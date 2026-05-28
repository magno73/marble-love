# Classic Renderer

> Status: PRD scope complete for the classic renderer/web pipeline. This is a
> safe visual pipeline branch, not a full ROM-accurate gameplay renderer.

Historical branch PRDs are archived outside the public tree.

## What is implemented

The engine now exposes a neutral `Frame` model with the Atari System 1 visible
size, palette entries, scroll values, and three explicit draw layers:

1. Playfield / tilemap
2. Motion objects / sprites
3. Alpha / HUD overlay

`packages/web/src/renderer.ts` translates that model into PixiJS containers in
the same order. It draws generated fixture geometry, decoded alpha glyphs when
available, and decoded ROM object-tile textures when commands include ROM
graphics metadata. The renderer preserves pixel-art behavior with antialiasing
disabled and integer viewport scaling centered in the browser window.

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

`packages/engine/src/render.ts` extracts conservative, documented pieces from
`GameState`: palette entries from `colorRam`, alpha/HUD commands from
`alphaRam`, and optional motion-object commands from `spriteRam` when explicitly
requested. It can also accept external playfield RAM snapshots through
`BuildFrameOptions` without adding playfield RAM to `GameState`. The engine does
not generate fake visuals and remains DOM-free and PixiJS-free.

## System 1 layer mapping

The frame model follows the layer order documented in `docs/video-system.md`:

- `playfield`: scrollable 8x8 tilemap background;
- `sprites`: motion object commands, including future priority/translucency
  metadata;
- `alpha`: non-scrolling alphanumerics/HUD overlay.

`Frame.scrollX` and `Frame.scrollY` are applied to playfield commands by the
Pixi renderer. Sprite and alpha commands remain in screen coordinates.

The current renderer uses the priority fields only for deterministic draw order
within the synthetic command lists. It does not implement the real System 1
priority merge or translucency palette behavior yet.

## ROM Work

The ROM loader is implemented in `packages/web/src/rom-loader.ts`. It reads
user-supplied ZIP files locally, validates expected Marble set 1 file
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

Future ROM work outside this PRD:

- add SHA1 verification if needed for parity harness workflows;
- connect ROM graphics to real gameplay video RAM rather than diagnostics/demo
  frames;
- complete palette/translucency behavior;
- keep decoded output in memory and never commit ROM-derived assets;
- preserve the neutral `Frame` boundary between engine and web renderer.

## Future Engine Integration

`buildFrame(state)` remains conservative by default. It can opt into diagnostic
playfield and motion-object rendering through `BuildFrameOptions`, but future
real gameplay integration should still wait for the memory model to explicitly
own:

- `state.spriteRam` for motion objects;
- future playfield RAM/tilemap state when it exists.

Palette RAM and alpha RAM have deterministic extraction. Motion-object
single-entry word extraction, bounded word-3 linked-list walking, external
playfield RAM extraction, and video-control bit decoding are implemented as
renderer-facing helpers. Sprite bank persistence, priority merge behavior,
translucency palette behavior, and real owned playfield RAM remain future work.

`decodePlayfieldWord()` extracts only the documented playfield RAM word fields
(`tileIndexLow`, `lookupIndex`, `flipX`). PROM tables are split into remap/color
raw views in the web loader. The web graphics scaffold also builds playfield and
motion-object lookup metadata from the PROM rules in `atarisy1_v.cpp`, and can
decode a single 8x8 object tile from the documented 4/5/6bpp planar layouts.
`buildFrame(state, { playfieldRam, playfieldLookups })` can opt into playfield
command generation from an external video RAM snapshot without adding playfield
RAM to `GameState` yet.
When a demo frame carries explicit `gfxBank`/`bitsPerPixel` metadata, the Pixi
renderer can turn those decoded object tiles into in-memory textures. This is
used only by the ROM-backed demo frame. Larger commands are composed from
multiple decoded 8x8 object tiles in memory rather than scaling one tile across
the whole command. The ROM-backed fixture limits playfield texture use to a
small diagnostics strip so incomplete palette/lookup behavior does not make the
whole screen look like noise. Real playfield RAM rendering remains
unimplemented.
The same texture path now supports ROM-backed demo motion objects. Chrome/debug
rendering includes a tiny palette swatch preview from the current frame palette.

`buildSpritesFromMotionObjectRam(spriteRam, entryIndexes)` can convert explicit
motion-object RAM entries into neutral `SpriteCommand` values.
`walkMotionObjectLinkedList(spriteRam)` follows documented word-3 links with a
bounded loop guard, and `buildSpritesFromMotionObjectList(spriteRam)` combines
the two. `buildFrame(state, { motionObjects: "linked-list" })` can opt into this
path and emit neutral sprite commands from `state.spriteRam`, while
`buildFrame(state)` without options remains conservative. These are narrow
diagnostic helpers: they skip timer entries, avoid gameplay behavior, and do not
select the active bank from `$860001` yet.
If optional PROM-derived motion-object lookup metadata is supplied, those sprite
commands also carry `gfxBank`, `bitsPerPixel`, and ROM-backed palette indices so
the web renderer can use decoded object textures. Without lookup metadata, the
helpers keep producing plain neutral rectangle-friendly sprite commands.
`decodeVideoControlByte(value)` separately exposes the documented alpha,
playfield, and motion-object bank bits from `$860001`, but no persistent
video-control state is modeled yet.

This renderer branch must not infer gameplay rules, mutate `GameState`, or touch
parity-sensitive engine logic.

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
Open `http://localhost:5173/?engine=1` to render the diagnostic engine-frame
fixture, which builds a `Frame` through `buildFrame(state, ...)` from synthetic
palette/alpha/playfield/motion-object RAM. Use `?rom=1&engine=1` to keep the
ROM picker and pass loaded playfield plus motion-object lookup metadata into
that diagnostic path.

The loader was also smoke-tested locally against user-provided `marble.zip` +
`atarisy1.zip` outside the repository with CRC32 validation enabled. No ROM
bytes or derived assets are copied into this branch.

At PRD close, the renderer branch still had validation failures outside the
renderer scope. Current validation status should come from CI and the commands
in `AGENTS.md`, not from the archived branch notes.
