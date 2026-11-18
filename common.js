/**
 * YT PureStream - code shared by the service worker (importScripts) and the
 * popup (<script>). Not used by the content script.
 */

/* exported YTPS, YTPS_CONFIG */

/* Edit these values to customise the extension. */
const YTPS_CONFIG = {
  // Shown as "Support this project" in the popup footer. Leave '' to hide it.
  // Example: 'https://github.com/sponsors/your-name' or 'https://ko-fi.com/your-name'
  SUPPORT_URL: '',
};

const YTPS = {
  /** Static rulesets declared in manifest.json. */
  RULESET_CORE: 'yt_core_rules',     // pagead + doubleclick (always on while enabled)
  RULESET_STRICT: 'yt_strict_rules', // ptracking + stats/ads (off in compatibility mode)

  /** Messages sent by the content script to the service worker. */
  MSG: {
    AD_SKIPPED: 'ytps:ad-skipped',
    AD_FINISHED: 'ytps:ad-finished',
    ENFORCEMENT: 'ytps:enforcement',
    HEALTH: 'ytps:health',
    GET_CHANNEL: 'ytps:get-channel', // popup -> content script
    ALLOW_TAB: 'ytps:allow-tab',     // content script: this tab shows an allowlisted channel
  },

  /** Compatibility mode is lifted again after this long (and after every update). */
  COMPAT_RETRY_MS: 7 * 24 * 60 * 60 * 1000,

  /** Cap on the seconds credited to "time saved" for a single ad. */
  MAX_SAVED_PER_AD: 180,

  DEFAULT_FEATURES: { video: true, overlay: true, cosmetic: true },

  /** Local date as YYYY-MM-DD (used for the "Today" counter). */
  todayKey() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },

  emptyStats() {
    return { total: 0, today: 0, day: YTPS.todayKey(), savedSeconds: 0 };
  },

  /** Fill in any missing counter fields (older versions stored fewer). */
  normalizeStats(stats) {
    return { ...YTPS.emptyStats(), ...(stats || {}) };
  },

  /**
   * Make the enabled network rulesets match the saved state:
   *   core   = extension enabled
   *   strict = extension enabled AND not in compatibility mode
   * Safe to call repeatedly (idempotent).
   */
  async applyRulesets() {
    const { enabled, compat } = await chrome.storage.local.get({ enabled: true, compat: false });
    const wantCore = enabled;
    const wantStrict = enabled && !compat;

    const enable = [];
    const disable = [];
    (wantCore ? enable : disable).push(YTPS.RULESET_CORE);
    (wantStrict ? enable : disable).push(YTPS.RULESET_STRICT);

    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enable,
      disableRulesetIds: disable,
    });
  },
};
