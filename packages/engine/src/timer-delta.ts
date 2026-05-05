/**
 * timer-delta.ts — `FUN_000043D6` (74 byte): timer delta accumulator.
 *
 * Reads frame timer @ 0x401FF8, computes delta from prev (saved @ 0x401F82),
 * accumulates into 3 fields based on control byte bits @ 0x401F81.
 *
 * Layout:
 *   *0x401F82 = prev timer (long, will be updated)
 *   *0x401F86 = optional accumulator (if bit 0)
 *   *0x401F8A = optional accumulator (if bit 1)
 *   *0x401F8E = always accumulated
 *   *0x401F81 = control byte (set to arg1.b after)
 *
 * Returns: address of *0x401F86 (= 0x401F82 + 4)
 */

import type { GameState } from "./state.js";

function readU32(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>> 0
  );
}
function writeU32(state: GameState, off: number, v: number): void {
  const x = v >>> 0;
  state.workRam[off] = (x >>> 24) & 0xff;
  state.workRam[off + 1] = (x >>> 16) & 0xff;
  state.workRam[off + 2] = (x >>> 8) & 0xff;
  state.workRam[off + 3] = x & 0xff;
}

const PREV_OFF = 0x1f82;
const FLAG_OFF = 0x1f81;
const TIMER_OFF = 0x1ff8;

export function timerDeltaAccumulate(state: GameState, controlByte: number): number {
  const r = state.workRam;
  const d2 = readU32(state, PREV_OFF); // prev
  const d0 = readU32(state, TIMER_OFF); // current
  writeU32(state, PREV_OFF, d0);
  const delta = (d0 - d2) >>> 0; // unsigned long sub

  const flag = r[FLAG_OFF] ?? 0;
  if (flag & 0x01) {
    const cur = readU32(state, PREV_OFF + 4);
    writeU32(state, PREV_OFF + 4, (cur + delta) >>> 0);
  }
  if (flag & 0x02) {
    const cur = readU32(state, PREV_OFF + 8);
    writeU32(state, PREV_OFF + 8, (cur + delta) >>> 0);
  }
  // Always +0xC
  const cur12 = readU32(state, PREV_OFF + 0xC);
  writeU32(state, PREV_OFF + 0xC, (cur12 + delta) >>> 0);
  // *A1 = D1.b
  r[FLAG_OFF] = controlByte & 0xff;
  // Return A0+4 = 0x401F86
  return ((0x400000 + PREV_OFF + 4) >>> 0);
}
