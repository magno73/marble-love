/**
 * level.ts — parser dei livelli a partire dalla ROM.
 *
 * **Status: STUB.** Phase 4 lo riempie. La memoria progetto del Marco riporta
 * (lavoro `marble-madness-2026`) i seguenti fatti utili come **partenza** per
 * Marble Love (DA RIVERIFICARE qui, non assumere senza testare):
 *  - Level pointer table @ 0x2BE00, 6 × 32-bit pointers
 *  - Headers di 36 byte
 *  - Height records di 8 byte
 *  - Slope: bits 12-15 = orient, bits 8-11 = slopeVal
 *  - z_cell = z_base + (dx*sdx + dy*sdy) * slopeVal
 *
 * Per Marble Love (bit-perfect) NON replichiamo la geometria da heightmap
 * estratta — replichiamo l'**accesso ROM** del binario originale e produciamo
 * lo stesso effetto sulle RAM regions. Quindi la decode qui è solo per il
 * renderer, non per la parità di stato.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

export interface LevelHeader {
  // Phase 4: campi reali. Per ora placeholder.
  romOffset: number;
  byteSize: number;
}

export interface LevelTile {
  /** Altezza Z del centro tile (in pixel z-unit, Z_SCALE=1). */
  height: number;
  /** Orientamento slope (0..15). */
  slopeOrient: number;
  /** Magnitude slope (0..15). */
  slopeMag: number;
}

export interface LevelData {
  index: number;
  header: LevelHeader;
  /** Heightmap del livello, indicizzata per y*width + x. */
  tiles: LevelTile[];
  width: number;
  height: number;
}

/** Carica e decodifica il livello N dalla ROM. STUB. */
export function loadLevel(_rom: RomImage, _state: GameState, index: number): LevelData {
  return {
    index,
    header: { romOffset: 0, byteSize: 0 },
    tiles: [],
    width: 0,
    height: 0,
  };
}
