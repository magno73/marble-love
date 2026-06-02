/**
 * render-glyph-loop-1e64.ts — `FUN_00001E64` replica (70 bytes).
 *
 * **Semantics**: iterates `count` times (low word of arg2) over a glyph render.
 * `[0x26, 0x2D]` inclusive is the "narrow" range, covering `&'()*+,-` in ASCII.
 * `(startCode, startCode+1, ..., startCode+count-1)`.
 *
 * **Disasm 0x1E64..0x1EA9** (70 byte):
 *
 *   00001e64    movem.l {D4 D3 D2},-(SP)         ; save D2/D3/D4 (12 bytes)
 *   00001e68    move.l  (0x10,SP),D4              ; D4 = arg1 long (bufPtr)
 *   00001e6c    move.w  (0x16,SP),D3w             ; D3.w = arg2 low word (startCode)
 *   00001e70    move.w  (0x1a,SP),D2w             ; D2.w = arg3 low word (count)
 *   loop_top:
 *   00001e74    tst.w   D2w
 *   00001e76    ble.b   0x00001ea4                ; if (i16)D2 <= 0 → exit
 *   00001e78    clr.l   -(SP)                     ; push 0 (mask = 0)
 *   00001e7a    move.w  D3w,D0w
 *   00001e7c    ext.l   D0
 *   00001e7e    move.l  D0,-(SP)                  ; push sext_l(D3.w) (charCode)
 *   00001e80    move.l  D4,-(SP)                  ; push D4 (bufPtr)
 *   00001e82    jsr     0x000032ba.l              ; FUN_32BA(bufPtr, charCode, mask=0)
 *   00001e88    moveq   0x26,D0
 *   00001e8a    cmp.w   D3w,D0w                   ; flags = 0x26 - D3 (signed)
 *   00001e8c    lea     (0xc,SP),SP               ; pop 3 long args
 *   00001e90    bgt.b   0x00001e9c                ; if 0x26 > D3 → wide branch
 *   00001e92    moveq   0x2d,D0
 *   00001e94    cmp.w   D3w,D0w                   ; flags = 0x2D - D3
 *   00001e96    blt.b   0x00001e9c                ; if 0x2D < D3 → wide branch
 *   00001e98    addq.l  0x2,D4                     ; narrow: bufPtr += 2
 *   00001e9a    bra.b   0x00001e9e
 *   00001e9c    addq.l  0x4,D4                     ; wide:   bufPtr += 4
 *   00001e9e    addq.w  0x1,D3w                    ; charCode++
 *   00001ea0    subq.w  0x1,D2w                    ; count--
 *   00001ea2    bra.b   0x00001e74
 *   00001ea4    movem.l (SP)+,{D2 D3 D4}          ; restore
 *   00001ea8    rts
 *
 * **Calling convention** (cdecl-like, args pushed RTL as long):
 *   - arg1 long @ (0x10,SP) post-prolog: `bufPtr` (alpha tilemap address,
 *     in practice `0x00A03000 + 2*N`).
 *   - arg2 long @ (0x14,SP), low word @ (0x16,SP): `startCode` — code-point
 *   - arg3 long @ (0x18,SP), low word @ (0x1A,SP): `count` (signed word,
 *     `<= 0` → no-op).
 *
 * replicated separately) handles 4+ branches based on `charCode` and
 *
 *   - `charCode` in `[0x26, 0x2D]` (= `&'()*+,-` ASCII) → step = 2
 *
 * (es. `0xFFFF` = -1 i16) prendono la branch "wide" (D3 < 0x26 signed).
 *
 *
 *
 * (hooked @ PC=0x32BA) and the TS replica (callback log). Actual alphaRam
 * writes depend on FUN_32BA (out of scope).
 */

/**
 * eventuali repliche future di FUN_32BA.
 */
export const RENDER_GLYPH_FN_ADDR = 0x000032ba as const;

/**
 * Inferiore (inclusivo) del range "narrow" per il code-point.
 * `charCode >= NARROW_LO_INCL && charCode <= NARROW_HI_INCL` → step = 2.
 */
export const NARROW_LO_INCL = 0x26 as const;

/** Superiore (inclusivo) del range "narrow". */
export const NARROW_HI_INCL = 0x2d as const;

export const NARROW_STEP = 2 as const;

export const WIDE_STEP = 4 as const;

/**
 *
 * - `bufPtr`: 32-bit pointer (long), di solito in alpha tilemap
 *   sign-extended long.
 */
export interface RenderGlyphCall {
  bufPtr: number;
  charCode: number;
  mask: number;
}

/**
 *
 *   step di `bufPtr`. Default: no-op.
 *
 */
export interface RenderGlyphLoop1E64Subs {
  renderGlyph?: (call: RenderGlyphCall) => void;
}

/**
 *
 *   `startBufPtr + sum(stride_i)` with stride_i in {2, 4} according to the rule
 *   `(startCharCode + iterations) & 0xFFFF`.
 */
export interface RenderGlyphLoop1E64Result {
  iterations: number;
  endBufPtr: number;
  endCharCode: number;
}

/**
 *
 * @param subs          Stub injection (`renderGlyph` callback).
 *
 * @returns `{ iterations, endBufPtr, endCharCode }` (see
 *          {@link RenderGlyphLoop1E64Result}).
 *
 * via `subs.renderGlyph`. The caller replica that invokes the real FUN_32BA
 * alpha tilemap.
 */
export function renderGlyphLoop1E64(
  bufPtr: number,
  startCharCode: number,
  count: number,
  subs: RenderGlyphLoop1E64Subs = {},
): RenderGlyphLoop1E64Result {
  // D4 = bufPtr (long). Tutte le aritmetiche sono su 32-bit unsigned in JS:
  let d4 = bufPtr >>> 0;

  // sign-extended ((d3w << 16) >> 16).
  let d3w = startCharCode & 0xffff;

  // D2.w = count, signed word. Loop condition `tst.w D2w; ble.b exit`:
  // `ble` (signed) means "branch if D <= 0 signed"; the loop continues while
  // sign-extended D2.w > 0. With count = 0x8000 (= -32768
  let d2w = count & 0xffff;

  let iterations = 0;
  const onCall = subs.renderGlyph;

  // Sign-extension helper: u16 → i32 sign-extended.
  const sext16 = (w: number): number => (w << 16) >> 16;

  while (true) {
    // tst.w D2w; ble.b exit
    if (sext16(d2w) <= 0) break;

    // jsr FUN_32BA(bufPtr, sext_l(charCode), 0)
    if (onCall !== undefined) {
      onCall({ bufPtr: d4, charCode: d3w, mask: 0 });
    }

    // Width rule:
    //   moveq #0x26, D0; cmp.w D3, D0; bgt narrow_skip   (if 0x26 > D3 → wide)
    //   moveq #0x2D, D0; cmp.w D3, D0; blt narrow_skip   (if 0x2D < D3 → wide)
    //   addq.l #2, D4   (narrow)
    //   bra continue
    // narrow_skip:
    //   addq.l #4, D4   (wide)
    // Comparisons are signed-word: use sext16(d3w).
    const d3signed = sext16(d3w);
    const isNarrow = d3signed >= NARROW_LO_INCL && d3signed <= NARROW_HI_INCL;
    d4 = (d4 + (isNarrow ? NARROW_STEP : WIDE_STEP)) >>> 0;

    // addq.w 0x1, D3w — word increment with 16-bit wrap.
    d3w = (d3w + 1) & 0xffff;

    // subq.w 0x1, D2w — word decrement with 16-bit wrap.
    d2w = (d2w - 1) & 0xffff;

    iterations++;
  }

  return {
    iterations,
    endBufPtr: d4 >>> 0,
    endCharCode: d3w,
  };
}
