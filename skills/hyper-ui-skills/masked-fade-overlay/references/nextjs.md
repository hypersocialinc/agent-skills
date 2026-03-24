# Next.js / Web

## Goal
Apply backdrop blur that fades to transparent using CSS masking.

## Core CSS
Use `backdrop-filter` on an overlay and mask its alpha with a vertical gradient.

```css
.maskedBlurOverlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 58%;
  pointer-events: none;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  mask-image: linear-gradient(
    to top,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.78) 40%,
    rgba(0, 0, 0, 0.24) 74%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to top,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.78) 40%,
    rgba(0, 0, 0, 0.24) 74%,
    transparent 100%
  );
}

.overlayTint {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.42) 0%,
    rgba(0, 0, 0, 0.24) 40%,
    rgba(0, 0, 0, 0.08) 74%,
    transparent 100%
  );
}
```

## Component Structure

```tsx
<div className="card">
  <img src={imageUrl} alt="" />
  <div className="maskedBlurOverlay" />
  <div className="overlayTint" />
  <div className="label">...</div>
</div>
```

## Browser Notes
- Include both standard and `-webkit-` prefixed properties.
- Test Safari and Chromium.
- If `mask-image` is unsupported, fall back to tint-only legibility layer and skip claiming blur-fade behavior.

## Anti-Patterns
- Do not use full overlay blur with opacity and call it masked blur.
- Do not rely on `filter: blur()` for this effect; it blurs overlay content, not background behind the overlay.

## Tuning Knobs
- Blur amount: `backdrop-filter: blur(...)`.
- Fade profile: gradient stop percentages and alpha values in mask.
- Readability: reduce or increase `overlayTint` alpha values.
