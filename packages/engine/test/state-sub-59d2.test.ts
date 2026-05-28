/**
 * state-sub-59d2.test.ts — smoke test per stateSub59D2 (FUN_59D2).
 *
 */

import { describe, it, expect } from "vitest";
import {
  stateSub59D2,
  FIELD_ID_F3,
  FIELD_ID_F4,
  FIELD_ID_F5,
  SCALE_FACTOR,
} from "../src/state-sub-59d2.js";
import { emptyGameState } from "../src/state.js";

describe("stateSub59D2 (FUN_59D2) — smoke", () => {
  it("early-exit: 2*F(4)+F(3) == 0 → ritorna 0, non chiama F(5)", () => {
    const s = emptyGameState();
    const calls: number[] = [];
    const r = stateSub59D2(s, (_st, id) => {
      calls.push(id);
      return 0;
    });
    expect(r).toBe(0);
    expect(calls).toEqual([FIELD_ID_F4, FIELD_ID_F3]);
  });

  it("ordine fetch: F(4) → F(3) → F(5) (quando denom != 0)", () => {
    const s = emptyGameState();
    const calls: number[] = [];
    stateSub59D2(s, (_st, id) => {
      calls.push(id);
      // F(4)=1 → 2*1=2; F(3)=0 → denom=2; F(5)=10 → num=10.
      const map: Record<number, number> = { 4: 1, 3: 0, 5: 10 };
      return map[id] ?? 0;
    });
    expect(calls).toEqual([FIELD_ID_F4, FIELD_ID_F3, FIELD_ID_F5]);
  });

  it("calcolo base: F(3)=10, F(4)=20, F(5)=30 → (30*60)/(2*20+10) = 1800/50 = 36", () => {
    const s = emptyGameState();
    const r = stateSub59D2(s, (_st, id) => {
      const map: Record<number, number> = { 3: 10, 4: 20, 5: 30 };
      return map[id] ?? 0;
    });
    expect(r).toBe(36);
  });

  it("denom = 1, num = 100 → 100*60/1 = 6000", () => {
    const s = emptyGameState();
    const r = stateSub59D2(s, (_st, id) => {
      const map: Record<number, number> = { 3: 1, 4: 0, 5: 100 };
      return map[id] ?? 0;
    });
    // denom = 2*0+1 = 1; num = 100. Bypass halve (entrambi <= 0xFFFF).
    // mulu = 100 * 60 = 6000. divu 6000 / 1 = 6000. Quotient = 6000.
    expect(r).toBe(6000);
  });

  it("divu overflow: denom=1, num=1100 → quoziente teorico 66000 > 0xFFFF", () => {
    const s = emptyGameState();
    const r = stateSub59D2(s, (_st, id) => {
      const map: Record<number, number> = { 3: 1, 4: 0, 5: 1100 };
      return map[id] ?? 0;
    });
    // denom = 1, num = 1100. mulu = 1100*60 = 66000 = 0x101D0.
    // 0x101D0 / 1 = 0x101D0 > 0xFFFF → V flag, D1 unchanged.
    // D1 pre-divu = 0x101D0. low word = 0x01D0 = 464.
    expect(r).toBe(0x01d0); // 464
  });

  it("halve loop: denom=0x10000, num=0x10000 → entrambi entrano in halve, ROUND-half", () => {
    const s = emptyGameState();
    const r = stateSub59D2(s, (_st, id) => {
      // 2*F(4)+F(3) = 0x10000 → F(4)=0x8000, F(3)=0
      const map: Record<number, number> = { 3: 0, 4: 0x8000, 5: 0x10000 };
      return map[id] ?? 0;
    });
    // denom = 0x10000, num = 0x10000.
    // @ 0x5A1A: 0x10000 <= 0x1FFFE → no LSR.
    //          0x10000 <= 0x1FFFE → ROUND-half.
    // d2' = 0x10001 >> 1 = 0x8000; d1' = 0x10001 >> 1 = 0x8000.
    // mulu: 0x8000 * 60 = 0x1E0000. divu: 0x1E0000 / 0x8000 = 0x3C = 60. Quot=60.
    expect(r).toBe(60);
  });

  it("halve loop con LSR step: denom=0x30000, num=0x100", () => {
    const s = emptyGameState();
    const r = stateSub59D2(s, (_st, id) => {
      // 2*F(4)+F(3) = 0x30000 → F(4)=0x18000, F(3)=0
      const map: Record<number, number> = { 3: 0, 4: 0x18000, 5: 0x100 };
      return map[id] ?? 0;
    });
    // d2 = 0x30000, d1 = 0x100.
    // 0x30000 > 0xFFFF → halve.
    // @ 0x5A1A: 0x30000 > 0x1FFFE → LSR: d2=0x18000, d1=0x80. bra.
    // @ 0x5A1A: 0x18000 <= 0x1FFFE; d1=0x80 <= 0x1FFFE → ROUND.
    // d2 = (0x18000+1)>>1 = 0xC000; d1 = (0x80+1)>>1 = 0x40.
    // mulu: 0x40 * 60 = 0xF00. divu: 0xF00 / 0xC000 = 0 (with remainder 0xF00).
    expect(r).toBe(0);
  });

  it("default callback (no inner40D8) → ritorna 0", () => {
    const s = emptyGameState();
    const r = stateSub59D2(s);
    expect(r).toBe(0);
  });

  it("non muta state.workRam in nessun path", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0x42;
    s.workRam[0x1f00] = 0x99;
    const before = new Uint8Array(s.workRam);
    stateSub59D2(s, (_st, id) => (id === 4 ? 5 : id === 3 ? 1 : 100));
    expect(s.workRam).toEqual(before);
  });

  it("F(4) viene moltiplicato per 2 (asl.l #1) prima della somma", () => {
    const s = emptyGameState();
    // F(4)=7, F(3)=0 → 2*7+0 = 14. F(5)=14 → num=14.
    // mulu: 14 * 60 = 840. divu: 840 / 14 = 60. → 60
    const r = stateSub59D2(s, (_st, id) => {
      const map: Record<number, number> = { 3: 0, 4: 7, 5: 14 };
      return map[id] ?? 0;
    });
    expect(r).toBe(60);
  });

  it("F(3) viene aggiunto al risultato di asl(F(4))", () => {
    const s = emptyGameState();
    // F(4)=10, F(3)=5 → 2*10+5 = 25. F(5)=25 → num=25.
    // mulu: 25 * 60 = 1500. divu: 1500 / 25 = 60. → 60
    const r = stateSub59D2(s, (_st, id) => {
      const map: Record<number, number> = { 3: 5, 4: 10, 5: 25 };
      return map[id] ?? 0;
    });
    expect(r).toBe(60);
  });

  it("SCALE_FACTOR è esposto come 0x3C (60)", () => {
    expect(SCALE_FACTOR).toBe(0x3c);
    expect(SCALE_FACTOR).toBe(60);
  });

  it("FIELD_ID costants sono esposte (3, 4, 5)", () => {
    expect(FIELD_ID_F3).toBe(3);
    expect(FIELD_ID_F4).toBe(4);
    expect(FIELD_ID_F5).toBe(5);
  });

  it("F(4) negativo (= 0xFFFFFFFF, -1) → asl wrap, denom = 0xFFFFFFFE + F(3)", () => {
    const s = emptyGameState();
    // F(4) = 0xFFFFFFFF (= -1 signed), asl → 0xFFFFFFFE.
    // F(3) = 2 → denom = 0x100000000 mod 2^32 = 0. → early exit, D0 = 0.
    const r = stateSub59D2(s, (_st, id) => {
      if (id === 4) return 0xffffffff >>> 0;
      if (id === 3) return 2;
      return 100;
    });
    expect(r).toBe(0);
  });

  it("denom==num exact → divu = 1 quotient (con num word *60 e poi divu)", () => {
    const s = emptyGameState();
    // F(4)=30, F(3)=0 → denom = 60. F(5)=1 → num=1.
    // mulu = 60. divu 60/60 = 1.
    const r = stateSub59D2(s, (_st, id) => {
      const map: Record<number, number> = { 3: 0, 4: 30, 5: 1 };
      return map[id] ?? 0;
    });
    expect(r).toBe(1);
  });
});
