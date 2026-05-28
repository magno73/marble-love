/**
 * Bit-perfect port of `FUN_00025C74`.
 *
 * Updates the object byte at `A2+0x57` with a clamped delta, then dispatches
 * the object state transitions and sound hooks used by the paired-object and
 * unpaired-object paths.
 *
 *   - `deltaWord` → D1.w = low 16-bit del secondo arg long (word delta per
 *     A2[+0x57]).
 *
 * Object struct fields, relative to `objPtr`:
 *   | Off  | Size | Name           | Use                                       |
 *   |------|------|----------------|-------------------------------------------|
 *   | 0x18 | byte | sec_state      | 0/2/3 secondary state                    |
 *   | 0x56 | byte | step_counter   | incremented on the !pair path            |
 *   | 0x60 | byte | frames_per_step| set by selected paths                    |
 *
 * Hard-coded constants:
 *   - `A3 = 0x25BAE` — `FUN_25BAE` (objectStateEntry).
 *   - `0x400018` and `0x4000FA`: canonical object-pair addresses.
 *
 * Main flow:
 *
 * ### Phase 1: is-pair-member check
 *   D3b = A2[+0x1A] (save state).
 *
 * ### Phase 2: state init
 *   If isPair:
 *     - If A2[+0x1A] == 6 → A2[+0x18] = 3
 *     - A2[+0x1A] = 1
 *     - A2[+0x1A] = 0x24
 *
 * ### Phase 3: object-type delta plus clamp
 *   D4w = sext_b(A2[+0x57]) + D1w; if D4w > 0x7F, clamp to 0x7F.
 *   A2[+0x57] receives D4b.
 *
 * ### Phase 4: dispatch by pair membership
 *
 * If isPair (D2 != 0):
 *   D0 = sext_b_to_l(A2[+0x56])
 *   D1 = sext_b_to_l(A2[+0x57])
 *   D1 -= D2; D1 >>= 1 (asr.l #1, arithmetic)
 *   D0 += D1
 *   Se D0 > 0x1F (signed long, i.e. 0x1F < D0): [advance path]
 *     D2w = A2[+0x20] (signed word)
 *     inRange = (-16 <= D2w < 240)
 *     If D3b is 1 or 5:
 *       jsr FUN_15884 (soundPair15884)
 *       A2[+0x5F] = 0; A2[+0x56] = 1; A2[+0x60] = 2; A2[+0x5A] = 0x20FD2
 *       If inRange → FUN_25BAE(A2, 2)
 *   If D0 <= 0x1F signed: cap path
 *     If D3b == 1 → return
 *       A2[+0x5F] = 0; A2[+0x60] = 2; A2[+0x5A] = 0x20FAA
 *       jsr FUN_158AC(0x39)
 *
 * If !isPair (D2 == 0):
 *   A2[+0x56] += D1b (byte add, wrapping)
 *   Se A2[+0x56] > 0x50 (signed byte, bgt): [overflow path]
 *     jsr FUN_15BD0(A2, 1, 0)
 *     A2[+0x18] = 2
 *     jsr FUN_25BAE(A2, 2)
 *     D0 = 0x1F; cmp.w D1w, D0w
 *     If D1w > 0x1F signed: call FUN_15BD0(A2, 1, 0), set A2[+0x18]=2, call FUN_25BAE(A2,2)
 *
 *   1. `cmp.w D4w, D0w` (D0=0x7F): signed word comparison. bge if D0w >= D4w.
 *      → D4w capped at 0x7F only if D4w > 0x7F.
 *   3. `asr.l #1, D1` → arithmetic shift right long by 1.
 *   4. `cmp.l D0, D1` with D1=0x1F → D1-D0; bge if D1 >= D0 → bge if 0x1F >= D0.
 *      → advance path only if D0 > 0x1F (= 31) in signed long sense.
 *   5. `cmp.w D2w, D0w` with D0=-16: `D0w - D2w`; bge if -16 >= D2w (signed).
 *   6. `cmpi.w #0xF0, D2w`; bge if D2w >= 0xF0 (signed = 240).
 *   7. `cmpi.b #0x50, (0x56,A2)`: byte comparison; bgt if A2[+0x56] > 0x50.
 *   8. `cmp.w D1w, D0w` with D0=0x1F: D0w - D1w; bge if 0x1F >= D1w.
 *      -> jump to epilog if D1w <= 0x1F (signed word).
 *       (12 + 8 pushate in totale).
 *
 * Callers:
 *   - `FUN_000121B8` @ 0x000124C8 — spinge (long D1, long A2).
 *   - `FUN_00029CCE` @ 0x0002AB64 — spinge (long 0, long A2).
 *
 */

import type { GameState } from "./state.js";

// Public constants.

export const HELPER_25C74_ADDR = 0x00025c74 as const;

/** Absolute work RAM base. */
const WORK_RAM_BASE = 0x00400000 as const;
const WORK_RAM_END = 0x00402000 as const;

const OBJ_PAIR_FIRST = 0x00400018 as const;
const OBJ_PAIR_SECOND = 0x004000fa as const;

const ANIM_PTR_LOW = 0x00020fd2 as const;
const ANIM_PTR_CAP = 0x00020faa as const;

export const FUN_25BAE_ADDR = 0x00025bae as const;
export const FUN_15884_ADDR = 0x00015884 as const;
export const FUN_158AC_ADDR = 0x000158ac as const;
export const FUN_15BD0_ADDR = 0x00015bd0 as const;

// Sub-JSR injection interface.

/**
 * External sub-JSR hooks orchestrated by `FUN_00025C74`.
 */
export interface Helper25C74Subs {
  /**
   * `FUN_25BAE(objPtr, code)` — object state-transition entry.
   * Called by several paths with `code` in {2, 4}.
   */
  objectStateEntry25BAE?: (
    state: GameState,
    objPtr: number,
    code: number,
  ) => void;

  /**
   * `FUN_15884()` — sound pair trigger.
   * Called in the isPair + advance path when D3b is 1 or 5.
   */
  soundPair15884?: (state: GameState) => void;

  /**
   * `FUN_158AC(cmd)` — sound command sender.
   * Called in the isPair + cap path with `cmd = 0x39` when D3b != 1.
   */
  soundCommand?: (cmd: number) => void;

  /**
   * `FUN_15BD0(structPtr, arg2, arg3)` — object reset + broadcast event.
   * Called in the !isPair path with `arg2=1, arg3=0`.
   */
  stateSub15BD0?: (
    state: GameState,
    structPtr: number,
    arg2: number,
    arg3: number,
  ) => void;
}

// Internal helpers.

function readU8(wr: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (wr[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

function writeU8(wr: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return;
  wr[a - WORK_RAM_BASE] = value & 0xff;
}

function readS16(wr: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return 0;
  const o = a - WORK_RAM_BASE;
  const w = (((wr[o] ?? 0) << 8) | (wr[o + 1] ?? 0)) & 0xffff;
  return w >= 0x8000 ? w - 0x10000 : w;
}

function writeU32BE(wr: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return;
  const o = a - WORK_RAM_BASE;
  const v = value >>> 0;
  wr[o]     = (v >>> 24) & 0xff;
  wr[o + 1] = (v >>> 16) & 0xff;
  wr[o + 2] = (v >>> 8)  & 0xff;
  wr[o + 3] =  v         & 0xff;
}

/** Sign-extend byte (8-bit) to signed JS number. */
function sextB(b: number): number {
  const v = b & 0xff;
  return v >= 0x80 ? v - 0x100 : v;
}


/**
 *
 * Execute `FUN_00025C74`.
 *
 * @param objPtr Absolute object pointer, for example `0x400018`.
 * @param deltaRaw Low 16 bits of the second long argument, interpreted as D1.w.
 * @param subs External sub-JSR callbacks. Defaults are no-ops.
 */
export function helper25C74(
  state: GameState,
  objPtr: number,
  deltaRaw: number,
  subs: Helper25C74Subs = {},
): void {
  const wr = state.workRam;
  const obj = objPtr >>> 0;

  // move.b (0x1a,A2),D3b  — save state (D3b)
  const d3b = readU8(wr, obj + 0x1a);

  const d1w = deltaRaw & 0xffff;
  const d1wSigned = d1w >= 0x8000 ? d1w - 0x10000 : d1w;

  // ── Fase 2: Is-pair-member check ───────────────────────────────────────
  // moveq 0x1, D0
  // cmpa.l #0x400018, A2 / beq 0x25CA2
  // cmpa.l #0x4000FA, A2 / beq 0x25CA2
  // clr.b D0b
  // move.b D0b, D2b
  const isPair =
    obj === OBJ_PAIR_FIRST || obj === OBJ_PAIR_SECOND ? 1 : 0;

  // ── Fase 3: State init basata su isPair ────────────────────────────────
  if (isPair !== 0) {
    // D2 != 0 → branch NOT taken (bne passes, beq goes to 0x25CBC)
    // cmpi.b #0x6, (0x1a,A2) / bne 0x25CB4
    if (readU8(wr, obj + 0x1a) === 0x06) {
      // move.b #0x3, (0x18,A2)
      writeU8(wr, obj + 0x18, 0x03);
    }
    // [0x25CB4]: move.b #0x1, (0x1a,A2)
    writeU8(wr, obj + 0x1a, 0x01);
    // bra 0x25CC2
  } else {
    // [0x25CBC]: move.b #0x24, (0x1a,A2)
    writeU8(wr, obj + 0x1a, 0x24);
  }

  // ── Fase 4: obj_type delta + clamp a 0x7F ─────────────────────────────
  // move.b (0x57,A2), D0b  /  ext.w D0w  /  move.w D0w, D4w
  // add.w D1w, D4w
  // moveq 0x7f, D0; cmp.w D4w, D0w; bge 0x25CD4  (branch if 0x7F >= D4w)
  // moveq 0x7f, D4
  // [0x25CD4]: move.b D4b, (0x57,A2)
  const byte57 = readU8(wr, obj + 0x57);
  // ext.w D0 → sign-extend byte to word (16-bit)
  const d0w = byte57 >= 0x80 ? byte57 - 0x100 : byte57;
  let d4w = (d0w + d1wSigned) & 0xffff;
  // Interpret as signed for clamp check
  const d4wSigned = d4w >= 0x8000 ? d4w - 0x10000 : d4w;
  // cmp.w D4w, D0w (D0=0x7F): D0w - D4w; bge if 0x7F >= D4w (signed)
  // → if NOT (0x7F >= D4w) → D4w > 0x7F → clamp to 0x7F
  if (d4wSigned > 0x7f) {
    d4w = 0x7f;
  }
  writeU8(wr, obj + 0x57, d4w & 0xff);

  // ── Fase 5: Dispatch basato su isPair ──────────────────────────────────
  // tst.b D2b / beq 0x25DBA
  if (isPair === 0) {
    // ──────────────────────────────────────────────────────────────────────
    // PATH !isPair (D2 == 0) — 0x25DBA
    // ──────────────────────────────────────────────────────────────────────
    // move.b D1b, D0b  /  add.b D0b, (0x56,A2)
    const d1b = d1w & 0xff;
    const step56old = readU8(wr, obj + 0x56);
    const step56new = (step56old + d1b) & 0xff;
    writeU8(wr, obj + 0x56, step56new);

    // cmpi.b #0x50, (0x56,A2); bgt 0x25DD0
    const step56Signed = step56new >= 0x80 ? step56new - 0x100 : step56new;
    const overflow = step56Signed > 0x50;

    if (!overflow) {
      // moveq 0x1f, D0; cmp.w D1w, D0w; bge 0x25DF0
      // D0w - D1w; bge if D0w >= D1w (signed) -> skip if 0x1F >= D1w
      if (d1wSigned <= 0x1f) {
        // Epilog — no-op
        return;
      }
    }

    // [0x25DD0]: both overflow and D1w > 0x1F -> call FUN_15BD0 + FUN_25BAE
    // clr.l -(SP) / pea (0x1).w / move.l A2,-(SP) / jsr FUN_15BD0
    subs.stateSub15BD0?.(state, obj, 1, 0);
    // move.b #0x2, (0x18,A2)
    writeU8(wr, obj + 0x18, 0x02);
    // pea (0x2).w / move.l A2,-(SP) / jsr (A3)=FUN_25BAE / lea (0x14,SP),SP
    subs.objectStateEntry25BAE?.(state, obj, 0x02);
    return;
  }

  // ──────────────────────────────────────────────────────────────────────
  // PATH isPair (D2 != 0)
  // ──────────────────────────────────────────────────────────────────────
  // move.b (0x56,A2), D0b / ext.w D0w / ext.l D0
  const byte56 = readU8(wr, obj + 0x56);
  const d0 = sextB(byte56);          // sign-extend byte → 32-bit (JS number)

  // move.b (0x57,A2), D1b / ext.w D1w / ext.l D1
  // NB: A2[+0x57] was just written in fase 4
  const byte57new = readU8(wr, obj + 0x57);
  let d1 = sextB(byte57new);         // sign-extend byte → 32-bit

  // move.b (0x56,A2), D2b / ext.w D2w / ext.l D2
  const d2 = sextB(byte56);          // same as D0

  // sub.l D2, D1  →  D1 = D1 - D2  (signed long)
  d1 = d1 - d2;

  // asr.l #0x1, D1  →  D1 >>= 1 (arithmetic, JS >> works for signed)
  d1 = d1 >> 1;

  // add.l D1, D0  →  D0 = D0 + D1
  const d0final = d0 + d1;

  // moveq 0x1f, D1_check; cmp.l D0, D1_check → D1_check - D0; bge if 0x1F >= D0
  // → advance path only if D0 > 0x1F (signed long)
  if (d0final > 0x1f) {
    // ─── Advance path ──────────────────────────────────────────────────
    // move.w (0x20,A2), D2w; andi.w #-1, D2w (= keep all bits)
    const d2w = readS16(wr, obj + 0x20);

    // Range check: -16 <= D2w < 240
    // moveq -0x10, D0 → D0.w = -16; cmp.w D2w,D0w; bge 0x25D52 if -16 >= D2w
    // cmpi.w #0xF0, D2w; bge 0x25D52 if D2w >= 240 (0xF0)
    const inRange = d2w >= -0x10 && d2w < 0xf0;

    if (d3b === 0x01 || d3b === 0x05) {
      // jsr FUN_15884
      subs.soundPair15884?.(state);
      // clr.b (0x5f,A2)
      writeU8(wr, obj + 0x5f, 0x00);
      // move.b #0x1, (0x56,A2)
      writeU8(wr, obj + 0x56, 0x01);
      // move.b #0x2, (0x60,A2)
      writeU8(wr, obj + 0x60, 0x02);
      // move.l #0x20FD2, (0x5a,A2)
      writeU32BE(wr, obj + 0x5a, ANIM_PTR_LOW);

      if (inRange) {
        // pea (0x2).w / move.l A2,-(SP) / jsr (A3) / addq.l 0x8,SP
        subs.objectStateEntry25BAE?.(state, obj, 0x02);
      } else {
        // move.b #0x64, (0x57,A2)
        writeU8(wr, obj + 0x57, 0x64);
        // pea (0x4).w / move.l A2,-(SP) / jsr (A3) / addq.l 0x8,SP
        subs.objectStateEntry25BAE?.(state, obj, 0x04);
      }
      return;
    }

    // D3b != 1 and != 5
    if (inRange) {
      // pea (0x2).w / move.l A2,-(SP) / jsr (A3) / addq.l 0x8,SP
      subs.objectStateEntry25BAE?.(state, obj, 0x02);
    } else {
      // move.b #0x64, (0x57,A2)
      writeU8(wr, obj + 0x57, 0x64);
      // pea (0x4).w / move.l A2,-(SP) / jsr (A3) / addq.l 0x8,SP
      subs.objectStateEntry25BAE?.(state, obj, 0x04);
    }
    return;
  }

  // ─── Cap path (D0 <= 0x1F) ────────────────────────────────────────────
  // cmpi.b #0x1, D3b; beq 0x25DF0 → if D3b == 1 → return (epilog)
  if (d3b === 0x01) {
    return;
  }

  // clr.b (0x5f,A2)
  writeU8(wr, obj + 0x5f, 0x00);
  // move.b #0x2, (0x60,A2)
  writeU8(wr, obj + 0x60, 0x02);
  // move.l #0x20FAA, (0x5a,A2)
  writeU32BE(wr, obj + 0x5a, ANIM_PTR_CAP);
  // pea (0x39).l / jsr FUN_158AC / addq.l 0x4,SP
  subs.soundCommand?.(0x39);
}
