/**
 * helper-182ba.ts — replica `FUN_000182BA` (~100 istr, range 0x182BA..0x18449).
 *
 * **Caller**: `FUN_000158F6` ELSE-branch (line 0x15984), wired in
 * `refresh-frame-10fce.ts` via `objectUpdatePair158CC` callback.
 *
 * **Logica**:
 *   1. JSR FUN_15DB6(A2)                                — state-validate-grid
 *   2. if (0x36,A2) == 2 → goto GRAVITY (skip seek)
 *   3. A1 = (0x6e,A2)                                   — currentPtr (target byte ptr ROM)
 *   4. D0 = sext_w(*(0x7a,A2)); A0 = romLong(0x1eff6 + D0*4)  — target slot lookup
 *   5. D1 = sext_w(*(0x1a,A0))                          — target state byte
 *   6. PATH A: if (0x1a,A2)==0x21 AND (0x18,A0)==1 AND (0x1b,A2)==(0x1b,A0)
 *              AND D1∈{0,1,5}:
 *        D2 = (0xc,A0) - (0xc,A2)                      — Δposition X
 *        D3 = (0x10,A0) - (0x10,A2)                    — Δposition Y
 *      ELSE PATH B (target via ROM byte coord):
 *        D2 = (sext_b(*A1) << 0x13) - (0xc,A2) + 0x40000
 *        D3 = (sext_b(*(A1+1)) << 0x13) - (0x10,A2) + 0x40000
 *   7. Compute Manhattan-like distance D1 = max(|D2|>>12, |D3|>>12) + (other>>3)*3
 *   8. if D1 != 0: D2 /= D1 (signed word divs), D3 /= D1
 *      else: D2 = D3 = 0
 *   9. if D1 < 0x40: (0x68,A2) = 0x10000 (clamp scale)
 *  10. Compute scaled velocity:
 *        D1 = (0x68,A2) >> 8 (asr_l 8)
 *        D2 = (D1*D2) >> 4 - (A2)      asr 5
 *        D3 = (D1*D3) >> 4 - (0x4,A2)  asr 5
 *  11. if (0x1a,A2) == 0x24:           — additional scaling per slot 0x56
 *        D1 = max(0, 0x1f - sext_b(*(0x56,A2)))
 *        D2 = ((D2 >> 8) * D1) << 3
 *        D3 = ((D3 >> 8) * D1) << 3
 *  12. (A2) += D2; (0x4,A2) += D3
 *  13. GRAVITY label: if (0x36,A2) != 0:
 *        (0x8,A2) -= 0x6000; clamp to >= -0x50000
 *  14. JSR FUN_26196(A2)
 *
 * **Sub callees**:
 *  - `FUN_15DB6` = `stateValidateGrid15DB6` (state-validate-grid-15db6.ts)
 *  - `FUN_26196` = `flagScaledMagnitudeDispatch` (flag-scaled-magnitude-dispatch.ts)
 *  - Inner of FUN_26196 = `FUN_261BC` (NOT replicato, default no-op)
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { stateValidateGrid15DB6 } from "./state-validate-grid-15db6.js";
import type { StateValidateGrid15DB6Subs } from "./state-validate-grid-15db6.js";
import { flagScaledMagnitudeDispatch } from "./flag-scaled-magnitude-dispatch.js";
import { fun261BC } from "./sub-261bc.js";
import { stateSub15E24 } from "./state-sub-15e24.js";
import { findNearestNeighbor } from "./nearest-neighbor.js";

const WORK_RAM_BASE = 0x00400000;
const OBJ_PTR_TABLE = 0x0001eff6;

// Slot field offsets
const F_VX  = 0x00;
const F_VY  = 0x04;
const F_VZ  = 0x08;
const F_X   = 0x0c;
const F_Y   = 0x10;
const F_S18 = 0x18;
const F_S1A = 0x1a;
const F_S1B = 0x1b;
const F_S36 = 0x36;
const F_S56 = 0x56;
const F_S68 = 0x68;
const F_S6E = 0x6e;
const F_S7A = 0x7a;

function rB(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}
function rW(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) >>> 0;
}
function rL(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
     ((state.workRam[off + 1] ?? 0) << 16) |
     ((state.workRam[off + 2] ?? 0) << 8) |
     (state.workRam[off + 3] ?? 0)) >>> 0
  );
}
function wL(state: GameState, off: number, v: number): void {
  const u = v >>> 0;
  state.workRam[off]     = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8)  & 0xff;
  state.workRam[off + 3] = u & 0xff;
}
function s32(v: number): number { return v | 0; }
function sextB(b: number): number { return ((b & 0xff) << 24) >> 24; }
function sextW(w: number): number { return ((w & 0xffff) << 16) >> 16; }

function readByteAbs(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a >= WORK_RAM_BASE && a - WORK_RAM_BASE < state.workRam.length) {
    return state.workRam[a - WORK_RAM_BASE] ?? 0;
  }
  if (a < rom.program.length) return rom.program[a] ?? 0;
  return 0;
}
function romLong(rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a + 3 < rom.program.length) {
    return (
      (((rom.program[a] ?? 0) << 24) |
       ((rom.program[a + 1] ?? 0) << 16) |
       ((rom.program[a + 2] ?? 0) << 8) |
       (rom.program[a + 3] ?? 0)) >>> 0
    );
  }
  return 0;
}

export interface Helper182BASubs {
  /** `FUN_15DB6` stub-injection → default `stateValidateGrid15DB6`. */
  validateGridSubs?: StateValidateGrid15DB6Subs;
  /**
   * Not replicated in TS — wirable in a future iteration.
   */
  fun_261bc?: (structPtr: number, magnitude: number) => number;
}

/**
 *
 * @param state    GameState (mutated: workRam slot fields)
 * @param subs     stub injection
 */
export function helper182BA(
  state: GameState,
  slotPtr: number,
  rom: RomImage,
  subs?: Helper182BASubs,
): void {
  const a2 = slotPtr >>> 0;
  const a2Off = (a2 - WORK_RAM_BASE) >>> 0;

  // 0x182c4: jsr 0x15db6(A2)
  const validateGridSubs: StateValidateGrid15DB6Subs = {
    ...subs?.validateGridSubs,
    readByteAbs: subs?.validateGridSubs?.readByteAbs ?? ((addr: number) => readByteAbs(state, rom, addr)),
    fun_15d10:
      subs?.validateGridSubs?.fun_15d10 ??
      ((ptr: number) => { findNearestNeighbor(state, ptr, rom); }),
    fun_15e24:
      subs?.validateGridSubs?.fun_15e24 ??
      ((ptr: number, flag: number) => stateSub15E24(state, rom, ptr, flag)),
  };
  stateValidateGrid15DB6(state, a2, validateGridSubs);

  // 0x182ca: cmpi.b #0x2, (0x36,A2); beq → 0x1841a (gravity-only path)
  const s36 = rB(state, a2Off + F_S36);
  let d2 = 0, d3 = 0;
  let skipSeek = (s36 === 0x02);

  if (!skipSeek) {
    // 0x182d6: A1 = (0x6e,A2) long
    const a1 = rL(state, a2Off + F_S6E);

    // 0x182da: D0w = (0x7a,A2); ext.l; asl.l #2 → D0 = D0 * 4 (long stride)
    const s7aWord = sextW(rW(state, a2Off + F_S7A));
    const tableIdx = (s7aWord << 2) >>> 0;

    // 0x182e2: A0 = romLong(0x1eff6 + D0)
    const a0 = romLong(rom, OBJ_PTR_TABLE + tableIdx);
    const a0Off = (a0 - WORK_RAM_BASE) >>> 0;
    const a0InWorkRam = a0 >= WORK_RAM_BASE && a0Off < state.workRam.length;

    // 0x182ec: D1w = (0x1a,A0); ext.w
    const a0_s1a = a0InWorkRam ? rB(state, a0Off + F_S1A) : 0;
    const d1Word = sextW(a0_s1a);

    // 0x182f2: cmpi.b #0x21,(0x1a,A2); bne → PATH B
    const s1a = rB(state, a2Off + F_S1A);
    let pathA = false;
    if (s1a === 0x21) {
      // 0x182fa: cmpi.b #0x1,(0x18,A0); bne → B
      const a0_s18 = a0InWorkRam ? rB(state, a0Off + F_S18) : 0;
      if (a0_s18 === 0x01) {
        // 0x18302: cmp.b (0x1b,A2),(0x1b,A0); bne → B
        if (rB(state, a2Off + F_S1B) === (a0InWorkRam ? rB(state, a0Off + F_S1B) : 0)) {
          // 0x1830c: D1w∈{0,1,5}? else → B
          if (d1Word === 0 || d1Word === 1 || d1Word === 5) {
            pathA = true;
          }
        }
      }
    }

    if (pathA) {
      // 0x18320: D2 = (0xc,A0) - (0xc,A2); D3 = (0x10,A0) - (0x10,A2)
      d2 = s32(rL(state, a0Off + F_X) - rL(state, a2Off + F_X));
      d3 = s32(rL(state, a0Off + F_Y) - rL(state, a2Off + F_Y));
    } else {
      // 0x18332: PATH B — target via ROM/workRam byte coord at A1
      const b0 = readByteAbs(state, rom, a1);
      d2 = s32(((sextB(b0) << 0x13) | 0) - rL(state, a2Off + F_X) + 0x40000);
      const b1 = readByteAbs(state, rom, (a1 + 1) >>> 0);
      d3 = s32(((sextB(b1) << 0x13) | 0) - rL(state, a2Off + F_Y) + 0x40000);
    }

    // 0x18360: D4w = (|D2| asr.l 12) cast w
    const absD2 = d2 < 0 ? -d2 : d2;
    const d4Word = (absD2 >> 12) & 0xffff;

    // 0x18372: D0w = (|D3| asr.l 12) cast w
    const absD3 = d3 < 0 ? -d3 : d3;
    const d0Word = (absD3 >> 12) & 0xffff;

    // 0x18382: cmp.w D0w,D4w; bls → ELSE branch (D4 <= D0)
    let d1Norm: number;
    if ((d4Word & 0xffff) > (d0Word & 0xffff)) {
      // 0x18386: D1 = (D0w >> 3) * 3 + D4w (word arithmetic)
      d1Norm = (((d0Word >> 3) & 0xffff) * 3 + d4Word) & 0xffff;
    } else {
      // 0x18392: D1 = (D4w >> 3) * 3 + D0w
      d1Norm = (((d4Word >> 3) & 0xffff) * 3 + d0Word) & 0xffff;
    }

    // 0x1839c: if D1w != 0: D2 = divs(D2,D1) (word result, sign-extended);
    //                       D3 = divs(D3,D1)
    //          else: D2 = D3 = 0
    if (d1Norm !== 0) {
      const d1Signed = sextW(d1Norm);
      // divs.w D1w,D0; result = quotient in low 16 bits
      // Result placed in D2 word (high preserved? No, "move.w D0w,D2w").
      // Then D2 long = (D2 high) | (quotient & 0xffff).
      const q2 = sextW(Math.trunc(s32(d2) / d1Signed) & 0xffff);
      const q3 = sextW(Math.trunc(s32(d3) / d1Signed) & 0xffff);
      d2 = q2;
      d3 = q3;
    } else {
      d2 = 0;
      d3 = 0;
    }

    // 0x183b2: if D1w < 0x40: (0x68,A2) = 0x10000
    if ((d1Norm & 0xffff) < 0x40) {
      wL(state, a2Off + F_S68, 0x10000);
    }

    // 0x183c0: D0 = (0x68,A2) asr.l 8; D1w = D0w
    const s68 = rL(state, a2Off + F_S68);
    const d1Mul = sextW((s32(s68) >> 8) & 0xffff);

    // 0x183c8: D0 = D1 * D2 (muls.w → long); D2 = D0 asr.l 4
    let d2Scaled = (d1Mul * sextW(d2 & 0xffff)) | 0;
    d2Scaled = d2Scaled >> 4;

    // 0x183d0: D0 = D1 * D3 (muls.w); D3 = D0 asr.l 4
    let d3Scaled = (d1Mul * sextW(d3 & 0xffff)) | 0;
    d3Scaled = d3Scaled >> 4;

    // 0x183d8: D2 = D2 - (A2); D2 asr.l 5
    d2 = (s32(d2Scaled) - s32(rL(state, a2Off + F_VX))) >> 5;
    // 0x183dc: D3 = D3 - (0x4,A2); D3 asr.l 5
    d3 = (s32(d3Scaled) - s32(rL(state, a2Off + F_VY))) >> 5;

    // 0x183e2: cmpi.b #0x24, (0x1a,A2); bne → 0x1840e
    if (s1a === 0x24) {
      // 0x183ea: D1w = 0x1f - sext_b((0x56,A2))
      let d1Cap = (0x1f - sextW(sextB(rB(state, a2Off + F_S56)))) & 0xffff;
      const d1CapSigned = sextW(d1Cap);
      // 0x183f4: tst.w D1w; bge → keep; else clr D1w
      if (d1CapSigned < 0) d1Cap = 0;
      // 0x183fa: D0 = D2 asr.l 8; muls.w D1w; asl.l 3 → D2
      d2 = (((s32(d2) >> 8) * sextW(d1Cap)) | 0) << 3;
      // 0x18404: D0 = D3 asr.l 8; muls.w D1w; asl.l 3 → D3
      d3 = (((s32(d3) >> 8) * sextW(d1Cap)) | 0) << 3;
    }

    // 0x1840e: (A2) += D2; (0x4,A2) += D3
    wL(state, a2Off + F_VX, (rL(state, a2Off + F_VX) + d2) >>> 0);
    wL(state, a2Off + F_VY, (rL(state, a2Off + F_VY) + d3) >>> 0);
  }

  // 0x1841a: GRAVITY label — tst.b (0x36,A2); beq → exit jsr 26196
  if (rB(state, a2Off + F_S36) !== 0) {
    // 0x18420: addi.l #-0x6000, (0x8,A2)
    let s8 = s32(rL(state, a2Off + F_VZ));
    s8 = (s8 + (-0x6000)) | 0;
    // 0x18428: cmpi.l #-0x50000, (0x8,A2); bge → ok; else clamp
    if (s8 < -0x50000) s8 = -0x50000;
    wL(state, a2Off + F_VZ, s8 >>> 0);
  }

  // 0x1843a: jsr 0x26196(A2)
  // override via `subs.fun_261bc` per test/stub.
  const innerCb = subs?.fun_261bc
    ?? ((sp: number, mag: number) => fun261BC(state, sp, mag, rom.program));
  flagScaledMagnitudeDispatch(state, a2, innerCb);
  // skipSeek branch already merged above (skip seek = true → no D2/D3 work,
  // straight to gravity + 26196 like MAME 0x1841a path).
  void skipSeek;
}

/** @public */
export const HELPER_182BA_ADDR = 0x000182ba as const;
