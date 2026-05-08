/**
 * helper-18f46.test.ts — smoke + corner case di FUN_18F46.
 *
 * Bit-perfect parity vs binario verificata in
 * `cli/src/test-helper-18f46-parity.ts` (500 casi).
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
 * Crea state e rom con byte-array pre-popolato. Ogni entry è [slotIdx],
 * e il rect-slot indicizzato ha struct[0]=typeCode, struct[1]=subIdx.
 *
 * @param entries  Array di {slotIdx, typeCode, subIdx} da inserire.
 */
function freshStateWithEntries(
  entries: Array<{ slotIdx: number; typeCode: number; subIdx: number }>,
) {
  const state = emptyGameState();
  const rom = emptyRomImage();
  setupRomLookup(rom);

  // Riempi byte-array con sentinel.
  for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
    state.workRam[BYTE_OFF + i] = SENTINEL_BYTE;
  }

  // Inserisci entries.
  for (let i = 0; i < entries.length; i++) {
    const { slotIdx, typeCode, subIdx } = entries[i]!;
    // byte-array[i] = slotIdx
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
  it("non trova nulla in lista vuota (tutti sentinel)", () => {
    const { state, rom } = freshStateWithEntries([]);
    const r = helper18F46(state, rom, 0x2c, 0x05);

    expect(r.removed).toBe(false);
    expect(r.foundPos).toBeNull();
    expect(r.slotIdx).toBeNull();

    // byte-array invariato
    for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
      expect(state.workRam[BYTE_OFF + i]).toBe(SENTINEL_BYTE);
    }
  });

  it("rimuove l'unico elemento della lista", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x2c, subIdx: 0x05 },
    ]);

    const r = helper18F46(state, rom, 0x2c, 0x05);

    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF);
    expect(r.slotIdx).toBe(0);

    // byte-array[0] deve essere sentinel dopo la rimozione
    expect(state.workRam[BYTE_OFF]).toBe(SENTINEL_BYTE);
    // struct[0] del slot 0 deve essere 0 (libero)
    expect(state.workRam[RECT_SLOT_OFF]).toBe(0);
  });

  it("rimuove il primo di tre elementi, altri shiftati a sinistra", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x01, subIdx: 0x00 },
      { slotIdx: 1, typeCode: 0x02, subIdx: 0x00 },
      { slotIdx: 2, typeCode: 0x03, subIdx: 0x00 },
    ]);

    const r = helper18F46(state, rom, 0x01, 0x00);

    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF);
    expect(r.slotIdx).toBe(0);

    // byte-array deve essere [1, 2, 0xFF, ...]
    expect(state.workRam[BYTE_OFF + 0]).toBe(1);
    expect(state.workRam[BYTE_OFF + 1]).toBe(2);
    expect(state.workRam[BYTE_OFF + 2]).toBe(SENTINEL_BYTE);

    // struct[0] dello slot 0 deve essere 0 (liberato)
    expect(state.workRam[RECT_SLOT_OFF + 0 * RECT_SLOT_STRIDE]).toBe(0);
    // struct[0] degli altri slot invariato
    expect(state.workRam[RECT_SLOT_OFF + 1 * RECT_SLOT_STRIDE]).toBe(0x02);
    expect(state.workRam[RECT_SLOT_OFF + 2 * RECT_SLOT_STRIDE]).toBe(0x03);
  });

  it("rimuove il secondo di tre elementi", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x01, subIdx: 0x00 },
      { slotIdx: 1, typeCode: 0x02, subIdx: 0x00 },
      { slotIdx: 2, typeCode: 0x03, subIdx: 0x00 },
    ]);

    const r = helper18F46(state, rom, 0x02, 0x00);

    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF + 1);
    expect(r.slotIdx).toBe(1);

    // byte-array deve essere [0, 2, 0xFF, ...]
    expect(state.workRam[BYTE_OFF + 0]).toBe(0);
    expect(state.workRam[BYTE_OFF + 1]).toBe(2);
    expect(state.workRam[BYTE_OFF + 2]).toBe(SENTINEL_BYTE);

    // struct[0] dello slot 1 deve essere 0 (liberato)
    expect(state.workRam[RECT_SLOT_OFF + 1 * RECT_SLOT_STRIDE]).toBe(0);
  });

  it("rimuove l'ultimo di tre elementi", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x01, subIdx: 0x00 },
      { slotIdx: 1, typeCode: 0x02, subIdx: 0x00 },
      { slotIdx: 2, typeCode: 0x03, subIdx: 0x00 },
    ]);

    const r = helper18F46(state, rom, 0x03, 0x00);

    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF + 2);
    expect(r.slotIdx).toBe(2);

    // byte-array deve essere [0, 1, 0xFF, ...] (terzo elemento rimosso)
    expect(state.workRam[BYTE_OFF + 0]).toBe(0);
    expect(state.workRam[BYTE_OFF + 1]).toBe(1);
    expect(state.workRam[BYTE_OFF + 2]).toBe(SENTINEL_BYTE);

    // struct[0] dello slot 2 deve essere 0 (liberato)
    expect(state.workRam[RECT_SLOT_OFF + 2 * RECT_SLOT_STRIDE]).toBe(0);
  });

  it("non trova nulla se typeCode non corrisponde", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x10, subIdx: 0x20 },
    ]);

    const r = helper18F46(state, rom, 0x99, 0x20);

    expect(r.removed).toBe(false);
    // byte-array invariato
    expect(state.workRam[BYTE_OFF]).toBe(0);
    expect(state.workRam[BYTE_OFF + 1]).toBe(SENTINEL_BYTE);
    // struct non azzerato
    expect(state.workRam[RECT_SLOT_OFF]).toBe(0x10);
  });

  it("non trova nulla se subIdx non corrisponde (typeCode match, subIdx mismatch)", () => {
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x10, subIdx: 0x20 },
    ]);

    const r = helper18F46(state, rom, 0x10, 0x99);

    expect(r.removed).toBe(false);
    expect(state.workRam[BYTE_OFF]).toBe(0);
    expect(state.workRam[RECT_SLOT_OFF]).toBe(0x10);
  });

  it("trova il primo match su typeCode+subIdx esatti (non il secondo slot con stesso type)", () => {
    // Due slot con stesso typeCode 0x05, subIdx diversi: 0x0A e 0x0B.
    const { state, rom } = freshStateWithEntries([
      { slotIdx: 0, typeCode: 0x05, subIdx: 0x0a },
      { slotIdx: 1, typeCode: 0x05, subIdx: 0x0b },
    ]);

    const r = helper18F46(state, rom, 0x05, 0x0b);

    // Deve trovare il secondo (slotIdx=1, pos=BYTE_OFF+1)
    expect(r.removed).toBe(true);
    expect(r.foundPos).toBe(BYTE_OFF + 1);
    expect(r.slotIdx).toBe(1);

    // byte-array: [0, FF, ...] (elemento 1 rimosso)
    expect(state.workRam[BYTE_OFF]).toBe(0);
    expect(state.workRam[BYTE_OFF + 1]).toBe(SENTINEL_BYTE);

    // Slot 0 invariato, slot 1 liberato
    expect(state.workRam[RECT_SLOT_OFF]).toBe(0x05);
    expect(state.workRam[RECT_SLOT_OFF + 1 * RECT_SLOT_STRIDE]).toBe(0);
  });

  it("lista con un solo sentinel immediato (byte[0]=0xFF): no-op", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomLookup(rom);

    state.workRam[BYTE_OFF] = SENTINEL_BYTE;

    const r = helper18F46(state, rom, 0x01, 0x00);

    expect(r.removed).toBe(false);
    expect(state.workRam[BYTE_OFF]).toBe(SENTINEL_BYTE);
  });

  it("rimozione dal fondo di una lista piena di 5 elementi: sentinel scritto correttamente", () => {
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

    // byte-array deve essere [0,1,2,3,FF,FF,...] dopo la rimozione
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

    // Prima rimozione: rimuovi typeCode=0x01
    const r1 = helper18F46(state, rom, 0x01, 0x00);
    expect(r1.removed).toBe(true);

    // byte-array ora: [1, 2, FF, ...]
    expect(state.workRam[BYTE_OFF + 0]).toBe(1);
    expect(state.workRam[BYTE_OFF + 1]).toBe(2);
    expect(state.workRam[BYTE_OFF + 2]).toBe(SENTINEL_BYTE);

    // Seconda rimozione: rimuovi typeCode=0x02 (ora al pos 0)
    const r2 = helper18F46(state, rom, 0x02, 0x00);
    expect(r2.removed).toBe(true);
    expect(r2.foundPos).toBe(BYTE_OFF);

    // byte-array ora: [2, FF, ...]
    expect(state.workRam[BYTE_OFF + 0]).toBe(2);
    expect(state.workRam[BYTE_OFF + 1]).toBe(SENTINEL_BYTE);
  });
});
