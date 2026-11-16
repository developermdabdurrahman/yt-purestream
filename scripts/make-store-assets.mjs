/**
 * Generates Chrome Web Store / Edge Add-ons images into store/:
 *   screenshot-1-main.png        1280x800   popup with counters
 *   screenshot-2-settings.png    1280x800   per-feature switches + allowlist
 *   screenshot-3-bengali.png     1280x800   Bengali interface
 *   promo-small-440x280.png      440x280    small promo tile
 *
 * It loads the real extension, fills the counters with sample numbers, takes a
 * high-resolution screenshot of the real popup and lays it out on a branded
 * background. Usage: npm run store-assets   (needs `npm run install:browser`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, ROOT, sleep } from '../tests/helpers.mjs';

const outDir = path.join(ROOT, 'store');
fs.mkdirSync(outDir, { recursive: true });

const t = await launch();
const day = new Date();
const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

// Sample data (clearly fictional channel names).
await t.setStorage({
  enabled: true,
  stats: { total: 1284, today: 23, day: dayKey, savedSeconds: 21480 },
  allowlist: ['@creator-one', '@science-hub'],
  lang: 'en',
});

/** Screenshot of the real popup at 2x resolution, returned as a data URL. */
async function popupShot({ lang = 'en', openSettings = false } = {}) {
  await t.setStorage({ lang });
  const page = await t.ctx.newPage();
  const cdp = await t.ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 280, height: 700, deviceScaleFactor: 2, mobile: false,
  });
  await page.goto(`chrome-extension://${t.extId}/popup.html`);
  await sleep(1200);                      // let the counter animation finish
  if (openSettings) {
    await page.evaluate(() => { document.getElementById('settings').open = true; });
    await sleep(200);
  }
  const buf = await page.locator('body').screenshot();
  await page.close();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const iconData = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'icons/icon128.png')).toString('base64')}`;

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; overflow: hidden; }
  body {
    background-repeat: no-repeat;
    font-family: -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif;
    color: #fff; background: radial-gradient(1200px 700px at 15% 10%, #3a1414 0%, #121212 60%);
  }
  .red { color: #ff4e45; }
  .green { color: #3ddc84; }`;

async function compose({ file, headline, sub, shot }) {
  const page = await t.ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<style>${BASE_CSS}
    .wrap { width: 1280px; height: 800px; display: flex; align-items: center; justify-content: space-between; padding: 0 110px 0 100px; }
    .text { max-width: 600px; }
    .brand { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 700; margin-bottom: 34px; }
    .brand img { width: 52px; height: 52px; }
    h1 { font-size: 58px; line-height: 1.12; letter-spacing: -1px; margin-bottom: 22px; }
    p { font-size: 24px; line-height: 1.45; color: #c9c9c9; }
    .shot { height: 640px; border-radius: 22px; box-shadow: 0 30px 80px rgba(0,0,0,.65), 0 0 0 1px #2c2c2c; }
  </style>
  <div class="wrap">
    <div class="text">
      <div class="brand"><img src="${iconData}"> <span>YT <span class="red">PureStream</span></span></div>
      <h1>${headline}</h1>
      <p>${sub}</p>
    </div>
    <img class="shot" src="${shot}">
  </div>`);
  await page.screenshot({ path: path.join(outDir, file) });
  await page.close();
  console.log('wrote store/' + file);
}

await compose({
  file: 'screenshot-1-main.png',
  headline: 'Skip YouTube ads<br><span class="green">automatically</span>',
  sub: 'Pre-roll, mid-roll and overlay ads are skipped in a blink. See how many ads were skipped and how much time you saved.',
  shot: await popupShot(),
});

await compose({
  file: 'screenshot-2-settings.png',
  headline: 'You stay in<br><span class="green">control</span>',
  sub: 'Choose what to skip, and allow ads on the creators you want to support. Works only on youtube.com.',
  shot: await popupShot({ openSettings: true }),
});

await compose({
  file: 'screenshot-3-bengali.png',
  headline: 'বাংলা ও ইংরেজি<br><span class="green">দুই ভাষাতেই</span>',
  sub: 'পপআপ থেকে এক ক্লিকে ভাষা বদলান। কোনো ডেটা সংগ্রহ নেই, শুধু ইউটিউবে কাজ করে।',
  shot: await popupShot({ lang: 'bn', openSettings: true }),
});

// Small promo tile 440x280. Rendered in a plain browser window: a window that
// is created with the extension has a minimum size larger than the tile.
{
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 440, height: 280 } });
  await page.setContent(`<style>${BASE_CSS}
    .tile { width: 440px; height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; }
    img { width: 84px; height: 84px; }
    h1 { font-size: 38px; letter-spacing: -0.5px; }
    p { font-size: 16px; color: #c9c9c9; }
  </style>
  <div class="tile">
    <img src="${iconData}">
    <h1>YT <span class="red">PureStream</span></h1>
    <p>Lightweight YouTube ad skipper</p>
  </div>`);
  await page.screenshot({ path: path.join(outDir, 'promo-small-440x280.png') });
  await browser.close();
  console.log('wrote store/promo-small-440x280.png');
}

await t.close();
