/**
 * high-score-register-428e.ts - replica `FUN_0000428E`.
 *
 * Inserts one score/initials record into the 10-row high-score table at
 * `*0x401FFC + 0x1E`. The caller passes the target rank and a record pointer
 * whoif theyout is a 4-byte score followed by 3 ASCII initials.
 */

import type { GameState } from "./state.js";

const WRAM = 0x00400000;
const PTR_FFC_OFF = 0x1ffc;
const TABLE_OFF_FROM_PTR = 0x1e;
const RECORD_STRIDE = 5;
const RECORD_COUNT = 10;
const TABLE_BYTES = RECORD_STRIDE * RECORD_COUNT;

function off(abs: number): number {
  return abs - WRAM;
}

function rb(state: GameState, abs: number): number {
  const o = off(abs);
  if (o < 0 || o >= state.workRam.length) return 0;
  return (state.workRam[o] ?? 0) & 0xff;
}

function readU32Off(ram: Uint8Array, offset: number): number {
  return ((((ram[offset] ?? 0) << 24) |
    ((ram[offset + 1] ?? 0) << 16) |
    ((ram[offset + 2] ?? 0) << 8) |
    (ram[offset + 3] ?? 0)) >>> 0);
}

function asciiToRadix40(value: number): number {
  let c = value & 0xff;
  if (c >= 0x61) c = (c - 0x20) & 0xff;
  if (c >= 0x41 && c <= 0x5a) return c - 0x40;
  if (c === 0x20) return 0;
  const digit = (c - 0x15) & 0xff;
  return digit <= 0x27 ? digit : 0;
}

function tableBaseOff(state: GameState): number {
  const ptr = readU32Off(state.workRam, PTR_FFC_OFF);
  return (ptr - WRAM + TABLE_OFF_FROM_PTR) | 0;
}

/**
 * Replica `FUN_0000428E`.
 *
 * @returns Binary D0 value: `-1` for rank out of range, `-2` if the source
 *          score exceeded 24 bits and was clamped, otherwise `0`.
 */
export function highScoreRegister428E(
  state: GameState,
  rank: number,
  recordAddr: number,
): number {
  const rankLong = rank >>> 0;
  if (rankLong > 9) {
    return -1;
  }

  const recordOff = off(recordAddr >>> 0);
  let score = readU32Off(state.workRam, recordOff);
  let overflowed = false;
  if (score > 0x00ffffff) {
    score = 0x01ffffff;
    overflowed = true;
  }

  const bytes = new Uint8Array(RECORD_STRIDE);
  bytes[0] = (score >>> 16) & 0xff;
  bytes[1] = (score >>> 8) & 0xff;
  bytes[2] = score & 0xff;

  let initials = 0;
  for (let i = 0; i < 3; i++) {
    initials = ((initials * 40) + asciiToRadix40(rb(state, (recordAddr + 4 + i) >>> 0))) & 0xffff;
  }
  bytes[3] = (initials >>> 8) & 0xff;
  bytes[4] = initials & 0xff;

  const base = tableBaseOff(state);
  const insert = rankLong * RECORD_STRIDE;
  for (let src = TABLE_BYTES - RECORD_STRIDE - 1; src >= insert; src--) {
    state.workRam[base + src + RECORD_STRIDE] = state.workRam[base + src] ?? 0;
  }
  for (let i = 0; i < RECORD_STRIDE; i++) {
    state.workRam[base + insert + i] = bytes[i] ?? 0;
  }

  return overflowed ? -2 : 0;
}

export { highScoreRegister428E as FUN_0000428E };
