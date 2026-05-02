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

export interface SpriteCommand {
  /** Indice nello sprite RAM (motion object). */
  spriteIndex: number;
  x: number;
  y: number;
  /** Codice color/palette del System 1. */
  paletteIndex: number;
  /** Flip X/Y. */
  flipX: boolean;
  flipY: boolean;
}

export interface TileCommand {
  /** Indice nel tile bank della ROM. */
  tileIndex: number;
  x: number;
  y: number;
  paletteIndex: number;
}

export interface Frame {
  /** Coord di scroll della tilemap (System 1 supporta scroll H/V). */
  scrollX: number;
  scrollY: number;
  tiles: TileCommand[];
  sprites: SpriteCommand[];
}

/** Genera la lista draw del frame corrente leggendo `state.spriteRam` e tilemap.
 *  STUB: ritorna frame vuoto. Phase 4-7. */
export function buildFrame(_state: GameState): Frame {
  return { scrollX: 0, scrollY: 0, tiles: [], sprites: [] };
}
