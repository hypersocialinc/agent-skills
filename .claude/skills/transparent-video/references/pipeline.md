# Pipeline reference

The full transparent-video-loop pipeline, command by command. The orchestrator script in `scripts/transparent-loop.sh` wraps all of this, but read this when you need to invoke the steps manually, tweak parameters, or debug.

## Cost

- **SeedDance 2 fast image-to-video**: ~$0.01–0.05 per generation depending on duration. 5s 720p ≈ $0.04.
- **BiRefNet v2 Matting**: ~$0.005 per frame (1024²). 118 frames ≈ $0.60.
- **ffmpeg encoding**: free, runs locally on `hevc_videotoolbox`.
- **Total** for a 5s 24fps 720² closed loop: **~$0.65**, ~3–5 min wall time.

## Stage 1: Upload still to fal CDN (only if local)

If the still image lives on disk, upload it once so the URL can be reused as both `image_url` and `end_image_url`.

```bash
IMAGE_URL=$(genmedia upload ./hero.png --json \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['cdn_url'])")
```

If the image is already on a CDN (e.g. you generated it via `gpt-image-2/edit` and have the result URL), skip this step.

## Stage 2: SeedDance 2 fast image-to-video

```bash
genmedia run bytedance/seedance-2.0/fast/image-to-video \
  --image_url "$IMAGE_URL" \
  --end_image_url "$IMAGE_URL"     `# ← closed-loop anchoring` \
  --prompt 'Subtle ambient idle motion that returns to the starting pose. Static camera. Transparent background preserved.' \
  --duration 5 \
  --resolution 720p \
  --aspect_ratio 1:1 \
  --generate_audio false \
  --download 'source.{ext}' \
  --json
```

Key parameter notes:

- `image_url` (required): starting frame.
- `end_image_url` (optional): SeedDance interpolates back to this exact pose. **Set this to the same URL as `image_url` for a closed loop with no seam.** This is the single most important flag for a UI loop.
- `duration`: enum-constrained — valid values are `auto`, `4`, `5`, `6`, `7`, …, `15` seconds. Anything else fails with a literal-error 422. Default seedance can give a `3` but `fast/image-to-video` requires ≥ `4`.
- `resolution`: `480p` (fast/cheap) or `720p` (balance). `1080p` exists on the non-fast variant.
- `aspect_ratio`: enum — `1:1`, `16:9`, `9:16`, `4:3`, `3:4`. For a square loop, use `1:1`.
- `generate_audio: false`: skip the audio track. Empty-state loops are always muted in the UI anyway, and SeedDance default `true` adds 200ms+ of synth audio that gets stripped later.
- **Prompt advice**: small, subtle, returning. "Characters breathe gently and return to rest. Static camera. No zoom. No pan." Big motion fights the closed-loop constraint and produces a jittery seam. Mention "transparent background preserved" — SeedDance still renders on solid black under the hood, but the cue helps it not introduce a fake gradient.

The downloaded MP4 lands as an `image_url`-shaped video on a **solid black background**. SeedDance does not preserve PNG alpha; that's why Stage 4 has to re-extract it with BiRefNet.

## Stage 3: ffmpeg split → PNG frames

```bash
mkdir -p frames
ffmpeg -y -i source.mp4 -vsync passthrough frames/f_%04d.png
```

`-vsync passthrough` keeps the frame count honest (vs. ffmpeg's default frame-rate normalization). At 24fps for 5s you get exactly 118–120 frames.

## Stage 4: BiRefNet v2 Matting per frame, in parallel

This is the most expensive stage in wall time. Each call has ~7–10s of fixed overhead (upload → model → download), so running them serially would take 15+ min for a 5s clip. Parallel-process via `xargs -P`.

The `scripts/birefnet-parallel.sh` script does this. Per-frame command:

```bash
genmedia run fal-ai/birefnet/v2 \
  --image_url "$frame_url" \
  --model "Matting" \
  --refine_foreground true \
  --download "frames_clean/$name" \
  --json
```

Model variants:

- **`Matting`** (recommended): preserves soft edges, fine details like hair, plushie fuzz, slight semi-transparency. Best for characters.
- `General Use (Light)`: faster default but harsher edges.
- `General Use (Heavy)`: more accurate, ~2× slower.
- `Portrait`: tuned for human faces. Overkill for cartoon characters.

`refine_foreground: true` performs a second pass that pulls the foreground colors free of the background mask, which removes "halo" artifacts from semi-transparent edges. Always on for this pipeline.

Parallelism guidance:

- **10 workers** is the sweet spot from fal.ai's rate limits. Going higher (20–30) sometimes gets throttled.
- For very long videos (1000+ frames), consider a small per-batch sleep to avoid 429s.

## Stage 5: Encode HEVC with alpha

```bash
ffmpeg -y -framerate 24 -i frames_clean/f_%04d.png \
  -vf "scale=720:720" \
  -c:v hevc_videotoolbox \
  -allow_sw 1 \
  -alpha_quality 0.7 \
  -tag:v hvc1 \
  -pix_fmt bgra \
  output.mov
```

Flag breakdown:

- `-c:v hevc_videotoolbox`: macOS-native HEVC encoder. **This is the only ffmpeg HEVC encoder that supports an alpha channel in a single `.mov`.** Other systems can use `libx265` + a separate alpha track, but the resulting file isn't iOS-native.
- `-allow_sw 1`: fall back to software encoding when hardware (Apple Silicon AMX) refuses (rare, but happens on smaller inputs).
- `-alpha_quality 0.7`: 0.0 = fast/lossy alpha, 1.0 = near-lossless. 0.7 is a good size/quality balance.
- `-tag:v hvc1`: ATOM tag — iOS / QuickTime require `hvc1` (not `hev1`) for native playback with alpha.
- `-pix_fmt bgra`: the alpha-aware pixel format. Without this, ffmpeg falls back to a non-alpha format and the output looks fine but has no transparency.
- `scale=720:720`: downsize for app bundle. 720² @ 24fps × 5s ≈ 1.3 MB. Higher resolutions inflate quickly: 960² adds ~70%, 1024² adds 2×.

## Verification

After Stage 5, sanity-check three things:

```bash
ffprobe -v error -show_format -show_streams output.mov | grep -E "codec_name|pix_fmt|width|height"
```

Expect: `codec_name=hevc`, `pix_fmt=bgra` (or `yuva420p` in a different builds), `width=720`, `height=720`.

Visually verify in QuickTime — play the loop and watch the seam (the moment the video restarts). If you see a flash or pose jump, the closed-loop wasn't perfect; usually the SeedDance prompt was too active. Rerun with a more restrained motion prompt.
