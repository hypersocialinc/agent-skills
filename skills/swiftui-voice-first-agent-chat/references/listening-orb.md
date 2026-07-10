# The listening orb: a lit sphere of glass that ripples with the voice

The overlay that appears while the mic is held: the home recedes behind a material
scrim, a glass orb inflates up from the mic pill, "Listening…" bends along its crown,
and the live transcript replaces it as words arrive. Entirely non-interactive
(`allowsHitTesting(false)`) — the held mic owns the gesture.

## Design thesis (what "glassy" actually means here)

The orb is **lit but not opaque**. Both extremes fail, and both were tried:

- A fully clear orb (material only) over an already-softened feed reads as *just a
  blurred screen* — there's no object.
- A fully white orb is a lid — the feed disappears and the glass stops being glass.

What works: the material blurs the feed *again* on top of the host's recede, and that
difference between blurred-behind and blurred-again is what reads as a lens. A light
tint gradient over it (heavier toward the foot) makes it a body of milky light without
killing the see-through. **Nothing is stroked** — the boundary is a mask whose edge is
blurred, so the sphere meets the feed across a soft band of light, and that boundary is
what ripples when you speak. Silence is the resting state: `level == 0` collapses the
wobble to an exact circle.

## Structure

```
VoiceOverlay(listening: Bool, speech: SpeechRecognizer)
├── calmingScrim         Rectangle(.ultraThinMaterial) + bg-tint overlay
│                        .compositingGroup()
│                        .mask(LinearGradient clear@0.02 → 50%@0.30 → white@0.55)
├── OrbSphere(level:)    constant frame (width × 1.5), .scaleEffect collapse,
│                        .position, opacity-gated
├── CurvedText("Listening…")  same frame+position as the orb (shared centre),
│                        phaseAnimator pulse, hidden once transcript is non-empty
└── transcript Text      flat (NOT curved), top-padded to ~55% height so it sits
                         on the sphere's face below the crown
```

Host side: the home recedes with **scale + opacity only** (`scaleEffect(1.05)`,
`opacity(0.75)`) — the softening comes from the overlay's material scrim. The scrim is
masked so the top of the feed stays itself and the calm gathers around the sphere.

## The performance rules (each one was a shipped lag)

1. **Never animate `.blur(radius:)` over the home hierarchy.** Re-filters the whole
   NavigationStack every frame; this alone made the press lag. The material scrim IS
   the blur — a hardware backdrop filter that costs the same at any opacity.
2. **Constant frame + `scaleEffect` for the inflation.** Scaling transforms a cached
   layer. Animating the frame re-rasterises the material, the compositing group and
   the blurred mask at a fresh size every frame of the expansion.
3. **Always mounted, gated by opacity** — both the orb and the curved label. Inserting
   them on press (`if listening`) allocates and rasterises the big Canvas/material
   layers mid-animation: the label visibly stuttered in.
4. **Gate the `TimelineView` when silent.** The ripple only means "I hear you", so
   below `level 0.01` render a static `sphere(phase: 0)`. Otherwise the timeline
   re-rasterises material + compositing group + blurred mask at 60Hz to draw the same
   circle — including while the overlay sits at opacity 0, which is most of the app's
   life.
5. **Pulse via `phaseAnimator`, never `withAnimation(.repeatForever)` in `onAppear`.**
   A repeat-forever started inside another transaction leaks into whatever else is
   animating (the press's entry fade) — the label appeared in stutters.
6. **Hoist literal-heavy gradients to `static let`.** Inline they push the Swift
   type-checker past its budget ("unable to type-check in reasonable time").

## OrbSphere layer recipe (light ↔ dark aware)

Order matters; everything except the halo is inside one `compositingGroup` masked by
the blurred contour:

```swift
ZStack {
    halo(phase:)                       // OUTSIDE the mask — a mask can only remove light
    Circle()
        .fill(.ultraThinMaterial)      // the distortion: blurs the feed AGAIN
        .overlay { litBody }           // tint gradient: white (light) / 0x2B2E36 graphite (dark)
                                       //   opacities ~0.08→0.44 light, 0.16→0.54 dark, top→foot
                                       //   + radial highlight near the crown (white, stays white in dark)
        .overlay { underside }         // cool shadow gathering at the foot — sells "round"
        .overlay { iridescence }       // angular mint/periwinkle/rose/butter, strokeBorder 60,
                                       //   blur 26, padding 14 (inside the feather), brightens with level
        .compositingGroup()
        .mask { silhouette(phase:) }   // OrbContour filled white, blurred — THE soft edge
}
```

Key numbers (tuned, keep the relationships even if you restyle):

- **Feather**: mask blur `12 − 5 × level` — a loud voice tightens the edge, so shouting
  reads as a crisper sphere, not a mushier one. Keep the feather well under the
  wobble's crest height or the blur eats the ripple.
- **Wobble**: amplitude `0.07 × level` on a base radius of `0.93` of the frame
  (headroom for crests + mask blur). Three harmonics so it never visibly repeats:
  `sin(7θ + 1.6t)·0.55 + sin(11θ − 2.2t)·0.30 + sin(4θ + 0.9t)·0.15`.
- **Dark mode is not an inversion**: body tint flips to smoked graphite (a white
  sphere over a dark home is a glowing blob), the underside shadow deepens toward
  near-black blue, but the halo and the crown highlight STAY white — they're light.
- Text on the sphere uses its own ink (`0x1C1C1E` light / `0xF2F2F7` dark), not the
  app's page ink — the orb is not the page, and coupling them breaks one mode later.

The contour shape (also used for the halo so glow and body share an edge):

```swift
struct OrbContour: Shape {
    var level: Double; var phase: Double
    func path(in rect: CGRect) -> Path {
        let radius = min(rect.width, rect.height) / 2 * 0.93
        let amplitude = 0.07 * min(max(level, 0), 1)
        var path = Path()
        for step in 0...180 {
            let angle = Double(step) / 180 * 2 * .pi
            let wobble = sin(angle*7 + phase*1.6)*0.55
                       + sin(angle*11 - phase*2.2)*0.30
                       + sin(angle*4 + phase*0.9)*0.15
            let r = radius * (1 + wobble * amplitude)
            let p = CGPoint(x: rect.midX + cos(angle)*r, y: rect.midY + sin(angle)*r)
            step == 0 ? path.move(to: p) : path.addLine(to: p)
        }
        path.closeSubpath(); return path
    }
}
```

## Curved status text

One short line bent along the sphere's crown. Draw it in a `Canvas` in the **orb's own
coordinate space** — give the `CurvedText` view the orb's frame and position and the
two share a centre, which is the whole trick. Canvas (not a stack of rotated `Text`s)
because it can `resolve` and measure each glyph, so the advance around the circle
matches real letter widths:

```swift
// centre the run on the top of the circle, then step glyph by glyph
var angle = -.pi / 2 - (totalWidth / radius) / 2
for glyph in glyphs {
    let sweep = glyph.width / radius            // arc length / radius = angle consumed
    let mid = angle + sweep / 2
    // position on the circle, rotate by mid + π/2 so the glyph sits square on the curve
    angle += sweep
}
```

Baseline at `radiusFraction 0.80` keeps the text inside the sphere rather than riding
the edge. **Do not curve the transcript** — a wrapping multi-line caption on an arc is
a legibility problem, not a flourish. The transcript is flat, semibold ~26pt, pinned to
the sphere's face (top padding ≈ 55% of height — the arc drops away at the flanks, so
text level with the apex hangs off at its ends).

## Motion

- Inflate on press: `.spring(response: 0.26, dampingFraction: 0.86)` — the orb must
  feel like it was already there when the finger lands.
- Collapse on release: `.spring(response: 0.45, dampingFraction: 0.9)` — the exit can
  breathe. Asymmetric on purpose.
- Status ↔ transcript crossfade: `easeInOut(0.35)` keyed on "has any words yet".
