# Concrete patterns

Working code extracted from a production Next.js (App Router) + Clerk + Convex app.
Adapt names/styling; the mechanics are the point.

## Middleware: waitlist as the front door

```ts
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// sign-up stays public so Clerk invitation links with a __clerk_ticket can
// complete; /waitlist is the signed-out landing.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/waitlist(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    const { userId } = await auth();
    if (!userId) {
      // Strangers land on the waitlist pitch, not the sign-in card. The
      // original destination rides along as redirect_url so the waitlist
      // page's "sign in" link can restore deep links for signed-out users.
      const waitlistUrl = new URL("/waitlist", request.url);
      waitlistUrl.searchParams.set("redirect_url", request.url);
      return NextResponse.redirect(waitlistUrl);
    }
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\.).*)", "/(api|trpc)(.*)"],
};
```

## Waitlist landing page

```tsx
// app/waitlist/page.tsx
import { Waitlist } from "@clerk/nextjs";
import Link from "next/link";

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const { redirect_url } = await searchParams;
  const signInHref = redirect_url
    ? `/sign-in?redirect_url=${encodeURIComponent(redirect_url)}`
    : "/sign-in";

  return (
    <main className="min-h-screen grid place-items-center px-4 py-12">
      <div className="w-full max-w-[440px] text-center">
        <h1>your-app</h1>
        <p>invite-only beta</p>
        <p>{/* one-paragraph pitch */}</p>
        <p>Leave your email and we&apos;ll send you an invite.</p>
        <Waitlist />
        <p>
          Already have access? <Link href={signInHref}>Sign in</Link>
        </p>
      </div>
    </main>
  );
}
```

## Provider

```tsx
// waitlistUrl: instance sign_up_mode is "waitlist", so Clerk components
// link "Join waitlist" here instead of a sign-up link.
<ClerkProvider waitlistUrl="/waitlist">
```

## In-app invite send path (Convex)

Mutation side — decide whether the invitee needs a Clerk invitation, then
schedule the email action:

```ts
// convex/members.ts (inside the invite mutation, after inserting the row)
const existing = await ctx.db
  .query("users")
  .withIndex("by_email", (q) => q.eq("email", normalized))
  .first();
await ctx.scheduler.runAfter(0, internal.inviteEmail.send, {
  to: normalized,
  url: acceptUrl(token),          // <base>/invite/<token>
  inviteId,                        // to stamp the Clerk invitation id back
  newUser: existing === null,
});
```

Action side — mint the ticket and use it as the email CTA:

```ts
// convex/inviteEmail.ts
const CLERK_API = "https://api.clerk.com/v1";

async function createClerkInvitation(
  email: string,
  acceptUrl: string
): Promise<{ id: string; url: string } | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    console.warn("Clerk invitation skipped — CLERK_SECRET_KEY not set");
    return null; // caller falls back to the plain accept link
  }
  const origin = new URL(acceptUrl).origin;
  // Ticket flow: Clerk appends __clerk_ticket to this URL; <SignUp /> on
  // /sign-up consumes it (bypassing waitlist/restricted mode), then honors
  // the nested redirect_url back to the accept page.
  const redirectUrl = `${origin}/sign-up?redirect_url=${encodeURIComponent(acceptUrl)}`;
  const res = await fetch(`${CLERK_API}/invitations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: email,
      redirect_url: redirectUrl,
      notify: false,          // we send our own branded email
      ignore_existing: true,
      expires_in_days: 14,    // match the app invite's TTL
    }),
  });
  if (!res.ok) {
    // e.g. email already belongs to a Clerk user our table hasn't synced —
    // the plain accept link works for them, so this is non-fatal.
    console.warn(`Clerk invitation failed: HTTP ${res.status}`);
    return null;
  }
  const inv = (await res.json()) as { id: string; url?: string };
  return inv.url ? { id: inv.id, url: inv.url } : null;
}

// In the send handler:
let ctaUrl = args.url;
if (args.newUser) {
  const clerkInv = await createClerkInvitation(args.to, args.url);
  if (clerkInv) {
    ctaUrl = clerkInv.url; // https://<fapi>/v1/tickets/accept?ticket=...
    await ctx.runMutation(internal.members.stampClerkInvitation, {
      id: args.inviteId,
      clerkInvitationId: clerkInv.id,
    });
  }
}
// ...email ctaUrl as the button href
```

## Revoke linkage

```ts
// In the app's revoke mutation, after stamping revokedAt:
if (inv.clerkInvitationId && !inv.acceptedAt) {
  await ctx.scheduler.runAfter(0, internal.inviteEmail.revokeClerkInvitation, {
    clerkInvitationId: inv.clerkInvitationId,
  });
}

// The action:
await fetch(`${CLERK_API}/invitations/${clerkInvitationId}/revoke`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secretKey}` },
});
// Non-2xx (already accepted/revoked) is fine — log and move on.
```

Schema: add `clerkInvitationId: v.optional(v.string())` to the invites table.

## Ops one-liners

Prereqs: `npm i -g clerk && clerk login`, find ids with `clerk apps list`.
(Dashboard fallback: sign-up mode under Configure → Restrictions; secret key
under Configure → API Keys.)

```bash
# Flip both instances (dry-run first, then --yes):
clerk config patch --app <app_id> --instance dev  --json '{"auth_access_control":{"sign_up_mode":"waitlist"}}' --yes
clerk config patch --app <app_id> --instance prod --json '{"auth_access_control":{"sign_up_mode":"waitlist"}}' --yes

# Secret key onto Convex (dev + prod deployments):
clerk env pull --app <app_id> --instance dev --file /tmp/ck.env && \
  npx convex env set CLERK_SECRET_KEY "$(grep '^CLERK_SECRET_KEY=' /tmp/ck.env | cut -d= -f2-)" && rm /tmp/ck.env
clerk env pull --app <app_id> --instance prod --file /tmp/ck.env && \
  npx convex env set --prod CLERK_SECRET_KEY "$(grep '^CLERK_SECRET_KEY=' /tmp/ck.env | cut -d= -f2-)" && rm /tmp/ck.env

# Manually invite one email (bypasses the gate; Clerk sends the email):
clerk api /invitations --instance prod -d '{"email_address":"a@b.co","notify":true}' --yes
```

## Test: revoke closes the Clerk side too (convex-test)

```ts
test("revoking an invite with a Clerk invitation schedules its revoke", async () => {
  const t = convexTest(schema, modules);
  const owner = await seedUser(t, "owner", "Camp");
  await owner.as.mutation(api.members.invite, { email: "new@x.com" });
  const inviteId = await t.run(
    async (ctx) => (await ctx.db.query("campaignInvites").collect())[0]._id
  );
  await t.mutation(internal.members.stampClerkInvitation, {
    id: inviteId,
    clerkInvitationId: "inv_clerk123",
  });
  await owner.as.mutation(api.members.revokeInvite, { id: inviteId });
  const scheduled = await t.run(
    async (ctx) => await ctx.db.system.query("_scheduled_functions").collect()
  );
  expect(
    scheduled.filter((s) => s.name.includes("revokeClerkInvitation"))
  ).toHaveLength(1);
});
```
