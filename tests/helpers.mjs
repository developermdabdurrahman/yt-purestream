/**
 * Shared helpers for the end-to-end tests.
 *
 * The tests load the real extension into Chromium (Playwright) and serve a
 * *mock* YouTube page on https://www.youtube.com/ via request interception, so
 * the content script runs exactly as it would on the real site, without
 * needing real ads. Run `npm run install:browser` once to fetch Chromium.
 */
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ----------------------------- Assertions ----------------------------- */

export function createChecker() {
  const results = [];
  return {
    check(name, ok, extra = '') {
      results.push(!!ok);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    },
    finish() {
      const failed = results.filter((r) => !r).length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      return failed === 0;
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- Browser ----------------------------- */

/** Launch Chromium with the extension loaded from `extDir`. */
export async function launch(extDir = ROOT) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytps-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;

  return {
    ctx,
    sw,
    extId,
    storage: (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys ?? null),
    setStorage: (obj) => sw.evaluate((o) => chrome.storage.local.set(o), obj),
    clearStorage: () => sw.evaluate(() => chrome.storage.local.clear()),
    rulesets: () => sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets()),
    async close() {
      await ctx.close();
      fs.rmSync(userDir, { recursive: true, force: true });
    },
  };
}

/** Copy the extension (runtime files only) to a temp dir, e.g. to patch config. */
export function copyExtension() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ytps-ext-'));
  const skip = new Set(['node_modules', 'tests', 'scripts', 'dist', 'store', '.git', '.github', '_metadata']);
  fs.cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => !skip.has(path.basename(src)),
  });
  return dest;
}

/* ----------------------------- Mock YouTube ----------------------------- */

/** WAV file of the given length, so a <video> gets a real, finite duration. */
export function wav(seconds) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n, 40);
  buf.fill(128, 44);
  return buf;
}

const CLIPS = { 'clip.wav': wav(6), 'long.wav': wav(400) };

/** A minimal watch page: owner link, player + video, a masthead ad, overlay ad. */
export function watchPage({ channel = '@creator', src = '/clip.wav', video = true, channelDelay = 0 } = {}) {
  const owner = `<ytd-watch-metadata><ytd-video-owner-renderer><ytd-channel-name><a href="/${channel}">${channel}</a></ytd-channel-name></ytd-video-owner-renderer></ytd-watch-metadata>`;
  // channelDelay > 0: the owner link renders late, like on the real site.
  const ownerHtml = channelDelay
    ? `<div id="ownerSlot"></div><script>setTimeout(() => { document.getElementById('ownerSlot').innerHTML = ${JSON.stringify(owner)}; }, ${channelDelay});</script>`
    : owner;
  return `<!doctype html><html><body>
${ownerHtml}
<div id="movie_player">${video ? `<video class="html5-main-video" src="${src}" preload="auto"></video>` : ''}<div class="ytp-ad-overlay-container" style="height:20px">overlay</div></div>
<div id="masthead-ad" style="height:40px">AD</div>
</body></html>`;
}

/**
 * Serve https://www.youtube.com/**: *.wav files (with HTTP Range support so
 * seeking works) and otherwise whatever `getHtml(url)` returns.
 * Returns a counter object { pageLoads } for tests that watch for reloads.
 */
export async function mockYouTube(ctx, getHtml = () => watchPage()) {
  const stats = { pageLoads: 0 };
  await ctx.route('https://www.youtube.com/**', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const clip = CLIPS[url.pathname.slice(1)];

    if (clip) {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] || '');
      const headers = { 'Accept-Ranges': 'bytes' };
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : clip.length - 1;
        return route.fulfill({
          status: 206,
          contentType: 'audio/wav',
          headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${clip.length}` },
          body: clip.subarray(start, end + 1),
        });
      }
      return route.fulfill({ status: 200, contentType: 'audio/wav', headers, body: clip });
    }

    if (req.resourceType() === 'document') stats.pageLoads++;
    return route.fulfill({ status: 200, contentType: 'text/html', body: getHtml(url) });
  });
  return stats;
}

/** Open a mock page and wait until its <video> (if any) has metadata. */
export async function openPage(ctx, url, { video = true } = {}) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(url);
  if (video) await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
  await sleep(300);   // let the content script settle
  return page;
}

export const adOn = (page) =>
  page.evaluate(() => document.getElementById('movie_player').classList.add('ad-showing'));
export const adOff = (page) =>
  page.evaluate(() => document.getElementById('movie_player').classList.remove('ad-showing'));
export const videoState = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('video');
    return { muted: v.muted, rate: v.playbackRate, t: v.currentTime, d: v.duration };
  });
export const display = (page, selector) =>
  page.evaluate((s) => getComputedStyle(document.querySelector(s)).display, selector);
