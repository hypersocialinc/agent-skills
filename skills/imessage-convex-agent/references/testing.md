# Testing the channel

## Simulated webhook (no phone, no Sendblue)

This payload shape is confirmed against real Sendblue sandbox webhooks — use
it verbatim so you're testing against the provider's actual field names, not
ones you invented:

```bash
curl -s -X POST \
  "https://<deployment>.convex.site/imessage/webhook?secret=<SENDBLUE_SIGNING_SECRET>" \
  -H "Content-Type: application/json" \
  -H "sb-signing-secret: <SENDBLUE_SIGNING_SECRET>" \
  -d '{
    "content": "save this: https://example.com/some-article",
    "status": "RECEIVED",
    "message_handle": "test-'$(date +%s)'",
    "date_sent": "2026-01-01T00:00:00.000Z",
    "from_number": "+15555550123",
    "to_number": "+15555550100",
    "is_outbound": false,
    "was_downgraded": false,
    "service": "iMessage",
    "media_url": ""
  }'
```

- `.convex.site`, NOT `.convex.cloud` — HTTP actions live on the `.site` host.
- Bump `message_handle` every send — it's the dedupe key; a repeated handle is
  silently absorbed as a duplicate (which is itself worth testing once).
- Echo test: same payload with `"is_outbound": true` → expect 200, no
  processing.
- Tripwire test: `{"foo": "bar"}` → expect 200 plus a logged
  "unrecognized payload shape" warning with keys only.
- Outbound replies to the fake `from_number` will fail at the Sendblue send —
  that's expected; watch the Convex logs (`npx convex logs`) for the brain's
  behavior instead.

## Link flow before any client UI exists

`adminIssueCode` (see links.ts) issues a code for an explicit user from the
CLI, so the whole link flow is testable pre-UI:

```bash
npx convex run links:adminIssueCode '{"userId": "<users id>", "channel": "imessage"}'
# → { code: "ABC234", ... }
# then simulate the user texting it:
#   webhook curl with "content": "ABC234" from the target phone number
```

## Real-phone checklist (sandbox)

1. In the Sendblue dashboard, add your phone as a sandbox contact (the free
   sandbox is capped at ~10 contacts) and note the shared line number — that's
   your `IMESSAGE_FROM_NUMBER`.
2. Text the line from an UNLINKED phone → expect the link-help reply, no agent
   run, no typing indicator.
3. Link with a real code → expect the "Linked!" confirmation.
4. Text a link/photo → typing indicator, then the reply. **Verify the side
   effect against DB rows** (dashboard or `npx convex data <table>`), never
   against the reply text — an ownership-binding bug produces a confident
   "Done!" over a write that never happened.
5. Send a PDF → expect the honest "can't ingest that" reply.
6. Re-link from a second account → old account's thread context must not leak
   (threadId reset).
7. Confirm the Sendblue dashboard has exactly ONE webhook registration
   (Settings → webhook URL). Dev + prod registered simultaneously = double
   replies and double side effects.
