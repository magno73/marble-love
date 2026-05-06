/**
 * state-sub-15bd0.ts — replica `FUN_00015BD0` (118 byte).
 *
 * Sub-routine "object reset + broadcast event":
 *   1. **Block A** (gated by low byte di `arg3Long`):
 *      Se `arg3.b != 0`, azzera il byte @ `structPtr+0x18` (state field di
 *      una struct passata come arg1) e chiama `FUN_00018F46(2, sext_l(byte
 *      @ structPtr+0x19))`. Tipico fan-out di "reset stato + notify".
 *
 *   2. **Block B** (gated by low byte di `arg2Long`):
 *      Se `arg2.b != 0`, itera tutti gli object struct dell'array @
 *      `0x400018` stride `0xE2`, per i in [0..count) dove
 *      `count = *0x400396` (word). Per ogni obj con `obj+0x18 ∉ {0, 2}`
 *      chiama `FUN_000285B0(objAddr, 3)` (triggerObjectEvent).
 *
 * **Argomenti** (3 long sullo stack, cdecl-like):
 *   - `arg1Long` (long → A0 = structPtr): pointer assoluto a una struct
 *     in workRam. Letto/scritto solo nel Block A:
 *       - `clr.b (0x18, A0)` — write 0
 *       - `move.b (0x19, A0), D0b` — read byte → sign-ext → arg2 di FUN_18F46
 *     Quando `arg3.b == 0`, A0 è unused (anche se il binario lo carica).
 *   - `arg2Long` (long, ma usato solo come **low byte** = `(0x17,SP).b`):
 *     gate del Block B. Se zero → skip Block B.
 *   - `arg3Long` (long, ma usato solo come **low byte** = `(0x1B,SP).b`):
 *     gate del Block A. Se zero → skip Block A.
 *
 * **Disasm 0x15BD0..0x15C46** (118 byte):
 *
 *   movem.l {A2,D3,D2},-(SP)         ; salva A2/D3/D2 (12 byte)
 *   movea.l (0x10,SP),A0             ; A0 = arg1 long (structPtr)
 *   move.b  (0x17,SP),D2b            ; D2.b = arg2 low byte
 *   move.b  (0x1B,SP),D0b            ; D0.b = arg3 low byte
 *   tst.b   D0b
 *   beq.b   0x15BFE                  ; arg3.b == 0 → skip Block A
 *   ; Block A:
 *   clr.b   (0x18, A0)               ; structPtr+0x18 = 0
 *   move.b  (0x19, A0), D0b
 *   ext.w   D0w
 *   ext.l   D0                       ; D0 = sext_l(structPtr+0x19)
 *   move.l  D0,-(SP)                 ; push arg2 (long sext)
 *   pea     (0x2).w                  ; push arg1 = sext_l(0x2) = 2
 *   jsr     0x00018F46.l             ; FUN_18F46(2, sext_l(structPtr+0x19))
 *   addq.l  #8, SP
 * 0x15BFE:
 *   tst.b   D2b
 *   beq.b   0x15C40                  ; arg2.b == 0 → skip Block B
 *   movea.l #0x400018, A2            ; A2 = OBJ_BASE_ADDR
 *   clr.b   D2b                      ; D2.b = 0 (loop counter)
 *   bra.b   0x15C34                  ; jump to loop test
 * 0x15C0C: ; loop body
 *   cmpi.b  #0x2, (0x18, A2)         ; obj.state == 2?
 *   beq.b   0x15C28                  ; sì → skip
 *   tst.b   (0x18, A2)               ; obj.state == 0?
 *   beq.b   0x15C28                  ; sì → skip
 *   pea     (0x3).w                  ; push 3 (long sext)
 *   move.l  A2,-(SP)                 ; push objAddr
 *   jsr     0x000285B0.l             ; FUN_285B0(objAddr, 3)
 *   addq.l  #8, SP
 * 0x15C28:
 *   move.l  A2, D3
 *   addi.l  #0xE2, D3                ; A2 += 0xE2 (next obj stride)
 *   movea.l D3, A2
 *   addq.b  #1, D2b                  ; D2++
 * 0x15C34: ; loop test
 *   move.b  D2b, D0b
 *   ext.w   D0w
 *   cmp.w   (0x00400396).l, D0w      ; D0.w == count word?
 *   bne.b   0x15C0C                  ; no → loop
 * 0x15C40:
 *   movem.l (SP)+, {D2,D3,A2}
 *   rts
 *
 * **Tabella semantica per (arg2.b, arg3.b)**:
 *   - (0, 0): no-op totale
 *   - (0, !0): solo Block A (reset structPtr.state + FUN_18F46)
 *   - (!0, 0): solo Block B (broadcast a tutti gli obj con state ∉ {0,2})
 *   - (!0, !0): Block A poi Block B in sequenza
 *
 * **Caller noti** (8 xref): `FUN_15A12 @ 0x15BB4`, `FUN_121B8 @ 0x1229E`,
 * `FUN_121B8 @ 0x126E8`, `FUN_1BC88 @ 0x1BFD2`, `FUN_25C74 @ 0x25DD8`,
 * `FUN_1CD00 @ 0x1CF96`, `FUN_29CCE @ 0x2A484`. Tipica chiamata
 * "reset uno + notify tutti" su transizione di stato globale.
 *
 * **Loop terminazione**: `cmp.w count, D0w; bne` — D0.w è D2.b
 * sign-extesa. Se `count > 127` o se `count == 0`, il loop ha edge case
 * peculiari (vedi sotto). Per i call site reali `count` è word piccolo
 * (≤ ~16), quindi nessuna patologia.
 *
 * **Edge case `count == 0`**: il binario fa `bra 0x15C34` PRIMA del loop,
 * quindi la prima iterazione testa `D2.b (=0) == count.w (=0)` → equal →
 * exit. Quindi count=0 → skip totale Block B body. Replicato fedelmente.
 *
 * **JSR sub injection**: due callee esposti via `StateSub15BD0Subs`:
 *   - `fun_18f46(arg1Long, arg2Long, state)` — invocata 0 o 1 volta per
 *     `stateSub15BD0`. Default no-op.
 *   - `fun_285b0(objAddr, eventByte, state)` — invocata 0..count volte.
 *     Default no-op.
 *
 * **Side effects diretti** (esclusi quelli dei sub):
 *   - `workRam[(structPtr - 0x400000) + 0x18] = 0` se `arg3.b != 0` E
 *     `structPtr` è in workRam.
 *
 * **Return**: nessun valore significativo (D0 al rts è "leftover" da
 * `addq.l #8, SP` o dal flag `bne`). Ritorniamo `void`.
 *
 * Verifica bit-perfect via `cli/src/test-state-sub-15bd0-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── Address constants ───────────────────────────────────────────────────

/** Base address dell'array di object struct (assoluto 0x400018). */
export const OBJ_BASE_ADDR = 0x00400018 as const;
/** Stride tra object struct adiacenti. */
export const OBJ_STRIDE = 0xe2 as const;
/** Offset assoluto del word "object count" (0x400396). */
export const OBJ_COUNT_ADDR = 0x00400396 as const;

/** Offset relativo del byte "state" nello struct/object. */
export const STATE_FIELD_OFF = 0x18 as const;
/** Offset relativo del byte usato come arg2 di FUN_18F46. */
export const FIELD_19_OFF = 0x19 as const;

/** Costante `2` passata come arg1 di FUN_18F46. */
export const FUN_18F46_ARG1 = 0x2 as const;
/** Costante `3` passata come arg2 (eventByte) di FUN_285B0. */
export const FUN_285B0_EVENT = 0x3 as const;

/** WORK RAM base assoluta M68k. */
const WORK_RAM_BASE = 0x00400000;
/** Dimensione workRam (8 KB). */
const WORK_RAM_SIZE = 0x2000;

// ─── Sub injection types ─────────────────────────────────────────────────

/**
 * Stub injection per le 2 JSR di FUN_15BD0.
 *
 * - `fun_18f46`: invocata nel Block A (al massimo 1 volta). Riceve
 *   `arg1Long = 2` (constante) e `arg2Long = sext_l(structPtr+0x19)`
 *   (signed byte espanso a long signed → wrappato a u32). Default no-op.
 * - `fun_285b0`: invocata nel Block B (0..count volte). Riceve
 *   `objAddrLong` (long absoluto del slot obj) e `eventByteLong = 3`
 *   (constante, ma il binario fa `pea (0x3).w` che è sext_w_l(3) = 3).
 *   Default no-op.
 */
export interface StateSub15BD0Subs {
  /** FUN_18F46(arg1=2, arg2=sext_l(structPtr+0x19), state). */
  fun_18f46?: (arg1Long: number, arg2Long: number, state: GameState) => void;
  /** FUN_285B0(objAddr, eventByte=3, state). */
  fun_285b0?: (objAddrLong: number, eventByteLong: number, state: GameState) => void;
}

// ─── Implementation ──────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00015BD0` — object reset + broadcast event.
 *
 * @param state       GameState. Side effect diretto: scrive
 *                    `workRam[(structPtr - 0x400000) + 0x18] = 0` se
 *                    `arg3Long.b != 0` e `structPtr` è in workRam.
 * @param structPtrLong  long: pointer assoluto allo struct passato come
 *                       primo arg (A0). Letto solo nel Block A.
 * @param arg2Long    long: gate del Block B (low byte solo).
 * @param arg3Long    long: gate del Block A (low byte solo).
 * @param subs        stub injection per `fun_18f46` (1 call) e
 *                    `fun_285b0` (0..count call).
 *
 * **Sequenza**:
 *   1. Se `arg3Long & 0xFF != 0`:
 *        - Scrivi 0 a `workRam[structPtr+0x18]` (se in workRam).
 *        - Leggi byte @ `structPtr+0x19`, sign-extend a long signed (poi
 *          wrappato a u32 per la callback).
 *        - Chiama `subs.fun_18f46(2, sext_l(byte19), state)`.
 *   2. Se `arg2Long & 0xFF != 0`:
 *        - Leggi `count = *0x400396` (word, big-endian, da `workRam`).
 *        - Per i in [0..count) (sequenziale):
 *            - `objAddr = 0x400018 + i * 0xE2` (long).
 *            - `objStateByte = workRam[objAddr+0x18 - 0x400000]`.
 *            - Se `objStateByte != 0` E `objStateByte != 2`:
 *                - Chiama `subs.fun_285b0(objAddr, 3, state)`.
 *
 * **Note ortogonalità**: i 2 block sono indipendenti. Block A può scrivere
 * su workRam, ma il Block B legge da object struct array @ 0x400018, non
 * da `structPtr` (a meno che `structPtr` punti dentro l'array, nel qual
 * caso il caller deve essere consapevole — situazione patologica non
 * osservata nei call site reali).
 *
 * **Bit-perfect detail per signed-byte sign-extension**:
 * `sext_l(byte)` in TS si calcola come `(byte << 24) >> 24` (int32 signed)
 * che produce -128..127. Per passare alla callback come `u32`:
 * `sext_l(byte) >>> 0` produce il pattern bit-perfect M68k (es. 0xFF →
 * 0xFFFFFFFF).
 */
export function stateSub15BD0(
  state: GameState,
  structPtrLong: number,
  arg2Long: number,
  arg3Long: number,
  subs?: StateSub15BD0Subs,
): void {
  const r = state.workRam;
  const a0 = structPtrLong >>> 0;
  const arg2B = arg2Long & 0xff;
  const arg3B = arg3Long & 0xff;

  // ─── Block A: arg3.b != 0 ────────────────────────────────────────────
  if (arg3B !== 0) {
    // clr.b (0x18, A0)
    const stateAddr = (a0 + STATE_FIELD_OFF) >>> 0;
    if (stateAddr >= WORK_RAM_BASE && stateAddr < WORK_RAM_BASE + WORK_RAM_SIZE) {
      r[stateAddr - WORK_RAM_BASE] = 0;
    }
    // move.b (0x19, A0), D0b ; ext.w D0w ; ext.l D0
    const fld19Addr = (a0 + FIELD_19_OFF) >>> 0;
    let byte19 = 0;
    if (fld19Addr >= WORK_RAM_BASE && fld19Addr < WORK_RAM_BASE + WORK_RAM_SIZE) {
      byte19 = r[fld19Addr - WORK_RAM_BASE] ?? 0;
    }
    // sign-extend byte → long, then wrap to u32 for callback bit-pattern.
    const arg2Sext = (((byte19 & 0xff) << 24) >> 24) >>> 0;
    // pea (0x2).w → arg1 long = sext_l(0x2) = 2
    subs?.fun_18f46?.(FUN_18F46_ARG1, arg2Sext, state);
  }

  // ─── Block B: arg2.b != 0 ────────────────────────────────────────────
  if (arg2B !== 0) {
    // count = word @ 0x400396 (big-endian).
    const countOff = OBJ_COUNT_ADDR - WORK_RAM_BASE;
    const countWord =
      (((r[countOff] ?? 0) << 8) | (r[countOff + 1] ?? 0)) & 0xffff;

    // Loop: D2.b da 0 a count-1.
    // Disasm: bra prima del loop test → cmp D2 (sext_w) con count.w; bne loop.
    // Equivalente a `for (i = 0; i < count; i++)` per count ≤ 127 e ≥ 0.
    // Per count == 0: prima iter test fallisce → no body. Coperto da `< count`.
    let objAddr = OBJ_BASE_ADDR >>> 0;
    for (let i = 0; i < countWord; i++) {
      const objStateOff = (objAddr + STATE_FIELD_OFF) - WORK_RAM_BASE;
      const objStateByte = r[objStateOff] ?? 0;

      // cmpi.b #0x2, (0x18, A2); beq skip → if state == 2: skip
      // tst.b (0x18, A2); beq skip → if state == 0: skip
      if (objStateByte !== 0 && objStateByte !== 2) {
        // pea (0x3).w → eventByte arg = sext_l(3) = 3
        subs?.fun_285b0?.(objAddr, FUN_285B0_EVENT, state);
      }

      // A2 += 0xE2
      objAddr = (objAddr + OBJ_STRIDE) >>> 0;
    }
  }
}
