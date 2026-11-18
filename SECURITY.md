# Security Policy

## Supported versions

Only the latest release of YT PureStream receives fixes. Please update before
reporting an issue.

## What the extension can and cannot do

- It runs **only on `youtube.com`** (`host_permissions` and content script).
- Permissions: `declarativeNetRequest` and `storage`. Nothing else.
- It has **no remote code, no network requests of its own, no analytics** and
  collects no personal data (see [PRIVACY.md](PRIVACY.md)).

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

1. Open the repository's **Security** tab and choose **Report a vulnerability**
   (GitHub private vulnerability reporting), or
2. If that is not available, open an issue titled "Security contact request"
   *without any details* and the maintainer will arrange a private channel.

Please include the extension version, browser and version, and steps to
reproduce. You can expect a first answer within about 7 days.

## Scope examples

In scope: a way for a web page to make the extension act outside youtube.com,
read or write its storage, or run code in the extension context.

Out of scope: YouTube changing its player so that ads reappear (that is a
normal bug - use the bug report template).
