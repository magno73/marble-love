#!/usr/bin/env bash
#
# Record a Marble Love gameplay demo (mp4 + gif) for the README.
#
# NOTE: this cannot run in CI or unattended — it needs local, legally obtained
# ROM ZIPs in packages/web/public/roms/ (see README "Quick Start"). The agent
# that wrote this script does not have ROMs, so the media is produced by the
# maintainer running this locally.
#
# Prerequisites:
#   - ffmpeg on PATH
#   - npm i -D puppeteer   (Chromium is downloaded by puppeteer)
#   - ROM ZIPs in packages/web/public/roms/marble.zip + atarisy1.zip
#
# Usage: bash tools/record_demo.sh        (writes docs/media/demo.mp4 + demo.gif)
# Env:   DEMO_SECONDS (default 30), DEMO_FPS (default 30)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRAMES="${DEMO_FRAMES_DIR:-/tmp/marble-demo-frames}"
OUTDIR="$ROOT/docs/media"
SECONDS_LEN="${DEMO_SECONDS:-30}"
FPS="${DEMO_FPS:-30}"
PORT="${DEMO_PORT:-5173}"

command -v ffmpeg >/dev/null 2>&1 || { echo "error: ffmpeg not found on PATH"; exit 1; }
node -e "require.resolve('puppeteer')" 2>/dev/null || { echo "error: puppeteer not installed — run: npm i -D puppeteer"; exit 1; }

mkdir -p "$OUTDIR"
rm -rf "$FRAMES"; mkdir -p "$FRAMES"

# 1. Start the dev server (auto-loads ROMs from packages/web/public/roms/).
( cd "$ROOT" && npm --workspace @marble-love/web run dev -- --host 127.0.0.1 --port "$PORT" ) &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# Wait for the server to answer.
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then break; fi
  sleep 1
done

# 2. Capture frames via puppeteer (Chrome DevTools screencast).
DEMO_FRAMES_DIR="$FRAMES" \
DEMO_SECONDS="$SECONDS_LEN" \
DEMO_URL="http://127.0.0.1:$PORT/?autoLoad=1" \
  node "$ROOT/tools/record_demo.mjs"

# 3. Assemble an mp4 and a small (<= ~6 MB) palette-based gif.
ffmpeg -y -framerate "$FPS" -i "$FRAMES/frame-%05d.jpg" \
  -vf "scale=640:-2" -c:v libx264 -pix_fmt yuv420p "$OUTDIR/demo.mp4"

ffmpeg -y -i "$OUTDIR/demo.mp4" -vf "fps=15,scale=480:-1:flags=lanczos,palettegen" /tmp/marble-demo-pal.png
ffmpeg -y -i "$OUTDIR/demo.mp4" -i /tmp/marble-demo-pal.png \
  -lavfi "fps=15,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse" "$OUTDIR/demo.gif"

# 4. Copy the gif where the Pages landing serves it (media/demo.gif).
WEB_MEDIA="$ROOT/packages/web/public/media"
mkdir -p "$WEB_MEDIA"
cp "$OUTDIR/demo.gif" "$WEB_MEDIA/demo.gif"

echo "wrote $OUTDIR/demo.mp4 and $OUTDIR/demo.gif"
echo "copied demo.gif to $WEB_MEDIA/demo.gif (used by the Pages landing page)"
echo "if demo.gif > 6 MB, lower DEMO_SECONDS or the fps/scale in this script."
