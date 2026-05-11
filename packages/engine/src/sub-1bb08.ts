/**
 * sub-1bb08.ts — replica bit-perfect di `FUN_0001BB08` (8 istr, 7 caller).
 *
 * **Sorgente**: questa funzione era già implementata come
 * `setScrollCoordsFromEntity1BB08` in `scroll-coord-helpers.ts` (insieme alla
 * sua callee `FUN_0001BB50` = `updateScrollCoords1BB50`). Questo file espone
 * la stessa logica sotto il nome canonico `sub1BB08` richiesto
 * dall'inventario `docs/missing-subs-inventory.md`.
 *
 * **Disasm** (verificato @ 0x1BB08..0x1BB26, 0x1E byte):
 *
 *   0001bb08  movea.l (0x4,SP),A1            ; A1 = entityPtr
 *   0001bb0c  lea     (0xc,A1),A0
 *   0001bb10  move.w  (A0),(0x00400690).l    ; *0x400690.w = entity+0xC.w
 *   0001bb16  lea     (0x10,A1),A0
 *   0001bb1a  move.w  (A0),(0x00400692).l    ; *0x400692.w = entity+0x10.w
 *   0001bb20  jsr     0x0001bb50.l           ; FUN_1BB50 (sub-cell + cell + dirty)
 *   0001bb26  rts
 *
 * **Callers identificati** (xref via grep nei file engine):
 *   - `helper-15148.ts` case 2 (path "vectorScale + advance position",
 *     @ 0x152BE): chiamata come `subs.fun_1bb08(state, sp)` con fallback
 *     `setScrollCoordsFromEntity1BB08` (default REAL).
 *   - `state-sub-19baa.ts` movement-block (@ 0x19D02): chiamata come
 *     `subs?.fun_1bb08?.(state, entityAddr)` senza default REAL (NOOP).
 *   - `state-sub-14c46.ts` slot-init path (@ 0x14CB6): chiamata live tramite
 *     `deriveSpriteFromArg_v1` (no injection, real-impl).
 *
 * **Side effects** in `state.workRam`:
 *   - `*0x400690.w` = `entity[0xC..0xD]` (entity X word)
 *   - `*0x400692.w` = `entity[0x10..0x11]` (entity Y word)
 *   - più tutto quanto fa `updateScrollCoords1BB50`:
 *     * `*0x40069E.w` = `*0x400690.w & 0x7`  (sub-cell X)
 *     * `*0x4006A0.w` = `*0x400692.w & 0x7`  (sub-cell Y)
 *     * `*0x400696.w` = signed_asr(`*0x400690.w`, 3)  (cell X)
 *     * `*0x400698.w` = signed_asr(`*0x400692.w`, 3)  (cell Y)
 *     * `*0x4006A2.w` = 1 default, cleared se subY < subX (signed)
 *
 * Bit-perfect verificato vs Musashi WASM via
 * `cli/src/test-sub-1bb08-parity.ts` (100 random scenarios).
 */

export { setScrollCoordsFromEntity1BB08 as sub1BB08 } from "./scroll-coord-helpers.js";

/** Absolute ROM address. */
export const SUB_1BB08_ADDR = 0x0001bb08 as const;
