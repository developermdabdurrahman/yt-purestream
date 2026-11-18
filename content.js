/**
 * YT PureStream - content script (runs only on *.youtube.com, document_start).
 *
 * Strategy
 * --------
 * YouTube frequently serves ads through the very same <video> element (and
 * sometimes server-side stitched streams), so a pure network block is not
 * enough and an aggressive one gets flagged by anti-adblock. Instead we let the
 * ad "play", but make it invisible and instantaneous:
 *
 *   1. Detect an ad via classes on #movie_player.
 *   2. Mute the <video>, play it at 16x and jump to its end.
 *   3. Click any skip / close button that appears.
 *   4. Restore the user's original mute state and playback rate afterwards.
 *
 * Extras: Shorts ad auto-advance, compatibility-mode fallback when YouTube
 * shows its anti-adblock dialog, health reports when selectors stop working,
 * per-feature switches and a per-channel allowlist.
 *
 * Triggers: MutationObserver on the player (only once it exists - there is no
 * page-wide observer), a requestAnimationFrame loop while an ad is active, a
 * slow interval as a safety net (also works in background tabs), a short fast
 * poll while the player is still being created, and YouTube's SPA navigation
 * events.
 */
(() => {
  'use strict';

  // Guard against double injection.
  if (window.__ytPureStreamLoaded) return;
  window.__ytPureStreamLoaded = true;

  /* ------------------------------------------------------------------ *
   * Configuration
   * ------------------------------------------------------------------ */
  const CFG = {
    ROOT_ATTR: 'data-ytps',                // master switch for styles.css
    ROOT_ATTR_OVERLAY: 'data-ytps-overlay',
    ROOT_ATTR_COSMETIC: 'data-ytps-cosmetic',
    AD_PLAYBACK_RATE: 16,                  // Chrome's maximum playbackRate
    SEEK_EPSILON: 0.1,                     // land this many seconds before the end
    // Safety: never jump to the end of a "video" longer than this. If an ad is
    // stitched into the real stream, duration would be that of the real video
    // and seeking to the end would skip the content the user wanted.
    MAX_SEEKABLE_AD_SECONDS: 180,
    FALLBACK_INTERVAL_MS: 500,
    CLICK_THROTTLE_MS: 250,
    COUNT_DEDUPE_MS: 1000,
    ENFORCEMENT_CHECK_MS: 1000,
    CHANNEL_CACHE_MS: 400,
    MIN_TICK_GAP_MS: 100,                  // observer-driven ticks are spaced at least this far apart
    STORAGE_WAIT_MS: 250,                  // wait for saved settings this long before using defaults
    PLAYER_POLL_MS: 100,                   // fast poll while waiting for #movie_player ...
    PLAYER_POLL_WINDOW_MS: 8000,           // ... for this long after load / navigation
    CHANNEL_WAIT_MS: 1500,                 // wait this long for the owner link before a pre-roll
    NAV_STALE_MS: 4000,                    // ignore the old page's channel this long after navigate-start
    RELOAD_GUARD_MS: 60000,                // reload at most once per minute
    HEALTH_NO_VIDEO_MS: 10000,             // ad state but no <video> for this long
    HEALTH_AD_STUCK_MS: 150000,            // same ad state for this long
  };

  const MSG = {
    AD_SKIPPED: 'ytps:ad-skipped',
    AD_FINISHED: 'ytps:ad-finished',
    ENFORCEMENT: 'ytps:enforcement',
    HEALTH: 'ytps:health',
    GET_CHANNEL: 'ytps:get-channel',
    ALLOW_TAB: 'ytps:allow-tab',
  };

  const AD_CLASSES = ['ad-showing', 'ad-interrupting'];
  const AD_OVERLAY_SELECTOR = '.ytp-ad-player-overlay';

  const VIDEO_SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
  ];
  const OVERLAY_CLOSE_SELECTOR = '.ytp-ad-overlay-close-button';

  // Best-effort markers of an advert inside a Shorts reel (YouTube changes
  // these often; the health check reports when nothing works any more).
  const SHORTS_AD_SELECTOR =
    'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ad-badge-view-model, [is-ad]';
  const SHORTS_NEXT_BUTTON = '#navigation-button-down button';   // preferred
  const SHORTS_NEXT_WRAPPER = '#navigation-button-down';          // fallback

  // YouTube's anti-adblock ("Ad blockers are not allowed") dialog.
  // Structural markers (language independent) ...
  const ENFORCEMENT_SELECTOR = [
    'ytd-enforcement-message-view-model',
    'tp-yt-paper-dialog [class*="enforcement"]',
    'tp-yt-paper-dialog [id*="enforcement"]',
  ].join(',');
  // ... and the wording in the most common interface languages, as a backup.
  const ENFORCEMENT_TEXTS = [
    /ad blockers?\s+(are|is)\s+not\s+allowed|ad blockers?\s+violate/i,        // English
    /(?:বিজ্ঞাপন|অ্যাড|এড)\s*ব্লকার/,                                           // Bengali
    /(?:विज्ञापन\s*अवरोधक|ए?ड\s*ब्लॉकर|ऐड\s*ब्लॉकर)/,                         // Hindi
    /bloqueadores?\s+de\s+anuncios/i,                           // Spanish, Portuguese
    /bloqueurs?\s+de\s+publicit/i,                                              // French
    /werbeblocker/i,                                                             // German
    /pemblokir\s+iklan/i,                                                        // Indonesian
    /reklam\s+engelleyici/i,                                                     // Turkish
    /блокировщик\S*\s+рекламы/i,                                                // Russian
    /مانع(?:ات)?\s+الإعلانات/,                                                   // Arabic
    /広告ブロック/,                                                              // Japanese
    /광고\s*차단/,                                                               // Korean
  ];

  const CHANNEL_SELECTORS = [
    'ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name a',
    'ytd-video-owner-renderer ytd-channel-name a',
    '#owner ytd-channel-name a',
    'ytd-reel-video-renderer[is-active] a[href*="/@"]',
  ];

  const DEFAULT_FEATURES = { video: true, overlay: true, cosmetic: true };

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  // Settings (optimistic defaults until storage answers).
  const config = { enabled: true, features: { ...DEFAULT_FEATURES }, allowlist: [] };
  let skipQuery = '';                    // rebuilt by applyConfig()

  let player = null;                     // current #movie_player element
  let playerObserver = null;             // watches the player
  let pollTimer = 0;                     // fast poll while the player does not exist yet
  let ready = false;                     // saved settings applied (or the wait timed out)
  let lastTickAt = -Infinity;
  let rafId = 0;
  let tickQueued = false;
  let tickTimer = 0;                     // pending queued tick (timeout) ...
  let tickRaf = 0;                       // ... or (animation frame)

  let savedState = null;                 // { video, muted, rate } while in an ad
  let inAd = false;                      // an ad break is being handled
  let breakCounted = false;              // this break was added to the counter
  let adSeconds = 0;                     // longest finite ad duration seen (time saved)
  let adStartedAt = 0;
  let noVideoSince = 0;
  let lastCountTime = -Infinity;         // de-duplicates flickering ad classes
  let lastEnforcementCheck = 0;
  let enforcementHandled = false;
  const healthSent = new Set();

  let channelCache = { at: -Infinity, value: null };
  let navStartedAt = 0;                  // last (SPA) navigation start; 0 = page load
  let navigating = false;                // between yt-navigate-start and -finish
  let bypassSent = false;                // we told the worker this tab is allowlisted

  let stopped = false;                   // set once the extension is gone (orphaned)
  let intervalId = 0;

  const clickLog = new WeakMap();        // button -> { time, count }
  const countedOverlays = new Set();     // overlay-ad close buttons already counted
  let handledReel = null;                // the Shorts ad reel we already skipped

  /* ------------------------------------------------------------------ *
   * Messaging helpers
   * ------------------------------------------------------------------ */
  function send(message, callback) {
    try {
      const p = chrome.runtime.sendMessage(message, callback);
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* extension context invalidated (extension reloaded) */ }
  }

  /**
   * Tell the background worker one more ad was skipped (it owns the counter).
   * Returns false (and sends nothing) if one was counted less than
   * COUNT_DEDUPE_MS ago, because YouTube can briefly toggle the ad classes
   * while loading a single ad.
   */
  function reportAdSkipped() {
    const now = performance.now();
    if (now - lastCountTime < CFG.COUNT_DEDUPE_MS) return false;
    lastCountTime = now;
    send({ type: MSG.AD_SKIPPED });
    return true;
  }

  function reportHealth(code) {
    if (healthSent.has(code)) return;
    healthSent.add(code);
    send({ type: MSG.HEALTH, code });
  }

  /* ------------------------------------------------------------------ *
   * DOM helpers
   * ------------------------------------------------------------------ */
  const getVideo = (p) =>
    p && (p.querySelector('video.html5-main-video') || p.querySelector('video'));

  /** The player itself says an ad is playing (the only state in which we touch the media). */
  function hasAdClass(p) {
    if (!p) return false;
    for (const cls of AD_CLASSES) {
      if (p.classList.contains(cls)) return true;
    }
    return false;
  }

  /** Ad state of any kind (player class, or a visible ad overlay). */
  function isAdShowing(p) {
    if (!p) return false;
    return hasAdClass(p) || !!p.querySelector(AD_OVERLAY_SELECTOR);
  }

  /** Dispatch a realistic pointer/mouse click sequence at the element centre. */
  function syntheticClick(el) {
    const rect = el.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const usePointer = type.startsWith('pointer') && typeof PointerEvent === 'function';
      const evt = usePointer
        ? new PointerEvent(type, { ...init, pointerType: 'mouse', isPrimary: true })
        : new MouseEvent(type, init);
      el.dispatchEvent(evt);
    }
  }

  /**
   * Click every enabled skip/close button currently in the DOM.
   * First attempt: native .click(). Later attempts (button still there):
   * .click() plus the synthetic event sequence as a fallback.
   * Throttled per button so we never spam clicks every frame.
   */
  function clickSkipButtons() {
    // Forget overlay buttons YouTube removed, so a later ad is counted again.
    for (const el of countedOverlays) {
      if (!el.isConnected) countedOverlays.delete(el);
    }

    if (!skipQuery) return;
    const buttons = (player && player.isConnected ? player : document).querySelectorAll(skipQuery);
    if (!buttons.length) return;

    const now = performance.now();
    for (const btn of buttons) {
      const log = clickLog.get(btn) || { time: 0, count: 0 };
      if (now - log.time < CFG.CLICK_THROTTLE_MS) continue;

      // A banner/overlay ad being closed counts as one ad (once per element).
      if (btn.matches(OVERLAY_CLOSE_SELECTOR) && !countedOverlays.has(btn)) {
        countedOverlays.add(btn);
        reportAdSkipped();
      }

      try {
        btn.click();
        if (log.count > 0) syntheticClick(btn);
      } catch (_) { /* element may have been detached mid-loop */ }

      clickLog.set(btn, { time: now, count: log.count + 1 });
    }
  }

  /* ------------------------------------------------------------------ *
   * Channel allowlist
   * ------------------------------------------------------------------ */
  /** "@handle" or "channel/UC..." of the video being watched, or null. */
  function readChannel() {
    const path = location.pathname;
    if (!path.startsWith('/watch') && !path.startsWith('/shorts')) return null;

    for (const sel of CHANNEL_SELECTORS) {
      const a = document.querySelector(sel);
      if (!a) continue;
      const m = /\/(@[^/?#]+|channel\/[^/?#]+)/.exec(a.getAttribute('href') || '');
      if (m) {
        try { return decodeURIComponent(m[1]).toLowerCase(); } catch (_) { return m[1].toLowerCase(); }
      }
    }
    return null;
  }

  function onVideoPage() {
    return location.pathname.startsWith('/watch') || location.pathname.startsWith('/shorts');
  }

  function currentChannel() {
    const now = performance.now();
    // While YouTube swaps pages the old owner link is still in the DOM.
    if (navigating && now - navStartedAt < CFG.NAV_STALE_MS) return null;
    if (now - channelCache.at > CFG.CHANNEL_CACHE_MS) {
      channelCache = { at: now, value: readChannel() };
    }
    return channelCache.value;
  }

  function isChannelAllowed() {
    if (!config.allowlist.length) return false;
    const ch = currentChannel();
    return !!ch && config.allowlist.includes(ch);
  }

  /**
   * With a non-empty allowlist, the owner link may render a moment after the
   * first ad frame. Hold back briefly so a pre-roll on an allowed channel is
   * not skipped before we can know whose video it is.
   */
  function channelPending() {
    return (
      config.allowlist.length > 0 &&
      onVideoPage() &&
      !currentChannel() &&
      performance.now() - navStartedAt < CFG.CHANNEL_WAIT_MS
    );
  }

  /**
   * Ask the worker to let this tab's ad requests through (a per-tab
   * declarativeNetRequest allow rule) while an allowlisted channel is open.
   */
  function syncBypass(want) {
    if (want === bypassSent) return;
    bypassSent = want;
    send({ type: MSG.ALLOW_TAB, on: want });
  }

  /* ------------------------------------------------------------------ *
   * Ad handling
   * ------------------------------------------------------------------ */
  function handleAd() {
    // An ad overlay alone (no ad-showing / ad-interrupting on the player) can be
    // a banner on top of the real video: never mute, speed up or seek then.
    if (!hasAdClass(player)) {
      noVideoSince = 0;
      restoreVideo();
      return;
    }

    const video = getVideo(player);
    if (!video) {
      // Ad state but nothing to act on: YouTube probably changed its markup.
      const now = performance.now();
      if (!noVideoSince) noVideoSince = now;
      else if (now - noVideoSince > CFG.HEALTH_NO_VIDEO_MS) reportHealth('no-video');
      return;
    }
    noVideoSince = 0;

    // Remember the user's settings once, at the start of the ad.
    if (!savedState || savedState.video !== video) {
      savedState = {
        video,
        muted: video.muted,
        rate: video.playbackRate >= CFG.AD_PLAYBACK_RATE ? 1 : video.playbackRate,
      };
    }

    try {
      if (!video.muted) video.muted = true;
      if (video.playbackRate !== CFG.AD_PLAYBACK_RATE) {
        video.playbackRate = CFG.AD_PLAYBACK_RATE;
      }

      const d = video.duration;
      const seekable = Number.isFinite(d) && d > 0 && d <= CFG.MAX_SEEKABLE_AD_SECONDS;
      if (seekable) adSeconds = Math.max(adSeconds, d);   // for "time saved"

      // Jump to the end of the ad when it is safe to do so.
      if (
        seekable &&
        video.readyState >= 1 &&                      // HAVE_METADATA
        d - video.currentTime > CFG.SEEK_EPSILON * 2  // not already at the end
      ) {
        video.currentTime = d - CFG.SEEK_EPSILON;
      }
    } catch (_) {
      // InvalidStateError etc. - ignore, the next tick will retry.
    }
  }

  /** Put mute state and playback rate back to what the user had. */
  function restoreVideo() {
    if (!savedState) return;
    const { video, muted, rate } = savedState;
    savedState = null;
    try {
      if (video.isConnected) {
        video.muted = muted;
        video.playbackRate = rate;
      }
    } catch (_) { /* ignore */ }
  }

  /** Close out the current ad break (if any) and restore the video. */
  function endAd() {
    if (inAd) {
      if (breakCounted && adSeconds > 0) {
        send({ type: MSG.AD_FINISHED, seconds: adSeconds });
      }
      inAd = false;
      breakCounted = false;
      adSeconds = 0;
      adStartedAt = 0;
      noVideoSince = 0;
    }
    restoreVideo();
  }

  /**
   * Shorts: an ad appears as its own reel. When the active reel looks like an
   * ad, scroll to the next one (once per reel).
   */
  function skipShortsAd() {
    if (!config.features.video || !location.pathname.startsWith('/shorts')) return;

    const reel = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (!reel) {
      handledReel = null;
      return;
    }
    // YouTube recycles reel elements: forget the old one as soon as another
    // reel is active, or once this one no longer carries ad markers.
    if (handledReel && handledReel !== reel) handledReel = null;
    const isAd = reel.matches(SHORTS_AD_SELECTOR) || !!reel.querySelector(SHORTS_AD_SELECTOR);
    if (!isAd) {
      if (handledReel === reel) handledReel = null;
      return;
    }
    if (handledReel === reel) return;

    const next =
      document.querySelector(SHORTS_NEXT_BUTTON) || document.querySelector(SHORTS_NEXT_WRAPPER);
    if (!next) return;
    handledReel = reel;
    reportAdSkipped();
    try { next.click(); } catch (_) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * Anti-adblock fallback ("compatibility mode")
   * ------------------------------------------------------------------ */
  function detectEnforcement() {
    if (document.querySelector(ENFORCEMENT_SELECTOR)) return true;
    for (const dialog of document.querySelectorAll('tp-yt-paper-dialog')) {
      const text = (dialog.textContent || '').slice(0, 2000);
      if (ENFORCEMENT_TEXTS.some((re) => re.test(text))) return true;
    }
    return false;
  }

  /** Reload the page, but never more than once per RELOAD_GUARD_MS. */
  function reloadOnce() {
    try {
      const KEY = 'ytps-reload-at';
      const last = Number(sessionStorage.getItem(KEY)) || 0;
      if (Date.now() - last < CFG.RELOAD_GUARD_MS) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch (_) { /* storage blocked: still reload once per page */ }
    location.reload();
  }

  function checkEnforcement() {
    if (enforcementHandled) return;
    const now = performance.now();
    if (now - lastEnforcementCheck < CFG.ENFORCEMENT_CHECK_MS) return;
    lastEnforcementCheck = now;

    if (!detectEnforcement()) return;
    enforcementHandled = true;   // once per page load
    send({ type: MSG.ENFORCEMENT }, (resp) => {
      void chrome.runtime.lastError;
      if (resp && resp.switched) setTimeout(reloadOnce, 300);
    });
  }

  /* ------------------------------------------------------------------ *
   * Player discovery & observation
   * ------------------------------------------------------------------ */
  function detachPlayer() {
    if (playerObserver) playerObserver.disconnect();
    playerObserver = null;
    player = null;
  }

  function attachPlayer(el) {
    detachPlayer();
    player = el;
    playerObserver = new MutationObserver(queueTick);
    playerObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class'],   // ad-showing / ad-interrupting
      childList: true,              // ad overlays / skip buttons being added
      subtree: true,
    });
  }

  /** Make sure we are watching the *current* #movie_player. */
  function ensurePlayer() {
    const current = document.getElementById('movie_player');

    if (current && current === player && player.isConnected) return;

    if (current) {
      attachPlayer(current);
    } else {
      // Player not in the DOM yet (document_start) or it was torn down. No
      // page-wide observer (it would run on every DOM change of a busy page):
      // poll cheaply for a short while, then rely on the interval and
      // YouTube's navigation events.
      detachPlayer();
      if (!pollTimer && performance.now() - navStartedAt < CFG.PLAYER_POLL_WINDOW_MS) {
        pollTimer = setTimeout(() => {
          pollTimer = 0;
          tick();
        }, CFG.PLAYER_POLL_MS);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Main loop
   * ------------------------------------------------------------------ */
  function queueTick() {
    if (tickQueued) return;
    tickQueued = true;
    // Busy pages mutate the player constantly: keep a minimum gap between
    // ticks, except while an ad is active (then every frame counts).
    const wait = inAd || rafId ? 0 : CFG.MIN_TICK_GAP_MS - (performance.now() - lastTickAt);
    if (wait > 0) tickTimer = setTimeout(tick, wait);
    else tickRaf = requestAnimationFrame(tick);
  }

  function rafStep() {
    rafId = 0;
    tick();
  }

  /**
   * When the extension is reloaded, updated, disabled or removed, Chrome leaves
   * the old content script running in tabs that were already open. It can no
   * longer hear the popup's switch, so it would keep skipping ads even while
   * "Paused". chrome.runtime.id disappears in that situation: detect it and
   * undo everything we changed in the page.
   */
  function contextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function shutdown() {
    if (stopped) return;
    stopped = true;
    endAd();                                  // restore mute state and speed
    syncBypass(false);
    setRootAttr(CFG.ROOT_ATTR, false);        // un-hide everything (styles.css)
    setRootAttr(CFG.ROOT_ATTR_OVERLAY, false);
    setRootAttr(CFG.ROOT_ATTR_COSMETIC, false);
    detachPlayer();
    clearInterval(intervalId);
    clearTimeout(pollTimer);
    pollTimer = 0;
    clearTimeout(tickTimer);
    cancelAnimationFrame(tickRaf);
    tickTimer = tickRaf = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function tick() {
    // Whoever called us (observer, interval, navigation event) takes over the
    // queued tick, so queued ticks can never pile up.
    clearTimeout(tickTimer);
    cancelAnimationFrame(tickRaf);
    tickTimer = tickRaf = 0;
    tickQueued = false;
    lastTickAt = performance.now();
    window.__ytpsTicks = (window.__ytpsTicks | 0) + 1;   // read by the tests (isolated world only)
    if (stopped) return;
    if (!contextAlive()) {
      shutdown();
      return;
    }
    if (!ready) return;     // saved settings not applied yet (avoids a flash of the wrong state)

    if (!config.enabled) {
      endAd();
      syncBypass(false);
      return;
    }

    ensurePlayer();
    checkEnforcement();

    // Creator is on the allowlist: leave their ads alone (page and network).
    if (isChannelAllowed()) {
      endAd();
      syncBypass(true);
      return;
    }
    syncBypass(false);

    // Allowlist in use but the channel link is not rendered yet: wait a moment.
    if (channelPending()) return;

    // Overlay close buttons can appear without the player being in "ad" mode.
    clickSkipButtons();
    skipShortsAd();

    const adActive = config.features.video && isAdShowing(player);
    if (adActive) {
      if (!inAd) {            // an ad break just started -> count it once
        inAd = true;
        adStartedAt = performance.now();
        breakCounted = reportAdSkipped();
      } else if (performance.now() - adStartedAt > CFG.HEALTH_AD_STUCK_MS) {
        reportHealth('ad-stuck');
      }
      handleAd();
      // Run every frame for as long as the ad is up.
      if (!rafId) rafId = requestAnimationFrame(rafStep);
    } else {
      endAd();
    }
  }

  /* ------------------------------------------------------------------ *
   * Settings
   * ------------------------------------------------------------------ */
  function setRootAttr(name, on) {
    const root = document.documentElement;
    if (!root) return;
    if (on) root.setAttribute(name, 'on');
    else root.removeAttribute(name);
  }

  function applyConfig(partial) {
    ready = true;
    if ('enabled' in partial) config.enabled = partial.enabled !== false;
    if ('features' in partial) {
      config.features = { ...DEFAULT_FEATURES, ...(partial.features || {}) };
    }
    if ('allowlist' in partial) {
      config.allowlist = Array.isArray(partial.allowlist)
        ? partial.allowlist.map((s) => String(s).toLowerCase())
        : [];
    }

    // Which buttons we are allowed to click.
    const selectors = [];
    if (config.features.video) selectors.push(...VIDEO_SKIP_SELECTORS);
    if (config.features.overlay) selectors.push(OVERLAY_CLOSE_SELECTOR);
    skipQuery = selectors.join(',');

    // Switches for styles.css.
    setRootAttr(CFG.ROOT_ATTR, config.enabled);
    setRootAttr(CFG.ROOT_ATTR_OVERLAY, config.enabled && config.features.overlay);
    setRootAttr(CFG.ROOT_ATTR_COSMETIC, config.enabled && config.features.cosmetic);

    channelCache.at = -Infinity;
    tick();
  }

  function initStorage() {
    try {
      chrome.storage.local.get(
        { enabled: true, features: DEFAULT_FEATURES, allowlist: [] },
        (res) => applyConfig(res)
      );
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const partial = {};
        for (const key of ['enabled', 'features', 'allowlist']) {
          if (changes[key]) partial[key] = changes[key].newValue;
        }
        if (Object.keys(partial).length) applyConfig(partial);
      });

      // The popup asks which channel is on screen.
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.type === MSG.GET_CHANNEL) {
          sendResponse({ channel: readChannel() });
        }
      });
    } catch (_) {
      // Extension context invalidated (extension reloaded): stay as-is.
    }
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  initStorage();
  // Storage normally answers within a few ms. If it does not, protect with defaults.
  setTimeout(() => { if (!ready && !stopped) applyConfig({}); }, CFG.STORAGE_WAIT_MS);

  // YouTube SPA navigation (video <-> video, home -> watch, Shorts swipes...).
  // Captured on window so it works whichever node YouTube dispatches it on.
  for (const evt of ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated']) {
    window.addEventListener(evt, () => {
      // Force re-discovery: the player node can be replaced between pages.
      if (evt !== 'yt-navigate-start') detachPlayer();
      if (evt === 'yt-navigate-start') {
        navigating = true;
        navStartedAt = performance.now();
      } else if (evt === 'yt-navigate-finish') {
        navigating = false;
        navStartedAt = performance.now();
      }
      channelCache.at = -Infinity;
      tick();
    }, true);
  }

  // Put the user's mute state and speed back if the page goes away mid-ad
  // (also covers the back/forward cache), and release the allowlist bypass.
  window.addEventListener('pagehide', () => {
    restoreVideo();
    syncBypass(false);
  });

  // Safety net (also fires in background tabs where rAF is paused).
  intervalId = setInterval(tick, CFG.FALLBACK_INTERVAL_MS);
})();
