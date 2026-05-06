/**
 * state-sub-5d2a.test.ts — smoke tests di stateSub5D2A (FUN_5D2A).
 *
 * Bit-perfect parity verificata vs binary in `test-state-sub-5d2a-parity.ts`.
 * Qui copriamo la logica osservabile dal lato JS:
 *   - 16 iter loop (D4 = 15..0), 32 chiamate a inner3784
 *   - bitmap scan MSB→LSB (mask = 0x8000..0x0001)
 *   - branch su byte ROM @ 0x10072 (gate) a iter D4=7
 *   - attr 0xA0 quando D4 == arg1_word, altrimenti 0x20 (cella sinistra)
 *   - cella destra ha SEMPRE attr 0
 *   - default callback no-op
 */

import { describe, it, expect } from "vitest";
import {
  stateSub5D2A,
  ATTR_DEFAULT,
  ATTR_HIGHLIGHTED,
  ATTR_RIGHT,
  CALLS_PER_ITER,
  LOOP_ITER_COUNT,
  ROM_GATE_BYTE_ADDR,
} from "../src/state-sub-5d2a.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

interface CapturedCall {
  y: number;
  x: number;
  attr: number;
  extra: number;
}

describe("stateSub5D2A (FUN_5D2A)", () => {
  it("invoca inner3784 esattamente 32 volte (16 iter × 2 celle)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const calls: CapturedCall[] = [];

    stateSub5D2A(state, rom, 0x0000, 0xffff, (_st, y, x, attr, extra) => {
      calls.push({ y, x, attr, extra });
      return 0;
    });

    expect(calls).toHaveLength(LOOP_ITER_COUNT * CALLS_PER_ITER); // 32
  });

  it("cella destra (every odd index) ha SEMPRE attr 0", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const calls: CapturedCall[] = [];

    // arg1 = 5 → cella sinistra a iter D4=5 ha attr 0xA0
    stateSub5D2A(state, rom, 0xa5a5, 0x0005, (_st, y, x, attr, extra) => {
      calls.push({ y, x, attr, extra });
      return 0;
    });

    // Cella destra è ogni call con index 1, 3, 5, ... 31.
    for (let i = 1; i < calls.length; i += CALLS_PER_ITER) {
      expect(calls[i]!.attr).toBe(ATTR_RIGHT);
    }
  });

  it("attr cella sinistra: 0xA0 a D4 == arg1_word, altrimenti 0x20", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const calls: CapturedCall[] = [];

    // arg1 = 10 → solo iter index 5 (D4=15-5=10) ha attr 0xA0
    // Iter 0: D4=15, iter 1: D4=14, ..., iter k: D4=15-k.
    // D4=10 → iter index 5.
    stateSub5D2A(state, rom, 0x0000, 0x000a, (_st, y, x, attr) => {
      calls.push({ y, x, attr, extra: 0 });
      return 0;
    });

    // Cella sinistra (even indices): index 0 = D4=15, ..., index 30 = D4=0.
    // 0xA0 al iter dove D4=10 → call index 2*5 = 10.
    for (let iter = 0; iter < LOOP_ITER_COUNT; iter++) {
      const d4 = 15 - iter;
      const leftCallIdx = iter * CALLS_PER_ITER;
      const expectedAttr = d4 === 10 ? ATTR_HIGHLIGHTED : ATTR_DEFAULT;
      expect(calls[leftCallIdx]!.attr).toBe(expectedAttr);
    }
  });

  it("default callback no-op → ritorna 0, non muta state.workRam o ROM", () => {
    const state = emptyGameState();
    state.workRam[0x100] = 0x77;
    const rom = emptyRomImage();
    rom.program[0x10072] = 0x42;
    const workRamBefore = new Uint8Array(state.workRam);
    const romBefore = new Uint8Array(rom.program);

    const r = stateSub5D2A(state, rom, 0xdead, 0xbeef);

    expect(r).toBe(0);
    expect(state.workRam).toEqual(workRamBefore);
    expect(rom.program).toEqual(romBefore);
  });

  it("gate byte ROM @ 0x10072 != 0 → A3=4, D5w=0xFFF5 a iter D4=7 (e successive)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    rom.program[ROM_GATE_BYTE_ADDR] = 0x01; // gate != 0

    const calls: CapturedCall[] = [];
    stateSub5D2A(state, rom, 0x8000, 0xffff, (_st, y, x, attr, extra) => {
      calls.push({ y, x, attr, extra });
      return 0;
    });

    // Iter D4=7 è iter index 8 (15-8=7). Cella sinistra a call index 16.
    // x_left a D4=7 = sign-ext(A3w=4) + sign-ext(A4w).
    // A4w dipende da bit 8 di mask (mask shiftata 8 volte = 0x0080).
    // arg0=0x8000, mask=0x0080 → bit clear → A4=8.
    // x_left = 4 + 8 = 12.
    // y a D4=7 = (15-7)*2 + 0xFFF5 = 16 + 0xFFF5 = 0x10005 → word 0x0005.
    //  Sign-ext word 0x0005 → 0x00000005.
    expect(calls[16]!.x).toBe(12);
    expect(calls[16]!.y).toBe(5);

    // Iter D4=6 è iter index 9. Cella sinistra call index 18.
    // mask = 0x0040 (after 9 shifts). arg0=0x8000 & 0x0040 = 0 → A4=8.
    // y = (15-6)*2 + 0xFFF5 = 18 + 0xFFF5 = 0x10007 → word 0x0007.
    //  Sign-ext word 0x0007 → 7.
    // x_left = 4 + 8 = 12.
    expect(calls[18]!.x).toBe(12);
    expect(calls[18]!.y).toBe(7);
  });

  it("gate byte == 0 → D5w=5, A3=0 (default, equivalente a init)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    // rom.program[0x10072] = 0 default

    const calls: CapturedCall[] = [];
    stateSub5D2A(state, rom, 0x8000, 0xffff, (_st, y, x, attr, extra) => {
      calls.push({ y, x, attr, extra });
      return 0;
    });

    // Iter 0 (D4=15): mask=0x8000, arg0=0x8000 → bit set → A4=7.
    // y = (15-15)*2 + 5 = 5. x_left = 0 + 7 = 7.
    expect(calls[0]!.x).toBe(7);
    expect(calls[0]!.y).toBe(5);

    // Iter D4=7 (index 8): mask=0x0080. arg0=0x8000 & 0x80 = 0 → A4=8.
    // y = (15-7)*2 + 5 = 21. x_left = 0 + 8 = 8.
    expect(calls[16]!.x).toBe(8);
    expect(calls[16]!.y).toBe(21);

    // Iter ultimo (D4=0): mask=0x0001. arg0=0x8000 & 1 = 0 → A4=8.
    // y = (15-0)*2 + 5 = 35. x_left = 0 + 8 = 8.
    expect(calls[30]!.x).toBe(8);
    expect(calls[30]!.y).toBe(35);
  });

  it("bitmap scan MSB→LSB: arg0 = 0x0001 → solo iter D4=0 (ultima) ha A4=7", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const calls: CapturedCall[] = [];

    // arg0 = 0x0001 → solo bit 0 set → solo mask=0x0001 (iter ultima D4=0) match.
    stateSub5D2A(state, rom, 0x0001, 0xffff, (_st, y, x, attr, extra) => {
      calls.push({ y, x, attr, extra });
      return 0;
    });

    // gate=0 → A3=0. x_left = A3 + A4. A4=8 (bit clear) o 7 (bit set).
    // Iter 0..14 (D4=15..1): mask=0x8000..0x0002, arg0=0x0001, AND=0 → A4=8 → x=8.
    // Iter 15 (D4=0): mask=0x0001, arg0=0x0001, AND=1 → A4=7 → x=7.
    for (let iter = 0; iter < 15; iter++) {
      expect(calls[iter * CALLS_PER_ITER]!.x).toBe(8);
    }
    expect(calls[15 * CALLS_PER_ITER]!.x).toBe(7);
  });

  it("bitmap scan: arg0 = 0xFFFF → tutti gli A4=7 (tutti i bit set)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const calls: CapturedCall[] = [];
    stateSub5D2A(state, rom, 0xffff, 0xffff, (_st, y, x, attr, extra) => {
      calls.push({ y, x, attr, extra });
      return 0;
    });

    // Tutte le iter: mask & arg0 != 0 → A4=7. gate=0, A3=0 → x_left = 7.
    for (let iter = 0; iter < LOOP_ITER_COUNT; iter++) {
      expect(calls[iter * CALLS_PER_ITER]!.x).toBe(7);
    }
  });

  it("cella destra: x_right = (15 - A4) + A3 (gate=0 → A3=0)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const calls: CapturedCall[] = [];

    // arg0 = 0x0000 → tutti bit clear → A4=8 sempre.
    // x_right = (15 - 8) + 0 = 7.
    stateSub5D2A(state, rom, 0x0000, 0xffff, (_st, y, x, attr, extra) => {
      calls.push({ y, x, attr, extra });
      return 0;
    });

    for (let iter = 0; iter < LOOP_ITER_COUNT; iter++) {
      const rightIdx = iter * CALLS_PER_ITER + 1;
      expect(calls[rightIdx]!.x).toBe(7);
      // y stesso di cella sinistra.
      expect(calls[rightIdx]!.y).toBe(calls[iter * CALLS_PER_ITER]!.y);
    }
  });

  it("trailing arg (extra) sempre 0 in tutte le 32 chiamate", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const calls: CapturedCall[] = [];
    stateSub5D2A(state, rom, 0xa5a5, 0x0005, (_st, y, x, attr, extra) => {
      calls.push({ y, x, attr, extra });
      return 0;
    });

    for (const c of calls) {
      expect(c.extra).toBe(0);
    }
  });

  it("ritorna l'ultimo D0 di inner3784 (per fedeltà al binario)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    let counter = 0;
    const r = stateSub5D2A(state, rom, 0x1234, 0x0007, () => {
      counter++;
      return counter; // ultimo invocato → counter = 32
    });
    expect(r).toBe(32);
  });

  it("ordine chiamate: per iter k, prima cella sinistra (call 2k), poi destra (2k+1)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const order: ("L" | "R")[] = [];
    let toggle = false;
    stateSub5D2A(state, rom, 0xffff, 0xffff, (_st, _y, _x, attr) => {
      // attr=0xA0 o 0x20 → cella sinistra; attr=0 → cella destra.
      order.push(attr === ATTR_RIGHT ? "R" : "L");
      toggle = !toggle;
      return 0;
    });
    expect(order).toHaveLength(32);
    for (let i = 0; i < 32; i += 2) {
      expect(order[i]).toBe("L");
      expect(order[i + 1]).toBe("R");
    }
  });
});
