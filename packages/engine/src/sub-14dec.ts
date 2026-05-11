/**
 * sub-14dec.ts — replica bit-perfect di `FUN_00014DEC` (166 byte, 1 caller).
 *
 * **Sorgente**: questa funzione era già implementata come
 * `findNearestNeighborV2` in `nearest-neighbor.ts` (variante della V1
 * `FUN_15D10` con list ptr da `obj+0x4E`, stride 4 byte, write a `obj+0x4A`).
 * Questo file espone la stessa logica sotto il nome canonico richiesto
 * dall'inventario `docs/missing-subs-inventory.md`.
 *
 * **Disasm** (verificato @ 0x14DEC..0x14E91, 0xA6 byte):
 *
 *   00014dec  movem.l {D6 D5 D4 D3 D2},-(SP)
 *   00014df0  movea.l (0x18,SP),A0           ; A0 = objPtr
 *   00014df4  move.l  (0xc,A0),D1            ; D1 = obj.posX long
 *   00014df8  moveq   #0x13,D0
 *   00014dfa  asr.l   D0,D1                  ; D1 = signed_asr(posX, 19)
 *   00014dfc  move.w  D1w,D5w                ; D5w = refX
 *   00014dfe  move.l  (0x10,A0),D1
 *   00014e02  moveq   #0x13,D0
 *   00014e04  asr.l   D0,D1                  ; D1 = signed_asr(posY, 19)
 *   00014e06  move.w  D1w,D4w                ; D4w = refY
 *   00014e08  movea.l (0x4e,A0),A1           ; A1 = listPtr (from obj+0x4E)
 *   00014e0c  move.l  #0x400,D3              ; D3 = bestDist init
 *  loop @ 0x14E12:
 *   00014e12  cmpi.b  #-0x1,(A1)             ; entry[0] == 0xFF? → break
 *   00014e16  beq.w   0x00014e88
 *   00014e1a  cmpi.b  #-0x1,(0x1,A1)         ; entry[1] == 0xFF? → break
 *   00014e20  beq.w   0x00014e88
 *   ; D1w = refX - sext_w(entry[0]); D2w = |D1| << 4
 *   ; D1w = refY - sext_w(entry[1]); D0w = |D1| << 4
 *   ; dist = (min>>3)*3 + max  (word arith, mulu.w #3,D1.l + add.w)
 *   ; if dist < bestDist: bestDist=dist, bestPtr=A1
 *   ; A1 += 4 (stride V2)
 *   ; bra loop
 *  end @ 0x14E88:
 *   00014e88  move.l  D6,(0x4a,A0)            ; obj[0x4A..0x4D] = bestPtr (D6)
 *   00014e8c  movem.l (SP)+,{D2 D3 D4 D5 D6}
 *   00014e90  rts
 *
 * **Caller identificato** (xref):
 *   - `helper-15148.ts` cases 5/6 (path damping + 14dec, @ 0x1544C):
 *     chiamata come `subs.fun_14dec(state, sp)` con fallback REAL
 *     `findNearestNeighborV2` già wirata di default.
 *
 * **Side effects** in `state.workRam`:
 *   - `*(long*)(obj+0x4A)` = pointer assoluto al best entry, oppure
 *     `0xFFFFFFFF` se nessuna entry ha `dist < 0x400` (D6 register iniziale
 *     non clearato; replicato fedelmente nella replica V2).
 *
 * Bit-perfect verificato vs Musashi WASM via
 * `cli/src/test-nearest-neighbor-parity.ts` (100/100 casi su V2 = FUN_14DEC,
 * vedi seconda suite del test esistente) e via
 * `cli/src/test-sub-14dec-parity.ts` (100 random scenarios dedicati).
 */

export { findNearestNeighborV2 as sub14DEC } from "./nearest-neighbor.js";

/** Absolute ROM address. */
export const SUB_14DEC_ADDR = 0x00014dec as const;
