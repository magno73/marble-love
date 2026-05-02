/**
 * array-helpers.ts — utility di array fill/copy del binario.
 *
 * Funzioni piccole molto-chiamate, generalmente per inizializzare array u16
 * (es. tile indices, palette indices, sprite ID lists).
 *
 * **Verificate bit-perfect** vs binary tramite `cli/src/test-array-helpers-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── Memory map per writeMemoryU16 (subset coerente con bus.ts) ──────────

function writeMemoryU16(state: GameState, addr: number, value: number): void {
  const v = value & 0xffff;
  if (addr >= 0x400000 && addr < 0x402000) {
    state.workRam[addr - 0x400000] = (v >>> 8) & 0xff;
    state.workRam[addr - 0x400000 + 1] = v & 0xff;
  } else if (addr >= 0xa00000 && addr < 0xa02000) {
    // Playfield RAM — per ora write-through al workRam (Phase 4: separare)
    // Fallback safe: ignore
  } else if (addr >= 0xa02000 && addr < 0xa03000) {
    state.spriteRam[addr - 0xa02000] = (v >>> 8) & 0xff;
    state.spriteRam[addr - 0xa02000 + 1] = v & 0xff;
  } else if (addr >= 0xa03000 && addr < 0xa04000) {
    state.spriteRam[addr - 0xa02000] = (v >>> 8) & 0xff;
    state.spriteRam[addr - 0xa02000 + 1] = v & 0xff;
  } else if (addr >= 0xb00000 && addr < 0xb00800) {
    state.colorRam[addr - 0xb00000] = (v >>> 8) & 0xff;
    state.colorRam[addr - 0xb00000 + 1] = v & 0xff;
  }
  // Altri range: ignored (cart RAM 0x900000-, MMIO)
}

// ─── fillIncrementingU16 (FUN_1E3E) ──────────────────────────────────────

/**
 * Replica `FUN_00001E3E` — `fillIncrementingU16(dest, start, count)`.
 *
 * Disassembly:
 *   A0 = arg1 (dest pointer, long)
 *   D0 = arg2 (start value, word)
 *   D2 = arg3 (count, long)
 *   D3 = 0
 *   while (D3 < D2 SIGNED):  // signed count
 *     *A0++ = D0 (word)
 *     D0 += 1 (word, può wrappare a 16 bit)
 *     D3 += 1
 *
 * Scrive `count` word a partire da `dest`, valori = start, start+1, start+2,...
 * Il valore D0 wrappa modulo 0x10000 ad ogni iterazione (è word).
 *
 * @param state    GameState (per la unified memory write)
 * @param destAddr Indirizzo assoluto 68010 destinazione
 * @param start    Valore iniziale (sarà mascherato a 16 bit)
 * @param count    Numero di word da scrivere (signed long; count <= 0 → no-op)
 */
export function fillIncrementingU16(
  state: GameState,
  destAddr: number,
  start: number,
  count: number,
): void {
  // count è signed long. Se <= 0, no-op (blt con D3=0 < D2<=0 è falso).
  const signedCount = count | 0;
  if (signedCount <= 0) return;

  let value = start & 0xffff;
  let addr = destAddr >>> 0;

  for (let i = 0; i < signedCount; i++) {
    writeMemoryU16(state, addr, value);
    addr = (addr + 2) >>> 0;
    value = (value + 1) & 0xffff; // word wrap
  }
}
