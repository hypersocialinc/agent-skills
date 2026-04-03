# HyperCoder Clerk Auth Debugging

Use this reference to diagnose Electron auth issues by symptom.

## Start With Symptom Classification

Pick the narrowest matching symptom:

1. Connect button does nothing
2. Browser login succeeds but Electron never updates
3. Packaged build only: Clerk network/CORS failures
4. Electron shows signed in, but GitHub repo access fails
5. Convex-authenticated backend calls fail while Clerk UI looks healthy

## 1. Connect Button Does Nothing

Check Electron UI entrypoints:
- `apps/electron/src/components/SettingsHub/SettingsHubModal.tsx`
- `apps/electron/src/components/NewWorkspaceDialog/GitHubRepoPicker.tsx`

Verify:
- `window.electronAPI.openGitHubAuth` exists
- `getOAuthBaseUrl()` resolves to the expected domain
- `isGitHubAuthRuntimeConfigured()` is not blocking the UI due to missing build env

Good first checks:

```bash
pnpm --filter @hypersurge/electron typecheck
```

In Electron devtools:
- inspect the console for missing `electronAPI`
- inspect whether the button handler logs an auth error result

## 2. Browser Login Succeeds But Electron Never Updates

Break the flow into boundaries:

### Browser side

Check the marketing auth page:
- `apps/marketing/app/auth/electron/page.tsx`

Questions:
- Did the user become signed in on that page?
- Did the page call the token-minting server action?
- Did it redirect to the callback URL with `?token=...`?

### Callback boundary

Check Electron main:
- `apps/electron/electron/main.ts`

Questions:
- Did the localhost callback server start?
- Did it receive `/auth/callback?token=...`?
- Did it emit `auth:sign-in-token` to renderer windows?

### Renderer consumption

Check:
- `apps/electron/src/hooks/useAuthDeepLink.ts`

Questions:
- Did `signIn.create({ strategy: "ticket", ticket })` run?
- Did it return `createdSessionId`?
- Did `clerk.setActive(...)` run?

If the callback page shows authenticated but the app stays disconnected, the problem is usually after token issuance, not in GitHub OAuth itself.

## 3. Packaged Build Only: Clerk Network Or CORS Failures

This is the class of issue that required the current fetch proxy architecture.

Relevant files:
- `apps/electron/src/lib/clerkElectron.ts`
- `apps/electron/src/lib/clerkElectronFetch.ts`
- `apps/electron/electron/main.ts`

Current expected behavior:
- packaged Electron Clerk HTTPS requests do not rely on raw renderer browser transport
- Clerk HTTPS requests are proxied through Electron main

If you see CORS-like failures on Clerk `sign_ins` or client endpoints in a packaged build:

1. Confirm the fetch shim is installed before Clerk initializes.
2. Confirm the request host matches the proxy allowlist.
3. Confirm Electron main `clerk:fetch` IPC still exists.
4. Confirm the request includes `_is_native=1`.
5. Confirm the token cache hooks still run on responses.

Validation commands:

```bash
pnpm --filter @hypersurge/electron typecheck
pnpm --filter @hypersurge/electron exec vitest run src/__tests__/lib/clerkElectronFetch.test.ts
pnpm --filter @hypersurge/electron build:ci
```

Then run a real packaged sign-in test.

## 4. Electron Shows Signed In, But GitHub Repo Access Fails

This usually means Clerk session auth succeeded, but Clerk-to-GitHub token retrieval on Convex failed.

Relevant file:
- `convex/github.ts`

Check:
- Convex has `CLERK_SECRET_KEY`
- the key belongs to the same Clerk instance as Electron and marketing
- GitHub social login is enabled in Clerk
- the GitHub social connection has the scopes needed for repo listing/clone flows

Typical failure signatures:
- `GitHub access token not found`
- Convex throws that `CLERK_SECRET_KEY` is missing
- repo import UI shows signed-in user but cannot load repositories

Best immediate check in production:

```bash
npx convex logs --prod --history 200 --jsonl | rg "github:listMyGithubRepos|CLERK_SECRET_KEY|GitHub repo list failed|Clerk OAuth token lookup failed"
```

Exact HyperCoder production incident:
- Electron showed: `GitHub import is temporarily unavailable. Try again in a moment.`
- Convex prod log showed:
  - `[github] CLERK_SECRET_KEY is not configured on Convex.`
  - `ConvexError: {"code":"github_unavailable", ...}`

Interpretation:
- this is not a GitHub repo-scope problem
- this is not a stale Electron build problem
- it means the Convex production deployment is missing `CLERK_SECRET_KEY`

Fix:

```bash
npx convex env set CLERK_SECRET_KEY 'sk_live_...' --prod
```

Then retry the installed app. A second code deploy is not required for that specific issue.

## 5. Convex Calls Fail While Clerk UI Looks Healthy

Relevant file:
- `convex/auth.config.ts`

Check:
- `CLERK_JWT_ISSUER_DOMAIN`

It must match the Clerk issuer/domain the Electron session was minted from.

If Electron is using `clerk.hypercoder.app` but Convex still trusts the old dev domain, auth identity in Convex will fail even though Clerk UI state looks fine in the renderer.

## Clerk Upgrade Checklist

Electron auth depends on Clerk internals more than normal web flows do.

When upgrading Clerk:

1. Re-check `@clerk/clerk-js/headless` imports.
2. Re-check `__unstable__onBeforeRequest`.
3. Re-check `__unstable__onAfterResponse`.
4. Re-check that the auth token still returns on response headers.
5. Re-run packaged Electron auth.

Do not assume a successful web or localhost test is enough after a Clerk upgrade.

## Useful Files To Open During Incidents

- `apps/electron/src/lib/auth.ts`
- `apps/electron/src/main.tsx`
- `apps/electron/src/lib/clerkElectron.ts`
- `apps/electron/src/lib/clerkElectronFetch.ts`
- `apps/electron/src/hooks/useAuthDeepLink.ts`
- `apps/electron/electron/main.ts`
- `apps/marketing/app/auth/electron/page.tsx`
- `apps/marketing/app/auth/electron/actions.ts`
- `convex/auth.config.ts`
- `convex/github.ts`

## Fast Validation

For code changes:

```bash
pnpm --filter @hypersurge/electron typecheck
pnpm --filter @hypersurge/electron build:ci
```

For Clerk transport changes:

```bash
pnpm --filter @hypersurge/electron exec vitest run src/__tests__/lib/clerkElectronFetch.test.ts
```

For true production confidence:
- use a packaged Electron build
- complete the full browser sign-in flow
- verify both signed-in UI state and GitHub repo access
