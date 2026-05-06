/**
 * eeprom-commit.ts — replica `FUN_00003F78` (78 byte) bit-perfect.
 *
 * **NOMENCLATURA**: Il commento nel `main-tick.ts` etichetta questa funzione
 * come "EEPROM commit/check tick" perche' viene chiamata via thunk 0x160 dal
 * mainTick (FUN_28788). In realta', leggendo il codice, NON tocca alcun
 * indirizzo MMIO o EEPROM: e' una *sub di output pacing audio/effetti* che
 * agisce sui contatori di sound dispatch (`0x401FF5/F7`) e sul player struct
 * puntato da `*0x401FFC` (gli stessi accessi di `sound-dispatch-send.ts`).
 * Il nome del file rimane `eeprom-commit` per coerenza col commento del
 * main-tick (etichetta originale dal disasm), ma la semantica e' "scale a
 * pacing counter into a 0..C scaled output".
 *
 * **Disasm 0x3F78..0x3FC5** (78 byte):
 *
 *   move.l  A2,-(SP)
 *   movea.l #0x401FF5,A2
 *   jsr     FUN_3F3E              ; helper interno (vedi sotto)
 *   move.w  D0w,D1w
 *   bne     work                  ; D1.w == 0  -> early exit
 *   moveq   #0x18,D0              ;             return 0x18 (24)
 *   bra     done
 * work:
 * loop:
 *   moveq   #0,D0
 *   move.b  (0x401FF7).l,D0b      ; D0 = byte zero-ext
 *   cmp.w   D1w,D0w               ; D0.w < D1.w (unsigned) -> exit
 *   bcs     after_loop
 *   move.b  D1b,D0b
 *   sub.b   D0b,(0x401FF7).l      ; *0x401FF7 -= D1.b
 *   move.b  D1b,D0b
 *   add.b   D0b,(A2)              ; *0x401FF5 += D1.b
 *   bra     loop
 * after_loop:
 *   cmpi.b  #0x19,(A2)            ; *0x401FF5 > 0x19 ?
 *   bls     skip_clamp            ; <=0x19 ok
 *   move.b  #0x19,(A2)            ; clamp to 0x19
 * skip_clamp:
 *   moveq   #0,D0
 *   move.b  (A2),D0b              ; D0 = *0x401FF5 (0..0x19)
 *   muls.w  #0xC,D0               ; D0.l = D0.w * 12 (signed)
 *   divs.w  D1w,D0                ; D0.l = quotient(low) | rem(high), signed
 *   move.w  D0w,D1w               ; D1.w = quotient
 *   moveq   #0,D0
 *   move.w  D1w,D0w               ; D0 = quotient zero-ext long
 * done:
 *   movea.l (SP)+,A2
 *   rts
 *
 * **Helper FUN_3F3E** (chiamata interna, unica `JSR`):
 *
 *   move.l  D2,-(SP)
 *   move.l  (0x401FFC).l,D1       ; D1 = *0x401FFC = ptr struct (player)
 *   movea.l D1,A0
 *   adda.l  #0xA,A0
 *   move.b  (A0),D2b              ; D2.b = *(ptr + 0xA)
 *   movea.l D1,A0
 *   adda.l  #0xB,A0
 *   move.b  (A0),D0b
 *   not.b   D0b                   ; D0.b = ~*(ptr + 0xB)
 *   cmp.b   D0b,D2b               ; complement check
 *   beq     ok
 *   clr.b   D2b                   ; mismatch -> D2.b = 0
 * ok:
 *   cmpi.b  #-0x20,D2b            ; D2.b < 0xE0 unsigned ?
 *   bcs     small
 *   moveq   #0,D0                 ; D2.b >= 0xE0 -> return 0
 *   bra     ret
 * small:
 *   moveq   #0,D1
 *   move.b  D2b,D1b
 *   moveq   #3,D0
 *   and.l   D0,D1                 ; D1 = D2.b & 3
 *   addq.l  #1,D1                 ; D1 = (D2.b & 3) + 1   (1..4)
 *   move.l  D1,D0
 * ret:
 *   move.l  (SP)+,D2
 *   rts
 *
 * **Riassunto del helper**: dato il byte status @ ptr+0xA (con verifica di
 * complement contro ptr+0xB; se mismatch -> status = 0), ritorna:
 *   - 0  se status >= 0xE0
 *   - (status & 3) + 1  altrimenti  (range 1..4)
 *
 * **Comportamento totale**:
 *   - Se helper ritorna 0 (status >= 0xE0): ritorna 0x18, lascia
 *     0x401FF5/F7 invariati.
 *   - Altrimenti D1 = 1..4. Drena 0x401FF7 in step da D1, accumulando
 *     in 0x401FF5; clampa 0x401FF5 a 0x19; ritorna (0x401FF5 * 12) / D1.
 *
 * **JSR interne**: 1 sola, FUN_3F3E (helper inline qui sotto).
 *
 * **MMIO**: nessuno. Solo workRam @ 0x401FFC, 0x401FF5, 0x401FF7, e bytes a
 * (*0x401FFC) + 0xA / +0xB.
 *
 * **Side effects sulla workRam**:
 *   - 0x401FF5: aggiornato (drain accumulator, clamped a 0x19) o invariato
 *   - 0x401FF7: aggiornato (drain counter) o invariato
 *
 * Verifica bit-perfect via `test-eeprom-commit-parity.ts` (500 casi).
 */

import type { GameState } from "./state.js";

/** WorkRam offsets (RAM base 0x400000). */
const ACC_FF5_OFF = 0x1ff5; // (A2) — accumulator drained-from-FF7
const COUNTER_FF7_OFF = 0x1ff7; // drain source counter
const PTR_FFC_OFF = 0x1ffc; // long pointer to player struct

/** RAM base (per convertire ptr assoluti a workRam offsets). */
const WORK_RAM_BASE = 0x400000;

/** Soglia status sopra la quale il helper ritorna 0 (early exit). */
const STATUS_EXIT_THRESHOLD = 0xe0;

/** Cap superiore di 0x401FF5 dopo il drain. */
const ACC_CLAMP_MAX = 0x19;

/** Moltiplicatore della scala finale (muls.w #0xC). */
const SCALE_MUL = 0xc;

/** Early-exit return value quando il helper torna 0. */
const EARLY_EXIT_RESULT = 0x18;

/**
 * Replica bit-perfect del helper interno `FUN_00003F3E`.
 *
 * Legge `*0x401FFC` (long big-endian) come puntatore, ne valida lo status
 * byte @ ptr+0xA contro il complement byte @ ptr+0xB, e ritorna:
 *   - 0  se status >= 0xE0  (caller usera' questo valore per un early exit)
 *   - (status & 3) + 1  altrimenti  (range 1..4)
 *
 * Solo lettura: nessun side effect sulla workRam.
 *
 * @param state  GameState (legge `state.workRam[0x1FFC..0x1FFF]` e i due
 *               byte puntati a +0xA/+0xB).
 * @returns      0 oppure 1..4.
 */
function helperFun3F3E(state: GameState): number {
  const r = state.workRam;

  // D1 = *(0x401FFC) (long, big-endian).
  const ptr =
    (((r[PTR_FFC_OFF] ?? 0) << 24) |
      ((r[PTR_FFC_OFF + 1] ?? 0) << 16) |
      ((r[PTR_FFC_OFF + 2] ?? 0) << 8) |
      (r[PTR_FFC_OFF + 3] ?? 0)) >>>
    0;
  const ptrOff = (ptr - WORK_RAM_BASE) >>> 0;

  // D2.b = *(ptr + 0xA); D0.b = ~*(ptr + 0xB)
  let d2 = (r[ptrOff + 0xa] ?? 0) & 0xff;
  const notB = ~(r[ptrOff + 0xb] ?? 0) & 0xff;
  // cmp.b D0b, D2b; beq keep else clr.b D2b
  if (d2 !== notB) d2 = 0;

  // cmpi.b #-0x20 (= 0xE0), D2b; bcs small (D2.b < 0xE0 unsigned)
  if (d2 >= STATUS_EXIT_THRESHOLD) {
    return 0;
  }
  // D1 = (D2.b & 3) + 1
  return (d2 & 3) + 1;
}

/**
 * Replica bit-perfect di `FUN_00003F78`.
 *
 * Chiamata via thunk 0x160 dal `mainTick` (slot #10). NON tocca MMIO ne'
 * EEPROM (nonostante il nome): e' una sub di pacing dei contatori sound
 * dispatch che converte un counter accumulato (0..0x19) in una scala
 * proporzionale al "rate" derivato dallo status byte del player struct.
 *
 * Convenzione: nessun argomento (legge tutto da workRam globals). Ritorna
 * D0 (long, ma sempre 0..0xFF nel range pratico):
 *   - 0x18 (24)  se il helper FUN_3F3E ritorna 0 (status >= 0xE0)
 *   - (clampedAcc * 12) / divisor  altrimenti  (0..300/1=300, ma di norma <=12)
 *
 * @param state  GameState. Legge:
 *   - `*0x401FFC` (long ptr) e bytes a ptr+0xA/+0xB
 *   - `0x401FF5` (acc), `0x401FF7` (drain counter)
 *
 *   Modifica (solo nel path "work"):
 *   - `0x401FF7` -= n*divisor   (drain)
 *   - `0x401FF5` += n*divisor   (accumula, poi clamp a 0x19)
 *
 *   Nel path early-exit (helper=0): NESSUNA modifica alla workRam.
 *
 * @returns  D0 (long). 0x18 nel path early-exit; quoziente word zero-extended
 *           altrimenti.
 */
export function eepromCommit(state: GameState): number {
  const r = state.workRam;

  // jsr FUN_3F3E -> D0 = ritorno helper; D1.w = D0.w.
  const helperRet = helperFun3F3E(state) & 0xffff;

  // bne work: se D1.w == 0 -> early exit con 0x18.
  // (D1 e' 0 solo quando il helper ha rilevato status >= 0xE0; in tal caso
  //  NON facciamo touch su 0x401FF5 ne' su 0x401FF7.)
  if (helperRet === 0) {
    return EARLY_EXIT_RESULT;
  }

  // D1.w in [1..4] qui per costruzione del helper.
  const divisor = helperRet; // alias semantico

  // Drain loop:
  //   while (byte@0x401FF7 >= divisor.w unsigned):
  //     byte@0x401FF7 -= divisor.b
  //     byte@0x401FF5 += divisor.b
  //
  // Note bit-perfect:
  //   - sub.b D0b, (0x401FF7).l: la sub e' BYTE, quindi modula 256. In
  //     pratica byte@0x401FF7 era >= divisor (1..4), quindi nessun underflow
  //     ai casi che ci interessano. Ma per parita' totale rispettiamo
  //     comunque il modulo 256.
  //   - add.b D0b, (A2): idem, modulo 256. byte@0x401FF5 puo' fare wrap se
  //     parte da valore alto, ma poi viene clampato a 0x19 dopo il loop.
  //   - cmp.w D1w, D0w (D0 word, divisor word, entrambi positivi piccoli):
  //     uscita quando D0.w < divisor.w.
  let counter = (r[COUNTER_FF7_OFF] ?? 0) & 0xff; // byte zero-ext word
  let acc = (r[ACC_FF5_OFF] ?? 0) & 0xff; // byte
  while (counter >= divisor) {
    counter = (counter - divisor) & 0xff; // sub.b
    acc = (acc + divisor) & 0xff; // add.b (wrap byte)
  }
  // Persisti i contatori aggiornati (anche se 0 iterazioni: scriviamo lo
  // stesso valore; comportamento equivalente al binario che avrebbe scritto
  // solo dopo almeno 1 iter — ma se 0 iter byte non cambia, nessun delta).
  r[COUNTER_FF7_OFF] = counter;
  r[ACC_FF5_OFF] = acc;

  // Clamp acc a 0x19 (cmpi.b + bls + move.b #0x19,(A2)).
  if (acc > ACC_CLAMP_MAX) {
    acc = ACC_CLAMP_MAX;
    r[ACC_FF5_OFF] = acc;
  }

  // D0 = acc zero-ext long; muls.w #0xC (signed). acc e' 0..0x19 (positivo)
  // -> D0.l = acc * 12 = 0..300, fits signed 16-bit.
  const product = (acc * SCALE_MUL) | 0;

  // divs.w divisor.w, D0: quotient signed-16 in D0.w. Operandi positivi e
  // |quotient| <= 300/1 = 300 < 32768 -> niente overflow, niente segno.
  // Math.trunc per dividere come "signed integer division" (dividendo
  // positivo: trunc == floor).
  const quotient = Math.trunc(product / divisor) & 0xffff;

  // moveq #0,D0; move.w D1w,D0w -> D0 = quotient zero-ext long.
  return quotient >>> 0;
}
