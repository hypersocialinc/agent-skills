// app/api/mcp/route.ts
//
// Remote MCP connector for a Next.js + Convex + Clerk app, deployed on Vercel.
// Clerk is the OAuth authorization server (via @clerk/mcp-tools); we verify the
// Clerk-issued OAuth access token, mint a short-lived JWT that Convex trusts
// (see convex-bridge-jwt.ts + convex-auth-config), and call a Convex action AS
// the requesting user — so every owner-scoped Convex function and `ctx.auth`
// check works unchanged. Add this connector by URL in Claude or ChatGPT.
//
// File path note: a STATIC `app/api/mcp/route.ts` + `basePath: "/api"` serves the
// connector at `/api/mcp` (Streamable HTTP). Keep it static rather than a
// dynamic `app/api/[transport]/route.ts`: the static folder lets the JWKS route
// at `app/api/mcp/jwks/route.ts` nest cleanly, with no static-vs-dynamic sibling
// routing surprises.

import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { signConvexBridgeJwt } from "@/lib/convex-bridge-jwt";

export const runtime = "nodejs";
export const maxDuration = 60;

// Must match where the protected-resource metadata route lives (see
// well-known-routes.md). withMcpAuth advertises this on a 401 so clients can
// discover Clerk as the authorization server.
const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";

// The Convex action(s) this connector exposes. Replace with your own. Actions can
// call external APIs and run as the authenticated user via `ctx.auth`.
const doTheThing = makeFunctionReference<"action">("myModule:doTheThing");

// Verify the Clerk OAuth access token, resolve the Clerk user, and mint a
// Convex-trusted bridge JWT (sub = Clerk user id) for them. Returns the AuthInfo
// whose `extra.jwt` the tool handlers use to call Convex as that user.
async function verifyToken(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  const clerkAuth = await auth({ acceptsToken: "oauth_token" });
  const info = await verifyClerkToken(clerkAuth, bearer);
  const userId = info?.extra?.userId as string | undefined;
  if (!info || !userId) return undefined; // no / invalid OAuth token

  // The token is VALID past here. A throw now means a SERVER MISCONFIG (missing
  // CLERK_SECRET_KEY, missing/malformed CONVEX_BRIDGE_* env), not an auth failure
  // — log it loudly so a missing env var doesn't become a mystery 401.
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress ?? null;
    const { token: jwt } = await signConvexBridgeJwt({ subject: userId, email: email ?? undefined });
    return { token: bearer, clientId: userId, scopes: (info.scopes ?? []) as string[], extra: { jwt, email } };
  } catch (e) {
    console.error("[mcp] token valid but bridge/user lookup failed — check env", e);
    return undefined;
  }
}

// A Convex client authenticated as the requesting user (so `ctx.auth` is real).
function userConvex(extra: { authInfo?: { extra?: Record<string, unknown> } }): ConvexHttpClient | null {
  const jwt = extra.authInfo?.extra?.jwt as string | undefined;
  if (!jwt) return null;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  const convex = new ConvexHttpClient(url);
  convex.setAuth(jwt);
  return convex;
}

const baseHandler = createMcpHandler(
  (server) => {
    // One tool per Convex action you want to expose. Keep the description tight —
    // it is what the model reads to decide when to call the tool.
    server.tool(
      "do_the_thing",
      "What this does and what it returns, in one sentence.",
      { input: z.string().describe("what the caller passes in") },
      async (args, extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
        const convex = userConvex(extra);
        if (!convex) {
          return { content: [{ type: "text" as const, text: "Error: not authenticated" }], isError: true };
        }
        try {
          const result = await convex.action(doTheThing, { input: args.input as string });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          // Always log server-side (the model may hide the returned text). Raw
          // e.message can leak internals — sanitize it for sensitive tools.
          console.error("[mcp] do_the_thing failed", e);
          const msg = e instanceof Error ? e.message : "unknown error";
          return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
        }
      },
    );

    // An identity probe — confirms the OAuth round-trip end to end. It is still
    // auth-required (withMcpAuth, below); reporting `authenticated` lets you tell
    // "not authenticated" apart from "authenticated but no email on file".
    server.tool(
      "whoami",
      "Show the identity this connector is authenticated as.",
      {},
      async (_args, extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
        const email = (extra.authInfo?.extra?.email as string | null) ?? null;
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ authenticated: !!extra.authInfo, email }) }],
        };
      },
    );
  },
  {},
  { basePath: "/api" },
);

const handler = withMcpAuth(baseHandler, verifyToken, {
  required: true,
  resourceMetadataPath: RESOURCE_METADATA_PATH,
});

export { handler as GET, handler as POST };
