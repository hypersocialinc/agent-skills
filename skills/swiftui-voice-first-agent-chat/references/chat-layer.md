# The chat layer: full-screen agent chat over the pushed-back home

Not a `.sheet`. The chat is a full-screen layer in the host's ZStack, presented over
the home screen pushed back like a card (scaled, corner-rounded, dimmed, floating on a
shadow), with a header drag to dismiss that the backdrop rides 1:1. Every entry point —
voice release, keyboard button, compose "+", thread reopen — presents this ONE layer.

Deliberately not the native black-void sheet treatment: over a light theme a black slab
behind the card reads as another app entirely. The backdrop stays the app's own
background.

## Host wiring

```swift
ZStack {
    homeContent
        .allowsHitTesting(chatRequest == nil)
        .chatBackdrop(presented: chatRequest != nil, drag: chatDrag)

    if chatRequest == nil {
        CommandDock(...)
            // removed ZStack children drop to stacking order 0 for their exit
            // animation — without an explicit zIndex the dock hard-cuts behind
            // the restoring home instead of animating out
            .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .bottom)))
            .zIndex(1)
    }
    if let chatRequest {
        ChatLayer(store: store, request: chatRequest, drag: chatDrag,
                  onClose: { closeChat() })
            .transition(.chatSlide)
            .zIndex(2)          // outgoing sheet stays ABOVE the restoring home
    }
}
```

Open/close:

```swift
withAnimation(.keyboardSpring) { chatRequest = request }   // open: co-animates with keyboard rise
withAnimation(.sheetSlide)     { chatRequest = nil }       // close: its own crisp settle
```

## Three transition traps (each shipped as a visible bug)

1. **`.move(edge: .bottom)` travels by the view's LAYOUT height.** If the host
   container is bottom-safe-area inset (it usually is), "fully moved off" leaves the
   sheet's top ~34pt on screen — a grabber strip flashes at the bottom before every
   slide-up and parks there after every slide-down. Transition by MORE than the screen
   instead, both directions:

   ```swift
   extension AnyTransition {
       static var chatSlide: AnyTransition {
           .offset(y: UIScreen.main.bounds.height * 1.15)
       }
   }
   ```

2. **Don't reuse the keyboard spring for the full-screen slide.** The system keyboard
   spring (`interpolatingSpring(mass: 3, stiffness: 1000, damping: 500)` — see the
   `swiftui-sheet-keyboard-animations` skill) is heavily overdamped (ζ ≈ 4.6):
   invisible over the keyboard's ~340pt travel, a visible crawl over ~850pt. The exit
   gets its own spring:

   ```swift
   static let sheetSlide = Animation.spring(response: 0.42, dampingFraction: 0.92)
   ```

   Open still uses `keyboardSpring` when the keyboard rises with it (one curve on
   screen); nothing needs keyboard-matching on close — the bar detaches the moment the
   slide starts regardless.

3. **`clipShape` clips to the view's BOUNDS even at `cornerRadius: 0`.** The backdrop's
   clip (below) silently amputated every bottom safe-area bleed — feed under the dock,
   dock shadows — by exactly 34pt, app-wide, whenever idle. Outset the shape when not
   presented. This one outlived four wrong fixes; if you see a "gap" at the screen
   bottom, check whether content is CUT at the safe-area line (a clip) before touching
   scrims or paint.

## The card backdrop

```swift
struct ChatBackdrop: ViewModifier {
    var presented: Bool
    var drag: ChatDragModel                 // read HERE, not in the host body

    private var t: CGFloat { presented ? drag.progress : 1 }
    private var scale: CGFloat { 0.92 + 0.08 * t }
    private var corner: CGFloat { presented ? 28 : 0 }   // keyed on Bool, NOT drag
    private var dim: Double { 0.28 * (1 - Double(t)) }
    private var shadowStrength: Double { presented ? 0.22 : 0 }

    func body(content: Content) -> some View {
        content
            .clipShape(
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .inset(by: presented ? 0 : -200)     // trap #3 above
            )
            .overlay { RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(.black.opacity(dim)).allowsHitTesting(false) }
            .shadow(color: .black.opacity(shadowStrength), radius: 28, y: 10)
            .scaleEffect(scale)
    }
}
```

Why corner + shadow key off `presented` while scale + dim ride the finger: animating a
clip path re-rasterises the whole clipped tree (NavigationStack + feed) every frame of
a drag, and the 28pt shadow recomputes against the changing shape. One change per
present/dismiss; only cheap transforms and fill opacities per frame.

## Per-frame drag state: the observable box

A host-owned `@State CGFloat` invalidates the host's ENTIRE body on every finger-move
frame — NavigationStack, feed, dock, overlay all re-diffed at 60–120Hz; the pull
visibly stuttered. Box it:

```swift
@MainActor @Observable
final class ChatDragModel {
    var y: CGFloat = 0
    var progress: CGFloat { min(1, max(0, y / ChatLayer.dismissDistance)) }
}
```

Only the two actual readers re-evaluate: the chat's `.offset` and the backdrop modifier
(whose `content` is an opaque proxy, so the home subtree isn't re-diffed at all). The
host resets `y = 0` on OPEN, not on close — resetting mid-exit animates the backdrop
twice.

## The dismiss drag

On the header strip only — never on the scroll content (iOS 26: any SwiftUI
`DragGesture` on scroll content freezes the ScrollView entirely).

```swift
DragGesture(minimumDistance: 8, coordinateSpace: .global)
    .onChanged { value in
        if value.translation.height > 0, !retractedForDrag {
            retractedForDrag = true
            resignKeyboard()          // a real sheet retracts the keyboard AS you drag
        }
        drag.y = max(0, value.translation.height)
    }
    .onEnded { value in
        retractedForDrag = false
        let far = value.translation.height > 110
        let flick = value.predictedEndTranslation.height > ChatLayer.dismissDistance  // 260
        if far || flick { close() }
        else { withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) { drag.y = 0 } }
    }
```

**`.global` coordinate space is non-negotiable**: the gesture rides a view that offsets
by its own translation. Measured locally, the space moves under the finger —
translation collapses, the offset falls back, translation reads large again — and the
sheet oscillates against the pull.

## ChatLayer structure & keyboard choreography

```swift
ZStack(alignment: .top) { ChatSurface(layout: .inline, ...); header }
    .geometryGroup()               // children animate as ONE geometry mid-slide
    .ignoresSafeArea(.keyboard)    // the keyboard must NOT re-layout the sliding container
    .offset(y: max(0, drag.y))     // tracks the finger 1:1; springs only on release
```

The surface never keyboard-avoids. Instead a `KeyboardObserver` publishes the end
frame from `keyboardWillChangeFrame` (delivered BEFORE the animation runs), and the
compose bar lifts by transform on the keyboard spring, with matching
`contentMargins(.bottom, lift, for: .scrollContent)` for the transcript. Full pattern —
prewarm field, land-gated focus handoff, the one-curve rule — is the
`swiftui-sheet-keyboard-animations` skill; this layer is its integration site.

`KeyboardObserver` gotcha: the block-based `NotificationCenter.addObserver` retains its
blocks — capture `[weak self]` or every observer instance leaks for the life of the
process (one per chat open) and `deinit`'s `removeObserver` never runs.

## The dock-mode compose bar (inside the chat)

Between messages the bar rests as the home dock's grammar transplanted: ＋ circle /
hold-to-talk pill / ⌨ circle. Focus or text morphs it into the type bar. One ZStack
slot, one curve:

```swift
@ViewBuilder private var bottomBar: some View {
    ZStack {
        if dockMode {
            dockBar.transition(.opacity.combined(with: .scale(scale: 0.96)))
        } else {
            composeBar
                .transition(.opacity.combined(with: .move(edge: .bottom)))
                .task(id: wantsKeyboard) {      // see below
                    guard wantsKeyboard else { return }
                    for _ in 0..<4 where !inputFocused {
                        try? await Task.sleep(for: .milliseconds(120))
                        inputFocused = true
                    }
                    wantsKeyboard = false
                }
        }
    }
    .animation(.keyboardSpring, value: dockMode)
}
```

**`wantsKeyboard` exists because `@FocusState` writes fail silently when the bound
field isn't mounted.** The dock's ⌨/＋ buttons can't set `inputFocused` directly — the
field doesn't exist in dock mode. The flag flips the mode first; the retry loop claims
focus once the field mounts. `task(id:)` also re-fires when the flag flips while the
bar is already mounted.

The pill's hold gesture (`DragGesture(minimumDistance: 0)` — fires on touch-down; a
`holding` latch makes start/end fire exactly once) raises the SAME listening overlay
inside the chat, and release appends + sends:

```swift
private func endChatVoice() {
    guard chatListening else { return }
    holdHaptic.stop(); speech.stop()
    let text = speech.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    withAnimation(.spring(response: 0.45, dampingFraction: 0.9)) { chatListening = false }
    guard !text.isEmpty else { return }
    Haptics.send()
    inputFocused = false            // rest at the dock after a voice send
    messages.append(ChatMessage(body: .user(text)))
    runAgent(text)
}
```

While `chatListening`, the conversation recedes (opacity ~0.55), the overlay renders in
an `.overlay` of the surface, and any dictation strip is hidden (`speech.isRecording &&
!chatListening` gates it) — the hold's transcript belongs to the overlay, not the
field. If a field dictation is already running when a hold starts, `stop()` it first —
otherwise `start()` no-ops and the release re-sends the words already staged in the
input.

Suggestions/starter rows live INSIDE the transcript's LazyVStack so they scroll with
the thread — pinning them under the bar reads as broken.
