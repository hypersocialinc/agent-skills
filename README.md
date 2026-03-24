# Agent Skills

Portable skill catalog and installer for Codex and Claude-style agent runtimes.

## Repo Layout

- `skills/`: canonical skill source folders
- `bin/skills.js`: local installer CLI

## Included Skills

- `convex-streaming-agents`
- `convex-r2-media`
- `hyper-ui-skills`
- `hypermoji`

## CLI

List available skills:

```bash
node bin/skills.js list
```

Install a skill into Codex:

```bash
node bin/skills.js install convex-streaming-agents --target codex
```

Install into Claude:

```bash
node bin/skills.js install convex-streaming-agents --target claude
```

Install into a custom directory:

```bash
node bin/skills.js install convex-streaming-agents --dir ./tmp/skills
```

Show target presets:

```bash
node bin/skills.js targets
```

## Notes

- Current target presets are based on local conventions:
  - Codex: `~/.codex/skills`
  - Claude: `~/.claude/agents`
  - Agents: `~/.agents/skills`
- The CLI copies skill folders verbatim, including nested references and agent metadata.
- Package naming for future `npx skills` publishing can be finalized later without changing the skill tree.
