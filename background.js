/**
 * YT PureStream - background service worker.
 *
 * Responsibilities (kept small):
 *  1. Keep the declarativeNetRequest rulesets in sync with the saved state
 *     (on/off switch + compatibility mode). Chrome resets rulesets to their
 *     manifest default on install/update, so we re-apply after those too.
 *  2. Be the single writer of the counters. Content scripts from many tabs send
 *     messages; all writes go through a promise queue so concurrent tabs can
 *     never overwrite each other's updates.
 *  3. Compatibility mode: when YouTube shows its "ad blockers are not allowed"
 *     dialog, switch off the strict (tracking) ruleset.
 *  4. Show the running total on the toolbar badge.
 */

importScripts('common.js');

const { MSG } = YTPS;

/* ----------------------------- Write queue ----------------------------- */

let queue = Promise.resolve();

/** Run fn after all previously queued work; the queue survives failures. */
function mutate(fn) {
  const run = queue.then(fn);
  queue = run.catch((err) => console.warn('[YT PureStream] Background error:', err));
  return run;
}

const getState = (extra = {}) =>
  chrome.storage.local.get({
    enabled: true,
    compat: false,
    stats: YTPS.emptyStats(),
    ...extra,
  });

/* ------------------------------- Counters ------------------------------- */

function recordAdSkipped() {
  return mutate(async () => {
    const state = await getState();
    if (!state.enabled) return;

    const stats = YTPS.normalizeStats(state.stats);
    const day = YTPS.todayKey();
    await chrome.storage.local.set({
      stats: {
        ...stats,
        total: stats.total + 1,
        today: (stats.day === day ? stats.today : 0) + 1,
        day,
      },
    });
  });
}

function recordAdFinished(seconds) {
  return mutate(async () => {
    const state = await getState();
    if (!state.enabled) return;

    const credit = Math.min(Math.max(Number(seconds) || 0, 0), YTPS.MAX_SAVED_PER_AD);
    const stats = YTPS.normalizeStats(state.stats);
    const update = { stats: { ...stats, savedSeconds: stats.savedSeconds + credit } };

    // An ad that completed normally proves the ad selectors work again, so
    // clear "selectors broke" reports. A persisting anti-adblock warning is a
    // different problem and stays until the user dismisses it.
    const { health } = await chrome.storage.local.get({ health: null });
    if (health && (health.code === 'no-video' || health.code === 'ad-stuck')) {
      update.health = null;
    }
    await chrome.storage.local.set(update);
  });
}

function recordHealth(code) {
  return mutate(() =>
    chrome.storage.local.set({ health: { code: String(code), at: Date.now() } })
  );
}

/* -------------------------- Compatibility mode -------------------------- */

/**
 * YouTube showed its enforcement dialog. First time: turn on compatibility
 * mode (strict ruleset off) and tell the page to reload once. If it is already
 * on and the dialog still appears, just record it for the popup.
 */
function handleEnforcement() {
  return mutate(async () => {
    const { enabled, compat } = await getState();
    if (!enabled) return { switched: false };

    if (compat) {
      await chrome.storage.local.set({
        health: { code: 'enforcement-persists', at: Date.now() },
      });
      return { switched: false };
    }

    await chrome.storage.local.set({ compat: true, compatAt: Date.now() });
    await YTPS.applyRulesets();
    return { switched: true };
  });
}

/* ------------------------------ Messaging ------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg) return;

  switch (msg.type) {
    case MSG.AD_SKIPPED:
      recordAdSkipped();
      return;
    case MSG.AD_FINISHED:
      recordAdFinished(msg.seconds);
      return;
    case MSG.HEALTH:
      recordHealth(msg.code);
      return;
    case MSG.ENFORCEMENT:
      handleEnforcement().then(sendResponse, () => sendResponse({ switched: false }));
      return true; // async response
  }
});

/* ------------------------------- Badge ------------------------------- */

function formatBadge(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
  if (n < 1000000) return Math.floor(n / 1000) + 'k';
  return Math.floor(n / 1000000) + 'M';
}

async function updateBadge() {
  try {
    const { enabled, stats } = await getState();
    if (!enabled) {
      await chrome.action.setBadgeBackgroundColor({ color: '#6b6b6b' });
      await chrome.action.setBadgeText({ text: 'OFF' });
      return;
    }
    const total = YTPS.normalizeStats(stats).total;
    await chrome.action.setBadgeBackgroundColor({ color: '#1e8e3e' });
    await chrome.action.setBadgeText({ text: total > 0 ? formatBadge(total) : '' });
  } catch (err) {
    console.warn('[YT PureStream] Badge error:', err);
  }
}

/* ------------------------------ Lifecycle ------------------------------ */

async function syncAll() {
  try {
    await YTPS.applyRulesets();
  } catch (err) {
    console.warn('[YT PureStream] Could not sync rulesets:', err);
  }
  await updateBadge();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled || changes.compat) {
    YTPS.applyRulesets().catch((err) =>
      console.warn('[YT PureStream] Could not sync rulesets:', err)
    );
  }
  if (changes.stats || changes.enabled) updateBadge();
});

chrome.runtime.onInstalled.addListener(syncAll);
chrome.runtime.onStartup.addListener(syncAll);
