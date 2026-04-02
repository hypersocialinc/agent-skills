# HyperCoder Clerk Auth Production Setup

This reference captures the production configuration that must stay aligned across Electron, the marketing app, Clerk, and Convex.

## Configuration Surfaces

There are four distinct places that must agree:

1. Electron build-time env
2. Marketing app env
3. Convex env
4. Clerk dashboard / production instance settings

If one of them drifts, auth often fails in ways that look unrelated.

## Electron Build-Time Env

Electron resolves auth config in:
- `apps/electron/src/lib/auth.ts`

The values are injected at build time through:
- `apps/electron/vite.config.ts`

Important variables:
- `VITE_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `VITE_CONVEX_URL`
- `EXPO_PUBLIC_CONVEX_URL`
- `CONVEX_URL`
- `VITE_OAUTH_BASE_URL` or `VITE_AUTH_PORT` for local auth development

### Critical invariant

Packaged Electron must be built with production Clerk and Convex values.

If you accidentally bake dev keys into the production build, you get failure modes like:
- Clerk 401s on `/v1/environment` or `/v1/client`
- app never reflects signed-in state after callback
- production auth works in browser but not in packaged Electron

## Marketing App Env

The Electron auth page on the marketing app uses:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

`CLERK_SECRET_KEY` is required because the server action in:
- `apps/marketing/app/auth/electron/actions.ts`

calls:
- `POST https://api.clerk.com/v1/sign_in_tokens`

Without a valid prod secret key on the marketing deployment, Electron login can succeed in the browser but fail before returning a usable token to the app.

## Convex Env

Convex depends on two Clerk-related values:
- `CLERK_JWT_ISSUER_DOMAIN`
- `CLERK_SECRET_KEY`

Where they matter:
- `convex/auth.config.ts`
- `convex/github.ts`

### `CLERK_JWT_ISSUER_DOMAIN`

This must point at the same Clerk instance/domain Electron and marketing are using in production.

Example production shape:
- `https://clerk.hypercoder.app`

If Convex trusts a different issuer than the session Electron is actually using, user identity in Convex will fail or drift.

### `CLERK_SECRET_KEY`

Convex uses this to retrieve the user’s GitHub social access token from Clerk.
If this is missing or tied to the wrong Clerk instance, GitHub repo listing/import fails even when the user appears signed in.

## Clerk Dashboard Requirements

The production Clerk instance needs all of the following aligned:

### Custom domain

HyperCoder production uses a custom Clerk domain:
- `clerk.hypercoder.app`

That domain must be:
- DNS verified
- SSL issued
- the domain Electron and Convex are configured to trust

### Native API

Native API must be enabled.

Electron’s packaged auth path relies on native-style Clerk request handling with `_is_native=1`.

### Allowed origins

Electron passes:
- `allowedRedirectOrigins={['hypercoder-app://local.app']}`

and production auth may still rely on Clerk recognizing the packaged app origin for parts of the flow and configuration.

Historically, the custom protocol origin had to be added to Clerk allowed origins:
- `hypercoder-app://local.app`

### Social connection

GitHub social login must be configured on the same Clerk production instance.

If you need repo access in Convex, ensure the GitHub connection includes scopes that cover the repo APIs you call.

### Keys

These keys must all come from the same Clerk production instance:
- Electron publishable key
- Marketing publishable key
- Marketing secret key
- Convex secret key

Do not mix a production publishable key with a dev secret key or vice versa.

## Runtime Gating in the App

Electron UI gates GitHub auth features on:
- Clerk publishable key being present
- Convex URL being present

That logic lives in:
- `apps/electron/src/lib/auth.ts`

If build-time env is missing, the UI may refuse to offer connect flows even though other parts of the app still run.

## Local vs Production Differences

### Local

- marketing auth page may run on localhost
- Electron may use `VITE_AUTH_PORT` or `VITE_OAUTH_BASE_URL`
- Clerk may tolerate simpler browser-like flows

### Production

- system browser always goes to the deployed marketing site
- packaged Electron runs under `hypercoder-app://local.app`
- Clerk HTTPS requests are proxied through Electron main
- issuer, secret key, publishable key, and custom domain must all match

Do not assume that a localhost success implies packaged production success.

## Production Change Checklist

Use this whenever changing auth config:

1. Confirm Electron build-time env uses production Clerk and Convex values.
2. Confirm marketing deployment has the matching `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
3. Confirm marketing deployment has the matching `CLERK_SECRET_KEY`.
4. Confirm Convex `CLERK_JWT_ISSUER_DOMAIN` matches the production Clerk domain.
5. Confirm Convex `CLERK_SECRET_KEY` belongs to the same Clerk instance.
6. Confirm Native API is enabled in Clerk.
7. Confirm the packaged app origin is allowed where required.
8. Confirm GitHub social login is enabled on the same Clerk instance.
9. Run a packaged Electron sign-in smoke test.

## Initial Clerk Production Setup (One-Time)

These steps were done once when moving from Clerk dev to prod. They don't need repeating unless the Clerk instance or domain changes.

### DNS (name.com for hypercoder.app)

Five CNAME records pointing to Clerk:
- `clerk` -> `frontend-api.clerk.services`
- `accounts` -> `accounts.clerk.services`
- `clkmail` -> `mail.dg3uemm8x4ws.clerk.services`
- `clk._domainkey` -> `dkim1.dg3uemm8x4ws.clerk.services`
- `clk2._domainkey` -> `dkim2.dg3uemm8x4ws.clerk.services`

### Clerk Dashboard

- DNS Configuration: Verified
- SSL Certificates: Issued
- Native API: Enabled (Configure -> User & authentication -> Native applications)
- JWT Template: "convex" (Configure -> Sessions -> JWT Templates)
- Allowed Origins: `hypercoder-app://local.app` (set via Backend API, not dashboard UI)

### Allowed Origins (Backend API only)

```bash
curl -X PATCH https://api.clerk.com/v1/instance \
  -H "Authorization: Bearer sk_live_YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"allowed_origins": ["hypercoder-app://local.app"]}'
```

### Vercel (marketing site)

Both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` must be prod keys. `NEXT_PUBLIC_*` vars require a redeploy to take effect (build-time inlined).

### Convex (production deployment)

- `CLERK_JWT_ISSUER_DOMAIN` = `https://clerk.hypercoder.app`
- `CLERK_SECRET_KEY` = prod secret key

## Known Failure Signatures

### Electron browser callback succeeds, app stays disconnected

Usually one of:
- Electron built with the wrong Clerk publishable key
- Clerk failed to initialize in packaged mode
- renderer could not reach Clerk FAPI before the fetch proxy existed
- Convex URL or auth gating is missing

### Signed in, but GitHub repo listing fails

Usually one of:
- Convex `CLERK_SECRET_KEY` missing or wrong
- GitHub social token not available in Clerk
- GitHub social connection missing required scopes

### Convex auth fails while Clerk UI looks signed in

Usually:
- `CLERK_JWT_ISSUER_DOMAIN` is pointed at the wrong Clerk instance/domain
