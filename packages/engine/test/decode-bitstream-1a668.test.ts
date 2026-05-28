/**
 * decode-bitstream-1a668.test.ts — smoke test di FUN_0001A668.
 *
 * Bit-perfect parity vs binary in
 * `packages/cli/src/test-decode-bitstream-1a668-parity.ts`. Qui copriamo i 5
 * path principali (A, B, C, D, E) e gli edge case (cache reload, A3 advance,
 * output overshoot) without Musashi.
 */

import { describe, it, expect } from "vitest";
import {
  decodeBitstream1A668,
  OUTPUT_LEN_BYTES,
  OUTPUT_LEN_WORDS,
  ROM_TABLE1_OFF,
  ROM_TABLE2_OFF,
} from "../src/decode-bitstream-1a668.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { GameState } from "../src/state.js";
import type { RomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;

/** Setup byte stream in workRam @ off, big-endian. */
function setBytes(s: GameState, off: number, bytes: number[]): void {
  for (let i = 0; i < bytes.length; i++) {
    s.workRam[off + i] = bytes[i]! & 0xff;
  }
}

/** Setup ctrl stream long-aligned ad un offset, scrivendo `longs` come 32-bit BE. */
function setLongs(s: GameState, off: number, longs: number[]): void {
  for (let i = 0; i < longs.length; i++) {
    const v = longs[i]! >>> 0;
    s.workRam[off + i * 4] = (v >>> 24) & 0xff;
    s.workRam[off + i * 4 + 1] = (v >>> 16) & 0xff;
    s.workRam[off + i * 4 + 2] = (v >>> 8) & 0xff;
    s.workRam[off + i * 4 + 3] = v & 0xff;
  }
}

/** Read word BE from output buffer at word index i. */
function readOutWord(s: GameState, outOff: number, wordIdx: number): number {
  const o = outOff + wordIdx * 2;
  return ((s.workRam[o]! << 8) | s.workRam[o + 1]!) & 0xffff;
}

/** Set up ROM lookup tables 1 and 2 with predictable values. */
function setupRomTables(rom: RomImage, t1: number[], t2: number[]): void {
  for (let i = 0; i < t1.length; i++) {
    const v = t1[i]! & 0xffff;
    rom.program[ROM_TABLE1_OFF + i * 2] = (v >>> 8) & 0xff;
    rom.program[ROM_TABLE1_OFF + i * 2 + 1] = v & 0xff;
  }
  for (let i = 0; i < t2.length; i++) {
    const v = t2[i]! & 0xffff;
    rom.program[ROM_TABLE2_OFF + i * 2] = (v >>> 8) & 0xff;
    rom.program[ROM_TABLE2_OFF + i * 2 + 1] = v & 0xff;
  }
}

describe("decodeBitstream1A668 (FUN_0001A668)", () => {
  it("Path B (token=0): produce 36 word con D6 incrementale + offset costante", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Output @ workRam off 0x100, ctrl @ off 0x200 (all zero), ext @ off 0x300.
    const outAbs = WORK_RAM_BASE + 0x100;
    const ctrlAbs = WORK_RAM_BASE + 0x200;
    const extAbs = WORK_RAM_BASE + 0x300;
    // Zero ctrl region -> every token = 0 -> path B with cnt=0 (1 word per token).
    // Extra stream: count=0xFF, value=0x10 -> D2 reloads only at the start,
    // then counts down to -1 (but 0xFF iters are more than the expected 36).
    setBytes(s, 0x300, [0xff, 0x10]);

    decodeBitstream1A668(s, rom, outAbs, ctrlAbs, extAbs);

    // Output: 36 word = 0x1001, 0x1002, ..., 0x1024.
    // D6 starts at 0; every iter D6++, then out = D6 + 0x1000.
    for (let i = 0; i < OUTPUT_LEN_WORDS; i++) {
      expect(readOutWord(s, 0x100, i)).toBe((0x1001 + i) & 0xffff);
    }
  });

  it("Path A (bit 13 set, token = 0x2010): 1 word con D5_shifted + D3", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const outAbs = WORK_RAM_BASE + 0x100;
    const ctrlAbs = WORK_RAM_BASE + 0x200;
    const extAbs = WORK_RAM_BASE + 0x300;
    // Token1: bit 13 set + low bits 0x010.
    //   14-bit token = 0x2010. After bclr #13 -> 0x10. asr.w #1 -> 0x8.
    //   bit 0 era 0 → carry CLEAR → D6 NON aggiornato.
    //   add D3 = 0x1500 (da extra stream 0x15) → out = 0x1508.
    // Token2..onwards: zero -> path B (consecutive). D6 starts from 0 (never
    //   updated in path A because token bit 0 was 0).
    // Long ctrl @ +0: bit 31..18 = 10 0000 0001 0000 → 0x80400000.
    //   bit 17..0 = zero. Quindi long = 0x80400000.
    setLongs(s, 0x200, [0x80400000, 0x00000000, 0x00000000]);
    setBytes(s, 0x300, [0xff, 0x15]);

    decodeBitstream1A668(s, rom, outAbs, ctrlAbs, extAbs);

    // Out[0] = 0x8 + 0x1500 = 0x1508 (path A, single literal).
    expect(readOutWord(s, 0x100, 0)).toBe(0x1508);
    // Out[1..35] from path B: D6 was 0, not updated after path A (bit 0 = 0).
    //   Ogni path B iter D6++ → 1, 2, 3, ... 35. Output = D6 + 0x1500.
    for (let i = 1; i < OUTPUT_LEN_WORDS; i++) {
      expect(readOutWord(s, 0x100, i)).toBe((i + 0x1500) & 0xffff);
    }
  });

  it("Path C (token = 0x1C00 + idx<<4): single ROM table-1 lookup", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const outAbs = WORK_RAM_BASE + 0x100;
    const ctrlAbs = WORK_RAM_BASE + 0x200;
    const extAbs = WORK_RAM_BASE + 0x300;
    // Setup ROM table 1: 32 word identity (table[i] = 0xA000 + i).
    const t1: number[] = [];
    for (let i = 0; i < 32; i++) t1.push(0xa000 + i);
    const t2: number[] = [];
    for (let i = 0; i < 8; i++) t2.push(0xb000 + i);
    setupRomTables(rom, t1, t2);
    // Token1: 0x1C00 + (3 << 4) = 0x1C30.
    //   Path C: D5 = (0x1C30 >> 4) & 0x3E = 0x1C3 & 0x3E = 0x02 (cleared bit 13
    //   no — bit 13 = 0 in 0x1C30 ✓). Then idx_byte = D5 = 0x02 (already cleared
    //   via mask 0x3E). idx_word = 0x02/2 = 1.
    //   → ROM table1[1] = 0xA001. + D3 = 0xA001 + 0x2000 = 0xC001.
    //
    // Verifica: 0x1C30 binary = 1110 0011 0000. After bclr #13 → 0011 0000.
    //   Wait. 0x1C30 = 0001 1100 0011 0000. Bit 13 = 0 (since 0x2000 = bit 13).
    //   Path: D1 = D5 & 0x1C00 = 0x1C00 → path C.
    //   D5 = 0x1C30 (or after bclr stays 0x1C30 since bit 13 was 0).
    //   asr.w #4 → 0x01C3. & 0x3E = 0x01C3 & 0x003E = 0x0002 (binary
    //   0000 0011 1110 → 0011 1110 = 0x3E; 0x01C3 & 0x3E: 1C3=0001 1100 0011,
    //   3E= 0011 1110, AND = 0000 0010 = 0x02). idx byte = 2 → word index 1.
    //   → 0xA001 + 0x2000 = 0xC001. ✓
    //
    // Long: bit 31..18 = 0001 1100 0011 00 → top 14 bits.
    //   bit 31 = 0, 30 = 0, 29 = 0, 28 = 1, 27 = 1, 26 = 1, 25 = 0, 24 = 0,
    //   23 = 0, 22 = 0, 21 = 1, 20 = 1, 19 = 0, 18 = 0.
    //   Mask: 0001 1100 00xx 1100 0000 0000 0000 0000?
    //   Wait. bit 31..18 = 14 bits. Value 0x1C30 = 0001 1100 0011 0000.
    //   Top 14 bits of long = these 14 bits left-shifted to occupy bits 31..18.
    //   Long = (token << 18). 0x1C30 << 18 = 0x1C30_0000_0000 truncated to 32-bit:
    //   0x1C30 << 18 = let me compute. 0x1C30 = 7216. 7216 * 2^18 = 7216 * 262144
    //   = 1,891,631,104 = 0x70C00000. Hmm.
    //   Actually 0x1C30 << 16 = 0x1C300000. Then << 2 = 0x70C00000.
    //   So long = 0x70C00000.
    setLongs(s, 0x200, [0x70c00000, 0x00000000, 0x00000000]);
    setBytes(s, 0x300, [0xff, 0x20]);

    decodeBitstream1A668(s, rom, outAbs, ctrlAbs, extAbs);

    // Out[0] = ROM_table1[1] + 0x2000 = 0xA001 + 0x2000 = 0xC001.
    expect(readOutWord(s, 0x100, 0)).toBe(0xc001);
    // Path C consuma 9 bit. d4 = 9. No bit 4 (9 = 0b1001). a3 NOT advanced.
    // Iter 2: d4=9, d1Shift = 18-9 = 9. asr.l 9 → 0x70c00000 >> 9 = 0x386000.
    //   token = 0x6000 & 0x3FFF = 0x2000. bit 13 set! Path A.
    //   D5 = 0x2000 ^ bit13 = 0. asr.w #1 → 0. carry = 0 (LSB was 0).
    //   D6 NOT updated. add D3 = 0x2000. out = 0x2000.
    expect(readOutWord(s, 0x100, 1)).toBe(0x2000);
    // d4 += 14 = 23. bit 4 set → bclr → d4 = 7, a3 += 2. Iter 3:
    //   read32 from new a3 (offset 2 in ctrl) = 0x00000000.
    //   d1Shift = 18-7 = 11. asr 11 = 0. token = 0. path B.
    //   D6=0 still. cnt=0. D6++ = 1. out = 1 + 0x2000 = 0x2001.
    expect(readOutWord(s, 0x100, 2)).toBe(0x2001);
  });

  it("Path D (token = 0x1000): consecutive run con ROM table-2 constant", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const outAbs = WORK_RAM_BASE + 0x100;
    const ctrlAbs = WORK_RAM_BASE + 0x200;
    const extAbs = WORK_RAM_BASE + 0x300;
    // Setup ROM tables.
    const t1: number[] = [];
    for (let i = 0; i < 32; i++) t1.push(0xa000 + i);
    const t2: number[] = [];
    for (let i = 0; i < 8; i++) t2.push(0xb000 + i);
    setupRomTables(rom, t1, t2);
    // Token1: 0x1000 + (5 << 7) | (2 << 9 = 0x400) — wait. Path D triggers when
    //   D5 & 0x1C00 in {0x400, 0x800, 0xC00, 0x1000} (i.e. != 0, != 0x1C00,
    //   <= 0x1000).
    //   Let's choose D1 = 0x1000 (highest path D).
    //   cnt = (D5 >> 7) & 7. Want cnt = 2 (3 outputs).
    //   D5 idx = (D5 >> 9) & 0xE. Want idx = 0xE (table2[7]).
    //   We need to set D5 such that:
    //     - bits 12..10 = 100 (0x1000)
    //     - bits 9..7 = 010 (cnt=2)
    //     - bits 6..0 = whatever
    //   Also bit 13 = 0.
    //   Also bits ?? for idx: idx = (D5 >> 9) & 0xE. (D5 >> 9) gets bits 9..14
    //   of the word. & 0xE = bits 1,2,3 of (D5>>9) = bits 10,11,12 of D5
    //   shifted into positions 1..3.
    //   bits 10..12 = 100 (from path D = 0x1000) → (D5>>9)&0xE = 0x100 >> ?
    //   Actually let me recompute: D5 = 0x1000 + (cnt << 7) = 0x1000 | 0x100
    //   = 0x1100. D5 >> 9 = 0x08. & 0xE = 0x08. table2[8/2 = 4] = 0xB004.
    //
    //   Let me pick a simpler test: just D5 = 0x1000 (no extra bits).
    //     bit 13 = 0, D1 = D5 & 0x1C00 = 0x1000 (path D).
    //     cnt = (0x1000 >> 7) & 7 = 0x20 & 7 = 0 → 1 iteration.
    //     idx_byte = (0x1000 >> 9) & 0xE = 0x08 & 0xE = 0x08. → table2[4] = 0xB004.
    //     out = 0xB004 + D3 (= 0x2500). → 0xD504.
    //   D5 = 0x1000 → as 14-bit token. bits 31..18 of long = 0001 0000 0000 00.
    //   Long = 0x1000 << 18 = 0x40000000.
    setLongs(s, 0x200, [0x40000000, 0x00000000, 0x00000000]);
    setBytes(s, 0x300, [0xff, 0x25]);

    decodeBitstream1A668(s, rom, outAbs, ctrlAbs, extAbs);

    expect(readOutWord(s, 0x100, 0)).toBe((0xb004 + 0x2500) & 0xffff);
  });

  it("Path E (token = 0x1400): consecutive run con toggle base 0x4D/0x4E", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const outAbs = WORK_RAM_BASE + 0x100;
    const ctrlAbs = WORK_RAM_BASE + 0x200;
    const extAbs = WORK_RAM_BASE + 0x300;
    // Token: D5 = 0x1400 → bits 12..10 = 101 (0x1400). D1 (mask) = 0x1400 > 0x1000 → path E.
    // cnt = (0x1400 >> 7) & 7 = 0x28 & 7 = 0 → 1 iter.
    // bit 10 of D1=0x1400 → 0x400 set → D5 = 0x4D (NOT incremented).
    // out = 0x4D + D3 = 0x4D + 0x3000 = 0x304D.
    // D5 ^= 3, but only 1 iter so no second output.
    // Long: 0x1400 << 18 = 0x50000000.
    setLongs(s, 0x200, [0x50000000, 0x00000000, 0x00000000]);
    setBytes(s, 0x300, [0xff, 0x30]);

    decodeBitstream1A668(s, rom, outAbs, ctrlAbs, extAbs);

    expect(readOutWord(s, 0x100, 0)).toBe(0x304d);
  });

  it("Path E con count=1 (token=0x1480): toggle D5 ^= 3 fra 2 output", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const outAbs = WORK_RAM_BASE + 0x100;
    const ctrlAbs = WORK_RAM_BASE + 0x200;
    const extAbs = WORK_RAM_BASE + 0x300;
    // Token: D5 = 0x1480 → bits 12..10 = 101 (0x1400 path E), bits 9..7 = 001 (cnt=1).
    // cnt=1 -> 2 iters. bit 10 set -> D5 starts at 0x4D.
    // Iter1: out = 0x4D + 0x3000 = 0x304D. D5 ^= 3 = 0x4E.
    // Iter2: out = 0x4E + 0x3000 = 0x304E. D5 ^= 3 = 0x4D.
    // Long: 0x1480 << 18 = 0x52000000.
    setLongs(s, 0x200, [0x52000000, 0x00000000, 0x00000000]);
    setBytes(s, 0x300, [0xff, 0x30]);

    decodeBitstream1A668(s, rom, outAbs, ctrlAbs, extAbs);

    expect(readOutWord(s, 0x100, 0)).toBe(0x304d);
    expect(readOutWord(s, 0x100, 1)).toBe(0x304e);
  });

  it("Pure: scrive solo nei 0x48 byte di output (+overshoot)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const outAbs = WORK_RAM_BASE + 0x100;
    const ctrlAbs = WORK_RAM_BASE + 0x200;
    const extAbs = WORK_RAM_BASE + 0x300;
    // Ctrl: zero → path B (1 output per iter). Output: 36 word = 72 byte = 0x48.
    // Ctrl region zeroed (default).
    setBytes(s, 0x300, [0xff, 0x00]);
    // Snapshot di tutta workRam pre-call.
    const before = new Uint8Array(s.workRam);

    decodeBitstream1A668(s, rom, outAbs, ctrlAbs, extAbs);

    // Expected writable range: [outOff..outOff + 0x48 + overshoot_max).
    // Max overshoot = 7 words = 14 bytes (last path B/D/E iter can produce 8 words).
    const writeStart = 0x100;
    const writeEnd = 0x100 + 0x48 + 14;
    for (let i = 0; i < s.workRam.length; i++) {
      if (i >= writeStart && i < writeEnd) continue;
      expect(s.workRam[i]).toBe(before[i]);
    }
  });

  it("Output buffer riceve esattamente OUTPUT_LEN_BYTES = 0x48", () => {
    expect(OUTPUT_LEN_BYTES).toBe(0x48);
    expect(OUTPUT_LEN_WORDS).toBe(0x24);
  });
});
