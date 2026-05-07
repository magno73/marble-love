/**
 * rng.ts — replica del PRNG di Marble Madness.
 *
 * **Identificato in Phase 2 (Ghidra)** — vedi `docs/static-overview.md`:
 *   - Funzione: `FUN_00013A98` (28 xref, 17 instr core)
 *   - State: u16 a `0x004003A6` in Work RAM
 *   - Algoritmo: **Galois LFSR a 16 bit con feedback custom**
 *
 * Algoritmo derivato dal disassembly 68010:
 *
 *   ```asm
 *   move.w (0x4003A6), D0       ; state
 *   move.l #-0x10000, D3         ; mask helper = 0xFFFF0000
 *   loop_step:
 *     move.w D0, D2
 *     lsr.w  #8, D2              ; D2 = state >> 8
 *     eor.b  D0, D2              ; D2.b = (state.h) XOR (state.l)
 *     bne    skip
 *     move.b #0x40, D2           ; if XOR==0: D2 = 0x40 (anti-zero attractor)
 *   skip:
 *     asl.b  #2, D2              ; X flag = bit 6 of D2.b (XOR result)
 *     roxl.w #1, D0              ; new state = (D0<<1) | X; X = old bit 15
 *     rol.l  #1, D3              ; mask helper rotates
 *     lsr.w  #1, D1              ; D1 = limit, halve until 0
 *     bne    loop_step
 *   move.w D0, (0x4003A6)        ; save back
 *   ; range-limit: D0 = D0 & D3.lo; while D0 > limit: D0 -= limit
 *   ```
 *
 * Per chiamata `next(limit)`:
 *   - N = numero di shift right necessari per portare `limit` a 0
 *   - Avanza state di N step LFSR
 *   - Restituisce `state mod limit` (range-limited)
 *
 * **Caveat**: questa è la nostra MIGLIORE INTERPRETAZIONE del disassembly. Il
 * comportamento esatto dei flag `asl.b` + `roxl.w` del 68010 è sottile; Phase 6
 * (hill-climbing) verificherà bit-perfect parity contro l'oracolo MAME e
 * potrebbe richiedere calibrazione minore.
 */

import { type RngState } from "./state.js";
import { as_u16, as_u32, u16_and, u16_or, u16_shl, u16_shr, u16_xor } from "./wrap.js";
import type { u16 } from "./wrap.js";

const FEEDBACK_FALLBACK = 0x40 as const; // se (high ^ low) == 0

/**
 * Avanza lo state RNG di un singolo step LFSR.
 *
 * Nuovo state = (state << 1) | feedback_bit, dove:
 *   feedback_byte = (state.high ^ state.low) ?: 0x40
 *   feedback_bit  = bit 6 di feedback_byte (= il bit X dopo asl.b #2)
 */
export function rngStepOnce(state: u16): u16 {
  const s = state as unknown as number;
  const xor_byte = ((s >>> 8) ^ (s & 0xff)) & 0xff;
  const fb = xor_byte === 0 ? FEEDBACK_FALLBACK : xor_byte;
  // asl.b #2 produces X = bit 6 of feedback (last shifted-out bit)
  const fb_bit = (fb >>> 6) & 1;
  // roxl.w #1: D0 << 1 | X; old bit 15 → new X (we discard it)
  return as_u16(((s << 1) | fb_bit) & 0xffff);
}

/**
 * Avanza state di N step (numero di shift-right per portare `limit` a 0).
 * Per `limit` u16, N = bit_length(limit), max 16 iterazioni.
 */
export function rngAdvanceForLimit(state: u16, limit: u16): u16 {
  let s = state as unknown as number;
  let l = limit as unknown as number;
  while (l !== 0) {
    s = (rngStepOnce(as_u16(s)) as unknown as number);
    l = l >>> 1;
  }
  return as_u16(s);
}

/**
 * Maschera helper D3 dopo N rotazioni di `0xFFFF0000` per 32 bit.
 * Dopo N ROL: i bit set originali (16-31) sono rotated.
 */
function maskHelperAfter(n: number): u16 {
  // D3 starts 0xFFFF0000, after N ROL.L #1: high bits rotate
  // D3.lo finale = top N bits di originale parte alta, shifted into low
  const k = n & 31;
  const v = ((0xffff0000 << k) | (0xffff0000 >>> (32 - k))) >>> 0;
  return as_u16(v & 0xffff);
}

/**
 * Genera un valore range-limited [0, limit).
 *
 * Mimica `FUN_00013A98`:
 *   1. Avanza state di N=bit_length(limit) step
 *   2. mask = D3.lo dopo N rotazioni
 *   3. result = state & mask
 *   4. while result >= limit: result -= limit
 *
 * NB: il binario @ 0x13AD0 fa `cmp.w D0,D1; bgt done; sub.w D1,D0; bra loop`,
 * quindi exit quando D1 > D0 (= result > limit). Equivalente a `while
 * result <= limit: sub`. Per result == limit: result -= limit → 0 (corretto
 * per modulo). La condizione qui è quindi `>=` (era `>` — bug latente:
 * quando result == limit avremmo ritornato limit invece di 0).
 */
export function rngNext(rstate: RngState, limit: u16): u16 {
  const limit_n = limit as unknown as number;
  if (limit_n === 0) {
    // PRD pendant: l'originale non gestisce 0; il binario itera 0 volte e
    // ritorna lo state corrente non avanzato. Mantengo questo comportamento.
    rstate.callsThisFrame = as_u32(
      (rstate.callsThisFrame as unknown as number) + 1
    );
    return as_u16(rstate.seed as unknown as number);
  }

  // Count number of LFSR steps needed (bit length of limit)
  let n = 0;
  let l = limit_n;
  while (l !== 0) {
    n += 1;
    l = l >>> 1;
  }

  const seed_old = rstate.seed as unknown as number;
  const seed_new = rngAdvanceForLimit(as_u16(seed_old), limit);
  rstate.seed = as_u32(seed_new as unknown as number);

  // Range-limit
  // NB: il binario fa `bgt done` (exit quando D1 > D0 signed), quindi continua
  // il loop finché result <= limit. Per ottenere modulo standard `[0, limit)`
  // la condizione qui è `>=` (era `>`, bug latente: quando result == limit
  // ritornava limit invece di 0). Vedi disasm @ 0x13AD0.
  const mask = maskHelperAfter(n);
  let r = (seed_new as unknown as number) & (mask as unknown as number);
  while (r >= limit_n) {
    r -= limit_n;
  }

  rstate.callsThisFrame = as_u32(
    (rstate.callsThisFrame as unknown as number) + 1
  );
  return as_u16(r);
}

/** Inizializza lo state RNG. Il seed iniziale del binario è 0 (Work RAM
 *  azzerata al reset). Il primo step "interessante" avviene quando il cart
 *  chiama `FUN_13A98` la prima volta. */
export function rngInit(initialSeed: u16 = as_u16(0)): RngState {
  return {
    seed: as_u32(initialSeed as unknown as number),
    callsThisFrame: as_u32(0),
  };
}

/** Reset contatore di chiamate per frame (debug-only). */
export function rngClearFrameCounter(state: RngState): void {
  state.callsThisFrame = as_u32(0);
}

// Silenzia warning su import inutilizzati (per ora). Phase 4b rimuoverà.
void u16_and; void u16_or; void u16_shl; void u16_shr; void u16_xor;
