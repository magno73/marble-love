/**
 * sub-29cce.ts — `FUN_00029CCE` replica (collision pipeline,
 *                5364 bytes / 1679 instructions, range 0x29CCE..0x2B22F).
 *
 * **Caller**: `helper121B8` ELSE-branch — invoked once per slot during the
 * pipeline INTEGRATE_VEL → spritePosUpdate → fun_29cce.
 *
 * **Architecture**:
 *  - PROLOGUE (0x29cce..0x29d48): saves globals 0x690/0x692/0x694/0x696/
 *  - LOOP outer su 25 slot a stride 0x56, iter `(-0x1,A6)` da 0..0x18:
 *      tst.b (0x18,A3); beq → iter advance.
 *      D6 = (0xc,A3)w - g690, A0 = (0x10,A3)w - g692
 *      D1 = (0xc,A3)w >> 3 - g696, D2 = (0x10,A3)w >> 3 - g698
 *      Color tag = (0x1f,A3); range-check 5..0x3b; jump table @ 0x29db4.
 *  - 56 BLOCKs per color tag (boundary check, kick, respawn, bounce):
 *      Other tags (0x05 0x0a 0x0b 0x0c 0x0d 0x13..0x16 0x1a..0x1f 0x20..0x22
 *      0x23..0x27) run complex logic (bounce, respawn, sound).
 *  - Each branch ends with `bra.w 0x2b072` (iteration advance).
 *    0x666/0x668: if != 0 -> restore x/y + neg.l vx/vy.
 *
 * **Replica scope**: PROLOGUE + outer LOOP + all 25 iterations + jump table
 * sound-pair and script kick. **BLOCK 0x12..0x16 and 0x20..0x27** cover the
 * Beginner pipes with teleport and `helper1CD00` shape collision. **BLOCK
 * 0x05** implements the proximity bumper with X/Y flags and sound 0x42.
 * **BLOCK 0x0b/0x0d** implement the observed Aerial gate/bumper collisions
 * and dynamic pipe/wall collisions with X/Y flags and sound 0x42. Other
 * **complex BLOCKs with sub-calls** (sound, helper25C74, divs.w bounce)
 * remain fallthrough no-ops (= bra 0x2b072), reducing drift from missing tags.
 *
 * **MAME f12000+ analysis (active demo gameplay)** — `/tmp/mame_100f.json`:
 * For obj0 (player1 @ 0x400018), during 100 demo gameplay frames,
 * s36=0 (bounce mode), s1a=0 (player normal state), s57=0 (sound code).
 * obj0.vx oscillates in a narrow range (0x23339..0x235FE, ±0x1FF) around
 *      respawn, sound 0x43/0x44) triggers — `neg.l vx/vy` flows in the
 *   2. The OUT_OF_RANGE path in `helper121B8` (gate
 *      `spriteProject1CC62(0) - obj.z > 0x100000`) does not trigger for obj0.
 *      Zeroing obj+0x00/obj+0x04 (vx/vy) in the common prologue of
 *
 *
 *     `(0xc,A3)w = (workRam[ofs+0]<<8) | workRam[ofs+1]` (= upper word of
 *   - jmp via PC+offset+D0w*1: D0w = jt[index*2], jmp 0x29db4 + D0w (sign-ext).
 *
 * **Used sub-callees**:
 *  - FUN_158AC = `soundCmdSend158AC` (byte argument)
 *  - FUN_2648C = `copyGlobalsToObj` (for BLOCK 0x0a catapult two-player wait)
 *  - FUN_15884 = `soundPair15884` (for BLOCK 0x0a catapult launch)
 *  - FUN_12896 = `helper12896` (for catapult arm script)
 *  - FUN_1CD00 = `helper1CD00` (Beginner pipe shape collision).
 *  - others (helper25C74, etc.) — only in complex BLOCKs that remain
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { helper12896 } from "./helper-12896.js";
import { helper1CD00 } from "./helper-1cd00.js";
import { helper25C74 } from "./helper-25c74.js";
import { copyGlobalsToObj } from "./object-helpers.js";
import { recordObjectStateEntryDebug } from "./object-state-debug.js";
import { objectStateEntry25BAE } from "./object-state-entry-25bae.js";
import { randomMod13A98 } from "./random-mod-13a98.js";
import { soundCmdSend158AC } from "./sound-cmd-send-158ac.js";
import { soundPair15884 } from "./sound-pair-15884.js";
import { spritePosUpdate1BAB2 } from "./sprite-pos-update-1bab2.js";
import { spriteProject1CC62 } from "./sprite-project-1cc62.js";
import { stateSub15BD0 } from "./state-sub-15bd0.js";
import { stringHelper17CB8 } from "./string-helper-17cb8.js";
import { sub1CABATileRedraw } from "./sub-1caba-tile-redraw.js";

const WORK_RAM_BASE = 0x00400000;

// Slot field offsets (A2 — caller's slot)
const F_VX  = 0x00;
const F_VY  = 0x04;
const F_VZ  = 0x08;
const F_X   = 0x0c;
const F_Y   = 0x10;
const F_Z   = 0x14;
const F_TYPE = 0x19;
const F_STATE_1A = 0x1a;
const F_STATE_36 = 0x36;
const F_S58 = 0x58;
const F_S59 = 0x59;

// Globals (workRam offsets, base 0x400000)
const G_FLAG_X    = 0x0666; // *(0x400666) → trigger neg.l vx
const G_FLAG_Y    = 0x0668; // *(0x400668) → trigger neg.l vy
const G_X_RESTORE = 0x0684; // *(0x400684) → restore (0xc,A2)
const G_Y_RESTORE = 0x0688; // *(0x400688) → restore (0x10,A2)
const G_Z_RESTORE = 0x068c; // *(0x40068c) → restore/current z helper
const G_690       = 0x0690; // *(0x400690) word
const G_692       = 0x0692; // *(0x400692) word
const G_694       = 0x0694; // *(0x400694) word
const G_696       = 0x0696; // *(0x400696) word
const G_698       = 0x0698; // *(0x400698) word

// Slot table: A3=0x400a9c, stride 0x56, fields:
//   (0x18,A3) : tst → beq 0x2b0f6, advance to the next slot
//   (0xc,A3)w : world X upper word (16 bit signed)
//   (0x10,A3)w: world Y upper word
//   (0x1f,A3) : color tag (drives jump table)
const SLOT_TABLE_BASE = 0x400a9c;
const SLOT_STRIDE     = 0x56;
const SLOT_COUNT      = 0x19; // 25 iterations
const SF_S18 = 0x18;
const SF_X   = 0x0c;
const SF_Y   = 0x10;
const SF_C   = 0x1f;
const SF_TIMER_1C = 0x1c;
const SF_PC_36    = 0x36;
const SF_REC_3E   = 0x3e;
const SF_BASE_46  = 0x46;

const OBJ_COUNT = 0x0396;
const PLAYER_PTR_TABLE = 0x0001eff6;
const PLAYER1_OBJ = 0x00400018;
const PLAYER2_OBJ = 0x004000fa;
const CATAPULT_SCRIPT = 0x0001db80;

type DispatchResult = "continue" | "return";

interface ShapeCollisionDebugContext {
  colorTag: number;
  d1: number;
  d2: number;
  d6: number;
  a0: number;
}

// ─── Helpers byte/word/long M68k big-endian ──────────────────────────────

function rB(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}
function wB(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}
function rWBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off]     ?? 0) << 8) |
      (state.workRam[off + 1] ?? 0)) & 0xffff
  );
}
function rL(state: GameState, off: number): number {
  return (
    (((state.workRam[off]     ?? 0) << 24) |
     ((state.workRam[off + 1] ?? 0) << 16) |
     ((state.workRam[off + 2] ?? 0) <<  8) |
      (state.workRam[off + 3] ?? 0)) >>> 0
  );
}
function wL(state: GameState, off: number, v: number): void {
  const u = v >>> 0;
  state.workRam[off]     = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>>  8) & 0xff;
  state.workRam[off + 3] =  u         & 0xff;
}

function romL(rom: RomImage, off: number): number {
  return (
    (((rom.program[off]     ?? 0) << 24) |
     ((rom.program[off + 1] ?? 0) << 16) |
     ((rom.program[off + 2] ?? 0) <<  8) |
      (rom.program[off + 3] ?? 0)) >>> 0
  );
}

function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + state.workRam.length) {
    return rB(state, a - WORK_RAM_BASE);
  }
  if (a < rom.program.length) return (rom.program[a] ?? 0) & 0xff;
  return 0;
}

function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a + 4 <= WORK_RAM_BASE + state.workRam.length) {
    return rL(state, a - WORK_RAM_BASE);
  }
  if (a + 4 <= rom.program.length) return romL(rom, a);
  return 0;
}

// sign-extend word (16-bit two's complement) to a JS-signed integer.
function sextW(w: number): number {
  const u = w & 0xffff;
  return u >= 0x8000 ? u - 0x10000 : u;
}

function sextB(b: number): number {
  const u = b & 0xff;
  return u >= 0x80 ? u - 0x100 : u;
}

// asr.w by 3 (signed arith shift right, returns 16-bit unsigned)
function asrW3(w: number): number {
  return (sextW(w) >> 3) & 0xffff;
}

// neg.l (signed two's complement negation, 32-bit).
function negL(v: number): number {
  return ((-(v | 0)) | 0) >>> 0;
}

function recordTerrainSlotDebug(
  state: GameState,
  a2Off: number,
  a3Off: number,
  colorTag: number,
  reason: string,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  vxBefore: number,
  vyBefore: number,
): void {
  state.debug ??= {};
  state.debug.lastTerrainSlotCollision = {
    frame: Number(state.clock.frame),
    entityAddr: (WORK_RAM_BASE + a2Off) >>> 0,
    slotIndex: Math.floor((a3Off - (SLOT_TABLE_BASE - WORK_RAM_BASE)) / SLOT_STRIDE),
    slotAddr: (WORK_RAM_BASE + a3Off) >>> 0,
    colorTag,
    reason,
    d1,
    d2,
    d6,
    a0,
    slotX: sextW(rWBE(state, a3Off + SF_X)),
    slotY: sextW(rWBE(state, a3Off + SF_Y)),
    slotZ: sextW(rWBE(state, a3Off + 0x14)),
    entityX: rL(state, a2Off + F_X) | 0,
    entityY: rL(state, a2Off + F_Y) | 0,
    entityZ: rL(state, a2Off + 0x14) | 0,
    entityVxBefore: vxBefore | 0,
    entityVyBefore: vyBefore | 0,
    flagX: rB(state, G_FLAG_X),
    flagY: rB(state, G_FLAG_Y),
  };
}

function recordTubeProbeDebug(
  state: GameState,
  a2Off: number,
  a3Off: number,
  colorTag: number,
  result: string,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
): void {
  state.debug ??= {};
  state.debug.lastTubeProbe = {
    frame: Number(state.clock.frame),
    entityAddr: (WORK_RAM_BASE + a2Off) >>> 0,
    slotIndex: Math.floor((a3Off - (SLOT_TABLE_BASE - WORK_RAM_BASE)) / SLOT_STRIDE),
    slotAddr: (WORK_RAM_BASE + a3Off) >>> 0,
    colorTag,
    result,
    d1,
    d2,
    d6,
    a0,
    slotX: sextW(rWBE(state, a3Off + SF_X)),
    slotY: sextW(rWBE(state, a3Off + SF_Y)),
    slotZ: sextW(rWBE(state, a3Off + 0x14)),
    entityX: rL(state, a2Off + F_X) | 0,
    entityY: rL(state, a2Off + F_Y) | 0,
    entityZ: rL(state, a2Off + F_Z) | 0,
    entityVx: rL(state, a2Off + F_VX) | 0,
    entityVy: rL(state, a2Off + F_VY) | 0,
    entityVz: rL(state, a2Off + F_VZ) | 0,
    state36: rB(state, a2Off + F_STATE_36),
    state1a: rB(state, a2Off + F_STATE_1A),
    f58: rB(state, a2Off + F_S58),
    f59: rB(state, a2Off + F_S59),
  };
}

function recordTerrainScanStopDebug(
  state: GameState,
  a2Off: number,
  a3Off: number,
  reason: string,
  iterCount: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
): void {
  const entityPtr = WORK_RAM_BASE + a2Off;
  if (entityPtr !== PLAYER1_OBJ && entityPtr !== PLAYER2_OBJ) return;
  state.debug ??= {};
  state.debug.lastTerrainScanStop = {
    frame: Number(state.clock.frame),
    entityAddr: entityPtr >>> 0,
    reason,
    iterCount,
    slotIndex: Math.floor((a3Off - (SLOT_TABLE_BASE - WORK_RAM_BASE)) / SLOT_STRIDE),
    slotAddr: (WORK_RAM_BASE + a3Off) >>> 0,
    active: rB(state, a3Off + SF_S18),
    slotState: rB(state, a3Off + F_STATE_1A),
    colorTag: rB(state, a3Off + SF_C),
    d1,
    d2,
    d6,
    a0,
    f58: rB(state, a2Off + F_S58),
    f59: rB(state, a2Off + F_S59),
    slotX: sextW(rWBE(state, a3Off + SF_X)),
    slotY: sextW(rWBE(state, a3Off + SF_Y)),
    slotZ: sextW(rWBE(state, a3Off + F_Z)),
    entityX: rL(state, a2Off + F_X) | 0,
    entityY: rL(state, a2Off + F_Y) | 0,
    entityZ: rL(state, a2Off + F_Z) | 0,
  };
}

function recordTerrainGateProbeDebug(
  state: GameState,
  a2Off: number,
  a3Off: number,
  colorTag: number,
  result: string,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  g694: number,
  prevD6?: number,
  prevA0?: number,
  zRestore?: number,
): void {
  const entityPtr = WORK_RAM_BASE + a2Off;
  if (entityPtr !== PLAYER1_OBJ && entityPtr !== PLAYER2_OBJ) return;
  state.debug ??= {};
  const existing = state.debug.lastTerrainGateProbe;
  if (
    existing !== undefined &&
    existing.frame === Number(state.clock.frame) &&
    gateProbePriority(existing.result) > gateProbePriority(result)
  ) {
    return;
  }
  state.debug.lastTerrainGateProbe = {
    frame: Number(state.clock.frame),
    entityAddr: entityPtr >>> 0,
    slotIndex: Math.floor((a3Off - (SLOT_TABLE_BASE - WORK_RAM_BASE)) / SLOT_STRIDE),
    slotAddr: (WORK_RAM_BASE + a3Off) >>> 0,
    colorTag,
    result,
    slotState: rB(state, a3Off + F_STATE_1A),
    base46: rL(state, a3Off + SF_BASE_46),
    d1,
    d2,
    d6,
    a0,
    g694,
    prevD6,
    prevA0,
    zRestore,
    flagX: rB(state, G_FLAG_X),
    flagY: rB(state, G_FLAG_Y),
    slotX: sextW(rWBE(state, a3Off + SF_X)),
    slotY: sextW(rWBE(state, a3Off + SF_Y)),
    entityX: rL(state, a2Off + F_X) | 0,
    entityY: rL(state, a2Off + F_Y) | 0,
    entityVx: rL(state, a2Off + F_VX) | 0,
    entityVy: rL(state, a2Off + F_VY) | 0,
    entityState: rB(state, a2Off + F_STATE_1A),
    entityS58: rB(state, a2Off + F_S58),
  };
}

function recordTerrainWaveCandidateDebug(
  state: GameState,
  a2Off: number,
  a3Off: number,
  colorTag: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
): void {
  const entityPtr = WORK_RAM_BASE + a2Off;
  if (entityPtr !== PLAYER1_OBJ && entityPtr !== PLAYER2_OBJ) return;
  const denominator = weightedVectorDenominator(d6, a0);
  const existing = state.debug?.lastTerrainWaveCandidate;
  if (
    existing !== undefined &&
    existing.frame === Number(state.clock.frame) &&
    existing.entityAddr === entityPtr &&
    existing.denominator <= denominator
  ) {
    return;
  }
  state.debug ??= {};
  state.debug.lastTerrainWaveCandidate = {
    frame: Number(state.clock.frame),
    entityAddr: entityPtr >>> 0,
    slotIndex: Math.floor((a3Off - (SLOT_TABLE_BASE - WORK_RAM_BASE)) / SLOT_STRIDE),
    slotAddr: (WORK_RAM_BASE + a3Off) >>> 0,
    colorTag,
    d1,
    d2,
    d6,
    a0,
    denominator,
    f58: rB(state, a2Off + F_S58),
    flagX: rB(state, G_FLAG_X),
    flagY: rB(state, G_FLAG_Y),
    slotX: sextW(rWBE(state, a3Off + SF_X)),
    slotY: sextW(rWBE(state, a3Off + SF_Y)),
    entityX: rL(state, a2Off + F_X) | 0,
    entityY: rL(state, a2Off + F_Y) | 0,
  };
}

function gateProbePriority(result: string): number {
  if (result === "outer-death-state4") return 5;
  if (result === "inner-hit-state" || result === "inner-impulse" || result === "outer-block-flags") return 4;
  if (result === "outer-range-x-miss" || result === "outer-range-y-miss" || result === "height-gate-miss") return 2;
  if (result === "guard-miss") return 1;
  return 0;
}

// "WHITE-LIST" boundary-tag values used by both the iter-epilog (0x2b072)
// and the final epilog (0x2b108).
function isMatchEpilog(b: number): boolean {
  // For final epilog dispatch (0x2b10c..0x2b150) — set: {0x10, 0x17, 0x18,
  // 0x32..0x37}
  return b === 0x10 || b === 0x17 || b === 0x18 ||
         b === 0x32 || b === 0x33 || b === 0x34 ||
         b === 0x35 || b === 0x36 || b === 0x37;
}

// For iter-epilog (0x2b072..0x2b108) — superset of the above PLUS:
//   {0, 0x10, 0x3b, 0x17, 0x18, 0x32-0x37, 0x2d, 0x2e, 0x38, 0x39, 0x3a,
//    0x2f, 0x30, 0x31}
function isMatchIter(b: number): boolean {
  if (b === 0) return true; // beq.w 0x0002b0f6 (first cmp)
  return (
    b === 0x10 || b === 0x3b ||
    b === 0x17 || b === 0x18 ||
    b === 0x32 || b === 0x33 || b === 0x34 ||
    b === 0x35 || b === 0x36 || b === 0x37 ||
    b === 0x2d || b === 0x2e ||
    b === 0x38 || b === 0x39 || b === 0x3a ||
    b === 0x2f || b === 0x30 || b === 0x31
  );
}

// ─── Sub-injection interface ────────────────────────────────────────────

export interface Sub29CCESubs {
  /** FUN_158AC — sound mailbox send. */
  soundCmdSend158AC?: (state: GameState, byteArg: number) => number;
}


/** ROM address of `FUN_00029CCE`. @public */
export const SUB_29CCE_ADDR = 0x00029cce as const;

/**
 * Replica of `FUN_00029CCE`.
 *
 */
export function fun29CCE(
  state: GameState,
  slotPtr: number,
  rom: RomImage,
  subs: Sub29CCESubs = {},
): void {
  const a2 = slotPtr >>> 0;
  const a2Off = (a2 - WORK_RAM_BASE) >>> 0;

  // ── PROLOGUE side-effect (0x29d32..0x29d36) ───────────────────────────
  // clr.b  (0x58,A2)       ; reset collision tag
  const d3 = rB(state, a2Off + F_S58);
  wB(state, a2Off + F_S58, 0);

  // ── PROLOGUE: snapshot globals (0x29cec..0x29d2a) ─────────────────────
  // Servono al loop outer (D6/A0/D1/D2 setup).
  const g690 = rWBE(state, G_690);
  const g692 = rWBE(state, G_692);
  const g694 = rWBE(state, G_694);
  const initialVx = rL(state, a2Off + F_VX);
  const initialVy = rL(state, a2Off + F_VY);
  const g696 = rWBE(state, G_696);
  const g698 = rWBE(state, G_698);

  // ── PROLOGUE A3 setup (0x29d3a..0x29d48) ──────────────────────────────
  // Outer loop: A3 = 0x400a9c, iter = 0..0x18.
  // tst.b (0x18,A3); beq.w → 0x2b0f6 (iter advance).
  let a3Abs = SLOT_TABLE_BASE;
  let iterCount = 0;

  // Outer loop. Each iter dispatches via jump table; the tag-write
  // determines whether we continue (advance A3 + iter) or break.
  outer:
  while (iterCount < SLOT_COUNT) {
    const a3Off = (a3Abs - WORK_RAM_BASE) >>> 0;
    if (rB(state, a3Off + SF_S18) === 0) {
      a3Abs = (a3Abs + SLOT_STRIDE) >>> 0;
      iterCount++;
      continue;
    }

    // Compute D6, A0 (delta vs viewport globals): both are 16-bit signed.
    const slotX_w = rWBE(state, a3Off + SF_X);
    const slotY_w = rWBE(state, a3Off + SF_Y);
    const d6 = sextW((slotX_w - g690) & 0xffff);
    const a0 = sextW((slotY_w - g692) & 0xffff);
    const d1  = sextW((asrW3(slotX_w) - g696) & 0xffff);
    const d2  = sextW((asrW3(slotY_w) - g698) & 0xffff);

    // 0x29d80..0x29d9c: color tag dispatch
    //  D0b = (0x1f,A3); ext.w; ext.l; cmp 5..0x3b → blt/bgt 0x2b072 (skip)
    const colorTag = rB(state, a3Off + SF_C);
    const colorTagSx = colorTag >= 0x80 ? colorTag - 0x100 : colorTag;

    if (colorTagSx >= 5 && colorTagSx <= 0x3b) {
      if (colorTag === 0x05 || colorTag === 0x06) {
        recordTerrainWaveCandidateDebug(state, a2Off, a3Off, colorTag, d1, d2, d6, a0);
      }
      const tagBefore = rB(state, a2Off + F_S58);
      const flagXBefore = rB(state, G_FLAG_X);
      const flagYBefore = rB(state, G_FLAG_Y);
      const vxBefore = rL(state, a2Off + F_VX);
      const vyBefore = rL(state, a2Off + F_VY);
      const vzBefore = rL(state, a2Off + F_VZ);
      const zBefore = rL(state, a2Off + F_Z);
      const state36Before = rB(state, a2Off + F_STATE_36);
      const dispatchResult = dispatchColor(state, rom, a2Off, a3Off, colorTag, d1, d2, d6, a0, g694, initialVx, initialVy, subs);
      const tagAfter = rB(state, a2Off + F_S58);
      const flagXAfter = rB(state, G_FLAG_X);
      const flagYAfter = rB(state, G_FLAG_Y);
      const motionChanged =
        rL(state, a2Off + F_VX) !== vxBefore ||
        rL(state, a2Off + F_VY) !== vyBefore ||
        rL(state, a2Off + F_VZ) !== vzBefore ||
        rL(state, a2Off + F_Z) !== zBefore ||
        rB(state, a2Off + F_STATE_36) !== state36Before;
      if (tagAfter !== tagBefore || flagXAfter !== flagXBefore || flagYAfter !== flagYBefore || motionChanged) {
        const reason = flagXAfter !== flagXBefore || flagYAfter !== flagYBefore ? "flag" : tagAfter !== tagBefore ? "tag" : "motion";
        recordTerrainSlotDebug(state, a2Off, a3Off, colorTag, reason, d1, d2, d6, a0, vxBefore, vyBefore);
      }
      if (dispatchResult === "return") {
        recordTerrainScanStopDebug(state, a2Off, a3Off, "dispatch-return", iterCount, d1, d2, d6, a0);
        return;
      }
    }

    // 0x2b072: iter-epilog. Read `(0x58,A2)`. WHITE-LIST → advance iter.
    // Otherwise → break.
    const tag = rB(state, a2Off + F_S58);
    if (!isMatchIter(tag)) {
      recordTerrainScanStopDebug(state, a2Off, a3Off, "iter-tag-break", iterCount, d1, d2, d6, a0);
      break outer;
    }

    // 0x2b0f6: A3 += 0x56; (-0x1,A6)++; cmp 0x19; bne loop_top.
    a3Abs = (a3Abs + SLOT_STRIDE) >>> 0;
    iterCount++;
  }
  if (iterCount >= SLOT_COUNT) {
    const lastOff = (SLOT_TABLE_BASE - WORK_RAM_BASE + (SLOT_COUNT - 1) * SLOT_STRIDE) >>> 0;
    recordTerrainScanStopDebug(state, a2Off, lastOff, "slot-count", iterCount, 0, 0, 0, 0);
  }

  // ── EPILOGUE post-loop dispatch (0x2b108..0x2b1f8) ────────────────────
  const d0 = rB(state, a2Off + F_S58);
  if (isMatchEpilog(d0)) {
    if (!isMatchEpilog(d3)) {
      (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, 0x43);
    }
  } else {
    if (isMatchEpilog(d3)) {
      (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, 0x44);
    }
  }

  // ── 0x2b1f8..0x2b22e: final flag check + neg.l vx/vy ──────────────────
  if (rB(state, G_FLAG_X) !== 0) {
    wL(state, a2Off + F_X, rL(state, G_X_RESTORE));
    wL(state, a2Off + F_VX, negL(rL(state, a2Off + F_VX)));
  }
  if (rB(state, G_FLAG_Y) !== 0) {
    wL(state, a2Off + F_Y, rL(state, G_Y_RESTORE));
    wL(state, a2Off + F_VY, negL(rL(state, a2Off + F_VY)));
  }
}

// ─── Jump table dispatch ─────────────────────────────────────────────────

/**
 * Helper: write boundary tag if D1/D2 fall in given ranges.
 *   if (d1Lo <= D1 < d1Hi) AND (d2Lo <= D2 < d2Hi):
 *     (0x58,A2) = (0x1f,A3) (= colorTag)
 *     (0x59,A2) = -1
 *
 * NB: M68k semantics use signed compares (`tst.w D1; blt`, `cmp; ble`).
 */
function rangeWrite(
  state: GameState,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  d1Lo: number, d1Hi: number,
  d2Lo: number, d2Hi: number,
): void {
  if (d1 < d1Lo || d1 >= d1Hi) return;
  if (d2 < d2Lo || d2 >= d2Hi) return;
  // move.b (0x1f,A3),(0x58,A2)
  wB(state, a2Off + F_S58, rB(state, a3Off + SF_C));
  // move.b #-0x1,(0x59,A2)
  wB(state, a2Off + F_S59, 0xff);
}

function objectPtrForPlayerIndex(rom: RomImage, playerIndex: number): number {
  const tablePtr = romL(rom, PLAYER_PTR_TABLE + playerIndex * 4);
  if (tablePtr >= WORK_RAM_BASE && tablePtr < WORK_RAM_BASE + 0x2000) {
    return tablePtr >>> 0;
  }
  return playerIndex === 0 ? PLAYER1_OBJ : PLAYER2_OBJ;
}

function runCatapult0A(
  state: GameState,
  rom: RomImage,
  a2Off: number,
  a3Off: number,
  d6: number,
  a0: number,
  subs: Sub29CCESubs,
): void {
  // 0x29e22..0x29e3e: tight center hitbox, using viewport deltas.
  if (d6 <= -0x08) return;
  if (d6 >=  0x08) return;
  if (a0 <= -0x08) return;
  if (a0 >=  0x08) return;

  // The original only launches when the marble is grounded.
  if (rL(state, a2Off + F_VZ) !== 0) return;

  // If the catapult script is already away from its base frame, the original
  // just restores the marble's saved XY and leaves the arm alone.
  if (
    rL(state, a3Off + SF_REC_3E) !== rL(state, a3Off + SF_BASE_46) ||
    rWBE(state, a3Off + SF_TIMER_1C) !== 0
  ) {
    wL(state, a2Off + F_X, rL(state, G_X_RESTORE));
    wL(state, a2Off + F_Y, rL(state, G_Y_RESTORE));
    return;
  }

  // Two-player guard: if the other marble is already on a catapult arm, this
  // object snaps to the saved globals and waits instead of launching too.
  if (rWBE(state, OBJ_COUNT) === 2) {
    const playerIndex = rB(state, a2Off + F_TYPE);
    if (playerIndex === 0 || playerIndex === 1) {
      const otherPtr = objectPtrForPlayerIndex(rom, 1 - playerIndex);
      const otherOff = (otherPtr - WORK_RAM_BASE) >>> 0;
      if (
        otherPtr >= WORK_RAM_BASE &&
        otherPtr < WORK_RAM_BASE + 0x2000 &&
        rB(state, otherOff + 0x18) === 1 &&
        rB(state, otherOff + F_S58) === 0x0a
      ) {
        copyGlobalsToObj(state, WORK_RAM_BASE + a2Off);
        wL(state, a2Off + F_VX, 0);
        wL(state, a2Off + F_VY, 0);
        return;
      }
    }
  }

  // 0x29ea8..0x29f1e: real catapult launch. This is the missing physical
  // piece: snap to the arm, lift the Z baseline, inject velocity, tag object,
  // then start the catapult script at 0x1DB80.
  wL(state, a2Off + F_X, rL(state, a3Off + SF_X));
  wL(state, a2Off + F_Y, rL(state, a3Off + SF_Y));
  wL(state, a2Off + F_Z, (rL(state, a2Off + F_Z) - 0x00030000) >>> 0);
  wL(state, a2Off + F_VZ, 0x000a0000);
  wL(state, a2Off + F_VX, ((randomMod13A98(state, 0x2000) - 0x1000) | 0) >>> 0);
  wL(state, a2Off + F_VY, ((-0x25000 - randomMod13A98(state, 0xa000)) | 0) >>> 0);
  wB(state, a2Off + F_STATE_36, 0x02);

  soundPair15884(state, {
    soundCommand: (cmd) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, cmd); },
  });

  wB(state, a2Off + F_STATE_1A, 0x03);
  wB(state, a2Off + F_S58, rB(state, a3Off + SF_C));
  wB(state, a2Off + F_S59, 0x0f);

  wL(state, a3Off + SF_PC_36, CATAPULT_SCRIPT);
  helper12896(state, rom, WORK_RAM_BASE + a3Off, {
    fun158ac: (st, arg) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(st, arg); },
  });
}

function collisionSound42(state: GameState, subs: Sub29CCESubs): void {
  (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, 0x42);
}

function runVerticalWallCollision(
  state: GameState,
  d6: number,
  a0: number,
  xLo: number,
  xHi: number,
  yLo: number,
  yHi: number,
  initialVy: number,
  subs: Sub29CCESubs,
): void {
  if (a0 <= yLo) return;
  if (a0 >= yHi) return;
  if (d6 <= xLo) return;
  if (d6 >= xHi) return;

  const vy = initialVy | 0;
  const hitsTop = a0 > yLo && a0 < yLo + 8 && vy < 0;
  const hitsBottom = a0 > yHi - 8 && a0 < yHi && vy > 0;
  if (hitsTop || hitsBottom) {
    wB(state, G_FLAG_Y, 1);
  }
  wB(state, G_FLAG_X, 1);
  collisionSound42(state, subs);
}

function absWordShift4(value: number): number {
  return (Math.abs(sextW(value)) << 4) & 0xffff;
}

function divsWord(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return (Math.trunc(numerator / denominator) << 16) >> 16;
}

function weightedVectorDenominator(dx: number, dy: number): number {
  const xAbs = absWordShift4(dx);
  const yAbs = absWordShift4(dy);
  return xAbs > yAbs
    ? ((((yAbs >>> 3) * 3) + xAbs) & 0xffff)
    : ((((xAbs >>> 3) * 3) + yAbs) & 0xffff);
}

function addScaledGateImpulse(
  state: GameState,
  a2Off: number,
  dx: number,
  dy: number,
): void {
  const denom = weightedVectorDenominator(dx, dy);
  const qx = denom === 0 ? 0 : divsWord(dx << 16, denom);
  const qy = denom === 0 ? 0 : divsWord(dy << 16, denom);
  wL(state, a2Off + F_VX, (rL(state, a2Off + F_VX) + ((qx << 2) >>> 0)) >>> 0);
  wL(state, a2Off + F_VY, (rL(state, a2Off + F_VY) + ((qy << 2) >>> 0)) >>> 0);
}

function runProximityBumper05(
  state: GameState,
  d6: number,
  a0: number,
  subs: Sub29CCESubs,
): void {
  if (weightedVectorDenominator(d6, a0) >= 0x38) return;
  wB(state, G_FLAG_Y, 1);
  wB(state, G_FLAG_X, 1);
  (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, 0x42);
}

function slotPreviousDeltas(state: GameState, a3Off: number): [number, number] {
  return [
    sextW((rWBE(state, a3Off + SF_X) - rWBE(state, G_X_RESTORE)) & 0xffff),
    sextW((rWBE(state, a3Off + SF_Y) - rWBE(state, G_Y_RESTORE)) & 0xffff),
  ];
}

function enterState4FromGate(
  state: GameState,
  a2Off: number,
  a3Off: number,
  colorTag: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  subs: Sub29CCESubs,
): void {
  wB(state, a2Off + 0x57, 0x65);
  recordObjectStateEntryDebug(state, WORK_RAM_BASE + a2Off, 4, "FUN_29CCE/gate-bumper", {
    slotIndex: Math.floor((a3Off - (SLOT_TABLE_BASE - WORK_RAM_BASE)) / SLOT_STRIDE),
    colorTag,
    d1,
    d2,
    d6,
    a0,
  });
  objectStateEntry25BAE(state, WORK_RAM_BASE + a2Off, 4, {
    soundCommand: (cmd) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, cmd); },
  });
}

function runGateOuterBlockOrDeath(
  state: GameState,
  a2Off: number,
  a3Off: number,
  colorTag: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  g694: number,
  subs: Sub29CCESubs,
): void {
  if (d6 < -0x0c || d6 >= 0x1c) {
    recordTerrainGateProbeDebug(state, a2Off, a3Off, colorTag, "outer-range-x-miss", d1, d2, d6, a0, g694);
    return;
  }
  if (a0 < -0x08 || a0 >= 0x10) {
    recordTerrainGateProbeDebug(state, a2Off, a3Off, colorTag, "outer-range-y-miss", d1, d2, d6, a0, g694);
    return;
  }
  if (g694 >= 0x3fc4) {
    recordTerrainGateProbeDebug(state, a2Off, a3Off, colorTag, "height-gate-miss", d1, d2, d6, a0, g694);
    return;
  }

  const [prevD6, prevA0] = slotPreviousDeltas(state, a3Off);
  const zRestore = rWBE(state, G_Z_RESTORE);
  if (
    prevD6 >= -0x0c &&
    prevD6 < 0x1c &&
    prevA0 >= -0x08 &&
    prevA0 < 0x10 &&
    zRestore < 0x3fc4
  ) {
    enterState4FromGate(state, a2Off, a3Off, colorTag, d1, d2, d6, a0, subs);
    recordTerrainGateProbeDebug(state, a2Off, a3Off, colorTag, "outer-death-state4", d1, d2, d6, a0, g694, prevD6, prevA0, zRestore);
    return;
  }

  wB(state, G_FLAG_X, 1);
  wB(state, G_FLAG_Y, 1);
  recordTerrainGateProbeDebug(state, a2Off, a3Off, colorTag, "outer-block-flags", d1, d2, d6, a0, g694, prevD6, prevA0, zRestore);
}

function runGate0B(
  state: GameState,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  g694: number,
  subs: Sub29CCESubs,
): void {
  if (rB(state, a3Off + F_STATE_1A) === 0) {
    recordTerrainGateProbeDebug(state, a2Off, a3Off, 0x0b, "slot-state-zero", d1, d2, d6, a0, g694);
    return;
  }
  if (rL(state, a3Off + SF_BASE_46) !== 0x00022016) {
    recordTerrainGateProbeDebug(state, a2Off, a3Off, 0x0b, "guard-miss", d1, d2, d6, a0, g694);
    return;
  }

  if (d6 >= -0x0c && d6 < 0x1c && a0 >= -0x20 && a0 < -0x08) {
    if (d6 >= 0 && d6 < 0x10 && a0 >= -0x0f && a0 < -0x09) {
      wB(state, a2Off + F_STATE_1A, 0x0a);
      wB(state, a2Off + 0x57, 0x20);
      wB(state, a2Off + F_S58, rB(state, a3Off + F_TYPE));
      recordTerrainGateProbeDebug(state, a2Off, a3Off, 0x0b, "inner-hit-state", d1, d2, d6, a0, g694);
      return;
    }
    addScaledGateImpulse(state, a2Off, d6 - 0x08, a0 + 0x0c);
    recordTerrainGateProbeDebug(state, a2Off, a3Off, 0x0b, "inner-impulse", d1, d2, d6, a0, g694);
    return;
  }

  runGateOuterBlockOrDeath(state, a2Off, a3Off, 0x0b, d1, d2, d6, a0, g694, subs);
}

function runGate0D(
  state: GameState,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  g694: number,
  subs: Sub29CCESubs,
): void {
  if (rB(state, a3Off + F_STATE_1A) === 0) {
    recordTerrainGateProbeDebug(state, a2Off, a3Off, 0x0d, "slot-state-zero", d1, d2, d6, a0, g694);
    return;
  }
  if (rL(state, a3Off + SF_BASE_46) !== 0x000220a6) {
    recordTerrainGateProbeDebug(state, a2Off, a3Off, 0x0d, "guard-miss", d1, d2, d6, a0, g694);
    return;
  }

  if (d6 >= -0x20 && d6 < -0x08 && a0 >= -0x0c && a0 < 0x1c) {
    if (d6 >= -0x0f && d6 < -0x09 && a0 >= 0 && a0 < 0x10) {
      wB(state, a2Off + F_STATE_1A, 0x0a);
      wB(state, a2Off + 0x57, 0x20);
      wB(state, a2Off + F_S58, rB(state, a3Off + F_TYPE));
      recordTerrainGateProbeDebug(state, a2Off, a3Off, 0x0d, "inner-hit-state", d1, d2, d6, a0, g694);
      return;
    }
    addScaledGateImpulse(state, a2Off, d6 + 0x0c, a0 - 0x08);
    recordTerrainGateProbeDebug(state, a2Off, a3Off, 0x0d, "inner-impulse", d1, d2, d6, a0, g694);
    return;
  }

  runGateOuterBlockOrDeath(state, a2Off, a3Off, 0x0d, d1, d2, d6, a0, g694, subs);
}

function runBounce0C(
  state: GameState,
  rom: RomImage,
  a2Off: number,
  a3Off: number,
  d6: number,
  a0: number,
  subs: Sub29CCESubs,
): void {
  if (rB(state, a3Off + F_STATE_1A) === 0) return;

  const bboxPtrTable = rL(state, a3Off + SF_REC_3E);
  const bboxRec = readLongAbs(state, rom, bboxPtrTable);
  const minX0 = sextB(readByteAbs(state, rom, bboxRec + 4));
  const minY0 = sextB(readByteAbs(state, rom, bboxRec + 5));
  const maxX0 = sextW((minX0 + sextB(readByteAbs(state, rom, bboxRec + 6))) & 0xffff);
  const maxY0 = sextW((minY0 + sextB(readByteAbs(state, rom, bboxRec + 7))) & 0xffff);

  const minX = sextW((-(maxX0 + 3)) & 0xffff);
  const maxX = sextW((-(minX0 - 3)) & 0xffff);
  const minY = sextW((-(maxY0 + 3)) & 0xffff);
  const maxY = sextW((-(minY0 - 3)) & 0xffff);

  if (d6 < minX || d6 >= maxX || a0 < minY || a0 >= maxY) return;

  const slotX = rWBE(state, a3Off + SF_X);
  const slotY = rWBE(state, a3Off + SF_Y);
  const prevD6 = sextW((slotX - rWBE(state, G_X_RESTORE)) & 0xffff);
  const prevA0 = sextW((slotY - rWBE(state, G_Y_RESTORE)) & 0xffff);
  if (prevD6 < minX || prevD6 >= maxX || prevA0 < minY || prevA0 >= maxY) {
    wB(state, G_FLAG_Y, 1);
    wB(state, G_FLAG_X, 1);
    return;
  }

  const dx = sextW((d6 + 4) & 0xffff);
  const dy = sextW((a0 + 4) & 0xffff);
  const denom = weightedVectorDenominator(dx, dy);
  let vxWord: number;
  let vyWord: number;
  if (denom === 0) {
    vxWord = 0x1000;
    vyWord = 0;
  } else {
    vxWord = divsWord((-dx) << 16, denom);
    vyWord = divsWord((-dy) << 16, denom);
  }
  wL(state, a2Off + F_VX, (sextW(vxWord) << 6) >>> 0);
  wL(state, a2Off + F_VY, (sextW(vyWord) << 6) >>> 0);

  if (rB(state, a2Off + F_STATE_1A) !== 1) {
    wB(state, a2Off + 0x5f, 0);
    wB(state, a2Off + 0x60, 2);
    wL(state, a2Off + 0x5a, 0x00020faa);
    (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, 0x39);
  }

  wB(state, a2Off + F_STATE_1A, 1);
  helper25C74(state, WORK_RAM_BASE + a2Off, 0, {
    soundCommand: (cmd) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, cmd); },
    soundPair15884: (st) => {
      soundPair15884(st, {
        soundCommand: (cmd) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(st, cmd); },
      });
    },
    stateSub15BD0: (st, entityPtr, arg2, arg3) => { stateSub15BD0(st, entityPtr, arg2, arg3); },
    objectStateEntry25BAE: (st, entityPtr, code) => {
      recordObjectStateEntryDebug(st, entityPtr, code, "FUN_29CCE/tag0c", {});
      objectStateEntry25BAE(st, entityPtr, code, {
        soundCommand: (cmd) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(st, cmd); },
      });
    },
  });
  wB(state, a2Off + 0x57, 0x3c);
  wB(state, a2Off + 0x56, 0);
}

function runHorizontalWallCollision(
  state: GameState,
  d6: number,
  a0: number,
  xLo: number,
  xHi: number,
  yLo: number,
  yHi: number,
  initialVx: number,
  subs: Sub29CCESubs,
): void {
  if (d6 <= xLo) return;
  if (d6 >= xHi) return;
  if (a0 <= yLo) return;
  if (a0 >= yHi) return;

  const vx = initialVx | 0;
  const hitsLeft = d6 > xLo && d6 < xLo + 8 && vx < 0;
  const hitsRight = d6 > xHi - 8 && d6 < xHi && vx > 0;
  if (hitsLeft || hitsRight) {
    wB(state, G_FLAG_X, 1);
  }
  wB(state, G_FLAG_Y, 1);
  collisionSound42(state, subs);
}

function callHelper1CD00(
  state: GameState,
  a2Off: number,
  a3Off: number,
  shapeIndex: number,
  debugContext: ShapeCollisionDebugContext,
  subs: Sub29CCESubs,
): number {
  return helper1CD00(
    state,
    WORK_RAM_BASE + a2Off,
    WORK_RAM_BASE + a3Off,
    shapeIndex,
    {
      soundPair15884: (st) => {
        soundPair15884(st, {
          soundCommand: (cmd) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(st, cmd); },
        });
      },
      soundCmdSend158AC: (st, cmd) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(st, cmd); },
      stateSub15BD0: (st, entityPtr, arg2, arg3) => {
        stateSub15BD0(st, entityPtr, arg2, arg3);
      },
      objectStateEntry25BAE: (st, entityPtr, code) => {
        recordObjectStateEntryDebug(st, entityPtr, code, "FUN_29CCE/FUN_1CD00", {
          slotIndex: Math.floor((a3Off - (SLOT_TABLE_BASE - WORK_RAM_BASE)) / SLOT_STRIDE),
          colorTag: debugContext.colorTag,
          d1: debugContext.d1,
          d2: debugContext.d2,
          d6: debugContext.d6,
          a0: debugContext.a0,
          detail: `shape=${shapeIndex}`,
        });
        objectStateEntry25BAE(st, entityPtr, code, {
          soundCommand: (cmd) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(st, cmd); },
        });
      },
    },
  );
}

function projectEntityZ(state: GameState, rom: RomImage, a2Off: number, writeGlobalZ: boolean): void {
  const entityPtr = WORK_RAM_BASE + a2Off;
  spritePosUpdate1BAB2(state, entityPtr, {
    fun_1CABA: (st) => { sub1CABATileRedraw(st, rom); },
  });
  const projectedZ = spriteProject1CC62(state, 0, {
    fun_1CABA: (st) => { sub1CABATileRedraw(st, rom); },
  });
  wL(state, a2Off + F_Z, projectedZ);
  if (writeGlobalZ) {
    wL(state, G_Z_RESTORE, projectedZ);
  }
}

function runTubeTeleport(
  state: GameState,
  rom: RomImage,
  a2Off: number,
  a3Off: number,
  xWord: number,
  yWord: number,
  soundCmd: number,
  writeGlobalZ: boolean,
  subs: Sub29CCESubs,
): void {
  wL(state, a2Off + F_X, (xWord & 0xffff) << 16);
  wL(state, a2Off + F_Y, (yWord & 0xffff) << 16);
  projectEntityZ(state, rom, a2Off, writeGlobalZ);
  wB(state, a2Off + F_S58, rB(state, a3Off + SF_C));
  wB(state, a2Off + F_STATE_1A, 0x03);
  soundPair15884(state, {
    soundCommand: (cmd) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, cmd); },
  });
  (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, soundCmd);
}

function runTubeExit(
  state: GameState,
  rom: RomImage,
  a2Off: number,
  a3Off: number,
  xWord: number,
  yWord: number,
  vx: number,
  vy: number,
  writeTag: boolean,
  subs: Sub29CCESubs,
): void {
  wL(state, a2Off + F_VX, vx >>> 0);
  wL(state, a2Off + F_VY, vy >>> 0);
  wL(state, a2Off + F_X, (xWord & 0xffff) << 16);
  wL(state, a2Off + F_Y, (yWord & 0xffff) << 16);
  projectEntityZ(state, rom, a2Off, false);
  if (writeTag) wB(state, a2Off + F_S58, rB(state, a3Off + SF_C));
  wB(state, a2Off + F_STATE_1A, 0x03);
  soundPair15884(state, {
    soundCommand: (cmd) => { (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, cmd); },
  });
  (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, 0x35);
}

function runShapeHelperCollision(
  state: GameState,
  a2Off: number,
  a3Off: number,
  colorTag: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  shapeIndex: number,
  subs: Sub29CCESubs,
): DispatchResult {
  return callHelper1CD00(state, a2Off, a3Off, shapeIndex, { colorTag, d1, d2, d6, a0 }, subs) !== 0
    ? "return"
    : "continue";
}

function runTube12(
  state: GameState,
  rom: RomImage,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  g694: number,
  subs: Sub29CCESubs,
): DispatchResult {
  if (d1 < -0x02) return "continue";
  if (d1 >= 0x03) return "continue";
  if (d2 < -0x01) return "continue";
  if (d2 >= 0x05) return "continue";
  if (g694 <= 0x3f40) return "continue";

  if (d1 >= 0 && d1 < 0x03 && d2 >= 0 && d2 < 0x04) {
    wB(state, a2Off + F_S58, rB(state, a3Off + SF_C));
    wB(state, a2Off + F_S59, 0xff);
  }

  if (g694 >= 0x3f78) {
    return runShapeHelperCollision(state, a2Off, a3Off, 0x12, d1, d2, 0, 0, 0, subs);
  }
  if (d1 < 0) return "continue";
  if (g694 >= 0x3f60) {
    wL(state, a2Off + F_VY, 0);
    wL(state, a2Off + F_VX, 0);
    return "continue";
  }

  const entityPtr = WORK_RAM_BASE + a2Off;
  if (entityPtr !== PLAYER1_OBJ && entityPtr !== PLAYER2_OBJ) {
    stateSub15BD0(state, entityPtr, 1, 1);
    return "continue";
  }

  wB(state, a2Off + F_STATE_36, 0);
  wB(state, a2Off + F_S59, 0x12);
  const xWord = stringHelper17CB8(state, entityPtr, 0x020c, 0x0264, 0x0070) !== 0
    ? 0x0204
    : 0x020c;
  runTubeExit(state, rom, a2Off, a3Off, xWord, 0x0264, 0x00040000, 0, false, subs);
  return "continue";
}

function runTube13Or14(
  state: GameState,
  rom: RomImage,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  subs: Sub29CCESubs,
): DispatchResult {
  if (d6 < -0x18) return "continue";
  if (d6 >= 0x20) return "continue";
  if (a0 < -0x10) return "continue";
  if (a0 >= 0x18) return "continue";

  if (d2 === 0 && d1 >= 0 && d1 < 0x03) {
    recordTubeProbeDebug(state, a2Off, a3Off, rB(state, a3Off + SF_C), "teleport", d1, d2, d6, a0);
    wB(state, a2Off + F_S59, 0x12);
    const yWord = stringHelper17CB8(state, WORK_RAM_BASE + a2Off, 0x029c, 0x02e4, 0x0070) !== 0
      ? 0x02dc
      : 0x02e4;
    runTubeExit(state, rom, a2Off, a3Off, 0x029c, yWord, 0, 0x00040000, true, subs);
    return "continue";
  }

  const result = runShapeHelperCollision(state, a2Off, a3Off, rB(state, a3Off + SF_C), d1, d2, d6, a0, 2, subs);
  recordTubeProbeDebug(
    state,
    a2Off,
    a3Off,
    rB(state, a3Off + SF_C),
    result === "return" ? "shape-return" : "shape-miss",
    d1,
    d2,
    d6,
    a0,
  );
  return result;
}

function runTube15(
  state: GameState,
  a2Off: number,
  a3Off: number,
  d6: number,
  a0: number,
  g694: number,
  subs: Sub29CCESubs,
): DispatchResult {
  if (d6 < -0x18) return "continue";
  if (d6 >= 0x28) return "continue";
  if (a0 < -0x18) return "continue";
  if (a0 >= 0x28) return "continue";
  if (g694 >= 0x3f40) return "continue";
  return runShapeHelperCollision(state, a2Off, a3Off, rB(state, a3Off + SF_C), 0, 0, d6, a0, 1, subs);
}

function runTube16(
  state: GameState,
  a2Off: number,
  a3Off: number,
  d6: number,
  a0: number,
  subs: Sub29CCESubs,
): DispatchResult {
  if (d6 < -0x10) return "continue";
  if (d6 >= 0x20) return "continue";
  if (a0 < -0x10) return "continue";
  if (a0 >= 0x18) return "continue";
  return runShapeHelperCollision(state, a2Off, a3Off, rB(state, a3Off + SF_C), 0, 0, d6, a0, 3, subs);
}

function runTube20(
  state: GameState,
  rom: RomImage,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  g694: number,
  subs: Sub29CCESubs,
): DispatchResult {
  if (d1 < -0x02) return "continue";
  if (d1 >= 0x03) return "continue";
  if (d2 < -0x01) return "continue";
  if (d2 >= 0x05) return "continue";
  if (g694 <= 0x3f80) return "continue";

  if (d1 >= 0 && d1 < 0x03 && d2 >= 0 && d2 < 0x04) {
    wB(state, a2Off + F_S58, rB(state, a3Off + SF_C));
    wB(state, a2Off + F_S59, 0xff);
  }

  if (g694 >= 0x3fb0) {
    return runShapeHelperCollision(state, a2Off, a3Off, 0x20, d1, d2, 0, 0, 0, subs);
  }
  if (d1 < 0) return "continue";
  if (g694 >= 0x3fa0) {
    wL(state, a2Off + F_VY, 0);
    wL(state, a2Off + F_VX, 0);
    return "continue";
  }

  wB(state, a2Off + F_STATE_36, 0);
  wB(state, a2Off + F_S59, 0x12);
  wL(state, a2Off + F_VX, 0);
  wL(state, a2Off + F_VY, 0xfffc0000);
  const yWord = stringHelper17CB8(state, WORK_RAM_BASE + a2Off, 0x026c, 0x0254, 0x0070) !== 0
    ? 0x025c
    : 0x0254;
  runTubeTeleport(state, rom, a2Off, a3Off, 0x026c, yWord, 0x35, false, subs);
  return "continue";
}

function runTube21(
  state: GameState,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  g694: number,
  subs: Sub29CCESubs,
): DispatchResult {
  if (d1 < -0x01) return "continue";
  if (d1 >= 0x04) return "continue";
  if (d2 < -0x01) return "continue";
  if (d2 >= 0x03) return "continue";
  if (g694 >= 0x3f60) return "continue";
  return runShapeHelperCollision(state, a2Off, a3Off, 0x21, d1, d2, 0, 0, 4, subs);
}

function runTube22(
  state: GameState,
  rom: RomImage,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  g694: number,
  subs: Sub29CCESubs,
): DispatchResult {
  if (d2 !== 1) return "continue";
  if (d1 !== 1) return "continue";

  if (g694 > 0x3f94) {
    wB(state, a2Off + F_STATE_36, 0);
    wB(state, a2Off + F_S59, 0x12);
    wL(state, a2Off + F_VX, 0);
    wL(state, a2Off + F_VY, 0xfffc0000);

    const firstExit = randomMod13A98(state, 2) !== 0;
    let xWord: number;
    if (firstExit) {
      xWord = stringHelper17CB8(state, WORK_RAM_BASE + a2Off, 0x02dc, 0x02b0, 0x0070) !== 0
        ? 0x02ac
        : 0x02dc;
    } else {
      xWord = stringHelper17CB8(state, WORK_RAM_BASE + a2Off, 0x02ac, 0x02b0, 0x0070) !== 0
        ? 0x02dc
        : 0x02ac;
    }
    runTubeTeleport(state, rom, a2Off, a3Off, xWord, 0x02b0, 0x36, true, subs);
    return "continue";
  }

  if (g694 === 0x3f74) {
    wL(state, a2Off + F_Z, (rL(state, a2Off + F_Z) + 0x00020000) >>> 0);
  }
  wL(state, a2Off + F_VZ, (rL(state, a2Off + F_VZ) + 0x00009000) >>> 0);
  wL(state, a2Off + F_VY, 0);
  wL(state, a2Off + F_VX, 0);
  wB(state, a2Off + F_STATE_36, 0x02);
  return "continue";
}

function runTube23Or24(
  state: GameState,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  subs: Sub29CCESubs,
): DispatchResult {
  if (d6 < -0x10) return "continue";
  if (d6 >= 0x20) return "continue";
  if (a0 < -0x18) return "continue";
  if (a0 >= 0x28) return "continue";
  return runShapeHelperCollision(state, a2Off, a3Off, rB(state, a3Off + SF_C), d1, d2, d6, a0, 5, subs);
}

function runTube25(
  state: GameState,
  rom: RomImage,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  g694: number,
  subs: Sub29CCESubs,
): DispatchResult {
  if (d1 < 0) return "continue";
  if (d1 > 1) return "continue";
  if (d2 < 0) return "continue";
  if (d2 > 1) return "continue";
  if (g694 >= 0x3fe0) return "continue";

  wB(state, a2Off + F_STATE_36, 0);
  (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, 0x46);
  wB(state, a2Off + F_S59, 0x12);

  let yWord: number;
  if (randomMod13A98(state, 2) !== 0) {
    yWord = stringHelper17CB8(state, WORK_RAM_BASE + a2Off, 0x00f0, 0x0100, 0x0070) !== 0
      ? 0x0140
      : 0x0100;
  } else {
    yWord = stringHelper17CB8(state, WORK_RAM_BASE + a2Off, 0x00f0, 0x0140, 0x0070) !== 0
      ? 0x0100
      : 0x0140;
  }

  runTubeExit(state, rom, a2Off, a3Off, 0x00f0, yWord, 0x00040000, 0, true, subs);
  return "continue";
}

function runTube26Or27(
  state: GameState,
  a2Off: number,
  a3Off: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  subs: Sub29CCESubs,
): DispatchResult {
  if (d6 < -0x18) return "continue";
  if (d6 >= 0x28) return "continue";
  if (a0 < -0x18) return "continue";
  if (a0 >= 0x28) return "continue";
  return runShapeHelperCollision(state, a2Off, a3Off, rB(state, a3Off + SF_C), d1, d2, d6, a0, 6, subs);
}

/**
 * Dispatch su color tag (range 5..0x3b).
 *
 * Le branch **BLOCK A simple** (range-check D1/D2 + tag-write) are
 * implementate fully:
 *   0x10, 0x12, 0x32-0x37, 0x2d-0x31, 0x38-0x3b.
 *
 * Complex cases implemented:
 *   0x05 — proximity bumper, sets X/Y restore flags and sound 0x42.
 *   0x0a — catapult arm launch + script kick.
 *   0x0b/0x0d — Aerial gate/bumper physical shove, hit state, and death gate.
 *   0x1a..0x1f — dynamic pipe/wall collisions, set X/Y flags + sound 0x42.
 *   0x20..0x27 — Beginner tube ramps/teleports and helper1CD00 wall checks.
 */
function dispatchColor(
  state: GameState,
  rom: RomImage,
  a2Off: number,
  a3Off: number,
  colorTag: number,
  d1: number,
  d2: number,
  d6: number,
  a0: number,
  g694: number,
  initialVx: number,
  initialVy: number,
  subs: Sub29CCESubs,
): DispatchResult {
  // Range checks for each color tag, derived from disasm 0x29f40..0x2b06c.
  // Pattern standard:
  //   tst.w D1w; blt.w 0x2b072         -> skip if D1 < 0
  //   moveq #hi,D0; cmp.w D1,D0; ble   -> skip if D1 >= hi
  //   tst.w D2w; blt.w 0x2b072         -> skip if D2 < 0
  //   moveq #hi,D0; cmp.w D2,D0; ble    → skip if D2 >= hi
  //   write tag, -1; bra 0x2b072

  switch (colorTag) {
    // 0x29f40: proximity bumper. Uses viewport deltas D6/A0, sets both
    // restore flags, then the common epilogue restores XY and negates vx/vy.
    case 0x05:
      runProximityBumper05(state, d6, a0, subs);
      return "continue";
    // 0x29e22: catapult arm. Tight D6/A0 hitbox; on success it snaps and
    // launches the marble, tags +0x58=0x0a, and starts script 0x1DB80.
    case 0x0a:
      runCatapult0A(state, rom, a2Off, a3Off, d6, a0, subs);
      return "continue";
    // 0x2ab88: Aerial gate/bumper oriented along the upper-left edge.
    case 0x0b:
      runGate0B(state, a2Off, a3Off, d1, d2, d6, a0, g694, subs);
      return "continue";
    // 0x2a9a2: dynamic bbox bounce; used by animated obstacle slots.
    case 0x0c:
      runBounce0C(state, rom, a2Off, a3Off, d6, a0, subs);
      return "continue";
    // 0x2ad20: Aerial gate/bumper oriented along the lower-right edge.
    case 0x0d:
      runGate0D(state, a2Off, a3Off, d1, d2, d6, a0, g694, subs);
      return "continue";
    // 0x2a1e4: D1∈[0..0x10), D2∈[0..0xe)
    case 0x10: rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x10, 0, 0xe); return "continue";
    // 0x2a258: D1∈[0..0x4), D2∈[0..0x2)
    case 0x32: rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x4, 0, 0x2); return "continue";
    // 0x2a284: D1∈[0..0x2), D2∈[0..0x4)
    case 0x33: rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x2, 0, 0x4); return "continue";
    // 0x2a2b0: D1∈[0..0x8), D2∈[0..0xb)
    case 0x34: rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x8, 0, 0xb); return "continue";
    // 0x2a2dc: D1∈[0..0x3), D2∈[0..0x8)
    case 0x35: rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x3, 0, 0x8); return "continue";
    // 0x2a308: D1∈[0..0x6), D2∈[0..0x3)
    case 0x36: rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x6, 0, 0x3); return "continue";
    // 0x2a334: D1∈[0..0x2), D2∈[0..0x3)
    case 0x37: rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x2, 0, 0x3); return "continue";
    // 0x2aec8: D1∈[0..0x2), D2∈[0..0x3); cond extra: (0x14,A3) == (0x14,A2)
    case 0x2e:
      if (rL(state, a3Off + 0x14) !== rL(state, a2Off + 0x14)) return "continue";
      rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x2, 0, 0x3);
      return "continue";
    // 0x2af00: D1∈[0..0x2), D2∈[0..0x3); cond extra (0x14,A3)==(0x14,A2)
    case 0x3b:
      if (rL(state, a3Off + 0x14) !== rL(state, a2Off + 0x14)) return "continue";
      rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x2, 0, 0x3);
      return "continue";
    // 0x2af38: D1∈[0..0x14), D2∈[0..0xe); cond extra (0x14,A3)==(0x14,A2)
    case 0x38:
      if (rL(state, a3Off + 0x14) !== rL(state, a2Off + 0x14)) return "continue";
      rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x14, 0, 0xe);
      return "continue";
    // 0x2af70: D1∈[0..0xc), D2∈[0..0xe); cond extra (0x14,A3)==(0x14,A2)
    case 0x39:
      if (rL(state, a3Off + 0x14) !== rL(state, a2Off + 0x14)) return "continue";
      rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0xc, 0, 0xe);
      return "continue";
    // 0x2afa8: D1∈[0..0x4), D2∈[0..0x2); cond extra (0x14,A3)==(0x14,A2)
    case 0x3a:
      if (rL(state, a3Off + 0x14) !== rL(state, a2Off + 0x14)) return "continue";
      rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x4, 0, 0x2);
      return "continue";
    // 0x2afe0: D1∈[0..0xa), D2∈[0..0x14); cond extra (0x14,A3)==(0x14,A2)
    case 0x2f:
      if (rL(state, a3Off + 0x14) !== rL(state, a2Off + 0x14)) return "continue";
      rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0xa, 0, 0x14);
      return "continue";
    // 0x2b018: D1∈[0..0x13), D2∈[0..0x9); cond extra (0x14,A3)==(0x14,A2)
    case 0x30:
      if (rL(state, a3Off + 0x14) !== rL(state, a2Off + 0x14)) return "continue";
      rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x13, 0, 0x9);
      return "continue";
    // 0x2b048: D1∈[0..0x2), D2∈[0..0x6); cond extra (0x14,A3)==(0x14,A2)
    case 0x31:
      if (rL(state, a3Off + 0x14) !== rL(state, a2Off + 0x14)) return "continue";
      rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x2, 0, 0x6);
      return "continue";
    // 0x2ae90: D1∈[0..0x14), D2∈[0..0xe); cond extra (0x14,A3)==(0x14,A2)
    case 0x2d:
      if (rL(state, a3Off + 0x14) !== rL(state, a2Off + 0x14)) return "continue";
      rangeWrite(state, a2Off, a3Off, d1, d2, 0, 0x14, 0, 0xe);
      return "continue";
    // 0x2a210: 0x17 — D1==0 AND -0x12 < D2 <= 0
    // tst.w D1; bne 0x2b072       → skip if D1 != 0
    // tst.w D2; bgt 0x2b072       → skip if D2 > 0
    // moveq -0x12,D0; cmp.w D2,D0; bge → skip if D0 >= D2 (D2 <= -0x12)
    // → match iff D1==0 AND D2 in (-0x12, 0]
    case 0x17:
      if (d1 !== 0) return "continue";
      if (d2 > 0) return "continue";
      if (d2 <= -0x12) return "continue";
      wB(state, a2Off + F_S58, rB(state, a3Off + SF_C));
      wB(state, a2Off + F_S59, 0xff);
      return "continue";
    // 0x2a234: 0x18 — -0x12 < D1 <= 0 AND D2 == 0
    case 0x18:
      if (d1 > 0) return "continue";
      if (d1 <= -0x12) return "continue";
      if (d2 !== 0) return "continue";
      wB(state, a2Off + F_S58, rB(state, a3Off + SF_C));
      wB(state, a2Off + F_S59, 0xff);
      return "continue";
    // 0x2a004: 0x1a — vertical tube/wall segment.
    case 0x1a:
      runVerticalWallCollision(state, d6, a0, -0x0c, 0x00, -0x08, 0x20, initialVy, subs);
      return "continue";
    // 0x29fa4: 0x1b — horizontal tube/wall segment.
    case 0x1b:
      runHorizontalWallCollision(state, d6, a0, -0x08, 0x20, -0x0c, 0x00, initialVx, subs);
      return "continue";
    // 0x2a0c6: 0x1c — horizontal tube/wall segment with lower lip.
    case 0x1c:
      runHorizontalWallCollision(state, d6, a0, -0x08, 0x20, -0x08, 0x04, initialVx, subs);
      return "continue";
    // 0x2a064: 0x1d — vertical tube/wall segment with right-side reach.
    case 0x1d:
      runVerticalWallCollision(state, d6, a0, -0x08, 0x04, -0x08, 0x20, initialVy, subs);
      return "continue";
    // 0x2a182: 0x1e — wide horizontal tube/wall segment.
    case 0x1e:
      runHorizontalWallCollision(state, d6, a0, -0x0c, 0x5e, -0x0e, 0x00, initialVx, subs);
      return "continue";
    // 0x2a360: 0x12 — Beginner tube entry/side shape.
    case 0x12:
      return runTube12(state, rom, a2Off, a3Off, d1, d2, g694, subs);
    // 0x2a492: 0x13/0x14 — Beginner tube exit/curved wall shape.
    case 0x13:
    case 0x14:
      return runTube13Or14(state, rom, a2Off, a3Off, d1, d2, d6, a0, subs);
    // 0x2a564: 0x15 — Beginner lower tube wall shape.
    case 0x15:
      return runTube15(state, a2Off, a3Off, d6, a0, g694, subs);
    // 0x2a5aa: 0x16 — Beginner visible tube body shape.
    case 0x16:
      return runTube16(state, a2Off, a3Off, d6, a0, subs);
    // 0x2a5e6: 0x20 — first Beginner tube segment / launcher.
    case 0x20:
      return runTube20(state, rom, a2Off, a3Off, d1, d2, g694, subs);
    // 0x2a6f2: 0x21 — tube wall shape check.
    case 0x21:
      return runTube21(state, a2Off, a3Off, d1, d2, g694, subs);
    // 0x2a738: 0x22 — tube support/exit segment.
    case 0x22:
      return runTube22(state, rom, a2Off, a3Off, d1, d2, g694, subs);
    // 0x2a83e: 0x23/0x24 — tube wall shape check, helper index 5.
    case 0x23:
    case 0x24:
      return runTube23Or24(state, a2Off, a3Off, d1, d2, d6, a0, subs);
    // 0x2a87a: 0x25 — tube teleport branch.
    case 0x25:
      return runTube25(state, rom, a2Off, a3Off, d1, d2, g694, subs);
    // 0x2a966: 0x26/0x27 — tube wall shape check, helper index 6.
    case 0x26:
    case 0x27:
      return runTube26Or27(state, a2Off, a3Off, d1, d2, d6, a0, subs);
    // 0x2a124: 0x1f — side-wall bounce. The block uses viewport deltas
    // D6/A0, not D1/D2. In the observed long demo f13542 case it sets the
    // X collision flag, then the epilogue restores X and negates vx.
    case 0x1f: {
      if (a0 <= -0x0c) return "continue";
      if (a0 >= 0x54) return "continue";
      if (d6 <= -0x0e) return "continue";
      if (d6 >= 0) return "continue";

      const oldVy = initialVy | 0;
      const hitsTop = a0 > -0x0c && a0 < -0x04 && oldVy < 0;
      const hitsBottom = a0 > 0x4c && a0 < 0x54 && oldVy > 0;
      if (hitsTop || hitsBottom) {
        wB(state, G_FLAG_Y, 1);
      }
      wB(state, G_FLAG_X, 1);
      collisionSound42(state, subs);
      return "continue";
    }
    default:
      return "continue";
  }
}
