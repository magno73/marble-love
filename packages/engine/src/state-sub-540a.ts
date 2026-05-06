/**
 * state-sub-540a.ts — replica `FUN_0000540A` (94 byte, fino al `rts` @ 0x5466).
 *
 * Walker di "record di stringhe" su una struttura impacchettata variabile.
 * Scansiona fino a `D3` record contigui partendo da `A2`. Ogni record è
 * `[header_byte, str0\0, str1\0, ...]` dove il numero di stringhe varia in
 * funzione delle due nibble del header. La funzione restituisce in `D0`:
 *   - `0`         se al termine la coppia `byte[A2..A2+1]` è `00 00`
 *                 (terminatore-doppio della tabella, sentinel "end-of-list").
 *   - `A2`        (post-walk) altrimenti.
 * **Early-exit**: se all'inizio di un record la coppia `byte[A2..A2+1]` è
 * `00 00`, la funzione esce immediatamente senza decrementare `D3`.
 *
 * **Disasm 0x540A..0x5466** (94 byte / 0x5C):
 *
 *   0x540A:  movem.l {A2 D3 D2},-(SP)        ; preserve D2,D3,A2
 *   0x540E:  movea.l (0x10,SP),A2            ; A2 = arg1 (long ptr)
 *   0x5412:  move.w  (0x16,SP),D3w           ; D3w = arg2 (word count)
 *   0x5416:  bra.b   0x544A                  ; jump to outer-loop test
 *
 *   0x5418: outer_body:
 *   0x5418:    move.l A2,-(SP)
 *   0x541A:    jsr    0x53EA.l                ; D0 = byte[A2] | byte[A2+1]
 *   0x5420:    tst.l  D0
 *   0x5422:    addq.l #4,SP
 *   0x5424:    beq.w  0x544E                  ; if pair==00 → exit_path (no decrement)
 *   0x5428:    moveq  #1,D2                   ; D2 = 1
 *   0x542A:    move.b (A2),D0b                 ; D0b = byte[A2] (HEADER) — only low byte!
 *                                              ;   D0 high 24 bits restano da FUN_53EA
 *                                              ;   ma sono 0x000000 (output range 0..0xFF)
 *   0x542C:    lsr.b  #4,D0b                  ; D0b = header >> 4 (high nibble)
 *   0x542E:    addq.b #1,D0b                  ; D0b += 1
 *   0x5430:    move.b (A2)+,D1b               ; D1b = header; A2++
 *   0x5432:    andi.b #0xF,D1b                ; D1b = header & 0xF (low nibble)
 *   0x5436:    sub.b  D1b,D0b                 ; D0b = ((hdr>>4)+1) - (hdr&0xF)  byte sub
 *   0x5438:    asl.l  D0,D2                   ; D2 = 1 << (D0 mod 64)  (M68k asl.l)
 *                                              ;   D0 = 0x000000XX, X può essere 0..16
 *                                              ;   o 0xF2..0xFF (byte sub negativo). Il
 *                                              ;   conteggio effettivo è D0 mod 64.
 *   0x543A:    move.w D2w,D0w                 ; D0w = D2w (low word di D2)
 *   0x543C:    bra.b  0x5444                  ; jump to inner-loop test
 *
 *   0x543E: inner_body:
 *   0x543E:    tst.b  (A2)+                   ; A2++; setta Z flag su byte
 *   0x5440:    bne.b  0x543E                  ; loop finché byte != 0 (skip stringa)
 *                                              ; quando trova 0, A2 punta al byte
 *                                              ; successivo (post-incremento)
 *   0x5442:    subq.w #1,D0w                  ; D0w-- (decremento per altra stringa)
 *   0x5444: tst.w  D0w
 *   0x5446: bge.b  0x543E                     ; if D0w >= 0 (signed) → inner_body
 *
 *   0x5448:    subq.w #1,D3w                  ; D3w--
 *   0x544A: tst.w  D3w
 *   0x544C: bne.b  0x5418                     ; if D3w != 0 → outer_body
 *
 *   0x544E: exit_path:
 *   0x544E:    move.l A2,-(SP)
 *   0x5450:    jsr    0x53EA.l                ; D0 = byte[A2] | byte[A2+1]
 *   0x5456:    tst.l  D0
 *   0x5458:    addq.l #4,SP
 *   0x545A:    bne.b  0x5460
 *   0x545C:    moveq  #0,D0                   ; return 0  (pair==0 → end of table)
 *   0x545E:    bra.b  0x5462
 *   0x5460:    move.l A2,D0                   ; return A2 (advanced pointer)
 *   0x5462:    movem.l (SP)+,{D2 D3 A2}
 *   0x5466:    rts
 *
 * **FUN_0000053EA (callee, 32 byte)**:
 *
 *   move.l D2,-(SP)
 *   movea.l (0x8,SP),A0          ; A0 = arg ptr
 *   moveq  #0,D1
 *   move.b (A0),D1b              ; D1 = byte[A0]
 *   moveq  #0,D0
 *   move.b (A0)+,D0b             ; D0 = byte[A0]; A0++
 *   movea.l A0,A1                ; A1 = A0+1
 *   addq.l #1,A0                 ; A0 = A0+2
 *   moveq  #0,D2
 *   move.b (A1),D2b              ; D2 = byte[A1] = byte[A0_orig+1]
 *   or.l   D2,D0                 ; D0 = byte[A0_0] | byte[A0_0+1]
 *   or.l   D0,D1                 ; D1 = byte[A0_0] | byte[A0_0+1]
 *   move.l D1,D0
 *   move.l (SP)+,D2
 *   rts                          ; ritorna `byte[ptr] | byte[ptr+1]` (long, 0..0xFF)
 *
 * **Convenzione caller** (verificata @ 0x5e9a, 0x6066, 0x559e, tutti `cdecl`):
 *   - arg1 (long, push first / SP+12 dopo movem.l 12 byte) = A2 = pointer assoluto
 *     (M68k 24-bit) alla testa della tabella di record.
 *   - arg2 (word, esteso a long su stack / SP+0x16 word) = D3 = numero massimo
 *     di record da scansionare.
 *   - return D0 = `0` se tabella terminata da pair==0, altrimenti `A2` post-walk
 *     (puntatore al prossimo header non visitato).
 *   - D2, D3, A2 callee-saved (preserved/restored da movem.l).
 *
 * **Side effects**: solo lettura. Nessuna scrittura in memoria. La funzione
 * NON modifica lo stato, è un pure walker.
 *
 * **Modellazione bit-perfect** delle sottigliezze M68k:
 *
 *   1. **`move.b (A2),D0b` con D0 high-bits da FUN_53EA**: l'output di
 *      FUN_53EA è `byte[A2]|byte[A2+1]`, range 0..0xFF (long). I `move.b ... D0b`
 *      successivi modificano SOLO il low byte. `lsr.b`, `addq.b`, `sub.b` operano
 *      su D0b. Quindi alla fine D0 = `0x000000XX` con XX = ((hdr>>4)+1 - (hdr&0xF))
 *      modulo 256 (byte sub wrap). Il `asl.l D0,D2` legge D0 long ma usa solo
 *      il count mod 64 (cioè `D0 & 0x3F`).
 *
 *   2. **`asl.l Dn,Dm` semantics**: count = `Dn & 63`. Per shift count >= 32 il
 *      valore long viene completamente azzerato. JS `<<` masca a 5 bit, quindi
 *      serve guard `count >= 32 ? 0 : (1 << count)`.
 *
 *   3. **`move.w D2w,D0w`**: copia low word di D2 in low word di D0. D0 high
 *      word è 0 (D0 era 0x000000XX), quindi dopo: D0 = `0x0000YYYY` con YYYY =
 *      D2 & 0xFFFF.
 *
 *   4. **`tst.w D0w; bge.b ...`**: bge testa `N` flag (signed). D0w come signed
 *      word: bit 15 set → negativo. Per D2 con count=15 (`1<<15 = 0x8000`), D0w
 *      è -32768 → bge fallisce → loop body **skipped**. Per count=14 (`0x4000`),
 *      D0w = 16384 positivo → loop body eseguito 16385 volte (D0w decrementa
 *      fino a -1). Per count=16 (`0x10000` & 0xFFFF = 0), D0w = 0 → bge passa →
 *      body 1 volta poi -1 → exit.
 *
 *   5. **Inner body `tst.b (A2)+; bne 543E`**: skip un null-terminated stringa.
 *      A2 viene incrementato finché trova un byte 0 (incluso), poi cade fuori.
 *      Questo legge la "string". Se la stringa è zero-byte (cioè byte[A2]==0
 *      all'ingresso del body), A2 avanza di 1.
 *
 *   6. **Outer test `subq.w #1,D3w; tst.w D3w; bne ...`**: equivalente a
 *      `do { body } while (--D3 != 0)`. Per D3=0 iniziale: il primo `tst.w D3w`
 *      @ 0x544A trova 0 → fall through senza eseguire mai il body. Per D3=1:
 *      una iterazione body, poi D3w=0 → exit. Per D3=N: N iterazioni.
 *      ATTENZIONE: il path è entrato via `bra 0x544A`, quindi il PRIMO check è
 *      `tst.w D3w` PRE-decremento. D3=0 → 0 iter; D3=1 → 1 iter (body, poi
 *      decrement, poi test fallisce, exit). D3=0xFFFF → 65535 iter (potenziale
 *      runaway, il caller deve passare valori sani).
 *
 *   7. **Early exit**: dentro il body, se `byte[A2]|byte[A2+1] == 0` esce
 *      direttamente senza decrementare D3 (vedi `beq.w 0x544E`). L'A2 al momento
 *      dell'early-exit è quello passato (non ancora avanzato dal record).
 *
 *   8. **Return value**: il path 0x544E rilegge byte[A2]|byte[A2+1] e ritorna
 *      0 se è zero, altrimenti A2 (assoluto M68k 24-bit). Per i caller di FUN_540A
 *      questo serve a distinguere "tabella terminata" vs "abbiamo D3 record validi
 *      consumati" — in quest'ultimo caso A2 è il prossimo header da processare.
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-540a-parity.ts`.
 */

import type { GameState } from "./state.js";

/** WORK RAM base assoluta M68k (le tabelle sono caricate qui dai loader). */
const WORK_RAM_BASE = 0x400000;
/** Limite superiore esclusivo workRam (0x400000 + 0x2000). */
const WORK_RAM_END = 0x402000;

/**
 * Helper interno: replica `FUN_0000053EA` (read-byte-pair OR).
 *
 * Legge `byte[ptr]` e `byte[ptr+1]` e ritorna il loro OR come long unsigned.
 * Esposto per testabilità isolata.
 *
 * @param state  GameState (workRam letto, non scritto).
 * @param ptr    Pointer assoluto M68k (long). Se fuori workRam ritorna 0
 *               (i byte assenti vengono trattati come 0, semantica difensiva
 *               coerente con `r[idx] ?? 0` del resto del codebase).
 * @returns      `(byte[ptr] | byte[ptr+1]) >>> 0`, range `0..0xFF`.
 */
export function fun53EA(state: GameState, ptr: number): number {
  const r = state.workRam;
  const ptrU = ptr >>> 0;
  const off0 = (ptrU - WORK_RAM_BASE) >>> 0;
  const off1 = (ptrU + 1 - WORK_RAM_BASE) >>> 0;
  const b0 =
    ptrU >= WORK_RAM_BASE && ptrU < WORK_RAM_END
      ? (r[off0] ?? 0) & 0xff
      : 0;
  const b1 =
    ptrU + 1 >= WORK_RAM_BASE && ptrU + 1 < WORK_RAM_END
      ? (r[off1] ?? 0) & 0xff
      : 0;
  return (b0 | b1) >>> 0;
}

/**
 * Risultato della scansione (replica del valore restituito in D0).
 *
 * - `0`            tabella terminata da pair `00 00` (sentinel end-of-list).
 *                  Replica esatto valore long M68k 0x00000000.
 * - `A2`           pointer assoluto M68k (24-bit address) al prossimo header
 *                  non ancora processato. Range tipico: `0x400000..0x401FFF`.
 *                  Replica del valore long M68k.
 *
 * In TS è semplicemente un `number` unsigned 32-bit (long).
 */
export type StateSub540AResult = number;

/**
 * Replica `FUN_0000540A` — table-of-string-records walker.
 *
 * Vedi disasm e semantica nell'header del file.
 *
 * @param state  GameState (workRam letto, non scritto). La funzione è pure-read.
 * @param a2     Pointer assoluto M68k (long). Punta alla testa di un record
 *               (header byte + string-list). Deve puntare in workRam
 *               (`0x400000..0x401FFF`) per i caller noti; se out-of-range, i
 *               byte vengono letti come 0 (semantica difensiva uniforme col
 *               resto del codebase).
 * @param d3     Numero massimo di record da scansionare (interpretato come
 *               word, range `0..0xFFFF`). Se `0` la funzione fa solo il check
 *               finale del pair e ritorna senza scansionare alcun record.
 *
 * @returns      `0` se al termine `byte[A2]|byte[A2+1] == 0`, altrimenti
 *               `A2` post-walk (long unsigned 32-bit, address M68k).
 *
 * **Modellazione bit-perfect** (vedi note dettagliate nell'header file):
 *   - byte sub wrap: `((hdr>>4)+1 - (hdr&0xF)) & 0xFF` → range
 *     `[0..16] ∪ [0xF2..0xFF]`.
 *   - asl.l count mod 64: per byte 0xF2..0xFF → count 50..63 → result 0.
 *   - asl.l count >= 32: result 0 (i bit "escono" dal long).
 *   - tst.w D0w bge: signed-word test; D0w = 0x8000 → negativo → skip body.
 *   - inner body: legge byte sequenziali finché trova 0 (skip null-string).
 *   - early exit dentro body: pair==0 → exit immediato senza decrementare D3.
 *
 * **Safety guards** per input pathologici (D3 grande, header che produce
 * shift=14 → 16385 inner iterazioni): aggiunti contatori di sicurezza per
 * evitare loop infiniti su input rotti. Il binario in produzione non
 * dovrebbe mai colpirli (le tabelle sono ben formate).
 */
export function stateSub540A(
  state: GameState,
  a2: number,
  d3: number,
): StateSub540AResult {
  const r = state.workRam;
  let a2Cur = a2 >>> 0;
  let d3w = d3 & 0xffff;

  // Helper inline: read byte assoluto M68k → workRam offset.
  const read8 = (addr: number): number => {
    const a = addr >>> 0;
    if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
    return (r[a - WORK_RAM_BASE] ?? 0) & 0xff;
  };

  // ── Outer loop ────────────────────────────────────────────────────────
  // M68k path: bra 0x544A; tst.w D3w; bne → 0x5418 (body); else fallthrough.
  // Quindi se D3=0 entrante salta direttamente al exit_path.
  let outerSafety = 0x10000; // max 65536 iter (matches D3w word range)
  while (d3w !== 0 && outerSafety-- > 0) {
    // body @ 0x5418

    // 0x541A: jsr 53EA — D0 = byte[A2] | byte[A2+1]
    // 0x5424: beq.w 0x544E — early-exit se pair==0
    if (fun53EA(state, a2Cur) === 0) {
      // exit_path con A2 corrente (pair già verificato == 0 → ritorna 0)
      return 0 >>> 0;
    }

    // 0x5428..0x5436: calcola shift = ((hdr>>4)+1) - (hdr&0xF), byte sub.
    const hdr = read8(a2Cur);
    a2Cur = (a2Cur + 1) >>> 0; // move.b (A2)+,D1b → A2++

    const hi = (hdr >>> 4) & 0xf;
    const lo = hdr & 0xf;
    // byte sub: ((hi+1) - lo) modulo 256 (high bits di D0 sono 0).
    const shiftByte = ((hi + 1 - lo) & 0xff) >>> 0;
    // D0 long = 0x000000 | shiftByte. asl.l count = D0 & 63 = shiftByte & 63.
    const shiftCount = shiftByte & 0x3f;
    // D2 = 1 << shiftCount. Per shiftCount >= 32 → 0.
    let d2Long: number;
    if (shiftCount >= 32) {
      d2Long = 0;
    } else {
      d2Long = ((1 << shiftCount) >>> 0) >>> 0;
    }
    // 0x543A: move.w D2w,D0w → D0w = D2 & 0xFFFF (D0 high word resta 0).
    let d0w = d2Long & 0xffff; // unsigned word

    // 0x543C: bra 0x5444 — first check is tst.w D0w, bge.
    // bge tests signed: 0x8000..0xFFFF (signed -32768..-1) → fall through.
    // 0x0000..0x7FFF (signed 0..32767) → branch to body.
    let innerSafety = 0x10000; // max 65536 inner iter
    while (innerSafety-- > 0) {
      // bge: if (signedWord(d0w) >= 0) execute body else exit.
      const d0wSigned = d0w >= 0x8000 ? d0w - 0x10000 : d0w;
      if (d0wSigned < 0) break;

      // inner body @ 0x543E: tst.b (A2)+; bne 0x543E — skip null-terminated string.
      // Avanza A2 finché trova un byte 0 (incluso il terminatore).
      let strSafety = 0x10000; // max 65536 byte per string
      while (strSafety-- > 0) {
        const b = read8(a2Cur);
        a2Cur = (a2Cur + 1) >>> 0;
        if (b === 0) break;
      }

      // 0x5442: subq.w #1,D0w → D0w-- (word decrement, wrap mod 65536)
      d0w = (d0w - 1) & 0xffff;
    }

    // 0x5448: subq.w #1,D3w
    d3w = (d3w - 1) & 0xffff;
    // 0x544A: tst.w D3w; bne 0x5418 — loop condition tested top.
  }

  // ── exit_path @ 0x544E ────────────────────────────────────────────────
  // jsr 53EA; if pair==0 return 0 else return A2.
  const finalPair = fun53EA(state, a2Cur);
  if (finalPair === 0) return 0 >>> 0;
  return a2Cur >>> 0;
}
