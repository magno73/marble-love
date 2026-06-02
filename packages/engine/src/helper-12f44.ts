/**
 * Bit-perfect port of `FUN_00012F44`.
 *
 * Binds or frees a script-slot record in work RAM based on a signed `mode`
 * byte. Mode 0 binds the slot and stores the script pointer; mode 1 frees the
 * slot and runs the type/sub-index cleanup; values outside 0..1 are no-ops.
 *
 * **Calling convention M68k** (RTL, 3 arg long):
 *   - `SP+8`  → byte al offset `SP+B` = `mode` (sign-extended a long in A1).
 *
 *   Tipico pattern caller mode-0:
 *   ```
 *     move.l  <scriptPtr>,-(SP)   ; arg3 = scriptPtr
 *     clr.l   -(SP)               ; arg2 = mode=0
 *     move.l  <slotPtr>,-(SP)     ; arg1 = slotPtr
 *     jsr     0x00012F44.l
 *     lea     (0xC,SP),SP
 *   ```
 *   Tipico pattern caller mode-1:
 *   ```
 *     clr.l   -(SP)               ; arg3 = 0
 *     pea     (0x1).w             ; arg2 = mode=1
 *     move.l  <slotPtr>,-(SP)     ; arg1 = slotPtr
 *     jsr     0x00012F44.l
 *     lea     (0xC,SP),SP
 *   ```
 *
 * Disassembly sketch:
 *
 *   00012f44  movea.l (0x4,SP),A0          ; A0 = slotPtr
 *   00012f48  move.b  (0xb,SP),D0b         ; D0.b = mode (low byte of arg2 long)
 *   00012f4c  move.l  (0xc,SP),D1          ; D1   = scriptPtr (arg3)
 *   00012f50  ext.w   D0w                  ; sign-extend D0.b → D0.w
 *   00012f52  ext.l   D0                   ; sign-extend D0.w → D0.l
 *   00012f54  movea.l D0,A1                ; A1 = mode (signed long)
 *
 *   ; Mode dispatch
 *   00012f56  cmpa.w  #0x0,A1              ; A1 == 0?
 *   00012f5a  blt.w   0x12fce              ; mode < 0 → return
 *   00012f5e  bgt.b   0x12f62              ; mode > 0 → check == 1
 *   00012f60  bra.b   0x12f6c              ; mode == 0 → bind path
 *   00012f62  cmpa.w  #0x1,A1             ; mode == 1?
 *   00012f66  bne.w   0x12fce              ; mode > 1 → return
 *   00012f6a  bra.b   0x12f7e              ; mode == 1 → free path
 *
 *   ; Mode-0 bind @ 0x12F6C:
 *   00012f6c  move.l  D1,(0x3a,A0)        ; slot+0x3A = scriptPtr (long BE)
 *   00012f70  move.b  #0x3,(0x1a,A0)      ; slot+0x1A = 3 (state init)
 *   00012f76  move.b  #0x1,(0x18,A0)      ; slot+0x18 = 1 (mark occupied)
 *   00012f7c  bra.b   0x12fce             ; return
 *
 *   ; Mode-1 free @ 0x12F7E:
 *   00012f7e  cmpa.l  (0x00400974).l,A0   ; A0 == *0x400974?
 *   00012f84  bne.b   0x12f94             ; no → skip global clear
 *   00012f86  moveq   0x0,D0
 *   00012f88  move.l  D0,(0x00400978).l   ; *0x400978 = 0
 *   00012f8e  move.l  D0,(0x00400974).l   ; *0x400974 = 0
 *   00012f94  clr.b   (0x18,A0)           ; slot+0x18 = 0
 *   00012f98  clr.b   (0x1a,A0)           ; slot+0x1A = 0
 *   00012f9c  cmpi.b  #0x6,(0x1f,A0)      ; slot+0x1F == 6?
 *   00012fa2  bne.b   0x12faa             ; no → skip counter decrement
 *   00012fa4  subq.b  0x1,(0x0040075c).l  ; *0x40075C.b -= 1
 *   00012faa  cmpi.b  #0x1,(0x1e,A0)      ; slot+0x1E == 1?
 *   00012fb0  beq.b   0x12fce             ; yes → return (no FUN_18F46)
 *   00012fb2  move.b  (0x19,A0),D0b       ; D0.b = slot+0x19
 *   00012fb6  ext.w   D0w
 *   00012fb8  ext.l   D0                  ; D0 = sext(slot+0x19)
 *   00012fba  move.l  D0,-(SP)            ; push arg2 (subIdx)
 *   00012fbc  move.b  (0x1f,A0),D0b       ; D0.b = slot+0x1F
 *   00012fc0  ext.w   D0w
 *   00012fc2  ext.l   D0                  ; D0 = sext(slot+0x1F)
 *   00012fc4  move.l  D0,-(SP)            ; push arg1 (typeCode, closer to SP)
 *   00012fc6  jsr     0x00018f46.l        ; FUN_18F46(typeCode=sext(1F), subIdx=sext(19))
 *   00012fcc  addq.l  0x8,SP
 *   00012fce  rts
 *
 * Slot record offsets, relative to `slotPtr`:
 *   - `+0x18` (byte) = occupied flag (0=free, 1=occupied).
 *   - `+0x19` (byte) = sub-index passed to FUN_18F46 in mode 1.
 *   - `+0x1F` (byte) = type code passed to FUN_18F46 in mode 1.
 *   - `+0x3A` (long) = script pointer written in mode 0.
 *
 * `0x40075C` is decremented by one when `slot+0x1F == 6` in mode 1.
 *
 * Known callers:
 *   - `FUN_00012D46` @ 0x12D60 — mode-0, bind script slot.
 *   - `FUN_00012DFA` @ 0x12E96, 0x12ED6, 0x12F28 — mode-0, bind (rect-dispatch).
 *   - `FUN_0001365C` @ 0x138B4 — mode-1, free slot.
 *   - `FUN_00012896` @ 0x12C74 — mode-0 o mode-1 (vedi FUN_12896).
 *
 *   `packages/cli/src/test-helper-12f44-parity.ts` (500/500).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { helper18F46 } from "./helper-18f46.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Absolute M68k work RAM base. */
const WORK_RAM_BASE = 0x00400000 as const;

export const HELPER_12F44_ADDR = 0x00012f44 as const;

const OFF_SLOTPTR_974 = 0x0974; // 0x400974 - WORK_RAM_BASE
const OFF_DECNEXT_978 = 0x0978; // 0x400978 - WORK_RAM_BASE
const OFF_COUNTER_75C = 0x075c; // 0x40075C - WORK_RAM_BASE

// Slot field offsets, relative to slotPtr - WORK_RAM_BASE.
const SLOT_OCCUPIED_OFF  = 0x18; // byte: 0=free, 1=occupied
const SLOT_SUBIDX_OFF    = 0x19; // byte: sub-index → FUN_18F46 subIdx
const SLOT_STATE_OFF     = 0x1a; // byte: state init (3 = bound, 0 = free)
const SLOT_GATE1E_OFF    = 0x1e;
const SLOT_TYPE_OFF      = 0x1f; // byte: type code → FUN_18F46 typeCode; decrements counter if 6
const SLOT_SCRIPT_OFF    = 0x3a; // long BE: script pointer (mode-0)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function r8(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function w8(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function r32(state: GameState, off: number): number {
  return (
    (((state.workRam[off]     ?? 0) << 24) |
     ((state.workRam[off + 1] ?? 0) << 16) |
     ((state.workRam[off + 2] ?? 0) << 8)  |
      (state.workRam[off + 3] ?? 0)) >>> 0
  );
}

function w32(state: GameState, off: number, v: number): void {
  const u = v >>> 0;
  state.workRam[off]     = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8)  & 0xff;
  state.workRam[off + 3] =  u         & 0xff;
}

/**
 * Sign-extend byte (8 → 32 bit), matching `ext.w; ext.l` on M68k.
 */
function sextByte(v: number): number {
  const b = v & 0xff;
  return b < 0x80 ? b : (b - 0x100);
}

// ─── Replica ─────────────────────────────────────────────────────────────────

/**
 * Bind or free one script-slot record.
 *
 * @param rom ROM image passed through to `helper18F46` on the mode-1 cleanup.
 * @param slotPtr Absolute work RAM pointer to the slot record.
 * @param mode Byte sign-extended to int: 0 = bind, 1 = free, otherwise no-op.
 * @param scriptPtr Script pointer written to `slot+0x3A` in mode 0.
 *
 * **Mutation (mode-0)**:
 *   - `slot+0x3A..0x3D` = `scriptPtr` (long BE).
 *   - `slot+0x1A` = 3.
 *   - `slot+0x18` = 1.
 *
 * **Mutation (mode-1)**:
 *   - If `slotPtr == *0x400974`: `*0x400978 = 0`, `*0x400974 = 0`.
 *   - `slot+0x18` = 0.
 *   - `slot+0x1A` = 0.
 *   - If `slot+0x1F == 6`: `*0x40075C.b -= 1`.
 *
 */
export function helper12F44(
  state: GameState,
  rom: RomImage,
  slotPtr: number,
  mode: number,
  scriptPtr: number,
): void {
  // Convert byte-mode to signed int (`ext.w; ext.l` on D0.b).
  const modeSigned = sextByte(mode & 0xff);

  // cmpa.w #0,A1; blt → return  (mode < 0)
  // cmpa.w #1,A1; bne → return  (mode > 1)
  if (modeSigned < 0 || modeSigned > 1) return;

  const slotOff = (slotPtr - WORK_RAM_BASE) >>> 0;

  if (modeSigned === 0) {
    // ── Mode-0: bind ────────────────────────────────────────────────────────
    // move.l D1,(0x3a,A0)  → slot+0x3A = scriptPtr (long BE)
    w32(state, slotOff + SLOT_SCRIPT_OFF, scriptPtr >>> 0);
    // move.b #3,(0x1a,A0)  → slot+0x1A = 3
    w8(state, slotOff + SLOT_STATE_OFF, 0x03);
    // move.b #1,(0x18,A0)  → slot+0x18 = 1
    w8(state, slotOff + SLOT_OCCUPIED_OFF, 0x01);
  } else {
    // ── Mode-1: free ─────────────────────────────────────────────────────────

    const activeLong = r32(state, OFF_SLOTPTR_974);
    if ((slotPtr >>> 0) === activeLong) {
      w32(state, OFF_DECNEXT_978, 0);
      w32(state, OFF_SLOTPTR_974, 0);
    }

    // clr.b (0x18,A0); clr.b (0x1a,A0)
    w8(state, slotOff + SLOT_OCCUPIED_OFF, 0);
    w8(state, slotOff + SLOT_STATE_OFF, 0);

    // cmpi.b #6,(0x1f,A0) -> if 6, decrement *0x40075C.b
    if (r8(state, slotOff + SLOT_TYPE_OFF) === 0x06) {
      const cur = r8(state, OFF_COUNTER_75C);
      w8(state, OFF_COUNTER_75C, (cur - 1) & 0xff);
    }

    // cmpi.b #1,(0x1e,A0) -> if 1, return (skip FUN_18F46)
    if (r8(state, slotOff + SLOT_GATE1E_OFF) === 0x01) return;

    // helper18F46 signature: (state, rom, typeCode, subIdx)
    const typeCode = sextByte(r8(state, slotOff + SLOT_TYPE_OFF));
    const subIdx   = sextByte(r8(state, slotOff + SLOT_SUBIDX_OFF));
    helper18F46(state, rom, typeCode, subIdx);
  }
}
