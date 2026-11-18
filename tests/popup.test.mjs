/** Popup UI, counters, badge, notices, settings, language and allowlist. */
import fs from 'node:fs';
import {
  createChecker, launch, mockYouTube, openPage, adOn, adOff, sleep, copyExtension,
} from './helpers.mjs';

const { check, finish } = createChecker();
const t = await launch();
await mockYouTube(t.ctx);

const popupUrl = (query = '') => `chrome-extension://${t.extId}/popup.html${query}`;
const text = (p, sel) => p.textContent(sel);
const badge = () => t.sw.evaluate(() => chrome.action.getBadgeText({}));
const stats = async () => (await t.storage('stats')).stats;

async function openPopup(query = '') {
  const p = await t.ctx.newPage();
  await p.setViewportSize({ width: 280, height: 560 });
  await p.goto(popupUrl(query));
  await sleep(900);
  return p;
}

/* =============== Counting =============== */
const tab1 = await openPage(t.ctx, 'https://www.youtube.com/watch?v=a');
const tab2 = await openPage(t.ctx, 'https://www.youtube.com/watch?v=b');

for (let i = 0; i < 3; i++) { await adOn(tab1); await sleep(500); await adOff(tab1); await sleep(1200); }
let s = await stats();
check('3 ad breaks counted = 3', s?.total === 3, JSON.stringify(s));

await adOn(tab2); await sleep(100); await adOff(tab2); await sleep(100); await adOn(tab2); await sleep(400); await adOff(tab2);
await sleep(600);
check('flicker within 1s counted once (3 -> 4)', (await stats()).total === 4);

await sleep(1200);
await adOn(tab1); await sleep(2500); await adOff(tab1); await sleep(300);
check('one long ad counted once (4 -> 5)', (await stats()).total === 5);

await tab1.evaluate(() => {
  const b = document.createElement('button');
  b.className = 'ytp-ad-overlay-close-button';
  document.getElementById('movie_player').appendChild(b);
});
await sleep(1500);
s = await stats();
check('overlay ad counted once (5 -> 6)', s.total === 6, JSON.stringify(s));
check('today == total', s.today === 6);
check('badge shows 6', (await badge()) === '6', await badge());

await sleep(1200);
await Promise.all([adOn(tab1), adOn(tab2)]);
await sleep(700);
await Promise.all([adOff(tab1), adOff(tab2)]);
await sleep(300);
check('two tabs at once both counted (6 -> 8)', (await stats()).total === 8);

/* =============== Popup display =============== */
const popup = await openPopup();
check('popup: status Active', (await text(popup, '#status')) === 'Active');
check('popup: total = 8', (await text(popup, '#total')) === '8', await text(popup, '#total'));
check('popup: today = 8', (await text(popup, '#today')) === '8');
check('popup: all feature switches on by default', await popup.evaluate(() => ['fVideo', 'fOverlay', 'fCosmetic'].every((id) => document.getElementById(id).checked)));
check('popup: support link hidden when no URL configured', await popup.evaluate(() => document.getElementById('support').hidden));

await sleep(1200);
await adOn(tab1); await sleep(500); await adOff(tab1); await sleep(1200);
check('popup updates live (8 -> 9)', (await text(popup, '#total')) === '9', await text(popup, '#total'));

/* =============== Time saved formatting =============== */
const day = await popup.evaluate(() => YTPS.todayKey());
await t.setStorage({ stats: { total: 9, today: 9, day, savedSeconds: 45 } });
await sleep(900);
check('time saved: seconds', (await text(popup, '#saved')) === '45 sec', await text(popup, '#saved'));
await t.setStorage({ stats: { total: 9, today: 9, day, savedSeconds: 125 } });
await sleep(900);
check('time saved: minutes', (await text(popup, '#saved')) === '2 min', await text(popup, '#saved'));
await t.setStorage({ stats: { total: 9, today: 9, day, savedSeconds: 3725 } });
await sleep(900);
check('time saved: hours and minutes', (await text(popup, '#saved')) === '1 h 2 min', await text(popup, '#saved'));
await t.setStorage({ stats: { total: 9, today: 9, day, savedSeconds: 0 } });
await sleep(500);

/* =============== Pause =============== */
await popup.evaluate(() => document.getElementById('toggle').click());
await sleep(600);
check('pause: popup says Paused', (await text(popup, '#status')) === 'Paused');
check('pause: badge OFF', (await badge()) === 'OFF', await badge());
check('pause: no rulesets enabled', (await t.rulesets()).length === 0);
await sleep(1200);
await adOn(tab1); await sleep(700); await adOff(tab1); await sleep(300);
check('pause: nothing counted', (await stats()).total === 9);
await popup.evaluate(() => document.getElementById('toggle').click());
await sleep(600);
check('resume: rulesets back', (await t.rulesets()).length === 2);
check('resume: badge shows total', (await badge()) === '9', await badge());

/* =============== Reset (two-step) =============== */
await popup.click('#reset');
check('reset: first click asks "Sure?"', (await text(popup, '#reset')) === 'Sure?');
check('reset: first click does not reset', (await stats()).total === 9);
await popup.click('#reset');
await sleep(800);
s = await stats();
check('reset: second click zeroes counters', s.total === 0 && s.today === 0 && s.savedSeconds === 0, JSON.stringify(s));
check('reset: popup shows 0, badge cleared', (await text(popup, '#total')) === '0' && (await badge()) === '');

/* =============== Language =============== */
await t.setStorage({ stats: { total: 8, today: 8, day, savedSeconds: 125 } });
await sleep(600);
check('language: default is English', (await text(popup, '#lang')) === 'বাংলা');
await popup.click('#lang');
await sleep(700);
check('language: Bengali status', (await text(popup, '#status')) === 'চালু', await text(popup, '#status'));
check('language: Bengali digits', (await text(popup, '#total')) === '৮', await text(popup, '#total'));
check('language: Bengali duration', (await text(popup, '#saved')) === '২ মিনিট', await text(popup, '#saved'));
check('language: button now offers English', (await text(popup, '#lang')) === 'English');
check('language: choice is saved', (await t.storage('lang')).lang === 'bn');
const reopened = await openPopup();
check('language: persists when popup reopened', (await text(reopened, '#status')) === 'চালু');
await reopened.close();
await popup.click('#lang');
await sleep(600);
check('language: back to English', (await text(popup, '#status')) === 'Active');
check('manifest name resolved by chrome.i18n', (await t.sw.evaluate(() => chrome.i18n.getMessage('extName'))) === 'YT PureStream');

/* =============== Compatibility-mode notice =============== */
check('compat notice hidden by default', await popup.evaluate(() => document.getElementById('compat').hidden));
await t.setStorage({ compat: true });
await sleep(700);
check('compat notice shown when compat mode is on', await popup.evaluate(() => !document.getElementById('compat').hidden));
check('compat: strict ruleset is off', !(await t.rulesets()).includes('yt_strict_rules'));
await popup.click('#compatRetry');
await sleep(700);
check('compat retry: notice hidden, strict ruleset back', (await popup.evaluate(() => document.getElementById('compat').hidden)) && (await t.rulesets()).includes('yt_strict_rules'));

// The notice says since when compat mode is on and that it is retried.
const attr = (pg, sel, name) => pg.evaluate(([s, n]) => document.querySelector(s).getAttribute(n), [sel, name]);
check('compat since-line hidden without a date', await popup.evaluate(() => document.getElementById('compatSince').hidden));
await t.setStorage({ compat: true, compatAt: new Date('2026-03-05T12:00:00').getTime() });
await sleep(700);
const since = await text(popup, '#compatSince');
check('compat since-line shows the date and the retry rule', since.includes('2026') && since.includes('7 days'), since);
await t.setStorage({ compat: false, compatAt: null });
await sleep(600);
check('compat since-line hidden again', await popup.evaluate(() => document.getElementById('compatSince').hidden));

/* =============== Accessibility =============== */
check('a11y: main switch has an accessible name', (await attr(popup, '#toggle', 'aria-label')) === 'Enable / disable YT PureStream');
check('a11y: feature switches are labelled', (await attr(popup, '#fVideo', 'aria-label')) === 'Video ads (skip & speed up)' && (await attr(popup, '#fCosmetic', 'aria-label')) === 'Banners & feed clutter');
check('a11y: switches expose role=switch', (await attr(popup, '#toggle', 'role')) === 'switch');
check('a11y: language button is labelled', (await attr(popup, '#lang', 'aria-label')) === 'Switch language');
await popup.focus('#lang');
await popup.keyboard.press('Enter');
await sleep(600);
check('a11y: language can be switched with the keyboard', (await text(popup, '#status')) === 'চালু');
check('a11y: aria labels follow the language', (await attr(popup, '#toggle', 'aria-label')) !== 'Enable / disable YT PureStream');
await popup.keyboard.press('Enter');
await sleep(600);
check('a11y: and back again', (await text(popup, '#status')) === 'Active');

/* =============== Health notice =============== */
await t.setStorage({ health: { code: 'no-video', at: Date.now() } });
await sleep(600);
check('health notice shown', await popup.evaluate(() => !document.getElementById('health').hidden));
check('health notice text (selectors changed)', (await text(popup, '#healthBody')).includes('could not be handled'));
await t.setStorage({ health: { code: 'enforcement-persists', at: Date.now() } });
await sleep(600);
check('health notice text (warning persists)', (await text(popup, '#healthBody')).includes('still shows'));
await popup.click('#healthDismiss');
await sleep(500);
check('health dismissed', (await t.storage('health')).health === null && (await popup.evaluate(() => document.getElementById('health').hidden)));

/* =============== Feature switches persist =============== */
await popup.evaluate(() => document.getElementById('settings').open = true);
await popup.click('label:has(#fOverlay) .slider');
await sleep(400);
const f = (await t.storage('features')).features;
check('feature switch saved (overlay off)', f.overlay === false && f.video !== false, JSON.stringify(f));
const popup2 = await openPopup();
check('feature switch restored on reopen', await popup2.evaluate(() => !document.getElementById('fOverlay').checked && document.getElementById('fVideo').checked));
await popup2.close();

/* =============== Channel allowlist =============== */
const tabId = await t.sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.youtube.com/*' }))[0].id);
const withTab = await openPopup(`?tab=${tabId}`);
await withTab.evaluate(() => { document.getElementById('settings').open = true; });
check('allowlist: current channel detected', (await text(withTab, '#channelName')) === '@creator', await text(withTab, '#channelName'));
check('allowlist: empty message shown', await withTab.evaluate(() => !document.getElementById('allowEmpty').hidden));
await withTab.click('#channelToggle');
await sleep(500);
check('allowlist: channel added', JSON.stringify((await t.storage('allowlist')).allowlist) === '["@creator"]');
check('allowlist: listed with remove button', (await withTab.locator('#allowList li').count()) === 1);
await withTab.click('#allowList button');
await sleep(500);
check('allowlist: channel removed', (await t.storage('allowlist')).allowlist.length === 0);
const noTab = await openPopup();
check('allowlist: hint shown when not on a video', await noTab.evaluate(() => !document.getElementById('channelNone').hidden));
await withTab.close(); await noTab.close();

/* =============== Support link =============== */
await t.close();
const patched = copyExtension();
const common = patched + '/common.js';
fs.writeFileSync(common, fs.readFileSync(common, 'utf8').replace("SUPPORT_URL: ''", "SUPPORT_URL: 'https://ko-fi.com/example'"));
const t2 = await launch(patched);
const sp = await t2.ctx.newPage();
await sp.goto(`chrome-extension://${t2.extId}/popup.html`);
await sleep(700);
check('support link: visible when SUPPORT_URL is set', await sp.evaluate(() => !document.getElementById('support').hidden));
check('support link: points to the configured URL', (await sp.getAttribute('#support', 'href')) === 'https://ko-fi.com/example');
check('support link: opens safely in a new tab', (await sp.getAttribute('#support', 'rel')) === 'noopener noreferrer' && (await sp.getAttribute('#support', 'target')) === '_blank');
await t2.close();
fs.rmSync(patched, { recursive: true, force: true });

process.exit(finish() ? 0 : 1);
