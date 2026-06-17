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

- `convex-streaming-agents`
  Build streaming text agents on Convex with Vercel AI SDK, persisted run state, tool traces, and polished client UX patterns like thinking dots and character reveal.
- `convex-r2-media`
  Use Convex with Cloudflare R2 correctly for durable public media delivery and migrations away from signed storage URLs.
- `hyper-ui-skills`
  Route reusable UI pattern work for Expo and Next.js to focused implementation guides like `masked-fade-overlay`.
- `swiftui-collapsible-pull-sheet`
  Build custom SwiftUI pull sheets that collapse into compact pills, expand with drag or tap, morph their surface and content, and coordinate surrounding iOS chrome.
- `transparent-video`
  Generate a short looping transparent video (`hvc1` HEVC with alpha) from a single still image. SeedDance 2 image-to-video (with optional closed-loop end-frame anchoring) → BiRefNet v2 Matting per frame in parallel → HEVC alpha encode. ~$0.65 and 3–5 min for a 5s 720² loop that plays natively in iOS, web, and Android.
- `instax-mini-link-ble`
  Print photos to a Fujifilm Instax Mini Link 1/2/3 over Bluetooth LE from Swift/CoreBluetooth, Node.js, Web Bluetooth, or Python. Covers the full opcode map, packet framing, image requirements (baseline JPEG, 600×800, ≤105 KB), and the specific gotchas — progressive JPEG, off-by-one status parsing, magic-byte case swap — that cause garbled prints or silent timeouts.
- `ios-testflight-fastlane`
  Set up one-command TestFlight releases for a native iOS app with fastlane: App Store Connect API-key auth, automatic build numbering stamped across every target's `Info.plist`, optional XcodeGen regeneration, `gym` archive/export, and `upload_to_testflight`. Ships a working `Fastfile`/`Appfile`/env template plus the hard-won gotchas (`export_method` alias, dual xcargs, numeric app id).
- `universal-links-deep-linking`
  Make tapped https links open a native iOS or Expo/React Native app when installed and fall back to the web page otherwise — Apple Universal Links + Android App Links. Covers the shared website half (`apple-app-site-association`, `assetlinks.json`, correct content-type/no-redirect serving), the per-stack app config (native entitlements + `onOpenURL`/`NSUserActivity`, Expo `associatedDomains`/`intentFilters` + expo-router), and the silent-failure gotchas (apex→www redirect, Apple CDN cache + `?mode=developer`, signing-fingerprint mismatch, device-only tap testing). Ships AASA/assetlinks templates and a Next.js route handler.

## Related skills (hosted elsewhere)

These follow the same `npx skills add` install pattern but live in their tool's repo so they stay in sync with the underlying CLI:

- [`instax-print`](https://github.com/hypersocialinc/instax-mini-link-3-print-harness/tree/main/skills/instax-print) — Operational skill for actually printing a photo to a Fujifilm Instax Mini Link from Claude Code / Codex. Hosted in `hypersocialinc/instax-mini-link-3-print-harness` so the skill ships alongside the CLI it invokes.

```bash
npx skills add hypersocialinc/instax-mini-link-3-print-harness --skill instax-print --agent claude-code
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
