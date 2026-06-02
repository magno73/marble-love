/**
 * decode-bitstream-1a668.ts — replica `FUN_0001A668` (304 byte).
 *
 * RLE-style bitstream plus byte-stream decoder that emits 36 words (72 bytes)
 * into an output buffer. It combines:
 *   - a control bitstream read as overlapping 32-bit BE windows from `A3`.
 *     A3 advances by one word whenever the bit pointer crosses byte 16.
 *   - an extra-byte stream read from `A1` as alternating `(count, value)` pairs.
 *     `count` controls how many consecutive tokens share the additive value.
 *   - due **lookup table ROM**:
 *     * `0x2499A` (32 words, 64 bytes), used by path C
 *     * `0x249DA` (8 words, 16 bytes), used by path D
 *
 * **Disasm 0x1A668..0x1A797** (304 byte):
 *
 *   0x1A668:  movem.l {A5 A4 A3 A2 D6 D5 D4 D3 D2},-(SP)  ; preserve 9 reg (36 byte)
 *   0x1A66C:  movea.l (0x28,SP),A2                 ; A2 = arg1 = output ptr
 *   0x1A670:  movea.l (0x2C,SP),A3                 ; A3 = arg2 = ctrl long-stream
 *   0x1A674:  movea.l (0x30,SP),A1                 ; A1 = arg3 = extra-byte stream
 *   0x1A678:  lea (0x2499A).l,A0                   ; A0 = ROM table 1 (32 word)
 *   0x1A67E:  lea (0x249DA).l,A5                   ; A5 = ROM table 2 (8 word)
 *   0x1A684:  clr.b D2b                            ; D2 = 0 (extra-byte cache count)
 *   0x1A686:  clr.b D4b                            ; D4 = 0 (bit position counter)
 *   0x1A688:  movea.l A2,A4
 *   0x1A68A:  adda.l #0x48,A4                      ; A4 = A2 + 0x48 (output end)
 *
 *   loop @ 0x1A690:
 *   0x1A690:  move.l (A3),D0                       ; D0 = 32-bit BE @ A3
 *   0x1A692:  moveq #0x12,D1
 *   0x1A694:  sub.b D4b,D1b                        ; D1 = 18 - D4
 *   0x1A696:  asr.l D1,D0                          ; D0 = bits[D4..D4+13] (signed)
 *   0x1A698:  move.w D0w,D5w
 *   0x1A69A:  andi.w #0x3FFF,D5w                   ; D5 = 14-bit token (unsigned)
 *   0x1A69E:  bclr.l #0xD,D5                       ; clear+test bit 13 of D5
 *   0x1A6A2:  beq.b 0x1A6C4                        ; if bit13 == 0 → branch
 *
 *   ── Path A (bit 13 set; "single literal with offset"):
 *   0x1A6A4:  tst.b D2b
 *   0x1A6A6:  bne.b 0x1A6AE
 *   0x1A6A8:  move.b (A1)+,D2b                     ; D2 = byte from A1 (count)
 *   0x1A6AA:  move.b (A1)+,D3b                     ; D3.b = byte from A1 (value)
 *   0x1A6AC:  asl.w #0x8,D3w                       ; D3.w = value << 8
 *   0x1A6AE:  subq.b #0x1,D2b                      ; D2--
 *   0x1A6B0:  asr.w #0x1,D5w                       ; D5 >>= 1 (signed)
 *   0x1A6B2:  bcc.b 0x1A6B6                        ; if old LSB == 0 → skip
 *   0x1A6B4:  move.w D5w,D6w                       ;   else D6 = D5 (after shift)
 *   0x1A6B6:  add.w D3w,D5w
 *   0x1A6B8:  move.w D5w,(A2)+                     ; *A2++ = D5 + D3
 *   0x1A6BA:  addi.l #0xE,D4                       ; D4 += 14
 *   0x1A6C0:  bra.w 0x1A784
 *
 *   ── @ 0x1A6C4 (bit 13 clear): controllo bit 12..10 (mask 0x1C00)
 *   0x1A6C4:  move.w D5w,D1w
 *   0x1A6C6:  andi.w #0x1C00,D1w                   ; D1 = D5 & 0x1C00
 *   0x1A6CA:  bne.b 0x1A6F4                        ; if D1 != 0 → branch
 *
 *   ── Path B (D1 == 0; "consecutive run with auto-increment D6"):
 *   0x1A6CC:  move.w D5w,D1w
 *   0x1A6CE:  asr.w #0x7,D1w
 *   0x1A6D0:  andi.w #0x7,D1w                      ; D1 = (D5 >> 7) & 7 (count - 1)
 *   loop:
 *   0x1A6D4:  tst.b D2b
 *   0x1A6D6:  bne.b 0x1A6DE
 *   0x1A6D8:  move.b (A1)+,D2b                     ; reload count
 *   0x1A6DA:  move.b (A1)+,D3b                     ; reload value
 *   0x1A6DC:  asl.w #0x8,D3w
 *   0x1A6DE:  subq.b #0x1,D2b                      ; D2--
 *   0x1A6E0:  addq.w #0x1,D6w                      ; D6++ (pre-increment)
 *   0x1A6E2:  move.w D6w,D0w
 *   0x1A6E4:  add.w D3w,D0w
 *   0x1A6E6:  move.w D0w,(A2)+                     ; *A2++ = D6 + D3
 *   0x1A6E8:  subq.w #0x1,D1w
 *   0x1A6EA:  tst.w D1w
 *   0x1A6EC:  bge.b 0x1A6D4                        ; D1 >= 0 → loop
 *   0x1A6EE:  addq.l #0x7,D4                       ; D4 += 7
 *   0x1A6F0:  bra.w 0x1A784
 *
 *   ── @ 0x1A6F4: D1 != 0; check if == 0x1C00
 *   0x1A6F4:  cmpi.w #0x1C00,D1w
 *   0x1A6F8:  bne.b 0x1A71C                        ; if != 0x1C00 → branch
 *
 *   ── Path C (D1 == 0x1C00; "single ROM-table-1 lookup + offset"):
 *   0x1A6FA:  tst.b D2b
 *   0x1A6FC:  bne.b 0x1A704
 *   0x1A6FE:  move.b (A1)+,D2b
 *   0x1A700:  move.b (A1)+,D3b
 *   0x1A702:  asl.w #0x8,D3w
 *   0x1A704:  subq.b #0x1,D2b
 *   0x1A706:  asr.w #0x4,D5w
 *   0x1A708:  andi.w #0x3E,D5w                     ; D5 = (D5 >> 4) & 0x3E (even, 0..62)
 *   0x1A70C:  move.w (0x0,A0,D5w*0x1),D5w          ; D5 = ROM[0x2499A + D5] (word)
 *   0x1A710:  add.w D3w,D5w
 *   0x1A712:  move.w D5w,(A2)+                     ; *A2++ = ROM_table1[idx] + D3
 *   0x1A714:  addi.l #0x9,D4                       ; D4 += 9
 *   0x1A71A:  bra.b 0x1A784
 *
 *   ── @ 0x1A71C: D1 != 0 && D1 != 0x1C00; check if D1 <= 0x1000
 *   0x1A71C:  cmpi.w #0x1000,D1w
 *   0x1A720:  bgt.b 0x1A752                        ; if D1 > 0x1000 → branch (path E)
 *
 *   ── Path D (D1 in {0x400, 0x800, 0xC00, 0x1000}; "consecutive run with
 *   ── ROM-table-2 lookup constant"):
 *   0x1A722:  move.w D5w,D1w
 *   0x1A724:  asr.w #0x7,D1w
 *   0x1A726:  andi.w #0x7,D1w                      ; D1 = (D5 >> 7) & 7 (count - 1)
 *   0x1A72A:  moveq #0x9,D0
 *   0x1A72C:  asr.w D0,D5w
 *   0x1A72E:  andi.w #0xE,D5w                      ; D5 = (D5 >> 9) & 0xE (even, 0..14)
 *   0x1A732:  move.w (0x0,A5,D5w*0x1),D5w          ; D5 = ROM[0x249DA + D5] (word)
 *   loop:
 *   0x1A736:  tst.b D2b
 *   0x1A738:  bne.b 0x1A740
 *   0x1A73A:  move.b (A1)+,D2b
 *   0x1A73C:  move.b (A1)+,D3b
 *   0x1A73E:  asl.w #0x8,D3w
 *   0x1A740:  subq.b #0x1,D2b
 *   0x1A742:  move.w D5w,D0w
 *   0x1A744:  add.w D3w,D0w
 *   0x1A746:  move.w D0w,(A2)+                     ; *A2++ = ROM_table2[idx] + D3
 *   0x1A748:  subq.w #0x1,D1w
 *   0x1A74A:  tst.w D1w
 *   0x1A74C:  bge.b 0x1A736
 *   0x1A74E:  addq.l #0x7,D4                       ; D4 += 7
 *   0x1A750:  bra.b 0x1A784
 *
 *   ── Path E (D1 > 0x1000; "consecutive run with toggle base 0x4D/0x4E"):
 *   0x1A752:  move.w D5w,D1w                       ; D1 = D5 (full)
 *   0x1A754:  move.w #0x4D,D5w
 *   0x1A758:  btst.l #0xA,D1                       ; test bit 10 of D1
 *   0x1A75C:  bne.b 0x1A760                        ; if bit 10 set → skip
 *   0x1A75E:  addq.w #0x1,D5w                      ;   else D5++ (D5 = 0x4E)
 *   0x1A760:  asr.w #0x7,D1w
 *   0x1A762:  andi.w #0x7,D1w                      ; D1 = (D5 >> 7) & 7 (count - 1)
 *   loop:
 *   0x1A766:  tst.b D2b
 *   0x1A768:  bne.b 0x1A770
 *   0x1A76A:  move.b (A1)+,D2b
 *   0x1A76C:  move.b (A1)+,D3b
 *   0x1A76E:  asl.w #0x8,D3w
 *   0x1A770:  subq.b #0x1,D2b
 *   0x1A772:  move.w D5w,D0w
 *   0x1A774:  add.w D3w,D0w
 *   0x1A776:  move.w D0w,(A2)+                     ; *A2++ = D5 + D3
 *   0x1A778:  eori.w #0x3,D5w                      ; D5 ^= 3 (toggle low 2 bit)
 *   0x1A77C:  subq.w #0x1,D1w
 *   0x1A77E:  tst.w D1w
 *   0x1A780:  bge.b 0x1A766
 *   0x1A782:  addq.l #0x7,D4                       ; D4 += 7
 *
 *   ── Post-iter @ 0x1A784:
 *   0x1A784:  bclr.l #0x4,D4                       ; clear+test bit 4 of D4
 *   0x1A788:  beq.b 0x1A78C                        ; if bit was 0 → skip
 *   0x1A78A:  addq.l #0x2,A3                       ;   else A3 += 2 (advance 1 word)
 *   0x1A78C:  cmpa.l A4,A2
 *   0x1A78E:  bcs.w 0x1A690                        ; if A2 < A4 → loop
 *   0x1A792:  movem.l (SP)+,{D2 D3 D4 D5 D6 A2 A3 A4 A5}
 *   0x1A796:  rts
 *
 * **Bit-perfect model**:
 *
 *   1. **Output buffer** (A2): 0x48 bytes = 36 words. All five paths write one
 *      or more words to `(A2)+`. The loop checks `A2 < A4` after each path, so
 *      a final multi-word path can overshoot by 0..7 words.
 *
 *   2. **Ctrl stream** (A3): A3 is a long read pointer. It reads 4 BE bytes
 *      each iteration and advances by +2 only when D4 crosses bit 16. Consecutive
 *      `move.l (A3),D0` reads therefore overlap by 16 bits.
 *
 *   3. **Bit position D4**: D4 is a 32-bit scalar, accumulated by 7/9/14
 *      each iteration. `bclr.l #4,D4` clears bit 4 exactly. After incrementing,
 *      D4 is at most 14+14 = 28 (two consecutive path A tokens), so only
 *      bit 4 (16) can be set, never bit 5+. `bclr` is therefore equivalent to
 *      `D4 mod 16` for in-game values. In `D1 = 18 - D4b`, only D4.b is used
 *      (low byte). If D4 < 16 (post-bclr), the subtract result is 18-D4 in
 *      [4..18].
 *
 *   4. **Extra-byte cache** (D2, D3): D2 is an unsigned byte counter and D3.w
 *      contains `value << 8`. When D2 is zero, the routine reloads
 *      `D2 = (A1)+, D3 = (A1)+ << 8`, then decrements D2. If the new count was
 *      zero, byte underflow makes it 0xFF, delaying the next reload for 255
 *      cache uses.
 *
 *   5. **Conditional path A `move.w D5w,D6w`**: after `asr.w #1, D5w`, `bcc`
 *      skips when carry is CLEAR (LSB was 0); fall-through (carry SET) executes
 *      `move.w D5w, D6w`. D6 is therefore updated only when bit 0 of the
 *      14-bit token (before the shift and before clearing bit 13) was 1. The
 *      bit 13 clear does not affect bit 0. Path B uses D6 as an auto-incrementing
 *      base.
 *
 *   6. **Path B/D/E inner loop**: the count is (D5 >> 7) & 7, therefore 0..7.
 *      The loop body runs D1+1 times (`subq+bge`: D1 starts at X-1 and ends at
 *      -1), so each token emits 1..8 output words.
 *
 *   7. **Path C ROM lookup index**: `D5 = (D5 >> 4) & 0x3E`, even values
 *      0..62. `move.w (0,A0,D5*1),D5` reads a ROM word from
 *      `0x2499A + D5_byte_offset`.
 *
 *   8. **Path D ROM lookup index**: `D5 = (D5 >> 9) & 0xE`, even values 0..14.
 *      8 total words (16 bytes).
 *
 *   9. **Word add `add.w D3w, D5w`**: 16-bit wrapping add (mod 0x10000).
 *      Output is 16-bit BE in workRam.
 *
 *  10. **Pure mutation**: the function mutates only
 *      `[outAbs..outAbs+0x48)` in workRam. A3 and A1 are read-only.
 *
 * **Side effect bit-perfect**:
 *   - workRam[outAbs..outAbs+0x48) or more (0..7 word overshoot).
 *   - No other writes.
 *
 * **Known callers** (4 call sites):
 *   - 0x135A8 in FUN_0001344c
 *   - 0x17008 in FUN_00016f6c
 *   - 0x13F96 / 0x1406C in FUN_00013ee6
 *
 * Bit-perfect verification via `packages/cli/src/test-decode-bitstream-1a668-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Absolute M68k workRam base. */
const WORK_RAM_BASE = 0x400000;
/** Exclusive workRam upper bound. */
const WORK_RAM_END = 0x402000;
/** Absolute M68k playfieldRam base. */
const PF_RAM_BASE = 0xa00000;
/** Exclusive playfieldRam upper bound. */
const PF_RAM_END = 0xa02000;
/** Exclusive program ROM upper bound. */
const ROM_END = 0x88000;

/** Minimum number of bytes written to the output buffer. */
export const OUTPUT_LEN_BYTES = 0x48 as const;
/** Minimum number of words written to the output buffer. */
export const OUTPUT_LEN_WORDS = 0x24 as const; // 36

/** ROM offset for lookup table 1 (32 words = 64 bytes). */
export const ROM_TABLE1_OFF = 0x2499a as const;
/** Number of words in ROM table 1. */
export const ROM_TABLE1_COUNT = 32 as const;

/** ROM offset for lookup table 2 (8 words = 16 bytes). */
export const ROM_TABLE2_OFF = 0x249da as const;
/** Number of words in ROM table 2. */
export const ROM_TABLE2_COUNT = 8 as const;

/** Bit 13 mask: partitions path A vs B/C/D/E. */
const BIT13_MASK = 0x2000;
/** 14-bit mask used to extract the token. */
const TOKEN14_MASK = 0x3fff;
/** Bit 12..10 mask: partitions path B vs C/D/E. */
const PATHGROUP_MASK = 0x1c00;
/** Path C selector. */
const PATH_C_VAL = 0x1c00;
/** Path D upper bound (inclusive). */
const PATH_D_MAX = 0x1000;
/** Path E bit 10 test mask. */
const BIT10_MASK = 0x400;
/** Path E base if bit 10 set. */
const PATH_E_BASE_HIGH = 0x4d;
/** Path E base if bit 10 clear. */
const PATH_E_BASE_LOW = 0x4e;

/**
 * Reads a byte from M68k absolute memory. Maps ROM (0..0x88000) and workRam
 * (0x400000..0x402000). Out-of-range ⇒ 0 (difensivo).
 */
function read8Abs(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a < ROM_END) return (rom.program[a] ?? 0) & 0xff;
  if (a >= PF_RAM_BASE && a < PF_RAM_END) {
    return (state.playfieldRam[a - PF_RAM_BASE] ?? 0) & 0xff;
  }
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    return (state.workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
  }
  return 0;
}

/**
 * Reads one BE word (16-bit unsigned) from absolute M68k memory.
 * Out-of-range => 0 as a defensive fallback.
 */
function read16Abs(state: GameState, rom: RomImage, abs: number): number {
  const b0 = read8Abs(state, rom, abs);
  const b1 = read8Abs(state, rom, (abs + 1) >>> 0);
  return ((b0 << 8) | b1) & 0xffff;
}

/**
 * Reads one BE long (32-bit unsigned) from absolute M68k memory.
 * Out-of-range => 0 as a defensive fallback.
 */
function read32Abs(state: GameState, rom: RomImage, abs: number): number {
  const b0 = read8Abs(state, rom, abs);
  const b1 = read8Abs(state, rom, (abs + 1) >>> 0);
  const b2 = read8Abs(state, rom, (abs + 2) >>> 0);
  const b3 = read8Abs(state, rom, (abs + 3) >>> 0);
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

/**
 * Writes one byte to absolute M68k memory. The decoder is used for both
 * scratch workRam and playfield rows during `levelInit16F6C`.
 */
function write8Abs(state: GameState, abs: number, v: number): void {
  const a = abs >>> 0;
  if (a >= PF_RAM_BASE && a < PF_RAM_END) {
    state.playfieldRam[a - PF_RAM_BASE] = v & 0xff;
    return;
  }
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    state.workRam[a - WORK_RAM_BASE] = v & 0xff;
  }
}

/**
 * Writes one BE word to absolute M68k memory.
 */
function write16Abs(state: GameState, abs: number, v: number): void {
  write8Abs(state, abs, (v >>> 8) & 0xff);
  write8Abs(state, (abs + 1) >>> 0, v & 0xff);
}

/**
 * **Arithmetic shift right on a signed long (32-bit) by N bits.**
 *
 * `asr.l D1, D0` on M68k is a signed shift with sign-extension from bit 31.
 * N is the count modulo 64 on the 68000, but for N in [4..18] (this routine's
 * D1 range) it is always a normal shift.
 */
function asrL32(value: number, n: number): number {
  const s = ((value | 0) >> (n & 31)) | 0; // JS `>>` e' arithmetic su int32
  return s | 0;
}

/**
 * Replica `FUN_0001A668` — bitstream + byte-stream RLE-style decoder.
 *
 * See the module header for the bit-exact disassembly notes.
 *
 * @param state    GameState with writable workRam output.
 * @param rom      ROM image; lookup tables and stream pointers may point to ROM
 *                 or workRam through absolute-address reads.
 * @param outAbs   Absolute 68000 pointer to the output buffer.
 * @param ctrlAbs  Absolute 68000 pointer to the control bitstream.
 * @param extAbs   Absolute 68000 pointer to the extra-byte stream.
 *
 * **Mutation**: workRam at `[outAbs..outAbs+0x48)`, possibly overshooting by
 * up to 7 words when the final B/D/E path emits multiple entries.
 */
export function decodeBitstream1A668(
  state: GameState,
  rom: RomImage,
  outAbs: number,
  ctrlAbs: number,
  extAbs: number,
  d6Init: number = 0,
): void {
  // Register state mirrored in JavaScript.
  let a2 = outAbs >>> 0; // output write ptr
  let a3 = ctrlAbs >>> 0; // ctrl long-stream ptr (advances by 2 conditionally)
  let a1 = extAbs >>> 0; // extra-byte stream ptr (advances by 1 on each (A1)+)
  const a4 = (outAbs + OUTPUT_LEN_BYTES) >>> 0; // output end exclusive

  // D2: byte counter for extra-byte cache (0..255; underflow allowed).
  let d2 = 0;
  // D3: 16-bit; high byte = current "value" from extra stream, low byte = 0.
  let d3 = 0;
  // D4: bit position counter (byte/long; only low byte used in `sub.b D4b,D1b`).
  let d4 = 0;
  // D5: scratch (14-bit token, indices, lookup result).
  let d5 = 0;
  // D6: auto-increment base for path B (preserved across iters).
  // MAME preserves D6 across the call through the movem prologue, so the entry
  // value belongs to the caller. TS accepts it as `d6Init`.
  let d6 = d6Init & 0xffff;

  // Reload byte cache (D2, D3) when D2 == 0. The same sequence appears in all
  // five decode paths.
  const maybeReloadCache = (): void => {
    if ((d2 & 0xff) === 0) {
      d2 = read8Abs(state, rom, a1);
      a1 = (a1 + 1) >>> 0;
      const valByte = read8Abs(state, rom, a1);
      a1 = (a1 + 1) >>> 0;
      // `move.b` writes only D3.b; `asl.w #8` then shifts the whole low word.
      // The result observed by later `add.w` operations is `valByte << 8`.
      d3 = (valByte << 8) & 0xffff;
    }
    // D2-- always, even after reload. M68k `subq.b` byte underflow is OK.
    d2 = (d2 - 1) & 0xff;
  };

  // Main loop at 0x1A690. It ends when A2 >= A4.
  // Safety cap: max OUTPUT_LEN_WORDS (36) iter (path A produce 1 word, path B/D/E
  // 1..8 words). The `A2 < A4` check exits as soon as A2 reaches the end.
  // Defensive cap: 100 iterations.
  let safety = 100;
  while (safety-- > 0) {
    if ((a2 >>> 0) >= a4) break;

    // 0x1A690-0x1A69E: extract 14-bit token from ctrl stream.
    const d0 = read32Abs(state, rom, a3);
    const d1Shift = (0x12 - (d4 & 0xff)) & 0xff; // sub.b D4b,D1b
    // M68k `asr.l D1, D0` with D1 in [0..63]: shift mod 64. For D1 in [4..18]
    // (D4 in [0..14] after bclr), this is the normal shift.
    const shifted = asrL32(d0 | 0, d1Shift) | 0;
    d5 = shifted & 0xffff; // move.w D0w, D5w
    d5 = d5 & TOKEN14_MASK; // andi.w #0x3FFF, D5w
    // bclr.l #13, D5: tests + clears bit 13. Z flag = original bit 13 == 0.
    const wasBit13Set = (d5 & BIT13_MASK) !== 0;
    d5 = d5 & ~BIT13_MASK & 0xffff; // bclr clears bit 13

    if (wasBit13Set) {
      // ── Path A @ 0x1A6A4: single literal with offset.
      maybeReloadCache();
      // asr.w #1, D5w; bcc → skip move.w D5w,D6w.
      const oldD5 = d5 & 0xffff;
      const oldLsb = oldD5 & 1;
      // asr.w (signed) by 1. d5 was masked to 13 bits (after bclr #13), so high
      // bit is bit 12. asr.w sign-extends from bit 15. Since d5 < 0x2000 (bit 15
      // = 0), asr.w by 1 = unsigned shift right.
      d5 = (oldD5 >>> 1) & 0xffff;
      if (oldLsb !== 0) {
        // carry SET → fall through to `move.w D5w, D6w`.
        d6 = d5 & 0xffff;
      }
      // add.w D3w, D5w → 16-bit add wrap.
      const out = (d5 + (d3 & 0xffff)) & 0xffff;
      write16Abs(state, a2, out);
      a2 = (a2 + 2) >>> 0;
      d4 = (d4 + 0xe) | 0; // D4 += 14
    } else {
      // bit 13 == 0; check 0x1C00 mask
      const d1 = d5 & PATHGROUP_MASK;
      if (d1 === 0) {
        // ── Path B @ 0x1A6CC: consecutive run with auto-increment D6.
        let cnt = ((d5 >>> 7) & 0x7) | 0; // D1 = (D5 >> 7) & 7 (count - 1)
        // do { ... } while (cnt-- >= 0) — bge after subq.
        // Loop body emits cnt+1 words.
        do {
          maybeReloadCache();
          d6 = (d6 + 1) & 0xffff; // addq.w #1, D6w
          const out = (d6 + (d3 & 0xffff)) & 0xffff;
          write16Abs(state, a2, out);
          a2 = (a2 + 2) >>> 0;
          cnt = (cnt - 1) | 0;
        } while (cnt >= 0);
        d4 = (d4 + 0x7) | 0; // D4 += 7
      } else if (d1 === PATH_C_VAL) {
        // ── Path C @ 0x1A6FA: single ROM-table-1 lookup + offset.
        maybeReloadCache();
        // D5 = (D5 >> 4) & 0x3E
        const idx = ((d5 >>> 4) & 0x3e) | 0;
        const tableWord = read16Abs(state, rom, ROM_TABLE1_OFF + idx);
        const out = (tableWord + (d3 & 0xffff)) & 0xffff;
        write16Abs(state, a2, out);
        a2 = (a2 + 2) >>> 0;
        d4 = (d4 + 0x9) | 0; // D4 += 9
      } else if (d1 <= PATH_D_MAX) {
        // ── Path D @ 0x1A722: consecutive run with ROM-table-2 lookup constant.
        let cnt = ((d5 >>> 7) & 0x7) | 0; // D1 = (D5 >> 7) & 7
        // D5 = (D5 >> 9) & 0xE
        const idx = ((d5 >>> 9) & 0xe) | 0;
        const tableWord = read16Abs(state, rom, ROM_TABLE2_OFF + idx);
        d5 = tableWord & 0xffff; // D5 = ROM_table2[idx]
        do {
          maybeReloadCache();
          const out = (d5 + (d3 & 0xffff)) & 0xffff;
          write16Abs(state, a2, out);
          a2 = (a2 + 2) >>> 0;
          cnt = (cnt - 1) | 0;
        } while (cnt >= 0);
        d4 = (d4 + 0x7) | 0;
      } else {
        // ── Path E @ 0x1A752: consecutive run with toggle base 0x4D/0x4E.
        const d1Save = d5 & 0xffff; // move.w D5w, D1w (full)
        let base = PATH_E_BASE_HIGH; // 0x4D
        if ((d1Save & BIT10_MASK) === 0) {
          base = PATH_E_BASE_LOW; // 0x4E
        }
        d5 = base & 0xffff;
        let cnt = ((d1Save >>> 7) & 0x7) | 0; // D1 = (D1 >> 7) & 7
        do {
          maybeReloadCache();
          const out = (d5 + (d3 & 0xffff)) & 0xffff;
          write16Abs(state, a2, out);
          a2 = (a2 + 2) >>> 0;
          d5 = (d5 ^ 0x3) & 0xffff; // eori.w #3, D5w
          cnt = (cnt - 1) | 0;
        } while (cnt >= 0);
        d4 = (d4 + 0x7) | 0;
      }
    }

    // ── Post-iter @ 0x1A784: bclr.l #4, D4; if was set: A3 += 2.
    const wasBit4Set = (d4 & 0x10) !== 0;
    d4 = d4 & ~0x10; // bclr #4
    if (wasBit4Set) {
      a3 = (a3 + 2) >>> 0;
    }
    // 0x1A78C: cmpa.l A4, A2; bcs (unsigned <) loop.
    if ((a2 >>> 0) >= a4) break;
  }
}
