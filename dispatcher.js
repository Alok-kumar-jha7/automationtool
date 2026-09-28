import { sendWhatsAppMessage, isWhatsAppReady } from './whatsapp.js';
import { store } from './store.js';

/**
 * Sends a message via Telegram Bot API using native fetch.
 * Extremely lightweight, 0 RAM overhead, ideal for cloud hosting on Render/Railway/Replit.
 * 
 * @param {string} chatId - Target Telegram user or channel ID
 * @param {string} text - Message text
 * @returns {Promise<object>}
 */
export async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('[Telegram] TELEGRAM_BOT_TOKEN is not configured in .env');
  }

  const cleanChatId = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!cleanChatId) {
    throw new Error('[Telegram] Telegram Chat ID is not specified.');
  }

  console.log(`[Telegram] Sending message to Chat ID: ${cleanChatId}...`);

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: cleanChatId,
      text,
      parse_mode: 'Markdown',
    }),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`[Telegram Error] ${data.description || 'Failed to send message'}`);
  }

  console.log('[Telegram] ✅ Message sent successfully!');
  return data;
}

/**
 * Universal Dispatcher: Routes message according to selected channel (WhatsApp, Telegram, Console)
 * Performs Master Toggle switch check prior to execution.
 * 
 * @param {object} params
 * @param {string} params.text - Final text to dispatch
 * @param {string} [params.channel] - 'whatsapp' | 'telegram' | 'console'
 * @param {string} [params.recipient] - Target phone number or chat ID
 * @param {boolean} [params.bypassMasterToggle=false] - Used for manual "Send Now" tests
 * @returns {Promise<{ sent: boolean, channel: string, reason?: string, details?: any }>}
 */
export async function dispatchReport({
  text,
  channel,
  recipient,
  bypassMasterToggle = false,
  triggerType = 'manual',
  scheduledTime = null,
  skipLogging = false,
}) {
  const currentState = store.getState();
  const effectiveChannel = channel || currentState.dispatchChannel || 'whatsapp';
  const effectiveRecipient = recipient || currentState.recipient;

  // 1. Check Master Toggle Switch
  if (!currentState.isEnabled && !bypassMasterToggle) {
    const reason = 'Dispatch aborted: Master Toggle Switch is set to STOP (Disabled).';
    console.warn(`[Dispatcher] ⏸️ ${reason}`);
    if (!skipLogging) {
      store.logExecution({
        channel: effectiveChannel,
        recipient: effectiveRecipient,
        status: 'paused',
        preview: text,
        error: 'Automation is paused by user',
        triggerType,
        scheduledTime,
      });
    }
    return { sent: false, channel: effectiveChannel, reason };
  }

  if (!text || text.trim().length === 0) {
    throw new Error('[Dispatcher] Cannot dispatch empty message content.');
  }

  try {
    let result = null;

    if (effectiveChannel === 'telegram') {
      result = await sendTelegramMessage(effectiveRecipient, text);
    } else if (effectiveChannel === 'whatsapp') {
      result = await sendWhatsAppMessage(effectiveRecipient, text);
    } else {
      // Console / Mock channel for cloud or test environments
      console.log('\n================== [DISPATCHER: CONSOLE MOCK] ==================');
      console.log(`To: ${effectiveRecipient || 'Console Output'}`);
      console.log(text);
      console.log('=================================================================\n');
      result = { mock: true, timestamp: new Date().toISOString() };
    }

    if (!skipLogging) {
      store.logExecution({
        channel: effectiveChannel,
        recipient: effectiveRecipient,
        status: 'success',
        preview: text,
        triggerType,
        scheduledTime,
      });
    }

    return { sent: true, channel: effectiveChannel, details: result };
  } catch (error) {
    console.error(`[Dispatcher] Failed to send via ${effectiveChannel}:`, error.message);
    if (!skipLogging) {
      store.logExecution({
        channel: effectiveChannel,
        recipient: effectiveRecipient,
        status: 'failed',
        preview: text,
        error: error.message,
        triggerType,
        scheduledTime,
      });
    }
    throw error;
  }
}
