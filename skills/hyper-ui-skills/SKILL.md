---
name: hyper-ui-skills
description: Route UI effect and component-pattern requests for Expo and Next.js to the correct implementation guide. Use when users ask for reusable visual patterns (blur fades, overlays, sticky headers, legibility treatments) or ask how to implement the same UI pattern across Expo and web.
---

# Hyper UI Skills

## Purpose
Route platform-specific UI pattern requests to focused sub-guides so implementation details stay accurate and consistent.

## Workflow
1. Identify the target platform: Expo/React Native, Next.js/web, or both.
2. Identify the requested visual behavior in plain language.
3. Map the request to a pattern guide.
4. Implement from that guide and verify behavior visually.

## Pattern Guides
- `masked-fade-overlay`
  Path: `./masked-fade-overlay/SKILL.md`
  Use for: blur that is strong at one edge and transparently fades out via alpha masks.

## Guardrails
- Prefer real compositing behavior over visual approximations.
- Reject fake solutions when a user asks for "blur that becomes transparent."
- Keep platform guidance separate and explicit.

## References
- For masked blur fades, use:
  - `./masked-fade-overlay/references/expo.md`
  - `./masked-fade-overlay/references/nextjs.md`
