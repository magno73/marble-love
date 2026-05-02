import { describe, it, expect } from "vitest";
import { emptyGameState, snapshotGameState } from "../src/state.js";
import { as_u32 } from "../src/wrap.js";

describe("GameState basics", () => {
  it("emptyGameState ha sizing RAM atteso", () => {
    const s = emptyGameState();
    expect(s.workRam.byteLength).toBe(0x4000);
    expect(s.spriteRam.byteLength).toBe(0x800);
    expect(s.colorRam.byteLength).toBe(0x800);
  });

  it("snapshot è deep-copy", () => {
    const a = emptyGameState();
    a.marble.pos.x = as_u32(0x1234);
    a.workRam[0] = 0xab;
    const b = snapshotGameState(a);
    a.marble.pos.x = as_u32(0xdead);
    a.workRam[0] = 0;
    expect(b.marble.pos.x as unknown as number).toBe(0x1234);
    expect(b.workRam[0]).toBe(0xab);
  });
});
