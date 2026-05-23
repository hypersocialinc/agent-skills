---
name: transparent-video
description: "Generate a short looping transparent video (HEVC `hvc1` with alpha) from a single still image. Pipeline: SeedDance 2 image-to-video with optional end-frame anchoring for a seamless loop → ffmpeg split → BiRefNet v2 Matting per frame in parallel → ffmpeg encode HEVC with alpha. Output is a small (~1-2 MB) `.mov` that plays natively in iOS `AVPlayer`, web video tags, and any HEVC-alpha-capable runtime. Use when the user wants to animate a static character/hero image into an empty-state loop, ambient onboarding hero, badge animation, or any short transparent video. Don't use for chroma-key/green-screen footage (BiRefNet is ML segmentation, not color-keying), long videos (cost scales linearly with frame count), or audio."
---

# Transparent Video Loop

## Workflow

1. **Confirm prerequisites.** The user needs `genmedia` (fal.ai CLI, configured with API key), `ffmpeg` (Homebrew `ffmpeg` with `hevc_videotoolbox` — bundled on macOS), and a still image they want to animate. Check with `genmedia setup --status` and `which ffmpeg`.

2. **Pick the inputs.** Ask the user (or infer from context) for:
   - **still image** — local path or URL. Subject on transparent or solid background, ideally already isolated. If it's a complex scene with subject + environment, the loop will animate the whole frame.
   - **motion prompt** — what subtle ambient motion to apply. Keep it small: "characters breathe gently, hand waves slowly, leaves rustle." Big camera motion or scene changes break the closed-loop seam.
   - **closed loop or open?** — recommend closed for ambient UI loops; open is fine if the clip plays once or you don't mind a tiny seam.
   - **output path** — where to save the final `.mov`.

3. **Run the orchestrator.** `scripts/transparent-loop.sh` handles the full pipeline. Recommended invocation for a closed UI loop:

    ```bash
    scripts/transparent-loop.sh \
      --image ./hero.png \
      --prompt "Subtle ambient idle motion that returns to the starting pose. Static camera." \
      --output ./hero_loop.mov \
      --duration 5 \
      --closed-loop
    ```

   The script uploads the still to fal if it's a local path, runs SeedDance 2 fast image-to-video with `end_image_url = image_url` (closed-loop mode), splits frames with ffmpeg, processes each frame through BiRefNet v2 Matting in parallel (10 workers by default), then encodes HEVC alpha at 720×720 24fps.

4. **Inspect the output before shipping.** Open the `.mov` in QuickTime to verify: the loop is seamless, the alpha is clean (no halo, no missing characters), the file size is reasonable (1-3 MB for a 5s 720² clip). If a character disappeared, see the BiRefNet failure mode in `references/troubleshooting.md` — usually means the still had thin/translucent details the matting model can't recover.

5. **Wire into the target app.** iOS uses `AVPlayer` directly; the `.mov` plays with alpha out of the box if `playerLayer.pixelBufferAttributes` is set to `kCVPixelFormatType_32BGRA`. Web uses `<video>` with the same `.mov`. See `references/playback.md` for the per-platform integration snippet.

## Reference

Read these in order when implementing or debugging:

- `references/pipeline.md` — every command, every flag, what each step does, cost breakdown.
- `references/troubleshooting.md` — failure modes I hit and how to recognize them (hypervideo chroma-key trap, ProRes oversize trap, seam without `end_image_url`, halo without `refine_foreground`).
- `references/playback.md` — minimal iOS / web / Android playback integration with alpha preserved.

## Scope

This skill is for **short transparent animation loops**, typically 3–10 seconds. For longer videos, the per-frame BiRefNet cost scales linearly (~$0.005/frame, ~$0.60 for a 2-min clip at 24fps) and the resulting `.mov` grows quickly. For real-time effects, transparent live video, or scenes with complex semi-transparency (glass, smoke, hair on cluttered backgrounds), a dedicated VFX matting tool is better than this open-source pipeline.
