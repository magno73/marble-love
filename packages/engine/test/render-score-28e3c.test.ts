import { describe, expect, it } from "vitest";
import { RENDER_SCORE_28E3C_ADDR, renderScore28E3C } from "../src/render-score-28e3c.js";
import { emptyGameState } from "../src/state.js";

function wl(bytes: Uint8Array, off: number, value: number): void {
  const v = value >>> 0;
  bytes[off] = (v >>> 24) & 0xff;
  bytes[off + 1] = (v >>> 16) & 0xff;
  bytes[off + 2] = (v >>> 8) & 0xff;
  bytes[off + 3] = v & 0xff;
}

describe("renderScore28E3C (FUN_00028E3C)", () => {
  it("calls formatter and render entry with binary argument mapping", () => {
    const s = emptyGameState();
    wl(s.workRam, 0x41e, 0x00401000);
    const calls: string[] = [];
    renderScore28E3C(s, 0x12345678, 0x0002, 0x00aa, 0x00bb, 0x0007, 0x3400, {
      numberFormatter: (_st, value, bufEnd, fmt, width, fill) => {
        calls.push(`fmt:${value.toString(16)}:${bufEnd.toString(16)}:${fmt}:${width}:${fill}`);
      },
      trimTrailingSpace: (_st, str, max) => calls.push(`trim:${str.toString(16)}:${max}`),
      renderStringEntry28F62: (_st, col, tick, attr) => calls.push(`render:${col}:${tick}:${attr}`),
    });
    expect(calls).toEqual([
      "fmt:12345678:401000:100:2:7",
      "trim:401000:7",
      "render:170:187:13312",
    ]);
  });

  it("skips trim when selector word is not 2 and defaults to 28F62 entry writes", () => {
    const s = emptyGameState();
    wl(s.workRam, 0x41e, 0x00401000);
    let trims = 0;
    renderScore28E3C(s, 1, 0, 0x0d, 0x05, 7, 0x1000, {
      trimTrailingSpace: () => {
        trims++;
      },
    });
    expect(trims).toBe(0);
    expect(s.workRam[0x41c]).toBe(0x0d);
    expect(s.workRam[0x41d]).toBe(0x05);
    expect(s.workRam[0x422]).toBe(0);
  });

  it("exposes the binary entry address", () => {
    expect(RENDER_SCORE_28E3C_ADDR).toBe(0x28e3c);
  });
});
