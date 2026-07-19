// Sendblue iMessage adapter for a Convex backend — drop into convex/channels/imessage.ts.
// Extracted from a production implementation; payload field names confirmed against
// real Sendblue sandbox webhooks. The parser stays defensive because the payload is
// third-party input.
//
// Env (set via `npx convex env set NAME value` or the Convex dashboard, per deployment):
//   SENDBLUE_API_KEY / SENDBLUE_API_SECRET — send-API credentials (dashboard → API settings)
//   SENDBLUE_SIGNING_SECRET — Sendblue's dashboard "Global Secret", required on inbound webhooks
//   IMESSAGE_FROM_NUMBER — your line's E.164 (from_number on sends; REQUIRED on the shared/free plan)
//   SENDBLUE_API_BASE — optional override (default https://api.sendblue.co)

export type InboundMessage = {
  channel: "imessage";
  chatKey: string; // sender E.164 — the conversation key
  updateId: string; // message_handle — dedupe key
  text: string;
  senderName?: string;
  mediaUrls?: string[];
};

const API_BASE = () => process.env.SENDBLUE_API_BASE ?? "https://api.sendblue.co";

/** Discriminated parse so the webhook can tell an EXPECTED drop (our own
 *  outbound echoes and their status callbacks) from an UNRECOGNIZED payload —
 *  the latter gets logged, because a silent shape change from Sendblue would
 *  otherwise kill the whole channel with zero signal. */
export type SendblueParse =
  | { kind: "inbound"; message: InboundMessage }
  | { kind: "echo" }
  | { kind: "unrecognized" };

export function parseSendblueInbound(payload: unknown): SendblueParse {
  if (typeof payload !== "object" || payload === null) return { kind: "unrecognized" };
  const p = payload as Record<string, any>;

  // Sendblue posts your OWN outbound messages and their status transitions to
  // the same webhook; only genuine inbound user messages proceed.
  if (p.is_outbound === true) return { kind: "echo" };

  const from = typeof p.from_number === "string" ? p.from_number.trim() : "";
  if (!/^\+\d{7,15}$/.test(from)) return { kind: "unrecognized" };

  const handle =
    typeof p.message_handle === "string" && p.message_handle.length > 0
      ? p.message_handle
      : null;
  if (!handle) return { kind: "unrecognized" };

  const text = typeof p.content === "string" ? p.content.trim() : "";
  const mediaUrls =
    typeof p.media_url === "string" && p.media_url.length > 0 ? [p.media_url] : [];
  // A message must carry something to act on (a bare tapback/typing event
  // from a valid sender is unrecognized rather than silently ignored, so a
  // content-field rename would surface in logs).
  if (text.length === 0 && mediaUrls.length === 0) return { kind: "unrecognized" };

  return {
    kind: "inbound",
    message: {
      channel: "imessage",
      chatKey: from,
      updateId: handle,
      text,
      ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
    },
  };
}

/** Per-character constant-time comparison of the webhook secret (early-exits
 *  on length mismatch only). Sendblue's Global Secret arrives as the
 *  `sb-signing-secret` header; also accept ?secret=<value> on the registered
 *  URL as belt-and-braces. */
export function verifySendblueSecret(url: URL, headers?: Headers): boolean {
  const expected = process.env.SENDBLUE_SIGNING_SECRET;
  if (!expected) {
    // Fail closed, but say why: an unset secret 401s EVERY webhook, which is
    // otherwise indistinguishable from rejected forgeries.
    console.error("SENDBLUE_SIGNING_SECRET not set — rejecting all webhooks");
    return false;
  }
  const candidates = [
    headers?.get("sb-signing-secret") ?? "",
    url.searchParams.get("secret") ?? "",
  ];
  return candidates.some((got) => {
    if (got.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
  });
}

/** Show the "…" typing bubble while the agent thinks. iMessage-only (no SMS),
 *  and Sendblue requires an existing conversation — both always true when
 *  firing while processing a message the user just sent. Auto-expires at
 *  max_duration_ms; sending the reply clears it sooner. */
export async function sendIMessageTyping(to: string): Promise<void> {
  const key = process.env.SENDBLUE_API_KEY;
  const secret = process.env.SENDBLUE_API_SECRET;
  if (!key || !secret) throw new Error("SENDBLUE_API_KEY / SENDBLUE_API_SECRET not set");

  const res = await fetch(`${API_BASE()}/api/send-typing-indicator`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "sb-api-key-id": key,
      "sb-api-secret-key": secret,
    },
    body: JSON.stringify({
      number: to,
      from_number: process.env.IMESSAGE_FROM_NUMBER,
      state: "start",
      // Agent runs can take a while; cap under Sendblue's 60s default so a
      // failed run doesn't leave a long-lived phantom "…".
      max_duration_ms: 45000,
    }),
  });
  if (!res.ok) {
    throw new Error(`sendblue typing-indicator failed: ${res.status} ${await res.text()}`);
  }
}

/** Send an iMessage (falls back to SMS on Sendblue's side when configured).
 *  `mediaUrl` attaches an image (Sendblue fetches it) — used for card sends,
 *  where a card image + a text-embedded link beats relying on iMessage's
 *  unreliable URL unfurling. */
export async function sendIMessage(
  to: string,
  text: string,
  mediaUrl?: string,
): Promise<void> {
  const key = process.env.SENDBLUE_API_KEY;
  const secret = process.env.SENDBLUE_API_SECRET;
  if (!key || !secret) throw new Error("SENDBLUE_API_KEY / SENDBLUE_API_SECRET not set");

  const res = await fetch(`${API_BASE()}/api/send-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "sb-api-key-id": key,
      "sb-api-secret-key": secret,
    },
    // from_number selects your line — REQUIRED on the shared (free-API) plan.
    body: JSON.stringify({
      number: to,
      content: text,
      from_number: process.env.IMESSAGE_FROM_NUMBER,
      ...(mediaUrl ? { media_url: mediaUrl } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`sendblue send-message failed: ${res.status} ${await res.text()}`);
  }
}
