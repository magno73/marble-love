/**
 * slot-insert-sorted-18e6c.test.ts — smoke + corner case of FUN_18E6C.
 *
 */

import { describe, it, expect } from "vitest";
import {
  slotInsertSorted18E6C,
  BYTE_ARRAY_ABS,
  BYTE_ARRAY_LEN,
  RECT_SLOT_ABS,
  RECT_SLOT_STRIDE,
  RECT_SLOT_END_OFF,
  SENTINEL_BYTE,
} from "../src/slot-insert-sorted-18e6c.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x00400000;
const BYTE_OFF = BYTE_ARRAY_ABS - WORK_RAM_BASE; // 0x3BC
const SLOT_OFF = RECT_SLOT_ABS - WORK_RAM_BASE; // 0x1DC

function freshState() {
  const s = emptyGameState();
  for (let i = 0; i < BYTE_ARRAY_LEN; i++) s.workRam[BYTE_OFF + i] = SENTINEL_BYTE;
  for (let i = 0; i < RECT_SLOT_END_OFF; i++) s.workRam[SLOT_OFF + i] = 0;
  return s;
}

/** Setup ROM lookup table @ 0x1F0E2 puntando a 16 slot in workRam. */
function setupRom() {
  const rom = emptyRomImage();
  for (let i = 0; i < 16; i++) {
    const ptr = (RECT_SLOT_ABS + i * RECT_SLOT_STRIDE) >>> 0;
    const off = 0x1f0e2 + i * 4;
    rom.program[off] = (ptr >>> 24) & 0xff;
    rom.program[off + 1] = (ptr >>> 16) & 0xff;
    rom.program[off + 2] = (ptr >>> 8) & 0xff;
    rom.program[off + 3] = ptr & 0xff;
  }
  return rom;
}

describe("slotInsertSorted18E6C (FUN_18E6C)", () => {
  it("inserisce in the lista vuota: byte[0] = 0 (slot 0), slot[0] = [type, sub]", () => {
    const s = freshState();
    const rom = setupRom();

    const r = slotInsertSorted18E6C(s, rom, 0x2c, 0x05);

    // Loop1 termina al first sentinel a A3 = a2Off+0 ⇒ insertOnSentinel=true,
    // insertPos = 0x3BC.
    expect(r.inserted).toBe(true);
    expect(r.insertPos).toBe(BYTE_OFF);
    expect(r.slotIdx).toBe(0);
    expect(r.insertOnSentinel).toBe(true);

    // byte[0] = 0 (slot index)
    expect(s.workRam[BYTE_OFF]).toBe(0);
    // byte[1..0x1F] inalterati (sentinel)
    for (let i = 1; i < BYTE_ARRAY_LEN; i++) {
      expect(s.workRam[BYTE_OFF + i]).toBe(SENTINEL_BYTE);
    }

    // Slot 0: bytes 0..1 = [0x2C, 0x05]; offsets 2..0xD = 0 (default subs no-op).
    expect(s.workRam[SLOT_OFF]).toBe(0x2c);
    expect(s.workRam[SLOT_OFF + 1]).toBe(0x05);
    for (let i = 2; i < RECT_SLOT_STRIDE; i++) {
      expect(s.workRam[SLOT_OFF + i]).toBe(0);
    }
  });

  it("trova il first slot free saltando uno occupied", () => {
    const s = freshState();
    const rom = setupRom();

    // Pre-occupa slot 0 and 1 (byte 0 != 0).
    s.workRam[SLOT_OFF + 0 * RECT_SLOT_STRIDE] = 0x10;
    s.workRam[SLOT_OFF + 1 * RECT_SLOT_STRIDE] = 0x20;

    const r = slotInsertSorted18E6C(s, rom, 0x40, 0x07);

    // Slot 0 and 1 pieni → d1 = 2 (slot 2 free).
    expect(r.inserted).toBe(true);
    expect(r.slotIdx).toBe(2);
    // byte[0] = 2 (slot index)
    expect(s.workRam[BYTE_OFF]).toBe(2);
    // Slot 2 popolato
    const slot2Off = SLOT_OFF + 2 * RECT_SLOT_STRIDE;
    expect(s.workRam[slot2Off]).toBe(0x40);
    expect(s.workRam[slot2Off + 1]).toBe(0x07);
    // Slot 0 and 1 inalterati
    expect(s.workRam[SLOT_OFF]).toBe(0x10);
    expect(s.workRam[SLOT_OFF + RECT_SLOT_STRIDE]).toBe(0x20);
  });

  it("returns inserted=false se all the slot are pieni (31 slot)", () => {
    const s = freshState();
    const rom = setupRom();

    const numSlots = Math.floor(RECT_SLOT_END_OFF / RECT_SLOT_STRIDE); // 31
    for (let i = 0; i < numSlots; i++) {
      s.workRam[SLOT_OFF + i * RECT_SLOT_STRIDE] = 0xff; // (slot)[0] != 0
    }

    const r = slotInsertSorted18E6C(s, rom, 0x2c, 0x00);

    expect(r.inserted).toBe(false);
    expect(r.slotIdx).toBe(null);
    for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
      expect(s.workRam[BYTE_OFF + i]).toBe(SENTINEL_BYTE);
    }
  });

  it("invoca subs.fun_1b12a con (typeCode, subIdx, localRect) and uses il risultato per il compare", () => {
    const s = freshState();
    const rom = setupRom();

    const captured: Array<{ type: number; sub: number; rect: number[] }> = [];
    slotInsertSorted18E6C(s, rom, 0x29, 0x42, {
      fun_1b12a: (_st, type, sub, local) => {
        captured.push({
          type,
          sub,
          rect: Array.from(local),
        });
        local[2] = 0x12;
        local[3] = 0x34;
      },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.type).toBe(0x29);
    expect(captured[0]!.sub).toBe(0x42);
    expect(captured[0]!.rect[0]).toBe(0x29);
    expect(captured[0]!.rect[1]).toBe(0x42);
    expect(captured[0]!.rect.slice(2)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("preserva il sentinel a byte[0x1F] dopo lo shift right", () => {
    const s = freshState();
    const rom = setupRom();

    // produrranno compare = 0 deterministicamente.
    // Per testare specificamente il sentinel a byte[0x1F], prepopoliamo
    for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
      s.workRam[BYTE_OFF + i] = i < 16 ? i : SENTINEL_BYTE;
    }
    // FUN_1A80A with sums=0: D3<=D2 (0<=0) -> return 0. Loop continues.

    slotInsertSorted18E6C(s, rom, 0x29, 0x00);

    // byte[0x1F] MUST rimanere sentinel (clamp of the shift).
    expect(s.workRam[BYTE_OFF + 0x1f]).toBe(SENTINEL_BYTE);
  });
});
