/**
 * state-sub-5250.ts - `FUN_00005250` replica (12 bytes, 0x5250-0x525B).
 *
 * Primitive that ORs a bitmask into both status-flag bitmaps in work RAM.
 *
 * **Disasm 0x5250..0x525B** (12 byte):
 *
 *   0x5250  or.l  D1,(0x00401F5E).l   ; *0x401F5E |= D1  (primary flags,  long-BE)
 *   0x5256  or.l  D1,(0x00401F76).l   ; *0x401F76 |= D1  (secondary flags, long-BE)
 *   0x525C  rts
 *
 * `or.l Dn,(abs).l` = 2-byte opcode + 4-byte absolute address = 6 bytes per
 * instruction. Two instructions = 12 bytes + rts = 14 bytes if including the
 * following rts, but the compiler does not emit a duplicate `rts`; Ghidra's
 * Ghidra delimits FUN_5250 as 12 bytes, excluding the shared `rts`: those
 * 12 bytes contain only the two `or.l` instructions.
 *
 *
 * **Xrefs (callers)**:
 *   - 0x50C6 in FUN_00004F38 (UNCONDITIONAL_CALL)
 *   - 0x51F8 in FUN_00004F38 (UNCONDITIONAL_CALL)
 *
 * whenever it wants to mark a flag set in both the primary and secondary longs.
 *
 *   - workRam[0x1F5E..0x1F61] (long-BE) |= d1
 *   - workRam[0x1F76..0x1F79] (long-BE) |= d1
 *
 * **Relationship with adjacent modules**:
 *   - `FUN_005248` (immediate predecessor): `or.l D1,(0x401F5E).l; rts` - OR only
 *     primary flags. FUN_5250 also ORs secondary, covering both
 *     le bitmap controllate da `FUN_52A2` (cfr `state-sub-5284.ts`).
 *     bitmaps checked by `FUN_52A2` (see `state-sub-5284.ts`).
 *   - `FUN_0000525C` (successor): uses `fun523A` to set individual bits in
 *     primary flags; it does not touch secondary directly.
 *
 */

import type { GameState } from "./state.js";

// ─── Costanti ────────────────────────────────────────────────────────────────

/** Offset workRam of the long-BE "primary status flags" @ 0x401F5E. */
export const PRIMARY_FLAGS_OFF = 0x1f5e as const;

/** Offset workRam of the long-BE "secondary status flags" @ 0x401F76. */
export const SECONDARY_FLAGS_OFF = 0x1f76 as const;

export const PRIMARY_FLAGS_ADDR = 0x00401f5e as const;

export const SECONDARY_FLAGS_ADDR = 0x00401f76 as const;

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * OR cumulativo of una maschera 32-bit su un long-BE in workRam a `off`.
 *
 * Implementa `or.l Dn,(abs).l` per un offset workRam dato.
 */
function orLongBE(r: Uint8Array, off: number, mask: number): void {
  const m = mask >>> 0;
  if (m === 0) return; // OR con 0 = no-op; avoids write useless.
  const cur =
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0;
  const next = (cur | m) >>> 0;
  r[off]     = (next >>> 24) & 0xff;
  r[off + 1] = (next >>> 16) & 0xff;
  r[off + 2] = (next >>> 8)  & 0xff;
  r[off + 3] =  next         & 0xff;
}

// ─── Replica ─────────────────────────────────────────────────────────────────

/**
 *
 *   1. `or.l D1,(0x401F5E).l`  — primary flags
 *   2. `or.l D1,(0x401F76).l`  — secondary flags
 *
 * @param state  GameState. workRam mutated in two locations:
 *               `[0x1F5E..0x1F61]` and `[0x1F76..0x1F79]`.
 * @param d1     Bitmask long (unsigned 32-bit). Same mask applied to
 *
 *
 */
export function stateSub5250(state: GameState, d1: number): void {
  const r = state.workRam;
  const mask = d1 >>> 0;

  // 0x5250: or.l D1,(0x00401F5E).l — primary status flags.
  orLongBE(r, PRIMARY_FLAGS_OFF, mask);

  // 0x5256: or.l D1,(0x00401F76).l — secondary status flags.
  orLongBE(r, SECONDARY_FLAGS_OFF, mask);
}
