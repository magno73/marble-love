/**
 * state-sub-5d2a.ts — replica `FUN_00005D2A` (194 byte = 0xC2).
 *
 * Wrapper di "row-render con bit-mask scan" che disegna 16 coppie di celle
 * iterando una bitmap di 16 bit (`arg0` low word) MSB→LSB. Per ogni bit
 * chiama 2 volte `FUN_00003784` (uno strumento "draw cell at xy with attr"):
 *
 *   - Cella sinistra : (x = A3 + A4 (sign-ext somma long), y = D6w sign-ext)
 *   - Cella destra   : (x = (15 - A4) + A3, y = D6w sign-ext)
 *   - Attr           : 0xA0 se D4 == arg1_word_low, altrimenti 0x20
 *   - Trailing arg   : 0 (immediate `clr.l -(SP)`)
 *
 * Iter principale: `D4 = 15 → 0` (`bge.w` in word signed → 16 iter). Maschera
 * bit-pattern: `A2w` shiftata a destra 1 bit per iter, partendo da `0x8000`.
 *
 * Special case @ `D4 == 7`: legge 2 volte `byte ROM[0x10072]`. Se != 0
 * imposta `D5w = -11 (0xFFF5 word)` e `A3w = 4`. Altrimenti lascia `D5w = 5`
 * (init) e `A3w = 0` (init). In produzione (ROM marble) `byte == 0`, quindi
 * questo branch è effettivamente no-op vs init.
 *
 * **Disasm 0x5D2A..0x5DEC** (194 byte):
 *
 *   0x5D2A  movem.l {A4 A3 A2 D7 D6 D5 D4 D3 D2},-(SP) ; preserve 9 reg (36 byte)
 *   0x5D2E  move.w  (0x2a,SP),D3w           ; D3w = arg0 word low
 *   0x5D32  move.w  (0x2e,SP),D2w           ; D2w = arg1 word low
 *   0x5D36  movea.w #-0x8000,A2             ; A2 = sign-ext(0x8000) = 0xFFFF8000;
 *                                            ; ma A2w = 0x8000 (mask iniziale)
 *   0x5D3A  moveq   #5,D5                   ; D5 = 5 (long)
 *   0x5D3C  clr.w   D7w                     ; D7w = 0
 *   0x5D3E  movea.w D7w,A3                  ; A3 = sign-ext(0) = 0
 *   0x5D40  moveq   #0xf,D4                 ; D4 = 15 (loop counter)
 * LOOP_TOP:
 *   0x5D42  moveq   #7,D1                   ; D1 = 7
 *   0x5D44  cmp.w   D4w,D1w                 ; cmp.w D4,D1 → calc D1-D4 = 7-D4
 *   0x5D46  bne.b   0x5D68                  ; if D4 != 7, skip gate-byte read
 *   0x5D48  tst.b   (0x10072).l             ; gate byte
 *   0x5D4E  beq.b   0x5D54                  ; if 0 → D0 = 5
 *   0x5D50  moveq   #-0xb,D0                ; D0 = -11 = 0xFFFFFFF5 (long)
 *   0x5D52  bra.b   0x5D56
 *   0x5D54  moveq   #5,D0                   ; D0 = 5
 *   0x5D56  move.w  D0w,D5w                 ; D5w = D0w (low word)
 *                                            ; D5 keeps its hi word, but hi=0 here
 *   0x5D58  tst.b   (0x10072).l             ; gate byte (read again)
 *   0x5D5E  beq.b   0x5D64                  ; if 0 → D0 = 0
 *   0x5D60  moveq   #4,D0                   ; D0 = 4
 *   0x5D62  bra.b   0x5D66
 *   0x5D64  moveq   #0,D0                   ; D0 = 0
 *   0x5D66  movea.w D0w,A3                  ; A3 = sign-ext(D0w)
 * LOOP_BODY:
 *   0x5D68  moveq   #0,D0
 *   0x5D6A  move.w  A2w,D0w                 ; D0 = A2w zero-ext (mask)
 *   0x5D6C  move.w  D3w,D1w                 ; D1w = D3w (arg0 word low)
 *   0x5D6E  ext.l   D1                      ; D1 = sign-ext(D1w)
 *   0x5D70  and.l   D1,D0                   ; D0 = mask & arg0 (long)
 *   0x5D72  beq.b   0x5D78                  ; if bit clear → D0 = 8
 *   0x5D74  moveq   #7,D0                   ; D0 = 7 (bit set)
 *   0x5D76  bra.b   0x5D7A
 *   0x5D78  moveq   #8,D0                   ; D0 = 8 (bit clear)
 *   0x5D7A  movea.w D0w,A4                  ; A4 = sign-ext(7 or 8) (always pos)
 *   0x5D7C  moveq   #0xf,D1                 ; D1 = 15
 *   0x5D7E  move.w  D4w,D0w                 ; D0w = D4w
 *   0x5D80  ext.l   D0                      ; D0 = sign-ext(D4w) = D4 (if 0..15)
 *   0x5D82  sub.l   D0,D1                   ; D1 = 15 - D4 (long)
 *   0x5D84  asl.l   #1,D1                   ; D1 = (15-D4) * 2
 *   0x5D86  move.w  D1w,D6w                 ; D6w = D1w
 *   0x5D88  add.w   D5w,D6w                 ; D6w += D5w (word)
 *   0x5D8A  cmp.w   D2w,D4w                 ; cmp.w D2,D4 → calc D4-D2
 *   0x5D8C  bne.b   0x5D96                  ; if D4 != D2w → attr = 0x20
 *   0x5D8E  move.l  #0xa0,D0                ; D0 = 0xA0 (highlighted)
 *   0x5D94  bra.b   0x5D98
 *   0x5D96  moveq   #0x20,D0                ; D0 = 0x20 (default)
 *   0x5D98  clr.l   -(SP)                   ; push 0 (arg4)
 *   0x5D9A  move.l  D0,-(SP)                ; push attr (arg3)
 *   0x5D9C  move.w  A3w,D0w                 ; D0 = A3w
 *   0x5D9E  ext.l   D0                      ; D0 = sign-ext(A3w)
 *   0x5DA0  move.w  A4w,D1w                 ; D1w = A4w
 *   0x5DA2  ext.l   D1                      ; D1 = sign-ext(A4w)
 *   0x5DA4  add.l   D1,D0                   ; D0 = A3 + A4 (long, sign-ext somma)
 *   0x5DA6  move.l  D0,-(SP)                ; push x_left (arg2)
 *   0x5DA8  move.w  D6w,D0w                 ; D0w = D6w
 *   0x5DAA  ext.l   D0                      ; D0 = sign-ext(D6w)
 *   0x5DAC  move.l  D0,-(SP)                ; push y (arg1)
 *   0x5DAE  jsr     0x3784.l                ; CALL #1 (cella sinistra)
 *   0x5DB4  clr.l   -(SP)                   ; push 0 (arg4 di call #2)
 *   0x5DB6  clr.l   -(SP)                   ; push 0 (arg3 di call #2)
 *                                            ; NB: attr = 0 NON 0xA0/0x20!
 *   0x5DB8  moveq   #0xf,D0                 ; D0 = 15
 *   0x5DBA  move.w  A4w,D1w
 *   0x5DBC  ext.l   D1                      ; D1 = sign-ext(A4w)
 *   0x5DBE  sub.l   D1,D0                   ; D0 = 15 - A4
 *   0x5DC0  move.w  A3w,D1w
 *   0x5DC2  ext.l   D1                      ; D1 = sign-ext(A3w)
 *   0x5DC4  add.l   D1,D0                   ; D0 = (15-A4) + A3
 *   0x5DC6  move.l  D0,-(SP)                ; push x_right (arg2)
 *   0x5DC8  move.w  D6w,D0w
 *   0x5DCA  ext.l   D0                      ; D0 = sign-ext(D6w)
 *   0x5DCC  move.l  D0,-(SP)                ; push y (arg1)
 *   0x5DCE  jsr     0x3784.l                ; CALL #2 (cella destra)
 *   0x5DD4  move.w  A2w,D0w
 *   0x5DD6  lsr.w   #1,D0w                  ; mask >>= 1 (logical word shift)
 *   0x5DD8  movea.w D0w,A2                  ; A2 = sign-ext(new mask word)
 *   0x5DDA  lea     (0x20,SP),SP            ; pop 32 byte (8 args * 4 byte)
 *   0x5DDE  subq.w  #1,D4w                  ; D4--
 *   0x5DE0  tst.w   D4w
 *   0x5DE2  bge.w   0x5D42                  ; loop while D4 >= 0 (signed word)
 *   0x5DE6  movem.l (SP)+,{D2 D3 D4 D5 D6 D7 A2 A3 A4}
 *   0x5DEA  rts
 *
 * **IMPORTANTE — attr di CALL #2 = 0 (non 0xA0/0x20!)**:
 *   Il codice fa `clr.l -(SP); clr.l -(SP)` per CALL #2 (push 0, 0). Quindi
 *   l'attr di cella destra è SEMPRE 0, NON l'attr di cella sinistra. Cella
 *   sinistra può essere 0xA0 (highlighted) o 0x20 (default). Questa è una
 *   feature di rendering: probabilmente cella destra è "trasparente" o "no
 *   attr override".
 *
 * **Convenzione caller** (verificata via xrefs):
 *   - Args: 2 long pushati da caller. Caller pusha low-word a `(0x2a, SP)`
 *     e `(0x2e, SP)` rispettivamente (offsets contano caller_SP_args + 2 e
 *     +6, cioè low word di arg0 long e arg1 long).
 *   - `arg0` long: bitmap pattern (16 bit usati nella low word). `arg0_word_low`
 *     è la maschera "row".
 *   - `arg1` long: highlight index (low word). Se `arg1 ∈ {0..15}`, la cella
 *     a `D4 == arg1` riceve attr 0xA0 invece di 0x20.
 *   - Return: D0 (long). Non significativo per il caller (è il D0 lasciato
 *     dall'ultimo jsr, ma i caller non lo testano).
 *   - Callee-saved: D2-D7, A2-A4 (preservati via movem prologue/epilogue).
 *
 * **Side effects**: nessuno DIRETTO da questo wrapper. Tutti gli effetti
 *   reali (modifica alphaRam/spriteRam/screen, ecc.) vivono dentro le 32
 *   invocazioni di FUN_3784 (16 iter × 2 chiamate). Lo stub di test cattura
 *   ciascuna invocazione con i suoi 4 args.
 *
 * **Note di low-level fidelity**:
 *
 *  1. **Stack offset di `(0x2a, SP)` e `(0x2e, SP)`**: post-movem (9 reg × 4 =
 *     36 = 0x24) + ret addr (4) = 40 = 0x28. Caller_SP_args = SP + 0x28.
 *     Layout args (2 long pushati da caller, RTL):
 *        (0x28, SP) = arg0 long (alta = 0x28+0..3, bassa = 0x2A..0x2B)
 *        (0x2C, SP) = arg1 long (bassa = 0x2E..0x2F)
 *     Quindi `move.w (0x2a,SP),D3w` = arg0 low word, `move.w (0x2e,SP),D2w`
 *     = arg1 low word. ✓
 *
 *  2. **`movea.w #-0x8000, A2`**: l'immediate `-0x8000` è word-signed-extended
 *     a long → A2 long = 0xFFFF8000. Ma `A2w` (low word) = 0x8000. Le
 *     successive operazioni leggono `move.w A2w, D0w` (zero-ext) = 0x8000.
 *     Il sign-ext di A2 long NON è osservato (mai letto come long).
 *
 *  3. **`movea.w D7w, A3` / `movea.w D0w, A2/A3/A4`**: tutti sign-extend la
 *     low word a long. Per word positive (< 0x8000) il risultato è zero-ext.
 *     Per word negative (>= 0x8000) sign-ext mette 0xFFFF nella metà alta.
 *     Nel caso di A2 dopo iter 0: D0w = 0x8000, lsr.w #1 → 0x4000 (positive),
 *     poi movea.w D0w, A2 → A2 = 0x00004000. Da iter 1 in poi A2 hi = 0.
 *
 *  4. **`moveq #-0xb, D0`**: long sign-ext = 0xFFFFFFF5 = -11. Poi
 *     `move.w D0w, D5w` = 0xFFF5 (low word). D5 = (D5_hi)|0xFFF5. D5_hi era
 *     0 (init `moveq #5,D5` = 0x00000005), quindi D5 = 0x0000FFF5.
 *
 *  5. **`add.w D5w, D6w`**: word add (mod 65536). Con D5w = 0xFFF5 (= -11
 *     signed) e D6w = (15-D4)*2 (range 0..30), risultato wraps. Es: D4=15,
 *     D6w = 0; D6w + 0xFFF5 = 0xFFF5. D4=14, D6w = 2 + 0xFFF5 = 0xFFF7. Ecc.
 *     Quando passato a FUN_3784, ext.l → D0 = sign-ext(0xFFF5) = 0xFFFFFFF5
 *     (long signed = -11). Quindi y può essere "negativo" come long.
 *
 *  6. **`cmp.w D4w, D1w` con D1=7**: calcola D1 - D4 = 7 - D4. `bne` fires se
 *     D4 != 7. Il branch eseguito UNA volta (D4 passa per 7 una sola volta
 *     nel loop 15→0). NON è un loop counter: è un check sull'iterazione 8a
 *     (zero-indexed: D4=15 è iter 0, D4=7 è iter 8).
 *
 *  7. **`cmp.w D2w, D4w`**: calcola D4w - D2w. `bne` fires se D4 != D2w. Se
 *     D4 == D2 (a livello word), attr = 0xA0; altrimenti 0x20. D2w = arg1
 *     low word (range 0..0xFFFF). Se arg1 ∈ {0..15}, esattamente UNA iter
 *     riceve attr 0xA0 (cella sinistra). Se arg1 not in range, NESSUNA iter
 *     riceve 0xA0 (sempre 0x20).
 *
 *  8. **`subq.w #1, D4w; tst.w D4w; bge.w 0x5D42`**: word decrement, signed
 *     test. Quando D4=0, D4-1 = -1 (= 0xFFFF word, signed = -1), tst.w sets
 *     N=1, bge fails (signed N XOR V = 1). 16 iter totali (D4=15..0).
 *
 *  9. **Args di FUN_3784 (push order RTL)**:
 *     CALL #1: push (0, attr, x_left, y) → callee vede args al stack come:
 *        (0x4, SP) = y (long, sign-ext da D6w)
 *        (0x8, SP) = x_left (long, sign-ext somma A3+A4)
 *        (0xC, SP) = attr (long, 0x20 o 0xA0)
 *        (0x10, SP) = 0 (long)
 *     CALL #2: push (0, 0, x_right, y) → callee vede:
 *        (0x4, SP) = y
 *        (0x8, SP) = x_right
 *        (0xC, SP) = 0  ← ATTR = 0, NON l'attr di CALL #1!
 *        (0x10, SP) = 0
 *
 * 10. **Iterazioni totali**: 16 (D4 ∈ {15, 14, ..., 0}). 32 chiamate a
 *     FUN_3784 (2 per iter). Cella sinistra a `x_left` e cella destra a
 *     `x_right` con la stessa `y`.
 *
 * 11. **D0 al rts**: l'epilogue movem NON tocca D0. D0 conserva il suo
 *     valore al momento di entry in 0x5DE6. L'ultimo jsr a 0x3784 lascia
 *     D0 = quel callee's D0. In ogni caso il caller di 5D2A non testa D0
 *     (verificato via xref @ 0x5C44, 0x5CC4 in FUN_5BB8).
 *
 * **Xrefs** (3 ref, 1 caller funzione):
 *   - `0x5C44` in FUN_5BB8 — jsr 0x5D2A (UNCONDITIONAL_CALL)
 *   - `0x5CC4` in FUN_5BB8 — jsr 0x5D2A (UNCONDITIONAL_CALL)
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-5d2a-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── ROM addresses ────────────────────────────────────────────────────────

/** Byte ROM @ 0x10072: gate per il branch `D4 == 7` (D5w/A3w override). */
export const ROM_GATE_BYTE_ADDR = 0x00010072 as const;

// ─── Costanti derivate dal disasm ─────────────────────────────────────────

/** Numero di iterazioni del loop principale (D4 = 15..0). */
export const LOOP_ITER_COUNT = 16 as const;

/** Numero di chiamate a FUN_3784 per iterazione (cella sinistra + destra). */
export const CALLS_PER_ITER = 2 as const;

/** Iter speciale dove si legge il gate byte (D4 == 7 → iter index 8). */
export const SPECIAL_ITER_D4 = 7 as const;

/** Maschera iniziale per A2w (`movea.w #-0x8000, A2`). */
export const INIT_MASK = 0x8000 as const;

/** Init D5 (default, override a -11/0xFFF5 word se gate != 0). */
export const INIT_D5 = 5 as const;

/** Override D5 word se gate != 0 (`moveq #-0xb, D0`). */
export const OVERRIDE_D5W_GATE_NZ = 0xfff5 as const;

/** Init A3 (default, override a 4 se gate != 0). */
export const INIT_A3 = 0 as const;

/** Override A3 se gate != 0 (`moveq #4, D0`). */
export const OVERRIDE_A3_GATE_NZ = 4 as const;

/** Attr quando D4 == arg1_word_low (cella highlighted). */
export const ATTR_HIGHLIGHTED = 0xa0 as const;

/** Attr default cella sinistra. */
export const ATTR_DEFAULT = 0x20 as const;

/** Attr cella destra (sempre 0). */
export const ATTR_RIGHT = 0 as const;

/** Trailing arg sempre 0 (push `clr.l -(SP)`). */
export const TRAILING_ARG = 0 as const;

// ─── Tipi callback ─────────────────────────────────────────────────────────

/**
 * Signature di `FUN_00003784` — "draw cell" callee.
 *
 * Args (long unsigned, in ordine come letti dal callee da `(0x4..0x10, SP)`):
 *   - `y`     : sign-ext di D6w (può essere 0..30 oppure 0xFFFFFFF5..0xFFFFFFF7
 *               se gate-byte != 0).
 *   - `x`     : sign-ext somma A3+A4 (A3∈{0,4}, A4∈{7,8} per cella sinistra;
 *               cella destra usa (15-A4)+A3).
 *   - `attr`  : 0xA0 (highlighted) o 0x20 (default) per cella sinistra; 0 per
 *               cella destra.
 *   - `extra` : sempre 0 (arg4, padding/reserved).
 *
 * Ritorna long. Il valore è ignorato dal wrapper (D0 al rts non significativo).
 */
export type Sub5D2AInner3784 = (
  state: GameState,
  y: number,
  x: number,
  attr: number,
  extra: number,
) => number;

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Sign-extend low word di `v` a long unsigned32.
 *   - se `v & 0x8000` → hi word = 0xFFFF
 *   - altrimenti hi word = 0x0000
 */
function signExtWord(v: number): number {
  return ((v & 0x8000) !== 0 ? (v | 0xffff0000) : (v & 0xffff)) >>> 0;
}

/** Add long unsigned32 (mod 2^32, equivalente a M68k `add.l`). */
function addLong(a: number, b: number): number {
  return ((a + b) | 0) >>> 0;
}

/** Sub long unsigned32 (mod 2^32). */
function subLong(a: number, b: number): number {
  return ((a - b) | 0) >>> 0;
}

// ─── Replica ───────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00005D2A` — row-render con bit-mask scan.
 *
 * Itera 16 volte (`D4 = 15..0`), per ogni iter:
 *   1. Aggiorna `A2w` (mask, shift right 1 bit) — la prima iter usa 0x8000.
 *   2. (Solo `D4 == 7`) legge `byte ROM[0x10072]`. Se != 0, override:
 *      - `D5w = 0xFFF5` (invece di 5)
 *      - `A3 = 4` (invece di 0)
 *   3. Test `mask & arg0_word`: se set → `A4 = 7`, else `A4 = 8`.
 *   4. Calcola `y = D5w + (15-D4)*2` (word add, mod 65536).
 *   5. Calcola `attr_left = (D4 == arg1_word) ? 0xA0 : 0x20`.
 *   6. CALL #1: `inner3784(y_signExt, (A3+A4)_signExt, attr_left, 0)`
 *      — cella sinistra.
 *   7. CALL #2: `inner3784(y_signExt, ((15-A4)+A3)_signExt, 0, 0)`
 *      — cella destra (attr SEMPRE 0).
 *   8. `mask = (mask >> 1) & 0xFFFF` (word logical shift).
 *
 * @param state         GameState. Letto/scritto SOLO dai callback `inner*`.
 * @param rom           RomImage. Letto a `0x10072` (byte gate).
 * @param arg0Long      Long unsigned32. La low word è la bitmap riga (16 bit
 *                      MSB→LSB). High word ignorata.
 * @param arg1Long      Long unsigned32. La low word è l'highlight index. Se
 *                      `arg1_low ∈ {0..15}`, la cella a `D4 == arg1_low`
 *                      riceve attr 0xA0; altrimenti tutte 0x20.
 * @param inner3784     Callback per FUN_3784. Default: ritorna 0 (no-op).
 *                      Invocato 32 volte (16 iter × 2 celle). Ordine:
 *                      iter 0 left, iter 0 right, iter 1 left, ... iter 15 right.
 *
 * @returns long unsigned32 (D0 al rts). In pratica = D0 lasciato dall'ultima
 *          chiamata a inner3784. I caller (FUN_5BB8 @ 0x5C44, 0x5CC4) NON
 *          testano D0, ma lo replichiamo per fedeltà (= ultimo return di
 *          inner3784, oppure 0 se default no-op).
 *
 * **Modellazione bit-perfect**:
 *
 * 1. `mask` parte da 0x8000 e viene shiftata DOPO le 2 chiamate (lsr.w #1).
 *    Quindi iter 0 usa 0x8000, iter 1 usa 0x4000, ... iter 15 usa 0x0001.
 * 2. `D5` (long) parte da 5. Solo a `D4 == 7` viene SOVRASCRITTA la low word
 *    a `0xFFF5` se gate != 0. La hi word resta 0 in entrambi i casi (init e
 *    override partono da D0 long, hi 0).
 * 3. `A3` (long) parte da 0. Solo a `D4 == 7` viene impostata a `sign-ext(D0w)`
 *    dove D0w ∈ {0, 4} → A3 ∈ {0, 4} (sempre positive, hi=0).
 * 4. `D6w = (15-D4)*2 + D5w` (word add, mod 65536). Sign-ext a long per `y`.
 * 5. `attr_left`: word cmp `D4 == D2w` → 0xA0 se equal, 0x20 altrimenti.
 *    NB: D4 in word range 0..15, D2w in range 0..0xFFFF. Match solo se D2w
 *    è nel range del loop counter.
 * 6. `x_left = sign-ext(A3w) + sign-ext(A4w)` (long add).
 *    `x_right = sign-ext(15-A4) + sign-ext(A3w)` — calcolato come
 *    `(15 - sign-ext(A4w)) + sign-ext(A3w)` long.
 * 7. CALL #2 attr = 0 (clr.l -(SP)) sempre, anche se cella sinistra ha 0xA0.
 *
 * **Safety**: loop ha esattamente 16 iter (no runaway). 32 invocazioni callback.
 */
export function stateSub5D2A(
  state: GameState,
  rom: RomImage,
  arg0Long: number,
  arg1Long: number,
  inner3784: Sub5D2AInner3784 = () => 0,
): number {
  // Normalizza args: il binario legge solo la low word, ma manteniamo la
  // signature long per coerenza con la convenzione caller (push long RTL).
  const arg0Word = arg0Long & 0xffff;
  const arg1Word = arg1Long & 0xffff;

  // ─── Init register state (post-prologue movem + setup) ──────────────────
  // A2 long = 0xFFFF8000 (sign-ext di 0x8000), ma A2w = 0x8000 (mask).
  // Useremo solo A2w → tracciamo come word.
  let maskWord: number = INIT_MASK; // 0x8000 → 0x4000 → ... → 0x0001
  // D5 long = 5 (init `moveq #5,D5`). hi=0, lo=5.
  let d5Word: number = INIT_D5; // low word usata per `add.w D5w, D6w`
  // A3 long = 0 (init `clr.w D7w; movea.w D7w, A3`). hi=0, lo=0.
  let a3Word: number = INIT_A3; // low word, sign-ext per long ops.

  // Gate byte (letto 2 volte a D4==7, ma stesso valore — ROM read-only).
  const gateByte = rom.program[ROM_GATE_BYTE_ADDR] ?? 0;

  // D0 al rts: si propaga dall'ultimo `inner3784`. Default 0.
  let lastD0 = 0;

  // ─── Loop principale: D4 = 15 → 0 (16 iter, signed bge.w on D4w) ───────
  for (let d4 = 15; d4 >= 0; d4--) {
    // ─── Special @ D4 == 7: gate-byte override ─────────────────────────
    if (d4 === SPECIAL_ITER_D4) {
      // tst.b ROM[0x10072]; beq → D5w = 5; bne → D5w = 0xFFF5.
      // Nota: `moveq #5,D0; move.w D0w,D5w` produce D5w = 5 (uguale a init,
      // quindi se gate==0 il valore non cambia). Se gate != 0 →
      // `moveq #-0xb, D0` (D0 = 0xFFFFFFF5), poi D5w = 0xFFF5.
      d5Word = gateByte === 0 ? INIT_D5 : OVERRIDE_D5W_GATE_NZ;

      // Seconda lettura gate (stesso valore): A3 = 0 se gate==0, 4 altrimenti.
      a3Word = gateByte === 0 ? INIT_A3 : OVERRIDE_A3_GATE_NZ;
    }

    // ─── Test bit `mask & arg0_word` → A4 ∈ {7, 8} ─────────────────────
    // moveq #0, D0; move.w A2w, D0w; move.w D3w, D1w; ext.l D1; and.l D1,D0.
    // D0 = (mask zero-ext) & sign-ext(arg0_word). Se arg0_word < 0x8000,
    // sign-ext = zero-ext (hi=0); se >= 0x8000, sign-ext (hi=0xFFFF). Ma
    // D0 = mask zero-ext (hi=0), quindi `and.l` con sign-ext: hi sempre 0.
    // Risultato: D0 = (mask & arg0_word) (16-bit AND, hi=0).
    const bitTest = (maskWord & arg0Word) >>> 0;
    const a4Word = bitTest === 0 ? 8 : 7;

    // ─── Calc D6w = (15-D4)*2 + D5w (word add) ─────────────────────────
    // D1 = 15 - D4 (long, sign-ext), asl.l #1 → *2. move.w D1w, D6w; add.w D5w, D6w.
    const d1Long = ((15 - d4) << 1) >>> 0; // (15-d4) * 2, range 0..30
    const d6Word = (d1Long + d5Word) & 0xffff; // word add wraps

    // ─── attr_left: 0xA0 se D4 == arg1_word, altrimenti 0x20 ──────────
    // cmp.w D2w, D4w → calc D4-D2; bne → attr = 0x20.
    const attrLeft = d4 === arg1Word ? ATTR_HIGHLIGHTED : ATTR_DEFAULT;

    // ─── CALL #1: inner3784(y, x_left, attr_left, 0) ──────────────────
    // y = sign-ext(D6w); x_left = sign-ext(A3w) + sign-ext(A4w) (long add).
    const yLong = signExtWord(d6Word);
    const xLeft = addLong(signExtWord(a3Word), signExtWord(a4Word));
    lastD0 = (inner3784(state, yLong, xLeft, attrLeft, TRAILING_ARG) >>> 0) >>> 0;

    // ─── CALL #2: inner3784(y, x_right, 0, 0) ─────────────────────────
    // x_right = (15 - sign-ext(A4w)) + sign-ext(A3w).
    // Disasm: `moveq #0xf,D0; move.w A4w,D1w; ext.l D1; sub.l D1,D0;
    //          move.w A3w,D1w; ext.l D1; add.l D1,D0`.
    // Equivale a `(15 - signExt(A4w)) + signExt(A3w)` (long arithmetic).
    const xRight = addLong(subLong(15, signExtWord(a4Word)), signExtWord(a3Word));
    lastD0 = (inner3784(state, yLong, xRight, ATTR_RIGHT, TRAILING_ARG) >>> 0) >>> 0;

    // ─── Shift mask: A2w >>= 1 (logical word shift) ────────────────────
    // move.w A2w, D0w; lsr.w #1, D0w; movea.w D0w, A2.
    // Nota: lsr.w è logical (zero-fill). 0x8000 >> 1 = 0x4000 (positive),
    // movea.w D0w → A2 = sign-ext(0x4000) = 0x00004000 (hi=0). A2w = 0x4000.
    // Iter successive: 0x2000, 0x1000, ..., 0x0001, poi 0x0000 a iter 16
    // (ma il loop esce a D4 < 0 prima di usare 0x0000).
    maskWord = (maskWord >>> 1) & 0xffff;
  }

  void state; // referenced for API / consistency
  return lastD0 >>> 0;
}
