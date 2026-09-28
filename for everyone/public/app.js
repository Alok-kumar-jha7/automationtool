// =============================================================================
// AutoReport AI — Frontend Application Controller v3.0
// =============================================================================

let currentAppState = {
  isEnabled: true,
  scheduleTime: '21:00',
  cronDays: '*',
  recipient: '',
  dispatchChannel: 'whatsapp',
  rawText: '',
  enhancedDraft: '',
  lastSentAt: null,
  lastStatus: 'idle',
  history: [],
  uptime: 0,
  hasOpenAIKey: false,
  isWhatsAppConnected: false,
};

// =============================================================================
// DOM ELEMENTS
// =============================================================================
const $ = (id) => document.getElementById(id);

const masterToggleBtn = $('masterToggleBtn');
const masterToggleIcon = $('masterToggleIcon');
const masterToggleLabel = $('masterToggleLabel');
const headerLiveDot = $('headerLiveDot');
const headerStatusText = $('headerStatusText');
const uptimeDisplay = $('uptimeDisplay');

const statSchedule = $('statSchedule');
const statDays = $('statDays');
const statRecipient = $('statRecipient');
const statChannel = $('statChannel');
const statMasterState = $('statMasterState');
const statLastSent = $('statLastSent');
const statLastStatus = $('statLastStatus');

const rawTextInput = $('rawTextInput');
const charCount = $('charCount');
const channelSelect = $('channelSelect');
const recipientInput = $('recipientInput');
const timeInput = $('timeInput');
const frequencySelect = $('frequencySelect');
const enhanceBtn = $('enhanceBtn');
const enhanceBtnText = $('enhanceBtnText');
const loadWorkLogBtn = $('loadWorkLogBtn');

const enhancedOutput = $('enhancedOutput');
const wordCountBadge = $('wordCountBadge');
const emptyStateOverlay = $('emptyStateOverlay');
const copyPreviewBtn = $('copyPreviewBtn');
const saveScheduleBtn = $('saveScheduleBtn');
const sendNowBtn = $('sendNowBtn');
const sendNowBtnText = $('sendNowBtnText');
const historyCount = $('historyCount');
const logsTableBody = $('logsTableBody');
const refreshLogsBtn = $('refreshLogsBtn');
const clearHistoryBtn = $('clearHistoryBtn');
const toastContainer = $('toastContainer');

const openaiStatusDot = $('openaiStatusDot');
const whatsappStatusDot = $('whatsappStatusDot');

// =============================================================================
// TOAST SYSTEM
// =============================================================================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type} animate-toast shadow-xl`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="opacity-50 hover:opacity-100 text-lg leading-none ml-2" onclick="this.closest('.toast').remove()">&times;</button>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// =============================================================================
// SECURITY: HTML ESCAPE (XSS Prevention in frontend rendering)
// =============================================================================
function escapeHtml(str) {
  if (!str) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, (m) => map[m]);
}

// =============================================================================
// HELPERS
// =============================================================================
function countWords(str) {
  if (!str) return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

function formatUptime(seconds) {
  if (!seconds || seconds < 60) return `${seconds || 0}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function updateWordAndCharCounts() {
  const raw = rawTextInput.value || '';
  charCount.textContent = raw.length;

  const enhanced = enhancedOutput.value || '';
  const words = countWords(enhanced);
  wordCountBadge.textContent = `${words} / 200`;

  if (words > 200) {
    wordCountBadge.className = 'word-badge word-badge-over';
  } else {
    wordCountBadge.className = 'word-badge';
  }

  // Show/hide empty state overlay
  if (emptyStateOverlay) {
    emptyStateOverlay.style.display = enhanced.trim() ? 'none' : '';
  }
}

// =============================================================================
// RENDER STATE
// =============================================================================
function renderState(state) {
  currentAppState = { ...currentAppState, ...state };
  const s = currentAppState;

  // Header toggle
  if (s.isEnabled) {
    masterToggleBtn.className = 'toggle-active flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-300 active:scale-[0.97]';
    masterToggleIcon.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-500/50';
    masterToggleLabel.textContent = 'ACTIVE';
    headerLiveDot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse';
    headerStatusText.textContent = 'Automation Active';
    statMasterState.textContent = 'RUNNING';
    statMasterState.className = 'status-badge-active';
  } else {
    masterToggleBtn.className = 'toggle-stopped flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-300 active:scale-[0.97]';
    masterToggleIcon.className = 'w-2 h-2 rounded-full bg-rose-400';
    masterToggleLabel.textContent = 'PAUSED';
    headerLiveDot.className = 'w-1.5 h-1.5 rounded-full bg-rose-500';
    headerStatusText.textContent = 'Paused';
    statMasterState.textContent = 'PAUSED';
    statMasterState.className = 'status-badge-paused';
  }

  // Stat cards
  statSchedule.textContent = s.scheduleTime || '21:00';
  const dayMap = { '1-5': 'Mon – Fri', '*': 'Every Day', '1,3,5': 'Mon, Wed, Fri' };
  statDays.textContent = dayMap[s.cronDays] || s.cronDays;
  statRecipient.textContent = s.recipient || 'Not Set';
  statChannel.textContent = (s.dispatchChannel || 'whatsapp').toUpperCase();

  statLastSent.textContent = s.lastSentAt ? timeAgo(s.lastSentAt) : 'Never';
  statLastStatus.textContent = s.lastStatus || 'Idle';

  // Uptime
  if (uptimeDisplay) uptimeDisplay.textContent = formatUptime(s.uptime);

  // Form fields (only if not focused)
  if (!rawTextInput.matches(':focus') && s.rawText) rawTextInput.value = s.rawText;
  if (!enhancedOutput.matches(':focus') && s.enhancedDraft) enhancedOutput.value = s.enhancedDraft;
  if (s.dispatchChannel) channelSelect.value = s.dispatchChannel;
  if (s.recipient && !recipientInput.matches(':focus')) recipientInput.value = s.recipient;
  if (s.scheduleTime) timeInput.value = s.scheduleTime;
  if (s.cronDays) frequencySelect.value = s.cronDays;

  // Footer connection dots
  if (openaiStatusDot) {
    const dot = openaiStatusDot.querySelector('span');
    if (dot) dot.className = `w-1.5 h-1.5 rounded-full ${s.hasOpenAIKey ? 'bg-emerald-500' : 'bg-gray-600'}`;
  }
  if (whatsappStatusDot) {
    const dot = whatsappStatusDot.querySelector('span');
    if (dot) dot.className = `w-1.5 h-1.5 rounded-full ${s.isWhatsAppConnected ? 'bg-emerald-500' : 'bg-amber-500'}`;
  }

  updateWordAndCharCounts();
  renderLogs(s.history);
  if (window.lucide) window.lucide.createIcons();
}

// =============================================================================
// RENDER LOGS TABLE
// =============================================================================
function renderLogs(logs = []) {
  if (historyCount) historyCount.textContent = logs.length;

  if (!logs || logs.length === 0) {
    logsTableBody.innerHTML = `
      <tr><td colspan="5" class="px-3 py-8 text-center text-gray-600">
        <div class="flex flex-col items-center"><svg class="w-6 h-6 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
        <p class="text-xs">No dispatch history yet</p></div>
      </td></tr>
    `;
    return;
  }

  logsTableBody.innerHTML = logs.map((log) => {
    const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = new Date(log.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

    const badgeMap = {
      success: '<span class="log-badge log-badge-success">SUCCESS</span>',
      paused: '<span class="log-badge log-badge-paused">PAUSED</span>',
      failed: '<span class="log-badge log-badge-failed">FAILED</span>',
    };

    return `
      <tr>
        <td class="px-3 py-2.5 font-mono text-[11px] text-gray-500 whitespace-nowrap">${escapeHtml(date)} ${escapeHtml(time)}</td>
        <td class="px-3 py-2.5 capitalize text-gray-300 text-xs">${escapeHtml(log.channel || 'whatsapp')}</td>
        <td class="px-3 py-2.5 font-mono text-[11px] text-gray-400 truncate max-w-[100px]">${escapeHtml(log.recipient || 'N/A')}</td>
        <td class="px-3 py-2.5">${badgeMap[log.status] || badgeMap.failed}</td>
        <td class="px-3 py-2.5 text-gray-500 truncate max-w-[180px] hidden sm:table-cell" title="${escapeHtml(log.preview || '')}">${escapeHtml(log.preview || '—')}</td>
      </tr>
    `;
  }).join('');
}

// =============================================================================
// API HELPERS (Safe JSON parsing)
// =============================================================================
async function apiCall(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Server error (${res.status}): ${text.slice(0, 150) || 'Empty response'}`);
  }
  if (!res.ok && json.error) throw new Error(json.error);
  return json;
}

// =============================================================================
// FETCH STATUS
// =============================================================================
async function fetchStatus() {
  try {
    const json = await apiCall('/api/status');
    if (json.success) renderState(json.data);
  } catch (err) {
    console.error('Status fetch error:', err);
    headerStatusText.textContent = 'Server Offline';
    headerLiveDot.className = 'w-1.5 h-1.5 rounded-full bg-gray-600';
  }
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

// Master Toggle
masterToggleBtn.addEventListener('click', async () => {
  try {
    const next = !currentAppState.isEnabled;
    const json = await apiCall('/api/toggle', {
      method: 'POST',
      body: JSON.stringify({ isEnabled: next }),
    });
    if (json.success) {
      renderState(json.data);
      showToast(json.message, next ? 'success' : 'info');
    }
  } catch (err) {
    showToast('Toggle failed: ' + err.message, 'error');
  }
});

// Load Work Log
loadWorkLogBtn.addEventListener('click', async () => {
  try {
    loadWorkLogBtn.disabled = true;
    showToast('Loading work log & git commits...', 'info');
    const json = await apiCall('/api/work-log/load', { method: 'POST' });
    if (json.success && json.data.rawContent) {
      rawTextInput.value = json.data.rawContent;
      updateWordAndCharCounts();
      showToast(`Loaded ${json.data.sources.length} source(s)`, 'success');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    loadWorkLogBtn.disabled = false;
  }
});

// Quick Templates
document.querySelectorAll('.template-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const template = chip.dataset.template;
    if (template) {
      rawTextInput.value = template;
      rawTextInput.focus();
      updateWordAndCharCounts();
      showToast('Template loaded — fill in the details!', 'info');
    }
  });
});

// AI Enhance
enhanceBtn.addEventListener('click', async () => {
  const text = rawTextInput.value.trim();
  if (!text) {
    showToast('Type or paste some work notes first!', 'error');
    rawTextInput.focus();
    return;
  }

  try {
    enhanceBtn.disabled = true;
    enhanceBtnText.innerHTML = '<span class="shimmer-text">Enhancing with AI...</span>';

    const json = await apiCall('/api/preview', {
      method: 'POST',
      body: JSON.stringify({ rawText: text }),
    });

    if (json.success) {
      enhancedOutput.value = json.data.enhancedText;
      updateWordAndCharCounts();
      showToast('AI enhancement complete!', 'success');
    } else if (json.data?.enhancedText) {
      enhancedOutput.value = json.data.enhancedText;
      updateWordAndCharCounts();
      showToast('Enhanced with offline fallback', 'info');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    enhanceBtn.disabled = false;
    enhanceBtnText.textContent = 'Enhance with AI';
  }
});

// Save Schedule
saveScheduleBtn.addEventListener('click', async () => {
  try {
    saveScheduleBtn.disabled = true;
    const json = await apiCall('/api/schedule', {
      method: 'POST',
      body: JSON.stringify({
        scheduleTime: timeInput.value || '21:00',
        cronDays: frequencySelect.value || '*',
        recipient: recipientInput.value.trim(),
        dispatchChannel: channelSelect.value || 'whatsapp',
        rawText: rawTextInput.value,
        enhancedDraft: enhancedOutput.value,
        isEnabled: currentAppState.isEnabled,
      }),
    });
    if (json.success) {
      renderState(json.data);
      showToast('Schedule saved!', 'success');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    saveScheduleBtn.disabled = false;
  }
});

// Send Now
sendNowBtn.addEventListener('click', async () => {
  const text = enhancedOutput.value.trim() || rawTextInput.value.trim();
  const recipient = recipientInput.value.trim();
  const channel = channelSelect.value;

  if (!text) { showToast('No report text. Enhance notes first.', 'error'); return; }
  if (!recipient && channel !== 'console') { showToast('Enter a recipient.', 'error'); return; }
  if (!confirm(`Send via ${channel.toUpperCase()} to ${recipient || 'Console'}?`)) return;

  try {
    sendNowBtn.disabled = true;
    sendNowBtnText.textContent = 'Sending...';

    const json = await apiCall('/api/send-now', {
      method: 'POST',
      body: JSON.stringify({ text, recipient, channel }),
    });

    if (json.success) {
      showToast(json.message || 'Sent!', 'success');
      fetchStatus();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    sendNowBtn.disabled = false;
    sendNowBtnText.textContent = 'Send Now';
  }
});

// Copy
copyPreviewBtn.addEventListener('click', () => {
  const text = enhancedOutput.value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'info'));
});

// Clear History
clearHistoryBtn.addEventListener('click', async () => {
  if (!confirm('Clear all dispatch history?')) return;
  try {
    await apiCall('/api/clear-history', { method: 'POST' });
    currentAppState.history = [];
    renderLogs([]);
    showToast('History cleared', 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Refresh
refreshLogsBtn.addEventListener('click', fetchStatus);

// Textarea change listeners
rawTextInput.addEventListener('input', updateWordAndCharCounts);
enhancedOutput.addEventListener('input', updateWordAndCharCounts);

// =============================================================================
// INITIALIZATION
// =============================================================================
fetchStatus();
setInterval(fetchStatus, 12000);
