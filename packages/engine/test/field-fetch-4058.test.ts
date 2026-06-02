/**
 * field-fetch-4058.test.ts — smoke tests of `fieldFetch4058` (FUN_4058).
 *
 * Verifica the 4 path of ritorno + invarianti chiave + bit-perfectness of the
 * sign-ext of the costante ROM and of the addressing record.
 *
 * Bit-perfect parity (500 random cases) verified in
 * `packages/cli/src/test-field-fetch-4058-parity.ts` vs Musashi.
 */

import { describe, it, expect } from "vitest";
import {
  fieldFetch4058,
  RECORD_SIZE,
  RECORD_WORD_OFF,
  RET_OFFSET_OOR,
  RET_INDEX_OOR,
} from "../src/field-fetch-4058.js";
import { emptyGameState } from "../src/state.js";

const PTR_OFF = 0x1ffc;

function writeLongBE(ram: Uint8Array, off: number, val: number): void {
  ram[off] = (val >>> 24) & 0xff;
  ram[off + 1] = (val >>> 16) & 0xff;
  ram[off + 2] = (val >>> 8) & 0xff;
  ram[off + 3] = val & 0xff;
}

/** ROM[0x1006F] = 0xE3 -> sign-ext-long & 7 = 3. Marble program reale. */
const ROM_BYTE_REAL = 0xe3;

describe("fieldFetch4058 (FUN_4058)", () => {
  it("path #1: arg2 > 0x12 -> ret -1 (RET_OFFSET_OOR)", () => {
    const s = emptyGameState();
    // Pointer dentro workRam, struct base = 0x401D00 + 0x50 = 0x401D50.
    writeLongBE(s.workRam, PTR_OFF, 0x401d00);
    // Even with valid arg1, arg2 > 0x12 always returns -1.
    expect(fieldFetch4058(s, 0, 0x13, ROM_BYTE_REAL)).toBe(RET_OFFSET_OOR);
    expect(fieldFetch4058(s, 0, 0xff, ROM_BYTE_REAL)).toBe(RET_OFFSET_OOR);
    expect(fieldFetch4058(s, 0, 0x12345, ROM_BYTE_REAL)).toBe(RET_OFFSET_OOR);
  });

  it("path #2: arg2 <= 0x12 but arg1 >= D4 -> ret -2 (RET_INDEX_OOR)", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, 0x401d00);
    // ROM_BYTE_REAL = 0xE3 -> D4 = 3. arg1=3,4,5,... -> ret -2.
    expect(fieldFetch4058(s, 3, 0, ROM_BYTE_REAL)).toBe(RET_INDEX_OOR);
    expect(fieldFetch4058(s, 7, 0x12, ROM_BYTE_REAL)).toBe(RET_INDEX_OOR);
    // Con romByte = 0x00 (D4 = 0), qualsiasi arg1 e' OOR.
    expect(fieldFetch4058(s, 0, 0, 0x00)).toBe(RET_INDEX_OOR);
  });

  it("path #3: arg1 < D4 and arg2 < 0x12 -> returns byte @ record_base + arg1*20 + arg2", () => {
    const s = emptyGameState();
    const ptr = 0x401000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    // Struct base = 0x401050. Record 0 = +0..+19, Record 1 = +20..+39, etc.
    // arg1=1, arg2=5 -> base + 1*20 + 5 = 0x401050 + 25 = 0x401069.
    // workRam offset = 0x401069 - 0x400000 = 0x1069.
    s.workRam[0x1050 + 1 * RECORD_SIZE + 5] = 0xa7;
    expect(fieldFetch4058(s, 1, 5, ROM_BYTE_REAL)).toBe(0xa7);

    // arg1=0, arg2=0x11 -> base + 0 + 0x11 = 0x401061.
    s.workRam[0x1050 + 0x11] = 0x42;
    expect(fieldFetch4058(s, 0, 0x11, ROM_BYTE_REAL)).toBe(0x42);
  });

  it("path #4: arg2 == 0x12 -> returns word big-endian @ record_base + arg1*20 + 0x12", () => {
    const s = emptyGameState();
    const ptr = 0x401000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    // Record 2: base + 2*20 = +40. Word @ +40+0x12 = +58.
    // workRam offset = 0x1050 + 58 = 0x108A. High byte 0x12, low 0x34 -> 0x1234.
    s.workRam[0x1050 + 2 * RECORD_SIZE + RECORD_WORD_OFF] = 0x12;
    s.workRam[0x1050 + 2 * RECORD_SIZE + RECORD_WORD_OFF + 1] = 0x34;
    expect(fieldFetch4058(s, 2, RECORD_WORD_OFF, ROM_BYTE_REAL)).toBe(0x1234);

    // Record 0, byte hi=0xFE, lo=0xDC -> 0xFEDC.
    s.workRam[0x1050 + RECORD_WORD_OFF] = 0xfe;
    s.workRam[0x1050 + RECORD_WORD_OFF + 1] = 0xdc;
    expect(fieldFetch4058(s, 0, RECORD_WORD_OFF, ROM_BYTE_REAL)).toBe(0xfedc);
  });

  it("priorita' check: arg2 > 0x12 vince even if arg1 e' outside range", () => {
    // The binary checks arg2 > 0x12 first (set D3=1), then arg1 vs D4
    // (skipped by bne). Therefore arg2 > 0x12 always forces ret -1 even if
    // arg1 e' also lui invalido.
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, 0x401d00);
    expect(fieldFetch4058(s, 99, 0x13, ROM_BYTE_REAL)).toBe(RET_OFFSET_OOR);
    expect(fieldFetch4058(s, 0xffffffff, 0x20, ROM_BYTE_REAL)).toBe(
      RET_OFFSET_OOR,
    );
  });

  it("ROM byte sign-ext: solo the 3 bit bassi contano (0xE3 -> D4=3, 0xFF -> D4=7)", () => {
    // Verify that different ROM bytes sharing the low 3 bits produce
    // same behavior: D4 is computed as (byte sign-ext-long) & 7.
    const s = emptyGameState();
    const ptr = 0x401000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    s.workRam[0x1050 + 6 * RECORD_SIZE] = 0x9c; // record 6 byte 0

    // 0xE3 & 7 = 3; 0xEB & 7 = 3 -> both -> arg1=3 e' OOR.
    expect(fieldFetch4058(s, 3, 0, 0xe3)).toBe(RET_INDEX_OOR);
    expect(fieldFetch4058(s, 3, 0, 0xeb)).toBe(RET_INDEX_OOR);

    // 0xFF & 7 = 7 -> arg1=6 valid -> reads the byte.
    expect(fieldFetch4058(s, 6, 0, 0xff)).toBe(0x9c);
    // 0x07 & 7 = 7 (same behavior, high bits irrelevant).
    expect(fieldFetch4058(s, 6, 0, 0x07)).toBe(0x9c);
  });

  it("ptr legato dinamicamente a *0x401FFC (cambiare ptr cambia base)", () => {
    const s = emptyGameState();
    // Setup A: ptr = 0x401000 -> base = 0x401050. Record 0 byte 0 = 0xAA.
    writeLongBE(s.workRam, PTR_OFF, 0x401000);
    s.workRam[0x1050] = 0xaa;
    expect(fieldFetch4058(s, 0, 0, ROM_BYTE_REAL)).toBe(0xaa);

    // Setup B: ptr = 0x400500 -> base = 0x400550. Record 0 byte 0 = 0xBB.
    writeLongBE(s.workRam, PTR_OFF, 0x400500);
    s.workRam[0x550] = 0xbb;
    expect(fieldFetch4058(s, 0, 0, ROM_BYTE_REAL)).toBe(0xbb);
  });

  it("no side effect su workRam (puro read)", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, 0x401000);
    s.workRam[0x1050] = 0x77;
    s.workRam[0x1051] = 0x88;
    const before = new Uint8Array(s.workRam);
    fieldFetch4058(s, 0, 0, ROM_BYTE_REAL);
    fieldFetch4058(s, 1, RECORD_WORD_OFF, ROM_BYTE_REAL);
    fieldFetch4058(s, 99, 0x99, ROM_BYTE_REAL); // OOR cases
    fieldFetch4058(s, 5, 0, ROM_BYTE_REAL);
    expect(s.workRam).toEqual(before);
  });
});
