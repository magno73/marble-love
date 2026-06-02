/**
 * Bit-perfect port of `FUN_000283C2`, the HUD score-frame initializer.
 *
 * Runs two loops over alpha tilemap RAM at `0xA03000`.
 *
 *      For each `row`:
 *        - `addr = getAlphaTileAddr(with the=0, row=row)` (=`FUN_000037E4`)
 *            3 words at `addr+0..5`,
 *            3 words at `addr+0x4e..0x53` (= +39 word offset, right side)
 *
 *   2. **Loop2** (D2 byte = 0..D3-1, where D3 = 0x0C in 1-player or
 *      `setAlphaTile` (= `FUN_00003784`):
 *        - with the  = ROM word @ A2 (low byte) — A2 base 0x23C2C (1P) or 0x23CA4 (2P)
 *        - mask = constant 0x1C00
 *      The (with the, row) pattern draws a 5×4 rounded-cell rectangle.
 *
 * **Disasm 0x283C2..0x28467** (166 byte, 0xA6):
 *
 *   ; ── Loop1: clears alpha tilemap borders ────────────────────────────
 *   000283C2  movem.l {A3 A2 D4 D3 D2},-(SP)    ; save 20 bytes
 *   000283C6  clr.b   D2b                       ; D2 = 0 (loop counter byte)
 *   L1_BODY:
 *   000283C8  move.b  D2b,D0b                   ; D0 = sext_l(D2 byte)
 *   000283CA  ext.w   D0w
 *   000283CC  ext.l   D0
 *   000283CE  move.l  D0,-(SP)                  ; arg2 (row) = sext_l(D2)
 *   000283D0  clr.l   -(SP)                     ; arg1 (with the) = 0
 *   000283D2  jsr     0x000037E4.l              ; A2 = getAlphaTileAddr(0, D2)
 *                                                ;     = via jmp 0x224 (long
 *                                                ;       trampoline)
 *   000283D8  movea.l D0,A2                     ; A2 = returned alpha-RAM ptr
 *   000283DA  move.l  A2,D1
 *   000283DC  moveq   0x4E,D0
 *   000283DE  add.l   D0,D1
 *   000283E0  movea.l D1,A3                     ; A3 = A2 + 0x4E (byte offset)
 *   000283E2  move.w  #0x3400,(A2)+             ; *(A2 + 0) = 0x3400; A2 += 2
 *   000283E6  move.w  #0x3400,(A2)+             ; *(A2 + 2) = 0x3400; A2 += 2
 *   000283EA  move.w  #0x3400,(A2)+             ; *(A2 + 4) = 0x3400; A2 += 2
 *   000283EE  move.w  #0x3400,(A3)+             ; *(A2 + 0x4E) = 0x3400
 *   000283F2  move.w  #0x3400,(A3)+             ; *(A2 + 0x50) = 0x3400
 *   000283F6  move.w  #0x3400,(A3)+             ; *(A2 + 0x52) = 0x3400
 *   000283FA  addq.l  0x8,SP                    ; cleanup 2 long arg
 *   000283FC  addq.b  0x1,D2b                   ; D2++
 *   000283FE  cmpi.b  #0x1E,D2b                 ; 30?
 *   00028402  bne.b   L1_BODY                   ; loop up to D2 == 30
 *
 *   ; ── Loop2 setup: select 1P vs 2P via word @ 0x400396 ───────────────
 *   00028404  movea.l #0x23C44,A3               ; A3 = ROM "rows" table
 *   0002840A  move.l  #0x23C74,D4               ; D4 = ROM "data" table
 *   00028410  moveq   0x1,D0                    ; D0 = 1
 *   00028412  cmp.w   (0x00400396).l,D0w        ; 1-player?
 *   00028418  bne.b   IS_2P                     ; if not 1P → 2P branch
 *   0002841A  movea.l #0x23C2C,A2               ; A2 = ROM "cols" 1P table
 *   00028420  moveq   0x0C,D3                   ; D3 = 12 (count 1P)
 *   00028422  bra.b   L2_INIT
 *   IS_2P:
 *   00028424  movea.l #0x23CA4,A2               ; A2 = ROM "cols" 2P table
 *   0002842A  moveq   0x18,D3                   ; D3 = 24 (count 2P)
 *   L2_INIT:
 *   0002842C  clr.b   D2b                       ; D2 = 0 (loop counter)
 *   0002842E  bra.b   L2_CHECK
 *   L2_BODY:
 *   00028430  pea     (0x1C00).w                ; push arg4 (mask) = 0x1C00
 *   00028434  movea.l D4,A0
 *   00028436  addq.l  0x2,D4                    ; D4 += 2 (next data word)
 *   00028438  move.w  (A0),D0w                  ; D0 = data word
 *   0002843A  ext.l   D0
 *   0002843C  move.l  D0,-(SP)                  ; push arg3 (data) sext_l
 *   0002843E  movea.l A3,A0
 *   00028440  addq.l  0x2,A3                    ; A3 += 2 (next row word)
 *   00028442  move.w  (A0),D0w                  ; D0 = row word
 *   00028444  ext.l   D0
 *   00028446  move.l  D0,-(SP)                  ; push arg2 (row) sext_l
 *   00028448  movea.l A2,A0
 *   0002844A  addq.l  0x2,A2                    ; A2 += 2 (next with the word)
 *   0002844C  move.w  (A0),D0w                  ; D0 = with the word
 *   0002844E  ext.l   D0
 *   00028450  move.l  D0,-(SP)                  ; push arg1 (with the) sext_l
 *   00028452  jsr     0x00003784.l              ; setAlphaTile(with the, row, data, mask)
 *                                                ;   via jmp 0x218 trampoline
 *   00028458  lea     (0x10,SP),SP              ; cleanup 4 long arg
 *   0002845C  addq.b  0x1,D2b                   ; D2++
 *   L2_CHECK:
 *   0002845E  cmp.b   D3b,D2b                   ; D2 == D3?
 *   00028460  bne.b   L2_BODY                   ; loop up to D2 == D3
 *
 *   ; ── Epilogo ────────────────────────────────────────────────────────
 *   00028462  movem.l (SP)+,{D2 D3 D4 A2 A3}    ; restore 20 byte
 *   00028466  rts
 *
 *   0x23C2C (12 word): cols 1-player frame   = 0x0013 0x0014 0x0015 0x0016
 *                                              0x0017 0x0017 0x0017 0x0017
 *                                              0x0016 0x0015 0x0014 0x0013
 *   0x23CA4 (24 word): cols 2-player frame   = top 12 + bottom 12
 *                       = 0x000D 0x000E 0x000F 0x0010 0x0011 0x0011 0x0011
 *                         0x0011 0x0010 0x000F 0x000E 0x000D
 *                         0x0019 0x001A 0x001B 0x001C 0x001D 0x001D 0x001D
 *                         0x001D 0x001C 0x001B 0x001A 0x0019
 *   0x23C44 (24 word): rows                  = 0,0,0,0,0,1,2,3,3,3,3,3
 *                                              0,0,0,0,0,0,0,1,2,3,3,3
 *   0x23C74 (24 word): data                  = 0x5F,0x5F,0x5F,0x5F,0xFF,
 *                                              0xDF,0xDF,0x1B,0x5E,0x5E,
 *                                              0x5E,0x5E (×2 ripetuto)
 *
 * **Caller** (xref):
 *   - `FUN_00010504` @ 0x00010524 — first init (boot/level start).
 *   - `FUN_00010504` @ 0x00010920 — second init in the same caller.
 *
 *     reading the rotation flag at workRam[0x1F42] and ROM lookup @ 0x72A4.
 *     (col_byte, row_byte, data_word, mask_word).
 *
 * coherent lookups):
 *   1. `state.alphaRam[..]` mutated by Loop1 in 30 × 12 bytes = 360 bytes
 *      from Loop2, drawing the frame around the score area.
 *      `workRam[0x396]` for the 1P/2P split, and `workRam[0x1F42]` indirectly
 *      via `getAlphaTileAddr`).
 *
 * `packages/cli/src/test-hud-frame-init-283c2-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { getAlphaTileAddr } from "./alpha-tilemap.js";
import { setAlphaTile } from "./string-format.js";

// ─── Address constants ───────────────────────────────────────────────────

export const FUN_283C2_ADDR = 0x000283c2 as const;

/**
 *  0x400396 → workRam offset 0x396). 1 = single player, 2 = two players. */
export const PLAYER_COUNT_OFF = 0x396 as const;

export const LOOP1_ROW_COUNT = 0x1e as const;

/** Clear word used in Loop1 (`0x3400` = blank alpha tile attr). */
export const LOOP1_CLEAR_WORD = 0x3400 as const;

/** Offset (in BYTE) between il first word write e il second gruppo of 3 word
  */
export const LOOP1_RIGHT_OFF = 0x4e as const;

/** Number of word writes per left/right group in Loop1. */
export const LOOP1_GROUP_WORDS = 3 as const;

/** ROM address of the table "cols" 1-player (12 word). */
export const ROM_COLS_1P = 0x00023c2c as const;

/** ROM address of the table "rows" (24 word, condiviso 1P/2P). */
export const ROM_ROWS = 0x00023c44 as const;

/** ROM address of the table "data" (24 word, condiviso 1P/2P). */
export const ROM_DATA = 0x00023c74 as const;

/** ROM address of the 2-player "cols" table (24 words). */
export const ROM_COLS_2P = 0x00023ca4 as const;

export const LOOP2_COUNT_1P = 0x0c as const;

export const LOOP2_COUNT_2P = 0x18 as const;

/** Constant mask word passed as arg4 to `setAlphaTile` in Loop2. */
export const LOOP2_MASK = 0x1c00 as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

function readPlayerCount(state: GameState): number {
  const r = state.workRam;
  return (
    (((r[PLAYER_COUNT_OFF] ?? 0) << 8) | (r[PLAYER_COUNT_OFF + 1] ?? 0)) &
    0xffff
  );
}

/**
 */
function readRomWordBE(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  const p = rom.program;
  return (((p[a] ?? 0) << 8) | (p[a + 1] ?? 0)) & 0xffff;
}

/**
 * (no-op): replicates the behavior of the oracle's unified memory layout,
 * which we do not observe here.
 */
function writeAlphaWordBE(state: GameState, off: number, value: number): void {
  const v = value & 0xffff;
  const a = off | 0;
  if (a >= 0 && a + 1 < state.alphaRam.length) {
    state.alphaRam[a] = (v >>> 8) & 0xff;
    state.alphaRam[a + 1] = v & 0xff;
  }
}


/**
 *
 * (draw frame score area, 12 o 24 tile based on 1P/2P).
 *
 * **Side effects**:
 *     `getAlphaTileAddr`).
 *     0x23CA4 e lookup ROM 0x72A4 via `getAlphaTileAddr`).
 *
 * @param rom   ROM image (tables + alpha-pointer lookup).
 */
export function hudFrameInit283C2(state: GameState, rom: RomImage): void {
  for (let row = 0; row < LOOP1_ROW_COUNT; row++) {
    // Replica `move.b D2b,D0b; ext.w D0w; ext.l D0; move.l D0,-(SP); clr.l -(SP); jsr 0x37E4`.
    const rowByte = row & 0xff;
    const baseAddr = getAlphaTileAddr(state, rom, 0, rowByte);
    // With a negative shift count or overflow, the write targets other regions:
    let leftOff = (baseAddr - 0xa03000) | 0;
    let rightOff = (leftOff + LOOP1_RIGHT_OFF) | 0;
    for (let i = 0; i < LOOP1_GROUP_WORDS; i++) {
      writeAlphaWordBE(state, leftOff, LOOP1_CLEAR_WORD);
      leftOff = (leftOff + 2) | 0;
      writeAlphaWordBE(state, rightOff, LOOP1_CLEAR_WORD);
      rightOff = (rightOff + 2) | 0;
    }
    // 2*LOOP1_GROUP_WORDS = 6 byte. 0x4E >> 6 → safe).
  }

  // ─── Loop2 setup: select tables + count basato su player count ─────────
  const playerCount = readPlayerCount(state);
  const is1P = playerCount === 1;
  const colsBase = is1P ? ROM_COLS_1P : ROM_COLS_2P;
  const loopCount = is1P ? LOOP2_COUNT_1P : LOOP2_COUNT_2P;

  for (let i = 0; i < loopCount; i++) {
    const colWord = readRomWordBE(rom, colsBase + i * 2);
    const rowWord = readRomWordBE(rom, ROM_ROWS + i * 2);
    const dataWord = readRomWordBE(rom, ROM_DATA + i * 2);
    // setAlphaTile signature: (state, rom, arg1Byte=with the, arg2Byte=row,
    // word). It uses only the low byte for with the/row and the full word for
    // data/mask, so this matches the caller contract.
    const colByte = colWord & 0xff;
    const rowByte = rowWord & 0xff;
    setAlphaTile(state, rom, colByte, rowByte, dataWord, LOOP2_MASK);
  }
}

/**
 * Re-export of the simbolo as "FUN_000283C2" per mappatura esplicita
 */
export { hudFrameInit283C2 as FUN_000283C2 };
