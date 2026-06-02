/**
 * entity-waypoint-step-1d1ec.test.ts — smoke + corner case of FUN_1D1EC.
 *
 * Test in-WORK_RAM: alloca struct entity in 0x401E00 (offset 0x1E00 in
 * workRam) and cursor array in 0x401E80 (offset 0x1E80). Verifica:
 *   1. Match X+Y -> cursor advances by step*4
 *   2. Mismatch X -> cursor unchanged (early-exit)
 *   3. Mismatch Y (but X matches) -> cursor unchanged
 *   4. Step negativo (signed byte) → cursor decrementa
 *   5. Coordinate negative → asr.l 19 mantiene segno
 *   6. fun_1d242 always called, even on skip
 */

import { describe, it, expect, vi } from "vitest";
import { entityWaypointStep1D1EC } from "../src/entity-waypoint-step-1d1ec.js";
import { emptyGameState } from "../src/state.js";
import type { GameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";

const ENTITY_BASE_ABS = 0x401e00;
const ENTITY_OFF = 0x1e00; // offset in workRam
const CURSOR_BASE_ABS = 0x401e80;
const CURSOR_OFF = 0x1e80;
const ARRAY_BASE_ABS = 0x401e90; // base per offset relativo
const ARRAY_BASE = 0x401e90;

function writeLong(s: GameState, off: number, v: number): void {
  const u = v >>> 0;
  s.workRam[off] = (u >>> 24) & 0xff;
  s.workRam[off + 1] = (u >>> 16) & 0xff;
  s.workRam[off + 2] = (u >>> 8) & 0xff;
  s.workRam[off + 3] = u & 0xff;
}

function writeRomByte(rom: RomImage, addr: number, v: number): void {
  rom.program[addr >>> 0] = v & 0xff;
}

function readLong(s: GameState, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

/**
 * Setup: place entity in workRam with pos.X/pos.Y (long) and
 * cursor/base pointer; populates cursor[0..2] (X, Y, step signed byte).
 */
function setup(opts: {
  posX: number;
  posY: number;
  cursorAbs?: number;
  baseAbs?: number;
  cursor: [number, number, number];
}): GameState {
  const s = emptyGameState();
  // pos.X (off+0x0c), pos.Y (off+0x10)
  writeLong(s, ENTITY_OFF + 0x0c, opts.posX);
  writeLong(s, ENTITY_OFF + 0x10, opts.posY);
  // cursor (0x2c), base (0x30)
  writeLong(s, ENTITY_OFF + 0x2c, opts.cursorAbs ?? CURSOR_BASE_ABS);
  writeLong(s, ENTITY_OFF + 0x30, opts.baseAbs ?? ARRAY_BASE_ABS);
  // cursor bytes
  const cOff = (opts.cursorAbs ?? CURSOR_BASE_ABS) - 0x400000;
  s.workRam[cOff] = opts.cursor[0] & 0xff;
  s.workRam[cOff + 1] = opts.cursor[1] & 0xff;
  s.workRam[cOff + 2] = opts.cursor[2] & 0xff;
  return s;
}

describe("entityWaypointStep1D1EC (FUN_1D1EC)", () => {
  it("match X+Y → cursor diventa base + step*4 (step positivo)", () => {
    // cellX = (0x00280000 >> 19) & 0xffff = 5
    // cellY = (0x00100000 >> 19) & 0xffff = 2
    const s = setup({
      posX: 0x00280000,
      posY: 0x00100000,
      cursor: [5, 2, 7],
    });
    entityWaypointStep1D1EC(s, ENTITY_BASE_ABS);
    expect(readLong(s, ENTITY_OFF + 0x2c)).toBe((ARRAY_BASE + 7 * 4) >>> 0);
  });

  it("mismatch X → cursor invariato", () => {
    const s = setup({
      posX: 0x00280000, // cellX=5
      posY: 0x00100000, // cellY=2
      cursor: [9, 2, 7], // cursor[0] != cellX
    });
    entityWaypointStep1D1EC(s, ENTITY_BASE_ABS);
    expect(readLong(s, ENTITY_OFF + 0x2c)).toBe(CURSOR_BASE_ABS);
  });

  it("X match but mismatch Y → cursor invariato", () => {
    const s = setup({
      posX: 0x00280000, // cellX=5
      posY: 0x00100000, // cellY=2
      cursor: [5, 9, 7], // cursor[1] != cellY
    });
    entityWaypointStep1D1EC(s, ENTITY_BASE_ABS);
    expect(readLong(s, ENTITY_OFF + 0x2c)).toBe(CURSOR_BASE_ABS);
  });

  it("step negativo (signed byte) → cursor decrementa relative a base", () => {
    // cellX=5, cellY=2 (match), step = -3 (0xFD signed)
    const s = setup({
      posX: 0x00280000,
      posY: 0x00100000,
      cursor: [5, 2, -3 & 0xff],
    });
    entityWaypointStep1D1EC(s, ENTITY_BASE_ABS);
    // base + (-3)*4 = base - 12 (with wrap >>>0).
    expect(readLong(s, ENTITY_OFF + 0x2c)).toBe((ARRAY_BASE - 12) >>> 0);
  });

  it("coordinate negative (asr.l 19 signed)", () => {
    // posX = -0x00280000 → asr.l 19 = -5; low word = 0xFFFB
    // cursor[0] = -5 (0xFB) sign-ext = 0xFFFB → match
    const posX = (-0x00280000) >>> 0;
    const posY = (-0x00100000) >>> 0;
    const s = setup({
      posX,
      posY,
      cursor: [-5 & 0xff, -2 & 0xff, 1],
    });
    entityWaypointStep1D1EC(s, ENTITY_BASE_ABS);
    expect(readLong(s, ENTITY_OFF + 0x2c)).toBe((ARRAY_BASE + 4) >>> 0);
  });

  it("subs.fun_1d242 chiamato always (also when skip per mismatch)", () => {
    const cb = vi.fn();
    const s = setup({
      posX: 0,
      posY: 0,
      cursor: [99, 0, 0], // mismatch X
    });
    entityWaypointStep1D1EC(s, ENTITY_BASE_ABS, { fun_1d242: cb });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(ENTITY_BASE_ABS);
  });

  it("subs.fun_1d242 chiamato also when match avviene", () => {
    const cb = vi.fn();
    const s = setup({
      posX: 0,
      posY: 0,
      cursor: [0, 0, 1],
    });
    entityWaypointStep1D1EC(s, ENTITY_BASE_ABS, { fun_1d242: cb });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("reads waypoint ROM and passa la ROM al follow-up FUN_1D242", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const cursor = 0x23000;

    writeLong(s, ENTITY_OFF + 0x0c, 5 << 19);
    writeLong(s, ENTITY_OFF + 0x10, 2 << 19);
    writeLong(s, ENTITY_OFF + 0x2c, cursor);
    writeLong(s, ENTITY_OFF + 0x30, cursor);
    writeRomByte(rom, cursor + 0, 5);
    writeRomByte(rom, cursor + 1, 2);
    writeRomByte(rom, cursor + 2, 2);
    writeRomByte(rom, cursor + 8, 7);
    writeRomByte(rom, cursor + 9, 2);

    entityWaypointStep1D1EC(s, ENTITY_BASE_ABS, undefined, rom);

    expect(readLong(s, ENTITY_OFF + 0x2c)).toBe(cursor + 8);
    expect(readLong(s, ENTITY_OFF + 0x00)).toBe(0x00080000);
    expect(readLong(s, ENTITY_OFF + 0x04)).toBe(0x00000000);
    expect(readLong(s, ENTITY_OFF + 0x3a)).toBe(0x00020ea4);
    expect(readLong(s, ENTITY_OFF + 0x3e)).toBe(0x00020ea4);
    expect(s.workRam[ENTITY_OFF + 0x25]).toBe(2);
  });
});
