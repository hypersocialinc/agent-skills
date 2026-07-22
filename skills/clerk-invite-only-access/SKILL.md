---
name: clerk-invite-only-access
description: Use when making a Clerk-authenticated app invite-only or waitlist-gated — blocking self-serve sign-ups, approving users by email, seeding specific emails, or when an app's own "invite by email" feature breaks with "Sign-ups are currently unavailable" because waitlist/restricted mode blocks new accounts. Applies to Next.js + Clerk apps, including Convex backends.
---

# Clerk Invite-Only Access

Gate account **creation** at Clerk, not access inside the app. With the right sign-up mode, unapproved people never get an account (no user rows, no per-user costs, no cleanup), existing users are untouched, and Clerk invitation tickets punch controlled holes through the gate. Do NOT build a custom waitlist table + admin UI first — Clerk ships the whole loop.

## Choose a sign-up mode

The instance setting is `auth_access_control.sign_up_mode`: `"public" | "restricted" | "waitlist"`.

| Mode | Behavior | Pick when |
|---|---|---|
| `waitlist` | Strangers submit email via Clerk's `<Waitlist />` component; you approve in Dashboard → Users → Waitlist; approval auto-emails an invite | You want to capture interested emails (default pick) |
| `restricted` | No self-serve path at all; accounts only via Clerk invitations | Hard-closed beta, no email capture |
| `public` | Anyone signs up | Revert switch |

Both modes: sign-in is untouched; **Clerk invitations bypass the gate** — their ticket link works even when sign-ups are blocked.

## Flip the mode

The setting is **instance config** (Clerk Platform API), NOT the Backend API — there is no BAPI endpoint for it; don't invent `PATCH /v1/instance/restrictions`. Use the dashboard (Configure → Restrictions → Sign-up mode) or the `clerk` CLI:

```bash
clerk config patch --app <app_id> --instance dev \
  --json '{"auth_access_control":{"sign_up_mode":"waitlist"}}' --dry-run
# then re-run with --yes, and repeat with --instance prod
```

**Dev and prod are separate instances — flip both.** Verify with `clerk config pull`.

## Wire the app (waitlist mode)

Four small changes — see `references/patterns.md` for complete code:

1. **`/waitlist` page** rendering `<Waitlist />` from `@clerk/nextjs`, with your pitch copy. Add to middleware public routes.
2. **`waitlistUrl="/waitlist"` on `<ClerkProvider>`** — makes `<SignIn />` show "Join waitlist" instead of a sign-up link.
3. **Middleware redirects signed-out visitors to `/waitlist`** (not sign-in) carrying `?redirect_url=<original>`; the page's "Already have access? Sign in" link forwards it so deep links survive. Otherwise strangers bounce off the sign-in card's red "Sign-ups are currently unavailable" error.
4. **Keep `/sign-up` public** — invitation ticket links land there with `__clerk_ticket`, which `<SignUp />` consumes automatically.

## In-app invites must mint Clerk invitations

If the app has its own "invite by email" feature (own token + accept page), a brand-new invitee can't accept — the gate blocks their sign-up. Fix in the send path:

1. If the email already has a user (check your synced users table), send the plain accept link — done.
2. Otherwise `POST https://api.clerk.com/v1/invitations` (Backend API, `CLERK_SECRET_KEY`) with `notify: false` (send your own branded email), `ignore_existing: true`, expiry matching your app token's TTL, and `redirect_url: "<origin>/sign-up?redirect_url=<encoded accept-page URL>"`.
3. The response's `url` field is a ticket link — use it as the email CTA. Flow: ticket → sign-up (bypasses gate) → redirect to your accept page → app-level accept.
4. Store the invitation `id` on your invite row; when the app invite is revoked, also `POST /v1/invitations/{id}/revoke`, or the emailed ticket can still mint an account.
5. If invitation creation fails (e.g. email already a Clerk user your table hasn't synced), fall back to the plain link — it still works for account-holders.

## Rollout order

Deploy the app changes first (harmless while mode is still `public`), backend before web if they're deployed separately, then flip the mode **last** — flipping first strands strangers on the sign-in card's error before the waitlist page exists.

## Verify

- Incognito: `/` redirects to `/waitlist`; direct `/sign-up` and OAuth refuse account creation.
- Waitlist submit → approve in dashboard → invite email → account created → lands in your DB via webhook.
- In-app invite to a fresh email: CTA is a `…/v1/tickets/accept?ticket=…` URL; completes sign-up despite the gate; auto-accepts into the app. Revoke, then click: refused at sign-up.
- Existing user signs in unaffected.

## Gotchas

- **Seeding yourself:** emails with existing accounts need nothing — the gate only blocks account *creation*.
- **Tickets are email-bound.** A Clerk invitation belongs to one email; the ticket sign-up locks that address, so a forwarded link can't register a different email. Someone wanting to sign up as a different address is a new request (waitlist). Revoking closes the door for that invitation's ticket — not for other pending invitations to the same email (`ignore_existing: true` permits duplicates; if multiple app invites can target one email, revoke should sweep all of them).
- **Keep the app's accept page protected** (not a public route): signed-out existing users flow waitlist → sign in → back via `redirect_url`; new users arrive already-authenticated via the ticket.
- Waitlist-approval emails link through Clerk's hosted Account Portal by default — works out of the box; customize under Dashboard → Customization → Emails if you want branded copy.
- Backend link URLs are built from your configured base URL (e.g. `APP_BASE_URL`) — on localhost, swap the origin manually when testing emailed links.
- Client mutations fired on the accept page can race the Clerk↔backend auth handshake on fresh loads — gate on the authenticated state (Convex: `useConvexAuth().isAuthenticated`), not on mount.
- Revoking an invitation can't delete an account it already created — that's a separate remove/ban action.
- Set `CLERK_SECRET_KEY` in the backend env (e.g. both Convex dev AND prod deployments); code should soft-fallback with a logged warning when it's missing.
