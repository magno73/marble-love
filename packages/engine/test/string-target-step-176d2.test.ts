/**
 * string-target-step-176d2.test.ts — smoke tests per `stringTargetStep176D2`.
 *
 * Bit-perfect parity validata vs binary in
 * `packages/cli/src/test-string-target-step-176d2-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  stringTargetStep176D2,
  resolveBbox,
  SLOT_BASE_ADDR,
  SLOT_STRIDE,
  OBJ_INDEX_BYTE_OFF,
  SLOT_BBOX_PTRPTR_OFF,
  SLOT_CENTER_X_WORD_OFF,
  SLOT_CENTER_Y_WORD_OFF,
  OBJ_X_LONG_OFF,
  OBJ_Y_LONG_OFF,
  BBOX_XMIN_OFF,
  BBOX_YMIN_OFF,
  BBOX_WIDTH_OFF,
  BBOX_HEIGHT_OFF,
  DEFAULT_XMIN,
  DEFAULT_YMIN,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  BBOX_SENTINEL,
} from "../src/string-target-step-176d2.js";
import { emptyGameState, type GameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;

function offOf(addr: number): number {
  return (addr >>> 0) - WORK_RAM_BASE;
}

function setByte(s: GameState, addr: number, v: number): void {
  s.workRam[offOf(addr)] = v & 0xff;
}

function setWord(s: GameState, addr: number, v: number): void {
  const u = v & 0xffff;
  s.workRam[offOf(addr)] = (u >>> 8) & 0xff;
  s.workRam[offOf(addr) + 1] = u & 0xff;
}

function setLong(s: GameState, addr: number, v: number): void {
  const u = v >>> 0;
  s.workRam[offOf(addr)] = (u >>> 24) & 0xff;
  s.workRam[offOf(addr) + 1] = (u >>> 16) & 0xff;
  s.workRam[offOf(addr) + 2] = (u >>> 8) & 0xff;
  s.workRam[offOf(addr) + 3] = u & 0xff;
}

function setRomByte(rom: ReturnType<typeof emptyRomImage>, addr: number, v: number): void {
  rom.program[addr >>> 0] = v & 0xff;
}

function setRomLong(rom: ReturnType<typeof emptyRomImage>, addr: number, v: number): void {
  const u = v >>> 0;
  rom.program[addr >>> 0] = (u >>> 24) & 0xff;
  rom.program[(addr + 1) >>> 0] = (u >>> 16) & 0xff;
  rom.program[(addr + 2) >>> 0] = (u >>> 8) & 0xff;
  rom.program[(addr + 3) >>> 0] = u & 0xff;
}

function getLong(s: GameState, addr: number): number {
  return (
    (((s.workRam[offOf(addr)] ?? 0) << 24) >>> 0) |
    ((s.workRam[offOf(addr) + 1] ?? 0) << 16) |
    ((s.workRam[offOf(addr) + 2] ?? 0) << 8) |
    (s.workRam[offOf(addr) + 3] ?? 0)
  );
}

/** Setup di una catena: obj@objAddr, slot indicizzato da idx, bboxPtrPtr@p1, bboxPtr@p2 (o sentinel). */
function setupChain(args: {
  s: GameState;
  objAddr: number;
  idx: number;
  p1Addr: number; // dove vive il long-pointer di livello 1 (= ptr ptr)
  bboxAddr: number; // valore puntato da p1 (o BBOX_SENTINEL)
  slotCx?: number;
  slotCy?: number;
  curX?: number;
  curY?: number;
  bbox?: { xMin: number; yMin: number; width: number; height: number };
}): number {
  const { s, objAddr, idx, p1Addr, bboxAddr } = args;
  const slotAddr = (SLOT_BASE_ADDR + idx * SLOT_STRIDE) >>> 0;

  // obj+0x58 = idx
  setByte(s, objAddr + OBJ_INDEX_BYTE_OFF, idx);

  // slot+0x3a = p1Addr (long)
  setLong(s, slotAddr + SLOT_BBOX_PTRPTR_OFF, p1Addr);

  // *p1Addr = bboxAddr (long)
  setLong(s, p1Addr, bboxAddr);

  // slot center words
  setWord(s, slotAddr + SLOT_CENTER_X_WORD_OFF, args.slotCx ?? 0);
  setWord(s, slotAddr + SLOT_CENTER_Y_WORD_OFF, args.slotCy ?? 0);

  // obj cur word
  setWord(s, objAddr + OBJ_X_LONG_OFF, args.curX ?? 0);
  setWord(s, objAddr + OBJ_Y_LONG_OFF, args.curY ?? 0);

  // se bbox è in workRam, scrivilo
  if (
    args.bbox !== undefined &&
    bboxAddr !== BBOX_SENTINEL &&
    bboxAddr >= WORK_RAM_BASE &&
    bboxAddr < WORK_RAM_BASE + 0x2000
  ) {
    setByte(s, bboxAddr + BBOX_XMIN_OFF, args.bbox.xMin);
    setByte(s, bboxAddr + BBOX_YMIN_OFF, args.bbox.yMin);
    setByte(s, bboxAddr + BBOX_WIDTH_OFF, args.bbox.width);
    setByte(s, bboxAddr + BBOX_HEIGHT_OFF, args.bbox.height);
  }

  return slotAddr;
}

describe("stringTargetStep176D2 (FUN_000176D2)", () => {
  it("costanti coerenti col disasm", () => {
    expect(SLOT_BASE_ADDR).toBe(0x401482);
    expect(SLOT_STRIDE).toBe(0x42);
    expect(OBJ_INDEX_BYTE_OFF).toBe(0x58);
    expect(SLOT_BBOX_PTRPTR_OFF).toBe(0x3a);
    expect(SLOT_CENTER_X_WORD_OFF).toBe(0x0c);
    expect(SLOT_CENTER_Y_WORD_OFF).toBe(0x10);
    expect(OBJ_X_LONG_OFF).toBe(0x0c);
    expect(OBJ_Y_LONG_OFF).toBe(0x10);
    expect(BBOX_XMIN_OFF).toBe(4);
    expect(BBOX_YMIN_OFF).toBe(5);
    expect(BBOX_WIDTH_OFF).toBe(6);
    expect(BBOX_HEIGHT_OFF).toBe(7);
    expect(DEFAULT_XMIN).toBe(-2);
    expect(DEFAULT_YMIN).toBe(-2);
    expect(DEFAULT_WIDTH).toBe(12);
    expect(DEFAULT_HEIGHT).toBe(12);
    expect(BBOX_SENTINEL).toBe(0xffffffff);
  });

  it("path default (bboxPtr == 0xFFFFFFFF) — usa xMin=-2,yMin=-2,w=12,h=12; cur al target esatto → step=0", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    // target X = (12 >> 1) + (-2) + slotCx = 6 - 2 + 0 = 4
    // target Y = (12 >> 1) + (-2) + slotCy = 6 - 2 + 0 = 4
    setupChain({
      s,
      objAddr,
      idx: 0, // slot @ 0x401482
      p1Addr: 0x401d00,
      bboxAddr: BBOX_SENTINEL,
      slotCx: 0,
      slotCy: 0,
      curX: 4,
      curY: 4,
    });

    stringTargetStep176D2(s, objAddr);

    // step = 0 per entrambi → newX = (4 + 0) << 16 = 4 << 16 = 0x40000
    expect(getLong(s, objAddr + OBJ_X_LONG_OFF)).toBe(0x00040000);
    expect(getLong(s, objAddr + OBJ_Y_LONG_OFF)).toBe(0x00040000);
  });

  it("path read-bbox: cur << target → step = +1 su entrambi gli assi", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    const bboxAddr = 0x401e00;
    // target X = (4 >> 1) + 0 + 10 = 2 + 0 + 10 = 12
    // target Y = (4 >> 1) + 0 +  5 = 2 + 0 +  5 =  7
    // cur = (0,0) → step = (+1, +1)
    setupChain({
      s,
      objAddr,
      idx: 1, // slot @ 0x401482 + 0x42 = 0x4014C4
      p1Addr: 0x401d00,
      bboxAddr,
      slotCx: 10,
      slotCy: 5,
      curX: 0,
      curY: 0,
      bbox: { xMin: 0, yMin: 0, width: 4, height: 4 },
    });

    stringTargetStep176D2(s, objAddr);

    // newX = (1 + 0) << 16 = 0x10000
    expect(getLong(s, objAddr + OBJ_X_LONG_OFF)).toBe(0x00010000);
    expect(getLong(s, objAddr + OBJ_Y_LONG_OFF)).toBe(0x00010000);
  });

  it("path read-bbox: cur >> target → step = -1 su entrambi gli assi", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    const bboxAddr = 0x401e00;
    // target X = (4 >> 1) + 0 + 0 = 2; target Y = 2
    // cur = (50, 30) → step = (-1, -1)
    setupChain({
      s,
      objAddr,
      idx: 2,
      p1Addr: 0x401d00,
      bboxAddr,
      slotCx: 0,
      slotCy: 0,
      curX: 50,
      curY: 30,
      bbox: { xMin: 0, yMin: 0, width: 4, height: 4 },
    });

    stringTargetStep176D2(s, objAddr);

    // newX = (-1 + 50) << 16 = 49 << 16 = 0x310000
    // newY = (-1 + 30) << 16 = 29 << 16 = 0x1D0000
    expect(getLong(s, objAddr + OBJ_X_LONG_OFF)).toBe(0x00310000);
    expect(getLong(s, objAddr + OBJ_Y_LONG_OFF)).toBe(0x001d0000);
  });

  it("low 16 bit del long sono sempre azzerati", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    // pre-fill obj+0xC..+0xF e obj+0x10..+0x13 con valori non-zero per
    // verificare che la funzione li azzeri.
    setLong(s, objAddr + OBJ_X_LONG_OFF, 0xdeadbeef);
    setLong(s, objAddr + OBJ_Y_LONG_OFF, 0xcafebabe);

    setupChain({
      s,
      objAddr,
      idx: 0,
      p1Addr: 0x401d00,
      bboxAddr: BBOX_SENTINEL,
      slotCx: 0,
      slotCy: 0,
      // curX deriva da (0xDEAD as i16) = -8531; curY = (0xCAFE as i16) = -13570
      // ma li sovrascriviamo dopo:
    });
    // sovrascrivi solo il word alto, lasciando il word basso non-zero
    setWord(s, objAddr + OBJ_X_LONG_OFF, 100);
    s.workRam[offOf(objAddr + OBJ_X_LONG_OFF) + 2] = 0xff;
    s.workRam[offOf(objAddr + OBJ_X_LONG_OFF) + 3] = 0xff;
    setWord(s, objAddr + OBJ_Y_LONG_OFF, 200);
    s.workRam[offOf(objAddr + OBJ_Y_LONG_OFF) + 2] = 0xff;
    s.workRam[offOf(objAddr + OBJ_Y_LONG_OFF) + 3] = 0xff;

    stringTargetStep176D2(s, objAddr);

    // Bbox = default (-2,-2,12,12), slot center = (0,0) → target = (4,4)
    // curX=100 > 4 → step = -1; newX = (100 - 1) << 16 = 99 << 16 = 0x630000
    // curY=200 > 4 → step = -1; newY = (200 - 1) << 16 = 199 << 16 = 0xC70000
    expect(getLong(s, objAddr + OBJ_X_LONG_OFF)).toBe(0x00630000);
    expect(getLong(s, objAddr + OBJ_Y_LONG_OFF)).toBe(0x00c70000);
    // verify low word == 0
    expect(s.workRam[offOf(objAddr + OBJ_X_LONG_OFF) + 2]).toBe(0);
    expect(s.workRam[offOf(objAddr + OBJ_X_LONG_OFF) + 3]).toBe(0);
    expect(s.workRam[offOf(objAddr + OBJ_Y_LONG_OFF) + 2]).toBe(0);
    expect(s.workRam[offOf(objAddr + OBJ_Y_LONG_OFF) + 3]).toBe(0);
  });

  it("step asimmetrico: X al target, Y in movimento", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    const bboxAddr = 0x401e00;
    // target X = (8 >> 1) + (-1) + 0 = 4 - 1 = 3
    // target Y = (8 >> 1) + (-1) + 100 = 3 + 100 = 103
    setupChain({
      s,
      objAddr,
      idx: 3,
      p1Addr: 0x401d00,
      bboxAddr,
      slotCx: 0,
      slotCy: 100,
      curX: 3, // already at target X
      curY: 50,
      bbox: { xMin: -1, yMin: -1, width: 8, height: 8 },
    });

    stringTargetStep176D2(s, objAddr);

    // stepX = 0; stepY = +1 (cur 50 < target 103)
    expect(getLong(s, objAddr + OBJ_X_LONG_OFF)).toBe((3 << 16) >>> 0);
    expect(getLong(s, objAddr + OBJ_Y_LONG_OFF)).toBe((51 << 16) >>> 0);
  });

  it("byte signed estremi del bbox: width=0x80 (= -128), height=0x7F (= +127)", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    const bboxAddr = 0x401e00;
    // width = -128 → asr.w #1 = -64; xMin = 0 → targetX_part = -64 + 0 = -64
    // slotCx = 100 → targetX = -64 + 100 = 36
    // height = 127 → asr.w #1 = 63; yMin = 0 → 63 + 0 + 0 = 63
    setupChain({
      s,
      objAddr,
      idx: 4,
      p1Addr: 0x401d00,
      bboxAddr,
      slotCx: 100,
      slotCy: 0,
      curX: 50, // > 36 → step -1
      curY: 0, // < 63 → step +1
      bbox: { xMin: 0, yMin: 0, width: -128, height: 127 },
    });

    stringTargetStep176D2(s, objAddr);

    expect(getLong(s, objAddr + OBJ_X_LONG_OFF)).toBe((49 << 16) >>> 0);
    expect(getLong(s, objAddr + OBJ_Y_LONG_OFF)).toBe((1 << 16) >>> 0);
  });

  it("resolveBbox: deref doppio + sentinel", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    setupChain({
      s,
      objAddr,
      idx: 5,
      p1Addr: 0x401d00,
      bboxAddr: BBOX_SENTINEL,
    });

    const r = resolveBbox(s, objAddr);
    expect(r.isDefault).toBe(true);
    expect(r.xMin).toBe(DEFAULT_XMIN);
    expect(r.yMin).toBe(DEFAULT_YMIN);
    expect(r.width).toBe(DEFAULT_WIDTH);
    expect(r.height).toBe(DEFAULT_HEIGHT);
    expect(r.bboxAddr).toBe(BBOX_SENTINEL);
  });

  it("resolveBbox: read path", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    const bboxAddr = 0x401e00;
    setupChain({
      s,
      objAddr,
      idx: 6,
      p1Addr: 0x401d00,
      bboxAddr,
      bbox: { xMin: -10, yMin: 20, width: -50, height: 70 },
    });

    const r = resolveBbox(s, objAddr);
    expect(r.isDefault).toBe(false);
    expect(r.xMin).toBe(-10);
    expect(r.yMin).toBe(20);
    expect(r.width).toBe(-50);
    expect(r.height).toBe(70);
    expect(r.bboxAddr).toBe(bboxAddr);
  });

  it("reads ROM-resident bbox chains when a ROM image is supplied", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const objAddr = 0x401c00;
    const cursorAddr = 0x23f66;
    const bboxAddr = 0x24000;
    const slotAddr = setupChain({
      s,
      objAddr,
      idx: 0,
      p1Addr: 0x401d00,
      bboxAddr: BBOX_SENTINEL,
      slotCx: 120,
      slotCy: 120,
      curX: 100,
      curY: 100,
    });

    setLong(s, slotAddr + SLOT_BBOX_PTRPTR_OFF, cursorAddr);
    setRomLong(rom, cursorAddr, bboxAddr);
    setRomByte(rom, bboxAddr + BBOX_XMIN_OFF, -30);
    setRomByte(rom, bboxAddr + BBOX_YMIN_OFF, -30);
    setRomByte(rom, bboxAddr + BBOX_WIDTH_OFF, 60);
    setRomByte(rom, bboxAddr + BBOX_HEIGHT_OFF, 60);

    const r = resolveBbox(s, objAddr, rom);
    expect(r.isDefault).toBe(false);
    expect(r.xMin).toBe(-30);
    expect(r.yMin).toBe(-30);
    expect(r.width).toBe(60);
    expect(r.height).toBe(60);
    expect(r.bboxAddr).toBe(bboxAddr);

    stringTargetStep176D2(s, objAddr, rom);

    expect(getLong(s, objAddr + OBJ_X_LONG_OFF)).toBe(0x00650000);
    expect(getLong(s, objAddr + OBJ_Y_LONG_OFF)).toBe(0x00650000);
  });

  it("nessun side-effect fuori obj+0xC..0x13 (8 byte totali)", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    // Pre-fill workRam con pattern 0xAA per rilevare scritture spurious
    s.workRam.fill(0xaa);

    // Setup minimo (sovrascrive i byte di setup ma non altri)
    setupChain({
      s,
      objAddr,
      idx: 0,
      p1Addr: 0x401d00,
      bboxAddr: BBOX_SENTINEL,
      curX: 4, // target è 4 con default → step=0
      curY: 4,
      slotCx: 0,
      slotCy: 0,
    });

    // Snapshot workRam pre-call
    const pre = new Uint8Array(s.workRam);

    stringTargetStep176D2(s, objAddr);

    // Differenza esattamente nei byte obj+0xC..+0x13
    const writtenOffs = new Set<number>();
    for (let i = 0; i < s.workRam.length; i++) {
      if (s.workRam[i] !== pre[i]) writtenOffs.add(i);
    }
    // I 4 byte di obj+0xC..+0xF: pre era 0xAA0000AA + l'high word=4 da setupChain.
    // Lo store finale = 0x00040000. Quindi cambiati: byte 0, byte 2, byte 3
    // (byte 1 era già 0x04). Stesso per obj+0x10..+0x13.
    for (const off of writtenOffs) {
      const a = off + WORK_RAM_BASE;
      const inX = a >= objAddr + OBJ_X_LONG_OFF && a < objAddr + OBJ_X_LONG_OFF + 4;
      const inY = a >= objAddr + OBJ_Y_LONG_OFF && a < objAddr + OBJ_Y_LONG_OFF + 4;
      expect(inX || inY).toBe(true);
    }
  });
});
