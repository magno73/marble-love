/**
 * Bit-perfect port of the root game-logic gate `FUN_00028972`.
 *
 * Responsibilities:
 * - debounce the MMIO input sample into `0x4003A8`, `0x4003AA`, and
 *   falling-edge flags at `0x4003AC`;
 * - process the two start/advance gate blocks for bits 0 and 1;
 * - skip block C when MMIO bit 6 is set;
 * - otherwise run pause detection, object timer maintenance, optional
 *   `FUN_28D02` callbacks, and the final `0x4003B2 = 0x40` write.
 *
 * `gateCheck` and `controlCallback` model `FUN_01CC` and `FUN_28D02` for
 * parity tests.
 */

import type { GameState } from "./state.js";

// ─── Address constants (workRam offsets) ─────────────────────────────────

/** Byte: previous MMIO input sample at absolute address `0x4003A8`. */
export const PREV_INPUT_OFF = 0x3a8 as const;
/** Byte: debounced stable input bits at absolute address `0x4003AA`. */
export const DEBOUNCED_INPUT_OFF = 0x3aa as const;
/** Byte: falling-edge trigger flags at absolute address `0x4003AC`. */
export const FALLING_EDGES_OFF = 0x3ac as const;

/** Word: game state at `0x400390` (also defined in game-tick-timers). */
export const GAME_STATE_WORD_OFF = 0x390 as const;
/** Word: object count @ 0x400396. */
export const OBJECT_COUNT_OFF = 0x396 as const;
/** Byte: control flag at `0x4003B2`, set to 0x40 at the end of block C. */
export const CONTROL_BYTE_OFF = 0x3b2 as const;

/** Object base plus per-object field offsets, matching game-tick-timers.ts. */
const OBJECTS_BASE_OFF = 0x18;
const OBJECT_STRIDE = 0xe2;
const OBJ_STATE_OFF = 0x18;
const OBJ_TIMER_OUTER_OFF = 0x6a; // word

const TIMER_INCREMENT = 0x3c; // 60
const TIMER_CLAMP = 0x168; // 360

/** MMIO byte 0xF60001 bit mask: bit 6 = "hardware ready / skip Block C". */
const MMIO_READY_BIT = 0x40;

// Sub-replica: FUN_2893C debounce.

/**
 * Port of `FUN_0002893C`: debounce plus falling-edge detect for MMIO input.
 *
 *   newDebounced := (oldDebounced | (prev & curr)) & (prev | curr)
 *   *0x4003A8 := curr   (save next prev)
 *   *0x4003AA := newDebounced
 *   *0x4003AC |= (newDebounced ^ oldDebounced) & oldDebounced
 *                 ; bits that transitioned 1 -> 0
 *
 */
export function debounceInput(state: GameState, mmioByte: number): void {
  const r = state.workRam;
  const prev = r[PREV_INPUT_OFF] ?? 0;
  const oldDebounced = r[DEBOUNCED_INPUT_OFF] ?? 0;
  const curr = mmioByte & 0xff;

  let newDebounced = (oldDebounced | (prev & curr)) & (prev | curr);
  newDebounced &= 0xff;

  r[DEBOUNCED_INPUT_OFF] = newDebounced;
  r[PREV_INPUT_OFF] = curr;

  // Falling edges are bits that changed and were previously set.
  const falling = ((newDebounced ^ oldDebounced) & oldDebounced) & 0xff;
  r[FALLING_EDGES_OFF] = ((r[FALLING_EDGES_OFF] ?? 0) | falling) & 0xff;
}

// Block helper: A or B.

function processGateBlock(
  state: GameState,
  bitNum: 0 | 1,
  countValue: number,
  gateCheck?: (arg: number) => number,
): void {
  const r = state.workRam;
  const fallingByte = r[FALLING_EDGES_OFF] ?? 0;
  // btst #N, (A4) — branch if bit clear (beq)
  if ((fallingByte & (1 << bitNum)) === 0) return;

  // cmp.w #1, *A3 — branch if not equal (bne)
  const gameStateWord =
    ((r[GAME_STATE_WORD_OFF] ?? 0) << 8) | (r[GAME_STATE_WORD_OFF + 1] ?? 0);
  if (gameStateWord !== 1) return;

  // `andi.b #-2` for bit 0 or `andi.b #-3` for bit 1: clear the bit.
  r[FALLING_EDGES_OFF] = (fallingByte & ~(1 << bitNum)) & 0xff;

  const result = gateCheck ? gateCheck(countValue) : 0;
  if (result === 0) return;

  // Commit: count word = countValue, game state = 5
  r[OBJECT_COUNT_OFF] = 0;
  r[OBJECT_COUNT_OFF + 1] = countValue;
  r[GAME_STATE_WORD_OFF] = 0;
  r[GAME_STATE_WORD_OFF + 1] = 5;
}

// Main function: FUN_28972.

export interface GameMainGateOptions {
  mmioInput: number;
  /**
   */
  gateCheck?: (arg: number) => number;
  /**
   * Stub for `FUN_28D02`. Receives the long argument.
   */
  controlCallback?: (arg: number) => void;
}

/**
 * The original `bra .` infinite loop is surfaced as a flag so the TS game
 * loop can stop processing cleanly.
 */
export interface GameStateWithHang extends GameState {
  hangRequested?: boolean;
}

/**
 * Port of `FUN_00028972`, the main game-loop gate.
 */
export function gameMainGate(state: GameState, opts: GameMainGateOptions): void {
  const r = state.workRam;

  // Step 1: debounce input MMIO
  debounceInput(state, opts.mmioInput);

  // Step 2: Block A (bit 0, count=1)
  processGateBlock(state, 0, 1, opts.gateCheck);

  // Step 3: Block B (bit 1, count=2)
  processGateBlock(state, 1, 2, opts.gateCheck);

  // Step 4: MMIO bit 6 check (early exit)
  if ((opts.mmioInput & MMIO_READY_BIT) !== 0) {
    return;
  }

  // Block C: pause logic plus timer increment.
  const debouncedByte = r[DEBOUNCED_INPUT_OFF] ?? 0;
  const bit0Set = (debouncedByte & 0x01) !== 0;
  const bit1Set = (debouncedByte & 0x02) !== 0;

  // Hang detection: bits 0 and 1 set in *0x4003AA trigger the original `bra .`.
  if (bit0Set && bit1Set) {
    (state as GameStateWithHang).hangRequested = true;
    return;
  }

  // skip_c2 / skip_c3 logic:
  //   if bit 0 of *0x4003AA NOT set: jsr FUN_28D02(1)
  if (!bit0Set) {
    if (opts.controlCallback) opts.controlCallback(1);
  }


  for (let i = 0; i < 2; i++) {
    const objOff = OBJECTS_BASE_OFF + i * OBJECT_STRIDE;
    const stateByte = r[objOff + OBJ_STATE_OFF] ?? 0;
    // `tst.b *(A0+0x18); beq skip`: skip state 0.
    if (stateByte === 0) continue;
    // `cmpi.b #2,...; beq skip`: skip state 2.
    if (stateByte === 2) continue;

    // *(obj+0x6A) += 60 (word add)
    const oldOuter =
      ((r[objOff + OBJ_TIMER_OUTER_OFF] ?? 0) << 8) |
      (r[objOff + OBJ_TIMER_OUTER_OFF + 1] ?? 0);
    let newOuter = (oldOuter + TIMER_INCREMENT) & 0xffff;
    // `cmpi.w #0x168,(0x6a,A0); ble.b skip` branches when timer <= 0x168,
    // so values above the clamp are forced back to 0x168.
    const newOuterSigned = newOuter & 0x8000 ? newOuter - 0x10000 : newOuter;
    if (newOuterSigned > TIMER_CLAMP) {
      newOuter = TIMER_CLAMP;
    }
    r[objOff + OBJ_TIMER_OUTER_OFF] = (newOuter >>> 8) & 0xff;
    r[objOff + OBJ_TIMER_OUTER_OFF + 1] = newOuter & 0xff;
  }

  // Final: if bit 0 of *0x4003AA NOT set: jsr FUN_28D02(0)
  if (!bit0Set) {
    if (opts.controlCallback) opts.controlCallback(0);
  }

  // *0x4003B2 = 0x40
  r[CONTROL_BYTE_OFF] = 0x40;
}
