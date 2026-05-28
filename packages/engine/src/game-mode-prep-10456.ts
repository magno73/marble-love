/**
 * Bit-perfect port of `FUN_00010456`.
 *
 *   - MainLoopInit1101ESubs.gameModePrep10456 (main-loop-init-1101e.ts)
 *   - MainLoopInit11452Subs.gameModePrep10456 (main-loop-init-11452.ts)
 *
 *
 * Main operations:
 *   1. For each of the two object slots (0x400018, 0x4000fa):
 *      - clr.l slot+0xbc, clr.w slot+0xd2
 *      - if i < [0x400396].w signed, set slot+0x18=3 and slot+0x1a=6
 *      [0x4003a4]=0xff, [0x4003ba]=0, [0x4003e0]=0,
 *      [0x400010].l=0, [0x4003e8]=1
 *   3. Masking: [0x400398] = [0x4003dc] & 0x30
 */

import type { GameState } from "./state.js";

export const GAME_MODE_PREP_10456_ADDR = 0x00010456 as const;

const WRAM = 0x00400000;

function off(addr: number): number {
  return addr - WRAM;
}

function rb(state: GameState, addr: number): number {
  return state.workRam[off(addr)] ?? 0;
}

function wb(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = value & 0xff;
}

function rw(state: GameState, addr: number): number {
  return (((state.workRam[off(addr)] ?? 0) << 8) | (state.workRam[off(addr) + 1] ?? 0)) & 0xffff;
}

function ww(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = (value >>> 8) & 0xff;
  state.workRam[off(addr) + 1] = value & 0xff;
}

function wl(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = (value >>> 24) & 0xff;
  state.workRam[off(addr) + 1] = (value >>> 16) & 0xff;
  state.workRam[off(addr) + 2] = (value >>> 8) & 0xff;
  state.workRam[off(addr) + 3] = value & 0xff;
}

/** Base address of object slot `index` (0 or 1). Each slot is 0xe2 bytes. */
function objectSlotAddr(index: number): number {
  return 0x00400018 + index * 0xe2;
}

/**
 * Port of `FUN_00010456`.
 */
export function gameModePrep10456(state: GameState): void {
  const mode = rw(state, 0x00400396);
  // Interpret as signed 16-bit for the M68k `bge` comparison.
  const modeSigned = mode >= 0x8000 ? mode - 0x10000 : mode;

  for (let i = 0; i < 2; i++) {
    const slotBase = objectSlotAddr(i);

    // clr.l (0xbc, A1)
    wl(state, slotBase + 0xbc, 0);
    // clr.w (0xd2, A1)
    ww(state, slotBase + 0xd2, 0);
    // move.b D2, (0x19, A1) — write slot index
    wb(state, slotBase + 0x19, i);

    // cmp.w [0x400396], D0w  then bge → clr.b (0x18, A1)
    // D0w = ext.w(i) = i  (i is 0 or 1, sign extension is no-op)
    const iSigned = i; // i is 0 or 1, always positive
    if (iSigned < modeSigned) {
      // Slot is "active" for this player count
      wb(state, slotBase + 0x18, 3);
      wb(state, slotBase + 0x1a, 6);
    } else {
      wb(state, slotBase + 0x18, 0);
    }

    // Write 0xff to [0x40098c + i*12 + 0x0a]
    // (A0 = 0x40098c, D0 = i*12, displacement = 0xa)
    wb(state, 0x0040098c + i * 12 + 0x0a, 0xff);
  }

  // Post-loop globals
  wb(state, 0x004003a4, 0xff);
  wb(state, 0x004003ba, 0);
  wb(state, 0x004003e0, 0);
  wl(state, 0x00400010, 0);
  wb(state, 0x004003e8, 1);

  // [0x400398] = [0x4003dc] & 0x30
  const dc = rb(state, 0x004003dc);
  wb(state, 0x00400398, dc & 0x30);

  // clr three consecutive bytes
  wb(state, 0x00400658, 0);
  wb(state, 0x00400656, 0);
  wb(state, 0x00400654, 0);
}
