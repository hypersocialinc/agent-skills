# HyperCoder Clerk Auth Architecture

This reference explains how authentication works today across Electron, the marketing site, Clerk, and Convex.

## High-Level Shape

HyperCoder does not use a single uniform Clerk flow everywhere.

- Marketing uses standard web Clerk auth.
- Mobile uses Clerk Expo with secure token storage.
- Electron uses a hybrid flow:
  browser-based login on the marketing site, then a Clerk sign-in token is handed back to Electron and consumed there.

That split exists because packaged Electron behaves differently from a standard browser:
- custom protocol origin
- no reliable cookie-based Clerk session flow
- renderer CORS constraints for Clerk FAPI requests
- OS/browser handoff when starting OAuth

## End-to-End Electron Flow

### 1. User starts auth from Electron UI

Common entrypoints:
- `apps/electron/src/components/SettingsHub/SettingsHubModal.tsx`
- `apps/electron/src/components/NewWorkspaceDialog/GitHubRepoPicker.tsx`

These call:
- `window.electronAPI.openGitHubAuth(getOAuthBaseUrl())`

`getOAuthBaseUrl()` lives in `apps/electron/src/lib/auth.ts`.

### 2. Electron main opens the browser to the marketing auth page

`apps/electron/electron/main.ts`

Main does two things:
- starts a localhost callback server on `127.0.0.1`
- opens the system browser to:
  `https://hypercoder.app/auth/electron?callback=http://127.0.0.1:<port>/auth/callback`

The localhost callback replaced the original direct deep-link approach because OS protocol prompts could delay the redirect long enough for short-lived tokens to become unreliable.

### 3. Marketing site performs normal web Clerk auth

`apps/marketing/app/auth/electron/page.tsx`

This page is a standard Clerk web page:
- if signed out, it shows a GitHub sign-in button
- if signed in, it calls a server action to mint a Clerk sign-in token
- then it redirects to the callback URL Electron provided

Auth on `/auth/*` is protected by:
- `apps/marketing/middleware.ts`

### 4. Marketing server action mints the Clerk sign-in token

`apps/marketing/app/auth/electron/actions.ts`

The server action:
- reads the current Clerk-authenticated user from the server session
- calls `POST https://api.clerk.com/v1/sign_in_tokens`
- authenticates that call with `CLERK_SECRET_KEY`
- returns the Clerk ticket-like token to the page

This is a critical boundary:
- Electron does not mint the sign-in token itself
- the browser client does not supply the user id
- the marketing server action uses the already-authenticated Clerk session to decide who the token is for

### 5. Electron main receives the callback

`apps/electron/electron/main.ts`

The localhost callback server extracts `token` from the query string and forwards it to renderer windows over IPC:
- event: `auth:sign-in-token`

### 6. Electron renderer consumes the token

`apps/electron/src/hooks/useAuthDeepLink.ts`

The renderer listens for the IPC token and runs:
- `signIn.create({ strategy: "ticket", ticket: token })`
- `clerk.setActive({ session: result.createdSessionId })`

This is the point where the Electron app becomes signed in from Clerk’s perspective.

### 7. Electron Clerk runtime uses a custom native-style setup

`apps/electron/src/main.tsx`
`apps/electron/src/lib/clerkElectron.ts`
`apps/electron/src/lib/clerkElectronFetch.ts`

In packaged Electron:
- a custom `hypercoder-app://local.app` protocol is used for the app origin
- a headless Clerk instance is created
- Clerk request hooks add `_is_native=1`
- cookies are disabled with `credentials: 'omit'`
- auth tokens are cached through Electron IPC
- Clerk HTTPS requests are proxied through Electron main

The proxy exists because direct renderer requests to Clerk FAPI hit CORS failures in packaged builds even after origin/header rewriting attempts.

### 8. Convex consumes the Clerk session

`apps/electron/src/main.tsx`
`convex/auth.config.ts`

Electron wraps the app in `ConvexProviderWithClerk`, so once Clerk session state is active, Convex auth follows.

Convex must trust the same Clerk issuer domain the app is actually using.

## Production-Only Pieces

### Custom protocol

`apps/electron/electron/main.ts`

Packaged Electron registers:
- `hypercoder-app://local.app`

This is used for:
- loading app assets with a non-`file://` origin
- allowing a more browser-like runtime environment for Clerk

It is not, by itself, sufficient to make Clerk web auth work like a normal browser app.

### Main-process Clerk transport proxy

`apps/electron/src/lib/clerkElectronFetch.ts`
`apps/electron/electron/main.ts`

Only Clerk HTTPS requests are proxied.
Everything else still uses normal renderer `fetch`.

The proxy path is now the canonical solution for packaged Electron Clerk FAPI transport.
Do not reintroduce renderer-only Clerk network assumptions unless you can prove packaged builds still work.

## GitHub Access After Sign-In

Electron UI often uses Clerk auth as the user/session source of truth, but GitHub repository access itself comes from Convex server-side logic.

`convex/github.ts`

Convex:
- reads the Clerk-authenticated identity from `ctx.auth`
- uses `CLERK_SECRET_KEY`
- asks Clerk for the user’s GitHub access token
- calls GitHub APIs with that token

That means these two facts must both be true for repo access to work:
- Electron/Clerk session is valid
- Clerk social connection is configured with the GitHub scopes you need

## File Ownership Map

### Electron renderer

- `apps/electron/src/lib/auth.ts`
  Runtime env resolution and base URLs.
- `apps/electron/src/main.tsx`
  ClerkProvider, ConvexProviderWithClerk, production Electron setup.
- `apps/electron/src/lib/clerkElectron.ts`
  Headless Clerk instance and token-management hooks.
- `apps/electron/src/lib/clerkElectronFetch.ts`
  Renderer fetch shim for Clerk HTTPS requests.
- `apps/electron/src/hooks/useAuthDeepLink.ts`
  Ticket consumption and session activation.

### Electron main

- `apps/electron/electron/main.ts`
  Custom protocol, localhost callback server, IPC bridge, Clerk fetch proxy.
- `apps/electron/electron/preload.ts`
  Exposes `openGitHubAuth`, token cache IPC, and Clerk fetch IPC to the renderer.

### Marketing app

- `apps/marketing/app/auth/electron/page.tsx`
  Browser auth flow and redirect UX.
- `apps/marketing/app/auth/electron/actions.ts`
  Sign-in token minting.
- `apps/marketing/middleware.ts`
  Ensures `/auth/*` uses Clerk middleware.

### Convex

- `convex/auth.config.ts`
  Trusted Clerk issuer domain.
- `convex/github.ts`
  GitHub access token retrieval via Clerk.

## Upgrade Risk

The most fragile part of this design is the Electron-specific Clerk client setup:
- `@clerk/clerk-js/headless`
- `__unstable__onBeforeRequest`
- `__unstable__onAfterResponse`

When upgrading Clerk, re-verify:
- the unstable hooks still exist
- `_is_native=1` is still honored
- the auth token still comes back on response headers
- packaged Electron auth still works end to end
