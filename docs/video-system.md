# Video System

The public browser renderer mirrors the Atari System 1 layer model while keeping
ROM data local and in memory.

## Screen

- Visible resolution: 336 x 240.
- Refresh: approximately 59.92 Hz.
- Pixel art rendering should remain unfiltered and integer-scaled where
  possible.

## Layers

Marble Madness draws three main layers:

1. Playfield: scrollable 8x8 tilemap background.
2. Motion objects: sprite-style objects, including marble and animated objects.
3. Alphanumerics: non-scrolling HUD and text overlay.

MAME performs priority and translucency merging between playfield and motion
objects. Marble Love has implemented enough of this path for the current browser
experience and parity probes, but the full renderer remains an active area of
work.

## Graphics Data

The web loader decodes user-supplied ROM data in memory:

- alpha/HUD tiles from the shared System 1 alpha ROM;
- object/playfield planar graphics from the Marble ROMs;
- lookup metadata from Marble graphics PROMs.

Decoded graphics are not written to disk and are not committed to the
repository.

## Engine Boundary

`packages/engine/src/render.ts` exposes a neutral frame model. The web package
owns the PixiJS adapter. Engine code should not depend on DOM, canvas, or PixiJS
types.

Detailed historical capture notes are kept outside the public tree.
