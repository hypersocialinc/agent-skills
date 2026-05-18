---
name: swiftui-collapsible-pull-sheet
description: "Build or adapt a SwiftUI collapsible pull sheet for iOS: a custom bottom or trailing overlay that starts as a compact pill, expands with drag or tap, morphs height, corner radius, material treatment, and content visibility from collapsed to expanded, coordinates surrounding chrome opacity, and supports in-sheet route transitions. Use when asked to implement, port, analyze, or refine collapsed/expanded pull sheets, floating bottom sheets, custom detents, drag-driven SwiftUI panels, or iOS sheet animations."
---

# SwiftUI Collapsible Pull Sheet

## Workflow

1. Inspect the target app's existing SwiftUI layout, theme tokens, haptics helper, and safe-area handling before writing code.
2. Prefer a custom overlay view over `.sheet` when the collapsed state must remain visible, morph into expanded content, or coexist with map/viewer chrome.
3. Model the sheet as two explicit detents, `collapsed` and `expanded`, plus a continuous `expansionProgress` value shared with the parent when surrounding controls need to fade or move.
4. Keep geometry in a dedicated metrics type. Derive collapsed height, expanded height, sheet width, content width, landscape placement, and bottom safe-area extension from `GeometryProxy` size and safe-area insets.
5. Use drag translation to compute live height and progress without implicit animation during the drag. On release, settle to the next detent with a spring and one haptic tick only when the detent changes.
6. Drive visual morphing from progress: height, corner radius, header thumbnail size, title size/line limit, scroll opacity, material tint/whitewash, and other chrome opacity.
7. Attach the drag gesture to both the handle and compact header. Add tap-to-expand on the collapsed header.
8. Disable expanded scrolling while collapsed; keep the expanded content in the view hierarchy but fade it in after early progress so the compact state remains clean.
9. Verify on portrait and landscape devices, with long titles, dynamic safe areas, and interactive drags.

## Reference

Read `references/swiftui-pull-sheet-pattern.md` when implementing or analyzing this pattern. It contains the source-derived anatomy, animation constants, layout rules, and a portable SwiftUI skeleton.

## Scope

This skill is app-agnostic. Treat the reference constants as proven defaults, then adapt names, colors, content, safe-area constraints, and surrounding chrome behavior to the target SwiftUI app.
