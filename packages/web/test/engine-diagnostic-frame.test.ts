import { describe, expect, it } from "vitest";
import { buildEngineDiagnosticFrame } from "../src/fixtures/engine-diagnostic-frame.js";

describe("buildEngineDiagnosticFrame", () => {
  it("renders an opt-in engine frame from synthetic RAM", () => {
    const frame = buildEngineDiagnosticFrame(0);

    expect(frame.playfield.length).toBeGreaterThan(100);
    expect(frame.alpha).toHaveLength(3);
    expect(frame.sprites).toHaveLength(3);
    expect(frame.debugLabel).toBe("engine-frame:alpha-bank-0:pf-bank-1:mo-bank-1");
  });

  it("passes optional motion-object lookup metadata to engine sprite commands", () => {
    const frame = buildEngineDiagnosticFrame(0, [
      { offset: 0, bank: 0, color: 0, bpp: 4 },
      { offset: 4, bank: 2, color: 3, bpp: 5 },
    ]);

    expect(frame.sprites[0]).toMatchObject({
      spriteIndex: 0x410,
      gfxBank: 2,
      bitsPerPixel: 5,
      paletteIndex: 0x26, // 0x20 + (3 << 1) — MAME s_mob_config
    });
  });

  it("passes optional playfield lookup metadata to engine tile commands", () => {
    const frame = buildEngineDiagnosticFrame(0, undefined, [
      { offset: 0, bank: 0, color: 0, bpp: 4 },
      { offset: 7, bank: 3, color: 5, bpp: 6 },
    ]);
    const texturedTile = frame.playfield.find((tile) => (tile.gfxBank ?? 0) > 0);

    expect(texturedTile).toMatchObject({
      gfxBank: 3,
      bitsPerPixel: 6,
      paletteIndex: 0x48,
    });
  });
});
