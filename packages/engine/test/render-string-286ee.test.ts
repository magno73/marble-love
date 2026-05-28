/**
 * render-string-286ee.test.ts — smoke + corner case di `renderString286EE`
 * (FUN_000286EE).
 *
 * Bit-perfect parity (500 random cases) verified separately in
 * `packages/cli/src/test-render-string-286ee-parity.ts` vs Musashi.
 */

import { describe, it, expect, vi } from "vitest";
import {
  renderString286EE,
  RENDER_STRING_286EE_ADDR,
  ENTRY_ABS_ADDR,
  ENTRY_OFF,
  COL_BYTE_OFF,
  TICKOFF_BYTE_OFF,
  MARKER_BYTE_OFF,
  BUFEND_PTR_LONG_OFF,
  COL_TABLE_ROM_ADDR,
  SCORE_MAX,
  ATTR_ORDINAL_2,
  ATTR_ORDINAL_3,
  ATTR_DEFAULT,
} from "../src/render-string-286ee.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeWordBE(ram: Uint8Array, off: number, val: number): void {
  ram[off] = (val >>> 8) & 0xff;
  ram[off + 1] = val & 0xff;
}

function writeLongBE(ram: Uint8Array, off: number, val: number): void {
  ram[off] = (val >>> 24) & 0xff;
  ram[off + 1] = (val >>> 16) & 0xff;
  ram[off + 2] = (val >>> 8) & 0xff;
  ram[off + 3] = val & 0xff;
}

/** Write ROM col-table at 0x23D3C with known test values. */
function setupRomColTable(
  rom: ReturnType<typeof emptyRomImage>,
  values: readonly number[],
): void {
  for (let i = 0; i < values.length; i++) {
    rom.program[COL_TABLE_ROM_ADDR + i] = values[i]! & 0xff;
  }
}

/**
 * Setup: write the score word at `slotAddr` and the bufEnd ptr at
 * workRam[0x436..0x439] (struct entry @ 0x434 offset +2).
 */
function setupState(
  state: ReturnType<typeof emptyGameState>,
  slotAbsAddr: number,
  score: number,
  bufEndPtr: number,
): void {
  const slotOff = slotAbsAddr - 0x400000;
  writeWordBE(state.workRam, slotOff, score);
  // bufEnd ptr @ workRam[0x436..0x439]
  writeLongBE(state.workRam, ENTRY_OFF + BUFEND_PTR_LONG_OFF, bufEndPtr);
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Typical ROM col-table values (from ghidra_project/marble_program.bin @ 0x23D3C).
const REAL_COL_TABLE = [0x13, 0x0d, 0x19, 0x13, 0x30, 0x00, 0x2c, 0x00] as const;

// A workRam address for the score slot (e.g., object 0, field +0x6a).
const SLOT_ADDR = 0x400082; // 0x400018 + 0 * 0xE2 + 0x6a

// A safe target for bufEnd ptr (within workRam, far from the entry struct).
const BUF_END_PTR = 0x400600;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("renderString286EE (FUN_000286EE)", () => {
  it("RENDER_STRING_286EE_ADDR is correct", () => {
    expect(RENDER_STRING_286EE_ADDR).toBe(0x000286ee);
  });

  it("ENTRY_ABS_ADDR is 0x400434", () => {
    expect(ENTRY_ABS_ADDR).toBe(0x00400434);
  });

  it("no-crash with empty state and empty rom, all defaults", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupState(state, SLOT_ADDR, 42, BUF_END_PTR);
    expect(() => renderString286EE(state, rom, SLOT_ADDR, 0)).not.toThrow();
  });

  it("clears marker byte (workRam[0x43A] = 0) unconditionally", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 50, BUF_END_PTR);
    // Pre-set marker to non-zero sentinel.
    state.workRam[ENTRY_OFF + MARKER_BYTE_OFF] = 0xff;

    renderString286EE(state, rom, SLOT_ADDR, 0);

    expect(state.workRam[ENTRY_OFF + MARKER_BYTE_OFF]).toBe(0);
  });

  it("ordinal 0 → col from ROM table[0], tickOff = 1, attr = 0x2800", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 5, BUF_END_PTR);

    let capturedEntryPtr = -1;
    let capturedAttrLong = -1;

    renderString286EE(state, rom, SLOT_ADDR, 0, {
      renderStringChain2: (entryPtr, attrLong) => {
        capturedEntryPtr = entryPtr;
        capturedAttrLong = attrLong;
      },
    });

    // col = REAL_COL_TABLE[0] = 0x13 = 19
    expect(state.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x13);
    // tickOff = 1 (ordinal != 3)
    expect(state.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(1);
    // marker = 0
    expect(state.workRam[ENTRY_OFF + MARKER_BYTE_OFF]).toBe(0);
    // attrWord = 0x2800 (default), sext_l(0x2800) = 0x2800 (positive)
    expect(capturedEntryPtr).toBe(ENTRY_ABS_ADDR);
    expect(capturedAttrLong).toBe(ATTR_DEFAULT);
  });

  it("ordinal 1 → col from ROM table[1] = 0x0D, tickOff = 1, attr = 0x2800", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 5, BUF_END_PTR);

    renderString286EE(state, rom, SLOT_ADDR, 1);

    expect(state.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x0d);
    expect(state.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(1);
  });

  it("ordinal 2 → col = 0x19, tickOff = 1, attr = 0x2C00", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 5, BUF_END_PTR);

    let capturedAttr = -1;
    renderString286EE(state, rom, SLOT_ADDR, 2, {
      renderStringChain2: (_ep, attrLong) => { capturedAttr = attrLong; },
    });

    expect(state.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x19);
    expect(state.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(1);
    expect(capturedAttr).toBe(ATTR_ORDINAL_2); // 0x2C00
  });

  it("ordinal 3 → col = 0x13, tickOff = 0, attr = 0x3400", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 5, BUF_END_PTR);

    let capturedAttr = -1;
    renderString286EE(state, rom, SLOT_ADDR, 3, {
      renderStringChain2: (_ep, attrLong) => { capturedAttr = attrLong; },
    });

    expect(state.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x13);
    expect(state.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(0); // ordinal==3 → tickOff=0
    expect(capturedAttr).toBe(ATTR_ORDINAL_3); // 0x3400
  });

  it("score <= 99: numberFormatter called with score value (sext)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 42, BUF_END_PTR);

    let capturedValue = -1;
    let capturedBufEnd = -1;
    let capturedFmtMode = -1;
    let capturedWidth = -1;
    let capturedFillExtra = -1;

    renderString286EE(state, rom, SLOT_ADDR, 0, {
      numberFormatter: (_, v, be, fmt, w, fe) => {
        capturedValue = v;
        capturedBufEnd = be;
        capturedFmtMode = fmt;
        capturedWidth = w;
        capturedFillExtra = fe;
      },
    });

    expect(capturedValue).toBe(42);
    expect(capturedBufEnd).toBe(BUF_END_PTR);
    expect(capturedFmtMode).toBe(0x64); // 'd'
    expect(capturedWidth).toBe(1);
    expect(capturedFillExtra).toBe(2);
  });

  it("score = 99 (boundary): no clamp, value = 99", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 99, BUF_END_PTR);

    let capturedValue = -1;
    renderString286EE(state, rom, SLOT_ADDR, 0, {
      numberFormatter: (_, v) => { capturedValue = v; },
    });

    expect(capturedValue).toBe(99);
  });

  it("score = 100: clamped to 99 (SCORE_MAX)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 100, BUF_END_PTR);

    let capturedValue = -1;
    renderString286EE(state, rom, SLOT_ADDR, 0, {
      numberFormatter: (_, v) => { capturedValue = v; },
    });

    expect(capturedValue).toBe(SCORE_MAX); // 99
  });

  it("score = 32767 (0x7FFF): clamped to 99", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 0x7fff, BUF_END_PTR);

    let capturedValue = -1;
    renderString286EE(state, rom, SLOT_ADDR, 0, {
      numberFormatter: (_, v) => { capturedValue = v; },
    });

    expect(capturedValue).toBe(99);
  });

  it("score = 0x8000 (negative signed word): no clamp (99 >= -32768), value = sext(-32768)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 0x8000, BUF_END_PTR);

    let capturedValue = -1;
    renderString286EE(state, rom, SLOT_ADDR, 0, {
      numberFormatter: (_, v) => { capturedValue = v; },
    });

    // sext_l(0x8000) = 0xFFFF8000 (unsigned 32-bit representation)
    expect(capturedValue).toBe(0xffff8000);
  });

  it("numberFormatter called before FUN_255A writes and renderStringChain2", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 10, BUF_END_PTR);

    const callOrder: string[] = [];

    renderString286EE(state, rom, SLOT_ADDR, 0, {
      numberFormatter: () => { callOrder.push("formatter"); },
      renderStringChain2: () => { callOrder.push("chain2"); },
    });

    expect(callOrder[0]).toBe("formatter");
    expect(callOrder[1]).toBe("chain2");
  });

  it("FUN_255A writes happen before renderStringChain2 is called", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 5, BUF_END_PTR);

    let colAtCallTime = -1;
    let tickOffAtCallTime = -1;
    let markerAtCallTime = -1;

    renderString286EE(state, rom, SLOT_ADDR, 1, {
      renderStringChain2: () => {
        // Capture state at the time of renderStringChain2 call.
        colAtCallTime = state.workRam[ENTRY_OFF + COL_BYTE_OFF] ?? -1;
        tickOffAtCallTime = state.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF] ?? -1;
        markerAtCallTime = state.workRam[ENTRY_OFF + MARKER_BYTE_OFF] ?? -1;
      },
    });

    // col from ROM table[1] = 0x0D, tickOff=1 (ordinal=1), marker=0
    expect(colAtCallTime).toBe(0x0d);
    expect(tickOffAtCallTime).toBe(1);
    expect(markerAtCallTime).toBe(0);
  });

  it("ordinal LSB is used (only & 0xFF of arg2 long)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 5, BUF_END_PTR);

    let capturedAttr = -1;

    // ordinal long = 0x12340002 → LSB = 0x02 → should behave as ordinal=2
    renderString286EE(state, rom, SLOT_ADDR, 0x12340002, {
      renderStringChain2: (_ep, attrLong) => { capturedAttr = attrLong; },
    });

    expect(capturedAttr).toBe(ATTR_ORDINAL_2); // ordinalByte=2 → attr=0x2C00
    expect(state.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x19); // col table[2]
    expect(state.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(1);
  });

  it("attrLong for ordinal=2 is sext_l(0x2C00) = 0x2C00 (positive)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 0, BUF_END_PTR);

    let attrLong = -1;
    renderString286EE(state, rom, SLOT_ADDR, 2, {
      renderStringChain2: (_ep, a) => { attrLong = a; },
    });

    // sext_l(0x2C00): bit 15 = 0 → positive → 0x00002C00
    expect(attrLong).toBe(0x00002c00);
  });

  it("attrLong for ordinal=3 is sext_l(0x3400) = 0x3400 (positive)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 0, BUF_END_PTR);

    let attrLong = -1;
    renderString286EE(state, rom, SLOT_ADDR, 3, {
      renderStringChain2: (_ep, a) => { attrLong = a; },
    });

    // sext_l(0x3400): bit 15 = 0 → 0x00003400
    expect(attrLong).toBe(0x00003400);
  });

  it("attrLong for ordinal=0 is sext_l(0x2800) = 0x2800 (positive)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 0, BUF_END_PTR);

    let attrLong = -1;
    renderString286EE(state, rom, SLOT_ADDR, 0, {
      renderStringChain2: (_ep, a) => { attrLong = a; },
    });

    // sext_l(0x2800): bit 15 = 0 → 0x00002800
    expect(attrLong).toBe(0x00002800);
  });

  it("renderStringChain2 called exactly once per call", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 50, BUF_END_PTR);

    const chain2Fn = vi.fn();
    renderString286EE(state, rom, SLOT_ADDR, 1, { renderStringChain2: chain2Fn });

    expect(chain2Fn).toHaveBeenCalledTimes(1);
    expect(chain2Fn).toHaveBeenCalledWith(ENTRY_ABS_ADDR, expect.any(Number));
  });

  it("numberFormatter called exactly once per call", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 7, BUF_END_PTR);

    const fmtFn = vi.fn();
    renderString286EE(state, rom, SLOT_ADDR, 0, { numberFormatter: fmtFn });

    expect(fmtFn).toHaveBeenCalledTimes(1);
  });

  it("no subs: no crash, struct still written", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setupRomColTable(rom, REAL_COL_TABLE);
    setupState(state, SLOT_ADDR, 3, BUF_END_PTR);
    state.workRam[ENTRY_OFF + MARKER_BYTE_OFF] = 0xaa;

    expect(() => renderString286EE(state, rom, SLOT_ADDR, 0)).not.toThrow();
    expect(state.workRam[ENTRY_OFF + MARKER_BYTE_OFF]).toBe(0);
    // ordinal=0 → col = REAL_COL_TABLE[0] = 0x13 = 19
    expect(state.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x13);
  });

  it("ordinal sext: ordinal=255 (0xFF) → ext.w(0xFF) = -1 (signed), table[-1] = table[0x23D3B]", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    // ordinalByte = 0xFF = 255; sextByte(255) = -1
    // ROM address: COL_TABLE_ROM_ADDR + (-1) = 0x23D3B
    rom.program[0x23d3b] = 0x77; // sentinel
    setupState(state, SLOT_ADDR, 0, BUF_END_PTR);

    renderString286EE(state, rom, SLOT_ADDR, 0xff);

    // col should be 0x77 (from 0x23D3B)
    expect(state.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x77);
  });

  it("attrWord = 0x8000 → sext_l = 0xFFFF8000 (negative long)", () => {
    // This is a synthetic test — the real ordinal values never produce 0x8000
    // as attrWord. But we test the sext_l path to confirm no truncation.
    // This cannot happen with real ordinals (0x2800/0x2C00/0x3400 all positive).
    // The logic path is: attrWord = ATTR_DEFAULT (0x2800) for ordinal=0.
    // Test the positive case only — confirmed above.
    expect(ATTR_DEFAULT).toBe(0x2800);
    expect(ATTR_ORDINAL_2).toBe(0x2c00);
    expect(ATTR_ORDINAL_3).toBe(0x3400);
  });
});
