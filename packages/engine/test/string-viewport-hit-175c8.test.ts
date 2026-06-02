/**
 * string-viewport-hit-175c8.test.ts — smoke tests for `stringViewportHit175C8`.
 *
 * Bit-perfect parity validated vs binary in
 * `packages/cli/src/test-string-viewport-hit-175c8-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  stringViewportHit175C8,
  SLOT_BASE_ADDR,
  SLOT_STRIDE,
  SLOT_COUNT,
  SLOT_ACTIVE_OFF,
  SLOT_SCRIPT_ID_OFF,
  SLOT_NEW_STATE_OFF,
  SLOT_X_OFF,
  SLOT_Y_OFF,
  SLOT_BBOX_PTRPTR_OFF,
  GAME_MODE_WORD_OFF,
  MARBLE_X_WORD_OFF,
  MARBLE_Y_WORD_OFF,
  REQUIRED_GAME_MODE_A,
  REQUIRED_GAME_MODE_B,
  ENTITY_SCRIPT_ID_OFF,
  HIT_SLOT_NEW_STATE,
  BBOX_SENTINEL,
  DEFAULT_XMIN,
  DEFAULT_YMIN,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  FUN_25BAE_ARG_MODE,
  SOUND_HIT_COMMAND,
} from "../src/string-viewport-hit-175c8.js";
import { emptyRomImage } from "../src/bus.js";
import { emptyGameState, type GameState } from "../src/state.js";

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
  rom.program[addr] = v & 0xff;
}

function setRomLong(rom: ReturnType<typeof emptyRomImage>, addr: number, v: number): void {
  const u = v >>> 0;
  rom.program[addr] = (u >>> 24) & 0xff;
  rom.program[addr + 1] = (u >>> 16) & 0xff;
  rom.program[addr + 2] = (u >>> 8) & 0xff;
  rom.program[addr + 3] = u & 0xff;
}

interface SetupArgs {
  s: GameState;
  gameMode: number;
  marbleX: number;
  marbleY: number;
  /** indexes of slots to "arm" (active=1). Left empty → all inactive. */
  activeSlots?: number[];
  /** map idx → position (slotX, slotY). */
  slotPos?: Record<number, { x: number; y: number }>;
  /** map idx → bbox addr (default sentinel). */
  slotBboxAddr?: Record<number, number>;
  /** map addr → 4 signed bbox bytes. */
  bboxes?: Record<number, { xMin: number; yMin: number; w: number; h: number }>;
  /** map idx → scriptId byte (default 0). */
  scriptId?: Record<number, number>;
}

function setupChain(a: SetupArgs): void {
  const { s, gameMode, marbleX, marbleY } = a;
  setWord(s, WORK_RAM_BASE + GAME_MODE_WORD_OFF, gameMode);
  setWord(s, WORK_RAM_BASE + MARBLE_X_WORD_OFF, marbleX);
  setWord(s, WORK_RAM_BASE + MARBLE_Y_WORD_OFF, marbleY);

  const active = new Set(a.activeSlots ?? []);
  const slotPos = a.slotPos ?? {};
  const slotBbox = a.slotBboxAddr ?? {};
  const scriptId = a.scriptId ?? {};

  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotAddr = (SLOT_BASE_ADDR + i * SLOT_STRIDE) >>> 0;
    setByte(s, slotAddr + SLOT_ACTIVE_OFF, active.has(i) ? 1 : 0);
    if (slotPos[i]) {
      setWord(s, slotAddr + SLOT_X_OFF, slotPos[i]!.x);
      setWord(s, slotAddr + SLOT_Y_OFF, slotPos[i]!.y);
    }
    if (scriptId[i] !== undefined) {
      setByte(s, slotAddr + SLOT_SCRIPT_ID_OFF, scriptId[i]!);
    }
    // ptrPtr (slot+0x3a) -> addr in scratch area; *addr -> bboxAddr.
    const p1Addr = 0x401e00 + i * 8;
    const bboxAddr = slotBbox[i] ?? BBOX_SENTINEL;
    setLong(s, slotAddr + SLOT_BBOX_PTRPTR_OFF, p1Addr);
    setLong(s, p1Addr, bboxAddr);
  }

  for (const [addrStr, bb] of Object.entries(a.bboxes ?? {})) {
    const addr = Number(addrStr);
    setByte(s, addr + 4, bb.xMin);
    setByte(s, addr + 5, bb.yMin);
    setByte(s, addr + 6, bb.w);
    setByte(s, addr + 7, bb.h);
  }
}

describe("stringViewportHit175C8 (FUN_000175C8)", () => {
  it("constants consistent with the disasm", () => {
    expect(SLOT_BASE_ADDR).toBe(0x401482);
    expect(SLOT_STRIDE).toBe(0x42);
    expect(SLOT_COUNT).toBe(7);
    expect(SLOT_ACTIVE_OFF).toBe(0x18);
    expect(SLOT_SCRIPT_ID_OFF).toBe(0x19);
    expect(SLOT_NEW_STATE_OFF).toBe(0x25);
    expect(SLOT_X_OFF).toBe(0x0c);
    expect(SLOT_Y_OFF).toBe(0x10);
    expect(SLOT_BBOX_PTRPTR_OFF).toBe(0x3a);
    expect(GAME_MODE_WORD_OFF).toBe(0x394);
    expect(MARBLE_X_WORD_OFF).toBe(0x690);
    expect(MARBLE_Y_WORD_OFF).toBe(0x692);
    expect(REQUIRED_GAME_MODE_A).toBe(2);
    expect(REQUIRED_GAME_MODE_B).toBe(5);
    expect(ENTITY_SCRIPT_ID_OFF).toBe(0x58);
    expect(HIT_SLOT_NEW_STATE).toBe(0x1c);
    expect(BBOX_SENTINEL).toBe(0xffffffff);
    expect(DEFAULT_XMIN).toBe(-2);
    expect(DEFAULT_YMIN).toBe(-2);
    expect(DEFAULT_WIDTH).toBe(12);
    expect(DEFAULT_HEIGHT).toBe(12);
    expect(FUN_25BAE_ARG_MODE).toBe(9);
    expect(SOUND_HIT_COMMAND).toBe(0x5e);
  });

  it("game-mode != {2,5} → early-exit, returns 0, no writes", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    s.workRam.fill(0xaa); // pattern to detect writes
    setupChain({
      s,
      gameMode: 4, // NOT 2, NOT 5
      marbleX: 100,
      marbleY: 100,
      activeSlots: [0, 1, 2],
      slotPos: { 0: { x: 100, y: 100 } },
    });
    const pre = new Uint8Array(s.workRam);

    let stubCalls = 0;
    const r = stringViewportHit175C8(s, objAddr, {
      entityStateTransition: () => stubCalls++,
      soundCommand: () => stubCalls++,
    });

    expect(r.earlyExit).toBe(true);
    expect(r.retVal).toBe(0);
    expect(r.hitSlotIndex).toBe(-1);
    expect(r.perSlot).toEqual([]);
    expect(stubCalls).toBe(0);
    // No writes.
    expect(Array.from(s.workRam)).toEqual(Array.from(pre));
  });

  it("game-mode == 2 + slot 0 active + coinciding position → HIT, returns 1", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    setByte(s, objAddr + ENTITY_SCRIPT_ID_OFF, 0x99); // pre-fill

    setupChain({
      s,
      gameMode: REQUIRED_GAME_MODE_A,
      marbleX: 50,
      marbleY: 60,
      activeSlots: [0],
      slotPos: { 0: { x: 50, y: 60 } }, // exact match
      slotBboxAddr: { 0: BBOX_SENTINEL }, // bbox default (-2,-2,12,12)
      scriptId: { 0: 0x42 },
    });

    let entityCalls = 0;
    let soundCalls = 0;
    const r = stringViewportHit175C8(s, objAddr, {
      entityStateTransition: (objPtr, mode) => {
        entityCalls++;
        expect(objPtr).toBe(objAddr);
        expect(mode).toBe(FUN_25BAE_ARG_MODE);
      },
      soundCommand: (cmd) => {
        soundCalls++;
        expect(cmd).toBe(SOUND_HIT_COMMAND);
      },
    });

    expect(r.earlyExit).toBe(false);
    expect(r.hitSlotIndex).toBe(0);
    expect(r.retVal).toBe(1);
    expect(entityCalls).toBe(1);
    expect(soundCalls).toBe(1);
    // Side-effects:
    expect(s.workRam[offOf(objAddr + ENTITY_SCRIPT_ID_OFF)]).toBe(0x42);
    expect(s.workRam[offOf(SLOT_BASE_ADDR + SLOT_NEW_STATE_OFF)]).toBe(0x1c);
    // perSlot: hit @ 0, the other 6 are "skipped_after_hit".
    expect(r.perSlot[0]).toBe("hit");
    for (let i = 1; i < 7; i++) expect(r.perSlot[i]).toBe("skipped_after_hit");
  });

  it("all slots inactive → full loop, retVal = sext(initialD2Byte)", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    setupChain({
      s,
      gameMode: REQUIRED_GAME_MODE_B,
      marbleX: 0,
      marbleY: 0,
      activeSlots: [],
    });
    const pre = new Uint8Array(s.workRam);

    // initialD2Byte = 0 → retVal = 0
    const r0 = stringViewportHit175C8(s, objAddr, undefined, 0);
    expect(r0.earlyExit).toBe(false);
    expect(r0.hitSlotIndex).toBe(-1);
    expect(r0.retVal).toBe(0);
    expect(r0.perSlot.every((x) => x === "skip_inactive")).toBe(true);
    // No writes.
    expect(Array.from(s.workRam)).toEqual(Array.from(pre));

    // initialD2Byte = 0xFF (sext_long = -1 = 0xFFFFFFFF)
    const r1 = stringViewportHit175C8(s, objAddr, undefined, 0xff);
    expect(r1.retVal).toBe(0xffffffff);

    // initialD2Byte = 0x80 (sext_long = -128 = 0xFFFFFF80)
    const r2 = stringViewportHit175C8(s, objAddr, undefined, 0x80);
    expect(r2.retVal).toBe(0xffffff80);

    // initialD2Byte = 0x7F (sext_long = +127 = 0x7F)
    const r3 = stringViewportHit175C8(s, objAddr, undefined, 0x7f);
    expect(r3.retVal).toBe(0x7f);
  });

  it("active slot but bbox far → miss, no writes", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    setupChain({
      s,
      gameMode: REQUIRED_GAME_MODE_A,
      marbleX: 0,
      marbleY: 0,
      activeSlots: [3],
      slotPos: { 3: { x: 1000, y: 1000 } }, // far away
      slotBboxAddr: { 3: BBOX_SENTINEL },
    });
    const preObj = s.workRam[offOf(objAddr + ENTITY_SCRIPT_ID_OFF)];
    const preSlot25 = s.workRam[offOf(
      SLOT_BASE_ADDR + 3 * SLOT_STRIDE + SLOT_NEW_STATE_OFF,
    )];

    let stubCalls = 0;
    const r = stringViewportHit175C8(s, objAddr, {
      entityStateTransition: () => stubCalls++,
      soundCommand: () => stubCalls++,
    });

    expect(r.earlyExit).toBe(false);
    expect(r.hitSlotIndex).toBe(-1);
    expect(r.perSlot[3]).toBe("miss");
    expect(stubCalls).toBe(0);
    // No writes to target fields.
    expect(s.workRam[offOf(objAddr + ENTITY_SCRIPT_ID_OFF)]).toBe(preObj);
    expect(
      s.workRam[offOf(
        SLOT_BASE_ADDR + 3 * SLOT_STRIDE + SLOT_NEW_STATE_OFF,
      )],
    ).toBe(preSlot25);
    // retVal = sext(rightEdge.b) where rightEdge = slot.x + xMin + width
    // = 1000 + (-2) + 12 = 1010 = 0x3F2 → low byte = 0xF2 → sext = -14 = 0xFFFFFFF2
    expect(r.retVal).toBe(0xfffffff2);
  });

  it("read-bbox path: reads xMin/yMin/width/height from the bbox struct", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    const bboxAddr = 0x401f00;
    setupChain({
      s,
      gameMode: REQUIRED_GAME_MODE_A,
      marbleX: 100,
      marbleY: 100,
      activeSlots: [2],
      slotPos: { 2: { x: 100, y: 100 } },
      slotBboxAddr: { 2: bboxAddr },
      bboxes: {
        [bboxAddr]: { xMin: -10, yMin: -10, w: 20, h: 20 },
      },
      scriptId: { 2: 0x77 },
    });

    let entityCalled = false;
    const r = stringViewportHit175C8(s, objAddr, {
      entityStateTransition: () => {
        entityCalled = true;
      },
    });

    expect(r.hitSlotIndex).toBe(2);
    expect(r.retVal).toBe(1);
    expect(entityCalled).toBe(true);
    expect(s.workRam[offOf(objAddr + ENTITY_SCRIPT_ID_OFF)]).toBe(0x77);
    expect(
      s.workRam[offOf(SLOT_BASE_ADDR + 2 * SLOT_STRIDE + SLOT_NEW_STATE_OFF)],
    ).toBe(0x1c);
  });

  it("read-bbox path: dereferences cursor and bbox even when they point to the ROM", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const objAddr = 0x401c00;
    const cursorAddr = 0x00023f66;
    const bboxAddr = 0x00024000;

    setupChain({
      s,
      gameMode: REQUIRED_GAME_MODE_A,
      marbleX: 100,
      marbleY: 100,
      activeSlots: [0],
      slotPos: { 0: { x: 120, y: 120 } },
      scriptId: { 0: 0x55 },
    });
    setLong(s, SLOT_BASE_ADDR + SLOT_BBOX_PTRPTR_OFF, cursorAddr);
    setRomLong(rom, cursorAddr, bboxAddr);
    setRomByte(rom, bboxAddr + 4, -30);
    setRomByte(rom, bboxAddr + 5, -30);
    setRomByte(rom, bboxAddr + 6, 60);
    setRomByte(rom, bboxAddr + 7, 60);

    const r = stringViewportHit175C8(s, objAddr, undefined, 0, rom);

    expect(r.hitSlotIndex).toBe(0);
    expect(r.retVal).toBe(1);
    expect(s.workRam[offOf(objAddr + ENTITY_SCRIPT_ID_OFF)]).toBe(0x55);
    expect(s.workRam[offOf(SLOT_BASE_ADDR + SLOT_NEW_STATE_OFF)]).toBe(0x1c);
  });

  it("only the FIRST colliding slot triggers a hit (early-exit)", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    setupChain({
      s,
      gameMode: REQUIRED_GAME_MODE_B,
      marbleX: 50,
      marbleY: 50,
      activeSlots: [0, 1, 2, 3, 4, 5, 6],
      slotPos: {
        0: { x: 50, y: 50 }, // hit candidate 1
        1: { x: 50, y: 50 }, // hit candidate 2 (NOT visited)
        2: { x: 50, y: 50 },
      },
      slotBboxAddr: {
        0: BBOX_SENTINEL,
        1: BBOX_SENTINEL,
        2: BBOX_SENTINEL,
      },
      scriptId: { 0: 0xaa, 1: 0xbb, 2: 0xcc },
    });

    let entityCalls = 0;
    const r = stringViewportHit175C8(s, objAddr, {
      entityStateTransition: () => entityCalls++,
    });

    expect(r.hitSlotIndex).toBe(0); // first
    expect(entityCalls).toBe(1); // ONLY 1 call
    expect(s.workRam[offOf(objAddr + ENTITY_SCRIPT_ID_OFF)]).toBe(0xaa); // scriptId of the ONLY slot 0
    // slot 0 has new_state=0x1c, slot 1/2 unchanged
    expect(s.workRam[offOf(SLOT_BASE_ADDR + 0 * SLOT_STRIDE + SLOT_NEW_STATE_OFF)]).toBe(0x1c);
    expect(s.workRam[offOf(SLOT_BASE_ADDR + 1 * SLOT_STRIDE + SLOT_NEW_STATE_OFF)]).toBe(0);
    expect(r.perSlot[0]).toBe("hit");
    expect(r.perSlot[1]).toBe("skipped_after_hit");
  });

  it("default subs (no-op): does not crash, side-effects on workRam still applied", () => {
    const s = emptyGameState();
    const objAddr = 0x401c00;
    setupChain({
      s,
      gameMode: REQUIRED_GAME_MODE_A,
      marbleX: 10,
      marbleY: 10,
      activeSlots: [4],
      slotPos: { 4: { x: 10, y: 10 } },
      slotBboxAddr: { 4: BBOX_SENTINEL },
      scriptId: { 4: 0x33 },
    });

    // No subs passed.
    const r = stringViewportHit175C8(s, objAddr);

    expect(r.hitSlotIndex).toBe(4);
    expect(r.retVal).toBe(1);
    expect(s.workRam[offOf(objAddr + ENTITY_SCRIPT_ID_OFF)]).toBe(0x33);
    expect(s.workRam[offOf(SLOT_BASE_ADDR + 4 * SLOT_STRIDE + SLOT_NEW_STATE_OFF)]).toBe(0x1c);
  });
});
