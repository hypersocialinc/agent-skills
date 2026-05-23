#!/usr/bin/env bash
# Run BiRefNet v2 Matting on every PNG in a directory, in parallel.
#
# Args: <frames_dir> <out_dir>
# Env:  PARALLEL=10 (workers), MODEL="Matting" (BiRefNet model variant)
#
# Each frame is uploaded to the fal CDN, processed with BiRefNet v2 in
# the chosen model variant (default: Matting), and the cleaned PNG is
# downloaded to <out_dir>/<same-basename>.png. Existing outputs are
# skipped so a partial run can be resumed by re-invoking.
#
# Requirements: genmedia (fal.ai CLI).

set -euo pipefail

FRAMES_DIR="${1:?Usage: birefnet-parallel.sh <frames_dir> <out_dir>}"
OUT_DIR="${2:?Usage: birefnet-parallel.sh <frames_dir> <out_dir>}"
PARALLEL="${PARALLEL:-10}"
MODEL="${MODEL:-Matting}"

mkdir -p "$OUT_DIR"

process_frame() {
  local frame="$1"
  local name
  name=$(basename "$frame")
  if [[ -f "$OUT_DIR/$name" ]]; then return 0; fi

  local url
  url=$(genmedia upload "$frame" --json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('cdn_url',''))")
  if [[ -z "$url" ]]; then
    echo "[skip] upload failed: $frame" >&2
    return 1
  fi

  genmedia run fal-ai/birefnet/v2 \
    --image_url "$url" \
    --model "$MODEL" \
    --refine_foreground true \
    --download "$OUT_DIR/$name" \
    --json >/dev/null 2>&1 || {
      echo "[skip] birefnet failed: $frame" >&2
      return 1
    }
}

export -f process_frame
export OUT_DIR MODEL

count=$(ls "$FRAMES_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo "BiRefNet $MODEL: $count frames × $PARALLEL workers"

ls "$FRAMES_DIR"/*.png | xargs -P "$PARALLEL" -I{} bash -c 'process_frame "$@"' _ {}

done_count=$(ls "$OUT_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo "done: $done_count / $count"
