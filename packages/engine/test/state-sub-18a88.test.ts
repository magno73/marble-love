/**
 * state-sub-18a88.test.ts — smoke test per `FUN_00018A88`.
 *
 * Verifica:
 *   - Total skip: count == 0 -> 1 particleInit + 1 vblank tick, nothing else.
 *   - Per-entity skip: entity[0x18] != 3 -> no body invoked for that entity.
 *   - Path completo: entity matched + count==1 → no renderTag, count-down
 *     until D4 <= 0, with coherent side-effect counter bytes.
 *   - 2-player: count==2 -> renderTag invoked, attr alternates 0x2000/0x2400.
 *   - Counter clamp: counterA > 99 → clamp a 99; counterB > 20 → clamp a 20.
 *   - D5/D6 swap: entity[0x19] == 0 → D5=0x1000, D6=0x1400; != 0 → invertito.
 */

import { describe, it, expect } from "vitest";
import {
  stateSub18A88,
  OBJ_BASE_ADDR,
  OBJ_STRIDE,
  OBJ_COUNT_OFF,
  OBJ_STATE_OFF,
  OBJ_PLAYER_ID_OFF,
  OBJ_COUNTER_A_OFF,
  OBJ_COUNTER_B_OFF,
  OBJ_TRIGGER_STATE,
  VBLANK_TICK_COUNTER_OFF,
  SUMMARY_COUNTER_OFF,
  PARTICLE_INIT_COUNT,
  PARTICLE_INIT_MODE,
  ATTR_PRIMARY,
  ATTR_SECONDARY,
  TAG_ATTR_PRIMARY,
  TAG_ATTR_SECONDARY,
  ROM_HEADER_STRING_1,
  ROM_HEADER_STRING_2,
  ROM_LABEL_BONUS,
  ROM_LABEL_TIME,
  ROM_TAG_TABLE,
  D4_INIT,
  D4_STEP,
  COUNTER_A_CLAMP,
  COUNTER_B_CLAMP,
  type StateSub18A88Subs,
} from "../src/state-sub-18a88.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;

function setByte(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = v & 0xff;
}

function setWordBE(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

function setLongBE(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

interface CallTrace {
  particleInit: Array<{ count: number; mode: number }>;
  clearAlphaTiles: number[];
  renderStringVia200: Array<{ entryPtr: number; attr: number }>;
  renderStringVia142: Array<{ entryPtr: number; attr: number }>;
  renderTag: Array<{ a1: number; a2: number; a3: number; a4: number }>;
  renderStringHelper: Array<number[]>;
  addToObjectAccum: Array<{ ptr: number; value: number }>;
  formatAndRender: Array<number[]>;
  waitVblankStateGated: number[];
}

function makeTracingSubs(): { subs: StateSub18A88Subs; trace: CallTrace } {
  const trace: CallTrace = {
    particleInit: [],
    clearAlphaTiles: [],
    renderStringVia200: [],
    renderStringVia142: [],
    renderTag: [],
    renderStringHelper: [],
    addToObjectAccum: [],
    formatAndRender: [],
    waitVblankStateGated: [],
  };
  const subs: StateSub18A88Subs = {
    particleInit: (_s, count, mode) => trace.particleInit.push({ count, mode }),
    clearAlphaTiles: (_s, startRow) => trace.clearAlphaTiles.push(startRow),
    renderStringVia200: (_s, entryPtr, attr) =>
      trace.renderStringVia200.push({ entryPtr, attr }),
    renderStringVia142: (_s, entryPtr, attr) =>
      trace.renderStringVia142.push({ entryPtr, attr }),
    renderTag: (_s, a1, a2, a3, a4) => trace.renderTag.push({ a1, a2, a3, a4 }),
    renderStringHelper: (_s, ...args) => trace.renderStringHelper.push(args),
    addToObjectAccum: (_s, ptr, value) => trace.addToObjectAccum.push({ ptr, value }),
    formatAndRender: (_s, ...args) => trace.formatAndRender.push(args),
    waitVblankStateGated: (_s, c) => trace.waitVblankStateGated.push(c),
  };
  return { subs, trace };
}

describe("stateSub18A88 (FUN_00018A88)", () => {
  it("count == 0: solo particleInit + 1 vblank tick, no body", () => {
    const s = emptyGameState();
    setWordBE(s, OBJ_COUNT_OFF, 0);
    const tickPre = s.workRam[VBLANK_TICK_COUNTER_OFF] ?? 0;
    const summaryPre = s.workRam[SUMMARY_COUNTER_OFF] ?? 0;

    const { subs, trace } = makeTracingSubs();
    const r = stateSub18A88(s, subs);

    expect(r.entityCount).toBe(0);
    expect(r.matchedCount).toBe(0);
    expect(r.matched).toHaveLength(0);

    // particleInit called exactly once with (0x1C, 0xFF).
    expect(trace.particleInit).toEqual([
      { count: PARTICLE_INIT_COUNT, mode: PARTICLE_INIT_MODE },
    ]);

    // Vblank counter +1 (pre-loop)
    expect(s.workRam[VBLANK_TICK_COUNTER_OFF]).toBe((tickPre + 1) & 0xff);
    // Summary counter intatto
    expect(s.workRam[SUMMARY_COUNTER_OFF]).toBe(summaryPre);

    // No other sub-call.
    expect(trace.clearAlphaTiles).toHaveLength(0);
    expect(trace.renderStringVia200).toHaveLength(0);
    expect(trace.renderStringVia142).toHaveLength(0);
    expect(trace.renderTag).toHaveLength(0);
    expect(trace.renderStringHelper).toHaveLength(0);
    expect(trace.addToObjectAccum).toHaveLength(0);
    expect(trace.formatAndRender).toHaveLength(0);
    expect(trace.waitVblankStateGated).toHaveLength(0);
  });

  it("count == 1, entity[0x18] != 3: skip body, niente render", () => {
    const s = emptyGameState();
    setWordBE(s, OBJ_COUNT_OFF, 1);
    const eOff = OBJ_BASE_ADDR - WORK_RAM_BASE;
    setByte(s, eOff + OBJ_STATE_OFF, 0x02); // != 3

    const { subs, trace } = makeTracingSubs();
    const r = stateSub18A88(s, subs);

    expect(r.matchedCount).toBe(0);
    expect(trace.particleInit).toHaveLength(1);
    expect(trace.clearAlphaTiles).toHaveLength(0);
    expect(trace.renderStringHelper).toHaveLength(0);
    // summary counter intatto
    expect(s.workRam[SUMMARY_COUNTER_OFF]).toBe(0);
    // vblank counter only +1 (pre-loop).
    expect(s.workRam[VBLANK_TICK_COUNTER_OFF]).toBe(1);
  });

  it("count == 1, entity[0x18] == 3, p1 (entity[0x19]==0): D5/D6 swap, no renderTag, count-down completo", () => {
    const s = emptyGameState();
    setWordBE(s, OBJ_COUNT_OFF, 1);
    const eOff = OBJ_BASE_ADDR - WORK_RAM_BASE;
    setByte(s, eOff + OBJ_STATE_OFF, OBJ_TRIGGER_STATE);
    setByte(s, eOff + OBJ_PLAYER_ID_OFF, 0); // p1
    // counterA = 5 (no clamp), counterB = 3 (no clamp)
    setWordBE(s, eOff + OBJ_COUNTER_A_OFF, 5);
    setWordBE(s, eOff + OBJ_COUNTER_B_OFF, 3);

    const { subs, trace } = makeTracingSubs();
    const r = stateSub18A88(s, subs);

    expect(r.matchedCount).toBe(1);
    const m = r.matched[0]!;
    // p1 → D5 = 0x1000, D6 = 0x1400
    expect(m.attrD5).toBe(ATTR_SECONDARY); // 0x1000
    expect(m.attrD6).toBe(ATTR_PRIMARY); // 0x1400
    expect(m.counterA).toBe(5);
    expect(m.counterB).toBe(3);
    // D4_initial = 20000 + 5*1000 - 3*1000 = 22000
    expect(m.d4Initial).toBe(22000);
    // count-down: 22000 / 250 = 88 (esatto, l'ultima iter porta D4 a 0)
    expect(m.countdownIterations).toBe(88);
    expect(m.renderTagCalls).toBe(0);

    // particleInit
    expect(trace.particleInit).toHaveLength(1);
    // clearAlphaTiles 1 volta
    expect(trace.clearAlphaTiles).toEqual([0]);
    // renderStringVia200 called 4 times (header1 + 2x BONUS labels = 3,
    // wait: header1 (1) + label BONUS (1) + label TIME (1) = 3, NON 4)
    // Verifica entry: [0x22B0A,0x1000], [0x22AF2,0x1000], [0x22AFE,0x1000]
    expect(trace.renderStringVia200).toEqual([
      { entryPtr: ROM_HEADER_STRING_1, attr: 0x1000 },
      { entryPtr: ROM_LABEL_BONUS, attr: 0x1000 },
      { entryPtr: ROM_LABEL_TIME, attr: 0x1000 },
    ]);
    // renderStringVia142 called once (header2 with D6=0x1400).
    expect(trace.renderStringVia142).toEqual([
      { entryPtr: ROM_HEADER_STRING_2, attr: 0x1400 },
    ]);
    // No renderTag (count != 2)
    expect(trace.renderTag).toHaveLength(0);

    // renderStringHelper called 3 + 88 = 91 times.
    // (counterA, counterA*1000, counterB, counterB*1000, D4-display) +
    // 88 count-down refresh
    // Wait: 5 fissi (a punti i,j,n,o,q) + 88 count-down = 93
    expect(trace.renderStringHelper).toHaveLength(5 + 88);

    // addToObjectAccum 88 times with (entityAddr, 250).
    expect(trace.addToObjectAccum).toHaveLength(88);
    expect(trace.addToObjectAccum[0]!.value).toBe(D4_STEP);
    expect(trace.addToObjectAccum[0]!.ptr).toBe(OBJ_BASE_ADDR);

    // formatAndRender 88 volte
    expect(trace.formatAndRender).toHaveLength(88);

    // waitVblankStateGated 88 + 1 volte (count=2 ×88, count=0x5A ×1)
    expect(trace.waitVblankStateGated).toHaveLength(89);
    expect(trace.waitVblankStateGated[88]).toBe(0x5a);
    for (let i = 0; i < 88; i++) {
      expect(trace.waitVblankStateGated[i]).toBe(2);
    }

    // Side effect counter byte:
    //   summary counter: +1 per entity matchata
    expect(s.workRam[SUMMARY_COUNTER_OFF]).toBe(1);
    //   vblank counter: 1 (pre-loop) + 3 (per entity matchata: c, l, r) = 4
    expect(s.workRam[VBLANK_TICK_COUNTER_OFF]).toBe(4);
  });

  it("count == 2: renderTag invocato 2 volte (alternando 0x2000/0x2400)", () => {
    const s = emptyGameState();
    setWordBE(s, OBJ_COUNT_OFF, 2);

    // Entity 0
    const e0Off = OBJ_BASE_ADDR - WORK_RAM_BASE;
    setByte(s, e0Off + OBJ_STATE_OFF, OBJ_TRIGGER_STATE);
    setByte(s, e0Off + OBJ_PLAYER_ID_OFF, 0);
    setWordBE(s, e0Off + OBJ_COUNTER_A_OFF, 0); // minimal
    setWordBE(s, e0Off + OBJ_COUNTER_B_OFF, 0);

    // Entity 1 (a OBJ_BASE_ADDR + 0xE2)
    const e1Off = e0Off + OBJ_STRIDE;
    setByte(s, e1Off + OBJ_STATE_OFF, OBJ_TRIGGER_STATE);
    setByte(s, e1Off + OBJ_PLAYER_ID_OFF, 1); // p2
    setWordBE(s, e1Off + OBJ_COUNTER_A_OFF, 0);
    setWordBE(s, e1Off + OBJ_COUNTER_B_OFF, 0);

    const { subs, trace } = makeTracingSubs();
    const r = stateSub18A88(s, subs);

    expect(r.matchedCount).toBe(2);
    expect(trace.renderTag).toHaveLength(2);
    // i==0 → tagAttr = 0x2000, i==1 → tagAttr = 0x2400
    expect(trace.renderTag[0]!.a1).toBe(ROM_TAG_TABLE + 0 * 4);
    expect(trace.renderTag[0]!.a2).toBe(0x0c);
    expect(trace.renderTag[0]!.a3).toBe(0x05);
    expect(trace.renderTag[0]!.a4).toBe(TAG_ATTR_PRIMARY);
    expect(trace.renderTag[1]!.a1).toBe(ROM_TAG_TABLE + 1 * 4);
    expect(trace.renderTag[1]!.a4).toBe(TAG_ATTR_SECONDARY);

    // Entity 0 (p1) → D5=0x1000, D6=0x1400
    expect(r.matched[0]!.attrD5).toBe(ATTR_SECONDARY);
    expect(r.matched[0]!.attrD6).toBe(ATTR_PRIMARY);
    // Entity 1 (p2) → D5=0x1400, D6=0x1000
    expect(r.matched[1]!.attrD5).toBe(ATTR_PRIMARY);
    expect(r.matched[1]!.attrD6).toBe(ATTR_SECONDARY);
  });

  it("counterA > 99 → clamp a 99; counterB > 20 → clamp a 20", () => {
    const s = emptyGameState();
    setWordBE(s, OBJ_COUNT_OFF, 1);
    const eOff = OBJ_BASE_ADDR - WORK_RAM_BASE;
    setByte(s, eOff + OBJ_STATE_OFF, OBJ_TRIGGER_STATE);
    setByte(s, eOff + OBJ_PLAYER_ID_OFF, 0);
    setWordBE(s, eOff + OBJ_COUNTER_A_OFF, 0x00ff); // 255 → clamp 99
    setWordBE(s, eOff + OBJ_COUNTER_B_OFF, 0x0064); // 100 → clamp 20

    const { subs } = makeTracingSubs();
    const r = stateSub18A88(s, subs);

    expect(r.matched[0]!.counterA).toBe(COUNTER_A_CLAMP); // 99
    expect(r.matched[0]!.counterB).toBe(COUNTER_B_CLAMP); // 20

    // D4_initial = 20000 + 99*1000 - 20*1000 = 99000
    expect(r.matched[0]!.d4Initial).toBe(D4_INIT + 99 * 1000 - 20 * 1000);
  });

  it("subs assente / parziale: no crash, counters byte aggiornati comunque", () => {
    const s = emptyGameState();
    setWordBE(s, OBJ_COUNT_OFF, 1);
    const eOff = OBJ_BASE_ADDR - WORK_RAM_BASE;
    setByte(s, eOff + OBJ_STATE_OFF, OBJ_TRIGGER_STATE);
    setByte(s, eOff + OBJ_PLAYER_ID_OFF, 0);
    setWordBE(s, eOff + OBJ_COUNTER_A_OFF, 1);
    setWordBE(s, eOff + OBJ_COUNTER_B_OFF, 0);

    expect(() => stateSub18A88(s)).not.toThrow();
    // 1 (pre-loop) + 3 (per entity) = 4
    expect(s.workRam[VBLANK_TICK_COUNTER_OFF]).toBe(4);
    expect(s.workRam[SUMMARY_COUNTER_OFF]).toBe(1);
  });

  it("entity[0xBC..0xBF] passato a formatAndRender bit-perfect", () => {
    const s = emptyGameState();
    setWordBE(s, OBJ_COUNT_OFF, 1);
    const eOff = OBJ_BASE_ADDR - WORK_RAM_BASE;
    setByte(s, eOff + OBJ_STATE_OFF, OBJ_TRIGGER_STATE);
    setByte(s, eOff + OBJ_PLAYER_ID_OFF, 0);
    setWordBE(s, eOff + OBJ_COUNTER_A_OFF, 1);
    setWordBE(s, eOff + OBJ_COUNTER_B_OFF, 0);
    // Prepopulate entity[0xBC..0xBF] = 0xCAFEBABE.
    setLongBE(s, eOff + 0xbc, 0xcafebabe);

    const { subs, trace } = makeTracingSubs();
    stateSub18A88(s, subs);

    // formatAndRender: arg1Long = entity[0xBC..0xBF] = 0xCAFEBABE
    expect(trace.formatAndRender.length).toBeGreaterThan(0);
    expect(trace.formatAndRender[0]![0]).toBe(0xcafebabe);
  });
});
