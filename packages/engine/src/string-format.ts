/**
 * string-format.ts — funzioni di formattazione stringhe del binario.
 *
 * Le funzioni qui replicate sono usate dal codice HUD/score per scrivere
 * numeri formattati nell'alpha tilemap. Operano write byte-by-byte in
 * memoria.
 *
 * Verificate bit-perfect vs binary tramite `cli/src/test-string-format-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── Memory dispatch (subset coerente con bus.ts) ─────────────────────────

function writeMemoryU8(state: GameState, addr: number, value: number): void {
  const v = value & 0xff;
  if (addr >= 0x400000 && addr < 0x402000) {
    state.workRam[addr - 0x400000] = v;
  } else if (addr >= 0xa02000 && addr < 0xa03000) {
    state.spriteRam[addr - 0xa02000] = v;
  } else if (addr >= 0xa03000 && addr < 0xa04000) {
    state.alphaRam[addr - 0xa03000] = v;
  } else if (addr >= 0xb00000 && addr < 0xb00800) {
    state.colorRam[addr - 0xb00000] = v;
  }
}

// ─── setAlphaTile (FUN_3784) ──────────────────────────────────────────────

/**
 * Replica `FUN_00003784` — `setAlphaTile(arg1, arg2, arg3, arg4)`.
 *
 * Scrive un word in alpha tilemap @ `0xA03000`, con offset calcolato da
 * 2 byte coordinate + lookup ROM table. Use case: print tile/char at
 * (col, row) nel HUD overlay.
 *
 * Disassembly (cdecl 4 long args):
 *   D1 = arg1.b (low byte di long arg1 @ SP+12)
 *   D0 = arg2.b (low byte di long arg2 @ SP+16)
 *   D2 = arg3.w (low word di long arg3 @ SP+20)
 *   if *0x401F42 != 0:
 *     D3 = 0x29 - sext_l(D0.b)        ; rotation mode
 *   else:
 *     D3 = sext_l(D0.b) << 6           ; row stride 64
 *   D0 = sext_l(D1.b)
 *   D1 = (sext_w(*0x401F42)) * 2 + 1
 *   D1 = sext_l(*(0x72A4 + D1).b)     ; lookup shift count
 *   D0 <<= D1
 *   D0 += D3; D0 *= 2
 *   *(0xA03000 + D0).w = arg4.w | D2.w
 */
export function setAlphaTile(
  state: GameState,
  rom: { program: Uint8Array },
  arg1Byte: number,
  arg2Byte: number,
  arg3Word: number,
  arg4Word: number,
): void {
  const ALPHA_RAM_BASE = 0xa03000;
  const ROM_LOOKUP_TABLE = 0x72a4;
  const ROTATION_FLAG_OFF = 0x1f42;

  const arg1Long = ((arg1Byte & 0xff) << 24) >> 24;
  const arg2Long = ((arg2Byte & 0xff) << 24) >> 24;

  const rotFlag =
    ((state.workRam[ROTATION_FLAG_OFF] ?? 0) << 8) |
    (state.workRam[ROTATION_FLAG_OFF + 1] ?? 0);

  let d3: number;
  if (rotFlag !== 0) {
    d3 = (0x29 - arg2Long) | 0;
  } else {
    d3 = (arg2Long << 6) | 0;
  }

  const rotFlagSigned = (rotFlag & 0x8000) ? rotFlag - 0x10000 : rotFlag;
  // movea.l #0x72A4, A0; move.b (1, A0, D1*1), D1.b
  // D1 = sext_l(rotFlag) * 2, then read byte at A0 + D1 + 1
  const lookupIdx = (rotFlagSigned * 2 + 1) | 0;
  const shiftByte = rom.program[(ROM_LOOKUP_TABLE + lookupIdx) >>> 0] ?? 0;
  const shiftCount = ((shiftByte & 0xff) << 24) >> 24;

  let d0 = arg1Long;
  if (shiftCount >= 32 || shiftCount < 0) {
    // asl.l con count fuori dal range: m68k cap a 64; >= 32 → 0
    d0 = shiftCount < 0 ? d0 : 0;
  } else {
    d0 = (d0 << shiftCount) | 0;
  }

  d0 = ((d0 + d3) * 2) | 0;

  const destAddr = (ALPHA_RAM_BASE + d0) >>> 0;
  const value = ((arg3Word | arg4Word) & 0xffff) >>> 0;
  if (destAddr >= 0xa03000 && destAddr < 0xa04000) {
    const off = destAddr - 0xa03000;
    state.alphaRam[off] = (value >>> 8) & 0xff;
    state.alphaRam[off + 1] = value & 0xff;
  }
}

// ─── formatHex (FUN_3A08) ─────────────────────────────────────────────────

/**
 * Replica `FUN_00003A08` — formatHex(value, bufEnd, numDigits, showSpaces).
 *
 * Scrive `value` come stringa hex ASCII in memoria, **backward** a partire
 * da `bufEnd + numDigits` (null terminator). Cifre da 0..9 e A..F.
 *
 * Speciale:
 *   - Se `value == 0` e `showSpaces == 1`: leading zero diventa space (' ').
 *   - Se `value == 0` AND non special: scrive un singolo '0' come trailing.
 *
 * Disassembly:
 *   D1 = value (long, arg1 a SP+8)
 *   A0 = bufEnd (arg2 a SP+12)
 *   D0 = numDigits (arg3 a SP+16)
 *   showSpaces = (0x16, SP).w (arg4, word low di un long a SP+20)
 *
 *   A0 += D0
 *   *A0 = 0 (null terminator)
 *   if D1 == 0:
 *     *--A0 = '0'; D0 -= 1
 *   D0 -= 1
 *   if D0 < 0: goto end
 *   loop:
 *     D2 = D1 & 0xF
 *     if D2 >= 10: D2 += 7 (gap '9'+1..'A')
 *     if D1 == 0 AND showSpaces == 1: D2 = -16 (= ' '-0x30)
 *     D2 += '0'
 *     *--A0 = D2
 *     D1 >>= 4 (lsr.l)
 *     if D0 != 0: D0 -= 1, loop
 *   end: rts
 */
export function formatHex(
  state: GameState,
  value: number,
  bufEnd: number,
  numDigits: number,
  showSpaces: number,
): void {
  let d1 = value >>> 0;
  let a0 = (bufEnd + numDigits) >>> 0;
  let d0 = numDigits | 0;
  const showSp = (showSpaces & 0xffff) === 1;

  // Null terminator
  writeMemoryU8(state, a0, 0);

  // if D1 == 0: write '0' and decrement D0
  if (d1 === 0) {
    a0 = (a0 - 1) >>> 0;
    writeMemoryU8(state, a0, 0x30); // '0'
    d0 = (d0 - 1) | 0;
  }

  // D0 -= 1
  d0 = (d0 - 1) | 0;
  // if D0 < 0 (signed bmi): exit
  if (d0 < 0) return;

  // Loop dbf D0 (do-while semantics: il dbf decrementa POI testa, quindi runna
  // almeno una volta). dbf esce quando D0 raggiunge -1.
  while (true) {
    let d2 = d1 & 0xf;
    if (d2 >= 10) d2 += 7;
    if (d1 === 0 && showSp) d2 = -16;
    d2 = (d2 + 0x30) & 0xff;
    a0 = (a0 - 1) >>> 0;
    writeMemoryU8(state, a0, d2);
    d1 = d1 >>> 4;
    if (d0 === 0) break;
    d0 = (d0 - 1) | 0;
  }
}
