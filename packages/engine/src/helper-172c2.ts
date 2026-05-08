/**
 * helper-172c2.ts — replica bit-perfect di `FUN_000172C2` (74 byte, 30 istr).
 *
 * **Funzione**: `findLastZeroSlot()` — scansiona 7 entry nell'array a
 * `0x401482` con stride `0x42` byte. Per ogni entry controlla il byte a
 * `offset + 0x18`: se è ZERO aggiorna il risultato all'indirizzo dell'entry.
 * Restituisce l'indirizzo dell'**ultima** entry con byte+0x18 == 0, oppure
 * `0xFFFFFFFF` (−1) se nessuna entry soddisfa la condizione.
 *
 * **Callers**:
 *   - `FUN_00028F28` (string-trim.ts) @ `0x28F28`
 *   - secondo caller da identificare con find_xrefs
 *
 * **Disassembly completo** (FUN_000172C2, 30 istruzioni):
 *
 *   000172c2    movem.l {D3 D2},-(SP)          ; salva D2, D3
 *   000172c6    moveq  -0x1,D3                 ; D3 = 0xFFFFFFFF (risultato di default = -1)
 *   000172c8    clr.b  D2b                     ; D2b = 0 (contatore slot)
 *
 *   ; ── LOOP ───────────────────────────────────────────────────────────────
 *   000172ca    move.b D2b,D0b                 ; D0b = D2b
 *   000172cc    ext.w  D0w                     ; sign-extend byte → word
 *   000172ce    ext.l  D0                      ; sign-extend word → long
 *   000172d0    add.l  D0,D0                   ; D0 = D2 * 2
 *   000172d2    move.l D0,D1                   ; D1 = D2 * 2
 *   000172d4    asl.l  #0x5,D0                 ; D0 = D2 * 2 * 32 = D2 * 64
 *   000172d6    add.l  D1,D0                   ; D0 = D2*64 + D2*2 = D2*66 = D2*0x42
 *   000172d8    movea.l #0x401482,A0           ; A0 = base array
 *   000172de    tst.b  (0x18,A0,D0*0x1)        ; test [0x401482 + D2*0x42 + 0x18]
 *   000172e2    bne.b  0x000172fc              ; se ≠ 0 → salta (non aggiornare risultato)
 *
 *   ; ── SAVE ADDRESS ────────────────────────────────────────────────────────
 *   000172e4    move.b D2b,D0b                 ; (ricalcola offset — idempotente)
 *   000172e6    ext.w  D0w
 *   000172e8    ext.l  D0
 *   000172ea    add.l  D0,D0
 *   000172ec    move.l D0,D1
 *   000172ee    asl.l  #0x5,D0
 *   000172f0    add.l  D1,D0
 *   000172f2    movea.l #0x401482,A0
 *   000172f8    adda.l D0,A0                   ; A0 = 0x401482 + D2*0x42
 *   000172fa    move.l A0,D3                   ; D3 = A0 (aggiorna risultato)
 *
 *   ; ── LOOP CONTROL ────────────────────────────────────────────────────────
 *   000172fc    addq.b 0x1,D2b                 ; D2b++
 *   000172fe    cmpi.b #0x7,D2b                ; D2b == 7?
 *   00017302    bne.b  0x000172ca              ; no → torna al loop
 *
 *   ; ── EPILOGO ─────────────────────────────────────────────────────────────
 *   00017304    move.l D3,D0                   ; D0 = risultato
 *   00017306    movem.l (SP)+,{D2 D3}
 *   0001730a    rts
 *
 * **Dettagli**:
 *   - Array base: `0x401482` (work RAM)
 *   - Numero entry: 7 (loop da 0 a 6, break a D2b == 7)
 *   - Stride: `0x42` byte (= 66 = 2 + 64 = slot width)
 *   - Campo testato: byte a `+0x18` nella struct
 *   - Nessun argomento: il binario usa `moveq -1,D3` / `clr.b D2b` direttamente
 *
 * **Side effects**: nessuno (solo lettura da workRam).
 */

import type { GameState } from "./state.js";

/** Indirizzo ROM di `FUN_000172C2`. */
export const HELPER_172C2_ADDR = 0x000172c2 as const;

/** Indirizzo base dell'array di slot (work RAM). */
const SLOT_ARRAY_BASE = 0x401482 as const;

/** Stride in byte tra slot consecutivi (= 2 + 64 = 0x42). */
const SLOT_STRIDE = 0x42 as const;

/** Numero di slot (loop 0..6, termina quando D2b == 7). */
const SLOT_COUNT = 7 as const;

/** Offset dentro ogni slot del byte da testare. */
const SLOT_ACTIVE_OFFSET = 0x18 as const;

/**
 * Replica bit-perfect di `FUN_000172C2`.
 *
 * Scansiona 7 slot nell'array a `0x401482` con stride `0x42`. Restituisce
 * l'indirizzo work-RAM dell'ultima entry il cui byte `+0x18` vale **zero**,
 * oppure `0xFFFFFFFF` (= −1 in complemento a 2) se nessuna entry soddisfa
 * la condizione.
 *
 * Corrisponde alla logica M68K:
 *   - D3 inizializzato a `−1` (moveq)
 *   - Loop: se `tst.b (0x18,A0,D0) == 0` (bne salta), aggiorna D3 = indirizzo entry
 *   - Return: D0 = D3
 *
 * @param state  GameState — `workRam` viene letto (solo lettura, no side effects).
 * @returns      Indirizzo a 32 bit (unsigned) dell'ultima entry zero, o `0xFFFFFFFF`.
 */
export function helper172C2(state: GameState): number {
  const r = state.workRam;
  const baseOff = (SLOT_ARRAY_BASE - 0x400000) >>> 0;

  // D3 = 0xFFFFFFFF  (moveq -0x1,D3)
  let d3 = 0xffffffff;

  // D2b = 0  (clr.b D2b)
  for (let d2b = 0; d2b < SLOT_COUNT; d2b++) {
    // Calcola offset slot: D2*2 + D2*64 = D2*0x42  (add/asl/add sequence)
    const slotOff = (d2b * SLOT_STRIDE) >>> 0;

    // tst.b (0x18,A0,D0*1) — test byte a base+slotOff+0x18
    const byteAt18 = r[baseOff + slotOff + SLOT_ACTIVE_OFFSET] ?? 0;

    // bne.b → se non zero salta (NON aggiorna D3)
    // se zero → aggiorna D3 = 0x401482 + slotOff
    if (byteAt18 === 0) {
      // adda.l D0,A0  →  A0 = 0x401482 + slotOff
      d3 = (SLOT_ARRAY_BASE + slotOff) >>> 0;
    }

    // addq.b 0x1,D2b  →  D2b++ (avviene sempre, anche se abbiamo saltato)
  }

  // move.l D3,D0 → return
  return d3 >>> 0;
}
