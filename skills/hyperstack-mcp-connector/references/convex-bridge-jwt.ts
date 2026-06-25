// lib/convex-bridge-jwt.ts
//
// The bridge between Clerk OAuth and Convex auth. Mints short-lived RS256 JWTs
// whose `sub` is the Clerk user id, which Convex trusts via a customJwt provider
// (see convex-auth-config in setup-and-gotchas.md). This lets the MCP route call
// Convex AS the OAuth-authenticated user, so every owner-scoped Convex function
// and `ctx.auth` check keeps working unchanged.
//
// Env (Next.js server only — set in Vercel, NOT exposed to the client):
//   CONVEX_BRIDGE_PRIVATE_KEY  RS256 private key, PKCS8 PEM (-----BEGIN PRIVATE KEY-----)
//   CONVEX_BRIDGE_ISSUER       issuer string; MUST equal the auth.config.ts provider's
//                              `issuer` (e.g. https://your-app.com/mcp)
//   CONVEX_BRIDGE_KID          key id, surfaced in the JWKS + JWT header (default "mcp-1")
//
// Generate a keypair:
//   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem
//   # paste private.pem into CONVEX_BRIDGE_PRIVATE_KEY (literal \n are tolerated)

import { SignJWT, importPKCS8, exportJWK } from "jose";

const ALG = "RS256";
const TTL_SECONDS = 15 * 60; // short-lived; the MCP route mints fresh per request

const issuer = () => {
  const v = process.env.CONVEX_BRIDGE_ISSUER;
  if (!v) throw new Error("CONVEX_BRIDGE_ISSUER not set");
  return v;
};
const kid = () => process.env.CONVEX_BRIDGE_KID || "mcp-1";

async function privateKey() {
  const pem = process.env.CONVEX_BRIDGE_PRIVATE_KEY;
  if (!pem) throw new Error("CONVEX_BRIDGE_PRIVATE_KEY not set");
  // `extractable` lets publicJwks() derive the public JWK; the PEM is already a
  // server secret. `\\n` handling supports keys pasted via dashboards.
  return importPKCS8(pem.replace(/\\n/g, "\n"), ALG, { extractable: true });
}

// Audience claim. Pair with `applicationID: "convex"` on the Convex customJwt
// provider (setup-and-gotchas.md §1) so Convex verifies `aud` too, not just `iss`.
const AUDIENCE = "convex";

// Mint a Convex-acceptable JWT for a user. subject = Clerk user id; `email` is
// added as a claim so Convex functions that read it (e.g. for role checks) can.
export async function signConvexBridgeJwt(opts: {
  subject: string;
  email?: string;
  ttlSeconds?: number;
}): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.ttlSeconds ?? TTL_SECONDS);
  const token = await new SignJWT({ email: opts.email })
    .setProtectedHeader({ alg: ALG, kid: kid(), typ: "JWT" })
    .setIssuer(issuer())
    .setAudience(AUDIENCE)
    .setSubject(opts.subject)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(await privateKey());
  return { token, expiresAt: exp * 1000 }; // expiresAt is epoch MILLISECONDS (exp is seconds)
}

// Public JWK set served at /api/mcp/jwks (see jwks-route.ts) so Convex can verify
// our signatures. Public RSA fields only.
export async function publicJwks(): Promise<{ keys: object[] }> {
  const jwk = await exportJWK(await privateKey());
  return { keys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, alg: ALG, use: "sig", kid: kid() }] };
}
