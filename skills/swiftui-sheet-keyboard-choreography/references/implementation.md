# Implementation — sheet + keyboard as one motion

Source-derived from a shipped chat sheet (SuperSpaces `ChatSheet.swift`). Adapt names; keep the ordering and gating exactly.

## 1. The prewarm field

```swift
/// Near-invisible UIKit field that grabs first responder the moment it
/// lands in a window — DURING the sheet's presentation — so the keyboard
/// rises with the sheet as one motion. Pure `@FocusState` can't do this:
/// it only takes effect after the presentation settles.
private struct KeyboardPrewarm: UIViewRepresentable {
    final class Field: UITextField {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window != nil { becomeFirstResponder() }
        }
    }

    func makeUIView(context: Context) -> Field {
        let field = Field()
        // isHidden would block first-responder status; near-zero alpha
        // keeps it invisible while remaining focusable.
        field.alpha = 0.02
        return field
    }

    func updateUIView(_ uiView: Field, context: Context) {}
}
```

If the real field uses a non-default keyboard type / appearance, set the same
traits on the prewarm field so the keyboard doesn't visibly morph at handoff.

## 2. State + mounting in the sheet view

```swift
@FocusState private var draftFocused: Bool
/// True from first render until the auto-focus handoff completes.
/// Gates the prewarm field AND keeps focus-collapsing accessories
/// (emote rows, suggestion strips) collapsed from frame one.
@State private var autoFocusPending = true

var body: some View {
    content
        // Prewarm mounts with the view, so didMoveToWindow fires during
        // the presentation transition.
        .background {
            if autoFocusPending {
                KeyboardPrewarm()
                    .frame(width: 1, height: 1)
                    .accessibilityHidden(true)
            }
        }
        .onChange(of: draftFocused) { _, focused in
            // Retire the prewarm ONLY once focus actually lands.
            // Unmounting it on the attempt (before focus stuck) resigns
            // first responder and drops the keyboard mid-presentation.
            if focused { autoFocusPending = false }
        }
        .task {
            // ... bind the conversation / load whatever the field needs ...

            // Keyboard is already visibly up via the prewarm, so waiting
            // for the real field to mount is invisible. An immediate
            // handoff races the mount and fails silently. 400ms covers a
            // normal mount; if your content mounts asynchronously, gate on
            // that instead of wall-clock time, and RETRY on failure —
            // otherwise a failed handoff leaves the prewarm holding an
            // orphaned keyboard:
            for _ in 0..<3 where !draftFocused {
                try? await Task.sleep(for: .milliseconds(400))
                draftFocused = true
            }
        }
}
```

Notes that prevent well-meaning "cleanup" breakage:
- `alpha = 0.02`, not `0`: UIKit treats fully transparent views like hidden
  ones for first-responder purposes. Don't round it down.
- `autoFocusPending` starting `true` assumes a fresh view per presentation
  (`sheet(item:)` gives you this). A reused view needs an explicit reset.
- Hardware keyboard / iPad: first responder is acquired the same way; no
  software keyboard shows, focus still lands, nothing to special-case.
- If the composer has an `inputAccessoryView`, give the prewarm the same
  one, or accept a one-frame accessory pop-in at handoff.

## 3. Detents — never auto-focus on `.medium`

The keyboard shoves a `.medium` sheet to full height (Apple Forums thread
743274); the input bar rides sheet-distance + keyboard-height and settles
back. Present at `.large`. Full plumbing (the sheet receives the selection
binding as an optional so non-detent presenters can omit it):

```swift
// Presenter
@State private var chatDetent: PresentationDetent = .large   // NOT .medium

.sheet(item: $route) { route in
    QuickReplySheet(route: route, detentSelection: $chatDetent, onClose: ...)
        .presentationDetents([.medium, .large], selection: $chatDetent)
}

// Sheet view
var detentSelection: Binding<PresentationDetent>? = nil
// Keep the NEXT open at .large (state outlives the presentation):
.onDisappear { detentSelection?.wrappedValue = .large }
```

Keeping `.medium` in the list is fine: by the time a user can drag there,
the handoff is complete and dragging to medium dismisses the keyboard
normally. If a design REQUIRES opening at `.medium`, don't auto-focus —
the shove is structural, not tunable.

## 4. Focus-collapsing accessories

Any strip that hides while typing must be collapsed from the FIRST frame of
an auto-focusing sheet, or its collapse adds a second bar jump mid-rise:

```swift
private var emoteRowVisible: Bool {
    emotesOn && (!draftFocused && !autoFocusPending || emotesPinned)
}
```

## 5. Exit symmetry

```swift
Button {
    draftFocused = false   // keyboard retracts in the SAME transaction…
    onClose()              // …as the sheet dismissal — one motion out
} label: { Image(systemName: "chevron.left") /* bare, 34pt hit target */ }
```

Drag-to-dismiss needs nothing: the sheet drags the keyboard along natively.

## Sequence recap

1. Sheet presentation starts → prewarm lands in window → keyboard rises WITH the sheet.
2. Content mounts; accessories that collapse on focus were never expanded.
3. ~400ms: `draftFocused = true` → same keyboard session transfers to the real field.
4. `onChange` sees focus land → prewarm unmounts (inert from here).
5. Close: focus cleared + dismissal in one transaction.
