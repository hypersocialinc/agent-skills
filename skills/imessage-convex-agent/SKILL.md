---
name: imessage-convex-agent
description: Build an iMessage AI agent channel on a Convex backend — Sendblue webhook → Convex brain → agent (OpenRouter via @convex-dev/agent) → replies, typing indicators, account linking, and card-image sends that work around iMessage's sender-side link-preview limitation (bot links showing "Click to Load Preview" / not unfurling). Use when adding "text this number, the agent handles it" to any Convex project.
---

# iMessage agent on Convex (Sendblue)

A production-extracted playbook. The `references/` directory ships the real
code: `sendblue-adapter.ts` (provider adapter), `schema.ts` (the four channel
tables), `webhook-and-brain.ts` (HTTP route + enqueue + the brain action with
its load-bearing ordering), `links.ts` (account linking), `agent-setup.md`
(@convex-dev/agent + OpenRouter wiring), `testing.md` (simulated-webhook
fixtures + checklist). Table/function names throughout are a recommended
shape, not requirements. (Provenance: extracted from hypersocialinc/savethis,
a private repo — this skill is self-contained; don't chase the pointer.)

## Stack

- **Sendblue** — the iMessage provider. Chosen because it's fully self-serve
  (dashboard.sendblue.com/company-signup — NOT the marketing site's "request a
  demo" page), has a free API sandbox (shared number, ~10 contacts), and a
  $100/mo flat "AI Agent" plan for a dedicated line. Apple Messages for
  Business is NOT self-serve (MSP + Apple review). All blue-bubble providers
  ride Apple's private protocol (Beeper Mini precedent) — keep the channel
  layer provider-agnostic so you can swap in Twilio SMS as a fallback.
- **Convex** — HTTP action webhook + mutation enqueue + action brain.
- **@convex-dev/agent** (Convex agent component) + **OpenRouter** as the model
  gateway (AI SDK `generateText` under the hood). Full wiring in
  `references/agent-setup.md`. For streaming architectures and client UX,
  install the `convex-streaming-agents` skill alongside this one — this skill
  covers the CHANNEL.

## Provider setup (do this first)

1. Sign up at dashboard.sendblue.com/company-signup, grab from the dashboard:
   API key + API secret (auth headers on every send), the **Global Secret**
   (this is the webhook signing secret — Sendblue issues it, you don't mint
   it), and your line's number.
2. Set Convex env vars — per deployment, via `npx convex env set` or the
   dashboard (they do NOT copy between dev and prod):
   `SENDBLUE_API_KEY`, `SENDBLUE_API_SECRET`, `SENDBLUE_SIGNING_SECRET`
   (= the Global Secret), `IMESSAGE_FROM_NUMBER` (your line's E.164),
   optional `SENDBLUE_API_BASE`.
3. Register the webhook in the Sendblue dashboard:
   `https://<deployment>.convex.site/imessage/webhook?secret=<signing-secret>`
   — note **`.convex.site`**, not `.convex.cloud` (HTTP actions live on the
   `.site` host).
4. On the sandbox: add your test phones as contacts (capped ~10).

API base URL: `https://api.sendblue.co` (keep it in `SENDBLUE_API_BASE` so
sandbox/prod can differ).

## Architecture

```
Sendblue webhook (POST, sb-signing-secret header)
  → http.ts httpAction: verify secret → parse → enqueue
  → chats.enqueueInbound (mutation): dedupe by (channel, updateId),
    upsert chat row, schedule brain
  → chat.processInbound (action): resolve identity (unlinked → link flow,
    EARLY RETURN) → typing indicator → bind ownership → ensure thread →
    ingest media → agent.generateText → send reply → card sends
```

Tables (full definitions in `references/schema.ts`): `chats` (channel,
chatKey=E.164, userId?, threadId?), `processedUpdates` (channel+updateId
dedupe), `identities` (channel, channelKey → userId), `linkCodes` (code,
userId, expiresAt).

## Sendblue specifics (all learned the hard way)

- **Auth on sends**: headers `sb-api-key-id` / `sb-api-secret-key`. Send
  endpoint `POST {base}/api/send-message` with body
  `{number, content, from_number, media_url?}`.
- **`from_number` is REQUIRED on the shared/free plan** — omitting it 400s.
- **Webhook secret arrives as the `sb-signing-secret` HEADER** (also accept
  `?secret=` on the registered URL as belt-and-braces). Compare per-character
  constant-time; fail closed but log loudly when the env var is unset.
- **Inbound payload fields**: `content`, `from_number`, `is_outbound`,
  `message_handle` (use as updateId), `media_url` (single string). Sendblue
  posts your OWN outbound messages and their status callbacks to the same
  webhook — drop `is_outbound === true` as an "echo", return 200.
- **Parse as a discriminated union** `inbound | echo | unrecognized` and LOG
  unrecognized shapes (keys only, no PII). A silent payload-shape change from
  the provider otherwise kills the channel with zero signal: 200s everywhere,
  no retries, nothing saved.
- **Typing indicator**: `POST {base}/api/send-typing-indicator` with
  `{number, from_number, state: "start", max_duration_ms}`. iMessage-only,
  requires an existing conversation (always true when replying). Cap at
  ~45s so a crashed run can't leave a phantom "…"; the reply clears it.
  Fire best-effort in a try/catch — never block the real work.
- **ONE webhook registration per number.** Registering dev + prod endpoints
  simultaneously double-replies and double-processes. Point the webhook at
  ONE deployment; test the other by curling simulated webhook payloads at it
  (fixtures in `references/testing.md`).

## The unfurl lesson (why cards are attached images)

iMessage link previews are generated **sender-side** by the sender's Messages
app. A bot's URL-only message shows a "Click to Load Preview" stub — being in
the recipient's contacts does NOT fix this (empirically verified). So:

- **Never send a bare URL and expect a card.** Send the card as an attached
  image (`media_url` pointing at your OG/card image route) with the link
  embedded in text (`↳ https://…`). Text+URL messages render as plain
  tappable links with no stub; the attachment supplies the visuals.
- If the link's preview matters when HUMANS paste it (it does), keep OG meta
  server-rendered with `og:image:width/height` declared, image ~1080×1350 or
  1200×630. Make the OG image a **route handler** (`/card?params`) not a
  Next.js `opengraph-image` file convention — conventions can't read query
  params and take precedence over explicit metadata.

## Account linking (texts act as a real user)

App-issued short codes, no SMS verification service needed. Full code in
`references/links.ts` — including the ⟨A⟩ adaptation point for projects whose
auth subject IS the user (no separate identities-for-app mapping needed).

- App calls `createLinkCode` (authed mutation) → 6-char code from a
  confusion-free alphabet (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`), 15-min TTL,
  via `crypto.getRandomValues`, one live code per user (re-issue replaces).
  User texts the code to the line.
- Webhook side: if sender is unlinked and the text looks like a code
  (`looksLikeLinkCode`), `consumeLinkCode` creates the identity row
  (channel+E.164 → userId). Use `.collect()` not `.unique()` on code lookup
  (collision safety); on re-link, delete the old identity.
- The app shows a reactive `textLinkStatus` query so the linking screen flips
  to "Linked" the moment the code lands. Deep-link Messages pre-filled:
  `sms:<number>&body=<code>` (note `&`, not `?` — iOS quirk).
- `adminIssueCode` (internal mutation) issues codes from the CLI/dashboard so
  the whole flow is testable before any client UI exists.
- Offer "Add to Contacts" in-app: `CNContactViewController(forUnknownContact:)`
  with an org-typed `CNMutableContact` + brand image (needs
  `NSContactsUsageDescription`). Bot texts then show your name + icon.

## The ownership trap (a known silent total-failure mode)

If your agent's tools resolve data ownership through a chat/session row (e.g.
`chats.userId`) rather than the agent library's thread userId: **bind the
chat row to the linked user BEFORE running the agent** (`bindChatUser`).
Otherwise every tool write fails — it throws or silently no-ops depending on
how the tool is written — while the agent may still reply "Saved!", because
models gloss over tool errors. `bindChatUser` returns the surviving threadId
(null after a cross-account re-link), which feeds thread creation — see the
numbered ordering in `references/webhook-and-brain.ts`.

- **Verify channel side effects against DB rows, never against reply text.**
- On re-link to a DIFFERENT account, also clear the chat's threadId — the new
  owner must not inherit the previous owner's conversation context.

## The agent

- Make a **text-channel variant** of your main agent: same instructions core,
  but strip every tool that renders in-app UI (cards, decks, choice pickers) —
  they emit nothing over Messages and you get replies like "Here are four
  picks —" followed by silence. Recommendations become numbered plain-text
  lists; add a text-channel addendum to the system prompt (plain text, no
  markdown headers/asterisks).
- **Thread per chat**, race-safe: create a thread, then an
  `ensureThreadId` mutation adopts whichever thread won a concurrent race so
  rapid messages don't split memory.
- **Media inbound**: provider URLs are short-lived — fetch to Convex storage
  IMMEDIATELY in the brain (cap ~3), then pass multimodal content:
  `messages: [{role:"user", content:[{type:"text",...}, {type:"image", image:new URL(servedUrl)}]}]`
  plus storage-id hints in the prompt so tools can persist them.
  Name unsupported types (PDFs…) in the prompt so the agent answers honestly
  instead of ignoring the attachment.
- **Split error handling: generation vs delivery.** Generation failure →
  "try again" nudge. Delivery failure AFTER the agent ran → log only; the
  agent's tool work already committed and a retry would duplicate it.
- Extract tool side effects (e.g. saved ids) from the run's `steps[].toolResults`
  defensively (`output` in AI SDK v5, `result` in v4).

## Message mechanics

- Chunk long replies (~2000 chars for iMessage) and send sequentially.
- No typing indicator for instant flows (link help/confirm) — fire it only
  before agent runs.
- Cap side-effect card sends (e.g. 3 per turn), each in its own try/catch —
  a failed card must never disturb the reply that already went out.
- Always return 200 to the provider for echoes/unrecognized/dupes so it
  doesn't retry them into double-processing.

## Verification checklist

Concrete fixtures and commands in `references/testing.md`.

1. Curl a simulated webhook payload at the dev deployment (keeps the single
   prod webhook rule intact) — use the sandbox-confirmed payload shape, not
   an invented one.
2. Text the real line → check the **DB rows** for the side effect, not the
   reply bubble.
3. Send a photo; send a PDF (expect the honest "can't ingest" reply).
4. Text from an UNLINKED number → link-help flow, no agent run, no typing
   indicator.
5. Link, unlink, re-link from a second account → old thread dropped.
6. Confirm exactly one webhook registration in the Sendblue dashboard.

## When NOT to use this skill

- The agent/streaming core itself (workers, persisted partials, thinking-dots
  client UX) → `convex-streaming-agents`.
- SMS-only or Twilio-based channels — the pipeline shape transfers, but every
  Sendblue specific here doesn't.
- Apple Messages for Business — different beast entirely (MSP + Apple review,
  not self-serve).
