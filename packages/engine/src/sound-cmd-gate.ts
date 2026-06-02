/**
 * sound-cmd-gate.ts — replica `FUN_00004420` (34 byte).
 *
 * Main sound-command gate. Callers pass two longs on the stack: `cmdIndex`
 * (arg1) and `data` (arg2).
 *
 * **Disasm 0x4420..0x4441** (34 byte):
 *
 *   move.l  D2,-(SP)              ; preserve D2
 *   move.l  (0x8,SP),D2           ; D2 = arg1 (cmdIndex, long)
 *   move.l  (0xC,SP),D1           ; D1 = arg2 (data, long)
 *   moveq   #0x0B,D0              ; D0 = 0x0B
 *   cmp.l   D2,D0                 ; D0 - D2  → flags
 *   bls.s   skip_clear            ; if D0 <= D2 unsigned (cmdIndex >= 0x0B) skip
 *   moveq   #0,D1                 ; else: data = 0
 * skip_clear:
 *   move.l  D1,-(SP)              ; push (possibly cleared) data
 *   move.l  D2,-(SP)              ; push cmdIndex
 *   jsr     0x00004442.l          ; tail-call to dispatcher
 *   addq.l  #8,SP                 ; pop 2 long args
 *   move.l  (SP)+,D2              ; restore D2
 *   rts                           ; D0 = return of FUN_4442
 *
 * **Caller convention** observed at the five real call sites:
 *   - `0x3D40`: `pea 0x0B; jsr 0x4420`           -> cmdIndex = 0x0B (no clear)
 *   - `0x59B8`: `pea 0x0D; jsr 0x4420`           -> cmdIndex = 0x0D (no clear)
 *   - `0x5A8A`: `clr.l -(SP); move.l D2,-(SP)`  -> variable cmdIndex (D2)
 *   - `0x5D1C`, `0x6194`: `pea 0x0C`             -> cmdIndex = 0x0C (no clear)
 *
 * Payload is cleared for command indices `0..0x0A`, where the ROM treats the
 * payload as meaningless.
 *
 *
 *
 * The differential test uses a constant inner stub to isolate the gating logic.
 */

/**
 * Signature of the inner dispatcher (FUN_00004442). Receives `(cmdIndex, data)`.
 */
export type SoundCmdGateInner = (cmdIndex: number, data: number) => number;

/** Clamp threshold: `cmdIndex < THRESHOLD` forces `data` to 0. */
export const CLAMP_THRESHOLD = 0x0b as const;

/**
 *
 * @param cmdIndex  long (0..0xFFFFFFFF). Command index passed as arg1.
 * @param data      long (0..0xFFFFFFFF). Command payload passed as arg2.
 *                  `cmdIndex < 0x0B` (unsigned).
 * @param inner     callback that models `FUN_00004442`. Default = `() => 0`
 *
 * Note of low-level fidelity:
 *     `cmdIndex >= 0x0B` (unsigned) preserves `data`. Indices `0..0x0A`
 *     inclusive clear it. Very large longs (`>= 0x0B` up to `0xFFFFFFFF`) do
 *     not clear it. Return behavior is delegated to the inner dispatcher.
 */
export function soundCmdGate(
  cmdIndex: number,
  data: number,
  inner: SoundCmdGateInner = () => 0,
): number {
  // Normalize to unsigned 32-bit, matching M68k long semantics.
  const idx = cmdIndex >>> 0;
  const dataNorm = data >>> 0;

  // bls.s skip_clear with cmp.l D2,D0 => branch taken if 0x0B <= idx (unsigned).
  const dataOut = idx < CLAMP_THRESHOLD ? 0 : dataNorm;

  // Tail-call the dispatcher with (cmdIndex, data_clamped).
  return inner(idx, dataOut) >>> 0;
}
