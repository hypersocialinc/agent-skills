---
name: swiftui-voice-first-agent-chat
description: "Build a voice-first agent chat in SwiftUI: a dock with a hold-to-talk mic pill, a speech-reactive glass orb overlay ('Listening…' + live caption), and release-to-send into a full-screen streaming agent chat. Use when an app wants push-to-talk capture with live transcription (SpeechAnalyzer/SpeechTranscriber + SFSpeechRecognizer fallback), a voice-reactive listening UI, or a custom full-screen chat presentation over the pushed-back home screen. Symptoms it fixes: mic press feels laggy, orb/overlay looks like 'just a blurred screen', transcription silently returns nothing on iOS 26, app crashes in installTap, sheet transitions strand a strip at the screen bottom, quick taps leave a hot mic."
---

# Voice-First Agent Chat (SwiftUI)

The complete interaction pattern from savethis: the app's command dock is voice-first —
**hold the mic pill to talk**, a lit-glass orb inflates and ripples with your voice under
a curved "Listening…" label, your words caption live on the sphere, and **releasing sends
the transcript straight into a full-screen agent chat** that streams the reply. Typing is
the secondary path (keyboard button on the dock), and both paths land in the same chat
surface.

This skill is the map. The four reference files hold the adaptable implementations with
every hard-won gotcha inline — copy from them rather than re-deriving:

- **`references/speech-engine.md`** — the two-backend speech facade
  (`SpeechAnalyzer`/`SpeechTranscriber` on iOS 26, `SFSpeechRecognizer` fallback), mic
  level plumbing, the audio-session actor, and the quick-tap race fix. Read this before
  touching any speech code: iOS 26's asset-reservation model fails *silently* if you
  skip a step.
- **`references/listening-orb.md`** — the voice-reactive overlay: lit glass sphere,
  level-driven edge ripple, curved status text, calming scrim, and the press-latency
  rules that keep touch-down instant.
- **`references/chat-layer.md`** — the full-screen chat presentation: card-sheet
  backdrop on the pushed-back home, drag-to-dismiss, screen-height transitions, the
  dock-mode compose bar that morphs into a type bar, and hold-to-talk inside the chat.
- **`references/agent-wiring.md`** — routing every entry point into ONE chat surface
  (`ChatRequest`), release-to-send seeding, streaming-agent hookup, and the error
  boundary that keeps a denied mic from becoming a dead button.

## The interaction grammar

```
        dock (idle)                     held                        released
┌──────────────────────────┐   ┌──────────────────────┐   ┌──────────────────────────┐
│ [☰]   ( 🎤 pill )   [⌨] │ → │  home recedes         │ → │ transcript non-empty:     │
│                          │   │  orb inflates from mic│   │   full-screen chat opens  │
│ tap ⌨ → same chat,       │   │  "Listening…" curved  │   │   with it already SENT    │
│ keyboard rising with it  │   │  words caption live   │   │ empty: settle back to dock│
└──────────────────────────┘   └──────────────────────┘   └──────────────────────────┘
```

Non-negotiables that make it feel right (each is explained in the references):

1. **Touch-down must respond within a frame.** Everything slow moves off the press path:
   audio session activation and engine start are async off-main, the haptic engine is
   prewarmed, the orb inflates by `scaleEffect` on a constant frame (never animate its
   frame, a material re-rasterises), and the overlay is always mounted, gated by opacity.
2. **One haptic system.** A single CoreHaptics pattern: transient tap decaying into a
   low continuous hum for the whole hold. Adding a separate impact haptic beside it
   reads as two distinct buzzes.
3. **Release-to-send, not release-to-review.** The transcript goes straight into the
   thread as a sent user message. An empty hold settles back silently.
4. **One chat surface for every entry.** Voice release, keyboard button, compose "+",
   deep links, thread reopens — all set the same request object and land in the same
   full-screen chat. No separate "voice chat" vs "compose sheet".
5. **The mic is never a silent dead end.** Permission denial drops the listening UI and
   offers Settings; engine failure mid-hold drops the overlay instead of pretending to
   listen. See the error-boundary section of `references/agent-wiring.md`.

## Sibling skills (compose, don't duplicate)

- **`swiftui-sheet-keyboard-animations`** — the keyboard prewarm + land-gated focus
  handoff used when the chat opens via the keyboard button. The chat layer's
  keyboard choreography (one `keyboardSpring` curve, `ignoresSafeArea(.keyboard)` on
  the sliding container, transform bar lift) builds on it; `references/chat-layer.md`
  covers the integration.
- **`convex-streaming-agents`** — the backend: start/status endpoints, persisted
  partial text, tool traces. `references/agent-wiring.md` shows the client side
  (seeding, hydration, thinking states); use that skill for the Convex functions.
- **`ios-clerk-auth`** — if the agent runs as the signed-in user.

## Red flags (all observed, not hypothetical)

- `withAnimation { ... .blur(radius:) }` over the home hierarchy on press → the press
  lags. The "blur" is the overlay's material scrim, never an animated `.blur`.
- iOS 26 transcription runs but produces empty text, console says "Cannot use modules
  with unallocated locales" → you skipped `AssetInventory.reserve`. It gates *use*,
  not just download, and returns `false` when already reserved — check
  `reservedLocales`, don't trust the return value.
- Crash in `installTap` (NSException, not a Swift error) → you read the mic format
  before activating the audio session. Activation with `.measurement` can change the
  hardware sample rate.
- Mic indicator stays lit after a quick tap with no UI showing → your `stop()` guards
  on `isRecording`, which an in-flight async `start()` hasn't set yet. Use the hold
  token from `references/speech-engine.md`.
- The sheet's top strip flashes/parks at the screen bottom during open/close →
  `.move(edge:)` travels by *layout* height and your container is safe-area inset.
  Use the screen-height offset transition from `references/chat-layer.md`.
- "Listening…" label appears in stutters → `repeatForever` started in `onAppear`
  leaks into the insertion transition. Use `phaseAnimator`, keep the label mounted.
- Testing note: hold-to-talk is **not simulator-drivable** (HID events can't sustain a
  press) and the SpeechTranscriber model is `.unsupported` on the Simulator — only the
  legacy engine runs there. Plan a device pass for the hold flow.

## Build order that works

1. Speech facade + dock pill hold gesture (verify transcript + level on device).
2. Listening overlay (orb, scrim, curved status, caption) driven by `speech.level`.
3. Chat layer presentation (backdrop, transitions, drag dismiss) with typed entry.
4. Release-to-send seeding + agent streaming.
5. Dock-mode bar inside the chat (hold-to-talk works mid-conversation too).
6. Error boundary + permission alert last, but never skip it.
