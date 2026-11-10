#!/bin/bash
# Cut videos/all.mp4 into the scroll-film scene clips (H.264 + AV1) + posters.
#
#   bash scripts/encode-film.sh
#
# MARKS are seconds:frames at the source frame rate (30 fps) — the start of each
# scene. Each clip also includes its end boundary frame, so neighbouring clips
# share an identical seam frame (no visible jump between scenes).
# If you change the number of scenes, update `film` in src/data/site.ts too
# (one entry per scene, same order, ids = NAMES).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=videos/all.mp4
NAMES=(town pension rooms view location book)
MARKS=(0:00 4:23 9:18 13:15 18:20 25:25)

FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$SRC" | awk -F/ '{printf "%d", ($2 ? $1/$2 : $1) + 0.5}')
TOTAL=$(ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$SRC")
mkdir -p public/video public/scenes

to_frame() { local s=${1%%:*} f=${1##*:}; echo $((10#$s * FPS + 10#$f)); }

for i in "${!NAMES[@]}"; do
  name=${NAMES[$i]}
  a=$(to_frame "${MARKS[$i]}")
  if (( i + 1 < ${#MARKS[@]} )); then b=$(to_frame "${MARKS[$((i + 1))]}"); else b=$((TOTAL - 1)); fi
  end=$((b + 1))
  echo "→ $name: frames $a..$b"
  # Desktop: native 1080p, crf 24, GOP 12. (crf 20 / GOP 8 was ~40% heavier for an
  # SSIM difference of 0.005 on this grainy source — not worth the download.)
  ffmpeg -v error -y -i "$SRC" -an \
    -vf "trim=start_frame=$a:end_frame=$end,setpts=PTS-STARTPTS,unsharp=5:5:0.6:5:5:0.0" \
    -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -g 12 -keyint_min 12 -sc_threshold 0 \
    -movflags +faststart "public/video/$name.mp4"
  # Phones: lighter 720p, crf 26, GOP 4 (cheaper seeks on mobile decoders).
  ffmpeg -v error -y -i "$SRC" -an \
    -vf "trim=start_frame=$a:end_frame=$end,setpts=PTS-STARTPTS,scale=1280:-2" \
    -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -g 4 -keyint_min 4 -sc_threshold 0 \
    -movflags +faststart "public/video/$name-m.mp4"
  # AV1 versions (~35-45% smaller at the same quality). The engine serves them only
  # where the browser reports hardware AV1 decoding (mediaCapabilities.powerEfficient):
  # scrubbing seeks constantly, and software AV1 seeks are slower than H.264.
  ffmpeg -v error -y -i "$SRC" -an \
    -vf "trim=start_frame=$a:end_frame=$end,setpts=PTS-STARTPTS,unsharp=5:5:0.6:5:5:0.0" \
    -c:v libsvtav1 -preset 6 -crf 36 -g 12 -pix_fmt yuv420p -svtav1-params "enable-overlays=1" \
    -movflags +faststart "public/video/$name.av1.mp4" 2>/dev/null
  ffmpeg -v error -y -i "$SRC" -an \
    -vf "trim=start_frame=$a:end_frame=$end,setpts=PTS-STARTPTS,scale=1280:-2" \
    -c:v libsvtav1 -preset 6 -crf 40 -g 4 -pix_fmt yuv420p \
    -movflags +faststart "public/video/$name-m.av1.mp4" 2>/dev/null
  # Poster = the clip's first frame (shown until the video paints, and for reduced motion).
  ffmpeg -v error -y -i "public/video/$name.mp4" -frames:v 1 -c:v libwebp -quality 82 "public/scenes/$name.webp"
done
echo "Done."
