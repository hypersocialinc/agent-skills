---
name: masked-fade-overlay
description: Implement blur overlays where blur alpha fades to transparent using a mask, not a flat blur plus dark tint. Use when users ask for effects like "blur at bottom that disappears toward top", "blur bleed into image", or text-legibility overlays on image cards in Expo or Next.js.
---

# Masked Fade Overlay

## Core Rule
Use an alpha mask to control blur visibility.

If a user asks for blur that fades out, do not ship a fake version with only a dark gradient over a uniform blur.

## Implementation Steps
1. Determine fade direction from user request (common: bottom -> top).
2. Create a gradient mask with opaque alpha at the strong-blur edge and transparent alpha at the fade edge.
3. Apply the mask to the blur layer itself.
4. Add an optional low-opacity tint gradient only for text contrast.
5. Verify the fade edge has no residual blur.

## Platform References
- Expo / React Native:
  `./references/expo.md`
- Next.js / Web:
  `./references/nextjs.md`

## Visual Acceptance Checklist
- Blur is strongest at the requested edge.
- Blur smoothly decays toward the opposite edge.
- Fade edge is visually clear (no haze band).
- Text remains legible without crushing image detail.
