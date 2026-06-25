# OAuth discovery metadata routes

Two tiny routes from `@clerk/mcp-tools/next`. They let MCP clients (Claude,
ChatGPT) discover that **Clerk** is the authorization server, then run the OAuth
flow. Both must be publicly reachable (see the middleware section in
`setup-and-gotchas.md`).

`protectedResourceHandlerClerk` reports the resource as the request **origin**,
so the `resourceMetadataPath` in the MCP route must match where you place the
protected-resource route below.

## `app/.well-known/oauth-authorization-server/route.ts`

```ts
import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";

const handler = authServerMetadataHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
```

## `app/.well-known/oauth-protected-resource/mcp/route.ts`

```ts
import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next";

const handler = protectedResourceHandlerClerk({ scopes_supported: ["profile", "email"] });
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
```

## Verify after deploy

```bash
curl -s https://your-app.com/.well-known/oauth-protected-resource/mcp | jq
# resource:               https://your-app.com
# authorization_servers:  ["<your Clerk Frontend API host>"]
#   dev:  https://<slug>.clerk.accounts.dev
#   prod: https://clerk.your-app.com  (only with a production custom domain)
# Seeing the .accounts.dev host in dev is correct, not a misconfiguration.

curl -s https://your-app.com/.well-known/oauth-authorization-server | jq
# issuer / authorize / token / registration_endpoint all on your Clerk instance.
# registration_endpoint present == Dynamic Client Registration is ON (required).
```
