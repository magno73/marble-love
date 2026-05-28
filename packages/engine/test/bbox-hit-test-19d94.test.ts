/**
 * bbox-hit-test-19d94.test.ts — smoke tests per `FUN_00019D94`.
 *
 *   1. Early-exit with `*0x400394 != 4`.
 *      (slot[0x1A]=2, slot[0x1C..1F]=0x22546, slot[0x25]=4, slot[0x24]=0,
 *      entity[0x1A]=0x0B, entity[0x57]=0x66) + sound 0x3E.
 *   3. Slot non armate (byte 0x18 == 0) ignorate.
 *   5. Bbox edge: x=slot.x+6 (right) → ble → miss; y=slot.y+8 (bottom) → ble.
 */

import { describe, it, expect } from "vitest";
import {
  bboxHitTest19D94,
  REQUIRED_GAME_MODE,
  SLOT_ARRAY_BASE_ADDR,
  SLOT_STRIDE,
  HIT_SCRIPT_PTR,
  HIT_ENTITY_STATE,
  HIT_ENTITY_FIELD_57,
  HIT_SLOT_STATE,
  HIT_SLOT_NEW_STATE,
  SOUND_HIT_COMMAND,
  GAME_MODE_WORD_OFF,
  MARBLE_X_WORD_OFF,
  MARBLE_Y_WORD_OFF,
} from "../src/bbox-hit-test-19d94.js";
import { emptyGameState } from "../src/state.js";

const ENTITY_BASE = 0x401e00;
const ENTITY_OFF = ENTITY_BASE - 0x400000;

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

function readLongBE(s: State, off: number): number {
  return (
    ((s.workRam[off] ?? 0) << 24) |
    ((s.workRam[off + 1] ?? 0) << 16) |
    ((s.workRam[off + 2] ?? 0) << 8) |
    (s.workRam[off + 3] ?? 0)
  ) >>> 0;
}

function slotOff(i: number): number {
  return SLOT_ARRAY_BASE_ADDR - 0x400000 + i * SLOT_STRIDE;
}

function armSlot(s: State, i: number, cx: number, cy: number): void {
  const off = slotOff(i);
  setByte(s, off + 0x18, 1); // armed
  setByte(s, off + 0x1a, 0); // free
  setWordBE(s, off + 0x0c, cx & 0xffff);
  setWordBE(s, off + 0x10, cy & 0xffff);
}

/** Setta game-mode = 4 e marble pos = (mx, my). */
function configureCommon(s: State, mx: number, my: number): void {
  setWordBE(s, GAME_MODE_WORD_OFF, REQUIRED_GAME_MODE);
  setWordBE(s, MARBLE_X_WORD_OFF, mx & 0xffff);
  setWordBE(s, MARBLE_Y_WORD_OFF, my & 0xffff);
}

describe("bboxHitTest19D94 (FUN_00019D94)", () => {
  it("early-exit: *0x400394 != 4 → niente loop, perSlot vuoto, hitCount=0", () => {
    const s = emptyGameState();
    setWordBE(s, GAME_MODE_WORD_OFF, 0x0002); // != 4
    armSlot(s, 0, 100, 100);
    setWordBE(s, MARBLE_X_WORD_OFF, 100);
    setWordBE(s, MARBLE_Y_WORD_OFF, 100);
    let soundCalls = 0;
    const r = bboxHitTest19D94(s, ENTITY_BASE, {
      soundCommand: () => { soundCalls++; },
    });
    expect(r.earlyExit).toBe(true);
    expect(r.perSlot).toEqual([]);
    expect(r.hitCount).toBe(0);
    expect(r.soundTriggers).toBe(0);
    expect(soundCalls).toBe(0);
    // Slot 0 must not have been touched.
    expect(readByte(s, slotOff(0) + 0x1a)).toBe(0);
  });

  it("hit semplice: slot armata + marble centrata → tutti i field scritti", () => {
    const s = emptyGameState();
    configureCommon(s, 100, 50);
    armSlot(s, 3, 100, 50); // bbox = [94..106) x [46..58)
    const sounds: number[] = [];
    const r = bboxHitTest19D94(s, ENTITY_BASE, {
      soundCommand: (cmd) => { sounds.push(cmd); },
    });
    expect(r.earlyExit).toBe(false);
    expect(r.hitCount).toBe(1);
    expect(r.soundTriggers).toBe(1);
    expect(r.perSlot[3]).toBe("hit");
    expect(sounds).toEqual([SOUND_HIT_COMMAND]);

    // Slot 3 fields:
    expect(readByte(s, slotOff(3) + 0x1a)).toBe(HIT_SLOT_STATE);
    expect(readLongBE(s, slotOff(3) + 0x1c)).toBe(HIT_SCRIPT_PTR);
    expect(readByte(s, slotOff(3) + 0x25)).toBe(HIT_SLOT_NEW_STATE);
    expect(readByte(s, slotOff(3) + 0x24)).toBe(0);

    // Entity:
    expect(readByte(s, ENTITY_OFF + 0x1a)).toBe(HIT_ENTITY_STATE);
    expect(readByte(s, ENTITY_OFF + 0x57)).toBe(HIT_ENTITY_FIELD_57);

    // The other unarmed slots must not have been touched.
    for (let i = 0; i < 10; i++) {
      if (i === 3) continue;
      expect(r.perSlot[i]).toBe("skip_armed");
    }
  });

  it("slot non armata (byte 0x18 == 0) → skip; nessuna scrittura", () => {
    const s = emptyGameState();
    configureCommon(s, 100, 50);
    // Slot 5 al centro ma NON armata
    setByte(s, slotOff(5) + 0x18, 0);
    setWordBE(s, slotOff(5) + 0x0c, 100);
    setWordBE(s, slotOff(5) + 0x10, 50);
    const r = bboxHitTest19D94(s, ENTITY_BASE);
    expect(r.hitCount).toBe(0);
    expect(r.perSlot.every((x) => x === "skip_armed")).toBe(true);
    expect(readByte(s, slotOff(5) + 0x1a)).toBe(0);
  });

  it("slot occupata (byte 0x1A != 0) → skip_state; nessuna scrittura", () => {
    const s = emptyGameState();
    configureCommon(s, 100, 50);
    armSlot(s, 7, 100, 50);
    setByte(s, slotOff(7) + 0x1a, 5);
    const r = bboxHitTest19D94(s, ENTITY_BASE);
    expect(r.hitCount).toBe(0);
    expect(r.perSlot[7]).toBe("skip_state");
    // Byte 0x1A must not be rewritten to 2.
    expect(readByte(s, slotOff(7) + 0x1a)).toBe(5);
  });

  it("bbox edge: marble.x == slot.x + 6 (right boundary, ble) → miss", () => {
    const s = emptyGameState();
    // bbox right = 100+6 = 106, ble misses if right <= marble.x -> marble.x=106 -> miss.
    configureCommon(s, 106, 50);
    armSlot(s, 0, 100, 50);
    const r = bboxHitTest19D94(s, ENTITY_BASE);
    expect(r.hitCount).toBe(0);
    expect(r.perSlot[0]).toBe("miss");

    // Invece marble.x = 105 → hit
    const s2 = emptyGameState();
    configureCommon(s2, 105, 50);
    armSlot(s2, 0, 100, 50);
    const r2 = bboxHitTest19D94(s2, ENTITY_BASE);
    expect(r2.hitCount).toBe(1);
    expect(r2.perSlot[0]).toBe("hit");
  });

  it("bbox edge: marble.x == slot.x - 6 (left boundary, bgt) → hit", () => {
    // bgt = strict greater. left = 94. miss if left > marble.x.
    const s = emptyGameState();
    configureCommon(s, 94, 50);
    armSlot(s, 0, 100, 50);
    const r = bboxHitTest19D94(s, ENTITY_BASE);
    expect(r.hitCount).toBe(1);

    // marble.x = 93 → 94 > 93 → miss
    const s2 = emptyGameState();
    configureCommon(s2, 93, 50);
    armSlot(s2, 0, 100, 50);
    const r2 = bboxHitTest19D94(s2, ENTITY_BASE);
    expect(r2.hitCount).toBe(0);
    expect(r2.perSlot[0]).toBe("miss");
  });

  it("multi-hit: 3 slot armate dentro il bbox della stessa marble pos", () => {
    const s = emptyGameState();
    configureCommon(s, 200, 100);
    armSlot(s, 0, 200, 100);
    armSlot(s, 4, 200, 100);
    armSlot(s, 9, 200, 100);
    const sounds: number[] = [];
    const r = bboxHitTest19D94(s, ENTITY_BASE, {
      soundCommand: (cmd) => { sounds.push(cmd); },
    });
    expect(r.hitCount).toBe(3);
    expect(r.soundTriggers).toBe(3);
    expect(sounds).toEqual([
      SOUND_HIT_COMMAND, SOUND_HIT_COMMAND, SOUND_HIT_COMMAND,
    ]);
    expect(r.perSlot[0]).toBe("hit");
    expect(r.perSlot[4]).toBe("hit");
    expect(r.perSlot[9]).toBe("hit");
  });

  it("subs assente → no crash, soundCommand silenziosamente skippato", () => {
    const s = emptyGameState();
    configureCommon(s, 100, 50);
    armSlot(s, 2, 100, 50);
    expect(() => bboxHitTest19D94(s, ENTITY_BASE)).not.toThrow();
    expect(readByte(s, slotOff(2) + 0x1a)).toBe(HIT_SLOT_STATE);
  });

  it("signed-word cmp: marble.x = -1 vs slot.x = 5 (bbox left=-1, right=11) → hit", () => {
    const s = emptyGameState();
    configureCommon(s, 0xffff, 50); // marble.x = -1 (signed)
    armSlot(s, 0, 5, 50);
    // bbox: left = 5 - 6 = -1; right = 5 + 6 = 11.
    // bgt: -1 > -1 false → ok
    // ble: 11 <= -1 false → ok → hit
    const r = bboxHitTest19D94(s, ENTITY_BASE);
    expect(r.hitCount).toBe(1);
  });
});
