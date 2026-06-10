# docs/media

Demo media for the README and the GitHub Pages landing page:

- `demo.mp4` — short gameplay capture; also copied to
  `packages/web/public/media/demo.mp4`, where the Pages landing page plays
  it inline (`<video autoplay muted loop>`)
- `demo.gif` — optional README-embeddable fallback (kept under ~6 MB)

Note on the README: GitHub does not render committed `.mp4` paths as inline
players. To embed the video in the README, edit it on github.com and drag
`demo.mp4` into the editor — GitHub uploads it as a user-attachment and
inserts a playable URL.

Provenance: the committed capture is **generated and approved by the
maintainer** from legally owned ROM ZIPs. Agents must not generate or commit
ROM-backed media themselves: producing it needs local ROMs that are not in
the repository.

The maintainer generates the files with:

```sh
npm i -D puppeteer        # one-time
bash tools/record_demo.sh # writes demo.mp4 + demo.gif here, copies the gif
                          # to packages/web/public/media/
```

See `tools/record_demo.sh` and `tools/record_demo.mjs` for the capture
pipeline (headless Chromium screencast → ffmpeg).
