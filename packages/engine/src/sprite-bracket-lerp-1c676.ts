/**
 * sprite-bracket-lerp-1c676.ts — replica `FUN_0001C676` (1092 byte).
 *
 * "Sprite bracket-lerp": calcola 4 valori di output "bracket+lerp" con
 * segno di direzione, poi 8 check di minimo con flag-bits, infine sottrae
 * il valore globale `*0x400694` da ciascuno degli 8 output.
 *
 * Struttura di ogni blocco bracket-lerp (x4):
 *   1. Se key==hi E tieP1==tieP2 → skip intero blocco (bra al successivo)
 *   2. dir=1 se (key<hi) OR (key>=hi AND dirProbe<dirLo), altrimenti dir=3
 *   3. OUT = lo (dir=1) oppure hi2 (dir=3)
 *   4. Se bumpPivot==hi: dir += 1  (diventa 2 o 4, nessun lerp)
 *   5. Se dir==1: OUT += ((lerpHi1-lerpLo1) * factor + 4) asr 3
 *      Se dir==3: OUT += ((lerpHi3-lerpLo3) * factor + 4) asr 3
 *
 * **Indirizzi globali (workRam offsets)**:
 *   - `0x40066A` = byte flags (8 bit OR-accumulate)
 *   - `0x40066C` = byte dircode bracket-1 (D2)
 *   - `0x40066E` = byte dircode bracket-2
 *   - `0x400670` = byte dircode bracket-3
 *   - `0x400672` = byte dircode bracket-4
 *   - `0x400674..0x400683` = OUT1..OUT8 (words)
 *   - `0x400694` = base word (subtracted from all 8 OUTs at end)
 *   - `0x40069E` = muls factor β (brackets 2 & 4)
 *   - `0x4006A0` = muls factor α (brackets 1 & 3)
 *   - struct1 @ `0x401C28` (A1): words +0, +2, +4, +6
 *   - struct2 @ `0x401C30` (A2): words +0, +2, +4, +6
 *   - struct3 @ `0x401C38` (A3): words +0, +2, +4, +6
 *   - struct4 @ `0x401C40` (A0): words +0, +2, +4, +6
 *
 * Nessun argomento, nessun valore di ritorno (side-effects in workRam).
 * Caller: `FUN_000121B8` (UNCONDITIONAL_CALL).
 *
 * Verifica bit-perfect via
 * `cli/src/test-sprite-bracket-lerp-1c676-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── workRam offsets ──────────────────────────────────────────────────────────

const FLAGS_OFF    = 0x066a;
const DIR0_OFF     = 0x066c;
const DIR1_OFF     = 0x066e;
const DIR2_OFF     = 0x0670;
const DIR3_OFF     = 0x0672;
const OUT1_OFF     = 0x0674;
const OUT2_OFF     = 0x0676;
const OUT3_OFF     = 0x0678;
const OUT4_OFF     = 0x067a;
const OUT5_OFF     = 0x067c;
const OUT6_OFF     = 0x067e;
const OUT7_OFF     = 0x0680;
const OUT8_OFF     = 0x0682;
const BASE_OFF     = 0x0694;
const FACTOR_B_OFF = 0x069e;
const FACTOR_A_OFF = 0x06a0;

const S1_OFF = 0x1c28;
const S2_OFF = 0x1c30;
const S3_OFF = 0x1c38;
const S4_OFF = 0x1c40;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rw(s: GameState, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}

function ww(s: GameState, off: number, v: number): void {
  s.workRam[off]     = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

function rb(s: GameState, off: number): number {
  return (s.workRam[off] ?? 0) & 0xff;
}

function wb(s: GameState, off: number, v: number): void {
  s.workRam[off] = v & 0xff;
}

/** sext16: u16 → signed int16. */
function sx16(v: number): number {
  return v & 0x8000 ? v - 0x10000 : v;
}

/** Truncate to signed 32-bit (for muls + arithmetic shifts). */
function i32(v: number): number {
  return v | 0;
}

/**
 * Common bracket-lerp pattern (4 instances in FUN_0001C676).
 *
 * Parameters directly map to disasm operands:
 *   key, hi         — first cmp.w pair (key vs hi)
 *   tieP1, tieP2    — secondary tiebreak for the equality skip
 *   lo, hi2         — base output values for dir=1 / dir=3
 *   dirProbe, dirLo — second cmp.w pair for dir determination (when key>=hi)
 *   bumpPivot        — compared to hi for the +1 bump on dir
 *   lerpHi1, lerpLo1 — lerp operands for dir=1  (lerpHi1 - lerpLo1)
 *   lerpHi3, lerpLo3 — lerp operands for dir=3  (lerpHi3 - lerpLo3)
 *   factor           — muls.w factor (signed 16-bit word)
 */
function bracketLerp(
  s: GameState,
  outOff: number,
  dirOff: number,
  key: number, hi: number,
  tieP1: number, tieP2: number,
  lo: number, hi2: number,
  dirProbe: number, dirLo: number,
  bumpPivot: number,
  lerpHi1: number, lerpLo1: number,
  lerpHi3: number, lerpLo3: number,
  factor: number,
): void {
  // Skip check: if key==hi AND tieP1==tieP2 → skip entire block
  if (key === hi && tieP1 === tieP2) return;

  let dir: number;
  let out: number;
  // dir=1 when: (key < hi) OR (key>=hi AND dirProbe < dirLo)
  // dir=3 when: (key >= hi) AND (dirProbe >= dirLo)
  if (sx16(key) < sx16(hi) || sx16(dirProbe) < sx16(dirLo)) {
    dir = 1; out = lo;
  } else {
    dir = 3; out = hi2;
  }
  ww(s, outOff, out);

  // bump: if bumpPivot == hi → dir += 1 (byte)
  if (bumpPivot === hi) dir = (dir + 1) & 0xff;
  wb(s, dirOff, dir);

  if (dir === 1) {
    // lerp: OUT += ((lerpHi1 - lerpLo1) * factor + 4) asr 3
    // M68k `sub.w` truncates the difference to 16 bits; `muls.w` then uses
    // the low word of D0 as a signed 16-bit operand. Replicate by sx16-ing
    // the wrapped difference before the signed multiply.
    const diff1 = sx16((sx16(lerpHi1) - sx16(lerpLo1)) & 0xffff);
    const d = i32(i32(diff1 * sx16(factor)) + 4);
    ww(s, outOff, (rw(s, outOff) + i32(d >> 3)) & 0xffff);
  } else if (dir === 3) {
    // lerp: OUT += ((lerpHi3 - lerpLo3) * factor + 4) asr 3
    const diff3 = sx16((sx16(lerpHi3) - sx16(lerpLo3)) & 0xffff);
    const d = i32(i32(diff3 * sx16(factor)) + 4);
    ww(s, outOff, (rw(s, outOff) + i32(d >> 3)) & 0xffff);
  }
  // dir==2 or dir==4 → no lerp
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_0001C676`.
 *
 * Side effects in `state.workRam`:
 *   - byte  @ 0x40066A (flags)
 *   - bytes @ 0x40066C..0x400672 (4 dir-codes)
 *   - words @ 0x400674..0x400683 (OUT1-OUT8)
 */
export function spriteBracketLerp1C676(state: GameState): void {
  // ── Init: clear all control bytes ──────────────────────────────────────
  wb(state, FLAGS_OFF, 0);
  wb(state, DIR3_OFF,  0); // 0x400672
  wb(state, DIR2_OFF,  0); // 0x400670
  wb(state, DIR1_OFF,  0); // 0x40066E
  wb(state, DIR0_OFF,  0); // 0x40066C

  // ── Read all struct words ─────────────────────────────────────────────
  const s1_0 = rw(state, S1_OFF);
  const s1_2 = rw(state, S1_OFF + 2);
  const s1_4 = rw(state, S1_OFF + 4);
  const s1_6 = rw(state, S1_OFF + 6);
  const s2_0 = rw(state, S2_OFF);
  const s2_2 = rw(state, S2_OFF + 2);
  const s2_4 = rw(state, S2_OFF + 4);
  const s2_6 = rw(state, S2_OFF + 6);
  const s3_0 = rw(state, S3_OFF);
  const s3_2 = rw(state, S3_OFF + 2);
  const s3_4 = rw(state, S3_OFF + 4);
  const s3_6 = rw(state, S3_OFF + 6);
  const s4_0 = rw(state, S4_OFF);
  const s4_2 = rw(state, S4_OFF + 2);
  const s4_4 = rw(state, S4_OFF + 4);
  const s4_6 = rw(state, S4_OFF + 6);

  const factorA = rw(state, FACTOR_A_OFF); // *0x4006A0
  const factorB = rw(state, FACTOR_B_OFF); // *0x40069E

  // ─── Phase 1: bracket-lerp outputs 1-4 ─────────────────────────────────
  //
  // Bracket 1 (0x1C6BE–0x1C754):
  //   key=s1[4], hi=s1[6]
  //   tiebreak: s4[2]==s4[0]
  //   dir=1 out=s4[0], dir=3 out=s4[2]
  //   dirProbe=s4[2] vs dirLo=s4[0]
  //   bumpPivot=s4[0] vs hi=s1[6]
  //   lerp1=(s1[6]-s4[0])*α, lerp3=(s1[4]-s4[2])*α
  bracketLerp(state, OUT1_OFF, DIR0_OFF,
    s1_4, s1_6,
    s4_2, s4_0,
    s4_0, s4_2,
    s4_2, s4_0,
    s4_0,
    s1_6, s4_0,
    s1_4, s4_2,
    factorA);

  // Bracket 2 (0x1C754–0x1C7F2):
  //   key=s1[4], hi=s1[2]
  //   tiebreak: s2[6]==s2[0]
  //   dir=1 out=s1[2], dir=3 out=s1[4]
  //   dirProbe=s2[6] vs dirLo=s2[0]  ← different from lo/hi2!
  //   bumpPivot=s2[0] vs hi=s1[2]
  //   lerp1=(s2[0]-s1[2])*β, lerp3=(s2[6]-s1[4])*β
  bracketLerp(state, OUT2_OFF, DIR1_OFF,
    s1_4, s1_2,
    s2_6, s2_0,
    s1_2, s1_4,
    s2_6, s2_0,
    s2_0,
    s2_0, s1_2,
    s2_6, s1_4,
    factorB);

  // Bracket 3 (0x1C7F2–0x1C892):
  //   key=s3[0], hi=s3[2]
  //   tiebreak: s2[6]==s2[4]
  //   dir=1 out=s2[4], dir=3 out=s2[6]
  //   dirProbe=s2[6] vs dirLo=s2[4]
  //   bumpPivot=s2[4] vs hi=s3[2]
  //   lerp1=(s2[4]-s3[2])*α, lerp3=(s2[6]-s3[0])*α
  bracketLerp(state, OUT3_OFF, DIR2_OFF,
    s3_0, s3_2,
    s2_6, s2_4,
    s2_4, s2_6,
    s2_6, s2_4,
    s2_4,
    s2_4, s3_2,
    s2_6, s3_0,
    factorA);

  // Bracket 4 (0x1C892–0x1C930):
  //   key=s3[0], hi=s3[6]
  //   tiebreak: s4[2]==s4[4]
  //   dir=1 out=s3[6], dir=3 out=s3[0]
  //   dirProbe=s4[2] vs dirLo=s4[4]
  //   bumpPivot=s4[4] vs hi=s3[6]
  //   lerp1=(s3[6]-s4[4])*β, lerp3=(s3[0]-s4[2])*β
  bracketLerp(state, OUT4_OFF, DIR3_OFF,
    s3_0, s3_6,
    s4_2, s4_4,
    s3_6, s3_0,
    s4_2, s4_4,
    s4_4,
    s3_6, s4_4,
    s3_0, s4_2,
    factorB);

  // ─── Phase 2: 8 min-check blocks → flag bits + OUT5-8 ─────────────────
  //
  // Each block: if all 3 probes strictly < pivot (signed) → flag |= bit, OUT = pivot.
  // Note: both blocks A+E write OUT5, B+F write OUT6, C+G write OUT7, D+H write OUT8.

  // A (0x1C930): s1[4]<s1[0] && s1[6]<s1[0] && s1[2]<s1[0] → flag|=0x01, OUT5=s1[0]
  if (sx16(s1_4) < sx16(s1_0) && sx16(s1_6) < sx16(s1_0) && sx16(s1_2) < sx16(s1_0)) {
    wb(state, FLAGS_OFF, rb(state, FLAGS_OFF) | 0x01);
    ww(state, OUT5_OFF, s1_0);
  }

  // B (0x1C952): s2[6]<s2[2] && s2[0]<s2[2] && s2[4]<s2[2] → flag|=0x02, OUT6=s2[2]
  if (sx16(s2_6) < sx16(s2_2) && sx16(s2_0) < sx16(s2_2) && sx16(s2_4) < sx16(s2_2)) {
    wb(state, FLAGS_OFF, rb(state, FLAGS_OFF) | 0x02);
    ww(state, OUT6_OFF, s2_2);
  }

  // C (0x1C97A): s3[0]<s3[4] && s3[2]<s3[4] && s3[6]<s3[4] → flag|=0x04, OUT7=s3[4]
  if (sx16(s3_0) < sx16(s3_4) && sx16(s3_2) < sx16(s3_4) && sx16(s3_6) < sx16(s3_4)) {
    wb(state, FLAGS_OFF, rb(state, FLAGS_OFF) | 0x04);
    ww(state, OUT7_OFF, s3_4);
  }

  // D (0x1C9A2): s4[2]<s4[6] && s4[4]<s4[6] && s4[0]<s4[6] → flag|=0x08, OUT8=s4[6]
  if (sx16(s4_2) < sx16(s4_6) && sx16(s4_4) < sx16(s4_6) && sx16(s4_0) < sx16(s4_6)) {
    wb(state, FLAGS_OFF, rb(state, FLAGS_OFF) | 0x08);
    ww(state, OUT8_OFF, s4_6);
  }

  // E (0x1C9CA): s1[0]<s1[4] && s1[6]<s1[4] && s1[2]<s1[4] → flag|=0x10, OUT5=s1[4]
  if (sx16(s1_0) < sx16(s1_4) && sx16(s1_6) < sx16(s1_4) && sx16(s1_2) < sx16(s1_4)) {
    wb(state, FLAGS_OFF, rb(state, FLAGS_OFF) | 0x10);
    ww(state, OUT5_OFF, s1_4);
  }

  // F (0x1C9F2): s2[2]<s2[6] && s2[0]<s2[6] && s2[4]<s2[6] → flag|=0x20, OUT6=s2[6]
  if (sx16(s2_2) < sx16(s2_6) && sx16(s2_0) < sx16(s2_6) && sx16(s2_4) < sx16(s2_6)) {
    wb(state, FLAGS_OFF, rb(state, FLAGS_OFF) | 0x20);
    ww(state, OUT6_OFF, s2_6);
  }

  // G (0x1CA1A): s3[4]<s3[0] && s3[2]<s3[0] && s3[6]<s3[0] → flag|=0x40, OUT7=s3[0]
  if (sx16(s3_4) < sx16(s3_0) && sx16(s3_2) < sx16(s3_0) && sx16(s3_6) < sx16(s3_0)) {
    wb(state, FLAGS_OFF, rb(state, FLAGS_OFF) | 0x40);
    ww(state, OUT7_OFF, s3_0);
  }

  // H (0x1CA3C): s4[6]<s4[2] && s4[4]<s4[2] && s4[0]<s4[2] → flag|=0x80, OUT8=s4[2]
  if (sx16(s4_6) < sx16(s4_2) && sx16(s4_4) < sx16(s4_2) && sx16(s4_0) < sx16(s4_2)) {
    wb(state, FLAGS_OFF, rb(state, FLAGS_OFF) | 0x80);
    ww(state, OUT8_OFF, s4_2);
  }

  // ─── Phase 3: subtract base (*0x400694) from all 8 OUTs ────────────────
  const base = rw(state, BASE_OFF);
  ww(state, OUT1_OFF, (rw(state, OUT1_OFF) - base) & 0xffff);
  ww(state, OUT2_OFF, (rw(state, OUT2_OFF) - base) & 0xffff);
  ww(state, OUT3_OFF, (rw(state, OUT3_OFF) - base) & 0xffff);
  ww(state, OUT4_OFF, (rw(state, OUT4_OFF) - base) & 0xffff);
  ww(state, OUT5_OFF, (rw(state, OUT5_OFF) - base) & 0xffff);
  ww(state, OUT6_OFF, (rw(state, OUT6_OFF) - base) & 0xffff);
  ww(state, OUT7_OFF, (rw(state, OUT7_OFF) - base) & 0xffff);
  ww(state, OUT8_OFF, (rw(state, OUT8_OFF) - base) & 0xffff);
}
