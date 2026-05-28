/**
 * sync-av-toggle-1e08.test.ts — smoke + corner case di FUN_1E08.
 */

import { describe, it, expect } from "vitest";
import {
  syncAvToggle1E08,
  MMIO_AV_CONTROL_ADDR,
  DEFAULT_MAX_ITERATIONS,
} from "../src/sync-av-toggle-1e08.js";
import { emptyGameState } from "../src/state.js";

const PORT_OFF = 0x00; // *0x400000 (low byte at +1, BE)
const EDGE_PREV_OFF = 0x17c; // *0x40017C (BE word)
const FLAGS_OFF = 0x06; // *0x400006 (BE word)

describe("syncAvToggle1E08 (FUN_1E08)", () => {
  it("termina alla 1° iterazione: bit0(*0x400000)=1 e bit0(prev)=0", () => {
    const s = emptyGameState();
    // *0x400000.w = 0x0001 (bit 0 set, low2 = 1)
    s.workRam[PORT_OFF] = 0x00;
    s.workRam[PORT_OFF + 1] = 0x01;
    // *0x40017C.w = 0x0000 (bit 0 == 0 → rising edge bit 0 = 1)
    s.workRam[EDGE_PREV_OFF] = 0x00;
    s.workRam[EDGE_PREV_OFF + 1] = 0x00;
    // Event flag word: due 1-bit per coprire i 2 inner pop.
    s.workRam[FLAGS_OFF] = 0x00;
    s.workRam[FLAGS_OFF + 1] = 0b11; // bit 0 e bit 1 settati

    const writes: Array<{ addr: number; value: number }> = [];
    const result = syncAvToggle1E08(s, {
      onMmioWrite: (addr, value) => writes.push({ addr, value }),
    });

    expect(result.terminated).toBe(true);
    expect(result.iterations).toBe(1);
    // 2 pop totali (consumed entrambi i bit set, in 1 sola pop ciascuno).
    expect(result.flagPops).toBe(2);
    // 2 MMIO writes: 0x0000, then 0x0080.
    expect(writes).toEqual([
      { addr: MMIO_AV_CONTROL_ADDR, value: 0x0000 },
      { addr: MMIO_AV_CONTROL_ADDR, value: 0x0080 },
    ]);

    expect(s.workRam[EDGE_PREV_OFF]).toBe(0x00);
    expect(s.workRam[EDGE_PREV_OFF + 1]).toBe(0x01);
    // *0x400006 shifted right 2 volte: 0b11 → 0b00.
    expect(s.workRam[FLAGS_OFF]).toBe(0x00);
    expect(s.workRam[FLAGS_OFF + 1]).toBe(0x00);
  });

  it("salta zeri nella queue prima di trovare il bit 1 (bit 0 e bit 5 set)", () => {
    const s = emptyGameState();
    s.workRam[PORT_OFF] = 0x00;
    s.workRam[PORT_OFF + 1] = 0x01;
    // Queue: bit 0 set, bit 5 set, all others 0.
    // Pop sequence (lsr → bit 0 popped first):
    //   pop1 → 1 (bit 0). Queue ora 0b00100000 >> 0 wait: 0b100001 >>1 = 0b10000 → 0b00010000
    //   inner1 done. Then inner2:
    //   pop2 → 0 (bit 0 of 0b00010000 = 0). Queue >>= 1 → 0b00001000 (= 8)
    //   pop3 → 0 → 0b00000100 (= 4)
    //   pop4 → 0 → 0b00000010 (= 2)
    //   pop5 → 0 → 0b00000001 (= 1)
    //   pop6 → 1 (bit 0 of 1) → queue 0
    //   inner2 done.
    s.workRam[FLAGS_OFF] = 0x00;
    s.workRam[FLAGS_OFF + 1] = 0b00100001;

    const result = syncAvToggle1E08(s);
    expect(result.terminated).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.flagPops).toBe(6);
  });

  it("loop fino a maxIterations quando bit 0 di rising è 0 (bit 0 cur = 0)", () => {
    const s = emptyGameState();
    // *0x400000.w = 0x0002 (bit 0 = 0, bit 1 = 1)
    // -> rising bit 0 = 0 always, even with prev = 0.
    s.workRam[PORT_OFF] = 0x00;
    s.workRam[PORT_OFF + 1] = 0x02;
    // ⇒ 16 pop totali → ok. Limitiamo iterations a 5, flagPops large.
    s.workRam[FLAGS_OFF] = 0xff;
    s.workRam[FLAGS_OFF + 1] = 0xff;

    const writes: Array<{ value: number }> = [];
    const result = syncAvToggle1E08(s, {
      maxIterations: 5,
      onMmioWrite: (_addr, value) => writes.push({ value }),
    });

    expect(result.terminated).toBe(false);
    expect(result.iterations).toBe(5);
    expect(result.flagPops).toBe(10);
    // 5 iter × 2 write = 10 MMIO write
    expect(writes.length).toBe(10);
    // Pattern: 0,0x80,0,0x80,...
    for (let i = 0; i < 10; i++) {
      expect(writes[i]!.value).toBe(i % 2 === 0 ? 0x0000 : 0x0080);
    }
  });

  it("anche con bit 0 cur = 1 non termina se bit 0 prev = 1 (no rising)", () => {
    const s = emptyGameState();
    // *0x400000.w = 0x0001
    s.workRam[PORT_OFF] = 0x00;
    s.workRam[PORT_OFF + 1] = 0x01;
    // *0x40017C.w = 0x0001 → bit 0 prev = 1 → rising bit 0 = 0 (no transition).
    s.workRam[EDGE_PREV_OFF] = 0x00;
    s.workRam[EDGE_PREV_OFF + 1] = 0x01;
    // Queue full di 1
    s.workRam[FLAGS_OFF] = 0xff;
    s.workRam[FLAGS_OFF + 1] = 0xff;

    const result = syncAvToggle1E08(s, { maxIterations: 3 });
    expect(result.terminated).toBe(false);
    expect(result.iterations).toBe(3);
  });

  it("default maxIterations è 256", () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(256);
  });

  it("usa cap maxFlagPops difensivo se la queue è tutta zero", () => {
    const s = emptyGameState();
    // bit0(cur) = 1, bit0(prev) = 0 -> would terminate at the 1st iter, but
    s.workRam[PORT_OFF + 1] = 0x01;
    s.workRam[FLAGS_OFF] = 0x00;
    s.workRam[FLAGS_OFF + 1] = 0x00;

    const result = syncAvToggle1E08(s, {
      maxFlagPops: 50,
    });
    expect(result.terminated).toBe(false);
    expect(result.flagPops).toBe(50);
    expect(result.iterations).toBe(1);
  });
});
