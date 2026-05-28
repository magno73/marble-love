/**
 * dispatch-strings-17230.ts - mirror of `FUN_00017230` (42 bytes).
 *
 * Service subroutine called by `FUN_00010fce` (1 xref @ 0x10FF2, JSR.L) as the
 * sixth step of the high-level frame tick, immediately after `addq.b #1,
 * (0x4003F0)` increments the global frame counter. It is a **dispatcher**: it
 * iterates 7 times over the string-slot array @ `0x401482` (stride `0x42`) and
 * calls `FUN_0001725a(slotPtr)` (string animation step) for each slot, passing
 * the pointer as the only long argument on the stack (cdecl-like).
 *
 * **Disasm 0x17230..0x17258** (42 byte, 0 args, 0 ret):
 *
 *   movem.l { D3 D2 }, -(SP)        ; save D2/D3 (callee-saved)
 *   move.l  #0x401482, D3            ; D3 = pointer to first slot
 *   clr.b   D2b                      ; D2 = counter byte = 0
 *   loop:
 *     move.l  D3, D1                 ; D1 = current slot ptr
 *     moveq   #0x42, D0              ; D0 = stride 0x42
 *     add.l   D0, D3                 ; D3 += 0x42 (next slot ptr)
 *     move.l  D1, -(SP)              ; push slotPtr arg
 *     jsr     0x0001725a.l           ; FUN_1725A(slotPtr)
 *     addq.l  #4, SP                 ; pop arg
 *     addq.b  #1, D2b                ; D2++
 *     cmpi.b  #0x7, D2b              ; D2 == 7?
 *     bne.b   loop                   ; repeat until D2 == 7
 *   movem.l (SP)+, { D2 D3 }         ; restore D2/D3
 *   rts
 *
 * **Geometry**:
 *   - Array: 7 slots, each 0x42 bytes, @ `0x401482..0x401482+7*0x42-1`
 *     = `0x401482..0x4015D3` (294 workRam bytes).
 *   - Pointers passed to the callee, in order:
 *     `0x401482, 0x4014C4, 0x401506, 0x401548, 0x40158A, 0x4015CC, 0x40160E`.
 *     **Note**: the loop pre-increments D3 before the jsr for the next
 *     iteration, but D1 (= D3's original value for that iteration) is what gets
 *     pushed. Therefore the 7 pushed pointers are `0x401482 + i*0x42` for
 *     `i in 0..6`. The final unused D3 value after the last `add.l` is
 *     `0x401650` (= base + 7*0x42), but `cmpi.b` closes the loop before any
 *     eighth `jsr`.
 *
 * **Pure dispatcher**: this function does not write workRam, read MMIO, or
 * touch palette/sprite/alpha RAM. All side effects are delegated to callee
 * `FUN_0001725a` (see `string-step.ts` for related subroutines, although
 * `0x1725a` is distinct from `FUN_00002CD4`/`FUN_00002DA0`).
 *
 * **TS model**: because `FUN_0001725a` is not mirrored in TS yet, the
 * dispatcher is exposed as a higher-order function that receives the callee as
 * callback `(slotAddr) => void`. This enables isolated parity against the
 * binary, with the callee patched to a bookkeeping stub in
 * `cli/src/test-dispatch-strings-17230-parity.ts`, and future integration by
 * passing the TS port of `FUN_0001725a` when it exists.
 *
 * No `state.workRam` mutation happens here. The dispatcher is transparent from
 * the state's perspective: it only computes 7 addresses and invokes the
 * callback in exact 68k order.
 *
 * Bit-perfect verification against the binary:
 * `cli/src/test-dispatch-strings-17230-parity.ts` (500/500 cases).
 */

/** workRam address of the first string slot (immediate `move.l #0x401482, D3`). */
export const SLOT_BASE_ADDR = 0x401482 as const;
/** Byte stride between consecutive slots (immediate `moveq #0x42, D0`). */
export const SLOT_STRIDE = 0x42 as const;
/** Number of slots iterated by the loop (`cmpi.b #0x7, D2b`). */
export const SLOT_COUNT = 7 as const;
/** Absolute 68010 address of the callee function: `jsr 0x0001725a.l`. */
export const CALLEE_ADDR = 0x0001725a as const;

/**
 * Mirrors `FUN_00017230` - `dispatchStrings17230(callee)`.
 *
 * Iterates 7 string slots (`SLOT_BASE_ADDR + i * SLOT_STRIDE` for `i in 0..6`)
 * and invokes `callee(slotAddr)` for each one in the exact 68k loop order
 * (i = 0, 1, ..., 6). `slotAddr` values are unsigned long 32-bit 68010
 * addresses in workRam space.
 *
 * @param callee Function invoked 7 times. Receives the absolute pointer
 *               (`number` u32) to the current slot. The return value is
 *               ignored; the callee's D0 would be clobbered by the next
 *               iteration's `move.l` anyway.
 *
 * NOTE bit-perfect:
 *   - No TS side effect beyond the 7 callee invocations.
 *   - The dispatcher does not directly read/write `state.workRam`; it is pure
 *     with respect to state.
 *   - Invocation order (ascending `i`) matches the binary (D2 goes from 0 to 6).
 *   - The D2/D3 `SP` push/pop is internal to the binary and not externally
 *     observable, so TS has no equivalent.
 */
export function dispatchStrings17230(
  callee: (slotAddr: number) => void,
): void {
  // Faithful loop shape: D3 starts at SLOT_BASE_ADDR, D2 at 0. Each iteration
  // saves D1=D3, increments D3 += 0x42, calls callee(D1), increments D2, and
  // exits when D2 == 7.
  let d3 = SLOT_BASE_ADDR >>> 0;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotPtr = d3 >>> 0;
    d3 = (d3 + SLOT_STRIDE) >>> 0;
    callee(slotPtr);
  }
}
