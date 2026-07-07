// convex/mcpTools.ts
//
// The functions the gateway dispatches for each tool. They are INTERNAL on
// purpose: the gateway calls them across the component boundary where Convex
// strips ctx.auth, so it injects the resolved caller `{ subject, claims }` into
// the `caller` arg. Internal ⇒ no external Convex client can call them with a
// forged caller — only the gateway (holding a function handle) can. Owner-scope
// every query by `caller.subject`, NOT by ctx.auth.
//
// Table/index names below (`users.by_clerkId`) are EXAMPLES — use whatever your
// app keys users on by the Clerk subject.

import { v } from "convex/values";
import { mcpCallerValidator, type McpCaller } from "convex-mcp-gateway";
import {
  internalAction,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/** Map the injected caller (Clerk subject) to your app's user id. Return null if
 *  they haven't onboarded yet — the tool should degrade gracefully, not throw. */
async function userIdForCaller(
  ctx: QueryCtx,
  caller: McpCaller,
): Promise<Id<"users"> | null> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", caller.subject))
    .unique();
  return user?._id ?? null;
}

export const searchItems = internalQuery({
  args: {
    caller: mcpCallerValidator,
    query: v.string(),
    limit: v.optional(v.number()),
  },
  // A `returns` validator here is good practice; the MCP tool does not need one.
  handler: async (ctx, args) => {
    const userId = await userIdForCaller(ctx, args.caller);
    if (!userId) return { items: [] };
    const limit = Math.max(1, Math.min(50, args.limit ?? 20));
    // ... your owner-scoped query, keyed on userId ...
    const items = await ctx.db
      .query("items")
      .withSearchIndex("search_text", (s) =>
        s.search("searchText", args.query).eq("ownerId", userId),
      )
      .take(limit);
    return { items };
  },
});

export const whoami = internalQuery({
  args: { caller: mcpCallerValidator },
  handler: async (ctx, args) => {
    const userId = await userIdForCaller(ctx, args.caller);
    const email =
      typeof (args.caller.claims as { email?: unknown })?.email === "string"
        ? (args.caller.claims as { email: string }).email
        : null;
    return { subject: args.caller.subject, email, hasAccount: userId !== null };
  },
});

// An action that calls internal.* MUST annotate its handler return type. The
// function is part of the same generated `internal` object it references, so
// without the annotation TS hits a circular-inference error (TS7022/7023).
export const saveItem = internalAction({
  args: { caller: mcpCallerValidator, text: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"items"> }> => {
    // Resolve the owner from caller.subject, then do the write via an internal
    // mutation (an action can't touch ctx.db directly). Reuse your existing
    // internal mutations so an MCP write is identical to an in-app write.
    const id: Id<"items"> = await ctx.runMutation(internal.items.insert, {
      subject: args.caller.subject,
      text: args.text,
    });
    return { id };
  },
});
