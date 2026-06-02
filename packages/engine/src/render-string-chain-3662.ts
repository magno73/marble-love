/**
 * render-string-chain-3662.ts — replica `FUN_00003662` (290 bytes, up to
 * `rts` @ 0x3782).
 *
 * Per-character dispatch variant of the string-chain renderer. It walks the
 * same linked-list entries as FUN_2572 and dispatches each character to:
 *   - `FUN_00032BA` (alias `fun_32ba`)  if rotation == 0
 *   - `FUN_000033F4` (alias `fun_33f4`) if rotation != 0
 *
 * **Entry struct layout** (same as FUN_2572 / FUN_2DA0):
 *   +0  byte  : col (signed)
 *   +1  byte  : tickOff (signed; sub.w uses the sign-extended word)
 *   +6  byte  : marker (added to *0x401F00 for the chain end check)
 *   +8  long  : pointer next entry
 *
 * **Work RAM globals**:
 *   0x401F00  word: VALUE_F00 (signed addend for the marker check)
 *   0x401F3A  word: tick counter (signed; sub.w applies word arithmetic)
 *
 * **ROM tables** (same as FUN_2572):
 *   0x7294   word table   : max-display-row per rotation (signed cmp.w)
 *   0x72a0   word table   : stride between consecutive chars per rotation
 *   0x72a4+1 byte table   : shift count per rotation (`asl.l Dn,Dm`, mod 64)
 *   0x72ac   long table   : per-character glyph index, indexed by char*4
 *
 * **Disasm 0x3662..0x3784** (290 byte / 0x122):
 *
 *   0x3662  movem.l {A4 A3 A2 D3 D2},-(SP)         ; 5 reg → SP -= 0x14
 *   0x3666  movea.l (0x18,SP),A2                    ; A2 = arg1 long (struct ptr)
 *   0x366a  move.w  (0x1e,SP),D0w                   ; D0w = arg2 low word
 *   0x366e  movea.l #0x401f42,A3                    ; A3 = &rotation flag (work RAM)
 *
 *   0x3674    move.b  (0x1,A2),D1b                  ; D1b = byte @ A2+1 (tickOff)
 *   0x3678    ext.w   D1w                            ; sign-extend byte to word
 *   0x367a    sub.w   (0x00401f3a).l,D1w             ; D1w = sext_w(tickOff) - tick
 *   0x3680    move.w  (A3),D0w                       ; D0w = rotation
 *   0x3682    ext.l   D0
 *   0x3684    add.l   D0,D0                          ; D0 = sext(rotation) * 2
 *   0x3686    movea.l #0x7294,A0                     ; A0 = ROM lookup table
 *   0x368c    cmp.w   (0x0,A0,D0*0x1),D1w            ; cmp lookup[rotation*2], D1w
 *   0x3690    bgt.w   0x375c                         ; if D1w > lookup, exit_path
 *
 *   0x3694    move.l  #0xa03000,D3                   ; D3 = ALPHA_BASE
 *   0x369a    movea.l (0x2,A2),A4                    ; A4 = stringPtr (long @ A2+2)
 *   0x369e    tst.w   (A3)                           ; rotation == 0?
 *   0x36a0    beq.b   0x36ac                         ;   (use ROT0 path)
 *
 *   ; rotation != 0:  D2 = 0x29 - sext_l(D1w)
 *   0x36a2    moveq   0x29,D2
 *   0x36a4    move.w  D1w,D0w
 *   0x36a6    ext.l   D0                              ; D0 = sext_l(D1w)
 *   0x36a8    sub.l   D0,D2                           ; D2 = 0x29 - D0
 *   0x36aa    bra.b   0x36b2
 *
 *   ; rotation == 0:  D2 = sext_l(D1w) << 6
 *   0x36ac    move.w  D1w,D2w
 *   0x36ae    ext.l   D2                              ; D2 = sext_l(D1w)
 *   0x36b0    asl.l   #0x6,D2                         ; D2 <<= 6 (arith == logical
 *
 *   ; join: compute alpha base D3
 *   0x36b2    move.b  (A2),D0b                        ; D0b = col (byte @ A2)
 *   0x36b4    ext.w   D0w
 *   0x36b6    ext.l   D0                              ; D0 = sext_l(col)
 *   0x36b8    move.w  (A3),D1w                        ; D1w = rotation
 *   0x36ba    ext.l   D1
 *   0x36bc    add.l   D1,D1                           ; D1 = sext(rotation) * 2
 *   0x36be    movea.l #0x72a4,A0                      ; A0 = ROM shift table base
 *   0x36c4    move.b  (0x1,A0,D1*0x1),D1b             ; D1b = byte @ 0x72a5+rot*2
 *   0x36c8    asl.l   D1,D0                           ; D0 <<= (D1 mod 64), 0 if >=32
 *   0x36ca    add.l   D2,D0                           ; D0 += D2
 *   0x36cc    add.l   D0,D0                           ; D0 *= 2 (word index → byte)
 *   0x36ce    add.l   D0,D3                           ; D3 = ALPHA_BASE + D0
 *
 *   ; per-char dispatch loop @ 0x36d0
 *   0x36d0    char_loop:
 *   0x36d0    move.b  (A4)+,D2b                       ; D2b = byte[A4]; A4++
 *   0x36d2    beq.w   0x375c                          ; if char==0, exit_path
 *   0x36d6    tst.w   (A3)                            ; rotation == 0?
 *   0x36d8    beq.b   0x36ee                          ;   (call FUN_32BA branch)
 *
 *   ; rotation != 0:  call FUN_33F4(D3, 0x3c, 0)
 *   0x36da    clr.l   -(SP)                           ; push 0 (long arg3)
 *   0x36dc    pea     (0x3c).w                         ; push 0x3c (long arg2,
 *                                                     ;   sext from word 0x003C)
 *   0x36e0    move.l  D3,-(SP)                        ; push D3 (long arg1)
 *   0x36e2    jsr     0x000033f4.l                    ; FUN_33F4(alphaPtr, 0x3c, 0)
 *   0x36e8    lea     (0xc,SP),SP                     ; pop 12 bytes
 *   0x36ec    bra.b   0x3700
 *
 *   ; rotation == 0:  call FUN_32BA(D3, 0x3c, 0)
 *   0x36ee    clr.l   -(SP)
 *   0x36f0    pea     (0x3c).w
 *   0x36f4    move.l  D3,-(SP)
 *   0x36f6    jsr     0x000032ba.l                    ; FUN_32BA(alphaPtr, 0x3c, 0)
 *   0x36fc    lea     (0xc,SP),SP
 *
 *   ; per-char stride dispatch @ 0x3700
 *   0x3700    moveq   0x0,D1
 *   0x3702    move.b  D2b,D1b                         ; D1 = char (zero-ext)
 *   0x3704    asl.w   #0x2,D1w                         ; D1w = char * 4 (max 0x3FC)
 *   0x3706    movea.l #0x72ac,A0                       ; A0 = glyph-index table
 *   0x370c    moveq   0x26,D0                         ; D0 = 0x26
 *   0x370e    cmp.l   (0x0,A0,D1w*0x1),D0             ; cmp.l table[char*4], D0
 *   0x3712    bgt.b   0x3740                          ; if 0x26 > table → wide
 *
 *   0x3714    moveq   0x0,D1
 *   0x3716    move.b  D2b,D1b
 *   0x3718    asl.w   #0x2,D1w
 *   0x371a    movea.l #0x72ac,A0
 *   0x3720    moveq   0x2e,D0                         ; D0 = 0x2e
 *   0x3722    cmp.l   (0x0,A0,D1w*0x1),D0
 *   0x3726    blt.b   0x3740                          ; if 0x2e < table → wide
 *
 *   ; narrow: stride * 2
 *   0x3728    move.w  (A3),D0w                        ; D0w = rotation
 *   0x372a    ext.l   D0
 *   0x372c    add.l   D0,D0                           ; D0 = rotation * 2
 *   0x372e    movea.l #0x72a0,A0                       ; A0 = stride table
 *   0x3734    move.w  (0x0,A0,D0*0x1),D0w             ; D0w = stride[rotation*2]
 *   0x3738    ext.l   D0                              ; sext to long
 *   0x373a    add.l   D0,D0                           ; D0 = stride * 2
 *   0x373c    add.l   D0,D3                           ; D3 += stride*2 (NARROW step)
 *   0x373e    bra.b   0x36d0                          ; back to char_loop
 *
 *   ; wide: stride * 4
 *   0x3740    move.w  (A3),D0w
 *   0x3742    ext.l   D0
 *   0x3744    add.l   D0,D0                           ; D0 = rotation * 2
 *   0x3746    movea.l #0x72a0,A0
 *   0x374c    move.w  (0x0,A0,D0*0x1),D0w             ; D0w = stride[rotation*2]
 *   0x3750    ext.l   D0
 *   0x3752    asl.l   #0x1,D0                          ; D0 = stride * 2
 *   0x3754    add.l   D0,D0                           ; D0 = stride * 4
 *   0x3756    add.l   D0,D3                           ; D3 += stride*4 (WIDE step)
 *   0x3758    bra.w   0x36d0                          ; back to char_loop
 *
 *   ; exit_path: chain advance check + maybe loop
 *   0x375c    move.b  (0x6,A2),D0b                    ; D0b = marker (byte @ A2+6)
 *   0x3760    ext.w   D0w
 *   0x3762    ext.l   D0
 *   0x3764    move.w  (0x00401f00).l,D1w              ; D1w = VAL_F00
 *   0x376a    ext.l   D1
 *   0x376c    add.l   D1,D0                           ; D0 = sext(marker) + sext(VAL_F00)
 *   0x376e    moveq   0x1,D1
 *   0x3770    cmp.l   D0,D1                           ; flags = D1 - D0 = 1 - sum
 *   0x3772    bge.b   0x377c                          ; if 1 >= sum, return 1
 *   0x3774    movea.l (0x8,A2),A2                     ; A2 = next entry (long @ A2+8)
 *   0x3778    bra.w   0x3674                          ; back to loop_top
 *
 *   0x377c    moveq   0x1,D0                          ; D0 = 1 (return)
 *   0x377e    movem.l (SP)+,{D2 D3 A2 A3 A4}
 *   0x3782    rts
 *
 * **Calling convention** (cdecl, args pushed RTL):
 *     linked-list entry). movem pushed 5*4=20=0x14 bytes; 0x18 =
 *     0x14 + 4 (return address), so this is arg1 long.
 *     compatibility with FUN_2572, which uses it as `attrWord`).
 *   - D2, D3, A2, A3, A4 are callee-saved by movem.l.
 *
 * **Side effects**:
 *     0x72a0, 0x72a4, 0x72ac.
 *
 *
 *   1. **`sub.w (0x00401f3a).l,D1w`**: word arithmetic. D1w = (sext_b(tickOff)
 *      signed-word; bgt branches when D1w > lookup (signed).
 *
 *   2. **`asl.l #6, D2`** (rotation==0): arithmetic left shift on a long.
 *
 *   3. **`asl.l Dn, Dm`** (count from byte): count = `Dn & 63`.
 *
 *      char*4, max 0xFF*4 = 0x3FC < 0x8000, so there is no sign-extension issue.
 *
 *   5. **Char dispatch**:
 *      - byte 0 exits the chain (terminator)
 *      - nonzero byte calls FUN_32BA (rot==0) or FUN_33F4 (rot!=0)
 *      - stride: narrow (table[char*4] in [0x26..0x2e]) adds stride*2
 *                wide   (table[char*4] outside [0x26..0x2e]) adds stride*4
 *
 *   6. **Marker check**:
 *      D0 = sext_l(byte @ A2+6) + sext_l(word @ 0x401F00)
 *      `cmp.l D0,D1; bge` with D1=1 branches when 1 >= D0, returning 1.
 *      FUN_2572.
 *
 *      argument. This TS replica accepts it and ignores it.
 *
 *
 *      side effects go through `subs.fun_32ba` / `subs.fun_33f4`.
 *
 *
 * `packages/cli/src/test-render-string-chain-3662-parity.ts`, where
 * FUN_32BA and FUN_33F4 are both patched to stub probes (one record per
 * call: `alphaPtr`).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants (M68k absolute) ───────────────────────────────────

const VAL_F00_OFF = 0x1f00 as const;
const TICK_OFF = 0x1f3a as const;
const ROTATION_OFF = 0x1f42 as const;
const ALPHA_BASE = 0xa03000 as const;

const ROM_LOOKUP_LIMIT = 0x7294 as const;
const ROM_STRIDE_TABLE = 0x72a0 as const;
const ROM_SHIFT_TABLE = 0x72a4 as const;
const ROM_GLYPH_INDEX_TABLE = 0x72ac as const;

/** Immediate constant pushed as arg2 for FUN_32BA/FUN_33F4. */
export const RENDER_CHAR_ARG2 = 0x3c as const;

export const FUN_32BA_ADDR = 0x000032ba as const;
export const FUN_33F4_ADDR = 0x000033f4 as const;

/** Inclusive lower threshold for the "narrow" glyph-index range. */
export const NARROW_GLYPH_LO_INCL = 0x26 as const;
/** Inclusive upper threshold for the "narrow" glyph-index range. */
export const NARROW_GLYPH_HI_INCL = 0x2e as const;

// ─── Memory helpers ──────────────────────────────────────────────────────

/**
 * alpha RAM + color RAM). Kept consistent with `string-render.ts` and
 * `state-sub-2da0.ts`.
 */
function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a < 0x80000) return rom.program[a] ?? 0;
  if (a >= 0x400000 && a < 0x402000) return state.workRam[a - 0x400000] ?? 0;
  if (a >= 0xa02000 && a < 0xa03000) return state.spriteRam[a - 0xa02000] ?? 0;
  if (a >= 0xa03000 && a < 0xa04000) return state.alphaRam[a - 0xa03000] ?? 0;
  if (a >= 0xb00000 && a < 0xb00800) return state.colorRam[a - 0xb00000] ?? 0;
  return 0;
}

function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  return (
    ((readByteAbs(state, rom, addr) << 24) |
      (readByteAbs(state, rom, (addr + 1) >>> 0) << 16) |
      (readByteAbs(state, rom, (addr + 2) >>> 0) << 8) |
      readByteAbs(state, rom, (addr + 3) >>> 0)) >>>
    0
  );
}

function readU16WorkRam(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}

/** Word signed @ workRam offset. */
function readU16WorkRamSigned(state: GameState, off: number): number {
  const w = readU16WorkRam(state, off);
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Signed long from ROM (for signed cmp). */
function readRomLongSigned(rom: RomImage, romAddr: number): number {
  const a = romAddr >>> 0;
  const b0 = rom.program[a] ?? 0;
  const b1 = rom.program[(a + 1) >>> 0] ?? 0;
  const b2 = rom.program[(a + 2) >>> 0] ?? 0;
  const b3 = rom.program[(a + 3) >>> 0] ?? 0;
  const u = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
  // Convert to signed 32-bit
  return u | 0;
}

/** Signed word from ROM. */
function readRomWordSigned(rom: RomImage, romAddr: number): number {
  const w = ((rom.program[romAddr] ?? 0) << 8) | (rom.program[romAddr + 1] ?? 0);
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Sign-extend a byte to a signed 32-bit JS number. */
function sextByte(b: number): number {
  return b & 0x80 ? (b & 0xff) - 0x100 : b & 0xff;
}

// ─── JSR stub injection ──────────────────────────────────────────────────

/**
 * The parity probe only needs `alphaPtr`, the single variable argument.
 */
export interface RenderCharCall {
  /** D3 at call time: absolute pointer into the alpha tilemap. */
  alphaPtr: number;
  arg2: number;
  arg3: number;
  charByte: number;
  rotation: number;
}

/**
 * Stub injection for the two external jsr calls (FUN_32BA and FUN_33F4).
 */
export interface RenderStringChain3662Subs {
  fun_32ba?: (call: RenderCharCall) => void;
  fun_33f4?: (call: RenderCharCall) => void;
}

// ─── Main function: replica FUN_3662 ─────────────────────────────────────

/**
 *
 *                    `subs.fun_32ba`/`subs.fun_33f4`).
 * @param rom         RomImage (for ROM tables 0x7294/0x72A0/0x72A4/0x72AC and
 *                    for dereferencing structs/strings in ROM regions).
 *                    file header). Kept in the signature for ABI compatibility.
 * @param subs        Stub injection for the two external jsr calls. Default no-op.
 *
 *
 *
 *   - `chainSafety = 1024`: walks at most 1024 entries to guard malformed
 *     circular chains.
 */
export function renderStringChain3662(
  state: GameState,
  rom: RomImage,
  structAddr: number,
  _attrWord: number,
  subs: RenderStringChain3662Subs = {},
): number {
  let a2 = structAddr >>> 0;
  let chainSafety = 1024;

  // Walk the linked-list entries; the marker check advances the chain.
  while (chainSafety-- > 0) {
    // ── tickOff check vs lookup table ─────────────────────────────────
    // 0x3674..0x3690
    const tickOffByte = readByteAbs(state, rom, (a2 + 1) >>> 0);
    const tickOffSigned = sextByte(tickOffByte); // ext.w D1w
    const tickWordSigned = readU16WorkRamSigned(state, TICK_OFF);
    // sub.w in word arithmetic: result wraps mod 0x10000
    const d1Word = (tickOffSigned - tickWordSigned) & 0xffff;
    const d1Signed = d1Word & 0x8000 ? d1Word - 0x10000 : d1Word;

    // rotation @ 0x401F42, sext to long
    const rotationWord = readU16WorkRam(state, ROTATION_OFF);
    const rotationSigned =
      rotationWord & 0x8000 ? rotationWord - 0x10000 : rotationWord;

    // lookup[rot*2] (signed word from ROM)
    const lookup = readRomWordSigned(
      rom,
      (ROM_LOOKUP_LIMIT + rotationSigned * 2) >>> 0,
    );

    // bgt: branch if D1w > lookup (signed-word), skipping this entry.
    if (d1Signed > lookup) {
      // Straight to the marker check (exit_path @ 0x375c)
    } else {
      // ── compute D2 (rotation branch) ──────────────────────────────────
      // 0x3694..0x36b0
      let d2: number;
      if (rotationWord !== 0) {
        // D2 = 0x29 - sext_l(D1w)  (signed long sub)
        d2 = (0x29 - d1Signed) | 0;
      } else {
        // D2 = sext_l(D1w) << 6. Arithmetic and logical left shifts match here.
        d2 = (d1Signed << 6) | 0;
      }

      // ── compute D3 = ALPHA_BASE + 2 * (col << shift + d2) ─────────────
      // 0x36b2..0x36ce
      const colByte = readByteAbs(state, rom, a2);
      const colSigned = sextByte(colByte); // ext.l after move.b → sext

      // shift count: byte @ 0x72a5 + rotation*2
      const shiftCount =
        (rom.program[(ROM_SHIFT_TABLE + 1 + rotationSigned * 2) >>> 0] ?? 0) &
        0x3f; // m68k count mod 64

      let d0Long: number;
      if (shiftCount >= 32) {
        d0Long = 0;
      } else {
        // asl.l: equivalent to a logical left shift on the signed value here.
        d0Long = (colSigned << shiftCount) | 0;
      }
      d0Long = (d0Long + d2) | 0;
      d0Long = (d0Long * 2) | 0;

      let d3 = (ALPHA_BASE + d0Long) >>> 0;

      // ── per-char dispatch loop ────────────────────────────────────────
      // 0x36d0..0x375A
      const stringPtr = readLongAbs(state, rom, (a2 + 2) >>> 0);
      let a4 = stringPtr >>> 0;

      let charSafety = 0x10000; // 65536 max bytes per string
      while (charSafety-- > 0) {
        // 0x36d0: move.b (A4)+, D2b
        const charByte = readByteAbs(state, rom, a4);
        a4 = (a4 + 1) >>> 0;
        // 0x36d2: beq.w 0x375c — terminator
        if (charByte === 0) break;

        // 0x36d6: tst.w (A3); beq → call FUN_32BA (rot==0)
        const callArgs: RenderCharCall = {
          alphaPtr: d3,
          arg2: RENDER_CHAR_ARG2,
          arg3: 0,
          charByte,
          rotation: rotationWord,
        };
        if (rotationWord === 0) {
          // 0x36ee..0x36fc: jsr FUN_32BA(D3, 0x3c, 0)
          subs.fun_32ba?.(callArgs);
        } else {
          // 0x36da..0x36e8: jsr FUN_33F4(D3, 0x3c, 0)
          subs.fun_33f4?.(callArgs);
        }

        // ── stride dispatch (narrow vs wide via 0x72ac glyph table) ────
        // 0x3700..0x3758
        const glyphIdx = readRomLongSigned(
          rom,
          (ROM_GLYPH_INDEX_TABLE + (charByte & 0xff) * 4) >>> 0,
        );
        const isNarrow =
          glyphIdx >= NARROW_GLYPH_LO_INCL && glyphIdx <= NARROW_GLYPH_HI_INCL;

        // stride[rotation*2] (signed word from ROM)
        const stride = readRomWordSigned(
          rom,
          (ROM_STRIDE_TABLE + rotationSigned * 2) >>> 0,
        );

        if (isNarrow) {
          // narrow: D3 += stride * 2
          d3 = (d3 + stride * 2) >>> 0;
        } else {
          // wide:   D3 += stride * 4
          d3 = (d3 + stride * 4) >>> 0;
        }
      }
    }

    // ── chain advance check @ 0x375c ─────────────────────────────────────
    const markerByte = readByteAbs(state, rom, (a2 + 6) >>> 0);
    const markerSigned = sextByte(markerByte);
    const valF00Signed = readU16WorkRamSigned(state, VAL_F00_OFF);
    const sum = (markerSigned + valF00Signed) | 0;

    // bge.b 0x377c: cmp.l D0,D1 with D1=1 -> flags = 1 - sum
    // bge: branch if N=0 (signed result >= 0) → 1 >= sum → sum <= 1 → exit
    if (sum <= 1) return 1;

    // Advance to next entry
    a2 = readLongAbs(state, rom, (a2 + 8) >>> 0);
  }

  return 1;
}
