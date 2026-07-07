# Setup, configuration, and gotchas

The code (`mcp.ts` + `mcp-tools.ts` + `http.ts`) is most of the work. A few things
are wired by hand — skipping any one produces a connector that *looks* configured
but fails at connect or call time.

## 1. Install + register the component

```bash
npm install convex-mcp-gateway   # a Convex Component
```

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import mcpGateway from "convex-mcp-gateway/convex.config";

const app = defineApp();
app.use(mcpGateway);          // alongside any other components you use
export default app;
```

## 2. Env vars (per deployment — dev and prod are separate)

```bash
npx convex env set MCP_AUTH_SERVER_URL https://<your-clerk-frontend-api-domain>
# e.g. https://your-slug.clerk.accounts.dev (dev) or https://clerk.yourapp.com (prod)
```

- `MCP_AUTH_SERVER_URL` — your Clerk issuer / Frontend API domain. Advertised as the
  OAuth authorization server **and** used to discover Clerk's userinfo endpoint
  (`resolveClerkIdentity`). If your app already sets `CLERK_JWT_ISSUER_DOMAIN` for
  Convex auth, the code falls back to it and you may not need to set anything.
- `MCP_RESOURCE_URL` — *optional*. The gateway derives the resource from the request
  origin (`<deployment>.convex.site/mcp/`); set this only if you front the
  deployment with a custom domain.

Set these on **each** deployment that will serve the connector. There's no
private-key/JWKS to manage — the gateway validates tokens via Clerk's userinfo, so
there is no bridge keypair to generate or rotate.

## 3. Enable Dynamic Client Registration in Clerk (one-time, manual)

Claude/ChatGPT register themselves as OAuth clients on the fly, so Clerk must allow
DCR.

- Clerk Dashboard → **Configure → OAuth applications → Settings** → toggle on
  **Dynamic client registration** → **Save** (easy to leave unsaved — confirm the
  banner clears).
- Leave **"Generate access tokens as JWTs" OFF.** Clerk's opaque OAuth tokens are
  what `resolveClerkIdentity` validates via userinfo; that's the supported path.
- **Verify** DCR is live — the `registration_endpoint` appears in the **OAuth
  authorization-server** metadata (RFC 8414), *not* the OIDC doc:
  ```bash
  curl -s https://<clerk-domain>/.well-known/oauth-authorization-server | jq .registration_endpoint
  # -> "https://<clerk-domain>/oauth/register"   (null/absent means DCR is off)
  ```
  (Checking `/.well-known/openid-configuration` here is a red herring — Clerk lists
  `registration_endpoint` only in the oauth-authorization-server doc.)

## 4. Deploy, then add the connector

```bash
npx convex deploy          # or `npx convex dev --once` for the dev deployment
```

The connector URL is your Convex **`.site`** domain (not `.cloud`, not your web app):

```
https://<deployment>.convex.site/mcp
```

In **Claude** (or ChatGPT): Settings → Connectors → **Add custom connector** →
that URL (no token). It redirects to Clerk sign-in + consent → **Allow** →
connected. Run `whoami` to confirm the identity round-trip.

## Gotchas (hard-won)

- **ctx.auth is stripped across the component boundary.** The gateway dispatches
  your tool functions from inside the component, where Convex does **not** propagate
  the caller's `ctx.auth`. So a tool CANNOT read the user from `ctx.auth` — declare a
  `caller: mcpCallerValidator` arg + `identityArg: "caller"` and scope on
  `caller.subject`. (`ctx.auth` *does* work in the `authorize` callback and the
  `httpAction`, which run host-side — that's why token validation lives there.)
- **Make tool functions `internal`.** Since they trust an injected `caller`, a
  `public` (api.*) function would let any Convex client call them with a **forged**
  `caller` and read another user's data. Reference them as `internal.*`; only the
  gateway can invoke those.
- **Actions that call `internal.*` need an explicit handler return type.** The
  function is part of the same generated `internal` object it references, so
  inference goes circular (TS7022/7023). Annotate `handler: async (ctx, args):
  Promise<...> =>`.
- **`subject` must match how you key users.** `caller.subject` is the Clerk user id.
  If your owner-scoped functions key on the Clerk id (the normal Clerk+Convex setup),
  they work unchanged; otherwise map it in `userIdForCaller`.
- **`requireAuth: true` is required for browser clients (claude.ai).** With an
  all-private server, an anonymous `initialize`/`tools/list` returns 200 with an
  empty list and the client concludes "connected, no tools" — it only starts OAuth on
  a 401. `requireAuth` produces that 401 (+ `WWW-Authenticate`).
- **Expose `mcp-session-id` + `www-authenticate` on CORS** (see
  `withMcpExposedHeaders`) or the browser client can't read the session id or the
  auth challenge.
- **Opaque vs JWT tokens.** Keep Clerk's "Generate access tokens as JWTs" OFF and use
  the `resolveClerkIdentity` userinfo resolver. (Only drop `resolveIdentity` if your
  IdP issues JWTs your `auth.config.ts` already trusts — Clerk OAuth tokens are not
  that.)
- **Tool descriptions decide whether the model reaches for you.** A weak description
  ("list saved items") makes the model default to web search; name the concrete
  things and say *when* to use it, and set `initializeInstructions`. After changing
  them, start a **new** chat — the registry + instructions re-sync on `initialize`,
  which fires per new connection, so an existing session keeps the old copy.
- **ChatGPT** works off the same server, but its Apps SDK has its own metadata
  conventions and (for some connector types) expects `search` + `fetch` tools —
  treat "works in ChatGPT" as a thin adapter, not automatic.

## Round-trip test

```bash
# 401 without a token (expected — requireAuth), with a discovery pointer:
curl -s -D - -o /dev/null -X POST https://<deployment>.convex.site/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | grep -i 'HTTP/\|www-authenticate'
# -> HTTP/2 401  +  www-authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"

# Protected-resource metadata (no auth) advertises Clerk as the auth server:
curl -s https://<deployment>.convex.site/.well-known/oauth-protected-resource/mcp | jq
# -> { "resource": "https://<deployment>.convex.site/mcp/",
#      "authorization_servers": ["https://<clerk-domain>"] }
```

The full OAuth flow (DCR → authorize → consent → token → userinfo) is exercised by
the client when you add the connector; `whoami` returning your identity proves the
Clerk-OAuth → userinfo → `caller.subject` → owner-scoped-Convex chain end to end.
