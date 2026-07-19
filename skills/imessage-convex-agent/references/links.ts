// Account linking: app-issued short codes → identities rows.
// Drop into convex/links.ts.
//
// ADAPTATION POINT (marked ⟨A⟩ below): this reference resolves the signed-in
// user through an identities row with channel "app" (auth subject → users
// row). If your project's auth subject IS your user id, replace authedUserId
// with your own lookup and delete the "app" identity concept.

import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

const CODE_TTL_MS = 15 * 60 * 1000;
// No 0/O/1/I/L — codes get typed into Messages by hand.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateCode(): string {
  // Crypto-strength: a live code links a phone to an account.
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

/** Exactly 6 chars from the code alphabet (case-blind). Used by the brain to
 *  decide whether an unlinked sender's text is a link attempt or just an
 *  early message. */
export function looksLikeLinkCode(text: string): boolean {
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(text.trim().toUpperCase());
}

/** ⟨A⟩ The signed-in user's id, or null. Swap for your auth → user mapping. */
async function authedUserId(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const row = await ctx.db
    .query("identities")
    .withIndex("by_channel_key", (q) =>
      q.eq("channel", "app").eq("channelKey", identity.subject),
    )
    .unique();
  return row?.userId ?? null;
}

/** Issue (or re-issue, replacing any live code) a link code for the signed-in
 *  user. Called by the app's linking screen. */
export const createLinkCode = mutation({
  args: { channel: v.literal("imessage") },
  handler: async (ctx, args) => {
    const userId = await authedUserId(ctx); // ⟨A⟩
    if (!userId) throw new Error("Not signed in");

    // One live code per user+channel: re-issuing replaces.
    const existing = await ctx.db
      .query("linkCodes")
      .withIndex("by_user_channel", (q) =>
        q.eq("userId", userId).eq("channel", args.channel),
      )
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const code = generateCode();
    const expiresAt = Date.now() + CODE_TTL_MS;
    await ctx.db.insert("linkCodes", { userId, channel: args.channel, code, expiresAt });
    return { code, expiresAt };
  },
});

/** Live status for the app's linking screen. Reactive: flips to linked the
 *  moment the inbound pipeline consumes the user's code. */
export const textLinkStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await authedUserId(ctx); // ⟨A⟩
    const number = process.env.IMESSAGE_FROM_NUMBER ?? null;
    if (!userId) return { linked: false as const, phone: null, number };
    const mine = await ctx.db
      .query("identities")
      .withIndex("by_userId_channel", (q) =>
        q.eq("userId", userId).eq("channel", "imessage"),
      )
      .first();
    return { linked: mine !== null, phone: mine?.channelKey ?? null, number };
  },
});

/** Unlink the signed-in user's iMessage number. */
export const unlinkText = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await authedUserId(ctx); // ⟨A⟩
    if (!userId) throw new Error("Not signed in");
    const rows = await ctx.db
      .query("identities")
      .withIndex("by_userId_channel", (q) =>
        q.eq("userId", userId).eq("channel", "imessage"),
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

/** Ops/testing: issue a code for an explicit user (no app auth). Same
 *  semantics as createLinkCode. Run from the Convex dashboard or
 *  `npx convex run links:adminIssueCode '{"userId":"...","channel":"imessage"}'`
 *  — lets you test the entire link flow before ANY client UI exists. */
export const adminIssueCode = internalMutation({
  args: { userId: v.id("users"), channel: v.literal("imessage") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("linkCodes")
      .withIndex("by_user_channel", (q) =>
        q.eq("userId", args.userId).eq("channel", args.channel),
      )
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    const code = generateCode();
    const expiresAt = Date.now() + CODE_TTL_MS;
    await ctx.db.insert("linkCodes", { userId: args.userId, channel: args.channel, code, expiresAt });
    return { code, expiresAt };
  },
});

/** The user linked to a channel identity, or null. */
export const identityFor = internalQuery({
  args: { channel: v.string(), channelKey: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("identities")
      .withIndex("by_channel_key", (q) =>
        q.eq("channel", args.channel).eq("channelKey", args.channelKey),
      )
      .unique();
    return row ? { userId: row.userId } : null;
  },
});

/** Consume a link code texted from `channelKey`: on a live match, write the
 *  identities row and delete the code. Transactional, so a double-texted code
 *  can't link twice. Returns whether the link happened. */
export const consumeLinkCode = internalMutation({
  args: {
    channel: v.literal("imessage"),
    channelKey: v.string(),
    code: v.string(),
    senderName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // .collect() not .unique(): a cross-user code collision is astronomically
    // rare but must not crash the inbound pipeline — prefer a live match.
    const rows = await ctx.db
      .query("linkCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code.trim().toUpperCase()))
      .collect();
    const row = rows.find(
      (r) => r.channel === args.channel && r.expiresAt >= Date.now(),
    );
    if (!row) return { linked: false as const };

    // Re-linking a number moves it to the new account — the code holder just
    // proved account ownership, and one phone maps to one library.
    const existing = await ctx.db
      .query("identities")
      .withIndex("by_channel_key", (q) =>
        q.eq("channel", args.channel).eq("channelKey", args.channelKey),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);

    await ctx.db.insert("identities", {
      userId: row.userId,
      channel: args.channel,
      channelKey: args.channelKey,
      senderName: args.senderName,
    });
    await ctx.db.delete(row._id);
    return { linked: true as const };
  },
});
