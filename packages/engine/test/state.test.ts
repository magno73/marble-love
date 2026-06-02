import { describe, it, expect } from "vitest";
import { emptyGameState, snapshotGameState } from "../src/state.js";
import { as_u32 } from "../src/wrap.js";

describe("GameState basics", () => {
  it("emptyGameState has the expected RAM sizing (verified in Phase 1)", () => {
    const s = emptyGameState();
    expect(s.workRam.byteLength).toBe(0x2000);     // 8 KB work RAM
    expect(s.playfieldRam.byteLength).toBe(0x2000); // 8 KB playfield tilemap
    expect(s.spriteRam.byteLength).toBe(0x1000);   // 4 KB motion-object RAM
    expect(s.alphaRam.byteLength).toBe(0x1000);    // 4 KB alpha/HUD RAM
    expect(s.colorRam.byteLength).toBe(0x800);     // 2 KB palette RAM
  });

  it("snapshot is deep-copy (including playfieldRam)", () => {
    const a = emptyGameState();
    a.marble.pos.x = as_u32(0x1234);
    a.workRam[0] = 0xab;
    a.playfieldRam[0x100] = 0xCD;
    const b = snapshotGameState(a);
    a.marble.pos.x = as_u32(0xdead);
    a.workRam[0] = 0;
    a.playfieldRam[0x100] = 0;
    expect(b.marble.pos.x as unknown as number).toBe(0x1234);
    expect(b.workRam[0]).toBe(0xab);
    expect(b.playfieldRam[0x100]).toBe(0xCD);
  });
});
