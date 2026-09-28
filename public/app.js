// =============================================================================
// AutoReport AI — Multi-User Application Controller v4.0
// =============================================================================

// Resolve active workspace from query parameter ?user=... or localStorage
const initialUrlParams = new URLSearchParams(window.location.search);
let activeUserId = initialUrlParams.get('user') || localStorage.getItem('autoreport_active_user') || 'default';
activeUserId = activeUserId.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'default';
localStorage.setItem('autoreport_active_user', activeUserId);

let currentAppState = {
  isEnabled: true,
  scheduleTime: '21:00',
  cronDays: '*',
  scheduleDate: null,
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
  whatsappAuth: null,
};

let currentScheduleMode = 'recurring'; // 'recurring' | 'specific'
let currentWorkspaceTarget = 'contact'; // 'contact' | 'group'
let currentModalTarget = 'contact';     // 'contact' | 'group'
let availableWhatsAppGroups = [];
let qrPollTimer = null;
let allWorkspaces = [];

// =============================================================================
// DOM ELEMENTS
// =============================================================================
const $ = (id) => document.getElementById(id);

// Workspace Switcher
const workspaceDropdownWrapper = $('workspaceDropdownWrapper');
const workspaceBtn = $('workspaceBtn');
const currentWorkspaceName = $('currentWorkspaceName');
const workspaceMenu = $('workspaceMenu');
const workspaceListItems = $('workspaceListItems');
const copyWorkspaceLinkBtn = $('copyWorkspaceLinkBtn');
const openNewWorkspaceModalBtn = $('openNewWorkspaceModalBtn');

// New Workspace Modal
const newWorkspaceModal = $('newWorkspaceModal');
const closeNewWorkspaceModalBtn = $('closeNewWorkspaceModalBtn');
const cancelNewWorkspaceBtn = $('cancelNewWorkspaceBtn');
const submitNewWorkspaceBtn = $('submitNewWorkspaceBtn');
const newWorkspaceNameInput = $('newWorkspaceNameInput');
const qrWorkspaceBadge = $('qrWorkspaceBadge');

// Header
const masterToggleBtn = $('masterToggleBtn');
const masterToggleIcon = $('masterToggleIcon');
const masterToggleLabel = $('masterToggleLabel');
const headerLiveDot = $('headerLiveDot');
const headerStatusText = $('headerStatusText');
const uptimeDisplay = $('uptimeDisplay');
const headerWhatsAppBtn = $('headerWhatsAppBtn');
const headerWhatsAppDot = $('headerWhatsAppDot');
const headerWhatsAppText = $('headerWhatsAppText');

// Stat Cards
const statSchedule = $('statSchedule');
const statDays = $('statDays');
const statRecipient = $('statRecipient');
const statChannel = $('statChannel');
const statMasterState = $('statMasterState');
const statLastSent = $('statLastSent');
const statLastStatus = $('statLastStatus');

// Workspace Inputs
const rawTextInput = $('rawTextInput');
const charCount = $('charCount');
const channelSelect = $('channelSelect');
const recipientInput = $('recipientInput');
const timeInput = $('timeInput');
const frequencySelect = $('frequencySelect');
const enhanceBtn = $('enhanceBtn');
const enhanceBtnText = $('enhanceBtnText');
const loadWorkLogBtn = $('loadWorkLogBtn');

// Group selectors in main workspace
const recipientTypeContactBtn = $('recipientTypeContactBtn');
const recipientTypeGroupBtn = $('recipientTypeGroupBtn');
const contactRecipientWrapper = $('contactRecipientWrapper');
const groupRecipientWrapper = $('groupRecipientWrapper');
const groupSelect = $('groupSelect');
const refreshGroupsBtn = $('refreshGroupsBtn');

// Workspace Outputs
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

// Footer status dots
const openaiStatusDot = $('openaiStatusDot');
const whatsappStatusDot = $('whatsappStatusDot');

// Schedule Modal Elements
const scheduleModal = $('scheduleModal');
const closeScheduleModalBtn = $('closeScheduleModalBtn');
const cancelScheduleModalBtn = $('cancelScheduleModalBtn');
const confirmScheduleModalBtn = $('confirmScheduleModalBtn');
const scheduleTypeRecurringBtn = $('scheduleTypeRecurringBtn');
const scheduleTypeSpecificBtn = $('scheduleTypeSpecificBtn');
const modalFrequencyWrapper = $('modalFrequencyWrapper');
const modalDateWrapper = $('modalDateWrapper');
const modalTimeInput = $('modalTimeInput');
const modalFrequencySelect = $('modalFrequencySelect');
const modalDateInput = $('modalDateInput');
const modalChannelSelect = $('modalChannelSelect');
const modalRecipientInput = $('modalRecipientInput');
const modalTextInput = $('modalTextInput');
const modalWordCount = $('modalWordCount');
const modalNextTriggerText = $('modalNextTriggerText');
const modalWhatsAppBanner = $('modalWhatsAppBanner');
const modalWhatsAppDot = $('modalWhatsAppDot');
const modalWhatsAppStatusTitle = $('modalWhatsAppStatusTitle');
const modalWhatsAppStatusSub = $('modalWhatsAppStatusSub');
const modalScanQrBtn = $('modalScanQrBtn');

// Group selector elements in modal
const modalTargetTypeSection = $('modalTargetTypeSection');
const modalTargetContactBtn = $('modalTargetContactBtn');
const modalTargetGroupBtn = $('modalTargetGroupBtn');
const modalActiveTargetDesc = $('modalActiveTargetDesc');
const modalContactInputWrapper = $('modalContactInputWrapper');
const modalGroupSelectWrapper = $('modalGroupSelectWrapper');
const modalGroupSelect = $('modalGroupSelect');
const modalRefreshGroupsBtn = $('modalRefreshGroupsBtn');

// QR Modal Elements
const qrModal = $('qrModal');
const closeQrModalBtn = $('closeQrModalBtn');
const qrLoadingState = $('qrLoadingState');
const qrReadyState = $('qrReadyState');
const qrSuccessState = $('qrSuccessState');
const qrImageElement = $('qrImageElement');
const refreshQrBtn = $('refreshQrBtn');
const relinkWhatsAppBtn = $('relinkWhatsAppBtn');
const qrDoneBtn = $('qrDoneBtn');

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
// SECURITY: HTML ESCAPE
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

  if (emptyStateOverlay) {
    emptyStateOverlay.style.display = enhanced.trim() ? 'none' : '';
  }
}

function updateModalWordCount() {
  if (!modalTextInput || !modalWordCount) return;
  const words = countWords(modalTextInput.value || '');
  modalWordCount.textContent = `${words} words`;
}

// =============================================================================
// WHATSAPP GROUPS MANAGEMENT
// =============================================================================
async function fetchWhatsAppGroups(force = false) {
  if (!currentAppState.isWhatsAppConnected) return [];
  if (availableWhatsAppGroups.length > 0 && !force) return availableWhatsAppGroups;

  try {
    const res = await apiCall('/api/whatsapp/groups');
    if (res.success && Array.isArray(res.data)) {
      availableWhatsAppGroups = res.data;
      populateGroupSelects(availableWhatsAppGroups);
      return availableWhatsAppGroups;
    }
  } catch (err) {
    console.warn('Could not fetch WhatsApp groups:', err.message);
  }
  return [];
}

function populateGroupSelects(groups = []) {
  const renderOptions = (currentVal) => {
    let html = `<option value="">Select WhatsApp Group (${groups.length} available)...</option>`;
    groups.forEach((g) => {
      const selected = g.id === currentVal ? 'selected' : '';
      const count = g.participantsCount ? ` (${g.participantsCount} members)` : '';
      html += `<option value="${escapeHtml(g.id)}" ${selected}>👥 ${escapeHtml(g.name)}${count}</option>`;
    });
    html += `<option value="__custom__">➕ Custom Group JID / Paste ID...</option>`;
    return html;
  };

  if (groupSelect) {
    const cur = recipientInput ? recipientInput.value : '';
    groupSelect.innerHTML = renderOptions(cur);
  }
  if (modalGroupSelect) {
    const cur = modalRecipientInput ? modalRecipientInput.value : '';
    modalGroupSelect.innerHTML = renderOptions(cur);
  }
}

function getGroupNameByJid(jid) {
  if (!jid) return null;
  const match = availableWhatsAppGroups.find((g) => g.id === jid);
  return match ? match.name : null;
}

// Workspace Target Type Switcher (Phone vs Group)
function setWorkspaceTargetType(type) {
  currentWorkspaceTarget = type;
  if (!recipientTypeContactBtn || !recipientTypeGroupBtn) return;

  if (type === 'contact') {
    recipientTypeContactBtn.className = 'px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium';
    recipientTypeGroupBtn.className = 'px-1.5 py-0.5 rounded bg-white/[0.05] text-gray-400 hover:text-white font-medium';
    if (contactRecipientWrapper) contactRecipientWrapper.classList.remove('hidden');
    if (groupRecipientWrapper) groupRecipientWrapper.classList.add('hidden');
  } else {
    recipientTypeGroupBtn.className = 'px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium';
    recipientTypeContactBtn.className = 'px-1.5 py-0.5 rounded bg-white/[0.05] text-gray-400 hover:text-white font-medium';
    if (contactRecipientWrapper) contactRecipientWrapper.classList.add('hidden');
    if (groupRecipientWrapper) groupRecipientWrapper.classList.remove('hidden');

    if (availableWhatsAppGroups.length === 0) {
      fetchWhatsAppGroups();
    }
  }
}

// Modal Target Type Switcher (Phone vs Group)
function setModalTargetType(type) {
  currentModalTarget = type;
  if (!modalTargetContactBtn || !modalTargetGroupBtn) return;

  if (type === 'contact') {
    modalTargetContactBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold border transition text-center bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
    modalTargetGroupBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold border transition text-center bg-white/[0.03] border-white/[0.08] text-gray-400 hover:text-white';
    if (modalContactInputWrapper) modalContactInputWrapper.classList.remove('hidden');
    if (modalGroupSelectWrapper) modalGroupSelectWrapper.classList.add('hidden');
    if (modalActiveTargetDesc) modalActiveTargetDesc.textContent = 'Direct Phone';
  } else {
    modalTargetGroupBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold border transition text-center bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
    modalTargetContactBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold border transition text-center bg-white/[0.03] border-white/[0.08] text-gray-400 hover:text-white';
    if (modalContactInputWrapper) modalContactInputWrapper.classList.add('hidden');
    if (modalGroupSelectWrapper) modalGroupSelectWrapper.classList.remove('hidden');

    if (availableWhatsAppGroups.length === 0) {
      fetchWhatsAppGroups();
    }
    const currentJid = modalRecipientInput ? modalRecipientInput.value : '';
    const name = getGroupNameByJid(currentJid);
    if (modalActiveTargetDesc) {
      modalActiveTargetDesc.textContent = name ? `Group: ${name}` : 'WhatsApp Group';
    }
  }
}

// =============================================================================
// WHATSAPP AUTH & QR MODAL LOGIC
// =============================================================================
function updateWhatsAppBadges(isConnected) {
  if (headerWhatsAppDot && headerWhatsAppText && headerWhatsAppBtn) {
    if (isConnected) {
      headerWhatsAppDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
      headerWhatsAppText.textContent = 'WhatsApp Connected';
      headerWhatsAppBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/20 text-xs font-semibold bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition cursor-pointer';
    } else {
      headerWhatsAppDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
      headerWhatsAppText.textContent = 'Scan WhatsApp QR';
      headerWhatsAppBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-500/30 text-xs font-semibold bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition cursor-pointer';
    }
  }

  if (whatsappStatusDot) {
    const dot = whatsappStatusDot.querySelector('span');
    if (dot) dot.className = `w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`;
  }

  updateModalWhatsAppStatus();
}

function updateModalWhatsAppStatus() {
  if (!modalWhatsAppBanner) return;
  const isConnected = currentAppState.isWhatsAppConnected;
  const selectedChannel = modalChannelSelect ? modalChannelSelect.value : 'whatsapp';

  if (selectedChannel !== 'whatsapp') {
    modalWhatsAppBanner.className = 'p-3 rounded-xl border flex items-center justify-between transition-all bg-sky-500/10 border-sky-500/20 text-sky-300';
    if (modalWhatsAppDot) modalWhatsAppDot.className = 'w-2.5 h-2.5 rounded-full bg-sky-400';
    if (modalWhatsAppStatusTitle) modalWhatsAppStatusTitle.textContent = `${selectedChannel.toUpperCase()} Selected`;
    if (modalWhatsAppStatusSub) modalWhatsAppStatusSub.textContent = 'WhatsApp authentication not required for this channel';
    if (modalScanQrBtn) modalScanQrBtn.classList.add('hidden');
    if (modalTargetTypeSection) modalTargetTypeSection.classList.add('hidden');
    return;
  }

  if (modalTargetTypeSection) modalTargetTypeSection.classList.remove('hidden');

  if (isConnected) {
    modalWhatsAppBanner.className = 'p-3 rounded-xl border flex items-center justify-between transition-all bg-emerald-500/10 border-emerald-500/20 text-emerald-300';
    if (modalWhatsAppDot) modalWhatsAppDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
    if (modalWhatsAppStatusTitle) modalWhatsAppStatusTitle.textContent = 'WhatsApp is Connected & Ready';
    if (modalWhatsAppStatusSub) modalWhatsAppStatusSub.textContent = 'Direct messages and group dispatches supported';
    if (modalScanQrBtn) modalScanQrBtn.classList.add('hidden');
  } else {
    modalWhatsAppBanner.className = 'p-3 rounded-xl border flex items-center justify-between transition-all bg-amber-500/10 border-amber-500/30 text-amber-200';
    if (modalWhatsAppDot) modalWhatsAppDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
    if (modalWhatsAppStatusTitle) modalWhatsAppStatusTitle.textContent = '⚠️ WhatsApp Login Required';
    if (modalWhatsAppStatusSub) modalWhatsAppStatusSub.textContent = 'You must scan the QR code before scheduled dispatch starts';
    if (modalScanQrBtn) modalScanQrBtn.classList.remove('hidden');
  }
}

async function checkWhatsAppQrStatus() {
  try {
    const res = await apiCall('/api/whatsapp/status');
    if (!res.success) return;
    const auth = res.data;

    currentAppState.isWhatsAppConnected = auth.isReady;
    currentAppState.whatsappAuth = auth;
    updateWhatsAppBadges(auth.isReady);

    if (auth.isReady) {
      if (qrLoadingState) qrLoadingState.classList.add('hidden');
      if (qrReadyState) qrReadyState.classList.add('hidden');
      if (qrSuccessState) qrSuccessState.classList.remove('hidden');
      // Fetch groups as soon as WhatsApp is ready
      fetchWhatsAppGroups();
    } else if (auth.qrDataUrl) {
      if (qrLoadingState) qrLoadingState.classList.add('hidden');
      if (qrSuccessState) qrSuccessState.classList.add('hidden');
      if (qrReadyState) qrReadyState.classList.remove('hidden');
      if (qrImageElement) qrImageElement.src = auth.qrDataUrl;
    } else {
      if (qrSuccessState) qrSuccessState.classList.add('hidden');
      if (qrReadyState) qrReadyState.classList.add('hidden');
      if (qrLoadingState) qrLoadingState.classList.remove('hidden');
    }
  } catch (err) {
    console.error('QR status check error:', err);
  }
}

function openQrModal() {
  if (!qrModal) return;
  qrModal.classList.add('active');
  checkWhatsAppQrStatus();
  if (qrPollTimer) clearInterval(qrPollTimer);
  qrPollTimer = setInterval(checkWhatsAppQrStatus, 2500);
}

function closeQrModal() {
  if (!qrModal) return;
  qrModal.classList.remove('active');
  if (qrPollTimer) {
    clearInterval(qrPollTimer);
    qrPollTimer = null;
  }
}

// =============================================================================
// SCHEDULE MODAL LOGIC
// =============================================================================
function setScheduleMode(mode) {
  currentScheduleMode = mode;
  if (!scheduleTypeRecurringBtn || !scheduleTypeSpecificBtn) return;

  if (mode === 'recurring') {
    scheduleTypeRecurringBtn.className = 'px-3 py-2 rounded-xl text-xs font-semibold border transition text-center bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
    scheduleTypeSpecificBtn.className = 'px-3 py-2 rounded-xl text-xs font-semibold border transition text-center bg-white/[0.03] border-white/[0.08] text-gray-400 hover:text-white';
    if (modalFrequencyWrapper) modalFrequencyWrapper.classList.remove('hidden');
    if (modalDateWrapper) modalDateWrapper.classList.add('hidden');
  } else {
    scheduleTypeSpecificBtn.className = 'px-3 py-2 rounded-xl text-xs font-semibold border transition text-center bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
    scheduleTypeRecurringBtn.className = 'px-3 py-2 rounded-xl text-xs font-semibold border transition text-center bg-white/[0.03] border-white/[0.08] text-gray-400 hover:text-white';
    if (modalFrequencyWrapper) modalFrequencyWrapper.classList.add('hidden');
    if (modalDateWrapper) modalDateWrapper.classList.remove('hidden');
  }
  updateModalTriggerPreview();
}

function updateModalTriggerPreview() {
  if (!modalNextTriggerText) return;
  const time = modalTimeInput ? modalTimeInput.value : '21:00';

  if (currentScheduleMode === 'specific') {
    const date = modalDateInput && modalDateInput.value ? modalDateInput.value : 'Selected date';
    modalNextTriggerText.textContent = `${date} at ${time}`;
  } else {
    const freq = modalFrequencySelect ? modalFrequencySelect.value : '*';
    const dayMap = { '*': 'Every Day', '1-5': 'Mon – Fri', '1,3,5': 'Mon, Wed, Fri' };
    modalNextTriggerText.textContent = `${dayMap[freq] || freq} at ${time}`;
  }
}

function openScheduleModal() {
  if (!scheduleModal) return;
  const s = currentAppState;

  if (modalTimeInput) modalTimeInput.value = timeInput.value || s.scheduleTime || '21:00';
  if (modalRecipientInput) modalRecipientInput.value = recipientInput.value || s.recipient || '';
  if (modalChannelSelect) modalChannelSelect.value = channelSelect.value || s.dispatchChannel || 'whatsapp';
  if (modalFrequencySelect) modalFrequencySelect.value = frequencySelect.value || s.cronDays || '*';
  if (modalTextInput) modalTextInput.value = enhancedOutput.value || rawTextInput.value || s.enhancedDraft || '';

  // Setup target type (Phone vs Group)
  const isGroup = (s.recipient && s.recipient.endsWith('@g.us')) || currentWorkspaceTarget === 'group';
  if (isGroup) {
    setModalTargetType('group');
    if (modalGroupSelect && s.recipient) {
      modalGroupSelect.value = s.recipient;
    }
  } else {
    setModalTargetType('contact');
  }

  // Setup schedule type (recurring vs specific date)
  if (s.scheduleDate) {
    setScheduleMode('specific');
    if (modalDateInput) modalDateInput.value = s.scheduleDate;
  } else {
    setScheduleMode('recurring');
    if (modalDateInput) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      modalDateInput.value = tomorrow.toISOString().split('T')[0];
    }
  }

  updateModalTriggerPreview();
  updateModalWhatsAppStatus();
  updateModalWordCount();

  scheduleModal.classList.add('active');
  if (window.lucide) window.lucide.createIcons();
}

function closeScheduleModal() {
  if (scheduleModal) scheduleModal.classList.remove('active');
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
  if (s.scheduleDate) {
    statDays.textContent = `Date: ${s.scheduleDate}`;
  } else {
    const dayMap = { '1-5': 'Mon – Fri', '*': 'Every Day', '1,3,5': 'Mon, Wed, Fri' };
    statDays.textContent = dayMap[s.cronDays] || s.cronDays;
  }

  // Recipient Display with Group Name recognition
  const isGroupRecipient = s.recipient && s.recipient.endsWith('@g.us');
  if (isGroupRecipient) {
    const groupName = getGroupNameByJid(s.recipient);
    statRecipient.textContent = groupName ? `👥 ${groupName}` : `👥 Group (${s.recipient.split('@')[0]})`;
    statChannel.textContent = `${(s.dispatchChannel || 'whatsapp').toUpperCase()} GROUP`;
    setWorkspaceTargetType('group');
  } else {
    statRecipient.textContent = s.recipient || 'Not Set';
    statChannel.textContent = (s.dispatchChannel || 'whatsapp').toUpperCase();
    setWorkspaceTargetType('contact');
  }

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

  updateWhatsAppBadges(s.isWhatsAppConnected);
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

    const isGroup = log.recipient && log.recipient.endsWith('@g.us');
    const groupName = isGroup ? getGroupNameByJid(log.recipient) : null;
    const recipientDisplay = groupName ? `👥 ${escapeHtml(groupName)}` : escapeHtml(log.recipient || 'N/A');

    return `
      <tr>
        <td class="px-3 py-2.5 font-mono text-[11px] text-gray-500 whitespace-nowrap">${escapeHtml(date)} ${escapeHtml(time)}</td>
        <td class="px-3 py-2.5 capitalize text-gray-300 text-xs">${escapeHtml(log.channel || 'whatsapp')}</td>
        <td class="px-3 py-2.5 font-mono text-[11px] text-gray-400 truncate max-w-[130px]" title="${escapeHtml(log.recipient || '')}">${recipientDisplay}</td>
        <td class="px-3 py-2.5">${badgeMap[log.status] || badgeMap.failed}</td>
        <td class="px-3 py-2.5 text-gray-500 truncate max-w-[180px] hidden sm:table-cell" title="${escapeHtml(log.preview || '')}">${escapeHtml(log.preview || '—')}</td>
      </tr>
    `;
  }).join('');
}

// =============================================================================
// API HELPERS
// =============================================================================
async function apiCall(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': activeUserId,
      ...options.headers,
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Server error (${res.status}): ${text.slice(0, 150) || 'Empty response'}`);
  }
  if (!res.ok && json.error) {
    const err = new Error(json.error);
    err.needsWhatsAppLogin = json.needsWhatsAppLogin;
    throw err;
  }
  return json;
}

// =============================================================================
// WORKSPACES MANAGEMENT
// =============================================================================
async function fetchWorkspaces() {
  try {
    const res = await apiCall('/api/workspaces');
    if (res.success && Array.isArray(res.data)) {
      allWorkspaces = res.data;
      renderWorkspacesList(res.data);
    }
  } catch (err) {
    console.warn('Failed to fetch workspaces:', err.message);
  }
}

function getMySavedWorkspaces() {
  try {
    const raw = localStorage.getItem('autoreport_my_workspaces');
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    if (!list.includes(activeUserId)) {
      list.push(activeUserId);
      localStorage.setItem('autoreport_my_workspaces', JSON.stringify(list));
    }
    return list;
  } catch {
    return [activeUserId];
  }
}

function saveMyWorkspace(id) {
  try {
    const list = getMySavedWorkspaces();
    if (!list.includes(id)) {
      list.push(id);
      localStorage.setItem('autoreport_my_workspaces', JSON.stringify(list));
    }
  } catch {}
}

function renderWorkspacesList(workspaces) {
  if (!workspaceListItems) return;
  const current = activeUserId;
  const currentObj = workspaces.find((w) => w.id === current);
  const displayName = currentObj ? currentObj.name : (current === 'default' ? 'Default' : current.charAt(0).toUpperCase() + current.slice(1));

  if (currentWorkspaceName) {
    currentWorkspaceName.textContent = displayName;
  }
  if (qrWorkspaceBadge) {
    qrWorkspaceBadge.textContent = displayName;
  }

  // Device Privacy: Only show workspaces this user has joined or created on this device!
  const myIds = getMySavedWorkspaces();
  const visibleWorkspaces = workspaces.filter((w) => myIds.includes(w.id));

  // If active user isn't in server list yet, create temporary entry
  if (!visibleWorkspaces.some((w) => w.id === current)) {
    visibleWorkspaces.push({ id: current, name: displayName, isWhatsAppConnected: currentAppState.isWhatsAppConnected });
  }

  workspaceListItems.innerHTML = visibleWorkspaces.map((w) => {
    const isActive = w.id === current;
    const activeBadge = isActive ? '<span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>' : '<span class="w-1.5 h-1.5 rounded-full bg-gray-600"></span>';
    const connBadge = w.isWhatsAppConnected 
      ? '<span class="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded">WA Ready</span>'
      : '<span class="text-[10px] text-gray-500 font-mono">Offline</span>';

    return `
      <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between transition cursor-pointer text-xs ${
        isActive ? 'bg-cyan-500/15 border border-cyan-500/30 text-white font-semibold' : 'text-gray-300 hover:bg-white/[0.06]'
      }" onclick="switchWorkspace('${escapeHtml(w.id)}')">
        <div class="flex items-center gap-2 truncate pr-2">
          ${activeBadge}
          <span class="truncate">${escapeHtml(w.name || w.id)}</span>
        </div>
        ${connBadge}
      </button>
    `;
  }).join('');
}

window.switchWorkspace = function(userId) {
  if (!userId) return;
  activeUserId = userId.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'default';
  localStorage.setItem('autoreport_active_user', activeUserId);
  saveMyWorkspace(activeUserId);

  // Sync URL query parameter without page reload
  const url = new URL(window.location);
  url.searchParams.set('user', activeUserId);
  window.history.replaceState({}, '', url);

  if (workspaceMenu) workspaceMenu.classList.add('hidden');
  availableWhatsAppGroups = [];
  hasAttemptedGroupFetch = false;

  fetchStatus();
  fetchWorkspaces();
  checkWhatsAppQrStatus();
  showToast(`Switched to workspace: ${activeUserId}`, 'info');
};

let hasAttemptedGroupFetch = false;

// =============================================================================
// FETCH STATUS
// =============================================================================
async function fetchStatus() {
  try {
    const json = await apiCall('/api/status');
    if (json.success) {
      renderState(json.data);
      if (json.data.isWhatsAppConnected && !hasAttemptedGroupFetch) {
        hasAttemptedGroupFetch = true;
        fetchWhatsAppGroups();
      }
      fetchWorkspaces();
    }
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

// Workspace Target Type Switcher
if (recipientTypeContactBtn) {
  recipientTypeContactBtn.addEventListener('click', () => setWorkspaceTargetType('contact'));
}
if (recipientTypeGroupBtn) {
  recipientTypeGroupBtn.addEventListener('click', () => setWorkspaceTargetType('group'));
}

// Group Selection in Main Workspace
if (groupSelect) {
  groupSelect.addEventListener('change', () => {
    const val = groupSelect.value;
    if (val === '__custom__') {
      const customJid = prompt('Enter the WhatsApp Group JID (e.g. 120363025412345678@g.us):');
      if (customJid && customJid.trim()) {
        recipientInput.value = customJid.trim();
        showToast('Custom Group ID set!', 'info');
      }
    } else if (val) {
      recipientInput.value = val;
      const gName = getGroupNameByJid(val);
      showToast(`Selected Group: ${gName || val}`, 'info');
    }
  });
}

if (refreshGroupsBtn) {
  refreshGroupsBtn.addEventListener('click', async () => {
    refreshGroupsBtn.disabled = true;
    showToast('Refreshing WhatsApp Groups...', 'info');
    await fetchWhatsAppGroups(true);
    refreshGroupsBtn.disabled = false;
    showToast(`Loaded ${availableWhatsAppGroups.length} groups!`, 'success');
  });
}

// Modal Target Type Switcher
if (modalTargetContactBtn) {
  modalTargetContactBtn.addEventListener('click', () => setModalTargetType('contact'));
}
if (modalTargetGroupBtn) {
  modalTargetGroupBtn.addEventListener('click', () => setModalTargetType('group'));
}

// Modal Group Selection
if (modalGroupSelect) {
  modalGroupSelect.addEventListener('change', () => {
    const val = modalGroupSelect.value;
    if (val === '__custom__') {
      const customJid = prompt('Enter the WhatsApp Group JID (e.g. 120363025412345678@g.us):');
      if (customJid && customJid.trim()) {
        modalRecipientInput.value = customJid.trim();
        if (modalActiveTargetDesc) modalActiveTargetDesc.textContent = `Custom Group: ${customJid.slice(0, 15)}...`;
      }
    } else if (val) {
      modalRecipientInput.value = val;
      const gName = getGroupNameByJid(val);
      if (modalActiveTargetDesc) modalActiveTargetDesc.textContent = `Group: ${gName || val}`;
    }
  });
}

if (modalRefreshGroupsBtn) {
  modalRefreshGroupsBtn.addEventListener('click', async () => {
    modalRefreshGroupsBtn.disabled = true;
    showToast('Refreshing WhatsApp Groups...', 'info');
    await fetchWhatsAppGroups(true);
    modalRefreshGroupsBtn.disabled = false;
    showToast(`Loaded ${availableWhatsAppGroups.length} groups!`, 'success');
  });
}

// Open Schedule Modal (Clicking "Save Schedule" or stat card)
saveScheduleBtn.addEventListener('click', openScheduleModal);

if (statSchedule && statSchedule.parentElement) {
  statSchedule.parentElement.style.cursor = 'pointer';
  statSchedule.parentElement.title = 'Click to configure schedule popup';
  statSchedule.parentElement.addEventListener('click', openScheduleModal);
}

// Modal Mode Selectors (Recurring vs Specific Date)
if (scheduleTypeRecurringBtn) {
  scheduleTypeRecurringBtn.addEventListener('click', () => setScheduleMode('recurring'));
}
if (scheduleTypeSpecificBtn) {
  scheduleTypeSpecificBtn.addEventListener('click', () => setScheduleMode('specific'));
}

// Modal input updates
if (modalTimeInput) modalTimeInput.addEventListener('input', updateModalTriggerPreview);
if (modalFrequencySelect) modalFrequencySelect.addEventListener('change', updateModalTriggerPreview);
if (modalDateInput) modalDateInput.addEventListener('input', updateModalTriggerPreview);
if (modalChannelSelect) modalChannelSelect.addEventListener('change', updateModalWhatsAppStatus);
if (modalTextInput) modalTextInput.addEventListener('input', updateModalWordCount);

// Close Schedule Modal
if (closeScheduleModalBtn) closeScheduleModalBtn.addEventListener('click', closeScheduleModal);
if (cancelScheduleModalBtn) cancelScheduleModalBtn.addEventListener('click', closeScheduleModal);

// Confirm Schedule in Popup Modal
if (confirmScheduleModalBtn) {
  confirmScheduleModalBtn.addEventListener('click', async () => {
    const channel = modalChannelSelect ? modalChannelSelect.value : 'whatsapp';
    const time = modalTimeInput ? modalTimeInput.value || '21:00' : '21:00';
    let recipient = modalRecipientInput ? modalRecipientInput.value.trim() : '';
    const text = modalTextInput ? modalTextInput.value.trim() : '';
    const specificDate = currentScheduleMode === 'specific' && modalDateInput ? modalDateInput.value : null;
    const cronDays = currentScheduleMode === 'recurring' && modalFrequencySelect ? modalFrequencySelect.value : '*';

    // If Group mode is active in modal, ensure group is picked
    if (channel === 'whatsapp' && currentModalTarget === 'group') {
      if (modalGroupSelect && modalGroupSelect.value && modalGroupSelect.value !== '__custom__') {
        recipient = modalGroupSelect.value;
      }
    }

    // 1. WhatsApp Login Check: User must scan QR and be logged in first!
    if (channel === 'whatsapp' && !currentAppState.isWhatsAppConnected) {
      showToast('⚠️ Please scan WhatsApp QR code and log in first!', 'error');
      openQrModal();
      return;
    }

    // 2. Validate recipient
    if (channel !== 'console' && !recipient) {
      showToast('Please enter or select a recipient phone number or WhatsApp group.', 'error');
      if (currentModalTarget === 'group') {
        if (modalGroupSelect) modalGroupSelect.focus();
      } else {
        if (modalRecipientInput) modalRecipientInput.focus();
      }
      return;
    }

    try {
      confirmScheduleModalBtn.disabled = true;
      confirmScheduleModalBtn.innerHTML = '<span class="shimmer-text">Saving schedule...</span>';

      const json = await apiCall('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({
          scheduleTime: time,
          cronDays,
          scheduleDate: specificDate,
          recipient,
          dispatchChannel: channel,
          rawText: text || rawTextInput.value,
          enhancedDraft: text || enhancedOutput.value,
          isEnabled: true, // Auto-enable when confirming schedule
        }),
      });

      if (json.success) {
        renderState(json.data);
        // Sync main workspace inputs
        timeInput.value = time;
        recipientInput.value = recipient;
        channelSelect.value = channel;
        frequencySelect.value = cronDays;
        if (recipient.endsWith('@g.us')) {
          setWorkspaceTargetType('group');
          if (groupSelect) groupSelect.value = recipient;
        } else {
          setWorkspaceTargetType('contact');
        }
        if (text) {
          enhancedOutput.value = text;
          updateWordAndCharCounts();
        }

        closeScheduleModal();
        const targetDesc = recipient.endsWith('@g.us')
          ? `to Group "${getGroupNameByJid(recipient) || recipient}"`
          : `to ${recipient}`;
        const dateDesc = specificDate ? `for date ${specificDate}` : `daily (${cronDays === '*' ? 'Every Day' : cronDays})`;
        showToast(`🎉 Scheduled! Dispatch set at ${time} ${dateDesc} ${targetDesc}`, 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      confirmScheduleModalBtn.disabled = false;
      confirmScheduleModalBtn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4"></i><span>Confirm & Schedule</span>';
      if (window.lucide) window.lucide.createIcons();
    }
  });
}

// WhatsApp QR Modal Events
if (headerWhatsAppBtn) headerWhatsAppBtn.addEventListener('click', openQrModal);
if (modalScanQrBtn) modalScanQrBtn.addEventListener('click', openQrModal);
if (closeQrModalBtn) closeQrModalBtn.addEventListener('click', closeQrModal);
if (qrDoneBtn) qrDoneBtn.addEventListener('click', closeQrModal);

if (refreshQrBtn) {
  refreshQrBtn.addEventListener('click', async () => {
    try {
      refreshQrBtn.disabled = true;
      showToast('Requesting fresh QR code...', 'info');
      await apiCall('/api/whatsapp/reconnect', { method: 'POST' });
      setTimeout(checkWhatsAppQrStatus, 1500);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      refreshQrBtn.disabled = false;
    }
  });
}

if (relinkWhatsAppBtn) {
  relinkWhatsAppBtn.addEventListener('click', async () => {
    if (!confirm('Disconnect current WhatsApp session and link another phone?')) return;
    try {
      showToast('Resetting WhatsApp session...', 'info');
      await apiCall('/api/whatsapp/reconnect', { method: 'POST' });
      currentAppState.isWhatsAppConnected = false;
      updateWhatsAppBadges(false);
      availableWhatsAppGroups = [];
      populateGroupSelects([]);
      if (qrSuccessState) qrSuccessState.classList.add('hidden');
      if (qrLoadingState) qrLoadingState.classList.remove('hidden');
      setTimeout(checkWhatsAppQrStatus, 1500);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// Close modals when clicking backdrop
window.addEventListener('click', (e) => {
  if (e.target === scheduleModal) closeScheduleModal();
  if (e.target === qrModal) closeQrModal();
});

// Send Now (with WhatsApp Login Gatekeeper & Group Support)
sendNowBtn.addEventListener('click', async () => {
  const channel = channelSelect.value;
  const text = enhancedOutput.value.trim() || rawTextInput.value.trim();
  let recipient = recipientInput.value.trim();

  if (channel === 'whatsapp' && currentWorkspaceTarget === 'group') {
    if (groupSelect && groupSelect.value && groupSelect.value !== '__custom__') {
      recipient = groupSelect.value;
    }
  }

  // 1. WhatsApp login gatekeeper
  if (channel === 'whatsapp' && !currentAppState.isWhatsAppConnected) {
    showToast('⚠️ WhatsApp is not logged in! Scan QR code first.', 'error');
    openQrModal();
    return;
  }

  if (!text) {
    showToast('No report text. Enhance notes first.', 'error');
    return;
  }
  if (!recipient && channel !== 'console') {
    showToast('Enter or select a recipient phone number or group.', 'error');
    if (currentWorkspaceTarget === 'group' && groupSelect) {
      groupSelect.focus();
    } else {
      recipientInput.focus();
    }
    return;
  }

  const targetLabel = recipient.endsWith('@g.us')
    ? `Group "${getGroupNameByJid(recipient) || recipient}"`
    : recipient;

  if (!confirm(`Send report via ${channel.toUpperCase()} to ${targetLabel || 'Console'} now?`)) return;

  try {
    sendNowBtn.disabled = true;
    sendNowBtnText.textContent = 'Sending...';

    const json = await apiCall('/api/send-now', {
      method: 'POST',
      body: JSON.stringify({ text, recipient, channel }),
    });

    if (json.success) {
      showToast(json.message || `Dispatched to ${targetLabel}!`, 'success');
      fetchStatus();
    }
  } catch (err) {
    if (err.needsWhatsAppLogin) {
      showToast('⚠️ WhatsApp session disconnected. Please scan QR code.', 'error');
      openQrModal();
    } else {
      showToast(err.message, 'error');
    }
  } finally {
    sendNowBtn.disabled = false;
    sendNowBtnText.textContent = 'Send Now';
  }
});

// Copy Preview
copyPreviewBtn.addEventListener('click', () => {
  const text = enhancedOutput.value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!', 'info'));
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

// Refresh Logs
refreshLogsBtn.addEventListener('click', fetchStatus);

// Textarea listeners
rawTextInput.addEventListener('input', updateWordAndCharCounts);
enhancedOutput.addEventListener('input', updateWordAndCharCounts);

// =============================================================================
// WORKSPACE UI EVENT LISTENERS
// =============================================================================

// Toggle Workspace Dropdown
if (workspaceBtn && workspaceMenu) {
  workspaceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    workspaceMenu.classList.toggle('hidden');
    if (!workspaceMenu.classList.contains('hidden')) {
      fetchWorkspaces();
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (workspaceDropdownWrapper && !workspaceDropdownWrapper.contains(e.target)) {
      workspaceMenu.classList.add('hidden');
    }
  });
}

// Copy Shareable Workspace Link
if (copyWorkspaceLinkBtn) {
  copyWorkspaceLinkBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const shareUrl = `${window.location.origin}${window.location.pathname}?user=${encodeURIComponent(activeUserId)}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast(`Link copied for "${activeUserId}"! Share it with your team.`, 'success');
      if (workspaceMenu) workspaceMenu.classList.add('hidden');
    }).catch(() => {
      showToast('Could not copy link to clipboard', 'error');
    });
  });
}

// Open New Workspace Modal
if (openNewWorkspaceModalBtn) {
  openNewWorkspaceModalBtn.addEventListener('click', () => {
    if (workspaceMenu) workspaceMenu.classList.add('hidden');
    if (newWorkspaceModal) {
      newWorkspaceModal.classList.add('active');
      if (newWorkspaceNameInput) {
        newWorkspaceNameInput.value = '';
        setTimeout(() => newWorkspaceNameInput.focus(), 100);
      }
    }
  });
}

// Close New Workspace Modal
const closeNewWorkspace = () => {
  if (newWorkspaceModal) newWorkspaceModal.classList.remove('active');
};
if (closeNewWorkspaceModalBtn) closeNewWorkspaceModalBtn.addEventListener('click', closeNewWorkspace);
if (cancelNewWorkspaceBtn) cancelNewWorkspaceBtn.addEventListener('click', closeNewWorkspace);

// Submit New Workspace
if (submitNewWorkspaceBtn) {
  const handleCreateWorkspace = async () => {
    const rawName = newWorkspaceNameInput ? newWorkspaceNameInput.value.trim() : '';
    if (!rawName) {
      showToast('Please enter your name or a workspace name', 'error');
      if (newWorkspaceNameInput) newWorkspaceNameInput.focus();
      return;
    }

    try {
      submitNewWorkspaceBtn.disabled = true;
      const res = await apiCall('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: rawName }),
      });

      if (res.success && res.data) {
        closeNewWorkspace();
        showToast(`Workspace "${res.data.id}" created successfully!`, 'success');
        switchWorkspace(res.data.id);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      submitNewWorkspaceBtn.disabled = false;
    }
  };

  submitNewWorkspaceBtn.addEventListener('click', handleCreateWorkspace);

  if (newWorkspaceNameInput) {
    newWorkspaceNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCreateWorkspace();
      }
    });
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================
fetchStatus();
fetchWorkspaces();
setInterval(fetchStatus, 10000);

