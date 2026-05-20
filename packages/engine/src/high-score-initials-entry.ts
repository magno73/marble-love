/**
 * high-score-initials-entry.ts - async browser/runtime high-score initials flow.
 *
 * This keeps the deterministic FUN_428E register tail, but delays it until the
 * player has changed and accepted the initials.
 */

import type { GameState } from "./state.js";
import { highScoreRegister428E } from "./high-score-register-428e.js";
import { as_u8, as_u16 } from "./wrap.js";

const WRAM = 0x00400000;
const INITIALS_LEN = 3;
const START_BUTTON = 0x01;
const MOVE_THRESHOLD = 8;
const MOVE_COOLDOWN_FRAMES = 6;
const INITIALS_ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export interface AdvanceHighScoreInitialsEntryOptions {
  p1X?: number;
  p1Y?: number;
  buttons?: number;
  registerScore?: (state: GameState, rank: number, recordAddr: number) => number;
  afterRegisterScore?: (
    state: GameState,
    objectAddr: number,
    rank: number,
    recordAddr: number,
    registerResult: number,
  ) => void;
}

export interface AdvanceHighScoreInitialsEntryResult {
  active: boolean;
  changed: boolean;
  accepted: boolean;
  registerResult: number | undefined;
}

function off(abs: number): number {
  return abs - WRAM;
}

function rb(state: GameState, abs: number): number {
  const o = off(abs);
  return o >= 0 && o < state.workRam.length ? (state.workRam[o] ?? 0) & 0xff : 0;
}

function wb(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  if (o >= 0 && o < state.workRam.length) state.workRam[o] = value & 0xff;
}

function normalizeInitial(value: number): number {
  let c = value & 0xff;
  if (c >= 0x61 && c <= 0x7a) c = (c - 0x20) & 0xff;
  if (c >= 0x41 && c <= 0x5a) return c;
  if (c === 0x20) return c;
  return 0x41;
}

function initialIndex(value: number): number {
  const c = String.fromCharCode(normalizeInitial(value));
  const idx = INITIALS_ALPHABET.indexOf(c);
  return idx >= 0 ? idx : INITIALS_ALPHABET.indexOf("A");
}

function signedByteDelta(current: number, previous: number): number {
  const delta = ((current & 0xff) - (previous & 0xff)) & 0xff;
  return delta & 0x80 ? delta - 0x100 : delta;
}

function changeInitial(state: GameState, recordAddr: number, cursor: number, direction: number): void {
  const addr = (recordAddr + 4 + cursor) >>> 0;
  const idx = initialIndex(rb(state, addr));
  const next = (idx + direction + INITIALS_ALPHABET.length) % INITIALS_ALPHABET.length;
  wb(state, addr, INITIALS_ALPHABET.charCodeAt(next));
}

function moveCursor(cursor: number, direction: number): number {
  return (cursor + direction + INITIALS_LEN) % INITIALS_LEN;
}

export function highScoreInitialsEntryActive(state: GameState): boolean {
  return state.clock.highScoreInitialsEntry !== undefined;
}

export function startHighScoreInitialsEntry(
  state: GameState,
  objectAddr: number,
  rank: number,
  recordAddr: number,
): boolean {
  if (state.clock.highScoreInitialsEntry !== undefined) return true;

  for (let i = 0; i < INITIALS_LEN; i++) {
    const addr = (recordAddr + 4 + i) >>> 0;
    wb(state, addr, normalizeInitial(rb(state, addr)));
  }

  state.clock.highScoreInitialsEntry = {
    objectAddr,
    rank: as_u8(rank & 0xff),
    recordAddr,
    cursor: as_u8(0),
    lastP1X: undefined,
    lastP1Y: undefined,
    previousButtons: as_u8(state.input.buttons),
    moveCooldown: as_u8(0),
    frames: as_u16(0),
  };
  return true;
}

export function advanceHighScoreInitialsEntry(
  state: GameState,
  options: AdvanceHighScoreInitialsEntryOptions = {},
): AdvanceHighScoreInitialsEntryResult {
  const entry = state.clock.highScoreInitialsEntry;
  if (entry === undefined) {
    return { active: false, changed: false, accepted: false, registerResult: undefined };
  }

  let changed = false;
  const p1X = (options.p1X ?? 0xff) & 0xff;
  const p1Y = (options.p1Y ?? 0xff) & 0xff;

  if (entry.lastP1X === undefined || entry.lastP1Y === undefined) {
    entry.lastP1X = as_u8(p1X);
    entry.lastP1Y = as_u8(p1Y);
  } else {
    const dx = signedByteDelta(p1X, entry.lastP1X);
    const dy = signedByteDelta(p1Y, entry.lastP1Y);
    entry.lastP1X = as_u8(p1X);
    entry.lastP1Y = as_u8(p1Y);

    if (entry.moveCooldown > 0) {
      entry.moveCooldown = as_u8(entry.moveCooldown - 1);
    } else if (Math.abs(dx) >= MOVE_THRESHOLD || Math.abs(dy) >= MOVE_THRESHOLD) {
      if (Math.abs(dy) >= Math.abs(dx)) {
        changeInitial(state, entry.recordAddr, entry.cursor, dy > 0 ? 1 : -1);
      } else {
        entry.cursor = as_u8(moveCursor(entry.cursor, dx < 0 ? 1 : -1));
      }
      entry.moveCooldown = as_u8(MOVE_COOLDOWN_FRAMES);
      changed = true;
    }
  }

  entry.frames = as_u16((entry.frames + 1) & 0xffff);

  const buttons = (options.buttons ?? state.input.buttons) & 0xff;
  const startPressed = (buttons & START_BUTTON) !== 0 && (entry.previousButtons & START_BUTTON) === 0;
  entry.previousButtons = as_u8(buttons);

  if (!startPressed) {
    return { active: true, changed, accepted: false, registerResult: undefined };
  }

  const registerResult = (options.registerScore ?? highScoreRegister428E)(
    state,
    entry.rank,
    entry.recordAddr,
  );
  options.afterRegisterScore?.(state, entry.objectAddr, entry.rank, entry.recordAddr, registerResult);
  state.clock.highScoreInitialsEntry = undefined;

  return { active: false, changed, accepted: true, registerResult };
}
