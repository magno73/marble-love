/**
 * text-slot-writers.ts — replica `FUN_0000255A` + `FUN_00028F28` + `FUN_00028F62`.
 *
 * 3 helper text-slot related, callees indiretti di `FUN_28E3C` (render-score
 *
 * **`FUN_255A`** (8 instr, 6 callers): write 2 byte + clear byte at +0x6 a
 *   un buffer pointed by A0 (arg long stack):
 *     A0 = (4,SP).l    ; arg ptr
 *     D1.b = (B,SP).b  ; arg byte 1
 *     D0.b = (F,SP).b  ; arg byte 2
 *     *(A0)   = D1.b
 *     *(1,A0) = D0.b
 *     *(6,A0) = 0
 *   Equivalent to initializing a 7-byte "text descriptor" struct
 *   (slot[0]=type, slot[1]=color/flags, slot[2..5] likely ROM ptr, slot[6]=enable=0).
 *
 *   trailing first space" (replaces it with null terminator).
 *
 * **`FUN_28F62`** (21 instr, 2 callers): orchestrator that invokes 2 thunks
 *   with the same buffer A0=0x40041C:
 *     - jsr 0x013C → FUN_255A (write 2 byte tuple)
 *     - jsr 0x0142 → FUN_2572 (state-sub render string chain, replicated)
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { stateSub2572 } from "./state-sub-2572.js";

export const TEXT_SLOT_INIT_255A_ADDR = 0x0000255a as const;
export const TRIM_TRAILING_SPACE_28F28_ADDR = 0x00028f28 as const;
export const RENDER_TEXT_SLOT_28F62_ADDR = 0x00028f62 as const;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_END = 0x00402000;

function readU8Abs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    return state.workRam[a - WORK_RAM_BASE] ?? 0;
  }
  return 0;
}

function writeU8Abs(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    state.workRam[a - WORK_RAM_BASE] = value & 0xff;
  }
  // else: ignore (out-of-range)
}

/**
 * Replica `FUN_0000255A` — text-slot init writer (3 byte write).
 *
 * Disasm:
 *   A0 = ptr (arg long)
 *   D1.b = arg byte 1
 *   D0.b = arg byte 2
 *   *(A0) = D1.b           ; slot[0] = type/byte1
 *   *(1,A0) = D0.b         ; slot[1] = color/byte2
 *   *(6,A0) = 0            ; slot[6] = enable flag = 0
 *
 * @param ptrAbs    Pointer assoluto M68k al text slot (workRam o ROM)
 * @param byte1     Byte 1 (slot[0])
 * @param byte2     Byte 2 (slot[1])
 */
export function textSlotInit255A(
  state: GameState,
  ptrAbs: number,
  byte1: number,
  byte2: number,
): void {
  writeU8Abs(state, ptrAbs, byte1);
  writeU8Abs(state, ptrAbs + 1, byte2);
  writeU8Abs(state, ptrAbs + 6, 0);
}

/**
 * Replica `FUN_00028F28` — trim trailing space.
 *
 * Disasm:
 *   D0 = arg1 long (string ptr)
 *   D1 = arg2 long (max len)
 *   A0 = D0
 *   D2.b = 0 (counter)
 *   loop:
 *     if *(A0) == 0x20: break
 *     if D2 >= D1: break
 *     A0++; D2++
 *     bra loop
 *   if D2 < D1 AND *(A0) == 0x20: *(A0) = 0  (clear space → null terminator)
 *
 */
export function trimTrailingSpace28F28(
  state: GameState,
  ptrAbs: number,
  maxLen: number,
): number {
  let pos = 0;
  while (pos < maxLen) {
    if (readU8Abs(state, ptrAbs + pos) === 0x20) break;
    pos += 1;
  }
  if (pos < maxLen && readU8Abs(state, ptrAbs + pos) === 0x20) {
    writeU8Abs(state, ptrAbs + pos, 0);
  }
  return pos;
}

/**
 * Replica `FUN_00028F62` — render text slot orchestrator.
 *
 * Disasm:
 *   D1.w = (A,SP).w (= arg1 word)
 *   D0.w = (E,SP).w (= arg2 word)
 *   D2.w = (12,SP).w (= arg3 word)
 *   ; jsr FUN_255A (= thunk 0x13C):
 *   push 0x40041C, push D1 ext, push D0 ext  → jsr FUN_255A
 *   ; jsr FUN_2572 (= thunk 0x142):
 *   push D2 ext, push 0x40041C  → jsr FUN_2572 (= stateSub2572)
 *   cleanup, rts
 *
 * @param state    GameState
 * @param rom      ROM (per stateSub2572)
 * @param arg1     Word arg per textSlotInit255A byte1
 * @param arg2     Word arg per textSlotInit255A byte2
 * @param arg3     Word arg per stateSub2572 (text ptr long)
 */
export function renderTextSlot28F62(
  state: GameState,
  rom: RomImage,
  arg1: number,
  arg2: number,
  arg3: number,
): void {
  // jsr FUN_255A(0x40041C, arg1.b, arg2.b)
  textSlotInit255A(state, 0x0040041c, arg1 & 0xff, arg2 & 0xff);
  // jsr FUN_2572(0x40041C, arg3.l) — note: stateSub2572 signature
  // is (state, rom, arg1Long, arg2Long) → number. Discard return.
  stateSub2572(state, rom, 0x0040041c, arg3 >>> 0);
}
