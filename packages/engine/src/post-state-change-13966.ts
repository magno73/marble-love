/**
 * post-state-change-13966.ts — replica `FUN_00013966`.
 *
 * Hook chiamato quando cambia `obj[0x1B]`. In mode 3 arma la slot-table
 * secondaria `0x401650` tramite `FUN_186AC` e rilancia eventuali script slot
 * legati al nuovo stato. Questo e' il caller ROM dei pistoni tipo `0x29`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { stateSub186AC } from "./state-sub-186ac.js";
import { deriveSpriteFromArg_v2 } from "./sprite-derive.js";
import { helper18F46 } from "./helper-18f46.js";
import { helper12896 } from "./helper-12896.js";
import { soundCmdSend158AC } from "./sound-cmd-send-158ac.js";

const WORK_RAM_BASE = 0x00400000 as const;

const GAME_MODE_ADDR = 0x00400394 as const;
const FLAG_ADDR = 0x0040076a as const;
const MODE3_TIMER_ADDR = 0x00400768 as const;

const OBJ_NEW_STATE_OFF = 0x1b as const;

const SLOT_ARRAY_BASE = 0x00400a9c as const;
const SLOT_STRIDE = 0x56 as const;
const SLOT_COUNT = 0x19 as const;
const SLOT_ACTIVE_OFF = 0x18 as const;
const SLOT_STATE_OFF = 0x1a as const;
const SLOT_NEW_STATE_OFF = 0x1b as const;
const SLOT_KIND_OFF = 0x1f as const;
const SLOT_PC_OFF = 0x36 as const;

const ROM_SCRIPT_SOUND_TABLE = 0x0001ef42 as const;

const MODE_3 = 0x0003 as const;
const MODE_4 = 0x0004 as const;

export interface PostStateChange13966Subs {
  soundCommand?: (state: GameState, cmd: number) => void;
  stateSub186AC?: (state: GameState, rom: RomImage) => void;
  helper12896?: (state: GameState, rom: RomImage, slotPtr: number) => void;
}

export interface PostStateChange13966Result {
  gameMode: number;
  stateSub186ACCalled: boolean;
  scriptSlotsTriggered: number;
  soundCommands: number[];
}

function off(abs: number): number {
  return abs - WORK_RAM_BASE;
}

function rb(state: GameState, abs: number): number {
  const addr = abs >>> 0;
  if (addr < WORK_RAM_BASE || addr >= WORK_RAM_BASE + state.workRam.length) return 0;
  return (state.workRam[off(addr)] ?? 0) & 0xff;
}

function wb(state: GameState, abs: number, value: number): void {
  const addr = abs >>> 0;
  if (addr < WORK_RAM_BASE || addr >= WORK_RAM_BASE + state.workRam.length) return;
  state.workRam[off(addr)] = value & 0xff;
}

function rw(state: GameState, abs: number): number {
  const addr = abs >>> 0;
  if (addr < WORK_RAM_BASE || addr + 1 >= WORK_RAM_BASE + state.workRam.length) return 0;
  const o = off(addr);
  return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
}

function ww(state: GameState, abs: number, value: number): void {
  const addr = abs >>> 0;
  if (addr < WORK_RAM_BASE || addr + 1 >= WORK_RAM_BASE + state.workRam.length) return;
  const o = off(addr);
  const v = value & 0xffff;
  state.workRam[o] = (v >>> 8) & 0xff;
  state.workRam[o + 1] = v & 0xff;
}

function wl(state: GameState, abs: number, value: number): void {
  const addr = abs >>> 0;
  if (addr < WORK_RAM_BASE || addr + 3 >= WORK_RAM_BASE + state.workRam.length) return;
  const o = off(addr);
  const v = value >>> 0;
  state.workRam[o] = (v >>> 24) & 0xff;
  state.workRam[o + 1] = (v >>> 16) & 0xff;
  state.workRam[o + 2] = (v >>> 8) & 0xff;
  state.workRam[o + 3] = v & 0xff;
}

function romLong(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a + 3 >= rom.program.length) return 0;
  return (
    ((rom.program[a] ?? 0) << 24) |
    ((rom.program[a + 1] ?? 0) << 16) |
    ((rom.program[a + 2] ?? 0) << 8) |
    (rom.program[a + 3] ?? 0)
  ) >>> 0;
}

function sext8(value: number): number {
  return ((value & 0xff) << 24) >> 24;
}

function defaultStateSub186AC(state: GameState, rom: RomImage): void {
  stateSub186AC(state, rom, {
    fun_1bb28: (entryAddr, st) => {
      deriveSpriteFromArg_v2(st, entryAddr);
    },
    fun_18f46: (typeCode, subIdx, st) => {
      helper18F46(st, rom, typeCode, subIdx);
    },
  });
}

export function postStateChange13966(
  state: GameState,
  rom: RomImage,
  objPtr: number,
  subs: PostStateChange13966Subs = {},
): PostStateChange13966Result {
  const result: PostStateChange13966Result = {
    gameMode: rw(state, GAME_MODE_ADDR),
    stateSub186ACCalled: false,
    scriptSlotsTriggered: 0,
    soundCommands: [],
  };
  const sendSound = (cmd: number): void => {
    result.soundCommands.push(cmd & 0xff);
    (subs.soundCommand ?? soundCmdSend158AC)(state, cmd);
  };

  const newState = rb(state, objPtr + OBJ_NEW_STATE_OFF);
  if (result.gameMode === MODE_4) {
    if (newState === 0x05 && (rb(state, FLAG_ADDR) & 0x01) === 0) {
      sendSound(0x15);
      wb(state, FLAG_ADDR, rb(state, FLAG_ADDR) | 0x01);
    } else if (newState === 0x06 && (rb(state, FLAG_ADDR) & 0x02) === 0) {
      sendSound(0x16);
      wb(state, FLAG_ADDR, rb(state, FLAG_ADDR) | 0x02);
    }
  }

  if (result.gameMode !== MODE_3) {
    return result;
  }

  if (newState === 0x14 && (rb(state, FLAG_ADDR) & 0x01) === 0) {
    sendSound(0x0f);
    wb(state, FLAG_ADDR, rb(state, FLAG_ADDR) | 0x01);
  } else if (
    (newState === 0x07 || newState === 0x06) &&
    (rb(state, FLAG_ADDR) & 0x02) === 0
  ) {
    sendSound(0x12);
    wb(state, FLAG_ADDR, rb(state, FLAG_ADDR) | 0x02);
    ww(state, MODE3_TIMER_ADDR, 0x003c);
  }

  (subs.stateSub186AC ?? defaultStateSub186AC)(state, rom);
  result.stateSub186ACCalled = true;

  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotAddr = SLOT_ARRAY_BASE + i * SLOT_STRIDE;
    if (rb(state, slotAddr + SLOT_ACTIVE_OFF) !== 0x01) continue;
    if (rb(state, slotAddr + SLOT_STATE_OFF) !== 0x04) continue;
    if (rb(state, slotAddr + SLOT_NEW_STATE_OFF) !== newState) continue;

    const kind = rb(state, slotAddr + SLOT_KIND_OFF);
    if (kind === 0x0b) {
      wl(state, slotAddr + SLOT_PC_OFF, 0x0001d766);
    } else if (kind === 0x0d) {
      wl(state, slotAddr + SLOT_PC_OFF, 0x0001d7ac);
    }

    const slotState = sext8(rb(state, slotAddr + SLOT_NEW_STATE_OFF));
    const soundPtr = romLong(rom, ROM_SCRIPT_SOUND_TABLE + ((slotState - 0x1e) << 2));
    sendSound(soundPtr);
    (subs.helper12896 ?? helper12896)(state, rom, slotAddr);
    result.scriptSlotsTriggered++;
  }

  return result;
}
