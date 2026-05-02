/**
 * Test paletteAnim1Tick (FUN_00026BEE).
 *
 * **Status**: bit-perfect verificato vs binary (1000/1000 match) tramite
 * `packages/cli/src/test-palette-anim-parity.ts`.
 *
 * Questi test cementano l'implementazione TS via input/output noti.
 */

import { describe, it, expect } from "vitest";
import { paletteAnim1Tick, OBJ_BASE_ADDR, OBJ_STRIDE, OBJ_FIELD_TYPE, OBJ_FIELD_ANIM, OBJ_FIELD_SKIP } from "../src/palette-anim.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

describe("paletteAnim1Tick", () => {
  function setup(opts: { count: number; type: number; ctr: number; skip: number }) {
    const state = emptyGameState();
    const rom = emptyRomImage();
    // Set count u16 BE @ 0x400396 (= workRam[0x396])
    state.workRam[0x396] = (opts.count >>> 8) & 0xff;
    state.workRam[0x397] = opts.count & 0xff;
    // Obj 0 fields
    const off = OBJ_BASE_ADDR - 0x400000;
    state.workRam[off + OBJ_FIELD_TYPE] = opts.type;
    state.workRam[off + OBJ_FIELD_ANIM] = opts.ctr;
    state.workRam[off + OBJ_FIELD_SKIP] = opts.skip;
    return { state, rom };
  }

  it("count=0: no-op (no obj iteration)", () => {
    const { state, rom } = setup({ count: 0, type: 1, ctr: 5, skip: 0 });
    paletteAnim1Tick(state, rom);
    // Counter stays 5
    expect(state.workRam[(OBJ_BASE_ADDR - 0x400000) + OBJ_FIELD_ANIM]).toBe(5);
  });

  it("disabled (ctr=0xFF): no-op", () => {
    const { state, rom } = setup({ count: 1, type: 1, ctr: 0xff, skip: 0 });
    paletteAnim1Tick(state, rom);
    // Counter stays 0xFF
    expect(state.workRam[(OBJ_BASE_ADDR - 0x400000) + OBJ_FIELD_ANIM]).toBe(0xff);
  });

  it("skip flag set: no-op", () => {
    const { state, rom } = setup({ count: 1, type: 1, ctr: 10, skip: 1 });
    paletteAnim1Tick(state, rom);
    // Counter stays 10 (skip)
    expect(state.workRam[(OBJ_BASE_ADDR - 0x400000) + OBJ_FIELD_ANIM]).toBe(10);
  });

  it("active obj: counter incremented + palette written", () => {
    // Imposta dati noti nel rom per la lookup table
    const { state, rom } = setup({ count: 1, type: 1, ctr: 10, skip: 0 });
    // type != 0 → table A @ 0x20B54
    // idxSigned = sext8(10) >> 2 = 2
    // rom address = 0x20B54 + 2*2 = 0x20B58
    rom.program[0x20B58] = 0xAB;
    rom.program[0x20B59] = 0xCD;
    paletteAnim1Tick(state, rom);
    // Counter went 10 → 11
    expect(state.workRam[(OBJ_BASE_ADDR - 0x400000) + OBJ_FIELD_ANIM]).toBe(11);
    // Palette word B (entry 7 = colorRam[0x0E]) = 0xABCD
    expect(state.colorRam[0x0E]).toBe(0xAB);
    expect(state.colorRam[0x0F]).toBe(0xCD);
  });

  it("counter wrap at 64 SIGNED (0x40 → 0)", () => {
    // ctr = 63 → after +1 = 64. Signed 64 > 0x3F → reset to 0.
    const { state, rom } = setup({ count: 1, type: 0, ctr: 63, skip: 0 });
    paletteAnim1Tick(state, rom);
    expect(state.workRam[(OBJ_BASE_ADDR - 0x400000) + OBJ_FIELD_ANIM]).toBe(0);
  });

  it("counter NOT wrap when signed negative (128..255)", () => {
    // ctr = 200 → after +1 = 201. Signed 201 = -55 ≤ 0x3F → no reset.
    const { state, rom } = setup({ count: 1, type: 0, ctr: 200, skip: 0 });
    paletteAnim1Tick(state, rom);
    expect(state.workRam[(OBJ_BASE_ADDR - 0x400000) + OBJ_FIELD_ANIM]).toBe(201);
  });

  it("type 0 writes palette A (entry 3 @ colorRam[0x06])", () => {
    const { state, rom } = setup({ count: 1, type: 0, ctr: 0, skip: 0 });
    // type == 0 → table B @ 0x20B34, palA dest @ colorRam[0x06]
    rom.program[0x20B34] = 0x12;
    rom.program[0x20B35] = 0x34;
    paletteAnim1Tick(state, rom);
    expect(state.colorRam[0x06]).toBe(0x12);
    expect(state.colorRam[0x07]).toBe(0x34);
    // palB unchanged
    expect(state.colorRam[0x0E]).toBe(0);
  });

  it("type non-zero writes palette B (entry 7 @ colorRam[0x0E])", () => {
    const { state, rom } = setup({ count: 1, type: 0xFE, ctr: 0, skip: 0 });
    rom.program[0x20B54] = 0xAB;
    rom.program[0x20B55] = 0xCD;
    paletteAnim1Tick(state, rom);
    expect(state.colorRam[0x0E]).toBe(0xAB);
    expect(state.colorRam[0x0F]).toBe(0xCD);
    expect(state.colorRam[0x06]).toBe(0);
  });

  it("multiple objects iterated (count=2)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    state.workRam[0x396] = 0; state.workRam[0x397] = 2; // count = 2

    const off = OBJ_BASE_ADDR - 0x400000;
    state.workRam[off + OBJ_FIELD_TYPE] = 0;  // type 0 → palA
    state.workRam[off + OBJ_FIELD_ANIM] = 0;
    state.workRam[off + OBJ_FIELD_SKIP] = 0;

    state.workRam[off + OBJ_STRIDE + OBJ_FIELD_TYPE] = 1;  // type !=0 → palB
    state.workRam[off + OBJ_STRIDE + OBJ_FIELD_ANIM] = 0;
    state.workRam[off + OBJ_STRIDE + OBJ_FIELD_SKIP] = 0;

    rom.program[0x20B34] = 0xAA; rom.program[0x20B35] = 0x11; // palA value
    rom.program[0x20B54] = 0xBB; rom.program[0x20B55] = 0x22; // palB value

    paletteAnim1Tick(state, rom);

    expect(state.colorRam[0x06]).toBe(0xAA);
    expect(state.colorRam[0x07]).toBe(0x11);
    expect(state.colorRam[0x0E]).toBe(0xBB);
    expect(state.colorRam[0x0F]).toBe(0x22);
    // Both counters incremented
    expect(state.workRam[off + OBJ_FIELD_ANIM]).toBe(1);
    expect(state.workRam[off + OBJ_STRIDE + OBJ_FIELD_ANIM]).toBe(1);
  });
});
