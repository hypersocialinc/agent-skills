# Troubleshooting

Failure modes hit while developing this pipeline, and how to recognize them. Read this first when an output looks wrong.

## "A character disappeared / the output is dark and missing pieces"

**Symptom**: in the final `.mov` (or any intermediate frame), one of the characters is partially or fully missing, or the whole frame looks crushed-dark.

**Root cause**: you used a chroma-key tool (e.g. `hypervideo video:bg-remove` with default settings) instead of ML segmentation. Chroma-keying picks a color and removes everything similar — if your subject has a solid color that's close to the background, the subject gets masked out too.

**Fix**: use BiRefNet v2 Matting per frame as documented in `pipeline.md`. The orchestrator script does this by default.

## "Frame 0 and frame N don't match — the loop has a visible seam"

**Symptom**: when the video restarts, there's a pop or jump in pose. Characters teleport between the final and first frame.

**Root cause**: SeedDance generated an *open-ended* clip — it started at your `image_url` but ended wherever the motion took it.

**Fix**: pass `end_image_url` set to the same URL as `image_url`. SeedDance interpolates back to the starting pose, giving a true closed loop. The orchestrator handles this when you pass `--closed-loop`.

If you still see a tiny seam after `end_image_url`, the motion prompt is too active — SeedDance is straining to fit the round trip into the requested seconds. Try a longer duration (more frames to interpolate) or a more restrained prompt: "subtle ambient motion that returns to rest" beats "characters wave and dance."

## "Output `.mov` is 50+ MB"

**Symptom**: you encoded HEVC alpha but the file is huge.

**Root cause**: you accidentally used a ProRes 4444 intermediate as the final output, or didn't downsize. ProRes is a near-lossless intermediate codec.

**Fix**: re-encode through `hevc_videotoolbox` with the flags in `pipeline.md`. Specifically:

```bash
ffmpeg -i big.mov \
  -vf "scale=720:720" \
  -c:v hevc_videotoolbox -allow_sw 1 -alpha_quality 0.7 \
  -tag:v hvc1 -pix_fmt bgra \
  small.mov
```

A 720² 5s 24fps clip should land at 1–2 MB. If you need it smaller, lower `-alpha_quality` to 0.5.

## "Alpha is there, but the edges have a colored halo"

**Symptom**: when composited on a dark surface, the silhouettes have a noticeable colored fringe — usually the color of whatever was behind the subject in the SeedDance output.

**Root cause**: BiRefNet ran without `refine_foreground: true`. The mask is correct, but the foreground RGB still contains contaminated pixels at the edge.

**Fix**: always pass `--refine_foreground true` to `genmedia run fal-ai/birefnet/v2`. The orchestrator does this by default; only an issue if you bypass the script.

## "iOS renders the video on a solid black background"

**Symptom**: in your iOS app, the `.mov` plays but the transparency is gone — everything composites on black.

**Root cause**: `AVPlayerLayer` defaults to a non-alpha pixel buffer format. The HEVC alpha is in the file, but the player isn't asking for it.

**Fix**: on the `AVPlayerLayer`, set:

```swift
playerLayer.pixelBufferAttributes = [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
]
```

See `references/playback.md` for a full minimal `UIViewRepresentable` snippet.

## "fal.ai 422 'literal_error' on `duration`"

**Symptom**: `Input should be 'auto', '4', '5', '6', …` error from SeedDance.

**Root cause**: `duration` is a string enum, not an integer. `--duration 3` fails because `3` isn't in the enum.

**Fix**: pass a value from `{4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}` or `auto`. The orchestrator defaults to `5`.

## "fal.ai 422 'literal_error' on `image_size`"

**Symptom**: similar 422 on `image_size`.

**Root cause**: many fal.ai endpoints take image_size as either a string enum (`square_hd`, `portrait_4_3`) or an `{width, height}` object — not the raw `1024x1024` string a human would type.

**Fix**: pass `square_hd` (1024×1024), `square` (512×512), or look up the enum for your specific endpoint with `genmedia schema <endpoint>`. The orchestrator uses safe defaults.

## "BiRefNet hangs / takes forever"

**Symptom**: stage 4 takes 10+ minutes for a 5s clip.

**Root cause**: low parallelism. The script defaults to 10 workers; if you reduced it (e.g. `PARALLEL=1`), wall time = `frames × ~10s`.

**Fix**: bump to `PARALLEL=10` or higher. fal.ai handles 10 concurrent BiRefNet jobs without throttling; 20–30 usually works but starts hitting occasional 429s. For longer videos add a `sleep 0.5` between batches.
