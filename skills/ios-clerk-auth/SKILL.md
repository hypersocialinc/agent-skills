---
name: ios-clerk-auth
description: Use when wiring or debugging Clerk authentication in a native iOS / Swift app — native "Sign in with Apple" failing with "You are not authorized to perform this request", OAuth (Apple/Google) social sign-in errors, or Clerk↔Convex token setup. Covers diagnosing and fixing the Clerk instance config with the clerk CLI.
---

# iOS Clerk Auth

Native iOS Clerk auth (ClerkKit / `Clerk.shared.auth`) has a few configuration
seams that live in the **Clerk dashboard/instance config**, not the Swift code —
so the app compiles and looks wired, but sign-in is rejected at runtime. This
skill is the symptom-driven fix list. Inspect and patch instance config with the
`clerk` CLI (`clerk config pull` / `clerk config patch`); it's pre-authed when
the repo is linked (`clerk doctor --json`).

## When to use

- Native **Sign in with Apple** fails with **"You are not authorized to perform
  this request"** (a generic Clerk authorization rejection).
- `Clerk.shared.auth.signInWithApple()` / `signInWithOAuth(provider:)` throws a
  `ClerkAPIError` even though the Swift integration looks correct.
- Setting up Clerk so a native app can call a **Convex** backend (JWT template).
- Social sign-in works on web but not in the native iOS app.

## The Apple `bundle_id` gotcha (most common)

**Symptom:** `signInWithApple()` → "You are not authorized to perform this request".

**Cause:** native Sign in with Apple uses ASAuthorization and returns an Apple
identity token whose `aud` claim is the **app's bundle identifier**. Clerk
validates that against `connection_oauth_apple.bundle_id`. If that field is
**empty**, the token is rejected.

The trap: the connection looks fully configured — `enabled: true`, a `client_id`,
a signing key, a `team_id` — because **`client_id` is the Apple *Services ID* used
for the web/OAuth-redirect flow; `bundle_id` is a *separate* field that the native
iOS flow needs.** Web sign-in works; native silently doesn't.

**Diagnose:**
```bash
clerk config pull | jq '.connection_oauth_apple'
# look at bundle_id — if "" that's the bug
```

**Fix** (dry-run first; confirm with the user before mutating shared config):
```bash
clerk config patch --json '{"connection_oauth_apple":{"bundle_id":"<app-bundle-id>"}}' --dry-run
clerk config patch --json '{"connection_oauth_apple":{"bundle_id":"<app-bundle-id>"}}' --yes
```
`config patch` rejects nested JSON via stdin / `--input-json` — use `--json` or
`--file`.

**Still failing after the patch?** Then it's the Apple Developer side, not Clerk:
the connection's `team_id`/`key_id` must belong to the team that owns
`<app-bundle-id>` AND that App ID must have the Sign in with Apple capability
enabled. The app's `.entitlements` must declare `com.apple.developer.applesignin`.

## Clerk ↔ Convex (JWT template)

For a native app to authenticate to a Convex backend:

1. **Clerk JWT template** named `convex` with `aud: "convex"` must exist on the
   instance. Verify:
   ```bash
   clerk api /jwt_templates | jq '.[] | select(.name=="convex") | {name, aud: .claims.aud}'
   ```
2. **Convex** `convex/auth.config.ts` sets `applicationID: "convex"` (matches the
   template `aud`) and `domain: process.env.CLERK_JWT_ISSUER_DOMAIN`.
3. `CLERK_JWT_ISSUER_DOMAIN` is set on the Convex deployment
   (`npx convex env list`) to the Clerk Frontend API domain
   (`https://<instance>.clerk.accounts.dev` for dev).
4. The iOS auth provider mints the token per request via
   `session.getToken(.init(template: "convex"))`.

A missing/mismatched template or env var → Convex rejects every call (often
surfacing as an empty/failed reactive query, not a sign-in error).

## Google as a fallback for isolating Apple issues

Google OAuth on a Clerk **development** instance works without custom
`client_id`/`client_secret` (empty → Clerk's shared dev credentials). So
"Continue with Google" is a clean way to confirm the rest of the auth + backend
wiring while an Apple-specific config problem is still being sorted. Production
needs real Google credentials.

## Common mistakes

| Mistake | Reality |
|---------|---------|
| Assuming auth is broken in Swift code | The Swift side often compiles & runs fine; the gap is Clerk instance config. Check `clerk config pull` first. |
| Setting `client_id` and expecting native Apple to work | `client_id` = Services ID (web). Native needs `bundle_id`. |
| Patching with nested JSON over stdin | `clerk config patch` only accepts nested JSON via `--json` or `--file`, not `--input-json`/stdin. |
| Mutating shared Clerk config without asking | It's shared auth infra — dry-run, then confirm with the user before `--yes`. |
| Forgetting the Convex JWT template | `aud` of the `convex` template must equal `applicationID` in `auth.config.ts`. |

## Validation

- `clerk config pull | jq '.connection_oauth_apple.bundle_id'` returns the app
  bundle id.
- Build & run on a simulator; tapping **Continue with Apple** completes and the
  app reaches its signed-in screen (no red "not authorized" message).
- If using Convex, the authenticated reactive query returns data (or a correct
  empty state) rather than an auth failure.
