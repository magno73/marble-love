/**
 * helper-253bc.ts — replica `FUN_000253BC` (15 istr, 0x253BC-0x253EA).
 *
 * **Semantica**: "object derive-shorts" — aggiorna 4 campi derivati di una
 * object struct M68K, oppure no-op se il flag di freeze byte+0x36 è != 0.
 *
 * Se `*(A0+0x36).b == 0`:
 *   1. `*(A0+0x32).w = arithmetic_shift_right_32(*(A0+0x0C).l, 19) & 0xFFFF`
 *   2. `*(A0+0x34).w = arithmetic_shift_right_32(*(A0+0x10).l, 19) & 0xFFFF`
 *   3. `*(A0+0x2A).l = *(A0+0x14).l`   (long copy)
 *   4. `*(A0+0x1D).b = *(A0+0x1B).b`   (byte copy)
 *
 * **Disasm 0x253BC..0x253EA** (15 istr):
 *
 *   000253bc  movea.l (0x4,SP),A0           ; A0 = arg1 = objPtr (struct abs addr)
 *   000253c0  tst.b   (0x36,A0)             ; test freeze flag
 *   000253c4  bne.b   0x000253ea            ; if freeze != 0: skip → rts
 *   000253c6  move.l  (0xc,A0),D1           ; D1 = *(A0+0x0C) [x long, 16.16 fp]
 *   000253ca  moveq   0x13,D0               ; D0 = 19
 *   000253cc  asr.l   D0,D1                 ; D1 >>= 19 (arithmetic, long → drops frac)
 *   000253ce  move.w  D1w,(0x32,A0)         ; *(A0+0x32).w = D1.w (screen-X short)
 *   000253d2  move.l  (0x10,A0),D1          ; D1 = *(A0+0x10) [y long]
 *   000253d6  moveq   0x13,D0               ; D0 = 19
 *   000253d8  asr.l   D0,D1                 ; D1 >>= 19 (arithmetic)
 *   000253da  move.w  D1w,(0x34,A0)         ; *(A0+0x34).w = D1.w (screen-Y short)
 *   000253de  move.l  (0x14,A0),(0x2a,A0)   ; *(A0+0x2A) = *(A0+0x14) (long copy)
 *   000253e4  move.b  (0x1b,A0),(0x1d,A0)   ; *(A0+0x1D).b = *(A0+0x1B).b
 *   000253ea  rts
 *
 * **Argomento** (1 long sullo stack, cdecl-like):
 *   - `objPtr` → A0 = indirizzo assoluto della object struct in workRam
 *     (range tipico: `0x400018..0x401FFC`).
 *
 * **Side effects** (workRam — offset relativo a `objPtr - 0x400000`):
 *   - `*(objPtr+0x32).w` — screen X short (da long 16.16 >> 19)
 *   - `*(objPtr+0x34).w` — screen Y short (da long 16.16 >> 19)
 *   - `*(objPtr+0x2A).l` — copia di `*(objPtr+0x14).l`
 *   - `*(objPtr+0x1D).b` — copia di `*(objPtr+0x1B).b`
 *
 * **Callers** (4 call-site reali, 1 entry-point esterno = 5 refs totali):
 *   - `FUN_000158F6` @ 0x0001597C
 *   - `FUN_000253EC` @ 0x00025732, 0x00025756, 0x000257C4
 */

import type { GameState } from "./state.js";

// ─── Costanti indirizzo ────────────────────────────────────────────────────

/** Indirizzo ROM di `FUN_000253BC`. */
export const HELPER_253BC_ADDR = 0x000253bc as const;

/** Base di work RAM (assoluta). */
const WORK_RAM_BASE = 0x00400000 as const;

// ─── Helpers interni ───────────────────────────────────────────────────────

/** Legge un long unsigned big-endian da workRam a offset relativo `off`. */
function readU32(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

/** Scrive un long unsigned big-endian in workRam a offset relativo `off`. */
function writeU32(r: Uint8Array, off: number, v: number): void {
  const x = v >>> 0;
  r[off] = (x >>> 24) & 0xff;
  r[off + 1] = (x >>> 16) & 0xff;
  r[off + 2] = (x >>> 8) & 0xff;
  r[off + 3] = x & 0xff;
}

// ─── Funzione principale ───────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_000253BC`.
 *
 * "Object derive-shorts": aggiorna i campi di visualizzazione screen-X/Y di
 * una object struct — convertendo le coordinate 16.16 fixed-point (long) in
 * word di schermo tramite `asr.l #19`. No-op se il freeze flag è settato.
 *
 * @param state   GameState: `state.workRam` mutato in-place.
 * @param objPtr  Indirizzo assoluto della object struct in workRam
 *                (es. `0x401D00`). Deve essere nel range `0x400000..0x401FFF`.
 */
export function helper253BC(state: GameState, objPtr: number): void {
  const r = state.workRam;
  const objOff = (objPtr - WORK_RAM_BASE) >>> 0;

  // tst.b (0x36,A0) / bne.b 0x253EA → no-op se freeze flag != 0
  if ((r[objOff + 0x36] ?? 0) !== 0) return;

  // ── Campo X: *(A0+0x0C).l >> 19 → *(A0+0x32).w ─────────────────────────
  // move.l (0xc,A0),D1 → D1 = unsigned long
  // asr.l  #19, D1     → arithmetic shift right: tratta D1 come signed 32-bit
  const longX = readU32(r, objOff + 0x0c);
  const longXSigned = longX >= 0x80000000 ? longX - 0x100000000 : longX;
  const screenX = (longXSigned >> 19) & 0xffff;
  r[objOff + 0x32] = (screenX >>> 8) & 0xff;
  r[objOff + 0x33] = screenX & 0xff;

  // ── Campo Y: *(A0+0x10).l >> 19 → *(A0+0x34).w ─────────────────────────
  const longY = readU32(r, objOff + 0x10);
  const longYSigned = longY >= 0x80000000 ? longY - 0x100000000 : longY;
  const screenY = (longYSigned >> 19) & 0xffff;
  r[objOff + 0x34] = (screenY >>> 8) & 0xff;
  r[objOff + 0x35] = screenY & 0xff;

  // ── Long copy: *(A0+0x14) → *(A0+0x2A) ─────────────────────────────────
  // move.l (0x14,A0),(0x2a,A0)
  writeU32(r, objOff + 0x2a, readU32(r, objOff + 0x14));

  // ── Byte copy: *(A0+0x1B) → *(A0+0x1D) ──────────────────────────────────
  // move.b (0x1b,A0),(0x1d,A0)
  r[objOff + 0x1d] = r[objOff + 0x1b] ?? 0;
}
