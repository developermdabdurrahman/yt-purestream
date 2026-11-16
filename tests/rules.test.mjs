/** Network rulesets: what is blocked, what is not, and how the switches affect them. */
import { createChecker, launch, sleep } from './helpers.mjs';

const { check, finish } = createChecker();
const t = await launch();

const matches = (url, initiator, type = 'xmlhttprequest') =>
  t.sw.evaluate(
    async (a) => (await chrome.declarativeNetRequest.testMatchOutcome(a)).matchedRules.length,
    { url, initiator, type }
  );
const YT = 'https://www.youtube.com';

// --- default state ---
const sets = await t.rulesets();
check('core + strict rulesets enabled by default', sets.includes('yt_core_rules') && sets.includes('yt_strict_rules'), JSON.stringify(sets));

// --- what is blocked ---
check('blocks youtube.com/pagead/', (await matches(`${YT}/pagead/adview`, YT)) > 0);
check('blocks googleads.g.doubleclick.net (script)', (await matches('https://googleads.g.doubleclick.net/pagead/id', YT, 'script')) > 0);
check('blocks youtube.com/ptracking', (await matches(`${YT}/ptracking?x=1`, YT)) > 0);
check('blocks youtube.com/api/stats/ads', (await matches(`${YT}/api/stats/ads?x=1`, YT)) > 0);

// --- what must NOT be blocked ---
check('doubleclick from another site is untouched', (await matches('https://googleads.g.doubleclick.net/x', 'https://example.com', 'script')) === 0);
check('base.js is untouched', (await matches(`${YT}/s/player/abc/player_ias.vflset/en_US/base.js`, YT, 'script')) === 0);
check('videoplayback is untouched', (await matches('https://rr1.googlevideo.com/videoplayback?x=1', YT, 'media')) === 0);
check('youtubei player API is untouched', (await matches(`${YT}/youtubei/v1/player`, YT)) === 0);
check('thumbnails are untouched', (await matches('https://i.ytimg.com/vi/x/hq.jpg', YT, 'image')) === 0);
check('main_frame navigation is never blocked', (await matches(`${YT}/pagead/x`, YT, 'main_frame')) === 0);

// --- compatibility mode: strict ruleset off, core stays on ---
await t.setStorage({ compat: true });
await sleep(500);
let s = await t.rulesets();
check('compat: strict ruleset disabled', !s.includes('yt_strict_rules'), JSON.stringify(s));
check('compat: core ruleset still enabled', s.includes('yt_core_rules'));
check('compat: ptracking no longer blocked', (await matches(`${YT}/ptracking?x=1`, YT)) === 0);
check('compat: pagead still blocked', (await matches(`${YT}/pagead/adview`, YT)) > 0);

// --- paused: everything off ---
await t.setStorage({ enabled: false });
await sleep(500);
s = await t.rulesets();
check('paused: no rulesets enabled', s.length === 0, JSON.stringify(s));

// --- back to normal ---
await t.setStorage({ enabled: true, compat: false });
await sleep(500);
s = await t.rulesets();
check('resumed: both rulesets back', s.includes('yt_core_rules') && s.includes('yt_strict_rules'), JSON.stringify(s));

await t.close();
process.exit(finish() ? 0 : 1);
