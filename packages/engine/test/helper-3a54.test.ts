/**
 * helper-3a54.test.ts — smoke test per helper3A54 (FUN_3A54).
 *
 * `FUN_00003A54` (27 instructions): formats a 32-bit value as a decimal string
 * ASCII in memoria, usando BCD packed come intermediario (via FUN_3A6A) e
 * then writing with FUN_3A08.
 *
 * Bit-perfect parity verificata vs binary in
 * `packages/cli/src/test-helper-3a54-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  helper3A54,
  HELPER_3A54_ADDR,
} from "../src/helper-3a54.js";
import { emptyGameState } from "../src/state.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

const WR_BASE = 0x400000;

function readByte(state: ReturnType<typeof emptyGameState>, addr: number): number {
  return state.workRam[addr - WR_BASE] ?? 0;
}

/** Legge `n` byte a partire da `addr` come stringa leggibile. */
function readStr(
  state: ReturnType<typeof emptyGameState>,
  addr: number,
  n: number,
): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const b = readByte(state, addr + i);
    parts.push(
      b >= 0x20 && b < 0x7f
        ? String.fromCharCode(b)
        : `\\x${b.toString(16).padStart(2, "0")}`,
    );
  }
  return parts.join("");
}

// ─── constants ────────────────────────────────────────────────────────────────

describe("helper3A54 costanti", () => {
  it("HELPER_3A54_ADDR ha il valore corretto", () => {
    expect(HELPER_3A54_ADDR).toBe(0x00003a54);
  });
});

// Base values.

describe("helper3A54 — valori decimali base", () => {
  it("value=0, digits=4, showSpaces=0: '0000' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 0, BUF, 4, 0);
    expect(readStr(s, BUF, 5)).toBe("0000\\x00");
  });

  it("value=1, digits=4, showSpaces=0: '0001' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 1, BUF, 4, 0);
    expect(readStr(s, BUF, 5)).toBe("0001\\x00");
  });

  it("value=9, digits=1, showSpaces=0: '9' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 9, BUF, 1, 0);
    expect(readByte(s, BUF)).toBe(0x39); // '9'
    expect(readByte(s, BUF + 1)).toBe(0x00);
  });

  it("value=10, digits=2, showSpaces=0: '10' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 10, BUF, 2, 0);
    expect(readStr(s, BUF, 3)).toBe("10\\x00");
  });

  it("value=99, digits=2, showSpaces=0: '99' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 99, BUF, 2, 0);
    expect(readStr(s, BUF, 3)).toBe("99\\x00");
  });

  it("value=100, digits=3, showSpaces=0: '100' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 100, BUF, 3, 0);
    expect(readStr(s, BUF, 4)).toBe("100\\x00");
  });

  it("value=1234, digits=4, showSpaces=0: '1234' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 1234, BUF, 4, 0);
    expect(readStr(s, BUF, 5)).toBe("1234\\x00");
  });

  it("value=9999, digits=4, showSpaces=0: '9999' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 9999, BUF, 4, 0);
    expect(readStr(s, BUF, 5)).toBe("9999\\x00");
  });

  it("value=12345678, digits=8, showSpaces=0: '12345678' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 12345678, BUF, 8, 0);
    expect(readStr(s, BUF, 9)).toBe("12345678\\x00");
  });

  it("value=99999999, digits=8, showSpaces=0: '99999999' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 99999999, BUF, 8, 0);
    expect(readStr(s, BUF, 9)).toBe("99999999\\x00");
  });
});

// ─── showSpaces ───────────────────────────────────────────────────────────────

describe("helper3A54 — showSpaces", () => {
  it("value=0, digits=4, showSpaces=1: '   0' + NUL (leading zeros → spaces)", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 0, BUF, 4, 1);
    expect(readByte(s, BUF + 0)).toBe(0x20); // ' '
    expect(readByte(s, BUF + 1)).toBe(0x20); // ' '
    expect(readByte(s, BUF + 2)).toBe(0x20); // ' '
    expect(readByte(s, BUF + 3)).toBe(0x30); // '0'
    expect(readByte(s, BUF + 4)).toBe(0x00); // NUL
  });

  it("value=42, digits=4, showSpaces=1: '  42' + NUL (leading zeros → spaces)", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 42, BUF, 4, 1);
    expect(readByte(s, BUF + 0)).toBe(0x20); // ' '
    expect(readByte(s, BUF + 1)).toBe(0x20); // ' '
    expect(readByte(s, BUF + 2)).toBe(0x34); // '4'
    expect(readByte(s, BUF + 3)).toBe(0x32); // '2'
    expect(readByte(s, BUF + 4)).toBe(0x00); // NUL
  });

  it("value=1000, digits=6, showSpaces=1: '  1000' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 1000, BUF, 6, 1);
    expect(readByte(s, BUF + 0)).toBe(0x20); // ' '
    expect(readByte(s, BUF + 1)).toBe(0x20); // ' '
    expect(readByte(s, BUF + 2)).toBe(0x31); // '1'
    expect(readByte(s, BUF + 3)).toBe(0x30); // '0'
    expect(readByte(s, BUF + 4)).toBe(0x30); // '0'
    expect(readByte(s, BUF + 5)).toBe(0x30); // '0'
    expect(readByte(s, BUF + 6)).toBe(0x00); // NUL
  });

  it("value=42, digits=4, showSpaces=0: '0042' (leading zeros non convertiti)", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 42, BUF, 4, 0);
    expect(readStr(s, BUF, 5)).toBe("0042\\x00");
  });
});

// ─── null-terminator ─────────────────────────────────────────────────────────

describe("helper3A54 — null-terminator", () => {
  it("scrive NUL a bufEnd+numDigits", () => {
    const s = emptyGameState();
    s.workRam.fill(0x55);
    const BUF = 0x401d00;
    helper3A54(s, 0, BUF, 4, 0);
    expect(readByte(s, BUF + 4)).toBe(0);
  });

  it("numDigits=1, value=7: '7' + NUL", () => {
    const s = emptyGameState();
    const BUF = 0x401d00;
    helper3A54(s, 7, BUF, 1, 0);
    expect(readByte(s, BUF)).toBe(0x37); // '7'
    expect(readByte(s, BUF + 1)).toBe(0x00);
  });
});

// ─── isolamento memoria ───────────────────────────────────────────────────────

describe("helper3A54 — isolamento memoria", () => {
  it("non tocca byte fuori dall'area [bufEnd..bufEnd+numDigits+1]", () => {
    const s = emptyGameState();
    s.workRam.fill(0xa5);
    const BUF = 0x401d00;
    const DIGITS = 4;
    helper3A54(s, 1234, BUF, DIGITS, 0);
    expect(readByte(s, BUF - 1)).toBe(0xa5);
    expect(readByte(s, BUF + DIGITS + 1)).toBe(0xa5);
  });
});
