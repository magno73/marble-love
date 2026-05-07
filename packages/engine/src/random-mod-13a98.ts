/**
 * random-mod-13a98.ts — replica di `FUN_00013A98` ("random modulo").
 *
 * Disassembly 68010 @ 0x13A98 (capstone):
 *
 *   movea.l  d2, a0               ; salva D2
 *   movea.l  d3, a1               ; salva D3
 *   move.l   #$FFFF0000, d3       ; D3 = mask helper
 *   move.w   ($4003A6), d0        ; D0 = seed (u16)
 *   move.l   $4(a7), d1           ; D1 = maxExclusive (long su stack, .w usato)
 *   ; loop: while D1 != 0
 *   move.w   d0, d2
 *   lsr.w    #8, d2               ; D2 = seed >> 8
 *   eor.b    d0, d2               ; D2.b ^= D0.b  (XOR high ^ low byte)
 *   bne.b    skip
 *   move.b   #$40, d2             ; se XOR == 0: fallback anti-zero
 * skip:
 *   asl.b    #2, d2               ; X = bit 6 del byte
 *   roxl.w   #1, d0               ; D0 = (D0 << 1) | X  (LFSR step)
 *   rol.l    #1, d3               ; D3 ruota (mask helper)
 *   lsr.w    #1, d1               ; D1 >>= 1  (contatore loop)
 *   bne.b    loop
 *   ; end loop
 *   move.w   d0, ($4003A6)        ; salva nuovo seed
 *   move.l   $4(a7), d1           ; ricarica maxExclusive
 *   beq.b    done                 ; se 0: skip riduzione
 *   and.w    d3, d0               ; D0 &= D3.lo  (mask = 2^N - 1)
 *   ; riduzione modulare: while D1 <= D0 (cioè while result >= limit)
 *   cmp.w    d0, d1               ; D1 - D0, setta flag
 *   bgt.b    done                 ; branch se D1 > D0 (result < limit)
 *   sub.w    d1, d0               ; D0 -= D1
 *   bra.b    back_to_cmp
 * done:
 *   move.l   a0, d2               ; restore D2
 *   move.l   a1, d3               ; restore D3
 *   rts                           ; return D0.w
 *
 * Semantica:
 *   N = numero di shift-right per portare `limit` a zero (= bit_length(limit))
 *   Il LFSR avanza di N step.
 *   mask = D3.lo dopo N ROL.L #1 di 0xFFFF0000 = (1 << N) - 1
 *   result = newSeed & mask
 *   Riduzione: while (result >= limit) result -= limit  ← bgt = "if D1>D0 skip"
 *   Caso limite: limit == 0 → nessun avanzamento, ritorna seed corrente
 *
 * Nota sulla riduzione: il binario usa `bgt done` (branch se D1 > D0, signed),
 * quindi resta nel loop finché D1 <= D0 (i.e. result >= limit). Questo è
 * `>=`, NON `>`. La differenza è visibile quando il valore mascherato è
 * uguale esattamente a limit (es. limit=1, result=1 → deve diventare 0).
 */

import type { GameState } from "./state.js";
import { rngStepOnce } from "./rng.js";
import { as_u16, as_u32 } from "./wrap.js";

export const RANDOM_MOD_13A98_ADDR = 0x00013a98 as const;

/**
 * Replica di `FUN_00013A98`.
 *
 * Prende `maxExclusive` (u16), avanza il LFSR in `state.rng`, e ritorna un
 * intero in [0, maxExclusive).
 *
 * Se `maxExclusive == 0`: seed invariato, ritorna seed corrente (binary: 0
 * iterazioni di loop → beq done → skip riduzione).
 *
 * Solo i 16 bit bassi di `maxExclusive` vengono usati (il binario legge
 * `move.l 4(SP), D1` ma usa solo D1.W per le operazioni).
 */
export function randomMod13A98(state: GameState, maxExclusive: number): number {
  const limit = maxExclusive & 0xffff;

  // Caso limit=0: no loop, no riduzione, ritorna seed corrente
  if (limit === 0) {
    state.rng.callsThisFrame = as_u32((state.rng.callsThisFrame as unknown as number) + 1);
    return (state.rng.seed as unknown as number) & 0xffff;
  }

  // Avanza seed di N step (N = bit_length(limit), il loop del binario usa
  // lsr.w #1 su D1 fino a zero — esattamente bit_length iterazioni).
  let seed = (state.rng.seed as unknown as number) & 0xffff;
  let d1 = limit;
  // Anche D3 ruota in parallelo; usiamo il calcolo diretto: mask = (1<<N)-1
  // ma teniamo D3 separato per fedeltà (il risultato mask è identico).
  let d3 = 0xffff0000;

  while (d1 !== 0) {
    // LFSR step (rngStepOnce)
    seed = (rngStepOnce(as_u16(seed)) as unknown as number) & 0xffff;
    // rol.l #1 di d3
    d3 = (((d3 << 1) | (d3 >>> 31)) >>> 0);
    // lsr.w #1 di d1
    d1 = (d1 >>> 1) & 0xffff;
  }

  // Salva nuovo seed
  state.rng.seed = as_u32(seed);
  state.rng.callsThisFrame = as_u32((state.rng.callsThisFrame as unknown as number) + 1);

  // Maschera: D3.lo = (1 << N) - 1  (after N ROL.L #1 di 0xFFFF0000)
  const mask = d3 & 0xffff;
  let result = seed & mask;

  // Riduzione modulare con >= (bgt: branch if D1>D0, loop while D1<=D0)
  while (result >= limit) {
    result -= limit;
  }

  return result;
}
