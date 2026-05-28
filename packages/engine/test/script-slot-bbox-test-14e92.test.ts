/**
 * script-slot-bbox-test-14e92.test.ts — smoke per `scriptSlotBboxTest14E92`
 * (`FUN_00014E92`).
 *
 * `packages/cli/src/test-script-slot-bbox-test-14e92-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  scriptSlotBboxTest14E92,
  SELECTOR_WORD_OFF,
  WORLD_X_WORD_OFF,
  WORLD_Y_WORD_OFF,
  WORLD_Z_WORD_OFF,
  GLOBAL_684_LONG_OFF,
  GLOBAL_688_LONG_OFF,
  SLOT_ARRAY_BASE_ADDR,
  SLOT_STRIDE,
} from "../src/script-slot-bbox-test-14e92.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;
const ENTITY_BASE = 0x401e00; // entity allocation in workRam (free area).
const ENTITY_OFF = ENTITY_BASE - WORK_RAM_BASE;

type State = ReturnType<typeof emptyGameState>;

function setByte(s: State, off: number, v: number): void {
  s.workRam[off] = v & 0xff;
}

function readByte(s: State, off: number): number {
  return (s.workRam[off] ?? 0) & 0xff;
}

function setWordBE(s: State, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

function readWordBE(s: State, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}

function setLongBE(s: State, off: number, v: number): void {
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

function readLongBE(s: State, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function slotOff(i: number): number {
  return SLOT_ARRAY_BASE_ADDR - WORK_RAM_BASE + i * SLOT_STRIDE;
}

/** Sets selector @0x400394 (word). */
function setSelector(s: State, v: number): void {
  setWordBE(s, SELECTOR_WORD_OFF, v);
}

/** Imposta marble world position (X, Y, Z). */
function setWorld(s: State, x: number, y: number, z: number): void {
  setWordBE(s, WORLD_X_WORD_OFF, x & 0xffff);
  setWordBE(s, WORLD_Y_WORD_OFF, y & 0xffff);
  setWordBE(s, WORLD_Z_WORD_OFF, z & 0xffff);
}

/** Configura uno slot armato + bbox-default (slot[0x58] punta a un long
  */
function armSlotWithDefaultBbox(
  s: State,
  i: number,
  pos: { x: number; y: number; z: number },
  state: number,
  recAddr: number,
): void {
  const off = slotOff(i);
  setByte(s, off + 0x18, 1); // armed
  setByte(s, off + 0x1a, state);
  setWordBE(s, off + 0x0c, pos.x & 0xffff);
  setWordBE(s, off + 0x10, pos.y & 0xffff);
  setWordBE(s, off + 0x14, pos.z & 0xffff);
  // slot[0x58] = recAddr (P1 in disasm). *(P1) = -1 (sentinel).
  setLongBE(s, off + 0x58, recAddr);
  setLongBE(s, recAddr - WORK_RAM_BASE, 0xffffffff);
}

/** Configure a slot with custom bbox (4 signed bytes @ recordPtr+4..+7). */
function armSlotWithCustomBbox(
  s: State,
  i: number,
  pos: { x: number; y: number; z: number },
  state: number,
  recAddr: number, // P1 (slot[0x58])
  recordAddr: number, // P2 = *(P1), record ptr
  delta: { d0: number; d3: number; d2: number; d4: number },
): void {
  const off = slotOff(i);
  setByte(s, off + 0x18, 1);
  setByte(s, off + 0x1a, state);
  setWordBE(s, off + 0x0c, pos.x & 0xffff);
  setWordBE(s, off + 0x10, pos.y & 0xffff);
  setWordBE(s, off + 0x14, pos.z & 0xffff);
  setLongBE(s, off + 0x58, recAddr);
  setLongBE(s, recAddr - WORK_RAM_BASE, recordAddr);
  // Bbox bytes @ recordAddr + 4..7.
  s.workRam[recordAddr - WORK_RAM_BASE + 4] = delta.d0 & 0xff;
  s.workRam[recordAddr - WORK_RAM_BASE + 5] = delta.d3 & 0xff;
  s.workRam[recordAddr - WORK_RAM_BASE + 6] = delta.d2 & 0xff;
  s.workRam[recordAddr - WORK_RAM_BASE + 7] = delta.d4 & 0xff;
}

describe("scriptSlotBboxTest14E92 (FUN_00014E92)", () => {
  it("selettore fuori range {1,2,5} → no side effect", () => {
    const s = emptyGameState();
    // Selector = 3 (non valido) → early exit.
    setSelector(s, 3);
    setWorld(s, 100, 100, 50);
    armSlotWithDefaultBbox(
      s,
      0,
      { x: 100, y: 100, z: 50 },
      0x00,
      0x401f00,
    );
    const before = new Uint8Array(s.workRam);
    scriptSlotBboxTest14E92(s, ENTITY_BASE);
    expect(s.workRam).toEqual(before);
  });

  it("selettore valido (=1) ma slot non-armed → no side effect", () => {
    const s = emptyGameState();
    setSelector(s, 1);
    setWorld(s, 0, 0, 0);
    const before = new Uint8Array(s.workRam);
    scriptSlotBboxTest14E92(s, ENTITY_BASE);
    expect(s.workRam).toEqual(before);
  });

  it("hit con bbox-default + state=0 → state=2 + entity field copy", () => {
    const s = emptyGameState();
    setSelector(s, 1);
    // World @ (10, 10, 5). Marble bbox: X[7..13], Y[7..13], Z[5..19].
    setWorld(s, 10, 10, 5);
    // Slot 0 @ (10, 10, 0) with default bbox -> X[6..14], Y[6..14], Z[0..16].
    // Overlap: X ✓, Y ✓, Z [5..16] vs [0..16] → marbleZNear=5 in [0,16] ✓.
    armSlotWithDefaultBbox(
      s,
      0,
      { x: 10, y: 10, z: 0 },
      0x00,
      0x401f00,
    );
    setLongBE(s, ENTITY_OFF + 0x00, 0xdeadbeef);
    setLongBE(s, ENTITY_OFF + 0x04, 0xcafebabe);
    setByte(s, ENTITY_OFF + 0x1a, 0x05); // entity state=5 → skip "default state" block

    scriptSlotBboxTest14E92(s, ENTITY_BASE);

    const off = slotOff(0);
    // Slot state changed to 2.
    expect(readByte(s, off + 0x1a)).toBe(0x02);
    // entity[0..3] = 0 (clear post-copy nel block 1503A).
    expect(readLongBE(s, ENTITY_OFF + 0x00)).toBe(0);
    expect(readLongBE(s, ENTITY_OFF + 0x04)).toBe(0);
    // slot[0..3] = old entity[0..3] = 0xDEADBEEF.
    expect(readLongBE(s, off + 0x00)).toBe(0xdeadbeef);
    expect(readLongBE(s, off + 0x1c)).toBe(0xdeadbeef);
    // slot[4..7] = old entity[4..7] = 0xCAFEBABE.
    expect(readLongBE(s, off + 0x04)).toBe(0xcafebabe);
    expect(readLongBE(s, off + 0x20)).toBe(0xcafebabe);
  });

  it("miss su X (marble fuori range slot) → no scrittura", () => {
    const s = emptyGameState();
    setSelector(s, 2);
    // World @ (100, 0, 0). Marble bbox X [97..103].
    setWorld(s, 100, 0, 0);
    armSlotWithDefaultBbox(
      s,
      0,
      { x: 0, y: 0, z: 0 },
      0x00,
      0x401f00,
    );
    const off = slotOff(0);
    const stateBefore = readByte(s, off + 0x1a);
    scriptSlotBboxTest14E92(s, ENTITY_BASE);
    expect(readByte(s, off + 0x1a)).toBe(stateBefore);
  });

  it("hit con state=1 + key NO match → write slot[0x56] e entity dispatch state-1", () => {
    const s = emptyGameState();
    setSelector(s, 1);
    setWorld(s, 0, 0, 0);
    // Slot 0 @ (0,0,0) overlap centrato. State=1 (alt-key path).
    armSlotWithDefaultBbox(
      s,
      0,
      { x: 0, y: 0, z: 0 },
      0x01, // state=1 → alt-key path
      0x401f00,
    );
    const off = slotOff(0);
    // slot[0x56] = 0xAAAA (sentinel pre-test).
    setWordBE(s, off + 0x56, 0xaaaa);
    setByte(s, ENTITY_OFF + 0x19, 0x42);
    // entity[0x1A] = 1 → branch state-1 nel dispatch.
    setByte(s, ENTITY_OFF + 0x1a, 0x01);

    scriptSlotBboxTest14E92(s, ENTITY_BASE);

    // No early exit (key non match), no bind (state=1, non in {0,3}).
    // slot[0x56] sovrascritto = 0x0042 (sext).
    expect(readWordBE(s, off + 0x56)).toBe(0x0042);
    // entity dispatch state=1: entity[0x5F]=0, entity[0x60]=2, entity[0x5A]=0x20FB6.
    expect(readByte(s, ENTITY_OFF + 0x5f)).toBe(0x00);
    expect(readByte(s, ENTITY_OFF + 0x60)).toBe(0x02);
    expect(readLongBE(s, ENTITY_OFF + 0x5a)).toBe(0x00020fb6);
    // entity[0x1A] != 5/7 → entity[0x1A] = 5, entity[0x56] = 0x32.
    expect(readByte(s, ENTITY_OFF + 0x1a)).toBe(0x05);
    expect(readByte(s, ENTITY_OFF + 0x56)).toBe(0x32);
  });

  it("hit con state=1 + key MATCH → early exit (no scritture entity)", () => {
    const s = emptyGameState();
    setSelector(s, 1);
    setWorld(s, 0, 0, 0);
    armSlotWithDefaultBbox(
      s,
      0,
      { x: 0, y: 0, z: 0 },
      0x01,
      0x401f00,
    );
    const off = slotOff(0);
    // slot[0x56].w = 0x0042; entity[0x19] = 0x42 → sext.w = 0x0042 → match.
    setWordBE(s, off + 0x56, 0x0042);
    setByte(s, ENTITY_OFF + 0x19, 0x42);
    setByte(s, ENTITY_OFF + 0x1a, 0x01);
    setByte(s, ENTITY_OFF + 0x56, 0xff);

    scriptSlotBboxTest14E92(s, ENTITY_BASE);

    // Early exit: entity unchanged.
    expect(readByte(s, ENTITY_OFF + 0x1a)).toBe(0x01);
    expect(readByte(s, ENTITY_OFF + 0x56)).toBe(0xff);
    // slot[0x56] non riscritto.
    expect(readWordBE(s, off + 0x56)).toBe(0x0042);
    expect(readByte(s, off + 0x1a)).toBe(0x01);
  });

  it("hit con bbox custom: solo slot 1 colpito (slot 0 mancato)", () => {
    const s = emptyGameState();
    setSelector(s, 5);
    setWorld(s, 50, 50, 10);
    // Slot 0 @ (0,0,0) → bbox far away → miss.
    armSlotWithCustomBbox(
      s,
      0,
      { x: 0, y: 0, z: 0 },
      0x03,
      0x401f00,
      0x401f10,
      { d0: -1, d3: -1, d2: 2, d4: 2 },
    );
    // Slot 1 @ (50,50,5) custom bbox → X[40..50] (d0=-10, d2=10),
    // Y[40..50] (d3=-10, d4=10). Marble bbox X[47..53], Y[47..53] →
    // marbleXNear=47 in [40,50] ✓, hit.
    armSlotWithCustomBbox(
      s,
      1,
      { x: 50, y: 50, z: 5 },
      0x03,
      0x401f20,
      0x401f30,
      { d0: -10, d3: -10, d2: 10, d4: 10 },
    );
    setLongBE(s, ENTITY_OFF + 0x00, 0x11111111);
    setLongBE(s, ENTITY_OFF + 0x04, 0x22222222);
    setByte(s, ENTITY_OFF + 0x1a, 0x05); // entity state=5 → skip dispatch block

    scriptSlotBboxTest14E92(s, ENTITY_BASE);

    const off0 = slotOff(0);
    const off1 = slotOff(1);
    // Slot 0: state unchanged (missed).
    expect(readByte(s, off0 + 0x1a)).toBe(0x03);
    // Slot 1: state=2 (era 3, hit + bind).
    expect(readByte(s, off1 + 0x1a)).toBe(0x02);
    expect(readLongBE(s, off1 + 0x00)).toBe(0x11111111);
    expect(readLongBE(s, off1 + 0x1c)).toBe(0x11111111);
    expect(readLongBE(s, off1 + 0x04)).toBe(0x22222222);
    expect(readLongBE(s, off1 + 0x20)).toBe(0x22222222);
  });

  it("globali 0x400684/0x400688 copiati in entity[0xC]/[0x10] su hit", () => {
    const s = emptyGameState();
    setSelector(s, 2);
    setWorld(s, 0, 0, 0);
    armSlotWithDefaultBbox(
      s,
      0,
      { x: 0, y: 0, z: 0 },
      0x00,
      0x401f00,
    );
    setLongBE(s, GLOBAL_684_LONG_OFF, 0xfeedface);
    setLongBE(s, GLOBAL_688_LONG_OFF, 0xbaadf00d);
    setByte(s, ENTITY_OFF + 0x1a, 0x02); // non-1, non-5 → default branch (sound+ptr_default)
    setByte(s, ENTITY_OFF + 0x19, 0x10);

    let soundCmd = -1;
    scriptSlotBboxTest14E92(s, ENTITY_BASE, {
      soundCommand: (cmd) => {
        soundCmd = cmd;
      },
    });

    expect(readLongBE(s, ENTITY_OFF + 0x0c)).toBe(0xfeedface);
    expect(readLongBE(s, ENTITY_OFF + 0x10)).toBe(0xbaadf00d);
    // Sound command default = 0x39.
    expect(soundCmd).toBe(0x39);
    // Script ptr default = 0x20FAA.
    expect(readLongBE(s, ENTITY_OFF + 0x5a)).toBe(0x00020faa);
  });

  it("FUN_15460 stub viene chiamato solo nel bind path (state ∈ {0,3})", () => {
    const s = emptyGameState();
    setSelector(s, 1);
    setWorld(s, 0, 0, 0);
    armSlotWithDefaultBbox(
      s,
      0,
      { x: 0, y: 0, z: 0 },
      0x03, // bind path
      0x401f00,
    );
    setByte(s, ENTITY_OFF + 0x1a, 0x05); // skip dispatch

    let calls = 0;
    let calledWith = -1;
    scriptSlotBboxTest14E92(s, ENTITY_BASE, {
      fun_15460: (slotPtr) => {
        calls++;
        calledWith = slotPtr;
      },
    });

    expect(calls).toBe(1);
    expect(calledWith).toBe(SLOT_ARRAY_BASE_ADDR);
  });

  it("stato slot=2 (non in {0,3} né in {1,5,6}) → no bind, no early exit, no key write skip", () => {
    const s = emptyGameState();
    setSelector(s, 1);
    setWorld(s, 0, 0, 0);
    armSlotWithDefaultBbox(
      s,
      0,
      { x: 0, y: 0, z: 0 },
      0x02, // non bind (state != 0,3), non alt-key (state != 1,5,6)
      0x401f00,
    );
    const off = slotOff(0);
    setByte(s, ENTITY_OFF + 0x19, 0x33);
    setByte(s, ENTITY_OFF + 0x1a, 0x05); // skip dispatch
    setWordBE(s, off + 0x56, 0xaaaa);

    let bindCalls = 0;
    scriptSlotBboxTest14E92(s, ENTITY_BASE, {
      fun_15460: () => {
        bindCalls++;
      },
    });

    expect(bindCalls).toBe(0);
    // slot state unchanged.
    expect(readByte(s, off + 0x1a)).toBe(0x02);
    // slot[0x56] sovrascritto: entity[0x1A]=5 → SKIP write.
    expect(readWordBE(s, off + 0x56)).toBe(0xaaaa);
  });
});
