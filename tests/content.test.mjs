/** Content script + CSS behaviour on a mocked youtube.com page. */
import {
  createChecker, launch, mockYouTube, openPage, watchPage, adOn, adOff, videoState, display, sleep,
} from './helpers.mjs';

const { check, finish } = createChecker();
const t = await launch();

const WATCH = 'https://www.youtube.com/watch?v=test';

// Which page the mock serves depends on the URL.
const pages = {
  '/': () => `<!doctype html><body>
    <ytd-rich-item-renderer id="adItem"><ytd-ad-slot-renderer>sponsored</ytd-ad-slot-renderer></ytd-rich-item-renderer>
    <ytd-rich-item-renderer id="normalItem"><div>real video</div></ytd-rich-item-renderer></body>`,
  '/shorts/abc': () => `<!doctype html><body>
    <ytd-reel-video-renderer id="reel" is-active><ytd-ad-slot-renderer>ad</ytd-ad-slot-renderer></ytd-reel-video-renderer>
    <div id="navigation-button-down"><button id="nextBtn">next</button></div>
    <script>window.__next = 0; document.getElementById('nextBtn').addEventListener('click', () => window.__next++);</script></body>`,
  '/shorts/normal': () => `<!doctype html><body>
    <ytd-reel-video-renderer id="reel" is-active><div>normal short</div></ytd-reel-video-renderer>
    <div id="navigation-button-down"><button id="nextBtn">next</button></div>
    <script>window.__next = 0; document.getElementById('nextBtn').addEventListener('click', () => window.__next++);</script></body>`,
  '/watch-long': () => watchPage({ src: '/long.wav' }),
  '/watch-novideo': () => watchPage({ video: false }),
  '/watch-lateplayer': () => `<!doctype html><body><script>
    setTimeout(() => {
      const p = document.createElement('div');
      p.id = 'movie_player';
      p.className = 'ad-showing';
      p.innerHTML = '<video class="html5-main-video" src="/clip.wav" preload="auto"></video>';
      document.body.appendChild(p);
    }, 1200);</script></body>`,
  '/watch-other': () => watchPage({ channel: '@other' }),
  '/watch-late': () => watchPage({ channelDelay: 900 }),
  '/watch-late-other': () => watchPage({ channel: '@other', channelDelay: 900 }),
};
const load = await mockYouTube(t.ctx, (url) => (pages[url.pathname] || (() => watchPage()))());

/** Start each section from clean settings and a fresh page. */
async function fresh(url = WATCH, opts) {
  await t.clearStorage();
  return openPage(t.ctx, url, opts);
}

/* =============== 1. Core ad handling =============== */
let page = await fresh();
check('content script active (html[data-ytps=on])', (await page.evaluate(() => document.documentElement.getAttribute('data-ytps'))) === 'on');
check('masthead ad hidden by CSS', (await display(page, '#masthead-ad')) === 'none');
check('overlay container hidden by CSS', (await display(page, '.ytp-ad-overlay-container')) === 'none');
check('#movie_player is NOT hidden', (await display(page, '#movie_player')) !== 'none');

await page.evaluate(() => { const v = document.querySelector('video'); v.muted = false; v.playbackRate = 1.5; v.pause(); });
await adOn(page);
await sleep(700);
let v = await videoState(page);
check('ad: video muted', v.muted === true, JSON.stringify(v));
check('ad: playbackRate = 16', v.rate === 16);
check('ad: jumped to the end of the ad', v.d - v.t < 0.5, `t=${v.t} d=${v.d}`);

await page.evaluate(() => {
  window.__skip = 0;
  const b = document.createElement('button');
  b.className = 'ytp-ad-skip-button-modern';
  b.addEventListener('click', () => window.__skip++);
  document.getElementById('movie_player').appendChild(b);
});
await sleep(600);
check('skip button auto-clicked', (await page.evaluate(() => window.__skip)) >= 1);

await adOff(page);
await sleep(600);
v = await videoState(page);
check('after ad: mute restored', v.muted === false, JSON.stringify(v));
check('after ad: playbackRate restored (1.5)', v.rate === 1.5);

await page.evaluate(() => {
  window.__close = 0;
  const b = document.createElement('button');
  b.className = 'ytp-ad-overlay-close-button';
  b.addEventListener('click', () => window.__close++);
  document.getElementById('movie_player').appendChild(b);
});
await sleep(700);
check('overlay close button auto-clicked (no ad-showing needed)', (await page.evaluate(() => window.__close)) >= 1);

/* =============== 2. Long video is never seeked =============== */
page = await fresh('https://www.youtube.com/watch-long');
await adOn(page);
await sleep(700);
v = await videoState(page);
check('400s "ad" is sped up but NOT seeked', v.rate === 16 && v.t < 20, JSON.stringify(v));

/* =============== 3. SPA navigation replaces the player =============== */
page = await fresh();
await page.evaluate(() => {
  document.getElementById('movie_player').remove();
  const p = document.createElement('div');
  p.id = 'movie_player';
  p.innerHTML = '<video class="html5-main-video" src="/clip.wav"></video>';
  document.body.appendChild(p);
  window.dispatchEvent(new Event('yt-navigate-finish'));
  p.classList.add('ad-interrupting');
});
await page.waitForFunction(() => document.querySelector('video').readyState >= 1);
await sleep(700);
v = await videoState(page);
check('SPA: replaced player is re-attached and ad handled', v.muted && v.rate === 16, JSON.stringify(v));

/* =============== 4. Master switch =============== */
page = await fresh();
await t.setStorage({ enabled: false });
await sleep(500);
check('disabled: data-ytps removed', (await page.evaluate(() => document.documentElement.getAttribute('data-ytps'))) === null);
check('disabled: masthead ad visible again', (await display(page, '#masthead-ad')) !== 'none');
await adOn(page);
await sleep(600);
check('disabled: ads are not touched', (await videoState(page)).rate !== 16);
await t.setStorage({ enabled: true });
await sleep(600);
check('re-enabled: ad handled again', (await videoState(page)).rate === 16);

/* =============== 5. Per-feature switches =============== */
page = await fresh();
await t.setStorage({ features: { video: false, overlay: true, cosmetic: true } });
await sleep(400);
await adOn(page);
await sleep(600);
v = await videoState(page);
check('video feature off: ad left alone', !v.muted && v.rate !== 16, JSON.stringify(v));

page = await fresh();
await t.setStorage({ features: { video: true, overlay: false, cosmetic: true } });
await sleep(400);
check('overlay feature off: overlay container visible', (await display(page, '.ytp-ad-overlay-container')) !== 'none');
await page.evaluate(() => {
  window.__close = 0;
  const b = document.createElement('button');
  b.className = 'ytp-ad-overlay-close-button';
  b.addEventListener('click', () => window.__close++);
  document.getElementById('movie_player').appendChild(b);
});
await sleep(700);
check('overlay feature off: close button NOT clicked', (await page.evaluate(() => window.__close)) === 0);
check('overlay feature off: masthead still hidden', (await display(page, '#masthead-ad')) === 'none');

page = await fresh();
await t.setStorage({ features: { video: true, overlay: true, cosmetic: false } });
await sleep(400);
check('cosmetic feature off: masthead visible', (await display(page, '#masthead-ad')) !== 'none');
check('cosmetic feature off: overlay container still hidden', (await display(page, '.ytp-ad-overlay-container')) === 'none');

/* =============== 6. Channel allowlist =============== */
page = await fresh();
await t.setStorage({ allowlist: ['@creator'] });
await sleep(500);
await adOn(page);
await sleep(700);
v = await videoState(page);
check('allowlisted channel: ad left alone', !v.muted && v.rate !== 16, JSON.stringify(v));
await t.setStorage({ allowlist: [] });
await sleep(700);
check('allowlist removed: ad handled again', (await videoState(page)).rate === 16);

/* =============== 7. Feed ads (CSS) =============== */
page = await fresh('https://www.youtube.com/', { video: false });
check('feed: whole ad grid cell hidden', (await display(page, '#adItem')) === 'none');
check('feed: normal item visible', (await display(page, '#normalItem')) !== 'none');

/* =============== 8. Shorts ads =============== */
page = await fresh('https://www.youtube.com/shorts/abc', { video: false });
await sleep(800);
check('shorts: ad reel is advanced (next clicked once)', (await page.evaluate(() => window.__next)) === 1);
check('shorts: skipped ad is counted', (await t.storage('stats')).stats?.total === 1, JSON.stringify((await t.storage('stats')).stats));
page = await fresh('https://www.youtube.com/shorts/normal', { video: false });
await sleep(800);
check('shorts: normal reel is left alone', (await page.evaluate(() => window.__next)) === 0);
check('shorts: normal reel is not counted', !(await t.storage('stats')).stats?.total);

/* =============== 9. Time saved =============== */
page = await fresh();
await sleep(500);
await adOn(page);
await sleep(700);
await adOff(page);
await sleep(700);
const stats = (await t.storage('stats')).stats;
check('stats: one ad counted', stats?.total === 1, JSON.stringify(stats));
check('stats: time saved ~ ad length (6s)', stats?.savedSeconds >= 5.5 && stats?.savedSeconds <= 6.5, `savedSeconds=${stats?.savedSeconds}`);

/* =============== 10. Compatibility mode (anti-adblock fallback) =============== */
await t.clearStorage();
page = await openPage(t.ctx, WATCH);
const loadsAfterOpen = load.pageLoads;
check('compat: off before the dialog appears', !(await t.storage('compat')).compat);
await page.evaluate(() => document.body.appendChild(document.createElement('ytd-enforcement-message-view-model')));
await sleep(2500);
check('compat: mode switched on', (await t.storage('compat')).compat === true);
const sets = await t.rulesets();
check('compat: strict ruleset off, core on', !sets.includes('yt_strict_rules') && sets.includes('yt_core_rules'), JSON.stringify(sets));
check('compat: page reloaded exactly once', load.pageLoads === loadsAfterOpen + 1, `loads ${loadsAfterOpen} -> ${load.pageLoads}`);

// Dialog shows again even in compat mode: record it, but do not reload in a loop.
await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
const loadsBeforePersist = load.pageLoads;
await page.evaluate(() => document.body.appendChild(document.createElement('ytd-enforcement-message-view-model')));
await sleep(2500);
check('compat: persistent dialog recorded as health issue', (await t.storage('health')).health?.code === 'enforcement-persists', JSON.stringify((await t.storage('health')).health));
check('compat: no reload loop', load.pageLoads === loadsBeforePersist, `loads ${loadsBeforePersist} -> ${load.pageLoads}`);

// A successfully skipped ad must NOT hide the persistent-warning notice...
await adOn(page); await sleep(700); await adOff(page); await sleep(700);
check('health: finished ad keeps the "warning persists" notice', (await t.storage('health')).health?.code === 'enforcement-persists');
// ...but it does clear a "selectors broke" notice.
await t.setStorage({ health: { code: 'no-video', at: Date.now() } });
await sleep(300);
await sleep(1200); await adOn(page); await sleep(700); await adOff(page); await sleep(700);
check('health: finished ad clears a "no-video" notice', (await t.storage('health')).health === null, JSON.stringify((await t.storage('health')).health));

// Text-based detection of the dialog (selector changed, wording the same).
await t.clearStorage();
page = await openPage(t.ctx, WATCH);
await page.evaluate(() => {
  const d = document.createElement('tp-yt-paper-dialog');
  d.textContent = 'Ad blockers are not allowed on YouTube';
  document.body.appendChild(d);
});
await sleep(2500);
check('compat: detects dialog by its text too', (await t.storage('compat')).compat === true);

// Language-independent detection: wording in other languages, and structure.
const enforcementCases = [
  ['Bengali wording', () => { const d = document.createElement('tp-yt-paper-dialog'); d.textContent = 'অ্যাড ব্লকার অনুমোদিত নয়'; document.body.appendChild(d); }],
  ['Hindi wording', () => { const d = document.createElement('tp-yt-paper-dialog'); d.textContent = 'विज्ञापन अवरोधकों की अनुमति नहीं है'; document.body.appendChild(d); }],
  ['Spanish wording', () => { const d = document.createElement('tp-yt-paper-dialog'); d.textContent = 'Los bloqueadores de anuncios no están permitidos'; document.body.appendChild(d); }],
  ['structure (no text at all)', () => { const d = document.createElement('tp-yt-paper-dialog'); d.innerHTML = '<div class="enforcement-message-x"></div>'; document.body.appendChild(d); }],
];
for (const [label, make] of enforcementCases) {
  await t.clearStorage();
  await sleep(300);
  page = await openPage(t.ctx, WATCH);
  await page.evaluate(make);
  await sleep(2500);
  check(`compat: dialog detected by ${label}`, (await t.storage('compat')).compat === true);
}
// A harmless dialog must not trigger it.
await t.clearStorage();
await sleep(300);
page = await openPage(t.ctx, WATCH);
await page.evaluate(() => { const d = document.createElement('tp-yt-paper-dialog'); d.textContent = 'Save to Watch later?'; document.body.appendChild(d); });
await sleep(2500);
check('compat: unrelated dialog does not trigger it', !(await t.storage('compat')).compat);

/* =============== 10b. Compatibility mode is retried automatically =============== */
const DAY = 24 * 3600 * 1000;
await t.clearStorage();
await t.setStorage({ compat: true, compatAt: Date.now() });
check('retry: a recent compat mode is kept', (await t.sw.evaluate(() => maybeRetryStrict())) === false && (await t.storage('compat')).compat === true);

await t.setStorage({ compat: true, compatAt: Date.now() - 8 * DAY });
check('retry: compat older than 7 days is lifted', (await t.sw.evaluate(() => maybeRetryStrict())) === true);
await sleep(400);
check('retry: strict ruleset is back and the state is cleared',
  (await t.rulesets()).includes('yt_strict_rules') && (await t.storage('compat')).compat === false && !(await t.storage('compatAt')).compatAt);

await t.setStorage({ compat: true, compatAt: Date.now() });
check('retry: forced retry (extension update) lifts even a recent compat mode', (await t.sw.evaluate(() => maybeRetryStrict({ force: true }))) === true);
await sleep(400);
check('retry: forced retry re-enabled strict rules', (await t.rulesets()).includes('yt_strict_rules'));

// Triggered by normal traffic: an old compat mode disappears when a tab reports an ad.
await t.setStorage({ compat: true, compatAt: Date.now() - 9 * DAY });
await t.sw.evaluate(() => { lastRetryCheck = 0; });
page = await openPage(t.ctx, WATCH);
await adOn(page);
await sleep(1500);
check('retry: happens by itself when the worker sees activity', (await t.storage('compat')).compat === false);

// ...and if YouTube still complains, compat mode simply comes back.
await page.evaluate(() => document.body.appendChild(document.createElement('ytd-enforcement-message-view-model')));
await sleep(2500);
check('retry: dialog still shown -> compat mode switches on again', (await t.storage('compat')).compat === true && !!(await t.storage('compatAt')).compatAt);

/* =============== 11. Health report when selectors stop working =============== */
page = await fresh('https://www.youtube.com/watch-novideo', { video: false });
await adOn(page);
await sleep(11500);
check('health: "no-video" reported after 10s of ad state with no <video>', (await t.storage('health')).health?.code === 'no-video', JSON.stringify((await t.storage('health')).health));

/* =============== 11b. Overlay alone never touches the media =============== */
page = await fresh();
await page.evaluate(() => {
  const o = document.createElement('div');
  o.className = 'ytp-ad-player-overlay';
  document.getElementById('movie_player').appendChild(o);
  const v = document.querySelector('video'); v.muted = false; v.playbackRate = 1;
});
await sleep(900);
v = await videoState(page);
check('overlay only (no ad-showing): not muted, not sped up, not seeked', !v.muted && v.rate === 1 && v.t < 1, JSON.stringify(v));
await adOn(page);
await sleep(700);
check('overlay + ad-showing: media handled normally', (await videoState(page)).rate === 16);

/* =============== 11c. Recycled elements are handled again =============== */
// Shorts: the same reel element turns into a normal reel and then into an ad again.
page = await fresh('https://www.youtube.com/shorts/abc', { video: false });
await sleep(800);
check('recycle: first ad reel skipped', (await page.evaluate(() => window.__next)) === 1);
await page.evaluate(() => { document.querySelector('ytd-ad-slot-renderer').remove(); });
await sleep(700);
await page.evaluate(() => { document.getElementById('reel').appendChild(document.createElement('ytd-ad-slot-renderer')); });
await sleep(1300);
check('recycle: same reel element showing a NEW ad is skipped again', (await page.evaluate(() => window.__next)) === 2, `next=${await page.evaluate(() => window.__next)}`);

// Shorts: another reel becomes active in between, then the old element comes back as an ad.
page = await fresh('https://www.youtube.com/shorts/abc', { video: false });
await sleep(800);
await page.evaluate(() => {
  const r2 = document.createElement('ytd-reel-video-renderer');
  r2.id = 'reel2'; r2.textContent = 'normal';
  document.body.appendChild(r2);
  document.getElementById('reel').removeAttribute('is-active');
  r2.setAttribute('is-active', '');
});
await sleep(700);
await page.evaluate(() => {
  document.getElementById('reel2').removeAttribute('is-active');
  document.getElementById('reel').setAttribute('is-active', '');
});
await sleep(1300);
check('recycle: old reel element active again with an ad is skipped again', (await page.evaluate(() => window.__next)) === 2, `next=${await page.evaluate(() => window.__next)}`);

// Overlay close button: the same element removed and re-inserted counts as a new ad.
await t.clearStorage();
page = await openPage(t.ctx, WATCH);
await page.evaluate(() => {
  const b = document.createElement('button');
  b.className = 'ytp-ad-overlay-close-button';
  window.__btn = b;
  document.getElementById('movie_player').appendChild(b);
});
await sleep(900);
check('recycle: overlay ad counted once', (await t.storage('stats')).stats?.total === 1);
await page.evaluate(() => window.__btn.remove());
await sleep(1300);
await page.evaluate(() => document.getElementById('movie_player').appendChild(window.__btn));
await sleep(900);
check('recycle: re-inserted overlay button counted again', (await t.storage('stats')).stats?.total === 2, JSON.stringify((await t.storage('stats')).stats));

/* =============== 11d. Allowlist: per-tab network bypass =============== */
const outcomeFor = (url, tabId) =>
  t.sw.evaluate(
    async (a) => (await chrome.declarativeNetRequest.testMatchOutcome(a)).matchedRules,
    { url, initiator: 'https://www.youtube.com', type: 'xmlhttprequest', tabId }
  );
const tabIdOf = (pattern) =>
  t.sw.evaluate(async (p) => (await chrome.tabs.query({ url: p }))[0]?.id ?? -1, pattern);
const sessionRules = () => t.sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
const AD_URL = 'https://www.youtube.com/pagead/adview';

await t.clearStorage();
page = await openPage(t.ctx, 'https://www.youtube.com/watch?v=bypass');
const bypassTab = await tabIdOf('https://www.youtube.com/watch?v=bypass*');
let outcome = await outcomeFor(AD_URL, bypassTab);
check('bypass: ads are blocked on a normal tab', outcome.length > 0 && outcome[0].rulesetId !== '_session', JSON.stringify(outcome));

await t.setStorage({ allowlist: ['@creator'] });
await sleep(1500);
const rules = await sessionRules();
check('bypass: allowlisted channel creates ONE session allow rule for that tab only',
  rules.some((r) => r.action.type === 'allow' && r.condition.tabIds?.length === 1 && r.condition.tabIds[0] === bypassTab), JSON.stringify(rules));
outcome = await outcomeFor(AD_URL, bypassTab);
check('bypass: ad request from that tab is allowed', outcome.length > 0 && outcome[0].rulesetId === '_session', JSON.stringify(outcome));
outcome = await outcomeFor(AD_URL, bypassTab + 9999);
check('bypass: the same request from another tab is still blocked', outcome.length > 0 && outcome[0].rulesetId !== '_session', JSON.stringify(outcome));

await t.setStorage({ allowlist: [] });
await sleep(1500);
outcome = await outcomeFor(AD_URL, bypassTab);
check('bypass: removing the channel removes the rule', outcome.length > 0 && outcome[0].rulesetId !== '_session' && !(await sessionRules()).some((r) => r.condition.tabIds?.includes(bypassTab)));

await t.setStorage({ allowlist: ['@creator'] });
await sleep(1500);
check('bypass: rule is back after re-allowing', (await sessionRules()).some((r) => r.condition.tabIds?.includes(bypassTab)));
await t.setStorage({ enabled: false });
await sleep(1500);
check('bypass: pausing the extension clears the rules', (await sessionRules()).length === 0, JSON.stringify(await sessionRules()));
await t.setStorage({ enabled: true });
await sleep(1500);
check('bypass: resuming restores the rule', (await sessionRules()).some((r) => r.condition.tabIds?.includes(bypassTab)));
await page.close();
await sleep(800);
check('bypass: closing the tab removes its rule', !(await sessionRules()).some((r) => r.condition.tabIds?.includes(bypassTab)));

// A channel that is NOT on the allowlist never gets a rule.
await t.clearStorage();
await t.setStorage({ allowlist: ['@creator'] });
page = await openPage(t.ctx, 'https://www.youtube.com/watch-other?v=nobypass');
await sleep(1500);
const otherTab = await tabIdOf('https://www.youtube.com/watch-other*');
check('bypass: non-allowed channel gets no rule', !(await sessionRules()).some((r) => r.condition.tabIds?.includes(otherTab)));
outcome = await outcomeFor(AD_URL, otherTab);
check('bypass: non-allowed channel is still blocked', outcome.length > 0 && outcome[0].rulesetId !== '_session');
await page.close();

/* =============== 11e. Pre-roll waits for the channel link =============== */
await t.clearStorage();
await t.setStorage({ allowlist: ['@creator'] });
page = await openPage(t.ctx, 'https://www.youtube.com/watch-late');
await adOn(page);
await sleep(200);
check('pre-roll: held back while the channel link is not rendered yet', (await videoState(page)).rate !== 16);
await sleep(2000);
v = await videoState(page);
check('pre-roll: allowed channel (link rendered late): ad stays untouched', !v.muted && v.rate !== 16, JSON.stringify(v));

page = await openPage(t.ctx, 'https://www.youtube.com/watch-late-other');
await adOn(page);
await sleep(200);
check('pre-roll (other channel): also held back at first', (await videoState(page)).rate !== 16);
await sleep(2000);
check('pre-roll (other channel): handled once the link shows it is not allowed', (await videoState(page)).rate === 16);

// No allowlist at all: no waiting.
await t.clearStorage();
page = await openPage(t.ctx, 'https://www.youtube.com/watch-late');
await adOn(page);
await sleep(700);
check('pre-roll: with an empty allowlist ads are handled immediately', (await videoState(page)).rate === 16);

/* =============== 11f. Performance & polish =============== */
/** Number of ticks the content script has run (counter lives in its isolated world). */
async function tickCount(pg) {
  const cdp = await t.ctx.newCDPSession(pg);
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  await cdp.send('Runtime.enable');
  const ctx = contexts.find((c) => c.name === 'YT PureStream');
  if (!ctx) return -1;
  const r = await cdp.send('Runtime.evaluate', { expression: 'window.__ytpsTicks', contextId: ctx.id, returnByValue: true });
  await cdp.detach();
  return r.result.value;
}

// A player that shows up late (after document_start) is still found quickly.
await t.clearStorage();
page = await openPage(t.ctx, 'https://www.youtube.com/watch-lateplayer', { video: false });
await sleep(800);
check('late player: not there yet, nothing happens', await page.evaluate(() => !document.getElementById('movie_player')));
await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
await sleep(600);
v = await videoState(page);
check('late player: found without a page-wide observer, ad handled', v.muted && v.rate === 16, JSON.stringify(v));

// Without a player there is no work: ticks stay at the interval rate even if the page mutates a lot.
await t.clearStorage();
page = await openPage(t.ctx, 'https://www.youtube.com/', { video: false });
await sleep(9000);                                  // fast player poll window is over
const idleBefore = await tickCount(page);
await page.evaluate(() => new Promise((res) => {
  let n = 0;
  const id = setInterval(() => {
    document.body.appendChild(document.createElement('div'));
    if (++n >= 400) { clearInterval(id); res(); }
  }, 5);
}));
const idleAfter = await tickCount(page);
check('no player: 400 DOM mutations cause (almost) no ticks', idleBefore > 0 && idleAfter - idleBefore <= 8, `ticks ${idleBefore} -> ${idleAfter}`);

// With a player: constant churn inside it is rate limited.
page = await fresh();
await sleep(500);
const busyBefore = await tickCount(page);
await page.evaluate(() => new Promise((res) => {
  const player = document.getElementById('movie_player');
  let n = 0;
  const id = setInterval(() => {
    player.appendChild(document.createElement('span'));
    if (++n >= 400) { clearInterval(id); res(); }
  }, 5);
}));
const busyAfter = await tickCount(page);
check('player churn: ticks are rate limited', busyBefore > 0 && busyAfter - busyBefore <= 50, `ticks ${busyBefore} -> ${busyAfter}`);

// No flash of the "on" state for a user who paused the extension.
await t.clearStorage();
await t.setStorage({ enabled: false });
page = await t.ctx.newPage();
await page.addInitScript(() => {
  window.__sawAttr = false;
  new MutationObserver(() => {
    if (document.documentElement.hasAttribute('data-ytps')) window.__sawAttr = true;
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-ytps'] });
});
await page.goto(WATCH);
await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
await sleep(800);
check('paused: html[data-ytps] never appears (no flash)', (await page.evaluate(() => window.__sawAttr)) === false);
await t.setStorage({ enabled: true });

// pagehide puts mute state and speed back.
page = await fresh();
await page.evaluate(() => { const v = document.querySelector('video'); v.muted = false; v.playbackRate = 1.25; });
await adOn(page);
await sleep(700);
check('pagehide setup: ad handled', (await videoState(page)).rate === 16);
v = await page.evaluate(() => {
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  const el = document.querySelector('video');
  return { muted: el.muted, rate: el.playbackRate };
});
check('pagehide: mute state and speed restored immediately', v.muted === false && v.rate === 1.25, JSON.stringify(v));

/* =============== 12. Orphaned script (extension reloaded / disabled while tab open) =============== */
// Keep this last: it unloads the extension. The tab keeps its old content script,
// which must notice and stop instead of skipping ads forever.
page = await fresh();
await page.evaluate(() => { const v = document.querySelector('video'); v.muted = false; v.playbackRate = 1.25; });
await adOn(page);
await sleep(700);
check('orphan setup: ad handled while extension is alive', (await videoState(page)).rate === 16);
await t.sw.evaluate(() => chrome.runtime.reload()).catch(() => {});
await sleep(3000);
check('orphan: extension is really gone', t.ctx.serviceWorkers().length === 0);
check('orphan: script stops (data-ytps removed)', (await page.evaluate(() => document.documentElement.getAttribute('data-ytps'))) === null);
check('orphan: masthead ad visible again', (await display(page, '#masthead-ad')) !== 'none');
v = await videoState(page);
check('orphan: mute and speed restored', v.muted === false && v.rate === 1.25, JSON.stringify(v));
await adOff(page);
await adOn(page);
await sleep(900);
check('orphan: new ads are no longer touched', (await videoState(page)).rate !== 16);

await t.close();
process.exit(finish() ? 0 : 1);
