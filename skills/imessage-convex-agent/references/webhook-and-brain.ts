// The pipeline: HTTP webhook → dedupe/enqueue mutation → brain action.
// Split across convex/http.ts, convex/chats.ts, convex/chat.ts in a real
// project; shown together here for the control flow. The ORDERING in
// processInbound is load-bearing — see the inline comments.

// ─── convex/http.ts ─────────────────────────────────────────────────────────

import { httpRouter } from "convex/server";
import { httpAction, internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  parseSendblueInbound,
  sendIMessage,
  sendIMessageTyping,
  verifySendblueSecret,
} from "./channels/imessage";
import { looksLikeLinkCode } from "./links";
// import { createThread } from "@convex-dev/agent";  // see agent-setup.md
// import { components } from "./_generated/api";
// import { myTextAgent } from "./agents";

const http = httpRouter();

http.route({
  path: "/imessage/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Sendblue sends its Global Secret as the sb-signing-secret header; the
    // registered URL also carries ?secret=... as belt-and-braces.
    if (!verifySendblueSecret(new URL(request.url), request.headers)) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = await request.json().catch((err) => {
      console.error("imessage webhook: unparseable body", String(err));
      return null;
    });
    const parsed = parseSendblueInbound(payload);
    if (parsed.kind === "unrecognized") {
      // Keys only — never message content/PII. This is the tripwire for a
      // Sendblue payload-shape change (which would otherwise silently kill
      // the channel: 200s everywhere, no retries, nothing processed).
      console.warn(
        "imessage webhook: unrecognized payload shape",
        payload && typeof payload === "object" ? Object.keys(payload) : typeof payload,
      );
    }
    // 200 for echoes/status callbacks and unrecognized payloads alike so
    // Sendblue doesn't retry them.
    if (parsed.kind !== "inbound") return new Response(null, { status: 200 });

    const m = parsed.message;
    await ctx.runMutation(internal.chats.enqueueInbound, {
      channel: m.channel,
      chatKey: m.chatKey,
      updateId: m.updateId,
      text: m.text,
      senderName: m.senderName,
      mediaUrls: m.mediaUrls,
    });
    return new Response(null, { status: 200 });
  }),
});

export default http;

// ─── convex/chats.ts ────────────────────────────────────────────────────────

/** Dedupe by (channel, updateId), ensure the chat row exists, and schedule
 *  the brain. Runs transactionally — provider retries are safely absorbed. */
export const enqueueInbound = internalMutation({
  args: {
    channel: v.string(),
    chatKey: v.string(),
    updateId: v.union(v.number(), v.string()),
    text: v.string(),
    senderName: v.optional(v.string()),
    /** Inbound attachment URLs. Fetched to storage by the brain — provider
     *  URLs may be short-lived, so they never get persisted directly. */
    mediaUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("processedUpdates")
      .withIndex("by_channel_updateId", (q) =>
        q.eq("channel", args.channel).eq("updateId", args.updateId),
      )
      .unique();
    if (seen) return { duplicate: true as const };
    await ctx.db.insert("processedUpdates", {
      channel: args.channel,
      updateId: args.updateId,
    });

    let chat = await ctx.db
      .query("chats")
      .withIndex("by_channel_chatKey", (q) =>
        q.eq("channel", args.channel).eq("chatKey", args.chatKey),
      )
      .unique();
    if (!chat) {
      const chatId = await ctx.db.insert("chats", {
        channel: args.channel,
        chatKey: args.chatKey,
        senderName: args.senderName,
      });
      chat = (await ctx.db.get(chatId))!;
    }

    await ctx.scheduler.runAfter(0, internal.chat.processInbound, {
      chatId: chat._id,
      text: args.text,
      mediaUrls: args.mediaUrls,
    });
    return { duplicate: false as const };
  },
});

/** Bind a chat to its owning user — CRITICAL if the agent's tools resolve
 *  ownership through chats.userId rather than the agent thread. On a re-link
 *  that moves the number to a different account, the old thread is dropped
 *  too: the new owner must not inherit the previous owner's conversation
 *  context. Returns the surviving threadId (null after a reset). */
export const bindChatUser = internalMutation({
  args: { chatId: v.id("chats"), userId: v.id("users") },
  handler: async (ctx, args): Promise<{ threadId: string | null }> => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat) throw new Error(`chat ${args.chatId} not found`);
    if (chat.userId === args.userId) return { threadId: chat.threadId ?? null };
    if (chat.userId && chat.userId !== args.userId) {
      await ctx.db.patch(args.chatId, { userId: args.userId, threadId: undefined });
      return { threadId: null };
    }
    await ctx.db.patch(args.chatId, { userId: args.userId });
    return { threadId: chat.threadId ?? null };
  },
});

/** Race-safe: if this chat already has a thread (a concurrent message won the
 *  race), keep it and return the winner; otherwise adopt the proposed one.
 *  Mutations are transactional, so all rapid messages converge on one thread. */
export const ensureThreadId = internalMutation({
  args: { chatId: v.id("chats"), proposedThreadId: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const chat = await ctx.db.get(args.chatId);
    if (chat?.threadId) return chat.threadId;
    await ctx.db.patch(args.chatId, { threadId: args.proposedThreadId });
    return args.proposedThreadId;
  },
});

// ─── convex/chat.ts — the brain ─────────────────────────────────────────────

/** Fetch inbound channel media into Convex storage. Provider URLs may be
 *  short-lived, so this happens immediately. Images become usable
 *  attachments; anything else (PDFs, video) is noted so the agent can
 *  respond honestly instead of silently ignoring the file. */
async function ingestMedia(
  ctx: { storage: { store(b: Blob): Promise<string>; getUrl(id: string): Promise<string | null> } },
  mediaUrls: string[],
) {
  const images: { storageId: string; servedUrl: string }[] = [];
  const unsupported: string[] = [];
  for (const url of mediaUrls.slice(0, 3)) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) {
        unsupported.push(type || "unknown type");
        continue;
      }
      const storageId = await ctx.storage.store(await res.blob());
      const servedUrl = await ctx.storage.getUrl(storageId);
      if (servedUrl) images.push({ storageId, servedUrl });
    } catch (err) {
      console.error("channel media ingest failed", url.slice(0, 80), err);
      unsupported.push("failed to fetch");
    }
  }
  return { images, unsupported };
}

const LINK_HELP =
  "Hey — to link this number to your account, open the app and text me the code you see there.";

export const processInbound = internalAction({
  args: {
    chatId: v.id("chats"),
    text: v.string(),
    mediaUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const chat = await ctx.runQuery(internal.chats.get, { chatId: args.chatId });

    // 1. RESOLVE IDENTITY. Unlinked senders only ever see the link flow;
    //    they never reach the agent.
    const identity = await ctx.runQuery(internal.links.identityFor, {
      channel: "imessage",
      channelKey: chat.chatKey,
    });
    if (!identity) {
      // The link flow commits BEFORE its reply sends; a delivery failure
      // must not crash the action — log it with context instead.
      try {
        if (looksLikeLinkCode(args.text)) {
          const result = await ctx.runMutation(internal.links.consumeLinkCode, {
            channel: "imessage",
            channelKey: chat.chatKey,
            code: args.text,
            senderName: chat.senderName,
          });
          await sendIMessage(
            chat.chatKey,
            result.linked
              ? "Linked! Text me anything and I'll handle it."
              : "That code didn't match — codes expire after 15 minutes. Grab a fresh one in the app.",
          );
        } else {
          await sendIMessage(chat.chatKey, LINK_HELP);
        }
      } catch (err) {
        console.error("imessage link-flow reply failed", chat.chatKey, err);
      }
      return; // ← EARLY RETURN: no typing indicator, no agent, no thread.
    }

    // 2. TYPING INDICATOR — best-effort, linked senders only.
    try {
      await sendIMessageTyping(chat.chatKey);
    } catch (err) {
      console.error("imessage typing indicator failed", chat.chatKey, err);
    }

    // 3. BIND OWNERSHIP before the agent runs (see the ownership trap).
    //    bindChatUser returns the surviving threadId — null after a re-link
    //    to a different account — which feeds thread creation below.
    const bound = await ctx.runMutation(internal.chats.bindChatUser, {
      chatId: args.chatId,
      userId: identity.userId,
    });
    let threadId = bound.threadId ?? undefined;

    // 4. THREAD (race-safe adoption).
    if (!threadId) {
      // const created = await createThread(ctx, components.agent, {
      //   userId: identity.userId,
      //   title: chat.senderName ? `Chat with ${chat.senderName}` : "Chat",
      // });
      const created = "<createThread result>"; // see agent-setup.md
      threadId = await ctx.runMutation(internal.chats.ensureThreadId, {
        chatId: args.chatId,
        proposedThreadId: created,
      });
    }

    // 5. MEDIA → multimodal prompt with storage-id hints.
    let prompt = args.text;
    let imageParts: { type: "image"; image: URL }[] = [];
    if ((args.mediaUrls?.length ?? 0) > 0) {
      const { images, unsupported } = await ingestMedia(ctx, args.mediaUrls!);
      imageParts = images.map((i) => ({ type: "image" as const, image: new URL(i.servedUrl) }));
      if (prompt.length === 0) prompt = "(the user sent this without a message)";
      if (images.length > 0) {
        const hints = images.map((i) => `imageStorageId: ${i.storageId}`).join("\n");
        prompt = `${prompt}\n\n[The user attached ${images.length} photo(s). To act on one, use its imageStorageId:\n${hints}]`;
      }
      if (unsupported.length > 0) {
        prompt = `${prompt}\n\n[The user also attached ${unsupported.length} file(s) that can't be ingested (${unsupported.join(", ")}) — documents like PDFs aren't supported over text; suggest a screenshot or a link instead.]`;
      }
    }

    // 6. GENERATE — split error handling: a generation failure earns a
    //    "try again" nudge, but a delivery failure after the agent ran must
    //    NOT retry — the agent's tool work already committed.
    let replyText: string;
    try {
      // const result = await myTextAgent.generateText(
      //   ctx,
      //   { threadId },
      //   imageParts.length > 0
      //     ? { messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }, ...imageParts] }] }
      //     : { prompt },
      // );
      // replyText = result.text;
      // Side effects (e.g. ids a save tool returned) live in result.steps[].toolResults:
      //   const id = tr.output?.id ?? tr.result?.id  // output in AI SDK v5, result in v4
      replyText = "<agent reply>";
    } catch (err) {
      console.error("processInbound generation failed", chat.chatKey, err);
      try {
        await sendIMessage(chat.chatKey, "Hmm, I hit a snag processing that. Mind trying again?");
      } catch (sendErr) {
        console.error("failed to send error notice", sendErr);
      }
      return;
    }
    try {
      // Chunk ~2000 chars per iMessage bubble; send sequentially.
      await sendIMessage(chat.chatKey, replyText);
    } catch (err) {
      console.error(
        "reply delivery failed (agent work already committed)",
        chat.chatKey,
        err,
      );
    }

    // 7. Optional: card sends for side effects — attach a card image via
    //    media_url with a text-embedded link (`↳ https://…`), capped (e.g. 3),
    //    each in its own try/catch so a failed card never disturbs the reply.
  },
});
