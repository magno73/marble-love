/**
 * sub-fa0-marble-emit.ts — main-thread patch chunk (FUN_FA0) that adjusts
 * the marble player's encoded sprite-RAM coordinates.
 *
 * MAME emits the marble as a 5-tile mosaic in sprite RAM entries 4..8. In MAME:
 *
 *   - obj0 @ 0x400018+0x24 (X long): `0x015aa6d5 → 0x01662b65` (Δ +0xb8490)
 *   - slot pair @ 0x400A20+0xC (X long): `0x0099e4d2 → 0x00a141fc` (Δ +0x75d2a)
 *   - slot pair @ 0x400A20+0x10 (Y long): `0x0107e17a → 0x010b5a24` (Δ +0x378aa)
 *
 * Those values shift X by -15 px and Y by +/-1..3 px while preserving tile
 * codes (0x07, 0x0f, 0x16, 0x19, 0x26 — marble rotation animation).
 *
 * **Replica strategy**: instead of projecting absolute coords,
 *
 *      workRam @ `0x4007F0..0x4007F3` (reserved zeroed region).
 *   3. Entries 4..8 in spriteRAM store their coord field in bits 5..13.
 *      Pixel delta = `(Δslot_high) / scale`. Empirically MAME uses
 *      `scale = 2` (1 screen px ≈ 2 slot-pair high-word units).
 *   4. For each entry in {4,5,6,7,8} across both A/B banks:
 *      b. Add `-Δslot_x_pixel` (inverted X: marble moves relative to scroll).
 *      c. Re-encode bits 5..13, preserving flags (bit 15) and tile count (bits 0..4).
 *      d. Do the same for Y with `+Δslot_y_pixel`.
 *
 * **Side effect**:
 *   - `state.spriteRam`: bank A entries 4..8 word 0/2 (Y/X), same for bank B.
 *     Offsets: 0x008..0x011 (Y), 0x108..0x111 (X), 0x208..0x211 (Y B),
 *     0x308..0x311 (X B).
 *   - `state.workRam[0x7F0..0x7F3]`: cache previous slot_x/slot_y high-word.
 *     unused by other replicas.
 *
 * `runMainLoopBody=true`.
 *
 * **Limitations**:
 *   - Approximates `scale = 2` (empirical from MAME f12000 → f12010 delta).
 *   - Does not handle per-tile offset (= marble rotation/animation).
 *   - First call (slot_prev = 0) produces a huge delta; mitigated by the
 *     "skip if prev == 0" guard on the first tick.
 *
 * **References**:
 *   - `docs/video-system.md:76..94` — MO entry layout (Y=word0 bit5-13,
 *     X=word2 bit5-13).
 *   - `tools/disasm/fa0_disasm.txt` — main thread loop FUN_FA0 (3.3KB).
 *   - `late-game-logic-26f3e.ts` — dispatcher type 1/2/4 (handles ent[0,1]
 *     but not the marble's internal tiles).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// Static camera fallback: use obj0.x/y directly as the delta source.

/**
 * Scratch workRam offsets for previous-frame snapshot.
 * Region 0x4007F0..0x4007FF is zeroed in MAME f12000 dump, unused by
 * other replicas (verified via grep).
 */
const PREV_SLOT_X_OFF = 0x7f0;
const PREV_SLOT_Y_OFF = 0x7f2;
const PREV_VALID_OFF  = 0x7f4;  // byte: 0=invalid (first tick), 1=valid

/** Marble player MO entry slot indices (7 entries: 2 sphere + 5 shadow). */
//   entries 2,3: main sphere (tile 5 + tile 3, each 1x2 = 8x16 px,
//                side-by-side → visible white/chrome 16x16 sphere)
//   entries 4..8: marble shadow (5 sub-tile codes 0x16/0x26/
//                 0x0f/0x19/0x07, color=0 = black/gray)
const MARBLE_ENTRY_FIRST = 2;
const MARBLE_ENTRY_COUNT = 7;

/** MO entry layout offsets (per Atari System 1, see docs/video-system.md). */
const MO_BANK_Y_OFF = 0x000;     // bank-A word 0 (Y position)
const MO_BANK_CODE_OFF = 0x080;  // bank-A word 1 (code)
const MO_BANK_X_OFF = 0x100;     // bank-A word 2 (X position)
const MO_BANK_B_OFFSET = 0x200;  // bank-B = bank-A + 0x200 stride

/**
 * Empirical scale factor: 1 screen pixel ≈ ~0.5 slot-pair-high-word unit.
 * Derived from MAME diff f12000→f12010 (10-frame interval):
 *   slot_x_high: 0x99 → 0xa1 (Δ +8)
 *   marble screen X: 95 → 80 (Δ -15 px)
 *   ratio: ~ -2 px / +1 unit (sign inverted, marble vs camera).
 * Therefore deltaPx = -ΔslotX * 2.
 */
/** Write big-endian unsigned 16-bit to workRam at offset. */
function wwBE_workram(state: GameState, off: number, val: number): void {
  state.workRam[off] = (val >>> 8) & 0xff;
  state.workRam[off + 1] = val & 0xff;
}

/** Read big-endian unsigned 16-bit from spriteRam at offset. */
function rwBE_spriteram(state: GameState, off: number): number {
  return (((state.spriteRam[off] ?? 0) << 8) | (state.spriteRam[off + 1] ?? 0)) & 0xffff;
}

/** Write big-endian unsigned 16-bit to spriteRam at offset. */
function wwBE_spriteram(state: GameState, off: number, val: number): void {
  state.spriteRam[off] = (val >>> 8) & 0xff;
  state.spriteRam[off + 1] = val & 0xff;
}

/**
 * Replica of FUN_FA0 chunk that projects `slot pair` (marble world position)
 * nel display-list MO sprite del marble player.
 *
 * **Algoritmo (delta-based)**:
 *   4. Applies delta to the marble entries (slots 4..8) in both banks.
 *
 * playfield that scrolls in the opposite direction (camera follows marble:
 * camera_x up -> marble_screen_x down if viewport-fixed).
 *
 *
 *               + spriteRam in-place).
 * @param rom    RomImage (riservato a future extensions ROM-driven).
 */
export function fun_FA0_marbleEmit(state: GameState, rom: RomImage): void {
  void rom;  // future: ROM-driven per-tile offsets


  // dump MAME, leggiamo direttamente obj0.x/y come fonte del delta.
  //
  // POSITION-ABSOLUTE projection (replica MAME FUN_FA0 camera transform).
  //
  // Derived empirically from warm state f12000:
  //   obj0.x_long = 0x015aa6d5 → cluster screen-x ≈ 95
  //   obj0.y_long = 0x011b4bd0 → cluster screen-y ≈ 68
  //
  //   0x015aa6d5 >> 18 = 0x56 = 86 → screen_x = 86 - (-9) = 95 ✓
  //   0x011b4bd0 >> 18 = 0x46 = 70 → screen_y = 70 - 2 = 68 ✓
  //
  // X sign is inverted: in MAME, marble world-x increases as the camera follows.
  // Empirical sample from warm f12000 to f12010 (+10 frames):
  //   obj.x_long 0x015aa6d5 -> 0x01662b65 (+0xb8490, ~+45/f via >>18)
  //   marble cluster x 95 -> 80 (-15)
  //   ratio ~= -1/3 px per +1 unit (>>18)
  //
  const objXLong = (((state.workRam[0x24] ?? 0) << 24) |
                    ((state.workRam[0x25] ?? 0) << 16) |
                    ((state.workRam[0x26] ?? 0) << 8) |
                    (state.workRam[0x27] ?? 0)) >>> 0;
  const objYLong = (((state.workRam[0x28] ?? 0) << 24) |
                    ((state.workRam[0x29] ?? 0) << 16) |
                    ((state.workRam[0x2a] ?? 0) << 8) |
                    (state.workRam[0x2b] ?? 0)) >>> 0;

  // signed shift right 18 → range [-512..511] truncated to 9-bit
  const objXProj = ((objXLong >> 18) & 0x1ff);
  const objYProj = ((objYLong >> 18) & 0x1ff);

  // Empirical calibration: warm obj proj (86, 70) maps to cluster (95, 68)
  //   X bias = 95 - (-86) = 181 (= 0xb5)  // sign-inverted X
  //   Y bias = 68 - 70 = -2
  const SCREEN_X_BIAS = 0xb5;
  const SCREEN_Y_BIAS = -2;
  const centerX = (SCREEN_X_BIAS - objXProj) & 0x1ff;
  const centerY = (objYProj + SCREEN_Y_BIAS) & 0x1ff;

  // Per-entry offsets relative to cluster center (95, 68), preserved from the
  // warmstate MAME f12000 (entries 2..8):
  //   entry 4 (95, 69) → ( 0, +1)   ← shadow tile #0x16
  //   entry 5 (95, 68) → ( 0,  0)   ← shadow tile #0x26
  //   entry 6 (99, 62) → (+4, -6)   ← shadow tile #0x0f
  //   entry 7 (102,69) → (+7, +1)   ← shadow tile #0x19
  //   entry 8 (91, 70) → (-4, +2)   ← shadow tile #0x07
  const ENTRY_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [-4, -3], [4, -3],            // sphere (entries 2-3)
    [0, 1], [0, 0], [4, -6], [7, 1], [-4, 2],  // shadow (entries 4-8)
  ];

  wwBE_workram(state, PREV_SLOT_X_OFF, objXProj);
  wwBE_workram(state, PREV_SLOT_Y_OFF, objYProj);
  state.workRam[PREV_VALID_OFF] = 1;

  for (let bank = 0; bank < 2; bank++) {
    const bankBase = bank * MO_BANK_B_OFFSET;
    for (let i = 0; i < MARBLE_ENTRY_COUNT; i++) {
      const slot = MARBLE_ENTRY_FIRST + i;
      const yOff = bankBase + MO_BANK_Y_OFF + slot * 2;
      const xOff = bankBase + MO_BANK_X_OFF + slot * 2;
      const codeOff = bankBase + MO_BANK_CODE_OFF + slot * 2;

      if (rwBE_spriteram(state, codeOff) === 0) continue;

      const [dx, dy] = ENTRY_OFFSETS[i] ?? [0, 0];
      const newPosX = (centerX + dx) & 0x1ff;
      const newPosY = (centerY + dy) & 0x1ff;

      // Re-encode 9-bit pos field (bit 5..13), preserve flags/size (bit 0..4, 15).
      const xCur = rwBE_spriteram(state, xOff);
      const yCur = rwBE_spriteram(state, yOff);
      const xFlags = xCur & 0x801f;
      const yFlags = yCur & 0x801f;
      wwBE_spriteram(state, xOff, ((newPosX << 5) & 0x3fe0) | xFlags);
      wwBE_spriteram(state, yOff, ((newPosY << 5) & 0x3fe0) | yFlags);
    }
  }
}

/** Address constant for documentation / introspection. */
export const FUN_FA0_MARBLE_EMIT_ADDR = 0x00000fa0 as const;
