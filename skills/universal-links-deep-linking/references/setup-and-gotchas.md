# Universal Links & App Links — full setup

Read `SKILL.md` first for the model and the three decisions. This file has the
concrete per-surface steps, the gotcha rationale, and verification.

Throughout, `HOST` is the **terminal** host of your shared links (the one that
answers `200` with no redirect — see Gotcha 1), e.g. `www.example.com`.

---

## § Website (shared by native and Expo)

The website half is identical no matter how the app is built. Do it once.

### Apple — apple-app-site-association (AASA)

- Serve at `https://HOST/.well-known/apple-app-site-association`
  (no extension, **`Content-Type: application/json`**, HTTP `200`, **no redirect**).
- `appIDs` entries are `<TEAM_ID>.<BUNDLE_ID>`. Team ID is in the Apple Developer
  portal (Membership) or your `.xcodeproj` `DEVELOPMENT_TEAM`.
- Use `references/apple-app-site-association.json` as the body.
- **Prefer a route handler** that sets the content-type over a bare static file.
  Next.js App Router: copy `references/aasa-route.ts` to
  `app/.well-known/apple-app-site-association/route.ts`. Other frameworks: any
  endpoint that returns the JSON with `application/json` and no redirect works
  (Express route, Cloudflare Worker, S3 object with metadata, etc.).

### Android — assetlinks.json

- Serve at `https://HOST/.well-known/assetlinks.json` (`application/json`, `200`).
- Use `references/assetlinks.json`. `package_name` is the Android applicationId.
- `sha256_cert_fingerprints` must be the **SHA-256 of the cert that signs the
  installed build**:
  - Dev / local: debug keystore →
    `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`
  - Production: **Play App Signing** SHA-256 from Play Console → your app →
    Setup → App signing. (Not your upload key — Google re-signs.)
  - You can list **multiple** fingerprints; include both debug and release so the
    same file verifies in every environment.

---

## § Native iOS (Swift / SwiftUI)

### 1. Capability + entitlement

- Enable **Associated Domains** on the App ID (Apple Developer portal → Identifiers),
  or let automatic signing add it.
- Add to the app's `.entitlements`:
  ```xml
  <key>com.apple.developer.associated-domains</key>
  <array>
    <string>applinks:HOST</string>
  </array>
  ```

### 2. Dev iteration without fighting Apple's CDN

Apple caches the AASA; edits can take time to propagate. For a fast loop, use a
**Debug-only** entitlement with `?mode=developer` so the device fetches the AASA
directly from your server and skips the cache. Keep Release on the plain form —
**`?mode=developer` must never ship.**

- `Spotless.Debug.entitlements`: `<string>applinks:HOST?mode=developer</string>`
- `Spotless.entitlements` (release): `<string>applinks:HOST</string>`
- Wire per-config. With **XcodeGen** (`project.yml`):
  ```yaml
  settings:
    configs:
      Debug:
        CODE_SIGN_ENTITLEMENTS: App/App.Debug.entitlements
      Release:
        CODE_SIGN_ENTITLEMENTS: App/App.entitlements
  ```
  Plain Xcode: set `CODE_SIGN_ENTITLEMENTS` per configuration in Build Settings.
- On the device: **Settings → Developer → Associated Domains Development = ON**.

### 3. Handle the inbound link

SwiftUI `App` lifecycle — handle **both**, so cold launch and warm foreground
both route:

```swift
WindowGroup {
  RootView()
    // Universal Links arrive as a browsing-web user activity.
    .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
      if let url = activity.webpageURL { route(url) }
    }
    // Custom-scheme opens (and some warm cases) arrive here.
    .onOpenURL { url in route(url) }
}

func route(_ url: URL) {
  // 1. Validate host + path (only act on links you own).
  // 2. Parse the id from the path.
  // 3. Resolve id -> your model, then navigate. Unknown id = no-op.
}
```

UIKit: implement `application(_:continue:restorationHandler:)` and read
`userActivity.webpageURL`.

**Keep the parser pure** (URL → route enum) so it's trivially testable; do the
async id→model resolution separately.

---

## § Expo / React Native

Expo configures the native pieces from `app.json` / `app.config.*` — no manual
entitlements or intent-filter XML. **A config change requires a rebuild**
(`expo prebuild` + native build / new dev client); it will not apply over OTA.

### 1. Declare the domains

```jsonc
{
  "expo": {
    "ios": {
      "associatedDomains": ["applinks:HOST"]
    },
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [{ "scheme": "https", "host": "HOST", "pathPrefix": "/item" }],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

The website AASA + assetlinks (the `§ Website` section) are still required and
identical. Android `autoVerify` + assetlinks fingerprint must match the build's
signing cert — in EAS that's the **EAS-managed / Play App Signing** key.

### 2. Handle the inbound link

- **expo-router**: file-based routes map URLs to screens automatically once the
  domain is associated. Set the route `pathPrefix` to match the app paths. Use
  `expo-linking` (`Linking.useURL()` / `getInitialURL()`) for any custom routing.
- **React Navigation**: pass a `linking` config (`prefixes: ["https://HOST"]`,
  `config: { screens: { ItemDetail: "item/:id" } }`).
- Dev iteration: use a **development build / dev client** (not Expo Go) so the
  associated domain is actually present; Universal Links don't verify in Expo Go.

---

## § Android App Links extras

- Per-link verification state on device:
  `adb shell pm get-app-links YOUR.PACKAGE.NAME` → look for `verified`.
- Force re-verification after fixing assetlinks:
  `adb shell pm verify-app-links --re-verify YOUR.PACKAGE.NAME`.
- Google's tester: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://HOST&relation=delegate_permission/common.handle_all_urls`.
- Unlike iOS there's no `?mode=developer`; just include the debug fingerprint in
  assetlinks so dev builds verify too.

---

## § Verification & debugging

Failures are **silent** (the link just opens the browser). Always verify rather
than guess.

```bash
# Apple: expect HTTP 200, content-type application/json, and NO 3xx line.
curl -sI https://HOST/.well-known/apple-app-site-association

# What Apple actually cached (may lag your deploy):
curl -s https://app-site-association.cdn-apple.com/a/v1/HOST | json_pp

# Android: expect 200 + your package_name + the right fingerprint.
curl -s https://HOST/.well-known/assetlinks.json
adb shell pm get-app-links YOUR.PACKAGE.NAME
```

On-device acceptance test:
1. Install the app (dev build / TestFlight / Play internal).
2. From **Notes or iMessage**, **tap** a `https://HOST/<owned-path>` link.
   (Do **not** type it into Safari's address bar — that bypasses Universal Links.)
3. It should open the app to that item. Long-press the link → "Open in <App>"
   confirms the association registered.
4. Delete the app → the same link should load the web fallback page.

If iOS opens Safari instead of the app, check in this order: (1) AASA reachable
with no redirect and JSON content-type, (2) entitlement host matches the link
host exactly, (3) you reinstalled after the entitlement/AASA changed, (4)
`?mode=developer` + Developer toggle while iterating.

---

## § Gotcha rationale (why each rule exists)

| Gotcha | Why it bites | Fix |
|---|---|---|
| Redirect on AASA/link | iOS won't follow 3xx to fetch the AASA or match a link; apex→www is the classic | Use the terminal host in link + entitlement + serving |
| Wrong content-type | Some Apple crawlers reject non-`application/json` | Route handler that pins the header |
| Simulator / address-bar test | Sim is unreliable; typing a URL isn't a "tap" | Real device, tap a link from another app |
| Stale AASA | Apple CDN caches it | `?mode=developer` (Debug only) + Developer toggle |
| Android fingerprint mismatch | `autoVerify` checks the SHA-256 of the *installed* signer | Use Play App Signing SHA-256 for prod; include debug too |
| Id doesn't resolve both sides | App and web identify entities differently | Pick a canonical id; add a resolver on the missing side |
| Capability not enabled | Signing drops the entitlement | Enable Associated Domains on the App ID |
| Shipped `?mode=developer` | Dev-only; behaves differently / flagged | Per-config entitlements; never in Release |
