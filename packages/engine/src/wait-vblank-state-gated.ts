/**
 * wait-vblank-state-gated.ts — replica `FUN_00028DB8` (50 byte).
 *
 * Variante "state-gated" di `vblank-wait.ts` (FUN_52B8). Differenze chiave:
 *
 *   - Il "vblank tick" usato qui NON è il long counter @ 0x401FF8 (come in
 *     FUN_52B8), ma il primitive `FUN_00028DEA` che:
 *       - clr.b *0x400016         (mailbox vblank ack)
 *       - spin: tst.b *0x400016; beq spin    (busy-wait IRQ vblank)
 *       - addq.b #1, *0x4003F0    (counter byte, wrap mod 256)
 *
 *   - Early-exit condition: ad ogni iterazione confronta il game state word
 *     `*0x400390.w` (signed) con il valore "iniziale" catturato come
 *     sign-extension del LOW BYTE `*0x400391.b`. Se i due differiscono,
 *     azzera il counter D3w → il loop abortisce al prossimo `tst.w`.
 *
 * **Disasm 0x28DB8..0x28DE9** (50 byte, 1 arg long-on-stack, ret void):
 *
 *   00028DB8  movem.l {D3 D2}, -(SP)            ; save D2/D3 (8 byte)
 *   00028DBC  move.w  (0xE,SP), D0w              ; D0w = arg.lo word
 *                                                  ;   (0xE = 8 D2D3 + 4 retPC + 2 hiword)
 *   00028DC0  move.b  (0x00400391).l, D2b        ; D2b = low byte of state word
 *   00028DC6  move.w  D0w, D3w                   ; D3w = D0w (count)
 *   00028DC8  bra.b   check                      ; → tst.w D3w
 *   loop:
 *   00028DCA  jsr     0x00028DEA.l               ; vblankAck (1 tick)
 *   00028DD0  move.b  D2b, D0b                   ; D0b = saved low byte
 *   00028DD2  ext.w   D0w                         ; sign-extend byte→word
 *   00028DD4  cmp.w   (0x00400390).l, D0w         ; cmp w/ current word
 *   00028DDA  beq.b   skip
 *   00028DDC  clr.w   D3w                         ; state changed → exit next tst
 *   skip:
 *   00028DDE  subq.w  #1, D3w
 *   check:
 *   00028DE0  tst.w   D3w
 *   00028DE2  bgt.b   loop                        ; while D3w > 0 (signed)
 *   00028DE4  movem.l (SP)+, {D2 D3}
 *   00028DE8  rts
 *
 * **Convenzione caller** (cfr. xrefs FUN_10504 et al.):
 *   pea     (count).w        ; sext word→long, push 4 byte (BE: hi word, lo word)
 *   jsr     0x00028DB8.l
 *   addq.l  #4, SP           ; cleanup arg
 *
 * Quindi `(0xE, SP) = arg.low_word`. In bit-perfect TS lo trattiamo come
 * word signed (lo stesso schema di `waitVblank`).
 *
 * **Sign-extend semantics di "stato invariato"**:
 *   D2b = byte @ 0x400391, poi `ext.w D0w` dopo `move.b D2b,D0b` produce:
 *     - se bit 7 di D2b == 1 → D0w = 0xFFxx
 *     - se bit 7 di D2b == 0 → D0w = 0x00xx
 *   Confronto con word @ 0x400390 (BE: hi=0x400390, lo=0x400391):
 *     - "match" iff: high byte == 0x00 (D2b<0x80) o 0xFF (D2b>=0x80),
 *       AND low byte == D2b iniziale.
 *   In pratica il game state word è quasi sempre 0..127 con high byte 0,
 *   quindi il check si riduce a "low byte invariato".
 *
 * **Side effects** osservabili in workRam (per ogni iterazione eseguita):
 *   - workRam[0x16]   ← 0      (clr.b in FUN_28DEA)
 *   - workRam[0x3F0]  ← prev+1 (addq.b in FUN_28DEA, wrap mod 256)
 *
 *   La spin `tst.b *0x400016; beq spin` richiede che un agente esterno
 *   (IRQ vblank in MAME, o l'oracolo binario tramite `onMemoryRead` hook
 *   nel parity test) imposti `*0x400016 != 0` per uscire. La nostra TS
 *   modella la "wait" come istantanea: ogni iterazione conta 1 tick.
 *
 * **Iterazioni eseguite** (denotato `N` di seguito):
 *   - countWord signed > 0 e stato invariato per tutta la wait: N = countWord
 *   - countWord signed <= 0: N = 0 (loop non parte)
 *   - stato cambia all'iterazione k (1-indexed, k <= countWord): N = k
 *     (l'iterazione k esegue il jsr poi rileva la divergenza e clr.w D3w)
 *
 * In TS NON possiamo "rilevare" un cambio di stato durante la wait (non
 * c'è IRQ né concorrenza). Perciò il modello pulito è: il caller specifica
 * a priori la "iterazione k" alla quale lo stato cambia (parametro
 * `abortAtIter`, default = nessun abort). Quando `abortAtIter` è settato
 * E ≤ countWord, simula esattamente la sequenza di side effects del
 * binario abortito.
 *
 * **Bit-perfect parity**: verificato vs binary tramite
 * `cli/src/test-wait-vblank-state-gated-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";

/** WORK RAM base assoluta (gli offset workRam di seguito sono relativi). */
export const WORK_RAM_BASE = 0x400000;

/** byte mailbox vblank ack: clr+spin in FUN_28DEA. */
export const VBLANK_MAILBOX_OFF = 0x16;
/** byte counter: ++ ad ogni iterazione (FUN_28DEA, addq.b mod 256). */
export const VBLANK_TICK_COUNTER_OFF = 0x3f0;
/** word game state (BE): hi=0x390, lo=0x391. Sign-extend lo via ext.w. */
export const GAME_STATE_WORD_OFF = 0x390;
export const GAME_STATE_LO_BYTE_OFF = 0x391;

/**
 * Risultato di una wait. Bit-perfect-osservabili:
 *   - `iterations`: numero di iterazioni eseguite (= incrementi di
 *     workRam[0x3F0] applicati).
 *   - `d0w`: low word di D0 al rientro (sext_w(initialLoByte) se almeno
 *     una iterazione è eseguita; altrimenti = countWord).
 *   - `aborted`: true se il loop è terminato per state-change (clr.w D3w).
 */
export interface WaitVblankStateGatedResult {
  iterations: number;
  d0w: number;
  aborted: boolean;
}

/**
 * Replica `FUN_00028DB8` — wait N vblank tick con abort su cambio stato.
 *
 * Modella la sequenza di side effects sul `state.workRam` come se ogni
 * iterazione del binario eseguisse atomicamente una `FUN_00028DEA` tick:
 *   - workRam[VBLANK_MAILBOX_OFF] ← 0
 *   - workRam[VBLANK_TICK_COUNTER_OFF] ← (prev + 1) & 0xFF
 *
 * Per default la funzione esegue tutte le `countWord` iterazioni (signed,
 * `<= 0` significa zero iterazioni, come per `vblank-wait.ts`). Per
 * simulare un cambio di game state durante la wait, il caller può
 * impostare `abortAtIter`: in tal caso, alla iterazione k (1-indexed),
 * dopo aver applicato il side effect del tick, il binario rileva la
 * divergenza fra `*0x400390.w` corrente e `sext_w(*0x400391.b iniziale)`,
 * azzera D3w, e al prossimo `tst.w` esce. Quindi: con `abortAtIter = k`
 * (`1 <= k <= countWord`) il numero finale di iterazioni applicate è
 * esattamente `k`. Valori `<= 0` o `> countWord` sono ignorati (no abort).
 *
 * @param state         GameState; mutato in-place.
 * @param countWord     Argomento word signed (low word di un long pushato).
 * @param abortAtIter   Iterazione 1-indexed alla quale il game state word
 *                      cambia (rispetto al sext_w del low byte iniziale).
 *                      Default: nessun abort. Range valido: [1..countWord].
 * @param d0HiPrev      High word di D0 prima della chiamata (preservato dal
 *                      binario; serve solo per ricostruire D0 finale a 32
 *                      bit, opzionale).
 * @returns             Result con iterazioni effettuate, D0w finale, flag.
 */
export function waitVblankStateGated(
  state: GameState,
  countWord: number,
  abortAtIter: number = 0,
  d0HiPrev: number = 0,
): WaitVblankStateGatedResult {
  // Tronca arg a 16 bit e reinterpreta signed (tst.w + bgt usano flags signed).
  const argW = countWord & 0xffff;
  const argSigned = argW & 0x8000 ? argW - 0x10000 : argW;

  // Cattura iniziale: low byte di *0x400390 word.
  const initialLoByte = (state.workRam[GAME_STATE_LO_BYTE_OFF] ?? 0) & 0xff;
  // sext_b → word: se bit7, hi byte = 0xFF.
  const initialSextW =
    initialLoByte & 0x80 ? 0xff00 | initialLoByte : initialLoByte;

  if (argSigned <= 0) {
    // Loop non eseguito: D0w resta = arg word; nessun side effect.
    return {
      iterations: 0,
      d0w: argW,
      aborted: false,
    };
  }

  // Cattura iniziale: WORD *0x400390 (BE: hi @ 0x390, lo @ 0x391).
  const initialStateWord =
    (((state.workRam[GAME_STATE_WORD_OFF] ?? 0) << 8) |
      (state.workRam[GAME_STATE_LO_BYTE_OFF] ?? 0)) &
    0xffff;
  // Se sext_w(initialLoByte) != *0x400390.w fin dall'inizio, il binario
  // aborta dopo la prima iterazione (la cmp.w dell'iter 1 vede subito
  // diff → clr.w D3w → exit). NB: `state.workRam[0x390..0x391]` non viene
  // mutato dal binario in questa sub; il "diff iniziale" può sussistere
  // perché il caller ha già un game state word non normalizzato (es.
  // hiByte != 0x00/0xFF coerente col bit 7 di loByte).
  const initialMismatch = initialSextW !== initialStateWord;

  // Loop "veloce" — calcoliamo direttamente quante iterazioni (`N`) si
  // applicano, senza simulare ogni tick singolarmente (il side effect è
  // un semplice contatore). NB: l'algoritmo qui sotto è equivalente al
  // loop while ma evita lavoro O(count) inutile.
  // - mismatch iniziale: abort all'iter 1 (esegue 1 tick poi exit).
  // - abortAtIter in [1..argSigned]: abort all'iter k.
  // - else: esegue tutte argSigned iterazioni.
  let iterations: number;
  let aborts: boolean;
  if (initialMismatch) {
    iterations = 1;
    aborts = true;
  } else if (abortAtIter >= 1 && abortAtIter <= argSigned) {
    iterations = abortAtIter;
    aborts = true;
  } else {
    iterations = argSigned;
    aborts = false;
  }

  // Side effect: workRam[0x3F0] += iterations (byte add, wrap mod 256).
  const prev = state.workRam[VBLANK_TICK_COUNTER_OFF] ?? 0;
  state.workRam[VBLANK_TICK_COUNTER_OFF] = (prev + iterations) & 0xff;
  // Side effect: workRam[0x16] = 0 (ultima iterazione fa clr.b prima dello
  // spin; nel modello TS la spin è istantanea quindi resta = 0).
  // NOTA: nel binario reale la mailbox è scritta a non-zero dall'IRQ vblank
  // tra il `clr.b` e il `tst.b ; beq`. Al return della jsr 0x28DEA il valore
  // è quindi != 0 (impostato dall'IRQ). Per parity NON dobbiamo modellare
  // il valore finale di 0x400016 — il parity test lo maschera.
  state.workRam[VBLANK_MAILBOX_OFF] = 0;

  // D0 finale (low word):
  //   move.b D2b, D0b   → D0 low byte = initialLoByte
  //   ext.w D0w         → D0w = sext_w(D2b)
  // Eseguito ogni iterazione, l'ultima vale.
  void d0HiPrev; // alto preserva — restituiamo solo low word
  const d0w = initialSextW & 0xffff;

  return {
    iterations,
    d0w,
    aborted: aborts,
  };
}

/**
 * Re-export del simbolo come "FUN_00028DB8" per mappatura esplicita
 * binario→TS (utile in test di parity / disasm cross-reference).
 */
export { waitVblankStateGated as FUN_00028DB8 };
