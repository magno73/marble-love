/**
 * late-game-logic-26f3e.ts — replica `FUN_00026F3E` (4848 byte, 6 callers).
 *
 * **Semantica**: orchestratore principale del rendering degli sprite di gioco.
 * Tre fasi principali:
 *
 *   1. **bufferFill1B12A** per ogni entità in workRam[0x3BC..0x3DB]
 *   2. **sortAdjacentObjects** 3× con stride 1/2/3 (se workRam[0x3E2]==0)
 *   3. **Setup cursors** + **entity sprite dispatch** via switch per tipo
 *
 * Verifica bit-perfect via `packages/cli/src/test-late-game-logic-26f3e-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { bufferFill1B12A } from "./buffer-fill-1b12a.js";
import { sortAdjacentObjects1A7A8 } from "./sort-adjacent-objects-1a7a8.js";
import { moBlockEmit1A8D2 } from "./mo-block-emit-1a8d2.js";

// ─── Address constants ────────────────────────────────────────────────────────

/** Address of FUN_00026F3E in M68k space. */
export const LATE_GAME_LOGIC_26F3E_ADDR = 0x00026f3e as const;

const WRAM          = 0x00400000;
const WRAM_END      = 0x00402000;
const ROM_END       = 0x00080000;
const SPRITE_BASE   = 0x00a02000;
const SPRITE_END    = 0x00a03000;
const ALPHA_BASE    = 0x00a03000;
const ALPHA_END     = 0x00a04000;
const PAL_BASE      = 0x00b00000;
const PAL_END       = 0x00b00800;

const PLAYER1_OBJ   = 0x00400018;
const PLAYER2_OBJ   = 0x004000fa;

const ROM_LOOKUP    = 0x1f0e2;        // entity pointer lookup table

const ENTITY_BASE   = 0x004003bc;     // entity list start (absolute)
const ENTITY_END    = 0x004003dc;     // entity list end (exclusive)
const SENTINEL      = 0xff;

// Cursor long addresses (absolute M68k)
const CUR_A3_ADDR   = WRAM + 0x3f6;  // → 0xA02000-based
const CUR_A1_ADDR   = WRAM + 0x3fa;  // → 0xA02080-based
const CUR_A2_ADDR   = WRAM + 0x3fe;  // → 0xA02100-based
const CUR_A4_ADDR   = WRAM + 0x402;  // → 0xA02180-2-based
const CNT_ADDR      = WRAM + 0x406;  // D7 sprite counter word

// ─── Memory access helpers ────────────────────────────────────────────────────

function rb(state: GameState, rom: RomImage, a: number): number {
  const addr = a >>> 0;
  if (addr < ROM_END)                           return (rom.program[addr] ?? 0) & 0xff;
  if (addr >= WRAM && addr < WRAM_END)          return (state.workRam[addr - WRAM] ?? 0) & 0xff;
  if (addr >= SPRITE_BASE && addr < SPRITE_END) return (state.spriteRam[addr - SPRITE_BASE] ?? 0) & 0xff;
  if (addr >= ALPHA_BASE && addr < ALPHA_END)   return (state.spriteRam[addr - ALPHA_BASE] ?? 0) & 0xff;
  if (addr >= PAL_BASE && addr < PAL_END)       return (state.colorRam[addr - PAL_BASE] ?? 0) & 0xff;
  return 0;
}
function rw(state: GameState, rom: RomImage, a: number): number {
  return ((rb(state, rom, a) << 8) | rb(state, rom, a + 1)) & 0xffff;
}
function rl(state: GameState, rom: RomImage, a: number): number {
  return (((rw(state, rom, a) << 16) | rw(state, rom, a + 2)) >>> 0);
}

function wb(state: GameState, a: number, v: number): void {
  const addr = a >>> 0; const val = v & 0xff;
  if (addr >= WRAM && addr < WRAM_END)          { state.workRam[addr - WRAM] = val; return; }
  if (addr >= SPRITE_BASE && addr < SPRITE_END) { state.spriteRam[addr - SPRITE_BASE] = val; return; }
  if (addr >= ALPHA_BASE && addr < ALPHA_END)   { state.spriteRam[addr - ALPHA_BASE] = val; return; }
  if (addr >= PAL_BASE && addr < PAL_END)       { state.colorRam[addr - PAL_BASE] = val; return; }
}
function ww(state: GameState, a: number, v: number): void {
  const val = v & 0xffff;
  wb(state, a, (val >>> 8) & 0xff);
  wb(state, a + 1, val & 0xff);
}
function wl(state: GameState, a: number, v: number): void {
  const val = v >>> 0;
  ww(state, a, (val >>> 16) & 0xffff);
  ww(state, a + 2, val & 0xffff);
}

/** Read 4-byte BE long from ROM at absolute address. */
function romL(rom: RomImage, a: number): number {
  const o = a >>> 0;
  return (((rom.program[o] ?? 0) << 24) | ((rom.program[o+1] ?? 0) << 16) |
          ((rom.program[o+2] ?? 0) << 8) | (rom.program[o+3] ?? 0)) >>> 0;
}

/** Sign-extend byte. */
function s8(b: number): number { const x = b & 0xff; return x >= 0x80 ? x - 0x100 : x; }
/** Sign-extend word. */
function s16(w: number): number { const x = w & 0xffff; return x >= 0x8000 ? x - 0x10000 : x; }

// ─── Sprite cursor emit helpers ───────────────────────────────────────────────

/** Emit a word to cursor pointed-to address and advance cursor by 2. */
function curEmit(state: GameState, rom: RomImage, curAddr: number, val: number): void {
  const ptr = rl(state, rom, curAddr);
  ww(state, ptr, val);
  wl(state, curAddr, (ptr + 2) >>> 0);
}

/**
 * Emit one sprite entry to all four cursor buffers and increment D7 counter.
 * Matches the pattern: cursors A1(code), A2(xEnc), A3(yEnc), A4(D7).
 */
function emitSprite(
  state: GameState,
  rom: RomImage,
  code: number,
  xEnc: number,
  yEnc: number,
): void {
  const d7 = rw(state, rom, CNT_ADDR);
  curEmit(state, rom, CUR_A1_ADDR, code);
  curEmit(state, rom, CUR_A2_ADDR, xEnc);
  curEmit(state, rom, CUR_A3_ADDR, yEnc);
  curEmit(state, rom, CUR_A4_ADDR, d7);
  ww(state, CNT_ADDR, (d7 + 1) & 0xffff);
}

// ─── Sub-injection interface ──────────────────────────────────────────────────

/**
 * Substitution callbacks for differential testing.
 * Default: real bit-perfect implementations.
 */
export interface LateGameLogic26F3ESubs {
  fun_1b12a?:     (state: GameState, rom: RomImage, rectBuf: Uint8Array) => void;
  fun_1a7a8?:     (state: GameState, rom: RomImage, stride: number) => void;
  fun_1a8d2_emit?: (state: GameState, arg0Ptr: number, arg1: number, arg2: number, arg3: number, rom: RomImage) => void;
}

function moEmit(
  state: GameState, rom: RomImage,
  arg0: number, arg1: number, arg2: number, arg3: number,
  subs: LateGameLogic26F3ESubs,
): void {
  if (subs.fun_1a8d2_emit) {
    subs.fun_1a8d2_emit(state, arg0, arg1, arg2, arg3, rom);
  } else {
    moBlockEmit1A8D2(state, arg0, arg1, arg2, arg3, { romRead: (o) => rom.program[o] ?? 0 });
  }
}

// ─── Entity-type dispatch helpers ─────────────────────────────────────────────

/** Standard coord load: d5 = word[structBase+coordOff] + xBias, d4 = word[+2] + yBias. */
function loadCoords(
  state: GameState, rom: RomImage,
  structBase: number, coordOff: number,
  xBias: number, yBias: number,
): [number, number] {
  const base = (structBase + coordOff) >>> 0;
  const d5 = (rw(state, rom, base)     + xBias) & 0xffff;
  const d4 = (rw(state, rom, base + 2) + yBias) & 0xffff;
  return [d5, d4];
}

function lowerVisibleBoundForStruct(
  state: GameState,
  rom: RomImage,
  structPtr: number,
  defaultBound: number,
): number {
  return rb(state, rom, structPtr + 0x1f) === 0x0a ? -0x40 : defaultBound;
}

/**
 * Iso-projection coord load for the player marble (objPtr in workRam @ 0x400018/0x4000FA).
 *
 * The struct fields `obj+0x1e` (word) and `obj+0x20` (word) are a packed 2-word
 * cache of the isometric screen projection computed elsewhere (mirror of
 * `FUN_19E42 marble-cell-dispatch`). In MAME canonical, these are kept in sync
 * with `(obj.x_long, obj.y_long, obj.z_long)` via a chain of sub-functions
 * (`spriteProject1CC62` + sub `FUN_1CABA` heavy redraw) that we don't fully
 * replicate. As a result, in TS:
 *   - `obj+0x1e` (= `Y_high - X_high + 0x88`) drifts because TS doesn't write
 *     it back.
 *   - `obj+0x20` (= `HUD_OFFSET + Z_high + 0x54 - (X_high+Y_high)/2`) diverges
 *     additionally because obj.z_long itself isn't updated by our chain.
 *
 * Verified formula (bit-perfect vs MAME on 100/100 frames f12000..12099):
 *   D3w = (Y_high - X_high + 0x88) & 0xFFFF              ← stored at +0x1e
 *   D2w = (HUD_OFFSET + Z_high + 0x54 - (X_high+Y_high)/2) & 0xFFFF ← stored at +0x20
 *
 * For the player marble we recompute these directly from
 * `(obj.x_long, obj.y_long, obj.z_long, *0x40097E HUD_OFFSET)` so the screen
 * MO RAM entries land where MAME would put them, eliminating the visual
 * "floating marble" artifact caused by the stale +0x20 cache.
 *
 * @returns `[d5, d4]` analogous to `loadCoords`, where:
 *   - `d5 = (D3w + xBias) & 0xFFFF`
 *   - `d4 = (D2w + yBias) & 0xFFFF`
 */
function loadCoordsIsoPlayer(
  state: GameState,
  objPtr: number,
  xBias: number, yBias: number,
): [number, number] {
  // Read high words of obj.x_long (+0xC), obj.y_long (+0x10), obj.z_long (+0x14).
  const xOff = (objPtr - WRAM + 0x0c) >>> 0;
  const yOff = (objPtr - WRAM + 0x10) >>> 0;
  const zOff = (objPtr - WRAM + 0x14) >>> 0;
  const xW = ((state.workRam[xOff] ?? 0) << 8) | (state.workRam[xOff + 1] ?? 0);
  const yW = ((state.workRam[yOff] ?? 0) << 8) | (state.workRam[yOff + 1] ?? 0);
  const zW = ((state.workRam[zOff] ?? 0) << 8) | (state.workRam[zOff + 1] ?? 0);
  const hudW = ((state.workRam[0x97e] ?? 0) << 8) | (state.workRam[0x97f] ?? 0);

  const xS = s16(xW);
  const yS = s16(yW);
  const zS = s16(zW);
  const hudS = s16(hudW);

  // D3w = Y_high - X_high + 0x88 (word arithmetic, m68k signed sub+addi).
  const d3w = (yS - xS + 0x88) & 0xffff;
  // avg = (X_high + Y_high) >> 1 (signed asr.l #1 of sext sum, low word used).
  const avg = (xS + yS) >> 1;
  // D2w = HUD_OFFSET + Z_high + 0x54 - avg (word arithmetic).
  const d2w = (hudS + zS + 0x54 - avg) & 0xffff;

  const d5 = (d3w + xBias) & 0xffff;
  const d4 = (d2w + yBias) & 0xffff;
  return [d5, d4];
}

/** Inner sub-sprite loop: iterates entries at baseAddr (6 bytes each), up to maxCount. */
function innerSprites(
  state: GameState, rom: RomImage,
  baseAddr: number, maxCount: number,
): void {
  for (let i = 0; i < maxCount; i++) {
    const a = (baseAddr + i * 6) >>> 0;
    const w0 = rw(state, rom, a);
    if (w0 === 0) break;
    const d6   = (w0 & 0x8000) | ((w0 >> 11) & 7);
    const code = w0 & 0x7ff;
    const w1   = rw(state, rom, a + 2);
    const w2   = rw(state, rom, a + 4);
    const xEnc = (((s16(w1) + 0x18) * 32) & 0x3fe0) | 0x8000;
    const yEnc = (((s16(w2) + 0x10) * 32) & 0x3fe0) | d6;
    emitSprite(state, rom, code, xEnc, yEnc);
  }
}

/**
 * Type 1 (0x2724c): ROM table 0x1EFF6. Player marble.
 *
 * Control flow (disasm 0x2724c..0x276e8):
 *   1. tst.b (0x1c, A5) → if 0, return (entity not active).
 *   2. Compute locals: animState=(0x1a,A5).b, subCode=(0x19,A5).b,
 *      frameNeg10=subCode<<11, d5/d4 from loadCoords(0x1e, +0x18/+0x10).
 *      localE=5 (long, M68k local @ -$e(A6)).
 *   3. If animState in {4,10,11,9,2,1,5}: skip first/second direct emits.
 *   4. Else: animState==8 special handling for *(0xcc,A5)→pCC, *pCC long.
 *   5. localE |= sign_ext_long(frameNeg10).
 *   6. FIRST direct emit: code = low_word(localE) (NOT orMask!),
 *      X=((a1w-8)*32)&0x3fe0, Y=(d2*32)&0x3fe0 | 1, A4=D7.
 *      Disasm 0x27376-0x2737E: `move.w (-0xc,A6),D0w; andi.w #-0x1,D0w;`
 *      reads LOW WORD of -$e(A6) long.
 *   7. SECOND direct emit: if animState==8 && frameNeg1!=0: localE+=2.
 *      Else: localE = ext_long(frameNeg10) | 3.
 *      code=low_word(localE), X=(a1w*32)&0x3fe0, Y=(d2*32)&0x3fe0 | 1.
 *   8. At 0x27442: if animState in {2,9,1,5} → goto 0x2750a (skip inner loop).
 *      But that path falls through to 0x275d8 where animState in {2,9,1,5} →
 *      moEmit `rl(rl(objPtr+0x5a))` doSubEmit, then exit.
 *   9. INNER LOOP 1 (only for animStates 0,3,6,7,8,10,11,12,13,14,15...) at
 *      objPtr+0xa4, max 4 iters:
 *      D6 = (w0 & 0x8000) | ((w0 >> 11) & 7)
 *      code = (w0 & 0x7ff) | frameNeg10
 *      X = (s16(w1) + 0x18) << 5 & 0x3fe0   (NO |0x8000 mask, unlike type 2/15)
 *      Y = (s16(w2) + 0x10) << 5 & 0x3fe0 | D6
 *  10. At 0x2750a: if animState in {4,10,11} → skip 3rd direct emit (animStates
 *      2/9/1/5 already exited at step 8; this branch covers 4/10/11). Else:
 *      animState==8 && locals[-1]!=0 → skip; else: THIRD direct emit.
 *      localE = ext_long(frameNeg10) | 7. D6 = HIGH word of localE long
 *      (= sign-extension of frameNeg10; 0 if frameNeg10 < 0x8000).
 *      code = low_word(localE) = frameNeg10 | 7.
 *      X = ((d5-8)*32) & 0x3fe0.  Y = ((d4+5)*32) & 0x3fe0 | D6.
 *  11. INNER LOOP 2 at objPtr+0x38, max 5 iters (TODO: not modeled yet —
 *      complex encoding with 0x4000 bit check). For obj0 demo gameplay,
 *      objPtr+0x38 contains data but the encoding differs from inner loop 1.
 */
function dispatchType1(
  state: GameState, rom: RomImage,
  a1Ptr: number, orMask: number,
  subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const d1     = (s8(subIdxB) << 2) | 0;
  const objPtr = romL(rom, (0x1eff6 + d1) >>> 0);

  if (rb(state, rom, objPtr + 0x1c) === 0) return;

  const animState  = rb(state, rom, objPtr + 0x1a) & 0xff;
  const subCode    = rb(state, rom, objPtr + 0x19) & 0xff;
  const frameNeg10 = (subCode << 11) & 0xffff;

  // The player marble's screen-projection cache @ obj+0x1e/+0x20 is kept in
  // sync with (obj.x, obj.y, obj.z) by MAME via sub-functions we don't fully
  // replicate (FUN_1CABA heavy tile redraw). Recompute only for the two player
  // objects. Other type-1 workRam entries (pair/script slots) maintain their
  // own cache and must render from it, otherwise physics and visuals drift.
  const [d5, d4] =
    objPtr === PLAYER1_OBJ || objPtr === PLAYER2_OBJ
      ? loadCoordsIsoPlayer(state, objPtr, 0x18, 0x10)
      : loadCoords(state, rom, objPtr, 0x1e, 0x18, 0x10);

  const skipFirstTwoEmits = (animState === 4 || animState === 10 || animState === 11 ||
    animState === 9 || animState === 2 || animState === 1 || animState === 5);

  let d2 = d4;
  let a1w = d5;
  let localE = 5;       // -$e(A6) long
  let frameNeg1 = 0;    // -$1(A6) byte

  // Sign-extend frameNeg10 word to long (M68k ext.l).
  function extL(w: number): number {
    return (w & 0x8000) ? (0xffff0000 | w) >>> 0 : (w >>> 0);
  }

  if (!skipFirstTwoEmits) {
    if (animState === 8) {
      const pCC = rl(state, rom, objPtr + 0xcc);
      const vCC = rl(state, rom, pCC);
      if (vCC === 0x000215c6) {
        localE = 0x104;
        d2 = (d2 - 5) & 0xffff;
        frameNeg1 = 1;
      } else if (vCC === 0x000215ea) {
        localE = 0x108;
        a1w = (a1w + 2) & 0xffff;
        frameNeg1 = 2;
      }
    }
    localE = (localE | extL(frameNeg10)) >>> 0;

    // FIRST direct emit: code = low_word(localE)
    {
      const xv = ((s16(a1w) - 8) * 32) & 0x3fe0;
      const yv = (s16(d2) * 32) & 0x3fe0 | 1;
      const d7v = rw(state, rom, CNT_ADDR);
      curEmit(state, rom, CUR_A1_ADDR, localE & 0xffff);
      curEmit(state, rom, CUR_A2_ADDR, xv);
      curEmit(state, rom, CUR_A3_ADDR, yv);
      curEmit(state, rom, CUR_A4_ADDR, d7v);
      ww(state, CNT_ADDR, (d7v + 1) & 0xffff);
    }

    // SECOND direct emit
    if (animState === 8 && frameNeg1 !== 0) {
      localE = (localE + 2) >>> 0;
    } else {
      localE = (extL(frameNeg10) | 3) >>> 0;
    }
    {
      const xv2 = (s16(a1w) * 32) & 0x3fe0;
      const yv2 = (s16(d2) * 32) & 0x3fe0 | 1;
      const d7v2 = rw(state, rom, CNT_ADDR);
      curEmit(state, rom, CUR_A1_ADDR, localE & 0xffff);
      curEmit(state, rom, CUR_A2_ADDR, xv2);
      curEmit(state, rom, CUR_A3_ADDR, yv2);
      curEmit(state, rom, CUR_A4_ADDR, d7v2);
      ww(state, CNT_ADDR, (d7v2 + 1) & 0xffff);
    }
  }

  const skipInner1 = animState === 2 || animState === 9 || animState === 1 || animState === 5;

  // At 0x27442: animState in {2,9,1,5} skips inner loop 1 and the third
  // direct emit, but still falls through to inner loop 2 at obj+0x38.
  if (skipInner1) {
    const sp5a = rl(state, rom, objPtr + 0x5a);
    moEmit(state, rom, rl(state, rom, sp5a), d5, d4, frameNeg10, subs);
  } else {
    // INNER LOOP 1 at objPtr+0xa4, max 4 iters
    let innerA1 = (objPtr + 0xa4) >>> 0;
    for (let i = 0; i < 4; i++) {
      const w0 = rw(state, rom, innerA1);
      if (w0 === 0) break;
      const d6 = (w0 & 0x8000) | ((w0 >> 11) & 7);
      const codeBase = w0 & 0x7ff;
      const code = (codeBase | (frameNeg10 & 0xffff)) & 0xffff;
      const w1 = rw(state, rom, innerA1 + 2);
      const w2 = rw(state, rom, innerA1 + 4);
      const xv = ((s16(w1) + 0x18) * 32) & 0x3fe0;
      const yv = (((s16(w2) + 0x10) * 32) & 0x3fe0) | d6;
      emitSprite(state, rom, code, xv, yv);
      innerA1 = (innerA1 + 6) >>> 0;
    }

    // At 0x2750a: animStates 4/10/11 → skip 3rd direct emit.
    // animState==8 && frameNeg1!=0 → also skip.
    const skip3rd = (animState === 4 || animState === 10 || animState === 11);
    if (!skip3rd && !(animState === 8 && frameNeg1 !== 0)) {
      // THIRD direct emit
      const localE3 = (extL(frameNeg10) | 7) >>> 0;
      const codeOut = localE3 & 0xffff;
      const d6_3 = (localE3 >>> 16) & 0xffff;  // HIGH word of localE long (disasm 0x2758e)
      const xv3 = ((s16(d5) - 8) * 32) & 0x3fe0;
      const yv3 = (((s16(d4) + 5) * 32) & 0x3fe0) | d6_3;
      const d7v3 = rw(state, rom, CNT_ADDR);
      curEmit(state, rom, CUR_A1_ADDR, codeOut);
      curEmit(state, rom, CUR_A2_ADDR, xv3);
      curEmit(state, rom, CUR_A3_ADDR, yv3);
      curEmit(state, rom, CUR_A4_ADDR, d7v3);
      ww(state, CNT_ADDR, (d7v3 + 1) & 0xffff);
    }
  }

  // INNER LOOP 2 at objPtr+0x38, max 5 iters (0x27620..0x276E4).
  {
    let innerA1 = (objPtr + 0x38) >>> 0;
    for (let i = 0; i < 5; i++) {
      const w0 = rw(state, rom, innerA1);
      if (w0 === 0) break;

      const d6 = (w0 & 0x8000) | ((w0 >> 11) & 7);
      const codeBase = w0 & 0x07ff;
      const xFlag = (w0 & 0x4000) !== 0 ? 0x8000 : 0;
      const code = (w0 & 0x4000) !== 0
        ? codeBase
        : (codeBase | (frameNeg10 & 0xffff)) & 0xffff;
      const w1 = rw(state, rom, innerA1 + 2);
      const w2 = rw(state, rom, innerA1 + 4);
      const xv = ((((s16(w1) + 0x18) * 32) & 0x3fe0) | xFlag) & 0xffff;
      const yv = ((((s16(w2) + 0x10) * 32) & 0x3fe0) | d6) & 0xffff;

      emitSprite(state, rom, code, xv, yv);
      innerA1 = (innerA1 + 6) >>> 0;
    }
  }

  // Tail conditionals after the obj+0x38 loop (0x276E8..0x277B2). The long
  // demo state-6 path uses obj+0xD8 to emit the award/banner sprite block;
  // leaving this as a no-op kept D7 at 7 while MAME emitted 11+ entries.
  if (rb(state, rom, objPtr + 0x67) !== 0) {
    const p62 = rl(state, rom, objPtr + 0x62);
    moEmit(state, rom, rl(state, rom, p62), d5, d4, 0x1000, subs);
  }

  if (rb(state, rom, objPtr + 0xd1) !== 0) {
    const pCC = rl(state, rom, objPtr + 0xcc);
    moEmit(state, rom, rl(state, rom, pCC), d5, d4, 0x1000, subs);
  }

  if (rb(state, rom, objPtr + 0xd8) !== 0 &&
      animState !== 4 && animState !== 10 && animState !== 11 &&
      animState !== 7 && animState !== 2) {
    const d4Tail = (d4 + (animState === 6 ? 0x20 : 0x10)) & 0xffff;
    const d5Tail = (d5 + s8(rb(state, rom, objPtr + 0x68))) & 0xffff;
    moEmit(state, rom, rl(state, rom, objPtr + 0xd4), d5Tail, d4Tail, frameNeg10, subs);
  }

  void d2; void orMask;
}

/**
 * Type 2 (0x2777b6): ROM table 0x1EFFE. Similar to type 1 with different sub-tables.
 */
function dispatchType2(
  state: GameState, rom: RomImage,
  a1Ptr: number, orMask: number,
  subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const d1    = (s8(subIdxB) << 2) | 0;
  const d3    = romL(rom, (0x1effe + d1) >>> 0);

  if (rb(state, rom, d3 + 0x1c) === 0) return;

  const [d5, d4] = loadCoords(state, rom, d3, 0x1e, 0x18, 0x10);

  const byte18 = rb(state, rom, d3 + 0x18);
  if (byte18 !== 2) {
    moEmit(state, rom, 0x21f36, d5, d4, 0x2800, subs);
  } else {
    const sp = rl(state, rom, d3 + 0x5a);
    moEmit(state, rom, rl(state, rom, sp), d5, d4, 0x2800, subs);
  }

  // Inner loop at d3+0x38 (up to 5):
  innerSprites(state, rom, (d3 + 0x38) >>> 0, 5);

  // Conditional second moBlockEmit:
  if (rb(state, rom, d3 + 0x67) !== 0) {
    const sp2 = rl(state, rom, d3 + 0x62);
    moEmit(state, rom, rl(state, rom, sp2), d5, d4, 0x1000, subs);
  }
  void orMask;
}

/**
 * Type 3 (0x27a16): ROM table 0x1F016, struct+0x4e, 4 moBlockEmit calls.
 */
function dispatchType3(
  state: GameState, rom: RomImage,
  a1Ptr: number, subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const sp = romL(rom, (0x1f016 + (s8(subIdxB) << 2)) >>> 0);
  const [d5, d4] = loadCoords(state, rom, sp, 0x4e, 0x18, 0x10);
  if (s16(d4) >= 0x160) return;
  // 3 fixed-ptr calls + 1 struct call:
  moEmit(state, rom, rl(state, rom, rl(state, rom, 0x40044a)), d5, d4, 0x3800, subs);
  moEmit(state, rom, rl(state, rom, rl(state, rom, 0x40044e)), d5, d4, 0x3800, subs);
  moEmit(state, rom, rl(state, rom, rl(state, rom, 0x400452)), d5, d4, 0x3800, subs);
  moEmit(state, rom, rl(state, rom, rl(state, rom, sp + 0x42)), d5, d4, 0x3000, subs);
}

/**
 * Type 4 (0x27ac4): ROM table 0x1F006, struct+0x28, inner sub-sprite word loop.
 */
function dispatchType4(
  state: GameState, rom: RomImage,
  a1Ptr: number, subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const sp = romL(rom, (0x1f006 + (s8(subIdxB) << 2)) >>> 0);
  const [d5, d4] = loadCoords(state, rom, sp, 0x28, 0x18, 0x10);
  if (s16(d4) >= 0x100) return;
  moEmit(state, rom, rl(state, rom, rl(state, rom, sp + 0x58)), d5, d4, 0x2000, subs);

  // Inner loop at sp+0x2c using a word-stride array (tst.w (a1) / addq.l #1,a2):
  // The inner entries here are 6-byte records (3 words). Up to 5 entries.
  // Each entry: word(code | 0x8000?), word(x), word(y) for direct buffer writes.
  // Disasm 0x27b20: `lea (0x2c,A5),A0` → A0 = sp + 0x2c DIRECTLY (NOT deref).
  // Then `movea.l D0,A1` → A1 = sp + 0x2c. Walks (A1)+ word by word.
  let innerA1 = (sp + 0x2c) >>> 0;
  for (let i = 0; i < 5; i++) {
    const w0 = rw(state, rom, innerA1);
    if (w0 === 0) break;
    const d6 = (w0 & 0x8000) | ((w0 >> 11) & 7);
    const codeV = w0 & 0x7ff;
    // Direct cursor writes (not via innerSprites helper):
    const xr = rw(state, rom, innerA1 + 2);
    const yr = rw(state, rom, innerA1 + 4);
    const xv = (((s16(xr) + 0x18) * 32) & 0x3fe0) | 0x8000;
    const yv = (((s16(yr) + 0x10) * 32) & 0x3fe0) | d6;
    emitSprite(state, rom, codeV, xv, yv);
    innerA1 = (innerA1 + 6) >>> 0;
  }
}

/**
 * Type 5 (0x27dd0): ROM table 0x1F016, struct+0x4e, +0x17 x-bias (not +0x18).
 */
function dispatchType5(
  state: GameState, rom: RomImage,
  a1Ptr: number, subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const sp = romL(rom, (0x1f016 + (s8(subIdxB) << 2)) >>> 0);
  const [d5, d4] = loadCoords(state, rom, sp, 0x4e, 0x17, 0x10); // note +0x17 not +0x18
  const p42 = rl(state, rom, sp + 0x42);
  const d4s = s16(d4);
  // Disasm 0x27DF6..0x27E1C: emit current *(p42) for -0x40 < d4 < 0x100.
  if (d4s <= -0x40 || d4s >= 0x100) return;
  const arg = rl(state, rom, p42);
  if (arg !== 0xffffffff) {
    moEmit(state, rom, arg, d5, d4, 0x1800, subs);
  }
}

/**
 * Type 6 (0x27ed4): ROM table 0x1F016, velocity-based animation loop.
 */
function dispatchType6(
  state: GameState, rom: RomImage,
  a1Ptr: number, subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const sp = romL(rom, (0x1f016 + (s8(subIdxB) << 2)) >>> 0);
  const [d5, d4] = loadCoords(state, rom, sp, 0x4e, 0x18, 0x10);
  const p42 = rl(state, rom, sp + 0x42);
  const p46 = rl(state, rom, sp + 0x46);
  const d6v = (((p42 - p46) >> 2) & 0xffff);
  if (s16(d4) < 0xc0 || s16(d4) >= 0x140) return;
  // orMask depends on pointer comparison: movea.l #0x220ee,a0; cmpa.l (a5),a0; bls
  const useLow = (p42 >>> 0) <= 0x220ee;
  const emitOM = useLow ? 0x3800 : 0x2800;
  moEmit(state, rom, rl(state, rom, p42), d5, d4, emitOM, subs);
  // Check p46 against 0x2227a:
  if (p46 !== 0x0002227a) return;
  // Look up ROM word table @ 0x20f64 + d6v*2:
  const idx6 = s16(d6v);
  if (idx6 < 0) return;
  const tableWord = ((rom.program[0x20f64 + idx6 * 2] ?? 0) << 8) | (rom.program[0x20f64 + idx6 * 2 + 1] ?? 0);
  if (tableWord === 0xffff) return;
  // Byte table @ 0x20f92 + d6v for y-offset:
  const yOff = s8(rom.program[0x20f92 + idx6] ?? 0);
  const d4b = (d4 + 8) & 0xffff; void d4b; // +8 not used directly
  const d5b = (d5 + 8) & 0xffff;
  const d4c = (d4 - 0x40 + yOff) & 0xffff;
  const d3v = tableWord & 0x7ff;
  const d6b = (tableWord & 0x8000) | ((tableWord >> 11) & 7);
  // Inner loop (up to 4 iterations):
  let d2cnt = 0;
  let curD4 = d4c; let curD5 = d5b;
  while (d2cnt < 4) {
    const codeV = d3v;
    const xv = (s16(curD5) * 32) & 0x3fe0 | 0x8000;
    const yv = (s16(curD4) * 32) & 0x3fe0 | d6b;
    const d7v = rw(state, rom, CNT_ADDR);
    curEmit(state, rom, CUR_A1_ADDR, codeV);
    curEmit(state, rom, CUR_A2_ADDR, xv);
    curEmit(state, rom, CUR_A3_ADDR, yv);
    curEmit(state, rom, CUR_A4_ADDR, d7v);
    ww(state, CNT_ADDR, (d7v + 1) & 0xffff);
    curD5 = (curD5 + 8) & 0xffff;
    curD4 = (curD4 + 4) & 0xffff;
    d2cnt++;
    if (d2cnt >= 4) break;
  }
}

/**
 * Types 7/8/9 (0x28018/0x2806e/0x280c4): ROM table 0x1F096, struct+0x20.
 */
function dispatchType7_9(
  state: GameState, rom: RomImage,
  a1Ptr: number, entityType: number,
  subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const sp = romL(rom, (0x1f096 + (s8(subIdxB) << 2)) >>> 0);
  const [d5, d4] = loadCoords(state, rom, sp, 0x20, 0x18, 0x10);
  if (s16(d4) < 0xf0 || s16(d4) >= 0x100) return;
  const om7: Record<number, number> = { 7: 0x2800, 8: 0x3000, 9: 0x2000 };
  moEmit(state, rom, rl(state, rom, rl(state, rom, sp + 0x1c)), d5, d4, om7[entityType] ?? 0x2800, subs);
}

/**
 * Type 10 (0x27e26): ROM table 0x1F016, struct+0x4e, single moBlockEmit.
 */
function dispatchType10(
  state: GameState, rom: RomImage,
  a1Ptr: number, subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const sp = romL(rom, (0x1f016 + (s8(subIdxB) << 2)) >>> 0);
  const [d5, d4] = loadCoords(state, rom, sp, 0x4e, 0x18, 0x10);
  const d4s = s16(d4);
  if (d4s < lowerVisibleBoundForStruct(state, rom, sp, 0xc0) || d4s >= 0x120) return;
  moEmit(state, rom, rl(state, rom, rl(state, rom, sp + 0x42)), d5, d4, 0x3000, subs);
}

/**
 * Types 11/13 (0x27c16): ROM table 0x1F016, inline sprite + direct cursor writes.
 */
function dispatchType11_13(
  state: GameState, rom: RomImage,
  a1Ptr: number,
  subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const sp = romL(rom, (0x1f016 + (s8(subIdxB) << 2)) >>> 0);
  const [d5base, d4base] = loadCoords(state, rom, sp, 0x4e, 0x18, 0x10);
  const d4baseS = s16(d4base);
  if (d4baseS < lowerVisibleBoundForStruct(state, rom, sp, 0xe0) || d4baseS >= 0x100) return;

  moEmit(state, rom, rl(state, rom, rl(state, rom, sp + 0x42)), d5base, d4base, 0x1800, subs);

  // Direct cursor writes for 2 entries:
  let d5 = (d5base - 8) & 0xffff;
  let d4 = (d4base + 0xffc0) & 0xffff; // -= 0x40
  const byte1f = rb(state, rom, sp + 0x1f);
  if (byte1f === 0x0d) d4 = (d4 + 4) & 0xffff;

  // Entry 1: code=0x0500, xv=(d5<<5)&0x3fe0|0x8000, yv=d4
  function emitDirect(curD5: number, curD4: number): void {
    const xv = ((s16(curD5) * 32) & 0x3fe0) | 0x8000;
    const yv = (s16(curD4) * 32) & 0x3fe0;
    const yvF = byte1f === 0x0d ? yv | 6 | 0x8000 : yv | 6;
    const d7v = rw(state, rom, CNT_ADDR);
    curEmit(state, rom, CUR_A1_ADDR, 0x0500);
    curEmit(state, rom, CUR_A2_ADDR, xv);
    // A3 cursor uses a2 = cursor A3 addr (the (a2) dereference):
    curEmit(state, rom, CUR_A3_ADDR, yvF);
    curEmit(state, rom, CUR_A4_ADDR, d7v);
    ww(state, CNT_ADDR, (d7v + 1) & 0xffff);
  }
  emitDirect(d5, d4);

  // Adjust for second entry:
  if (byte1f === 0x0d) d4 = (d4 - 4) & 0xffff;
  else d4 = (d4 + 4) & 0xffff;
  d5 = (d5 + 8) & 0xffff;
  emitDirect(d5, d4);
}

/**
 * Type 12 (0x27d7a): ROM table 0x1F016, struct+0x4e, single moBlockEmit.
 */
function dispatchType12(
  state: GameState, rom: RomImage,
  a1Ptr: number, subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const sp = romL(rom, (0x1f016 + (s8(subIdxB) << 2)) >>> 0);
  const [d5, d4] = loadCoords(state, rom, sp, 0x4e, 0x18, 0x10);
  const d4s = s16(d4);
  if (d4s < lowerVisibleBoundForStruct(state, rom, sp, 0xe0) || d4s >= 0x100) return;
  moEmit(state, rom, rl(state, rom, rl(state, rom, sp + 0x42)), d5, d4, 0x3800, subs);
}

/**
 * Type 14 (0x27bc0): ROM table 0x1F07A, struct+0x28.
 */
function dispatchType14(
  state: GameState, rom: RomImage,
  a1Ptr: number, subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const sp = romL(rom, (0x1f07a + (s8(subIdxB) << 2)) >>> 0);
  const [d5, d4] = loadCoords(state, rom, sp, 0x28, 0x18, 0x10);
  if (s16(d4) < 0xd0 || s16(d4) >= 0x120) return;
  moEmit(state, rom, rl(state, rom, rl(state, rom, sp + 0x3a)), d5, d4, 0x3000, subs);
}

/**
 * Type 15 (0x2811a): ROM table 0x1F0BA, one moBlockEmit + inner loop (up to 3).
 */
function dispatchType15(
  state: GameState, rom: RomImage,
  a1Ptr: number, subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const d2 = romL(rom, (0x1f0ba + (s8(subIdxB) << 2)) >>> 0);
  const [d5, d4] = loadCoords(state, rom, d2, 0x20, 0x18, 0x10);
  if (s16(d4) < 0xf0 || s16(d4) >= 0x100) return;
  moEmit(state, rom, rl(state, rom, rl(state, rom, d2 + 0x1c)), d5, d4, 0x3800, subs);
  // Inner loop at d2+0x26 (up to 3 entries, 6 bytes each):
  innerSprites(state, rom, (d2 + 0x26) >>> 0, 3);
}

/**
 * Type 0x29 (0x27e7c): workRam table @ 0x401650 + subIdx*16.
 */
function dispatchType0x29(
  state: GameState, rom: RomImage,
  a1Ptr: number, subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const base = (0x401650 + (s8(subIdxB) << 4)) >>> 0; // *16 = asl.l #4
  const [d5, d4] = loadCoords(state, rom, base, 0xc, 0x18, 0x10);
  if (s16(d4) < 0xc0 || s16(d4) >= 0x100) return;
  moEmit(state, rom, rl(state, rom, rl(state, rom, base + 0x8)), d5, d4, 0x2000, subs);
}

/**
 * Type 0x2A (0x27114): workRam table @ 0x40098C + subIdx*12. Player marble.
 */
function dispatchType0x2A(
  state: GameState, rom: RomImage,
  a1Ptr: number, orMask: number,
  subs: LateGameLogic26F3ESubs,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  // stride = s8(subIdxB) * 12: asl.l #2 → *4, add.l d1,d1 → *8, add.l a0,d1 → *12
  const stride = (s8(subIdxB) * 12) | 0;
  const base = (0x40098c + stride) >>> 0;
  // Coords at base+6 (not +0x4e):
  const [d5, d4] = loadCoords(state, rom, base, 6, 0x18, 0x10);
  if (s16(d4) < 0xc0 || s16(d4) >= 0x100) return;

  // d2 = s8(subIdxB) << 11 (sprite rotation bits):
  const d2 = ((s8(subIdxB) & 0xff) << 11) & 0xffff;

  // Check base[0xa] for variant:
  const b0a = rb(state, rom, base + 0xa);
  let code1: number;
  let d5adj: number;
  let d4adj: number;
  if (b0a !== 0) {
    code1 = (0x102 | (s16(d2) >>> 0)) >>> 0;
    d5adj = (d5 - 1) & 0xffff;
    d4adj = (d4 - 5) & 0xffff;
  } else {
    code1 = (0x100 | (s16(d2) >>> 0)) >>> 0;
    d5adj = (d5 - 0xc) & 0xffff;
    d4adj = (d4 - 5) & 0xffff;
  }

  // First direct emit (A1←orMask, A2←x<<5, A3←y<<5, A4←D7):
  {
    const xv = (s16(d5adj) * 32) & 0x3fe0;
    const yv = (s16(d4adj) * 32) & 0x3fe0;
    const d7v = rw(state, rom, CNT_ADDR);
    curEmit(state, rom, CUR_A1_ADDR, orMask & 0xffff);
    curEmit(state, rom, CUR_A2_ADDR, xv);
    curEmit(state, rom, CUR_A3_ADDR, yv);
    curEmit(state, rom, CUR_A4_ADDR, d7v);
    ww(state, CNT_ADDR, (d7v + 1) & 0xffff);
  }

  // Second direct emit (code1+1, x shifted +8):
  {
    const code2 = (code1 + 1) & 0xffff;
    const xv2 = (s16(d5adj + 8) * 32) & 0x3fe0;
    const yv2 = (s16(d4adj) * 32) & 0x3fe0;
    const d7v2 = rw(state, rom, CNT_ADDR);
    curEmit(state, rom, CUR_A1_ADDR, code2);
    curEmit(state, rom, CUR_A2_ADDR, xv2);
    curEmit(state, rom, CUR_A3_ADDR, yv2);
    curEmit(state, rom, CUR_A4_ADDR, d7v2);
    ww(state, CNT_ADDR, (d7v2 + 1) & 0xffff);
  }

  void subs;
}

/**
 * Type 0x2C (0x27906): workRam @ 0x400A9C + subIdx*10. Two direct sprite entries.
 */
function dispatchType0x2C(
  state: GameState, rom: RomImage,
  a1Ptr: number, orMask: number,
): void {
  const subIdxB = rb(state, rom, a1Ptr + 1);
  const offset = (s8(subIdxB) * 10) | 0; // mulu.w #$a,d0
  const base = (0x400a9c + offset) >>> 0;
  // d5 = word(base) >> 4 (asr.w #4); d4 = word(base+2) >> 4 + 0x10
  const d5 = (s16(rw(state, rom, base)) >> 4) & 0xffff;
  const d4 = ((s16(rw(state, rom, base + 2)) >> 4) + 0x10) & 0xffff;
  // -$a(a6) = word(base+8); -$e(a6) = s16(-$a) | 0x10001
  const localA = rw(state, rom, base + 8);
  const localE1 = (s16(localA) | 0x10001) >>> 0;
  const localE2 = (s16(localA) | 0x10003) >>> 0;

  // Entry 1: code=low16(localE1), xv=(d5-8)<<5&0x3fe0,
  // yv=d4<<5&0x3fe0|high16(localE1)
  {
    const xv = ((s16(d5) - 8) * 32) & 0x3fe0;
    const yv = (s16(d4) * 32) & 0x3fe0 | ((localE1 >>> 16) & 0xffff);
    emitSprite(state, rom, localE1 & 0xffff, xv, yv);
  }
  // Entry 2: code=low16(localE2), xv=d5<<5&0x3fe0,
  // yv=d4<<5&0x3fe0|high16(localE2)
  {
    const xv2 = (s16(d5) * 32) & 0x3fe0;
    const yv2 = (s16(d4) * 32) & 0x3fe0 | ((localE2 >>> 16) & 0xffff);
    emitSprite(state, rom, localE2 & 0xffff, xv2, yv2);
  }

  void orMask;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Replica `FUN_00026F3E` — main entity sprite dispatch loop.
 *
 * @param state   GameState (workRam/spriteRam mutated).
 * @param rom     RomImage (entity lookup tables read from ROM).
 * @param subs    Sub-injection callbacks (default: real implementations).
 */
export function lateGameLogic26F3E(
  state: GameState,
  rom: RomImage,
  subs: LateGameLogic26F3ESubs = {},
): void {
  // ── Phase 1: bufferFill1B12A per entity ────────────────────────────────────
  let walkPtr = ENTITY_BASE;
  while (true) {
    if (rb(state, rom, walkPtr) === SENTINEL) break;
    if ((walkPtr >>> 0) >= (ENTITY_END - 1)) break;
    const curPtr = walkPtr;
    walkPtr = (walkPtr + 1) >>> 0;
    const entByte = rb(state, rom, curPtr);
    const d1 = (s8(entByte) << 2) | 0;
    const rectBufPtr = romL(rom, (ROM_LOOKUP + d1) >>> 0);
    // Read 14-byte rect buffer, call bufferFill, write back
    const rectBuf = new Uint8Array(14);
    for (let i = 0; i < 14; i++) rectBuf[i] = rb(state, rom, rectBufPtr + i);
    if (subs.fun_1b12a) subs.fun_1b12a(state, rom, rectBuf);
    else bufferFill1B12A(state, rom, rectBuf);
    for (let i = 0; i < 14; i++) wb(state, rectBufPtr + i, rectBuf[i] ?? 0);
  }

  // ── Phase 2: sortAdjacentObjects (if 0x4003E2 == 0) ───────────────────────
  if (rb(state, rom, 0x004003e2) === 0) {
    if (subs.fun_1a7a8) {
      subs.fun_1a7a8(state, rom, 1);
      subs.fun_1a7a8(state, rom, 2);
      subs.fun_1a7a8(state, rom, 3);
    } else {
      sortAdjacentObjects1A7A8(state, rom, 1);
      sortAdjacentObjects1A7A8(state, rom, 2);
      sortAdjacentObjects1A7A8(state, rom, 3);
    }
  }

  // ── Phase 3: Sprite cursor setup ──────────────────────────────────────────
  // d1 = word[0x4003AE] XOR 8; store to [0x4003B0]
  const raw3ae = rw(state, rom, 0x004003ae);
  const d1xor = (raw3ae ^ 8) & 0xffff;
  ww(state, 0x004003b0, d1xor);
  // d3 = (d1xor & 8) << 5; d3*2 as signed offset
  const d3     = ((d1xor & 8) << 5) & 0xffff;
  const d3t2   = (s16(d3) * 2) | 0;
  // The orMask for sprite code fields = d3
  const orMask = d3;

  // Init cursor A4 region (0xA02180 + d3*2): write sequential words 0,1,2,...,0x37.
  // Binary loop: clr.b d2; move.b d2,d1; ext.w d1; move.w d1,(a0)+; addq.b #1,d2; bne
  const cA4start = (0xa02180 + d3t2) >>> 0;
  for (let i = 0; i < 0x38; i++) ww(state, cA4start + i * 2, i);

  // Write cursor pointers to workRam:
  wl(state, CUR_A2_ADDR, (0xa02100 + d3t2) >>> 0);
  wl(state, CUR_A3_ADDR, (0xa02000 + d3t2) >>> 0);
  wl(state, CUR_A1_ADDR, (0xa02080 + d3t2) >>> 0);
  wl(state, CUR_A4_ADDR, (cA4start - 2) >>> 0);
  ww(state, CNT_ADDR, 0);

  // ── Phase 4: Entity sprite dispatch loop ──────────────────────────────────
  walkPtr = ENTITY_BASE;
  while (true) {
    if (rb(state, rom, walkPtr) === SENTINEL) break;
    if ((walkPtr >>> 0) >= (ENTITY_END - 1)) break;
    if (rw(state, rom, CNT_ADDR) >= 0x3c) break;

    const entByte2 = rb(state, rom, walkPtr);
    const d1e = (s8(entByte2) << 2) | 0;
    const a1Ptr = romL(rom, (ROM_LOOKUP + d1e) >>> 0);
    const rawType = rb(state, rom, a1Ptr);
    const entityType = s8(rawType);

    // Dispatch by entity type:
    if (entityType === 0x2a) {
      dispatchType0x2A(state, rom, a1Ptr, orMask, subs);
    } else if (entityType > 0x2a) {
      if (entityType === 0x2c) dispatchType0x2C(state, rom, a1Ptr, orMask);
      // other > 0x2c or == 0x2b: skip
    } else if (entityType < 0x01) {
      // skip
    } else if (entityType > 0x0f) {
      if (entityType === 0x29) dispatchType0x29(state, rom, a1Ptr, subs);
      // 0x10..0x28 (except 0x29, 0x2a): skip
    } else {
      switch (entityType) {
        case  1: dispatchType1(state, rom, a1Ptr, orMask, subs); break;
        case  2: dispatchType2(state, rom, a1Ptr, orMask, subs); break;
        case  3: dispatchType3(state, rom, a1Ptr, subs); break;
        case  4: dispatchType4(state, rom, a1Ptr, subs); break;
        case  5: dispatchType5(state, rom, a1Ptr, subs); break;
        case  6: dispatchType6(state, rom, a1Ptr, subs); break;
        case  7: dispatchType7_9(state, rom, a1Ptr, 7, subs); break;
        case  8: dispatchType7_9(state, rom, a1Ptr, 8, subs); break;
        case  9: dispatchType7_9(state, rom, a1Ptr, 9, subs); break;
        case 10: dispatchType10(state, rom, a1Ptr, subs); break;
        case 11: dispatchType11_13(state, rom, a1Ptr, subs); break;
        case 12: dispatchType12(state, rom, a1Ptr, subs); break;
        case 13: dispatchType11_13(state, rom, a1Ptr, subs); break;
        case 14: dispatchType14(state, rom, a1Ptr, subs); break;
        case 15: dispatchType15(state, rom, a1Ptr, subs); break;
        default: break;
      }
    }

    // Advance entity pointer:
    walkPtr = (walkPtr + 1) >>> 0;
  }

  // ── Exit: if counter == 0, write 0 at current A3 cursor position ──────────
  if (rw(state, rom, CNT_ADDR) === 0) {
    ww(state, rl(state, rom, CUR_A3_ADDR), 0);
  }

  // ── Post-body flag set (replica disasm 0x118C0 main-loop wrapper) ─────────
  // Dopo `jsr 0x26F3E` (lateGameLogic), il main thread esegue
  //   move.b #1, *0x40039A
  // (`SCROLL_DIRTY_FLAG` in main-loop.ts). Il prossimo IRQ4 vblank handler
  // (= mainTick → mainUpdateScrollSync) legge il flag, latcha
  //   *0x4003AE = *0x4003B0  (AV-control word, sprite-bank toggler)
  // e clear flag. Senza questo set TS-side, `0x4003AE` resta stale al valore
  // warm (0x0080) per sempre, e Phase 3 di lateGameLogic computa sempre lo
  // stesso `d3t2` ⇒ scriviamo nello stesso bank ogni frame anziché toggle
  // bit-perfect tra bank 0 e bank 1 in lockstep con MAME.
  //
  // Disasm relevante (main-thread loop body 0x118A8..0x118CE):
  //   0x118A8 jsr  0x26F3E      ; lateGameLogic
  //   0x118AE tst.b *0x400016
  //   ...
  //   0x118C0 move.b #1, *0x40039A  ← QUESTO
  //   0x118C6 jsr  0x28DEA      ; spin-wait next IRQ4
  //
  // Lo metto qui (fine di lateGameLogic) anziché in main-tick.ts perché il
  // wrapper main-loop-body è tightly coupled a questa funzione ed è bit-perfect
  // equivalente: l'effetto osservabile è identico (flag visto dal prossimo
  // mainTick run).
  state.workRam[0x39a] = 1;
}
