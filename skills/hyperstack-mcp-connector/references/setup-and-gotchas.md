# Setup, configuration, and gotchas

The MCP route + bridge code is most of the work, but four things must be wired by
hand. Skipping any one produces a connector that *looks* configured but fails at
connect or call time.

## 1. Convex trusts the bridge issuer

Add a `customJwt` provider to `convex/auth.config.ts`, gated on env so an
un-provisioned deployment never carries a broken provider. This sits alongside
your existing Clerk provider(s).

```ts
// convex/auth.config.ts
const providers = [
  // ...your existing Clerk provider(s)...
];

if (process.env.CONVEX_BRIDGE_ISSUER && process.env.CONVEX_BRIDGE_JWKS_URL) {
  providers.push({
    type: "customJwt",
    issuer: process.env.CONVEX_BRIDGE_ISSUER,      // == CONVEX_BRIDGE_ISSUER on the Next side
    jwks: process.env.CONVEX_BRIDGE_JWKS_URL,       // https://your-app.com/api/mcp/jwks
    algorithm: "RS256",
  });
}

export default { providers };
```

Set the Convex env vars (per deployment — dev and prod are separate):

```bash
npx convex env set CONVEX_BRIDGE_ISSUER   https://your-app.com/mcp
npx convex env set CONVEX_BRIDGE_JWKS_URL https://your-app.com/api/mcp/jwks
```

And on the Next.js/Vercel side: `CONVEX_BRIDGE_PRIVATE_KEY`, `CONVEX_BRIDGE_ISSUER`
(same value as Convex's), optional `CONVEX_BRIDGE_KID`.

> The issuer is an **opaque identifier** — `customJwt` only string-matches it
> against the token's `iss` claim. It does **not** need to resolve to a real URL
> (e.g. `https://your-app.com/mcp` need not be a route). Only
> `CONVEX_BRIDGE_JWKS_URL` is actually fetched. Just keep the Next and Convex
> `CONVEX_BRIDGE_ISSUER` values byte-identical.

## 2. The new routes must be public in middleware

`clerkMiddleware()` protects everything by default. The connector + its discovery
metadata + JWKS are credential-authenticated (no Clerk *session*), so exempt them.

```ts
// middleware.ts (or proxy.ts)
const isPublicRoute = createRouteMatcher([
  // ...existing public routes...
  "/api/mcp(.*)",                                    // the connector + /api/mcp/jwks
  "/.well-known/oauth-authorization-server(.*)",
  "/.well-known/oauth-protected-resource(.*)",
]);
```

## 3. Enable Dynamic Client Registration in Clerk (one-time, manual)

Claude/ChatGPT register themselves as OAuth clients on the fly, so the Clerk
authorization server must allow DCR.

- Clerk Dashboard → **Configure → OAuth applications → Settings** → toggle on
  **Dynamic client registration** → acknowledge the warning → **Save**.
- This opens a public client-registration endpoint; Clerk **forces the OAuth
  consent screen** on (the main mitigation). Brand that consent screen under
  **Configure → Account Portal → Customization** (logo lives with the OAuth
  client, not here; colors do).
- Verify: the `registration_endpoint` appears in
  `/.well-known/oauth-authorization-server` (see well-known-routes.md).
- Non-DCR alternative: pre-create an OAuth application in Clerk and paste its
  client id/secret into the client's "advanced" connector fields — avoids the
  public endpoint but doesn't scale to "anyone adds it."

## 4. Deploy, then add the connector

```bash
vercel --prod
```

In **Claude** (or ChatGPT): Settings → Connectors → **Add custom connector** →
Remote MCP server URL `https://your-app.com/api/mcp` (no token). It redirects to
Clerk sign-in + consent → Allow → connected. Run `whoami` to confirm identity.

## Gotchas (hard-won)

- **Clerk version:** needs `auth({ acceptsToken: "oauth_token" })` and
  `@clerk/mcp-tools` (peer `@clerk/nextjs` ^7.2.3+). Older Clerk lacks the
  machine/OAuth-token verification path.
- **Pin `@clerk/mcp-tools` and read the user id from the right field.** This skill
  was validated against `@clerk/mcp-tools@0.5.0` + `mcp-handler@1.x`, where
  `verifyClerkToken(...)` surfaces the Clerk user id as **`info.extra.userId`**.
  That field name is version-sensitive — if a newer version moves it, `verifyToken`
  returns `undefined` and **every call 401s with no other symptom**. Pin the
  version, or log `info` once and confirm where the user id lands.
- **Resource = origin:** `protectedResourceHandlerClerk` reports the resource as
  the request origin. The MCP route's `resourceMetadataPath` must point at the
  protected-resource route you actually created, or discovery 401-loops.
- **Convex subject must match:** the bridge JWT's `sub` is the Clerk user id. If
  your owner-scoped Convex functions key on the Clerk user id (the normal Clerk +
  Convex setup), they work unchanged. If they key on something else, map it in
  `signConvexBridgeJwt`.
- **`opaque` vs JWT OAuth tokens:** leave Clerk's "Generate access tokens as JWTs"
  OFF. `verifyClerkToken` validates opaque tokens via Clerk introspection — no
  extra config needed.
- **ChatGPT:** the same server works, but ChatGPT's Apps SDK has its own metadata
  conventions and (for some connector types) expects `search` + `fetch` tools.
  Treat "works in ChatGPT" as a thin adapter on top, not automatic.
- **Cost:** Clerk machine/OAuth tokens are free in beta, priced at GA — confirm
  before relying on high volume.

## Test the round-trip

```bash
# Discovery (no auth):
curl -s https://your-app.com/.well-known/oauth-protected-resource/mcp | jq

# 401 without a token (expected — withMcpAuth requires it):
curl -s -o /dev/null -w "%{http_code}\n" https://your-app.com/api/mcp
```

The full OAuth flow (DCR → authorize → consent → token) is exercised by the
client when you add the connector; `whoami` returning your email proves the
Clerk-identity → bridge-JWT → Convex-`ctx.auth` chain end to end.
