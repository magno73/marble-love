/**
 * eeprom-commit-request.ts — replica `FUN_00003FC6` (66 byte) bit-perfect.
 *
 * **NOMENCLATURA**: La funzione e' chiamata UNA volta da `FUN_0000472A`
 * (call site @ 0x4748). E' un wrapper "consume / pace-check" che combina:
 *   - una query non-distruttiva via `FUN_3F3E` (helper "rate" — vedi
 *     `eeprom-commit.ts`) per ottenere un divisore D in [0..4];
 *   - una chiamata distruttiva a `FUN_3F78` (eepromCommit, drain+scale)
 *     per ottenere il "budget" corrente;
 *   - decide se "consumare" il request decrementando un byte
 *     dell'accumulator a 0x401FF5.
 *
 * Nonostante l'etichetta "EEPROM" (ereditata dal modulo gemello a 0x3F78),
 * NON tocca alcun MMIO o EEPROM: solo workRam @ 0x401FF5/F7 e bytes a
 * `*0x401FFC` + 0xA / +0xB (via FUN_3F3E e FUN_3F78).
 *
 * **Disasm 0x3FC6..0x4007** (66 byte):
 *
 *   movem.l {D2,D3},-(SP)            ; salva D2/D3 (8 byte)
 *   move.w  (0xE,SP),D2w             ; D2.w = arg low word (vedi note stack)
 *   move.w  D2w,D3w                  ; D3.w = D2.w (D3 alto preservato)
 *   jsr     FUN_3F3E                 ; D0 = rate (0 o 1..4); NESSUN side effect
 *   mulu.w  D0w,D3                   ; D3.l = D3.w * D0.w  (unsigned 16x16)
 *   move.w  D3w,D3w                  ; tst.w D3.w
 *   bne     work
 *   moveq   #1,D0                    ; (arg.w * rate.w) low-word == 0
 *   bra     done                     ; -> ritorna 1 (NESSUNA side effect)
 * work:
 *   jsr     FUN_3F78                 ; D0 = eepromCommit result; modifica workRam
 *   move.l  D0,D1                    ; D1 = budget (long)
 *   move.w  D2w,D0w                  ; D0.w = arg.w (D0 alto = D0 alto post-jsr)
 *   ext.l   D0                       ; D0.l = signext(D0.w) = signext(arg.w)
 *   muls.w  #0xC,D0                  ; D0.l = signext(arg.w) * 12 (signed)
 *   cmp.l   D0,D1                    ; flags = D1 - D0 (signed long)
 *   blt     fail                     ; se D1 < D0  -> ritorna 0
 *   move.b  D3b,D0b                  ; D0.b = (arg.w * rate.w).b
 *   sub.b   D0b,(0x401FF5).l         ; *0x401FF5 -= D3.b   (modulo 256)
 *   moveq   #1,D0
 *   bra     done                     ; -> ritorna 1
 * fail:
 *   moveq   #0,D0                    ; -> ritorna 0
 * done:
 *   movem.l (SP)+,{D2,D3}
 *   rts
 *
 * **IMPORTANTE — distinzione tra le 2 JSR**:
 *
 *   - 1° JSR @ 0x3FD0 va a `FUN_3F3E` (helper interno di FUN_3F78, vedi
 *     `eeprom-commit.ts` -> `helperFun3F3E`). Ritorna 0 (status >= 0xE0)
 *     oppure (status & 3) + 1 in [1..4]. NESSUN side effect su workRam.
 *
 *   - 2° JSR @ 0x3FE0 va a `FUN_3F78` (eepromCommit completo). Side effects
 *     descritti in `eeprom-commit.ts`: drain di 0x401FF7 in 0x401FF5,
 *     clamp a 0x19, scala finale.
 *
 * Errore facile: leggere entrambe le `jsr` come jsr a `FUN_3F78`. La prima
 * va al **helper** (0x3F3E), che e' funzionalmente equivalente al rate-only
 * branch del wrapper. Verificato col disasm di `tools/ghidra_disasm_at.py`.
 *
 * **Stack al `move.w (0xE,SP),D2w`**:
 *
 *   SP+0   D2 saved (4 byte)
 *   SP+4   D3 saved (4 byte)
 *   SP+8   return PC (4 byte)
 *   SP+C   arg long (caller pushed `move.l D2,-(SP)` @ 0x4746)
 *   SP+E   arg low word  (offset 0xE = SP+12+2, big-endian low word del long)
 *
 * Il caller `FUN_472A` push un long, ma la sub legge solo la LOW word.
 *
 * **Comportamento totale** (3 path di ritorno):
 *
 *   1. `(arg.w * rate.w) & 0xFFFF == 0`:
 *        ritorna 1, NESSUN side effect (no jsr a FUN_3F78). Scenari:
 *        - rate == 0 (status @ ptr+0xA >= 0xE0)
 *        - arg.w == 0
 *        - `(arg.w * rate.w) & 0xFFFF == 0` per coincidenza
 *
 *   2. budget < signext(arg.w) * 12 (signed long):
 *        ritorna 0, side effects: 1 chiamata a FUN_3F78 (drain).
 *        Nessun ulteriore decremento di 0x401FF5.
 *
 *   3. budget >= signext(arg.w) * 12 (signed long):
 *        side effects: 1 chiamata a FUN_3F78 (drain) + decremento byte
 *        @ 0x401FF5 di `(arg.w * rate.w).b` (low byte unsigned product),
 *        modulo 256. Ritorna 1.
 *
 * **Side effects sulla workRam**:
 *   - Nel path #1: NESSUNO.
 *   - Nei path #2/#3: 0x401FF5 e 0x401FF7 modificati da FUN_3F78
 *     (drain accumulator + clamp a 0x19).
 *   - Solo nel path #3: 0x401FF5 ulteriormente decrementato di D3.b
 *     modulo 256.
 *   - Bytes a `*0x401FFC` + 0xA / +0xB: solo letti, non scritti.
 *
 * **JSR interne**: 1 a FUN_3F3E (no side effects) + 0/1 a FUN_3F78.
 *
 * **MMIO**: nessuno.
 *
 * Verifica bit-perfect via `test-eeprom-commit-request-parity.ts` (500 casi).
 */

import type { GameState } from "./state.js";
import { eepromCommit } from "./eeprom-commit.js";

/** WorkRam offset di 0x401FF5 (RAM base 0x400000). */
const ACC_FF5_OFF = 0x1ff5;

/** WorkRam offset del long pointer @ 0x401FFC. */
const PTR_FFC_OFF = 0x1ffc;

/** RAM base. */
const WORK_RAM_BASE = 0x400000;

/** Soglia status oltre la quale FUN_3F3E ritorna 0. */
const STATUS_EXIT_THRESHOLD = 0xe0;

/** Moltiplicatore della scala finale (muls.w #0xC, D0). */
const SCALE_MUL = 0xc;

/**
 * Replica bit-perfect del helper interno `FUN_00003F3E` (rate query).
 *
 * Identica a `helperFun3F3E` in `eeprom-commit.ts` (chiamata diretta come
 * 1° JSR @ 0x3FD0): legge `*0x401FFC` (long big-endian) come puntatore,
 * valida lo status byte @ ptr+0xA contro il complement byte @ ptr+0xB,
 * e ritorna:
 *   - 0  se status >= 0xE0
 *   - (status & 3) + 1  altrimenti  (range 1..4)
 *
 * Solo lettura: nessun side effect su workRam.
 *
 * @param state  GameState (legge `state.workRam[0x1FFC..0x1FFF]` e i due
 *               byte puntati a +0xA/+0xB).
 * @returns      0 oppure 1..4.
 */
function helperFun3F3E(state: GameState): number {
  const r = state.workRam;

  const ptr =
    (((r[PTR_FFC_OFF] ?? 0) << 24) |
      ((r[PTR_FFC_OFF + 1] ?? 0) << 16) |
      ((r[PTR_FFC_OFF + 2] ?? 0) << 8) |
      (r[PTR_FFC_OFF + 3] ?? 0)) >>>
    0;
  const ptrOff = (ptr - WORK_RAM_BASE) >>> 0;

  let d2 = (r[ptrOff + 0xa] ?? 0) & 0xff;
  const notB = ~(r[ptrOff + 0xb] ?? 0) & 0xff;
  if (d2 !== notB) d2 = 0;

  if (d2 >= STATUS_EXIT_THRESHOLD) {
    return 0;
  }
  return (d2 & 3) + 1;
}

/**
 * Replica bit-perfect di `FUN_00003FC6`.
 *
 * Wrapper "consume / pace-check":
 * - chiama `FUN_3F3E` per ottenere il rate corrente (0 o 1..4) — nessun
 *   side effect;
 * - se `(arg.w * rate.w) low word == 0` -> ritorna 1 (path #1);
 * - altrimenti chiama `eepromCommit` (FUN_3F78, distruttiva) per ottenere
 *   il budget;
 * - se budget (long signed) < `signext(arg.w) * 12` -> ritorna 0 (path #2);
 * - altrimenti decrementa byte @ 0x401FF5 di `(arg.w * rate.w).b` modulo
 *   256 e ritorna 1 (path #3).
 *
 * @param state  GameState. Side effects: vedi commenti del modulo.
 * @param arg    Long (32-bit) come pushato dal caller; solo la low word
 *               (`arg & 0xFFFF`) viene letta. Il caller `FUN_472A` push
 *               sempre un long via `move.l Dx,-(SP)`.
 * @returns      D0 (long): 0 oppure 1.
 */
export function eepromCommitRequest(state: GameState, arg: number): number {
  const r = state.workRam;

  // D2.w = arg low word (move.w (0xE,SP),D2w).
  // D3.w = D2.w (move.w D2w,D3w). D3 high preservato (non osservabile dopo).
  const d2w = arg & 0xffff;
  const d3wInitial = d2w;

  // 1° JSR -> FUN_3F3E: rate query, NESSUN side effect.
  const rate = helperFun3F3E(state) & 0xffff;

  // mulu.w D0w,D3: D3.l = D3.w * D0.w (32-bit unsigned product).
  const d3l = ((d3wInitial * rate) >>> 0) & 0xffffffff;

  // move.w D3w,D3w; bne work: testa la low word del prodotto.
  if ((d3l & 0xffff) === 0) {
    // moveq #1, D0 -> ritorna 1. NESSUNA chiamata a FUN_3F78.
    return 1;
  }

  // 2° JSR -> FUN_3F78 (eepromCommit completo, drain+scale, modifica workRam).
  const budget = eepromCommit(state) >>> 0;

  // move.l D0,D1: D1 = budget (long).
  // move.w D2w,D0w: D0.w = arg.w (D0 alto = budget alto post-jsr).
  // ext.l D0: D0.l = signext(D0.w) = signext(arg.w).
  // muls.w #0xC,D0: D0.l = (int16)(arg.w) * 12 (signed long product).
  const argSignedW = (d2w & 0x8000) !== 0 ? d2w - 0x10000 : d2w;
  const d0Signed = (argSignedW * SCALE_MUL) | 0;

  // cmp.l D0,D1: flags = D1 - D0 (signed long compare).
  // budget e' sempre 0 <= budget <= 0x12C (300, da eepromCommit), quindi
  // signed == unsigned a livello di valore.
  const d1Signed = budget | 0;
  if (d1Signed < d0Signed) {
    // moveq #0, D0 -> ritorna 0. NESSUN ulteriore decremento.
    return 0;
  }

  // move.b D3b,D0b; sub.b D0b,(0x401FF5).l: byte @ 0x401FF5 -= D3.b modulo 256.
  const d3b = d3l & 0xff;
  const accOld = (r[ACC_FF5_OFF] ?? 0) & 0xff;
  r[ACC_FF5_OFF] = (accOld - d3b) & 0xff;

  // moveq #1, D0 -> ritorna 1.
  return 1;
}
