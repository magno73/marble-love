/**
 * string-dispatch-table-177f8.ts - port of `FUN_000177F8` (316 bytes).
 *
 * Takes three word arguments on the stack, walks the terrain/string dispatch
 * tables, performs a PF/sprite RAM read, and returns the delta/coordinate used
 * by callers. Exits with `D0 = 0` for four miss conditions: bound, empty, zero
 * pixel, or sentinel `0x1000`.
 *
 * **Calling convention** (cdecl-like, args on stack):
 *
 *   args (relative to callee SP after `movem.l { A3 A2 D3 D2 }, -(SP)`):
 *     +0x14 :  arg0L_hi  (16 bits, expected 0, unused)
 *     +0x1a :  arg1L_lo  -> D0.w = "x raw word" then `+ word@0x40098a; asr.w #1; +2`
 *     +0x1e :  arg2L_lo  -> D3.w = "y raw word" then `ext.l + add.l long@0x400988`
 *
 *   The caller pushes each as a long (4 bytes); only each low word is consumed.
 *
 *   - `(byteValue - 0x80) + word@(0x400478 + 2*arg0w)`, or
 *   - `(D0w & 0x7f) - 0x40 + word@(0x400478 + 2*arg0w)` (case `top4 != 0`),
 *   - `(D0w & 0x7f) - 0x40 - lookupBias + word@(0x400478 + 2*arg0w)` (case
 *     `top4 != 0` with bias search).
 *
 * **Disasm 0x177F8..0x17934** (316 byte, 3 long args):
 *
 *   000177f8  movem.l  { A3 A2 D3 D2 }, -(SP)        ; save 16 callee-saved bytes
 *   000177fc  move.w   (0x16,SP), D2w                 ; D2.w = arg0w (char-index byte)
 *   00017800  movea.l  (0x00400474).l, A0             ; A0 = level header ptr (workRam)
 *   00017806  cmp.w    (0x18,A0), D2w                 ; D2.w vs (A0+0x18).w (signed)
 *   0001780a  blt.b    0x00017812                     ; if D2 < bound → proceed
 *   0001780c    moveq    #0, D0                       ; else: D0 = 0
 *   0001780e    bra.w    0x0001792e                   ;        return
 *
 *   00017812  move.w   (0x1e,SP), D3w                 ; D3.w = arg2w (y raw)
 *   00017816  ext.l    D3                              ; D3 = sext_l(arg2w)
 *   00017818  add.l    (0x00400988).l, D3             ; D3 += globalLong @ 0x400988
 *
 *   0001781e  move.w   (0x1a,SP), D0w                 ; D0.w = arg1w (x raw)
 *   00017822  add.w    (0x0040098a).l, D0w            ; D0.w += globalWord @ 0x40098a
 *   00017828  asr.w    #1, D0w                         ; D0.w = signed >> 1
 *   0001782a  addq.w   #2, D0w                         ; D0.w += 2
 *
 *   0001782c  moveq    #0, D1                          ; D1 = 0
 *   0001782e  move.b   D2b, D1b                        ; D1.b = D2.b (low byte of arg0)
 *   00017830  bclr.l   #0, D1                          ; D1 &= ~1; Z = (oldBit0==0)
 *   00017834  beq.b    0x0001783a                      ; bit0==0 → skip add 0x16
 *   00017836    addi.w   #0x16, D0w                    ; bit0==1 → D0.w += 0x16
 *
 *   0001783a  lea      (0x1eb3a).l, A2                 ; A2 = ROM table base
 *   00017840  movea.l  #0xa00000, A1                   ; A1 = PF RAM base
 *   00017846  adda.w   (0,A2,D1w*1), A1                ; A1 += sext( ROM word @ 0x1eb3a + D1.w )
 *
 *   0001784a  lea      (0x1ed0a).l, A2                 ; A2 = ROM byte table
 *   00017850  move.b   (0,A2,D0w*1), D1b               ; D1.b = ROM byte @ 0x1ed0a + D0.w (sext)
 *   00017854  subq.l   #2, D1                           ; D1 -= 2 (long sub on D1.b zero-extended)
 *   00017856  adda.l   D1, A1                           ; A1 += D1 (signed long add)
 *   00017858  move.l   (A1), D1                         ; D1 = long @ A1 (PF/sprite RAM)
 *
 *   0001785a  move.b   (0x2c,A2,D0w*1), D0b            ; D0.b = ROM byte @ 0x1ed36 + D0.w
 *   0001785e  lsr.l    D0, D1                            ; D1 >>>= D0.b (mod 64)
 *   00017860  andi.w   #0x7fe, D1w                       ; D1.w &= 0x7fe (clear bit 0 + bits 11..15)
 *   00017864  movea.l  (0x0040065a).l, A2                ; A2 = global ptr @ workRam 0x40065a
 *   0001786a  move.w   (0,A2,D1w*1), D0w                 ; D0.w = word @ A2 + D1.w (sext)
 *
 *   0001786e  move.w   D0w, D1w                          ; D1.w = D0.w
 *   00017870  andi.w   #-0x1000, D1w                     ; D1.w &= 0xF000 (top4 nibble)
 *   00017874  bne.w    0x000178d8                        ; if top4 != 0 → case_top4
 *
 *   ;-- case_top4_zero (D0.w fits in 12 bits) --
 *   00017878  move.w   D0w, D1w
 *   0001787a  andi.w   #0xfff, D1w                       ; D1.w = D0 & 0xFFF
 *   0001787e  beq.b    0x0001780c                        ; if D0 & 0xFFF == 0 → return 0
 *   00017880  andi.w   #0x800, D1w                       ; check bit 11
 *   00017884  beq.w    0x0001789a                        ; bit 11 == 0 → case_no_bit11
 *
 *   ;-- case_bit11_set: indirect via workRam table @ 0x40076e, then re-loop --
 *   00017888  andi.w   #0x7fe, D0w                       ; D0.w &= 0x7FE
 *   0001788c  ext.l    D0                                ; sign-extend (low bit 0 cleared, but high bit possible)
 *   0001788e  movea.l  D0, A1                             ; A1 = D0
 *   00017890  adda.l   #0x40076e, A1                     ; A1 += 0x40076e (workRam table)
 *   00017896  move.w   (A1), D0w                          ; D0.w = word @ workRam[0x76e + D0.w]
 *   00017898  bra.b    0x0001786e                         ; → re-loop top4 check
 *
 *   ;-- case_no_bit11 (0x1789a): full table-walk via 0x2417e (8-byte stride) --
 *   0001789a  ext.l    D0                                ; D0 = sext_l(D0.w)
 *   0001789c  movea.l  (A0), A1                           ; A1 = (A0).l ; A0 = level header ptr
 *   0001789e  adda.l   D0, A1                             ; A1 += D0 (signed)
 *   000178a0  movea.l  #0x2417e, A2                       ; A2 = ROM table (8-byte stride per "y")
 *   000178a6  asl.l    #3, D3                              ; D3 *= 8 (y stride)
 *   000178a8  adda.l   D3, A2                              ; A2 += D3
 *   000178aa  movea.l  A1, A3                              ; A3 = A1
 *   000178ac  adda.l   (A2), A3                            ; A3 += long @ A2 (offset0)
 *   000178ae  move.b   (A3), D0b                           ; D0.b = byte @ A3 (PF/sprite/alpha RAM o ROM)
 *   000178b0  lea      (4,A2), A2                          ; A2 += 4
 *   000178b4  adda.l   (A2), A1                            ; A1 += long @ A2 (offset4)
 *   000178b6  move.b   (A1), D1b                           ; D1.b = byte @ A1
 *   000178b8  cmp.b    D1b, D0b                            ; flags: D0.b - D1.b (unsigned)
 *   000178ba  bcc.b    0x000178be                          ; if D0.b >= D1.b → keep D0
 *   000178bc    move.b   D1b, D0b                          ; else D0.b = D1.b
 *   000178be  andi.w   #0xff, D0w                          ; D0.w = D0.b (zero-extended)
 *   000178c2  beq.w    0x0001780c                          ; if 0 → return 0
 *   000178c6  subi.w   #0x80, D0w                          ; D0.w -= 0x80
 *   000178ca  add.w    D2w, D2w                             ; D2.w *= 2
 *   000178cc  lea      0x400478, A1
 *   000178d2  add.w    (0,A1,D2w*1), D0w                    ; D0.w += word @ workRam[0x478 + 2*arg0w]
 *   000178d6  bra.b    0x0001792e
 *
 *   ;-- case_top4 (0x178d8): test against 0x24176 mask, then either short-form
 *   ;     or do a "bias search" via 0x1ed62 --
 *   000178d8  movea.l  #0x24176, A1                        ; A1 = ROM mask table base
 *   000178de  add.w    D3w, D3w                              ; D3.w *= 2
 *   000178e0  and.w    (0,A1,D3w*1), D1w                    ; D1.w &= ROM word @ 0x24176 + D3.w (sext)
 *   000178e4  beq.w    0x000178fe                            ; if 0 → bias-search path
 *
 *   ;-- top4_short: D0.w & 0x7f - 0x40 + workRam table --
 *   000178e8  andi.w   #0x7f, D0w
 *   000178ec  subi.w   #0x40, D0w
 *   000178f0  add.w    D2w, D2w
 *   000178f2  lea      0x400478, A1
 *   000178f8  add.w    (0,A1,D2w*1), D0w
 *   000178fc  bra.b    0x0001792e
 *
 *   ;-- top4_search (0x178fe): bias from 0x1ed62, fail if = 0x1000 --
 *   000178fe  move.w   D0w, D1w
 *   00017900  andi.w   #0xf80, D1w                          ; D1 = D0 bits 7..11 (range 0..0xf80)
 *   00017904  asr.w    #6, D1w                                ; D1 >>= 6 (signed; here always non-negative)
 *   00017906  movea.l  #0x1ed62, A1                          ; A1 = ROM bias table
 *   0001790c  move.w   (0,A1,D1w*1), D1w                     ; D1.w = ROM word @ 0x1ed62 + D1.w
 *   00017910  cmpi.w   #0x1000, D1w
 *   00017914  beq.w    0x0001780c                            ; if 0x1000 → return 0
 *   00017918  andi.w   #0x7f, D0w
 *   0001791c  subi.w   #0x40, D0w
 *   00017920  sub.w    D1w, D0w
 *   00017922  add.w    D2w, D2w
 *   00017924  lea      0x400478, A1
 *   0001792a  add.w    (0,A1,D2w*1), D0w
 *
 *   0001792e  movem.l  (SP)+, { D2 D3 A2 A3 }              ; restore
 *   00017932  rts
 *
 *   - ROM @ 0x1eb3a   : 256 byte (128 word) — pair-table (signed16 → PF offset).
 *   - ROM @ 0x1ed0a   : ≥0x40 byte unsigned — "shift-base" byte index.
 *   - ROM @ 0x1ed36   (= 0x1ed0a + 0x2c)
 *                     : ≥0x40 byte — "shift-amount" (3..15).
 *   - ROM @ 0x1ed62   : 0x80 byte (16 word, 0x10 entry sentinel 0x1000) — bias.
 *   - ROM @ 0x24176   : 8-byte word-mask indexed by `D3.w*2` in [0, 14].
 *   - ROM @ 0x2417e   : pair-long table with 8-byte stride, indexed by
 *                       D3.l (post `asl.l #3`), entry { off0:long, off1:long }.
 *   - workRam @ 0x400474.l   : pointer to level header (init via FUN_1A236).
 *   - workRam @ 0x400988.l   : additive Y long bias.
 *   - workRam @ 0x40098a.w   : additive X word bias, overlapping low word of 0x988.
 *                              FUN_1ABD4 - `bsearch-table-1abd4.ts`.
 *                              `arg0w * 2`. Filled by rle-expand
 *                              (`rle-expand.ts`).
 *                              indexed by sign-extended `D0.w & 0x7fe`.
 *                              `(A0).l + D0_signed` for case_no_bit11, and
 *                              `0xa00000 + tableSigned + (rom_byte - 2)` for
 *                              the first `move.l (A1)`. In the TS port, the
 *                              0x4000 bytes (covers 0xa00000..0xa04000), with
 *                              0xa02000..0xa03000 ↔ `state.spriteRam` e
 *                              0xa03000..0xa04000 ↔ `state.alphaRam` (la
 *
 * `cli/src/test-string-dispatch-table-177f8-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Constants (immediate values from disasm) ─────────────────────────────

export const ROM_TABLE_BASE_177F8_TBL1 = 0x0001eb3a as const;
export const ROM_TABLE_BASE_177F8_TBL2 = 0x0001ed0a as const;
/** Internal offset into table 2: shift amount (`+0x2c` from `0x1ed0a` = `0x1ed36`). */
export const ROM_TABLE_SHIFT_OFFSET = 0x2c as const;
export const ROM_TABLE_BIAS_177F8 = 0x0001ed62 as const;
export const ROM_TABLE_TOP4_MASK = 0x00024176 as const;
export const ROM_TABLE_PAIR_LONG = 0x0002417e as const;

/** workRam ptr long: `*(0x400474)` = level header ptr (see init-level-load-1a236). */
export const WR_LEVEL_HEADER_PTR_ABS = 0x00400474 as const;
/** workRam long: additive Y bias (`*(0x400988).l`). */
export const WR_BIAS_Y_LONG_ABS = 0x00400988 as const;
/** workRam word: additive X bias (`*(0x40098a).w`). NB overlaps low word of 0x988. */
export const WR_BIAS_X_WORD_ABS = 0x0040098a as const;
export const WR_STRING_TABLE_PTR_ABS = 0x0040065a as const;
/** workRam base-offset word table, indexed by `2*arg0w` (`0x400478`). */
export const WR_BASE_OFFSET_TABLE_ABS = 0x00400478 as const;
/** workRam table indirect "case_bit11_set" (`0x40076e`). */
export const WR_INDIRECT_TABLE_ABS = 0x0040076e as const;

/** Constante immediato `movea.l #0xa00000, A1` — base "string image RAM". */
export const A1_BASE_PFRAM_177F8 = 0xa00000 as const;

/** Sentinel "missing" returned by bias table (`cmpi.w #0x1000, D1w`). */
export const BIAS_SENTINEL_177F8 = 0x1000 as const;

export const LEVEL_HEADER_BOUND_OFF = 0x18 as const;

/** Workram base and size. */
const WORK_RAM_BASE_ADDR = 0x00400000 as const;
const WORK_RAM_SIZE = 0x2000 as const;

/** Range PF/sprite/alpha (together): 0xA00000..0xA04000. */
const PFRAM_BASE_ADDR = 0x00a00000 as const;
const PFRAM_END_ADDR = 0x00a04000 as const;

// ─── Memory readers ───────────────────────────────────────────────────────

function readByteAbs(
  state: GameState,
  rom: RomImage,
  pfRam: Uint8Array,
  addr: number,
): number {
  const a = addr >>> 0;
  if (a < rom.program.length) return rom.program[a] ?? 0;
  if (a >= WORK_RAM_BASE_ADDR && a < WORK_RAM_BASE_ADDR + WORK_RAM_SIZE) {
    return state.workRam[a - WORK_RAM_BASE_ADDR] ?? 0;
  }
  if (a >= PFRAM_BASE_ADDR && a < PFRAM_END_ADDR) {
    return pfRam[a - PFRAM_BASE_ADDR] ?? 0;
  }
  return 0;
}

function readWordAbs(
  state: GameState,
  rom: RomImage,
  pfRam: Uint8Array,
  addr: number,
): number {
  return (
    ((readByteAbs(state, rom, pfRam, addr) << 8) |
      readByteAbs(state, rom, pfRam, (addr + 1) >>> 0)) &
    0xffff
  );
}

function readLongAbs(
  state: GameState,
  rom: RomImage,
  pfRam: Uint8Array,
  addr: number,
): number {
  return (
    (((readByteAbs(state, rom, pfRam, addr) << 24) >>> 0) |
      (readByteAbs(state, rom, pfRam, (addr + 1) >>> 0) << 16) |
      (readByteAbs(state, rom, pfRam, (addr + 2) >>> 0) << 8) |
      readByteAbs(state, rom, pfRam, (addr + 3) >>> 0)) >>>
    0
  );
}

// ─── Sign helpers ─────────────────────────────────────────────────────────

function sextW(w: number): number {
  const v = w & 0xffff;
  return v & 0x8000 ? v - 0x10000 : v;
}

/**
 */
export interface DispatchResult177F8 {
  d0Word: number;
  /** Path "early-exit" preso (return 0): "bound", "fff_zero", "byte_zero",
    */
  earlyExit:
    | "bound"
    | "fff_zero"
    | "byte_zero"
    | "bias_sentinel"
    | null;
  /**
   *  or `null` on early-exit. */
  normalPath: "no_bit11" | "top4_short" | "top4_search" | null;
  bit11Reloops: number;
}

/**
 * Replica `FUN_000177F8` — `stringDispatchTable177F8`.
 *
 *
 *                RAM and PF RAM (the first 0x2000 byte are PF RAM, poi 0x2000
 *                and 0x3000 = sprite, 0x3000..0x4000 = alpha).
 */
export function stringDispatchTable177F8(
  state: GameState,
  rom: RomImage,
  pfRam: Uint8Array,
  arg0w: number,
  arg1w: number,
  arg2w: number,
): number {
  const r = stringDispatchTable177F8Detailed(state, rom, pfRam, arg0w, arg1w, arg2w);
  return r.d0Word;
}

/**
 */
export function stringDispatchTable177F8Detailed(
  state: GameState,
  rom: RomImage,
  pfRam: Uint8Array,
  arg0w: number,
  arg1w: number,
  arg2w: number,
): DispatchResult177F8 {
  // Helper riassuntivi
  const rb = (addr: number): number => readByteAbs(state, rom, pfRam, addr);
  const rw = (addr: number): number => readWordAbs(state, rom, pfRam, addr);
  const rl = (addr: number): number => readLongAbs(state, rom, pfRam, addr);

  // ── Prologo: bound check ──────────────────────────────────────────────
  const D2_w = arg0w & 0xffff;
  const A0 = rl(WR_LEVEL_HEADER_PTR_ABS) >>> 0;
  const boundW = sextW(rw((A0 + LEVEL_HEADER_BOUND_OFF) >>> 0));
  const D2_signed = sextW(D2_w);
  if (D2_signed >= boundW) {
    return { d0Word: 0, earlyExit: "bound", normalPath: null, bit11Reloops: 0 };
  }

  // ── D3 = sext_l(arg2w) + globalLong @ 0x400988 ────────────────────────
  const arg2_sext = sextW(arg2w);
  const globalLong988 = rl(WR_BIAS_Y_LONG_ABS);
  const D3_l = (arg2_sext + globalLong988) >>> 0; // long add modulo 2^32

  // ── D0.w = (arg1w + word@0x40098a).w >> 1 (signed asr) + 2 ────────────
  const globalWord98a = rw(WR_BIAS_X_WORD_ABS);
  let D0_w_init = (arg1w + globalWord98a) & 0xffff;
  D0_w_init = sextW(D0_w_init);
  D0_w_init = (D0_w_init >> 1) & 0xffff;
  D0_w_init = (D0_w_init + 2) & 0xffff;

  // ── D1 = D2 & ~1; if oldBit0==1 then D0 += 0x16 ──────────────────────
  const D2_b = D2_w & 0xff;
  const oddBit = D2_b & 1;
  let D1_l_step1 = (D2_b & 0xfe) >>> 0; // D1 = D2.b with bit 0 cleared (long, hi=0)
  if (oddBit !== 0) {
    D0_w_init = (D0_w_init + 0x16) & 0xffff;
  }

  // ── A1 = 0xa00000 + sext( ROM word @ 0x1eb3a + D1.w ) ──────────────
  // D1 here is D2.b & 0xfe (range 0..254), even values only.
  // (0,A2,D1w*1) — D1.w sign-extended; D1.w ≥ 0 so signed = unsigned here.
  const tbl1Off = (ROM_TABLE_BASE_177F8_TBL1 + D1_l_step1) >>> 0;
  const tbl1Word = sextW(rw(tbl1Off));
  let A1 = (A1_BASE_PFRAM_177F8 + tbl1Word) >>> 0;

  // ── D1.b = ROM byte @ 0x1ed0a + D0.w (sext) ──────────────────────────
  // Then: D1 = D1 - 2 (long sub, where D1's high 24 bits were just-loaded from
  // a `move.b D2b,D1b` followed by `bclr.l #0,D1`. Wait — D1 was clobbered
  // with `move.b D2b,D1b` after `moveq #0,D1`, so D1 = (0..0xfe) at step 1.
  // Then `move.b (0,A2,D0w*1),D1b` clobbers D1.b, leaving D1[8..31] = 0.
  // Wait, but D1.b is the same byte position as we just had D2 in. Let me
  // re-check: `move.b D2b,D1b` overwrites D1.b. Then we have `bclr.l #0,D1`,
  // which clears bit 0 of D1.l. So D1.l = (D2 & 0xfe) | 0 = (0..0xfe). All
  // high bits 0. Then `move.b (...),D1b` overwrites D1.b again. So D1.l =
  // (0..0xff). OK so D1.l = 0..0xff (the new ROM byte, zero-extended).
  // Then `subq.l #2, D1` — subtract 2 long. So D1.l = (rom_byte - 2) signed.
  // In TS: a long sub from a value in 0..0xff. Result is in (-2 .. 253). As
  // u32: 0xfffffffe (if rom_byte=0), 0x000000fd (if rom_byte=0xff).
  const tbl2_idx_signed = sextW(D0_w_init);
  const tbl2_addr = (ROM_TABLE_BASE_177F8_TBL2 + tbl2_idx_signed) >>> 0;
  const tbl2_byte = rb(tbl2_addr) & 0xff;
  const D1_l_after_sub = (tbl2_byte - 2) >>> 0; // subq.l #2, D1; result long unsigned

  // ── A1 += D1 (signed long add) ────────────────────────────────────────
  A1 = (A1 + D1_l_after_sub) >>> 0;

  // ── D1 = long @ A1 (PF/sprite/alpha RAM) ─────────────────────────────
  let D1_l_loaded = rl(A1);

  // ── D0.b = ROM byte @ 0x1ed36 + D0.w (= 0x1ed0a + 0x2c + D0.w) ─────
  const shift_addr =
    (ROM_TABLE_BASE_177F8_TBL2 + ROM_TABLE_SHIFT_OFFSET + tbl2_idx_signed) >>>
    0;
  const shift_byte = rb(shift_addr) & 0xff;
  // D0.b = shift_byte. The high bits of D0 are unchanged. For lsr.l D0,D1 the
  // shift count is (D0 mod 64). Since shift_byte is the low 8 bits of D0, and
  // the higher bits of D0 (bits 8..31) as from before, we need them. But
  // for `Dn mod 64`, only bits 0..5 of D0 matter. Since D0.b is the new value,
  // the bits 0..5 are shift_byte & 0x3f. So shift_count = shift_byte & 0x3f.
  const shift_count = shift_byte & 0x3f;

  // ── D1 >>>= D0.b (unsigned long shift) ────────────────────────────────
  // 68k `lsr.l Dn,Dy` interpreta lo shift count as `Dn mod 64`. Per shift
  // dobbiamo gestire separatamente count ≥ 32.
  if (shift_count >= 32) {
    D1_l_loaded = 0;
  } else {
    D1_l_loaded = (D1_l_loaded >>> shift_count) >>> 0;
  }

  // ── D1.w &= 0x7fe ────────────────────────────────────────────────────
  let D1_w_masked = D1_l_loaded & 0x7fe;

  // ── A2 = *(0x40065a).l (workRam) ─────────────────────────────────────
  let A2 = rl(WR_STRING_TABLE_PTR_ABS) >>> 0;
  // ── D0.w = word @ A2 + D1.w (sext, but D1.w ∈ [0, 0x7fe] always positive) ─
  let D0_w = rw((A2 + D1_w_masked) >>> 0);

  // ── case_top4: re-loop on bit11_set, branch on top4_nibble ────────────
  let bit11Reloops = 0;
  // Loop label "0x1786e" — we re-enter here after bit11_set indirect.
  // Cap re-loops to prevent pathological inputs (binary itself doesn't cap;
  // testing-only safety).
  const RELOOP_CAP = 64;

  while (true) {
    // top4 = D0.w & 0xF000
    let D1_top4 = D0_w & 0xf000;
    if (D1_top4 !== 0) {
      // ── case_top4 (0x178d8) ────────────────────────────────────────
      // D1.w (still = D0.w post-mask 0xF000)
      // D3.w *= 2 (only low word; D3.l preserved in upper)
      // D1.w &= word @ 0x24176 + D3.w (sext)
      let D3_w = (D3_l & 0xffff) * 2;
      D3_w = D3_w & 0xffff; // wrap 16-bit (add.w wraps)
      const D3_w_sext = sextW(D3_w);
      const top4MaskAddr = (ROM_TABLE_TOP4_MASK + D3_w_sext) >>> 0;
      const top4Mask = rw(top4MaskAddr);
      const D1_andResult = (D1_top4 & top4Mask) & 0xffff;

      if (D1_andResult !== 0) {
        // ── top4_short (0x178e8) ────────────────────────────────────
        let D0_short = D0_w & 0x7f;
        D0_short = (D0_short - 0x40) & 0xffff;
        const D2_doubled = (D2_w + D2_w) & 0xffff;
        const baseTblOff =
          (WR_BASE_OFFSET_TABLE_ABS + sextW(D2_doubled)) >>> 0;
        const baseWord = rw(baseTblOff);
        const D0_final = (D0_short + baseWord) & 0xffff;
        return {
          d0Word: D0_final,
          earlyExit: null,
          normalPath: "top4_short",
          bit11Reloops,
        };
      } else {
        // ── top4_search (0x178fe) ───────────────────────────────────
        // D1.w = D0.w & 0xf80; D1.w >>= 6 (signed asr but always non-negative)
        let D1_search = D0_w & 0xf80;
        D1_search = D1_search >> 6; // arithmetic but value is non-negative
        // D1.w = ROM word @ 0x1ed62 + D1.w (sext, but always non-neg)
        const biasAddr = (ROM_TABLE_BIAS_177F8 + D1_search) >>> 0;
        const biasW = rw(biasAddr);
        if (biasW === BIAS_SENTINEL_177F8) {
          return {
            d0Word: 0,
            earlyExit: "bias_sentinel",
            normalPath: null,
            bit11Reloops,
          };
        }
        const biasS = sextW(biasW);
        let D0_s = D0_w & 0x7f;
        D0_s = (D0_s - 0x40) & 0xffff;
        D0_s = (D0_s - biasS) & 0xffff;
        const D2_doubled = (D2_w + D2_w) & 0xffff;
        const baseTblOff =
          (WR_BASE_OFFSET_TABLE_ABS + sextW(D2_doubled)) >>> 0;
        const baseWord = rw(baseTblOff);
        const D0_final = (D0_s + baseWord) & 0xffff;
        return {
          d0Word: D0_final,
          earlyExit: null,
          normalPath: "top4_search",
          bit11Reloops,
        };
      }
    }

    // ── case_top4_zero: D0 fits in 12 bits ────────────────────────────
    const fff = D0_w & 0xfff;
    if (fff === 0) {
      return {
        d0Word: 0,
        earlyExit: "fff_zero",
        normalPath: null,
        bit11Reloops,
      };
    }

    if ((fff & 0x800) !== 0) {
      // ── case_bit11_set: indirect via workRam @ 0x40076e, then re-loop ──
      bit11Reloops++;
      if (bit11Reloops > RELOOP_CAP) {
        // Safety cap (TS-only). The binary doesn't cap; if the reloop never
        // converges, it'd be an infinite loop. Treat as bound-like miss for
        // safety; tests should never hit this in practice.
        return {
          d0Word: 0,
          earlyExit: "bound",
          normalPath: null,
          bit11Reloops,
        };
      }
      const D0_masked = D0_w & 0x7fe;
      // ext.l D0: sign-extend D0.w to long. D0.w & 0x7fe < 0x8000, so sext = same.
      // movea.l D0,A1; adda.l #0x40076e,A1; move.w (A1),D0w
      const indirectAddr =
        (WR_INDIRECT_TABLE_ABS + sextW(D0_masked)) >>> 0;
      D0_w = rw(indirectAddr);
      // re-loop: branch back to 0x1786e (top4 check)
      continue;
    }

    // ── case_no_bit11 (0x1789a) ────────────────────────────────────────
    // ext.l D0: D0.w & 0xfff with bit 11 = 0, so 0..0x7ff (positive). sext = same.
    // A1 = (A0).l + D0
    const D0_sext = sextW(D0_w);
    const A0_deref = rl(A0); // (A0).l = long @ level header
    A1 = (A0_deref + D0_sext) >>> 0;

    // A2 = 0x2417e + D3 * 8
    // D3.l was set earlier (sext arg2 + globalLong988). Now `asl.l #3, D3`
    // shifts left 3 (= * 8). This is a long arithmetic shift (or logical,
    // same result for positive but asl can affect V-flag for sign change).
    // For modulo 2^32, asl.l #3 = (D3 << 3) >>> 0.
    const D3_shifted = (D3_l << 3) >>> 0;
    A2 = (ROM_TABLE_PAIR_LONG + D3_shifted) >>> 0;

    // A3 = A1 + (A2).l
    const offset0 = rl(A2);
    const A3 = (A1 + offset0) >>> 0;

    // D0.b = (A3).b
    let D0_b_a = rb(A3) & 0xff;

    // A2 += 4; A1 += (A2).l; D1.b = (A1).b
    A2 = (A2 + 4) >>> 0;
    const offset4 = rl(A2);
    A1 = (A1 + offset4) >>> 0;
    const D1_b_a = rb(A1) & 0xff;

    // cmp.b D1b,D0b; bcc skip; move.b D1b,D0b — i.e., D0.b = max(D0.b, D1.b) UNSIGNED
    if (D0_b_a < D1_b_a) {
      D0_b_a = D1_b_a;
    }

    // D0.w &= 0xff
    let D0_pixel = D0_b_a & 0xff;
    if (D0_pixel === 0) {
      return {
        d0Word: 0,
        earlyExit: "byte_zero",
        normalPath: null,
        bit11Reloops,
      };
    }
    D0_pixel = (D0_pixel - 0x80) & 0xffff;

    const D2_doubled = (D2_w + D2_w) & 0xffff;
    const baseTblOff = (WR_BASE_OFFSET_TABLE_ABS + sextW(D2_doubled)) >>> 0;
    const baseWord = rw(baseTblOff);
    const D0_final = (D0_pixel + baseWord) & 0xffff;
    return {
      d0Word: D0_final,
      earlyExit: null,
      normalPath: "no_bit11",
      bit11Reloops,
    };
  }
}
