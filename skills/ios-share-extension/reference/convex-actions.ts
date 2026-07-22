// Convex side. The KEY POINT: the extension calls the SAME action the app already uses to
// save (`saveFromApp`). You do NOT add a share-specific endpoint. Both run as the
// authenticated Clerk user (the extension proved identity via the shared keychain session
// and `ConvexClientWithAuth` + `ClerkConvexAuthProvider`).
//
// The only extension-specific addition is OPTIONAL: a read-only `classifyShare` so the
// card's category chip matches what saving will produce.

import { action } from "./_generated/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Your existing save action — unchanged. The extension calls this as-is.
// ---------------------------------------------------------------------------
export const saveFromApp = action({
  args: { text: v.string(), categoryHint: v.optional(v.string()) },
  returns: v.object({ id: v.string(), category: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    // ... classify + enrich + insert exactly as you already do ...
    // The reactive listMine query updates the feed automatically.
    return { id: "…", category: "…" };
  },
});

// ---------------------------------------------------------------------------
// OPTIONAL: read-only category preview for the share card. Runs the *same*
// classifier the save path uses but writes nothing. The extension passes the
// link's crawled title (a stronger signal than the bare URL), so the chip it
// shows matches what saving produces.
// ---------------------------------------------------------------------------
export const classifyShare = action({
  args: { text: v.string(), title: v.optional(v.string()) },
  returns: v.object({ category: v.string() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const text = args.text.trim();
    const urlMatch = text.match(/https?:\/\/\S+/i);
    const bareDomain = !urlMatch && /^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(text);
    const isLink = urlMatch != null || bareDomain;
    const kind: "link" | "note" = isLink ? "link" : "note";
    const url = urlMatch ? urlMatch[0] : bareDomain ? text : undefined;
    const title =
      args.title?.trim().slice(0, 120) ?? (isLink ? undefined : text.slice(0, 80));

    let category = "other";
    try {
      category = await classifyCategory({ kind, title, url }); // your shared classifier
    } catch (err) {
      console.error("classifyShare failed; defaulting to other", err);
    }
    return { category };
  },
});

// classifyCategory is your own shared helper — the same one saveFromApp uses.
declare function classifyCategory(input: {
  kind: "link" | "note";
  title?: string;
  url?: string;
}): Promise<string>;
