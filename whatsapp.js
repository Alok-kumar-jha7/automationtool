import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import { sanitizeUserId } from './store.js';

// Map of active WhatsApp sessions: userId -> SessionState
const userSessions = new Map();

/**
 * Gets or creates session state container for a given userId.
 * @param {string} userId 
 * @returns {object}
 */
function getOrCreateSession(userId = 'default') {
  const cleanId = sanitizeUserId(userId);
  if (!userSessions.has(cleanId)) {
    userSessions.set(cleanId, {
      userId: cleanId,
      clientInstance: null,
      isClientReady: false,
      clientInitPromise: null,
      latestQrString: null,
      latestQrDataUrl: null,
      qrGeneratedAt: null,
      authStatus: 'disconnected', // 'disconnected' | 'initializing' | 'qr_ready' | 'authenticated' | 'ready' | 'auth_failure'
      authFailureReason: null,
    });
  }
  return userSessions.get(cleanId);
}

/**
 * Normalizes phone number or group ID into standard WhatsApp JID format.
 * - Individual: "1234567890@c.us"
 * - Group: "123456789-123456@g.us" or "120363025412345678@g.us"
 * 
 * @param {string} target 
 * @returns {string} Normalized JID
 */
export function formatRecipientJid(target) {
  if (!target || typeof target !== 'string') {
    throw new Error(`[WhatsApp] Invalid recipient identifier: "${target}"`);
  }

  const trimmed = target.trim();

  // Already a valid WhatsApp JID (direct contact @c.us or group @g.us)
  if (trimmed.endsWith('@c.us') || trimmed.endsWith('@g.us')) {
    return trimmed;
  }

  // Older WhatsApp group format with hyphens (e.g. 123456789-123456)
  if (/^\d+-\d+$/.test(trimmed)) {
    return `${trimmed}@g.us`;
  }

  const cleanDigits = trimmed.replace(/\D/g, '');

  // Modern WhatsApp group JID numbers are typically 17 to 20 digits long
  if (cleanDigits.length >= 17) {
    return `${cleanDigits}@g.us`;
  }

  if (!cleanDigits || cleanDigits.length < 7) {
    throw new Error(
      `[WhatsApp] Identifier "${target}" is too short or malformed. Provide country code + number or a group JID (e.g. 120363025412345678@g.us).`
    );
  }

  return `${cleanDigits}@c.us`;
}

/**
 * Initializes and starts the WhatsApp Web client for a specific user with LocalAuth persistence.
 * Returns a promise that resolves once the client is fully authenticated and ready.
 * 
 * @param {string} [userId='default'] - Unique workspace/user ID
 * @param {object} [options]
 * @param {string} [options.dataPath='./.wwebjs_auth'] - Path to store session tokens
 * @param {boolean} [options.headless=true] - Run browser headless
 * @returns {Promise<Client>}
 */
export function initWhatsAppClient(userId = 'default', options = {}) {
  const cleanId = sanitizeUserId(userId);
  const session = getOrCreateSession(cleanId);

  if (session.clientInitPromise) {
    return session.clientInitPromise;
  }

  const {
    dataPath = './.wwebjs_auth',
    headless = true,
  } = options;

  session.authStatus = 'initializing';
  session.authFailureReason = null;

  session.clientInitPromise = new Promise((resolve, reject) => {
    try {
      console.log(`[WhatsApp] [User: ${cleanId}] Initializing WhatsApp Web client...`);

      // For 'default', preserve legacy './.wwebjs_auth/session'
      // For any other workspace (e.g. 'john'), uses './.wwebjs_auth/session-john'
      const authStrategyConfig = cleanId === 'default'
        ? { dataPath }
        : { dataPath, clientId: cleanId };

      const client = new Client({
        authStrategy: new LocalAuth(authStrategyConfig),
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
        },
        puppeteer: {
          headless: true,
          ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-default-apps',
            '--mute-audio',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--disable-breakpad',
            '--disable-sync',
            '--disable-translate',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          ],
        },
      });

      session.clientInstance = client;

      // 45-second watchdog timer: alert user if browser takes too long to render WhatsApp Web
      const initWatchdog = setTimeout(() => {
        if (session.authStatus === 'initializing' && !session.latestQrDataUrl && !session.isClientReady) {
          console.warn(`[WhatsApp] [User: ${cleanId}] Initializing is taking >45s. Flagging timeout for retry.`);
          session.authStatus = 'timeout';
          session.authFailureReason = 'Browser is taking longer than expected. Click "Retry / Force Refresh" to restart.';
        }
      }, 45000);

      // Event: Loading screen / chat syncing after scan
      client.on('loading_screen', (percent, message) => {
        clearTimeout(initWatchdog);
        session.authStatus = 'loading';
        session.loadingPercent = percent;
        console.log(`[WhatsApp] [User: ${cleanId}] 🔄 Syncing WhatsApp: ${percent}% - ${message}`);
      });

      // Event: Display QR Code for terminal and web dashboard scanning
      client.on('qr', async (qr) => {
        clearTimeout(initWatchdog);
        session.latestQrString = qr;
        session.qrGeneratedAt = new Date().toISOString();
        session.authStatus = 'qr_ready';
        session.authFailureReason = null;

        try {
          session.latestQrDataUrl = await QRCode.toDataURL(qr, {
            margin: 2,
            scale: 7,
            color: { dark: '#000000', light: '#ffffff' },
          });
        } catch (err) {
          console.error(`[WhatsApp] [User: ${cleanId}] Failed to generate QR data URL:`, err.message);
        }

        console.log(`\n=============================================================`);
        console.log(`📱 [User: ${cleanId}] SCAN THIS QR CODE WITH YOUR WHATSAPP MOBILE APP:`);
        console.log(`   (WhatsApp Settings -> Linked Devices -> Link a Device)`);
        console.log(`=============================================================\n`);
        qrcode.generate(qr, { small: true });
        console.log(`\nWaiting for scan for user "${cleanId}"...\n`);
      });

      // Event: Authentication successful
      client.on('authenticated', () => {
        clearTimeout(initWatchdog);
        console.log(`[WhatsApp] [User: ${cleanId}] ✅ Session authenticated successfully.`);
        session.authStatus = 'authenticated';
        session.latestQrString = null;
        session.latestQrDataUrl = null;
        session.authFailureReason = null;
      });

      // Event: Authentication failure
      client.on('auth_failure', (msg) => {
        clearTimeout(initWatchdog);
        console.error(`[WhatsApp] [User: ${cleanId}] ❌ Authentication failure:`, msg);
        session.isClientReady = false;
        session.authStatus = 'auth_failure';
        session.authFailureReason = msg;
        session.latestQrString = null;
        session.latestQrDataUrl = null;
        reject(new Error(`WhatsApp authentication failure for ${cleanId}: ${msg}`));
      });

      // Event: Client is ready to send and receive messages
      client.on('ready', () => {
        clearTimeout(initWatchdog);
        session.isClientReady = true;
        session.authStatus = 'ready';
        session.latestQrString = null;
        session.latestQrDataUrl = null;
        session.authFailureReason = null;
        console.log(`[WhatsApp] [User: ${cleanId}] 🚀 WhatsApp client is READY and connected!`);
        resolve(client);
      });

      // Event: Disconnected / Logged out
      client.on('disconnected', (reason) => {
        clearTimeout(initWatchdog);
        console.warn(`[WhatsApp] [User: ${cleanId}] ⚠️ WhatsApp client was disconnected. Reason:`, reason);
        session.isClientReady = false;
        session.authStatus = 'disconnected';
        session.authFailureReason = reason ? String(reason) : 'Client disconnected';
        session.latestQrString = null;
        session.latestQrDataUrl = null;
        session.clientInitPromise = null;
      });

      // Event: Puppeteer browser crash or error
      client.on('error', (err) => {
        clearTimeout(initWatchdog);
        console.error(`[WhatsApp] [User: ${cleanId}] Client error occurred:`, err.message);
        session.authStatus = 'auth_failure';
        session.authFailureReason = err.message;
      });

      client.initialize().catch((err) => {
        clearTimeout(initWatchdog);
        console.error(`[WhatsApp] [User: ${cleanId}] Failed during initialize():`, err.message);
        session.isClientReady = false;
        session.authStatus = 'auth_failure';
        session.authFailureReason = err.message || 'Initialization failed';
        session.clientInitPromise = null;
        reject(err);
      });
    } catch (err) {
      session.isClientReady = false;
      session.authStatus = 'auth_failure';
      session.authFailureReason = err.message || 'Failed to start browser';
      session.clientInitPromise = null;
      reject(err);
    }
  });

  return session.clientInitPromise;
}

/**
 * Checks if WhatsApp client for a user is currently connected and ready.
 * @param {string} [userId='default']
 * @returns {boolean}
 */
export function isWhatsAppReady(userId = 'default') {
  const cleanId = sanitizeUserId(userId);
  const session = userSessions.get(cleanId);
  return Boolean(session && session.clientInstance && session.isClientReady);
}

/**
 * Gets current WhatsApp authentication and QR status for a user.
 * Auto-triggers initialization if not yet started.
 * @param {string} [userId='default']
 * @returns {object}
 */
export function getWhatsAppAuthStatus(userId = 'default') {
  const cleanId = sanitizeUserId(userId);
  const session = getOrCreateSession(cleanId);

  // Lazy auto-init if client hasn't started yet
  if (!session.clientInstance && !session.clientInitPromise && process.env.ENABLE_WHATSAPP !== 'false') {
    initWhatsAppClient(cleanId).catch((e) => {
      console.warn(`[WhatsApp] Lazy init notice for ${cleanId}:`, e.message);
    });
  }

  return {
    userId: cleanId,
    isReady: Boolean(session.clientInstance && session.isClientReady),
    status: session.isClientReady ? 'ready' : session.authStatus,
    loadingPercent: session.loadingPercent || 0,
    qrCode: session.latestQrString,
    qrDataUrl: session.latestQrDataUrl,
    qrGeneratedAt: session.qrGeneratedAt,
    authFailureReason: session.authFailureReason,
  };
}

/**
 * Fetches all available WhatsApp groups from user's active session.
 * @param {string} [userId='default']
 * @returns {Promise<Array<{ id: string, name: string, unreadCount: number, participantsCount: number }>>}
 */
export async function getWhatsAppGroups(userId = 'default') {
  const cleanId = sanitizeUserId(userId);
  const session = userSessions.get(cleanId);

  if (!session || !session.clientInstance || !session.isClientReady) {
    return [];
  }

  try {
    const chats = await session.clientInstance.getChats();
    if (!Array.isArray(chats)) return [];
    const groups = chats
      .filter((chat) => chat && chat.isGroup)
      .map((chat) => ({
        id: (chat.id && chat.id._serialized) || String(chat.id),
        name: chat.name || chat.formattedTitle || 'Unnamed Group',
        unreadCount: chat.unreadCount || 0,
        participantsCount: (chat.groupMetadata && chat.groupMetadata.participants && chat.groupMetadata.participants.length) || (chat.participants && chat.participants.length) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  } catch {
    return [];
  }
}

/**
 * Reconnects WhatsApp client for a user by clearing active session and re-initializing.
 * @param {string} [userId='default']
 * @param {object} [options]
 */
export async function reconnectWhatsAppClient(userId = 'default', options = {}) {
  const cleanId = sanitizeUserId(userId);
  await destroyWhatsAppClient(cleanId);
  return initWhatsAppClient(cleanId, options);
}

/**
 * Sends a message to a WhatsApp contact or group using specified user's session.
 * Waits up to timeoutMs if client is currently connecting.
 * 
 * @param {string} recipient - Phone number or WhatsApp group ID
 * @param {string} message - Message text to deliver
 * @param {object} [options]
 * @param {string} [options.userId='default']
 * @param {number} [options.timeoutMs=60000]
 * @returns {Promise<object>} - Message send confirmation details
 */
export async function sendWhatsAppMessage(recipient, message, options = {}) {
  const { userId = 'default', timeoutMs = 60000 } = (typeof options === 'number' ? { timeoutMs: options } : options);
  const cleanId = sanitizeUserId(userId);
  const session = getOrCreateSession(cleanId);

  if (!message || message.trim().length === 0) {
    throw new Error('[WhatsApp] Cannot send an empty message.');
  }

  const jid = formatRecipientJid(recipient);

  // If client instance is not running, attempt start
  if (!session.clientInstance && !session.clientInitPromise) {
    initWhatsAppClient(cleanId).catch(() => {});
  }

  // If not ready yet, wait for initialization
  if (!session.isClientReady) {
    console.log(`[WhatsApp] [User: ${cleanId}] Client not marked ready yet, waiting for connection...`);
    const startTime = Date.now();
    while (!session.isClientReady) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          `[WhatsApp] Timed out waiting for WhatsApp client (${cleanId}) to be ready (${timeoutMs / 1000}s). Please scan QR code or check network.`
        );
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  try {
    console.log(`[WhatsApp] [User: ${cleanId}] Dispatching message to: ${jid}...`);
    const result = await session.clientInstance.sendMessage(jid, message);
    const messageId = (result && result.id && (result.id._serialized || result.id.id || result.id)) || 'sent';
    console.log(`[WhatsApp] [User: ${cleanId}] ✅ Message successfully sent! (ID: ${messageId})`);
    return result || { success: true, id: messageId };
  } catch (error) {
    console.error(`[WhatsApp] [User: ${cleanId}] ❌ Failed to dispatch message to ${jid}:`, error.message);
    throw error;
  }
}

/**
 * Gracefully shuts down the WhatsApp Web session for a specific user, or all users if no userId given.
 * @param {string} [userId]
 */
export async function destroyWhatsAppClient(userId) {
  if (userId) {
    const cleanId = sanitizeUserId(userId);
    const session = userSessions.get(cleanId);
    if (session && session.clientInstance) {
      console.log(`[WhatsApp] Closing WhatsApp client session for user: ${cleanId}...`);
      try {
        await session.clientInstance.destroy();
      } catch (err) {
        console.error(`[WhatsApp] Error closing user ${cleanId}:`, err.message);
      } finally {
        session.clientInstance = null;
        session.isClientReady = false;
        session.clientInitPromise = null;
        session.authStatus = 'disconnected';
      }
    }
  } else {
    console.log('[WhatsApp] Closing all active WhatsApp client sessions...');
    for (const [uid, session] of userSessions.entries()) {
      if (session && session.clientInstance) {
        try {
          await session.clientInstance.destroy();
          console.log(`[WhatsApp] Closed session for ${uid}`);
        } catch (e) {
          console.error(`[WhatsApp] Error closing ${uid}:`, e.message);
        }
      }
    }
    userSessions.clear();
  }
}

