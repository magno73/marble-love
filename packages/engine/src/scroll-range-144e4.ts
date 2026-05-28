/**
 *
 * poi dispatcha a 4 sub e (condizionalmente su game mode 3 o 4) ad altre sub
 * di bound-check.
 *
 * **Algoritmo** (da disasm 0x144E4..0x14648):
 *
 * 1. `boundary = sext16(*(statePtrAddr + 0x10))` where
 *    `statePtrAddr = workRam[0x474..0x477]` (deref ROM-or-workRam).
 * 2. `d3b = ((sext32(fromWord) - boundary) >> 4) & 0xFF`  (signed byte)
 * 3. `d2b = ((sext32(toWord)   - boundary) >> 4) & 0xFF`  (signed byte)
 * 4. If `d3b == d2b` → return (no-op).
 *    - `FUN_15A12(d3b, d2b)` — object-pair slot spawn/despawn.
 *    - `FUN_12DFA(d3b, d2b)` — replicata come `scriptRectDispatch12DFA`.
 * 6. Se mode == 3:
 *    - Se `d3b < 0x29 && d2b >= 0x29` → `bannerHelper26B66(9)`.
 *    - Se `d3b >= 0x29 && d2b < 0x29` → `bannerHelper26B66(8)`.
 * 7. Se mode == 4:
 *    - Se `d3b NOT in [0x1D..0x38] AND d2b in [0x1D..0x38]` → `FUN_18FFA`.
 *    - Se `d3b in [0x1D..0x38] AND d2b NOT in [0x1D..0x38]` → `FUN_190EE`.
 *    - Se `d3b NOT in [0x03..0x1B] AND d2b in [0x03..0x1B]` → `wb(0x400762, 1)`.
 *    - Se `d3b in [0x03..0x1B] AND d2b NOT in [0x03..0x1B]` → `wb(0x400762, 0)`.
 *
 *   D2b as arg2. `scriptRectDispatch12DFA` takes `(state, rom, arg1, arg2)`,
 *   where `arg1.b = D2` (to_scaled) and `arg2.b = D3` (from_scaled). In the
 *
 * **Source disasm**: 0x144E4..0x14648 (364 bytes) — see tools/ghidra_disasm_at.py.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { scriptRectDispatch12DFA } from "./script-rect-dispatch-12dfa.js";
import { bannerHelper26B66 } from "./banner-helper-26b66.js";
import { scrollSub15A12 } from "./scroll-sub-15a12.js";
import { stateSub14C46 } from "./state-sub-14c46.js";
import { stringRangeDispatch17346 } from "./string-range-dispatch-17346.js";
import { spriteProject1CC62 } from "./sprite-project-1cc62.js";
import { spriteCoordsJsr150D0 } from "./sprite-coords-jsr-150d0.js";
import { computeSpriteCoords_v3 } from "./sprite-coords.js";
import { slotInsertSorted18E6C } from "./slot-insert-sorted-18e6c.js";
import { helper18F46 } from "./helper-18f46.js";
import { array9InitAndDispatch18FFA } from "./array-9-init-and-dispatch-18ffa.js";
import { array9ClearAndDispatch } from "./array-9-clear-and-dispatch.js";
import { sub1CABATileRedraw } from "./sub-1caba-tile-redraw.js";
import { fun264AA } from "./fun-264aa.js";
import { entityWaypointStep1D1EC } from "./entity-waypoint-step-1d1ec.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

export const SCROLL_RANGE_144E4_ADDR = 0x000144e4 as const;

const WORK_RAM_BASE = 0x00400000 as const;
const WORK_RAM_END  = 0x00402000 as const;

// ─── Memory helpers ──────────────────────────────────────────────────────────

function readU16Ram(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function readU32Ram(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function readU16Rom(rom: RomImage, addr: number): number {
  return (((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0)) & 0xffff;
}

/**
 * work RAM o in ROM (pattern `readAbsU16` come in level-dispatcher-16ec6.ts).
 */
function readAbsU16(state: GameState, rom: RomImage | undefined, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return readU16Ram(state, a - WORK_RAM_BASE);
  if (rom !== undefined) return readU16Rom(rom, a);
  return 0;
}

/** sign-extend 16-bit word → 32-bit signed integer. */
function sext16(v: number): number {
  const w = v & 0xffff;
  return w < 0x8000 ? w : (w | 0xffff0000) >> 0;
}

/** sign-extend 32-bit low byte → signed byte value (-128..127). */
function sextByte(v: number): number {
  const b = v & 0xff;
  return b < 0x80 ? b : b - 0x100;
}

/**
 */
function asrL4byte(v: number): number {
  return (v >> 4) & 0xff;
}

// ─── Injection interface ──────────────────────────────────────────────────────

export interface ScrollRange144E4Subs {
  fun_15a12?: (state: GameState, d3b: number, d2b: number) => void;
  fun_14c46?: (state: GameState, d3b: number, d2b: number) => void;
  fun_17346?: (state: GameState, d3b: number, d2b: number) => void;
  fun_18ffa?: (state: GameState) => void;
  fun_190ee?: (state: GameState) => void;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Replica `FUN_000144E4`.
 *
 * @param subs      Sub-injection: fun_15a12/fun_14c46/fun_17346/fun_18ffa/fun_190ee.
 */
export function scrollRange144E4(
  state: GameState,
  rom: RomImage | undefined,
  fromWord: number,
  toWord: number,
  subs?: ScrollRange144E4Subs,
): void {
  // movea.l (0x00400474).l, A0 — deref ptr from workRam[0x474]
  const statePtrAddr = readU32Ram(state, 0x474); // offset = 0x400474 - 0x400000

  // move.w (0x10,A0), D1w; ext.l D1 — signed word boundary
  const boundaryRaw = readAbsU16(state, rom, (statePtrAddr + 0x10) >>> 0);
  const boundary = sext16(boundaryRaw);

  // ── Scale from ──────────────────────────────────────────────────────────
  // D0 = sext32(fromWord); D0 -= boundary; D0 = asr.l #4 D0; D3.b = D0.b
  const fromSext = sext16(fromWord & 0xffff);
  const d3b = asrL4byte((fromSext - boundary) >> 0);

  // ── Scale to ────────────────────────────────────────────────────────────
  // D0 = sext32(toWord); D0 -= boundary; D0 = asr.l #4 D0; D2.b = D0.b
  const toSext = sext16(toWord & 0xffff);
  const d2b = asrL4byte((toSext - boundary) >> 0);

  // ── Early exit: D3 == D2 ────────────────────────────────────────────────
  if ((d3b & 0xff) === (d2b & 0xff)) return;

  // ── 4 dispatcher calls ──────────────────────────────────────────────────
  // Arg order: callee sees d3b as arg1, d2b as arg2
  // (M68K push order: D2b first → arg2, D3b last → arg1; see file header)
  if (subs?.fun_15a12 !== undefined) {
    subs.fun_15a12(state, d3b, d2b);
  } else if (rom !== undefined) {
    scrollSub15A12(state, rom, d3b, d2b);
  }
  if (subs?.fun_14c46 !== undefined) {
    subs.fun_14c46(state, d3b, d2b);
  } else if (rom !== undefined) {
    stateSub14C46(state, rom, d3b, d2b, {
      fun_1cc62: (s, arg) => spriteProject1CC62(s, arg, {
        fun_1CABA: (st) => { sub1CABATileRedraw(st, rom); },
      }),
      fun_150d0: (s, slotPtr) => {
        spriteCoordsJsr150D0(s, slotPtr, {
          inner264AA: (structPtr, mode) => fun264AA(s, rom, structPtr, mode),
        });
      },
      fun_18e6c: (s, typeCode, subIdx) => {
        slotInsertSorted18E6C(s, rom, typeCode, subIdx);
      },
      fun_18f46: (s, typeCode, subIdx) => {
        helper18F46(s, rom, typeCode, subIdx);
      },
    });
  }
  if (subs?.fun_17346 !== undefined) {
    subs.fun_17346(state, d3b, d2b);
  } else if (rom !== undefined) {
    stringRangeDispatch17346(state, rom, d3b, d2b, {
      fun_13a98: (s, limit) => rngNext(s.rng, as_u16(limit)) as unknown as number,
      fun_1cc62: (s, arg) => spriteProject1CC62(s, arg, {
        fun_1CABA: (st) => { sub1CABATileRedraw(st, rom); },
      }),
      fun_1d1ec: (s, slotPtr) => {
        entityWaypointStep1D1EC(s, slotPtr, undefined, rom);
      },
      fun_1778e: (s, slotPtr) => {
        computeSpriteCoords_v3(s, slotPtr);
      },
      fun_18e6c: (s, typeCode, subIdx) => {
        slotInsertSorted18E6C(s, rom, typeCode, subIdx);
      },
      fun_18f46: (s, typeCode, subIdx) => {
        helper18F46(s, rom, typeCode, subIdx);
      },
    });
  }
  // FUN_12DFA = scriptRectDispatch12DFA: arg1=d3b (from_scaled), arg2=d2b (to_scaled)
  if (rom !== undefined) {
    scriptRectDispatch12DFA(state, rom, d3b, d2b);
  }

  // ── Game mode dispatch ───────────────────────────────────────────────────
  const mode = readU16Ram(state, 0x394); // *0x400394 word

  if (mode === 3) {
    // cmpi.b #0x29, D3b / bge 0x1459E: if D3 < 0x29 AND D2 >= 0x29 -> banner(9)
    const d3s = sextByte(d3b);
    const d2s = sextByte(d2b);
    if (d3s < 0x29 && d2s >= 0x29) {
      bannerHelper26B66(state, 9);
    }
    // cmpi.b #0x29, D3b / blt 0x145B6: if D3 >= 0x29 AND D2 < 0x29 -> banner(8)
    if (d3s >= 0x29 && d2s < 0x29) {
      bannerHelper26B66(state, 8);
    }
    return;
  }

  if (mode !== 4) return;

  // ── Mode 4 logic ─────────────────────────────────────────────────────────
  const d3s = sextByte(d3b);
  const d2s = sextByte(d2b);

  // Block 1 @ 0x145C2: FUN_18FFA when D3 NOT in [0x1D..0x38] AND D2 in [0x1D..0x38]
  const d3in1d38 = d3s >= 0x1d && d3s <= 0x38;
  const d2in1d38 = d2s >= 0x1d && d2s <= 0x38;
  if (!d3in1d38 && d2in1d38) {
    if (subs?.fun_18ffa !== undefined) {
      subs.fun_18ffa(state);
    } else if (rom !== undefined) {
      array9InitAndDispatch18FFA(state, rom);
    }
  }

  // Block 2 @ 0x145E2: FUN_190EE when D3 in [0x1D..0x38] AND D2 NOT in [0x1D..0x38]
  if (d3in1d38 && !d2in1d38) {
    if (subs?.fun_190ee !== undefined) {
      subs.fun_190ee(state);
    } else if (rom !== undefined) {
      array9ClearAndDispatch(state, {
        fun_18f46: (typeCode, subIdx, st) => {
          helper18F46(st, rom, typeCode, subIdx);
        },
      });
    }
  }

  // Block 3 @ 0x14602: write 1 to 0x400762 when D3 NOT in [3..0x1B] AND D2 in [3..0x1B]
  const d3in031b = d3s >= 0x03 && d3s <= 0x1b;
  const d2in031b = d2s >= 0x03 && d2s <= 0x1b;
  if (!d3in031b && d2in031b) {
    state.workRam[0x400762 - WORK_RAM_BASE] = 1;
    return;
  }

  // Block 4 @ 0x14624: write 0 to 0x400762 when D3 in [3..0x1B] AND D2 NOT in [3..0x1B]
  if (d3in031b && !d2in031b) {
    state.workRam[0x400762 - WORK_RAM_BASE] = 0;
  }
}
