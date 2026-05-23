# Agent Skills Catalog

Reusable agent skills distributed via `npx skills add hypersocialinc/agent-skills`. Skills work across Claude Code, Codex, and other runtimes that support the open skills ecosystem.

## Repo Layout

```
skills/
  <skill-name>/
    SKILL.md              # Main skill content (required)
    agents/
      openai.yaml         # Codex/OpenAI agent config (optional)
    references/           # Supporting material (optional)
      *.md
```

## Skill Format

Every skill must have a `SKILL.md` with YAML frontmatter:

```yaml
---
name: skill-name
description: One-line description used for discovery and routing.
---
```

The body is structured prose that teaches an agent how to implement or review a specific pattern. Skills are not code libraries -- they are implementation guides.

## OpenAI Agent YAML

Each skill can optionally include `agents/openai.yaml` for Codex integration:

```yaml
interface:
  display_name: "Human Readable Name"
  short_description: "Short description"
  default_prompt: "Use $skill-name to ..."
```

## Adding a New Skill

1. Create `skills/<skill-name>/SKILL.md` with frontmatter and structured content.
2. Optionally add `agents/openai.yaml` for Codex support.
3. Optionally add `references/*.md` for concrete examples or extracted patterns.
4. Update the "Included Skills" section of `README.md`.

## Conventions

- Skill names use kebab-case.
- Skills should be self-contained implementation guides, not project-specific operational tools.
- Reference files hold concrete code extractions; SKILL.md holds the abstract guidance.
- Keep skills portable across projects -- avoid hardcoding org-specific URLs, table names, or env vars as requirements (use them as examples only).
- The `tmp-install/` directory is gitignored scratch space used by the installer -- never commit into it.

## Installation

```bash
# List available skills
npx skills add hypersocialinc/agent-skills --list

# Install one skill (Claude Code)
npx skills add hypersocialinc/agent-skills --skill <name> --agent claude-code

# Install one skill (Codex)
npx skills add hypersocialinc/agent-skills --skill <name> --agent codex

# Install all
npx skills add hypersocialinc/agent-skills --all
```
