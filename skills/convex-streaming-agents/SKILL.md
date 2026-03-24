---
name: convex-streaming-agents
description: Build streaming text agents on Convex with Vercel AI SDK, including start and status endpoints, background workers, persisted partial text, tool traces, and client UX patterns like thinking dots and character reveal.
---

# Convex Streaming Agents

Use this skill when the user wants a Convex-backed streaming agent with a polished client experience, not just a one-shot text response.

## What This Skill Covers

- Vercel AI SDK `streamText(...)` with Convex
- choosing between direct HTTP streaming and Convex-backed persisted streaming
- start and status routes for async runs
- background worker patterns for long-running model calls
- persisted partial text, final text, and tool traces
- client-side thinking dots, typing animation, polling, and completion cleanup

## Architecture Choice

Choose one of these two patterns first.

### 1. Direct HTTP streaming

Use when:
- one client is watching the response live
- resumability is not important
- speed of implementation matters more than persistence

Pattern:
1. Client calls a Convex `httpAction`
2. `httpAction` calls `streamText(...)`
3. HTTP response streams chunks back directly
4. Client appends chunks as they arrive

### 2. Convex-backed persisted streaming

Use when:
- the run should survive reloads or reconnects
- multiple clients may watch the same run
- you want durable run state and traceability

Pattern:
1. Client calls `POST /api/agent/start`
2. Route creates an `agentRun` row and schedules an internal action
3. Internal action calls `streamText(...)`
4. Stream handler writes partial text and steps into Convex
5. Client polls or subscribes to `GET /api/agent/run` or a query
6. UI renders partial text until status becomes `completed` or `failed`

For most production agent UIs on Convex, prefer the persisted pattern.

## Backend Shape

Recommended tables:

- `agentRuns`
  - `status`
  - `prompt`
  - `streamedText`
  - `finalText`
  - `error`
  - `model`
  - `stepCount`
  - `createdAt`
  - `updatedAt`
- `agentSteps`
  - `runId`
  - `kind`
  - `label`
  - `payload`
  - `createdAt`

Recommended statuses:

- `queued`
- `running`
- `completed`
- `failed`

Keep `streamedText` and `finalText` separate. `streamedText` is the mutable live buffer. `finalText` is the finalized answer once the model run closes.

## Backend Workflow

1. Add schema fields first.
2. Create a start route that validates input, inserts a run, and schedules the worker.
3. Create an internal action for the worker.
4. Inside the worker, call `streamText(...)`.
5. Append partial text into `agentRuns.streamedText`.
6. Persist tool calls and model steps into `agentSteps`.
7. On completion, set `finalText`, `status`, and `updatedAt`.
8. On failure, set `status: failed` and store a concise `error`.

## Vercel AI SDK Pattern

Use `streamText(...)` inside a Convex Node action or internal action.

What to persist while streaming:

- accumulated partial text
- current run status
- tool call steps
- model step count

Do not wait until the end to write everything if the UI needs live progress.

## Client Workflow

Recommended flow:

1. Insert a placeholder assistant bubble immediately.
2. Show animated thinking dots until the first text arrives.
3. Start polling run state or subscribe reactively.
4. Maintain two strings:
   - `targetText`: latest text from backend
   - `renderedText`: what the user currently sees
5. Reveal `renderedText` toward `targetText` character by character.
6. When run completes, stop polling and remove transient thinking state.
7. If run fails, replace the placeholder with a short error message.

## UI Pattern: Thinking Dots

Thinking dots should exist before any text has arrived.

Rules:

- render them inside the assistant bubble, not beside it
- hide them as soon as the first character arrives
- animate three dots with staggered opacity or scale
- do not leave the dots visible once real text is streaming

## UI Pattern: Character Reveal

Use character reveal on the client even if the backend returns larger partial chunks.

Why:

- backend chunk cadence is irregular
- client-side smoothing makes the response feel intentional
- the UI remains consistent across model providers

Rules:

- reveal toward the latest `targetText`
- keep line breaks
- stop animation immediately if the final state is reached
- do not restart from zero on every poll

## Polling Guidance

Polling is acceptable for desktop and MVP web clients.

Reasonable cadence:

- active run: every `200ms` to `350ms`
- after completion: stop immediately

If polling is too chatty, persist less often or batch deltas server-side.

## Common Failure Cases

- Using `.convex.cloud` for HTTP actions instead of `.convex.site`
- Running `convex dev` from the wrong directory so new routes never deploy
- Schema migrations breaking existing rows because new fields were made required too early
- Writing `undefined` into patches on optional fields
- Replacing the whole assistant bubble on each poll instead of incrementally extending it
- Leaving the thinking indicator visible after text starts
- Losing the final answer because only partial text was stored

## Review Checklist

- Does the backend distinguish partial text from final text?
- Is there an explicit run status lifecycle?
- Are tool steps stored separately from visible assistant text?
- Does the client create a placeholder bubble immediately?
- Do thinking dots disappear on first text?
- Does the client reveal toward the latest target string instead of re-rendering from scratch?
- Does the UI stop polling on completion or failure?
- Are Convex HTTP endpoints called through `.convex.site`?

## When Not To Use This Skill

- one-shot chat completions with no streaming UX
- non-Convex backends
- server-sent text where no persisted run state is needed and plain HTTP streaming is enough
