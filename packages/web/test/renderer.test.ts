import { describe, expect, it } from "vitest";

import { motionObjectScreenPosition, wrappedPlayfieldDrawPositions } from "../src/renderer.js";
import type { render as renderNs } from "@marble-love/engine";

describe("wrappedPlayfieldDrawPositions", () => {
  it("wraps playfield tiles back into view when vertical scroll crosses the tilemap edge", () => {
    expect(
      wrappedPlayfieldDrawPositions(
        { x: 0, y: 0, width: 8, height: 8 },
        { x: 0, y: 346 },
        { width: 336, height: 240 },
      ),
    ).toEqual([{ x: 0, y: 166 }]);
  });

  it("draws both the scrolled body and wrapped tail for high-scroll lower-level frames", () => {
    const noWrapVisible = (tileY: number, scrollY: number): boolean => {
      const y = tileY - scrollY;
      return y < 240 && y + 8 > 0;
    };

    expect(noWrapVisible(504, 346)).toBe(true);
    expect(noWrapVisible(0, 346)).toBe(false);
    expect(
      wrappedPlayfieldDrawPositions(
        { x: 0, y: 504, width: 8, height: 8 },
        { x: 0, y: 346 },
        { width: 336, height: 240 },
      ),
    ).toEqual([{ x: 0, y: 158 }]);
    expect(
      wrappedPlayfieldDrawPositions(
        { x: 0, y: 0, width: 8, height: 8 },
        { x: 0, y: 346 },
        { width: 336, height: 240 },
      ),
    ).toEqual([{ x: 0, y: 166 }]);
  });

  it("keeps partially wrapped edge tiles visible", () => {
    expect(
      wrappedPlayfieldDrawPositions(
        { x: 508, y: 508, width: 8, height: 8 },
        { x: 0, y: 0 },
        { width: 336, height: 240 },
      ),
    ).toEqual([{ x: -4, y: -4 }]);
  });

  it("filters wrapped candidates that are still outside the viewport", () => {
    expect(
      wrappedPlayfieldDrawPositions(
        { x: 400, y: 400, width: 8, height: 8 },
        { x: 0, y: 0 },
        { width: 336, height: 240 },
      ),
    ).toEqual([]);
  });
});

describe("motionObjectScreenPosition", () => {
  const frame = {
    nativeSize: { width: 336, height: 240 },
    scrollX: 0,
    scrollY: 0,
    palette: [],
    playfield: [],
    sprites: [],
    alpha: [],
  } satisfies renderNs.Frame;

  it("wraps MAME 9-bit MO coordinates back into the visible viewport", () => {
    expect(
      motionObjectScreenPosition(
        frame,
        {
          spriteIndex: 1,
          gfxBank: 1,
          bitsPerPixel: 4,
          x: 500,
          y: 240,
          paletteIndex: 0x20,
        },
        16,
      ),
    ).toEqual({ x: -12, y: 0 });
  });

  it("keeps ROM-backed demo coordinates unwrapped", () => {
    expect(
      motionObjectScreenPosition(
        { ...frame, debugLabel: "rom-backed-demo" },
        {
          spriteIndex: 1,
          gfxBank: 1,
          bitsPerPixel: 4,
          x: 500,
          y: 240,
          paletteIndex: 0x20,
        },
        16,
      ),
    ).toEqual({ x: 500, y: 240 });
  });
});
