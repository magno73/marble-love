/**
 * render-score-28e3c.ts — replica `FUN_00028E3C`.
 *
 * Six-argument decimal format + optional trim + render-string-entry wrapper.
 * It is the 28F62-backed sibling of `formatAndRender28EB2`.
 */

import type { GameState } from "./state.js";
import { renderStringEntry28F62 } from "./render-string-entry-28f62.js";
import { trimTrailingSpace } from "./string-trim.js";

const BUFEND_PTR_OFF = 0x41e;
const FMT_MODE_D = 0x64;
const TRIM_SELECTOR = 2;

export const RENDER_SCORE_28E3C_ADDR = 0x00028e3c as const;

export interface RenderScore28E3CSubs {
  numberFormatter?: (
    state: GameState,
    value: number,
    bufEnd: number,
    fmtMode: number,
    width: number,
    fillExtra: number,
  ) => void;
  trimTrailingSpace?: (state: GameState, strPtr: number, maxLen: number) => void;
  renderStringEntry28F62?: (state: GameState, col: number, tickOff: number, attr: number) => void;
}

function extLowWordToLong(value: number): number {
  const w = value & 0xffff;
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) >>> 0 : w >>> 0;
}

function readWorkLongBE(state: GameState, off: number): number {
  const r = state.workRam;
  return ((((r[off] ?? 0) << 24) |
    ((r[off + 1] ?? 0) << 16) |
    ((r[off + 2] ?? 0) << 8) |
    (r[off + 3] ?? 0)) >>> 0);
}

export function renderScore28E3C(
  state: GameState,
  longArg: number,
  w1: number,
  w2: number,
  w3: number,
  w4: number,
  w5: number,
  subs: RenderScore28E3CSubs = {},
): void {
  const bufEnd = readWorkLongBE(state, BUFEND_PTR_OFF);
  const widthExt = extLowWordToLong(w1);
  const fillExt = extLowWordToLong(w4);

  subs.numberFormatter?.(state, longArg >>> 0, bufEnd, FMT_MODE_D, widthExt, fillExt);

  if ((w1 & 0xffff) === TRIM_SELECTOR) {
    (subs.trimTrailingSpace ?? trimTrailingSpace)(state, bufEnd, fillExt);
  }

  const col = extLowWordToLong(w2);
  const tickOff = extLowWordToLong(w3);
  const attr = extLowWordToLong(w5);
  (subs.renderStringEntry28F62 ?? renderStringEntry28F62)(state, col, tickOff, attr);
}

export { renderScore28E3C as FUN_00028E3C };
