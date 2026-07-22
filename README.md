# Agent Skills

Reusable agent skills for Codex, Claude Code, and other runtimes that support the open skills ecosystem.

This repo is meant to be installed with the official `skills` CLI, not a custom installer.

## Install

List skills in this repo:

```bash
npx skills add hypersocialinc/agent-skills --list
```

Install a specific skill into Codex:

```bash
npx skills add hypersocialinc/agent-skills --skill convex-streaming-agents --agent codex
```

Install a specific skill into Claude Code:

```bash
npx skills add hypersocialinc/agent-skills --skill convex-streaming-agents --agent claude-code
```

Install all skills:

```bash
npx skills add hypersocialinc/agent-skills --all
```

## Included Skills

- `imessage-convex-agent`
  Build an iMessage AI agent channel on Convex via Sendblue -- webhook parsing, dedupe + enqueue pipeline, account linking with app-issued codes, the chat-ownership binding trap, typing indicators, and card-image sends that sidestep iMessage's sender-side unfurling.
- `convex-streaming-agents`
  Build streaming text agents on Convex with Vercel AI SDK, persisted run state, tool traces, and polished client UX patterns like thinking dots and character reveal.
- `convex-r2-media`
  Use Convex with Cloudflare R2 correctly for durable public media delivery and migrations away from signed storage URLs.
- `hyperstack-mcp-connector`
  Expose Convex functions as an OAuth-secured remote MCP connector that Claude, ChatGPT, or any MCP client can call as the signed-in user — hosted entirely inside Convex via the `convex-mcp-gateway` component (no separate web server, no bridge JWT, no keypair). Clerk is the authorization server (dynamic client registration); the gateway validates Clerk's opaque OAuth token via its OIDC userinfo endpoint and injects the caller into each tool, so owner-scoped Convex functions run as that user. Ships the tool descriptors, the internal tool impls, the `http.ts` mount + OAuth discovery, and the full setup checklist + gotchas.
- `hyper-ui-skills`
  Route reusable UI pattern work for Expo and Next.js to focused implementation guides like `masked-fade-overlay`.
- `swiftui-collapsible-pull-sheet`
  Build custom SwiftUI pull sheets that collapse into compact pills, expand with drag or tap, morph their surface and content, and coordinate surrounding iOS chrome.
- `swiftui-sheet-keyboard-animations`
  Open a SwiftUI sheet with the keyboard rising as one motion (iMessage-compose style) and dismiss them together: UIKit prewarm field, land-gated `@FocusState` handoff, `.large`-detent rule, and accessory freezing — with the failure modes each piece prevents.
- `swiftui-voice-first-agent-chat`
  Build a voice-first agent chat: a dock with a hold-to-talk mic pill, a speech-reactive lit-glass orb overlay with live captioning, and release-to-send into a full-screen streaming agent chat over the pushed-back home. Ships the `SpeechAnalyzer`/`SFSpeechRecognizer` two-backend facade (asset reservation, quick-tap hold token, audio-session actor, level pipeline), the orb's render recipe and press-latency rules, the chat presentation (card backdrop, screen-height transitions, drag dismiss, dock-mode bar morph), agent seeding/streaming patterns for Convex+Clerk apps, and the mandatory mic error boundary.
- `transparent-video`
  Generate a short looping transparent video (`hvc1` HEVC with alpha) from a single still image. SeedDance 2 image-to-video (with optional closed-loop end-frame anchoring) → BiRefNet v2 Matting per frame in parallel → HEVC alpha encode. ~$0.65 and 3–5 min for a 5s 720² loop that plays natively in iOS, web, and Android.
- `instax-mini-link-ble`
  Print photos to a Fujifilm Instax Mini Link 1/2/3 over Bluetooth LE from Swift/CoreBluetooth, Node.js, Web Bluetooth, or Python. Covers the full opcode map, packet framing, image requirements (baseline JPEG, 600×800, ≤105 KB), and the specific gotchas — progressive JPEG, off-by-one status parsing, magic-byte case swap — that cause garbled prints or silent timeouts.
- `ios-testflight-fastlane`
  Set up one-command TestFlight releases for a native iOS app with fastlane: App Store Connect API-key auth, automatic build numbering stamped across every target's `Info.plist`, optional XcodeGen regeneration, `gym` archive/export, and `upload_to_testflight`. Ships a working `Fastfile`/`Appfile`/env template plus the hard-won gotchas (`export_method` alias, dual xcargs, numeric app id).
- `ios-share-extension`
  Add a "Save to <app>" iOS Share Extension that saves a shared link or text into a native app from the system share sheet, on a Convex + Clerk stack. Covers the app-extension target wiring (XcodeGen `project.yml`), App Group + keychain-access-group entitlements on both targets, the Clerk shared-session gotcha (pin the keychain `service`/`accessGroup` so the extension reuses the app's login instead of seeing a signed-out user), calling the app's existing Convex save action from the extension via `ConvexClientWithAuth` + `ClerkConvexAuthProvider`, a resilient App Group save-queue drained by the host app on activation, the `NSExtensionActivationRule` setup, an `LPMetadataProvider` link preview, and a branded SwiftUI card with a live category chip. Ships adaptable `ShareViewController`/`ShareCardView`/`Shared` sources plus the entitlements, `Info.plist`, `project.yml`, and Convex-action references.
- `universal-links-deep-linking`
  Make tapped https links open a native iOS or Expo/React Native app when installed and fall back to the web page otherwise — Apple Universal Links + Android App Links. Covers the shared website half (`apple-app-site-association`, `assetlinks.json`, correct content-type/no-redirect serving), the per-stack app config (native entitlements + `onOpenURL`/`NSUserActivity`, Expo `associatedDomains`/`intentFilters` + expo-router), and the silent-failure gotchas (apex→www redirect, Apple CDN cache + `?mode=developer`, signing-fingerprint mismatch, device-only tap testing). Ships AASA/assetlinks templates and a Next.js route handler.
- `mna-advisor`
  Drive an acquisition from the founder's side the way an elite founder + M&A banker would — outcome-first, structure-aware, leverage-driven, and meticulously tracked. Covers the playbook (rank the objective function, map money to cap-table reality, size the ask backward from after-tax, anchor on precedent, run a process not an event, control posture and information), the structures (underwater cap tables, preference stacks, consideration buckets, founder/team carve-outs and retention, single/double-trigger acceleration, management carve-out plans, ordinary-vs-cap-gains/QSBS and §280G), the paper (LOI and exclusivity timing, escrow/holdback, reps & indemnity, earn-out protection), diligence-readiness (IP-assignment gaps, clean cap table), building the data/deal room (folder structure, checklist, staged disclosure, scaffold script), and an opinionated deal-tracking + memory system so the deal stays correct across calls and counterparties over months.

## Related skills (hosted elsewhere)

These follow the same `npx skills add` install pattern but live in their tool's repo so they stay in sync with the underlying CLI:

- [`instax-print`](https://github.com/hypersocialinc/instax-mini-link-3-print-harness/tree/main/skills/instax-print) — Operational skill for actually printing a photo to a Fujifilm Instax Mini Link from Claude Code / Codex. Hosted in `hypersocialinc/instax-mini-link-3-print-harness` so the skill ships alongside the CLI it invokes.

```bash
npx skills add hypersocialinc/instax-mini-link-3-print-harness --skill instax-print --agent claude-code
```

- [`hypershots`](https://github.com/hypersocialinc/hypershots) — Spec-reliable App Store screenshots: deterministic HTML/CSS panels (exact store canvases, device-frame geometry, localization with auto-fit, a hard validator) plus optional AI-generated cutout stickers and a protected style grade. Hosted in `hypersocialinc/hypershots` so the skill ships alongside its render/validate harness and the annotated example set.

```bash
npx skills add hypersocialinc/hypershots --skill hypershots --agent claude-code
```

## Repo Layout

- `skills/<skill-name>/SKILL.md`
- optional `agents/openai.yaml`
- optional `references/`
- optional `scripts/` for pipeline tooling the skill calls

## Notes

- This repo follows the layout expected by the public `skills` tool.
- Skills are portable, but agent behavior can still vary a bit by runtime.
- If you need project-specific operational skills, keep those in a separate repo instead of mixing them into this shared catalog.
