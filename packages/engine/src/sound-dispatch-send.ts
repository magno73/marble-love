/**
 * sound-dispatch-send.ts — replica `FUN_00003E1A`.
 *
 * Sub-function pure-logic chiamata da:
 *   - `FUN_00004CA0` (sound dispatcher wrapper) @ 0x4CCC
 *   - thunk @ 0x16E
 *
 * Argomento (long sullo stack a 0x24,SP dopo movem.l 8 reg = 0x20 byte
 * + ret addr 0x4 byte = 0x24): `(D0<<8) | D1` dove
 *   - D0.b = comando sound corrente (high byte di argLong)
 *   - D1.b = ultimo comando inviato (low byte di argLong)
 *
 * **Comportamento osservato (3E1A..3F3D)**:
 *   1. D4 = (argLong >> 8) & 0xff   — current cmd
 *      D6 = argLong & 0xff           — last sent (già masked dal caller)
 *   2. A2 = *0x401FFC (long) → pointer a struct (player-/eeprom-related).
 *      A3 = A2 + 0x14
 *      D3 = *(A2+0x0A); D0 = ~*(A2+0x0B). Se D3 != ~D0: D3 = 0.  (validazione
 *      complementare byte status).
 *   3. Se D3 < 0xE0 (unsigned, cioè status non "raw/end-of-region"):
 *        outer loop su D5 ∈ {0,2,4} (incremento +2):
 *          a. D2 = (D4 >> D5) & 0xff       (lsr.w D5)
 *          b. D2 = (D2 | 4) - ((D6 >> D5) & 0xff)
 *          c. D2 &= 3
 *          d. if D2 > 1: D2 = 0   (clamp: solo 0 o 1 passano)
 *          e. if D5 == 0:
 *               D1 = (D3 & 0xC) >> 2          (bits 2-3 di status)
 *               if D1 != 0: D2 = D2 * (D1 + 3) (mulu.w → D2 word)
 *          f. if D5 == 2:
 *               if (D3 >> 4) & 1 != 0: D2 = (D2 + D2) & 0xffff
 *          g. if D2 != 0:
 *               D7 = 2; A0 = D7 - (D5>>1); A0 += A3; *A0 += 1
 *               if (post-incr byte) == 0 (overflow back to 00):
 *                  A0 = D7 - (D5>>1); A0 += A2; *A0 += 1
 *               *0x401FF5 += D2.b
 *               *0x401FF6 += D2.b
 *      Esce loop quando D5 >= 6.
 *   4. Inner loop "drain":
 *        D5 = D3 >> 5            (top 3 bit di status, range 0..7)
 *        D1 = ROM[0x7952 + D5].b
 *        if D1 == 0: exit
 *        loop:
 *          D0 = *0x401FF6 (byte)
 *          if D0 < D1 unsigned: exit
 *          *0x401FF6 -= D1
 *          if D5 == 3: *0x401FF7 += 2
 *          else:       *0x401FF7 += 1
 *   5. Else (D3 >= 0xE0): *0x401FF5 = 0; skip everything.
 *
 * **Tabella ROM @ 0x7952 (8 byte)**: divisor table per "drain rate".
 *
 * Nessuna `JSR`/`BSR` interna → implementazione pura senza stub-injection.
 * Verifica bit-perfect via `test-sound-dispatch-send-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const ACC_FF5_OFF = 0x1ff5; // accumulator high (?)
const ACC_FF6_OFF = 0x1ff6; // accumulator drain target
const COUNTER_FF7_OFF = 0x1ff7; // drained counter (output score?)
const POINTER_FFC_OFF = 0x1ffc; // long pointer to struct A2

/** ROM divisor table @ 0x7952. 8 byte, indexed by `status >> 5`. */
const DIVISOR_TABLE_OFF = 0x7952;

export interface SoundDispatchSendSubs {
  // FUN_3E1A non chiama nessuna sub. Stubs riservati per future estensioni
  // (es. instrumenting). Default: nessuno.
  readonly _reserved?: never;
}

/**
 * Replica bit-perfect di `FUN_00003E1A`.
 *
 * @param state  GameState (legge `*0x401FFC`, modifica `0x401FF5/6/7` e
 *               byte locali alla struct A2).
 * @param argLong  parametro `(D0 << 8) | D1` dal caller (FUN_4CA0).
 * @param subs   inutilizzato (no JSR interne); accettato per simmetria
 *               con altri dispatcher.
 *
 * **Side effects** in `state.workRam`:
 *   - Sempre: scrive `0x401FF5` (a 0 nel "early exit", oppure incrementa
 *     dopo outer loop).
 *   - Se path "valid": legge/scrive byte a `(A3 - D5/2)` e `(A2 - D5/2)`
 *     dentro la struct puntata da `*0x401FFC` (offsets +0x12, +0x13, +0x14).
 *   - Aggiorna `0x401FF6` (accumulator + drain).
 *   - Aggiorna `0x401FF7` (output counter).
 */
export function soundDispatchSend(
  state: GameState,
  rom: RomImage,
  argLong: number,
): void {
  const r = state.workRam;
  const arg = argLong >>> 0;

  // D4 = high byte (current cmd), D6 = low byte (last sent, already masked).
  const d4 = (arg >>> 8) & 0xff;
  const d6 = arg & 0xff;

  // A2 = *0x401FFC (long, big-endian). A3 = A2 + 0x14.
  const ptr =
    (((r[POINTER_FFC_OFF] ?? 0) << 24) |
      ((r[POINTER_FFC_OFF + 1] ?? 0) << 16) |
      ((r[POINTER_FFC_OFF + 2] ?? 0) << 8) |
      (r[POINTER_FFC_OFF + 3] ?? 0)) >>>
    0;
  // Address space: workRam mapped @ 0x400000. Convert to workRam offset.
  const a2Off = (ptr - 0x400000) >>> 0;
  const a3Off = (a2Off + 0x14) >>> 0;

  // D3 = *(A2 + 0xA). D0 = ~*(A2 + 0xB). Se D3.b != D0.b: D3 = 0.
  let d3 = r[a2Off + 0xa] ?? 0;
  const notB = (~(r[a2Off + 0xb] ?? 0)) & 0xff;
  // cmp.b D0,D3; beq keep else clr.b D3
  if (d3 !== notB) d3 = 0;

  // cmpi.b #-0x20 (= 0xE0), D3; bcs ok (D3 < 0xE0 unsigned)
  if (d3 >= 0xe0) {
    r[ACC_FF5_OFF] = 0;
    return;
  }

  // ── Outer loop su D5 ∈ {0, 2, 4} (incremento +2) ──────────────────────
  for (let d5 = 0; d5 < 6; d5 += 2) {
    // D2 = (D4 >> D5) & 0xff    — lsr.w D5,D2.w (D2 era moveq #0; move.b D4,D2)
    let d2 = (d4 >>> d5) & 0xffff;
    // ori.w #4, D2
    d2 = (d2 | 4) & 0xffff;
    // D1 = (D6 >> D5) & 0xff (anche qui d1 word)
    const d1Shift = (d6 >>> d5) & 0xffff;
    // sub.w D1.w, D2.w
    d2 = (d2 - d1Shift) & 0xffff;
    // andi.w #3, D2
    d2 = d2 & 3;
    // moveq #1, D0; cmp.w D2, D0; bcc skip (D0 >= D2 → ok); else clr.w D2
    // bcc = no carry (unsigned >=). cmp.w D2,D0 ⇒ D0 - D2; carry if D0 < D2.
    // bcc = D0 >= D2 → skip clr. Se D2 > 1 (D0=1 < D2): clr.w D2.
    if (d2 > 1) d2 = 0;

    // ── Branch su D5 ──────────────────────────────────────────────────
    if (d5 === 0) {
      // tst.w D5; bne skip — D5==0 qui.
      // D0 = (D3 & 0xC) → asr.l #2 = D0 / 4 → D1 = D0.w
      let d1Inner = (d3 & 0xc) >>> 2;
      // beq skip mul
      if (d1Inner !== 0) {
        // D0 = D1.w; addq.l #3, D0 → mulu.w D0.w, D2.l (ma poi tst.w D2 →
        // si usa solo low word, e D2 era già word-bound)
        const mulD0 = (d1Inner + 3) & 0xffff;
        // mulu.w D0,D2 → result long ma tst.w D2 sotto usa solo word.
        // mulu.w prende D0.w * D2.w → 32-bit. Salvato in D2.l.
        d2 = (d2 * mulD0) & 0xffffffff;
      }
    } else if (d5 === 2) {
      // moveq #2,D0; cmp.w D5,D0; bne skip (only when D5==2)
      // D1 = (D3 >> 4) & 1
      const bit4 = (d3 >>> 4) & 1;
      // beq skip; else add.w D2,D2 (D2 *= 2)
      if (bit4 !== 0) {
        d2 = (d2 + d2) & 0xffff;
      }
    }
    // d5 === 4 → nessuno dei due branch; si va al tst.w D2.

    // tst.w D2; beq skip update
    if ((d2 & 0xffff) !== 0) {
      // D7 = 2; A0 = D7 (long); D0 = D5.w; lsr.l #1, D0 → D5/2; suba.l D0,A0
      // → A0 = 2 - D5/2. adda.l A3,A0 → A0 = A3 + (2 - D5/2).
      // Per D5=0: A0 = A3 + 2 = A2 + 0x16
      // Per D5=2: A0 = A3 + 1 = A2 + 0x15
      // Per D5=4: A0 = A3 + 0 = A2 + 0x14
      const slotOff = (a3Off + 2 - (d5 >>> 1)) >>> 0;
      // addq.b #1, (A0)
      const before = r[slotOff] ?? 0;
      const after = (before + 1) & 0xff;
      r[slotOff] = after;
      // bne skip (Z=1 only if result is 0 → overflow from 0xFF)
      if (after === 0) {
        // Mirror increment in A2 region (carry byte): A0 = 2 - D5/2; A0 += A2.
        // Per D5=0: A2 + 2 = A2 + 0x02
        // Per D5=2: A2 + 1 = A2 + 0x01
        // Per D5=4: A2 + 0 = A2 + 0x00
        const carryOff = (a2Off + 2 - (d5 >>> 1)) >>> 0;
        r[carryOff] = ((r[carryOff] ?? 0) + 1) & 0xff;
      }

      // *0x401FF5 += D2.b
      const d2b = d2 & 0xff;
      r[ACC_FF5_OFF] = ((r[ACC_FF5_OFF] ?? 0) + d2b) & 0xff;
      // *(A1) = *0x401FF6 += D2.b
      r[ACC_FF6_OFF] = ((r[ACC_FF6_OFF] ?? 0) + d2b) & 0xff;
    }
  }

  // ── Inner drain loop ──────────────────────────────────────────────────
  // D5 = D3 >> 5 (top 3 bit, range 0..7).
  const d5Top = (d3 >>> 5) & 7;
  // D1 = byte_at(0x7952 + D5).b
  const divisor = rom.program[DIVISOR_TABLE_OFF + d5Top] ?? 0;
  // beq exit
  if (divisor === 0) return;

  // loop: D0 = *(A1) = *0x401FF6; cmp.w D1,D0; bcs exit (D0 < D1 → done).
  // else: *(A1) -= D1; if D5==3: *0x401FF7 += 2; else: *0x401FF7 += 1.
  for (;;) {
    const acc = r[ACC_FF6_OFF] ?? 0;
    if (acc < divisor) break;
    r[ACC_FF6_OFF] = (acc - divisor) & 0xff;
    const inc = d5Top === 3 ? 2 : 1;
    r[COUNTER_FF7_OFF] = ((r[COUNTER_FF7_OFF] ?? 0) + inc) & 0xff;
  }
}
