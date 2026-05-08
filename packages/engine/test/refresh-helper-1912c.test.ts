/**
 * refresh-helper-1912c.test.ts — smoke tests per `FUN_0001912C`.
 *
 * Verifica:
 *   - Gate: *0x400394.w != 4 → gatedOut senza side effects.
 *   - Slot scan: D3 flag alzato quando slot[0x18]==1 && slot[0x14..0x15]==0x3F6E && slot[0x1b]==1.
 *   - Entity loop con tutti i branch principali (threshold_only, state7_kind2_*,
 *     state7_kindx_*, not7_*).
 *   - Chiamata a fun_194ba e fun_199d6 corretta per ogni path.
 */

import { describe, it, expect } from "vitest";
import {
  refreshHelper1912C,
  ENTITY_TABLE_BASE,
  ENTITY_STRIDE,
  ENTITY_ACTIVE_OFFSET,
  ENTITY_KIND_OFFSET,
  ENTITY_STATE_OFFSET,
  ENTITY_ANIM_COUNTER_OFFSET,
  ENTITY_SCRIPT_PTR_OFFSET,
  ENTITY_SUB_COUNTER_OFFSET,
  ENTITY_DELTA_X_OFFSET,
  ENTITY_DELTA_Y_OFFSET,
  ENTITY_POS_X_OFFSET,
  ENTITY_POS_Y_OFFSET,
  SLOT_ARRAY_BASE,
  SLOT_STRIDE,
  GAME_MODE_WORD_OFF,
  SLOT_COUNT_WORD_OFF,
  STATE_TRIGGER,
  KIND_CLAMPED,
} from "../src/refresh-helper-1912c.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

function setByte(s: ReturnType<typeof emptyGameState>, addr: number, v: number): void {
  s.workRam[addr - 0x400000] = v & 0xff;
}

function readByte(s: ReturnType<typeof emptyGameState>, addr: number): number {
  return (s.workRam[addr - 0x400000] ?? 0) & 0xff;
}

function setWordBE(s: ReturnType<typeof emptyGameState>, addr: number, v: number): void {
  const o = addr - 0x400000;
  s.workRam[o] = (v >>> 8) & 0xff;
  s.workRam[o + 1] = v & 0xff;
}

function setLongBE(s: ReturnType<typeof emptyGameState>, addr: number, v: number): void {
  const o = addr - 0x400000;
  const x = v >>> 0;
  s.workRam[o] = (x >>> 24) & 0xff;
  s.workRam[o + 1] = (x >>> 16) & 0xff;
  s.workRam[o + 2] = (x >>> 8) & 0xff;
  s.workRam[o + 3] = x & 0xff;
}

function readLongBE(s: ReturnType<typeof emptyGameState>, addr: number): number {
  const o = addr - 0x400000;
  return (
    (((s.workRam[o] ?? 0) << 24) |
      ((s.workRam[o + 1] ?? 0) << 16) |
      ((s.workRam[o + 2] ?? 0) << 8) |
      (s.workRam[o + 3] ?? 0)) >>>
    0
  );
}

/** Build a GameState with game mode set to 4 and all entities inactive. */
function makeState(): ReturnType<typeof emptyGameState> {
  const s = emptyGameState();
  // Gate: *0x400394.w = 4
  s.workRam[GAME_MODE_WORD_OFF] = 0;
  s.workRam[GAME_MODE_WORD_OFF + 1] = 4;
  // Slot count: *0x400396.w = 0 (no slot scan by default)
  s.workRam[SLOT_COUNT_WORD_OFF] = 0;
  s.workRam[SLOT_COUNT_WORD_OFF + 1] = 0;
  return s;
}

/** Get m68k addr of entity i. */
function entityAddr(i: number): number {
  return ENTITY_TABLE_BASE + i * ENTITY_STRIDE;
}

describe("refreshHelper1912C (FUN_0001912C)", () => {
  it("gate: *0x400394 != 4 → gatedOut, no side effects", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[GAME_MODE_WORD_OFF] = 0;
    s.workRam[GAME_MODE_WORD_OFF + 1] = 3; // game mode = 3, not 4
    let called = false;
    const r = refreshHelper1912C(s, rom, {
      fun_194ba: () => { called = true; },
      fun_199d6: () => { called = true; },
    });
    expect(r.gatedOut).toBe(true);
    expect(r.slotFlagSet).toBe(false);
    expect(r.perEntity).toHaveLength(0);
    expect(called).toBe(false);
  });

  it("gate: *0x400394 == 4 → passes gate", () => {
    const s = makeState();
    const rom = emptyRomImage();
    const r = refreshHelper1912C(s, rom);
    expect(r.gatedOut).toBe(false);
    expect(r.perEntity).toHaveLength(9); // 9 entities always iterated
  });

  it("slot scan: D3 flag NOT set when no slots match (count=0)", () => {
    const s = makeState();
    const rom = emptyRomImage();
    // Slot count = 0 → no scanning
    const r = refreshHelper1912C(s, rom);
    expect(r.slotFlagSet).toBe(false);
  });

  it("slot scan: D3 flag set when one slot has all 3 conditions true", () => {
    const s = makeState();
    const rom = emptyRomImage();
    // slot count = 1
    setWordBE(s, 0x400000 + SLOT_COUNT_WORD_OFF, 1);
    const slotBase = SLOT_ARRAY_BASE;
    setByte(s, slotBase + 0x18, 1);       // slot[0x18] == 1
    setWordBE(s, slotBase + 0x14, 0x3f6e); // slot[0x14..0x15] == 0x3F6E
    setByte(s, slotBase + 0x1b, 1);        // slot[0x1b] == 1
    const r = refreshHelper1912C(s, rom);
    expect(r.slotFlagSet).toBe(true);
  });

  it("slot scan: D3 flag NOT set when slot[0x18] != 1", () => {
    const s = makeState();
    const rom = emptyRomImage();
    setWordBE(s, 0x400000 + SLOT_COUNT_WORD_OFF, 1);
    const slotBase = SLOT_ARRAY_BASE;
    setByte(s, slotBase + 0x18, 0);       // inactive
    setWordBE(s, slotBase + 0x14, 0x3f6e);
    setByte(s, slotBase + 0x1b, 1);
    const r = refreshHelper1912C(s, rom);
    expect(r.slotFlagSet).toBe(false);
  });

  it("slot scan: D3 flag NOT set when slot type word != 0x3F6E", () => {
    const s = makeState();
    const rom = emptyRomImage();
    setWordBE(s, 0x400000 + SLOT_COUNT_WORD_OFF, 1);
    const slotBase = SLOT_ARRAY_BASE;
    setByte(s, slotBase + 0x18, 1);
    setWordBE(s, slotBase + 0x14, 0xdead); // wrong type
    setByte(s, slotBase + 0x1b, 1);
    const r = refreshHelper1912C(s, rom);
    expect(r.slotFlagSet).toBe(false);
  });

  it("slot scan: second slot in sequence sets D3", () => {
    const s = makeState();
    const rom = emptyRomImage();
    // scan 2 slots
    setWordBE(s, 0x400000 + SLOT_COUNT_WORD_OFF, 2);
    // slot 0: inactive
    const slot0 = SLOT_ARRAY_BASE;
    setByte(s, slot0 + 0x18, 0);
    // slot 1: active + matching
    const slot1 = SLOT_ARRAY_BASE + SLOT_STRIDE;
    setByte(s, slot1 + 0x18, 1);
    setWordBE(s, slot1 + 0x14, 0x3f6e);
    setByte(s, slot1 + 0x1b, 1);
    const r = refreshHelper1912C(s, rom);
    expect(r.slotFlagSet).toBe(true);
  });

  it("entity: inactive entity (entity[0x18]==0) → no side effects, wasActive=false", () => {
    const s = makeState();
    const rom = emptyRomImage();
    // All entities inactive by default (workRam is zeroed)
    let calls = 0;
    const r = refreshHelper1912C(s, rom, {
      fun_194ba: () => { calls++; },
      fun_199d6: () => { calls++; },
    });
    expect(r.gatedOut).toBe(false);
    expect(r.perEntity).toHaveLength(9);
    for (const rec of r.perEntity) {
      expect(rec.wasActive).toBe(false);
      expect(rec.branch).toBeNull();
    }
    expect(calls).toBe(0);
  });

  it("entity threshold_only: D0=3 > entity[0x24]=0 → only fun_199d6 called", () => {
    const s = makeState();
    const rom = emptyRomImage();
    const addr = entityAddr(0);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);  // active
    setByte(s, addr + ENTITY_KIND_OFFSET, 0);    // kind=0, threshold=3
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 0); // counter=0 → after ++: 1
    // D0=3 > 1 signed → threshold_only
    let v2Calls = 0;
    let dispCalls = 0;
    const r = refreshHelper1912C(s, rom, {
      fun_194ba: (_st, a) => {
        expect(a).toBe(addr);
        dispCalls++;
      },
      fun_199d6: (_st, a) => {
        expect(a).toBe(addr);
        v2Calls++;
      },
    });
    const rec = r.perEntity[0]!;
    expect(rec.wasActive).toBe(true);
    expect(rec.branch).toBe("threshold_only");
    expect(v2Calls).toBe(1);
    expect(dispCalls).toBe(0);
    // counter was incremented to 1
    expect(readByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET)).toBe(1);
  });

  it("entity threshold_only kind==1 with D3=1 (slot flag set): kindAfter=1, threshold=1, counter=0 → after++:1, 1>1 false → not7_cont", () => {
    const s = makeState();
    const rom = emptyRomImage();
    // Set D3=1 via slot scan so that entity[0x1A] = 1 after the D3 write.
    setWordBE(s, 0x400000 + SLOT_COUNT_WORD_OFF, 1);
    const slotBase = SLOT_ARRAY_BASE;
    setByte(s, slotBase + 0x18, 1);
    setWordBE(s, slotBase + 0x14, 0x3f6e);
    setByte(s, slotBase + 0x1b, 1);

    const addr = entityAddr(0);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);
    // kind=0 initially (not 2 → D3=1 written → kindAfter=1 → threshold=1)
    setByte(s, addr + ENTITY_KIND_OFFSET, 0);
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 0); // → 1 after++
    // D0=1, counter=1. 1>1 signed? No → not threshold_only → proceeds.
    // state=0 (not 7) → not7_* ; script ptr=0→4, ROM[4..7]=0 → not7_cont
    let v2Calls = 0;
    const r = refreshHelper1912C(s, rom, {
      fun_199d6: () => { v2Calls++; },
    });
    const rec = r.perEntity[0]!;
    expect(rec.wasActive).toBe(true);
    expect(rec.branch).toBe("not7_cont");
    expect(v2Calls).toBe(1);
  });

  it("entity: D3 flag written to entity[0x1A] when kind != 2", () => {
    const s = makeState();
    const rom = emptyRomImage();
    // Set D3 via slot scan
    setWordBE(s, 0x400000 + SLOT_COUNT_WORD_OFF, 1);
    const slotBase = SLOT_ARRAY_BASE;
    setByte(s, slotBase + 0x18, 1);
    setWordBE(s, slotBase + 0x14, 0x3f6e);
    setByte(s, slotBase + 0x1b, 1);

    const addr = entityAddr(0);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);
    setByte(s, addr + ENTITY_KIND_OFFSET, 0); // kind=0, not 2 → D3 written
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 0);

    refreshHelper1912C(s, rom);

    // D3=1 was written to entity[0x1A]
    expect(readByte(s, addr + ENTITY_KIND_OFFSET)).toBe(1);
  });

  it("entity: D3 NOT written when entity[0x1A] == 2 (KIND_CLAMPED)", () => {
    const s = makeState();
    const rom = emptyRomImage();
    // D3 = 1 via slot
    setWordBE(s, 0x400000 + SLOT_COUNT_WORD_OFF, 1);
    const slotBase = SLOT_ARRAY_BASE;
    setByte(s, slotBase + 0x18, 1);
    setWordBE(s, slotBase + 0x14, 0x3f6e);
    setByte(s, slotBase + 0x1b, 1);

    const addr = entityAddr(0);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);
    setByte(s, addr + ENTITY_KIND_OFFSET, KIND_CLAMPED); // == 2 → guard
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 5);   // counter=5, after++: 6

    // With kind=2 and state!=7: threshold=3. D0=3 > 6 (signed)? No.
    // → proceed: clear counter, state != 7 → not7_*
    refreshHelper1912C(s, rom);

    // D3 NOT written: kind still 2
    expect(readByte(s, addr + ENTITY_KIND_OFFSET)).toBe(KIND_CLAMPED);
  });

  it("entity state7_kind2_term: state==7, kind==2, [ptr]==0xFFFF_FFFF → fun_194ba + fun_199d6", () => {
    const s = makeState();
    const rom = emptyRomImage();
    const addr = entityAddr(3);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);
    setByte(s, addr + ENTITY_STATE_OFFSET, STATE_TRIGGER);      // state == 7
    setByte(s, addr + ENTITY_KIND_OFFSET, KIND_CLAMPED);        // kind == 2
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 5);           // counter=5, after++: 6
    // threshold: kind=2 → D0=3. 3 > 6? No. → proceed.
    // script ptr = 0x00 → after +4: 0x04. ROM[0x04..0x07] defaults to ROM content.
    // Force ROM at offset 4 to be 0xFFFFFFFF:
    rom.program[4] = 0xff;
    rom.program[5] = 0xff;
    rom.program[6] = 0xff;
    rom.program[7] = 0xff;
    setLongBE(s, addr + ENTITY_SCRIPT_PTR_OFFSET, 0x00000000); // starts at 0 → +4 = 4

    let v2Addr = 0;
    let dispAddr = 0;
    const r = refreshHelper1912C(s, rom, {
      fun_194ba: (_st, a) => { dispAddr = a; },
      fun_199d6: (_st, a) => { v2Addr = a; },
    });
    const rec = r.perEntity[3]!;
    expect(rec.branch).toBe("state7_kind2_term");
    expect(dispAddr).toBe(addr);
    expect(v2Addr).toBe(addr);
    // Script ptr advanced by 4
    expect(readLongBE(s, addr + ENTITY_SCRIPT_PTR_OFFSET)).toBe(4);
  });

  it("entity state7_kind2_cont: state==7, kind==2, [ptr]!=0xFFFF_FFFF → only fun_199d6", () => {
    const s = makeState();
    const rom = emptyRomImage();
    const addr = entityAddr(2);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);
    setByte(s, addr + ENTITY_STATE_OFFSET, STATE_TRIGGER);
    setByte(s, addr + ENTITY_KIND_OFFSET, KIND_CLAMPED);
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 5);
    // ROM at 4 = 0x00000000 (not terminator)
    rom.program[4] = 0;
    rom.program[5] = 0;
    rom.program[6] = 0;
    rom.program[7] = 0;
    setLongBE(s, addr + ENTITY_SCRIPT_PTR_OFFSET, 0x00000000);

    let dispCalls = 0;
    let v2Calls = 0;
    const r = refreshHelper1912C(s, rom, {
      fun_194ba: () => { dispCalls++; },
      fun_199d6: () => { v2Calls++; },
    });
    const rec = r.perEntity[2]!;
    expect(rec.branch).toBe("state7_kind2_cont");
    expect(dispCalls).toBe(0);
    expect(v2Calls).toBe(1);
  });

  it("entity state7_kindx_lt4: state==7, kind!=2, sub_counter<4 → only fun_199d6", () => {
    const s = makeState();
    const rom = emptyRomImage();
    const addr = entityAddr(1);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);
    setByte(s, addr + ENTITY_STATE_OFFSET, STATE_TRIGGER);
    setByte(s, addr + ENTITY_KIND_OFFSET, 0);    // kind=0 (not 2)
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 5); // 5+1=6 > 3? No (6 > 3 = yes, threshold_only)
    // Adjust so threshold_only is NOT taken: counter=0 → after++: 1. threshold=3. 3>1 → threshold_only.
    // We need counter to be high enough. Use counter=2 → after++:3. D0=3>3? No (not >).
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 2); // → 3 after++, 3>3 = false
    setByte(s, addr + ENTITY_SUB_COUNTER_OFFSET, 2); // sub_counter=2, after++: 3 < 4
    setLongBE(s, addr + ENTITY_DELTA_X_OFFSET, 0x100);
    setLongBE(s, addr + ENTITY_POS_X_OFFSET, 0x200);
    setLongBE(s, addr + ENTITY_DELTA_Y_OFFSET, 0x50);
    setLongBE(s, addr + ENTITY_POS_Y_OFFSET, 0x150);

    let dispCalls = 0;
    let v2Calls = 0;
    const r = refreshHelper1912C(s, rom, {
      fun_194ba: () => { dispCalls++; },
      fun_199d6: () => { v2Calls++; },
    });
    const rec = r.perEntity[1]!;
    expect(rec.branch).toBe("state7_kindx_lt4");
    expect(dispCalls).toBe(0);
    expect(v2Calls).toBe(1);
    // Position updates applied
    expect(readLongBE(s, addr + ENTITY_POS_X_OFFSET)).toBe(0x300);
    expect(readLongBE(s, addr + ENTITY_POS_Y_OFFSET)).toBe(0x1a0);
    // Sub counter incremented: 2→3
    expect(readByte(s, addr + ENTITY_SUB_COUNTER_OFFSET)).toBe(3);
    // Anim counter reset
    expect(readByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET)).toBe(0);
  });

  it("entity state7_kindx_ge4: state==7, kind!=2, sub_counter>=4 → fun_194ba + fun_199d6 + clear", () => {
    const s = makeState();
    const rom = emptyRomImage();
    const addr = entityAddr(4);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);
    setByte(s, addr + ENTITY_STATE_OFFSET, STATE_TRIGGER);
    setByte(s, addr + ENTITY_KIND_OFFSET, 0);
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 2); // → 3 after++, 3 not > 3
    setByte(s, addr + ENTITY_SUB_COUNTER_OFFSET, 3); // → 4 after++, 4 >= 4
    setLongBE(s, addr + ENTITY_DELTA_X_OFFSET, 0x10);
    setLongBE(s, addr + ENTITY_POS_X_OFFSET, 0x00);
    setLongBE(s, addr + ENTITY_DELTA_Y_OFFSET, 0x20);
    setLongBE(s, addr + ENTITY_POS_Y_OFFSET, 0x00);

    let dispCalls = 0;
    let v2Calls = 0;
    const r = refreshHelper1912C(s, rom, {
      fun_194ba: () => { dispCalls++; },
      fun_199d6: () => { v2Calls++; },
    });
    const rec = r.perEntity[4]!;
    expect(rec.branch).toBe("state7_kindx_ge4");
    expect(dispCalls).toBe(1);
    expect(v2Calls).toBe(1);
    // Sub counter cleared after >= 4
    expect(readByte(s, addr + ENTITY_SUB_COUNTER_OFFSET)).toBe(0);
    expect(readLongBE(s, addr + ENTITY_POS_X_OFFSET)).toBe(0x10);
    expect(readLongBE(s, addr + ENTITY_POS_Y_OFFSET)).toBe(0x20);
  });

  it("entity not7_term: state!=7, [ptr+4]==0xFFFF_FFFF → pos update + fun_194ba + fun_199d6", () => {
    const s = makeState();
    const rom = emptyRomImage();
    const addr = entityAddr(0);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);
    setByte(s, addr + ENTITY_STATE_OFFSET, 3);   // state = 3, != 7
    setByte(s, addr + ENTITY_KIND_OFFSET, 0);
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 2); // → 3 after++, 3 not > 3
    setLongBE(s, addr + ENTITY_DELTA_X_OFFSET, 0xaabb);
    setLongBE(s, addr + ENTITY_POS_X_OFFSET, 0x1000);
    setLongBE(s, addr + ENTITY_DELTA_Y_OFFSET, 0xccdd);
    setLongBE(s, addr + ENTITY_POS_Y_OFFSET, 0x2000);
    // script ptr = 0 → after +4: 4 → ROM[4..7] = 0xFFFFFFFF
    rom.program[4] = 0xff;
    rom.program[5] = 0xff;
    rom.program[6] = 0xff;
    rom.program[7] = 0xff;
    setLongBE(s, addr + ENTITY_SCRIPT_PTR_OFFSET, 0);

    let dispCalls = 0;
    let v2Calls = 0;
    const r = refreshHelper1912C(s, rom, {
      fun_194ba: () => { dispCalls++; },
      fun_199d6: () => { v2Calls++; },
    });
    const rec = r.perEntity[0]!;
    expect(rec.branch).toBe("not7_term");
    expect(dispCalls).toBe(1);
    expect(v2Calls).toBe(1);
    expect(readLongBE(s, addr + ENTITY_POS_X_OFFSET)).toBe(0x1000 + 0xaabb);
    expect(readLongBE(s, addr + ENTITY_POS_Y_OFFSET)).toBe(0x2000 + 0xccdd);
    expect(readLongBE(s, addr + ENTITY_SCRIPT_PTR_OFFSET)).toBe(4);
  });

  it("entity not7_cont: state!=7, [ptr+4]!=0xFFFF_FFFF → only fun_199d6", () => {
    const s = makeState();
    const rom = emptyRomImage();
    const addr = entityAddr(0);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);
    setByte(s, addr + ENTITY_STATE_OFFSET, 5);
    setByte(s, addr + ENTITY_KIND_OFFSET, 0);
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 2); // → 3, not > 3
    setLongBE(s, addr + ENTITY_SCRIPT_PTR_OFFSET, 0);
    // ROM[4..7] = 0 → not terminator
    rom.program[4] = 0;
    rom.program[5] = 0;
    rom.program[6] = 0;
    rom.program[7] = 0;

    let dispCalls = 0;
    let v2Calls = 0;
    const r = refreshHelper1912C(s, rom, {
      fun_194ba: () => { dispCalls++; },
      fun_199d6: () => { v2Calls++; },
    });
    const rec = r.perEntity[0]!;
    expect(rec.branch).toBe("not7_cont");
    expect(dispCalls).toBe(0);
    expect(v2Calls).toBe(1);
  });

  it("subs absent → no crash, all callbacks skipped silently", () => {
    const s = makeState();
    const rom = emptyRomImage();
    const addr = entityAddr(0);
    setByte(s, addr + ENTITY_ACTIVE_OFFSET, 1);
    setByte(s, addr + ENTITY_STATE_OFFSET, STATE_TRIGGER);
    setByte(s, addr + ENTITY_KIND_OFFSET, 0);
    setByte(s, addr + ENTITY_ANIM_COUNTER_OFFSET, 2);
    setByte(s, addr + ENTITY_SUB_COUNTER_OFFSET, 3);
    expect(() => refreshHelper1912C(s, rom)).not.toThrow();
  });

  it("all 9 entities processed: perEntity length == 9", () => {
    const s = makeState();
    const rom = emptyRomImage();
    const r = refreshHelper1912C(s, rom);
    expect(r.perEntity).toHaveLength(9);
    for (let i = 0; i < 9; i++) {
      expect(r.perEntity[i]!.slot).toBe(i);
    }
  });
});
