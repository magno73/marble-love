/**
 * event-flags.ts — gestione di "queue di flag" a 16 bit nel game state.
 *
 * Marble Madness usa un word a `0x400006` come **queue di event flags**:
 *   - I produttori settano bit specifici per signalare eventi
 *     (es. "biglia rotolata", "nemico spawnato", ...)
 *   - I consumatori chiamano `consumeEventFlag` (FUN_2548) per pop il bit
 *     più basso. La funzione fa shift-right del word e ritorna il bit
 *     uscito (in D0).
 *
 * Verificato bit-perfect vs `FUN_00002548` tramite test-event-flags-parity.
 */

import type { GameState } from "./state.js";

/** Offset del flag word in workRam (assoluto 0x400006). */
export const EVENT_FLAGS_OFF = 0x06 as const;

/** Offset della status-flags bitmap u32 BE (assoluto 0x401F5E). */
export const STATUS_FLAGS_OFF = 0x1f5e as const;

/** Offset della "object trigger flags" bitmap u8 (assoluto 0x40039C). */
export const OBJECT_TRIGGER_FLAGS_OFF = 0x39c as const;

export const OBJ_BASE_ADDR = 0x400018 as const;
export const OBJ_STRIDE = 0xe2 as const;
export const OBJ_FIELD_TYPE = 0x19 as const;       // u8: object type
export const OBJ_FIELD_ACCUM = 0xbc as const;      // u32 BE: long accumulator

/**
 * Replica `FUN_00002548` — consume next event flag.
 *
 * Disassembly:
 *   lsr.w *0x400006     ; X = bit 0 (uscito)
 *   bcc skip_set        ; if X == 0: D0 = 0
 *   moveq #1, D0
 *   rts
 *   skip_set:
 *   clr.l D0
 *   rts
 *
 * Side effect: *0x400006 viene shifted right by 1 (consuma il bit).
 *
 * Ritorna: 1 se il bit consumato era 1, altrimenti 0.
 */
export function consumeEventFlag(state: GameState): number {
  const high = state.workRam[EVENT_FLAGS_OFF] ?? 0;
  const low = state.workRam[EVENT_FLAGS_OFF + 1] ?? 0;
  const word = (high << 8) | low;
  const bit0 = word & 1;
  const newWord = (word >>> 1) & 0xffff;
  state.workRam[EVENT_FLAGS_OFF] = (newWord >>> 8) & 0xff;
  state.workRam[EVENT_FLAGS_OFF + 1] = newWord & 0xff;
  return bit0;
}

/**
 * Replica `FUN_00028608` — addToObjectAccumAndFlag(objPtr, value).
 *
 * Disassembly (7 istruzioni):
 *   A0 = obj pointer (arg1 long)
 *   D0 = value (arg2 long)
 *   *(0xBC, A0) += D0           ; obj.accumulator += value (long add BE)
 *   D0 = 1
 *   D1 = obj.+0x19 (byte = type)
 *   D0 = 1 << D1   ; asl.l D1, D0
 *   *0x40039C |= D0.b           ; setta bit `type` in flag byte
 *   rts
 *
 * Use case: aggiunge contributo (es. score, time bonus) all'accumulator
 * dell'obj e segnala l'evento nella bitmap globale.
 */
export function addToObjectAccumAndFlag(
  state: GameState,
  objPtr: number,
  value: number,
): void {
  const objOff = objPtr - 0x400000;
  const accumOff = objOff + OBJ_FIELD_ACCUM;

  // Read u32 BE accumulator
  const oldAccum =
    ((state.workRam[accumOff] ?? 0) << 24) |
    ((state.workRam[accumOff + 1] ?? 0) << 16) |
    ((state.workRam[accumOff + 2] ?? 0) << 8) |
    (state.workRam[accumOff + 3] ?? 0);
  const newAccum = (oldAccum + value) >>> 0;
  state.workRam[accumOff] = (newAccum >>> 24) & 0xff;
  state.workRam[accumOff + 1] = (newAccum >>> 16) & 0xff;
  state.workRam[accumOff + 2] = (newAccum >>> 8) & 0xff;
  state.workRam[accumOff + 3] = newAccum & 0xff;

  // Set bit `type` in flag byte at 0x40039C
  const type = state.workRam[objOff + OBJ_FIELD_TYPE] ?? 0;
  // asl.l D1, D0 — shift count è D1.b (low byte). 68k cap a 64.
  // shift >= 32 → D0 = 0 (per long shift)
  // Per byte OR usa solo low 8 bit del result.
  let mask = 0;
  if (type < 32) mask = (1 << type) >>> 0;
  // OR in flag byte (low 8 bit only since `or.b D0b, ...`)
  const cur = state.workRam[OBJECT_TRIGGER_FLAGS_OFF] ?? 0;
  state.workRam[OBJECT_TRIGGER_FLAGS_OFF] = (cur | (mask & 0xff)) & 0xff;
}

/**
 * Replica `FUN_00005236` — setFlagBit(bitNum).
 *
 * Disassembly:
 *   D0 = arg long
 *   if D0 >= 2 (unsigned): D0 -= 2     ; (cmpi #2 + bcs poi subq.l 2)
 *   D1 = 1
 *   D1 <<= D0   ; asl.l (D0 capped a 64; per D0 >=32 il behaviour 68k è
 *               ;  D1 = 0 dopo 32 shift)
 *   *0x401F5E |= D1
 *
 * Mappatura del bit:
 *   arg = 0 → bit 0
 *   arg = 1 → bit 1
 *   arg = 2 → bit 0 (riusato come "tipo evento 2")
 *   arg = 3 → bit 1
 *   arg = N>=2 → bit (N-2)
 *
 * Side effect: bit settato in u32 BE @ 0x401F5E (status flag bitmap).
 */
export function setFlagBit(state: GameState, bitNum: number): void {
  const arg = bitNum >>> 0; // unsigned
  let shift = arg >= 2 ? (arg - 2) : arg;
  // m68k asl.l con shift count > 31 produce 0 (i bit escono completamente)
  shift = shift & 0x3f; // 68k usa low 6 bits per shift count, ma >=32 → 0
  const mask = shift >= 32 ? 0 : ((1 << shift) >>> 0);

  const off = STATUS_FLAGS_OFF;
  const cur =
    ((state.workRam[off] ?? 0) << 24) |
    ((state.workRam[off + 1] ?? 0) << 16) |
    ((state.workRam[off + 2] ?? 0) << 8) |
    (state.workRam[off + 3] ?? 0);
  const next = (cur | mask) >>> 0;
  state.workRam[off] = (next >>> 24) & 0xff;
  state.workRam[off + 1] = (next >>> 16) & 0xff;
  state.workRam[off + 2] = (next >>> 8) & 0xff;
  state.workRam[off + 3] = next & 0xff;
}
