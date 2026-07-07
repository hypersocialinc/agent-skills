---
name: hyperstack-mcp-connector
description: Use when exposing Convex functions as OAuth-secured tools that Claude, ChatGPT, or another MCP client can call as the signed-in user — i.e. building a remote/hosted MCP connector for a Convex + Clerk app, adding Clerk OAuth to an MCP server, or wiring a "save to / do X in / recall from <your app>" connector. Stack-specific — Convex + Clerk.
---

# Hyperstack MCP Connector

## Overview

Expose Convex functions as tools that Claude and ChatGPT can call **as the
signed-in user**, over a hosted remote MCP server with real OAuth. One server
works across every MCP client. The whole thing lives **inside Convex** — no
separate web server, no bridge, no keypair.

Built on the **`convex-mcp-gateway`** component. It hosts the MCP server as a
Convex `httpAction`, handles the JSON-RPC/Streamable-HTTP protocol, the OAuth
discovery doc, and an audit log. You supply three things:

1. **Tools** — `defineMcpQuery` / `defineMcpMutation` / `defineMcpAction` map a
   Convex function to a tool. Each identity-scoped tool takes an injected
   `caller` arg (`identityArg`), because Convex strips `ctx.auth` across the
   component boundary — so you scope on `caller.subject`, not `ctx.auth`.
2. **Identity** — a `resolveIdentity` that validates Clerk's **opaque** OAuth
   access token at Clerk's OIDC **userinfo** endpoint and returns
   `{ subject, claims }`. Clerk is the OAuth authorization server (with Dynamic
   Client Registration); the gateway is the resource server.
3. **Mount** — one `httpAction` in `convex/http.ts` that calls
   `gateway.handleMcpRequest(...)`, plus the protected-resource discovery route.

```
Claude/ChatGPT --OAuth (DCR)--> Clerk (authorization server)
      |  opaque access token
      v
convex.site/mcp  (gateway httpAction, requireAuth)
      |  resolveIdentity → Clerk userinfo → { subject }
      v
gateway injects `caller` → internal Convex fn scopes by caller.subject
      (runs as that user; every owner-scoped function works unchanged)
```

## When to use

- You want an AI client to *do something* in your app (save, fetch, recall,
  trigger) and have it run as the actual user.
- Your backend is **Convex + Clerk** — Convex is your source of truth.
- You want it addable in Claude **and** ChatGPT without per-client backends.

**Not for:** local stdio MCP servers (no OAuth needed — a token is enough); apps
not on Convex+Clerk (the identity resolver assumes Clerk; the tool model assumes
Convex components); read-only public data with no user identity (skip OAuth
entirely).

> Why not host the MCP server in a Next.js/Vercel route and bridge to Convex? You
> can, but for a Convex-centric app it adds a separate server, a signed bridge JWT,
> a JWKS endpoint, and key rotation — all to reproduce an identity Convex can
> already carry. The gateway keeps everything in `convex/`.

## Build steps

1. **Install + register:** `npm install convex-mcp-gateway`, then `app.use(mcpGateway)`
   in `convex/convex.config.ts` (`setup-and-gotchas.md` §1).
2. **Tools** — copy `references/mcp.ts` to `convex/mcp.ts`. Replace the sample
   tools with one `defineMcp{Query,Mutation,Action}` per function you expose. Every
   identity-scoped tool declares `caller: mcpCallerValidator` + `identityArg: "caller"`
   and points `fn` at an **internal** function. Keep `authorize`, `resolveClerkIdentity`,
   and `initializeInstructions`.
3. **Tool impls** — copy `references/mcp-tools.ts` to `convex/mcpTools.ts`. These are
   `internalQuery`/`internalMutation`/`internalAction`s that owner-scope by
   `caller.subject` (map it to your user via whatever index keys users on the Clerk id).
4. **Mount** — merge `references/http.ts` into `convex/http.ts` (the `/mcp` routes +
   protected-resource discovery + `requireAuth` + exposed headers).
5. **Env** — set `MCP_AUTH_SERVER_URL` (your Clerk issuer) per deployment, or rely on
   an existing `CLERK_JWT_ISSUER_DOMAIN` (`setup-and-gotchas.md` §2).
6. **Enable Dynamic Client Registration** in the Clerk dashboard — required, one
   manual toggle; leave "access tokens as JWTs" OFF (`setup-and-gotchas.md` §3).
7. **Deploy** (`npx convex deploy`), then **add the connector** at
   `https://<deployment>.convex.site/mcp` in Claude/ChatGPT (`setup-and-gotchas.md` §4).

## Reference files

| File | Goes to | What it is |
|------|---------|------------|
| `references/mcp.ts` | `convex/mcp.ts` | gateway + tool descriptors + `authorize` + `resolveClerkIdentity` (Clerk userinfo) + `initializeInstructions` |
| `references/mcp-tools.ts` | `convex/mcpTools.ts` | the **internal** tool impls, owner-scoped by the injected `caller.subject` |
| `references/http.ts` | `convex/http.ts` | the `/mcp` mount + OAuth discovery route + `requireAuth` + exposed headers |
| `references/setup-and-gotchas.md` | — | `convex.config`, env, Clerk DCR, deploy, add-connector, gotchas, round-trip test |

## Common mistakes

- **Reading the user from `ctx.auth` in a tool** → always null. The gateway strips
  `ctx.auth` across the component boundary; use the injected `caller` arg.
- **Exposing tool functions as `public` (api.*)** → any Convex client can call them
  with a forged `caller` and read another user's data. Make them `internal`.
- **Skipping Dynamic Client Registration** in Clerk (or leaving it unsaved) → the
  client can't register, OAuth never starts. `registration_endpoint` must appear in
  Clerk's **oauth-authorization-server** metadata (not openid-configuration).
- **Omitting `requireAuth: true`** → browser clients (claude.ai) see an empty
  `tools/list`, think they're connected, and never start OAuth (they only react to a 401).
- **Not exposing `mcp-session-id` / `www-authenticate`** on CORS → the browser client
  can't read the session or the auth challenge.
- **Convex `subject` mismatch** → tools authenticate but owner-scoped queries return
  nothing. `caller.subject` (the Clerk user id) must be what your functions key on.
- **Weak tool descriptions** → the model defaults to web search instead of your
  connector. Name the concrete data and say *when* to use it; set
  `initializeInstructions`. Re-sync by starting a **new** chat after changing them.

See `references/setup-and-gotchas.md` for the full gotcha list (opaque-vs-JWT
tokens, the circular-type annotation, ChatGPT caveats, DCR verification) and the
round-trip test.

## Reference implementation

Padscanner's connector (github.com/tfohlmeister/convex-mcp-gateway is the
component; padscanner exposes its rental-search tools to Claude as the signed-in
user) is built exactly this way and runs in production — the same pattern powers a
savethis "save & recall from Claude" connector. Use it as the worked example, but
keep this skill stack-generic.
