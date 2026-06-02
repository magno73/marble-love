/**
 * object-charcode-broadcast-1bbaa.test.ts — smoke + corner case of
 * `FUN_0001BBAA`.
 */

import { describe, it, expect } from "vitest";
import {
  objectCharcodeBroadcast1BBAA,
  ROM_PTR_TABLE_BASE,
  ROM_BYTE_TABLE_BASE,
  LEVEL_IDX_ADDR,
  GATE_FLAG_ADDR,
  PROGRESS_ADDR,
  OBJ_COUNT_ADDR,
  OBJ_BASE_ADDR,
  OBJ_STRIDE,
  OBJ_STATE_OFF,
  OBJ_FILTER_FLAG_OFF,
  OBJ_CHARCODE_OFF,
  OBJ_SIGNED_RANGE_OFF,
  OBJ_BROADCAST_FLAG_OFF,
} from "../src/object-charcode-broadcast-1bbaa.js";
import { emptyGameState, type GameState } from "../src/state.js";
import { emptyRomImage, type RomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x00400000;

function writeWord(s: GameState, abs: number, v: number): void {
  const off = abs - WORK_RAM_BASE;
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

function writeByte(s: GameState, abs: number, v: number): void {
  s.workRam[abs - WORK_RAM_BASE] = v & 0xff;
}

function readByte(s: GameState, abs: number): number {
  return s.workRam[abs - WORK_RAM_BASE] ?? 0;
}

function setupObj(
  s: GameState,
  i: number,
  fields: {
    state?: number;
    filterFlag?: number;
    charcode?: number;
    signedRange?: number;
    broadcastFlag?: number;
  },
): void {
  const base = OBJ_BASE_ADDR + i * OBJ_STRIDE;
  if (fields.state !== undefined) writeByte(s, base + OBJ_STATE_OFF, fields.state);
  if (fields.filterFlag !== undefined)
    writeByte(s, base + OBJ_FILTER_FLAG_OFF, fields.filterFlag);
  if (fields.charcode !== undefined)
    writeByte(s, base + OBJ_CHARCODE_OFF, fields.charcode);
  if (fields.signedRange !== undefined)
    writeWord(s, base + OBJ_SIGNED_RANGE_OFF, fields.signedRange);
  if (fields.broadcastFlag !== undefined)
    writeByte(s, base + OBJ_BROADCAST_FLAG_OFF, fields.broadcastFlag);
}

function objBroadcastFlag(s: GameState, i: number): number {
  return readByte(s, OBJ_BASE_ADDR + i * OBJ_STRIDE + OBJ_BROADCAST_FLAG_OFF);
}

/**
 * Create a minimal ROM with ptr-table and byte-table placed at their addresses
 * pian piano scritta in ROM @ `listAddr` (of default 0x24a9a, in area table).
 */
function makeRom(
  listBytes: number[],
  thresholdByte: number,
  levelIdx: number,
  listAddr = 0x024a9a,
): RomImage {
  const rom = emptyRomImage();
  // Byte-table @ 0x24a94 + idx
  rom.program[ROM_BYTE_TABLE_BASE + levelIdx] = thresholdByte & 0xff;
  // Ptr-table @ 0x24aae + idx*4 (long big-endian)
  const ptrSlot = ROM_PTR_TABLE_BASE + levelIdx * 4;
  rom.program[ptrSlot] = (listAddr >>> 24) & 0xff;
  rom.program[ptrSlot + 1] = (listAddr >>> 16) & 0xff;
  rom.program[ptrSlot + 2] = (listAddr >>> 8) & 0xff;
  rom.program[ptrSlot + 3] = listAddr & 0xff;
  // Char-list
  for (let i = 0; i < listBytes.length; i++) {
    rom.program[listAddr + i] = listBytes[i]! & 0xff;
  }
  return rom;
}

describe("objectCharcodeBroadcast1BBAA (FUN_0001BBAA)", () => {
  it("exit immediato se gate flag *0x40076C == 0", () => {
    const s = emptyGameState();
    writeWord(s, LEVEL_IDX_ADDR, 0);
    writeByte(s, GATE_FLAG_ADDR, 0); // gate off
    writeByte(s, PROGRESS_ADDR, 0);
    writeWord(s, OBJ_COUNT_ADDR, 4);
    setupObj(s, 0, { state: 1, charcode: 0x42, signedRange: 4, broadcastFlag: 0 });
    setupObj(s, 1, { state: 1, charcode: 0x42, signedRange: 4, broadcastFlag: 0 });
    const rom = makeRom([0x42, 0xff], 0x10, 0);
    objectCharcodeBroadcast1BBAA(s, rom);
    expect(readByte(s, GATE_FLAG_ADDR)).toBe(0);
    expect(objBroadcastFlag(s, 0)).toBe(0);
    expect(objBroadcastFlag(s, 1)).toBe(0);
  });

  it("exit immediato se threshold ≤ progress (BLS unsigned)", () => {
    const s = emptyGameState();
    writeWord(s, LEVEL_IDX_ADDR, 0);
    writeByte(s, GATE_FLAG_ADDR, 1);
    writeByte(s, PROGRESS_ADDR, 0x80);
    writeWord(s, OBJ_COUNT_ADDR, 1);
    setupObj(s, 0, { state: 1, charcode: 0x42, signedRange: 4, broadcastFlag: 0 });
    const rom = makeRom([0x42, 0xff], 0x10, 0); // threshold 0x10 < progress 0x80
    objectCharcodeBroadcast1BBAA(s, rom);
    expect(readByte(s, GATE_FLAG_ADDR)).toBe(1);
    expect(objBroadcastFlag(s, 0)).toBe(0);
  });

  it("exit immediato se char-list vuota (first byte = 0xFF)", () => {
    const s = emptyGameState();
    writeWord(s, LEVEL_IDX_ADDR, 0);
    writeByte(s, GATE_FLAG_ADDR, 1);
    writeByte(s, PROGRESS_ADDR, 0x10);
    writeWord(s, OBJ_COUNT_ADDR, 1);
    setupObj(s, 0, { state: 1, charcode: 0x42, signedRange: 4, broadcastFlag: 0 });
    const rom = makeRom([0xff], 0x80, 0);
    objectCharcodeBroadcast1BBAA(s, rom);
    expect(readByte(s, GATE_FLAG_ADDR)).toBe(1);
    expect(objBroadcastFlag(s, 0)).toBe(0);
  });

  it("nominal: 1 obj match → broadcast su all the obj con state==1", () => {
    const s = emptyGameState();
    writeWord(s, LEVEL_IDX_ADDR, 0);
    writeByte(s, GATE_FLAG_ADDR, 1);
    writeByte(s, PROGRESS_ADDR, 0x10);
    writeWord(s, OBJ_COUNT_ADDR, 4);
    // obj0: state=1, charcode=0x42 (in lista), 0x6a=4 (in [3,6]), filter=0 → MATCH outer
    setupObj(s, 0, { state: 1, filterFlag: 0, charcode: 0x42, signedRange: 4 });
    setupObj(s, 1, { state: 1, filterFlag: 0, charcode: 0x99, signedRange: 0 });
    setupObj(s, 2, { state: 2, filterFlag: 0, charcode: 0x42, signedRange: 4 });
    // obj3: state=1
    setupObj(s, 3, { state: 1, filterFlag: 0, charcode: 0x55, signedRange: 0 });
    const rom = makeRom([0x42, 0x55, 0xff], 0x80, 0);
    objectCharcodeBroadcast1BBAA(s, rom);
    expect(readByte(s, GATE_FLAG_ADDR)).toBe(0);
    expect(objBroadcastFlag(s, 0)).toBe(1);
    expect(objBroadcastFlag(s, 1)).toBe(1);
    expect(objBroadcastFlag(s, 2)).toBe(0);
    expect(objBroadcastFlag(s, 3)).toBe(1);
  });

  it("filter 0x1A != 0 → outer skip", () => {
    const s = emptyGameState();
    writeWord(s, LEVEL_IDX_ADDR, 0);
    writeByte(s, GATE_FLAG_ADDR, 1);
    writeByte(s, PROGRESS_ADDR, 0x10);
    writeWord(s, OBJ_COUNT_ADDR, 1);
    setupObj(s, 0, { state: 1, filterFlag: 1, charcode: 0x42, signedRange: 4 });
    const rom = makeRom([0x42, 0xff], 0x80, 0);
    objectCharcodeBroadcast1BBAA(s, rom);
    expect(readByte(s, GATE_FLAG_ADDR)).toBe(1);
    expect(objBroadcastFlag(s, 0)).toBe(0);
  });

  it("signedRange (+0x6a) outside [3,6] → outer skip", () => {
    const s = emptyGameState();
    writeWord(s, LEVEL_IDX_ADDR, 0);
    writeByte(s, GATE_FLAG_ADDR, 1);
    writeByte(s, PROGRESS_ADDR, 0x10);
    writeWord(s, OBJ_COUNT_ADDR, 4);
    // edges: 2 (skip), 3 (ok), 6 (ok), 7 (skip)
    setupObj(s, 0, { state: 1, filterFlag: 0, charcode: 0x42, signedRange: 2 });
    setupObj(s, 1, { state: 1, filterFlag: 0, charcode: 0x42, signedRange: 3 });
    setupObj(s, 2, { state: 1, filterFlag: 0, charcode: 0x42, signedRange: 6 });
    setupObj(s, 3, { state: 1, filterFlag: 0, charcode: 0x42, signedRange: 7 });
    const rom = makeRom([0x42, 0xff], 0x80, 0);
    objectCharcodeBroadcast1BBAA(s, rom);
    expect(readByte(s, GATE_FLAG_ADDR)).toBe(0);
    expect(objBroadcastFlag(s, 0)).toBe(1);
    expect(objBroadcastFlag(s, 1)).toBe(1);
    expect(objBroadcastFlag(s, 2)).toBe(1);
    expect(objBroadcastFlag(s, 3)).toBe(1);
  });

  it("no obj con charcode in lista → no broadcast", () => {
    const s = emptyGameState();
    writeWord(s, LEVEL_IDX_ADDR, 0);
    writeByte(s, GATE_FLAG_ADDR, 1);
    writeByte(s, PROGRESS_ADDR, 0x10);
    writeWord(s, OBJ_COUNT_ADDR, 2);
    setupObj(s, 0, { state: 1, filterFlag: 0, charcode: 0x99, signedRange: 4 });
    setupObj(s, 1, { state: 1, filterFlag: 0, charcode: 0x88, signedRange: 4 });
    const rom = makeRom([0x42, 0x55, 0xff], 0x80, 0);
    objectCharcodeBroadcast1BBAA(s, rom);
    expect(readByte(s, GATE_FLAG_ADDR)).toBe(1);
    expect(objBroadcastFlag(s, 0)).toBe(0);
    expect(objBroadcastFlag(s, 1)).toBe(0);
  });

  it("count == 0 → no body, no side effects (but gate/progress/list already passed)", () => {
    const s = emptyGameState();
    writeWord(s, LEVEL_IDX_ADDR, 0);
    writeByte(s, GATE_FLAG_ADDR, 1);
    writeByte(s, PROGRESS_ADDR, 0x10);
    writeWord(s, OBJ_COUNT_ADDR, 0);
    setupObj(s, 0, { state: 1, charcode: 0x42, signedRange: 4 });
    const rom = makeRom([0x42, 0xff], 0x80, 0);
    objectCharcodeBroadcast1BBAA(s, rom);
    expect(readByte(s, GATE_FLAG_ADDR)).toBe(1);
    expect(objBroadcastFlag(s, 0)).toBe(0);
  });

  it("level index != 0 → cambia ptr+threshold", () => {
    const s = emptyGameState();
    writeWord(s, LEVEL_IDX_ADDR, 3);
    writeByte(s, GATE_FLAG_ADDR, 1);
    writeByte(s, PROGRESS_ADDR, 0x10);
    writeWord(s, OBJ_COUNT_ADDR, 1);
    setupObj(s, 0, { state: 1, filterFlag: 0, charcode: 0x77, signedRange: 5 });
    const rom = makeRom([0x77, 0xff], 0x80, 3, 0x024ab0);
    objectCharcodeBroadcast1BBAA(s, rom);
    expect(readByte(s, GATE_FLAG_ADDR)).toBe(0);
    expect(objBroadcastFlag(s, 0)).toBe(1);
  });
});
