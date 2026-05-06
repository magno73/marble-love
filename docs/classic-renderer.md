# Classic Renderer

> Status: renderer/ROM scaffold. This document describes the current web
> renderer pipeline, not a full ROM-accurate scene renderer.

Related branch documents:

- Product requirements: `docs/classic-renderer-prd.md`
- Implementation plan: `docs/classic-renderer-plan.md`

## What is implemented

The engine now exposes a neutral `Frame` model with the Atari System 1 visible
size, palette entries, scroll values, and three explicit draw layers:

1. Playfield / tilemap
2. Motion objects / sprites
3. Alpha / HUD overlay

`packages/web/src/renderer.ts` translates that model into PixiJS containers in
the same order. It draws simple generated rectangles and HUD glyph blocks using
the palette colors carried by the frame. The renderer preserves pixel-art
behavior with antialiasing disabled and integer viewport scaling centered in the
browser window.

In development mode, `packages/web/src/main.ts` bypasses the ROM splash and
renders the synthetic fixture directly. Production mode still keeps the local
ROM file picker path and calls the conservative engine `buildFrame(state)`.

## What is synthetic

The development web build uses
`packages/web/src/fixtures/classic-demo-frame.ts` to generate a deterministic
classic-style frame. It includes:

- an abstract isometric ramp with two platforms and dark void/background;
- a few fake sprite-like motion objects, including a marble-like marker;
- fake alpha/HUD tile blocks;
- a small synthetic palette.

These are fixture commands only. They are not extracted from Marble Madness ROMs,
MAME screenshots, or any copyrighted pixel art.
`packages/web/test/classic-demo-frame.test.ts` covers the fixture shape so the
demo stays a readable ramp/platform composition instead of regressing into a
full-screen checkerboard or fully ROM-textured diagnostics view.

`packages/engine/src/render.ts` now extracts only two conservative, documented
pieces from `GameState`: palette entries from `colorRam` and alpha/HUD commands
from `alphaRam`. Playfield and motion-object command arrays remain empty until
their memory integration is implemented narrowly. The engine does not generate
fake visuals and remains DOM-free and PixiJS-free.

## System 1 layer mapping

The frame model follows the layer order documented in `docs/video-system.md`:

- `playfield`: scrollable 8x8 tilemap background;
- `sprites`: motion object commands, including future priority/translucency
  metadata;
- `alpha`: non-scrolling alphanumerics/HUD overlay.

The current renderer uses the priority fields only for deterministic draw order
within the synthetic command lists. It does not implement the real System 1
priority merge or translucency palette behavior yet.

## Remaining ROM work

The ROM loader scaffold is implemented in `packages/web/src/rom-loader.ts`.
It reads user-supplied ZIP files locally, validates expected Marble set 1 file
names from `docs/rom-layout.md`, and assembles raw byte regions for:

- 68010 program ROM;
- 6502 sound ROM;
- sparse tile/motion-object graphics region;
- graphics PROMs;
- raw alpha/HUD bytes;
- raw motherboard PROM entries.

`packages/web/src/rom-graphics.ts` defines typed graphics containers and
explicit `not-decoded` placeholders. It also decodes the alphanumerics ROM into
512 in-memory 8x8 2bpp glyphs using the documented MAME `anlayout` offsets. No
decoded glyphs are written to disk.
When ROM graphics are available, the Pixi renderer uses those decoded alpha
glyphs for `Frame.alpha` commands; otherwise it keeps the synthetic block-glyph
fallback.
Decoded alpha glyphs are converted to Pixi textures in memory and drawn through
a small sprite pool. The fallback path remains `Graphics` based.
Until real engine video RAM is wired, loading a valid ROM shows the same
synthetic classic demo frame, but with any available alpha glyphs supplied by
the locally decoded ROM data. A small controlled playfield sample area and the
demo motion objects can also use decoded object-tile textures in memory. The
main scene intentionally stays synthetic/readable until real playfield RAM,
palette RAM, and priority rules are wired. This is still a demo frame, not real
gameplay rendering.

The loader supports split MAME-style input, where `marble.zip` contains the game
ROMs and `atarisy1.zip` contains shared Atari System 1 motherboard files such as
BIOS, alpha ROM, and motherboard PROMs. Both archives are merged in memory only.
The web splash now accepts multiple `.zip` files, validates CRC32 values from
`docs/rom-layout.md`, and shows status/errors without uploading anything.

Remaining ROM work:

- add SHA1 verification if needed for parity harness workflows;
- connect decoded alphanumerics to real text/tile rendering;
- decode playfield tiles, motion-object graphics, and palette PROM behavior;
- keep decoded output in memory and never commit ROM-derived assets;
- connect decoded textures to the frame renderer behind the neutral `Frame`
  model.

## Remaining engine integration

`buildFrame(state)` should later read known video RAM only after the memory model
is stable:

- `state.spriteRam` for motion objects;
- future playfield RAM/tilemap state when it exists.

Palette RAM and alpha RAM have a first deterministic scaffold. Motion-object
single-entry word extraction and bounded word-3 linked-list walking also have a
deterministic scaffold for diagnostics, but sprite bank selection, priority
merge behavior, translucency palette behavior, and playfield RAM extraction
remain TODOs.

`decodePlayfieldWord()` extracts only the documented playfield RAM word fields
(`tileIndexLow`, `lookupIndex`, `flipX`). PROM tables are split into remap/color
raw views in the web loader. The web graphics scaffold also builds playfield and
motion-object lookup metadata from the PROM rules in `atarisy1_v.cpp`, and can
decode a single 8x8 object tile from the documented 4/5/6bpp planar layouts.
When a demo frame carries explicit `gfxBank`/`bitsPerPixel` metadata, the Pixi
renderer can turn those decoded object tiles into in-memory textures. This is
used only by the ROM-backed demo frame. The ROM-backed fixture limits playfield
texture use to a small diagnostics strip so incomplete palette/lookup behavior
does not make the whole screen look like noise. Real playfield RAM rendering
remains unimplemented.
The same texture path now supports ROM-backed demo motion objects. Chrome/debug
rendering includes a tiny palette swatch preview from the current frame palette.

`buildSpritesFromMotionObjectRam(spriteRam, entryIndexes)` can convert explicit
motion-object RAM entries into neutral `SpriteCommand` values.
`walkMotionObjectLinkedList(spriteRam)` follows documented word-3 links with a
bounded loop guard, and `buildSpritesFromMotionObjectList(spriteRam)` combines
the two. These are narrow diagnostic helpers: they skip timer entries, avoid
gameplay behavior, and do not select the active bank from `$860001` yet.
`decodeVideoControlByte(value)` separately exposes the documented alpha,
playfield, and motion-object bank bits from `$860001`, but no persistent
video-control state is modeled yet.

Until then, the renderer is a visual pipeline branch. It must not infer gameplay
rules, mutate `GameState`, or touch parity-sensitive engine logic.

## Local verification

Useful commands for this branch:

```bash
npm run typecheck --workspace @marble-love/engine
npm run typecheck --workspace @marble-love/web
npm run build --workspace @marble-love/web
npm run test
npm run dev --workspace @marble-love/web
```

In development, open `http://localhost:5173/?rom=1` to keep the ROM picker
visible instead of auto-starting the synthetic demo.

The loader was also smoke-tested locally against user-provided `marble.zip` +
`atarisy1.zip` outside the repository with CRC32 validation enabled. No ROM
bytes or derived assets are copied into this branch.

The PRD also asks for root `npm run typecheck`, `npm run lint`, and
`npm run build`. At the time this README was added, those root commands had
pre-existing failures outside the renderer scope. See
`docs/classic-renderer-plan.md` for the current list.
