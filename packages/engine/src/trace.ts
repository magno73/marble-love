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
export const TRACE_SCHEMA_VERSION = 2 as const;

/** Header (prima riga del JSONL). */
export interface TraceHeader {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  source: "mame" | "reimpl";
  scenario: string;
  /** ROM crc32 (per garantire che oracle e reimpl usino lo stesso binario).
   *  Stringa hex; vuoto se non calcolato. */
  romCrc32: string;
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
  /** CRC32 della Work RAM 8 KB ($400000-$401FFF), escluso `0x440-0x447`
   *  (stack low water mark, debug-only). Permette di rilevare divergenze
   *  ovunque senza dumpare 8 KB per frame.
   *
   *  Nel trace MAME: calcolato da `oracle/mame_dumper.lua`. Nel reimpl: TBD
   *  Phase 4-6 (calcolato sulla Uint8Array `state.workRam`). */
  workRamHash: number;
  /** CRC32 per regione (32 regioni di 0x100 byte = 256). Indice = offset/0x100.
   *  Region 4 (0x400-0x4FF) esclude `0x440-0x447` (stack low water).
   *
   *  Permette al diff di puntare alla regione specifica che diverge,
   *  invece di limitarsi a "workRamHash mismatch". */
  workRamHashes: number[];
  /** Dump esadecimale opzionale di una regione di 0x100 byte. Indicizzato
   *  per offset (es. `"0x100"`). Solo se attivato via env `MARBLE_DUMP_REGIONS`
   *  (lista di indici comma-separati). Usato per debug puntuale. */
  workRamDumps?: Record<string, string>;
}

/** Lista di indici (offsets) di regioni da dumpare in hex. Letto da env var
 *  `MARBLE_DUMP_REGIONS` (es. "0x100,0x300"). Cached: leggi una volta. */
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
    /** CRC32 della Work RAM 8 KB (esclude 0x440-0x447 stack low water).
     *  `>>> 0` forza il risultato a u32 unsigned (l'XOR può produrre signed). */
    workRamHash:
      (crc32(s.workRam, 0, 0x440) ^ crc32(s.workRam, 0x448, 0x2000 - 0x448)) >>> 0,
    workRamHashes: workRamRegionalHashes(s.workRam),
    ...(dumps !== undefined ? { workRamDumps: dumps } : {}),
  };
}

/**
 * Calcola CRC32 per 32 regioni di 0x100 byte ciascuna sulla Work RAM 8 KB.
 * Regione 4 (0x400-0x4FF) esclude `0x440-0x447` (stack low water mark).
 *
 * Output: array di 32 u32, indice = offset / 0x100.
 */
function workRamRegionalHashes(buf: Uint8Array): number[] {
  const out = new Array<number>(32);
  for (let i = 0; i < 32; i++) {
    const start = i * 0x100;
    if (i === 4) {
      // 0x400-0x4FF con buco 0x440-0x447 (8 byte stack water)
      out[i] = (crc32(buf, 0x400, 0x40) ^ crc32(buf, 0x448, 0x100 - 0x48)) >>> 0;
    } else {
      out[i] = crc32(buf, start, 0x100) >>> 0;
    }
  }
  return out;
}

/** CRC32 standard (IEEE 802.3, polynomial 0xEDB88320). Pre-computa la tabella
 *  alla prima chiamata. Usato per fingerprint della Work RAM nel trace. */
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
