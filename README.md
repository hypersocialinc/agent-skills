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

## Repo Layout

- `skills/<skill-name>/SKILL.md`
- optional `agents/openai.yaml`
- optional `references/`
- optional `scripts/` for pipeline tooling the skill calls

## Notes

- This repo follows the layout expected by the public `skills` tool.
- Skills are portable, but agent behavior can still vary a bit by runtime.
- If you need project-specific operational skills, keep those in a separate repo instead of mixing them into this shared catalog.
