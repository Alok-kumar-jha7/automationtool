import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('./data');
const STATE_FILE = path.join(DATA_DIR, 'app_state.json');

const DEFAULT_STATE = {
  isEnabled: true,
  scheduleTime: '18:00',
  cronDays: '1-5', // 1-5 = Mon-Fri, * = Every day
  scheduleDate: null, // null for recurring, or 'YYYY-MM-DD' for specific date
  cronExpression: '0 18 * * 1-5',
  recipient: process.env.TARGET_PHONE_NUMBER || '',
  dispatchChannel: process.env.DEFAULT_DISPATCH_CHANNEL || 'whatsapp', // 'whatsapp' | 'telegram' | 'console'
  rawText: '',
  enhancedDraft: '',
  lastSentAt: null,
  lastStatus: 'idle',
  history: [],
};

class StateStore {
  constructor() {
    this.state = { ...DEFAULT_STATE };
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(STATE_FILE)) {
        const fileData = fs.readFileSync(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(fileData);
        this.state = { ...DEFAULT_STATE, ...parsed };
      } else {
        this.save();
      }
    } catch (err) {
      console.warn('[Store] Warning: Could not read app_state.json, using defaults.', err.message);
      this.state = { ...DEFAULT_STATE };
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Store] Failed to write app_state.json:', err.message);
    }
  }

  getState() {
    return { ...this.state };
  }

  update(updates) {
    this.state = {
      ...this.state,
      ...updates,
    };

    // If time, days, or specific date were updated, automatically recalculate cronExpression
    if (updates.scheduleTime || updates.cronDays || updates.scheduleDate !== undefined) {
      const [hour = '18', min = '00'] = (this.state.scheduleTime || '18:00').split(':');
      if (this.state.scheduleDate && /^\d{4}-\d{2}-\d{2}$/.test(this.state.scheduleDate)) {
        const parts = this.state.scheduleDate.split('-');
        const dayOfMonth = parseInt(parts[2], 10);
        const month = parseInt(parts[1], 10);
        this.state.cronExpression = `${parseInt(min, 10)} ${parseInt(hour, 10)} ${dayOfMonth} ${month} *`;
      } else {
        const days = this.state.cronDays || '1-5';
        this.state.cronExpression = `${parseInt(min, 10)} ${parseInt(hour, 10)} * * ${days}`;
      }
    }

    this.save();
    return this.getState();
  }

  toggleMaster(enabled) {
    const isEnabled = typeof enabled === 'boolean' ? enabled : !this.state.isEnabled;
    return this.update({ isEnabled });
  }

  logExecution({ channel, recipient, status, preview, error = null, triggerType = 'manual', scheduledTime = null, triggerAt = null }) {
    const entry = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      channel,
      recipient,
      status, // 'success' | 'failed' | 'paused' | 'scheduled'
      preview: preview ? preview.slice(0, 140) + '...' : '',
      error: error ? String(error) : null,
      triggerType, // 'scheduled' | 'manual'
      scheduledTime: scheduledTime || null, // e.g. "21:00"
      triggerAt: triggerAt || new Date().toISOString(), // actual trigger timestamp
    };

    const history = [entry, ...(this.state.history || [])].slice(0, 100); // Keep last 100
    return this.update({
      history,
      lastSentAt: status === 'success' ? entry.timestamp : this.state.lastSentAt,
      lastStatus: status,
    });
  }
}

export const store = new StateStore();
