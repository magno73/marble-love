# docs/media

Demo media for the README and the GitHub Pages landing page:

- `demo.mp4` — short gameplay capture
- `demo.gif` — README-embeddable version (kept under ~6 MB); also copied to
  `packages/web/public/media/demo.gif` for the Pages landing page

Provenance: the committed capture is **generated and approved by the
maintainer** from legally owned ROM ZIPs (decision recorded in
`docs/show-hn-launch-prd.md`). Agents must not generate or commit ROM-backed
media themselves: producing it needs local ROMs that are not in the
repository.

The maintainer generates the files with:

```sh
npm i -D puppeteer        # one-time
bash tools/record_demo.sh # writes demo.mp4 + demo.gif here, copies the gif
                          # to packages/web/public/media/
```

See `tools/record_demo.sh` and `tools/record_demo.mjs` for the capture
pipeline (headless Chromium screencast → ffmpeg).
