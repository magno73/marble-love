/**
 * script-rect-dispatch-12dfa.test.ts — smoke test for `scriptRectDispatch12DFA`
 * (`FUN_00012DFA`).
 *
 * Bit-perfect parity validated against the binary in
 * `packages/cli/src/test-script-rect-dispatch-12dfa-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { scriptRectDispatch12DFA } from "../src/script-rect-dispatch-12dfa.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;

function writeU16Rom(rom: RomImage, off: number, v: number): void {
  rom.program[off] = (v >>> 8) & 0xff;
  rom.program[off + 1] = v & 0xff;
}

function writeU32Rom(rom: RomImage, off: number, v: number): void {
  rom.program[off] = (v >>> 24) & 0xff;
  rom.program[off + 1] = (v >>> 16) & 0xff;
  rom.program[off + 2] = (v >>> 8) & 0xff;
  rom.program[off + 3] = v & 0xff;
}

/** Populates ROM slot-ptr table @0x1F016 (25 entries -> @0x400A9C stride 0x56). */
function setupSlotPtrTable(rom: RomImage): void {
  for (let i = 0; i < 25; i++) {
    writeU32Rom(rom, 0x1f016 + i * 4, 0x400a9c + i * 0x56);
  }
}

/** Writes a rect record (2 bytes + 1 long) into ROM at the given offset. */
function writeRect(
  rom: RomImage,
  off: number,
  lo: number,
  hi: number,
  scriptPtr: number,
): void {
  rom.program[off] = lo & 0xff;
  rom.program[off + 1] = hi & 0xff;
  writeU32Rom(rom, off + 2, scriptPtr);
}

/** Writes the end-of-rect-list sentinel. */
function writeRectEnd(rom: RomImage, off: number): void {
  rom.program[off] = 0xff;
}

/** Selector @0x400394 (word). Points to rect-list ptr in 0x1DEC0+(sel*4). */
function setSelector(s: ReturnType<typeof emptyGameState>, selWord: number): void {
  s.workRam[0x394] = (selWord >>> 8) & 0xff;
  s.workRam[0x395] = selWord & 0xff;
}

/** Sets the rect-list pointer in ROM (entry @0x1DEC0+(sel*4)). */
function setRectListPtr(rom: RomImage, sel: number, ptr: number): void {
  writeU32Rom(rom, 0x1dec0 + (sel & 0xffff) * 4, ptr);
}

describe("scriptRectDispatch12DFA (FUN_00012DFA)", () => {
  it("empty rect-list (immediate 0xFF) → no slot touched, no despawn", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupSlotPtrTable(rom);

    // Selector = 0 → read long @ 0x1DEC0.
    setSelector(s, 0);
    setRectListPtr(rom, 0, 0x20000); // rect-list base in ROM (any value)
    writeRectEnd(rom, 0x20000); // 0xFF immediately

    const before = new Uint8Array(s.workRam);
    scriptRectDispatch12DFA(s, rom, 0x12, 0x34);
    expect(s.workRam).toEqual(before);
  });

  it("rect non-zero path: 1 rect → spawn 1 slot with scriptPtr and 0x52/0x54 sext", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupSlotPtrTable(rom);

    setSelector(s, 0);
    setRectListPtr(rom, 0, 0x20000);
    // Rect[0]=0x05 (signed 5), Rect[1]=0x14 (signed 20), scriptPtr=0xCAFEBABE.
    // D2=0x01 (=1, < 5 → spawn). D3=0x05 (= rect[0] → pass D3 check).
    writeRect(rom, 0x20000, 0x05, 0x14, 0xcafebabe);
    writeRectEnd(rom, 0x20006);

    scriptRectDispatch12DFA(s, rom, 0x01, 0x05);

    const slot0 = 0x400a9c - WORK_RAM_BASE;
    expect(s.workRam[slot0 + 0x18]).toBe(0x01);
    expect(s.workRam[slot0 + 0x1a]).toBe(0x03);
    // scriptPtr long BE @ +0x3A.
    expect(s.workRam[slot0 + 0x3a]).toBe(0xca);
    expect(s.workRam[slot0 + 0x3b]).toBe(0xfe);
    expect(s.workRam[slot0 + 0x3c]).toBe(0xba);
    expect(s.workRam[slot0 + 0x3d]).toBe(0xbe);
    // 0x52/0x54: word sext byte (5 → 0x0005, 0x14 → 0x0014).
    expect(s.workRam[slot0 + 0x52]).toBe(0x00);
    expect(s.workRam[slot0 + 0x53]).toBe(0x05);
    expect(s.workRam[slot0 + 0x54]).toBe(0x00);
    expect(s.workRam[slot0 + 0x55]).toBe(0x14);
  });

  it("D2 ∈ [rect[0], rect[1]] → SKIP (no spawn)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupSlotPtrTable(rom);

    setSelector(s, 0);
    setRectListPtr(rom, 0, 0x20000);
    writeRect(rom, 0x20000, 0x05, 0x14, 0xdeadbeef);
    writeRectEnd(rom, 0x20006);

    // D2=0x10 (=16, in [5,20]) -> skip. D3=0x05 passes the D3 check.
    const before = new Uint8Array(s.workRam);
    scriptRectDispatch12DFA(s, rom, 0x10, 0x05);
    expect(s.workRam).toEqual(before);
  });

  it("D3 != rect[0] AND D3 != rect[1] → SKIP", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupSlotPtrTable(rom);

    setSelector(s, 0);
    setRectListPtr(rom, 0, 0x20000);
    writeRect(rom, 0x20000, 0x05, 0x14, 0xdeadbeef);
    writeRectEnd(rom, 0x20006);

    // D3=0x99 → != 5 and != 20 → skip regardless of D2.
    const before = new Uint8Array(s.workRam);
    scriptRectDispatch12DFA(s, rom, 0x01, 0x99);
    expect(s.workRam).toEqual(before);
  });

  it("despawn post-loop: slot occupied with D2==slot[0x52] AND D3<slot[0x52] → free (slot+0x18=0)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupSlotPtrTable(rom);

    setSelector(s, 0);
    setRectListPtr(rom, 0, 0x20000);
    writeRectEnd(rom, 0x20000); // no spawn

    // Prepopulate slot 7 as occupied with 0x52=0x000A (=10), 0x54=0x0050 (=80).
    const slotIdx = 7;
    const slotOff = (0x400a9c + slotIdx * 0x56) - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 0x01;
    s.workRam[slotOff + 0x1a] = 0x03;
    s.workRam[slotOff + 0x52] = 0x00;
    s.workRam[slotOff + 0x53] = 0x0a; // word 0x000A = 10
    s.workRam[slotOff + 0x54] = 0x00;
    s.workRam[slotOff + 0x55] = 0x50; // word 0x0050 = 80
    s.workRam[slotOff + 0x1e] = 0x01; // gate FUN_18F46 → return early
    s.workRam[slotOff + 0x1f] = 0x00;

    // D2 = 10 (= slot[0x52]) AND D3 = 5 (< 10) → despawn.
    scriptRectDispatch12DFA(s, rom, 0x0a, 0x05);

    expect(s.workRam[slotOff + 0x18]).toBe(0); // freed
    expect(s.workRam[slotOff + 0x1a]).toBe(0);
  });

  it("despawn opposite condition: D2==slot[0x54] AND D3>slot[0x54] → free", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupSlotPtrTable(rom);

    setSelector(s, 0);
    setRectListPtr(rom, 0, 0x20000);
    writeRectEnd(rom, 0x20000);

    const slotIdx = 3;
    const slotOff = (0x400a9c + slotIdx * 0x56) - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 0x01;
    s.workRam[slotOff + 0x52] = 0x00;
    s.workRam[slotOff + 0x53] = 0x0a;
    s.workRam[slotOff + 0x54] = 0x00;
    s.workRam[slotOff + 0x55] = 0x50;
    s.workRam[slotOff + 0x1e] = 0x01;

    // D2 = 80 (= slot[0x54]) AND D3 = 100 (> 80) → despawn.
    scriptRectDispatch12DFA(s, rom, 0x50, 0x64);

    expect(s.workRam[slotOff + 0x18]).toBe(0);
    expect(s.workRam[slotOff + 0x1a]).toBe(0);
  });

  it("despawn skip: slot occupied but D2/D3 outside both conditions → no free", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupSlotPtrTable(rom);

    setSelector(s, 0);
    setRectListPtr(rom, 0, 0x20000);
    writeRectEnd(rom, 0x20000);

    const slotIdx = 0;
    const slotOff = 0x400a9c - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 0x01;
    s.workRam[slotOff + 0x1a] = 0x03;
    s.workRam[slotOff + 0x52] = 0x00;
    s.workRam[slotOff + 0x53] = 0x0a;
    s.workRam[slotOff + 0x54] = 0x00;
    s.workRam[slotOff + 0x55] = 0x50;
    s.workRam[slotOff + 0x1e] = 0x01;

    // D2 = 50 (∉ {10, 80}) → no despawn.
    scriptRectDispatch12DFA(s, rom, 0x32, 0x05);

    expect(s.workRam[slotOff + 0x18]).toBe(0x01); // still occupied
    expect(s.workRam[slotOff + 0x1a]).toBe(0x03);
  });

  it("FUN_12F44 mode-1 side effect: slot[0x1F]==6 decrements byte @0x40075C", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupSlotPtrTable(rom);

    setSelector(s, 0);
    setRectListPtr(rom, 0, 0x20000);
    writeRectEnd(rom, 0x20000);

    const slotIdx = 5;
    const slotOff = (0x400a9c + slotIdx * 0x56) - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 0x01;
    s.workRam[slotOff + 0x52] = 0x00;
    s.workRam[slotOff + 0x53] = 0x0a;
    s.workRam[slotOff + 0x54] = 0x00;
    s.workRam[slotOff + 0x55] = 0x50;
    s.workRam[slotOff + 0x1e] = 0x01; // gate FUN_18F46
    s.workRam[slotOff + 0x1f] = 0x06; // trigger decrement of 40075C

    s.workRam[0x75c] = 0x05; // initial counter

    // D2=10, D3=5 → despawn.
    scriptRectDispatch12DFA(s, rom, 0x0a, 0x05);

    expect(s.workRam[slotOff + 0x18]).toBe(0);
    expect(s.workRam[0x75c]).toBe(0x04); // decremented by 1
  });
});
