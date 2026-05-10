/**
 * sub-29cce.ts — replica MINIMAL CHUNK di `FUN_00029CCE`
 *               (collision pipeline, 5364 byte, range 0x29CCE..0x2B22F).
 *
 * **Caller**: `helper121B8` ELSE-branch — invocata 1× per slot durante la
 * pipeline INTEGRATE_VEL → spritePosUpdate → fun_29cce.
 *
 * **Scope**: replica solo i 3 chunk a basso rischio + side-effect garantito
 * di prologo. Le branch BLOCK A/B/C/D/E (collision response, boundary clamp,
 * respawn, bounce vettoriale ~750 istr fixed-point) sono SALTATE come no-op.
 *
 * **Chunk replicati**:
 *  1. PROLOGUE side-effect (0x29cce..0x29d40):
 *     - `D3 = (0x58, A2); clr.b (0x58, A2)`
 *     - read `(0x18, A3=0x400a9c)`; if 0 → skip 25-iter loop body, vai
 *       direttamente a EPILOGUE post-loop @ 0x2b0f6.
 *  2. PROLOGUE early-out arm (0x29e5e..0x29ea4): branch arm `state==0xa`
 *     other-slot → chiama FUN_2648C(A2) (copyGlobalsToObj) + scrive
 *     `(0x4,A2)=0; (A2)=0` (vy=0, vx=0).
 *     SKIPPATO: richiede contesto BLOCK arm "color 5..0xb" + jump table
 *     decode che non replichiamo.
 *  3. EPILOGUE post-loop (0x2b108..0x2b22e):
 *     - rilegge `D0=(0x58,A2)`; dispatch arms su {0x10,0x17,0x18,0x32-0x37}
 *     - chiama FUN_158AC con arg 0x43 o 0x44 in base al match arm
 *     - tst.b *(0x666); bne → ripristina x da *(0x400684) + neg.l vx
 *     - tst.b *(0x668); bne → ripristina y da *(0x400688) + neg.l vy
 *
 * **NOTE BIT-PERFECT**:
 *   - i flag globals 0x666/0x668 vengono settati dal LOOP BODY (BLOCK
 *     A/B/C/D/E). Visto che il loop è skippato qui, i flag sono lasciati al
 *     valore corrente prima della chiamata: se 0 → nessun neg.l, se non-0
 *     → eseguito (potrebbe accadere se altri caller hanno settato il flag).
 *   - Il `clr.b (0x58,A2)` di prologue è side-effect garantito, ma il
 *     dispatch dell'epilogue è basato sul VECCHIO valore (D3) salvato.
 *
 * **Sub callees**:
 *  - FUN_2648C = `copyGlobalsToObj` (object-helpers.ts) — used in arm 0xa
 *    (currently NOT triggered: arm code skipped).
 *  - FUN_158AC = `soundCmdSend158AC` (sound-cmd-send-158ac.ts).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { soundCmdSend158AC } from "./sound-cmd-send-158ac.js";

const WORK_RAM_BASE = 0x00400000;

// Slot field offsets toccati dal chunk replicato.
const F_VX  = 0x00;
const F_VY  = 0x04;
const F_X   = 0x0c;
const F_Y   = 0x10;
const F_S58 = 0x58;

// Globals
const G_X_RESTORE = 0x0684;  // *(0x400684) → ripristina (0xc,A2)
const G_Y_RESTORE = 0x0688;  // *(0x400688) → ripristina (0x10,A2)
const G_FLAG_X    = 0x0666;  // *(0x400666) → trigger neg.l vx
const G_FLAG_Y    = 0x0668;  // *(0x400668) → trigger neg.l vy

// A3 (other-slot) per check `(0x18,A3)`.
const OTHER_SLOT_A3 = 0x400a9c;
const OTHER_SLOT_A3_OFF = (OTHER_SLOT_A3 - WORK_RAM_BASE) >>> 0;
const F_S18 = 0x18;

// ─── Helpers byte/long M68k big-endian ─────────────────────────────────────

function rB(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}
function wB(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
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

// neg.l (signed two's complement negation, 32-bit).
function negL(v: number): number {
  return ((-(v | 0)) | 0) >>> 0;
}

// ─── Sub-injection interface ───────────────────────────────────────────────

export interface Sub29CCESubs {
  /** FUN_158AC — sound mailbox send. Default: import TS bit-perfect. */
  soundCmdSend158AC?: (state: GameState, byteArg: number) => number;
}

// ─── Funzione principale ───────────────────────────────────────────────────

/** ROM address di `FUN_00029CCE`. */
export const SUB_29CCE_ADDR = 0x00029cce as const;

/**
 * Replica MINIMAL CHUNK di `FUN_00029CCE`.
 *
 * @param state    GameState corrente. `workRam` mutato in-place.
 * @param slotPtr  Indirizzo assoluto M68k del slot A2 (es. 0x4009A4).
 * @param _rom     ROM image (per ora inutilizzato dal chunk replicato).
 * @param subs     Stub injection (opzionale).
 */
export function fun29CCE(
  state: GameState,
  slotPtr: number,
  _rom: RomImage,
  subs: Sub29CCESubs = {},
): void {
  const a2 = slotPtr >>> 0;
  const a2Off = (a2 - WORK_RAM_BASE) >>> 0;

  // ── PROLOGUE side-effect (0x29d32..0x29d36) ───────────────────────────
  // move.b (0x58,A2),D3b   ; D3 = vecchio +0x58 (initial collision tag)
  // clr.b  (0x58,A2)       ; reset collision tag
  const d3 = rB(state, a2Off + F_S58);
  wB(state, a2Off + F_S58, 0);

  // ── PROLOGUE A3 setup (0x29d3a..0x29d48) ──────────────────────────────
  // movea.l #0x400a9c,A3
  // tst.b   (0x18,A3); beq.w → 0x2b0f6 (post-loop epilogue)
  //
  // Se A3.0x18 == 0 saltiamo direttamente al post-loop epilogue (replicato
  // a fondo file). Se !=0, normalmente entreremmo nel 25-iter slot loop:
  // qui SKIPPATO (no-op) come da scope minimo. In entrambi i casi cadiamo
  // in EPILOGUE che è il chunk effettivamente replicato.
  // (la flag locale `(-0x1,A6)` per loop counter resta 0 = caso loop saltato)

  // ── EPILOGUE post-loop dispatch (0x2b108..0x2b22e) ────────────────────
  // move.b (0x58,A2),D0b
  // NB: il loop body avrebbe potuto modificare *(0x58,A2). Qui loop skipped
  // → *(0x58,A2) == 0 (clr in prologo). Per replicare bit-perfect il path
  // "loop body skipped" usiamo D0 = current = 0.
  const d0 = rB(state, a2Off + F_S58);

  // 0x2b10c..0x2b150: cmpi.b D0 in {0x10,0x17,0x18,0x32..0x37};
  // beq → 0x2b154 (path A: 0x43/0x44 dispatch arm 1)
  // bne → 0x2b1a8 (path B: 0x44 dispatch arm 2)
  const isMatch = (b: number): boolean =>
    b === 0x10 || b === 0x17 || b === 0x18 ||
    b === 0x32 || b === 0x33 || b === 0x34 ||
    b === 0x35 || b === 0x36 || b === 0x37;

  if (isMatch(d0)) {
    // 0x2b154..0x2b1a6: secondo dispatch su D3.b
    // cmpi.b D3 in {0x10,0x17,0x18,0x32..0x37}; beq → 0x2b1f8 (skip sound)
    // else → pea 0x43; jsr (A4)=0x158ac; bra 0x2b1f8
    if (!isMatch(d3)) {
      (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, 0x43);
    }
    // → 0x2b1f8 (final flag check)
  } else {
    // 0x2b1a8..0x2b1ec: cmpi.b D3 in {0x10,0x17,0x18,0x32..0x37};
    // beq → 0x2b1ee (sound 0x44); bne → 0x2b1f8 (skip sound)
    if (isMatch(d3)) {
      (subs.soundCmdSend158AC ?? soundCmdSend158AC)(state, 0x44);
    }
    // → 0x2b1f8 (final flag check)
  }

  // ── 0x2b1f8..0x2b22e: final flag check + neg.l vx/vy ──────────────────
  // tst.b *(0x400666); beq → 0x2b20e (skip)
  // else: move.l *(0x400684), (0xc,A2); move.l (A2),D0; neg.l D0; move.l D0,(A2)
  if (rB(state, G_FLAG_X) !== 0) {
    const xRestore = rL(state, G_X_RESTORE);
    wL(state, a2Off + F_X, xRestore);
    const vx = rL(state, a2Off + F_VX);
    wL(state, a2Off + F_VX, negL(vx));
  }

  // tst.b *(0x400668); beq → 0x2b228 (rts)
  // else: move.l *(0x400688), (0x10,A2); move.l (0x4,A2),D0; neg.l D0; move.l D0,(0x4,A2)
  if (rB(state, G_FLAG_Y) !== 0) {
    const yRestore = rL(state, G_Y_RESTORE);
    wL(state, a2Off + F_Y, yRestore);
    const vy = rL(state, a2Off + F_VY);
    wL(state, a2Off + F_VY, negL(vy));
  }
  // (movem + unlk + rts: epilog stack — no-op TS)
}
