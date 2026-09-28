import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

let clientInstance = null;
let isClientReady = false;
let clientInitPromise = null;

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

  // Already a valid WhatsApp JID
  if (trimmed.endsWith('@c.us') || trimmed.endsWith('@g.us')) {
    return trimmed;
  }

  // Strip non-digit characters (+, spaces, hyphens, parentheses)
  const cleanDigits = trimmed.replace(/\D/g, '');

  if (!cleanDigits || cleanDigits.length < 7) {
    throw new Error(
      `[WhatsApp] Phone number "${target}" is too short or malformed. Provide country code + number (e.g. 15551234567).`
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

      // Event: Display QR Code for terminal scanning
      clientInstance.on('qr', (qr) => {
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
      });

      // Event: Authentication failure
      clientInstance.on('auth_failure', (msg) => {
        console.error('[WhatsApp] ❌ Authentication failure:', msg);
        isClientReady = false;
        reject(new Error(`WhatsApp authentication failure: ${msg}`));
      });

      // Event: Client is ready to send and receive messages
      clientInstance.on('ready', () => {
        isClientReady = true;
        console.log('[WhatsApp] 🚀 WhatsApp client is READY and connected!');
        resolve(clientInstance);
      });

      // Event: Disconnected / Logged out
      clientInstance.on('disconnected', (reason) => {
        console.warn('[WhatsApp] ⚠️ WhatsApp client was disconnected. Reason:', reason);
        isClientReady = false;
        clientInitPromise = null;
      });

      // Event: Puppeteer browser crash or error
      clientInstance.on('error', (err) => {
        console.error('[WhatsApp] Client error occurred:', err);
      });

      clientInstance.initialize().catch((err) => {
        console.error('[WhatsApp] Failed during initialize():', err);
        isClientReady = false;
        clientInitPromise = null;
        reject(err);
      });
    } catch (err) {
      isClientReady = false;
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
    console.log(`[WhatsApp] ✅ Message successfully sent! (ID: ${result.id?._serialized || result.id?.id})`);
    return result;
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
