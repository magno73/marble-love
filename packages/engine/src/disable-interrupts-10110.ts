/**
 * disable-interrupts-10110.ts — replica `FUN_00010110` (6 byte).
 *
 * **Disasm 0x010110..0x010115** (6 byte):
 *
 *   00010110    move #0x2700,SR   ; SR ← 0x2700: supervisor + IPL=7
 *   00010114    rts
 *
 *
 * **Xrefs (callers)**:
 *   - `0x00028a14` in `FUN_00028972` (UNCONDITIONAL_CALL)
 *   - `0x00028a88` in `FUN_00028972` (UNCONDITIONAL_CALL)
 *   - `0x0002bc62` in `FUN_0002bc5c` (UNCONDITIONAL_CALL)
 *   - Entry Point in ? (EXTERNAL)
 *
 * This routine only affects the CPU status register, not the RAM.
 */

export const SR_IPL7_SUPERVISOR = 0x2700 as const;

/**
 *
 *
 */
export function disableInterrupts10110(): number {
  return SR_IPL7_SUPERVISOR;
}
