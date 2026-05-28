/**
 * event-flags.ts — gestione di "queue di flag" a 16 bit nel game state.
 *
 * Marble Madness usa un word a `0x400006` come **queue di event flags**:
 *   - I produttori settano bit specifici per signalare eventi
 *     (es. "biglia rotolata", "nemico spawnato", ...)
 *   - I consumatori chiamano `consumeEventFlag` (FUN_2548) per pop il bit
 *     uscito (in D0).
 *
 */

import type { GameState } from "./state.js";

/** Offset del flag word in workRam (assoluto 0x400006). */
export const EVENT_FLAGS_OFF = 0x06 as const;

/** Offset della status-flags bitmap u32 BE (assoluto 0x401F5E). */
export const STATUS_FLAGS_OFF = 0x1f5e as const;

/** Offset della "secondary status flags" bitmap u32 BE (assoluto 0x401F76). */
export const SECONDARY_FLAGS_OFF = 0x1f76 as const;

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
 *
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

/** Previous-state edge detector offset (absolute 0x40017C). */
export const EDGE_DETECTOR_PREV_OFF = 0x17c as const;

/**
 * `FUN_00000F6A` replica — rising edge detector + high nibble passthrough.
 *
 * Disassembly (13 instructions):
 *   D1 = *0x400000.w
 *   D2 = D1 & 0xF000          ; high nibble
 *   D1 = D1 & 0x0003           ; low 2 bits = current state
 *   D3 = D1
 *   D0 = *0x40017C.w           ; previous saved state (also low 2 bits used)
 *   D0 ^= D1                   ; bits that changed
 *   D1 = D0 & D3               ; bits that changed and are set now = rising edges
 *   *0x40017C.w = D3            ; save current state for next call
 *   D0 = sext_l(D2)            ; D0 = high nibble (shifted in word position)
 *   D1 = sext_l(D1)            ; D1 = rising-edge bits
 *   return D0 = D2.l | D1.l    ; combined long
 *
 * Use case: detect which bits of `*0x400000.w` low 2 bits transitioned from 0
 * to 1 since last call. Returned together with high nibble of input.
 *
 */
export function detectRisingEdgesAndPass(state: GameState): number {
  const flagWord =
    ((state.workRam[0x00] ?? 0) << 8) | (state.workRam[0x01] ?? 0);

  const highNibble = flagWord & 0xf000;
  const currentLow2 = flagWord & 0x0003;

  const prevSaved =
    ((state.workRam[EDGE_DETECTOR_PREV_OFF] ?? 0) << 8) |
    (state.workRam[EDGE_DETECTOR_PREV_OFF + 1] ?? 0);

  // Rising edges: bits set now that differed from prev, i.e. bits that just
  // became 1 (or changed in any way, masked by current).
  const xor = (prevSaved ^ currentLow2) & 0xffff;
  const risingBits = xor & currentLow2;

  // Save current low 2 bits as new prev
  state.workRam[EDGE_DETECTOR_PREV_OFF] = (currentLow2 >>> 8) & 0xff;
  state.workRam[EDGE_DETECTOR_PREV_OFF + 1] = currentLow2 & 0xff;

  // Result: high nibble (sign-extended) OR rising bits (sign-extended) as long
  // sext_l of word 0xF000 = 0xFFFFF000 (negative). OR with risingBits (small).
  // sext_l of word risingBits = 0..3.
  const d2Long = (highNibble & 0x8000) ? (highNibble | 0xffff0000) >>> 0 : highNibble;
  const d1Long = risingBits; // always positive (0..3)

  return (d2Long | d1Long) >>> 0;
}

/**
 * `FUN_00028608` replica — addToObjectAccumAndFlag(objPtr, value).
 *
 * Disassembly (7 instructions):
 *   A0 = obj pointer (arg1 long)
 *   D0 = value (arg2 long)
 *   *(0xBC, A0) += D0           ; obj.accumulator += value (long add BE)
 *   D0 = 1
 *   D1 = obj.+0x19 (byte = type)
 *   D0 = 1 << D1   ; asl.l D1, D0
 *   *0x40039C |= D0.b           ; set bit `type` in flag byte
 *   rts
 *
 * Use case: aggiunge contributo (es. score, time bonus) all'accumulator
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
  // shift >= 32 -> D0 = 0 for long shifts.
  // Byte OR uses only the low 8 result bits.
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
 *   *0x401F5E |= D1
 *
 * Bit mapping:
 *   arg = 0 → bit 0
 *   arg = 1 → bit 1
 *   arg = 2 → bit 0 (reused as "event type 2")
 *   arg = 3 → bit 1
 *   arg = N>=2 → bit (N-2)
 *
 * Side effect: bit set in BE u32 @ 0x401F5E (status flag bitmap).
 */
/**
 * `FUN_000052A2` replica — `anyStatusFlagsSet()`.
 *
 * Disassembly (4 instructions):
 *   move.l (0x00401F76).l, D0    ; D0 = secondary flags long
 *   or.l   (0x00401F5E).l, D0    ; D0 |= primary status flags long
 *   beq.b  skip                   ; if D0 == 0: skip (D0 stays 0)
 *   moveq  #1, D0                 ; else D0 = 1
 *   skip:
 *   rts
 *
 * Use case: "any pending status event?" check.
 *
 */
export function anyStatusFlagsSet(state: GameState): number {
  const primary =
    ((state.workRam[STATUS_FLAGS_OFF] ?? 0) << 24) |
    ((state.workRam[STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
    ((state.workRam[STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
    (state.workRam[STATUS_FLAGS_OFF + 3] ?? 0);
  const secondary =
    ((state.workRam[SECONDARY_FLAGS_OFF] ?? 0) << 24) |
    ((state.workRam[SECONDARY_FLAGS_OFF + 1] ?? 0) << 16) |
    ((state.workRam[SECONDARY_FLAGS_OFF + 2] ?? 0) << 8) |
    (state.workRam[SECONDARY_FLAGS_OFF + 3] ?? 0);
  return ((primary | secondary) >>> 0) === 0 ? 0 : 1;
}

export function setFlagBit(state: GameState, bitNum: number): void {
  const arg = bitNum >>> 0; // unsigned
  let shift = arg >= 2 ? (arg - 2) : arg;
  // m68k asl.l with shift count > 31 produces 0 (all bits shift out).
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
