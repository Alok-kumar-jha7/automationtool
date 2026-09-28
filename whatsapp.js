import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';

let clientInstance = null;
let isClientReady = false;
let clientInitPromise = null;
let latestQrString = null;
let latestQrDataUrl = null;
let qrGeneratedAt = null;
let authStatus = 'initializing'; // 'disconnected' | 'qr_ready' | 'authenticated' | 'ready' | 'auth_failure'
let authFailureReason = null;

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
 * Initializes and starts the WhatsApp Web client with LocalAuth persistence.
 * Returns a promise that resolves once the client is fully authenticated and ready.
 * 
 * @param {object} [options]
 * @param {string} [options.dataPath='./.wwebjs_auth'] - Path to store session tokens
 * @param {boolean} [options.headless=true] - Run browser headless
 * @returns {Promise<Client>}
 */
export function initWhatsAppClient(options = {}) {
  if (clientInitPromise) {
    return clientInitPromise;
  }

  const {
    dataPath = './.wwebjs_auth',
    headless = true,
  } = options;

  authStatus = 'initializing';
  authFailureReason = null;

  clientInitPromise = new Promise((resolve, reject) => {
    try {
      console.log('[WhatsApp] Initializing WhatsApp Web client...');

      clientInstance = new Client({
        authStrategy: new LocalAuth({
          dataPath,
        }),
        puppeteer: {
          headless,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
          ],
        },
      });

      // Event: Display QR Code for terminal and web dashboard scanning
      clientInstance.on('qr', async (qr) => {
        latestQrString = qr;
        qrGeneratedAt = new Date().toISOString();
        authStatus = 'qr_ready';
        authFailureReason = null;

        try {
          latestQrDataUrl = await QRCode.toDataURL(qr, {
            margin: 2,
            scale: 7,
            color: { dark: '#000000', light: '#ffffff' },
          });
        } catch (err) {
          console.error('[WhatsApp] Failed to generate QR data URL:', err.message);
        }

        console.log('\n=============================================================');
        console.log('📱 SCAN THIS QR CODE WITH YOUR WHATSAPP MOBILE APP:');
        console.log('   (WhatsApp Settings -> Linked Devices -> Link a Device)');
        console.log('=============================================================\n');
        qrcode.generate(qr, { small: true });
        console.log('\nWaiting for authentication scan...\n');
      });

      // Event: Authentication successful
      clientInstance.on('authenticated', () => {
        console.log('[WhatsApp] ✅ Session authenticated successfully. Session stored in', dataPath);
        authStatus = 'authenticated';
        latestQrString = null;
        latestQrDataUrl = null;
        authFailureReason = null;
      });

      // Event: Authentication failure
      clientInstance.on('auth_failure', (msg) => {
        console.error('[WhatsApp] ❌ Authentication failure:', msg);
        isClientReady = false;
        authStatus = 'auth_failure';
        authFailureReason = msg;
        latestQrString = null;
        latestQrDataUrl = null;
        reject(new Error(`WhatsApp authentication failure: ${msg}`));
      });

      // Event: Client is ready to send and receive messages
      clientInstance.on('ready', () => {
        isClientReady = true;
        authStatus = 'ready';
        latestQrString = null;
        latestQrDataUrl = null;
        authFailureReason = null;
        console.log('[WhatsApp] 🚀 WhatsApp client is READY and connected!');
        resolve(clientInstance);
      });

      // Event: Disconnected / Logged out
      clientInstance.on('disconnected', (reason) => {
        console.warn('[WhatsApp] ⚠️ WhatsApp client was disconnected. Reason:', reason);
        isClientReady = false;
        authStatus = 'disconnected';
        latestQrString = null;
        latestQrDataUrl = null;
        clientInitPromise = null;
      });

      // Event: Puppeteer browser crash or error
      clientInstance.on('error', (err) => {
        console.error('[WhatsApp] Client error occurred:', err);
      });

      clientInstance.initialize().catch((err) => {
        console.error('[WhatsApp] Failed during initialize():', err);
        isClientReady = false;
        authStatus = 'disconnected';
        clientInitPromise = null;
        reject(err);
      });
    } catch (err) {
      isClientReady = false;
      authStatus = 'disconnected';
      clientInitPromise = null;
      reject(err);
    }
  });

  return clientInitPromise;
}

/**
 * Checks if WhatsApp client is currently connected and ready.
 * @returns {boolean}
 */
export function isWhatsAppReady() {
  return Boolean(clientInstance && isClientReady);
}

/**
 * Gets the current WhatsApp authentication and QR status.
 * @returns {object}
 */
export function getWhatsAppAuthStatus() {
  return {
    isReady: Boolean(clientInstance && isClientReady),
    status: isClientReady ? 'ready' : authStatus,
    qrCode: latestQrString,
    qrDataUrl: latestQrDataUrl,
    qrGeneratedAt,
    authFailureReason,
  };
}

/**
 * Fetches all available WhatsApp groups from active session.
 * @returns {Promise<Array<{ id: string, name: string, unreadCount: number, participantsCount: number }>>}
 */
export async function getWhatsAppGroups() {
  if (!clientInstance || !isClientReady) {
    return [];
  }
  try {
    const chats = await clientInstance.getChats();
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
 * Reconnects WhatsApp client by clearing active session and re-initializing.
 */
export async function reconnectWhatsAppClient(options = {}) {
  await destroyWhatsAppClient();
  return initWhatsAppClient(options);
}

/**
 * Sends a message to a WhatsApp contact or group.
 * Waits up to timeoutMs if client is currently in the process of connecting.
 * 
 * @param {string} recipient - Phone number or WhatsApp group ID
 * @param {string} message - Message text to deliver
 * @param {number} [timeoutMs=60000] - Maximum wait time for client readiness
 * @returns {Promise<object>} - Message send confirmation details
 */
export async function sendWhatsAppMessage(recipient, message, timeoutMs = 60000) {
  if (!message || message.trim().length === 0) {
    throw new Error('[WhatsApp] Cannot send an empty message.');
  }

  const jid = formatRecipientJid(recipient);

  // If not ready yet, wait for initialization
  if (!isClientReady) {
    console.log('[WhatsApp] Client not marked ready yet, waiting for connection...');
    const startTime = Date.now();
    while (!isClientReady) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          `[WhatsApp] Timed out waiting for WhatsApp client to be ready (${timeoutMs / 1000}s). Please scan QR code or check network.`
        );
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  try {
    console.log(`[WhatsApp] Dispatching message to: ${jid}...`);
    const result = await clientInstance.sendMessage(jid, message);
    const messageId = (result && result.id && (result.id._serialized || result.id.id || result.id)) || 'sent';
    console.log(`[WhatsApp] ✅ Message successfully sent! (ID: ${messageId})`);
    return result || { success: true, id: messageId };
  } catch (error) {
    console.error(`[WhatsApp] ❌ Failed to dispatch message to ${jid}:`, error.message);
    throw error;
  }
}

/**
 * Gracefully shuts down the WhatsApp Web Puppeteer session.
 */
export async function destroyWhatsAppClient() {
  if (clientInstance) {
    console.log('[WhatsApp] Closing WhatsApp client session...');
    try {
      await clientInstance.destroy();
      console.log('[WhatsApp] Client session closed.');
    } catch (err) {
      console.error('[WhatsApp] Error during client shutdown:', err.message);
    } finally {
      clientInstance = null;
      isClientReady = false;
      clientInitPromise = null;
    }
  }
}
