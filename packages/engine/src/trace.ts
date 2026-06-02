/**
 * trace.ts — formato JSONL del trace per differential testing.
 *
 *   - `oracle/mame_dumper.lua` (ground truth, ogni frame)
 *   - `@marble-love/cli` (reimpl, same scenario, same ticks)
 *
 *
 */

import type { GameState } from "./state.js";
import { raw } from "./wrap.js";

export const TRACE_SCHEMA_VERSION = 2 as const;

export interface TraceHeader {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  source: "mame" | "reimpl";
  scenario: string;
  /**
    */
  romCrc32: string;
  startedAt: string; // ISO datetime, only for human reading; NOT diffed
}

/** Per-frame record. */
export interface TraceFrame {
  f: number;
  /** CPU ticks 68010. */
  cpuTicks: number;
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
  input: { dx: number; dy: number; buttons: number };
  /** CRC32 of the 8 KB Work RAM ($400000-$401FFF), excluding 68k stack areas:
   *    - `0x440-0x447`  (stack low water debug)
   *    - `0x1EE0-0x1EFF` (stack low water + sentinel `bsr`)
   *
   *
   *  In the MAME trace: computed by `oracle/mame_dumper.lua`. */
  workRamHash: number;
  /** Per-region CRC32 (32 regions of 0x100 bytes = 256). Index = offset/0x100.
   *  Regions with stack residue excluded:
   *    - Region 4 (0x400-0x4FF): excludes 0x440-0x447
   *    - Region 29 (0x1D00-0x1DFF): excludes 0x1D40-0x1DFF
   *    - Region 30 (0x1E00-0x1EFF): excludes 0x1E00-0x1E7F + 0x1EE0-0x1EFF
   *
   *  Lets the diff point at the specific diverging region instead of only
   *  reporting "workRamHash mismatch". */
  workRamHashes: number[];
  /**
   *  by offset (for example `"0x100"`). Only if enabled via `MARBLE_DUMP_REGIONS`
    */
  workRamDumps?: Record<string, string>;
}

/**
  */
let dumpRegionsCache: number[] | null = null;
function getDumpRegions(): number[] {
  if (dumpRegionsCache !== null) return dumpRegionsCache;
  const env = (typeof process !== "undefined" ? process.env["MARBLE_DUMP_REGIONS"] : undefined) ?? "";
  dumpRegionsCache = env
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 0 && n < 0x2000);
  return dumpRegionsCache;
}

function bytesToHex(buf: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ((buf[start + i] ?? 0) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

/** Serializza un GameState in TraceFrame. Pure function: no mutation. */
export function frameFromState(s: GameState): TraceFrame {
  const regions = getDumpRegions();
  const dumps: Record<string, string> | undefined = regions.length === 0
    ? undefined
    : Object.fromEntries(regions.map((off) => [
        `0x${off.toString(16).padStart(3, "0")}`,
        bytesToHex(s.workRam, off, 0x100),
      ]));

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
    // dal Phase 0; non sono i veri "score/lives" semantici. Tenuti per
    // sides read from the same addresses.
    stats: {
      score: ((s.workRam[0x396] ?? 0) << 8) | (s.workRam[0x397] ?? 0), // u16 @ 0x400396
      lives: s.workRam[0x3F4] ?? 0,                                    // u8 @ 0x4003F4
      timer: s.workRam[0x14] ?? 0,                                     // u8 @ 0x400014
      bonus: s.workRam[0x16] ?? 0,                                     // u8 @ 0x400016
    },
    input: {
      dx: raw(s.input.trackballDx),
      dy: raw(s.input.trackballDy),
      buttons: raw(s.input.buttons),
    },
    /** CRC32 of the 8 KB Work RAM (excludes the 68k stack zones 0x440-0x447,
      */
    workRamHash:
      (
        crc32(s.workRam, 0, 0x440) ^
        crc32(s.workRam, 0x448, 0x1D40 - 0x448) ^
        crc32(s.workRam, 0x1E80, 0x1EE0 - 0x1E80) ^
        crc32(s.workRam, 0x1F00, 0x2000 - 0x1F00)
      ) >>> 0,
    workRamHashes: workRamRegionalHashes(s.workRam),
    ...(dumps !== undefined ? { workRamDumps: dumps } : {}),
  };
}

/**
 *
 * Exclusions (68K stack residue / debug-only, not part of game state):
 *   - Region 4 (0x400-0x4FF): excludes `0x440-0x447` (stack low water debug)
 *   - Region 29 (0x1D00-0x1DFF): excludes `0x1D40-0x1DFF` (stack scratch
 *     `link A6,#-N` + `movem.l ...,-(SP)` + `move (d8,A6)`. TS does not
 *     emulate the M68K register file → spurious divergence. Rule 12 confirmed:
 *     top-1 PC covers 6% of writes, helper121B8 prologue only 1% — not
 *     reducible by wiring a few subs.)
 *   - Region 30 (0x1E00-0x1EFF): excludes `0x1E00-0x1E7F` (continuation
 *     stack scratch) + `0x1EE0-0x1EFF` (stack low water + sentinel `bsr`).
 *     SP starts at 0x401F00 and descends to ~0x401D40 for nested chains.
 *
 */
function workRamRegionalHashes(buf: Uint8Array): number[] {
  const out = new Array<number>(32);
  for (let i = 0; i < 32; i++) {
    const start = i * 0x100;
    if (i === 4) {
      // 0x400-0x4FF esclude 0x440-0x447 (8 byte stack water)
      out[i] = (crc32(buf, 0x400, 0x40) ^ crc32(buf, 0x448, 0x100 - 0x48)) >>> 0;
    } else if (i === 29) {
      // 0x1D00-0x1DFF esclude 0x1D40-0x1DFF (192 byte stack scratch)
      out[i] = crc32(buf, 0x1D00, 0x40) >>> 0;
    } else if (i === 30) {
      // 0x1E00-0x1EFF esclude 0x1E00-0x1E7F + 0x1EE0-0x1EFF
      out[i] = crc32(buf, 0x1E80, 0x60) >>> 0;
    } else {
      out[i] = crc32(buf, start, 0x100) >>> 0;
    }
  }
  return out;
}

/**
  */
let crc32_table: Uint32Array | null = null;
function crc32(buf: Uint8Array, start: number, length: number): number {
  if (crc32_table === null) {
    crc32_table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crc32_table[i] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  const end = Math.min(start + length, buf.length);
  for (let i = start; i < end; i++) {
    c = (c >>> 8) ^ (crc32_table[(c ^ (buf[i] ?? 0)) & 0xFF] ?? 0);
  }
  return (~c) >>> 0;
}

export function serializeHeader(h: TraceHeader): string {
  return JSON.stringify(h);
}
export function serializeFrame(f: TraceFrame): string {
  return JSON.stringify(f);
}
