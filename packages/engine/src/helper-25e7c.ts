/**
 * helper-25e7c.ts — replica `FUN_00025E7C` (51 istr, 0x25E7C–0x25FC0).
 *
 * **Semantica**: "velocity friction / damping" — applica un fattore di
 * attrito a due componenti di velocità memorizzati come long signed in
 * work RAM, usando una tabella ROM a 16 entry per interpolare il fattore
 * in funzione della magnitudine risultante.
 *
 * **Calling convention M68k** (RTL, 2 arg long):
 *   - `SP+4`  → `objPtr` → A0 (puntatore a struct con due long: vx @ +0, vy @ +4)
 *   - `SP+8`  → `mode`   → D1b (solo il byte basso conta)
 *
 * **Disasm 0x25E7C..0x25FC0** (51 istruzioni):
 *
 *   00025e7c  movem.l {D5 D4 D3 D2},-(SP)
 *   00025e80  movea.l (0x14,SP),A0       ; A0 = objPtr
 *   00025e84  move.b  (0x1b,SP),D1b      ; D1b = mode (low byte of arg2)
 *
 *   ; Phase 1: abs values
 *   00025e88  move.l  (A0),D0            ; D0 = A0[+0] (vx)
 *   00025e8a  bge.b   0x25e90
 *   00025e8c  neg.l   D0
 *   00025e8e  nop
 *   00025e90  move.l  D0,D2              ; D2 = abs(vx)
 *   00025e92  move.l  (0x4,A0),D0        ; D0 = A0[+4] (vy)
 *   00025e96  bge.b   0x25e9c
 *   00025e98  neg.l   D0
 *   00025e9a  nop
 *   00025e9c  move.l  D0,D4              ; D4 = abs(vy)
 *
 *   ; Phase 2: blend blend D3 = max_contribution + scaled_min_contribution
 *   00025e9e  cmp.l   D4,D2              ; compare D2-D4
 *   00025ea0  bls.b   0x25eb2            ; branch if D2 <=_unsigned D4
 *   ; D2 > D4 path:
 *   00025ea2  move.l  D4,D0
 *   00025ea4  lsr.l   #3,D0             ; D0 = D4 >> 3
 *   00025ea6  move.w  D0w,D3w; ext.l D3 ; D3 = sign-extend(D0.w)
 *   00025eaa  mulu.w  #3,D3             ; D3 *= 3
 *   00025eae  add.l   D2,D3             ; D3 += D2
 *   00025eb0  bra.b   0x25ec0
 *   ; D2 <= D4 path:
 *   00025eb2  move.l  D2,D0
 *   00025eb4  lsr.l   #3,D0             ; D0 = D2 >> 3
 *   00025eb6  move.w  D0w,D3w; ext.l D3 ; D3 = sign-extend(D0.w)
 *   00025eba  mulu.w  #3,D3             ; D3 *= 3
 *   00025ebe  add.l   D4,D3             ; D3 += D4
 *
 *   ; Phase 3: extract table index D4 and sub-index D2 from D3
 *   00025ec0  move.l  D3,D0
 *   00025ec2  moveq   0xf,D2; lsr.l D2,D0   ; D0 = D3 >> 15
 *   00025ec6  move.w  D0w,D4w               ; D4.w = low 16 bits
 *   00025ec8  andi.w  #0xf,D4w              ; D4 &= 0xF (index 0..15)
 *   00025ecc  move.l  D3,D0
 *   00025ece  moveq   0xc,D2; lsr.l D2,D0   ; D0 = D3 >> 12
 *   00025ed2  move.w  D0w,D2w               ; D2.w = low 16 bits
 *   00025ed4  andi.w  #0x7,D2w              ; D2 &= 0x7 (sub-index 0..7)
 *
 *   ; Phase 4+5: table lookup + linear interpolation
 *   00025ed8  move.w  D4w,D0w; ext.l D0; add.l D0,D0   ; D0 = D4 * 2 (byte offset)
 *   00025ede  movea.l #0x1eef8,A1
 *   00025ee4  move.w  (0,A1,D0*1),D5w       ; D5 = table[D4]
 *   00025ee8  move.w  D4w,D0w; ext.l D0; addq.l 1,D0; add.l D0,D0 ; D0 = (D4+1)*2
 *   00025ef0  movea.l #0x1eef8,A1
 *   00025ef6  move.w  (0,A1,D0*1),D0w       ; D0 = table[D4+1]
 *   00025efa  sub.w   D5w,D0w               ; D0 = table[D4+1] - table[D4]
 *   00025efc  muls.w  D2w,D0               ; D0 = D0.w * D2.w (signed word mult)
 *   00025efe  move.l  D0,D2
 *   00025f00  asr.l   #3,D2               ; D2 >>= 3 (signed)
 *   00025f02  move.w  D5w,D0w; ext.l D0   ; D0 = sign-extend(table[D4])
 *   00025f06  add.l   D0,D2               ; D2 = friction_factor
 *
 *   ; Phase 6: cap D3 to minimum 0x100
 *   00025f08  cmpi.l  #0x100,D3
 *   00025f0e  bcc.b   0x25f16             ; skip if D3 >= 0x100
 *   00025f10  move.l  #0x100,D3           ; D3 = 0x100
 *
 *   ; Phase 7: mode dispatch
 *   00025f16  cmpi.b  #2,D1b; bne.b 0x25f36
 *   ; mode 2: primary_raw = max(0, D3 - D2*4), D4_secondary = same
 *   00025f1c  move.l  D2,D0; asl.l #2,D0 ; D0 = D2 * 4
 *   00025f20  move.l  D0,D2
 *   00025f22  move.l  D2,D0; cmp.l D3,D0
 *   00025f26  bcc.b   0x25f2e             ; bcc: D0 >=_unsigned D3
 *   00025f28  move.l  D3,D0; sub.l D2,D0 ; D0 = D3 - D2
 *   00025f2c  bra.b   0x25f30
 *   00025f2e  moveq   0x0,D0
 *   00025f30  move.l  D0,D4
 *   00025f32  bra.w   0x25f80
 *
 *   00025f36  cmpi.b  #3,D1b; bne.b 0x25f60
 *   ; mode 3: D4 = max(0, D3 - D2), primary_raw = max(0, D3 - D2*5)
 *   00025f3c  move.l  D2,D0; cmp.l D3,D0
 *   00025f40  bcc.b   0x25f48
 *   00025f42  move.l  D3,D4; sub.l D2,D4 ; D4 = D3 - D2
 *   00025f46  bra.b   0x25f4a
 *   00025f48  moveq   0x0,D4
 *   00025f4a  move.l  D2,D0; asl.l #2,D0 ; D0 = D2 * 4
 *   00025f4e  add.l   D0,D2              ; D2 = D2 + D2*4 = D2 * 5
 *   00025f50  move.l  D2,D0; cmp.l D3,D0
 *   00025f54  bcc.b   0x25f5c
 *   00025f56  move.l  D3,D0; sub.l D2,D0 ; D0 = D3 - D2*5
 *   00025f5a  bra.b   0x25f80
 *   00025f5c  moveq   0x0,D0
 *   00025f5e  bra.b   0x25f80
 *
 *   00025f60  cmpi.b  #4,D1b; bne.b 0x25f70
 *   ; mode 4: D0 = D3 + D2 >> 2; D4 = D0
 *   00025f66  move.l  D2,D0; asr.l #2,D0 ; D0 = D2 >> 2
 *   00025f6a  add.l   D3,D0              ; D0 = D3 + D2/4
 *   00025f6c  move.l  D0,D4
 *   00025f6e  bra.b   0x25f80
 *
 *   ; default mode: D0 = max(0, D3 - D2)
 *   00025f70  move.l  D2,D0; cmp.l D3,D0
 *   00025f74  bcc.b   0x25f7c
 *   00025f76  move.l  D3,D0; sub.l D2,D0 ; D0 = D3 - D2
 *   00025f7a  bra.b   0x25f7e
 *   00025f7c  moveq   0x0,D0
 *   00025f7e  move.l  D0,D4
 *
 *   ; Phase 8: compute ratio(s) via scaled division
 *   ; ratio_primary = (D0 << 6) / (D3 >> 8)  [unsigned 32÷16 divu]
 *   00025f80  lsl.l   #6,D0              ; D0 <<= 6
 *   00025f82  move.l  D0,D2
 *   00025f84  move.l  D3,D0; lsr.l #8,D0 ; D0 = D3 >> 8
 *   00025f88  divu.w  D0w,D2             ; D2 = D2 / D0w (unsigned), quotient → D2.w
 *   00025f8a  move.w  D2w,D5w            ; D5 = ratio_primary
 *   ; for mode 3 only: also compute ratio_secondary from D4
 *   00025f8c  cmpi.b  #3,D1b; bne.b 0x25fa2
 *   00025f92  move.l  D4,D0; lsl.l #6,D0; move.l D0,D2
 *   00025f98  move.l  D3,D0; lsr.l #8,D0
 *   00025f9c  divu.w  D0w,D2; move.w D2w,D1w ; D1 = ratio_secondary
 *   00025fa0  bra.b   0x25fa4
 *   00025fa2  move.w  D5w,D1w            ; D1 = ratio_primary (same for non-mode-3)
 *
 *   ; Phase 9: apply ratios to original velocities
 *   ; vx_new = ((vx >> 8).w * ratio_primary.w) >> 6
 *   00025fa4  move.l  (A0),D0; asr.l #8,D0; muls.w D5w,D0; asr.l #6,D0; move.l D0,(A0)
 *   ; vy_new = ((vy >> 8).w * ratio_secondary.w) >> 6
 *   00025fae  move.l  (0x4,A0),D0; asr.l #8,D0; muls.w D1w,D0; asr.l #6,D0; move.l D0,(0x4,A0)
 *   00025fbc  movem.l (SP)+,{D2 D3 D4 D5}
 *   00025fc0  rts
 *
 * **Tabella ROM** (`FRICTION_TABLE @ 0x1eef8`, 16 word, BE):
 *   [0]=0x0200, [1]=0x0400, [2]=0x0700, [3]=0x0C00,
 *   [4]=0x1000, [5]=0x2000, [6]=0x3000, [7]=0x4000,
 *   [8..15]=0x5000
 *
 * **Argomenti** (2 long sullo stack, cdecl-like):
 *   - `objPtr` → indirizzo assoluto workRam di una struct con:
 *       - `+0`: vx (long signed, fixed-point)
 *       - `+4`: vy (long signed, fixed-point)
 *   - `mode`   → byte 0..4 (solo il nibble basso conta praticamente):
 *       - 0,1: default: scale_primary = max(0, D3 - friction)
 *       - 2: scale_primary = max(0, D3 - friction*4); secondary=same
 *       - 3: scale_primary = max(0, D3 - friction*5); secondary = max(0, D3 - friction)
 *       - 4: scale_primary = D3 + friction/4; secondary=same
 *
 * **Side effects** (workRam — indirizzi assoluti):
 *   - `*(objPtr+0).l` ← `((vx >> 8).w * ratio_primary.w) >> 6`
 *   - `*(objPtr+4).l` ← `((vy >> 8).w * ratio_secondary.w) >> 6`
 *
 * **Callers** (2 reali + entry-point esterno = 3 refs totali):
 *   - `FUN_000121B8` @ 0x000127F6  (object physics-update)
 *   - `FUN_00015148` @ 0x00015282  (object-state machine)
 *
 * Parity bit-perfect verificata in
 * `packages/cli/src/test-helper-25e7c-parity.ts` (500/500 vs Musashi).
 */

import type { GameState } from "./state.js";

// ─── Costanti pubbliche ───────────────────────────────────────────────────────

/** Indirizzo ROM di `FUN_00025E7C`. */
export const HELPER_25E7C_ADDR = 0x00025e7c as const;

/** Indirizzo ROM della tabella di attrito (`FRICTION_TABLE`). */
export const FRICTION_TABLE_ADDR = 0x0001eef8 as const;

// ─── Costanti interne ─────────────────────────────────────────────────────────

const WORK_RAM_BASE = 0x00400000 as const;
const WORK_RAM_END = 0x00402000 as const;

/**
 * Tabella di attrito (16 word, harcodata in ROM @ 0x1eef8).
 * Valori in formato 16-bit unsigned; rappresentano frazioni di scala.
 */
const FRICTION_TABLE: readonly number[] = [
  0x0200, // [0]  0.0078
  0x0400, // [1]  0.0156
  0x0700, // [2]  0.0273
  0x0c00, // [3]  0.0469
  0x1000, // [4]  0.0625
  0x2000, // [5]  0.1250
  0x3000, // [6]  0.1875
  0x4000, // [7]  0.2500
  0x5000, // [8]  0.3125
  0x5000, // [9]  0.3125
  0x5000, // [10] 0.3125
  0x5000, // [11] 0.3125
  0x5000, // [12] 0.3125
  0x5000, // [13] 0.3125
  0x5000, // [14] 0.3125
  0x5000, // [15] 0.3125
] as const;

// ─── Helpers interni ──────────────────────────────────────────────────────────

/** Legge long unsigned big-endian da workRam a indirizzo assoluto. */
function readU32(wr: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return 0;
  const o = a - WORK_RAM_BASE;
  return (
    (((wr[o] ?? 0) << 24) |
      ((wr[o + 1] ?? 0) << 16) |
      ((wr[o + 2] ?? 0) << 8) |
      (wr[o + 3] ?? 0)) >>>
    0
  );
}

/** Scrive long unsigned big-endian in workRam a indirizzo assoluto. */
function writeU32(wr: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return;
  const o = a - WORK_RAM_BASE;
  const v = value >>> 0;
  wr[o] = (v >>> 24) & 0xff;
  wr[o + 1] = (v >>> 16) & 0xff;
  wr[o + 2] = (v >>> 8) & 0xff;
  wr[o + 3] = v & 0xff;
}

/** M68K `asr.l #n, Dn` — arithmetic (signed) right shift. */
function asrl(val: number, shift: number): number {
  const s = val >>> 0;
  const signed = s >= 0x80000000 ? s - 0x100000000 : s;
  return (signed >> shift) >>> 0;
}

/** M68K `lsr.l #n, Dn` — logical (unsigned) right shift. */
function lsrl(val: number, shift: number): number {
  return (val >>> shift) >>> 0;
}

/** M68K `asl.l #n, Dn` / `lsl.l #n, Dn` — left shift (32-bit wrap). */
function lsll(val: number, shift: number): number {
  return (val << shift) >>> 0;
}

/** Sign-extend M68K word to 32-bit (JS number). */
function s16(val: number): number {
  const w = val & 0xffff;
  return w >= 0x8000 ? w - 0x10000 : w;
}

/**
 * M68K `divu.w src, Dn` — unsigned 32÷16 division.
 *
 * Simulates `divu.w src, Dn` exactly:
 *   - If divisor is 0: division-by-zero trap — return `dividend32 & 0xFFFF`
 *     (D2 unchanged, we just expose the low word; callers exclude this case
 *     from the parity suite as it triggers a watchdog-reset exception path).
 *   - If quotient > 0xFFFF (overflow): V flag set, Dn unchanged →
 *     return `dividend32 & 0xFFFF` (the low word of the pre-division D2).
 *   - Otherwise: return `quotient & 0xFFFF` (normal result).
 *
 * The return value models `Dn.w` **after** the instruction.
 */
function divuW(dividend32: number, divisor16: number): number {
  const d = divisor16 & 0xffff;
  const dvd = dividend32 >>> 0;
  if (d === 0) {
    // Division-by-zero: D2 unchanged → return low word of dividend32
    return dvd & 0xffff;
  }
  const q = Math.floor(dvd / d);
  if (q > 0xffff) {
    // Overflow: Dn unchanged → return low word of pre-division Dn (= dividend32)
    return dvd & 0xffff;
  }
  return q & 0xffff;
}

// ─── Funzione principale ──────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00025E7C` — velocity friction/damping.
 *
 * Applica un fattore di attrito (calcolato via tabella ROM) a due componenti
 * di velocità `vx = A0[+0]` e `vy = A0[+4]` memorizzati come long signed in
 * work RAM all'indirizzo assoluto `objPtr`.
 *
 * Il fattore di attrito è determinato dalla magnitudine approssimata della
 * velocità (blend pesato di |vx| e |vy|), interpolato linearmente nella
 * tabella `FRICTION_TABLE`. Il parametro `mode` seleziona la curva di
 * risposta applicata prima del calcolo del ratio finale.
 *
 * Vedi header del file per descrizione completa di disasm + semantica.
 *
 * @param state   GameState: `state.workRam` mutato in-place.
 * @param objPtr  Indirizzo assoluto M68k della struct velocità in work RAM.
 *                Campi: `+0` = vx (long signed), `+4` = vy (long signed).
 * @param mode    Modalità di damping (0..4; solo il byte basso conta):
 *                0/1/default → scale = max(0, mag - friction);
 *                2 → scale = max(0, mag - friction×4);
 *                3 → vx: max(0, mag - friction×5), vy: max(0, mag - friction);
 *                4 → scale = mag + friction÷4.
 */
export function helper25E7C(
  state: GameState,
  objPtr: number,
  mode: number,
): void {
  const wr = state.workRam;
  const A0 = objPtr >>> 0;

  // ── Phase 1: abs values ───────────────────────────────────────────────────
  // move.l (A0),D0 / bge.b → neg.l D0 / move.l D0,D2
  const vxRaw = readU32(wr, A0);
  let D0 = vxRaw;
  let D2signed = D0 >= 0x80000000 ? D0 - 0x100000000 : D0;
  if (D2signed < 0) D2signed = -D2signed;
  let D2 = D2signed >>> 0;  // abs(vx) as u32

  // move.l (4,A0),D0 / bge.b → neg.l D0 / move.l D0,D4
  const vyRaw = readU32(wr, A0 + 4);
  D0 = vyRaw;
  let D4signed = D0 >= 0x80000000 ? D0 - 0x100000000 : D0;
  if (D4signed < 0) D4signed = -D4signed;
  let D4 = D4signed >>> 0;  // abs(vy) as u32

  // ── Phase 2: blend → D3 ──────────────────────────────────────────────────
  // cmp.l D4,D2 → bls.b 0x25eb2 (branch if D2 <=_unsigned D4)
  //
  // NOTE on mulu.w #3,D3:
  //   After `lsr.l #3; move.w D0w,D3w; ext.l D3` the pattern looks like
  //   sign-extension, but the multiply is `mulu.w` (UNSIGNED word × imm).
  //   `ext.l D3` sets D3.l = sign_extend(D3.w), but `mulu.w #3,D3` then
  //   computes `D3 = (D3.w & 0xffff) * 3` (unsigned 16-bit × 3 → 32-bit).
  //   The prior ext.l is effectively a no-op for the multiply operand
  //   because mulu.w reads only the low word. Final add.l is 32-bit unsigned.
  let D3: number;
  if (D2 > D4) {
    // D2 > D4: D3 = (D4 >> 3).w_unsigned * 3 + D2
    D0 = lsrl(D4, 3);
    // move.w D0w,D3w; ext.l D3; mulu.w #3,D3
    // ext.l affects upper bits but mulu.w uses only low word
    const D3w = D0 & 0xffff;          // move.w D0w,D3w (ext.l irrelevant for mulu)
    D3 = (D3w * 3 + D2) >>> 0;       // mulu.w #3 (unsigned) + add.l D2
  } else {
    // D2 <= D4: D3 = (D2 >> 3).w_unsigned * 3 + D4
    D0 = lsrl(D2, 3);
    const D3w = D0 & 0xffff;
    D3 = (D3w * 3 + D4) >>> 0;
  }

  // ── Phase 3: extract table index D4 and sub-index D2 ─────────────────────
  // D4 = (D3 >> 15) & 0xF
  D0 = lsrl(D3, 15);
  D4 = (D0 & 0xffff) & 0xf;   // andi.w #0xf

  // D2 = (D3 >> 12) & 0x7
  D0 = lsrl(D3, 12);
  D2 = (D0 & 0xffff) & 0x7;   // andi.w #0x7

  // ── Phase 4+5: table lookup + linear interpolation ─────────────────────
  const D5 = FRICTION_TABLE[D4] ?? 0x5000;                  // table[D4]
  const tableNext = FRICTION_TABLE[D4 + 1] ?? 0x5000;       // table[D4+1]
  const delta = (tableNext - D5) & 0xffff;                  // sub.w D5w, D0w

  // muls.w D2w, D0: signed word × signed word → long
  const mulResult = s16(delta) * s16(D2);
  D0 = mulResult >>> 0;
  D2 = asrl(D0, 3);                  // asr.l #3
  D0 = s16(D5) >>> 0;                // sign-extend table[D4] word to long (positive, so same)
  // add.l D0,D2 → friction factor
  const D2_friction = (D2 + D0) >>> 0;

  // ── Phase 6: cap D3 to minimum 0x100 ─────────────────────────────────────
  // cmpi.l #0x100,D3 / bcc.b (skip if D3 >= 0x100) / move.l #0x100,D3
  if (D3 < 0x100) {
    D3 = 0x100;
  }

  // ── Phase 7: mode dispatch ─────────────────────────────────────────────
  // Reset D2 to friction factor for mode computations
  D2 = D2_friction;
  const D1b = mode & 0xff;

  let D0_primary: number;
  let D4_secondary: number;

  if (D1b === 2) {
    // mode 2: scale = max(0, D3 - D2*4)
    // asl.l #2,D0 → D0 = D2*4; cmp.l D3,D0; bcc D0=0; else D0=D3-D2*4
    D0 = lsll(D2, 2);     // asl.l #2 (D0 = D2*4)
    D2 = D0;               // move.l D0,D2
    D0 = D2;               // move.l D2,D0
    // cmp.l D3,D0: bcc if D0 >=_unsigned D3
    if ((D0 >>> 0) >= (D3 >>> 0)) {
      D0 = 0;
    } else {
      D0 = (D3 - D2) >>> 0;
    }
    D4_secondary = D0;
    D0_primary = D0;

  } else if (D1b === 3) {
    // mode 3: D4 = max(0, D3 - D2), D0 = max(0, D3 - D2*5)
    D0 = D2;
    // cmp.l D3,D0: bcc if D0 >=_unsigned D3
    if ((D0 >>> 0) >= (D3 >>> 0)) {
      D4_secondary = 0;
    } else {
      D4_secondary = (D3 - D2) >>> 0;
    }
    // D2 = D2 + D2*4 = D2*5
    D0 = lsll(D2, 2);     // asl.l #2 → D0 = D2*4
    D2 = (D0 + D2) >>> 0; // add.l D0,D2 → D2 = D2*5
    D0 = D2;
    // cmp.l D3,D0: bcc if D0 >=_unsigned D3
    if ((D0 >>> 0) >= (D3 >>> 0)) {
      D0 = 0;
    } else {
      D0 = (D3 - D2) >>> 0;
    }
    D0_primary = D0;

  } else if (D1b === 4) {
    // mode 4: D0 = D3 + (D2 >> 2); D4 = D0
    D0 = asrl(D2, 2);        // asr.l #2 → D0 = D2 / 4 (signed)
    D0 = (D0 + D3) >>> 0;    // add.l D3,D0
    D4_secondary = D0;
    D0_primary = D0;

  } else {
    // default (mode 0, 1, or any other):
    // D0 = max(0, D3 - D2)
    D0 = D2;
    if ((D0 >>> 0) >= (D3 >>> 0)) {
      D0 = 0;
    } else {
      D0 = (D3 - D2) >>> 0;
    }
    D4_secondary = D0;
    D0_primary = D0;
  }

  // ── Phase 8: compute ratio(s) via scaled division ─────────────────────
  // ratio_primary = (D0_primary << 6) / (D3 >> 8)
  const divisor = lsrl(D3, 8) & 0xffff;  // lsr.l #8 → D0w (max 0xFFFF when D3=0xFFFFFF00)
  const D0p = lsll(D0_primary, 6);       // lsl.l #6
  const ratioPrimary = divuW(D0p, divisor);

  // For mode 3: also compute ratio_secondary from D4_secondary
  let ratioSecondary: number;
  if (D1b === 3) {
    const D0s = lsll(D4_secondary, 6);
    ratioSecondary = divuW(D0s, divisor);
  } else {
    ratioSecondary = ratioPrimary;
  }

  // ── Phase 9: apply ratios to original velocities ───────────────────────
  // vx_new = ((vx >> 8).w * ratio_primary.w) >> 6  [signed]
  const vxShifted = asrl(vxRaw, 8);   // asr.l #8,D0 (signed)
  const vxMul = s16(vxShifted) * s16(ratioPrimary);  // muls.w D5w,D0
  const vxNew = asrl(vxMul >>> 0, 6); // asr.l #6,D0
  writeU32(wr, A0, vxNew);

  // vy_new = ((vy >> 8).w * ratio_secondary.w) >> 6  [signed]
  const vyShifted = asrl(vyRaw, 8);   // asr.l #8,D0 (signed)
  const vyMul = s16(vyShifted) * s16(ratioSecondary);  // muls.w D1w,D0
  const vyNew = asrl(vyMul >>> 0, 6); // asr.l #6,D0
  writeU32(wr, A0 + 4, vyNew);
}
