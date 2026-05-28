/**
 * state-dispatch-160f6.ts - `FUN_000160F6` replica (1378 bytes,
 * 0x0160F6-0x016658).
 *
 * ROM speed table, updating `(0x14,A2)`.
 *
 * **Calling convention** (cdecl 68k, stack frame):
 *   ```
 *   link.w   A6, #-8               ; locals (-0x2,A6) and (-0x4,A6)
 *   movem.l  {D2-D7/A2-A4}, -(SP)
 *   move.l   (0xc,A6), D1          ; arg2: long prevTimer
 *   ```
 *   Epilogo: `movem.l (SP)+, {D2-D7/A2-A4}; unlk A6; rts`.
 *
 *   +0x08 (long) : vertical impulse (written as -0x6000)
 *   +0x30 (word) : snapshot tile-Y
 *
 * **Globals workRam** (offset da WORK_RAM_BASE = 0x400000):
 *   0x66a (byte): bitmask diagonali (bit0=NE,bit1=NW,bit2=SE,bit3=SW)
 *   0x66c/0x66e/0x670/0x672 (byte): input Left/Down/Right/Up
 *   0x674/0x676/0x678/0x67a (word): vel Left/Down/Right/Up
 *   0x67c/0x67e/0x680/0x682 (word): vel NE/NW/SE/SW
 *
 * **Whitelist charcode** `(0x58,A2)`:
 *
 * **ROM speed table** @ 0x2398c:
 *   `table[idx]` -> signed byte -> magnitude; idx = min-distance score 0-4.
 *
 * **Caller**: `0x00012434` in `FUN_000121b8`.
 *
 */

import type { GameState } from "./state.js";

// Constants.

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

export const FUN_160F6_ADDR = 0x000160f6 as const;

/** Sound command sent in 2 paths (idle->lock and inner-loop miss). */
export const SOUND_CMD = 0x45 as const;

/** Impulse written to `(0x8,A2)` in start/lock branches. */
export const IMPULSE_VALUE = -0x6000 as const;

/** Idle->lock timer threshold (diff > 0x60000). */
export const TIMER_THRESHOLD = 0x60000 as const;

export const ROM_SPEED_TABLE = 0x0002398c as const;

/** Whitelist charcode `(0x58,A2)`. */
export const CHARCODE_WHITELIST: ReadonlySet<number> = new Set([
  0x00, 0x10, 0x12, 0x17, 0x18, 0x20,
  0x2d, 0x2e, 0x2f, 0x30, 0x31,
  0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
  0x38, 0x39, 0x3a, 0x3b,
]);

export const STRUCT_FIELDS = {
  impulse_08:   0x08,
  position_14:  0x14,
  snapX_2E:     0x2e,
  snapY_30:     0x30,
  state_36:     0x36,
  dirMask_37:   0x37,
  charcode_58:  0x58,
} as const;

/** Globals workRam (offset da WORK_RAM_BASE). */
export const GLOBALS = {
  accumXPrev: 0x696, accumXCur: 0x69a,
  accumYPrev: 0x698, accumYCur: 0x69c,
  diagInput:  0x66a,
  inLeft:  0x66c, inDown:  0x66e, inRight: 0x670, inUp:  0x672,
  velLeft: 0x674, velDown: 0x676, velRight:0x678, velUp: 0x67a,
  velNE:   0x67c, velNW:   0x67e, velSE:   0x680, velSW: 0x682,
} as const;


export interface StateDispatch160F6Subs {
  /**
   */
  soundCommand?: (cmd: number) => void;
  /**
   */
  romByte?: (addr: number) => number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rB(r: Uint8Array, off: number): number {
  return (r[off] ?? 0) & 0xff;
}
function rWs(r: Uint8Array, off: number): number {
  const w = (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
  return w >= 0x8000 ? w - 0x10000 : w;
}
function rLs(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) | ((r[off + 1] ?? 0) << 16) |
     ((r[off + 2] ?? 0) << 8) | (r[off + 3] ?? 0))
  ) | 0;
}
function wB(r: Uint8Array, off: number, v: number): void { r[off] = v & 0xff; }
function wW(r: Uint8Array, off: number, v: number): void {
  const u = v & 0xffff;
  r[off] = (u >>> 8) & 0xff; r[off + 1] = u & 0xff;
}
function wL(r: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  r[off] = (u >>> 24) & 0xff; r[off + 1] = (u >>> 16) & 0xff;
  r[off + 2] = (u >>> 8) & 0xff; r[off + 3] = u & 0xff;
}

function rWabs(state: GameState, abs: number): number {
  const off = abs - WORK_RAM_BASE;
  if (off < 0 || off + 1 >= WORK_RAM_SIZE) return 0;
  return rWs(state.workRam, off);
}
function rBabs(state: GameState, abs: number): number {
  const off = abs - WORK_RAM_BASE;
  if (off < 0 || off >= WORK_RAM_SIZE) return 0;
  return rB(state.workRam, off);
}
function sx8(b: number): number { return ((b & 0xff) << 24) >> 24; }
function sx16(w: number): number { return ((w & 0xffff) << 16) >> 16; }


/**
 *
 * @param state     GameState — mutates `workRam`.
 * @param subs      Stub injection (sound + ROM reader).
 */
export function stateDispatch160F6(
  state: GameState,
  structPtr: number,
  tileXPtr: number,
  tileYPtr: number,
  prevTimer: number,
  subs?: StateDispatch160F6Subs,
): void {
  const r = state.workRam;
  const a2 = (structPtr >>> 0) - WORK_RAM_BASE; // A2 workRam offset
  const D1 = prevTimer | 0;

  // ── 0x1612c: D2 = 0 ──────────────────────────────────────────────────────
  let D2 = 0;

  // ── 0x16130–0x16147: delta trackball ────────────────────────────────────
  const D3 = sx16((rWabs(state, 0x40069a) - rWabs(state, 0x400696)) & 0xffff);
  const D4 = sx16((rWabs(state, 0x40069c) - rWabs(state, 0x400698)) & 0xffff);

  // ── 0x16150–0x16185: Left → bit 0 ────────────────────────────────────────
  // *0x40066c != 0 AND < 3
  // tileX < 4  (ble skip: branch if 4 <= tileX)
  // D3 != 1    (beq skip)
  // velLeft in [0, 3]  (ble skip if >=4; bge skip if <=-1)
  {
    const i = rBabs(state, 0x40066c);
    if (i !== 0 && i < 3) {
      const tx = rWabs(state, tileXPtr);
      if (!(4 <= tx)) {
        if (D3 !== 1) {
          const v = rWabs(state, 0x400674);
          if (!(4 <= v) && !(-1 >= v)) D2 |= 0x01;
        }
      }
    }
  }
  // ── 0x16186–0x161bb: Down → bit 1 ────────────────────────────────────────
  // *0x40066e != 0 AND < 3; tileY > 4 (bge skip: branch if 4>=tileY)
  // D4 != -1; velDown in [0,3]
  {
    const i = rBabs(state, 0x40066e);
    if (i !== 0 && i < 3) {
      const ty = rWabs(state, tileYPtr);
      if (!(4 >= ty)) {
        if (D4 !== -1) {
          const v = rWabs(state, 0x400676);
          if (!(4 <= v) && !(-1 >= v)) D2 |= 0x02;
        }
      }
    }
  }
  // ── 0x161bc–0x161f1: Right → bit 2 ──────────────────────────────────────
  // *0x400670 != 0 AND < 3; tileX > 4 (bge skip: branch if 4>=tileX)
  // D3 != -1; velRight in [0,3]
  {
    const i = rBabs(state, 0x400670);
    if (i !== 0 && i < 3) {
      const tx = rWabs(state, tileXPtr);
      if (!(4 >= tx)) {
        if (D3 !== -1) {
          const v = rWabs(state, 0x400678);
          if (!(4 <= v) && !(-1 >= v)) D2 |= 0x04;
        }
      }
    }
  }
  // ── 0x161f2–0x16227: Up → bit 3 ──────────────────────────────────────────
  // *0x400672 != 0 AND < 3; tileY < 4 (ble skip: branch if 4<=tileY)
  // D4 != 1; velUp in [0,3]
  {
    const i = rBabs(state, 0x400672);
    if (i !== 0 && i < 3) {
      const ty = rWabs(state, tileYPtr);
      if (!(4 <= ty)) {
        if (D4 !== 1) {
          const v = rWabs(state, 0x40067a);
          if (!(4 <= v) && !(-1 >= v)) D2 |= 0x08;
        }
      }
    }
  }

  // ── 0x16228–0x162e7: diagonals ────────────────────────────────────────────
  // Per ogni diagonal bit: btst → position check (2 bounds) → D3/D4 exact
  // match → vel < 4 (ble skip if vel >= 4).
  // NE (bit0→D2 bit4): tileX<4, tileY>4, D3==-1, D4==1, velNE<4
  // NW (bit1→D2 bit5): tileX>4, tileY>4, D3==1, D4==1, velNW<4
  // SE (bit2→D2 bit6): tileX>4, tileY<4, D3==1, D4==-1, velSE<4
  // SW (bit3→D2 bit7): tileX<4, tileY<4, D3==-1, D4==-1, velSW<4
  // (conditions verified line-by-line from disasm 0x16228–0x162e7)
  const tileX = rWabs(state, tileXPtr);
  const tileY = rWabs(state, tileYPtr);
  const diag = rBabs(state, 0x40066a);
  if ((diag & 0x01) !== 0) { // NE
    if (!(4 <= tileX) && !(4 >= tileY) && D3 === -1 && D4 === 1)
      if (!(4 <= rWabs(state, 0x40067c))) D2 |= 0x10;
  }
  if ((diag & 0x02) !== 0) { // NW
    if (!(4 >= tileX) && !(4 >= tileY) && D3 === 1 && D4 === 1)
      if (!(4 <= rWabs(state, 0x40067e))) D2 |= 0x20;
  }
  if ((diag & 0x04) !== 0) { // SE
    if (!(4 >= tileX) && !(4 <= tileY) && D3 === 1 && D4 === -1)
      if (!(4 <= rWabs(state, 0x400680))) D2 |= 0x40;
  }
  if ((diag & 0x08) !== 0) { // SW
    if (!(4 <= tileX) && !(4 <= tileY) && D3 === -1 && D4 === -1)
      if (!(4 <= rWabs(state, 0x400682))) D2 |= 0x80;
  }

  // ── 0x162e8: charcode ────────────────────────────────────────────────────
  const charcode = rB(r, a2 + 0x58);

  // ── 0x162ec–0x163d9: dispatch D2 + whitelist ─────────────────────────────
  // D2!=0 AND charcode in whitelist → movement branch (0x16396)
  // D2==0 OR charcode not in whitelist → idle/lock branch (0x163dc)
  const movAllowed = (D2 & 0xffff) !== 0 && CHARCODE_WHITELIST.has(charcode);

  if (movAllowed) {
    // ── 0x16396–0x163d8: start / update movement ─────────────────────────
    if (rB(r, a2 + 0x36) === 0) wB(r, a2 + 0x37, 0); // clr if idle
    const dir37 = sx8(rB(r, a2 + 0x37)) & 0xffff;
    if (dir37 === (D2 & 0xffff) || rB(r, a2 + 0x36) === 2) {
      // unchanged or locked → fall through to state==1 check
    } else {
      wB(r, a2 + 0x36, 0x01);
      wW(r, a2 + 0x2e, rWabs(state, 0x400696) & 0xffff);
      wW(r, a2 + 0x30, rWabs(state, 0x400698) & 0xffff);
      wB(r, a2 + 0x37, D2 & 0xff);
      wL(r, a2 + 0x08, IMPULSE_VALUE >>> 0);
    }
  } else {
    // ── 0x163dc–0x16439: idle / lock ─────────────────────────────────────
    if ((D2 & 0xffff) !== 0) {
      // D2!=0 but charcode not whitelisted → skip to state==1 check
    } else {
      if (rB(r, a2 + 0x36) !== 2) {
        wB(r, a2 + 0x36, 0x00);
        wL(r, a2 + 0x08, 0);
        const diff = (rLs(r, a2 + 0x14) - D1) | 0;
        if (diff > TIMER_THRESHOLD) {
          wB(r, a2 + 0x36, 0x02);
          wW(r, a2 + 0x2e, rWabs(state, 0x400696) & 0xffff);
          wW(r, a2 + 0x30, rWabs(state, 0x400698) & 0xffff);
          wL(r, a2 + 0x08, IMPULSE_VALUE >>> 0);
          if (charcode !== 0x12 && charcode !== 0x20)
            subs?.soundCommand?.(SOUND_CMD);
        }
      }
    }
  }

  // ── 0x1643a: check state==1 ───────────────────────────────────────────────
  if (rB(r, a2 + 0x36) !== 1) return;

  // ── 0x16444–0x16495: abs deltas da snapshot ──────────────────────────────
  // D5w = |*0x400696 - (0x2e,A2)|
  // D6w = |*0x400698 - (0x30,A2)|
  // Replica M68k abs: tst.w; bge skip; moveq 0,D0; move.w,D0b; neg.l D0; bra
  //   else:           moveq 0,D0; move.w,D0b → D0 = zero-ext word → abs.
  // the full long if negative. Result: |signed_word| as 32-bit.
  const rawD5 = sx16((rWabs(state, 0x400696) - rWs(r, a2 + 0x2e)) & 0xffff);
  const D5 = (rawD5 < 0 ? -rawD5 : rawD5) & 0xffff;
  const rawD6 = sx16((rWabs(state, 0x400698) - rWs(r, a2 + 0x30)) & 0xffff);
  const D6 = (rawD6 < 0 ? -rawD6 : rawD6) & 0xffff;

  // 0x16482: A1 = -1 (best magnitude, none found yet)
  // 0x16486: ble skip if D5 >= 2
  if (D5 >= 2) return;
  // 0x1648e: ble skip if D6 >= 2
  if (D6 >= 2) return;

  // ── 0x16496–0x16601: inner loop ─────────────────────────────────────────
  // Iterate D3b = 0..7 (bit index). At each step:
  //   D4w = sx8(dirMask) & mask(bit)  — isolate one bit
  //   if D4w matches a valid direction (1,2,4,8,0x10,0x20,0x40,0x80):
  //     set currVel = vel for that direction (→ local[-0x2,A6])
  //     compute D1w, D2w = "closeness" scores (0..4, or 5=N/A)
  //     table lookup: pick index = min(D1w,D2w) if any < 5
  //     compare table[index] (signed byte, ext.w) with bestMag (A1)
  //     if better (or A1==-1): A1 = newMag, local[-0x4,A6] = currVel
  //
  // Initial D2w = D1w = 5 (moveq 0x5,D2; move.w D2w,D1w at 0x164a6-0x164a8)

  const dirMask = rB(r, a2 + 0x37);
  let bestMag = -1;   // A1 word signed (-1 = no candidate)
  let bestVel = 0;    // local[-0x4,A6]

  for (let bit = 0; bit < 8; bit++) {
    const isolated = (sx8(dirMask) & 0xffff) & ((1 << bit) >>> 0);
    // D2w and D1w initial = 5
    let D1w = 5;
    let D2w = 5;
    let currVel = 0;

    switch (isolated) {
      case 1: { // Left
        // 0x164b0: currVel = *0x400674
        // 0x164b8: if D5==0: D1w = tileX; else skip to 0x165a4 (D1w=5,D2w=5)
        currVel = rWabs(state, 0x400674) & 0xffff;
        if (D5 === 0) D1w = rWabs(state, tileXPtr) & 0xffff;
        else { D1w = 5; D2w = 5; } // bra → 0x165a4 immediately
        break;
      }
      case 2: { // Down
        // 0x164ca: currVel = *0x400676
        // 0x164d2: if D6==0: D1w = 7-tileY; else skip
        currVel = rWabs(state, 0x400676) & 0xffff;
        if (D6 === 0) D1w = (7 - (rWabs(state, tileYPtr) & 0xffff)) & 0xffff;
        else { D1w = 5; D2w = 5; }
        break;
      }
      case 4: { // Right
        // 0x164e6: currVel = *0x400678
        // 0x164ee: if D5==0: D1w = 7-tileX; else skip
        currVel = rWabs(state, 0x400678) & 0xffff;
        if (D5 === 0) D1w = (7 - (rWabs(state, tileXPtr) & 0xffff)) & 0xffff;
        else { D1w = 5; D2w = 5; }
        break;
      }
      case 8: { // Up
        // 0x16502: currVel = *0x40067a
        // 0x1650c: if D6==0: D1w = tileY; else skip
        currVel = rWabs(state, 0x40067a) & 0xffff;
        if (D6 === 0) D1w = rWabs(state, tileYPtr) & 0xffff;
        else { D1w = 5; D2w = 5; }
        break;
      }
      case 0x10: { // NE
        // 0x1651c: currVel = *0x40067c
        // skip if D5w==0xffff (cmp.w D5w,D0w where D0=-1; beq → skip)
        // skip if D6w==1
        // else: D1w=tileX, D2w=7-tileY
        currVel = rWabs(state, 0x40067c) & 0xffff;
        if ((D5 & 0xffff) === 0xffff || (D6 & 0xffff) === 1) {
          D1w = 5; D2w = 5;
        } else {
          D1w = rWabs(state, tileXPtr) & 0xffff;
          D2w = (7 - (rWabs(state, tileYPtr) & 0xffff)) & 0xffff;
        }
        break;
      }
      case 0x20: { // NW
        // 0x16544: currVel = *0x40067e
        // skip if D5w==1; skip if D6w==1
        // else: D1w=7-tileX, D2w=7-tileY
        currVel = rWabs(state, 0x40067e) & 0xffff;
        if ((D5 & 0xffff) === 1 || (D6 & 0xffff) === 1) {
          D1w = 5; D2w = 5;
        } else {
          D1w = (7 - (rWabs(state, tileXPtr) & 0xffff)) & 0xffff;
          D2w = (7 - (rWabs(state, tileYPtr) & 0xffff)) & 0xffff;
        }
        break;
      }
      case 0x40: { // SE
        // 0x1656a: currVel = *0x400680
        // skip if D5w==1; skip if D6w==0xffff
        // else: D1w=7-tileX, D2w=tileY
        currVel = rWabs(state, 0x400680) & 0xffff;
        if ((D5 & 0xffff) === 1 || (D6 & 0xffff) === 0xffff) {
          D1w = 5; D2w = 5;
        } else {
          D1w = (7 - (rWabs(state, tileXPtr) & 0xffff)) & 0xffff;
          D2w = rWabs(state, tileYPtr) & 0xffff;
        }
        break;
      }
      case 0x80: { // SW
        // 0x1658c: currVel = *0x400682
        // skip if D5w==0xffff; skip if D6w==0xffff
        // else: D1w=tileX, D2w=tileY
        currVel = rWabs(state, 0x400682) & 0xffff;
        if ((D5 & 0xffff) === 0xffff || (D6 & 0xffff) === 0xffff) {
          D1w = 5; D2w = 5;
        } else {
          D1w = rWabs(state, tileXPtr) & 0xffff;
          D2w = rWabs(state, tileYPtr) & 0xffff;
        }
        break;
      }
      default:
        continue; // isolated == 0 → skip iteration
    }

    // ── 0x165a4–0x165f7: table lookup + best update ──────────────────────
    // Replicate branchy index selection from disasm (see header analysis).
    // Skip if both D1w >= 5 and D2w >= 5.
    // Index priority: D1 if D1<5 AND D1>D2; else D2 if D2<5; else D1.
    let tableIdx: number;
    if (D1w < 5) {
      if (D1w > D2w) {
        tableIdx = D1w; // 0x165c4: use D1
      } else if (D2w < 5) {
        tableIdx = D2w; // 0x165d4: use D2
      } else {
        tableIdx = D1w; // D2>=5, D1<=D2 but D1<5: use D1 (0x165c4 via fallthrough)
      }
    } else if (D2w < 5) {
      tableIdx = D2w; // D1>=5, D2<5 → 0x165d4
    } else {
      continue; // both >=5: ble 0x165f8 → skip to next iter
    }

    // ROM table lookup: signed byte ext.w
    const romAddr = ROM_SPEED_TABLE + (tableIdx & 0xffff);
    const mag = sx8(subs?.romByte?.(romAddr) ?? 0) & 0xffff;

    // 0x165e4: if A1==-1 (beq) OR mag > A1 (cmpa.w D2w,A1; bgt) → update
    // cmpa.w D2w,A1: A1-D2w; bgt: A1>D2w → NOT branch → no update.
    // ble: branch if A1<=D2w → skip (no update). So update if A1==-1 OR mag>A1.
    const magS = sx16(mag);
    if (bestMag === -1 || magS > bestMag) {
      bestMag = magS;
      bestVel = currVel;
    }
  } // for bit

  // ── 0x16602–0x1664f: apply / miss ────────────────────────────────────────
  if (bestMag === -1) {
    // No direction found → lock
    wB(r, a2 + 0x36, 0x02);
    wL(r, a2 + 0x08, IMPULSE_VALUE >>> 0);
    if (charcode !== 0x12 && charcode !== 0x20)
      subs?.soundCommand?.(SOUND_CMD);
  } else {
    // 0x16608: D1=sx16(bestVel); D0=sx16(bestMag); diff=D1-D0; if diff<=0 skip
    // 0x16618: (0x14,A2) += diff << 16
    const D0l = sx16(bestMag);
    const D1l = sx16(bestVel);
    const diff = (D1l - D0l) | 0;
    if (diff > 0) {
      wL(r, a2 + 0x14, (rLs(r, a2 + 0x14) + ((diff << 16) | 0)) >>> 0);
    }
  }
  // epilog: return
}

export { stateDispatch160F6 as FUN_000160F6 };
