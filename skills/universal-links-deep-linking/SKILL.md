---
name: universal-links-deep-linking
description: "Make tapped https links open a native iOS or Expo/React Native app when installed and fall back to the web page when not — Apple Universal Links + Android App Links. Use when adding deep linking for shared links, writing apple-app-site-association (AASA) or assetlinks.json, wiring associated-domains/applinks entitlements or Expo associatedDomains/intentFilters, handling onOpenURL/NSUserActivity or expo-router linking, or debugging why a link opens the browser instead of the app (AASA redirect or content-type, signing-fingerprint mismatch, Apple CDN cache, simulator-vs-device testing)."
---

# Universal Links & App Links

## The model (read this first)

A Universal Link (iOS) / App Link (Android) is a **verified two-sided handshake**, not a URL scheme:

1. The **website** hosts a file vouching for the app (`apple-app-site-association` for iOS, `assetlinks.json` for Android).
2. The **app** declares it owns that domain (entitlement / `associatedDomains` / `intentFilter`).
3. The OS verifies the pair on install, then **one ordinary https URL serves both audiences**:
   - App installed → the OS opens the app directly. **No redirect, no "Open in app?" prompt.**
   - App not installed → the same URL loads the web page (your fallback + install CTA).

**You never detect-and-redirect.** The OS intercepts the tap. That's the whole point — and why getting the website file *exactly* right matters more than any app code.

## Three decisions before you build

1. **Which domain?** It must be the **terminal host** of the shared link — the one that answers `200` with no redirect. A bare-apex → `www` redirect (or http→https, or a trailing-slash redirect) **silently breaks** the link. Pick one host and use it in the link, the entitlement, AND where the association file is served. Crucially, the code that **generates** shared links must emit that terminal host **directly** — never a host that depends on a redirect. (Keeping the apex→www 301 for humans typing the URL is fine; just don't let a *shared* link rely on it.)
2. **What ID goes in the URL?** It must resolve to the **same entity on both the web page and the app** — this is the most common "it opens but shows the wrong/empty thing" bug. Default: keep the **web/SEO-friendly id** (slug) in the URL and **resolve it to the app's internal id on the app side** (a lookup the app likely already has). Only embed the app's internal id directly if the web page can also resolve that id. Either way, add the resolver on whichever side is missing it before you ship.
3. **Which paths does the app own?** e.g. `/item/*` — narrow enough that the app doesn't swallow `/about` or `/blog`.

## What to set up (3 surfaces)

| Surface | iOS | Android |
|---|---|---|
| **Website** | `/.well-known/apple-app-site-association` (JSON, `application/json`, **no redirect**) | `/.well-known/assetlinks.json` |
| **App declares domain** | `applinks:HOST` entitlement (native) / `ios.associatedDomains` (Expo) | `autoVerify` intent filter (native) / `android.intentFilters` (Expo) |
| **App handles the link** | `onOpenURL` + `NSUserActivityTypeBrowsingWeb` | `onNewIntent` / `Linking` |

The **website half is identical** regardless of whether the app is native or Expo. Build it once.

- App ID for the AASA = **`<TEAM_ID>.<BUNDLE_ID>`** (e.g. `ABCDE12345.com.acme.app`).
- assetlinks fingerprint = the **SHA-256 of the signing cert** — debug keystore in dev, **Play App Signing** cert in production (Play Console → Setup → App signing). A wrong fingerprint fails silently.

Concrete files to copy and the per-stack steps are in **`references/setup-and-gotchas.md`**, with ready artifacts:
- `references/apple-app-site-association.json` — AASA template
- `references/aasa-route.ts` — Next.js App Router route handler that serves it with the correct content-type
- `references/assetlinks.json` — Android template

## Gotchas that cost real hours

Failures here are **silent** — the link just opens the browser, with no error. Don't guess; use the verification commands below.

1. **A redirect on the AASA URL or the link breaks it.** iOS does **not** follow redirects to fetch the AASA or to match a link. Apex→www is the classic trap. Target the terminal host everywhere.
2. **AASA content-type must be `application/json`.** Serve via a route handler you control, not a bare static file that may be served as `application/octet-stream`.
3. **Test on a real device, and *tap a link* (Messages/Notes).** The iOS Simulator is unreliable for the tap-to-open path, and **typing the URL into Safari's address bar bypasses Universal Links** — it only fires from a tapped link.
4. **Apple caches the AASA on its CDN**, so edits can lag. During dev, use `applinks:HOST?mode=developer` in a **Debug-only** entitlement + Settings → Developer → Associated Domains Development to fetch directly. **Never ship `?mode=developer`.**
5. **Android: the signing fingerprint must match the installed build.** Dev uses the debug keystore SHA-256; production uses the Play App Signing SHA-256. Mismatch → `autoVerify` silently fails and links open in Chrome.
6. **Associated Domains is a capability** that must be enabled on the App ID in the Apple Developer portal (paid account).

## Verify (don't trust, check)

```bash
# Apple — must be 200, application/json, NO 3xx redirect:
curl -sI https://HOST/.well-known/apple-app-site-association
# What Apple's CDN actually cached for the domain:
curl -s https://app-site-association.cdn-apple.com/a/v1/HOST

# Android — must be 200 and contain your package + fingerprint:
curl -s https://HOST/.well-known/assetlinks.json
# On-device verification state:
adb shell pm get-app-links YOUR.PACKAGE.NAME
```

Then the real test: on a device with the app installed, **tap** a `https://HOST/<owned-path>` link from Notes or iMessage → it should open the app. Delete the app → the same link loads the web page.

## Don't forget the web fallback

Half the value is the not-installed path. The same URL should render a real page for that item plus a "Get the app" CTA, and on iOS a Smart App Banner (`<meta name="apple-itunes-app" content="app-id=...">`). If an id can't be resolved to a page, return a graceful 404/empty state — not a server error.

## Per-stack details

- **Native iOS (Swift / SwiftUI), incl. XcodeGen per-config entitlements** → `references/setup-and-gotchas.md` § Native iOS
- **Expo / React Native (config plugin + expo-router linking)** → `references/setup-and-gotchas.md` § Expo
- **Android App Links** → `references/setup-and-gotchas.md` § Android
