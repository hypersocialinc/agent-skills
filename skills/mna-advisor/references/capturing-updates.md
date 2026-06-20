# Capturing updates — the retention routine

How to log a new piece of deal information (a call, email, decision, or signal) into the deal vault so it stays correct and complete over time. Run this whenever something happens. You can wrap it in a slash command (e.g. `/deal-capture <what happened>`) for convenience.

## Routine

1. **Classify** the input → which artifact(s) it belongs in:
   - email / DM / message → `threads/`
   - call / meeting → `meetings/`
   - strategic decision or framework → `decisions/`
   - new or changed counterparty → `people/`
   - status / context shift → `deal-tracker.md`
   - an action to take → `todos.md`

2. **Update the right files.** Always:
   - Append to the **`deal-tracker.md` activity log** (dated entry).
   - Update **`todos.md`** if an action is implied or completed.
   - Create/update the **specific note** (thread/meeting/decision/person).
   - Update any **affected `people/` profile**.

3. **Apply conventions:**
   - **Absolute dates** (`2026-06-20`), never relative.
   - Proper **frontmatter** and **`[[wikilinks]]`** matching the vault's existing style.
   - **Verbatim quotes** for signals — preserve exact wording.

4. **Propagate corrections.** If the new fact contradicts something already on record, **grep the whole vault and fix every stale copy** — do not just append a correction and leave old versions standing. Stale facts in three files read as truth.

5. **Respect guardrails** in the repo's `CLAUDE.md` (e.g., never cross-name competing acquirers).

6. **Summarize** what changed, then **offer to commit** (one commit, clear message).

Before writing, briefly confirm the classification if it's ambiguous. Otherwise proceed.
