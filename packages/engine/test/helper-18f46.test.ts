/**
 * helper-18f46.test.ts — smoke + corner case of FUN_18F46.
 *
 */

import { describe, it, expect } from "vitest";
import {
  helper18F46,
  BYTE_ARRAY_ABS,
  BYTE_ARRAY_LEN,
  ROM_LOOKUP_OFF,
  SENTINEL_BYTE,
} from "../src/helper-18f46.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x00400000;
const BYTE_OFF = BYTE_ARRAY_ABS - WORK_RAM_BASE; // 0x3BC

// Rect-slot base @ 0x4001DC, stride 14 byte.
const RECT_SLOT_ABS = 0x004001dc;
const RECT_SLOT_STRIDE = 0x0e;
const RECT_SLOT_OFF = RECT_SLOT_ABS - WORK_RAM_BASE; // 0x1DC

/**
 * Setup ROM lookup table @ 0x1F0E2 → pointing to 16 rect-slot entries
 * in workRam at 0x4001DC stride 14 byte.
 */
function setupRomLookup(rom: ReturnType<typeof emptyRomImage>): void {
  for (let i = 0; i < 16; i++) {
    const ptr = (RECT_SLOT_ABS + i * RECT_SLOT_STRIDE) >>> 0;
    const off = ROM_LOOKUP_OFF + i * 4;
    rom.program[off] = (ptr >>> 24) & 0xff;
    rom.program[off + 1] = (ptr >>> 16) & 0xff;
    rom.program[off + 2] = (ptr >>> 8) & 0xff;
    rom.program[off + 3] = ptr & 0xff;
  }
}

/**
 * and il rect-slot indicizzato ha struct[0]=typeCode, struct[1]=subIdx.
 *
 */
function freshStateWithEntries(
  entries: Array<{ slotIdx: number; typeCode: number; subIdx: number }>,
) {
  const state = emptyGameState();
  const rom = emptyRomImage();
  setupRomLookup(rom);

  for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
    state.workRam[BYTE_OFF + i] = SENTINEL_BYTE;
  }

  // Inserisci entries.
  for (let i = 0; i < entries.length; i++) {
    const { slotIdx, typeCode, subIdx } = entries[i]!;
    state.workRam[BYTE_OFF + i] = slotIdx & 0xff;
    // rect-slot[slotIdx].struct[0] = typeCode, [1] = subIdx
    const sOff = RECT_SLOT_OFF + slotIdx * RECT_SLOT_STRIDE;
    state.workRam[sOff] = typeCode & 0xff;
    state.workRam[sOff + 1] = subIdx & 0xff;
  }

  return { state, rom };
}

// ─── Test cases ───────────────────────────────────────────────────────────────

describe("helper18F46 (FUN_18F46)", () => {
  it("non trova nulla in lista vuota (all sentinel)", () => {
    const { state, rom } = freshStateWithEntries([]);
    const r = helper18F46(state, rom, 0x2c, 0x05);

    expect(r.removed).toBe(false);
    expect(r.foundPos).toBeNull();
    expect(r.slotIdx).toBeNull();

    for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
      expect(state.workRam[BYTE_OFF + i]).toBe(SENTINEL_BYTE);
    }
  });

  it("rimuove l'single elemento of the lista", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x2c, subIdx: 0x05 },
    ]);

    const r = helper18F46(state, rom, 0x2c, 0x05);

    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF);
    expect(r.slotIdx).toBe(0);

    expect(state.workRam[BYTE_OFF]).toBe(SENTINEL_BYTE);
    // slot 0 struct[0] must be 0 (free).
    expect(state.workRam[RECT_SLOT_OFF]).toBe(0);
  });

  it("rimuove il first of tre elementi, altri shiftati a sinistra", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x01, subIdx: 0x00 },
      { slotIdx: 1, typeCode: 0x02, subIdx: 0x00 },
      { slotIdx: 2, typeCode: 0x03, subIdx: 0x00 },
    ]);

    const r = helper18F46(state, rom, 0x01, 0x00);

    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF);
    expect(r.slotIdx).toBe(0);

    expect(state.workRam[BYTE_OFF + 0]).toBe(1);
    expect(state.workRam[BYTE_OFF + 1]).toBe(2);
    expect(state.workRam[BYTE_OFF + 2]).toBe(SENTINEL_BYTE);

    // slot 0 struct[0] must be 0 (freed).
    expect(state.workRam[RECT_SLOT_OFF + 0 * RECT_SLOT_STRIDE]).toBe(0);
    // struct[0] of other slots unchanged.
    expect(state.workRam[RECT_SLOT_OFF + 1 * RECT_SLOT_STRIDE]).toBe(0x02);
    expect(state.workRam[RECT_SLOT_OFF + 2 * RECT_SLOT_STRIDE]).toBe(0x03);
  });

  it("rimuove il second of tre elementi", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x01, subIdx: 0x00 },
      { slotIdx: 1, typeCode: 0x02, subIdx: 0x00 },
      { slotIdx: 2, typeCode: 0x03, subIdx: 0x00 },
    ]);

    const r = helper18F46(state, rom, 0x02, 0x00);

    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF + 1);
    expect(r.slotIdx).toBe(1);

    expect(state.workRam[BYTE_OFF + 0]).toBe(0);
    expect(state.workRam[BYTE_OFF + 1]).toBe(2);
    expect(state.workRam[BYTE_OFF + 2]).toBe(SENTINEL_BYTE);

    // slot 1 struct[0] must be 0 (freed).
    expect(state.workRam[RECT_SLOT_OFF + 1 * RECT_SLOT_STRIDE]).toBe(0);
  });

  it("rimuove l'last of tre elementi", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x01, subIdx: 0x00 },
      { slotIdx: 1, typeCode: 0x02, subIdx: 0x00 },
      { slotIdx: 2, typeCode: 0x03, subIdx: 0x00 },
    ]);

    const r = helper18F46(state, rom, 0x03, 0x00);

    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF + 2);
    expect(r.slotIdx).toBe(2);

    expect(state.workRam[BYTE_OFF + 0]).toBe(0);
    expect(state.workRam[BYTE_OFF + 1]).toBe(1);
    expect(state.workRam[BYTE_OFF + 2]).toBe(SENTINEL_BYTE);

    // slot 2 struct[0] must be 0 (freed).
    expect(state.workRam[RECT_SLOT_OFF + 2 * RECT_SLOT_STRIDE]).toBe(0);
  });

  it("non trova nulla se typeCode non corresponds", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x10, subIdx: 0x20 },
    ]);

    const r = helper18F46(state, rom, 0x99, 0x20);

    expect(r.removed).toBe(false);
    expect(state.workRam[BYTE_OFF]).toBe(0);
    expect(state.workRam[BYTE_OFF + 1]).toBe(SENTINEL_BYTE);
    expect(state.workRam[RECT_SLOT_OFF]).toBe(0x10);
  });

  it("non trova nulla se subIdx non corresponds (typeCode match, subIdx mismatch)", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x10, subIdx: 0x20 },
    ]);

    const r = helper18F46(state, rom, 0x10, 0x99);

    expect(r.removed).toBe(false);
    expect(state.workRam[BYTE_OFF]).toBe(0);
    expect(state.workRam[RECT_SLOT_OFF]).toBe(0x10);
  });

  it("trova il first match su typeCode+subIdx esatti (non il second slot con same type)", () => {
    // Two slots with same typeCode 0x05, different subIdx values: 0x0A and 0x0B.
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x05, subIdx: 0x0a },
      { slotIdx: 1, typeCode: 0x05, subIdx: 0x0b },
    ]);

    const r = helper18F46(state, rom, 0x05, 0x0b);

    // Deve trovare il second (slotIdx=1, pos=BYTE_OFF+1)
    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF + 1);
    expect(r.slotIdx).toBe(1);

    expect(state.workRam[BYTE_OFF]).toBe(0);
    expect(state.workRam[BYTE_OFF + 1]).toBe(SENTINEL_BYTE);

    // Slot 0 unchanged, slot 1 freed.
    expect(state.workRam[RECT_SLOT_OFF]).toBe(0x05);
    expect(state.workRam[RECT_SLOT_OFF + 1 * RECT_SLOT_STRIDE]).toBe(0);
  });

  it("lista con un only ifntinel immediato (byte[0]=0xFF): no-op", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomLookup(rom);

    state.workRam[BYTE_OFF] = SENTINEL_BYTE;

    const r = helper18F46(state, rom, 0x01, 0x00);

    expect(r.removed).toBe(false);
    expect(state.workRam[BYTE_OFF]).toBe(SENTINEL_BYTE);
  });

  it("rimozione from the fondo of una lista piena of 5 elementi: sentinel scritto correttamente", () => {
    const entries = [
      { slotIdx: 0, typeCode: 0x01, subIdx: 0x00 },
      { slotIdx: 1, typeCode: 0x02, subIdx: 0x00 },
      { slotIdx: 2, typeCode: 0x03, subIdx: 0x00 },
      { slotIdx: 3, typeCode: 0x04, subIdx: 0x00 },
      { slotIdx: 4, typeCode: 0x05, subIdx: 0x00 },
    ];
    const { state, rom } = freshStateWithEntries(entries);

    const r = helper18F46(state, rom, 0x05, 0x00);

    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF + 4);

    expect(state.workRam[BYTE_OFF + 0]).toBe(0);
    expect(state.workRam[BYTE_OFF + 1]).toBe(1);
    expect(state.workRam[BYTE_OFF + 2]).toBe(2);
    expect(state.workRam[BYTE_OFF + 3]).toBe(3);
    expect(state.workRam[BYTE_OFF + 4]).toBe(SENTINEL_BYTE);
  });

  it("doppia rimozione: rimuovi due elementi in sequenza", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x01, subIdx: 0x00 },
      { slotIdx: 1, typeCode: 0x02, subIdx: 0x00 },
      { slotIdx: 2, typeCode: 0x03, subIdx: 0x00 },
    ]);

    const r1 = helper18F46(state, rom, 0x01, 0x00);
    expect(r1.removed).toBe(true);

    expect(state.workRam[BYTE_OFF + 0]).toBe(1);
    expect(state.workRam[BYTE_OFF + 1]).toBe(2);
    expect(state.workRam[BYTE_OFF + 2]).toBe(SENTINEL_BYTE);

    // Seconda rimozione: rimuovi typeCode=0x02 (ora al pos 0)
    const r2 = helper18F46(state, rom, 0x02, 0x00);
    expect(r2.removed).toBe(true);
    expect(r2.foundPos).toBe(BYTE_OFF);

    expect(state.workRam[BYTE_OFF + 0]).toBe(2);
    expect(state.workRam[BYTE_OFF + 1]).toBe(SENTINEL_BYTE);
  });
});
