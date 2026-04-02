---
name: electron-clerk-auth
description: Use when working on HyperCoder's Clerk-based authentication across Electron, the marketing auth page, and Convex. Covers packaged Electron auth, custom protocol and localhost callback flows, Clerk sign-in tokens, production Clerk domain and env wiring, GitHub social token access, and debugging prod-only auth failures.
---

# Electron Clerk Auth

Use this skill for any auth work that touches:
- `apps/electron` Clerk session setup or GitHub connect UI
- `apps/marketing/app/auth/electron` sign-in token issuance
- `convex` auth provider or GitHub token access
- packaged Electron auth failures that do not reproduce on localhost
- Clerk production configuration questions for `clerk.hypercoder.app`

## Workflow

1. Identify the failing layer before editing anything.
   Electron UI entrypoints, Electron main process, marketing auth page, Convex backend, or Clerk dashboard/config.
2. Read the right reference file.
   `references/architecture.md` for end-to-end flow and file ownership.
   `references/production-setup.md` for env vars, Clerk dashboard requirements, and cross-service invariants.
   `references/debugging.md` for symptom-based diagnosis and validation steps.
3. Preserve the current architecture unless you have a strong reason to change it.
   Packaged Electron auth is not standard web Clerk auth. It relies on a localhost callback server, a sign-in token minted on the marketing app, renderer ticket consumption, and a main-process HTTPS fetch proxy for Clerk FAPI requests.
4. Validate at the right level.
   For code-only changes, run Electron typecheck and targeted tests first.
   For transport or auth-init changes, also run `pnpm --filter @hypersurge/electron build:ci`.
   For production-only fixes, prefer a real packaged auth smoke test before declaring success.

## Non-Negotiable Invariants

- Electron does not start GitHub OAuth with `authenticateWithRedirect` inside the renderer.
  It opens the system browser to the marketing auth page.
- The marketing auth page is responsible for the normal web Clerk login and for minting the Clerk `sign_in_token`.
- Electron consumes that token with `signIn.create({ strategy: "ticket", ticket })`.
- Packaged Electron Clerk HTTPS requests are proxied through Electron main to avoid renderer CORS failures.
- Convex must trust the same Clerk issuer domain that the marketing app and Electron build are using.
- Treat Clerk `__unstable__` hooks in Electron as pinned implementation details. Re-verify them on Clerk upgrades.

## Key Files

- `apps/electron/src/main.tsx`
- `apps/electron/src/lib/clerkElectron.ts`
- `apps/electron/src/lib/clerkElectronFetch.ts`
- `apps/electron/src/hooks/useAuthDeepLink.ts`
- `apps/electron/electron/main.ts`
- `apps/marketing/app/auth/electron/page.tsx`
- `apps/marketing/app/auth/electron/actions.ts`
- `convex/auth.config.ts`
- `convex/github.ts`

## Validation Commands

```bash
pnpm --filter @hypersurge/electron typecheck
pnpm --filter @hypersurge/electron exec vitest run src/__tests__/lib/clerkElectronFetch.test.ts
pnpm --filter @hypersurge/electron build:ci
```

If the issue is production-only, do not stop at unit/build validation. Run a packaged Electron sign-in smoke test.
