// The four channel tables — merge into your convex/schema.ts defineSchema.
// Table/field names are a recommended shape, not a requirement; keep them
// consistent with the other references if you rename.

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const channelTables = {
  /** One row per conversation (channel + chatKey). For iMessage the chatKey
   *  is the sender's E.164 phone number. */
  chats: defineTable({
    channel: v.string(), // "imessage" (add others later)
    chatKey: v.string(), // sender E.164
    threadId: v.optional(v.string()), // @convex-dev/agent thread
    senderName: v.optional(v.string()),
    /** The user who owns this conversation. MUST be bound before the agent
     *  runs if your tools resolve ownership through this row — see the
     *  ownership-trap section of the skill. */
    userId: v.optional(v.id("users")),
  })
    .index("by_channel_chatKey", ["channel", "chatKey"])
    .index("by_threadId", ["threadId"]),

  /** Dedupe ledger — providers retry deliveries that don't get a fast 200.
   *  For Sendblue the updateId is the message_handle string. */
  processedUpdates: defineTable({
    channel: v.string(),
    updateId: v.union(v.number(), v.string()),
  }).index("by_channel_updateId", ["channel", "updateId"]),

  /** Maps each channel login to a user; many per user enables account
   *  linking (the same human on iMessage + the app → one user).
   *  ADAPTATION POINT: this reference assumes an identities row with
   *  channel "app" maps your auth provider's subject to a users row. If
   *  your project's auth subject IS the user id, you can drop the "app"
   *  rows and resolve the user directly in links.ts (marked there). */
  identities: defineTable({
    userId: v.id("users"),
    channel: v.string(), // "app" | "imessage"
    channelKey: v.string(), // app: auth subject · imessage: E.164
    senderName: v.optional(v.string()),
  })
    .index("by_channel_key", ["channel", "channelKey"])
    .index("by_userId_channel", ["userId", "channel"]),

  /** One-time codes that link a phone number to a user. Issued from the app,
   *  texted to the bot, consumed on match. Expired rows are ignored on
   *  lookup and replaced on re-issue. */
  linkCodes: defineTable({
    userId: v.id("users"),
    channel: v.string(), // "imessage" for now
    code: v.string(), // 6 chars, unambiguous alphabet, stored uppercase
    expiresAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_user_channel", ["userId", "channel"]),
};
