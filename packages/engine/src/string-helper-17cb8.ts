/**
 * string-helper-17cb8.ts — replica `FUN_00017CB8`.
 *
 * Despite the string-range address, this routine is a short line-of-sight /
 * proximity helper. It scans three object pools and returns the pool tag of
 * the first active object close enough to a target point.
 */

import type { GameState } from "./state.js";

const WRAM = 0x00400000;

export const STRING_HELPER_17CB8_ADDR = 0x00017cb8 as const;

function off(abs: number): number {
  return abs - WRAM;
}

function rb(state: GameState, abs: number): number {
  return state.workRam[off(abs)] ?? 0;
}

function rw(state: GameState, abs: number): number {
  const o = off(abs);
  return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
}

function wl(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value >>> 0;
  state.workRam[o] = (v >>> 24) & 0xff;
  state.workRam[o + 1] = (v >>> 16) & 0xff;
  state.workRam[o + 2] = (v >>> 8) & 0xff;
  state.workRam[o + 3] = v & 0xff;
}

function toS16(value: number): number {
  const w = value & 0xffff;
  return (w & 0x8000) !== 0 ? w - 0x10000 : w;
}

function absWordDelta(value: number): number {
  const s = toS16(value);
  return s < 0 ? (-s >>> 0) & 0xffff : s & 0xffff;
}

function metric(dxAbs: number, dyAbs: number): number {
  const dx = (dxAbs << 4) & 0xffff;
  const dy = (dyAbs << 4) & 0xffff;
  return dx > dy ? (((dy >>> 3) & 0xffff) * 3 + dx) >>> 0 : (((dx >>> 3) & 0xffff) * 3 + dy) >>> 0;
}

function hitObject(state: GameState, objAbs: number, targetX: number, targetY: number, range: number): boolean {
  if (rb(state, objAbs + 0x18) === 0) return false;

  const dxAbs = absWordDelta((rw(state, objAbs + 0x0c) - (targetX & 0xffff)) & 0xffff);
  if ((dxAbs >>> 3) > 3) return false;

  const dyAbs = absWordDelta((rw(state, objAbs + 0x10) - (targetY & 0xffff)) & 0xffff);
  if ((dyAbs >>> 3) > 3) return false;

  return ((range & 0xffff) >>> 0) > metric(dxAbs, dyAbs);
}

function scanPool(
  state: GameState,
  base: number,
  count: number,
  stride: number,
  targetX: number,
  targetY: number,
  range: number,
  skipObj: number | null,
): number {
  let obj = base >>> 0;
  for (let i = 0; i < count; i++) {
    if (skipObj === null || obj !== (skipObj >>> 0)) {
      if (hitObject(state, obj, targetX, targetY, range)) return i;
    }
    obj = (obj + stride) >>> 0;
  }
  return -1;
}

export function stringHelper17CB8(
  state: GameState,
  objPtr: number,
  targetX: number,
  targetY: number,
  range: number,
): number {
  const hit0 = scanPool(state, 0x00400018, rw(state, 0x00400396), 0x00e2, targetX, targetY, range, objPtr);
  if (hit0 >= 0) {
    wl(state, 0x0040046a, hit0);
    return 1;
  }

  const hit1 = scanPool(state, 0x004009a4, 2, 0x007c, targetX, targetY, range, null);
  if (hit1 >= 0) {
    wl(state, 0x0040046a, hit1);
    return 2;
  }

  const hit2 = scanPool(state, 0x00401302, 4, 0x0060, targetX, targetY, range, null);
  if (hit2 >= 0) {
    wl(state, 0x0040046a, hit2);
    return 4;
  }

  return 0;
}

export { stringHelper17CB8 as FUN_00017CB8 };
