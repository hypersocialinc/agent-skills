---
name: hyperstack-mcp-connector
description: Use when exposing a Convex action as an OAuth-secured tool that Claude, ChatGPT, or another MCP client can call as the signed-in user — i.e. building a remote/hosted MCP connector for a Next.js + Convex + Clerk app on Vercel, adding Clerk OAuth to an MCP server, or wiring a "Send to <your app>" / "do X in <your app>" connector. Stack-specific — Next.js + Convex + Clerk + Vercel.
---

# Hyperstack MCP Connector

## Overview

Turn a Convex action into a tool that Claude and ChatGPT can call **as the
signed-in user**, over a hosted remote MCP server with real OAuth. One server
works across every MCP client.

Three layers, each delegated to a library so there is little custom auth code:

1. **MCP transport** — `mcp-handler` exposes tools over Streamable HTTP at
   `/api/mcp` on Next.js/Vercel.
2. **OAuth** — **Clerk is the authorization server** (`@clerk/mcp-tools`). It
   handles dynamic client registration, authorize, token, and discovery
   metadata. The route just *verifies* Clerk's access token.
3. **Convex bridge** — verify the Clerk token → mint a short-lived RS256 JWT
   whose `sub` is the Clerk user id → call Convex with it. Convex trusts that
   JWT via a `customJwt` provider, so the action runs with a real `ctx.auth`
   identity and every owner-scoped function works unchanged.

```
Claude/ChatGPT --OAuth--> Clerk (authorization server)
      |  access token
      v
/api/mcp (mcp-handler + verifyClerkToken)  --mint bridge JWT (sub=clerk user)-->
      Convex action (ctx.auth == that user)
```

## When to use

- You want an AI client to *do something* in your app (create, import, fetch,
  trigger) and have it run as the actual user.
- You have a Next.js + Convex + Clerk app on Vercel (the "hyperstack").
- You want it addable in Claude **and** ChatGPT without per-client backends.

**Not for:** local stdio MCP servers (no OAuth needed — a token is enough);
apps not on Convex+Clerk (the bridge assumes both); read-only public data with no
user identity (skip OAuth entirely).

## Build steps

1. **Install:** `mcp-handler @clerk/mcp-tools jose @modelcontextprotocol/sdk`
   (pin `@clerk/mcp-tools` — the user-id field is version-sensitive; see gotchas).
2. **MCP route** — copy `references/mcp-route.ts` to `app/api/mcp/route.ts` (static,
   not `[transport]` — see the file's header for why). Replace the `do_the_thing`
   tool with one `server.tool(...)` per Convex action you expose. Keep `whoami`.
3. **Discovery metadata** — add the two routes in `references/well-known-routes.md`.
4. **Convex bridge** — copy `references/convex-bridge-jwt.ts` to `lib/` and
   `references/jwks-route.ts` to `app/api/mcp/jwks/route.ts`. Generate an RS256
   keypair; set `CONVEX_BRIDGE_*` env (see `setup-and-gotchas.md`).
5. **Trust the bridge in Convex** — add the `customJwt` provider + Convex env
   (`setup-and-gotchas.md` §1).
6. **Make the new routes public** in `clerkMiddleware` (`setup-and-gotchas.md` §2).
7. **Enable Dynamic Client Registration** in the Clerk dashboard — required, one
   manual toggle (`setup-and-gotchas.md` §3).
8. **Deploy** to Vercel, then **add the connector** by URL in Claude/ChatGPT
   (`setup-and-gotchas.md` §4).

## Reference files

| File | What it is |
|------|------------|
| `references/mcp-route.ts` | The connector route: `mcp-handler` + `verifyClerkToken` + bridge mint + sample action-backed tool + `whoami` |
| `references/convex-bridge-jwt.ts` | The jose RS256 signer + public JWKS (the Clerk→Convex bridge) |
| `references/jwks-route.ts` | Public JWKS endpoint Convex reads to verify bridge JWTs |
| `references/well-known-routes.md` | The two OAuth discovery metadata routes |
| `references/setup-and-gotchas.md` | Convex `auth.config`, middleware, env, Clerk DCR, deploy, add-connector, gotchas, tests |

## Common mistakes

- **Skipping Dynamic Client Registration** in Clerk → the client can't register,
  OAuth never starts. The `registration_endpoint` must appear in the
  authorization-server metadata.
- **Forgetting the public-route exemptions** → `/api/mcp`, `/.well-known/*`, and
  the JWKS endpoint get caught by `clerkMiddleware` and 404/redirect.
- **`resourceMetadataPath` not matching** the protected-resource route → 401
  discovery loop.
- **Convex `sub` mismatch** → tools authenticate but owner-scoped queries return
  nothing. The bridge `sub` must be what your Convex functions key users on.

See `references/setup-and-gotchas.md` for the full gotcha list (Clerk version,
opaque-vs-JWT tokens, ChatGPT caveats, token pricing) and the round-trip test.

## Reference implementation

Hyperdecks' "Send to Hyperdecks" connector (imports a Claude Design deck into
Hyperdecks from inside Claude Design) is built exactly this way and runs in
production — use it as the worked example, but keep this skill stack-generic.
