/**
 * level-intro-banner-resume.ts — warm-state continuation for true level starts.
 *
 * The checked-in startLevel seeds are MAME frame_done snapshots captured while
 * FUN_10504 is still inside its HUD/timer presentation loop. A raw warm-state
 * boot has RAM and alpha for the banner, but no CPU PC/resume stack, so the TS
 * main loop otherwise restarts from FUN_1101E and leaves the banner timer
 * parked. This cursor reproduces the visible FUN_10504 tail proven by the
 * MAME start-level captures without editing the seed RAM.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { stateSub2572 } from "./state-sub-2572.js";
import type { u16 } from "./wrap.js";
import { as_u16 } from "./wrap.js";

const PLAYER_TIMER_ABS = 0x00400082 as const;
const PLAYER_TIMER_OFF = 0x82 as const;
const PLAYER_OBJ_OFF = 0x18 as const;
const PLAYER_OBJ_STATE_OFF = PLAYER_OBJ_OFF + 0x18;
const PLAYER_OBJ_TYPE_OFF = PLAYER_OBJ_OFF + 0x1a;
const PLAYER_TIMER_MEDIUM_OFF = PLAYER_TIMER_OFF + 0x02;
const PLAYER_TIMER_PAD_OFF = PLAYER_TIMER_OFF + 0x03;
const PLAYER_TIMER_INNER_OFF = PLAYER_TIMER_OFF + 0x04;

const GAME_STATE_OFF = 0x390 as const;
const GAME_MODE_OFF = 0x392 as const;
const LEVEL_IDX_OFF = 0x394 as const;
const OBJ_COUNT_OFF = 0x396 as const;
const ATTRACT_SEGMENT_OFF = 0x3e4 as const;

const ALPHA_COLS = 64;
const CLEAR_START_ROW = 4;
const CLEAR_END_ROW_EXCLUSIVE = 0x1e;
const CLEAR_START_COL = 3;
const CLEAR_COL_COUNT = 0x24;
const BANNER_TIMER_ROW = 9;
const BANNER_TIMER_COL = 29;
const INTRO_HEADER_TIME_CHAIN = 0x0002291e as const;
const INTRO_HEADER_EXTRA_CHAIN = 0x00022942 as const;
const INTRO_RACE_NAME_PTR_TABLE = 0x0001f15e as const;
const INTRO_RACE_SUFFIX_PTR_TABLE = 0x0001f176 as const;
const BANNER_TIMER_BLANK_WORD = 0x353c;
const BANNER_TIMER_DIGIT_WORDS: readonly (readonly [number, number, number, number])[] = [
  [0x3500, 0x3501, 0x3502, 0x3503], // 0
  [0x3510, 0x3511, 0x3512, 0x3513], // 1
  [0x350c, 0x350d, 0x350e, 0x350f], // 2
  [0x3508, 0x3509, 0x350a, 0x350b], // 3
  [0x3504, 0x3505, 0x3506, 0x3507], // 4
  [0x3514, 0x3515, 0x3516, 0x3517], // 5
  [0x3518, 0x3519, 0x351a, 0x351b], // 6
] as const;

const LEVEL_EXTRA_TIME: readonly number[] = [
  60, // Practice
  60, // Beginner
  35, // Intermediate
  30, // Aerial
  20, // Silly
  20, // Ultimate
] as const;

const LEVEL_BANNER_PHRASES: readonly (readonly [number, string, string])[] = [
  [0, "TIME TO FINISH", "PRACTICE RACE"],
  [1, "TIME TO FINISH", "BEGINNER RACE"],
  [2, "EXTRA TIME FOR", "INTERMEDIATE RACE"],
  [3, "EXTRA TIME FOR", "AERIAL RACE"],
  [4, "EXTRA TIME FOR", "SILLY RACE"],
  [5, "EXTRA TIME FOR", "ULTIMATE RACE"],
] as const;

export type IntroBannerHudCallback = (timerPtr: number, idx: number) => void;

export interface ArmLevelIntroBannerResumeOptions {
  /** Carryover timer captured before runtime level init rebuilds obj0. */
  baseTimer?: number;
  /** ROM image used to redraw the level intro strings on runtime transitions. */
  rom?: RomImage;
  /**
   * Runtime level transitions enter through FUN_1101E state 3, not a warm seed,
   * so park the player timer while the presentation adds the bonus time.
   */
  parkTimer?: boolean;
}

function readWordBE(bytes: Uint8Array, off: number): number {
  return (((bytes[off] ?? 0) << 8) | (bytes[off + 1] ?? 0)) & 0xffff;
}

function writeWordBE(bytes: Uint8Array, off: number, value: number): void {
  const v = value & 0xffff;
  bytes[off] = (v >>> 8) & 0xff;
  bytes[off + 1] = v & 0xff;
}

function readRomLongBE(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>> 0
  );
}

function alphaLineIncludes(state: GameState, row: number, phrase: string): boolean {
  let line = "";
  for (let col = 0; col < ALPHA_COLS; col++) {
    const off = (row * ALPHA_COLS + col) * 2;
    const tile = state.alphaRam[off + 1] ?? 0;
    line += tile >= 0x20 && tile <= 0x7e ? String.fromCharCode(tile) : " ";
  }
  return line.toUpperCase().includes(phrase);
}

function hasLevelIntroBanner(state: GameState, levelIdx: number): boolean {
  const spec = LEVEL_BANNER_PHRASES.find(([level]) => level === levelIdx);
  if (spec === undefined) return false;
  const [, row9Phrase, row10Phrase] = spec;
  return (
    alphaLineIncludes(state, 9, row9Phrase) &&
    alphaLineIncludes(state, 10, row10Phrase)
  );
}

function matchesIntroWarmSeed(state: GameState): boolean {
  const r = state.workRam;
  const levelIdx = readWordBE(r, LEVEL_IDX_OFF);
  return (
    readWordBE(r, GAME_STATE_OFF) === 0 &&
    readWordBE(r, GAME_MODE_OFF) === 0 &&
    readWordBE(r, OBJ_COUNT_OFF) === 1 &&
    (r[ATTRACT_SEGMENT_OFF] ?? 0) === 2 &&
    (r[PLAYER_OBJ_STATE_OFF] ?? 0) === 1 &&
    (r[PLAYER_OBJ_TYPE_OFF] ?? 0) === 0 &&
    (r[PLAYER_TIMER_MEDIUM_OFF] ?? 0) === 9 &&
    (r[PLAYER_TIMER_PAD_OFF] ?? 0) === 5 &&
    (r[PLAYER_TIMER_INNER_OFF] ?? 0) === 0xff &&
    LEVEL_EXTRA_TIME[levelIdx] !== undefined &&
    hasLevelIntroBanner(state, levelIdx)
  );
}

function clearIntroAlphaArea(state: GameState): void {
  for (let row = CLEAR_START_ROW; row < CLEAR_END_ROW_EXCLUSIVE; row++) {
    for (let col = CLEAR_START_COL; col < CLEAR_START_COL + CLEAR_COL_COUNT; col++) {
      const off = (row * ALPHA_COLS + col) * 2;
      state.alphaRam[off] = 0;
      state.alphaRam[off + 1] = 0;
    }
  }
}

function writeAlphaWord(state: GameState, row: number, col: number, value: number): void {
  const off = (row * ALPHA_COLS + col) * 2;
  const word = value & 0xffff;
  state.alphaRam[off] = (word >>> 8) & 0xff;
  state.alphaRam[off + 1] = word & 0xff;
}

function writeBannerTimerDigit(state: GameState, col: number, digit: number | undefined): void {
  const words = digit === undefined ? undefined : BANNER_TIMER_DIGIT_WORDS[digit];
  const topLeft = words?.[0] ?? BANNER_TIMER_BLANK_WORD;
  const topRight = words?.[1] ?? BANNER_TIMER_BLANK_WORD;
  const bottomLeft = words?.[2] ?? BANNER_TIMER_BLANK_WORD;
  const bottomRight = words?.[3] ?? BANNER_TIMER_BLANK_WORD;
  writeAlphaWord(state, BANNER_TIMER_ROW, col, topLeft);
  writeAlphaWord(state, BANNER_TIMER_ROW, col + 1, topRight);
  writeAlphaWord(state, BANNER_TIMER_ROW + 1, col, bottomLeft);
  writeAlphaWord(state, BANNER_TIMER_ROW + 1, col + 1, bottomRight);
}

function updateBannerRemainingTimer(state: GameState, remaining: number): void {
  const clamped = Math.max(0, Math.min(99, remaining | 0));
  const tens = Math.floor(clamped / 10);
  const ones = clamped % 10;
  writeBannerTimerDigit(state, BANNER_TIMER_COL, tens === 0 ? undefined : tens);
  writeBannerTimerDigit(state, BANNER_TIMER_COL + 2, ones);
}

function renderLevelIntroBannerText(state: GameState, rom: RomImage, levelIdx: number): void {
  const headerChain = levelIdx < 2 ? INTRO_HEADER_TIME_CHAIN : INTRO_HEADER_EXTRA_CHAIN;
  const raceNameChain = readRomLongBE(rom, INTRO_RACE_NAME_PTR_TABLE + levelIdx * 4);
  const raceSuffixChain = readRomLongBE(rom, INTRO_RACE_SUFFIX_PTR_TABLE + levelIdx * 4);

  stateSub2572(state, rom, headerChain, 0x3000);
  stateSub2572(state, rom, raceNameChain, 0x3000);
  stateSub2572(state, rom, raceSuffixChain, 0x3400);
}

function clearResumeCursor(state: GameState): void {
  state.clock.levelIntroBannerResumeTick = undefined;
  state.clock.levelIntroBannerBaseTimer = undefined;
}

export function armLevelIntroBannerResume(
  state: GameState,
  options: ArmLevelIntroBannerResumeOptions = {},
): boolean {
  const levelIdx = readWordBE(state.workRam, LEVEL_IDX_OFF);
  const extraTime = LEVEL_EXTRA_TIME[levelIdx];
  if (extraTime === undefined) {
    clearResumeCursor(state);
    return false;
  }

  const baseTimer = options.baseTimer ?? readWordBE(state.workRam, PLAYER_TIMER_OFF);
  writeWordBE(state.workRam, PLAYER_TIMER_OFF, baseTimer);
  state.clock.levelIntroBannerResumeTick = as_u16(0);
  state.clock.levelIntroBannerBaseTimer = as_u16(baseTimer);
  if (options.parkTimer === true) {
    state.workRam[PLAYER_TIMER_MEDIUM_OFF] = 9;
    state.workRam[PLAYER_TIMER_PAD_OFF] = 5;
    state.workRam[PLAYER_TIMER_INNER_OFF] = 0xff;
  }
  if (options.rom !== undefined) {
    clearIntroAlphaArea(state);
    renderLevelIntroBannerText(state, options.rom, levelIdx);
  }
  updateBannerRemainingTimer(state, extraTime);
  return true;
}

/**
 * Advance the proven FUN_10504 intro-banner tail by one rendered frame.
 *
 * MAME proof cadence for all six true-start seeds:
 *   - add 5 seconds on tick 1, then every 10 ticks
 *   - repeat until the level-specific extra-time amount has been added
 *   - wait out the remaining presentation delay, then clear rows 4..29 and
 *     arm the normal cascading player timer by setting obj0 timer inner to 5
 */
export function advanceLevelIntroBannerResume(
  state: GameState,
  hudCallback?: IntroBannerHudCallback,
): void {
  if (state.clock.levelIntroBannerResumeTick === undefined) {
    // Only auto-arm immediately after a warm-state boot. Live route tests can
    // later pass through visually similar level-start RAM, but those frames
    // are owned by the normal dispatcher rather than a lost warm-state PC.
    if (state.clock.frame > 1) return;
    if (!matchesIntroWarmSeed(state)) return;
    armLevelIntroBannerResume(state);
  }

  const levelIdx = readWordBE(state.workRam, LEVEL_IDX_OFF);
  const extraTime = LEVEL_EXTRA_TIME[levelIdx];
  if (extraTime === undefined) {
    clearResumeCursor(state);
    return;
  }
  const baseTimer = state.clock.levelIntroBannerBaseTimer ?? as_u16(readWordBE(state.workRam, PLAYER_TIMER_OFF));
  state.clock.levelIntroBannerBaseTimer = baseTimer;
  const targetTimer = (baseTimer + extraTime) & 0xffff;

  const resumeTick = state.clock.levelIntroBannerResumeTick;
  if (resumeTick === undefined) return;
  const tick = ((resumeTick + 1) & 0xffff) as u16;
  state.clock.levelIntroBannerResumeTick = tick;

  const increments = extraTime / 5;
  if (tick >= 1 && (tick - 1) % 10 === 0 && (tick - 1) / 10 < increments) {
    writeWordBE(state.workRam, PLAYER_TIMER_OFF, readWordBE(state.workRam, PLAYER_TIMER_OFF) + 5);
    updateBannerRemainingTimer(state, Math.max(0, targetTimer - readWordBE(state.workRam, PLAYER_TIMER_OFF)));
    hudCallback?.(PLAYER_TIMER_ABS, 0);
  }

  const clearTick = 61 + extraTime;
  if (tick >= clearTick) {
    clearIntroAlphaArea(state);
    writeWordBE(state.workRam, GAME_STATE_OFF, 1);
    state.workRam[PLAYER_TIMER_INNER_OFF] = 5;
    hudCallback?.(PLAYER_TIMER_ABS, 0);
    clearResumeCursor(state);
  }
}
