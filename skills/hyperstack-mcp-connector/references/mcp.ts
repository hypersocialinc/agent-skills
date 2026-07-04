// convex/mcp.ts
//
// The MCP connector, hosted INSIDE Convex via `convex-mcp-gateway`. Declares the
// tools, the authorizer, the Clerk identity resolver, and server-level guidance.
// http.ts mounts it; mcp-tools.ts implements the tools. Table names / tool names
// below are EXAMPLES — swap in your own.

import { v } from "convex/values";
import {
  McpGateway,
  defineMcpAction,
  defineMcpQuery,
  mcpCallerValidator,
  type McpAuthorizerHandler,
  type McpIdentityResolver,
  type McpToolRegistration,
} from "convex-mcp-gateway";
import { components, internal } from "./_generated/api";

export const gateway = new McpGateway(components.mcpGateway);

// One entry per Convex function you expose. Every identity-scoped tool declares a
// `caller: mcpCallerValidator` arg + `identityArg: "caller"`: the gateway strips
// `ctx.auth` across the component boundary, so it INJECTS the resolved
// `{ subject, claims }` here (client-supplied `caller` is dropped — no spoofing).
// `fn` points at an INTERNAL function (internal.*) so no external Convex client
// can call it with a forged caller — only the gateway, holding a handle, can.
export const tools: McpToolRegistration[] = [
  defineMcpQuery({
    name: "search_items",
    // Write descriptions in the user's terms and say WHEN to reach for the tool —
    // this is what makes the model call your connector unprompted instead of the
    // web. Name the concrete things it holds ("saved articles, notes, …").
    description:
      "Search the signed-in user's own saved items by keyword. Use this to recall something THEY saved (e.g. 'that article I saved', 'my notes on X') before searching the web. Returns matching items, most relevant first.",
    fn: internal.mcpTools.searchItems,
    args: {
      caller: mcpCallerValidator,
      query: v.string(),
      limit: v.optional(v.number()),
    },
    identityArg: "caller",
    metadata: { auditArgs: true },
  }),
  defineMcpAction({
    name: "save_item",
    description:
      "Save a note or link to the signed-in user's library. Returns the new item's id.",
    fn: internal.mcpTools.saveItem,
    args: {
      caller: mcpCallerValidator,
      text: v.string(),
    },
    identityArg: "caller",
    // Redact sensitive args from the audit log (they're stored verbatim otherwise).
    metadata: { auditArgs: { redact: ["text"] } },
  }),
  defineMcpQuery({
    name: "whoami",
    description: "Show the identity this connector is authenticated as.",
    fn: internal.mcpTools.whoami,
    args: { caller: mcpCallerValidator },
    identityArg: "caller",
    metadata: { auditArgs: true },
  }),
];

// Deny-by-default. With `requireAuth: true` + `resolveClerkIdentity`, the gateway
// only reaches here with a resolved identity — but gate on it anyway so an
// unauthenticated call can never touch a tool. Runs host-side, where you MAY also
// read ctx.auth / args.toolMetadata for scope/role checks.
export const authorize: McpAuthorizerHandler = async (_ctx, args) => {
  if (!args.identity) return { allowed: false, reason: "Unauthorized" };
  return { allowed: true };
};

// Server-level guidance surfaced in the MCP `initialize` result — the strongest
// lever for getting the model to reach for your connector on its own. Say what
// the connector is the source of truth for, and to consult it BEFORE the web when
// the user refers to their own data.
export const initializeInstructions =
  "This connector is the source of truth for the signed-in user's own saved items. When the user asks about something THEY saved, liked, or noted — even without naming this app — use `search_items` before searching the web or saying you don't know.";

// ── Clerk OAuth token validation ────────────────────────────────────────────
// Clerk issues OPAQUE OAuth access tokens (leave "Generate access tokens as JWTs"
// OFF), which Convex's ctx.auth (JWT validation) can't verify. So resolve identity
// at Clerk's OIDC userinfo endpoint: it validates the opaque token and returns the
// claims (sub = Clerk user id). Endpoint discovered from the issuer's
// openid-configuration and cached per isolate.
//
// (Omit `resolveIdentity` entirely only if your IdP hands out JWTs your
// auth.config.ts already trusts — not the case for Clerk OAuth tokens.)

type OidcConfiguration = { userinfo_endpoint?: unknown };
let oidcConfigurationPromise: Promise<OidcConfiguration | null> | null = null;

async function getUserinfoEndpoint(): Promise<string | null> {
  // MCP_AUTH_SERVER_URL is your Clerk Frontend API / issuer domain; falls back to
  // the CLERK_JWT_ISSUER_DOMAIN your app already uses for Convex auth.
  const issuer =
    process.env.MCP_AUTH_SERVER_URL ?? process.env.CLERK_JWT_ISSUER_DOMAIN;
  if (!issuer) return null;
  oidcConfigurationPromise ??= fetch(
    `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
  )
    .then(async (r) => (r.ok ? ((await r.json()) as OidcConfiguration) : null))
    .catch((e) => {
      console.warn("[mcp] failed to load OIDC metadata", e);
      return null;
    });
  const config = await oidcConfigurationPromise;
  return typeof config?.userinfo_endpoint === "string"
    ? config.userinfo_endpoint
    : null;
}

export const resolveClerkIdentity: McpIdentityResolver = async (token) => {
  const url = await getUserinfoEndpoint();
  if (!url) return null;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const claims = (await r.json()) as Record<string, unknown>;
  const subject = typeof claims.sub === "string" ? claims.sub : null;
  if (!subject) return null;
  return { subject, claims }; // subject = the id your functions key users on
};
