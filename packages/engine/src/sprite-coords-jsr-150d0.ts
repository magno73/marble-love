/**
 * sprite-coords-jsr-150d0.ts — replica `FUN_000150D0` (120 byte).
 *
 * Variante "compute coords + dispatch" del pattern `compute()` (vedi
 * `sprite-coords.ts`): legge w0/w2/w4 da `(arg+0xC, +0x10, +0x14)`, scrive
 * la coppia long di coordinate a `(arg+0x28)`, poi chiama `FUN_000264AA`
 * con `(structPtr, 2)`.
 *
 * Equivale a `computeSpriteCoords_v3` (FUN_1778E) PIÙ una jsr finale a
 * `FUN_264AA(structPtr, 2)`. Differenza chiave rispetto a `FUN_1281C`
 * (gating/mode 0 o 1): qui il `mode` è hard-coded a 2 e non c'è gating.
 *
 * **Disasm 0x150D0..0x15147** (120 byte):
 *
 *   000150d0   movem.l {A3,A2,D3,D2},-(SP)     ; salva 4 long (16 byte)
 *   000150d4   movea.l (0x14,SP),A1             ; A1 = arg long (struct ptr)
 *   000150d8   movea.l #0x400692,A3             ; A3 → POS_Y global
 *   000150de   movea.l #0x400690,A2             ; A2 → POS_X global
 *   000150e4   lea     (0xc,A1),A0
 *   000150e8   move.w  (A0),(A2)                ; *0x400690 = word @ A1+0xC  (w0)
 *   000150ea   lea     (0x10,A1),A0
 *   000150ee   move.w  (A0),(A3)                ; *0x400692 = word @ A1+0x10 (w2)
 *   000150f0   move.w  (A3),D3w
 *   000150f2   sub.w   (A2),D3w                 ; D3w = w2 - w0
 *   000150f4   addi.w  #0x88,D3w                ; D3w += 0x88
 *   000150f8   lea     (0x14,A1),A0
 *   000150fc   move.w  (A0),D0w                 ; D0w = word @ A1+0x14 (w4)
 *   000150fe   move.w  (0x40097e).l,D2w         ; D2w = HUD_OFFSET
 *   00015104   add.w   D0w,D2w                  ; D2w += w4
 *   00015106   addi.w  #0x54,D2w                ; D2w += 0x54
 *   0001510a   move.w  (A3),D0w
 *   0001510c   ext.l   D0                        ; D0 = sext_l(w2)
 *   0001510e   move.w  (A2),D1w
 *   00015110   ext.l   D1                        ; D1 = sext_l(w0)
 *   00015112   add.l   D1,D0                     ; D0 = sext_l(w2)+sext_l(w0)
 *   00015114   asr.l   #0x1,D0                   ; D0 >>= 1 (signed)
 *   00015116   sub.w   D0w,D2w                   ; D2w -= avg (low word)
 *   00015118   move.w  D2w,D0w
 *   0001511a   ext.l   D0                        ; D0 = sext_l(D2w)
 *   0001511c   move.l  D0,D2
 *   0001511e   andi.l  #0xffff,D2                ; D2 = D2w (zero high word)
 *   00015124   move.w  D3w,D0w
 *   00015126   ext.l   D0                        ; D0 = sext_l(D3w)
 *   00015128   move.l  D0,D1
 *   0001512a   moveq   #0x10,D0
 *   0001512c   asl.l   D0,D1                     ; D1 = sext_l(D3w) << 16
 *   0001512e   add.l   D1,D2                     ; D2 = (D3w_signed<<16) | D2w
 *   00015130   move.l  D2,(0x28,A1)              ; *(A1+0x28) = D2 (long)
 *   00015134   pea     (0x2).w                   ; push 2 (long)
 *   00015138   move.l  A1,-(SP)                  ; push struct ptr
 *   0001513a   jsr     0x000264aa.l              ; FUN_264AA(structPtr, 2)
 *   00015140   addq.l  #0x8,SP                   ; pop 2 long
 *   00015142   movem.l (SP)+,{D2,D3,A2,A3}
 *   00015146   rts                               ; D0 = inner return value
 *
 * **Side effects pre-jsr** (in `state.workRam`):
 *   - `0x690..0x691` (POS_X global)  = word @ A1+0xC
 *   - `0x692..0x693` (POS_Y global)  = word @ A1+0x10
 *   - `(A1+0x28)..(A1+0x2B)` (long)  = pack(yMinusX_signed << 16 | adjustedX_word)
 *
 * **Ritorno**: il `D0` lasciato da `FUN_264AA` (passato verbatim al caller).
 *
 * **NO INTEGRAZIONE**: `FUN_264AA` (~object update sub) non è ancora
 * replicato in TS. Modelliamo via callback `inner` (vedi `Inner264AA` in
 * `object-enter-1281c.ts`). Il parity test patcha la `jsr` con uno stub
 * `move.l (8,SP),D0; rts` per esporre il `mode=2` come `D0`.
 *
 * Verifica bit-perfect via `cli/src/test-sprite-coords-jsr-150d0-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Base della work RAM. */
const WORK_RAM_BASE = 0x400000;

/** Globali condivisi col pattern `sprite-coords.ts`. */
const POS_X_OFF = 0x690; // *0x400690 word
const POS_Y_OFF = 0x692; // *0x400692 word
const HUD_OFFSET_OFF = 0x97e; // *0x40097E word

/** Offsets nello struct passato come arg1 (A1). */
const STRUCT_W0_OFF = 0xc; // word @ A1+0xC  → POS_X
const STRUCT_W2_OFF = 0x10; // word @ A1+0x10 → POS_Y
const STRUCT_W4_OFF = 0x14; // word @ A1+0x14 → input per HUD compute
const STRUCT_DST_OFF = 0x28; // long @ A1+0x28 ← packed coords output

/** Mode hard-coded passato come secondo arg long alla jsr `FUN_264AA`. */
export const INNER_MODE = 2 as const;

/**
 * Callback che modella `FUN_000264AA`. Riceve `(structPtr, mode)` come long
 * pushati dallo shim. Lo shim ritorna verbatim il `D0` della callback. La
 * firma è identica a `Inner264AA` di `object-enter-1281c.ts`.
 *
 * @param structPtr  = `A1` (verbatim, non normalizzato).
 * @param mode       hard-coded a `INNER_MODE = 2`.
 */
export type Inner264AA = (structPtr: number, mode: number) => number;

/** Interface stub injection per JSR. */
export interface SpriteCoordsJsr150D0Subs {
  inner264AA: Inner264AA;
}

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}
function writeU16(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}
function writeU32(state: GameState, off: number, v: number): void {
  const u = v >>> 0;
  state.workRam[off] = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8) & 0xff;
  state.workRam[off + 3] = u & 0xff;
}

/**
 * Replica bit-perfect di `FUN_000150D0`.
 *
 * @param state     GameState (modifica `workRam[0x690..0x693]` + `(arg+0x28..arg+0x2B)`).
 * @param structPtr Long pushato dal caller (`A1` nel binario). DEVE essere in
 *                  `0x400000..0x401FFF` perché tutte le letture/scritture su
 *                  `(A1, ...)` toccano work RAM.
 * @param subs      Stub injection per `FUN_264AA`.
 * @returns         Il long che la funzione lascia in `D0` al `rts` =
 *                  `subs.inner264AA(structPtr, 2)`.
 *
 * **Side effects in `state.workRam`** (sempre, indipendentemente da `inner`):
 *   - `0x690..0x691` = word @ structPtr+0xC (big-endian)
 *   - `0x692..0x693` = word @ structPtr+0x10 (big-endian)
 *   - `(structPtr+0x28)..(structPtr+0x2B)` = packed long (big-endian)
 */
export function spriteCoordsJsr150D0(
  state: GameState,
  structPtr: number,
  subs: SpriteCoordsJsr150D0Subs,
): number {
  const a1 = structPtr >>> 0;
  const argOff = (a1 - WORK_RAM_BASE) >>> 0;

  // Read w0, w2, w4 dalla struct (m68k word, big-endian).
  const w0 = readU16(state, argOff + STRUCT_W0_OFF);
  const w2 = readU16(state, argOff + STRUCT_W2_OFF);
  const w4 = readU16(state, argOff + STRUCT_W4_OFF);

  // Pre-jsr side effects: scrivi i due globals POS_X/POS_Y.
  writeU16(state, POS_X_OFF, w0 & 0xffff);
  writeU16(state, POS_Y_OFF, w2 & 0xffff);

  // D3.w = (w2 - w0 + 0x88) (word arithmetic, sub.w / addi.w sequence).
  const yMinusX = (((w2 - w0) | 0) + 0x88) & 0xffff;

  // D2.w = HUD_OFFSET + w4 + 0x54 (word arithmetic).
  const hudOff = readU16(state, HUD_OFFSET_OFF);
  let d2w = ((hudOff + (w4 & 0xffff)) | 0) + 0x54;
  d2w = d2w & 0xffff;

  // D0 = sext_l(w2)+sext_l(w0); D0 >>= 1 (asr.l #1, signed shift).
  // Solo D0w viene poi sub-tratto da D2w → ci serve solo la low word di avg.
  const yS = w2 & 0x8000 ? w2 - 0x10000 : w2;
  const xS = w0 & 0x8000 ? w0 - 0x10000 : w0;
  const avgLong = (yS + xS) >> 1; // signed >>= preserva il segno
  // D2.w -= avg.w (sub.w D0w,D2w)
  d2w = (d2w - (avgLong & 0xffff)) & 0xffff;

  // ext.l D0 (di D2w sext); andi.l #0xffff,D2 → D2 (long) = D2w (zero high).
  // Indipendente dal sext perché poi mascherato.
  const d2Long = d2w & 0xffff;

  // D1 = sext_l(D3w) << 16  (low 16 bit del prodotto è 0).
  const d3Signed = yMinusX & 0x8000 ? yMinusX - 0x10000 : yMinusX;
  const d1Long = ((d3Signed << 16) | 0) >>> 0;

  // D2 (long) = D1 + D2  (add.l D1,D2)
  const packed = (d1Long + d2Long) >>> 0;

  // *(A1+0x28) = D2 (long, big-endian)
  writeU32(state, argOff + STRUCT_DST_OFF, packed);

  // jsr FUN_264AA(structPtr, 2). Il valore di ritorno (D0 dell'inner)
  // sopravvive all'`addq.l #8,SP; rts` dello shim → ritornato verbatim.
  return subs.inner264AA(a1, INNER_MODE) >>> 0;
}
