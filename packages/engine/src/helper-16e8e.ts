/**
 * Bit-perfect port of `FUN_00016E8E`.
 *
 * Clears alpha-tilemap rows from `arg & 0xff` inclusive up to `0x1E`
 * exclusive. Each row asks `getAlphaTileAddr` (thunk 0x224 -> FUN_37E4) for
 * column 3, then clears 0x24 words starting at the returned address.
 *
 * Full disassembly sketch:
 *
 *   00016e8e    move.l  D2,-(SP)           ; save D2
 *   00016e90    move.w  (0xa,SP),D0w       ; D0w = low word of arg
 *   00016e94    move.b  D0b,D2b            ; D2b = D0b (low byte = startRow)
 *   00016e96    bra.b   0x00016ebc         ; → loop condition
 *
 *   ; ── LOOP BODY ─────────────────────────────────────────────────────────
 *   00016e98    move.b  D2b,D0b            ; D0b = D2b
 *   00016e9a    ext.w   D0w                ; sign-extend byte → word
 *   00016e9c    ext.l   D0                 ; sign-extend word → long
 *   00016e9e    move.l  D0,-(SP)           ; push row (long) as arg
 *   00016ea0    pea     (0x3).w            ; push with the=3 as arg
 *   00016ea4    jsr     0x00000224.l       ; → getAlphaTileAddr(with the=3, row=D0)
 *   00016eaa    movea.l D0,A0              ; A0 = returned address
 *   00016eac    clr.b   D0b               ; D0b = 0 (inner counter)
 *   00016eae    addq.l  0x8,SP             ; pop 2 × 4 byte args
 *
 *   ; ── INNER LOOP (0x24 iterations) ──────────────────────────────────────
 *   00016eb0    clr.w   (A0)+              ; *(A0) = 0; A0 += 2
 *   00016eb2    addq.b  0x1,D0b            ; D0b++
 *   00016eb4    cmpi.b  #0x24,D0b          ; D0b == 36?
 *   00016eb8    bne.b   0x00016eb0         ; no → repeat inner
 *
 *   00016eba    addq.b  0x1,D2b            ; D2b++ (outer row counter)
 *
 *   ; ── LOOP CONDITION ────────────────────────────────────────────────────
 *   00016ebc    cmpi.b  #0x1e,D2b          ; D2b == 0x1E (30)?
 *   00016ec0    bne.b   0x00016e98         ; no → back to loop body
 *
 *   00016ec2    move.l  (SP)+,D2           ; restore D2
 *   00016ec4    rts
 *
 * Stack argument: long pushed via `pea` or `move.l`:
 *   - `move.w (0xa,SP),D0w` → reads low word of the long at stack offset 10
 *     (= 4 bytes saved D2 + 4 bytes return addr + 2 byte word alignment pad).
 *     The low byte is the effective `startRow`.
 *
 * Side effects: clears words in `alphaRam` starting at the address returned by
 * `getAlphaTileAddr(with the=3, row=r)` for each row in [startRow, 0x1E).
 *
 * Out-of-range writes are ignored because this port models only alpha RAM.
 *
 * **Callers**:
 *   - `FUN_00010504` @ `0x10E9C`: `pea (0x4).w` → startRow=4
 *   - `FUN_00016A20` @ `0x16C8A`: callers various
 *   - `FUN_00016A20` @ `0x16DD0`: callers various
 */

import type { GameState } from "./state.js";
import { getAlphaTileAddr } from "./alpha-tilemap.js";

export const HELPER_16E8E_ADDR = 0x00016e8e as const;

/** thunk 0x224 → FUN_37E4 address */
export const GET_ALPHA_TILE_ADDR_THUNK = 0x00000224 as const;

// ── Sub injection interface ───────────────────────────────────────────────────

export interface Helper16E8ESubs {
  /**
   * `FUN_37E4` via thunk `0x224`: compute the alpha-tile address for
   * (with the=3, row=r). Default: `getAlphaTileAddr(state, rom, with the, row)`.
   *
   * Signature M68K: getAlphaTileAddr(with the: number, row: number) → address.
   * TypeScript wrapper: (state, rom, with the, row) → number.
   */
  getAlphaTileAddr?: (
    state: GameState,
    rom: { program: Uint8Array },
    col: number,
    row: number,
  ) => number;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Clear alpha-tilemap rows from `arg & 0xff` up to `0x1E` exclusive.
 *
 * For each row:
 *  1. `addr = getAlphaTileAddr(with the=3, row=r)` (via thunk 0x224)
 *  2. Write 0x24 zero words starting at `addr` (72 bytes).
 *
 * @param state Game state; target rows in `alphaRam` are cleared.
 * @param rom ROM image used by `getAlphaTileAddr`.
 * @param arg Long stack argument; the binary uses its low byte as startRow.
 * @param subs Optional injection for the JSR target.
 */
export function helper16E8E(
  state: GameState,
  rom: { program: Uint8Array },
  arg: number,
  subs: Helper16E8ESubs = {},
): void {
  // move.w (0xa,SP),D0w → low word of arg; move.b D0b,D2b → low byte
  let d2b = arg & 0xff;

  // bra → jump to condition check first (do-while equivalent)
  const addrFn = subs.getAlphaTileAddr ?? getAlphaTileAddr;

  // Loop condition check first (bra to 0x16ebc)
  while (d2b !== 0x1e) {
    // sign-extend D2b → D0 (ext.w; ext.l)
    const d0 = (d2b & 0x80) ? ((d2b & 0xff) - 0x100) : (d2b & 0xff);

    // jsr 0x224 with args: pea(3) on top, then D0 below
    // getAlphaTileAddr(with the=3, row=d0)
    const a0 = addrFn(state, rom, 3, d0) >>> 0;

    // Inner loop: clr.w (A0)+ × 0x24
    const ALPHA_BASE = 0xa03000;
    const ALPHA_END = 0xa04000;
    let addr = a0;
    for (let d0b = 0; d0b < 0x24; d0b++) {
      if (addr >= ALPHA_BASE && addr + 1 < ALPHA_END) {
        const off = addr - ALPHA_BASE;
        state.alphaRam[off] = 0;
        state.alphaRam[off + 1] = 0;
      }
      addr = (addr + 2) >>> 0;
    }

    // addq.b 0x1,D2b — byte increment (wraps mod 256)
    d2b = (d2b + 1) & 0xff;
    // loop condition: cmpi.b #0x1e,D2b / bne back
  }
}
