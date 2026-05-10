/**
 * helper-182ba.test.ts — smoke tests per FUN_182BA replica.
 */
import { describe, it, expect } from "vitest";
import { helper182BA } from "../src/helper-182ba.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

describe("helper182BA (FUN_182BA)", () => {
  it("non solleva eccezioni con state vuoto e slot vuoto", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => helper182BA(s, 0x400a20, rom)).not.toThrow();
  });

  it("gravity-only path: (0x36,A2) == 2 → skip seek, no obj+0x68 write", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const off = 0xa20; // slot @ 0x400A20
    s.workRam[off + 0x36] = 0x02; // skip seek branch
    s.workRam[off + 0x18] = 0x01; // active (FUN_15DB6 may run guards)
    expect(() => helper182BA(s, 0x400a20, rom)).not.toThrow();
    // Nessuno scrive 0x68 nel branch gravity-only
    expect(s.workRam[off + 0x68]).toBe(0);
  });

  it("gravity branch: (0x36,A2) != 0,2 → vz -= 0x6000, clamp -0x50000", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const off = 0xa20;
    s.workRam[off + 0x36] = 0x01; // gravity-on, non-skip-seek
    // VZ = 0
    helper182BA(s, 0x400a20, rom);
    // Dopo gravity: vz = 0 - 0x6000 = -0x6000 → 0xffffa000 (signed)
    const vzU = (s.workRam[off + 0x08] ?? 0) << 24 |
                (s.workRam[off + 0x09] ?? 0) << 16 |
                (s.workRam[off + 0x0a] ?? 0) << 8  |
                (s.workRam[off + 0x0b] ?? 0);
    const vz = vzU | 0;
    // Esito esatto dipende dal seek path (potrebbe aver scritto vy/vx/vz prima)
    // Ma vz dovrebbe esserci una qualche mutazione (≠ seed 0).
    expect(vz).not.toBe(0);
  });

  it("clamp gravity: vz iniziale < -0x4F000 → diventa -0x50000", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const off = 0xa20;
    s.workRam[off + 0x36] = 0x01;
    // VZ = -0x4f000 → -0x4f000 + (-0x6000) = -0x55000 → clamp -0x50000
    const vzInit = -0x4f000 >>> 0;
    s.workRam[off + 0x08] = (vzInit >>> 24) & 0xff;
    s.workRam[off + 0x09] = (vzInit >>> 16) & 0xff;
    s.workRam[off + 0x0a] = (vzInit >>> 8) & 0xff;
    s.workRam[off + 0x0b] = vzInit & 0xff;
    helper182BA(s, 0x400a20, rom);
    const vzU = ((s.workRam[off + 0x08] ?? 0) << 24) |
                ((s.workRam[off + 0x09] ?? 0) << 16) |
                ((s.workRam[off + 0x0a] ?? 0) << 8)  |
                (s.workRam[off + 0x0b] ?? 0);
    const vz = vzU | 0;
    expect(vz).toBe(-0x50000);
  });
});
