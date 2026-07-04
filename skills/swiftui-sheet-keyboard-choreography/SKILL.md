---
name: swiftui-sheet-keyboard-choreography
description: "Use when a SwiftUI sheet should open with the keyboard already rising (auto-focused TextField/composer) and the animations stagger — sheet settles first, keyboard pops late, the input bar bounces up-then-down, focus silently fails, or the keyboard appears then immediately drops. Also use when a keyboard-focused sheet's dismissal should retract the keyboard together with the sheet. Symptoms: '@FocusState in .task/.onAppear does nothing', 'keyboard appears after a visible gap', 'composer overshoots above the keyboard and settles back', 'medium detent sheet jumps to full height when keyboard shows'."
---

# SwiftUI Sheet + Keyboard Choreography

Present a sheet with the keyboard rising **as one motion** (iMessage-compose style), and dismiss them together — in pure-ish SwiftUI.

## Why naive approaches fail (all observed, not hypothetical)

| Attempt | What actually happens |
|---|---|
| `draftFocused = true` after a delay (300–500ms) | Works, but visibly staggered: sheet settles, THEN keyboard pops and re-lifts the input bar — an up-then-down bounce |
| `draftFocused = true` immediately in `.task`/`.onAppear` | `@FocusState` cannot co-animate with a presentation; worse, at bind time the field may not be mounted, so focus **fails silently** — no keyboard at all |
| Any auto-focus on a `.medium` detent sheet | The keyboard SHOVES the medium sheet to full height (Apple Forums #743274): the input bar travels sheet-distance + keyboard-height and settles back — the big ride |
| Retiring the prewarm field when you *attempt* the handoff | If focus didn't land yet, unmounting the prewarm resigns first responder and the keyboard drops mid-presentation |

## The pattern (4 pieces, all required)

1. **UIKit prewarm field** — a near-invisible `UITextField` that calls `becomeFirstResponder()` in `didMoveToWindow`. UIKit *can* grab the keyboard during a presentation transition, so the keyboard rises with the sheet. (Pattern origin: github.com/naan/FocusOnAppear.)
2. **Land-gated handoff** — after the sheet content mounts (~400ms is safe; the keyboard is already visibly up so the wait is invisible), set the real field's `@FocusState`. Retire the prewarm **only when focus actually lands** (`onChange(of: focused)`), never on the attempt.
3. **Open at `.large`** — never auto-focus on a `.medium` detent. If the sheet has a detent-selection binding, reset it to `.large` for the next open.
4. **Freeze bottom accessories from frame one** — anything that collapses when focus lands (emote strips, suggestion rows) must render collapsed from the first frame during auto-open, or its height change adds another bar jump mid-rise.

**Exit symmetry:** an explicit close control clears focus and dismisses in the same transaction (`focused = false; onClose()`); sheet drag-dismiss already pulls the keyboard along natively.

## Skeleton

Complete adaptable implementation in `references/implementation.md` — the prewarm representable, state wiring, handoff task, and accessory gating, extracted from a shipped app.

## Red flags

- A bare `Task.sleep` before `focused = true` with no prewarm → you have the gap
- `autoFocusPending = false` (or prewarm unmount) in the same statement as the focus attempt → keyboard will drop when the attempt races the mount
- `presentationDetents([.medium, .large])` on an auto-focusing sheet without forcing `.large` at open → overshoot
