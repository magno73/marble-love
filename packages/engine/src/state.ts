/**
 * state.ts — root del game state. Layout pensato per **rispecchiare** il game
 * state RAM dell'originale (PRD §6 Phase 4): rende il diff 1:1 più semplice
 * quando il differential harness confronta `trace_truth.jsonl` con
 * `trace_reimpl.jsonl`.
 *
 * Tutti i campi numerici sono branded (u8/u16/u32). Mai fare aritmetica diretta:
 * la ESLint rule fallisce. Usa wrap.ts.
 *
 * NOTA SCAFFOLD: questo è uno scheletro. I campi reali andranno popolati in
 * Phase 4 dopo aver letto la memory map (Phase 1) e aver identificato il game
 * state struct nel binario via Ghidra (Phase 2).
 */

import type { u8, u16, u32 } from "./wrap.js";
import { as_u8, as_u16, as_u32 } from "./wrap.js";

// ─── Primitive geometriche ────────────────────────────────────────────────

export interface Vec2_u16 {
  x: u16;
  y: u16;
}

export interface Vec3_i32 {
  x: u32; // posizione fissa-virgola, segno gestito da wrap helpers
  y: u32;
  z: u32;
}

// ─── Marble (la biglia del giocatore) ─────────────────────────────────────

export interface Marble {
  /** Posizione nel mondo (formato 16.16 fixed-point, da confermare in Phase 1). */
  pos: Vec3_i32;
  /** Velocità (sub-pixel per tick). */
  vel: Vec3_i32;
  /** Stato animazione/colore (TBD). */
  spriteIndex: u8;
  /** True se la biglia è "viva" (non in caduta/distrutta). */
  alive: boolean;
  /** Frame counter da quando è iniziato l'eventuale stato di morte. */
  deathTimer: u16;
}

// ─── Nemici ───────────────────────────────────────────────────────────────

/** Tipologie da Phase 1 (TBD da MAME source / ROM analysis). */
export type EnemyKind =
  | "marble_eater"
  | "slinky"
  | "acid_pool"
  | "hammer"
  | "steelie"
  | "unknown";

export interface Enemy {
  kind: EnemyKind;
  pos: Vec3_i32;
  vel: Vec3_i32;
  state: u8;
  active: boolean;
}

// ─── Livello ──────────────────────────────────────────────────────────────

export interface Level {
  /** Indice 1..6 (Practice, Beginner, Intermediate, Aerobic, Silly, Ultimate). */
  index: u8;
  /** Pointer/offset al level data caricato dalla ROM. */
  romOffset: u32;
  /** Tile/heightmap loader: popolato in Phase 4. */
  tilesLoaded: boolean;
}

// ─── RNG ──────────────────────────────────────────────────────────────────

export interface RngState {
  /** Seme corrente. Layout esatto da identificare in Phase 2.
   *  Mantenere l'esatto stato del generatore originale è prerequisito per parità. */
  seed: u32;
  /** Numero di chiamate accumulate nel frame (debug/diff). */
  callsThisFrame: u32;
}

// ─── Score / Lives / Timer ────────────────────────────────────────────────

export interface PlayerStats {
  score: u32;
  lives: u8;
  /** Timer del livello (decrementa, formato BCD nell'originale — TBD). */
  levelTimer: u16;
  /** Bonus accumulato. */
  bonus: u16;
}

// ─── Input snapshot ───────────────────────────────────────────────────────

/** Stato letto dall'hardware MMIO ogni frame. Replicato 1:1 dall'I/O del 68010. */
export interface InputSnapshot {
  /** Trackball delta X (signed 8-bit nel hardware reale). */
  trackballDx: u8;
  /** Trackball delta Y. */
  trackballDy: u8;
  /** Bitfield bottoni (start, coin, ...). */
  buttons: u8;
  /** DIP switch (bank 1+2). */
  dipSwitches: u16;
}

// ─── Tick clock ───────────────────────────────────────────────────────────

export interface TickClock {
  /** Frame contati da power-on. */
  frame: u32;
  /** Tick CPU 68010 (a 7.159 MHz, da confermare in Phase 1). */
  cpuTicks: u32;
  /** Sub-frame per IRQ scanline (TBD). */
  scanline: u16;
}

// ─── GameState root ───────────────────────────────────────────────────────

export interface GameState {
  clock: TickClock;
  rng: RngState;
  marble: Marble;
  enemies: Enemy[];
  level: Level;
  stats: PlayerStats;
  input: InputSnapshot;
  /** Region di memoria principale del 68010 (work RAM).
   *  Dimensione esatta da Phase 1 (atarisys1.cpp). */
  workRam: Uint8Array;
  /** Playfield tilemap RAM (background tilemap, 0xA00000-0xA01FFF, 8 KB).
   *  64×64 tile entries (2 byte each) per Atari System 1 hardware spec.
   *  Popolato da game-side write durante level load + scroll updates. */
  playfieldRam: Uint8Array;
  /** Motion object RAM (sprite, 0xA02000-0xA02FFF, 4 KB). */
  spriteRam: Uint8Array;
  /** Alphanumerics RAM (HUD overlay, 0xA03000-0xA03FFF, 4 KB). */
  alphaRam: Uint8Array;
  /** Color RAM (palette IRGB-4444, 0xB00000-0xB007FF, 2 KB). */
  colorRam: Uint8Array;
  /** Playfield X scroll register (MMIO 0x800000, 9-bit, write-only).
   *  Aggiornato da CPU write durante il main loop (es. FUN_2FFB8 pfScrollUpdate).
   *  Letto dal renderer per posizionare il viewport sulla tilemap 64×64 (512×512 px). */
  videoScrollX: number;
  /** Playfield Y scroll register (MMIO 0x820000, 9-bit, write-only). */
  videoScrollY: number;
}

// ─── Factory: stato vuoto ─────────────────────────────────────────────────

export function emptyGameState(): GameState {
  return {
    clock: { frame: as_u32(0), cpuTicks: as_u32(0), scanline: as_u16(0) },
    rng: { seed: as_u32(0), callsThisFrame: as_u32(0) },
    marble: {
      pos: { x: as_u32(0), y: as_u32(0), z: as_u32(0) },
      vel: { x: as_u32(0), y: as_u32(0), z: as_u32(0) },
      spriteIndex: as_u8(0),
      alive: false,
      deathTimer: as_u16(0),
    },
    enemies: [],
    level: { index: as_u8(0), romOffset: as_u32(0), tilesLoaded: false },
    stats: {
      score: as_u32(0),
      lives: as_u8(0),
      levelTimer: as_u16(0),
      bonus: as_u16(0),
    },
    input: {
      trackballDx: as_u8(0),
      trackballDy: as_u8(0),
      buttons: as_u8(0),
      dipSwitches: as_u16(0),
    },
    // Sizing verificato Phase 1 (`docs/hardware-map.md`):
    //   work RAM 8 KB ($400000-$401FFF)
    //   playfield RAM 8 KB ($A00000-$A01FFF, 64x64 tile entries)
    //   motion-object RAM 4 KB ($A02000-$A02FFF, 8 banchi × 64 entry × 4 word)
    //   alpha RAM 4 KB ($A03000-$A03FFF, HUD overlay 64×32 tile)
    //   palette RAM 2 KB ($B00000-$B007FF)
    workRam: new Uint8Array(0x2000),     // 8 KB
    playfieldRam: new Uint8Array(0x2000), // 8 KB
    spriteRam: new Uint8Array(0x1000),   // 4 KB
    alphaRam: new Uint8Array(0x1000),    // 4 KB
    colorRam: new Uint8Array(0x800),     // 2 KB
    videoScrollX: 0,
    videoScrollY: 0,
  };
}

/**
 * Snapshot deep-copy del GameState. Usato dal differential harness per:
 *  - serializzare lo stato a fine frame (→ trace.jsonl)
 *  - confrontare bit-by-bit con il trace dell'oracolo MAME
 */
export function snapshotGameState(s: GameState): GameState {
  return {
    clock: { ...s.clock },
    rng: { ...s.rng },
    marble: {
      ...s.marble,
      pos: { ...s.marble.pos },
      vel: { ...s.marble.vel },
    },
    enemies: s.enemies.map((e) => ({
      ...e,
      pos: { ...e.pos },
      vel: { ...e.vel },
    })),
    level: { ...s.level },
    stats: { ...s.stats },
    input: { ...s.input },
    workRam: new Uint8Array(s.workRam),
    playfieldRam: new Uint8Array(s.playfieldRam),
    spriteRam: new Uint8Array(s.spriteRam),
    alphaRam: new Uint8Array(s.alphaRam),
    colorRam: new Uint8Array(s.colorRam),
    videoScrollX: s.videoScrollX,
    videoScrollY: s.videoScrollY,
  };
}
