# Changelog

All notable changes to YT PureStream. Versions follow [Semantic Versioning](https://semver.org/).

## 1.2.1

### Fixed
- **Ads were still skipped after pausing (or after reloading/updating/disabling the extension) in tabs that were already open.** Chrome leaves the old content script running in such tabs, cut off from the popup's switch. The script now detects that the extension is gone, stops itself, restores the player's mute state and speed, and un-hides page elements. Reload the YouTube tab once to get the fixed script.
- A successfully skipped ad no longer clears the "YouTube still shows its ad blocker warning" notice; it only clears "selectors broke" notices.

### Changed
- `manifest.json`: added `homepage_url` and `minimum_chrome_version` (105, needed for the `:has()` CSS rules).
- README now has a full Bengali usage guide above the English documentation.

## 1.2.0

### Reliability
- **Compatibility mode:** if YouTube shows its "Ad blockers are not allowed" dialog, the extension switches off the strict (tracking) rules, reloads the page once, and shows a notice in the popup with a "Try strict mode again" button.
- Network rules are now split into two rulesets: `core` (`pagead`, `doubleclick`) and `strict` (`ptracking`, `api/stats/ads`).
- **Health reports:** if an ad is detected but cannot be handled (no `<video>` for 10 s, or the same ad state for 150 s), the popup tells the user YouTube may have changed.
- Shorts: an ad reel is detected and skipped automatically (best effort).
- Feed ads: the whole grid cell around an ad is hidden, so no empty gap is left.

### Features
- **Time saved** shown in the popup (estimated from the length of skipped ads).
- **Per-feature switches:** video ads, overlay ads, banners and feed clutter.
- **Channel allowlist ("Support creators"):** page-level ad skipping is paused on allowed channels.
- **Bengali / English** interface with an in-popup language switch.
- Optional "Support this project" link (set `SUPPORT_URL` in `common.js`).

### Project
- Automated end-to-end tests (`npm test`) that load the extension in Chromium against a mock YouTube page.
- GitHub Actions: tests on every push, and tagged releases build and attach the ZIP automatically.
- `npm run build` creates a clean store-ready ZIP in `dist/`.
- Added `LICENSE` (MIT), `PRIVACY.md`, `STORE_LISTING.md`, store screenshots and promo tile.

## 1.1.0

- "Ads skipped" counter in the popup (total and today) and on the toolbar badge, with reset.
- Extension icons.

## 1.0.0

- First release: Manifest V3, YouTube-only host access, network rules, ad skipper (mute, 16x, seek to end, skip buttons), cosmetic hiding, on/off popup.
