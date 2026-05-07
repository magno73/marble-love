/**
 * render-string-chain-3662.test.ts — smoke + corner case di FUN_3662.
 *
 * Bit-perfect parity verificata vs binary in
 * `packages/cli/src/test-render-string-chain-3662-parity.ts`.
 *
 * Qui copriamo i path principali (rotation 0 vs !=0, narrow vs wide,
 * tickOff oltre lookup, marker che termina/continua chain) e l'edge case
 * "stringa vuota" (primo byte == 0).
 */

import { describe, it, expect } from "vitest";

import {
  renderStringChain3662,
  RENDER_CHAR_ARG2,
  FUN_32BA_ADDR,
  FUN_33F4_ADDR,
  NARROW_GLYPH_LO_INCL,
  NARROW_GLYPH_HI_INCL,
  type RenderCharCall,
  type RenderStringChain3662Subs,
} from "../src/render-string-chain-3662.js";
import { emptyGameState, type GameState } from "../src/state.js";
import { emptyRomImage, type RomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;
const ALPHA_BASE = 0xa03000;

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Scrive un long big-endian a `off` in workRam. */
function writeLongWR(workRam: Uint8Array, off: number, val: number): void {
  workRam[off] = (val >>> 24) & 0xff;
  workRam[off + 1] = (val >>> 16) & 0xff;
  workRam[off + 2] = (val >>> 8) & 0xff;
  workRam[off + 3] = val & 0xff;
}

/** Scrive una word big-endian a `off` in workRam. */
function writeWordWR(workRam: Uint8Array, off: number, val: number): void {
  workRam[off] = (val >>> 8) & 0xff;
  workRam[off + 1] = val & 0xff;
}

/**
 * Costruisce un RomImage popolato con le ROM tables minime per i test:
 *   - 0x7294 (lookup limit, words)
 *   - 0x72a0 (stride, words)
 *   - 0x72a4+1 (shift count byte per rotation*2)
 *   - 0x72ac (glyph index long per char)
 *
 * Usa valori sintetici per controllare il flow ma compatibili coi range
 * effettivi del binario (rotation 0..7).
 */
function makeTestRom(): RomImage {
  const rom = emptyRomImage();
  const p = rom.program;

  // 0x7294 lookup limit per rotation:
  //   rot=0 → 0x100 (large, così tickOff diff è quasi sempre <= lookup)
  //   rot=1 → 0x100
  //   rot=2 → -1 (0xFFFF, signed -1) per testare path bgt → skip render
  for (let r = 0; r < 8; r++) {
    const v = r === 2 ? 0xffff : 0x0100;
    p[0x7294 + r * 2] = (v >>> 8) & 0xff;
    p[0x7294 + r * 2 + 1] = v & 0xff;
  }

  // 0x72a0 stride per rotation: tutti = 1 (semplifica reasoning sui pos).
  for (let r = 0; r < 8; r++) {
    p[0x72a0 + r * 2] = 0;
    p[0x72a0 + r * 2 + 1] = 0x01;
  }

  // 0x72a5 + rot*2 shift count: 0 per default (no shift) per facilitare
  // i test (col_signed << 0 = col_signed).
  for (let r = 0; r < 8; r++) {
    p[0x72a4 + r * 2] = 0;
    p[0x72a4 + r * 2 + 1] = 0;
  }

  // 0x72ac glyph index long per char:
  //   char 'A' (0x41) → idx 0x10  (wide, fuori [0x26..0x2e])
  //   char "'" (0x27) → idx 0x2a  (narrow, dentro [0x26..0x2e])
  //   char '0' (0x30) → idx 0x00  (wide, < 0x26)
  //   altri          → idx 0x00  (wide)
  // Cleariamo prima l'intera area
  for (let i = 0; i < 0x100; i++) {
    p[0x72ac + i * 4] = 0;
    p[0x72ac + i * 4 + 1] = 0;
    p[0x72ac + i * 4 + 2] = 0;
    p[0x72ac + i * 4 + 3] = 0;
  }
  // 'A' (0x41) → 0x10 (wide)
  p[0x72ac + 0x41 * 4 + 3] = 0x10;
  // "'" (0x27) → 0x2a (narrow)
  p[0x72ac + 0x27 * 4 + 3] = 0x2a;
  // 'B' (0x42) → 0x26 (narrow lower bound)
  p[0x72ac + 0x42 * 4 + 3] = 0x26;
  // 'C' (0x43) → 0x2e (narrow upper bound)
  p[0x72ac + 0x43 * 4 + 3] = 0x2e;
  // 'D' (0x44) → 0x25 (wide, < 0x26)
  p[0x72ac + 0x44 * 4 + 3] = 0x25;
  // 'E' (0x45) → 0x2f (wide, > 0x2e)
  p[0x72ac + 0x45 * 4 + 3] = 0x2f;

  return rom;
}

/**
 * Setup di una struct entry singola in workRam:
 *   col @ off, tickOff @ off+1, stringPtr @ off+2..+5, marker @ off+6,
 *   nextPtr @ off+8..+11.
 *
 * Returns absolute address of the struct.
 */
function setupEntry(
  state: GameState,
  off: number,
  col: number,
  tickOff: number,
  stringPtr: number,
  marker: number,
  nextPtr: number,
): number {
  state.workRam[off] = col & 0xff;
  state.workRam[off + 1] = tickOff & 0xff;
  writeLongWR(state.workRam, off + 2, stringPtr);
  state.workRam[off + 6] = marker & 0xff;
  state.workRam[off + 7] = 0; // padding
  writeLongWR(state.workRam, off + 8, nextPtr);
  return WORK_RAM_BASE + off;
}

/** Scrive una stringa null-terminated in workRam @ off. */
function writeStr(workRam: Uint8Array, off: number, s: string): void {
  for (let i = 0; i < s.length; i++) {
    workRam[off + i] = s.charCodeAt(i) & 0xff;
  }
  workRam[off + s.length] = 0;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("renderStringChain3662 (FUN_3662) — exports", () => {
  it("expone gli indirizzi delle jsr esterne e i bound narrow", () => {
    expect(FUN_32BA_ADDR).toBe(0x000032ba);
    expect(FUN_33F4_ADDR).toBe(0x000033f4);
    expect(RENDER_CHAR_ARG2).toBe(0x3c);
    expect(NARROW_GLYPH_LO_INCL).toBe(0x26);
    expect(NARROW_GLYPH_HI_INCL).toBe(0x2e);
  });
});

describe("renderStringChain3662 (FUN_3662) — single entry, rotation == 0", () => {
  it("string vuota (primo byte = 0) → nessuna call, return 1", () => {
    const state = emptyGameState();
    const rom = makeTestRom();
    // rotation = 0 (default zero)
    // tick = 0, valF00 = 0
    // marker = 0 (sum = 0 ≤ 1 → no chain advance, return 1)
    const stringOff = 0x100;
    state.workRam[stringOff] = 0; // primo byte = terminator immediato
    const structAddr = setupEntry(
      state,
      0x200,
      /*col*/ 0,
      /*tickOff*/ 0,
      /*stringPtr*/ WORK_RAM_BASE + stringOff,
      /*marker*/ 0,
      /*nextPtr*/ 0,
    );

    const calls: RenderCharCall[] = [];
    const subs: RenderStringChain3662Subs = {
      fun_32ba: (c) => calls.push(c),
      fun_33f4: (c) => calls.push(c),
    };

    const ret = renderStringChain3662(state, rom, structAddr, 0, subs);
    expect(ret).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("rotation == 0 → dispatch a fun_32ba per ogni char (NON fun_33f4)", () => {
    const state = emptyGameState();
    const rom = makeTestRom();
    // rotation = 0 (workRam[0x1f42..0x1f43] = 0)
    // tick = 0, valF00 = 0, marker = 0 → chain ferma dopo 1ª entry

    const stringOff = 0x100;
    writeStr(state.workRam, stringOff, "AB"); // 2 char + 0 terminator
    const structAddr = setupEntry(
      state,
      0x200,
      /*col*/ 0,
      /*tickOff*/ 0,
      /*stringPtr*/ WORK_RAM_BASE + stringOff,
      /*marker*/ 0,
      /*nextPtr*/ 0,
    );

    const calls32ba: RenderCharCall[] = [];
    const calls33f4: RenderCharCall[] = [];
    renderStringChain3662(state, rom, structAddr, 0, {
      fun_32ba: (c) => calls32ba.push(c),
      fun_33f4: (c) => calls33f4.push(c),
    });

    // 2 char → 2 call a fun_32ba, 0 a fun_33f4
    expect(calls32ba).toHaveLength(2);
    expect(calls33f4).toHaveLength(0);
    expect(calls32ba[0]!.charByte).toBe(0x41);
    expect(calls32ba[0]!.rotation).toBe(0);
    expect(calls32ba[0]!.arg2).toBe(0x3c);
    expect(calls32ba[0]!.arg3).toBe(0);
    expect(calls32ba[1]!.charByte).toBe(0x42);
  });

  it("rotation == 0, char 'A' (wide) vs char 'B' (narrow) → stride diversi", () => {
    // Setup: rot=0, stride[0] = 1, shift = 0, col = 0 → primo D3 = ALPHA_BASE.
    // 'A' wide → step = stride*4 = 4
    // 'B' narrow (idx 0x26 → in [0x26..0x2e]) → step = stride*2 = 2
    const state = emptyGameState();
    const rom = makeTestRom();

    const stringOff = 0x100;
    writeStr(state.workRam, stringOff, "AB");
    const structAddr = setupEntry(
      state,
      0x200,
      /*col*/ 0,
      /*tickOff*/ 0,
      /*stringPtr*/ WORK_RAM_BASE + stringOff,
      /*marker*/ 0,
      /*nextPtr*/ 0,
    );

    const ptrs: number[] = [];
    renderStringChain3662(state, rom, structAddr, 0, {
      fun_32ba: (c) => ptrs.push(c.alphaPtr),
    });

    expect(ptrs).toHaveLength(2);
    // primo char @ ALPHA_BASE (col=0, tickOff=0, shift=0, stride=1)
    expect(ptrs[0]).toBe(ALPHA_BASE);
    // 'A' wide → +stride*4 = +4
    expect(ptrs[1]).toBe(ALPHA_BASE + 4);
    // 'B' è il SECONDO char e nessun terzo: solo 2 ptr.
  });
});

describe("renderStringChain3662 (FUN_3662) — rotation != 0", () => {
  it("rotation = 1 → dispatch a fun_33f4 (NON fun_32ba)", () => {
    const state = emptyGameState();
    const rom = makeTestRom();
    writeWordWR(state.workRam, 0x1f42, 1); // rotation = 1

    const stringOff = 0x100;
    writeStr(state.workRam, stringOff, "X"); // 1 char
    const structAddr = setupEntry(
      state,
      0x200,
      0,
      0,
      WORK_RAM_BASE + stringOff,
      0,
      0,
    );

    const calls32ba: RenderCharCall[] = [];
    const calls33f4: RenderCharCall[] = [];
    renderStringChain3662(state, rom, structAddr, 0, {
      fun_32ba: (c) => calls32ba.push(c),
      fun_33f4: (c) => calls33f4.push(c),
    });

    expect(calls32ba).toHaveLength(0);
    expect(calls33f4).toHaveLength(1);
    expect(calls33f4[0]!.charByte).toBe(0x58); // 'X'
    expect(calls33f4[0]!.rotation).toBe(1);
  });
});

describe("renderStringChain3662 (FUN_3662) — tickOff > lookup → skip render", () => {
  it("rotation=2 con lookup=-1 (sempre skip) → no call, return 1", () => {
    const state = emptyGameState();
    const rom = makeTestRom();
    writeWordWR(state.workRam, 0x1f42, 2); // rotation = 2 → lookup[2] = 0xFFFF (-1 signed)
    // tickOff = 0, tick = 0 → D1w = 0; cmp.w lookup, D1w → 0 > -1 → bgt → skip
    const stringOff = 0x100;
    writeStr(state.workRam, stringOff, "ABC");
    const structAddr = setupEntry(
      state,
      0x200,
      0,
      0,
      WORK_RAM_BASE + stringOff,
      0,
      0,
    );

    let callCount = 0;
    const ret = renderStringChain3662(state, rom, structAddr, 0, {
      fun_32ba: () => callCount++,
      fun_33f4: () => callCount++,
    });
    expect(ret).toBe(1);
    expect(callCount).toBe(0);
  });
});

describe("renderStringChain3662 (FUN_3662) — chain advance via marker", () => {
  it("marker + valF00 > 1 → continua con next entry; entrambe processate", () => {
    const state = emptyGameState();
    const rom = makeTestRom();

    // VAL_F00 @ 0x401F00 = 5 (positivo, signed)
    writeWordWR(state.workRam, 0x1f00, 5);

    // String 1: "A" @ 0x100
    writeStr(state.workRam, 0x100, "A");
    // String 2: "B" @ 0x180
    writeStr(state.workRam, 0x180, "B");

    // Entry 2 @ 0x300: marker = 0 → sum = 0+5 = 5 > 1 → continua...
    //   ma poi arriva a entry 3 (nextPtr = 0) che è degenerata.
    // Per evitare loop, usiamo marker della entry 2 NEGATIVO grande così
    // sum = -100 + 5 = -95 ≤ 1 → exit.
    const entry2Addr = setupEntry(
      state,
      0x300,
      0,
      0,
      WORK_RAM_BASE + 0x180, // string "B"
      0x80, // marker = -128 signed → sum = -128+5 = -123 ≤ 1 → exit
      0, // nextPtr = 0 (non usato)
    );

    // Entry 1 @ 0x200: marker = 0 → sum = 0+5 = 5 > 1 → advance to entry 2
    const entry1Addr = setupEntry(
      state,
      0x200,
      0,
      0,
      WORK_RAM_BASE + 0x100, // string "A"
      0, // marker = 0 → sum = 5 > 1 → advance
      entry2Addr,
    );

    const calls: RenderCharCall[] = [];
    const ret = renderStringChain3662(state, rom, entry1Addr, 0, {
      fun_32ba: (c) => calls.push(c),
    });
    expect(ret).toBe(1);
    // Due char processati: 'A' (entry1) + 'B' (entry2)
    expect(calls).toHaveLength(2);
    expect(calls[0]!.charByte).toBe(0x41);
    expect(calls[1]!.charByte).toBe(0x42);
  });

  it("marker + valF00 ≤ 1 (default 0+0 = 0) → ferma dopo 1ª entry", () => {
    const state = emptyGameState();
    const rom = makeTestRom();
    writeStr(state.workRam, 0x100, "AB");
    const structAddr = setupEntry(
      state,
      0x200,
      0,
      0,
      WORK_RAM_BASE + 0x100,
      0, // marker = 0, valF00 = 0 → sum = 0 ≤ 1 → exit dopo 1ª entry
      0xdeadbeef, // nextPtr — NON deve essere seguito
    );

    const calls: RenderCharCall[] = [];
    renderStringChain3662(state, rom, structAddr, 0, {
      fun_32ba: (c) => calls.push(c),
    });
    // 2 char processati ma niente chain advance
    expect(calls).toHaveLength(2);
  });
});

describe("renderStringChain3662 (FUN_3662) — pure read", () => {
  it("non scrive in alphaRam né workRam", () => {
    const state = emptyGameState();
    const rom = makeTestRom();
    writeStr(state.workRam, 0x100, "ABC");
    const structAddr = setupEntry(
      state,
      0x200,
      0,
      0,
      WORK_RAM_BASE + 0x100,
      0,
      0,
    );

    const wrBefore = new Uint8Array(state.workRam);
    const alphaBefore = new Uint8Array(state.alphaRam);

    renderStringChain3662(state, rom, structAddr, 0, {
      // subs vuote → nessuna call modifica state
    });

    expect(state.workRam).toEqual(wrBefore);
    expect(state.alphaRam).toEqual(alphaBefore);
  });

  it("ritorna SEMPRE 1 (anche su input degenerati)", () => {
    const state = emptyGameState();
    const rom = makeTestRom();
    // structAddr = 0 (out-of-range): readByteAbs ritorna 0, quindi tickOff=0,
    // stringPtr=0, primo byte=0 → exit. marker=0 → sum=0 → return 1.
    expect(renderStringChain3662(state, rom, 0, 0)).toBe(1);
    // structAddr punta a una zona non popolata: stesso percorso.
    expect(renderStringChain3662(state, rom, 0x401d00, 0)).toBe(1);
  });
});

describe("renderStringChain3662 (FUN_3662) — _attrWord ignorato", () => {
  it("attrWord diverso non cambia il comportamento", () => {
    const state = emptyGameState();
    const rom = makeTestRom();
    writeStr(state.workRam, 0x100, "X");
    const structAddr = setupEntry(
      state,
      0x200,
      0,
      0,
      WORK_RAM_BASE + 0x100,
      0,
      0,
    );

    const calls1: RenderCharCall[] = [];
    renderStringChain3662(state, rom, structAddr, 0xdeadbeef, {
      fun_32ba: (c) => calls1.push(c),
    });

    const calls2: RenderCharCall[] = [];
    renderStringChain3662(state, rom, structAddr, 0, {
      fun_32ba: (c) => calls2.push(c),
    });

    expect(calls1).toEqual(calls2);
  });
});
