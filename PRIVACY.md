# Privacy Policy - YT PureStream

_Last updated: 16 November 2026_

**YT PureStream collects no personal data.**

## What the extension does
It runs only on `youtube.com` and its subdomains. It skips video ads in the page and blocks a small list of ad-related network requests made by YouTube.

## What is stored (on your device only)
The extension saves these settings and counters in your browser's local extension storage (`chrome.storage.local`):

- the on/off switch and compatibility-mode state;
- your feature switches and language choice;
- the list of YouTube channels you allowed (for example `@channelname`);
- the "ads skipped" counters and estimated time saved;
- a short technical note if a problem was detected (for example "YouTube may have changed").

This data never leaves your device. It is not sent to the developer or to any third party.

## What is NOT done
- No analytics, tracking, advertising or telemetry.
- No data is collected, sold, shared or transferred.
- No remote code is loaded; everything the extension runs is included in the package.
- The extension makes no network requests of its own.
- It does not read your browsing history, accounts, cookies or passwords, and it does not run on websites other than YouTube.

## Permissions explained
| Permission | Why it is needed |
|-----------|------------------|
| `declarativeNetRequest` | Lets the browser block ad-related requests made by `youtube.com`, using the rules shipped in the extension. |
| `storage` | Saves your settings and counters locally. |
| Host access `*://*.youtube.com/*` | Lets the extension run its ad-skipping script and styles on YouTube only. |

## Your control
Use the switch in the extension popup to pause it at any time, **Reset** to clear the counters, or remove the extension to delete all stored data.

## Contact
Questions about this policy: open an issue at https://github.com/developermdabdurrahman/yt-purestream/issues .

## Disclaimer
YT PureStream is an independent project and is not affiliated with, endorsed by, or sponsored by YouTube or Google.
