/**
 *
 *
 * Original calling convention (68k, cdecl-like):
 *   `move.l A2, -(SP); jsr $1BC88.l; tst.l D0; addq.l #4, SP`
 *   → 1 arg long su stack (objAddr assoluto M68k).
 *
 * @returns         D0.l (0 = no collision, 1 = collision).
 *
 * @see disasm FUN_0001BC88 @ 0x1bc88–0x1c012
 */

import type { GameState, ObjectPairCollisionDebug } from "./state.js";
import type { RomImage } from "./bus.js";

import { soundCmdSend158AC } from "./sound-cmd-send-158ac.js";
import { soundPair15884 } from "./sound-pair-15884.js";
import { stateSub15BD0 } from "./state-sub-15bd0.js";
import { objectStateEntry25BAE } from "./object-state-entry-25bae.js";
import { objectEnterState23 } from "./object-enter-state-23.js";
import { findNearestNeighbor } from "./nearest-neighbor.js";

// ─── ROM constants ────────────────────────────────────────────────────────────

/**
 * ROM address of the velocity-→-repulsion look-up table (256 signed bytes,
 * byte-indexed by abs(velocity word)).  Only indices 0..127 are used because
 * a 16-bit velocity has abs ≤ 0x7FFF but the relevant range is 0..255 after
 * clamping to the low byte.
 *
 * `0x1bc9a: movea.l #$24ad6, a4`
 */
const ROM_REPULSION_TABLE = 0x24ad6 as const;

/**
 * ROM address of the object-pointer table (4 × 4-byte absolute M68k ptrs).
 *
 * `0x1bcec: movea.l (a0, d0.w), a3`  where a0 = 0x24ac6
 */
const ROM_OBJ_PTR_TABLE = 0x24ac6 as const;

/** Fixed player-1 absolute address (d4 = 0x400018 throughout FUN). */
const PLAYER1_ABS = 0x00400018 as const;
/** Player-2 = Player-1 + 0xe2 stride. */
const PLAYER2_ABS = 0x004000fa as const; // 0x400018 + 0xe2

/** Global-snapshot absolute addresses (workRam). */
const ABS_GLOBAL_X = 0x00400690 as const;
const ABS_GLOBAL_Y = 0x00400692 as const;
const ABS_GLOBAL_Z = 0x00400694 as const;

/**
 * Position snapshot addresses (OFF_GLOBAL_X/Y/Z in helper-121b8).
 * Written by helper-121b8 as obj.X/Y/Z before velocity integration.
 * On collision, restored to a2.X/Y/Z (a2 snaps back to pre-integration pos).
 * 0x1be0a: move.l $400684.l, $c(a2)
 */
const ABS_SNAP_X = 0x00400684 as const;
const ABS_SNAP_Y = 0x00400688 as const;
const ABS_SNAP_Z = 0x0040068c as const;

/** Game-mode word @ 0x400394. Values 1/3/5 → loopCount=4; else → 2. */
const ABS_GAME_MODE = 0x00400394 as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WR_BASE = 0x00400000 as const;

function wOff(absAddr: number): number {
  return (absAddr - WR_BASE) >>> 0;
}

function r8(state: GameState, absAddr: number): number {
  return (state.workRam[wOff(absAddr)] ?? 0) & 0xff;
}
function w8(state: GameState, absAddr: number, v: number): void {
  state.workRam[wOff(absAddr)] = v & 0xff;
}
function r16(state: GameState, absAddr: number): number {
  const o = wOff(absAddr);
  return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
}
function w16(state: GameState, absAddr: number, v: number): void {
  const o = wOff(absAddr);
  state.workRam[o]     = (v >>> 8) & 0xff;
  state.workRam[o + 1] =  v        & 0xff;
}
function r32(state: GameState, absAddr: number): number {
  const o = wOff(absAddr);
  return (
    (((state.workRam[o]     ?? 0) << 24) |
     ((state.workRam[o + 1] ?? 0) << 16) |
     ((state.workRam[o + 2] ?? 0) << 8)  |
      (state.workRam[o + 3] ?? 0)) >>> 0
  );
}
function w32(state: GameState, absAddr: number, v: number): void {
  const o = wOff(absAddr);
  const u = v >>> 0;
  state.workRam[o]     = (u >>> 24) & 0xff;
  state.workRam[o + 1] = (u >>> 16) & 0xff;
  state.workRam[o + 2] = (u >>> 8)  & 0xff;
  state.workRam[o + 3] =  u         & 0xff;
}

/** Sign-extend 32-bit unsigned → signed JS integer (for arithmetic). */
function s32(v: number): number {
  const u = v >>> 0;
  return u >= 0x80000000 ? (u | 0) : u;
}
/** Sign-extend 16-bit unsigned → signed JS integer. */
function s16(v: number): number {
  const u = v & 0xffff;
  return u & 0x8000 ? u - 0x10000 : u;
}

/** Read unsigned byte from ROM at absolute address. */
function romB(rom: RomImage, addr: number): number {
  return (rom.program[addr] ?? 0) & 0xff;
}
/** Read unsigned 32-bit long from ROM at absolute address (big-endian). */
function romL(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr]     ?? 0) << 24) |
     ((rom.program[addr + 1] ?? 0) << 16) |
     ((rom.program[addr + 2] ?? 0) << 8)  |
      (rom.program[addr + 3] ?? 0)) >>> 0
  );
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * FUN_0001BC88 — obj-pair physics interaction.
 *
 */
export function helper1BC88(
  state: GameState,
  entityAddr: number,
  rom: RomImage,
  subs: { objectEnterState23?: (state: GameState, objAddr: number) => void } = {},
): number {
  const enterState23 =
    subs.objectEnterState23 ??
    ((st: GameState, objAddr: number): void => {
      objectEnterState23(st, objAddr, {
        fun_15d10: (s, ptr) => { findNearestNeighbor(s, ptr, rom); },
      });
    });

  // link.w a6, #$fff4  (12 byte of locals: -$c..-$1)
  // movem.l d2-d7/a2-a4, -(a7)
  // movea.l $8(a6), a2  ← entityAddr (our parameter)

  const a2 = entityAddr >>> 0;

  // d4 = 0x400018  (fixed; holds player-1 address throughout)
  // a4 = 0x24ad6  (ROM repulsion table)

  // ── Determine loop count (d6) ───────────────────────────────────────────
  // 0x1bca0: movea.l #$400394, a0
  // 0x1bca6: moveq #$4, d6
  // compare game-mode with 1, 3, 5 → keep 4; else moveq #$2, d6
  const gameMode = s16(r16(state, ABS_GAME_MODE));
  let loopCount = (gameMode === 1 || gameMode === 3 || gameMode === 5) ? 4 : 2;

  // ── Read global-snapshot (saved just before call in helper-121b8) ────────
  // 0x1bcbc: clr.w -$2(a6)    → local collision flag = 0
  // 0x1bcc0: move.w $400690,-$c(a6)  → savedX = global-X snapshot (word)
  // 0x1bcc8: move.w $400692,-$a(a6)  → savedY
  // 0x1bcd0: move.w $400694,-$8(a6)  → savedZ
  // 0x1bcd8: clr.w  -$6(a6)          → loop index = 0
  let collisionFlag = 0;           // -$2(a6)
  const savedX = s16(r16(state, ABS_GLOBAL_X));  // -$c(a6)
  const savedY = s16(r16(state, ABS_GLOBAL_Y));  // -$a(a6)
  const savedZ = s16(r16(state, ABS_GLOBAL_Z));  // -$8(a6)

  // ── Main loop ────────────────────────────────────────────────────────────
  // Loop variable (word): -$6(a6) = 0..loopCount-1
  for (let loopIdx = 0; loopIdx < loopCount; loopIdx++) {
    // 0x1bce0: move.w -$6(a6), d0
    // 0x1bce4: asl.w #$2, d0           → d0 = idx * 4
    // 0x1bce6: movea.l #$24ac6, a0
    // 0x1bcec: movea.l (a0, d0.w), a3  → a3 = ROM_OBJ_PTR_TABLE[idx]
    const a3Abs = romL(rom, ROM_OBJ_PTR_TABLE + loopIdx * 4);
    const a3 = a3Abs >>> 0;

    // 0x1bcf0: cmpa.l a2, a3; beq → next
    if (a3 === a2) continue;

    // 0x1bcf6: cmpi.b #$1, $18(a3); bne → next
    // obj.state18 must be 1 (active)
    if (r8(state, a3 + 0x18) !== 1) continue;

    // ── X bounding-box check ────────────────────────────────────────────
    // 0x1bd00: move.w -$c(a6), d1
    // 0x1bd04: lea $c(a3), a0
    // 0x1bd08: sub.w (a0), d1        → d1 = savedX - a3.x_word
    // 0x1bd0a: moveq #$f9, d0        → d0.l = 0xFFFFFFF9 (sign-ext → -7)
    // 0x1bd0e: bgt → next if -7 > d1 (i.e. d1 < -7)
    // 0x1bd14: blt → next if  7 < d1 (i.e. d1 > 7)
    // Note: a3.x is a LONG at 0xc(a3); sub.w reads the LOW WORD of that long.
    const a3xWord = s16(r16(state, a3 + 0x0c));   // low word of obj.x long
    const d1x = s16((savedX - a3xWord) & 0xffff);
    if (d1x < -7 || d1x > 7) continue;

    // ── Y bounding-box check ────────────────────────────────────────────
    // 0x1bd1a: move.w -$a(a6), d3
    // 0x1bd1e: lea $10(a3), a0
    // 0x1bd22: sub.w (a0), d3
    const a3yWord = s16(r16(state, a3 + 0x10));
    const d3y = s16((savedY - a3yWord) & 0xffff);
    if (d3y < -7 || d3y > 7) continue;

    // ── Z bounding-box check ────────────────────────────────────────────
    // 0x1bd34: move.w -$8(a6), -$4(a6)
    // 0x1bd3a: lea $14(a3), a0
    // 0x1bd3e: move.w -$4(a6), d7
    // 0x1bd42: sub.w (a0), d7         → d7 = savedZ - a3.z_word
    // 0x1bd44: move.w d7, -$4(a6)
    // 0x1bd48: moveq #$f2, d0  → -14 (sign-ext of 0xFFFFFFF2)
    // 0x1bd4e: bgt → next if -14 > zdelta (zdelta < -14)
    // 0x1bd54: moveq #$e; blt → next if 14 < zdelta (zdelta > 14)
    const a3zWord = s16(r16(state, a3 + 0x14));
    let localZ = s16((savedZ - a3zWord) & 0xffff); // -$4(a6)
    if (localZ < -14 || localZ > 14) continue;

    // ── State-1A checks ─────────────────────────────────────────────────
    // 0x1bd5c: cmpi.b #$4, $1a(a3); beq → next
    // 0x1bd66: cmpi.b #$2, $1a(a3); beq → next
    // 0x1bd70: cmpi.b #$b, $1a(a3); beq → next
    const state1A = r8(state, a3 + 0x1a);
    if (state1A === 4 || state1A === 2 || state1A === 0xb) continue;

    // 0x1bd7a: cmpi.b #$a, $58(a2); beq → next
    if (r8(state, a2 + 0x58) === 0xa) continue;

    // ── Approach-vector magnitude check ─────────────────────────────────
    // abs(d1x) * 16 → d2
    // abs(d3y) * 16 → d0
    // if d2 >= d0: d1 = d0/8*3 + d2  (d0 is small)
    //   else     : d1 = d2/8*3 + d0  (d2 is small)
    // if d1 >= 0x70 → skip (no close approach)
    const absX = d1x < 0 ? -d1x : d1x;
    const absY = d3y < 0 ? -d3y : d3y;
    const d2mag = (absX * 16) & 0xffff;
    const d0mag = (absY * 16) & 0xffff;

    let d1mag: number;
    if (d2mag >= d0mag) {
      // d2 is the larger component
      d1mag = (((d0mag >>> 3) * 3) + d2mag) & 0xffff;
    } else {
      // d0 is the larger component
      d1mag = (((d2mag >>> 3) * 3) + d0mag) & 0xffff;
    }

    if (d1mag >= 0x70) continue;

    // ── Collision confirmed ──────────────────────────────────────────────
    // 0x1bdcc: moveq #$1, d7
    // 0x1bdce: move.w d7, -$2(a6)   → collisionFlag = 1
    collisionFlag = 1;
    const debugBefore = {
      selfX: s32(r32(state, a2 + 0x0c)),
      selfY: s32(r32(state, a2 + 0x10)),
      selfZ: s32(r32(state, a2 + 0x14)),
      targetX: s32(r32(state, a3 + 0x0c)),
      targetY: s32(r32(state, a3 + 0x10)),
      targetZ: s32(r32(state, a3 + 0x14)),
      selfVx: s32(r32(state, a2 + 0x00)),
      selfVy: s32(r32(state, a2 + 0x04)),
      targetVx: s32(r32(state, a3 + 0x00)),
      targetVy: s32(r32(state, a3 + 0x04)),
    };

    // ── Determine if a2/a3 are player objects ───────────────────────────
    // d3b = 1 if a2 is player1 or player2; else 0
    // d2b = 1 if a3 is player1 or player2; else 0
    const d3b = (a2 === PLAYER1_ABS || a2 === PLAYER2_ABS) ? 1 : 0;
    const d2b = (a3 === PLAYER1_ABS || a3 === PLAYER2_ABS) ? 1 : 0;

    // ── Reset a2's velocity from saved snapshot ──────────────────────────
    // 0x1be0a: move.l $400684.l, $c(a2)   → a2.x = savedVX?
    // Wait: 0x400684 = ABS_SAVED_VX (saved velocity X), field $c(a2) = obj.X pos
    // Looking again at disasm:
    //   0x1be0a: move.l $400684.l, $c(a2)  — restore a2.x from snapshot
    //   0x1be12: move.l $400688.l, $10(a2) — restore a2.y from snapshot
    //   0x1be1a: move.l $40068c.l, $14(a2) — restore a2.z from snapshot
    // These are the position fields ($c,$10,$14) set from the saved values.
    // The saved values at 0x400684/688/68c were written by helper-121b8 as
    // obj.vx/vy/vz (velocities). So: a2.pos = snapshot of a2.vel?
    // Actually reading helper-121b8: those globals are obj.x/y/z positions
    // NOT velocities. Let me re-read…
    // In helper-121b8 line 430-432: OFF_GLOBAL_X=0x684, X snapshot = obj.X
    // Wait: helper-121b8 OFF_GLOBAL_X=0x684, OFF_GLOBAL_Y=0x688, OFF_GLOBAL_Z=0x68c
    // And then 0x1bcc0: move.w $400690,-$c(a6) which is OFF_WORLD_X=0x690
    // So in 1bc88:
    //   -$c(a6) = word from 0x400690 (savedX world coord)
    //   -$a(a6) = word from 0x400692 (savedY world coord)
    //   -$8(a6) = word from 0x400694 (savedZ world coord)
    // BUT: 0x1be0a: move.l $400684.l, $c(a2)  ← this is a LONG from abs 0x400684
    // 0x400684 = ABS_SAVED_VX (in helper-121b8: OFF_GLOBAL_X = 0x684)
    // So: a2.$c (obj.X pos long) = value @ 0x400684 = global X snapshot (long)
    // This restores a2 position to the snapshot taken before velocity integration.
    w32(state, a2 + 0x0c, r32(state, ABS_SNAP_X));   // a2.X = position snapshot
    w32(state, a2 + 0x10, r32(state, ABS_SNAP_Y));   // a2.Y = position snapshot
    w32(state, a2 + 0x14, r32(state, ABS_SNAP_Z));   // a2.Z = position snapshot

    // ── Swap velocity longs between a2 and a3 ───────────────────────────
    // 0x1be22: move.l (a2), d0
    // 0x1be24: move.l (a3), (a2)
    // 0x1be26: move.l d0, (a3)          → swap a2[0] ↔ a3[0]  (VX low-long)
    // 0x1be28: move.l $4(a2), d0
    // 0x1be2c: move.l $4(a3), $4(a2)
    // 0x1be32: move.l d0, $4(a3)        → swap a2[4] ↔ a3[4]  (VY low-long)
    const tmp0 = r32(state, a2 + 0x00);
    w32(state, a2 + 0x00, r32(state, a3 + 0x00));
    w32(state, a3 + 0x00, tmp0);
    const tmp4 = r32(state, a2 + 0x04);
    w32(state, a2 + 0x04, r32(state, a3 + 0x04));
    w32(state, a3 + 0x04, tmp4);

    // ── Repulsion for a2 VX ─────────────────────────────────────────────
    // 0x1be36: movea.l a2, a0
    // 0x1be38: move.w (a0), d1     → d1 = a2[0].w  (low word of VX after swap)
    // 0x1be3a: bge.b → abs
    // 0x1be3c..1be46: abs(d1) → d0.l
    // 0x1be48: movea.l a4, a0
    // 0x1be4a: move.b (a0, d0.w), d0 → d0.b = ROM_TABLE[abs(vx)]  (byte index)
    // 0x1be4e: ext.w d0; ext.l d0    → sign-extend byte to long
    // 0x1be52: move.l d0, d5
    // 0x1be54: moveq #$c, d0
    // 0x1be56: asl.l d0, d5          → d5 = signedByte << 12
    // 0x1be58: cmp.b d2, d3          → if d3b == d2b: equal (same type)
    // 0x1be5a: beq → skip scale-up
    // 0x1be5c: asl.l #$2, d5         → d5 <<= 2 (×4 if mixed player/non-player)
    // 0x1be62: move.l $c(a2), d0     → a2.X (long)
    // 0x1be66: cmp.l $c(a3), d0      → compare a2.X vs a3.X
    // 0x1be6a: ble → skip negate
    // 0x1be6c: neg.l d5              → negate if a2.X > a3.X (repel away)
    // 0x1beb0: move.l d5, d0
    // 0x1beb2: sub.l d0, (a2)        → a2[0].l -= d5
    {
      const vxWord = s16(r16(state, a2 + 0x00));
      const absVx = vxWord < 0 ? -vxWord : vxWord;
      // move.b (a4, d0.w) — byte index into ROM table; d0 is unsigned index 0..255
      const romIdx = absVx & 0xff;
      let romByte = romB(rom, ROM_REPULSION_TABLE + romIdx);
      // sign-extend byte to long
      const sRomByte = romByte & 0x80 ? (romByte | 0xffffff00) | 0 : romByte;
      let d5 = (sRomByte << 12) | 0;  // asl.l #$c
      if (d3b !== d2b) {
        d5 = (d5 << 2) | 0;           // asl.l #$2 (mixed player/non-player)
      }
      // if a2.X > a3.X → negate
      if (s32(r32(state, a2 + 0x0c)) > s32(r32(state, a3 + 0x0c))) {
        d5 = (-d5) | 0;
      }
      // a2[0].l -= d5
      const newVx = (s32(r32(state, a2 + 0x00)) - d5) | 0;
      w32(state, a2 + 0x00, newVx >>> 0);
    }

    // ── Repulsion for a2 VY ─────────────────────────────────────────────
    // 0x1be72: lea $4(a2), a0
    // 0x1be76: move.w (a0), d1   → low word of VY
    // ... (same pattern) ...
    // 0x1bea0: move.l $10(a2), d0  → a2.Y
    // 0x1bea4: cmp.l $10(a3), d0
    // 0x1bea8: ble → skip negate
    // 0x1beae: move.l d0, d1
    // 0x1beb0: neg ← actually: 0x1beaa..1beae set d1=neg then
    //   0x1beb0: move.l d5, d0; sub.l d0, (a2) → oops, actually:
    // Let me re-check the disasm:
    //   0x1be76: move.w (a0), d1
    //   0x1be78: bge → 0x1be82
    //   0x1be7a: moveq #0, d0; move.w d1, d0; neg.l d0 → bra 0x1be86
    //   0x1be82: moveq #0, d0; move.w d1, d0
    //   0x1be86: move.b (a4,d0.w), d0  → romTable[abs(vy)]
    //   0x1be8c: ext.w d0; ext.l d0
    //   0x1be90: move.l d0, d1
    //   0x1be92: moveq #$c, d0; asl.l d0, d1  → d1 = sB << 12
    //   0x1be96: cmp.b d2, d3; beq 0x1bea0
    //   0x1be9a: asl.l #$2, d1  (×4 if mixed)
    //   0x1bea0: move.l $10(a2), d0  → a2.Y
    //   0x1bea4: cmp.l $10(a3), d0
    //   0x1bea8: ble 0x1beb0
    //   0x1beaa: move.l d1, d0; neg.l d0; move.l d0, d1
    //   0x1beb0: move.l d5, d0   ← wait, d5 here? Let me re-read…
    //
    // Actually at 0x1beb0: move.l d5, d0 — d5 still holds repulsion for VX?
    // No wait: looking at 0x1beb0: "move.l d5, d0" → but d5 was set for VX.
    // Re-reading disasm:
    //   0x1be90: move.l d0, d1
    //   0x1be92: moveq #$c, d0
    //   0x1be94: asl.l d0, d1      → d1 = sB << 12
    //   0x1be96: cmp.b d2, d3
    //   0x1be98: beq.b 0x1bea0
    //   0x1be9a: move.l d1, d0; asl.l #$2, d0; move.l d0, d1
    //   0x1bea0: move.l $10(a2), d0
    //   0x1bea4: cmp.l $10(a3), d0
    //   0x1bea8: ble.b 0x1beb0
    //   0x1beaa: move.l d1, d0; neg.l d0; move.l d0, d1
    //   0x1beb0: move.l d5, d0      ← this is the VX d5 value!
    //   0x1beb2: sub.l d0, (a2)     ← a2[0].l -= d5 (VX adjustment)
    //   0x1beb4: move.l d1, d0
    //   0x1beb6: sub.l d0, $4(a2)   ← a2[4].l -= d1 (VY adjustment)
    //
    // So the code computes d5 (for VX) and d1 (for VY) and then applies both.
    // The d1 (VY) computation is interleaved with the d5 application for VX.
    // Let me restructure this in TS:
    {
      const vyWord = s16(r16(state, a2 + 0x04));
      const absVy = vyWord < 0 ? -vyWord : vyWord;
      const romIdxY = absVy & 0xff;
      let romByteY = romB(rom, ROM_REPULSION_TABLE + romIdxY);
      const sRomByteY = romByteY & 0x80 ? (romByteY | 0xffffff00) | 0 : romByteY;
      let d1rep = (sRomByteY << 12) | 0;
      if (d3b !== d2b) {
        d1rep = (d1rep << 2) | 0;
      }
      if (s32(r32(state, a2 + 0x10)) > s32(r32(state, a3 + 0x10))) {
        d1rep = (-d1rep) | 0;
      }
      // 0x1beb4: move.l d1, d0; sub.l d0, $4(a2)
      const newVy = (s32(r32(state, a2 + 0x04)) - d1rep) | 0;
      w32(state, a2 + 0x04, newVy >>> 0);
    }

    // ── Repulsion for a3 VX ─────────────────────────────────────────────
    // 0x1bebc: movea.l a3, a0
    // 0x1bebe: move.w (a0), d1   → low word of a3[0] (VX after swap)
    // ... same abs+lookup pattern ...
    // 0x1bee6: move.l $c(a2), d0
    // 0x1beea: cmp.l $c(a3), d0
    // 0x1beee: ble → skip negate d5
    // d5 used for a3.VX; d1 for a3.VY
    // 0x1bef6: lea $4(a3), a0 → next: compute d1 for a3.VY
    // 0x1bf34: move.l d5, d0; add.l d0, (a3)   → a3[0] += d5
    // 0x1bf38: move.l d1, d0; add.l d0, $4(a3) → a3[4] += d1
    let d5_a3: number;
    {
      const vxWord = s16(r16(state, a3 + 0x00));
      const absVx = vxWord < 0 ? -vxWord : vxWord;
      const romIdx = absVx & 0xff;
      let romByte = romB(rom, ROM_REPULSION_TABLE + romIdx);
      const sRomByte = romByte & 0x80 ? (romByte | 0xffffff00) | 0 : romByte;
      let d5 = (sRomByte << 12) | 0;
      if (d3b !== d2b) {
        d5 = (d5 << 2) | 0;
      }
      if (s32(r32(state, a2 + 0x0c)) > s32(r32(state, a3 + 0x0c))) {
        d5 = (-d5) | 0;
      }
      d5_a3 = d5;
    }

    let d1_a3: number;
    {
      const vyWord = s16(r16(state, a3 + 0x04));
      const absVy = vyWord < 0 ? -vyWord : vyWord;
      const romIdxY = absVy & 0xff;
      let romByteY = romB(rom, ROM_REPULSION_TABLE + romIdxY);
      const sRomByteY = romByteY & 0x80 ? (romByteY | 0xffffff00) | 0 : romByteY;
      let d1 = (sRomByteY << 12) | 0;
      if (d3b !== d2b) {
        d1 = (d1 << 2) | 0;
      }
      if (s32(r32(state, a2 + 0x10)) > s32(r32(state, a3 + 0x10))) {
        d1 = (-d1) | 0;
      }
      d1_a3 = d1;
    }

    // 0x1bf34: move.l d5, d0; add.l d0, (a3)
    w32(state, a3 + 0x00, (s32(r32(state, a3 + 0x00)) + d5_a3) >>> 0);
    // 0x1bf3a: move.l d1, d0; add.l d0, $4(a3)
    w32(state, a3 + 0x04, (s32(r32(state, a3 + 0x04)) + d1_a3) >>> 0);
    state.debug ??= {};
    const pairDebug: ObjectPairCollisionDebug = {
      frame: Number(state.clock.frame),
      selfAddr: a2,
      targetAddr: a3,
      loopIndex: loopIdx,
      savedX,
      savedY,
      savedZ,
      deltaX: d1x,
      deltaY: d3y,
      deltaZ: localZ,
      selfActiveBefore: r8(state, a2 + 0x18),
      targetActiveBefore: r8(state, a3 + 0x18),
      selfF36Before: r8(state, a2 + 0x36),
      targetF36Before: r8(state, a3 + 0x36),
      selfState: r8(state, a2 + 0x1a),
      targetState: r8(state, a3 + 0x1a),
      selfKind: r8(state, a2 + 0x1b),
      targetKind: r8(state, a3 + 0x1b),
      selfX: debugBefore.selfX,
      selfY: debugBefore.selfY,
      selfZ: debugBefore.selfZ,
      targetX: debugBefore.targetX,
      targetY: debugBefore.targetY,
      targetZ: debugBefore.targetZ,
      selfVxBefore: debugBefore.selfVx,
      selfVyBefore: debugBefore.selfVy,
      targetVxBefore: debugBefore.targetVx,
      targetVyBefore: debugBefore.targetVy,
      selfVxAfter: s32(r32(state, a2 + 0x00)),
      selfVyAfter: s32(r32(state, a2 + 0x04)),
      targetVxAfter: s32(r32(state, a3 + 0x00)),
      targetVyAfter: s32(r32(state, a3 + 0x04)),
    };
    const finishPairDebug = (zDepthPath: string): void => {
      pairDebug.zDepthPath = zDepthPath;
      pairDebug.selfActiveAfter = r8(state, a2 + 0x18);
      pairDebug.targetActiveAfter = r8(state, a3 + 0x18);
      pairDebug.selfStateAfter = r8(state, a2 + 0x1a);
      pairDebug.targetStateAfter = r8(state, a3 + 0x1a);
      pairDebug.selfKindAfter = r8(state, a2 + 0x1b);
      pairDebug.targetKindAfter = r8(state, a3 + 0x1b);
      pairDebug.selfF36After = r8(state, a2 + 0x36);
      pairDebug.targetF36After = r8(state, a3 + 0x36);
    };
    state.debug.lastObjectPairCollision = pairDebug;

    // ── Update a2 state/sound if not a player ────────────────────────────
    // 0x1bf3e: tst.b d3; bne → skip_a2_state
    if (d3b === 0) {
      // 0x1bf42: movea.l a2, a0
      // 0x1bf44: moveq #$ff, d0
      // 0x1bf46: cmp.w $6c(a0), d0; bne → skip_6c_set
      // 0x1bf4c: move.w #$96, $6c(a0)
      if (r16(state, a2 + 0x6c) === 0xffff) {
        w16(state, a2 + 0x6c, 0x96);
      }
      // 0x1bf52: move.b #$24, $1a(a0)
      w8(state, a2 + 0x1a, 0x24);
      // 0x1bf58: addi.b #$14, $56(a0)
      w8(state, a2 + 0x56, (r8(state, a2 + 0x56) + 0x14) & 0xff);
      // 0x1bf5e: move.l a0,-(a7); jsr $160d4.l; addq.l #4, a7
      enterState23(state, a2);
    }

    // ── Update a3 state/sound if not a player ────────────────────────────
    // 0x1bf68: tst.b d2; bne → skip_a3_state
    if (d2b === 0) {
      // 0x1bf6c: movea.l a3, a0
      // 0x1bf70: cmp.w $6c(a0), d0 (d0 = 0xff from previous moveq or 0 from clr.b)
      // wait: d0 was clr.b at 0x1bdea if a3 is not player. Let me check.
      // Actually d0 is 0xff from the moveq #$ff at 0x1bf44 (set for a2 block)
      // but if d3b != 0, we skipped that block, so d0 is unspecified.
      // HOWEVER: looking at the code path again:
      // 0x1bf3e: tst.b d3; bne 0x1bf68  → if d3b != 0, skip to a3 block
      // 0x1bf68: tst.b d2; bne 0x1bf92
      // 0x1bf6c: movea.l a3, a0
      // 0x1bf6e: moveq #$ff, d0     ← fresh moveq #$ff, d0 before compare
      // 0x1bf70: cmp.w $6c(a0), d0
      if (r16(state, a3 + 0x6c) === 0xffff) {
        w16(state, a3 + 0x6c, 0x96);
      }
      // 0x1bf7c: move.b #$24, $1a(a0)
      w8(state, a3 + 0x1a, 0x24);
      // 0x1bf82: addi.b #$14, $56(a0)
      w8(state, a3 + 0x56, (r8(state, a3 + 0x56) + 0x14) & 0xff);
      // 0x1bf88: move.l a0,-(a7); jsr $160d4.l; addq.l #4,a7
      enterState23(state, a3);
    }

    // ── Sound dispatch ───────────────────────────────────────────────────
    // 0x1bf92: tst.b d3; beq 0x1bf9c (d3b == 0 → do sound)
    // 0x1bf98: tst.b d2; bne 0x1bfac (both players → play 0x37)
    // 0x1bf9c: pea $32.l; jsr $158ac.l; addq.l #4,a7  → sound 0x32
    // 0x1bfac: pea $37.l; jsr $158ac.l; addq.l #4,a7  → sound 0x37
    if (d3b === 0 || d2b === 0) {
      // at least one is non-player: play sound 0x32
      soundCmdSend158AC(state, 0x32);
    } else {
      // both are players: play sound 0x37
      soundCmdSend158AC(state, 0x37);
    }

    // ── Check z-depth flag and trigger enemy logic ───────────────────────
    // 0x1bfba: tst.w -$4(a6)  → localZ (signed word)
    // 0x1bfbe: blt → next (if localZ < 0 skip rest)
    if (localZ < 0) {
      finishPairDebug("skip-local-z");
      continue;
    }

    // 0x1bfc0: tst.b $36(a2); beq → next
    if (r8(state, a2 + 0x36) === 0) {
      finishPairDebug("skip-self-f36");
      continue;
    }

    // 0x1bfc6: tst.b d2; bne → skip_clr_branch (a3 is player)
    let zDepthPath = "";
    if (d2b === 0) {
      // a3 is NOT a player → stateSub15BD0 + set state18=2
      // 0x1bfca: clr.l -(a7)
      // 0x1bfcc: pea $1.w
      // 0x1bfd0: move.l a3, -(a7)
      // 0x1bfd2: jsr $15bd0.l          → stateSub15BD0(state, a3, 1, 0)
      // 0x1bfd8: move.b #$2, $18(a3)   → a3.state18 = 2
      // 0x1bfde: lea $c(a7), a7
      stateSub15BD0(state, a3, 1, 0);
      w8(state, a3 + 0x18, 2);
      zDepthPath = "target-active2";
    } else {
      // a3 IS a player → soundPair15884
      // 0x1bfe4: jsr $15884.l
      soundPair15884(state);
      zDepthPath = "target-player-sound";
    }

    // 0x1bfea: pea $2.w
    // 0x1bfee: move.l a3, -(a7)
    // 0x1bff0: jsr $25bae.l
    // 0x1bff6: addq.l #$8, a7
    objectStateEntry25BAE(state, a3, 2);
    finishPairDebug(zDepthPath);
  }
  // end loop

  // 0x1c006: move.w -$2(a6), d0
  // 0x1c00a: ext.l d0
  // → D0.l = sign-extended collisionFlag (0 or 1)
  return collisionFlag;
}
