/**
 * Bit-perfect port of `FUN_0001D1EC`.
 *
 * This entity helper advances a script cursor when the entity's coarse cell
 * position matches the waypoint encoded at the current cursor. The X and Y
 * positions are arithmetic-shifted right by 19 and compared as low words
 * against two signed cursor bytes. On a match, cursor byte 2 is treated as a
 * signed relative step and the cursor becomes `base + step * 4`.
 *
 * The original routine always tail-calls `FUN_0001D242(entityPtr)` after the
 * optional cursor advance. Parity is covered by the corresponding CLI parity
 * probe with the follow-up routine stubbed where needed.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { sub1D242 } from "./sub-1d242.js";

const WORK_RAM_BASE = 0x00400000 as const;
const WORK_RAM_END = 0x00402000 as const;

/** Stub injection for the JSR to `0x1D242`. */
export interface EntityWaypointStep1D1ECSubs {
  fun_1d242?: (entityPtr: number) => void;
}

/** Read a big-endian long from workRam given an absolute address. */
function readLongAbs(state: GameState, addr: number): number {
  const off = (addr - 0x400000) >>> 0;
  const r = state.workRam;
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

function readByteAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return state.workRam[a - WORK_RAM_BASE] ?? 0;
  if (rom !== undefined && a < rom.program.length) return rom.program[a] ?? 0;
  return 0;
}

/** Read signed byte from workRam/ROM at absolute address. */
function readSByteAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  const v = readByteAbs(state, rom, addr);
  return v & 0x80 ? v - 0x100 : v;
}

/** Write a big-endian long to workRam at absolute address. */
function writeLongAbs(state: GameState, addr: number, value: number): void {
  const off = (addr - 0x400000) >>> 0;
  const r = state.workRam;
  const v = value >>> 0;
  r[off] = (v >>> 24) & 0xff;
  r[off + 1] = (v >>> 16) & 0xff;
  r[off + 2] = (v >>> 8) & 0xff;
  r[off + 3] = v & 0xff;
}

/** Signed 32-bit `asr.l`, with the count masked as the 68k does. */
function asrL(value: number, count: number): number {
  const c = count & 0x3f;
  return ((value | 0) >> c) | 0;
}

/**
 * Advance the entity cursor when the current waypoint matches the entity cell.
 *
 * @param entityPtr Absolute pointer to the entity struct.
 * @param subs Optional stub for the follow-up `fun_1d242` call.
 */
export function entityWaypointStep1D1EC(
  state: GameState,
  entityPtr: number,
  subs?: EntityWaypointStep1D1ECSubs,
  rom?: RomImage,
): void {
  const a0 = entityPtr >>> 0;

  // D1 = pos.X long; D1 = asr.l 19; D2.w = D1 low word
  const posX = readLongAbs(state, a0 + 0x0c);
  const cellX = asrL(posX, 0x13) & 0xffff; // word

  const posY = readLongAbs(state, a0 + 0x10);
  const cellY = asrL(posY, 0x13) & 0xffff; // word

  // A1 = cursor; D0 = ext.w(cursor[0])
  const cursor = readLongAbs(state, a0 + 0x2c);
  const c0 = readSByteAbs(state, rom, cursor + 0) & 0xffff; // ext.w → low word

  // cmp.w D2w,D0w; bne → skip
  if (c0 === cellX) {
    const c1 = readSByteAbs(state, rom, cursor + 1) & 0xffff; // ext.w
    if (c1 === cellY) {
      // ext.w → ext.l → asl.l #2 → +base → store
      const stepB = readSByteAbs(state, rom, cursor + 2); // signed byte
      const stepL = (stepB << 2) | 0; // ext.l + asl.l #2 (signed * 4)
      const base = readLongAbs(state, a0 + 0x30);
      const newCursor = (base + stepL) >>> 0;
      writeLongAbs(state, a0 + 0x2c, newCursor);
    }
  }

  if (subs?.fun_1d242 !== undefined) {
    subs.fun_1d242(a0);
  } else {
    sub1D242(state, a0, rom);
  }
}
