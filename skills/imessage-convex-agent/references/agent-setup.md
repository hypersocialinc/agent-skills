# Agent wiring: @convex-dev/agent + OpenRouter

The minimum to go from zero to `agent.generateText` in a Convex project. For
streaming architectures, persisted partials, and client UX, use the
`convex-streaming-agents` skill — this is just the non-streaming channel case.

## Install

```bash
npm i @convex-dev/agent @openrouter/ai-sdk-provider ai
npx convex env set OPENROUTER_API_KEY <key>
```

## Register the component — `convex/convex.config.ts`

```ts
import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";

const app = defineApp();
app.use(agent);
export default app;
```

Run `npx convex dev` once after this so codegen emits `components.agent`.

## Define the agent — `convex/agents.ts`

```ts
import { Agent } from "@convex-dev/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { stepCountIs } from "ai";
import { components } from "./_generated/api";
import { myTool, myOtherTool } from "./tools"; // createTool from @convex-dev/agent

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export const myTextAgent = new Agent(components.agent, {
  name: "my-text-agent",
  languageModel: openrouter.chat("anthropic/claude-sonnet-5", {
    // Optional: reasoning adds seconds to time-to-first-token; "low" is a
    // good default for capture/recall turns.
    reasoning: { enabled: true, effort: "low" },
  }),
  instructions: TEXT_INSTRUCTIONS, // include a text-channel addendum: plain
  // text only, no markdown headers/asterisks, numbered lists for options.
  tools: { myTool, myOtherTool }, // NO app-UI-rendering tools on this variant
  stopWhen: [stepCountIs(8)], // tool-call step budget per turn
});
```

## Threads + generateText — inside an action

```ts
import { createThread } from "@convex-dev/agent";
import { components } from "./_generated/api";
import { myTextAgent } from "./agents";

// Create (then race-safely adopt — see webhook-and-brain.ts ensureThreadId):
const threadId = await createThread(ctx, components.agent, {
  userId, // the LINKED user — threads are namespaced per user
  title: "Chat",
});

// Text-only turn:
const result = await myTextAgent.generateText(ctx, { threadId }, { prompt });

// Multimodal turn (images already fetched into Convex storage):
const result2 = await myTextAgent.generateText(
  ctx,
  { threadId },
  {
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          { type: "image" as const, image: new URL(servedStorageUrl) },
        ],
      },
    ],
  },
);

// result.text — the reply to send.
// result.steps[].toolResults — extract tool side effects here; each entry's
// payload is `output` on AI SDK v5 and `result` on v4, so read defensively:
//   const id = tr.output?.id ?? tr.result?.id;
```

The agent component persists thread history itself — the channel tables in
`schema.ts` only store the `threadId` pointer per chat.
