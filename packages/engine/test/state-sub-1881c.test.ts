/**
 * state-sub-1881c.test.ts — smoke tests per `FUN_0001881C`.
 *
 * Verifica:
 *   - early-out (gameMode != 3 OR byte760 == 0)
 *   - loop con tabella vuota → result = 0, hits = []
 *   - reflect-neg branch (primi 3 match, secondo check fallisce, dist < 12)
 *   - reflect-skip branch (primi 3 match, secondo check fallisce, dist >= 12)
 *   - math/sound branch (tutti 6 match) + soundCommand callback
 */

import { describe, it, expect } from "vitest";
import {
  stateSub1881C,
  GAME_MODE_OFFSET,
  SECONDARY_GATE_OFFSET,
  SPAWN_BYTE0_OFFSET,
  SPAWN_BYTE1_OFFSET,
  WORLD_X_OFFSET,
  WORLD_Y_OFFSET,
  TABLE_BASE_OFFSET,
  TABLE_ENTRY_STRIDE,
  ENTRY_ACTIVE_OFFSET,
  ENTRY_KEY_BYTE0_OFFSET,
  ENTRY_KEY_BYTE1_OFFSET,
  ENTRY_KEY_WORD_OFFSET,
  ENTITY_LONG0_OFFSET,
  ENTITY_LONG1_OFFSET,
  ENTITY_LONG2_OFFSET,
  ENTITY_LONG3_OFFSET,
  ENTITY_LONG4_OFFSET,
  ENTITY_LONG5_OFFSET,
  ENTITY_FLAG36_OFFSET,
  GAME_MODE_ACTIVE,
  ACTIVE_SENTINEL,
  MATH_LONG2_VALUE,
  MATH_LONG5_INCREMENT,
  MATH_FLAG36_VALUE,
  MATH_SOUND_ID,
} from "../src/state-sub-1881c.js";
import { emptyGameState } from "../src/state.js";
import { as_u32 } from "../src/wrap.js";

const ENTITY_BASE = 0x401e00;
const ENTITY_OFF = ENTITY_BASE - 0x400000;

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

function readLongBE(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    ((s.workRam[off] ?? 0) << 24) |
    ((s.workRam[off + 1] ?? 0) << 16) |
    ((s.workRam[off + 2] ?? 0) << 8) |
    (s.workRam[off + 3] ?? 0)
  ) >>> 0;
}

function readByte(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (s.workRam[off] ?? 0) & 0xff;
}

/** Setup minimal: gameMode=3, byte760!=0, tabella vuota. */
function setupActive(s: ReturnType<typeof emptyGameState>): void {
  setWordBE(s, GAME_MODE_OFFSET, GAME_MODE_ACTIVE);
  setByte(s, SECONDARY_GATE_OFFSET, 0xff);
}

describe("stateSub1881C (FUN_0001881C)", () => {
  it("early-out: gameMode != 3 → result=0, no side effects", () => {
    const s = emptyGameState();
    setWordBE(s, GAME_MODE_OFFSET, 0x0002); // != 3
    setByte(s, SECONDARY_GATE_OFFSET, 0xff);
    // Pre-popola entity per verificare che NON venga toccata
    setLongBE(s, ENTITY_OFF + ENTITY_LONG0_OFFSET, 0xdeadbeef);
    let soundCalls = 0;
    const r = stateSub1881C(s, ENTITY_BASE, {
      soundCommand: () => { soundCalls++; },
    });
    expect(r.earlyOut).toBe(true);
    expect(r.result).toBe(0);
    expect(r.hits).toHaveLength(0);
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG0_OFFSET)).toBe(0xdeadbeef);
    expect(soundCalls).toBe(0);
  });

  it("early-out: gameMode==3 ma byte760==0 → result=0", () => {
    const s = emptyGameState();
    setWordBE(s, GAME_MODE_OFFSET, GAME_MODE_ACTIVE);
    setByte(s, SECONDARY_GATE_OFFSET, 0); // gate chiuso
    const r = stateSub1881C(s, ENTITY_BASE);
    expect(r.earlyOut).toBe(true);
    expect(r.result).toBe(0);
  });

  it("loop con tabella vuota (tutti entry inattivi) → result=0", () => {
    const s = emptyGameState();
    setupActive(s);
    // Pre-popola entity per verificare che NON venga toccata
    setLongBE(s, ENTITY_OFF + ENTITY_LONG3_OFFSET, 0x12345678);
    const r = stateSub1881C(s, ENTITY_BASE);
    expect(r.earlyOut).toBe(false);
    expect(r.result).toBe(0);
    expect(r.hits).toHaveLength(0);
    // entity[0xc] non riscritto (nessun first-3 match)
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG3_OFFSET)).toBe(0x12345678);
  });

  it("reflect-neg: primi 3 match, secondo check fallisce, dist < 12 → nega entity[0..3] e [4..7]", () => {
    const s = emptyGameState();
    setupActive(s);
    setByte(s, SPAWN_BYTE0_OFFSET, 0xaa);
    setByte(s, SPAWN_BYTE1_OFFSET, 0xbb);
    // long684/688: i loro byte((>>19)) NON devono matchare 0xaa/0xbb (per
    // forzare reflect path). Lasciali a 0 → byte((0>>19))=0 != 0xaa.
    setLongBE(s, WORLD_X_OFFSET, 0);
    setLongBE(s, WORLD_Y_OFFSET, 0);

    // Entry @ index 5: active, key bytes match
    const e0 = TABLE_BASE_OFFSET + 5 * TABLE_ENTRY_STRIDE;
    setWordBE(s, e0 + ENTRY_ACTIVE_OFFSET, ACTIVE_SENTINEL);
    setByte(s, e0 + ENTRY_KEY_BYTE0_OFFSET, 0xaa);
    setByte(s, e0 + ENTRY_KEY_BYTE1_OFFSET, 0xbb);
    setWordBE(s, e0 + ENTRY_KEY_WORD_OFFSET, 0x0050);
    // entity[0x14].w = 0x0055 → dist = 5, < 12 → reflect_neg
    setWordBE(s, ENTITY_OFF + ENTITY_LONG5_OFFSET, 0x0055);

    setLongBE(s, ENTITY_OFF + ENTITY_LONG0_OFFSET, 0x00010000);
    setLongBE(s, ENTITY_OFF + ENTITY_LONG1_OFFSET, 0xfffe0000); // -0x20000 signed

    const r = stateSub1881C(s, ENTITY_BASE);
    expect(r.earlyOut).toBe(false);
    expect(r.result).toBe(1);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.branch).toBe("reflect_neg");
    expect(r.hits[0]!.index).toBe(5);

    // entity[0..3] negato: 0x10000 → -0x10000 = 0xFFFF0000
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG0_OFFSET)).toBe(0xffff0000);
    // entity[4..7] negato: 0xFFFE0000 (signed -0x20000) → +0x20000 = 0x00020000
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG1_OFFSET)).toBe(0x00020000);
    // entity[0xc] / [0x10] sempre scritti su first-3 match
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG3_OFFSET)).toBe(0); // = long684
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG4_OFFSET)).toBe(0); // = long688
  });

  it("reflect-skip: primi 3 match, secondo check fallisce, dist >= 12 → no negate", () => {
    const s = emptyGameState();
    setupActive(s);
    setByte(s, SPAWN_BYTE0_OFFSET, 0x10);
    setByte(s, SPAWN_BYTE1_OFFSET, 0x20);
    setLongBE(s, WORLD_X_OFFSET, 0);
    setLongBE(s, WORLD_Y_OFFSET, 0);

    const e0 = TABLE_BASE_OFFSET + 0 * TABLE_ENTRY_STRIDE;
    setWordBE(s, e0 + ENTRY_ACTIVE_OFFSET, ACTIVE_SENTINEL);
    setByte(s, e0 + ENTRY_KEY_BYTE0_OFFSET, 0x10);
    setByte(s, e0 + ENTRY_KEY_BYTE1_OFFSET, 0x20);
    setWordBE(s, e0 + ENTRY_KEY_WORD_OFFSET, 0x0010);
    // dist = 0x100 - 0x10 = 240 (>= 12) → reflect_skip
    setWordBE(s, ENTITY_OFF + ENTITY_LONG5_OFFSET, 0x0100);

    setLongBE(s, ENTITY_OFF + ENTITY_LONG0_OFFSET, 0x12345678);
    setLongBE(s, ENTITY_OFF + ENTITY_LONG1_OFFSET, 0xabcdef01);

    const r = stateSub1881C(s, ENTITY_BASE);
    expect(r.result).toBe(1);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.branch).toBe("reflect_skip");
    // entity[0..3] e [4..7] NON toccati
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG0_OFFSET)).toBe(0x12345678);
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG1_OFFSET)).toBe(0xabcdef01);
  });

  it("math/sound branch: tutti 6 campi match → entity[0x8]=0x70000, [0x14]+=0xc0000, [0x36]=2, soundCommand(0x45)", () => {
    const s = emptyGameState();
    s.rng.seed = as_u32(0x1234);
    setupActive(s);

    // Forza byte((long@684)>>19) = 0x10 e byte((long@688)>>19) = 0x20.
    // long684 = 0x10 << 19 = 0x800000 → byte((0x800000 >> 19)) = 0x10 ✓
    // long688 = 0x20 << 19 = 0x1000000
    setLongBE(s, WORLD_X_OFFSET, 0x10 << 19);
    setLongBE(s, WORLD_Y_OFFSET, 0x20 << 19);
    setByte(s, SPAWN_BYTE0_OFFSET, 0x10);
    setByte(s, SPAWN_BYTE1_OFFSET, 0x20);

    const e0 = TABLE_BASE_OFFSET + 7 * TABLE_ENTRY_STRIDE;
    setWordBE(s, e0 + ENTRY_ACTIVE_OFFSET, ACTIVE_SENTINEL);
    setByte(s, e0 + ENTRY_KEY_BYTE0_OFFSET, 0x10);
    setByte(s, e0 + ENTRY_KEY_BYTE1_OFFSET, 0x20);
    setWordBE(s, e0 + ENTRY_KEY_WORD_OFFSET, 0x0033);
    // entity[0x14].w == entry word
    setWordBE(s, ENTITY_OFF + ENTITY_LONG5_OFFSET, 0x0033);
    // entity[0x14..0x17] full long, low word = 0x0000 (irrilevante per cmp.w)
    setLongBE(s, ENTITY_OFF + ENTITY_LONG5_OFFSET, 0x00330000);

    setLongBE(s, ENTITY_OFF + ENTITY_LONG0_OFFSET, 0x00040000);
    setLongBE(s, ENTITY_OFF + ENTITY_LONG1_OFFSET, 0x00080000);

    let soundCalls: number[] = [];
    const r = stateSub1881C(s, ENTITY_BASE, {
      soundCommand: cmd => { soundCalls.push(cmd); },
    });

    expect(r.result).toBe(1);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.branch).toBe("math");
    expect(r.hits[0]!.rngSignA).not.toBeNull();
    expect(r.hits[0]!.rngSignB).not.toBeNull();
    expect([0, 1]).toContain(r.hits[0]!.rngSignA!);
    expect([0, 1]).toContain(r.hits[0]!.rngSignB!);

    expect(soundCalls).toEqual([MATH_SOUND_ID]);

    // entity[0x8..0xb] = 0x70000
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG2_OFFSET)).toBe(MATH_LONG2_VALUE);
    // entity[0x14..0x17] += 0xc0000 → 0x00330000 + 0xc0000 = 0x003F0000
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG5_OFFSET)).toBe(
      (0x00330000 + MATH_LONG5_INCREMENT) >>> 0,
    );
    // entity[0x36] = 2
    expect(readByte(s, ENTITY_OFF + ENTITY_FLAG36_OFFSET)).toBe(MATH_FLAG36_VALUE);

    // entity[0..3] = (0x40000 >> 1) ± 0x6000 = 0x20000 ± 0x6000 ∈ {0x1A000, 0x26000}
    const long0After = readLongBE(s, ENTITY_OFF + ENTITY_LONG0_OFFSET);
    expect([0x0001a000, 0x00026000]).toContain(long0After);
    // entity[4..7] = (0x80000 >> 1) ± 0x6000 = 0x40000 ± 0x6000
    const long1After = readLongBE(s, ENTITY_OFF + ENTITY_LONG1_OFFSET);
    expect([0x0003a000, 0x00046000]).toContain(long1After);
  });

  it("subs assente → no crash anche su math branch", () => {
    const s = emptyGameState();
    setupActive(s);
    setLongBE(s, WORLD_X_OFFSET, 0x10 << 19);
    setLongBE(s, WORLD_Y_OFFSET, 0x20 << 19);
    setByte(s, SPAWN_BYTE0_OFFSET, 0x10);
    setByte(s, SPAWN_BYTE1_OFFSET, 0x20);
    const e0 = TABLE_BASE_OFFSET + 0 * TABLE_ENTRY_STRIDE;
    setWordBE(s, e0 + ENTRY_ACTIVE_OFFSET, ACTIVE_SENTINEL);
    setByte(s, e0 + ENTRY_KEY_BYTE0_OFFSET, 0x10);
    setByte(s, e0 + ENTRY_KEY_BYTE1_OFFSET, 0x20);
    setWordBE(s, e0 + ENTRY_KEY_WORD_OFFSET, 0x0000);
    setWordBE(s, ENTITY_OFF + ENTITY_LONG5_OFFSET, 0x0000);
    expect(() => stateSub1881C(s, ENTITY_BASE)).not.toThrow();
  });

  it("entity[0xc] / [0x10] sempre scritti su first-3 match (anche se reflect-skip)", () => {
    const s = emptyGameState();
    setupActive(s);
    setByte(s, SPAWN_BYTE0_OFFSET, 0x77);
    setByte(s, SPAWN_BYTE1_OFFSET, 0x88);
    setLongBE(s, WORLD_X_OFFSET, 0xcafebabe);
    setLongBE(s, WORLD_Y_OFFSET, 0x12345678);

    const e0 = TABLE_BASE_OFFSET + 0 * TABLE_ENTRY_STRIDE;
    setWordBE(s, e0 + ENTRY_ACTIVE_OFFSET, ACTIVE_SENTINEL);
    setByte(s, e0 + ENTRY_KEY_BYTE0_OFFSET, 0x77);
    setByte(s, e0 + ENTRY_KEY_BYTE1_OFFSET, 0x88);
    setWordBE(s, e0 + ENTRY_KEY_WORD_OFFSET, 0x0010);
    setWordBE(s, ENTITY_OFF + ENTITY_LONG5_OFFSET, 0x0100); // dist >= 12
    setLongBE(s, ENTITY_OFF + ENTITY_LONG3_OFFSET, 0); // pre-clear
    setLongBE(s, ENTITY_OFF + ENTITY_LONG4_OFFSET, 0);

    stateSub1881C(s, ENTITY_BASE);
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG3_OFFSET)).toBe(0xcafebabe);
    expect(readLongBE(s, ENTITY_OFF + ENTITY_LONG4_OFFSET)).toBe(0x12345678);
  });
});
