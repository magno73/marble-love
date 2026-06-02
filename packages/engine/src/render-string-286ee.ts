/**
 * render-string-286ee.ts — replica `FUN_000286EE` (154 byte).
 *
 *
 * **Disasm 0x286EE..0x28786** (154 byte):
 *
 *   000286EE  movem.l  d2-d3/a2, -(a7)         ; save D2,D3,A2 (12 byte)
 *   000286F2  movea.l  $10(a7), a0               ; A0 = arg1 (slotAddr, absptr)
 *   000286F6  move.b   $17(a7), d2               ; D2.b = LSB arg2 (ordinal byte)
 *   000286FA  movea.l  #$400434, a2              ; A2 = string-chain entry struct
 *   00028700  move.w   (a0), d3                  ; D3.w = word @ slotAddr (score)
 *   00028702  moveq    #$63, d0                  ; D0 = 99
 *   00028704  cmp.w    d3, d0                    ; signed cmp: 99 vs D3
 *   00028706  bge.b    $2870a                    ; if 99 >= D3 → no clamp
 *   00028708  moveq    #$63, d3                  ; clamp D3 = 99
 *   0002870A  pea.l    $2.w                      ; push 2 (fillExtra #5)
 *   0002870E  pea.l    $1.w                      ; push 1 (width #4)
 *   00028712  pea.l    $64.w                     ; push 0x64='d' (fmtMode #3)
 *   00028716  move.l   $2(a2), -(a7)             ; push *(0x400436) (bufEnd #2)
 *   0002871A  move.w   d3, d0
 *   0002871C  ext.l    d0                        ; D0 = sext(score)
 *   0002871E  move.l   d0, -(a7)                 ; push D0 (value #1)
 *   00028720  jsr      $112.l                    ; → FUN_3874 (number formatter)
 *   00028726  cmpi.b   #$2, d2                   ; ordinal == 2?
 *   0002872A  lea.l    $14(a7), a7               ; pop 20 byte (5 long)
 *   0002872E  bne.b    $28736
 *   00028730  move.w   #$2c00, d3                ; attr = 0x2C00 (ordinal 2)
 *   00028734  bra.b    $28746
 *   00028736  cmpi.b   #$3, d2                   ; ordinal == 3?
 *   0002873A  bne.b    $28742
 *   0002873C  move.w   #$3400, d3                ; attr = 0x3400 (ordinal 3)
 *   00028740  bra.b    $28746
 *   00028742  move.w   #$2800, d3                ; attr = 0x2800 (default)
 *   00028746  cmpi.b   #$3, d2                   ; ordinal == 3?
 *   0002874A  beq.b    $28750
 *   0002874C  moveq    #$1, d0                   ; tickOff = 1 (ordinal != 3)
 *   0002874E  bra.b    $28752
 *   00028750  moveq    #$0, d0                   ; tickOff = 0 (ordinal == 3)
 *   00028752  move.l   d0, -(a7)                 ; push tickOff long
 *   00028754  move.b   d2, d0                    ; D0.b = ordinal
 *   00028756  ext.w    d0                        ; sext byte → word
 *   00028758  movea.l  #$23d3c, a0               ; A0 = ROM column table
 *   0002875E  move.b   (a0, d0.w), d0            ; D0.b = table[ordinal]
 *   00028762  ext.w    d0                        ; sext byte → word
 *   00028764  ext.l    d0                        ; sext word → long
 *   00028766  move.l   d0, -(a7)                 ; push column long
 *   00028768  pea.l    (a2)                      ; push 0x400434
 *   0002876A  jsr      $13c.l                    ; → FUN_255A (struct init)
 *   00028770  move.w   d3, d0                    ; D0 = attr
 *   00028772  ext.l    d0                        ; sext attr word → long
 *   00028774  move.l   d0, -(a7)                 ; push attr long
 *   00028776  pea.l    (a2)                      ; push 0x400434
 *   00028778  jsr      $200.l                    ; → FUN_3520 (renderStringChain2)
 *   0002877E  lea.l    $14(a7), a7               ; pop 20 byte (5 long)
 *   00028782  movem.l  (a7)+, d2-d3/a2           ; restore
 *   00028786  rts
 *
 * **Stack layout** (post-movem, 12 saved regs + 4 ret addr = 16 = 0x10):
 *   - SP+0x10 : arg1 long (slotAddr, absolute M68k address in workRam)
 *   - SP+0x14 : arg2 long; LSB @ SP+0x17 → D2.b = ordinal byte
 *
 * **Step semantics**:
 *
 *         value=sext_l(score), bufEnd=*(0x400436), fmtMode='d'(0x64),
 *         width=1, fillExtra=2.
 *      *(0x400436) (= workRam[0x436..0x439] long-BE, dest ptr).
 *         ordinal == 2 → 0x2C00
 *         ordinal == 3 → 0x3400
 *         else         → 0x2800
 *         ordinal == 3 → 0
 *         else         → 1
 *         entryPtr=0x400434, attrLong=sext_l(attrWord).
 *
 * **ROM column table @ 0x23D3C** (8 byte, ordinal 0..7):
 *   ordinal 0 → column 0x13 (19)
 *   ordinal 1 → column 0x0D (13)
 *   ordinal 2 → column 0x19 (25)
 *   ordinal 3 → column 0x13 (19)
 *   ordinal 4 → column 0x30 (48)
 *   ordinal 5 → column 0x00 (0)
 *   ordinal 6 → column 0x2C (44)
 *   ordinal 7 → column 0x00 (0)
 *
 * **JSR sub injection**:
 *   - `FUN_255A` (struct init): replicated inline (3 byte writes, deterministic).
 *   - `FUN_3520` (renderStringChain2): stub-injectable. Default no-op.
 *
 * **Side effects in workRam** (struct @ 0x400434):
 *   1. `*(0x400436)` buffer written by `FUN_3874` with ASCII digits + null.
 *   2. `workRam[0x434] = column`        (byte from ROM table)
 *   3. `workRam[0x435] = tickOff`    (0 or 1 from ordinal)
 *   4. `workRam[0x43A] = 0`          (marker clear)
 *   5. call `subs.renderStringChain2(0x400434, sext_l(attrWord))`.
 *
 * **Callers in FUN_10504** (main-loop-init-10504.ts):
 *
 * `packages/cli/src/test-render-string-286ee-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants (M68k absolute) ───────────────────────────────────

export const ENTRY_ABS_ADDR = 0x00400434 as const;

/** Offset entry in `state.workRam` (= ENTRY_ABS_ADDR - 0x400000). */
export const ENTRY_OFF = 0x434 as const;

/** Offset workRam: column byte (entry[0]). */
export const COL_BYTE_OFF = 0 as const;
/** Offset workRam: tickOff byte (entry[1]). */
export const TICKOFF_BYTE_OFF = 1 as const;
export const BUFEND_PTR_LONG_OFF = 2 as const;
/** Offset workRam: marker byte (entry[6]). */
export const MARKER_BYTE_OFF = 6 as const;

export const COL_TABLE_ROM_ADDR = 0x00023d3c as const;

export const SCORE_MAX = 0x63 as const;

/** Hardcoded byte 'd' = 0x64 passed as fmtMode to FUN_3874 (decimal). */
export const FMT_MODE_D = 0x64 as const;

/** Width (1) passed to FUN_3874. */
export const FMT_WIDTH = 1 as const;

/** FillExtra (2) passed to FUN_3874. */
export const FMT_FILL_EXTRA = 2 as const;

/** Attr word for ordinal == 2. */
export const ATTR_ORDINAL_2 = 0x2c00 as const;
/** Attr word for ordinal == 3. */
export const ATTR_ORDINAL_3 = 0x3400 as const;
/** Attr word default (ordinal != 2 and != 3). */
export const ATTR_DEFAULT = 0x2800 as const;

export const RENDER_STRING_286EE_ADDR = 0x000286ee as const;

export const RENDER_STRING_286EE_SUB_ADDRS = [
  0x00003874, // FUN_3874 (via trampoline 0x112) — number formatter
  0x0000255a, // FUN_255A (via trampoline 0x13C) — struct init (inline)
  0x00003520, // FUN_3520 (via trampoline 0x200) — renderStringChain2
] as const;

// ─── Memory helpers ──────────────────────────────────────────────────────

/** Absolute workRam base. */
const WORK_RAM_BASE = 0x00400000 as const;

function readRomByte(rom: RomImage, addr: number): number {
  return rom.program[addr >>> 0] ?? 0;
}

function readWorkLongBE(wram: Uint8Array, off: number): number {
  const b0 = wram[off] ?? 0;
  const b1 = wram[off + 1] ?? 0;
  const b2 = wram[off + 2] ?? 0;
  const b3 = wram[off + 3] ?? 0;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

function readWorkWordBE(state: GameState, absAddr: number): number {
  const off = absAddr - WORK_RAM_BASE;
  const hi = state.workRam[off] ?? 0;
  const lo = state.workRam[off + 1] ?? 0;
  return ((hi << 8) | lo) & 0xffff;
}

/** Sign-extend byte (8 bit) → signed JS number. */
function sextByte(b: number): number {
  const v = b & 0xff;
  return v & 0x80 ? v - 0x100 : v;
}

/** Sign-extend word (16 bit) → unsigned 32-bit representation (JS number). */
function sextWordToLong(w: number): number {
  const v = w & 0xffff;
  return (v & 0x8000) !== 0 ? (v | 0xffff0000) >>> 0 : v >>> 0;
}

// ─── Sub injection ────────────────────────────────────────────────────────

/**
 * Stub injection for the two external JSRs.
 *
 * (injectable). `FUN_3874` and `FUN_3520` are external sub-calls.
 */
export interface RenderString286EESubs {
  /**
   * `FUN_3874` (via trampoline 0x112) — number formatter.
   *
   * `bufEnd` (the long @ workRam[0x436]), with `fmtMode='d'`, `width=1`,
   * `fillExtra=2`.
   *
   *   - `bufEnd`     : `*(0x400436)` long-BE — pointer to the destination buffer.
   *   - `fmtMode`    : 0x64 long ('d', decimal). Hardcoded.
   *   - `width`      : 1 long. Hardcoded.
   *   - `fillExtra`  : 2 long. Hardcoded.
   *
   * Default: no-op.
   */
  numberFormatter?: (
    state: GameState,
    value: number,
    bufEnd: number,
    fmtMode: number,
    width: number,
    fillExtra: number,
  ) => void;

  /**
   * `FUN_3520` (via trampoline 0x200) — renderStringChain2.
   *
   *
   *   - `entryPtr` : 0x400434 (constant).
   *   - `attrLong` : sext_l(attrWord) — attr word sign-extended.
   *
   * Default: no-op.
   */
  renderStringChain2?: (entryPtr: number, attrLong: number) => void;
}

// ─── Main function ────────────────────────────────────────────────────────

/**
 *
 * Invokes renderStringChain2 through a stub.
 *
 * @param state     GameState (mutated in place: workRam[0x434..0x43A]).
 * @param rom       RomImage (for the column-lookup table @ 0x23D3C).
 *                  "score" word of the object struct (typically
 *                  `objectSlotAddr(i) + 0x6a` = `0x400018 + i*0xE2 + 0x6a`).
 * @param ordinal   arg2 long: player ordinal (typically `playerCount + i - 1`);
 * @param subs      Stub injection for `numberFormatter` and `renderStringChain2`.
 *                  Default: both no-op.
 *
 * **Side effects in `state.workRam`** (struct @ offset 0x434):
 *   1. `*(bufEndPtr)..*(bufEndPtr+N)` ← ASCII digits + null (via numberFormatter).
 *      `bufEndPtr = readLongBE(workRam, 0x436)`.
 *   2. `workRam[0x434]` ← column byte (ROM table @ 0x23D3C indexed by ordinal LSB).
 *   4. `workRam[0x43A]` ← 0 (marker clear).
 *   5. invocation `subs.renderStringChain2(0x400434, sext_l(attrWord))`.
 */
export function renderString286EE(
  state: GameState,
  rom: RomImage,
  slotAddr: number,
  ordinal: number,
  subs?: RenderString286EESubs,
): void {
  const r = state.workRam;

  // move.w (A0), D3 — A0 = slotAddr
  const rawScore = readWorkWordBE(state, slotAddr >>> 0);

  // Clamp a 99 (0x63): `moveq #0x63, D0; cmp.w D3, D0; bge <no-clamp>; moveq #0x63, D3`
  // M68k `cmp.w D3, D0` → sets flags for D0 - D3 (word arithmetic).
  // `bge` branches if result (D0 - D3) is >= 0 (signed), i.e. D0 >= D3 → 99 >= D3.
  // Comparison is signed-word: sign-extend both from 16 to 32 bit.
  const rawSigned = rawScore & 0x8000 ? rawScore - 0x10000 : rawScore;
  // If 99 (signed) >= rawSigned → no clamp (bge taken); otherwise clamp D3 = 99.
  const scoreWord = rawSigned > SCORE_MAX ? SCORE_MAX : rawScore;
  // scoreWord is the M68k D3.w value after clamp (0..0xFFFF).

  // Step 2: FUN_3874 (number formatter).
  // Args: (value=sext_l(D3.w), bufEnd=*(0x400436), fmtMode=0x64, width=1, fillExtra=2)
  // Binary: move.w D3, D0; ext.l D0; move.l D0, -(SP)
  const bufEnd = readWorkLongBE(r, ENTRY_OFF + BUFEND_PTR_LONG_OFF) >>> 0;
  // sext_l of the (possibly clamped) word value.
  const valueLong = sextWordToLong(scoreWord);

  subs?.numberFormatter?.(
    state,
    valueLong,
    bufEnd,
    FMT_MODE_D,
    FMT_WIDTH,
    FMT_FILL_EXTRA,
  );

  // Step 3: select attrWord from ordinal byte (D2.b).
  // cmpi.b #2, D2; bne; move.w #0x2C00, D3
  // cmpi.b #3, D2; bne; move.w #0x3400, D3
  // else move.w #0x2800, D3
  const ordinalByte = ordinal & 0xff;
  let attrWord: number;
  if (ordinalByte === 2) {
    attrWord = ATTR_ORDINAL_2;
  } else if (ordinalByte === 3) {
    attrWord = ATTR_ORDINAL_3;
  } else {
    attrWord = ATTR_DEFAULT;
  }

  // Step 4: select tickOff from ordinal.
  // cmpi.b #3, D2; beq; moveq #1, D0; bra; moveq #0, D0
  const tickOff = ordinalByte === 3 ? 0 : 1;

  // Step 5: read column from ROM column table @ 0x23D3C + ordinal.
  // move.b D2, D0; ext.w D0; movea.l #0x23D3C, A0
  // move.b (A0, D0.w), D0 — D0.w is sext of ordinalByte
  // The m68k `(A0, D0.w)` uses D0.w sign-extended to compute offset.
  // sext of D2.b (= ordinalByte): if ordinalByte < 128 → positive index.
  const ordinalSext = sextByte(ordinalByte); // ext.w D0 (from byte) then ext.l
  // Then move.b (A0, D0.w): uses the sign-extended WORD as displacement.
  // For ordinal 0..7 (typical), ordinalSext = ordinal (positive).
  const colByte = readRomByte(rom, (COL_TABLE_ROM_ADDR + ordinalSext) >>> 0);
  // ext.w D0; ext.l D0: sext the column byte to long
  const colLong = sextByte(colByte); // sext byte → signed number
  // The binary pushes D0 (long), FUN_255A reads (0xB,SP).b = low byte = colByte & 0xff

  // Step 6: FUN_255A inline — struct init (3 byte writes).
  // Push order in FUN_286EE for FUN_255A (after SP-12 for 3 longs):
  //   move.l tickOff_long, -(SP)  → SP+0 = tickOff long
  //   move.l col_long, -(SP)      → no — actually read disasm again:
  //
  // 00028752: move.l D0, -(SP)   (D0 = tickOff long at this point)
  // 00028766: move.l D0, -(SP)   (D0 = column long after sext)
  // 00028768: pea.l (A2)         (A2 = 0x400434)
  // 0002876A: jsr 0x13C
  //
  // Stack inside FUN_255A (SP = just pushed ret addr):
  //   SP+0:  return addr (4)
  //   SP+4:  entryPtr = 0x400434
  //   SP+8:  col_long       → SP+0xB = LSB of col_long = colByte & 0xff (D1.b)
  //   SP+12: tickOff_long   → SP+0xF = LSB of tickOff_long = tickOff & 0xff (D0.b)
  //
  // FUN_255A: entry[0] = D1.b = col_long & 0xff
  //           entry[1] = D0.b = tickOff_long & 0xff
  //           entry[6] = 0

  r[ENTRY_OFF + COL_BYTE_OFF] = colLong & 0xff;
  r[ENTRY_OFF + TICKOFF_BYTE_OFF] = tickOff & 0xff;
  r[ENTRY_OFF + MARKER_BYTE_OFF] = 0;

  // Step 7: FUN_3520 (renderStringChain2) — stub injection.
  // Args: (entryPtr=0x400434, attrLong=sext_l(attrWord))
  // move.w D3, D0; ext.l D0 → D0 = sext_l(attrWord)
  const attrLong = sextWordToLong(attrWord);
  subs?.renderStringChain2?.(ENTRY_ABS_ADDR, attrLong);
}

/** Re-export of the symbol as "FUN_000286EE" for cross-reference. */
export { renderString286EE as FUN_000286EE };
