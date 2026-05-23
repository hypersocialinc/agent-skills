# Agents

This repo contains agent skills -- implementation guides consumed by AI coding agents. The skills themselves define agent behavior; this file documents how to work on the repo.

## Current Skills

| Skill | Purpose |
|---|---|
| `convex-streaming-agents` | Streaming text agent architecture on Convex with Vercel AI SDK, persisted run state, tool traces, and client UX patterns |
| `convex-r2-media` | Convex + Cloudflare R2 media pipeline: schema design, public URL delivery, migration from Convex Storage, and Next.js integration |
| `hyper-ui-skills` | Router for platform-specific UI patterns (Expo + Next.js), currently includes `masked-fade-overlay` sub-skill |

## Skill Anatomy

A well-structured skill follows this pattern:

1. **Frontmatter** -- `name` and `description` for discovery/routing.
2. **When to Use / When Not** -- Clear scope boundaries.
3. **Architecture or Decision Tree** -- Help the agent choose the right approach.
4. **Implementation Guidance** -- Ordered steps, schema shapes, code patterns.
5. **Common Mistakes / Pitfalls** -- Things the agent should actively avoid.
6. **Review Checklist** -- Verification criteria after implementation.
7. **References** -- Pointer to `./references/*.md` for concrete extracted code.

## Writing Skills for This Repo

- Write for an AI agent audience, not humans. Be directive and specific.
- Structure content so an agent can follow it top-to-bottom as a workflow.
- Use tables and lists over prose paragraphs where possible.
- Include code snippets that show the pattern shape, not full copy-paste implementations.
- Put large extracted code blocks in `references/` to keep SKILL.md focused on guidance.
- Test that the skill description is specific enough for an agent to decide whether to invoke it.

## Sub-Skills

Skills can contain sub-skills (like `hyper-ui-skills/masked-fade-overlay/`). The parent SKILL.md acts as a router that maps requests to the correct sub-skill path.
