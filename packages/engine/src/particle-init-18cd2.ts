/**
 * Port of ROM routine `FUN_00018CD2`.
 *
 * Initializes particle slots at `0x400A9C`, generating position, velocity, and
 * animation/mode words from the ROM RNG helper. It calls `FUN_26CFA` once when
 * mode is `0xFF`, inserts each slot into the sorted draw list via `FUN_18E6C`,
 * and writes the count to `0x4003E2` for the particle bounce path.
 *
 * RNG cost per slot is four base calls plus one extra call when mode >= 0x80.
 * Mode `0xFF` also triggers the palette helper, which consumes eight RNG steps.
 */

import type { GameState } from "./state.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

// ─── Constants ───────────────────────────────────────────────────────────

/** Absolute M68K work RAM base. */
const WORK_RAM_BASE = 0x00400000;

export const PARTICLE_ARRAY_ABS = 0x00400a9c as const;
/** Slot stride (10 bytes). */
export const PARTICLE_STRIDE = 0x0a as const;
export const COUNT_BYTE_ABS = 0x004003e2 as const;

/** Type code passed to `FUN_18E6C` for each slot. */
export const RECT_TYPE_CODE = 0x2c as const;

/** Marker `mode == 0xFF` → palette refresh + rng(8) per mode-word. */
export const MODE_RANDOM_8 = 0xff as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

function writeWordBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff
  );
}

/**
 * Normalizes the `rngNext` result from `[0, limit]` to `[0, limit)`.
 *
 * `rngNext` uses `while (r > limit) r -= limit`, so it can return
 * `r == limit`. The ROM helper (`FUN_13A98`) produces `[0, limit)`. This is
 * the same normalization used by `palette-rng-fill-26cfa.ts` and
 * `state-sub-1960e.ts`.
 */
function rng(state: GameState, limit: number): number {
  let r = rngNext(state.rng, as_u16(limit)) as unknown as number;
  if (limit > 0) {
    while (r >= limit) r -= limit;
  }
  return r & 0xffff;
}

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Stub injection per le 2 JSR esterne.
 *
 *    Default: no-op. Replicabile via `paletteRngFill26CFATick(state, rom)`.
 *    Default: no-op. Replicabile via `slotInsertSorted18E6C(state, rom,
 *    0x2C, i, slotInsertSubs)`.
 */
export interface ParticleInit18CD2Subs {
  /** Replica di `FUN_00026CFA` (palette refresh + 8 RNG). */
  fun_26cfa?: (state: GameState) => void;
  /** Replica di `FUN_00018E6C` (insert-sorted in draw-list). */
  fun_18e6c?: (state: GameState, typeCode: number, subIdx: number) => void;
}


/**
 * Detail for each generated slot.
 */
export interface ParticleInit18CD2SlotDetail {
  /** Slot index (0..count-1). */
  index: number;
  /** xpos word written to entry[0..1]. */
  xpos: number;
  /** ypos word written to entry[2..3]. */
  ypos: number;
  xvel: number;
  yvel: number;
  modeWord: number;
}

export interface ParticleInit18CD2Result {
  /** Number of initialized slots (= count = arg1 LSB). */
  count: number;
  /** Mode byte (= arg2 LSB). */
  mode: number;
  paletteRefreshed: boolean;
  slots: ParticleInit18CD2SlotDetail[];
}

// ─── Port ────────────────────────────────────────────────────────────────

/**
 *
 * @param state  GameState; mutates `workRam[0xA9C..0xA9C+count*0xA)`,
 *               `workRam[0x3E2]`, and `state.rng.seed`.
 * @param count  Byte (0..255), LSB of the first caller-pushed argument.
 * @param mode   Byte (0..255), LSB of the second caller-pushed argument.
 * @param subs   Injection points for `FUN_26CFA` and `FUN_18E6C`. Default: no-op.
 *
 * @returns      Run detail: count, mode, paletteRefreshed, slots[].
 *
 *   1. If `mode == 0xFF`, call `subs.fun_26cfa(state)`.
 *   2. For i = 0..count-1:
 *      a. `entry[0..1] = ((rng(256) & 0xFF) + 0x24) << 4` (& 0xFFFF)
 *      b. `entry[2..3] = (rng(128) + 0x30) << 4` (& 0xFFFF)
 *      c. raw = `rng(96) - 0x30` (signed word); `entry[4..5] = raw & 0xFFFF`,
 *      d. raw = `rng(96) - 0x30`; idem per `entry[6..7]`.
 *         11) & 0xFFFF`.
 *      f. `subs.fun_18e6c(state, 0x2C, i)`.
 *   3. `workRam[0x3E2] = count`.
 */
export function particleInit18CD2(
  state: GameState,
  count: number,
  mode: number,
  subs: ParticleInit18CD2Subs = {},
): ParticleInit18CD2Result {
  const d3 = count & 0xff; // count
  const d2 = mode & 0xff; // mode

  const paletteRefreshed = d2 === MODE_RANDOM_8;
  if (paletteRefreshed) {
    subs.fun_26cfa?.(state);
  }

  const baseOff = PARTICLE_ARRAY_ABS - WORK_RAM_BASE; // 0xA9C
  const slots: ParticleInit18CD2SlotDetail[] = [];

  // d2 < 0 in m68k = byte >= 0x80
  const d2Negative = (d2 & 0x80) !== 0;

  for (let i = 0; i < d3; i++) {
    const entryOff = baseOff + i * PARTICLE_STRIDE;

    // ─── xpos: rng(256) & 0xFF, +0x24, <<4 (long-shift, then move.w) ──
    const r0 = rng(state, 0x100) & 0xff;
    const xpos = (((r0 + 0x24) << 4) & 0xffff) >>> 0;
    writeWordBE(state, entryOff + 0, xpos);

    // ─── ypos: (rng(128) + 0x30) << 4 (long-shift, low 16 bit) ────────
    // rng(128) ∈ [0..0x7F], +0x30 ∈ [0x30..0xAF], <<4 ∈ [0x300..0xAF0].
    const r1 = rng(state, 0x80);
    const ypos = (((r1 + 0x30) << 4) & 0xffff) >>> 0;
    writeWordBE(state, entryOff + 2, ypos);

    // `subi.w #0x30,D0w` operates on word: if r2 in [0..0x2F], D0w in
    // 0xFFD0..0xFFFF (signed -0x30..-1). Se r2 in [0x30..0x5F] ⇒ D0w in
    const r2 = rng(state, 0x60);
    const xvelRawSigned = r2 - 0x30; // -0x30..0x2F
    let xvelOut: number;
    writeWordBE(state, entryOff + 4, xvelRawSigned & 0xffff);
    if (xvelRawSigned >= 0) {
      // bge → addi.w #0x10,(0x4,A2)
      const v = (readWordBE(state, entryOff + 4) + 0x10) & 0xffff;
      writeWordBE(state, entryOff + 4, v);
      xvelOut = v;
    } else {
      // blt → subi.w #0x10,(0x4,A2) (note: addi.w sub mod 16-bit)
      const v = (readWordBE(state, entryOff + 4) - 0x10) & 0xffff;
      writeWordBE(state, entryOff + 4, v);
      xvelOut = v;
    }

    // ─── yvel: idem ───────────────────────────────────────────────────
    const r3 = rng(state, 0x60);
    const yvelRawSigned = r3 - 0x30;
    let yvelOut: number;
    writeWordBE(state, entryOff + 6, yvelRawSigned & 0xffff);
    if (yvelRawSigned >= 0) {
      const v = (readWordBE(state, entryOff + 6) + 0x10) & 0xffff;
      writeWordBE(state, entryOff + 6, v);
      yvelOut = v;
    } else {
      const v = (readWordBE(state, entryOff + 6) - 0x10) & 0xffff;
      writeWordBE(state, entryOff + 6, v);
      yvelOut = v;
    }

    // ─── mode-word: tst.b D2; blt … ───────────────────────────────────
    let modeWordPre: number;
    if (!d2Negative) {
      // mode in [0x00..0x7F]: D0w = sign-ext(D2.b). D2 in [0..0x7F] ⇒ D0w =
      // 0..0x7F (non-negativi, top byte zero). NO RNG step.
      modeWordPre = d2 & 0xffff;
    } else if (d2 === MODE_RANDOM_8) {
      modeWordPre = rng(state, 0x08);
    } else {
      modeWordPre = rng(state, 0x02);
    }

    // 0x18D9A: move.w D0w << 11 → entry[8..9]. asl.w D1=11,D0 — opera su
    // 16 bit, top bit shifted out ⇒ mask & 0xFFFF.
    const modeWord = (modeWordPre << 11) & 0xffff;
    writeWordBE(state, entryOff + 8, modeWord);

    // ─── jsr FUN_18E6C(0x2C, i) ──────────────────────────────────────
    subs.fun_18e6c?.(state, RECT_TYPE_CODE, i);

    slots.push({
      index: i,
      xpos,
      ypos,
      xvel: xvelOut,
      yvel: yvelOut,
      modeWord,
    });
  }

  // ─── Tail: *0x004003E2 = D3 (count) ──────────────────────────────────
  state.workRam[COUNT_BYTE_ABS - WORK_RAM_BASE] = d3;

  return {
    count: d3,
    mode: d2,
    paletteRefreshed,
    slots,
  };
}
