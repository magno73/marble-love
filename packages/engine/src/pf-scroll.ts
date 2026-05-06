/**
 * pf-scroll.ts — playfield scroll update.
 *
 * Replica `FUN_00026D8A` (PF scroll setup, sub conditional di FUN_28788).
 *
 * Funzione chiamata se:
 *   *0x400008 != 0 AND *0x40000A >= 2 AND *0x400014 == 1
 *
 * Side effect:
 *   - aggiorna *0x400002 (latched scroll Y) con +=delta
 *   - aggiorna fino a 60 word in spriteRam @ 0xA02000+/0xA02200+ (tile scroll
 *     bits 5..13 di ogni word, in funzione del rotation flag in *0x4003AE)
 *
 * MMIO 0x820000 write skipped (responsabilità del renderer).
 */

import type { GameState } from "./state.js";

const SCROLL_SPEED_OFF = 0x0A;     // *0x40000A: byte signed
const SCROLL_FLIP_OFF = 0x04;      // *0x400004: byte (0xFF = flip sign)
const SCROLL_Y_LATCHED_OFF = 0x02; // *0x400002: word
const AV_CONTROL_OFF = 0x3AE;      // *0x4003AE: word (rotation bit 3)

const TILE_BASE = 0x000;           // 0xA02000 in spriteRam
const TILE_CMP_BASE = 0x180;       // 0xA02180 in spriteRam
const TILE_LINE_MASK = 0x3FE0;     // bit 5..13
const MAX_ITER = 60;

function readU16BE(buf: Uint8Array, off: number): number {
  return ((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0);
}
function writeU16BE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}
function sext8(b: number): number {
  return b & 0x80 ? b - 0x100 : b;
}
function sext16(w: number): number {
  return w & 0x8000 ? w - 0x10000 : w;
}

/**
 * Replica `FUN_00026D8A` — playfield horizontal scroll update.
 *
 * Va chiamato solo quando il caller (FUN_28788) ha verificato che
 * *0x400008 != 0 AND *0x40000A >= 2 AND *0x400014 == 1.
 */
export function pfScrollUpdate(state: GameState): void {
  const r = state.workRam;
  const sp = state.spriteRam;

  // D2.w = sext8(*0x40000A) >> 1 (asr signed)
  let d2 = sext8(r[SCROLL_SPEED_OFF] ?? 0) >> 1;
  d2 = d2 & 0xffff;

  // if (*0x400004.b == 0xFF): D2 = -D2 (signed word negate)
  if ((r[SCROLL_FLIP_OFF] ?? 0) === 0xff) {
    d2 = (-sext16(d2)) & 0xffff;
  }

  // *0x400002.w += D2 (signed accumulate, mod 2^16)
  const scrollY = (readU16BE(r, SCROLL_Y_LATCHED_OFF) + d2) & 0xffff;
  writeU16BE(r, SCROLL_Y_LATCHED_OFF, scrollY);
  // MMIO 0x820000 write skipped

  // Line offset accumulator: D2 = D2 << 5 (asl.w, 16-bit truncate)
  const lineOffset = (d2 << 5) & 0xffff;

  // Rotation index: D1 = ((AV & 8) << 5) (= 0 or 0x100)
  const av = readU16BE(r, AV_CONTROL_OFF);
  const rotIndex = (av & 8) << 5; // 0 o 0x100

  // Base offsets: A0 = 0xA02000 + D1*2, A1 = 0xA02180 + D1*2 (D1*2 = 0 o 0x200)
  const a0Base = TILE_BASE + (rotIndex * 2);
  const a1Base = TILE_CMP_BASE + (rotIndex * 2);

  // Loop: max 60 iter; exit appena D0 (= old D3) == cmpWord
  for (let d3 = 0; d3 < MAX_ITER; d3++) {
    const a0Off = a0Base + d3 * 2;
    const tileWord = readU16BE(sp, a0Off);

    // D1.w = (tileWord + lineOffset) & 0x3FE0
    const shifted = (tileWord + lineOffset) & TILE_LINE_MASK;
    // D0.w = tileWord & ~0x3FE0
    const preserved = tileWord & ~TILE_LINE_MASK & 0xffff;
    const merged = (shifted | preserved) & 0xffff;
    writeU16BE(sp, a0Off, merged);

    // Compare D0 (= old D3) with *(A1)+ (post-increment)
    const a1Off = a1Base + d3 * 2;
    const cmpWord = readU16BE(sp, a1Off);
    if (cmpWord === d3) return;
  }
}
