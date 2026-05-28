/**
 * state-machine-schedule.ts — `FUN_00002BDA` (134 bytes) and `FUN_00002C60` (116 bytes).
 *
 * FUN_2E18 sub: schedule a new job in the state-machine slot array.
 *
 * - **FUN_2BDA — `scheduleStateMachine3(dataPtr, word16, threshold)`**:
 *   finds the first slot with state==0 and fills it with state=3.
 * - **FUN_2C60 — `scheduleStateMachine4(dataPtr, threshold)`**:
 *   same as above but state=4, no word16.
 *
 * Returns: 1 = scheduled OK, 0 = no free slot.
 */

import type { GameState } from "./state.js";

const SLOT_COUNT = 4;
const DATA_PTR_BASE_OFF = 0x1f04;
const WORD16_BASE_OFF = 0x1f14;
const STATE_BASE_OFF = 0x1f1c;
const THRESHOLD_BASE_OFF = 0x1f20;
const COUNTER_BASE_OFF = 0x1f28;
const FLAG30_BASE_OFF = 0x1f30;
const FLAG34_BASE_OFF = 0x1f34;

function fillSlot(state: GameState, idx: number, dataPtr: number, word16: number, threshold: number, stateValue: number, includeWord16: boolean): void {
  const r = state.workRam;
  // data[idx] = dataPtr (long)
  const dOff = DATA_PTR_BASE_OFF + idx * 4;
  r[dOff] = (dataPtr >>> 24) & 0xff;
  r[dOff + 1] = (dataPtr >>> 16) & 0xff;
  r[dOff + 2] = (dataPtr >>> 8) & 0xff;
  r[dOff + 3] = dataPtr & 0xff;
  // state[idx] = stateValue
  r[STATE_BASE_OFF + idx] = stateValue & 0xff;
  // threshold[idx] = threshold word
  r[THRESHOLD_BASE_OFF + idx * 2] = (threshold >>> 8) & 0xff;
  r[THRESHOLD_BASE_OFF + idx * 2 + 1] = threshold & 0xff;
  // word16[idx] = word16 (only state 3)
  if (includeWord16) {
    r[WORD16_BASE_OFF + idx * 2] = (word16 >>> 8) & 0xff;
    r[WORD16_BASE_OFF + idx * 2 + 1] = word16 & 0xff;
  }
  // counter[idx] = 0
  r[COUNTER_BASE_OFF + idx * 2] = 0;
  r[COUNTER_BASE_OFF + idx * 2 + 1] = 0;
  // flag34[idx] = 0
  r[FLAG34_BASE_OFF + idx] = 0;
}

export function scheduleStateMachine3(state: GameState, dataPtr: number, word16: number, threshold: number): number {
  const r = state.workRam;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if ((r[STATE_BASE_OFF + i] ?? 0) === 0) {
      fillSlot(state, i, dataPtr >>> 0, word16 & 0xffff, threshold & 0xffff, 3, true);
      return 1;
    }
  }
  return 0;
}

export function scheduleStateMachine4(state: GameState, dataPtr: number, threshold: number): number {
  const r = state.workRam;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if ((r[STATE_BASE_OFF + i] ?? 0) === 0) {
      fillSlot(state, i, dataPtr >>> 0, 0, threshold & 0xffff, 4, false);
      return 1;
    }
  }
  return 0;
}

/**
 * Replica `FUN_00002A24` — `scheduleStateMachine2(dataPtr, word16, threshold)`.
 * Render via FUN_2572, then schedule state=2: data, threshold, word16, flag30=1.
 */
/**
 * Replica `FUN_00002B50` — `scheduleStateMachine1(dataPtr, word16, threshold)`.
 * Render via FUN_2572, then schedule state=1.
 */
export function scheduleStateMachine1(
  state: GameState,
  rom: import("./bus.js").RomImage,
  renderFn: (state: GameState, rom: import("./bus.js").RomImage, dataPtr: number, attrSigned: number) => number,
  dataPtr: number,
  word16: number,
  threshold: number,
): number {
  const r = state.workRam;
  const w16Word = word16 & 0xffff;
  const w16Signed = w16Word & 0x8000 ? w16Word - 0x10000 : w16Word;
  renderFn(state, rom, dataPtr >>> 0, w16Signed | 0);

  for (let i = 0; i < SLOT_COUNT; i++) {
    if ((r[STATE_BASE_OFF + i] ?? 0) === 0) {
      const dOff = DATA_PTR_BASE_OFF + i * 4;
      const dp = dataPtr >>> 0;
      r[dOff] = (dp >>> 24) & 0xff;
      r[dOff + 1] = (dp >>> 16) & 0xff;
      r[dOff + 2] = (dp >>> 8) & 0xff;
      r[dOff + 3] = dp & 0xff;
      r[STATE_BASE_OFF + i] = 1;
      r[THRESHOLD_BASE_OFF + i * 2] = (threshold >>> 8) & 0xff;
      r[THRESHOLD_BASE_OFF + i * 2 + 1] = threshold & 0xff;
      r[WORD16_BASE_OFF + i * 2] = (w16Word >>> 8) & 0xff;
      r[WORD16_BASE_OFF + i * 2 + 1] = w16Word & 0xff;
      r[COUNTER_BASE_OFF + i * 2] = 0;
      r[COUNTER_BASE_OFF + i * 2 + 1] = 0;
      return 1;
    }
  }
  return 0;
}

export function scheduleStateMachine2(
  state: GameState,
  rom: import("./bus.js").RomImage,
  renderFn: (state: GameState, rom: import("./bus.js").RomImage, dataPtr: number, attrSigned: number) => number,
  dataPtr: number,
  word16: number,
  threshold: number,
): number {
  const r = state.workRam;
  const w16Word = word16 & 0xffff;
  const w16Signed = w16Word & 0x8000 ? w16Word - 0x10000 : w16Word;
  renderFn(state, rom, dataPtr >>> 0, w16Signed | 0);

  for (let i = 0; i < SLOT_COUNT; i++) {
    if ((r[STATE_BASE_OFF + i] ?? 0) === 0) {
      const dOff = DATA_PTR_BASE_OFF + i * 4;
      const dp = dataPtr >>> 0;
      r[dOff] = (dp >>> 24) & 0xff;
      r[dOff + 1] = (dp >>> 16) & 0xff;
      r[dOff + 2] = (dp >>> 8) & 0xff;
      r[dOff + 3] = dp & 0xff;
      r[STATE_BASE_OFF + i] = 2;
      r[THRESHOLD_BASE_OFF + i * 2] = (threshold >>> 8) & 0xff;
      r[THRESHOLD_BASE_OFF + i * 2 + 1] = threshold & 0xff;
      r[WORD16_BASE_OFF + i * 2] = (w16Word >>> 8) & 0xff;
      r[WORD16_BASE_OFF + i * 2 + 1] = w16Word & 0xff;
      r[FLAG30_BASE_OFF + i] = 1;
      r[COUNTER_BASE_OFF + i * 2] = 0;
      r[COUNTER_BASE_OFF + i * 2 + 1] = 0;
      return 1;
    }
  }
  return 0;
}

/**
 * Replica `FUN_000026C2` — `scheduleStateMachine5or6(dataPtr, word16, threshold)`.
 *
 * Render via FUN_2572 first, then schedule:
 *   - Find slot with state==0
 *   - threshold[i] = abs(threshold) (negate if negative)
 *   - state[i] = 6 if threshold < 0 signed, else 5
 *   - data[i] = dataPtr, word16[i] = word16, counter[i] = 0
 *   - Returns 1 if scheduled, 0 if all slots full
 */
export function scheduleStateMachine5or6(
  state: GameState,
  rom: import("./bus.js").RomImage,
  renderFn: (state: GameState, rom: import("./bus.js").RomImage, dataPtr: number, attrSigned: number) => number,
  dataPtr: number,
  word16: number,
  threshold: number,
): number {
  const r = state.workRam;
  // Render
  const w16Word = word16 & 0xffff;
  const w16Signed = w16Word & 0x8000 ? w16Word - 0x10000 : w16Word;
  renderFn(state, rom, dataPtr >>> 0, w16Signed | 0);

  const thWord = threshold & 0xffff;
  const thSigned = thWord & 0x8000 ? thWord - 0x10000 : thWord;
  const stateValue = thSigned < 0 ? 6 : 5;
  const thAbs = thSigned < 0 ? (-thSigned) >>> 0 : thSigned;

  for (let i = 0; i < SLOT_COUNT; i++) {
    if ((r[STATE_BASE_OFF + i] ?? 0) === 0) {
      // data[i] = dataPtr
      const dOff = DATA_PTR_BASE_OFF + i * 4;
      const dp = dataPtr >>> 0;
      r[dOff] = (dp >>> 24) & 0xff;
      r[dOff + 1] = (dp >>> 16) & 0xff;
      r[dOff + 2] = (dp >>> 8) & 0xff;
      r[dOff + 3] = dp & 0xff;
      // threshold[i] = thAbs (word, but stored full long via word write)
      r[THRESHOLD_BASE_OFF + i * 2] = (thAbs >>> 8) & 0xff;
      r[THRESHOLD_BASE_OFF + i * 2 + 1] = thAbs & 0xff;
      // state[i] = stateValue
      r[STATE_BASE_OFF + i] = stateValue & 0xff;
      // word16[i] = w16Word
      r[WORD16_BASE_OFF + i * 2] = (w16Word >>> 8) & 0xff;
      r[WORD16_BASE_OFF + i * 2 + 1] = w16Word & 0xff;
      // counter[i] = 0
      r[COUNTER_BASE_OFF + i * 2] = 0;
      r[COUNTER_BASE_OFF + i * 2 + 1] = 0;
      return 1;
    }
  }
  return 0;
}

/**
 * Replica `FUN_000028EA` — `scheduleStateMachine7(dataPtr, word16, target)`.
 *
 * Steps:
 *   - Set *0x401F3E (target word) = arg3
 *   - Call renderStringChain(dataPtr, sext_l(word16))  [side effect: writes alpha]
 *   - Find first slot with state==0
 *   - Set: data[i] = dataPtr, state[i] = 7, word16[i] = word16
 *
 * Side effects on workRam @ 0x401F3E + slot fields. Plus alpha tilemap from render.
 */
export function scheduleStateMachine7(
  state: GameState,
  rom: import("./bus.js").RomImage,
  renderFn: (state: GameState, rom: import("./bus.js").RomImage, dataPtr: number, attrSigned: number) => number,
  dataPtr: number,
  word16: number,
  target: number,
): void {
  const r = state.workRam;
  // *0x401F3E = target word
  r[0x1f3e] = (target >>> 8) & 0xff;
  r[0x1f3f] = target & 0xff;

  // Call render. arg2 is sext_l of word16 word.
  const word16Word = word16 & 0xffff;
  const word16Signed = word16Word & 0x8000 ? word16Word - 0x10000 : word16Word;
  renderFn(state, rom, dataPtr >>> 0, word16Signed | 0);

  // Find first free slot, fill state=7
  for (let i = 0; i < SLOT_COUNT; i++) {
    if ((r[STATE_BASE_OFF + i] ?? 0) === 0) {
      const dOff = DATA_PTR_BASE_OFF + i * 4;
      const dp = dataPtr >>> 0;
      r[dOff] = (dp >>> 24) & 0xff;
      r[dOff + 1] = (dp >>> 16) & 0xff;
      r[dOff + 2] = (dp >>> 8) & 0xff;
      r[dOff + 3] = dp & 0xff;
      r[STATE_BASE_OFF + i] = 7;
      r[WORD16_BASE_OFF + i * 2] = (word16Word >>> 8) & 0xff;
      r[WORD16_BASE_OFF + i * 2 + 1] = word16Word & 0xff;
      return;
    }
  }
}
