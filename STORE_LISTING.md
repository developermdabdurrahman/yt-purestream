# Store listing text (Chrome Web Store / Edge Add-ons)

Copy-paste material for the developer dashboard. Images are in `store/` (regenerate with `npm run store-assets`). Upload `dist/YT-PureStream-v<version>.zip` (create it with `npm run build`).

## Name
YT PureStream

## Category
Productivity (or "Tools")

## Short description (max 132 characters)
Lightweight YouTube-only ad skipper. Skips video ads, hides promo clutter and shows how many ads and minutes you saved.

## Detailed description
YT PureStream is a small, fast extension that skips video ads on YouTube - and does nothing anywhere else.

WHAT IT DOES
- Skips pre-roll, mid-roll and overlay video ads automatically.
- Hides banner and feed promotions on youtube.com.
- Shows how many ads were skipped (total and today) and an estimate of the time you saved, right on the toolbar icon and in the popup.
- Works with YouTube Shorts and with YouTube's single-page navigation.

YOU STAY IN CONTROL
- One switch to pause everything instantly.
- Separate switches for video ads, overlay ads, and banners/feed clutter.
- Allow ads on the creators you want to support.
- Bengali and English interface.

BUILT TO BE LIGHT AND SAFE
- Runs only on youtube.com. No access to any other website.
- No data collection, no analytics, no tracking, no remote code, no accounts.
- Everything stays on your device.
- Compatibility mode: if YouTube flags an ad blocker, the extension relaxes its network blocking by itself so videos keep playing.
- Open source (MIT).

PRIVACY
YT PureStream collects no data. Settings and counters are stored locally in your browser only.

NOTE
YouTube changes often. If ads reappear, update the extension. YT PureStream is an independent project and is not affiliated with, endorsed by, or sponsored by YouTube or Google.

## Single purpose (Privacy practices tab)
Skip video advertisements on youtube.com.

## Permission justifications
- **declarativeNetRequest** - Blocks ad-related network requests made by youtube.com using static rules bundled with the extension (`rules_core.json`, `rules_strict.json`). No rules are downloaded.
- **storage** - Saves the user's settings (on/off, feature switches, language, allowed channels) and the ads-skipped counters locally.
- **Host permission `*://*.youtube.com/*`** - Needed to run the content script and styles that skip ads and hide ad containers on YouTube. The extension does not request access to any other site.

## Data usage disclosures (Privacy practices tab)
- Does the extension collect user data? **No** (leave every data-type box unchecked).
- Certify: data is not sold, not used for unrelated purposes, not used for creditworthiness or lending.
- Remote code: **No** (all code is in the package).
- Privacy policy URL: the published `PRIVACY.md` (for example `https://developermdabdurrahman.github.io/yt-purestream/PRIVACY`). See README "Publish the privacy policy".

## Images
| Asset | File |
|-------|------|
| Icon 128x128 | `icons/icon128.png` |
| Screenshot 1 (1280x800) | `store/screenshot-1-main.png` |
| Screenshot 2 (1280x800) | `store/screenshot-2-settings.png` |
| Screenshot 3 (1280x800) | `store/screenshot-3-bengali.png` |
| Small promo tile (440x280) | `store/promo-small-440x280.png` |

## Tips for review
- Keep the description honest and specific; do not promise "100% ad-free".
- Do not use the YouTube logo or the word "YouTube" as the extension's brand name.
- Mention the compatibility mode and that the extension is YouTube-only; it matches the permissions requested.
- Chrome Web Store payments no longer exist: if you ever add paid features, you must use your own checkout and say so in the description. Donations via the optional "Support this project" link need no extra declaration.
