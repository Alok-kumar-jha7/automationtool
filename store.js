import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve('./data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const LEGACY_STATE_FILE = path.join(DATA_DIR, 'app_state.json');

export const DEFAULT_USER_STATE = {
  isEnabled: true,
  scheduleTime: '18:00',
  cronDays: '1-5', // 1-5 = Mon-Fri, * = Every day
  scheduleDate: null, // null for recurring, or 'YYYY-MM-DD' for specific date
  cronExpression: '0 18 * * 1-5',
  recipient: '', // Strictly empty for new users to guarantee zero cross-user data leakage
  dispatchChannel: 'whatsapp',
  rawText: '',
  enhancedDraft: '',
  lastSentAt: null,
  lastStatus: 'idle',
  history: [],
  sessionToken: null, // Per-user auth token, auto-generated on workspace creation
  createdAt: null,
};

/**
 * Sanitizes and normalizes workspace/user IDs.
 * Allows alphanumeric, hyphens, and underscores.
 * @param {string} userId
 * @returns {string}
 */
export function sanitizeUserId(userId) {
  if (!userId || typeof userId !== 'string') return 'default';
  const clean = userId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  return clean || 'default';
}

class StateStore {
  constructor() {
    this.userStates = new Map();
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (!fs.existsSync(USERS_DIR)) {
        fs.mkdirSync(USERS_DIR, { recursive: true });
      }

      // Check for legacy data/app_state.json and migrate to data/users/default.json
      const defaultUserFile = path.join(USERS_DIR, 'default.json');
      if (!fs.existsSync(defaultUserFile) && fs.existsSync(LEGACY_STATE_FILE)) {
        try {
          const legacyData = fs.readFileSync(LEGACY_STATE_FILE, 'utf-8');
          fs.writeFileSync(defaultUserFile, legacyData, 'utf-8');
          console.log('[Store] Migrated legacy app_state.json to users/default.json');
        } catch (e) {
          console.warn('[Store] Could not migrate legacy app_state.json:', e.message);
        }
      }

      // Load all existing users in data/users/
      const files = fs.readdirSync(USERS_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const uid = path.basename(file, '.json');
          this.loadUserStateFromFile(uid);
        }
      }

      // Ensure 'default' user is always available
      if (!this.userStates.has('default')) {
        this.getUserState('default');
      }
    } catch (err) {
      console.warn('[Store] Warning during store initialization:', err.message);
    }
  }

  getUserFilePath(userId) {
    const cleanId = sanitizeUserId(userId);
    return path.join(USERS_DIR, `${cleanId}.json`);
  }

  loadUserStateFromFile(userId) {
    const cleanId = sanitizeUserId(userId);
    const filePath = this.getUserFilePath(cleanId);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const state = { ...DEFAULT_USER_STATE, ...parsed };
        if (!state.sessionToken) {
          state.sessionToken = crypto.randomBytes(32).toString('hex');
          if (!state.createdAt) state.createdAt = new Date().toISOString();
          this.userStates.set(cleanId, state);
          this.saveUserState(cleanId);
          return state;
        }
        this.userStates.set(cleanId, state);
        return state;
      }
    } catch (err) {
      console.warn(`[Store] Could not read user state for "${cleanId}":`, err.message);
    }
    const fallback = {
      ...DEFAULT_USER_STATE,
      sessionToken: crypto.randomBytes(32).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    this.userStates.set(cleanId, fallback);
    this.saveUserState(cleanId);
    return fallback;
  }

  saveUserState(userId) {
    const cleanId = sanitizeUserId(userId);
    const state = this.userStates.get(cleanId) || { ...DEFAULT_USER_STATE };
    try {
      if (!fs.existsSync(USERS_DIR)) {
        fs.mkdirSync(USERS_DIR, { recursive: true });
      }
      const filePath = this.getUserFilePath(cleanId);
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');

      // Also mirror to legacy app_state.json if userId is default
      if (cleanId === 'default') {
        fs.writeFileSync(LEGACY_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
      }
    } catch (err) {
      console.error(`[Store] Failed to save state for user "${cleanId}":`, err.message);
    }
  }

  getUserState(userId = 'default') {
    const cleanId = sanitizeUserId(userId);
    if (!this.userStates.has(cleanId)) {
      return this.loadUserStateFromFile(cleanId);
    }
    return { ...this.userStates.get(cleanId) };
  }

  updateUserState(userId = 'default', updates = {}) {
    const cleanId = sanitizeUserId(userId);
    const current = this.getUserState(cleanId);

    const merged = {
      ...current,
      ...updates,
    };

    // If time, days, or specific date were updated, recalculate cronExpression
    if (updates.scheduleTime || updates.cronDays || updates.scheduleDate !== undefined) {
      const [hour = '18', min = '00'] = (merged.scheduleTime || '18:00').split(':');
      if (merged.scheduleDate && /^\d{4}-\d{2}-\d{2}$/.test(merged.scheduleDate)) {
        const parts = merged.scheduleDate.split('-');
        const dayOfMonth = parseInt(parts[2], 10);
        const month = parseInt(parts[1], 10);
        merged.cronExpression = `${parseInt(min, 10)} ${parseInt(hour, 10)} ${dayOfMonth} ${month} *`;
      } else {
        const days = merged.cronDays || '1-5';
        merged.cronExpression = `${parseInt(min, 10)} ${parseInt(hour, 10)} * * ${days}`;
      }
    }

    this.userStates.set(cleanId, merged);
    this.saveUserState(cleanId);
    return { ...merged };
  }

  toggleUserMaster(userId = 'default', enabled) {
    const cleanId = sanitizeUserId(userId);
    const current = this.getUserState(cleanId);
    const isEnabled = typeof enabled === 'boolean' ? enabled : !current.isEnabled;
    return this.updateUserState(cleanId, { isEnabled });
  }

  logUserExecution(userId = 'default', { channel, recipient, status, preview, error = null, triggerType = 'manual', scheduledTime = null, triggerAt = null }) {
    const cleanId = sanitizeUserId(userId);
    const current = this.getUserState(cleanId);

    const entry = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      channel,
      recipient,
      status, // 'success' | 'failed' | 'paused' | 'scheduled'
      preview: preview ? preview.slice(0, 140) + '...' : '',
      error: error ? String(error) : null,
      triggerType, // 'scheduled' | 'manual'
      scheduledTime: scheduledTime || null,
      triggerAt: triggerAt || new Date().toISOString(),
    };

    const history = [entry, ...(current.history || [])].slice(0, 100);
    return this.updateUserState(cleanId, {
      history,
      lastSentAt: status === 'success' ? entry.timestamp : current.lastSentAt,
      lastStatus: status,
    });
  }

  /**
   * Validates a session token for a specific user.
   * @param {string} userId
   * @param {string} token
   * @returns {boolean}
   */
  validateSessionToken(userId, token) {
    if (!userId || !token) return false;
    const cleanId = sanitizeUserId(userId);
    const state = this.getUserState(cleanId);
    return state.sessionToken && state.sessionToken === token;
  }

  /**
   * Returns the session token for a user (used during workspace creation response).
   * @param {string} userId
   * @returns {string|null}
   */
  getSessionToken(userId) {
    const cleanId = sanitizeUserId(userId);
    const state = this.getUserState(cleanId);
    return state.sessionToken || null;
  }

  /**
   * Ensures a user has a session token (migrates legacy users).
   * @param {string} userId
   * @returns {string} The session token
   */
  ensureSessionToken(userId) {
    const cleanId = sanitizeUserId(userId);
    const state = this.getUserState(cleanId);
    if (!state.sessionToken) {
      const token = crypto.randomBytes(32).toString('hex');
      this.updateUserState(cleanId, { sessionToken: token });
      return token;
    }
    return state.sessionToken;
  }

  /**
   * Lists all workspaces on the server (internal use for cron rescheduling).
   * @returns {Array<{id: string, name: string}>}
   */
  listAllWorkspaces() {
    try {
      if (!fs.existsSync(USERS_DIR)) return [{ id: 'default', name: 'Default Workspace' }];
      const files = fs.readdirSync(USERS_DIR);
      const workspaces = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = path.basename(file, '.json');
          workspaces.push({
            id,
            name: id === 'default' ? 'Default Workspace' : id.charAt(0).toUpperCase() + id.slice(1),
          });
        }
      }

      if (workspaces.length === 0) {
        workspaces.push({ id: 'default', name: 'Default Workspace' });
      }
      return workspaces;
    } catch {
      return [{ id: 'default', name: 'Default Workspace' }];
    }
  }

  /**
   * Returns only the requesting user's own workspace info (public API).
   * Prevents enumeration of other users.
   * @param {string} userId
   * @returns {Array<{id: string, name: string}>}
   */
  listWorkspaces(userId) {
    const cleanId = sanitizeUserId(userId || 'default');
    const state = this.getUserState(cleanId);
    return [{
      id: cleanId,
      name: cleanId === 'default' ? 'Default Workspace' : cleanId.charAt(0).toUpperCase() + cleanId.slice(1),
    }];
  }

  // Backward compatibility delegates
  getState() {
    return this.getUserState('default');
  }

  update(updates) {
    return this.updateUserState('default', updates);
  }

  toggleMaster(enabled) {
    return this.toggleUserMaster('default', enabled);
  }

  logExecution(logData) {
    return this.logUserExecution('default', logData);
  }
}

export const store = new StateStore();
