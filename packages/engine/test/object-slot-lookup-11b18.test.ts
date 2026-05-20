import { describe, expect, it } from "vitest";
import {
  objectSlotLookup11B18,
  OBJECT_SLOT_LOOKUP_11B18_ADDR,
} from "../src/object-slot-lookup-11b18.js";
import { emptyGameState } from "../src/state.js";

function writeU32(bytes: Uint8Array, off: number, value: number): void {
  bytes[off] = (value >>> 24) & 0xff;
  bytes[off + 1] = (value >>> 16) & 0xff;
  bytes[off + 2] = (value >>> 8) & 0xff;
  bytes[off + 3] = value & 0xff;
}

describe("objectSlotLookup11B18 (FUN_00011B18)", () => {
  it("returns 0 when rank lookup returns 10", () => {
    const s = emptyGameState();
    writeU32(s.workRam, 0x18 + 0xbc, 0x00123456);

    const ret = objectSlotLookup11B18(s, 0x00400018, {
      rankLookup: (_state, score) => {
        expect(score).toBe(0x00123456);
        return 10;
      },
    });

    expect(ret).toBe(0);
  });

  it("registers the score but returns 0 when the initials flow is not wired", () => {
    const s = emptyGameState();
    writeU32(s.workRam, 0x18 + 0xbc, 0x00123456);
    const registerCalls: Array<[number, number]> = [];
    const afterRegisterCalls: Array<[number, number, number, number]> = [];

    const ret = objectSlotLookup11B18(s, 0x00400018, {
      rankLookup: () => 0,
      registerScore: (_state, rank, recordAddr) => {
        registerCalls.push([rank, recordAddr]);
        return -2;
      },
      afterRegisterScore: (_state, objectAddr, rank, recordAddr, registerResult) => {
        afterRegisterCalls.push([objectAddr, rank, recordAddr, registerResult]);
      },
    });

    expect(ret).toBe(0);
    expect(registerCalls).toEqual([[0, 0x00400018 + 0xbc]]);
    expect(afterRegisterCalls).toEqual([[0x00400018, 0, 0x00400018 + 0xbc, -2]]);
  });

  it("starts the initials entry path and returns 1 when wired", () => {
    const s = emptyGameState();
    writeU32(s.workRam, 0x18 + 0xbc, 0x00123456);
    const calls: Array<[number, number, number]> = [];

    const ret = objectSlotLookup11B18(s, 0x00400018, {
      rankLookup: () => 2,
      startInitialsEntry: (_state, objectAddr, rank, recordAddr) => {
        calls.push([objectAddr, rank, recordAddr]);
        return true;
      },
    });

    expect(ret).toBe(1);
    expect(calls).toEqual([[0x00400018, 2, 0x00400018 + 0xbc]]);
  });

  it("delegates qualifying path and returns 1", () => {
    const s = emptyGameState();
    const calls: Array<[number, number]> = [];
    const ret = objectSlotLookup11B18(s, 0x004000fa, {
      rankLookup: () => 3,
      qualifiedFlow: (_state, objectAddr, rank) => calls.push([objectAddr, rank]),
    });

    expect(ret).toBe(1);
    expect(calls).toEqual([[0x004000fa, 3]]);
  });

  it("exposes the binary entry address", () => {
    expect(OBJECT_SLOT_LOOKUP_11B18_ADDR).toBe(0x11b18);
  });
});
