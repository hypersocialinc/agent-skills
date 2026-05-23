#!/usr/bin/env bash
# Transparent Video Loop pipeline.
#
# Animate a still image into a short transparent HEVC loop:
#   1. (optional) upload local still to fal CDN
#   2. SeedDance 2 fast image-to-video, optionally with end-frame anchoring
#      for a closed loop (end_image_url = image_url)
#   3. ffmpeg split into PNG frames
#   4. BiRefNet v2 Matting per frame in parallel
#   5. ffmpeg encode HEVC `hvc1` with alpha
#
# Output is a `.mov` that plays natively in iOS AVPlayer, web <video>, etc.
#
# Usage:
#   transparent-loop.sh \
#     --image <path-or-url> \
#     --prompt "<motion prompt>" \
#     --output <path-to-output.mov> \
#     [--duration 5] \
#     [--closed-loop]            # set end_image_url = image_url
#     [--fps 24]
#     [--size 720]
#     [--parallel 10]            # BiRefNet workers
#     [--work-dir <path>]        # default: ./.transparent-video-tmp
#     [--alpha-quality 0.7]
#     [--keep-work]              # don't rm work dir on success
#
# Requirements: genmedia (fal.ai CLI), ffmpeg with hevc_videotoolbox.

set -euo pipefail

IMAGE=""
PROMPT=""
OUTPUT=""
DURATION="5"
CLOSED_LOOP="0"
FPS="24"
SIZE="720"
PARALLEL="10"
WORK_DIR=""
ALPHA_QUALITY="0.7"
KEEP_WORK="0"
RESOLUTION="720p"
ASPECT="1:1"

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)         IMAGE="$2"; shift 2 ;;
    --prompt)        PROMPT="$2"; shift 2 ;;
    --output)        OUTPUT="$2"; shift 2 ;;
    --duration)      DURATION="$2"; shift 2 ;;
    --closed-loop)   CLOSED_LOOP="1"; shift ;;
    --fps)           FPS="$2"; shift 2 ;;
    --size)          SIZE="$2"; shift 2 ;;
    --parallel)      PARALLEL="$2"; shift 2 ;;
    --work-dir)      WORK_DIR="$2"; shift 2 ;;
    --alpha-quality) ALPHA_QUALITY="$2"; shift 2 ;;
    --keep-work)     KEEP_WORK="1"; shift ;;
    --resolution)    RESOLUTION="$2"; shift 2 ;;
    --aspect-ratio)  ASPECT="$2"; shift 2 ;;
    -h|--help)       usage 0 ;;
    *)               echo "Unknown arg: $1" >&2; usage 1 ;;
  esac
done

[[ -z "$IMAGE"  ]] && { echo "Missing --image" >&2;  usage 1; }
[[ -z "$PROMPT" ]] && { echo "Missing --prompt" >&2; usage 1; }
[[ -z "$OUTPUT" ]] && { echo "Missing --output" >&2; usage 1; }

WORK_DIR="${WORK_DIR:-$(pwd)/.transparent-video-tmp}"
mkdir -p "$WORK_DIR/frames" "$WORK_DIR/frames_clean"

cleanup() {
  if [[ "$KEEP_WORK" != "1" ]]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

command -v genmedia >/dev/null 2>&1 || { echo "genmedia CLI not found" >&2; exit 2; }
command -v ffmpeg >/dev/null 2>&1   || { echo "ffmpeg not found"   >&2; exit 2; }

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# ────────────────────────────────────────────────────────────────────────
# 1. Resolve image to a fal CDN URL.
# ────────────────────────────────────────────────────────────────────────
if [[ "$IMAGE" =~ ^https?:// ]]; then
  IMAGE_URL="$IMAGE"
  echo "[1/5] image URL: $IMAGE_URL"
else
  [[ -f "$IMAGE" ]] || { echo "image not found: $IMAGE" >&2; exit 2; }
  echo "[1/5] uploading $IMAGE to fal CDN..."
  IMAGE_URL=$(genmedia upload "$IMAGE" --json | python3 -c "import sys,json; print(json.load(sys.stdin)['cdn_url'])")
  echo "       → $IMAGE_URL"
fi

# ────────────────────────────────────────────────────────────────────────
# 2. SeedDance 2 fast image-to-video.
# ────────────────────────────────────────────────────────────────────────
echo "[2/5] generating motion with SeedDance 2..."

SEED_ARGS=(
  bytedance/seedance-2.0/fast/image-to-video
  --image_url "$IMAGE_URL"
  --prompt "$PROMPT"
  --duration "$DURATION"
  --resolution "$RESOLUTION"
  --aspect_ratio "$ASPECT"
  --generate_audio false
  --download "$WORK_DIR/source.{ext}"
  --json
)
if [[ "$CLOSED_LOOP" == "1" ]]; then
  SEED_ARGS+=(--end_image_url "$IMAGE_URL")
  echo "       closed loop: end_image_url = image_url"
fi
genmedia run "${SEED_ARGS[@]}" > "$WORK_DIR/seedance.json"
SOURCE_MP4=$(ls "$WORK_DIR"/source.* | head -1)
echo "       → $SOURCE_MP4"

# ────────────────────────────────────────────────────────────────────────
# 3. ffmpeg split → frames.
# ────────────────────────────────────────────────────────────────────────
echo "[3/5] splitting into PNG frames..."
ffmpeg -y -v error -i "$SOURCE_MP4" -vsync passthrough "$WORK_DIR/frames/f_%04d.png"
FRAME_COUNT=$(ls "$WORK_DIR/frames" | wc -l | tr -d ' ')
echo "       → $FRAME_COUNT frames"

# ────────────────────────────────────────────────────────────────────────
# 4. BiRefNet per frame in parallel.
# ────────────────────────────────────────────────────────────────────────
echo "[4/5] running BiRefNet v2 Matting on $FRAME_COUNT frames ($PARALLEL workers)..."
PARALLEL="$PARALLEL" \
  "$SCRIPT_DIR/birefnet-parallel.sh" "$WORK_DIR/frames" "$WORK_DIR/frames_clean"

CLEAN_COUNT=$(ls "$WORK_DIR/frames_clean" | wc -l | tr -d ' ')
if [[ "$CLEAN_COUNT" -ne "$FRAME_COUNT" ]]; then
  echo "       WARNING: only $CLEAN_COUNT / $FRAME_COUNT frames matted" >&2
fi
echo "       → $CLEAN_COUNT clean frames"

# ────────────────────────────────────────────────────────────────────────
# 5. Encode HEVC alpha.
# ────────────────────────────────────────────────────────────────────────
echo "[5/5] encoding HEVC hvc1 with alpha at ${SIZE}x${SIZE} ${FPS}fps..."
ffmpeg -y -v error \
  -framerate "$FPS" -i "$WORK_DIR/frames_clean/f_%04d.png" \
  -vf "scale=${SIZE}:${SIZE}" \
  -c:v hevc_videotoolbox \
  -allow_sw 1 \
  -alpha_quality "$ALPHA_QUALITY" \
  -tag:v hvc1 \
  -pix_fmt bgra \
  "$OUTPUT"

SIZE_BYTES=$(stat -f%z "$OUTPUT" 2>/dev/null || stat -c%s "$OUTPUT")
SIZE_MB=$(awk -v b="$SIZE_BYTES" 'BEGIN{printf "%.2f", b/1024/1024}')
echo ""
echo "✅ done → $OUTPUT (${SIZE_MB} MB)"
echo "   verify: open '$OUTPUT'  (QuickTime)"
