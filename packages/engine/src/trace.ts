/**
 * trace.ts — formato JSONL del trace per differential testing.
 *
 * **Contratto chiave:** lo stesso schema viene emesso da:
 *   - `oracle/mame_dumper.lua` (ground truth, ogni frame)
 *   - `@marble-love/cli` (reimpl, stesso scenario, stessi tick)
 *
 * Il diff (`harness/diff.ts`) confronta riga-per-riga e identifica il primo
 * campo che diverge. Modifiche allo schema vanno propagate **simultaneamente**
 * al Lua dumper e al CLI runner, altrimenti il diff è inutile.
 *
 * Formato: una riga JSON per frame. Tutti i numeri sono integer JS standard
 * (53-bit safe per qualunque valore u32). Niente float. Niente NaN.
 */

import type { GameState } from "./state.js";
import { raw } from "./wrap.js";

/** Versione dello schema. Bump quando aggiungi/togli campi. Diff fallisce se mismatch. */
export const TRACE_SCHEMA_VERSION = 1 as const;

/** Header (prima riga del JSONL). */
export interface TraceHeader {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  source: "mame" | "reimpl";
  scenario: string;
  /** ROM crc32 (per garantire che oracle e reimpl usino lo stesso binario). */
  romCrc32?: string;
  startedAt: string; // ISO datetime, only for human reading; NOT diffed
}

/** Per-frame record. */
export interface TraceFrame {
  /** "f" = frame; sempre il primo campo, semplifica diff. */
  f: number;
  /** CPU ticks 68010. */
  cpuTicks: number;
  /** Stato RNG (seed + chiamate accumulate nel frame). */
  rng: { seed: number; calls: number };
  /** Marble. */
  marble: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    alive: 0 | 1;
    spriteIndex: number;
  };
  /** Stats. */
  stats: { score: number; lives: number; timer: number; bonus: number };
  /** Input letto (post-MMIO). */
  input: { dx: number; dy: number; buttons: number };
  /** Hash work-RAM (xxhash32 o crc32 — definito in harness).
   *  Permette di rilevare divergenze ovunque senza dumpare 16K per frame. */
  workRamHash?: string;
}

/** Serializza un GameState in TraceFrame. Pure function: no mutation. */
export function frameFromState(s: GameState): TraceFrame {
  return {
    f: raw(s.clock.frame),
    cpuTicks: raw(s.clock.cpuTicks),
    rng: { seed: raw(s.rng.seed), calls: raw(s.rng.callsThisFrame) },
    marble: {
      x: raw(s.marble.pos.x),
      y: raw(s.marble.pos.y),
      z: raw(s.marble.pos.z),
      vx: raw(s.marble.vel.x),
      vy: raw(s.marble.vel.y),
      vz: raw(s.marble.vel.z),
      alive: s.marble.alive ? 1 : 0,
      spriteIndex: raw(s.marble.spriteIndex),
    },
    stats: {
      score: raw(s.stats.score),
      lives: raw(s.stats.lives),
      timer: raw(s.stats.levelTimer),
      bonus: raw(s.stats.bonus),
    },
    input: {
      dx: raw(s.input.trackballDx),
      dy: raw(s.input.trackballDy),
      buttons: raw(s.input.buttons),
    },
  };
}

export function serializeHeader(h: TraceHeader): string {
  return JSON.stringify(h);
}
export function serializeFrame(f: TraceFrame): string {
  return JSON.stringify(f);
}
