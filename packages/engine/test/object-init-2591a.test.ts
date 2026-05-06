/**
 * Test objectInit2591A (FUN_0002591A) — smoke tests sull'orchestratore
 * di inizializzazione oggetto + scritture dirette.
 *
 * `FUN_0002591A` (154 byte) scrive 12 campi della struct A2 + 2 globals
 * @ 0x400696/0x400698, e orchestra 6 sub-jsr (default no-op qui).
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-object-init-2591a-parity.ts` (500/500 cases).
 */

import { describe, it, expect } from "vitest";
import {
  objectInit2591A,
  OBJECT_INIT_2591A_ADDR,
  OBJECT_INIT_2591A_FIELDS,
  OBJECT_INIT_2591A_SUB_ADDRS,
  type ObjectInit2591ASubs,
} from "../src/object-init-2591a.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;

/** Scrive long big-endian in workRam. */
function writeU32BE(wr: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  wr[off + 0] = (u >>> 24) & 0xff;
  wr[off + 1] = (u >>> 16) & 0xff;
  wr[off + 2] = (u >>> 8) & 0xff;
  wr[off + 3] = u & 0xff;
}

/** Legge long big-endian da workRam. */
function readU32BE(wr: Uint8Array, off: number): number {
  return (
    (((wr[off] ?? 0) << 24) |
      ((wr[off + 1] ?? 0) << 16) |
      ((wr[off + 2] ?? 0) << 8) |
      (wr[off + 3] ?? 0)) >>>
    0
  );
}

/** Legge word big-endian da workRam. */
function readU16BE(wr: Uint8Array, off: number): number {
  return (((wr[off] ?? 0) << 8) | (wr[off + 1] ?? 0)) & 0xffff;
}

describe("objectInit2591A (FUN_0002591A)", () => {
  it("scrive i 12 campi diretti su A2 + i 2 globals (default subs no-op)", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1000;
    const objOff = objPtr - WORK_RAM_BASE;

    // Pre-fill globals @ 0x400462, 0x400466 (long), 0x400472 (byte) con valori
    // distintivi per verificare le letture.
    writeU32BE(s.workRam, 0x462, 0xaabbccdd);
    writeU32BE(s.workRam, 0x466, 0x11223344);
    s.workRam[0x472] = 0x77;

    // Pre-fill obj con sentinel non-zero per verificare clear.
    for (let k = 0; k < 0x60; k++) s.workRam[objOff + k] = 0x55;

    objectInit2591A(s, objPtr);

    // 3 long ← 0
    expect(readU32BE(s.workRam, objOff + 0x00)).toBe(0);
    expect(readU32BE(s.workRam, objOff + 0x04)).toBe(0);
    expect(readU32BE(s.workRam, objOff + 0x08)).toBe(0);
    // A2[+0xC] = (*0x400462) << 16 = 0xCCDD0000
    expect(readU32BE(s.workRam, objOff + 0x0c)).toBe(0xccdd0000 >>> 0);
    // A2[+0x10] = (*0x400466) << 16 = 0x33440000
    expect(readU32BE(s.workRam, objOff + 0x10)).toBe(0x33440000);
    // A2[+0x14] = FUN_1CC62(0) ret = 0 (default stub)
    expect(readU32BE(s.workRam, objOff + 0x14)).toBe(0);
    // A2[+0x1B] = byte (*0x400472) = 0x77
    expect(s.workRam[objOff + 0x1b]).toBe(0x77);
    // A2[+0x22], +0x26 ← 0 long
    expect(readU32BE(s.workRam, objOff + 0x22)).toBe(0);
    expect(readU32BE(s.workRam, objOff + 0x26)).toBe(0);
    // bytes @ +0x36, +0x56, +0x58 ← 0
    expect(s.workRam[objOff + 0x36]).toBe(0);
    expect(s.workRam[objOff + 0x56]).toBe(0);
    expect(s.workRam[objOff + 0x58]).toBe(0);

    // Globals @ 0x400696 / 0x400698 ← 0xFFFF
    expect(readU16BE(s.workRam, 0x696)).toBe(0xffff);
    expect(readU16BE(s.workRam, 0x698)).toBe(0xffff);
  });

  it("chiama tutte e 6 le subs nell'ordine binary, con args corretti", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1100;
    const calls: Array<{ name: string; args: readonly number[] }> = [];

    const subs: ObjectInit2591ASubs = {
      fun_262B2: (_, p) => calls.push({ name: "fun_262B2", args: [p] }),
      fun_1BAB2: (_, p) => calls.push({ name: "fun_1BAB2", args: [p] }),
      fun_1CC62: (_, z) => {
        calls.push({ name: "fun_1CC62", args: [z] });
        return 0xdeadbeef;
      },
      fun_25B40: (_, p) => calls.push({ name: "fun_25B40", args: [p] }),
      fun_1B9CC: (_, p, f) =>
        calls.push({ name: "fun_1B9CC", args: [p, f] }),
      fun_13966: (_, p) => calls.push({ name: "fun_13966", args: [p] }),
    };

    objectInit2591A(s, objPtr, subs);

    expect(calls.map((c) => c.name)).toEqual([
      "fun_262B2",
      "fun_1BAB2",
      "fun_1CC62",
      "fun_25B40",
      "fun_1B9CC",
      "fun_13966",
    ]);
    // objPtr propagato a tutte le sub che lo richiedono
    expect(calls[0]!.args).toEqual([objPtr]);
    expect(calls[1]!.args).toEqual([objPtr]);
    expect(calls[2]!.args).toEqual([0]); // arg long zero
    expect(calls[3]!.args).toEqual([objPtr]);
    expect(calls[4]!.args).toEqual([objPtr, 0]);
    expect(calls[5]!.args).toEqual([objPtr]);

    // FUN_1CC62 ret è scritto in A2[+0x14]
    const objOff = objPtr - WORK_RAM_BASE;
    expect(readU32BE(s.workRam, objOff + 0x14)).toBe(0xdeadbeef);
  });

  it("default subs={}: non solleva, scritture dirette comunque applicate", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1200;
    expect(() => objectInit2591A(s, objPtr)).not.toThrow();
    expect(() => objectInit2591A(s, objPtr, {})).not.toThrow();
    // Globals comunque scritti
    expect(readU16BE(s.workRam, 0x696)).toBe(0xffff);
    expect(readU16BE(s.workRam, 0x698)).toBe(0xffff);
  });

  it("non muta byte vicini ai campi scritti (0x19, 0x1A, 0x1C, 0x35, 0x37, 0x55, 0x57, 0x59)", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1300;
    const objOff = objPtr - WORK_RAM_BASE;

    // Sentinel sui vicini (offset NON toccati dai writes diretti).
    //
    // Mappa scritture: +0x00..03, +0x04..07, +0x08..0B, +0x0C..0F, +0x10..13,
    //   +0x14..17 (long), +0x1B (byte), +0x22..25, +0x26..29 (long),
    //   +0x36, +0x56, +0x58 (byte).
    // Liberi adiacenti: +0x18, +0x19, +0x1A, +0x1C, +0x1D, +0x21, +0x2A,
    //   +0x35, +0x37, +0x55, +0x57, +0x59.
    const neighbors: Record<number, number> = {
      0x18: 0xa0,
      0x19: 0xa1,
      0x1a: 0xa2,
      0x1c: 0xa3,
      0x1d: 0xae,
      0x21: 0xa9,
      0x2a: 0xaa,
      0x35: 0xa4,
      0x37: 0xa5,
      0x55: 0xa6,
      0x57: 0xa7,
      0x59: 0xa8,
    };
    for (const [off, v] of Object.entries(neighbors)) {
      s.workRam[objOff + Number(off)] = v;
    }

    objectInit2591A(s, objPtr);

    for (const [off, v] of Object.entries(neighbors)) {
      expect(s.workRam[objOff + Number(off)]).toBe(v);
    }
  });

  it("propaga il GameState alle callback con stato osservabile", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1400;

    // Pre-imposta global che FUN_2591A scrive PRIMA di FUN_1BAB2
    // (sentinel 0xFFFF @ 0x400696/0x400698) — la callback FUN_1BAB2 li deve
    // vedere = 0xFFFF.
    let observedTileX = -1;
    let observedTileY = -1;
    objectInit2591A(s, objPtr, {
      fun_1BAB2: (st) => {
        observedTileX = readU16BE(st.workRam, 0x696);
        observedTileY = readU16BE(st.workRam, 0x698);
      },
    });
    expect(observedTileX).toBe(0xffff);
    expect(observedTileY).toBe(0xffff);
  });

  it("costanti exposed: indirizzi binary corretti", () => {
    expect(OBJECT_INIT_2591A_ADDR).toBe(0x2591a);
    expect(OBJECT_INIT_2591A_SUB_ADDRS).toEqual([
      0x262b2, 0x1bab2, 0x1cc62, 0x25b40, 0x1b9cc, 0x13966,
    ]);
    expect(OBJECT_INIT_2591A_SUB_ADDRS).toHaveLength(6);
    expect(OBJECT_INIT_2591A_FIELDS.shiftXAt0C).toBe(0x0c);
    expect(OBJECT_INIT_2591A_FIELDS.shiftYAt10).toBe(0x10);
    expect(OBJECT_INIT_2591A_FIELDS.fun1CC62RetAt14).toBe(0x14);
    expect(OBJECT_INIT_2591A_FIELDS.byteFrom472At1B).toBe(0x1b);
  });
});
