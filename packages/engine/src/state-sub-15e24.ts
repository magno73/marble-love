/**
 * state-sub-15e24.ts — partial replica of `FUN_00015E24`.
 *
 * This handler is reached from `FUN_15DB6` after the current target-grid
 * comparison. Its important side effect for the seek path is conditional:
 * only the incoming match flag, or a state change inside this routine, causes
 * the speed timer refresh and the `FUN_1605C` target-pointer dispatch.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { helper15FE6 } from "./helper-15fe6.js";
import { objectEnterState23 } from "./object-enter-state-23.js";
import { stateDispatch1605C } from "./state-dispatch-1605c.js";

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

const OBJ_BASE = 0x00400018;
const OBJ_STRIDE = 0xe2;
const OBJ_COUNT_ADDR = 0x00400396;
const OBJ_PTR_TABLE = 0x0001eff6;

const F_X = 0x0c;
const F_Y = 0x10;
const F_ACTIVE = 0x18;
const F_INDEX = 0x19;
const F_KIND = 0x1a;
const F_LAYER = 0x1b;
const F_36 = 0x36;
const F_68 = 0x68;
const F_6C = 0x6c;
const F_CURRENT = 0x6e;
const F_BASE = 0x72;
const F_TARGET_INDEX = 0x7a;

function inWorkRam(addr: number, len = 1): boolean {
  const a = addr >>> 0;
  return a >= WORK_RAM_BASE && a + len <= WORK_RAM_BASE + WORK_RAM_SIZE;
}

function rb(state: GameState, addr: number): number {
  if (!inWorkRam(addr)) return 0;
  return state.workRam[(addr - WORK_RAM_BASE) >>> 0] ?? 0;
}

function rw(state: GameState, addr: number): number {
  if (!inWorkRam(addr, 2)) return 0;
  const off = (addr - WORK_RAM_BASE) >>> 0;
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) >>> 0;
}

function rl(state: GameState, addr: number): number {
  if (!inWorkRam(addr, 4)) return 0;
  const off = (addr - WORK_RAM_BASE) >>> 0;
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function wb(state: GameState, addr: number, value: number): void {
  if (!inWorkRam(addr)) return;
  state.workRam[(addr - WORK_RAM_BASE) >>> 0] = value & 0xff;
}

function ww(state: GameState, addr: number, value: number): void {
  if (!inWorkRam(addr, 2)) return;
  const off = (addr - WORK_RAM_BASE) >>> 0;
  const v = value & 0xffff;
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function wl(state: GameState, addr: number, value: number): void {
  if (!inWorkRam(addr, 4)) return;
  const off = (addr - WORK_RAM_BASE) >>> 0;
  const v = value >>> 0;
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (inWorkRam(a)) return rb(state, a);
  if (a < rom.program.length) return rom.program[a] ?? 0;
  return 0;
}

function romLong(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a + 3 >= rom.program.length) return 0;
  return (
    (((rom.program[a] ?? 0) << 24) |
      ((rom.program[a + 1] ?? 0) << 16) |
      ((rom.program[a + 2] ?? 0) << 8) |
      (rom.program[a + 3] ?? 0)) >>>
    0
  );
}

function sextB(v: number): number {
  return ((v & 0xff) << 24) >> 24;
}

function sextW(v: number): number {
  return ((v & 0xffff) << 16) >> 16;
}

function absL(v: number): number {
  const s = v | 0;
  return s < 0 ? (-s | 0) : s;
}

function octantDistance(dx: number, dy: number): number {
  const ax = (absL(dx) >> 12) & 0xffff;
  const ay = (absL(dy) >> 12) & 0xffff;
  if (ax > ay) return ((((ay >>> 3) & 0xffff) * 3) + ax) | 0;
  return ((((ax >>> 3) & 0xffff) * 3) + ay) | 0;
}

function advance160AE(state: GameState, rom: RomImage, structPtr: number, idxLong: number): void {
  const current = rl(state, structPtr + F_CURRENT);
  const base = rl(state, structPtr + F_BASE);
  const idx = idxLong & 0xffff;
  const stride = sextB(readByteAbs(state, rom, current + 2 + idx));
  wl(state, structPtr + F_CURRENT, (base + stride * 6) >>> 0);
}

function fun15C46(state: GameState, rom: RomImage, structPtr: number): number {
  const targetSlot = romLong(rom, OBJ_PTR_TABLE + (sextW(rw(state, structPtr + F_TARGET_INDEX)) << 2));
  const targetX = rl(state, targetSlot + F_X) | 0;
  const targetY = rl(state, targetSlot + F_Y) | 0;
  const current = rl(state, structPtr + F_CURRENT);
  const base = rl(state, structPtr + F_BASE);

  let bestIdx = 0;
  let bestDist = 0x7fffffff;
  for (let idx = 0; idx < 4; idx++) {
    const stride = sextB(readByteAbs(state, rom, current + 2 + idx));
    const ptr = (base + stride * 6) >>> 0;
    const candidateX = (sextB(readByteAbs(state, rom, ptr)) << 19) | 0;
    const candidateY = (sextB(readByteAbs(state, rom, ptr + 1)) << 19) | 0;
    const dist = octantDistance((candidateX - targetX) | 0, (candidateY - targetY) | 0);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

function speedForKind(kind: number): number {
  if (kind === 0x21) return 0x000c0000;
  if (kind === 0x22) return 0x00080000;
  if (kind === 0x20 || kind === 0x23) return 0x00070000;
  return 0;
}

export function stateSub15E24(
  state: GameState,
  rom: RomImage,
  structPtr: number,
  flagLong: number,
): void {
  const a2 = structPtr >>> 0;
  const oldKind = rb(state, a2 + F_KIND);
  let dispatchFlag = sextB(flagLong) !== 0 ? 1 : 0;
  const count = rw(state, OBJ_COUNT_ADDR);
  let remainingByte = rb(state, OBJ_COUNT_ADDR + 1);
  let candidate = 0;

  for (let i = 0; i < count; i++) {
    const obj = (OBJ_BASE + i * OBJ_STRIDE) >>> 0;
    if (rb(state, obj + F_ACTIVE) !== 1) continue;
    if (rb(state, obj + F_LAYER) !== rb(state, a2 + F_LAYER)) continue;
    if (rb(state, obj + F_36) === 2) continue;
    const kind = rb(state, obj + F_KIND);
    if (kind !== 0 && kind !== 1 && kind !== 5) continue;
    remainingByte = (remainingByte - 1) & 0xff;
    candidate = obj;
  }

  if ((sextB(remainingByte) & 0xffff) !== (count & 0xffff)) {
    if (count === 2 && remainingByte === 0) {
      const obj0 = OBJ_BASE;
      const obj1 = (OBJ_BASE + OBJ_STRIDE) >>> 0;
      candidate = helper15FE6(state, obj0, obj1) !== 0 ? obj1 : obj0;
    }

    ww(state, a2 + F_TARGET_INDEX, sextB(rb(state, candidate + F_INDEX)) & 0xffff);

    const dist = octantDistance(
      ((rl(state, candidate + F_X) | 0) - (rl(state, a2 + F_X) | 0)) | 0,
      ((rl(state, candidate + F_Y) | 0) - (rl(state, a2 + F_Y) | 0)) | 0,
    );

    if (
      dist < 0x280 &&
      (rl(state, a2 + F_6C) !== 0 || rb(state, a2 + F_LAYER) === 7 || rb(state, a2 + F_LAYER) === 9) &&
      rb(state, a2 + F_36) === 0
    ) {
      wb(state, a2 + F_KIND, 0x21);
    } else if (rl(state, a2 + F_6C) !== 0) {
      wb(state, a2 + F_KIND, 0x22);
    } else if (rb(state, a2 + F_KIND) !== 0x23) {
      wb(state, a2 + F_KIND, 0x20);
    }
  }

  const newKind = rb(state, a2 + F_KIND);
  if (oldKind !== newKind) {
    if (oldKind === 0x21) {
      objectEnterState23(state, a2);
    } else {
      dispatchFlag = 1;
    }
  }

  if (dispatchFlag !== 0) {
    wl(state, a2 + F_68, speedForKind(rb(state, a2 + F_KIND)));
    stateDispatch1605C(state, a2, {
      fun_15c46: (ptr) => fun15C46(state, rom, ptr),
      fun_160ae: (ptr, idx) => advance160AE(state, rom, ptr, idx),
    });
  }
}
