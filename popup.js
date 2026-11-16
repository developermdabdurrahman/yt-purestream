/**
 * YT PureStream - popup logic.
 *
 * Everything the popup shows lives in chrome.storage.local and is re-rendered
 * on change, so it stays correct while open (e.g. an ad is skipped right now):
 *
 *   enabled    on/off switch      -> content.js + network rulesets
 *   compat     compatibility mode -> strict ruleset off (set by background.js)
 *   health     last problem report from the content script
 *   features   { video, overlay, cosmetic } switches
 *   allowlist  channels whose ads are left alone
 *   stats      counters written by background.js
 *   lang       'en' | 'bn' (absent = follow the browser language)
 */

const $ = (id) => document.getElementById(id);

const els = {
  toggle: $('toggle'),
  status: $('status'),
  total: $('total'),
  today: $('today'),
  saved: $('saved'),
  reset: $('reset'),
  lang: $('lang'),
  compat: $('compat'),
  compatRetry: $('compatRetry'),
  health: $('health'),
  healthBody: $('healthBody'),
  healthDismiss: $('healthDismiss'),
  fVideo: $('fVideo'),
  fOverlay: $('fOverlay'),
  fCosmetic: $('fCosmetic'),
  channelNow: $('channelNow'),
  channelName: $('channelName'),
  channelToggle: $('channelToggle'),
  channelNone: $('channelNone'),
  allowList: $('allowList'),
  allowEmpty: $('allowEmpty'),
  support: $('support'),
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------ State ------------------------------ */

const state = {
  enabled: true,
  compat: false,
  health: null,
  features: { ...YTPS.DEFAULT_FEATURES },
  allowlist: [],
  stats: YTPS.emptyStats(),
  lang: null,
};

let channel = null;   // channel of the YouTube tab the popup was opened on

/* ------------------------------ i18n ------------------------------ */
/* Own tiny loader (instead of chrome.i18n) so users can switch language
 * inside the popup regardless of the browser language. */

let messages = {};
let fallback = {};
let nf = new Intl.NumberFormat('en-US');

const SUPPORTED_LANGS = ['en', 'bn'];

function effectiveLang() {
  if (SUPPORTED_LANGS.includes(state.lang)) return state.lang;
  const ui = (chrome.i18n.getUILanguage() || 'en').toLowerCase();
  return ui.startsWith('bn') ? 'bn' : 'en';
}

async function loadMessages(lang) {
  const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
  const json = await res.json();
  return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, v.message]));
}

/** Translate `key`, replacing {0}, {1}... with the extra arguments. */
function t(key, ...args) {
  const text = messages[key] ?? fallback[key] ?? key;
  return text.replace(/\{(\d+)\}/g, (_, i) => (args[i] !== undefined ? args[i] : ''));
}

async function setupLanguage() {
  const lang = effectiveLang();
  fallback = await loadMessages('en');
  messages = lang === 'en' ? fallback : await loadMessages(lang);
  nf = new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-US');
  document.documentElement.lang = lang;

  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
}

function formatDuration(totalSeconds) {
  const sec = Math.round(totalSeconds);
  if (sec < 60) return t('unitSec', nf.format(sec));
  const min = Math.round(sec / 60);
  if (min < 60) return t('unitMin', nf.format(min));
  return t('unitHourMin', nf.format(Math.floor(min / 60)), nf.format(min % 60));
}

/* ------------------------------ Rendering ------------------------------ */

function renderEnabled() {
  els.toggle.checked = state.enabled;
  els.status.textContent = t(state.enabled ? 'statusActive' : 'statusPaused');
  els.status.className = state.enabled ? 'active' : 'paused';
  document.body.classList.toggle('off', !state.enabled);
}

let shownTotal = 0;
let animFrame = 0;

/** Count smoothly from the number on screen to `target`. */
function showTotal(target, animate) {
  cancelAnimationFrame(animFrame);
  if (!animate || reduceMotion || target === shownTotal) {
    shownTotal = target;
    els.total.textContent = nf.format(target);
    return;
  }

  const from = shownTotal;
  const duration = Math.min(700, 250 + Math.abs(target - from) * 8);
  const start = performance.now();

  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);               // ease-out cubic
    shownTotal = Math.round(from + (target - from) * eased);
    els.total.textContent = nf.format(shownTotal);
    if (p < 1) animFrame = requestAnimationFrame(step);
  };
  animFrame = requestAnimationFrame(step);

  if (target > from) {                                   // little "pop"
    els.total.classList.remove('bump');
    void els.total.offsetWidth;                          // restart animation
    els.total.classList.add('bump');
  }
}

function renderStats(animate) {
  const s = YTPS.normalizeStats(state.stats);
  showTotal(s.total, animate);
  els.today.textContent = nf.format(s.day === YTPS.todayKey() ? s.today : 0);
  els.saved.textContent = formatDuration(s.savedSeconds);
}

function renderNotices() {
  els.compat.hidden = !(state.compat && state.enabled);

  const h = state.health;
  els.health.hidden = !h;
  if (h) {
    els.healthBody.textContent = t(h.code === 'enforcement-persists' ? 'healthPersists' : 'healthBody');
  }
}

function renderFeatures() {
  els.fVideo.checked = !!state.features.video;
  els.fOverlay.checked = !!state.features.overlay;
  els.fCosmetic.checked = !!state.features.cosmetic;
}

function renderChannels() {
  // Channel of the page the popup was opened on.
  els.channelNone.hidden = !!channel;
  els.channelNow.hidden = !channel;
  if (channel) {
    const allowed = state.allowlist.includes(channel);
    els.channelName.textContent = channel + (allowed ? '  \u2713' : '');
    els.channelToggle.textContent = t(allowed ? 'channelRemove' : 'channelAllow');
  }

  // Everything on the allowlist.
  els.allowList.textContent = '';
  for (const name of state.allowlist) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = name;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = t('channelRemove');
    btn.dataset.channel = name;
    li.append(label, btn);
    els.allowList.append(li);
  }
  els.allowEmpty.hidden = state.allowlist.length > 0;
}

function renderSupport() {
  const url = YTPS_CONFIG.SUPPORT_URL;
  els.support.hidden = !url;
  if (url) els.support.href = url;
}

function renderAll(animate = false) {
  renderEnabled();
  renderStats(animate);
  renderNotices();
  renderFeatures();
  renderChannels();
  renderSupport();
}

/* ------------------------------ Actions ------------------------------ */

async function setEnabled(enabled) {
  state.enabled = enabled;
  renderEnabled();
  try {
    await chrome.storage.local.set({ enabled });
    await YTPS.applyRulesets();
  } catch (err) {
    console.error('[YT PureStream] Failed to update state:', err);
  }
}

async function setFeature(name, value) {
  state.features = { ...state.features, [name]: value };
  await chrome.storage.local.set({ features: state.features });
}

async function setAllowlist(list) {
  state.allowlist = [...new Set(list.map((s) => s.toLowerCase()))];
  renderChannels();
  await chrome.storage.local.set({ allowlist: state.allowlist });
}

/** Ask the content script of the YouTube tab which channel is on screen. */
async function detectChannel() {
  try {
    // `?tab=<id>` lets automated tests point the popup at a specific tab.
    let tabId = Number(new URLSearchParams(location.search).get('tab')) || 0;
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !/^https?:\/\/([^/]*\.)?youtube\.com\//.test(tab.url || '')) return null;
      tabId = tab.id;
    }
    const resp = await chrome.tabs.sendMessage(tabId, { type: YTPS.MSG.GET_CHANNEL });
    return (resp && resp.channel) || null;
  } catch (_) {
    return null;   // not a YouTube tab / content script not there
  }
}

/* ------------------------------ Wiring ------------------------------ */

els.toggle.addEventListener('change', () => setEnabled(els.toggle.checked));

els.fVideo.addEventListener('change', () => setFeature('video', els.fVideo.checked));
els.fOverlay.addEventListener('change', () => setFeature('overlay', els.fOverlay.checked));
els.fCosmetic.addEventListener('change', () => setFeature('cosmetic', els.fCosmetic.checked));

els.channelToggle.addEventListener('click', () => {
  if (!channel) return;
  const without = state.allowlist.filter((c) => c !== channel);
  setAllowlist(state.allowlist.includes(channel) ? without : [...state.allowlist, channel]);
});

els.allowList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-channel]');
  if (btn) setAllowlist(state.allowlist.filter((c) => c !== btn.dataset.channel));
});

els.compatRetry.addEventListener('click', async () => {
  await chrome.storage.local.set({ compat: false, health: null });
  await YTPS.applyRulesets();
});

els.healthDismiss.addEventListener('click', () => chrome.storage.local.set({ health: null }));

els.lang.addEventListener('click', async () => {
  state.lang = effectiveLang() === 'bn' ? 'en' : 'bn';
  await chrome.storage.local.set({ lang: state.lang });
  await setupLanguage();
  renderAll(false);
});

// Two-step reset (confirm() is unreliable inside extension popups).
let resetTimer = 0;
els.reset.addEventListener('click', async () => {
  if (!resetTimer) {
    els.reset.textContent = t('resetSure');
    resetTimer = setTimeout(() => {
      els.reset.textContent = t('reset');
      resetTimer = 0;
    }, 3000);
    return;
  }
  clearTimeout(resetTimer);
  resetTimer = 0;
  els.reset.textContent = t('reset');
  await chrome.storage.local.set({ stats: YTPS.emptyStats() });
});

// Live updates while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of ['enabled', 'compat', 'health', 'features', 'allowlist', 'stats']) {
    if (!changes[key]) continue;
    const value = changes[key].newValue;
    if (key === 'enabled') state.enabled = value !== false;
    else if (key === 'features') state.features = { ...YTPS.DEFAULT_FEATURES, ...(value || {}) };
    else if (key === 'allowlist') state.allowlist = value || [];
    else if (key === 'stats') state.stats = value;
    else state[key] = value;
  }
  renderAll(!!changes.stats);
});

(async function init() {
  const saved = await chrome.storage.local.get({
    enabled: true,
    compat: false,
    health: null,
    features: YTPS.DEFAULT_FEATURES,
    allowlist: [],
    stats: YTPS.emptyStats(),
    lang: null,
  });
  Object.assign(state, saved, {
    features: { ...YTPS.DEFAULT_FEATURES, ...saved.features },
  });

  await setupLanguage();
  renderAll(true);                 // count up from 0 when the popup opens

  channel = await detectChannel();
  renderChannels();
})();
