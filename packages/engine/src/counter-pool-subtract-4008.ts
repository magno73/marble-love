/**
 * counter-pool-subtract-4008.ts — replica `FUN_00004008` (80 byte) bit-perfect.
 *
 * Sub di "consume" su una coppia di contatori sound-dispatch (drain counter
 * @ `0x401FF7` + accumulator @ `0x401FF5`). Tenta di sottrarre `arg1` byte
 * dal pool combinato (`counter + acc`), drenando prima il counter e poi
 * scalando il resto dall'acc.
 *
 * **Famiglia funzioni**: stesso "modulo audio pacing" di
 *   - `eeprom-commit.ts` (FUN_3F78 — convert acc to scaled output)
 *   - `eeprom-commit-request.ts` (FUN_3FC6 — increment / scaled-decrement)
 *   - questa (FUN_4008 — request subtract from pool, return success bool)
 *
 * Tutte chiamano l'helper interno **FUN_3F3E** (gia' replicato come
 * `helperFun3F3E` in `eeprom-commit.ts`) che valida lo status byte del
 * player struct (puntato da `*0x401FFC`) e ritorna 0 (status >= 0xE0) o
 * (status & 3) + 1 (range 1..4).
 *
 * **Disasm 0x4008..0x4057** (80 byte / 0x50):
 *
 *   0x4008  movem.l {A2 D2},-(SP)            ; preserve A2, D2 (8 byte)
 *   0x400C  move.l  (0xC,SP),D2              ; D2 = arg1 (long)
 *   0x4010  movea.l #0x401FF7,A2             ; A2 = counter ptr
 *   0x4016  jsr     FUN_3F3E                 ; helper -> D0 = 0 o 1..4
 *   0x401C  tst.l   D0
 *   0x401E  bne.b   0x4024                   ; D0 != 0 -> work
 *   0x4020  moveq   #1,D0                    ; helper=0 -> ret 1 (no-op)
 *   0x4022  bra.b   0x4052                   ; -> epilogue
 *   0x4024  moveq   #0,D0
 *   0x4026  move.b  (A2),D0b                 ; D0 = byte @ 0x401FF7 (zero-ext)
 *   0x4028  moveq   #0,D1
 *   0x402A  move.b  (0x401FF5).l,D1b         ; D1 = byte @ 0x401FF5 (zero-ext)
 *   0x4030  add.l   D1,D0                    ; D0 = counter + acc (long)
 *   0x4032  cmp.l   D2,D0                    ; flags = D0 - D2
 *   0x4034  bcc.b   0x403A                   ; D0 >= D2 unsigned -> drain
 *   0x4036  moveq   #0,D0                    ; pool < arg1 -> ret 0
 *   0x4038  bra.b   0x4052
 *
 *   ; drain loop: drena counter@FF7 finche' D2 (signed) > 0 e (A2) != 0.
 *   0x403A: tst.l   D2
 *   0x403C  ble.b   0x4048                   ; D2 <= 0 signed -> after_loop
 *   0x403E  tst.b   (A2)
 *   0x4040  bls.b   0x4048                   ; (A2) <= 0 unsigned -> after_loop
 *                                             ; (su tst.b, C=0 sempre -> bls = Z)
 *   0x4042  subq.l  #1,D2                    ; D2 -= 1
 *   0x4044  subq.b  #1,(A2)                  ; counter@FF7 -= 1
 *   0x4046  bra.b   0x403A                   ; loop
 *
 *   ; after_loop: D2 e' la "rimanenza" dopo aver svuotato il counter.
 *   0x4048  move.b  D2b,D0b                  ; D0.b = D2.b
 *   0x404A  sub.b   D0b,(0x401FF5).l         ; acc@FF5 -= D2.b (modulo 256)
 *   0x4050  moveq   #1,D0                    ; ret 1 (success)
 *
 *   0x4052: movem.l (SP)+,{D2 A2}
 *   0x4056  rts
 *
 * **Modellazione bit-perfect**:
 *
 *   1. **`cmp.l D2,D0; bcc`**: bcc = `!C` = `D0 >= D2 unsigned`. Quindi se
 *      arg1 ha l'high-bit set (sign-ext-negative o long molto grande), il
 *      pool combinato (max 0xFF + 0xFF = 0x1FE) e' sempre minore unsigned,
 *      quindi cade nel "ret 0". I caller (es. 0x10E22-0x10E24) passano
 *      sempre `ext.l` di un word, quindi arg1 hi = 0 o 0xFFFF; il binario
 *      gestisce entrambi correttamente via unsigned compare.
 *
 *   2. **`tst.l D2; ble`**: ble = `Z or (N != V)` = `D2 <= 0 signed`. arg1
 *      puo' essere 0 (Z set, ble taken, no drain). arg1 negativo (sign-ext
 *      d'un word negativo) e' gia' filtrato da bcc al passo 1, quindi qui
 *      e' sempre positivo o zero.
 *
 *   3. **`tst.b (A2); bls`**: bls = `C or Z`. Per `tst.b`, C e' sempre 0,
 *      quindi bls = Z = `byte == 0`. Esce dal loop quando il counter@FF7 e'
 *      stato drenato a 0.
 *
 *   4. **`subq.l #1,D2`**: long subtract. D2 e' "small positive" qui
 *      (max 0x1FE per il check del passo 1), niente underflow.
 *
 *   5. **`subq.b #1,(A2)`**: byte subtract. Il counter era != 0, quindi non
 *      underflowsa. Wrap byte non si verifica mai sotto la guard.
 *
 *   6. **`sub.b D0b,(0x401FF5).l`**: byte subtract con D0.b = D2.b
 *      (rimanenza). D2 in [0..0x1FE], quindi D2.b puo' essere qualsiasi
 *      byte 0..0xFF. Il binario fa `sub.b` modulo 256 — l'acc puo' fare
 *      wrap se la rimanenza e' troppo grande, ma la pre-condizione del
 *      passo 1 garantisce che `counter+acc >= arg1`, quindi dopo aver
 *      svuotato il counter (sottratto `counter` da arg1), la rimanenza
 *      `D2 = arg1 - counter <= acc`. Quindi `acc -= D2.b` non underflowsa
 *      ne' wrappa nei casi reali. Per parita' totale modelliamo comunque
 *      modulo 256.
 *
 *   7. **Helper FUN_3F3E**: stesso helper di `eeprom-commit.ts`. Riusiamo
 *      la stessa logica inline (potrebbe essere fattorizzata in un
 *      modulo condiviso, ma manteniamo inline come `eeprom-commit.ts`
 *      per coerenza col binario originale).
 *
 * **Side effects**: solo nel path "work" (helper != 0 AND pool >= arg1):
 *   - `0x401FF7` -= min(arg1, counter_iniziale)  (drain del counter)
 *   - `0x401FF5` -= max(0, arg1 - counter_iniziale)  (scarto sull'acc)
 *
 * Nei path "early exit" (helper=0) e "insufficient" (pool < arg1):
 *   - **NESSUNA** modifica alla workRam.
 *
 * **JSR interne**: 1 sola, FUN_3F3E (helper inline qui sotto, identico a
 * quello in `eeprom-commit.ts`).
 *
 * **MMIO**: nessuno. Solo workRam @ 0x401FFC, 0x401FF5, 0x401FF7, e bytes
 * a (*0x401FFC) + 0xA / +0xB.
 *
 * **Stack layout** all'ingresso (dopo `movem` di 8 byte):
 *   SP+0x00..0x07  saved A2, D2 (8 byte)
 *   SP+0x08..0x0B  return PC (4 byte)
 *   SP+0x0C..0x0F  arg1 long (push-RTL bottom arg)
 *
 * **Caller sites** (1 sola xref via thunk @ 0x230):
 *   - 0x10E24: arg1 = signext(word @ -0xA(A6))   (boolean check su pool)
 *
 * **Verifica bit-perfect** via `test-counter-pool-subtract-4008-parity.ts`
 * (500 casi randomici).
 */

import type { GameState } from "./state.js";

/** WorkRam offsets (RAM base 0x400000). */
const ACC_FF5_OFF = 0x1ff5;
const COUNTER_FF7_OFF = 0x1ff7;
const PTR_FFC_OFF = 0x1ffc;

/** RAM base assoluta M68k. */
const WORK_RAM_BASE = 0x400000;

/** Soglia status sopra la quale il helper FUN_3F3E ritorna 0 (early exit). */
const STATUS_EXIT_THRESHOLD = 0xe0;

/** Return code "success / no-op" (`D0 = 1`). */
export const RET_SUCCESS = 1 as const;

/** Return code "pool insufficient" (`D0 = 0`). */
export const RET_INSUFFICIENT = 0 as const;

/**
 * Helper FUN_3F3E — identico a quello in `eeprom-commit.ts`.
 *
 * Legge `*0x401FFC` (long BE) come puntatore al player struct, valida lo
 * status byte @ ptr+0xA contro il complement byte @ ptr+0xB, e ritorna:
 *   - 0  se status >= 0xE0  (caller usa per early-exit)
 *   - (status & 3) + 1  altrimenti  (range 1..4)
 *
 * Pure read: nessun side effect su workRam.
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
  if (d2 !== notB) d2 = 0;

  // cmpi.b #-0x20 (= 0xE0), D2b; bcs small (D2.b < 0xE0 unsigned)
  if (d2 >= STATUS_EXIT_THRESHOLD) {
    return 0;
  }
  return (d2 & 3) + 1;
}

/**
 * Replica bit-perfect di `FUN_00004008` — counter-pool subtract.
 *
 * Tenta di sottrarre `arg1` byte dal pool combinato `counter@FF7 + acc@FF5`,
 * drenando prima il counter e poi scalando il resto dall'acc. Ritorna un
 * boolean (long: 0 o 1) per indicare success.
 *
 * @param state  GameState. Legge:
 *   - `*0x401FFC` (long ptr) e bytes a ptr+0xA / +0xB (via helper)
 *   - `0x401FF7` (counter), `0x401FF5` (acc)
 *
 *   Modifica (solo nel path "work"):
 *   - `0x401FF7` -= n  (drain, byte modulo 256)
 *   - `0x401FF5` -= m  (scarto, byte modulo 256)
 *
 *   Nei path early-exit e insufficient: NESSUNA modifica.
 *
 * @param arg1   Long M68k. Quantita' da sottrarre dal pool. I caller passano
 *               sempre `ext.l` di un word, ma il binario tratta arg1 come
 *               long pieno (vedi nota 1 dell'header).
 *
 * @returns      D0 long:
 *   - 1 se helper status >= 0xE0 (no-op, early exit)
 *   - 0 se pool < arg1 unsigned (insufficient, no-op)
 *   - 1 se subtract avvenuto con successo
 */
export function counterPoolSubtract4008(
  state: GameState,
  arg1: number,
): number {
  const r = state.workRam;
  const arg1l = arg1 >>> 0;

  // ── 0x4016: jsr FUN_3F3E. ──
  // tst.l D0; bne work; moveq #1,D0; bra epilogue.
  // Se helper == 0 (status >= 0xE0): early exit con ret 1, NO modifiche.
  if (helperFun3F3E(state) === 0) {
    return RET_SUCCESS;
  }

  // ── 0x4024..0x4030: D0 = byte@FF7 + byte@FF5 (long, zero-ext). ──
  const counter0 = (r[COUNTER_FF7_OFF] ?? 0) & 0xff;
  const acc0 = (r[ACC_FF5_OFF] ?? 0) & 0xff;
  const pool = (counter0 + acc0) >>> 0;

  // ── 0x4032..0x4038: cmp.l D2,D0; bcc drain; ret 0. ──
  // bcc = D0 >= D2 unsigned. Se pool < arg1 unsigned -> insufficient.
  if (pool < arg1l) {
    return RET_INSUFFICIENT;
  }

  // ── 0x403A..0x4046: drain loop. ──
  // tst.l D2 (signed); ble after_loop.
  // tst.b (A2); bls after_loop.  (bls = Z su tst.b, cioe' counter == 0)
  // Loop body: D2 -= 1 (long); counter -= 1 (byte).
  //
  // Nota: D2 e' "small positive" (max 0x1FE per la guard sopra), quindi
  // tst.l + ble si comporta come "while D2 > 0". I bit alti restano 0.
  let d2 = arg1l | 0; // signed view (i32) per il check `ble` (D2 <= 0 signed).
  let counter = counter0;
  while (d2 > 0 && counter !== 0) {
    d2 = (d2 - 1) | 0;
    counter = (counter - 1) & 0xff;
  }

  // ── 0x4048..0x4050: sub.b D2b,(0x401FF5); ret 1. ──
  // D2 e' la rimanenza. sub.b modulo 256.
  const d2b = d2 & 0xff;
  const accNew = (acc0 - d2b) & 0xff;

  // Persisti i due byte modificati.
  r[COUNTER_FF7_OFF] = counter;
  r[ACC_FF5_OFF] = accNew;

  return RET_SUCCESS;
}
