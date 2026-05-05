/**
 * render.ts — adapter di rendering. **NON usa PixiJS direttamente.**
 *
 * Il pacchetto `engine` deve restare puro (no DOM, no WebGL). Qui esponiamo
 * tipi neutri (`SpriteCommand`, `TileCommand`, `Frame`) che il pacchetto
 * `@marble-love/web` (Vite + PixiJS) traduce in draw call.
 *
 * Questa indirezione serve a:
 *  - Eseguire l'engine in CLI/test senza PixiJS in dipendenza (Phase 5 — diff).
 *  - Permettere swap del backend grafico (Canvas2D, WebGPU) senza toccare l'engine.
 */

import type { GameState } from "./state.js";

export interface FrameSize {
  width: number;
  height: number;
}

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PaletteEntry {
  index: number;
  rgba: RgbaColor;
}

export interface TileCommand {
  /** Indice nel tile bank della ROM o fixture sintetica. */
  tileIndex: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** Codice color/palette del System 1. */
  paletteIndex: number;
  flipX?: boolean;
  flipY?: boolean;
  priority?: number;
}

export interface SpriteCommand {
  /** Indice nello sprite RAM (motion object) o fixture sintetica. */
  spriteIndex: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  paletteIndex: number;
  flipX?: boolean;
  flipY?: boolean;
  priority?: number;
  translucent?: boolean;
}

export interface AlphaCommand {
  /** Indice nel tile alphanumerics/HUD. */
  tileIndex: number;
  x: number;
  y: number;
  paletteIndex: number;
  opaque?: boolean;
}

export interface Frame {
  nativeSize: FrameSize;
  /** Coord di scroll della tilemap (System 1 supporta scroll H/V). */
  scrollX: number;
  scrollY: number;
  palette: PaletteEntry[];
  playfield: TileCommand[];
  sprites: SpriteCommand[];
  alpha: AlphaCommand[];
  debugLabel?: string;
}

export const CLASSIC_NATIVE_SIZE: FrameSize = {
  width: 336,
  height: 240,
};

const ALPHA_COLUMNS = 64;
const ALPHA_TILE_SIZE = 8;
const PALETTE_ENTRY_COUNT = 1024;

export function irgb4444ToRgba(word: number): RgbaColor {
  const intensity = (word >>> 12) & 0x0f;
  const red = (word >>> 8) & 0x0f;
  const green = (word >>> 4) & 0x0f;
  const blue = word & 0x0f;
  const scale = intensity / 15;

  return {
    r: Math.round(((red << 4) | red) * scale),
    g: Math.round(((green << 4) | green) * scale),
    b: Math.round(((blue << 4) | blue) * scale),
    a: 255,
  };
}

export function buildPaletteFromColorRam(colorRam: Uint8Array): PaletteEntry[] {
  const palette: PaletteEntry[] = [];
  const count = Math.min(PALETTE_ENTRY_COUNT, Math.floor(colorRam.length / 2));

  for (let index = 0; index < count; index += 1) {
    const offset = index * 2;
    const word = ((colorRam[offset] ?? 0) << 8) | (colorRam[offset + 1] ?? 0);
    palette.push({ index, rgba: irgb4444ToRgba(word) });
  }

  return palette;
}

export function buildAlphaFromRam(alphaRam: Uint8Array): AlphaCommand[] {
  const alpha: AlphaCommand[] = [];
  const tileCount = Math.floor(alphaRam.length / 2);

  for (let index = 0; index < tileCount; index += 1) {
    const offset = index * 2;
    const word = ((alphaRam[offset] ?? 0) << 8) | (alphaRam[offset + 1] ?? 0);
    if (word === 0) continue;

    alpha.push({
      tileIndex: word & 0x03ff,
      x: (index % ALPHA_COLUMNS) * ALPHA_TILE_SIZE,
      y: Math.floor(index / ALPHA_COLUMNS) * ALPHA_TILE_SIZE,
      paletteIndex: (word >>> 10) & 0x07,
      opaque: (word & 0x2000) !== 0,
    });
  }

  return alpha;
}

/** Genera la lista draw del frame corrente leggendo `state.spriteRam` e tilemap.
 *  Scaffold conservativo: legge solo palette/alpha RAM già presenti in state.
 *  TODO: aggiungere spriteRam e playfield RAM quando il modello memoria è stabile. */
export function buildFrame(state: GameState): Frame {
  return {
    nativeSize: CLASSIC_NATIVE_SIZE,
    scrollX: 0,
    scrollY: 0,
    palette: buildPaletteFromColorRam(state.colorRam),
    playfield: [],
    sprites: [],
    alpha: buildAlphaFromRam(state.alphaRam),
  };
}
