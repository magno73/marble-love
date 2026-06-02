/**
 * score-table-update-4790.test.ts — smoke tests of `scoreTableUpdate4790`
 * (FUN_004790, 1178 byte).
 *
 * `packages/cli/src/test-score-table-update-4790-parity.ts` vs Musashi.
 */

import { describe, it, expect } from "vitest";
import {
  scoreTableUpdate4790,
  type ScoreTableUpdate4790Subs,
} from "../src/score-table-update-4790.js";
import { emptyGameState } from "../src/state.js";

const PTR_FFC_OFF = 0x1ffc;
const PTR_ABS = 0x401a00;
const BASE_OFF = (PTR_ABS - 0x400000) + 0x50; // = 0x1a50
const A2_OFF = 0x1f86; // timerDeltaAccumulate returns 0x401F86

function writeLongBE(r: Uint8Array, off: number, v: number): void {
  const x = v >>> 0;
  r[off] = (x >>> 24) & 0xff;
  r[off + 1] = (x >>> 16) & 0xff;
  r[off + 2] = (x >>> 8) & 0xff;
  r[off + 3] = x & 0xff;
}
function readLongBE(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>> 0
  );
}

/**
 */
function makeState() {
  const s = emptyGameState();
  writeLongBE(s.workRam, PTR_FFC_OFF, PTR_ABS);
  for (let i = 0; i < 160; i++) s.workRam[BASE_OFF + i] = 0;
  return s;
}

const SUBS_BASE: ScoreTableUpdate4790Subs = {
  romByte1006F: 0xe3,                            // numRecords=3, colThresh=7
  romTable7974: [0x05, 0x05, 0x05, 0x05],        // tblByte=5 → divisorW=300
  soundDispatch: () => 0,
};

describe("scoreTableUpdate4790 (FUN_4790)", () => {
  it("no delta → table invariata, flag2 non set", () => {
    const s = makeState();
    // Accumulatori = 0 → both le entry saltate
    const before = Array.from(s.workRam.slice(BASE_OFF, BASE_OFF + 60));
    scoreTableUpdate4790(s, 0x1000, 2, 0x2000, 2, 0, 0, 0, SUBS_BASE);
    const after = Array.from(s.workRam.slice(BASE_OFF, BASE_OFF + 60));
    expect(after).toEqual(before);
  });

  it("first entry con delta non-zero → cella [row*20+col] incrementata of 1", () => {
    const s = makeState();
    // Sets accumulatore A2 (0x401F86) = 600 (> 0, < divisor*colThresh overflow)
    writeLongBE(s.workRam, A2_OFF, 600);
    // divisorW = 300, colThresh = 7
    // quotient = 600/300 = 2; A0 = max(0, 2-7)=0 (2 < 7 → A0=0)
    // row cap arg2=2; numRec=3 (romB & 7); 3 > 2 unsigned → rowD2 = 2
    // D5 = 2*20 + 0 = 40
    scoreTableUpdate4790(s, 0x1000, 2, 0, 2, 0, 0, 0, SUBS_BASE);
    expect(s.workRam[BASE_OFF + 40]).toBe(1);
    expect(readLongBE(s.workRam, A2_OFF)).toBe(0);
  });

  it("delta grande → col clamped a 0x11 (17)", () => {
    const s = makeState();
    // Sets A2 = 100_000 (grande)
    writeLongBE(s.workRam, A2_OFF, 100_000);
    // quotient = 100000/300 = 333; A0 = 333 - 7 = 326 > 17 → clamped a 17
    // row cap arg2=0; numRec=3 (>0); 3>0 → rowD2=0
    // D5 = 0*20 + 17 = 17 → base[17]++
    scoreTableUpdate4790(s, 0x500, 0, 0, 0, 0, 0, 0, SUBS_BASE);
    expect(s.workRam[BASE_OFF + 17]).toBe(1);
  });

  it("overflow cella 0xFF→0x00 → setta flag2 → decay (lsr.b #1) su all le celle", () => {
    const s = makeState();
    s.workRam[BASE_OFF + 0] = 0xff;
    s.workRam[BASE_OFF + 1] = 0x80;
    s.workRam[BASE_OFF + 2] = 0x42;
    // A2 = 1 (small delta -> col=0 with large colThresh values, row=0).
    writeLongBE(s.workRam, A2_OFF, 1);
    // divisorW=300, quotient=0 < colThresh=7 → A0=0; row cap=0, numRec=3, 3>0 → row=0
    // D5=0; base[0] = 0xFF+1 = 0x00 → wrap → flag2=1, base[0]=0xFF
    scoreTableUpdate4790(s, 0, 0, 0, 0, 0, 0, 0, SUBS_BASE);
    expect(s.workRam[BASE_OFF + 0]).toBe(0x7f);
    // base[1]: 0x80 >> 1 = 0x40
    expect(s.workRam[BASE_OFF + 1]).toBe(0x40);
    // base[2]: 0x42 >> 1 = 0x21
    expect(s.workRam[BASE_OFF + 2]).toBe(0x21);
  });

  // ── Smoke 5: sound dispatch per bonus fields ──────────────────────────────
  it("bonus arg5 != 0 → soundDispatch chiamato con cmdIndex=7", () => {
    const s = makeState();
    const calls: Array<[number, number]> = [];
    const subs: ScoreTableUpdate4790Subs = {
      ...SUBS_BASE,
      soundDispatch: (cmd, data) => { calls.push([cmd, data]); return 0; },
    };
    scoreTableUpdate4790(s, 0, 0, 0, 0, 1234, 0, 0, subs);
    // There must be at least one call with cmdIndex=7.
    const has7 = calls.some(([c]) => c === 7);
    expect(has7).toBe(true);
  });

  it("seconda entry non-zero → score accumulatore @ 0x401F92 aggiornato", () => {
    const s = makeState();
    writeLongBE(s.workRam, A2_OFF, 0);
    writeLongBE(s.workRam, A2_OFF + 4, 500);
    scoreTableUpdate4790(s, 0, 0, 0, 0, 0, 0, 0, SUBS_BASE);
    const scoreAccum = readLongBE(s.workRam, 0x1f92);
    expect(scoreAccum).toBe(500);
  });

  // ── Smoke 7: score wrap beyond 0xE10 ─────────────────────────────────────
  it("score accum >= 0xE10 → wrap: dispatch cmd 5 and sottrai multiplo", () => {
    const s = makeState();
    const calls: Array<[number, number]> = [];
    const subs: ScoreTableUpdate4790Subs = {
      ...SUBS_BASE,
      soundDispatch: (cmd, data) => { calls.push([cmd, data]); return 0; },
    };
    // Sets A2+4 = 3601 (> 0xE10=3600)
    writeLongBE(s.workRam, A2_OFF + 4, 3601);
    scoreTableUpdate4790(s, 0, 0, 0, 0, 0, 0, 0, subs);
    // 3601 > 3600 → wrap: wrapDiv = floor(3601/3600) = 1; dispatch (5, ff5+1+1)
    const score5call = calls.find(([c]) => c === 5);
    expect(score5call).toBeDefined();
    const scoreAccum = readLongBE(s.workRam, 0x1f92);
    expect(scoreAccum).toBeLessThan(0xe10);
  });
});
