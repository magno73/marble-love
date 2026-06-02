/**
 * state-sub-5608.ts - port of `FUN_00005608` (82 bytes).
 *
 * Builds two render-like calls and one handle-dispatch call from ROM constants:
 *   - two immediates (`0x1B`, `0x1C`) - likely row / position ids
 *
 * **Disasm 0x5608..0x5658** (82 byte = 0x52):
 *
 *   0x5608  move.l D2,-(SP)                 ; preserve D2 (callee-saved)
 *   0x560A  tst.b  (0x00010072).l           ; test byte ROM @ 0x10072
 *   0x5610  beq.b  0x00005616                ; if byte == 0  → D0 = 8
 *   0x5612  moveq  #4,D0                    ; if byte != 0  → D0 = 4
 *   0x5614  bra.b  0x00005618
 *   0x5616  moveq  #8,D0
 *   0x5618  move.l D0,D2                    ; D2 = D0 (saved for phase 2/3)
 *   0x561A  pea    (0x7978).l               ; push 0x7978 -> FUN_52DA #1 arg3
 *   0x5620  pea    (0x1B).w                 ; push 0x1B   -> FUN_52DA #1 arg2
 *   0x5624  move.l D2,D0
 *   0x5626  addq.l #3,D0                    ; D0 = D2 + 3
 *   0x5628  move.l D0,-(SP)                 ; push D2+3   -> FUN_52DA #1 arg1
 *   0x562A  jsr    0x000052DA.l             ; FUN_52DA(D2+3, 0x1B, 0x7978)
 *   0x5630  move.l (0x00010074).l,-(SP)     ; push long ROM @ 0x10074 -> FUN_5334 argLong
 *   0x5636  jsr    0x00005334.l             ; FUN_5334(*ROM[0x10074])
 *   0x563C  pea    (0x7980).l               ; push 0x7980  -> FUN_52DA #2 arg3
 *   0x5642  pea    (0x1C).w                 ; push 0x1C   -> FUN_52DA #2 arg2
 *   0x5646  move.l D2,D0
 *   0x5648  addq.l #4,D0                    ; D0 = D2 + 4
 *   0x564A  move.l D0,-(SP)                 ; push D2+4   -> FUN_52DA #2 arg1
 *   0x564C  jsr    0x000052DA.l             ; FUN_52DA(D2+4, 0x1C, 0x7980)
 *   0x5652  lea    (0x1C,SP),SP             ; pop 28 byte (12 + 4 + 12 = 28 = 0x1C)
 *   0x5656  move.l (SP)+,D2                 ; restore D2
 *   0x5658  rts
 *
 * **ROM addresses** (immutable at runtime):
 *     Some are pushed with `pea` and are not dereferenced here; they are passed as-is.
 *
 * **Caller convention**:
 *   - D2 is preserved by the prologue/epilogue.
 *
 * **Side effects**:
 *   callee:
 *     1. `FUN_52DA(D2+3, 0x1B, 0x7978)` — render-string-like #1
 *     2. `FUN_5334(*ROM[0x10074])`     — handle dispatch
 *     3. `FUN_52DA(D2+4, 0x1C, 0x7980)` — render-string-like #2
 *
 * = `() => 0` (no-op), allowing isolated tests. The differential test uses the
 *
 * **Low-level fidelity notes**:
 *   - `beq.b` branches on Z=1 (byte == 0).
 *     `moveq` sign-extends the full long, not only the low byte. 4 and 8 are
 *     positive, so D0 = 0x00000004 or
 *     0x00000008. `move.l D0,D2` propaga il long completo.
 *   - `pea (0x7978).l` and `pea (0x7980).l`: push effective address as long.
 *   - `move.l (0x00010074).l,-(SP)`: read long BE from ROM, push as-is.
 *   - `lea (0x1C,SP),SP`: equivalent to `addq.l #0x1C,SP` (pop 28 arg bytes).
 *
 * **Xrefs** (3 ref, 2 callsite):
 *   - `0x594C` in FUN_5688 — jsr 0x5608 (UNCONDITIONAL_CALL)
 *   - `0x5B7A` in FUN_5A5E — jsr 0x5608 (UNCONDITIONAL_CALL)
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── ROM addresses ────────────────────────────────────────────────────────

export const ROM_GATE_BYTE_ADDR = 0x00010072 as const;

/** Long BE ROM @ 0x10074: argLong propagated to FUN_5334. */
export const ROM_HANDLE_LONG_ADDR = 0x00010074 as const;

export const PTR_LITERAL_1 = 0x00007978 as const;

/** Pointer literal #2: arg3 for the second FUN_52DA call. */
export const PTR_LITERAL_2 = 0x00007980 as const;

export const ROW_IMM_1 = 0x0000001b as const;

/** Immediate row id #2: arg2 for the second FUN_52DA call. */
export const ROW_IMM_2 = 0x0000001c as const;

/** Additive arg1 bias for phase 1 (`addq.l #3,D0`). */
export const ARG1_BIAS_PHASE1 = 3 as const;

/** Additive arg1 bias for phase 3 (`addq.l #4,D0`). */
export const ARG1_BIAS_PHASE3 = 4 as const;

// ─── Callback types ───────────────────────────────────────────────────────

/**
 * Signature of `FUN_000052DA`: receives three unsigned longs. The callee sees
 * args on the stack at `(0x4,SP)`, `(0x8,SP)`, `(0xC,SP)`.
 *   - `arg1` = D2+3 or D2+4 (small int, 7..12)
 *   - `arg2` = 0x1B or 0x1C (immediate)
 *   - `arg3` = pointer literal (0x7978 or 0x7980)
 *
 */
export type Sub5608Inner52DA = (
  arg1: number,
  arg2: number,
  arg3: number,
) => number;

/**
 * Signature of `FUN_00005334`: receives one unsigned long `argLong`.
 *
 */
export type Sub5608Inner5334 = (argLong: number) => number;

// ─── Utility: read long BE from Uint8Array ─────────────────────────────────

function readLongBE(bytes: Uint8Array, off: number): number {
  return (
    (((bytes[off] ?? 0) << 24) |
      ((bytes[off + 1] ?? 0) << 16) |
      ((bytes[off + 2] ?? 0) << 8) |
      (bytes[off + 3] ?? 0)) >>>
    0
  );
}

// ─── Replica ───────────────────────────────────────────────────────────────

/**
 *
 *                      `0x10074` (long BE) per `argLong` of FUN_5334.
 * @param inner52DA     Callback that models `FUN_000052DA`. Invoked 2 times
 *                      with `(D2+3, 0x1B, 0x7978)` and `(D2+4, 0x1C, 0x7980)`.
 *                      Default `() => 0`.
 * @param inner5334     Callback that models `FUN_00005334`. Invoked 1 time
 *                      with `(*ROM[0x10074])`. Default `() => 0`.
 *
 *          and 0x5B7A ignorano D0).
 *
 *     `inner52DA` #1 modifies workRam @ `0x401F98/99`, then `inner5334`
 */
export function stateSub5608(
  state: GameState,
  rom: RomImage,
  inner52DA: Sub5608Inner52DA = () => 0,
  inner5334: Sub5608Inner5334 = () => 0,
): void {
  const gateByte = rom.program[ROM_GATE_BYTE_ADDR] ?? 0;
  const d2 = gateByte === 0 ? 8 : 4;

  // ─── Fase 1: FUN_52DA(D2+3, 0x1B, 0x7978) ───────────────────────────────
  // Push order RTL: 0x7978 (arg3), 0x1B (arg2), D2+3 (arg1).
  // Callee vede arg1=(0x4,SP), arg2=(0x8,SP), arg3=(0xC,SP).
  const phase1Arg1 = (d2 + ARG1_BIAS_PHASE1) >>> 0;
  inner52DA(phase1Arg1, ROW_IMM_1, PTR_LITERAL_1);

  // ─── Phase 2: FUN_5334(*ROM[0x10074]) ────────────────────────────────────
  const argLong5334 = readLongBE(rom.program, ROM_HANDLE_LONG_ADDR);
  inner5334(argLong5334);

  // ─── Phase 3: FUN_52DA(D2+4, 0x1C, 0x7980) ───────────────────────────────
  const phase3Arg1 = (d2 + ARG1_BIAS_PHASE3) >>> 0;
  inner52DA(phase3Arg1, ROW_IMM_2, PTR_LITERAL_2);

  // No direct state mutation here; any mutations happen inside `inner*` callbacks.
  void state; // referenced for API consistency / future expansion
}
