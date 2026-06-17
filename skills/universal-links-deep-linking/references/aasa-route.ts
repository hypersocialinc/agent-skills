// Next.js App Router route handler for the Apple App Site Association file.
//
// Why a route handler instead of a static public/.well-known/ file:
//  - Pins `Content-Type: application/json` (a static extensionless file may be
//    served as application/octet-stream, which some Apple crawlers reject).
//  - Guarantees a direct 200 with no redirect in front of it.
//
// Place at: app/.well-known/apple-app-site-association/route.ts
// Serves:   https://<host>/.well-known/apple-app-site-association
//
// appIDs entries are "<TEAM_ID>.<BUNDLE_ID>". Keep them in sync with the app's
// `applinks:<host>` entitlement (and the Debug copy's `?mode=developer`).

const AASA = {
  applinks: {
    details: [
      {
        appIDs: ["TEAMID12345.com.example.app"],
        components: [
          { "/": "/item/*", comment: "Deep link item detail URLs into the app." },
        ],
      },
    ],
  },
};

// Nothing per-request — let it cache at the edge.
export const dynamic = "force-static";

export function GET() {
  return Response.json(AASA, { headers: { "Content-Type": "application/json" } });
}
