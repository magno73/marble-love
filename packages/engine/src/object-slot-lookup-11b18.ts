/**
 * object-slot-lookup-11b18.ts — partial replica `FUN_00011B18`.
 *
 * `FUN_11B18` is the per-player high-score qualification / initials-entry
 * routine. The first block is small and deterministic: rank the score at
 * `object+0xBC`; if rank is 10, return 0 immediately. The qualifying path is
 * interactive and render-heavy, so it is exposed through sub-injection. When
 * that path is not implemented, the default returns 0 instead of pretending the
 * initials flow completed; otherwise callers skip the reset/presentation path
 * and leave stale gameplay terrain visible after game over.
 */

import type { GameState } from "./state.js";
import { keyRankLookup4686 } from "./key-rank-lookup-4686.js";

const WRAM = 0x00400000;

export const OBJECT_SLOT_LOOKUP_11B18_ADDR = 0x00011b18 as const;
export const OBJECT_SLOT_LOOKUP_NONQUALIFY_RANK = 10 as const;

export interface ObjectSlotLookup11B18Subs {
  rankLookup?: (state: GameState, scoreLong: number) => number;
  qualifiedFlow?: (state: GameState, objectAddr: number, rank: number) => void;
}

function off(abs: number): number {
  return abs - WRAM;
}

function readU32(state: GameState, abs: number): number {
  const o = off(abs);
  return ((((state.workRam[o] ?? 0) << 24) |
    ((state.workRam[o + 1] ?? 0) << 16) |
    ((state.workRam[o + 2] ?? 0) << 8) |
    (state.workRam[o + 3] ?? 0)) >>> 0);
}

export function objectSlotLookup11B18(
  state: GameState,
  objectAddr: number,
  subs: ObjectSlotLookup11B18Subs = {},
): number {
  const scoreLong = readU32(state, objectAddr + 0xbc);
  const rank = subs.rankLookup?.(state, scoreLong) ?? keyRankLookup4686(state, scoreLong);

  if ((rank & 0xff) === OBJECT_SLOT_LOOKUP_NONQUALIFY_RANK) {
    return 0;
  }

  if (subs.qualifiedFlow === undefined) {
    return 0;
  }

  subs.qualifiedFlow(state, objectAddr, rank & 0xff);
  return 1;
}

export { objectSlotLookup11B18 as FUN_00011B18 };
