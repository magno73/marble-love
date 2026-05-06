/**
 * object-type-dispatch-194ba.test.ts — smoke + corner case di FUN_000194BA.
 */

import { describe, it, expect } from "vitest";
import {
  objectTypeDispatch194BA,
  FN_PTR_KIND2_SUB7,
  FN_PTR_KIND2_SUB8,
  FN_PTR_KIND2_DEFAULT,
  FN_PTR_OFFSET,
  KIND_OFFSET,
  SUBTYPE_OFFSET,
} from "../src/object-type-dispatch-194ba.js";
import { emptyGameState } from "../src/state.js";

const OBJ_BASE = 0x401d00;

function readU32BE(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>> 0
  );
}

describe("objectTypeDispatch194BA (FUN_000194BA)", () => {
  it("kind == 0 → invoca fun_1960e poi fun_1953e nell'ordine, NO scrittura a obj+0x1C", () => {
    const s = emptyGameState();
    const objOff = OBJ_BASE - 0x400000;
    s.workRam[objOff + KIND_OFFSET] = 0x00;
    // Pre-scrivi un sentinel a obj+0x1C per verificare che NON viene toccato.
    s.workRam[objOff + FN_PTR_OFFSET] = 0xde;
    s.workRam[objOff + FN_PTR_OFFSET + 1] = 0xad;
    s.workRam[objOff + FN_PTR_OFFSET + 2] = 0xbe;
    s.workRam[objOff + FN_PTR_OFFSET + 3] = 0xef;
    const order: string[] = [];
    const r = objectTypeDispatch194BA(s, OBJ_BASE, {
      fun_1960e: (addr) => {
        order.push("1960E");
        expect(addr).toBe(OBJ_BASE >>> 0);
      },
      fun_1973c: () => {
        order.push("1973C-WRONG");
      },
      fun_1953e: (addr) => {
        order.push("1953E");
        expect(addr).toBe(OBJ_BASE >>> 0);
      },
    });
    expect(r.branch).toBe("case0");
    expect(r.fnPtrWritten).toBeNull();
    expect(order).toEqual(["1960E", "1953E"]);
    // Sentinel intatto.
    expect(readU32BE(s, objOff + FN_PTR_OFFSET)).toBe(0xdeadbeef);
  });

  it("kind == 1 → invoca fun_1973c poi fun_1953e nell'ordine", () => {
    const s = emptyGameState();
    const objOff = OBJ_BASE - 0x400000;
    s.workRam[objOff + KIND_OFFSET] = 0x01;
    const order: string[] = [];
    const r = objectTypeDispatch194BA(s, OBJ_BASE, {
      fun_1960e: () => order.push("1960E-WRONG"),
      fun_1973c: () => order.push("1973C"),
      fun_1953e: () => order.push("1953E"),
    });
    expect(r.branch).toBe("case1");
    expect(r.fnPtrWritten).toBeNull();
    expect(order).toEqual(["1973C", "1953E"]);
  });

  it("kind == 2, sub-type == 7 → scrive 0x21F8A a obj+0x1C (BE)", () => {
    const s = emptyGameState();
    const objOff = OBJ_BASE - 0x400000;
    s.workRam[objOff + KIND_OFFSET] = 0x02;
    s.workRam[objOff + SUBTYPE_OFFSET] = 0x07;
    const r = objectTypeDispatch194BA(s, OBJ_BASE);
    expect(r.branch).toBe("case2");
    expect(r.fnPtrWritten).toBe(FN_PTR_KIND2_SUB7);
    expect(readU32BE(s, objOff + FN_PTR_OFFSET)).toBe(0x00021f8a);
  });

  it("kind == 2, sub-type == 8 → scrive 0x21A62 a obj+0x1C", () => {
    const s = emptyGameState();
    const objOff = OBJ_BASE - 0x400000;
    s.workRam[objOff + KIND_OFFSET] = 0x02;
    s.workRam[objOff + SUBTYPE_OFFSET] = 0x08;
    const r = objectTypeDispatch194BA(s, OBJ_BASE);
    expect(r.branch).toBe("case2");
    expect(r.fnPtrWritten).toBe(FN_PTR_KIND2_SUB8);
    expect(readU32BE(s, objOff + FN_PTR_OFFSET)).toBe(0x00021a62);
  });

  it("kind == 2, sub-type != 7 e != 8 → scrive default 0x21EFE a obj+0x1C", () => {
    const s = emptyGameState();
    const objOff = OBJ_BASE - 0x400000;
    s.workRam[objOff + KIND_OFFSET] = 0x02;
    s.workRam[objOff + SUBTYPE_OFFSET] = 0x42; // né 7 né 8
    const r = objectTypeDispatch194BA(s, OBJ_BASE);
    expect(r.branch).toBe("case2");
    expect(r.fnPtrWritten).toBe(FN_PTR_KIND2_DEFAULT);
    expect(readU32BE(s, objOff + FN_PTR_OFFSET)).toBe(0x00021efe);
  });

  it("kind == 2 con sub-type 0/9/0xFF → tutti default", () => {
    for (const sub of [0x00, 0x09, 0xff]) {
      const s = emptyGameState();
      const objOff = OBJ_BASE - 0x400000;
      s.workRam[objOff + KIND_OFFSET] = 0x02;
      s.workRam[objOff + SUBTYPE_OFFSET] = sub;
      const r = objectTypeDispatch194BA(s, OBJ_BASE);
      expect(r.branch).toBe("case2");
      expect(r.fnPtrWritten).toBe(FN_PTR_KIND2_DEFAULT);
    }
  });

  it("kind negativo (0x80, 0xFF) → branch 'skip', nessuna scrittura, nessuna callback", () => {
    for (const k of [0x80, 0xc0, 0xff]) {
      const s = emptyGameState();
      const objOff = OBJ_BASE - 0x400000;
      s.workRam[objOff + KIND_OFFSET] = k;
      // sentinel
      s.workRam[objOff + FN_PTR_OFFSET] = 0x11;
      s.workRam[objOff + FN_PTR_OFFSET + 3] = 0x44;
      let calls = 0;
      const r = objectTypeDispatch194BA(s, OBJ_BASE, {
        fun_1960e: () => calls++,
        fun_1973c: () => calls++,
        fun_1953e: () => calls++,
      });
      expect(r.branch).toBe("skip");
      expect(r.fnPtrWritten).toBeNull();
      expect(calls).toBe(0);
      expect(s.workRam[objOff + FN_PTR_OFFSET]).toBe(0x11);
      expect(s.workRam[objOff + FN_PTR_OFFSET + 3]).toBe(0x44);
    }
  });

  it("kind >= 3 (3, 4, 0x7F) → branch 'skip'", () => {
    for (const k of [0x03, 0x04, 0x7f]) {
      const s = emptyGameState();
      const objOff = OBJ_BASE - 0x400000;
      s.workRam[objOff + KIND_OFFSET] = k;
      let calls = 0;
      const r = objectTypeDispatch194BA(s, OBJ_BASE, {
        fun_1960e: () => calls++,
        fun_1973c: () => calls++,
        fun_1953e: () => calls++,
      });
      expect(r.branch).toBe("skip");
      expect(calls).toBe(0);
    }
  });

  it("subs assente → case 0/1 sono no-op silenzioso (no crash)", () => {
    const s = emptyGameState();
    const objOff = OBJ_BASE - 0x400000;
    s.workRam[objOff + KIND_OFFSET] = 0x00;
    expect(() => objectTypeDispatch194BA(s, OBJ_BASE)).not.toThrow();
    s.workRam[objOff + KIND_OFFSET] = 0x01;
    expect(() => objectTypeDispatch194BA(s, OBJ_BASE)).not.toThrow();
  });

  it("case 2 scrittura strict big-endian (verifica byte-by-byte)", () => {
    const s = emptyGameState();
    const objOff = OBJ_BASE - 0x400000;
    s.workRam[objOff + KIND_OFFSET] = 0x02;
    s.workRam[objOff + SUBTYPE_OFFSET] = 0x07;
    objectTypeDispatch194BA(s, OBJ_BASE);
    // 0x00021F8A → BE: 00 02 1F 8A
    expect(s.workRam[objOff + FN_PTR_OFFSET + 0]).toBe(0x00);
    expect(s.workRam[objOff + FN_PTR_OFFSET + 1]).toBe(0x02);
    expect(s.workRam[objOff + FN_PTR_OFFSET + 2]).toBe(0x1f);
    expect(s.workRam[objOff + FN_PTR_OFFSET + 3]).toBe(0x8a);
  });
});
