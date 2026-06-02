# docs/media

Generated demo media for the README lives here:

- `demo.mp4` — short gameplay capture
- `demo.gif` — README-embeddable version (kept under ~6 MB)

These files are **not committed by the agent**: producing them needs local,
legally obtained ROM ZIPs (the dev server auto-loads them). The maintainer
generates them with:

```sh
npm i -D puppeteer        # one-time
bash tools/record_demo.sh # writes demo.mp4 + demo.gif here
```

See `tools/record_demo.sh` and `tools/record_demo.mjs` for the capture pipeline
(headless Chromium screencast → ffmpeg).
