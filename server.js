import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import cron from 'node-cron';
import { fileURLToPath } from 'node:url';
import { store, sanitizeUserId } from './store.js';
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

// Multi-tenant user extractor middleware
app.use('/api', (req, res, next) => {
  const rawUser = req.headers['x-user-id'] || req.query.user || req.body?.userId || 'default';
  req.userId = sanitizeUserId(String(rawUser));
  req.sessionToken = req.headers['x-session-token'] || null;
  next();
});

/**
 * Token authentication middleware.
 * Validates x-session-token header matches the stored token for x-user-id.
 * Applied to all data-access endpoints to prevent cross-user access.
 */
function requireAuth(req, res, next) {
  // Allow workspace creation and health endpoints without auth
  if (!req.sessionToken) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please create or log into a workspace.',
      needsOnboarding: true,
    });
  }
  if (!store.validateSessionToken(req.userId, req.sessionToken)) {
    return res.status(403).json({
      success: false,
      error: 'Invalid session token. Please re-authenticate.',
      needsOnboarding: true,
    });
  }
  next();
}

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
// MULTI-TENANT CRON SCHEDULER
// =============================================================================
const activeCronTasks = new Map(); // userId -> cronTask

/**
 * Reschedules the active node-cron task for a specific user from their persisted state.
 * @param {string} [userId='default']
 */
export function rescheduleCronJobForUser(userId = 'default') {
  const cleanId = sanitizeUserId(userId);
  const state = store.getUserState(cleanId);

  if (activeCronTasks.has(cleanId)) {
    const existing = activeCronTasks.get(cleanId);
    existing.stop();
    activeCronTasks.delete(cleanId);
    console.log(`[Scheduler] [User: ${cleanId}] Stopped previous cron schedule.`);
  }

  const cronExpression = state.cronExpression || '0 18 * * 1-5';

  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] [User: ${cleanId}] Invalid cron expression: "${cronExpression}"`);
    return false;
  }

  console.log(`[Scheduler] [User: ${cleanId}] ⏰ Scheduling cron: "${cronExpression}" (Enabled: ${state.isEnabled})`);
  const nextTime = getNextCronTriggerTime(state.scheduleTime, state.cronDays, state.scheduleDate);
  if (nextTime) {
    console.log(`[Scheduler] [User: ${cleanId}] Next trigger at: ${nextTime}`);
  }

  const task = cron.schedule(cronExpression, async () => {
    const triggerTime = new Date().toISOString();
    const currentState = store.getUserState(cleanId);
    console.log(`\n[Scheduler] [User: ${cleanId}] ⏰ CRON TRIGGER FIRED at ${new Date().toLocaleTimeString()}`);
    console.log(`[Scheduler] [User: ${cleanId}] Schedule: ${currentState.scheduleTime} | Channel: ${currentState.dispatchChannel} | Recipient: ${currentState.recipient}`);

    if (!currentState.isEnabled) {
      console.log(`[Scheduler] [User: ${cleanId}] ⏸️ Skipped: Automation is PAUSED.`);
      store.logUserExecution(cleanId, {
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
        console.log(`[Scheduler] [User: ${cleanId}] No draft found. Ingesting daily work notes & git logs...`);
        const aggregated = await getAggregatedDailyWork();
        textToSend = await analyzeDailyWork(aggregated.rawContent);
        store.updateUserState(cleanId, { rawText: aggregated.rawContent, enhancedDraft: textToSend });
      }

      await dispatchReport({
        text: textToSend,
        channel: currentState.dispatchChannel,
        recipient: currentState.recipient,
        triggerType: 'scheduled',
        scheduledTime: currentState.scheduleTime,
        skipLogging: true,
        userId: cleanId,
      });

      store.logUserExecution(cleanId, {
        channel: currentState.dispatchChannel,
        recipient: currentState.recipient,
        status: 'success',
        preview: textToSend,
        triggerType: 'scheduled',
        scheduledTime: currentState.scheduleTime,
        triggerAt: triggerTime,
      });

      console.log(`[Scheduler] [User: ${cleanId}] ✅ Scheduled report dispatched successfully!`);
    } catch (err) {
      console.error(`[Scheduler] [User: ${cleanId}] ❌ Dispatch failed:`, err.message);
      store.logUserExecution(cleanId, {
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

  activeCronTasks.set(cleanId, task);
  return true;
}

/**
 * Reschedules all cron tasks for all known workspaces.
 * Uses listAllWorkspaces (internal) — not the user-scoped public API.
 */
export function rescheduleAllCronJobs() {
  const workspaces = store.listAllWorkspaces();
  console.log(`[Scheduler] Rescheduling cron jobs for ${workspaces.length} workspace(s)...`);
  for (const w of workspaces) {
    rescheduleCronJobForUser(w.id);
  }
}

// Backward compatibility alias
export const rescheduleCronJob = (userId = 'default') => rescheduleCronJobForUser(userId);

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

// GET /api/workspaces — Only returns the authenticated user's own workspace
app.get('/api/workspaces', requireAuth, (req, res) => {
  const workspaces = store.listWorkspaces(req.userId).map((w) => ({
    ...w,
    isWhatsAppConnected: isWhatsAppReady(w.id),
  }));
  res.json({
    success: true,
    data: workspaces,
    currentUserId: req.userId,
  });
});

// POST /api/workspaces — Create or initialize a new workspace (no auth required — this IS the signup)
app.post('/api/workspaces', (req, res) => {
  try {
    const rawName = req.body.name || req.body.id || '';
    const cleanId = sanitizeUserId(rawName);
    if (!cleanId) {
      return res.status(400).json({ success: false, error: 'Valid workspace name is required.' });
    }

    const state = store.getUserState(cleanId);
    const { sessionToken: _existingToken, ...safeState } = state;
    const sessionToken = store.ensureSessionToken(cleanId);
    rescheduleCronJobForUser(cleanId);

    res.json({
      success: true,
      data: {
        id: cleanId,
        name: cleanId === 'default' ? 'Default Workspace' : cleanId.charAt(0).toUpperCase() + cleanId.slice(1),
        sessionToken,
        state: safeState,
      },
      message: `Workspace "${cleanId}" is ready.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/status — Full current state for active user workspace (auth required)
app.get('/api/status', requireAuth, (req, res) => {
  const uid = req.userId;
  const state = store.getUserState(uid);
  // Strip sensitive token from API response
  const { sessionToken: _st, ...safeState } = state;
  const nextTriggerAt = getNextCronTriggerTime(state.scheduleTime, state.cronDays, state.scheduleDate);
  const whatsappAuth = getWhatsAppAuthStatus(uid);
  res.json({
    success: true,
    data: {
      ...safeState,
      userId: uid,
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

// GET /api/whatsapp/status — Real-time WhatsApp connection & QR code for active user (auth required)
app.get('/api/whatsapp/status', requireAuth, (req, res) => {
  const auth = getWhatsAppAuthStatus(req.userId);
  res.json({
    success: true,
    data: auth,
  });
});

// GET /api/whatsapp/groups — Get list of WhatsApp groups the user is part of (auth required)
app.get('/api/whatsapp/groups', requireAuth, async (req, res) => {
  try {
    const groups = await getWhatsAppGroups(req.userId);
    res.json({
      success: true,
      data: groups,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/whatsapp/reconnect — Trigger new QR code generation for active user (auth required)
app.post('/api/whatsapp/reconnect', requireAuth, async (req, res) => {
  try {
    console.log(`[API] [User: ${req.userId}] User requested WhatsApp client reconnect/new QR`);
    reconnectWhatsAppClient(req.userId).catch((err) => {
      console.warn(`[WhatsApp] [User: ${req.userId}] Reconnect notice:`, err.message);
    });
    res.json({
      success: true,
      message: 'WhatsApp reconnection initiated. QR code will refresh shortly.',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/toggle — Start/Stop master automation switch for active user (auth required)
app.post('/api/toggle', requireAuth, (req, res) => {
  const { isEnabled } = req.body;
  const updatedState = store.toggleUserMaster(req.userId, isEnabled);
  console.log(`[API] [User: ${req.userId}] Master Toggle: ${updatedState.isEnabled ? '🟢 RUNNING' : '🔴 PAUSED'}`);
  res.json({
    success: true,
    data: updatedState,
    message: updatedState.isEnabled ? 'Automation started and active.' : 'Automation stopped/paused.',
  });
});

// POST /api/preview — AI enhancement preview (rate-limited, auth required)
app.post('/api/preview', requireAuth, aiLimiter, async (req, res) => {
  try {
    const rawText = sanitize(req.body.rawText, 10000);

    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Raw work log text cannot be empty.',
      });
    }

    const enhanced = await analyzeDailyWork(rawText);
    store.updateUserState(req.userId, { rawText, enhancedDraft: enhanced });

    res.json({
      success: true,
      data: { rawText, enhancedText: enhanced },
    });
  } catch (error) {
    console.error('[API /preview Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/schedule — Save dispatch configuration for active user (auth required)
app.post('/api/schedule', requireAuth, (req, res) => {
  try {
    const { scheduleTime, cronDays, scheduleDate, recipient, dispatchChannel, rawText, enhancedDraft, isEnabled } = req.body;

    const updates = {};
    if (scheduleTime !== undefined) {
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

    const newState = store.updateUserState(req.userId, updates);
    rescheduleCronJobForUser(req.userId);

    res.json({
      success: true,
      data: newState,
      message: 'Schedule settings saved successfully.',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/send-now — Instant manual dispatch (rate-limited, auth required)
app.post('/api/send-now', requireAuth, dispatchLimiter, async (req, res) => {
  try {
    const { text, channel, recipient } = req.body;
    const currentState = store.getUserState(req.userId);

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

    if (effectiveChannel === 'whatsapp' && !isWhatsAppReady(req.userId)) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp is not connected for this workspace. Please scan the QR code to log in first.',
        needsWhatsAppLogin: true,
      });
    }

    const result = await dispatchReport({
      text: messageText,
      channel: effectiveChannel,
      recipient: targetRecipient,
      bypassMasterToggle: true,
      userId: req.userId,
    });

    res.json({
      success: true,
      data: result,
      message: `Report dispatched to ${targetRecipient} via ${result.channel}!`,
    });
  } catch (error) {
    console.error(`[API /send-now Error] [User: ${req.userId}]:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/work-log/load — Read from local markdown & git (isolated per user, auth required)
app.post('/api/work-log/load', requireAuth, async (req, res) => {
  try {
    if (req.userId === 'default') {
      const aggregated = await getAggregatedDailyWork();
      res.json({
        success: true,
        data: {
          rawContent: aggregated.rawContent,
          sources: aggregated.sources,
          hasData: aggregated.hasData,
        },
      });
    } else {
      // Non-default users: strictly isolated. Only load their own saved draft notes
      const userState = store.getUserState(req.userId);
      res.json({
        success: true,
        data: {
          rawContent: userState.rawText || '',
          sources: userState.rawText ? ['Workspace Draft'] : [],
          hasData: Boolean(userState.rawText && userState.rawText.trim().length > 0),
        },
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/logs — Dispatch history for active user (auth required)
app.get('/api/logs', requireAuth, (req, res) => {
  const state = store.getUserState(req.userId);
  res.json({ success: true, data: state.history || [] });
});

// POST /api/clear-history — Wipe dispatch logs for active user (auth required)
app.post('/api/clear-history', requireAuth, (req, res) => {
  store.updateUserState(req.userId, { history: [] });
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
