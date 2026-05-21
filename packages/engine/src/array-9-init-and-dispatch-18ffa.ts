/**
 * array-9-init-and-dispatch-18ffa.ts — replica `FUN_00018FFA`.
 *
 * Inizializza l'array-9 (`0x401890`, 9 entry × 0x28) quando nessuna entry è
 * già attiva. È il complemento di `FUN_190EE`: crea gli oggetti type 7/8/9,
 * sceglie posizioni casuali valide, aggiorna il loro script/render state e li
 * inserisce nella draw-list tramite `FUN_18E6C`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";
import { slotInsertSorted18E6C } from "./slot-insert-sorted-18e6c.js";
import { objectTypeDispatch194BA } from "./object-type-dispatch-194ba.js";
import { stateSub1960E } from "./state-sub-1960e.js";
import { stateSub198BC } from "./state-sub-198bc.js";
import { stateSub1953E } from "./state-sub-1953e.js";
import { sub19692 } from "./sub-19692.js";
import { sub19976 } from "./sub-19976.js";
import { sub1937C } from "./sub-1937c.js";
import { computeSpriteCoords_v2 } from "./sprite-coords.js";

export const ARRAY9_INIT_18FFA_ADDR = 0x00018ffa as const;
export const ARRAY9_BASE = 0x00401890 as const;
export const ARRAY9_STRIDE = 0x28 as const;
export const ARRAY9_COUNT = 9 as const;

const WORK_RAM_BASE = 0x00400000 as const;
const ACTIVE_OFFSET = 0x18 as const;
const SUB_INDEX_OFFSET = 0x19 as const;
const KIND_OFFSET = 0x1a as const;
const SUB_COUNTER_OFFSET = 0x1b as const;
const TYPE_OFFSET = 0x25 as const;

export interface Array9InitAndDispatch18FFASubs {
  /** FUN_13A98(limit). Default: `rngNext(state.rng, limit)`. */
  fun_13a98?: (state: GameState, limit: number) => number;
  /** FUN_1937C(entry). Default: real implementation. */
  fun_1937c?: (state: GameState, entityAddr: number) => number;
  /** FUN_194BA(entry). Default: real implementation with replicated callees. */
  fun_194ba?: (state: GameState, entityAddr: number) => void;
  /** FUN_199D6(entry). Default: `computeSpriteCoords_v2`. */
  fun_199d6?: (state: GameState, entityAddr: number) => void;
  /** FUN_18E6C(type, sub). Default: real insert-sorted implementation. */
  fun_18e6c?: (state: GameState, typeCode: number, subIdx: number) => void;
}

function off(addr: number): number {
  return (addr - WORK_RAM_BASE) >>> 0;
}

function wb(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = value & 0xff;
}

function rb(state: GameState, addr: number): number {
  return state.workRam[off(addr)] ?? 0;
}

function wl(state: GameState, addr: number, value: number): void {
  const o = off(addr);
  const v = value >>> 0;
  state.workRam[o] = (v >>> 24) & 0xff;
  state.workRam[o + 1] = (v >>> 16) & 0xff;
  state.workRam[o + 2] = (v >>> 8) & 0xff;
  state.workRam[o + 3] = v & 0xff;
}

function defaultRng(state: GameState, limit: number): number {
  return rngNext(state.rng, as_u16(limit)) as unknown as number;
}

function defaultObjectDispatch(state: GameState, rom: RomImage, entityAddr: number): void {
  const move = (st: GameState, addr: number): void => {
    sub19976(st, rom, addr);
  };
  const validate = (st: GameState, addr: number): number => {
    return sub1937C(st, rom, addr);
  };

  objectTypeDispatch194BA(state, entityAddr, {
    fun_1960e: (objAddr, st) => {
      stateSub1960E(st, objAddr, {
        fun_19692: (st2, addr) => {
          sub19692(st2, addr, {
            fun_19976: move,
            fun_1937c: validate,
          });
        },
      });
    },
    fun_1973c: (objAddr, st) => {
      stateSub198BC(st, objAddr, {
        fun_19976: move,
        fun_1937c: validate,
      });
    },
    fun_1953e: (objAddr, st) => {
      stateSub1953E(st, objAddr);
    },
  });
}

function anyActive(state: GameState): boolean {
  for (let i = 0; i < ARRAY9_COUNT; i++) {
    const entry = ARRAY9_BASE + i * ARRAY9_STRIDE;
    if (rb(state, entry + ACTIVE_OFFSET) === 1) return true;
  }
  return false;
}

export function array9InitAndDispatch18FFA(
  state: GameState,
  rom: RomImage,
  subs: Array9InitAndDispatch18FFASubs = {},
): void {
  if (anyActive(state)) return;

  const rng = subs.fun_13a98 ?? defaultRng;
  const validate = subs.fun_1937c ?? ((st, addr) => sub1937C(st, rom, addr));
  const dispatch194ba = subs.fun_194ba ?? ((st, addr) => defaultObjectDispatch(st, rom, addr));
  const updateCoords = subs.fun_199d6 ?? computeSpriteCoords_v2;
  const insertSorted = subs.fun_18e6c ?? ((st, typeCode, subIdx) => {
    slotInsertSorted18E6C(st, rom, typeCode, subIdx);
  });

  for (let i = 0; i < ARRAY9_COUNT; i++) {
    const entry = ARRAY9_BASE + i * ARRAY9_STRIDE;
    const typeCode = i < 3 ? 7 : i < 6 ? 8 : 9;

    wb(state, entry + TYPE_OFFSET, typeCode);
    wb(state, entry + ACTIVE_OFFSET, 1);
    wb(state, entry + KIND_OFFSET, 0);

    while (true) {
      const x = (((((rng(state, 0x20) & 0xffff) << 2) + 0x02ca) << 16) >>> 0);
      wl(state, entry + 0x0c, x);
      const y = (((((rng(state, 0x20) & 0xffff) << 2) + 0x02d2) << 16) >>> 0);
      wl(state, entry + 0x10, y);
      if ((validate(state, entry) | 0) === 0) break;
    }

    wl(state, entry + 0x14, 0x3f6e0000);
    wl(state, entry + 0x08, 0);
    wl(state, entry + 0x04, 0);
    wl(state, entry + 0x00, 0);
    wb(state, entry + SUB_COUNTER_OFFSET, 0);

    dispatch194ba(state, entry);
    updateCoords(state, entry);
    insertSorted(state, rb(state, entry + TYPE_OFFSET), rb(state, entry + SUB_INDEX_OFFSET));
  }
}
