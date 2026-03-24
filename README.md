# Agent Skills

Portable skill catalog and installer for Codex and Claude-style agent runtimes.

## Repo Layout

- `skills/`: canonical skill source folders
- `bin/skills.js`: local installer CLI

## Included Skills

- `convex-streaming-agents`
- `convex-r2-media`
- `hyper-ui-skills`

## CLI

List available skills:

```bash
node bin/skills.js list
```

Install a skill into Codex:

```bash
node bin/skills.js install convex-streaming-agents --target codex
```

Install into all known targets:

```bash
node bin/skills.js install convex-streaming-agents --target all
```

Install into Claude:

```bash
node bin/skills.js install convex-streaming-agents --target claude
```

Install directly from GitHub:

```bash
node bin/skills.js install hypersocialinc/agent-skills/convex-streaming-agents --target codex
```

Install from a GitHub tree URL:

```bash
node bin/skills.js install https://github.com/hypersocialinc/agent-skills/tree/main/skills/convex-streaming-agents --dir ./tmp/skills
```

Install into a custom directory:

```bash
node bin/skills.js install convex-streaming-agents --dir ./tmp/skills
```

Update an installed skill from its recorded source:

```bash
node bin/skills.js update convex-streaming-agents --target codex
```

Update from an explicit source:

```bash
node bin/skills.js update convex-streaming-agents --target codex --source hypersocialinc/agent-skills/convex-streaming-agents
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
- Installed skills get a local `.agent-skill-install.json` file so `update` can reuse the original source.
- GitHub source specs currently support:
  - `owner/repo/skill-name`
  - `owner/repo/path/to/skill`
  - `https://github.com/owner/repo/tree/<ref>/path/to/skill`
