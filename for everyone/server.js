import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import cron from 'node-cron';
import { fileURLToPath } from 'node:url';
import { store } from './store.js';
import { analyzeDailyWork } from './analyzer.js';
import { getAggregatedDailyWork } from './logger.js';
import { dispatchReport } from './dispatcher.js';
import { isWhatsAppReady } from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// =============================================================================
// SECURITY MIDDLEWARE
// =============================================================================

// Helmet: Sets security-related HTTP headers (XSS protection, Content-Type sniffing, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS: Only allow same-origin in production
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGIN || false)
    : true,
}));

// Body parser with size limit to prevent payload attacks
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Global rate limiter: 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' },
});
app.use('/api/', globalLimiter);

// Strict rate limiter for AI endpoint (expensive API calls)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: 'AI enhancement rate limited. Max 10 per minute.' },
});

// Strict rate limiter for dispatch endpoint
const dispatchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, error: 'Dispatch rate limited. Max 5 per minute.' },
});

// =============================================================================
// INPUT SANITIZATION
// =============================================================================

/**
 * Sanitizes user input strings to prevent XSS and injection attacks.
 * Strips HTML tags and limits length.
 * @param {string} input
 * @param {number} maxLength
 * @returns {string}
 */
function sanitize(input, maxLength = 5000) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')         // Strip HTML tags
    .replace(/javascript:/gi, '')     // Remove js: protocol
    .replace(/on\w+\s*=/gi, '')       // Remove inline event handlers
    .slice(0, maxLength)
    .trim();
}

/**
 * Validates phone number format (digits only, 7-15 chars, optionally ending with @c.us or @g.us)
 * @param {string} phone
 * @returns {boolean}
 */
function isValidRecipient(phone) {
  if (!phone) return false;
  if (phone.endsWith('@c.us') || phone.endsWith('@g.us')) return true;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

// =============================================================================
// STATIC FILES
// =============================================================================
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

// =============================================================================
// CRON SCHEDULER
// =============================================================================
let activeCronTask = null;

/**
 * Reschedules the active node-cron task from the persisted state.
 */
export function rescheduleCronJob() {
  const state = store.getState();

  if (activeCronTask) {
    activeCronTask.stop();
    activeCronTask = null;
    console.log('[Scheduler] Stopped previous cron schedule.');
  }

  const cronExpression = state.cronExpression || '0 18 * * 1-5';

  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] Invalid cron expression: "${cronExpression}"`);
    return false;
  }

  console.log(`[Scheduler] ⏰ Scheduling cron: "${cronExpression}" (Enabled: ${state.isEnabled})`);

  activeCronTask = cron.schedule(cronExpression, async () => {
    const currentState = store.getState();
    console.log(`\n[Scheduler] ⏰ Trigger at ${new Date().toLocaleTimeString()}`);

    if (!currentState.isEnabled) {
      console.log('[Scheduler] ⏸️ Skipped: Automation is PAUSED.');
      store.logExecution({
        channel: currentState.dispatchChannel,
        recipient: currentState.recipient,
        status: 'paused',
        preview: 'Scheduled run skipped — master switch is paused',
      });
      return;
    }

    try {
      let textToSend = currentState.enhancedDraft;
      if (!textToSend || textToSend.trim().length === 0) {
        console.log('[Scheduler] Ingesting daily work notes & git logs...');
        const aggregated = await getAggregatedDailyWork();
        textToSend = await analyzeDailyWork(aggregated.rawContent);
        store.update({ rawText: aggregated.rawContent, enhancedDraft: textToSend });
      }

      await dispatchReport({
        text: textToSend,
        channel: currentState.dispatchChannel,
        recipient: currentState.recipient,
      });

      console.log('[Scheduler] ✅ Scheduled report dispatched!');
    } catch (err) {
      console.error('[Scheduler] ❌ Dispatch failed:', err.message);
    }
  });

  return true;
}

// =============================================================================
// REST API ENDPOINTS
// =============================================================================

// GET /api/status — Full current state + connectivity checks
app.get('/api/status', (req, res) => {
  const state = store.getState();
  res.json({
    success: true,
    data: {
      ...state,
      isWhatsAppConnected: isWhatsAppReady(),
      hasTelegramToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('sk-proj-xxxx')),
      serverTime: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    },
  });
});

// POST /api/toggle — Start/Stop master automation switch
app.post('/api/toggle', (req, res) => {
  const { isEnabled } = req.body;
  const updatedState = store.toggleMaster(isEnabled);
  console.log(`[API] Master Toggle: ${updatedState.isEnabled ? '🟢 RUNNING' : '🔴 PAUSED'}`);
  res.json({
    success: true,
    data: updatedState,
    message: updatedState.isEnabled ? 'Automation started and active.' : 'Automation stopped/paused.',
  });
});

// POST /api/preview — AI enhancement preview (rate-limited)
app.post('/api/preview', aiLimiter, async (req, res) => {
  try {
    const rawText = sanitize(req.body.rawText, 10000);

    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Raw work log text cannot be empty.',
      });
    }

    const enhanced = await analyzeDailyWork(rawText);
    store.update({ rawText, enhancedDraft: enhanced });

    res.json({
      success: true,
      data: { rawText, enhancedText: enhanced },
    });
  } catch (error) {
    console.error('[API /preview Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/schedule — Save dispatch configuration
app.post('/api/schedule', (req, res) => {
  try {
    const { scheduleTime, cronDays, recipient, dispatchChannel, rawText, enhancedDraft, isEnabled } = req.body;

    const updates = {};
    if (scheduleTime !== undefined) {
      // Validate HH:MM format
      if (!/^\d{1,2}:\d{2}$/.test(scheduleTime)) {
        return res.status(400).json({ success: false, error: 'Invalid time format. Use HH:MM.' });
      }
      updates.scheduleTime = scheduleTime;
    }
    if (cronDays !== undefined) {
      const validDays = ['1-5', '*', '1,3,5', '1-7', '6,0'];
      if (!validDays.includes(cronDays)) {
        return res.status(400).json({ success: false, error: 'Invalid frequency selection.' });
      }
      updates.cronDays = cronDays;
    }
    if (recipient !== undefined) {
      const cleanRecipient = sanitize(recipient, 50);
      if (cleanRecipient && !isValidRecipient(cleanRecipient)) {
        return res.status(400).json({ success: false, error: 'Invalid phone number or group ID format.' });
      }
      updates.recipient = cleanRecipient;
    }
    if (dispatchChannel !== undefined) {
      if (!['whatsapp', 'telegram', 'console'].includes(dispatchChannel)) {
        return res.status(400).json({ success: false, error: 'Invalid dispatch channel.' });
      }
      updates.dispatchChannel = dispatchChannel;
    }
    if (rawText !== undefined) updates.rawText = sanitize(rawText, 10000);
    if (enhancedDraft !== undefined) updates.enhancedDraft = sanitize(enhancedDraft, 10000);
    if (isEnabled !== undefined) updates.isEnabled = Boolean(isEnabled);

    const newState = store.update(updates);
    rescheduleCronJob();

    res.json({
      success: true,
      data: newState,
      message: 'Schedule settings saved successfully.',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/send-now — Instant manual dispatch (rate-limited)
app.post('/api/send-now', dispatchLimiter, async (req, res) => {
  try {
    const { text, channel, recipient } = req.body;
    const currentState = store.getState();

    const messageText = sanitize(text || currentState.enhancedDraft, 10000);
    if (!messageText || messageText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No report text to send. Enhance some notes first.',
      });
    }

    const targetRecipient = sanitize(recipient, 50) || currentState.recipient;
    if (!targetRecipient) {
      return res.status(400).json({
        success: false,
        error: 'Target recipient is missing.',
      });
    }

    if (!isValidRecipient(targetRecipient)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid recipient format.',
      });
    }

    const effectiveChannel = channel || currentState.dispatchChannel;
    if (!['whatsapp', 'telegram', 'console'].includes(effectiveChannel)) {
      return res.status(400).json({ success: false, error: 'Invalid dispatch channel.' });
    }

    const result = await dispatchReport({
      text: messageText,
      channel: effectiveChannel,
      recipient: targetRecipient,
      bypassMasterToggle: true,
    });

    res.json({
      success: true,
      data: result,
      message: `Report dispatched to ${targetRecipient} via ${result.channel}!`,
    });
  } catch (error) {
    console.error('[API /send-now Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/work-log/load — Read from local markdown & git
app.post('/api/work-log/load', async (req, res) => {
  try {
    const aggregated = await getAggregatedDailyWork();
    res.json({
      success: true,
      data: {
        rawContent: aggregated.rawContent,
        sources: aggregated.sources,
        hasData: aggregated.hasData,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/logs — Dispatch history
app.get('/api/logs', (req, res) => {
  const state = store.getState();
  res.json({ success: true, data: state.history || [] });
});

// POST /api/clear-history — Wipe dispatch logs
app.post('/api/clear-history', (req, res) => {
  store.update({ history: [] });
  res.json({ success: true, message: 'Dispatch history cleared.' });
});

// Health check for deployment
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

// Catch-all: serve index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
