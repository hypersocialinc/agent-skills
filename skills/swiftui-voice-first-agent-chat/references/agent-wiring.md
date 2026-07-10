# Agent wiring: one chat, many doors, and the error boundary

## ChatRequest: every entry point sets one value

The host holds `@State var chatRequest: ChatRequest?` — nil means closed. Every door
into the chat constructs a request; the layer renders identically regardless of door:

```swift
struct ChatRequest: Identifiable {
    let id = UUID()                    // fresh identity per open → fresh surface state
    var categoryHint: ItemCategory? = nil   // scope the greeting + nudge the classifier
    var autoPrompt: String? = nil           // auto-send on open (hidden scaffold allowed)
    var autoPromptLabel: String? = nil      // what the user SEES for autoPrompt
    var initialSend: String? = nil          // voice release hands the transcript here
    var startFocused: Bool = false          // keyboard button: open typing
    var existingThreadId: String? = nil     // Messages reopen: hydrate history
}
```

- **Voice release** → `ChatRequest(initialSend: transcript)`, opened with a fade (the
  orb overlay is already up; a slide under it looks wrong).
- **Keyboard button** → `ChatRequest(startFocused: true)`, opened with the slide, the
  keyboard rising WITH the presentation (prewarm — see
  `swiftui-sheet-keyboard-animations`).
- **Auto-prompt entries** (a "discover" dice, a deep link) → `autoPrompt` carries the
  full scaffolded instruction, `autoPromptLabel` the short human line that appears as
  the visible user bubble. Displaying `autoPromptLabel ?? autoPrompt` leaks internal
  scaffold strings the moment someone forgets the label — pass both, always.
- **Thread reopen** → `existingThreadId`; the surface hydrates history before
  accepting input.

The seeds are resolved in ONE `.task` with explicit priority order (thread → initialSend
→ startFocused → autoPrompt → zero-state). They're intentionally exclusive; a known
hardening is to make them an enum (`case voice(String)`, `case keyboard`, …) so
contradictory combinations don't compile.

Release-to-send from the home dock:

```swift
private func endVoice() {
    holdHaptic.stop(); speech.stop()
    let text = speech.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty {
        withAnimation(.easeInOut(duration: 0.3)) { listening = false }
    } else {
        Haptics.send()
        openChat(ChatRequest(initialSend: text), viaVoice: true)
    }
}
```

The `.task` seeding on the surface:

```swift
} else if let initialSend, !initialSend.isEmpty, messages.isEmpty {
    messages.append(ChatMessage(body: .user(initialSend)))
    runAgent(initialSend)
}
```

`messages.isEmpty` guards double-seeding when the task re-runs.

## Streaming agent hookup (Convex + Clerk shape)

The backend patterns — start/status endpoints, background worker, persisted partial
text, tool traces — are the `convex-streaming-agents` skill. Client-side rules that
make voice-first feel right:

- **Append the user message locally and synchronously** before any network. The
  release-to-send contract is "my words are in the thread the instant I let go" — a
  round-trip before the bubble appears reads as dropped input.
- **One thread id per conversation, owned by the surface** (`sessionThreadId`),
  created lazily by the first send and reused for the rest — that's what makes
  `existingThreadId` reopens land in the same history.
- **Route everything through the agent** (saves, questions, commands) rather than
  client-side intent heuristics — a transcript is messier than typed text, and "is
  this a save or an ask" guesses wrong on speech.
- **Thinking states**: a placeholder message with animated dots the moment `runAgent`
  fires, replaced in place by the streamed reply (and by reasoning-trace pills if the
  model exposes them). The placeholder must be replaced — not appended after — or
  failures strand a spinner in history.
- **Failure renders in-thread** as a message ("Couldn't reach the agent — tap to
  retry"), never a toast over a chat. A voice-seeded send that fails must NOT eat the
  transcript: keep the user bubble, mark the reply failed.
- With Clerk, the agent call carries the session token; run the thread as the signed-in
  user so history and personalization survive reinstalls (see `ios-clerk-auth`).

## The error boundary (mandatory, not polish)

The speech facade throws; SwiftUI hosts that swallow it with `try?` ship four real
bugs. The contract:

**1. Denial must surface — iOS shows the permission prompt exactly once.** After that,
a swallowed `.unauthorized` is a mic that pretends to listen forever:

```swift
Task {
    do { try await speech.start() }
    catch {
        holdHaptic.stop()
        withAnimation(.easeInOut(duration: 0.3)) { listening = false }  // never fake "Listening…"
        if speech.permissionDenied { micDenied = true }
    }
}
```

with a shared alert on every voice entry point:

```swift
func micDeniedAlert(isPresented: Binding<Bool>) -> some View {
    alert("Microphone is off for <YourApp>", isPresented: isPresented) {
        Button("Open Settings") {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        }
        Button("Not Now", role: .cancel) {}
    } message: {
        Text("Turn on microphone and speech recognition access in Settings to talk to <YourApp>.")
    }
}
```

**2. `.unavailable` (both engines failed: mic held by a call, degenerate format, no
recognizer) takes the same "drop the overlay" path.** The Settings alert is only for
denial; transient failures just settle back — but the overlay must come down.

**3. Mid-hold engine death**: the facade's `onFinish` flips `isRecording` false, but
the host's `listening` flag is gesture-owned. Watch for the divergence, or the orb
pulses over a dead mic and everything said after the failure evaporates:

```swift
.onChange(of: speech.isRecording) { _, recording in
    if !recording, listening, speech.transcript.isEmpty {
        holdHaptic.stop()
        withAnimation(.easeInOut(duration: 0.3)) { listening = false }
    }
}
```

(Transcript non-empty → leave the overlay: the release still sends what was heard.)

**4. A tap-to-dictate mic falls back to the keyboard** (`inputFocused = true`) so the
bar is never a dead end — plus the denial alert, so the user learns WHY they got a
keyboard.

## Known follow-ups in the pattern

- SwiftUI `DragGesture` has no cancellation callback: if the FIRST-run permission
  dialog cancels the touch, the `holding` latch can stick until the next press
  (recoverable but janky). The proper fix is a UIKit `UILongPressGestureRecognizer`
  (reports `.cancelled`) on the dock mic.
- Slide-to-lock (hands-free), slide-to-cancel, and VoiceOver activation for the hold
  gesture are natural extensions none of which this pattern includes yet.
- Hold-to-talk cannot be driven by simulator HID events; the modern speech model is
  Simulator-`.unsupported`. Budget a device pass for every change to this flow.
