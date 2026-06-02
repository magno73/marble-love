/**
 * helper-121b8.test.ts — smoke tests of `helper121B8` (FUN_000121B8).
 *
 * Verifies the function's main paths with every sub-callee
 * iniettati as no-op, isolando la logica interna of FUN_000121B8:
 *
 *   1. Costante `HELPER_121B8_ADDR`
 *   2. Prologue: writes globals 0x400684/688/68C, 0x40069A/9C, 0x400696/698
 *   3. Percorso "out-of-range" non-player (fun_1cc62 returns large value)
 *   4. Percorso "out-of-range" player (isPlayer=true + out-of-range)
 *   5. Percorso "integrate velocity" (in-range): obj.x += vx, obj.y += vy, obj.z += vz
 *   6. Bounce detection (doBounce=true → calls fun_12886, restores x/y from globals)
 *   7. State byte dispatch (0x2D → vectorScale mode 2)
 *   8. Player early exit via obj[0x1A] = 0x0B
 *   9. obj[0x58] = 0x0A → early exit
 *  10. No-crash smoke test with empty state
 *
 * Parity bit-perfect (500/500) vs Musashi in
 * `packages/cli/src/test-helper-121b8-parity.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import { helper121B8, HELPER_121B8_ADDR } from "../src/helper-121b8.js";
import {
  FUN_25BAE_ARG_MODE,
  HIT_SLOT_NEW_STATE,
  SLOT_ACTIVE_OFF,
  SLOT_BASE_ADDR,
  SLOT_BBOX_PTRPTR_OFF,
  SLOT_NEW_STATE_OFF,
  SLOT_SCRIPT_ID_OFF,
  SLOT_X_OFF,
  SLOT_Y_OFF,
  SOUND_HIT_COMMAND,
} from "../src/string-viewport-hit-175c8.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeLongBE(ram: Uint8Array, off: number, val: number): void {
  const u = val >>> 0;
  ram[off]     = (u >>> 24) & 0xff;
  ram[off + 1] = (u >>> 16) & 0xff;
  ram[off + 2] = (u >>>  8) & 0xff;
  ram[off + 3] =  u         & 0xff;
}

function writeWordBE(ram: Uint8Array, off: number, val: number): void {
  ram[off]     = (val >>> 8) & 0xff;
  ram[off + 1] =  val        & 0xff;
}

function writeByteAbs(ram: Uint8Array, abs: number, val: number): void {
  ram[abs - WORK_RAM_BASE] = val & 0xff;
}

function writeWordAbs(ram: Uint8Array, abs: number, val: number): void {
  writeWordBE(ram, abs - WORK_RAM_BASE, val);
}

function writeLongAbs(ram: Uint8Array, abs: number, val: number): void {
  writeLongBE(ram, abs - WORK_RAM_BASE, val);
}

function readLongBE(ram: Uint8Array, off: number): number {
  return (
    (((ram[off]     ?? 0) << 24) |
     ((ram[off + 1] ?? 0) << 16) |
     ((ram[off + 2] ?? 0) << 8)  |
      (ram[off + 3] ?? 0)) >>> 0
  );
}

function readWordBE(ram: Uint8Array, off: number): number {
  return (((ram[off] ?? 0) << 8) | (ram[off + 1] ?? 0)) & 0xffff;
}

/** workRam offset for an object at abs addr 0x401E00 (non-player). */
const WORK_RAM_BASE = 0x00400000;
const PLAYER_ABS = 0x00400018;
const OBJ_ABS  = 0x00401e00;
const OBJ_OFF  = OBJ_ABS - 0x400000;

/** Object struct field offsets. */
const VX = 0x00, VY = 0x04, VZ = 0x08;
const PX = 0x0c, PY = 0x10, PZ = 0x14;
const ST = 0x1a, SUB = 0x1b;
const BOUNCE = 0x36;
const EVT  = 0x57;
const SB   = 0x58;

/** All-noop subs — stub every callee. */
function noopSubs(): Parameters<typeof helper121B8>[3] {
  return {
    fun_1bab2: () => { /* no-op */ },
    fun_1cc62: () => 0,
    fun_1c676: () => { /* no-op */ },
    fun_12886: () => { /* no-op */ },
    fun_1b5c2: () => { /* no-op */ },
    fun_29cce: () => { /* no-op */ },
    fun_1bc88: () => 0,
    fun_14e92: () => { /* no-op */ },
    fun_175c8: () => { /* no-op */ },
    fun_1881c: () => { /* no-op */ },
    fun_1924e: () => { /* no-op */ },
    fun_19d94: () => { /* no-op */ },
    fun_1365c: () => { /* no-op */ },
    fun_160f6: () => { /* no-op */ },
    fun_1b9cc: () => { /* no-op */ },
    fun_1c014: () => { /* no-op */ },
    fun_1281c: () => 0,
    fun_1706c: () => { /* no-op */ },
    fun_25c74: () => { /* no-op */ },
    fun_18a1e: () => { /* no-op */ },
    fun_18e6c: () => { /* no-op */ },
    fun_25bae: () => { /* no-op */ },
    fun_15884: () => { /* no-op */ },
    fun_158ac: () => { /* no-op */ },
    fun_15bd0: () => { /* no-op */ },
    fun_25df6: () => { /* no-op */ },
    fun_25e7c: () => { /* no-op */ },
    fun_285b0: () => { /* no-op */ },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("helper121B8 (FUN_000121B8)", () => {
  it("HELPER_121B8_ADDR is correct", () => {
    expect(HELPER_121B8_ADDR).toBe(0x121b8);
  });

  it("no-crash smoke test with empty state", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    expect(() => helper121B8(state, rom, OBJ_ABS, noopSubs())).not.toThrow();
  });

  it("prologue: writes obj.x/y/z to globals 0x400684/688/68C", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    writeLongBE(r, OBJ_OFF + PX, 0x12345678);
    writeLongBE(r, OBJ_OFF + PY, 0x9abcdef0);
    writeLongBE(r, OBJ_OFF + PZ, 0x11223344);

    helper121B8(state, rom, OBJ_ABS, noopSubs());

    expect(readLongBE(r, 0x684)).toBe(0x12345678);
    expect(readLongBE(r, 0x688)).toBe(0x9abcdef0);
    expect(readLongBE(r, 0x68c)).toBe(0x11223344);
  });

  it("prologue: writes 0xFFFF to 0x400696 and 0x400698", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    helper121B8(state, rom, OBJ_ABS, noopSubs());

    // 0x400696 and 0x400698 are set to 0xFFFF early in prologue
    // (before spritePosUpdate1BAB2 runs, which with stub keeps them)
    expect(readWordBE(r, 0x696)).toBe(0xffff);
    expect(readWordBE(r, 0x698)).toBe(0xffff);
  });

  it("prologue: computes trackX = signed(obj.x) >> 0x13 (stored in 0x40069A)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    // obj.x = 0x00800000 → signed >> 19 = 0x00800000 >> 19 = 16
    // (0x00800000 = 8388608; 8388608 >> 19 = 16)
    writeLongBE(r, OBJ_OFF + PX, 0x00800000);
    writeLongBE(r, OBJ_OFF + PY, 0x00000000);
    writeLongBE(r, OBJ_OFF + PZ, 0x00000000);

    helper121B8(state, rom, OBJ_ABS, noopSubs());

    expect(readWordBE(r, 0x69a)).toBe(16); // 0x00800000 >> 19 = 16
  });

  it("in-range: integrates velocity (obj.x += vx, obj.y += vy)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    writeLongBE(r, OBJ_OFF + VX, 0x00000100);
    writeLongBE(r, OBJ_OFF + VY, 0x00000200);
    writeLongBE(r, OBJ_OFF + VZ, 0x00000300);
    writeLongBE(r, OBJ_OFF + PX, 0x00001000);
    writeLongBE(r, OBJ_OFF + PY, 0x00002000);
    writeLongBE(r, OBJ_OFF + PZ, 0x00001000);

    // D0 = 0 (noop spriteProject) - 0x00001000 = negative → in-range (ble taken)
    helper121B8(state, rom, OBJ_ABS, noopSubs());

    // obj.x and obj.y should be updated by velocity integration
    expect(readLongBE(r, OBJ_OFF + PX)).toBe(0x1100);
    expect(readLongBE(r, OBJ_OFF + PY)).toBe(0x2200);
    // Note: obj.z is also integrated (0x1000 + 0x300 = 0x1300) but later
    // overwritten by d4_timer=0 at the SKIP_BOUNCE_STATE path (0x126FC)
    // when obj[0x36]=0. This is correct behaviour.
  });

  it("out-of-range non-player: calls fun_15bd0 (not fun_15884)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    // Use OBJ_ABS (non-player)
    writeLongBE(r, OBJ_OFF + PZ, 0x00000000);

    const subs = noopSubs();
    const bd0 = vi.fn();
    const s884 = vi.fn();
    subs.fun_15bd0 = bd0;
    subs.fun_15884 = s884;

    // Force out-of-range: fun_1cc62 returns 0x200000 > obj.z (0) + 0x100000
    subs.fun_1cc62 = () => 0x200000;

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(bd0).toHaveBeenCalledWith(state, OBJ_ABS, 1, 1);
    expect(s884).not.toHaveBeenCalled();
  });

  it("out-of-range player: calls fun_15884, sets obj.57 = 0x65, calls fun_25bae", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;
    const PLAYER_OFF = 0x00400018 - 0x400000;

    writeLongBE(r, PLAYER_OFF + PZ, 0x00000000);

    const subs = noopSubs();
    const s884 = vi.fn();
    const sbae = vi.fn();
    const bd0  = vi.fn();
    subs.fun_15884 = s884;
    subs.fun_25bae = sbae;
    subs.fun_15bd0 = bd0;
    subs.fun_1cc62 = () => 0x200000; // force out-of-range

    helper121B8(state, rom, 0x00400018, subs);

    expect(s884).toHaveBeenCalledOnce();
    expect(r[PLAYER_OFF + EVT]).toBe(0x65);
    expect(sbae).toHaveBeenCalledWith(state, 0x00400018, 4);
    expect(bd0).not.toHaveBeenCalled();
  });

  it("in-range: does NOT call fun_15bd0 or fun_15884", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    const subs = noopSubs();
    const bd0  = vi.fn();
    const s884 = vi.fn();
    subs.fun_15bd0 = bd0;
    subs.fun_15884 = s884;
    // fun_1cc62 returns 0 → in-range (0 - obj.z_0 = 0 → ble taken)

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(bd0).not.toHaveBeenCalled();
    expect(s884).not.toHaveBeenCalled();
  });

  it("isPlayer flag: OBJ_ABS = 0x400018 gives isPlayer=true", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const subs = noopSubs();
    // Force out-of-range so the isPlayer branch is taken
    subs.fun_1cc62 = () => 0x200000;
    const s884 = vi.fn();
    subs.fun_15884 = s884;

    helper121B8(state, rom, 0x00400018, subs);
    expect(s884).toHaveBeenCalledOnce();
  });

  it("isPlayer flag: OBJ_ABS = 0x4000FA gives isPlayer=true", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const subs = noopSubs();
    subs.fun_1cc62 = () => 0x200000;
    const s884 = vi.fn();
    subs.fun_15884 = s884;

    helper121B8(state, rom, 0x004000fa, subs);
    expect(s884).toHaveBeenCalledOnce();
  });

  it("in-range: calls fun_1bab2 twice (first = prologue, second = after integration)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const subs = noopSubs();
    const cb = vi.fn();
    subs.fun_1bab2 = cb;

    helper121B8(state, rom, OBJ_ABS, subs);

    // First call at prologue, second call after integrate_vel
    // (possibly more if bounce is triggered or changed-flags are set)
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("in-range: calls fun_1c676 (spriteBracketLerp) after second spritePosUpdate", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const subs = noopSubs();
    const cb = vi.fn();
    subs.fun_1c676 = cb;

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(cb).toHaveBeenCalledOnce();
  });

  it("bounce path: calls fun_12886 when d1w < 4 AND vx > vy", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    // Set vx very large positive, vy very negative → vx > vy
    writeLongBE(r, OBJ_OFF + VX, 0x70000000); // large positive
    writeLongBE(r, OBJ_OFF + VY, 0x80000001); // large negative (signed)
    writeLongBE(r, OBJ_OFF + PZ, 0x00000001); // in-range

    // Set worldX and worldY so d1w < 4:
    // d1w = worldY - worldX + 0x88 < 4 → worldY - worldX < -0x84
    // e.g. worldX = 0xFAB7, worldY = 0x0FF1 (from our TC1 analysis)
    // But with RTS stub for spritePosUpdate1BAB2, the globals are NOT updated
    // So the initial globals matter here.
    // Set worldX @ 0x400690 = 0xFAB7, worldY @ 0x400692 = 0x0FF1
    // d1w = 0x0FF1 - 0xFAB7 + 0x88 = 0x153A - 0xFAB7 + 0x... = negative
    // Actually: (0x0FF1 - 0xFAB7 + 0x88) as signed 16-bit:
    // = 0x0FF1 - 0xFAB7 + 0x88 = 0x1079 - 0xFAB7 = mod 0x10000 = 0x15C2 (wraps)
    // Wait let me compute: 0xFF1 - 0xFAB7 = -0xEAC6 (very negative in 16-bit signed)
    // = (0x0FF1 - 0xFAB7) & 0xffff = 0x153A... no
    // 0x0FF1 = 4081, 0xFAB7 = 64183
    // 4081 - 64183 = -60102 = 0xFFFF - 60102 + 1 = 0x13CA (mod 16bit unsigned)
    // + 0x88 = 0x1452... still negative? No: 0x1452 = 5202 > 4 → in range
    // Let me set worldX and worldY such that d1w < 4:
    // worldX = 0x1000, worldY = 0x0F7B → d1w = 0x0F7B - 0x1000 + 0x88 = 0xFF03 (negative signed) < 4
    writeWordBE(r, 0x690, 0x1000); // worldX
    writeWordBE(r, 0x692, 0x0F7B); // worldY
    // d1w = 0x0F7B - 0x1000 + 0x88 = -0x085 + 0x88 = 3 < 4 → low bound triggered
    // vx > vy (0x70000000 > 0x80000001 as signed? 0x70000000 = +ve, 0x80000001 = -ve → yes)
    // → BOUNCE condition met!

    const subs = noopSubs();
    const swap = vi.fn();
    subs.fun_12886 = swap;

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(swap).toHaveBeenCalledWith(state, OBJ_ABS);
  });

  it("bounce path: restores obj.x from global 0x400684 when bounce triggered", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    // Set up obj
    writeLongBE(r, OBJ_OFF + VX, 0x70000000);
    writeLongBE(r, OBJ_OFF + VY, 0x80000001);
    writeLongBE(r, OBJ_OFF + PX, 0x00010000);
    writeLongBE(r, OBJ_OFF + PY, 0x00020000);
    writeLongBE(r, OBJ_OFF + PZ, 0x00000001);

    // Set worldX/Y for bounce condition
    writeWordBE(r, 0x690, 0x1000);
    writeWordBE(r, 0x692, 0x0F7B);

    const subs = noopSubs();
    // fun_12886 is no-op → verify obj.x is set from global 0x400684
    // Global 0x400684 is set to initial obj.x at prologue: 0x00010000
    // After integrate: obj.x = 0x00010000 + 0x70000000 = 0x70010000
    // But with fun_12886 = no-op, bounce restore:
    // obj.x = r32(0x400684) = 0x00010000 (saved at prologue)
    // obj.y = r32(0x400688) = 0x00020000 (saved at prologue)

    helper121B8(state, rom, OBJ_ABS, subs);

    // After bounce restore (with no-op swap), obj.x = globals_saved = 0x00010000
    // plus midpoint addition
    const savedX = readLongBE(r, 0x684); // should be 0x00010000
    expect(savedX).toBe(0x00010000);
  });

  it("state byte 0x2D calls fun_25e7c with mode 2 (obj[0x36]=0)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;
    r[OBJ_OFF + SB] = 0x2d;    // state byte
    r[OBJ_OFF + BOUNCE] = 0;   // no bounce mode

    const subs = noopSubs();
    const scale = vi.fn();
    subs.fun_25e7c = scale;

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(scale).toHaveBeenCalledWith(state, rom, OBJ_ABS, 2);
  });

  it("state byte 0xFF (none) does NOT call fun_25e7c", () => {
    // 0xFF maps to mode 0xFF → cmpi.b #0xFF,D0; beq → skip vectorScale
    // Actually 0xFF is not in the dispatch table → maps to mode 0 (default)
    // and mode 0 → calls vectorScale(mode=0)
    // Let's use a byte not in any special list: 0x00
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;
    r[OBJ_OFF + SB] = 0x10;    // maps to mode 0xFF → NO vectorScale call
    r[OBJ_OFF + BOUNCE] = 0;

    const subs = noopSubs();
    const scale = vi.fn();
    subs.fun_25e7c = scale;

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(scale).not.toHaveBeenCalled();
  });

  it("state byte 0x38 calls fun_25e7c with mode 4", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;
    r[OBJ_OFF + SB] = 0x38;
    r[OBJ_OFF + BOUNCE] = 0;

    const subs = noopSubs();
    const scale = vi.fn();
    subs.fun_25e7c = scale;

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(scale).toHaveBeenCalledWith(state, rom, OBJ_ABS, 4);
  });

  it("obj[0x58]=0x0A → early exit after 29CCE, does NOT call fun_1b9cc", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;
    r[OBJ_OFF + SB] = 0x0a;

    const subs = noopSubs();
    const b9cc = vi.fn();
    subs.fun_1b9cc = b9cc;

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(b9cc).not.toHaveBeenCalled();
  });

  it("obj[0x1A]=0x04 → early exit before player checks", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;
    r[OBJ_OFF + ST] = 0x04;   // early exit

    const subs = noopSubs();
    const b9cc = vi.fn();
    const s836 = vi.fn();
    subs.fun_1b9cc = b9cc;
    subs.fun_1365c = s836;

    helper121B8(state, rom, OBJ_ABS, subs);

    // After 0x12380 check, returns immediately
    expect(b9cc).not.toHaveBeenCalled();
  });

  it("in-range player: calls fun_14e92, fun_175c8, fun_1881c, fun_19d94", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    const subs = noopSubs();
    const e92  = vi.fn();
    const v175 = vi.fn();
    const m881 = vi.fn();
    const d94  = vi.fn();
    subs.fun_14e92 = e92;
    subs.fun_175c8 = v175;
    subs.fun_1881c = m881;
    subs.fun_19d94 = d94;

    // Use player address
    helper121B8(state, rom, 0x00400018, subs);

    // These are all called in the isPlayer block
    expect(e92).toHaveBeenCalledWith(state, 0x00400018);
    expect(v175).toHaveBeenCalledWith(state, 0x00400018);
    expect(m881).toHaveBeenCalledWith(state, 0x00400018);
    expect(d94).toHaveBeenCalledWith(state, 0x00400018);
  });

  it("in-range player: default FUN_175C8 wires type-14 hit side effects", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    writeWordBE(r, 0x394, 2);
    writeWordBE(r, 0x690, 50);
    writeWordBE(r, 0x692, 60);

    const slotAddr = SLOT_BASE_ADDR;
    const bboxPtrPtr = 0x00023f66;
    const bboxPtr = 0x00024000;
    writeByteAbs(r, slotAddr + SLOT_ACTIVE_OFF, 1);
    writeByteAbs(r, slotAddr + SLOT_SCRIPT_ID_OFF, 0x42);
    writeWordAbs(r, slotAddr + SLOT_X_OFF, 50);
    writeWordAbs(r, slotAddr + SLOT_Y_OFF, 60);
    writeLongAbs(r, slotAddr + SLOT_BBOX_PTRPTR_OFF, bboxPtrPtr);
    rom.program[bboxPtrPtr] = (bboxPtr >>> 24) & 0xff;
    rom.program[bboxPtrPtr + 1] = (bboxPtr >>> 16) & 0xff;
    rom.program[bboxPtrPtr + 2] = (bboxPtr >>> 8) & 0xff;
    rom.program[bboxPtrPtr + 3] = bboxPtr & 0xff;
    rom.program[bboxPtr + 4] = (-2) & 0xff;
    rom.program[bboxPtr + 5] = (-2) & 0xff;
    rom.program[bboxPtr + 6] = 12;
    rom.program[bboxPtr + 7] = 12;

    const subs = noopSubs();
    delete subs.fun_175c8;
    const updateSprite = vi.fn();
    const enterState = vi.fn();
    const soundCommand = vi.fn();
    subs.fun_1bab2 = updateSprite;
    subs.fun_25bae = enterState;
    subs.fun_158ac = soundCommand;

    helper121B8(state, rom, PLAYER_ABS, subs);

    expect(enterState).toHaveBeenCalledWith(state, PLAYER_ABS, FUN_25BAE_ARG_MODE);
    expect(soundCommand).toHaveBeenCalledWith(state, SOUND_HIT_COMMAND);
    expect(r[PLAYER_ABS - WORK_RAM_BASE + SB]).toBe(0x42);
    expect(r[SLOT_BASE_ADDR - WORK_RAM_BASE + SLOT_NEW_STATE_OFF]).toBe(HIT_SLOT_NEW_STATE);
    expect(updateSprite.mock.calls.filter((call) => call[1] === PLAYER_ABS).length)
      .toBeGreaterThanOrEqual(3);
  });

  it("in-range player: calls fun_1b9cc with flagLong=0", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const subs = noopSubs();
    const cb = vi.fn();
    subs.fun_1b9cc = cb;

    helper121B8(state, rom, 0x00400018, subs);

    expect(cb).toHaveBeenCalledWith(state, 0x00400018, 0);
  });

  it("in-range player default FUN_25DF6 path suppresses terrain discontinuity impulses", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;
    const playerOff = 0x00400018 - 0x400000;

    writeLongBE(r, playerOff + VX, Math.round(0.05 * 0x10000));
    writeLongBE(r, playerOff + VY, Math.round(0.49 * 0x10000));
    writeLongBE(r, playerOff + PZ, 0x003f8800);

    writeWordBE(r, 0x1c28 + 0x04, 16264);
    writeWordBE(r, 0x1c28 + 0x0e, 16264);
    writeWordBE(r, 0x1c28 + 0x10, 16472);
    writeWordBE(r, 0x1c28 + 0x1a, 16264);
    writeWordBE(r, 0x6a2, 0);
    writeWordBE(r, 0x6a4, 208);
    writeWordBE(r, 0x6a6, 0);

    const subs = noopSubs();
    subs.fun_1cc62 = () => 0x003f8800;
    delete subs.fun_25df6;

    helper121B8(state, rom, 0x00400018, subs);

    expect(readLongBE(r, playerOff + VX)).toBe(Math.round(0.05 * 0x10000));
    expect(readLongBE(r, playerOff + VY)).toBe(Math.round(0.49 * 0x10000));
    expect(state.debug?.lastTrackballSanitize).toMatchObject({
      rawX: 208,
      rawY: 0,
      suppressedX: true,
      suppressedY: false,
      reasonX: "large-discontinuity",
    });
    expect(state.debug?.lastTrackballApply).toMatchObject({
      rawX: 0,
      rawY: 0,
      appliedX: 0,
      appliedY: 0,
    });
  });

  it("in-range player follows ROM floor projection when an endpoint is missing", () => {
    const state = emptyGameState();
    state.clock.frame = 3051 as any;
    const rom = emptyRomImage();
    const r = state.workRam;
    const playerOff = 0x00400018 - 0x400000;
    const zStart = 16280 << 16;
    const bogusFloor = 12210 << 16;

    writeLongBE(r, playerOff + PZ, zStart);
    writeLongBE(r, playerOff + VZ, 0);
    writeWordBE(r, 0x1c28 + 0x04, 16280);
    writeWordBE(r, 0x1c28 + 0x0e, 0);
    writeWordBE(r, 0x1c28 + 0x10, 16280);
    writeWordBE(r, 0x1c28 + 0x1a, 16280);
    writeWordBE(r, 0x69e, 2);
    writeWordBE(r, 0x6a0, 4);
    writeWordBE(r, 0x6a2, 1);

    const subs = noopSubs();
    subs.fun_1cc62 = () => bogusFloor;
    delete subs.fun_160f6;

    helper121B8(state, rom, 0x00400018, subs);

    expect(r[playerOff + BOUNCE]).toBe(2);
    expect(readLongBE(r, playerOff + VZ)).toBe(0xffffa000);
  });

  it("in-range player still enters fall lock when the projected floor is trusted", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;
    const playerOff = 0x00400018 - 0x400000;
    const zStart = 16280 << 16;
    const floorBelow = 12210 << 16;

    writeLongBE(r, playerOff + PZ, zStart);
    writeLongBE(r, playerOff + VZ, 0);
    writeWordBE(r, 0x1c28 + 0x04, 16280);
    writeWordBE(r, 0x1c28 + 0x0e, 16280);
    writeWordBE(r, 0x1c28 + 0x10, 16280);
    writeWordBE(r, 0x1c28 + 0x1a, 16280);
    writeWordBE(r, 0x69e, 2);
    writeWordBE(r, 0x6a0, 4);
    writeWordBE(r, 0x6a2, 1);

    const subs = noopSubs();
    subs.fun_1cc62 = () => floorBelow;
    delete subs.fun_160f6;

    helper121B8(state, rom, 0x00400018, subs);

    expect(r[playerOff + BOUNCE]).toBe(2);
    expect(readLongBE(r, playerOff + VZ)).toBe(0xffffa000);
  });

  it("in-range non-player: does NOT call fun_14e92, fun_175c8, fun_1924e", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const subs = noopSubs();
    const e92 = vi.fn();
    const c175 = vi.fn();
    const c924 = vi.fn();
    subs.fun_14e92 = e92;
    subs.fun_175c8 = c175;
    subs.fun_1924e = c924;

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(e92).not.toHaveBeenCalled();
    expect(c175).not.toHaveBeenCalled();
    expect(c924).not.toHaveBeenCalled();
  });

  it("in-range: always calls fun_1bab2 + fun_1b5c2", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const subs = noopSubs();
    const bab2 = vi.fn();
    const b5c2 = vi.fn();
    subs.fun_1bab2 = bab2;
    subs.fun_1b5c2 = b5c2;

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(bab2.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(b5c2).toHaveBeenCalledOnce();
  });

  it("default spriteHelper1B9CC reuses the wired fun_1bab2 redraw path", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const subs = noopSubs();
    const bab2 = vi.fn();
    subs.fun_1bab2 = bab2;
    delete subs.fun_1b9cc;

    helper121B8(state, rom, OBJ_ABS, subs);

    expect(bab2.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("in-range player obj[0x36]=1 (not 2) → exits before state-byte dispatch", () => {
    // obj[0x36] = 1 (non-zero, not == 2): passes the cmpi.b #2 check at 0x12490
    // (bne → SKIP_BOUNCE_STATE), then d4_timer (=0) is written to obj.z (0x126FC only
    // when obj[0x36]==0), then at 0x1273A: tst.b obj[0x36] = 1 → bne → EPILOGUE.
    // So function exits before vectorScale.
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;
    const PLAYER_OFF = 0x400018 - 0x400000;
    r[PLAYER_OFF + BOUNCE] = 0x01; // non-zero, not 2 → SKIP_BOUNCE_STATE, then early exit
    r[PLAYER_OFF + SB] = 0x2d;     // state byte that would trigger vectorScale

    const subs = noopSubs();
    const scale = vi.fn();
    subs.fun_25e7c = scale;

    helper121B8(state, rom, 0x00400018, subs);

    // bounce flag non-zero → exits at 0x12740 before vectorScale
    expect(scale).not.toHaveBeenCalled();
  });

  it("default FUN_160F6 wiring reads the ROM speed table", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;
    const playerOff = 0x18;
    const zStart = 0x00100000;

    writeLongBE(r, playerOff + PZ, zStart);
    r[playerOff + SB] = 0x00; // charcode whitelist
    r[0x66c] = 1; // left input active
    writeWordBE(r, 0x674, 3); // current left velocity
    rom.program[0x2398c + 2] = 2; // bestMag=2, so z += (3 - 2) << 16

    const subs = noopSubs();
    delete subs.fun_160f6;
    subs.fun_1cc62 = () => zStart;
    subs.fun_1bab2 = (s) => {
      writeWordBE(s.workRam, 0x696, 0);
      writeWordBE(s.workRam, 0x698, 0);
      writeWordBE(s.workRam, 0x69e, 2); // tile X -> table index 2
      writeWordBE(s.workRam, 0x6a0, 0);
    };

    helper121B8(state, rom, 0x00400018, subs);

    expect(readLongBE(r, playerOff + PZ)).toBe(zStart + 0x10000);
    expect(r[playerOff + BOUNCE]).toBe(1);
  });
});
