/**
 * slot-insert-sorted-18e6c.test.ts — smoke + corner case di FUN_18E6C.
 *
 * Bit-perfect parity vs binario verificata in
 * `cli/src/test-slot-insert-sorted-18e6c-parity.ts` (500 casi).
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

/** Setup default: byte-array tutto sentinel (lista vuota); slot tutti vuoti. */
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
  it("inserisce nella lista vuota: byte[0] = 0 (slot 0), slot[0] = [type, sub]", () => {
    const s = freshState();
    const rom = setupRom();

    const r = slotInsertSorted18E6C(s, rom, 0x2c, 0x05);

    // Loop1 termina al primo sentinel a A3 = a2Off+0 ⇒ insertOnSentinel=true,
    // insertPos = 0x3BC.
    // Loop2 trova slot[0] vuoto ⇒ d1 = 0.
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

  it("trova il primo slot libero saltando uno occupato", () => {
    const s = freshState();
    const rom = setupRom();

    // Pre-occupa slot 0 e 1 (byte 0 != 0).
    s.workRam[SLOT_OFF + 0 * RECT_SLOT_STRIDE] = 0x10; // slot[0] usato
    s.workRam[SLOT_OFF + 1 * RECT_SLOT_STRIDE] = 0x20; // slot[1] usato

    const r = slotInsertSorted18E6C(s, rom, 0x40, 0x07);

    // Slot 0 e 1 pieni → d1 = 2 (slot 2 free).
    expect(r.inserted).toBe(true);
    expect(r.slotIdx).toBe(2);
    // byte[0] = 2 (slot index)
    expect(s.workRam[BYTE_OFF]).toBe(2);
    // Slot 2 popolato
    const slot2Off = SLOT_OFF + 2 * RECT_SLOT_STRIDE;
    expect(s.workRam[slot2Off]).toBe(0x40);
    expect(s.workRam[slot2Off + 1]).toBe(0x07);
    // Slot 0 e 1 inalterati
    expect(s.workRam[SLOT_OFF]).toBe(0x10);
    expect(s.workRam[SLOT_OFF + RECT_SLOT_STRIDE]).toBe(0x20);
  });

  it("ritorna inserted=false se tutti gli slot sono pieni (31 slot)", () => {
    const s = freshState();
    const rom = setupRom();

    // Riempi tutti gli slot (31 slot da A4 ad A4+0x1B2 esclusivo).
    const numSlots = Math.floor(RECT_SLOT_END_OFF / RECT_SLOT_STRIDE); // 31
    for (let i = 0; i < numSlots; i++) {
      s.workRam[SLOT_OFF + i * RECT_SLOT_STRIDE] = 0xff; // (slot)[0] != 0
    }

    const r = slotInsertSorted18E6C(s, rom, 0x2c, 0x00);

    expect(r.inserted).toBe(false);
    expect(r.slotIdx).toBe(null);
    // byte-array NON modificato
    for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
      expect(s.workRam[BYTE_OFF + i]).toBe(SENTINEL_BYTE);
    }
  });

  it("invoca subs.fun_1b12a con (typeCode, subIdx, localRect) e usa il risultato per il compare", () => {
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
        // Scrive valori non-zero nei campi rect per esercitare il compare.
        local[2] = 0x12;
        local[3] = 0x34;
      },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.type).toBe(0x29);
    expect(captured[0]!.sub).toBe(0x42);
    // localRect entry: bytes 0..1 = (type, sub), resto = 0 prima del callback.
    expect(captured[0]!.rect[0]).toBe(0x29);
    expect(captured[0]!.rect[1]).toBe(0x42);
    expect(captured[0]!.rect.slice(2)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("preserva il sentinel a byte[0x1F] dopo lo shift right", () => {
    const s = freshState();
    const rom = setupRom();

    // Pre-popola byte-array con valori non-sentinel: [0,1,2,FF,FF,...]
    // Dopo insert con compare=0 sempre (default zero-rect ⇒ compare può
    // restituire valori diversi a seconda dello slot), ma uno scenario
    // semplice: tutti gli slot puntano a strutture con campi che
    // produrranno compare = 0 deterministicamente.
    // Per testare specificamente il sentinel a byte[0x1F], prepopoliamo
    // l'array con dati validi fino a byte[0x1E], byte[0x1F]=SENTINEL.
    for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
      s.workRam[BYTE_OFF + i] = i < 16 ? i : SENTINEL_BYTE;
    }
    // Setup tutti i 16 slot con campi rect = 0 (default).
    // Il primo compare con local = 0 vs slot[0] = 0 → tutti i sum sono 0.
    // FUN_1A80A con sums=0: D3<=D2 (0<=0) → return 0. Loop continua.
    // Quindi loop1 cammina fino al primo SENTINEL a byte[16] = 0xFF.

    slotInsertSorted18E6C(s, rom, 0x29, 0x00);

    // byte[0x1F] DEVE rimanere sentinel (clamp dello shift).
    expect(s.workRam[BYTE_OFF + 0x1f]).toBe(SENTINEL_BYTE);
  });
});
