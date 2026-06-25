// app/api/mcp/jwks/route.ts
//
// Public endpoint Convex fetches to verify bridge JWTs. The URL goes in the
// Convex env var CONVEX_BRIDGE_JWKS_URL and must be reachable unauthenticated
// (add it to the Clerk middleware public matcher — see setup-and-gotchas.md).

import { publicJwks } from "@/lib/convex-bridge-jwt";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await publicJwks(), {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
