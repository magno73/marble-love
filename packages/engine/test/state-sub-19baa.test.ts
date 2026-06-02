/**
 * state-sub-19baa.test.ts — smoke + corner case of `FUN_00019BAA`
 * (per-frame entity tick).
 */

import { describe, it, expect } from "vitest";
import {
  stateSub19BAA,
  ENTITY_TABLE_BASE,
  ENTITY_STRIDE,
  GAME_MODE_WORD_OFF,
  GAME_MODE_REQUIRED,
  SPAWN_ENABLE_BYTE_OFF,
  FRAME_COUNTER_LONG_OFF,
  ENTITY_ACTIVE_OFFSET,
  ENTITY_ANIM_COUNTER_OFFSET,
  ENTITY_STATE_OFFSET,
  ENTITY_SUBSTATE_OFFSET,
  ENTITY_TIMER_OFFSET,
  ENTITY_SCRIPT_PTR_OFFSET,
  ENTITY_VEL_OFFSET,
  ENTITY_POS_X_OFFSET,
  ENTITY_POS_Y_OFFSET,
  ENTITY_POS_Z_OFFSET,
  ENTITY_SCREEN_Y_OFFSET,
  ENTITY_KEY19_OFFSET,
  SCRIPT_PTR_RESET,
  SCRIPT_PTR_CLAMP,
  VEL_PIVOT_IF,
  VEL_IF_SET,
  VEL_ELSE_SET,
  STATE_IF,
  STATE_ELSE,
  SUBSTATE_CLAMPED,
  Y_CLAMP_MASK,
  SOUND_TRIGGER_ARG,
  FUN_18F46_ARG1,
} from "../src/state-sub-19baa.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

function ENTITY_OFF(slot: number): number {
  return (ENTITY_TABLE_BASE - 0x400000) + slot * ENTITY_STRIDE;
}

function writeLong(
  s: ReturnType<typeof emptyGameState>,
  off: number,
  v: number,
): void {
  const x = v >>> 0;
  s.workRam[off] = (x >>> 24) & 0xff;
  s.workRam[off + 1] = (x >>> 16) & 0xff;
  s.workRam[off + 2] = (x >>> 8) & 0xff;
  s.workRam[off + 3] = x & 0xff;
}

function writeWord(
  s: ReturnType<typeof emptyGameState>,
  off: number,
  v: number,
): void {
  const x = v & 0xffff;
  s.workRam[off] = (x >>> 8) & 0xff;
  s.workRam[off + 1] = x & 0xff;
}

function readLong(
  s: ReturnType<typeof emptyGameState>,
  off: number,
): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

describe("stateSub19BAA (FUN_00019BAA)", () => {
  it("gate-out: word @ 0x394 != 4 → no-op (return early)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Prepopulate an active entity: it must remain unchanged.
    s.workRam[ENTITY_OFF(0) + ENTITY_ACTIVE_OFFSET] = 1;
    s.workRam[ENTITY_OFF(0) + ENTITY_ANIM_COUNTER_OFFSET] = 0xaa;
    writeWord(s, GAME_MODE_WORD_OFF, 3);

    const result = stateSub19BAA(s, rom);
    expect(result.gatedOut).toBe(true);
    expect(result.spawnDispatched).toBe(false);
    expect(result.perEntity).toEqual([]);
    // Entity unchanged.
    expect(s.workRam[ENTITY_OFF(0) + ENTITY_ANIM_COUNTER_OFFSET]).toBe(0xaa);
  });

  it("spawn dispatcher gated: enable=0 → no call; enable=1 + frame&7==0 → call", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeWord(s, GAME_MODE_WORD_OFF, GAME_MODE_REQUIRED);

    // Case 1: enable=0
    s.workRam[SPAWN_ENABLE_BYTE_OFF] = 0;
    writeLong(s, FRAME_COUNTER_LONG_OFF, 0);
    let calls = 0;
    let r = stateSub19BAA(s, rom, { fun_19a40: () => { calls++; } });
    expect(r.spawnDispatched).toBe(false);
    expect(calls).toBe(0);

    // Case 2: enable=1, frame=8 (low 3 bits = 0)
    s.workRam[SPAWN_ENABLE_BYTE_OFF] = 1;
    writeLong(s, FRAME_COUNTER_LONG_OFF, 8);
    calls = 0;
    r = stateSub19BAA(s, rom, { fun_19a40: () => { calls++; } });
    expect(r.spawnDispatched).toBe(true);
    expect(calls).toBe(1);

    // Case 3: enable=1, frame=9 (low 3 bits != 0)
    s.workRam[SPAWN_ENABLE_BYTE_OFF] = 1;
    writeLong(s, FRAME_COUNTER_LONG_OFF, 9);
    calls = 0;
    r = stateSub19BAA(s, rom, { fun_19a40: () => { calls++; } });
    expect(r.spawnDispatched).toBe(false);
    expect(calls).toBe(0);
  });

  it("inactive entity (entity[0x18] == 0) → skip without side effect", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeWord(s, GAME_MODE_WORD_OFF, GAME_MODE_REQUIRED);

    // Slot 0: inactive.
    s.workRam[ENTITY_OFF(0) + ENTITY_ACTIVE_OFFSET] = 0;
    s.workRam[ENTITY_OFF(0) + ENTITY_ANIM_COUNTER_OFFSET] = 0xaa;

    const result = stateSub19BAA(s, rom);
    expect(result.gatedOut).toBe(false);
    expect(result.perEntity[0]?.wasActive).toBe(false);
    // Counter unchanged.
    expect(s.workRam[ENTITY_OFF(0) + ENTITY_ANIM_COUNTER_OFFSET]).toBe(0xaa);
  });

  it("active entity with state>counter+1 → bgt (skip script-advance), enters movement-block (substate=0)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeWord(s, GAME_MODE_WORD_OFF, GAME_MODE_REQUIRED);

    const off = ENTITY_OFF(0);
    s.workRam[off + ENTITY_ACTIVE_OFFSET] = 1;
    s.workRam[off + ENTITY_ANIM_COUNTER_OFFSET] = 5;
    s.workRam[off + ENTITY_STATE_OFFSET] = 10; // 10 > 6 (5+1) → bgt true
    s.workRam[off + ENTITY_SUBSTATE_OFFSET] = 0; // movement enabled
    writeLong(s, off + ENTITY_VEL_OFFSET, 0); // no Y delta
    writeLong(s, off + ENTITY_POS_Y_OFFSET, 0x10000);
    writeLong(s, off + ENTITY_POS_Z_OFFSET, 0x7fffffff); // huge depth

    let bb08Calls = 0;
    let cc62Calls = 0;
    let e42Calls = 0;
    const result = stateSub19BAA(s, rom, {
      fun_1bb08: () => { bb08Calls++; },
      fun_1cc62: () => { cc62Calls++; return 0; },
      fun_19e42: () => { e42Calls++; },
    });

    // Counter incremented to 6.
    expect(s.workRam[off + ENTITY_ANIM_COUNTER_OFFSET]).toBe(6);
    expect(result.perEntity[0]?.scriptAdvanced).toBe(false);
    expect(result.perEntity[0]?.enteredMovement).toBe(true);
    expect(result.perEntity[0]?.yClamped).toBe(false);
    expect(bb08Calls).toBe(1);
    expect(cc62Calls).toBe(1);
    expect(e42Calls).toBe(1);
  });

  it("Y-clamp: cc62Result > entity[0x14] → restore masked Y + arm D3 sound", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeWord(s, GAME_MODE_WORD_OFF, GAME_MODE_REQUIRED);

    const off = ENTITY_OFF(0);
    s.workRam[off + ENTITY_ACTIVE_OFFSET] = 1;
    s.workRam[off + ENTITY_ANIM_COUNTER_OFFSET] = 5;
    s.workRam[off + ENTITY_STATE_OFFSET] = 10; // bgt → movement
    s.workRam[off + ENTITY_SUBSTATE_OFFSET] = 0;
    writeLong(s, off + ENTITY_VEL_OFFSET, 0); // no Y delta
    const savedY = 0x12345678;
    writeLong(s, off + ENTITY_POS_Y_OFFSET, savedY);
    writeLong(s, off + ENTITY_POS_Z_OFFSET, 0x100); // small depth

    // Slot screen-Y in the range [0, 0xF0). X.w >> 3 < 0x35.
    // X.w = 0x0008 → asr 3 = 0x0001 < 0x35 OK.
    writeWord(s, off + ENTITY_POS_X_OFFSET, 0x0008);
    writeWord(s, off + ENTITY_SCREEN_Y_OFFSET, 0x0040); // 0 ≤ 0x40 < 0xF0

    let soundArg = -1;
    const result = stateSub19BAA(s, rom, {
      fun_1cc62: () => 0x200, // > 0x100 (depth) → trigger Y-clamp
      fun_158ac: (_st, arg) => { soundArg = arg; },
    });

    expect(result.perEntity[0]?.yClamped).toBe(true);
    // Masked Y: savedY & 0xFFFC0000.
    expect(readLong(s, off + ENTITY_POS_Y_OFFSET)).toBe((savedY & Y_CLAMP_MASK) >>> 0);
    expect(readLong(s, off + ENTITY_SCRIPT_PTR_OFFSET)).toBe(SCRIPT_PTR_CLAMP);
    expect(s.workRam[off + ENTITY_ANIM_COUNTER_OFFSET]).toBe(0);
    expect(s.workRam[off + ENTITY_STATE_OFFSET]).toBe(STATE_IF);
    expect(s.workRam[off + ENTITY_SUBSTATE_OFFSET]).toBe(SUBSTATE_CLAMPED);
    expect(result.perEntity[0]?.soundFired).toBe(true);
    expect(soundArg).toBe(SOUND_TRIGGER_ARG);
  });

  it("script-advance + terminator -1 in ROM + scan finds no match → state-branch 'else'", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeWord(s, GAME_MODE_WORD_OFF, GAME_MODE_REQUIRED);

    // Inject terminator -1 into ROM @ 0x10000.
    rom.program[0x10000] = 0xff;
    rom.program[0x10001] = 0xff;
    rom.program[0x10002] = 0xff;
    rom.program[0x10003] = 0xff;

    const off = ENTITY_OFF(0);
    s.workRam[off + ENTITY_ACTIVE_OFFSET] = 1;
    s.workRam[off + ENTITY_ANIM_COUNTER_OFFSET] = 5;
    // state == 5 → counter incremented a 6, cmp.b: 5 - 6 = -1 (< 0) → bgt false → script-advance
    s.workRam[off + ENTITY_STATE_OFFSET] = 5;
    s.workRam[off + ENTITY_SUBSTATE_OFFSET] = 0; // != 2 → enters scan-block
    s.workRam[off + ENTITY_TIMER_OFFSET] = 1; // dec → 0 → state branch
    writeLong(s, off + ENTITY_SCRIPT_PTR_OFFSET, 0x0000fffc); // +4 → 0x10000 (terminator)
    writeLong(s, off + ENTITY_VEL_OFFSET, 0xdeadbeef); // != 0xFFFE0000 → else branch

    const result = stateSub19BAA(s, rom);

    expect(result.perEntity[0]?.scriptAdvanced).toBe(true);
    expect(result.perEntity[0]?.enteredScanBlock).toBe(true);
    expect(result.perEntity[0]?.enteredStateBranch).toBe(true);
    expect(result.perEntity[0]?.ifBranchTaken).toBe(false);
    expect(s.workRam[off + ENTITY_STATE_OFFSET]).toBe(STATE_ELSE);
    expect(readLong(s, off + ENTITY_VEL_OFFSET)).toBe(VEL_ELSE_SET);
    expect(readLong(s, off + ENTITY_SCRIPT_PTR_OFFSET)).toBe(SCRIPT_PTR_RESET);
    expect(s.workRam[off + ENTITY_SUBSTATE_OFFSET]).toBe(0);
  });

  it("script-advance + terminator + scan no-match + vel == 0xFFFE0000 → state-branch 'if'", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeWord(s, GAME_MODE_WORD_OFF, GAME_MODE_REQUIRED);

    rom.program[0x10000] = 0xff;
    rom.program[0x10001] = 0xff;
    rom.program[0x10002] = 0xff;
    rom.program[0x10003] = 0xff;

    const off = ENTITY_OFF(0);
    s.workRam[off + ENTITY_ACTIVE_OFFSET] = 1;
    s.workRam[off + ENTITY_ANIM_COUNTER_OFFSET] = 5;
    s.workRam[off + ENTITY_STATE_OFFSET] = 5;
    s.workRam[off + ENTITY_SUBSTATE_OFFSET] = 0;
    s.workRam[off + ENTITY_TIMER_OFFSET] = 1;
    writeLong(s, off + ENTITY_SCRIPT_PTR_OFFSET, 0x0000fffc);
    writeLong(s, off + ENTITY_VEL_OFFSET, VEL_PIVOT_IF); // == 0xFFFE0000 → if branch (D4 stays 1)

    const result = stateSub19BAA(s, rom);

    expect(result.perEntity[0]?.ifBranchTaken).toBe(true);
    expect(s.workRam[off + ENTITY_STATE_OFFSET]).toBe(STATE_IF);
    expect(readLong(s, off + ENTITY_VEL_OFFSET)).toBe(VEL_IF_SET);
  });

  it("recheck path (substate==2) + terminator → clr.b active + jsr fun_18f46(0xF, sext_l(byte))", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeWord(s, GAME_MODE_WORD_OFF, GAME_MODE_REQUIRED);

    rom.program[0x10000] = 0xff;
    rom.program[0x10001] = 0xff;
    rom.program[0x10002] = 0xff;
    rom.program[0x10003] = 0xff;

    const off = ENTITY_OFF(0);
    s.workRam[off + ENTITY_ACTIVE_OFFSET] = 1;
    s.workRam[off + ENTITY_ANIM_COUNTER_OFFSET] = 5;
    s.workRam[off + ENTITY_STATE_OFFSET] = 5;
    s.workRam[off + ENTITY_SUBSTATE_OFFSET] = SUBSTATE_CLAMPED; // == 2 → recheck path
    writeLong(s, off + ENTITY_SCRIPT_PTR_OFFSET, 0x0000fffc); // +4 → 0x10000 (terminator)
    s.workRam[off + ENTITY_KEY19_OFFSET] = 0x80; // sign-ext → -128

    const calls: Array<[number, number]> = [];
    stateSub19BAA(s, rom, {
      fun_18f46: (_st, a, b) => { calls.push([a, b]); },
    });

    // Active cleared.
    expect(s.workRam[off + ENTITY_ACTIVE_OFFSET]).toBe(0);
    expect(calls.length).toBe(1);
    expect(calls[0]?.[0]).toBe(FUN_18F46_ARG1);
    expect(calls[0]?.[1]).toBe(-128); // sext_l(0x80)
  });
});
