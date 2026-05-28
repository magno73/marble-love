/**
 *
 * Compatibility wrapper for `setScrollCoordsFromEntity1BB08` in
 * `scroll-coord-helpers.ts`, matching the missing-sub inventory entry.
 *
 *
 *   0001bb08  movea.l (0x4,SP),A1            ; A1 = entityPtr
 *   0001bb0c  lea     (0xc,A1),A0
 *   0001bb10  move.w  (A0),(0x00400690).l    ; *0x400690.w = entity+0xC.w
 *   0001bb16  lea     (0x10,A1),A0
 *   0001bb1a  move.w  (A0),(0x00400692).l    ; *0x400692.w = entity+0x10.w
 *   0001bb20  jsr     0x0001bb50.l           ; FUN_1BB50 (sub-cell + cell + dirty)
 *   0001bb26  rts
 *
 * **Identified callers** (xref via grep in engine files):
 *   - `helper-15148.ts` case 2 (path "vectorScale + advance position",
 *     `setScrollCoordsFromEntity1BB08` (default REAL).
 *     `deriveSpriteFromArg_v1` (no injection, real-impl).
 *
 * **Side effects** in `state.workRam`:
 *   - `*0x400690.w` = `entity[0xC..0xD]` (entity X word)
 *   - `*0x400692.w` = `entity[0x10..0x11]` (entity Y word)
 *     * `*0x40069E.w` = `*0x400690.w & 0x7`  (sub-cell X)
 *     * `*0x4006A0.w` = `*0x400692.w & 0x7`  (sub-cell Y)
 *     * `*0x400696.w` = signed_asr(`*0x400690.w`, 3)  (cell X)
 *     * `*0x400698.w` = signed_asr(`*0x400692.w`, 3)  (cell Y)
 *     * `*0x4006A2.w` = 1 default, cleared if subY < subX (signed)
 *
 * `cli/src/test-sub-1bb08-parity.ts` (100 random scenarios).
 */

export { setScrollCoordsFromEntity1BB08 as sub1BB08 } from "./scroll-coord-helpers.js";

/** Absolute ROM address. */
export const SUB_1BB08_ADDR = 0x0001bb08 as const;
