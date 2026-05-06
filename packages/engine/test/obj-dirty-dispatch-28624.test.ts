/**
 * Test objDirtyDispatch28624 (FUN_00028624) — smoke tests sui rami principali.
 *
 * `FUN_00028624` (140 byte) è un dispatcher: itera N obj struct, per ogni
 * indice testa il bit corrispondente di una bitmap dirty, e invoca un
 * render-string helper con 6 long arg derivati. Bit-perfect verificato vs
 * binary tramite `cli/src/test-obj-dirty-dispatch-28624-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  objDirtyDispatch28624,
  OBJECTS_BASE_OFF,
  OBJECT_STRIDE,
  OBJECT_COUNT_OFF,
  DIRTY_BITMAP_OFF,
  OBJ_ARG1_OFF,
  FUN_28624_ADDR,
  type ObjDirtyDispatch28624Subs,
} from "../src/obj-dirty-dispatch-28624.js";
import { emptyGameState } from "../src/state.js";

/** Helper: scrive un word big-endian in workRam @ off. */
function writeWordBE(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 8) & 0xff;
  ram[off + 1] = value & 0xff;
}

/** Helper: scrive un long big-endian in workRam @ off. */
function writeLongBE(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 24) & 0xff;
  ram[off + 1] = (value >>> 16) & 0xff;
  ram[off + 2] = (value >>> 8) & 0xff;
  ram[off + 3] = value & 0xff;
}

/** Bag che traccia ogni invocazione del render-string helper. */
interface CallRecord {
  arg1: number;
  arg2: number;
  arg3: number;
  arg4: number;
  arg5: number;
  arg6: number;
}

function makeTrackedSubs(): {
  calls: CallRecord[];
  subs: ObjDirtyDispatch28624Subs;
} {
  const calls: CallRecord[] = [];
  return {
    calls,
    subs: {
      renderStringHelper: (_s, a1, a2, a3, a4, a5, a6) => {
        calls.push({ arg1: a1, arg2: a2, arg3: a3, arg4: a4, arg5: a5, arg6: a6 });
      },
    },
  };
}

describe("objDirtyDispatch28624 (FUN_00028624)", () => {
  it("count=0: nessuna invocazione, ma la bitmap viene comunque azzerata", () => {
    const s = emptyGameState();
    s.workRam[DIRTY_BITMAP_OFF] = 0xff; // tutti i bit set
    writeWordBE(s.workRam, OBJECT_COUNT_OFF, 0); // count = 0

    const { calls, subs } = makeTrackedSubs();
    objDirtyDispatch28624(s, new Uint8Array(8), subs);

    expect(calls).toHaveLength(0);
    expect(s.workRam[DIRTY_BITMAP_OFF]).toBe(0);
  });

  it("bitmap=0: nessuna invocazione, bitmap già 0 resta 0", () => {
    const s = emptyGameState();
    s.workRam[DIRTY_BITMAP_OFF] = 0;
    writeWordBE(s.workRam, OBJECT_COUNT_OFF, 5);

    const { calls, subs } = makeTrackedSubs();
    objDirtyDispatch28624(s, new Uint8Array(8), subs);

    expect(calls).toHaveLength(0);
    expect(s.workRam[DIRTY_BITMAP_OFF]).toBe(0);
  });

  it("bitmap=0xFF count=4: chiama 4 volte (D2=0..3), arg6=0x2000 per D2=0, 0x2400 altrimenti", () => {
    const s = emptyGameState();
    s.workRam[DIRTY_BITMAP_OFF] = 0xff;
    writeWordBE(s.workRam, OBJECT_COUNT_OFF, 4);

    // Setup obj+0xBC long con un valore unico per ogni slot, così la
    // sequenza arg1 distingue le iterazioni.
    for (let i = 0; i < 4; i++) {
      const objOff = OBJECTS_BASE_OFF + i * OBJECT_STRIDE;
      writeLongBE(s.workRam, objOff + OBJ_ARG1_OFF, 0xcafe0000 | i);
    }

    // ROM table 0x23D3A: usiamo i primi 4 byte reali del ROM.
    const romTab = Uint8Array.from([0x03, 0x20, 0x13, 0x0d]);

    const { calls, subs } = makeTrackedSubs();
    objDirtyDispatch28624(s, romTab, subs);

    expect(calls).toHaveLength(4);
    // Ordine D2=0..3
    expect(calls[0]).toEqual({
      arg1: 0xcafe0000,
      arg2: 2,
      arg3: 0x03,
      arg4: 2,
      arg5: 7,
      arg6: 0x2000,
    });
    expect(calls[1]).toEqual({
      arg1: 0xcafe0001,
      arg2: 2,
      arg3: 0x20,
      arg4: 2,
      arg5: 7,
      arg6: 0x2400,
    });
    expect(calls[2]).toEqual({
      arg1: 0xcafe0002,
      arg2: 2,
      arg3: 0x13,
      arg4: 2,
      arg5: 7,
      arg6: 0x2400,
    });
    expect(calls[3]).toEqual({
      arg1: 0xcafe0003,
      arg2: 2,
      arg3: 0x0d,
      arg4: 2,
      arg5: 7,
      arg6: 0x2400,
    });
    expect(s.workRam[DIRTY_BITMAP_OFF]).toBe(0);
  });

  it("bitmap selettiva (0b00001010): chiama solo D2=1 e D2=3", () => {
    const s = emptyGameState();
    s.workRam[DIRTY_BITMAP_OFF] = 0b00001010; // bit 1 e bit 3
    writeWordBE(s.workRam, OBJECT_COUNT_OFF, 5);

    for (let i = 0; i < 5; i++) {
      const objOff = OBJECTS_BASE_OFF + i * OBJECT_STRIDE;
      writeLongBE(s.workRam, objOff + OBJ_ARG1_OFF, 0xdead0000 | i);
    }
    const romTab = Uint8Array.from([0xa1, 0xa2, 0xa3, 0xa4, 0xa5]);

    const { calls, subs } = makeTrackedSubs();
    objDirtyDispatch28624(s, romTab, subs);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.arg1).toBe(0xdead0001);
    // arg3 di D2=1: byte 0xa2 sext_l → 0xffffffa2 (signed) ma nel nostro
    // wrap usiamo signed JS number → -94. Il binario passa long signed,
    // FUN_28E3C legge solo low word con move.w che fa truncation.
    // Il sign-extend a long lo replichiamo per fedeltà al binario.
    expect(calls[0]?.arg3).toBe(0xa2 | 0xffffff00 | 0); // = -94 in JS signed
    expect(calls[0]?.arg6).toBe(0x2400); // D2=1
    expect(calls[1]?.arg1).toBe(0xdead0003);
    expect(calls[1]?.arg3).toBe(0xa4 | 0xffffff00 | 0);
    expect(calls[1]?.arg6).toBe(0x2400);
    expect(s.workRam[DIRTY_BITMAP_OFF]).toBe(0);
  });

  it("bit oltre count: ignorati. Bitmap=0xFF, count=2 → solo 2 chiamate", () => {
    const s = emptyGameState();
    s.workRam[DIRTY_BITMAP_OFF] = 0xff;
    writeWordBE(s.workRam, OBJECT_COUNT_OFF, 2);

    for (let i = 0; i < 2; i++) {
      const objOff = OBJECTS_BASE_OFF + i * OBJECT_STRIDE;
      writeLongBE(s.workRam, objOff + OBJ_ARG1_OFF, 0xb0b00000 | i);
    }
    const romTab = Uint8Array.from([0x03, 0x20]);

    const { calls, subs } = makeTrackedSubs();
    objDirtyDispatch28624(s, romTab, subs);

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.arg1)).toEqual([0xb0b00000, 0xb0b00001]);
    expect(s.workRam[DIRTY_BITMAP_OFF]).toBe(0);
  });

  it("default no-op: non solleva su subs={}, ma azzera comunque la bitmap", () => {
    const s = emptyGameState();
    s.workRam[DIRTY_BITMAP_OFF] = 0xff;
    writeWordBE(s.workRam, OBJECT_COUNT_OFF, 3);
    const romTab = Uint8Array.from([0x03, 0x20, 0x13]);

    expect(() => objDirtyDispatch28624(s, romTab)).not.toThrow();
    expect(() => objDirtyDispatch28624(s, romTab, {})).not.toThrow();
    expect(s.workRam[DIRTY_BITMAP_OFF]).toBe(0);
  });

  it("non muta workRam fuori dalla bitmap byte (verifica side effect localizzato)", () => {
    const s = emptyGameState();
    // pollute random
    for (let i = 0; i < s.workRam.length; i++) s.workRam[i] = i & 0xff;
    // Imposta count e bitmap e arg1 dei primi 3 obj
    writeWordBE(s.workRam, OBJECT_COUNT_OFF, 3);
    s.workRam[DIRTY_BITMAP_OFF] = 0b00000101; // D2=0, D2=2
    for (let i = 0; i < 3; i++) {
      const objOff = OBJECTS_BASE_OFF + i * OBJECT_STRIDE;
      writeLongBE(s.workRam, objOff + OBJ_ARG1_OFF, 0xfeed0000 | i);
    }
    const before = new Uint8Array(s.workRam);

    objDirtyDispatch28624(s, Uint8Array.from([1, 2, 3]));

    // Solo workRam[0x39C] deve essere cambiato (era 0b101=5, ora 0).
    for (let i = 0; i < s.workRam.length; i++) {
      if (i === DIRTY_BITMAP_OFF) {
        expect(s.workRam[i]).toBe(0);
      } else {
        expect(s.workRam[i]).toBe(before[i]);
      }
    }
  });

  it("costanti exposed: indirizzi binary corretti", () => {
    expect(FUN_28624_ADDR).toBe(0x28624);
    expect(OBJECTS_BASE_OFF).toBe(0x18);
    expect(OBJECT_STRIDE).toBe(0xe2);
    expect(OBJECT_COUNT_OFF).toBe(0x396);
    expect(DIRTY_BITMAP_OFF).toBe(0x39c);
    expect(OBJ_ARG1_OFF).toBe(0xbc);
  });
});
