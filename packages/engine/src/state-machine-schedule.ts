/**
 * state-machine-schedule.ts — `FUN_00002BDA` (134 byte) e `FUN_00002C60` (116 byte).
 *
 * Sub di FUN_2E18: schedule un nuovo job nel state machine slot array.
 *
 * - **FUN_2BDA — `scheduleStateMachine3(dataPtr, word16, threshold)`**:
 *   trova primo slot con state==0 e lo riempie con state=3.
 * - **FUN_2C60 — `scheduleStateMachine4(dataPtr, threshold)`**:
 *   come sopra ma state=4, no word16.
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
