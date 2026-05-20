/**
 * state-sub-1953e.test.ts — smoke tests per `FUN_0001953E`.
 */

import { describe, it, expect } from "vitest";
import {
  stateSub1953E,
  ENTITY_SCRIPT_PTR_OFFSET,
  ENTITY_SUBTYPE_OFFSET,
  SCRIPT_PTR_SUBTYPE_7,
  SCRIPT_PTR_SUBTYPE_8,
  SCRIPT_PTR_SUBTYPE_9,
  STATE_SUB_1953E_ADDR,
} from "../src/state-sub-1953e.js";
import { emptyGameState } from "../src/state.js";

const ENTITY_BASE = 0x00401890;

function readU32BE(bytes: Uint8Array, off: number): number {
  return (
    (((bytes[off] ?? 0) << 24) |
      ((bytes[off + 1] ?? 0) << 16) |
      ((bytes[off + 2] ?? 0) << 8) |
      (bytes[off + 3] ?? 0)) >>>
    0
  );
}

function writeU32BE(bytes: Uint8Array, off: number, value: number): void {
  const v = value >>> 0;
  bytes[off] = (v >>> 24) & 0xff;
  bytes[off + 1] = (v >>> 16) & 0xff;
  bytes[off + 2] = (v >>> 8) & 0xff;
  bytes[off + 3] = v & 0xff;
}

describe("stateSub1953E (FUN_0001953E)", () => {
  it("exports the binary address", () => {
    expect(STATE_SUB_1953E_ADDR).toBe(0x0001953e);
  });

  it.each([
    [0x07, SCRIPT_PTR_SUBTYPE_7],
    [0x08, SCRIPT_PTR_SUBTYPE_8],
    [0x09, SCRIPT_PTR_SUBTYPE_9],
  ])("subtype 0x%s writes the matching script pointer", (subtype, expected) => {
    const state = emptyGameState();
    const off = ENTITY_BASE - 0x400000;
    writeU32BE(state.workRam, off + ENTITY_SCRIPT_PTR_OFFSET, 0xdeadbeef);
    state.workRam[off + ENTITY_SUBTYPE_OFFSET] = subtype;

    const written = stateSub1953E(state, ENTITY_BASE);

    expect(written).toBe(expected);
    expect(readU32BE(state.workRam, off + ENTITY_SCRIPT_PTR_OFFSET)).toBe(expected);
  });

  it("other subtype values leave the script pointer unchanged", () => {
    for (const subtype of [0x00, 0x01, 0x06, 0x0a, 0xff]) {
      const state = emptyGameState();
      const off = ENTITY_BASE - 0x400000;
      writeU32BE(state.workRam, off + ENTITY_SCRIPT_PTR_OFFSET, 0xdeadbeef);
      state.workRam[off + ENTITY_SUBTYPE_OFFSET] = subtype;

      const written = stateSub1953E(state, ENTITY_BASE);

      expect(written).toBeNull();
      expect(readU32BE(state.workRam, off + ENTITY_SCRIPT_PTR_OFFSET)).toBe(0xdeadbeef);
    }
  });
});
