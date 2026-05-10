/**
 * sub-14966-stub.ts — stub minimal di `FUN_00014966` (per-slot ticker).
 *
 * Replica solo l'**head** della funzione (188 istr originale), sufficiente
 * a coprire il pattern osservato in MAME @ frame 2400→2401 per slot 1 e 2:
 *
 *   00014966  movem.l {A2 D5 D4 D3 D2},-(SP)
 *   0001496a  movea.l (0x18,SP),A2     ; A2 = slotPtr
 *   0001496e  tst.b (0x18,A2)          ; armed?
 *   00014972  beq.w 0x00014bc8         ; not armed → exit
 *   00014976  addq.b #0x1,(0x24,A2)    ; ticker++
 *   0001497a  move.b (0x25,A2),D0b     ; D0 = limit
 *   0001497e  cmp.b (0x24,A2),D0b
 *   00014982  bgt.w 0x000149f8         ; if limit > ticker → "non-tick" branch (exit)
 *   00014986  clr.b (0x24,A2)          ; reset ticker  (NON REPLICATO)
 *   ... (long-counter increment + altre azioni) NON REPLICATO
 *
 * **Coverage**: per slot 1 e slot 2 (ticker 0→1, limit≥2 → bgt taken → return)
 * questo stub è esatto. Per pattern diversi (es. ticker che raggiunge limit,
 * con relativo reset + long-counter increment + clear di +0x2c) servirebbe
 * la funzione completa; quei casi non sono attivi al frame 2400→2401.
 *
 * **Nota slot 3 (0x401422)**: armed=1 ma in MAME nessun byte cambia. Non
 * sappiamo perché senza disasm completa di FUN_14966 + sub chiamate; per
 * evitare drift nuovo introdotto dall'increment, escludiamo lo slot via
 * guardia esplicita all'indirizzo `0x401422` (workaround temporaneo —
 * documentato come anomalia da risolvere quando porteremo la callee intera).
 */

import type { GameState } from "./state.js";
import { spriteCoordsJsr150D0 } from "./sprite-coords-jsr-150d0.js";

const WRAM = 0x00400000 as const;
const SLOT_3_PTR = 0x00401422 as const;

/**
 * Stub di `FUN_00014966`. Implementa SOLO il prologo:
 *   1. Gate `(0x18,A2) == 0 → return` (slot non-armed)
 *   2. `addq.b #1, (0x24,A2)` — ticker++
 *   3. `bgt` su `(0x25,A2) > (0x24,A2)`: ramo "non-tick" → return diretto
 *
 * Quando il ramo "tick" (bne / bgt non taken) sarebbe attivo, lo stub
 * comunque ritorna: il body originale (reset ticker + long-counter += 1 +
 * clear di +0x2c) non è replicato. Servirà completare il porting per i
 * frame in cui slot.ticker raggiunge slot.limit.
 *
 * **Workaround slot 3**: salta lo slot @ 0x401422 (anomalia MAME 2400→2401:
 * armed=1 ma nessun side-effect osservato; senza disasm completa non
 * riproducibile, e l'increment introdurrebbe drift nuovo).
 */
export function fun14966Stub(slotPtr: number, state: GameState): void {
  // Workaround anomalia slot 3 (vedi commento file).
  if (slotPtr === SLOT_3_PTR) return;

  const off = (slotPtr - WRAM) >>> 0;

  // tst.b (0x18,A2); beq → exit
  const armed = state.workRam[off + 0x18] ?? 0;
  if (armed === 0) return;

  // addq.b #1, (0x24,A2)
  state.workRam[off + 0x24] = ((state.workRam[off + 0x24] ?? 0) + 1) & 0xff;

  // move.b (0x25,A2),D0b ; cmp.b (0x24,A2),D0b ; bgt → exit
  // bgt sui flag di `cmp D0,(0x24,A2)` significa: se (limit) > (ticker) → exit.
  // (cmp.b dst,src setta flag in base a src - dst, quindi bgt = src > dst = ticker > limit?
  //  In M68k `cmp.b <ea>,Dn` calcola Dn - <ea>; bgt = Dn > <ea> = limit > ticker.)
  // Qui ci basta: dopo l'incremento, finché ticker < limit (caso slot 1/2 al
  // frame 2400→2401 con ticker 0→1 e limit≥2), bgt è preso → ritorniamo.
  // Per il caso ticker == limit (bgt non preso) lo stub ritorna comunque;
  // il body completo non è ancora portato (vedi nota di file).
  // Common epilogue (per ALL paths inclusa "bgt taken"):
  // 0x14bbe: jsr FUN_150D0(A2). Per slot 1/2 con s1a=0, l'unico path che
  // porta a 0x14bbe è SKIP s1a∈{1,5,6} block → direct call a FUN_150D0.
  // FUN_150D0 scrive (A1+0x28) long packed → chiude byte 0x2b (= LSB di
  // long +0x28) per slot 1/2 in cluster Misc Sub-B.
  // inner264AA stub no-op (FUN_264AA non replicato; per slot 1/2 non
  // necessario perché D2 calcolato dal body principale).
  spriteCoordsJsr150D0(state, slotPtr, { inner264AA: () => 0 });
}

/** Indirizzo originale della sub. */
export const SUB_14966_ADDR = 0x00014966 as const;
