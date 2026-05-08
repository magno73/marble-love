/**
 * helper-253bc.test.ts — unit test di `helper253BC` (FUN_000253BC).
 *
 * Verifica tutti i path:
 *   1. Costante indirizzo corretta
 *   2. No-op quando freeze flag (offset +0x36) != 0
 *   3. Conversione long X → word @+0x32 tramite asr.l #19
 *   4. Conversione long Y → word @+0x34 tramite asr.l #19
 *   5. Long copy *(A0+0x14) → *(A0+0x2A)
 *   6. Byte copy *(A0+0x1B) → *(A0+0x1D)
 *   7. Segni: valori negativi, boundary (0x80000000, 0x7FFFFFFF)
 *   8. Operazione non tocca byte fuori dai campi attesi
 *
 * Bit-perfect parity (500 casi) verificata nel parity runner
 * `packages/cli/src/test-object-helpers-parity.ts` (sezione objDeriveShorts vs Musashi).
 */

import { describe, it, expect } from "vitest";
import { helper253BC, HELPER_253BC_ADDR } from "../src/helper-253bc.js";
import { emptyGameState } from "../src/state.js";

// ─── Helpers locali ───────────────────────────────────────────────────────────

const OBJ_ABS = 0x00401d00; // indirizzo assoluto struct oggetto in workRam
const OBJ_OFF = OBJ_ABS - 0x400000; // offset in workRam (0x1d00)

function readU32(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

function writeU32(r: Uint8Array, off: number, v: number): void {
  const x = v >>> 0;
  r[off] = (x >>> 24) & 0xff;
  r[off + 1] = (x >>> 16) & 0xff;
  r[off + 2] = (x >>> 8) & 0xff;
  r[off + 3] = x & 0xff;
}

function readU16(r: Uint8Array, off: number): number {
  return (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("helper253BC (FUN_000253BC)", () => {
  it("HELPER_253BC_ADDR è 0x000253bc", () => {
    expect(HELPER_253BC_ADDR).toBe(0x000253bc);
  });

  it("no-op se freeze flag (offset +0x36) != 0", () => {
    const state = emptyGameState();
    const r = state.workRam;

    // Setup: scrivi valori riconoscibili nei campi output
    writeU32(r, OBJ_OFF + 0x0c, 0x00800000); // longX → positivo
    writeU32(r, OBJ_OFF + 0x10, 0x00400000); // longY
    writeU32(r, OBJ_OFF + 0x14, 0xdeadbeef);
    r[OBJ_OFF + 0x1b] = 0x42;
    // Sentinel: scrivi 0xAA nei campi output per verificare che non vengano toccati
    r[OBJ_OFF + 0x32] = 0xaa;
    r[OBJ_OFF + 0x33] = 0xaa;
    r[OBJ_OFF + 0x34] = 0xaa;
    r[OBJ_OFF + 0x35] = 0xaa;
    writeU32(r, OBJ_OFF + 0x2a, 0x11111111);
    r[OBJ_OFF + 0x1d] = 0x99;

    // Setta freeze flag
    r[OBJ_OFF + 0x36] = 0x01;

    helper253BC(state, OBJ_ABS);

    // Nessun campo deve essere stato modificato
    expect(r[OBJ_OFF + 0x32]).toBe(0xaa);
    expect(r[OBJ_OFF + 0x33]).toBe(0xaa);
    expect(r[OBJ_OFF + 0x34]).toBe(0xaa);
    expect(r[OBJ_OFF + 0x35]).toBe(0xaa);
    expect(readU32(r, OBJ_OFF + 0x2a)).toBe(0x11111111);
    expect(r[OBJ_OFF + 0x1d]).toBe(0x99);
  });

  it("no-op con freeze flag qualsiasi valore != 0", () => {
    for (const freezeVal of [0x01, 0x02, 0x80, 0xff]) {
      const state = emptyGameState();
      const r = state.workRam;
      r[OBJ_OFF + 0x36] = freezeVal;
      r[OBJ_OFF + 0x32] = 0xbb;
      helper253BC(state, OBJ_ABS);
      expect(r[OBJ_OFF + 0x32]).toBe(0xbb);
    }
  });

  it("esegue quando freeze flag == 0", () => {
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0x00; // non frozen

    writeU32(r, OBJ_OFF + 0x0c, 0x00800000); // longX = 0x800000 → >>19 = 4
    r[OBJ_OFF + 0x32] = 0xaa; // sentinel

    helper253BC(state, OBJ_ABS);

    // Deve aver scritto qualcosa di diverso dal sentinel
    expect(r[OBJ_OFF + 0x32]).not.toBe(0xaa);
  });

  it("screen X: asr.l #19 su valore positivo", () => {
    // asr.l #19: 0x00800000 >> 19 = 16 (0x10)
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;
    writeU32(r, OBJ_OFF + 0x0c, 0x00800000);
    helper253BC(state, OBJ_ABS);
    expect(readU16(r, OBJ_OFF + 0x32)).toBe(16);
  });

  it("screen X: asr.l #19 su 0x00000000 → 0", () => {
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;
    writeU32(r, OBJ_OFF + 0x0c, 0x00000000);
    helper253BC(state, OBJ_ABS);
    expect(readU16(r, OBJ_OFF + 0x32)).toBe(0);
  });

  it("screen X: asr.l #19 su 0x7FFFFFFF → 0x0FFF (massimo positivo)", () => {
    // 0x7FFFFFFF >> 19 = 0x00000FFF
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;
    writeU32(r, OBJ_OFF + 0x0c, 0x7fffffff);
    helper253BC(state, OBJ_ABS);
    expect(readU16(r, OBJ_OFF + 0x32)).toBe(0x0fff);
  });

  it("screen X: asr.l #19 su 0x80000000 → 0xFFFF (-1 come signed)", () => {
    // 0x80000000 signed = -2147483648; -2147483648 >> 19 = -4096 = 0xFFFFF000;
    // low word = 0xF000
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;
    writeU32(r, OBJ_OFF + 0x0c, 0x80000000);
    helper253BC(state, OBJ_ABS);
    // -2147483648 >> 19 = -4096 → & 0xFFFF = 0xF000
    expect(readU16(r, OBJ_OFF + 0x32)).toBe(0xf000);
  });

  it("screen X: asr.l #19 su 0xFFFFFFFF → 0xFFFF (-1)", () => {
    // -1 >> 19 = -1; low word = 0xFFFF
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;
    writeU32(r, OBJ_OFF + 0x0c, 0xffffffff);
    helper253BC(state, OBJ_ABS);
    expect(readU16(r, OBJ_OFF + 0x32)).toBe(0xffff);
  });

  it("screen Y: asr.l #19 su valore positivo (0x00200000 → 4)", () => {
    // 0x00200000 >> 19 = 4
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;
    writeU32(r, OBJ_OFF + 0x10, 0x00200000);
    helper253BC(state, OBJ_ABS);
    expect(readU16(r, OBJ_OFF + 0x34)).toBe(4);
  });

  it("screen Y: asr.l #19 su 0x80000000 → 0xF000 (negativo)", () => {
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;
    writeU32(r, OBJ_OFF + 0x10, 0x80000000);
    helper253BC(state, OBJ_ABS);
    expect(readU16(r, OBJ_OFF + 0x34)).toBe(0xf000);
  });

  it("long copy: *(A0+0x14) → *(A0+0x2A)", () => {
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;
    writeU32(r, OBJ_OFF + 0x14, 0x12345678);
    writeU32(r, OBJ_OFF + 0x2a, 0x00000000); // cella destinazione azzerata

    helper253BC(state, OBJ_ABS);

    expect(readU32(r, OBJ_OFF + 0x2a)).toBe(0x12345678);
  });

  it("long copy: valori di confine 0x00000000 e 0xFFFFFFFF", () => {
    for (const v of [0x00000000, 0xffffffff, 0xdeadbeef]) {
      const state = emptyGameState();
      const r = state.workRam;
      r[OBJ_OFF + 0x36] = 0;
      writeU32(r, OBJ_OFF + 0x14, v);
      helper253BC(state, OBJ_ABS);
      expect(readU32(r, OBJ_OFF + 0x2a)).toBe(v >>> 0);
    }
  });

  it("byte copy: *(A0+0x1B) → *(A0+0x1D)", () => {
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;
    r[OBJ_OFF + 0x1b] = 0x7e;
    r[OBJ_OFF + 0x1d] = 0x00;

    helper253BC(state, OBJ_ABS);

    expect(r[OBJ_OFF + 0x1d]).toBe(0x7e);
  });

  it("byte copy: tutti i valori 0x00 e 0xFF", () => {
    for (const v of [0x00, 0xff, 0x55, 0xaa]) {
      const state = emptyGameState();
      const r = state.workRam;
      r[OBJ_OFF + 0x36] = 0;
      r[OBJ_OFF + 0x1b] = v;
      r[OBJ_OFF + 0x1d] = ~v & 0xff;
      helper253BC(state, OBJ_ABS);
      expect(r[OBJ_OFF + 0x1d]).toBe(v);
    }
  });

  it("tutti e 4 i campi aggiornati in una singola call", () => {
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;

    // longX = 0x01400000 → 0x01400000 >> 19 = 40 (0x28)
    writeU32(r, OBJ_OFF + 0x0c, 0x01400000);
    // longY = 0x00600000 → 0x00600000 >> 19 = 12
    writeU32(r, OBJ_OFF + 0x10, 0x00600000);
    // long14 = 0xabcdef01
    writeU32(r, OBJ_OFF + 0x14, 0xabcdef01);
    // byte1B = 0x33
    r[OBJ_OFF + 0x1b] = 0x33;

    helper253BC(state, OBJ_ABS);

    expect(readU16(r, OBJ_OFF + 0x32)).toBe(40);
    expect(readU16(r, OBJ_OFF + 0x34)).toBe(12);
    expect(readU32(r, OBJ_OFF + 0x2a)).toBe(0xabcdef01);
    expect(r[OBJ_OFF + 0x1d]).toBe(0x33);
  });

  it("non tocca byte al di fuori dei 4 campi attesi", () => {
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;

    // Scrivi 0xCC in tutta la regione dell'oggetto per rilevare write inattese
    for (let i = 0; i < 0x80; i++) r[OBJ_OFF + i] = 0xcc;

    // Imposta i campi necessari per una call normale
    writeU32(r, OBJ_OFF + 0x0c, 0x00100000);
    writeU32(r, OBJ_OFF + 0x10, 0x00080000);
    writeU32(r, OBJ_OFF + 0x14, 0x12345678);
    r[OBJ_OFF + 0x1b] = 0x55;
    r[OBJ_OFF + 0x36] = 0x00; // freeze off

    // Snapshot dei byte che NON devono cambiare
    const unchanged: Record<number, number> = {};
    const changedOffsets = new Set([0x32, 0x33, 0x34, 0x35, 0x2a, 0x2b, 0x2c, 0x2d, 0x1d]);
    for (let i = 0; i < 0x80; i++) {
      if (!changedOffsets.has(i)) unchanged[i] = r[OBJ_OFF + i] ?? 0;
    }

    helper253BC(state, OBJ_ABS);

    for (const [offStr, expected] of Object.entries(unchanged)) {
      const off = Number(offStr);
      expect(r[OBJ_OFF + off]).toBe(expected);
    }
  });

  it("idempotente: doppia call con freeze=0 dà lo stesso risultato", () => {
    const state = emptyGameState();
    const r = state.workRam;
    r[OBJ_OFF + 0x36] = 0;
    writeU32(r, OBJ_OFF + 0x0c, 0x00400000);
    writeU32(r, OBJ_OFF + 0x10, 0x00200000);
    writeU32(r, OBJ_OFF + 0x14, 0xcafebabe);
    r[OBJ_OFF + 0x1b] = 0xf1;

    helper253BC(state, OBJ_ABS);
    const x1 = readU16(r, OBJ_OFF + 0x32);
    const y1 = readU16(r, OBJ_OFF + 0x34);
    const l1 = readU32(r, OBJ_OFF + 0x2a);
    const b1 = r[OBJ_OFF + 0x1d];

    helper253BC(state, OBJ_ABS);
    expect(readU16(r, OBJ_OFF + 0x32)).toBe(x1);
    expect(readU16(r, OBJ_OFF + 0x34)).toBe(y1);
    expect(readU32(r, OBJ_OFF + 0x2a)).toBe(l1);
    expect(r[OBJ_OFF + 0x1d]).toBe(b1);
  });
});
