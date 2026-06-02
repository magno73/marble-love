/**
 * sub-19976.ts — `FUN_00019976` replica (96 bytes): apply velocity to entity.
 *
 * Uses direction to read 2 signed words from ROM table @ 0x244B6 (dX) and
 * adds the resulting long to `entity[0x0C..0x0F]` (x) and `entity[0x10..0x13]` (y).
 *
 * for further subs).
 *
 * **Disasm 0x19976..0x199D4** (96 byte):
 *
 *   move.l   D2,-(SP)                       ; save D2
 *   movea.l  (0x8,SP),A0                    ; A0 = arg (entity ptr)
 *   move.b   (0x26,A0),D0b                  ; D0.b = entity[0x26] (dir)
 *   ext.w    D0w                            ; sign-extend → word
 *   add.w    D0w,D0w                        ; D0w *= 2 (word index)
 *   movea.l  #0x244b6,A1                    ; A1 = ROM dX table
 *   move.w   (0x0,A1,D0w*0x1),D0w           ; D0w = ROM_DX[dir*2] (signed)
 *   ext.l    D0                             ; sign-extend → long
 *   move.l   D0,D2
 *   asl.l    #0x8,D2                        ; D2 = dX << 8 (long)
 *   move.b   (0x26,A0),D0b                  ; (again)
 *   ext.w    D0w
 *   add.w    D0w,D0w
 *   movea.l  #0x244d6,A1                    ; A1 = ROM dY table
 *   move.w   (0x0,A1,D0w*0x1),D0w           ; D0w = ROM_DY[dir*2]
 *   ext.l    D0
 *   move.l   D0,D1
 *   asl.l    #0x8,D1                        ; D1 = dY << 8 (long)
 *   move.l   D2,D0
 *   add.l    D0,(0xc,A0)                    ; entity[0xC..0xF] += dX_long
 *   move.l   D1,D0
 *   add.l    D0,(0x10,A0)                   ; entity[0x10..0x13] += dY_long
 *   cmpi.b   #0x7,(0x25,A0)
 *   bne.b    0x199cc                        ; state != 7 → skip /4
 *   move.l   D2,D0
 *   asr.l    #0x2,D0                        ; D0 = dX_long / 4
 *   move.l   D0,D2
 *   move.l   D1,D0
 *   asr.l    #0x2,D0                        ; D0 = dY_long / 4
 *   move.l   D0,D1
 *   move.l   D2,(A0)                        ; entity[0..3] = dX (maybe /4)
 *   move.l   D1,(0x4,A0)                    ; entity[4..7] = dY (maybe /4)
 *   move.l   (SP)+,D2
 *   rts
 *
 * **Side effects** on `state.workRam`:
 *   - `entity[0x00..0x07]`: velocity long X,Y, always rewritten.
 *   - `entity[0x0C..0x13]`: position long X,Y, always incremented.
 *
 * **Note**: this is the same replica as `move-velocity.ts` (FUN_19976 =
 * `applyMoveVelocity`) exposed under the conventional `sub-XXXXX.ts` name. The
 * `(state, rom, addr) => void` signature matches the ROM `jsr` call with
 * `entity` as the only long argument on the stack.
 *
 * **Wrapper helper** (`sub19976AsInjection`): produces a closure compatible
 * with the `fun_19976` sub-injection from `state-sub-198bc.ts` / `sub-19692.ts`,
 * applying the `RomImage` once at setup.
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Base ROM table for dX (word, signed). */
export const ROM_DX_TABLE = 0x244b6 as const;
/** Base ROM table for dY (word, signed). */
export const ROM_DY_TABLE = 0x244d6 as const;

/** Offset velocity cache long X (`entity[0..3]`). */
export const ENTITY_VEL_X_OFFSET = 0x00 as const;
/** Offset velocity cache long Y (`entity[4..7]`). */
export const ENTITY_VEL_Y_OFFSET = 0x04 as const;
export const ENTITY_POS_X_OFFSET = 0x0c as const;
export const ENTITY_POS_Y_OFFSET = 0x10 as const;
/** Offset state-byte (`entity[0x25]`). */
export const ENTITY_STATE_OFFSET = 0x25 as const;
/** Offset direction-byte (`entity[0x26]`, signed). */
export const ENTITY_DIR_OFFSET = 0x26 as const;
export const STATE_FINE_SCALE = 0x07 as const;

function readU32(s: GameState, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>> 0
  );
}
function writeU32(s: GameState, off: number, v: number): void {
  const x = v >>> 0;
  s.workRam[off] = (x >>> 24) & 0xff;
  s.workRam[off + 1] = (x >>> 16) & 0xff;
  s.workRam[off + 2] = (x >>> 8) & 0xff;
  s.workRam[off + 3] = x & 0xff;
}

function readSignedWordRom(rom: RomImage, addr: number): number {
  const hi = rom.program[addr] ?? 0;
  const lo = rom.program[addr + 1] ?? 0;
  const raw = (hi << 8) | lo;
  return raw & 0x8000 ? raw - 0x10000 : raw;
}

/**
 *
 * @param state       GameState (modifies `entity[0x00..0x07]` and `entity[0x0C..0x13]`).
 * @param rom         RomImage to read the ROM tables 0x244B6 (dX) and 0x244D6 (dY).
 */
export function sub19976(state: GameState, rom: RomImage, entityAddr: number): void {
  const off = (entityAddr - 0x400000) >>> 0;
  const r = state.workRam;

  // D0.b = entity[0x26], ext.w (sign extend byte → word). Index = D0w * 2.
  const dirByte = (r[off + ENTITY_DIR_OFFSET] ?? 0) & 0xff;
  const dirSigned = dirByte & 0x80 ? dirByte - 0x100 : dirByte;

  const dxRaw = readSignedWordRom(rom, (ROM_DX_TABLE + dirSigned * 2) >>> 0);
  const d2 = (dxRaw << 8) | 0; // signed shift in 32-bit int

  const dyRaw = readSignedWordRom(rom, (ROM_DY_TABLE + dirSigned * 2) >>> 0);
  const d1 = (dyRaw << 8) | 0;

  // entity[0xC..0xF] += d2 (long add, mod 2^32).
  writeU32(state, off + ENTITY_POS_X_OFFSET, ((readU32(state, off + ENTITY_POS_X_OFFSET) + d2) >>> 0));
  writeU32(state, off + ENTITY_POS_Y_OFFSET, ((readU32(state, off + ENTITY_POS_Y_OFFSET) + d1) >>> 0));

  // If state == 7 → asr.l #2 (signed shift right by 2) on d2 and d1.
  let velX = d2;
  let velY = d1;
  if ((r[off + ENTITY_STATE_OFFSET] ?? 0) === STATE_FINE_SCALE) {
    velX = velX >> 2; // signed shift
    velY = velY >> 2;
  }

  // entity[0..3] = velX, entity[4..7] = velY (long BE).
  writeU32(state, off + ENTITY_VEL_X_OFFSET, velX >>> 0);
  writeU32(state, off + ENTITY_VEL_Y_OFFSET, velY >>> 0);
}

/**
 * (`StateSub198BCSubs.fun_19976`, `Sub19692Subs.fun_19976`).
 *
 * @param rom  RomImage to inject (captured in the closure).
 * @returns    closure `(state, entityAddr) => void`.
 */
export function sub19976AsInjection(
  rom: RomImage,
): (state: GameState, entityAddr: number) => void {
  return (state: GameState, entityAddr: number): void => {
    sub19976(state, rom, entityAddr);
  };
}
