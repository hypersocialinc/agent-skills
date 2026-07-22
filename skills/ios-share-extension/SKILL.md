---
name: ios-share-extension
description: "Use when adding an iOS Share Extension that saves a shared link or text into a native app from the system share sheet — especially on a Convex + Clerk stack. Covers the new app-extension target (XcodeGen/project.yml), App Group + keychain-access-group entitlements on BOTH targets, the Clerk shared-session gotcha (pin keychain service + accessGroup so the extension reuses the app's signed-in session), calling a Convex action from the extension via ConvexClientWithAuth, a resilient App Group save-queue drained by the host app on activation, NSExtensionActivationRule setup, LPMetadataProvider link preview, and a branded SwiftUI card. Use when the extension can't read the app's login, the share sheet target doesn't appear, or shares get lost offline."
---

# iOS Share Extension (Convex + Clerk)

Add a "Save to <app>" target to the iOS share sheet that saves the shared link/text
through the **same authenticated backend path the app already uses** — no new server
endpoint, no re-login. The extension reuses the app's Clerk session and calls a Convex
action as the signed-in user.

## The model (read this first)

An iOS Share Extension is a **separate process with its own bundle id, its own
entitlements, and its own signed-in state**. It does NOT inherit the host app's
keychain or network session for free. Two bridges make it work:

1. **Shared Clerk session** via a **keychain access group** — so the extension reads
   the app's login and calls Convex as that user. This is the part everyone gets wrong
   (see the gotcha below).
2. **Shared save-queue** via an **App Group** `UserDefaults` — so a save that can't
   reach the network (offline, cold extension) is never lost; the host app drains the
   queue when it next becomes active.

Both bridges require entitlements on **both targets** (app AND extension) and matching
constants in code.

## THE gotcha: Clerk's keychain service defaults to the bundle id

Clerk stores its session in the keychain under a `service` that **defaults to the
process's bundle id**. The app is `com.example.myapp`; the extension is
`com.example.myapp.ShareExtension`. Different bundle id → different keychain service →
**the extension sees a signed-out user even though the app is logged in.**

Fix: pin `service` AND `accessGroup` to the same values in `Clerk.configure(options:)`
on **both** targets:

```swift
Clerk.configure(
  publishableKey: Config.clerkPublishableKey,
  options: .init(keychainConfig: .init(
    service: SharedAuth.keychainService,        // pinned, NOT the bundle id
    accessGroup: SharedAuth.keychainAccessGroup // teamID.<shared-id>
  ))
)
```

**Migration cost:** pinning `service`/`accessGroup` MOVES where the session is stored,
so an already-signed-in user re-signs-in ONCE after you ship this. Call it out in the
PR; it is expected, not a bug.

See `reference/SharedAuth.swift` for the constants.

## Build order

1. **Entitlements on both targets** — App Group + keychain-access-group. `reference/entitlements.md`.
2. **Pin Clerk's keychain** in the app's `configure()` (the migration step above) and in the extension.
3. **Add the app-extension target** in `project.yml` (XcodeGen), embed it in the app, share the auth/config sources. `reference/project.yml.snippet`.
4. **Info.plist activation rule** — what the share sheet offers the extension for. `reference/Info.plist`.
5. **ShareViewController** — extract content, crawl a preview, build an authed Convex client, call your save action, fall back to the App Group queue on failure. `reference/ShareViewController.swift`.
6. **Branded card UI** — SwiftUI in a `UIHostingController` with a clear background. `reference/ShareCardView.swift`.
7. **Host-app drain** — `scenePhase == .active` → drain the App Group queue via the normal save path. `reference/host-app-drain.swift`.
8. **(Optional) live category preview** — a read-only Convex action so the card's chip matches what saving produces. `reference/convex-actions.ts`.

## Quick reference

| Concern | Answer |
|---|---|
| Extension type | `app-extension`, `NSExtensionPointIdentifier = com.apple.share-services` |
| Principal class | `$(PRODUCT_MODULE_NAME).ShareViewController` in Info.plist |
| Share the login | keychain-access-group entitlement + pinned Clerk `service`/`accessGroup` on BOTH targets |
| Share a save-queue | App Group entitlement + `UserDefaults(suiteName:)` on BOTH targets |
| Call the backend | reuse `ConvexClientWithAuth` + your `ClerkConvexAuthProvider`; `await client.login()` then `client.action("app:saveFromApp", ...)` |
| Never lose a share | on save failure, append to the App Group queue; host app drains on activate |
| What triggers the extension | `NSExtensionActivationRule` (web URL / web page / text) |
| Link preview | `LPMetadataProvider` (title + image), 8s timeout |
| Keep the archive light | share only `Config.swift` + `ClerkConvexAuthProvider.swift` + `Shared/` into the extension target — not the whole app |

## Common mistakes

- **Extension shows "signed out" but the app is logged in** → you didn't pin Clerk's
  keychain `service`/`accessGroup`, or the keychain-access-group entitlement is missing
  on one target, or the `accessGroup` string isn't `teamID.<id>` (it needs the team
  prefix at runtime; the entitlement can use `$(AppIdentifierPrefix)<id>`).
- **App Group reads come back empty** → the group string doesn't match on both targets,
  or the App Group capability isn't enabled in the provisioning profile. It must be the
  exact same `group.…` on the app entitlement, the extension entitlement, and the
  `UserDefaults(suiteName:)` call.
- **Share sheet doesn't offer your app** → `NSExtensionActivationRule` doesn't match the
  shared type (e.g. no `SupportsWebURLWithMaxCount`), or the extension isn't embedded in
  the app (`- target: ShareExtension` dependency on the app in `project.yml`).
- **`GENERATE_INFOPLIST_FILE: YES` on the extension** → overwrites your
  `NSExtension`/activation rule. Set it to `NO` and point `INFOPLIST_FILE` at your file.
- **Bundling the whole app into the extension** → bloated, slow to launch, and pulls in
  UI code it can't use. Share only the auth/config/Shared sources it needs.
- **Blocking the save on the network with no fallback** → offline shares vanish. Always
  queue to the App Group on failure and drain from the host app.

## Why route through the existing save action

The extension calls the *same* Convex action the app calls (`app:saveFromApp`), as the
*same* authenticated user. The server classifies, enriches, and inserts exactly as it
does from inside the app — so there is one code path to reason about, and the reactive
query updates the feed automatically when the app next opens. Don't build a
share-specific backend endpoint.
