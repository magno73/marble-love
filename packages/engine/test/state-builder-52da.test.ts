import { describe, expect, it } from "vitest";
import {
  STATE_BUILDER_INDEX_ADDR,
  STATE_BUILDER_SECOND_ADDR,
  stateBuilder52DA,
} from "../src/state-builder-52da.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x00400000;
const INDEX_OFF = STATE_BUILDER_INDEX_ADDR - WORK_RAM_BASE;
const SECOND_OFF = STATE_BUILDER_SECOND_ADDR - WORK_RAM_BASE;

describe("stateBuilder52DA (FUN_52DA)", () => {
  it("stores b2, finds first zero table byte, then stores found index plus b1", () => {
    const s = emptyGameState();
    const table = new Map<number, number>([
      [0x7000, 0x11],
      [0x7001, 0x22],
      [0x7002, 0x00],
    ]);

    const ret = stateBuilder52DA(s, 3, 0x1b, 0x7000, {
      readByte: (addr) => table.get(addr) ?? 0,
    });

    expect(s.workRam[SECOND_OFF]).toBe(0x1b);
    expect(s.workRam[INDEX_OFF]).toBe(5);
    expect(ret).toBe(0x03);
  });

  it("uses only the low byte of the first two long args", () => {
    const s = emptyGameState();

    stateBuilder52DA(s, 0x12345687, 0xabcdef9a, 0x8000);

    expect(s.workRam[SECOND_OFF]).toBe(0x9a);
    expect(s.workRam[INDEX_OFF]).toBe(0x87);
  });

  it("sign-extends the scanning index after it wraps past 0x7f", () => {
    const s = emptyGameState();
    const seen: number[] = [];

    stateBuilder52DA(s, 1, 2, 0x9000, {
      readByte: (addr) => {
        seen.push(addr >>> 0);
        return seen.length === 130 ? 0 : 1;
      },
      maxScanSteps: 200,
    });

    expect(seen[0]).toBe(0x9000);
    expect(seen[128]).toBe(0x8f80);
    expect(seen[129]).toBe(0x8f81);
    expect(s.workRam[INDEX_OFF]).toBe(0x82);
  });

  it("passes the initialized descriptor bytes and zero arg to the injected FUN_2572", () => {
    const s = emptyGameState();
    let captured: { descriptor: number[]; zeroArg: number; d0In: number } | null = null;

    const ret = stateBuilder52DA(s, 0xaa, 0xbb, 0x12345678, {
      renderStringChain: ({ descriptor, zeroArg, d0In }) => {
        captured = { descriptor: [...descriptor], zeroArg, d0In };
        return 0xcafebabe;
      },
    });

    expect(ret).toBe(0xcafebabe >>> 0);
    expect(captured).toEqual({
      descriptor: [0xaa, 0xbb, 0x12, 0x34, 0x56, 0x78, 0, 0, 0, 0, 0, 0],
      zeroArg: 0,
      d0In: 0xaa,
    });
  });

  it("default FUN_2572 no-op preserves D0 with high bits from signed found index", () => {
    const s = emptyGameState();
    let reads = 0;

    const ret = stateBuilder52DA(s, 0x44, 0, 0xa000, {
      readByte: () => (++reads === 129 ? 0 : 1),
      maxScanSteps: 200,
    });

    expect(ret).toBe(0xffffff44 >>> 0);
    expect(s.workRam[INDEX_OFF]).toBe(0xc4);
  });
});
