/**
 * render-glyph-loop-1e64.test.ts — smoke + corner case di FUN_1E64.
 */

import { describe, it, expect } from "vitest";
import {
  renderGlyphLoop1E64,
  NARROW_LO_INCL,
  NARROW_HI_INCL,
  NARROW_STEP,
  WIDE_STEP,
  RENDER_GLYPH_FN_ADDR,
  type RenderGlyphCall,
} from "../src/render-glyph-loop-1e64.js";

describe("renderGlyphLoop1E64 (FUN_1E64)", () => {
  it("count <= 0 → no-op (zero iterazioni, no callback)", () => {
    const calls: RenderGlyphCall[] = [];
    const r0 = renderGlyphLoop1E64(0x00a03000, 0x41, 0, {
      renderGlyph: (c) => calls.push(c),
    });
    expect(r0.iterations).toBe(0);
    expect(r0.endBufPtr).toBe(0x00a03000);
    expect(r0.endCharCode).toBe(0x41);
    expect(calls).toHaveLength(0);

    // Negativo (signed): count = 0x8000 = -32768 i16 → exit immediato.
    const calls2: RenderGlyphCall[] = [];
    const r1 = renderGlyphLoop1E64(0x00a03000, 0x41, 0x8000, {
      renderGlyph: (c) => calls2.push(c),
    });
    expect(r1.iterations).toBe(0);
    expect(calls2).toHaveLength(0);

    // Negativo small: count = 0xFFFF = -1 → exit.
    const r2 = renderGlyphLoop1E64(0x00a03000, 0x41, 0xffff, {});
    expect(r2.iterations).toBe(0);
  });

  it("tutti wide: 'ABC' (0x41, 0x42, 0x43) → 3 iter, +12 byte, charCode=0x44", () => {
    const calls: RenderGlyphCall[] = [];
    const r = renderGlyphLoop1E64(0x00a03000, 0x41, 3, {
      renderGlyph: (c) => calls.push(c),
    });
    expect(r.iterations).toBe(3);
    expect(r.endCharCode).toBe(0x44);
    // Wide step = 4, 3 volte → 0x00A0300C
    expect(r.endBufPtr).toBe(0x00a0300c);
    expect(calls).toEqual([
      { bufPtr: 0x00a03000, charCode: 0x41, mask: 0 },
      { bufPtr: 0x00a03004, charCode: 0x42, mask: 0 },
      { bufPtr: 0x00a03008, charCode: 0x43, mask: 0 },
    ]);
  });

  it("tutti narrow: code-point 0x26..0x2D (8 char, range esatto)", () => {
    const calls: RenderGlyphCall[] = [];
    const r = renderGlyphLoop1E64(0x00a03100, 0x26, 8, {
      renderGlyph: (c) => calls.push(c),
    });
    expect(r.iterations).toBe(8);
    expect(r.endCharCode).toBe(0x2e);
    // 8 narrow × 2 = 16 byte → 0x00A03110
    expect(r.endBufPtr).toBe(0x00a03110);
    expect(calls).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(calls[i]!.bufPtr).toBe(0x00a03100 + i * 2);
      expect(calls[i]!.charCode).toBe(0x26 + i);
      expect(calls[i]!.mask).toBe(0);
    }
  });

  it("boundary: charCode=0x25 (wide), 0x26 (narrow), 0x2D (narrow), 0x2E (wide)", () => {
    // start=0x25, count=4 → sequenza: 0x25(wide), 0x26(narrow), 0x27(narrow), 0x28(narrow)
    // step: 4 + 2 + 2 + 2 = 10 byte
    const r1 = renderGlyphLoop1E64(0x00a03000, 0x25, 4);
    expect(r1.endBufPtr).toBe(0x00a03000 + 10);
    expect(r1.endCharCode).toBe(0x29);

    // start=0x2D, count=2 → 0x2D(narrow), 0x2E(wide). step: 2 + 4 = 6
    const r2 = renderGlyphLoop1E64(0x00a03000, 0x2d, 2);
    expect(r2.endBufPtr).toBe(0x00a03000 + 6);
    expect(r2.endCharCode).toBe(0x2f);
  });

  it("charCode signed-negative (0xFFFF = -1) → wide branch (D3 < 0x26 signed)", () => {
    const calls: RenderGlyphCall[] = [];
    const r = renderGlyphLoop1E64(0x00a03200, 0xffff, 1, {
      renderGlyph: (c) => calls.push(c),
    });
    expect(r.iterations).toBe(1);
    // -1 signed < 0x26 → wide → +4
    expect(r.endBufPtr).toBe(0x00a03204);
    // 0xFFFF + 1 wraps a 16-bit → 0x0000
    expect(r.endCharCode).toBe(0x0000);
    expect(calls).toEqual([
      { bufPtr: 0x00a03200, charCode: 0xffff, mask: 0 },
    ]);
  });

  it("charCode signed-positive grande (0x7FFF) → wide; charCode 0x8000 (= -32768 i16) → wide", () => {
    // 0x7FFF = 32767 signed > 0x2D → wide
    const r1 = renderGlyphLoop1E64(0x00a03000, 0x7fff, 1);
    expect(r1.endBufPtr).toBe(0x00a03004);
    expect(r1.endCharCode).toBe(0x8000);

    // 0x8000 = -32768 signed < 0x26 → wide
    const r2 = renderGlyphLoop1E64(0x00a03000, 0x8000, 1);
    expect(r2.endBufPtr).toBe(0x00a03004);
    expect(r2.endCharCode).toBe(0x8001);
  });

  it("transizione narrow → wide: 0x2D + 1 = 0x2E (wide), step 2 poi 4", () => {
    // count=3 da 0x2C: 0x2C(narrow,+2), 0x2D(narrow,+2), 0x2E(wide,+4)
    const r = renderGlyphLoop1E64(0x00a03400, 0x2c, 3);
    expect(r.iterations).toBe(3);
    expect(r.endBufPtr).toBe(0x00a03400 + 2 + 2 + 4);
    expect(r.endCharCode).toBe(0x2f);
  });

  it("renderGlyph callback assente è no-op (default subs)", () => {
    // Senza callback: il loop avanza correttamente lo stesso, solo
    // senza side effect. La firma del modulo accetta `subs` opzionale.
    const r = renderGlyphLoop1E64(0x00a03500, 0x41, 5);
    expect(r.iterations).toBe(5);
    expect(r.endBufPtr).toBe(0x00a03500 + 5 * 4);
    expect(r.endCharCode).toBe(0x46);
  });

  it("constanti pubbliche: range narrow e step", () => {
    expect(NARROW_LO_INCL).toBe(0x26);
    expect(NARROW_HI_INCL).toBe(0x2d);
    expect(NARROW_STEP).toBe(2);
    expect(WIDE_STEP).toBe(4);
    expect(RENDER_GLYPH_FN_ADDR).toBe(0x000032ba);
  });

  it("wrap u32 di bufPtr quando close al limite (0xFFFFFFFC + 4 = 0)", () => {
    // bufPtr a -4 (= 0xFFFFFFFC), 1 wide iter → wrap a 0
    const r = renderGlyphLoop1E64(0xfffffffc, 0x30, 1);
    expect(r.endBufPtr).toBe(0x00000000);
    expect(r.iterations).toBe(1);
  });

  it("wrap u16 di endCharCode (0xFFFE + 3 = 0x0001)", () => {
    const r = renderGlyphLoop1E64(0x00a03000, 0xfffe, 3);
    expect(r.iterations).toBe(3);
    // 0xFFFE → 0xFFFF → 0x0000 → 0x0001
    expect(r.endCharCode).toBe(0x0001);
  });

  it("count = 1, charCode esattamente al boundary basso 0x26 → narrow", () => {
    const calls: RenderGlyphCall[] = [];
    const r = renderGlyphLoop1E64(0x00a03000, 0x26, 1, {
      renderGlyph: (c) => calls.push(c),
    });
    expect(r.endBufPtr).toBe(0x00a03002);
    expect(calls[0]!.charCode).toBe(0x26);
  });

  it("count = 1, charCode esattamente al boundary alto 0x2D → narrow", () => {
    const r = renderGlyphLoop1E64(0x00a03000, 0x2d, 1);
    expect(r.endBufPtr).toBe(0x00a03002);
  });
});
