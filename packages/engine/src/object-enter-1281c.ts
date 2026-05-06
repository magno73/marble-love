/**
 * object-enter-1281c.ts — replica `FUN_0001281C` (82 byte).
 *
 * Wrapper "bounded enter / dispatch" chiamato da quattro siti del binario
 * (xref: `FUN_259B4`, `FUN_121B8`, `FUN_158F6`, `FUN_253EC` — 7 jsr).
 *
 * Riceve un singolo long argument (struct ptr `A0`), legge un word signed
 * a `(0x20,A0)` e gate-a la chiamata interna a `FUN_000264AA` su quel
 * range. La firma di `FUN_264AA` è `(structPtr, mode)` dove `mode` è 0 o 1
 * a seconda che `A0` sia uno dei due "singleton object slot" canonici
 * (`0x400018`, `0x4000FA`) — in quel caso `mode=0`, altrimenti `mode=1`.
 *
 * **Disasm 0x1281C..0x1286D** (82 byte):
 *
 *   0001281c   movea.l (0x4,SP),A0       ; A0 = arg long (struct ptr)
 *   00012820   clr.b   (0x1c,A0)         ; struct+0x1C = 0 (clear status byte)
 *   00012824   move.w  (0x20,A0),D0w     ; D0w = struct+0x20 (signed word)
 *   00012828   andi.w  #-0x1,D0w         ; AND con 0xFFFF (no-op su valore;
 *                                          serve solo per pulire V/C nei flag,
 *                                          irrilevante per il branch successivo)
 *   0001282c   move.w  D0w,D1w           ; D1w = D0w
 *   0001282e   moveq   #-0x10,D0         ; D0 = 0xFFFFFFF0  (long, sign-ext −16)
 *   00012830   cmp.w   D1w,D0w           ; CCR ← D0w − D1w
 *   00012832   bge.b   done              ; D1 ≤ −16 (signed) → skip body
 *   00012834   cmpi.w  #0x100,D1w
 *   00012838   bge.b   done              ; D1 ≥ 256 (signed) → skip body
 *   0001283a   move.b  #0x1,(0x1c,A0)    ; struct+0x1C = 1
 *   00012840   moveq   #1,D1             ; D1 = 1
 *   00012842   cmpa.l  #0x400018,A0
 *   00012848   beq.w   skip_clr
 *   0001284c   cmpa.l  #0x4000FA,A0
 *   00012852   beq.w   skip_clr
 *   00012856   clr.b   D1b               ; A0 ∉ {0x400018, 0x4000FA} → D1b = 0
 *   skip_clr:
 *   00012858   moveq   #0x0,D0           ; D0 = 0
 *   0001285a   tst.b   D1b
 *   0001285c   seq     D0b               ; D0b = 0xFF se D1b == 0, else 0x00
 *   0001285e   neg.b   D0b               ; 0xFF → 0x01 ; 0x00 → 0x00
 *   00012860   move.l  D0,-(SP)          ; push mode (long, 0 o 1)
 *   00012862   move.l  A0,-(SP)          ; push struct ptr
 *   00012864   jsr     0x000264AA.l      ; FUN_264AA(structPtr, mode)
 *   0001286a   addq.l  #0x8,SP           ; pop 2 long args
 *   0001286c   rts                       ; D0 = inner return value
 *   done:                                 ; out-of-range path
 *   0001286c   rts                       ; D0 = 0xFFFFFFF0 (sign-ext −16
 *                                          dal `moveq #-0x10,D0` precedente)
 *
 * **Mode mapping** (logica del `seq/neg`):
 *   - A0 == 0x400018 OR A0 == 0x4000FA  →  D1=1  →  D0b=0  → `mode = 0`
 *   - altrimenti                         →  D1=0  →  D0b=1  → `mode = 1`
 *
 * Cioè: i due slot canonici (player/marble?) usano `mode=0`, tutti gli altri
 * `mode=1`. Lo slot `0x400018` è anche citato da `flag-scaled-magnitude-dispatch`
 * test parity tra i `ptrChoices` come slot rappresentativo.
 *
 * **Ritorno (D0)**:
 *   - In-range  : il `D0` lasciato da `FUN_264AA` (passato verbatim al chiamante).
 *   - Out-of-range : 0xFFFFFFF0 (residuo del `moveq #-0x10,D0` non sovrascritto).
 *
 * **Side effects**:
 *   - Sempre              : `workRam[A0+0x1C] = 0`
 *   - Path in-range, prima della jsr : `workRam[A0+0x1C] = 1`
 *   - Path in-range, dopo  : tutti gli effetti di `FUN_264AA` (opaque).
 *
 * **NO INTEGRAZIONE**: il sub interno `FUN_264AA` è una sub di update oggetto
 * complessa (~200+ byte, tocca slot `0x40074E`, `0x400988`, ecc.) ancora non
 * replicata in TS. Modelliamo la sua chiamata via callback `inner`, identico
 * a `flag-scaled-magnitude-dispatch.ts`. Il parity test patcha `FUN_264AA` con
 * uno stub `move.l (8,SP),D0; rts` per espone `mode` come D0 e poterlo
 * confrontare con quello calcolato da TS.
 */

import type { GameState } from "./state.js";

/** Base della work RAM (0x400000..0x401FFF, 8 KB). */
const WORK_RAM_BASE = 0x400000;

/** Offsets nello struct passato come arg1. */
const STRUCT_STATUS_BYTE_OFF = 0x1c; // (0x1C, A0) byte: 0 prologo, 1 in-range
const STRUCT_RANGE_WORD_OFF = 0x20; // (0x20, A0) word signed: gating value

/** Bound inferiore (signed): body skip se `range <= LOWER_REJECT`. */
export const RANGE_LOWER_BOUND = -16 as const;

/** Bound superiore (signed): body skip se `range >= UPPER_REJECT`. */
export const RANGE_UPPER_BOUND = 0x100 as const;

/** I due "singleton object slot" canonici che attivano `mode=0`. */
export const SINGLETON_SLOT_A = 0x00400018 as const;
export const SINGLETON_SLOT_B = 0x004000fa as const;

/**
 * Sentinel `D0` del path out-of-range: residuo del `moveq #-0x10,D0` (long
 * sign-extended di −16) che non viene mai sovrascritto su quella branch.
 */
export const OUT_OF_RANGE_D0 = 0xfffffff0 as const;

/**
 * Callback che modella `FUN_000264AA`. Riceve `(structPtr, mode)` come long
 * pushati dallo shim e ritorna il long lasciato in `D0` da quella sub. Nel
 * binario gli arg viaggiano sullo stack (RTL); qui li passiamo per valore.
 *
 * @param structPtr  identico ad `A0` (verbatim, non normalizzato).
 * @param mode       0 se `A0` è un singleton slot, 1 altrimenti.
 */
export type Inner264AA = (structPtr: number, mode: number) => number;

/**
 * Replica `FUN_0001281C` — bounded enter/dispatch shim.
 *
 * @param state    GameState (per leggere/scrivere `workRam[A0+0x1C, +0x20]`).
 * @param structPtr Long pushato dal caller (`A0` nel binario). DEVE essere
 *                 in `0x400000..0x401FFF` perché la funzione legge/scrive a
 *                 `(0x1C,A0)` e `(0x20,A0)` (work RAM).
 * @param inner    Callback che modella `FUN_000264AA`. Vedi `Inner264AA`.
 * @param rangeWordOverride (Opzionale) word signed già letto dal caller; se
 *                 presente bypassa la lettura da `state.workRam`.
 * @returns        Il long che la funzione lascia in `D0` al `rts`:
 *                 - in-range      : `inner(structPtr, mode)`
 *                 - out-of-range  : `0xFFFFFFF0` (= `OUT_OF_RANGE_D0`).
 */
export function objectEnter1281C(
  state: GameState,
  structPtr: number,
  inner: Inner264AA,
  rangeWordOverride?: number,
): number {
  const a0 = structPtr >>> 0;
  const slotOff = (a0 - WORK_RAM_BASE) >>> 0;

  // clr.b (0x1C,A0) — sempre, anche se poi skippiamo il body.
  state.workRam[slotOff + STRUCT_STATUS_BYTE_OFF] = 0;

  // move.w (0x20,A0),D0w — lettura word big-endian m68k.
  let rangeWord: number;
  if (rangeWordOverride !== undefined) {
    rangeWord = rangeWordOverride & 0xffff;
  } else {
    const hi = state.workRam[slotOff + STRUCT_RANGE_WORD_OFF] ?? 0;
    const lo = state.workRam[slotOff + STRUCT_RANGE_WORD_OFF + 1] ?? 0;
    rangeWord = ((hi << 8) | lo) & 0xffff;
  }

  // Sign-extend del word a signed 16-bit per il confronto.
  const rangeSigned = rangeWord & 0x8000 ? rangeWord - 0x10000 : rangeWord;

  // Bounds gate: body runs sse RANGE_LOWER_BOUND < rangeSigned < RANGE_UPPER_BOUND.
  // (Il binario fa `moveq #-0x10,D0; cmp.w D1,D0; bge done` → skip se D1 ≤ −16.
  // E `cmpi.w #0x100,D1; bge done` → skip se D1 ≥ 256.)
  if (rangeSigned <= RANGE_LOWER_BOUND || rangeSigned >= RANGE_UPPER_BOUND) {
    // D0 al ritorno = 0xFFFFFFF0 (sign-ext del moveq #-0x10 mai sovrascritto).
    return OUT_OF_RANGE_D0 >>> 0;
  }

  // In-range: scrivi flag = 1, poi delega a inner.
  state.workRam[slotOff + STRUCT_STATUS_BYTE_OFF] = 1;

  // Selezione mode: 0 se A0 ∈ {0x400018, 0x4000FA}, 1 altrimenti.
  // (Logica del `seq/neg D0b` dopo i due cmpa.l.)
  const mode = a0 === SINGLETON_SLOT_A || a0 === SINGLETON_SLOT_B ? 0 : 1;

  // jsr FUN_264AA(structPtr, mode). Il valore di ritorno (D0 dell'inner)
  // sopravvive all'`addq.l #8,SP; rts` dello shim → ritornato verbatim.
  return inner(a0, mode) >>> 0;
}

/**
 * Versione "selector-only" della selezione mode: utile per logging o quando il
 * caller vuole conoscere la mode senza eseguire `inner`. Restituisce 0 per i
 * singleton slot canonici, 1 altrimenti.
 */
export function selectMode(structPtr: number): number {
  const a0 = structPtr >>> 0;
  return a0 === SINGLETON_SLOT_A || a0 === SINGLETON_SLOT_B ? 0 : 1;
}
