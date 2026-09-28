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
import {
  isWhatsAppReady,
  getWhatsAppAuthStatus,
  reconnectWhatsAppClient,
  getWhatsAppGroups,
} from './whatsapp.js';

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
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
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
 * Validates phone number or group ID format.
 * Supports direct phones (+1234567, 1234567890@c.us) and WhatsApp groups (120363xxxx@g.us, 12345-6789).
 * @param {string} target
 * @returns {boolean}
 */
function isValidRecipient(target) {
  if (!target) return false;
  const trimmed = target.trim();
  if (trimmed.endsWith('@c.us') || trimmed.endsWith('@g.us')) return true;
  if (/^\d+-\d+$/.test(trimmed)) return true;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7;
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
  const nextTime = getNextCronTriggerTime(state.scheduleTime, state.cronDays, state.scheduleDate);
  if (nextTime) {
    console.log(`[Scheduler] Next trigger at: ${nextTime}`);
  }

  activeCronTask = cron.schedule(cronExpression, async () => {
    const triggerTime = new Date().toISOString();
    const currentState = store.getState();
    console.log(`\n[Scheduler] ⏰ CRON TRIGGER FIRED at ${new Date().toLocaleTimeString()}`);
    console.log(`[Scheduler] Schedule was: ${currentState.scheduleTime} | Channel: ${currentState.dispatchChannel} | Recipient: ${currentState.recipient}`);

    // Log that the schedule triggered (regardless of enabled state)
    if (!currentState.isEnabled) {
      console.log('[Scheduler] ⏸️ Skipped: Automation is PAUSED.');
      store.logExecution({
        channel: currentState.dispatchChannel,
        recipient: currentState.recipient,
        status: 'paused',
        preview: `⏸️ Scheduled trigger at ${currentState.scheduleTime} — skipped (automation paused)`,
        triggerType: 'scheduled',
        scheduledTime: currentState.scheduleTime,
        triggerAt: triggerTime,
      });
      return;
    }

    try {
      let textToSend = currentState.enhancedDraft;
      if (!textToSend || textToSend.trim().length === 0) {
        console.log('[Scheduler] No draft found. Ingesting daily work notes & git logs...');
        const aggregated = await getAggregatedDailyWork();
        textToSend = await analyzeDailyWork(aggregated.rawContent);
        store.update({ rawText: aggregated.rawContent, enhancedDraft: textToSend });
      }

      await dispatchReport({
        text: textToSend,
        channel: currentState.dispatchChannel,
        recipient: currentState.recipient,
        triggerType: 'scheduled',
        scheduledTime: currentState.scheduleTime,
        skipLogging: true,
      });

      store.logExecution({
        channel: currentState.dispatchChannel,
        recipient: currentState.recipient,
        status: 'success',
        preview: textToSend,
        triggerType: 'scheduled',
        scheduledTime: currentState.scheduleTime,
        triggerAt: triggerTime,
      });

      console.log('[Scheduler] ✅ Scheduled report dispatched successfully!');
    } catch (err) {
      console.error('[Scheduler] ❌ Dispatch failed:', err.message);
      store.logExecution({
        channel: currentState.dispatchChannel,
        recipient: currentState.recipient,
        status: 'failed',
        preview: `❌ Scheduled trigger at ${currentState.scheduleTime} — dispatch failed`,
        error: err.message,
        triggerType: 'scheduled',
        scheduledTime: currentState.scheduleTime,
        triggerAt: triggerTime,
      });
    }
  });

  return true;
}

/**
 * Calculates the next cron trigger time as a human-readable string.
 */
function getNextCronTriggerTime(scheduleTime = '21:00', cronDays = '*', scheduleDate = null) {
  try {
    const [hour, min] = (scheduleTime || '21:00').split(':').map(Number);
    const now = new Date();

    if (scheduleDate && /^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
      const [y, m, d] = scheduleDate.split('-').map(Number);
      const target = new Date(y, m - 1, d, hour, min, 0, 0);
      return target.toISOString();
    }

    // Parse allowed days
    let allowedDays;
    if (cronDays === '*') {
      allowedDays = [0, 1, 2, 3, 4, 5, 6];
    } else if (cronDays === '1-5') {
      allowedDays = [1, 2, 3, 4, 5];
    } else if (cronDays === '1,3,5') {
      allowedDays = [1, 3, 5];
    } else {
      allowedDays = [0, 1, 2, 3, 4, 5, 6];
    }

    // Check today first
    for (let i = 0; i <= 7; i++) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + i);
      candidate.setHours(hour, min, 0, 0);
      const dayOfWeek = candidate.getDay();

      if (allowedDays.includes(dayOfWeek) && candidate > now) {
        return candidate.toISOString();
      }
    }
    return null;
  } catch {
    return null;
  }
}

export { getNextCronTriggerTime };

// =============================================================================
// REST API ENDPOINTS
// =============================================================================

// GET /api/status — Full current state + connectivity checks + next trigger
app.get('/api/status', (req, res) => {
  const state = store.getState();
  const nextTriggerAt = getNextCronTriggerTime(state.scheduleTime, state.cronDays, state.scheduleDate);
  const whatsappAuth = getWhatsAppAuthStatus();
  res.json({
    success: true,
    data: {
      ...state,
      nextTriggerAt,
      isWhatsAppConnected: whatsappAuth.isReady,
      whatsappAuth,
      hasTelegramToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('sk-proj-xxxx')),
      serverTime: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    },
  });
});

// GET /api/whatsapp/status — Real-time WhatsApp connection & QR code
app.get('/api/whatsapp/status', (req, res) => {
  const auth = getWhatsAppAuthStatus();
  res.json({
    success: true,
    data: auth,
  });
});

// GET /api/whatsapp/groups — Get list of WhatsApp groups the user is part of
app.get('/api/whatsapp/groups', async (req, res) => {
  try {
    const groups = await getWhatsAppGroups();
    res.json({
      success: true,
      data: groups,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/whatsapp/reconnect — Trigger new QR code generation
app.post('/api/whatsapp/reconnect', async (req, res) => {
  try {
    console.log('[API] User requested WhatsApp client reconnect/new QR');
    reconnectWhatsAppClient().catch((err) => {
      console.warn('[WhatsApp] Reconnect notice:', err.message);
    });
    res.json({
      success: true,
      message: 'WhatsApp reconnection initiated. QR code will refresh shortly.',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
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
    const { scheduleTime, cronDays, scheduleDate, recipient, dispatchChannel, rawText, enhancedDraft, isEnabled } = req.body;

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
    if (scheduleDate !== undefined) {
      if (scheduleDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
        return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD.' });
      }
      updates.scheduleDate = scheduleDate || null;
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

    if (effectiveChannel === 'whatsapp' && !isWhatsAppReady()) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp is not connected. Please scan the QR code to log in first.',
        needsWhatsAppLogin: true,
      });
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
