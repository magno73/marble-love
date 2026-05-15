/**
 * fun-264aa.ts — partial replica of `FUN_000264AA`.
 *
 * This module currently ports the shared sprite-list clear prelude plus the
 * `mode=0/1/2` emit paths used by `FUN_1281C` and `FUN_150D0`, i.e. the object
 * sprite-shape and slot-array sprite/collision emit paths.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { stringDispatchTable177F8 } from "./string-dispatch-table-177f8.js";

const WORK_RAM_BASE = 0x00400000 as const;
const WORK_RAM_END = 0x00402000 as const;
const ROM_TABLE_1EA2A = 0x0001ea2a as const;
const ROM_TABLE_1EABA = 0x0001eaba as const;
const ROM_TABLE_1EACA = 0x0001eaca as const;
const ROM_TABLE_1EAD2 = 0x0001ead2 as const;
const ROM_TABLE_1EAF4 = 0x0001eaf4 as const;
const WR_CURSOR_74E = 0x0040074e as const;
const WR_GAME_MODE = 0x00400394 as const;
const WR_LEVEL_Y_BASE = 0x0040045c as const;
const WR_LEVEL_HEADER_PTR = 0x00400474 as const;
const WR_HUD_OFFSET = 0x0040097e as const;
const WR_MODE_FLAG_988 = 0x00400988 as const;
const PF_BASE = 0x00a00000 as const;
const PF_END = 0x00a02000 as const;
const SPRITE_BASE = 0x00a02000 as const;
const SPRITE_END = 0x00a03000 as const;
const ALPHA_BASE = 0x00a03000 as const;
const ALPHA_END = 0x00a04000 as const;

function s8(v: number): number {
  const b = v & 0xff;
  return b & 0x80 ? b - 0x100 : b;
}

function s16(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

function u16(v: number): number {
  return v & 0xffff;
}

function s32(v: number): number {
  return v | 0;
}

function rbWork(state: GameState, addr: number): number {
  return state.workRam[(addr - WORK_RAM_BASE) >>> 0] ?? 0;
}

function rwWork(state: GameState, addr: number): number {
  return ((rbWork(state, addr) << 8) | rbWork(state, (addr + 1) >>> 0)) & 0xffff;
}

function rlWork(state: GameState, addr: number): number {
  return (
    (((rbWork(state, addr) << 24) >>> 0) |
      (rbWork(state, (addr + 1) >>> 0) << 16) |
      (rbWork(state, (addr + 2) >>> 0) << 8) |
      rbWork(state, (addr + 3) >>> 0)) >>>
    0
  );
}

function wbWork(state: GameState, addr: number, v: number): void {
  state.workRam[(addr - WORK_RAM_BASE) >>> 0] = v & 0xff;
}

function wwWork(state: GameState, addr: number, v: number): void {
  const w = v & 0xffff;
  wbWork(state, addr, (w >>> 8) & 0xff);
  wbWork(state, (addr + 1) >>> 0, w & 0xff);
}

function wlWork(state: GameState, addr: number, v: number): void {
  const u = v >>> 0;
  wbWork(state, addr, (u >>> 24) & 0xff);
  wbWork(state, (addr + 1) >>> 0, (u >>> 16) & 0xff);
  wbWork(state, (addr + 2) >>> 0, (u >>> 8) & 0xff);
  wbWork(state, (addr + 3) >>> 0, u & 0xff);
}

function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a < rom.program.length) return rom.program[a] ?? 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return rbWork(state, a);
  if (a >= PF_BASE && a < PF_END) return state.playfieldRam[a - PF_BASE] ?? 0;
  if (a >= SPRITE_BASE && a < SPRITE_END) return state.spriteRam[a - SPRITE_BASE] ?? 0;
  if (a >= ALPHA_BASE && a < ALPHA_END) return state.alphaRam[a - ALPHA_BASE] ?? 0;
  return 0;
}

function readWordAbs(state: GameState, rom: RomImage, addr: number): number {
  return (
    ((readByteAbs(state, rom, addr) << 8) |
      readByteAbs(state, rom, (addr + 1) >>> 0)) &
    0xffff
  );
}

function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  return (
    (((readByteAbs(state, rom, addr) << 24) >>> 0) |
      (readByteAbs(state, rom, (addr + 1) >>> 0) << 16) |
      (readByteAbs(state, rom, (addr + 2) >>> 0) << 8) |
      readByteAbs(state, rom, (addr + 3) >>> 0)) >>>
    0
  );
}

function makePfRam(state: GameState): Uint8Array {
  const pfRam = new Uint8Array(0x4000);
  pfRam.set(state.playfieldRam, 0);
  pfRam.set(state.spriteRam, 0x2000);
  pfRam.set(state.alphaRam, 0x3000);
  return pfRam;
}

function writeEmitWord(state: GameState, value: number): void {
  const cursor = rlWork(state, WR_CURSOR_74E);
  wlWork(state, WR_CURSOR_74E, (cursor + 2) >>> 0);
  wwWork(state, cursor, value);
}

function readMode2ScriptWord(state: GameState, rom: RomImage, scriptPtr: number, off: number): number {
  return readWordAbs(state, rom, (scriptPtr + off) >>> 0);
}

/**
 * Partial `FUN_264AA(structPtr, mode)`.
 *
 * `mode=0/1` are called by `FUN_1281C`; `mode=2` is called by `FUN_150D0`.
 * `mode=3` still depends on caller-local `A1` state and remains a no-op here.
 */
export function fun264AA(
  state: GameState,
  rom: RomImage,
  structPtr: number,
  mode: number,
): number {
  const a2 = structPtr >>> 0;
  const d3 = s16(mode);

  if (d3 > 2) {
    return 0;
  }

  const outputBase = d3 < 2 ? (a2 + 0x38) >>> 0 : (a2 + 0x2c) >>> 0;
  wlWork(state, WR_CURSOR_74E, outputBase);
  for (let i = 0; i < 5; i++) {
    wwWork(state, outputBase + i * 6, 0);
  }

  if (d3 === 0) {
    const state58 = rbWork(state, a2 + 0x58);
    const state59 = rbWork(state, a2 + 0x59);
    const state18 = rbWork(state, a2 + 0x18);
    const state1a = rbWork(state, a2 + 0x1a);
    if (
      state58 !== 0 &&
      state59 !== 0xff &&
      state58 !== 0x0a &&
      state18 !== 0x09 &&
      state1a !== 0x0b &&
      state1a !== 0x0a
    ) {
      wbWork(state, a2 + 0x1c, 0);
      return 0;
    }
    if (state1a === 0x04 || state1a === 0x06 || state1a === 0x0a) {
      return 0;
    }
  }

  const posX = rlWork(state, a2 + 0x0c);
  const posY = rlWork(state, a2 + 0x10);

  let d4 = 3;
  let d5 = 0;
  let d6 = 0;
  let yOffset = 0;

  if (d3 < 2) {
    const packed = rlWork(state, a2 + 0x1e);
    yOffset = u16(packed);
    d6 = u16(s32(packed) >> 16);
    d5 = 0x0e;
    if (d3 === 0) {
      const state1a = rbWork(state, a2 + 0x1a);
      if (state1a === 0x01 || state1a === 0x02 || state1a === 0x05 || state1a === 0x09) {
        d4 = 5;
        d5 = 0x20;
      }
    }
  } else {
    const scriptCursor = rlWork(state, a2 + 0x58);
    const scriptPtr = readLongAbs(state, rom, scriptCursor);

    if (s8(readByteAbs(state, rom, scriptPtr + 2)) > 2) {
      d4 = 5;
    }

    d5 = u16(s8(readByteAbs(state, rom, scriptPtr + 3)) << 3);
    d6 = u16(s8(readByteAbs(state, rom, scriptPtr)) + readMode2ScriptWord(state, rom, a2, 0x28));
    yOffset = u16(s8(readByteAbs(state, rom, scriptPtr + 1)) + readMode2ScriptWord(state, rom, a2, 0x2a));
  }

  d5 = u16(d5 + yOffset);

  const lineA = u16((s32(posY) >> 19) + (s32(posX) >> 19) - 0x15);
  const lineB = u16((s32((posY + posX) >>> 0) >> 19) - 0x15);

  d6 = u16(s16(d6) >> 3);
  if (d3 === 2) {
    d6 = u16(d6 + (d4 === 3 ? 1 : 2));
  }

  let shapePtr = ROM_TABLE_1EABA;
  if (lineA !== lineB) {
    shapePtr = (shapePtr + 0x0a) >>> 0;
  } else if (((s16(d6) ^ s16(lineA)) & 1) !== 0) {
    shapePtr = (shapePtr + 5) >>> 0;
  }

  if (d4 === 3) {
    shapePtr = (shapePtr + 1) >>> 0;
  }
  let startCol = u16(d6 - (d4 === 3 ? 1 : 2));
  if (s16(startCol) < 0) {
    d4 = u16(d4 + s16(startCol));
    shapePtr = (shapePtr - s16(startCol)) >>> 0;
    startCol = 0;
  } else if (s16(d4) + s16(startCol) > 0x24) {
    d4 = u16(0x24 - s16(startCol));
  }

  const levelHeader = rlWork(state, WR_LEVEL_HEADER_PTR);
  let levelTablePtr = (
    s16(rwWork(state, WR_LEVEL_Y_BASE)) +
    ((levelHeader + 0x2e + (s16(startCol) << 2)) >>> 0) -
    4
  ) >>> 0;
  let coveredMask = 0;
  const endCol = u16(d4 + startCol);
  const pfRam = makePfRam(state);
  const screenYOffset = u16(rwWork(state, WR_HUD_OFFSET) - readWordAbs(state, rom, (levelHeader + 0x10) >>> 0));

  for (let col = startCol; s16(col) < s16(endCol); col = u16(col + 1)) {
    const shapeByte = readByteAbs(state, rom, shapePtr);
    shapePtr = (shapePtr + 1) >>> 0;
    let row = u16(s8(shapeByte) + s16(lineA));
    levelTablePtr = (levelTablePtr + 4) >>> 0;
    if (s16(row) < 0) {
      row = 0;
    }

    if (d3 < 2) {
      const special = mode01ScriptEmit(state, rom, {
        structPtr: a2,
        col,
        startCol,
        row,
        lineB,
        d5,
        yOffset,
        screenYOffset,
        coveredMask,
      });
      if (special.action === "continue") {
        coveredMask = special.coveredMask;
        continue;
      }
      coveredMask = special.coveredMask;
      row = special.row;
    }

    const bit = row & 7;
    const rowBase = (readLongAbs(state, rom, levelTablePtr) + (s16(row) >> 3)) >>> 0;
    let scanPtr = rowBase;
    row = row & 0xfff8;
    let maskByte = s8(readByteAbs(state, rom, ROM_TABLE_1EACA + bit));
    maskByte = u16(maskByte & s8(readByteAbs(state, rom, scanPtr))) & 0xff;

    if (maskByte === 0) {
      do {
        scanPtr = (scanPtr + 1) >>> 0;
      } while (readByteAbs(state, rom, scanPtr) === 0);
      maskByte = readByteAbs(state, rom, scanPtr);
      row = u16(row + (((scanPtr - rowBase) << 3) & 0xffff));
    }

    let bitMask = 1;
    while ((maskByte & bitMask) === 0) {
      bitMask = (bitMask << 1) & 0xffff;
      row = u16(row + 1);
    }

    wlWork(state, WR_MODE_FLAG_988, ((s16(col) ^ s16(row)) & 1) >>> 0);

    let screenY = u16((row << 2) - rwWork(state, WR_HUD_OFFSET));
    let y0 = stringDispatchTable177F8(state, rom, pfRam, row, col, 0);
    y0 = u16(y0 - screenY);

    if (s16(y0) > s16(u16(d5 + 0x10))) {
      coveredMask = writeBlockedEmit(state, col, startCol, coveredMask, d5);
      continue;
    }

    if (s16(y0) < s16(u16(yOffset - 0x10))) {
      continue;
    }

    wlWork(state, WR_MODE_FLAG_988, (rlWork(state, WR_MODE_FLAG_988) ^ 1) >>> 0);
    screenY = u16(screenY + 4);

    let y1 = stringDispatchTable177F8(state, rom, pfRam, u16(row + 1), col, 2);
    y1 = u16(y1 - screenY);

    if (
      s16(y1) <= s16(yOffset) &&
      s16(y0) <= s16(yOffset)
    ) {
      continue;
    }

    if (s16(y1) >= s16(d5) && s16(y0) >= s16(d5)) {
      coveredMask = writeBlockedEmit(state, col, startCol, coveredMask, d5);
      continue;
    }

    writeSpanEmit(state, rom, y0, y1, col);
  }

  if (d3 < 2) {
    const allMask = (1 << d4) - 1;
    if ((coveredMask & allMask) === allMask) {
      wbWork(state, a2 + 0x1c, 0);
    } else if (d3 === 0 && d4 === 5 && (coveredMask & 0x0e) === 0x0e) {
      wbWork(state, a2 + 0x1c, 0);
    }
  }

  return 0;
}

interface Mode01EmitArgs {
  structPtr: number;
  col: number;
  startCol: number;
  row: number;
  lineB: number;
  d5: number;
  yOffset: number;
  screenYOffset: number;
  coveredMask: number;
}

type Mode01EmitResult =
  | { action: "fallthrough"; row: number; coveredMask: number }
  | { action: "continue"; coveredMask: number };

function mode01ScriptEmit(
  state: GameState,
  rom: RomImage,
  args: Mode01EmitArgs,
): Mode01EmitResult {
  const tablePtr = readLongAbs(state, rom, (ROM_TABLE_1EA2A + (s16(args.col) << 2)) >>> 0);
  const selector = readWordAbs(state, rom, (tablePtr + (s16(rwWork(state, WR_GAME_MODE)) << 1)) >>> 0);
  if (selector === 0) {
    return { action: "fallthrough", row: args.row, coveredMask: args.coveredMask };
  }

  let recordPtr = (tablePtr + (s16(selector) << 1)) >>> 0;
  while (true) {
    const rowLimit = readWordAbs(state, rom, recordPtr);
    if (rowLimit === 0xffff) {
      return { action: "fallthrough", row: args.row, coveredMask: args.coveredMask };
    }

    if (s16(rowLimit) < s16(args.row)) {
      recordPtr = (recordPtr + 0x0a) >>> 0;
      continue;
    }

    const delta = readWordAbs(state, rom, (recordPtr + 2) >>> 0);
    if (s16(args.row) < s16(rowLimit) - s16(delta)) {
      return { action: "fallthrough", row: args.row, coveredMask: args.coveredMask };
    }

    const control = readWordAbs(state, rom, (recordPtr + 4) >>> 0);
    const controlSigned = s16(control);
    const y = u16(readWordAbs(state, rom, (recordPtr + 6) >>> 0) + args.screenYOffset);
    const codePtr = (recordPtr + 8) >>> 0;

    if (controlSigned >= 0) {
      if (controlSigned < 8) {
        if (s16(y) >= s16(args.yOffset) - controlSigned) {
          return {
            action: "continue",
            coveredMask: writeBlockedEmit(state, args.col, args.startCol, args.coveredMask, args.d5),
          };
        }
        emitMode01Record(state, rom, codePtr, args.col, y);
        return { action: "continue", coveredMask: args.coveredMask };
      }

      if (controlSigned === 8) {
        if (s16(y) < s16(args.d5)) {
          emitMode01Record(state, rom, codePtr, args.col, y);
        }
        return { action: "continue", coveredMask: args.coveredMask };
      }

      if (s16(y) <= s16(args.d5)) {
        emitMode01Record(state, rom, codePtr, args.col, y);
        return { action: "continue", coveredMask: args.coveredMask };
      }
      return { action: "fallthrough", row: control & 0xff, coveredMask: args.coveredMask };
    }

    if (controlSigned === -2) {
      const zGate = s16(readWordAbs(state, rom, codePtr));
      const objZ = s32(rlWork(state, args.structPtr + 0x14)) >> 16;
      if (zGate <= objZ) {
        return { action: "continue", coveredMask: args.coveredMask };
      }
      return {
        action: "continue",
        coveredMask: writeBlockedEmit(state, args.col, args.startCol, args.coveredMask, args.d5),
      };
    }

    if (s16(args.row) !== s16(rowLimit) || s16(args.lineB) !== s16(rowLimit)) {
      emitMode01Record(state, rom, codePtr, args.col, y);
    }
    return { action: "continue", coveredMask: args.coveredMask };
  }
}

function emitMode01Record(
  state: GameState,
  rom: RomImage,
  recordWordPtr: number,
  col: number,
  y: number,
): void {
  writeEmitWord(state, readWordAbs(state, rom, recordWordPtr));
  writeEmitWord(state, u16(col << 3));
  writeEmitWord(state, y);
}

function writeBlockedEmit(
  state: GameState,
  col: number,
  startCol: number,
  coveredMask: number,
  d5: number,
): number {
  const bit = 1 << (((col & 0xff) - (startCol & 0xff)) & 0x3f);
  const nextMask = u16(coveredMask | bit);
  writeEmitWord(state, 0x6ce0);
  writeEmitWord(state, u16(col << 3));
  writeEmitWord(state, u16(d5 - 0x2f));
  return nextMask;
}

function writeSpanEmit(
  state: GameState,
  rom: RomImage,
  y0Raw: number,
  y1Raw: number,
  col: number,
): void {
  let y0 = y0Raw;
  let y1 = y1Raw;
  if (rlWork(state, WR_MODE_FLAG_988) === 0) {
    const tmp = y1;
    y1 = y0;
    y0 = tmp;
  }

  if (s16(y0) <= s16(y1)) {
    const delta = u16(y1 - y0);
    writeEmitWord(state, readWordRomTable(rom, ROM_TABLE_1EAD2, delta));
    writeEmitWord(state, u16(col << 3));
    writeEmitWord(state, u16(readWordRomTable(rom, ROM_TABLE_1EAF4, delta) + y0));
  } else {
    const delta = u16(y0 - y1);
    writeEmitWord(state, u16(readWordRomTable(rom, ROM_TABLE_1EAD2, delta) + 0x8000));
    writeEmitWord(state, u16(col << 3));
    writeEmitWord(state, u16(readWordRomTable(rom, ROM_TABLE_1EAF4, delta) + y1));
  }
}

function readWordRomTable(rom: RomImage, base: number, wordIndex: number): number {
  const addr = (base + (s16(wordIndex) << 1)) >>> 0;
  return (((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0)) & 0xffff;
}
