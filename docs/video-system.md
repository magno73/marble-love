# Video System — Atari System 1

> **Status:** SKELETON. Phase 1 deliverable.

## Layer

Atari System 1 ha tipicamente:
1. **Playfield (tilemap)**: scrollabile, 8×8 tile
2. **Motion Object (sprites)**: oggetti dinamici
3. **Alpha Layer**: overlay non-scrollato (HUD, score, menu)

Marble Madness usa primariamente il playfield per il livello renderato in
isometric, e gli sprite per la biglia + nemici + UI floating.

## Tilemap

| Parametro | Valore | Note |
|-----------|--------|------|
| Tile size | 8×8 | tipico System 1 |
| Tile bank | TBD | da `atarisy1.cpp` |
| Scroll H/V | sì | scroll registers MMIO |
| Visible area | TBD (di solito 42×30 = 336×240 px) | |

## Motion Objects

| Parametro | Valore | Note |
|-----------|--------|------|
| Sprite RAM size | TBD | |
| Entry size | 8 byte? | |
| Max sprites/frame | TBD | |

Ogni entry sprite codifica: x, y, tile index, flip, palette, size.

## Palette

| Parametro | Valore |
|-----------|--------|
| Color depth | TBD (4 bpp = 16 colori per palette) |
| Palette banks | TBD |
| Color RAM size | TBD |
| Format | xRGB444? RGB555? |

## Render order

1. Background tilemap (scrolled)
2. Motion objects (depth-sorted o priority bit?)
3. Alpha overlay

## Per il reimpl

Vedi `packages/engine/src/render.ts` per il layer astratto. Il PixiJS adapter
(`packages/web/src/renderer.ts`) traduce in draw calls. Phase 7.
