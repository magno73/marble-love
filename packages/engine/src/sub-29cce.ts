/**
 * sub-29cce.ts — replica di `FUN_00029CCE` (collision pipeline,
 *                5364 byte / 1679 istruzioni, range 0x29CCE..0x2B22F).
 *
 * **Caller**: `helper121B8` ELSE-branch — invocata 1× per slot durante la
 * pipeline INTEGRATE_VEL → spritePosUpdate → fun_29cce.
 *
 * **Architettura**:
 *  - PROLOGO (0x29cce..0x29d48): salva globals 0x690/0x692/0x694/0x696/
 *    0x698/0x69a/0x69c, posizioni `(A2)` e `(0x4,A2)`, globali 0x68c.
 *    Cattura D3=`(0x58,A2)`, azzera `(0x58,A2)`. A3=0x400a9c (slot table).
 *  - LOOP outer su 25 slot a stride 0x56, iter `(-0x1,A6)` da 0..0x18:
 *      tst.b (0x18,A3); beq → iter advance.
 *      D6 = (0xc,A3)w - g690, A0 = (0x10,A3)w - g692
 *      D1 = (0xc,A3)w >> 3 - g696, D2 = (0x10,A3)w >> 3 - g698
 *      Color tag = (0x1f,A3); range-check 5..0x3b; jump table @ 0x29db4.
 *  - 56 BLOCKs per color tag (boundary check, kick, respawn, bounce):
 *      la maggioranza scrive solo `(0x58,A2)=color, (0x59,A2)=-1` e ritorna.
 *      Altri (0x05 0x0a 0x0b 0x0c 0x0d 0x13..0x16 0x1a..0x1f 0x20..0x22
 *      0x23..0x27) eseguono logica complessa (bounce, respawn, sound).
 *  - Ogni branch termina con `bra.w 0x2b072` (iter advance).
 *  - 0x2b072..0x2b108: epilog di iterazione. Controlla se `(0x58,A2)` matcha
 *    una WHITE-LIST di valori: se sì → ADV (avanza alla prossima iter).
 *    Altrimenti → break out del loop.
 *  - 0x2b108..0x2b22e: EPILOGO finale. Dispatch su D0/D3 in base alla
 *    WHITE-LIST → soundCmdSend(0x43 o 0x44). Poi check globali
 *    0x666/0x668: se != 0 → restore x/y + neg.l vx/vy.
 *
 * **Scope replica**: PROLOGO + LOOP outer + tutte le 25 iter + jump table
 * con dispatch completo. **BLOCK A simple** (range-check + tag-write) è
 * implementato fully. **BLOCK 0x0a catapult** è implementato con launch,
 * sound-pair e script kick. I **BLOCK 0x12..0x16 e 0x20..0x27** coprono i
 * tubi Beginner con teleport e shape collision `helper1CD00`. I **BLOCK
 * 0x1a..0x1f** implementano le collisioni dinamiche dei tubi/pareti con flag
 * X/Y e sound 0x42. Gli altri **BLOCK complessi con sub-calls** (sound,
 * helper25C74, divs.w bounce) restano fallthrough no-op (= bra 0x2b072).
 * Questo replica fedelmente l'AVANZAMENTO del loop e i tag-writes di confine,
 * riducendo drift dovuto a tag mancanti.
 *
 * **MAME f12000+ analysis (demo gameplay attive)** — `/tmp/mame_100f.json`:
 * Per obj0 (player1 @ 0x400018), durante 100 frame di demo gameplay,
 * i campi di stato osservati sono **invarianti**: s58=0 (collision tag),
 * s36=0 (bounce mode), s1a=0 (player normal state), s57=0 (sound code).
 * obj0.vx oscilla in un range stretto (0x23339..0x235FE, ±0x1FF) attorno
 * al valore di partenza 0x23447 con cambi piccoli (~0x100/2-frame) dovuti
 * a `helper182BA` (seek dispatcher). vx NON è azzerato in MAME perché:
 *   1. `FUN_29CCE`: il loop su 25 slot @ 0x400a9c salta gli slot non-attivi
 *      via 0x2b0f6 e continua. Per obj0, nessun BLOCK complesso (bounce,
 *      respawn, sound 0x43/0x44) triggera — flussi `neg.l vx/vy` dell'
 *      epilog (gated da `*0x400666`/`*0x400668`) NON eseguiti perché i
 *      flag globali restano 0 frame after frame.
 *   2. Il path OUT_OF_RANGE in `helper121B8` (gate
 *      `spriteProject1CC62(0) - obj.z > 0x100000`) NON triggera per obj0,
 *      quindi `objectStateEntry25BAE(obj0, 4)` NON viene chiamato.
 *      L'azzeramento di obj+0x00/obj+0x04 (vx/vy) nel prologue comune di
 *      25BAE non avviene mai per obj0 in MAME canonical.
 *
 * Quindi il NETTO MAME-osservato per `fun_29cce(obj0)` a f12000+ è:
 * **nessuna modifica osservabile** su (workRam[0x18..0x5F]) per il loop
 * outer (no tag match), e **nessun neg.l vx/vy** nell'epilog (flag X/Y
 * globali zero). I globali workRam[0x690..0x69C] vengono solo SNAPSHOT
 * letti, non scritti.
 *
 * **NOTE BIT-PERFECT**:
 *   - Slot stride 0x56 (= 86 byte/slot). Il loop avanza A3 += 0x56 dopo ogni
 *     iter. (-0x1,A6) byte è il counter, range 0..0x18.
 *   - signed/unsigned: tutte le coords sono lette come word16 → ext.l.
 *     `(0xc,A3)w` significa lower word del long32 X; M68k è big-endian quindi
 *     `(0xc,A3)w = (workRam[ofs+0]<<8) | workRam[ofs+1]` (= upper word del
 *     fixed-point 16.16). NB il long32 è offset 0xc..0xf, ma `(0xc,A3)w`
 *     legge i 2 byte a 0xc..0xd = upper word.
 *   - `cmpa.w #imm,A0` = sext-w-to-32 prima di confronto.
 *   - jmp via PC+offset+D0w*1: D0w = jt[index*2], jmp 0x29db4 + D0w (sign-ext).
 *
 * **Sub callees usati**:
 *  - FUN_158AC = `soundCmdSend158AC` (ad arg byte)
 *  - FUN_2648C = `copyGlobalsToObj` (per BLOCK 0x0a catapult two-player wait)
 *  - FUN_15884 = `soundPair15884` (per BLOCK 0x0a catapult launch)
 *  - FUN_12896 = `helper12896` (per script arm catapulta)
 *  - FUN_1CD00 = `helper1CD00` (shape collision dei tubi Beginner).
 *  - altri (helper25C74, etc.) — solo nei BLOCK COMPLESSI che restano
 *    fallthrough no-op in questa implementazione.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { helper12896 } from "./helper-12896.js";
import { helper1CD00 } from "./helper-1cd00.js";
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

// sign-extend word (16-bit two's complement) to a JS-signed integer.
function sextW(w: number): number {
  const u = w & 0xffff;
  return u >= 0x8000 ? u - 0x10000 : u;
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

// ─── Funzione principale ────────────────────────────────────────────────

/** ROM address di `FUN_00029CCE`. */
export const SUB_29CCE_ADDR = 0x00029cce as const;

/**
 * Replica di `FUN_00029CCE`.
 *
 * @param state    GameState corrente. `workRam` mutato in-place.
 * @param slotPtr  Indirizzo assoluto M68k del slot A2 (es. 0x4009A4).
 * @param rom      ROM image (usata dai complex cases implementati).
 * @param subs     Stub injection (opzionale).
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
  // move.b (0x58,A2),D3b   ; D3 = vecchio +0x58 (initial collision tag)
  // clr.b  (0x58,A2)       ; reset collision tag
  const d3 = rB(state, a2Off + F_S58);
  wB(state, a2Off + F_S58, 0);

  // ── PROLOGUE: snapshot globals (0x29cec..0x29d2a) ─────────────────────
  // Letti come word, salvati in stack frame locale (-0x1e..-0x24,-0x16,-0x1c).
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
 * Le branch **BLOCK A simple** (range-check D1/D2 + tag-write) sono
 * implementate fully:
 *   0x10, 0x12, 0x32-0x37, 0x2d-0x31, 0x38-0x3b.
 *
 * Complex cases implemented:
 *   0x0a — catapult arm launch + script kick.
 *   0x1a..0x1f — dynamic pipe/wall collisions, set X/Y flags + sound 0x42.
 *   0x20..0x27 — Beginner tube ramps/teleports and helper1CD00 wall checks.
 *
 * Le branch SKIP (no-op fallthrough = bra epilog_iter):
 *   0x05 (kick + sound), 0x0b/0x0c/0x0d (BLOCK C bounce),
 *   0x13/0x14/0x15/0x16 (helper1CD00), 0x17/0x18 (range checks D6/A0 invece
 *   di D1/D2 — più complessi).
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
  // Range checks per ogni color tag, derivati dai disasm 0x29f40..0x2b06c.
  // Pattern standard:
  //   tst.w D1w; blt.w 0x2b072         → skip if D1 < 0
  //   moveq #hi,D0; cmp.w D1,D0; ble    → skip if D1 >= hi
  //   tst.w D2w; blt.w 0x2b072         → skip if D2 < 0
  //   moveq #hi,D0; cmp.w D2,D0; ble    → skip if D2 >= hi
  //   write tag, -1; bra 0x2b072

  switch (colorTag) {
    // 0x29e22: catapult arm. Tight D6/A0 hitbox; on success it snaps and
    // launches the marble, tags +0x58=0x0a, and starts script 0x1DB80.
    case 0x0a:
      runCatapult0A(state, rom, a2Off, a3Off, d6, a0, subs);
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
