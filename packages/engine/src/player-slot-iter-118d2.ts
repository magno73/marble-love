/**
 * player-slot-iter-118d2.ts — observable replica of `FUN_000118D2`.
 *
 * `FUN_118D2` is the "player slot iteration + sound + level dispatcher entry"
 * function called from `FUN_1101E` (mainLoopInit1101E) as `helper118D2`.
 *
 * Observable side effects (all bit-perfect):
 *
 * 1. **Color RAM init (first half)**:
 *    - Clear words @ B00000, B00008, B0003A, B00010, B00018 (5 words → 0).
 *    - Write fixed values: B00012 ← 0xAFFF, B0001A ← 0xAFFF,
 *                          B00016 ← 0xF00F, B0001E ← 0xAF00.
 *
 * 2. **First player slot loop** (A2 = 0x400018, stride 0xE2, count = *0x400396):
 *    For slots where state byte @ (0x18, A2) == 3:
 *      - Clear byte @ (0xD8, A2).
 *      - Set byte @ (0x71, A2) = 0xFF.
 *      - Clear byte @ (0x70, A2).
 *      - Inject `fun_0142` with tileBase (0x2400 if slotIdx>0, else 0x2000)
 *        and textPtr (0x22B9A if slotIdx>0, else 0x22B82).
 *      - Compute `clamped = min(slot[0x6A].word, 99)` (score cap).
 *      - Inject `fun_28e3c` with (clamped*100, 0, ROM[0x1d36e+slotIdx], 4, 5,
 *        tileBase).
 *
 * 3. **Vblank wait**: inject `fun_28db8` with frames = 0x28 (= 40).
 *
 * 4. **Sound command**: read *0x400394 (word), index table @ 0x1EF92 with
 *    (value - 1) * 4, extract the long as soundCmd; inject `fun_158ac`.
 *
 * 5. **Level dispatcher**: if *0x400394 (signed) <= 6, inject `fun_16ec6`.
 *
 * 6. **Second player slot loop** (same iteration):
 *    For slots where state byte @ (0x18, A2) == 3:
 *      - Set byte @ (0x70, A2) = 0xFF.
 *      - Inject `fun_28608` with (absSlotPtr, localVar[slotIdx]) — i.e.
 *        addToObjectAccumAndFlag(slotPtr, clamped*100).
 *
 * 7. **Color RAM finalize**:
 *    - Set: B00000 ← 0xAFFF, B00008 ← 0xAFFF, B0003A ← 0xAFFF,
 *           B00006 ← 0xF00F,  B0000E ← 0xAF00,
 *           B00010 ← 0xAFFF,  B00018 ← 0xAFFF.
 *    - Clear: B00012 ← 0, B0001A ← 0.
 *
 * **Disasm range**: 0x118D2..0x11AC0 (≈498 bytes).
 * **Single caller**: `FUN_1101E` @ 0x11380 (case 3 body, via helper118D2).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants ────────────────────────────────────────────────────

export const PLAYER_SLOT_ITER_118D2_ADDR = 0x000118d2 as const;

/** Color RAM base address. */
const COLOR_RAM_BASE = 0xb00000 as const;

/** Work RAM base address. */
const WORK_RAM_BASE = 0x00400000 as const;

/** Player slot table start (absolute address). */
const SLOT_TABLE_BASE = 0x00400018 as const;

/** Per-slot stride in bytes. */
const SLOT_STRIDE = 0xe2 as const;

/** workRam offset for slot count (*0x400396). */
const SLOT_COUNT_OFF = 0x396 as const;

/** workRam offset for level/state index (*0x400394). */
const LEVEL_INDEX_OFF = 0x394 as const;

/** ROM address of the lookup table used for inner-loop score rendering. */
const SCORE_RENDER_TABLE = 0x0001d36e as const;

/** ROM address of the sound command pointer table (8 entries × 4 bytes). */
const SOUND_TABLE = 0x0001ef92 as const;

/** ROM address of text string for player 0 (tileBase=0x2000). */
const TEXT_PTR_P0 = 0x00022b82 as const;

/** ROM address of text string for player 1 (tileBase=0x2400). */
const TEXT_PTR_P1 = 0x00022b9a as const;

// Tile bases for the two players.
const TILE_BASE_P0 = 0x2000 as const;
const TILE_BASE_P1 = 0x2400 as const;

// ─── Sub injection ────────────────────────────────────────────────────────

/**
 * Bag of injectable JSR targets. All default to no-op so that parity tests
 * can patch them to RTS on the binary side and compare workRam / colorRam.
 */
export interface PlayerSlotIter118D2Subs {
  /**
   * `FUN_0142` (text render, jump-table entry 0 → FUN_2572).
   * Called twice per qualifying slot (once per player).
   *
   * @param textPtr  ROM address of the text string.
   * @param tileBase Tile base constant (0x2000 or 0x2400).
   */
  fun_0142?: (state: GameState, textPtr: number, tileBase: number) => void;

  /**
   * `FUN_28E3C` (formatAndRender variant — 6 long args).
   *
   * @param arg1  Clamped score × 100 (long).
   * @param arg2  0 (long, constant).
   * @param arg3  ROM lookup byte sign-extended to long.
   * @param arg4  4 (column, long).
   * @param arg5  5 (maxLen/width, long).
   * @param arg6  tileBase (0x2000 or 0x2400, long).
   */
  fun_28e3c?: (
    state: GameState,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
  ) => void;

  /**
   * `FUN_28DB8` (vblank wait).
   * @param frames Number of vblank frames to wait (0x28 = 40).
   */
  fun_28db8?: (state: GameState, frames: number) => void;

  /**
   * `FUN_158AC` (sound command send).
   * @param cmd Sound command byte (from ROM table @ 0x1EF92).
   * @returns 0 = not sent, 1 = sent.
   */
  fun_158ac?: (state: GameState, cmd: number) => number;

  /**
   * `FUN_16EC6` (level dispatcher). Called when *0x400394 (signed word) <= 6.
   */
  fun_16ec6?: (state: GameState) => void;

  /**
   * `FUN_28608` (addToObjectAccumAndFlag).
   * Called in the second slot loop for qualifying slots.
   *
   * @param slotPtr  Absolute address of the slot (0x400018 + idx*0xE2).
   * @param value    Clamped score × 100 (same value stored in local array).
   */
  fun_28608?: (state: GameState, slotPtr: number, value: number) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Read unsigned word (big-endian) from workRam. */
function rwOff(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

/** Read unsigned byte from workRam. */
function rbOff(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

/** Write byte to workRam. */
function wbOff(state: GameState, off: number, value: number): void {
  state.workRam[off] = value & 0xff;
}

/** Write word to colorRam (offset relative to 0xB00000). */
function colorRamWrite(state: GameState, colorOff: number, value: number): void {
  const v = value & 0xffff;
  state.colorRam[colorOff] = (v >>> 8) & 0xff;
  state.colorRam[colorOff + 1] = v & 0xff;
}

/** Read unsigned byte from ROM. */
function romByte(rom: RomImage, addr: number): number {
  return (rom.program[addr] ?? 0) & 0xff;
}

/** Read unsigned long (big-endian) from ROM. */
function romLong(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>>
    0
  );
}

/**
 * Sign-extend a 16-bit word to a signed JS number.
 * Replicates M68k `ext.w` then `ext.l` semantics on a word-sized operand.
 */
function sextWord(w: number): number {
  const v = w & 0xffff;
  return v & 0x8000 ? (v | 0xffff0000) >> 0 : v;
}

// ─── Main function ────────────────────────────────────────────────────────

/**
 * Replica of `FUN_000118D2` — player slot iteration, sound dispatch, level
 * dispatcher entry.
 *
 * @param state  GameState (mutated in-place: workRam, colorRam).
 * @param rom    RomImage (for ROM score/sound tables).
 * @param subs   Injectable JSR targets. All default to no-op.
 */
export function playerSlotIter118D2(
  state: GameState,
  rom: RomImage,
  subs: PlayerSlotIter118D2Subs = {},
): void {
  // ── 1. Color RAM init (first half) ──────────────────────────────────────
  // clr.w $b00000.l  (colorRam offset 0x00)
  colorRamWrite(state, 0x00, 0x0000);
  // clr.w $b00008.l  (colorRam offset 0x08)
  colorRamWrite(state, 0x08, 0x0000);
  // clr.w $b0003a.l  (colorRam offset 0x3a)
  colorRamWrite(state, 0x3a, 0x0000);
  // clr.w $b00010.l  (colorRam offset 0x10)
  colorRamWrite(state, 0x10, 0x0000);
  // clr.w $b00018.l  (colorRam offset 0x18)
  colorRamWrite(state, 0x18, 0x0000);
  // move.w #0xafff, $b00012.l
  colorRamWrite(state, 0x12, 0xafff);
  // move.w #0xafff, $b0001a.l
  colorRamWrite(state, 0x1a, 0xafff);
  // move.w #0xf00f, $b00016.l
  colorRamWrite(state, 0x16, 0xf00f);
  // move.w #0xaf00, $b0001e.l
  colorRamWrite(state, 0x1e, 0xaf00);

  // ── 2. First player slot loop ────────────────────────────────────────────
  // A2 = 0x400018 (absolute), stride 0xE2.
  // Counter D2 goes from 0 until D2 == *0x400396 (word).
  // The `link.w a6, #$fff8` allocates 8 bytes of local frame space used as
  // an array of 2 × long (one entry per slot index, 0..1). We model it as a
  // local JS array indexed by slotIdx.
  const localAccum: [number, number] = [0, 0];

  // *0x400396 word — slot count.
  const slotCountWord = rwOff(state, SLOT_COUNT_OFF);

  // Loop: D2.byte from 0; exit when sextByte(D2) == slotCountWord.
  // M68k: `move.b D2,D0; ext.w D0; cmp.w MEM,D0; bne loop`.
  // sextByte: treat D2.byte as signed int8 extended to int16.
  for (let d2 = 0; (d2 & 0x80 ? (d2 - 256) : d2) !== (slotCountWord & 0xffff); d2 = (d2 + 1) & 0xff) {
    const slotBase = SLOT_TABLE_BASE - WORK_RAM_BASE + d2 * SLOT_STRIDE; // workRam offset

    // cmpi.b #3, (0x18, a2) — state byte for this slot
    const slotState = rbOff(state, slotBase + 0x18);
    if (slotState !== 3) continue;

    // ── Slot state==3 mutations ──────────────────────────────────────────
    // clr.b (0xd8, a2)
    wbOff(state, slotBase + 0xd8, 0x00);
    // move.b #0xff, (0x71, a2)
    wbOff(state, slotBase + 0x71, 0xff);
    // clr.b (0x70, a2)
    wbOff(state, slotBase + 0x70, 0x00);

    // ── Text render (jsr 0x142) ──────────────────────────────────────────
    // tst.b d2 → if d2 != 0: player 1 path, else player 0 path
    const tileBase = d2 !== 0 ? TILE_BASE_P1 : TILE_BASE_P0;
    const textPtr = d2 !== 0 ? TEXT_PTR_P1 : TEXT_PTR_P0;
    subs.fun_0142?.(state, textPtr, tileBase);

    // ── Score computation ────────────────────────────────────────────────
    // move.w (0x6a, a2), d3  — slot[0x6A] word (score field)
    // moveq #0x63, d0         — d0 = 99
    // cmp.w d3, d0            — compare 99 vs d3 (cmp.w src, dst: dst-src,
    //                           sets flags on d0-d3); bge means d0 >= d3
    // bge.b skip_clamp        — if 99 >= d3, no clamp needed
    // moveq #0x63, d3         — clamp: d3 = 99
    const scoreWord = rwOff(state, slotBase + 0x6a);
    // Note: bge uses signed comparison: d0 = 99, d3 = score.
    // Instruction: `cmp.w d3, d0` sets flags for d0-d3.
    // `bge` means N==V (d0-d3 >= 0), i.e. d0 >= d3 (signed).
    // Since d0=99 is always positive and word comparisons are signed 16-bit:
    const scoreSigned = sextWord(scoreWord);
    const clamped = scoreSigned > 99 ? 99 : scoreSigned;
    // muls.w #0x64, d0 — d0 = clamped * 100 (signed × word)
    // The product is a long; we replicated the M68k muls.w semantics:
    //   muls.w #100, d0: d0 (long) = sign_extend(d0.word) * sign_extend(#100)
    // clamped is in range -32768..99 but only values 0..99 are reached here.
    const accumVal = (clamped * 100) >> 0; // signed 32-bit long
    // Store in local frame (indexed by d2): move.l d0, (a0, d1.l)
    localAccum[d2 & 1] = accumVal;

    // ── Format/render (jsr 0x28e3c) ─────────────────────────────────────
    // ROM lookup: move.b (SCORE_RENDER_TABLE + d2), d0
    //   ext.w d0   → sign-extend byte to word
    //   ext.l d0   → sign-extend word to long
    // Equivalent to: treat raw byte as signed int8 → sign-extend to int32.
    const rawByte = romByte(rom, SCORE_RENDER_TABLE + d2);
    const arg3Long = rawByte & 0x80 ? (rawByte | 0xffffff00) >> 0 : rawByte;

    subs.fun_28e3c?.(state, accumVal >>> 0, 0, arg3Long, 4, 5, tileBase);
  }

  // ── 3. Vblank wait ──────────────────────────────────────────────────────
  // pea.l $28.w; jsr $28db8.l; (no cleanup needed — addq #4, a7 pops pea)
  subs.fun_28db8?.(state, 0x28);

  // ── 4. Sound command ────────────────────────────────────────────────────
  // move.w $400394.l, d0   → d0.word = *0x400394
  // ext.l d0               → sign-extend to long
  // subq.l #1, d0          → d0 = levelIndex - 1
  // asl.l #2, d0           → d0 = (levelIndex - 1) * 4
  // movea.l #0x1ef92, a0
  // movea.l (a0, d0.l), a0 → a0 = ROM[(levelIndex-1)*4 + 0x1ef92] (pointer value)
  // pea.l (a0)             → push pointer as long arg
  // jsr $158ac.l           → FUN_158AC(a0)
  const levelWord = rwOff(state, LEVEL_INDEX_OFF);
  const levelSigned = sextWord(levelWord); // ext.l of word
  const soundIdx = (levelSigned - 1) * 4;
  // soundIdx can be negative if levelWord is 0, but the code doesn't guard —
  // if soundIdx < 0, the ROM access would be out-of-range. We reproduce the
  // lookup faithfully (defaulting to 0 for OOB).
  const soundPtr = soundIdx >= 0 ? romLong(rom, SOUND_TABLE + soundIdx) : 0;
  subs.fun_158ac?.(state, soundPtr);

  // ── 5. Level dispatcher ─────────────────────────────────────────────────
  // moveq #6, d0; cmp.w $400394.l, d0; ble.b skip — bLE is signed ≤
  // So: if d0 <= *0x400394 (signed): skip jsr 16EC6
  // i.e.: jsr 16EC6 only if *0x400394 (signed) < 6 → d0 (6) > levelSigned
  // Wait: `ble` = branch if less-or-equal. Condition: N != V or Z set.
  // `cmp.w $400394, d0` computes d0 - mem = 6 - levelSigned.
  // ble branches if 6 - levelSigned <= 0, i.e. levelSigned >= 6.
  // So the jsr 16EC6 is at 0x11A26, which is the NOT-taken branch.
  // From the disasm:
  //   0x11a1c: moveq #6, d0
  //   0x11a1e: cmp.w $400394.l, d0    ← d0 - mem (= 6 - levelSigned)
  //   0x11a24: ble.b $11a2c           ← branch if <= 0, i.e. levelSigned >= 6
  //   0x11a26: jsr $16ec6.l           ← reached only if levelSigned < 6
  if (levelSigned < 6) {
    subs.fun_16ec6?.(state);
  }

  // ── 6. Second player slot loop ───────────────────────────────────────────
  // Same iteration: A2 = 0x400018, stride 0xE2, counter until *0x400396.
  for (let d2 = 0; (d2 & 0x80 ? (d2 - 256) : d2) !== (slotCountWord & 0xffff); d2 = (d2 + 1) & 0xff) {
    const slotBase = SLOT_TABLE_BASE - WORK_RAM_BASE + d2 * SLOT_STRIDE;

    const slotState = rbOff(state, slotBase + 0x18);
    if (slotState !== 3) continue;

    // move.b #0xff, (0x70, a2)
    wbOff(state, slotBase + 0x70, 0xff);

    // Absolute slot pointer for jsr 0x28608
    const absSlotPtr = SLOT_TABLE_BASE + d2 * SLOT_STRIDE;
    const accumVal = localAccum[d2 & 1] ?? 0;
    subs.fun_28608?.(state, absSlotPtr, accumVal);
  }

  // ── 7. Color RAM finalize ────────────────────────────────────────────────
  // move.w #0xafff, $b00000.l
  colorRamWrite(state, 0x00, 0xafff);
  // move.w #0xafff, $b00008.l
  colorRamWrite(state, 0x08, 0xafff);
  // move.w #0xafff, $b0003a.l
  colorRamWrite(state, 0x3a, 0xafff);
  // move.w #0xf00f, $b00006.l
  colorRamWrite(state, 0x06, 0xf00f);
  // move.w #0xaf00, $b0000e.l
  colorRamWrite(state, 0x0e, 0xaf00);
  // move.w #0xafff, $b00010.l
  colorRamWrite(state, 0x10, 0xafff);
  // move.w #0xafff, $b00018.l
  colorRamWrite(state, 0x18, 0xafff);
  // clr.w $b00012.l
  colorRamWrite(state, 0x12, 0x0000);
  // clr.w $b0001a.l
  colorRamWrite(state, 0x1a, 0x0000);

  void COLOR_RAM_BASE; // suppress unused-const warning
}
