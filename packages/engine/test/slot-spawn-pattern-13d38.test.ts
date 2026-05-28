/**
 * slot-spawn-pattern-13d38.test.ts — corner cases di `slotSpawnPattern13D38`
 * (FUN_00013D38).
 *
 * `packages/cli/src/test-slot-spawn-pattern-13d38-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { slotSpawnPattern13D38 } from "../src/slot-spawn-pattern-13d38.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;
const SLOT_PTR_TABLE = 0x1f016;
const DELTA_STREAM = 0x1ef32;

/** Set up ROM table @ 0x1F016 with 25 canonical ptrs (slot @0x400A9C stride 0x56). */
function setupCanonicalRomTable(rom: RomImage): void {
  for (let i = 0; i < 25; i++) {
    const slotAddr = 0x400a9c + i * 0x56;
    const off = SLOT_PTR_TABLE + i * 4;
    rom.program[off] = (slotAddr >>> 24) & 0xff;
    rom.program[off + 1] = (slotAddr >>> 16) & 0xff;
    rom.program[off + 2] = (slotAddr >>> 8) & 0xff;
    rom.program[off + 3] = slotAddr & 0xff;
  }
}

/** Setup delta-stream @ 0x1EF32 (16 byte: 8 coppie di delta x/y). */
function setupDeltaStream(rom: RomImage, bytes: readonly number[]): void {
  for (let i = 0; i < bytes.length; i++) {
    rom.program[DELTA_STREAM + i] = bytes[i]! & 0xff;
  }
}

describe("slotSpawnPattern13D38 (FUN_00013D38)", () => {
  it("counter pre=1 → decrementa a 0 → ritorna 0x01; mark byte +0x1C = 1", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);
    setupDeltaStream(rom, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const argPtr = 0x400a9c; // slot[0]
    const argOff = argPtr - WORK_RAM_BASE;

    s.workRam[argOff + 0x57] = 1; // counter = 1 → post-decrement = 0
    s.workRam[argOff + 0x58] = 0; // selector = 0 → A1 = slot[0] (self)

    const r = slotSpawnPattern13D38(s, rom, argPtr);
    expect(r >>> 0).toBe(0x01);
    expect(s.workRam[argOff + 0x57]).toBe(0);
    expect(s.workRam[argOff + 0x1c]).toBe(0x01);
  });

  it("counter pre=2 → decrementa a 1 → ritorna 0; mark byte +0x1C = 1", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);
    setupDeltaStream(rom, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const argPtr = 0x400a9c;
    const argOff = argPtr - WORK_RAM_BASE;

    s.workRam[argOff + 0x57] = 2;
    s.workRam[argOff + 0x58] = 0;

    const r = slotSpawnPattern13D38(s, rom, argPtr);
    expect(r >>> 0).toBe(0);
    expect(s.workRam[argOff + 0x57]).toBe(1);
    expect(s.workRam[argOff + 0x1c]).toBe(0x01);
  });

  it("counter pre=0 → decrementa a 0xFF → ritorna 0 (counter post != 0)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);
    setupDeltaStream(rom, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const argPtr = 0x400a9c;
    const argOff = argPtr - WORK_RAM_BASE;

    s.workRam[argOff + 0x57] = 0;
    s.workRam[argOff + 0x58] = 0;

    const r = slotSpawnPattern13D38(s, rom, argPtr);
    expect(r >>> 0).toBe(0);
    expect(s.workRam[argOff + 0x57]).toBe(0xff);
  });

  it("counter pre=0x21 (D2=0x20-0x21=-1) → tutti i record skip (D1<0 base ma D2<0 → primo iter D1=-1<0 OK; ma per D1>=8 deve essere D2>=8+iter*2). Verifica path emit con tutti delta=0 e selettore canonico", () => {
    // Iter 0: D1 = 0 → range [0..3] → emit @ 0xA4. Iter 1: D1 = -2 → use orig.
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);
    setupDeltaStream(rom, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const argPtr = 0x400a9c;
    const argOff = argPtr - WORK_RAM_BASE;

    s.workRam[argOff + 0x57] = 0x20;
    s.workRam[argOff + 0x58] = 0; // selector 0 → A1 = slot[0] = self

    // Imposta (A0+0x1E) come long: high=0x0010, low=0x0020 (Y_orig=0x10, X_orig=0x20).
    s.workRam[argOff + 0x1e] = 0x00;
    s.workRam[argOff + 0x1f] = 0x10;
    s.workRam[argOff + 0x20] = 0x00;
    s.workRam[argOff + 0x21] = 0x20;

    // Imposta A1+0x4E (= self+0x4E) come long: high=0x0030, low=0x0040.
    s.workRam[argOff + 0x4e] = 0x00;
    s.workRam[argOff + 0x4f] = 0x30;
    s.workRam[argOff + 0x50] = 0x00;
    s.workRam[argOff + 0x51] = 0x40;


    slotSpawnPattern13D38(s, rom, argPtr);

    // Iter 0: D1=0 → range [0..3]; charcode = 0x10B; x = sextByte(0)+frame[-A]/0...
    // Verify only deterministic charcodes: record 0..7 -> 0x10B..0x112.
    const r0 = argOff + 0xa4;
    expect((s.workRam[r0]! << 8) | s.workRam[r0 + 1]!).toBe(0x010b);
    const r1 = argOff + 0xa4 + 6;
    expect((s.workRam[r1]! << 8) | s.workRam[r1 + 1]!).toBe(0x010c);
    const r2 = argOff + 0xa4 + 12;
    expect((s.workRam[r2]! << 8) | s.workRam[r2 + 1]!).toBe(0x010d);
    const r3 = argOff + 0xa4 + 18;
    expect((s.workRam[r3]! << 8) | s.workRam[r3 + 1]!).toBe(0x010e);
    const r4 = argOff + 0x38;
    expect((s.workRam[r4]! << 8) | s.workRam[r4 + 1]!).toBe(0x010f);
    const r5 = argOff + 0x38 + 6;
    expect((s.workRam[r5]! << 8) | s.workRam[r5 + 1]!).toBe(0x0110);
    const r6 = argOff + 0x38 + 12;
    expect((s.workRam[r6]! << 8) | s.workRam[r6 + 1]!).toBe(0x0111);
    const r7 = argOff + 0x38 + 18;
    expect((s.workRam[r7]! << 8) | s.workRam[r7 + 1]!).toBe(0x0112);
  });

  it("counter pre=0xE0 (D2=0x20-(-0x20)=0x40) → tutti gli iter hanno D1>=8 (skip): nessun emit, charcode tutti 0", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);
    setupDeltaStream(rom, [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);

    const argPtr = 0x400a9c;
    const argOff = argPtr - WORK_RAM_BASE;

    s.workRam[argOff + 0x57] = 0xe0; // sext = -0x20 → D2 = 0x20 - (-0x20) = 0x40
    s.workRam[argOff + 0x58] = 0;

    // D1 sequence: iter=0: 0x40-0=0x40 (>>8 → skip).

    slotSpawnPattern13D38(s, rom, argPtr);

    for (let k = 0; k < 4; k++) {
      const off2nd = argOff + 0x38 + k * 6;
      expect((s.workRam[off2nd]! << 8) | s.workRam[off2nd + 1]!).toBe(0);
      const off1st = argOff + 0xa4 + k * 6;
      expect((s.workRam[off1st]! << 8) | s.workRam[off1st + 1]!).toBe(0);
    }
    // mark byte is still 1.
    expect(s.workRam[argOff + 0x1c]).toBe(0x01);
  });

  it("branch su (A1+0x1F)==0xD: counter pre=0x20, A1 in slot self, scrivi 0x0D in self+0x1F → branch 'subtract' attivo, charcode iter 0..7 ancora deterministici", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);
    setupDeltaStream(rom, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const argPtr = 0x400a9c;
    const argOff = argPtr - WORK_RAM_BASE;

    s.workRam[argOff + 0x57] = 0x20;
    s.workRam[argOff + 0x58] = 0;

    // (A1+0x1F) = self+0x1F = 0x0D → branch "subtract".
    s.workRam[argOff + 0x1f] = 0x0d;

    s.workRam[argOff + 0x1e] = 0x00;
    s.workRam[argOff + 0x20] = 0x00;
    s.workRam[argOff + 0x21] = 0x00;

    s.workRam[argOff + 0x4e] = 0x00;
    s.workRam[argOff + 0x4f] = 0x10;
    s.workRam[argOff + 0x50] = 0x00;
    s.workRam[argOff + 0x51] = 0x20;

    slotSpawnPattern13D38(s, rom, argPtr);

    // Charcodes still determined by the iteration count, which produces emit
    // 0x10B (iter 0, D1=0 → emit nel range [0..3]).
    const r0 = argOff + 0xa4;
    expect((s.workRam[r0]! << 8) | s.workRam[r0 + 1]!).toBe(0x010b);
    expect(s.workRam[argOff + 0x1c]).toBe(0x01);
    // counter post = 0x1F (decrement)
    expect(s.workRam[argOff + 0x57]).toBe(0x1f);
  });
});
