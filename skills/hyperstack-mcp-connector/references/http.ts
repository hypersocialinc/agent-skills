// convex/http.ts (the MCP mount — add these routes to your existing httpRouter)
//
// Serves the connector at `<deployment>.convex.site/mcp/` plus its OAuth
// protected-resource discovery. `requireAuth: true` makes anonymous POSTs 401
// with a WWW-Authenticate header, which is what browser MCP clients (claude.ai)
// need to START the OAuth flow — without it they see an empty tools/list and
// never prompt a login.

import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import {
  authorize,
  gateway,
  initializeInstructions,
  resolveClerkIdentity,
  tools,
} from "./mcp";

const http = httpRouter();

// Point OAuth discovery at Clerk (auth server) + this deployment (resource).
// Env-driven so dev and prod carry their own values; a no-op when unset, so an
// un-provisioned deployment simply serves no connector. Idempotent — safe per
// request. MCP_RESOURCE_URL is optional (the gateway derives it from the request
// origin); set it if you front the deployment with a custom domain.
async function syncMcpOAuthConfig(ctx: ActionCtx): Promise<void> {
  const authServerUrl =
    process.env.MCP_AUTH_SERVER_URL ?? process.env.CLERK_JWT_ISSUER_DOMAIN;
  if (!authServerUrl) return;
  const resourceUrl = process.env.MCP_RESOURCE_URL;
  await gateway.setOAuthConfig(ctx, {
    authServerUrl,
    ...(resourceUrl ? { resourceUrl } : {}),
  });
}

// Browser MCP clients read `mcp-session-id` and `www-authenticate` off CORS
// responses; expose them or the handshake / OAuth challenge is invisible.
function withMcpExposedHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const exposed = new Set(
    (headers.get("access-control-expose-headers") ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
  exposed.add("mcp-session-id");
  exposed.add("www-authenticate");
  headers.set("access-control-expose-headers", [...exposed].join(", "));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const mcpHandler = httpAction(async (ctx, request) => {
  await syncMcpOAuthConfig(ctx);
  const response = await gateway.handleMcpRequest(ctx, request, {
    authorize,
    tools, // registry auto-syncs on `initialize` — no separate registration step
    cors: true,
    resolveIdentity: resolveClerkIdentity,
    requireAuth: true,
    serverInfo: { name: "yourapp", version: "0.1.0" },
    initializeInstructions,
  });
  return withMcpExposedHeaders(response);
});

const mcpMetadataHandler = httpAction(async (ctx, request) => {
  await syncMcpOAuthConfig(ctx);
  return await gateway.serveProtectedResourceMetadata(ctx, request);
});

// Mount both /mcp/ and /mcp — some clients (claude.ai) strip the trailing slash.
for (const path of ["/mcp/", "/mcp"]) {
  http.route({ path, method: "POST", handler: mcpHandler });
  http.route({ path, method: "GET", handler: mcpHandler });
  http.route({ path, method: "DELETE", handler: mcpHandler });
  http.route({ path, method: "OPTIONS", handler: mcpHandler });
}
http.route({
  pathPrefix: "/.well-known/oauth-protected-resource/",
  method: "GET",
  handler: mcpMetadataHandler,
});
http.route({
  pathPrefix: "/.well-known/oauth-protected-resource/",
  method: "OPTIONS",
  handler: mcpMetadataHandler,
});

export default http;
