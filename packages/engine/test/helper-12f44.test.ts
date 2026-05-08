/**
 * helper-12f44.test.ts — smoke + corner cases di `helper12F44` (FUN_00012F44).
 *
 * Bit-perfect parity vs binario verificata in
 * `packages/cli/src/test-helper-12f44-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  helper12F44,
  HELPER_12F44_ADDR,
} from "../src/helper-12f44.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const WRAM = 0x00400000;

// Canonical slot table: 25 slot @ 0x400A9C stride 0x56.
const SLOT_TABLE_BASE = 0x400a9c;
const SLOT_STRIDE     = 0x56;
const SLOT_PTR_TABLE  = 0x1f016;

// ROM lookup table for FUN_18F46 (@ 0x1F0E2, 16 entries → rect-slots @ 0x4001DC stride 14).
const ROM_LOOKUP_OFF  = 0x1f0e2;
const RECT_SLOT_ABS   = 0x004001dc;
const RECT_SLOT_STRIDE = 0x0e;
const RECT_SLOT_COUNT  = 16;

/** Scrive un byte in workRam tramite indirizzo M68k assoluto. */
function wb(state: ReturnType<typeof emptyGameState>, addr: number, v: number): void {
  state.workRam[addr - WRAM] = v & 0xff;
}

/** Legge un byte da workRam tramite indirizzo M68k assoluto. */
function rb(state: ReturnType<typeof emptyGameState>, addr: number): number {
  return (state.workRam[addr - WRAM] ?? 0) & 0xff;
}

/** Scrive un long BE in workRam tramite indirizzo M68k assoluto. */
function wl(state: ReturnType<typeof emptyGameState>, addr: number, v: number): void {
  const u = v >>> 0;
  state.workRam[addr - WRAM]     = (u >>> 24) & 0xff;
  state.workRam[addr - WRAM + 1] = (u >>> 16) & 0xff;
  state.workRam[addr - WRAM + 2] = (u >>> 8)  & 0xff;
  state.workRam[addr - WRAM + 3] =  u         & 0xff;
}

/** Legge un long BE da workRam tramite indirizzo M68k assoluto. */
function rl(state: ReturnType<typeof emptyGameState>, addr: number): number {
  const o = addr - WRAM;
  return (
    (((state.workRam[o]     ?? 0) << 24) |
     ((state.workRam[o + 1] ?? 0) << 16) |
     ((state.workRam[o + 2] ?? 0) << 8)  |
      (state.workRam[o + 3] ?? 0)) >>> 0
  );
}

/** Setup ROM lookup table @ 0x1F0E2 → 16 rect-slot entries in workRam. */
function setupRomLookup(rom: ReturnType<typeof emptyRomImage>): void {
  for (let i = 0; i < RECT_SLOT_COUNT; i++) {
    const ptr = (RECT_SLOT_ABS + i * RECT_SLOT_STRIDE) >>> 0;
    const off = ROM_LOOKUP_OFF + i * 4;
    rom.program[off]     = (ptr >>> 24) & 0xff;
    rom.program[off + 1] = (ptr >>> 16) & 0xff;
    rom.program[off + 2] = (ptr >>> 8)  & 0xff;
    rom.program[off + 3] =  ptr         & 0xff;
  }
}

/** Slot 0 address. */
const SLOT0 = SLOT_TABLE_BASE; // 0x400A9C

describe("helper12F44 (FUN_00012F44)", () => {
  it("HELPER_12F44_ADDR == 0x12F44", () => {
    expect(HELPER_12F44_ADDR).toBe(0x00012f44);
  });

  // ── Mode-0: bind ─────────────────────────────────────────────────────────

  it("mode-0: scrive scriptPtr in slot+0x3A, slot+0x1A=3, slot+0x18=1", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    const scriptPtr = 0x1d854;

    helper12F44(state, rom, SLOT0, 0, scriptPtr);

    // slot+0x18 = 1 (occupato)
    expect(rb(state, SLOT0 + 0x18)).toBe(0x01);
    // slot+0x1A = 3 (state init)
    expect(rb(state, SLOT0 + 0x1a)).toBe(0x03);
    // slot+0x3A = scriptPtr (long BE)
    expect(rl(state, SLOT0 + 0x3a)).toBe(scriptPtr);
  });

  it("mode-0: non tocca globali 0x400974/0x400978/0x40075C", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    wl(state, 0x400974, 0xdeadbeef);
    wl(state, 0x400978, 0x12345678);
    wb(state, 0x40075c, 0x07);

    helper12F44(state, rom, SLOT0, 0, 0x1d854);

    expect(rl(state, 0x400974)).toBe(0xdeadbeef >>> 0);
    expect(rl(state, 0x400978)).toBe(0x12345678 >>> 0);
    expect(rb(state, 0x40075c)).toBe(0x07);
  });

  it("mode-0: non tocca altri offset del record", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    // Pre-set some fields
    wb(state, SLOT0 + 0x19, 0xAB);
    wb(state, SLOT0 + 0x1e, 0x55);
    wb(state, SLOT0 + 0x1f, 0x06);

    helper12F44(state, rom, SLOT0, 0, 0x1d854);

    // Unchanged fields
    expect(rb(state, SLOT0 + 0x19)).toBe(0xAB);
    expect(rb(state, SLOT0 + 0x1e)).toBe(0x55);
    expect(rb(state, SLOT0 + 0x1f)).toBe(0x06);
  });

  // ── Mode-1: free ─────────────────────────────────────────────────────────

  it("mode-1: azzera slot+0x18 e slot+0x1A", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    wb(state, SLOT0 + 0x18, 0x01);
    wb(state, SLOT0 + 0x1a, 0x03);
    // gate1e = 1 → skip FUN_18F46
    wb(state, SLOT0 + 0x1e, 0x01);

    helper12F44(state, rom, SLOT0, 1, 0);

    expect(rb(state, SLOT0 + 0x18)).toBe(0x00);
    expect(rb(state, SLOT0 + 0x1a)).toBe(0x00);
  });

  it("mode-1: A0 == *0x400974 → azzera 0x400974 e 0x400978", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    wl(state, 0x400974, SLOT0 >>> 0);
    wl(state, 0x400978, 0xdeadcafe);
    // gate1e = 1 → skip FUN_18F46
    wb(state, SLOT0 + 0x1e, 0x01);

    helper12F44(state, rom, SLOT0, 1, 0);

    expect(rl(state, 0x400974)).toBe(0);
    expect(rl(state, 0x400978)).toBe(0);
  });

  it("mode-1: A0 != *0x400974 → globali 974/978 invariati", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    const OTHER = 0x401234;
    wl(state, 0x400974, OTHER >>> 0);
    wl(state, 0x400978, 0xabcd1234);
    wb(state, SLOT0 + 0x1e, 0x01);

    helper12F44(state, rom, SLOT0, 1, 0);

    expect(rl(state, 0x400974)).toBe(OTHER >>> 0);
    expect(rl(state, 0x400978)).toBe(0xabcd1234 >>> 0);
  });

  it("mode-1: slot+0x1F == 6 → decrementa *0x40075C di 1", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    wb(state, SLOT0 + 0x1f, 0x06);
    wb(state, 0x40075c, 0x05);
    wb(state, SLOT0 + 0x1e, 0x01);

    helper12F44(state, rom, SLOT0, 1, 0);

    expect(rb(state, 0x40075c)).toBe(0x04);
  });

  it("mode-1: slot+0x1F != 6 → *0x40075C invariato", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    wb(state, SLOT0 + 0x1f, 0x05);
    wb(state, 0x40075c, 0x05);
    wb(state, SLOT0 + 0x1e, 0x01);

    helper12F44(state, rom, SLOT0, 1, 0);

    expect(rb(state, 0x40075c)).toBe(0x05);
  });

  it("mode-1: slot+0x1F == 6 e counter == 0 → wrap-around a 0xFF", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    wb(state, SLOT0 + 0x1f, 0x06);
    wb(state, 0x40075c, 0x00);
    wb(state, SLOT0 + 0x1e, 0x01);

    helper12F44(state, rom, SLOT0, 1, 0);

    expect(rb(state, 0x40075c)).toBe(0xff);
  });

  it("mode-1: gate1e == 1 → FUN_18F46 non chiamata (nessun side effect draw-list)", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    setupRomLookup(rom);
    // Riempi byte-array con un entry a slot 0 (typeCode=0xAB subIdx=0xCD)
    const BYTE_ARRAY_OFF = 0x004003bc - WRAM;
    state.workRam[BYTE_ARRAY_OFF]     = 0x00; // slot idx 0
    state.workRam[BYTE_ARRAY_OFF + 1] = 0xff; // sentinel
    const rectOff = (RECT_SLOT_ABS - WRAM);
    state.workRam[rectOff]     = 0xAB; // typeCode del rect-slot 0
    state.workRam[rectOff + 1] = 0xCD; // subIdx

    // slot+0x1F = 0xAB (typeCode), slot+0x19 = 0xCD (subIdx)
    wb(state, SLOT0 + 0x1f, 0xAB);
    wb(state, SLOT0 + 0x19, 0xCD);
    // gate1e = 1 → NON chiama FUN_18F46
    wb(state, SLOT0 + 0x1e, 0x01);

    const before = new Uint8Array(state.workRam.slice(BYTE_ARRAY_OFF, BYTE_ARRAY_OFF + 2));

    helper12F44(state, rom, SLOT0, 1, 0);

    // Il byte-array non deve essere toccato (FUN_18F46 non chiamata)
    expect(state.workRam[BYTE_ARRAY_OFF]).toBe(before[0]);
    expect(state.workRam[BYTE_ARRAY_OFF + 1]).toBe(before[1]);
  });

  it("mode-1: gate1e != 1 → FUN_18F46 chiamata, entry rimossa dal byte-array", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    setupRomLookup(rom);

    const BYTE_ARRAY_OFF = 0x004003bc - WRAM;
    // Inserisci una entry nel byte-array: slot-idx 0 con typeCode=0x05, subIdx=0x02
    state.workRam[BYTE_ARRAY_OFF]     = 0x00; // slot idx 0 in draw-list
    state.workRam[BYTE_ARRAY_OFF + 1] = 0xff; // sentinel
    // Rect-slot 0 @ 0x4001DC: struct[0]=typeCode=0x05, struct[1]=subIdx=0x02
    const rectOff = RECT_SLOT_ABS - WRAM;
    state.workRam[rectOff]     = 0x05;
    state.workRam[rectOff + 1] = 0x02;

    // slot del nostro script-slot: +0x1F = 0x05 (typeCode), +0x19 = 0x02 (subIdx)
    wb(state, SLOT0 + 0x1f, 0x05);
    wb(state, SLOT0 + 0x19, 0x02);
    // gate1e = 0 → chiama FUN_18F46
    wb(state, SLOT0 + 0x1e, 0x00);

    helper12F44(state, rom, SLOT0, 1, 0);

    // FUN_18F46 deve aver rimosso l'entry → byte-array[0] ora sentinel
    expect(state.workRam[BYTE_ARRAY_OFF]).toBe(0xff);
    // Rect-slot 0 struct[0] deve essere 0 (liberato)
    expect(state.workRam[rectOff]).toBe(0x00);
  });

  // ── No-op modes ──────────────────────────────────────────────────────────

  it("mode < 0 (es. 0xFF = -1 sext) → no-op, nessun side effect", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    wb(state, SLOT0 + 0x18, 0x55);
    wb(state, SLOT0 + 0x1a, 0x55);
    wl(state, SLOT0 + 0x3a, 0x12345678);

    helper12F44(state, rom, SLOT0, 0xff, 0x1d854); // 0xFF sext = -1

    expect(rb(state, SLOT0 + 0x18)).toBe(0x55);
    expect(rb(state, SLOT0 + 0x1a)).toBe(0x55);
    expect(rl(state, SLOT0 + 0x3a)).toBe(0x12345678 >>> 0);
  });

  it("mode > 1 (es. 0x02) → no-op, nessun side effect", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    wb(state, SLOT0 + 0x18, 0x55);

    helper12F44(state, rom, SLOT0, 0x02, 0x1d854);

    expect(rb(state, SLOT0 + 0x18)).toBe(0x55);
  });

  it("mode == 0x80 (sext = -128) → no-op", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    wb(state, SLOT0 + 0x18, 0xAA);

    helper12F44(state, rom, SLOT0, 0x80, 0xdeadbeef);

    expect(rb(state, SLOT0 + 0x18)).toBe(0xAA);
  });

  // ── Script pointer edge cases ─────────────────────────────────────────────

  it("mode-0: scriptPtr = 0 → slot+0x3A = 0", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();
    wl(state, SLOT0 + 0x3a, 0xffffffff);

    helper12F44(state, rom, SLOT0, 0, 0);

    expect(rl(state, SLOT0 + 0x3a)).toBe(0);
  });

  it("mode-0: scriptPtr = 0xFFFFFFFF → slot+0x3A = 0xFFFFFFFF", () => {
    const state = emptyGameState();
    const rom   = emptyRomImage();

    helper12F44(state, rom, SLOT0, 0, 0xffffffff);

    expect(rl(state, SLOT0 + 0x3a)).toBe(0xffffffff >>> 0);
  });

  // ── Different slot addresses ──────────────────────────────────────────────

  it("mode-0 funziona con uno slot diverso da slot-0", () => {
    const state  = emptyGameState();
    const rom    = emptyRomImage();
    const SLOT5  = SLOT_TABLE_BASE + 5 * SLOT_STRIDE; // slot 5

    helper12F44(state, rom, SLOT5, 0, 0xabcdef12);

    expect(rb(state, SLOT5 + 0x18)).toBe(0x01);
    expect(rb(state, SLOT5 + 0x1a)).toBe(0x03);
    expect(rl(state, SLOT5 + 0x3a)).toBe(0xabcdef12 >>> 0);
    // Slot 0 invariato
    expect(rb(state, SLOT0 + 0x18)).toBe(0x00);
  });
});
