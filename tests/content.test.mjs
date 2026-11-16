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
let stats = (await t.storage('stats')).stats;
check('stats: one ad counted', stats?.total === 1, JSON.stringify(stats));
check('stats: time saved ~ ad length (6s)', stats?.savedSeconds >= 5.5 && stats?.savedSeconds <= 6.5, `savedSeconds=${stats?.savedSeconds}`);

/* =============== 10. Compatibility mode (anti-adblock fallback) =============== */
await t.clearStorage();
const before = load.pageLoads;
page = await openPage(t.ctx, WATCH);
const loadsAfterOpen = load.pageLoads;
check('compat: off before the dialog appears', !(await t.storage('compat')).compat);
await page.evaluate(() => document.body.appendChild(document.createElement('ytd-enforcement-message-view-model')));
await sleep(2500);
check('compat: mode switched on', (await t.storage('compat')).compat === true);
let sets = await t.rulesets();
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

/* =============== 11. Health report when selectors stop working =============== */
page = await fresh('https://www.youtube.com/watch-novideo', { video: false });
await adOn(page);
await sleep(11500);
check('health: "no-video" reported after 10s of ad state with no <video>', (await t.storage('health')).health?.code === 'no-video', JSON.stringify((await t.storage('health')).health));

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
