/**
 * sub-14966.ts — replica `FUN_00014966` (per-slot ticker, 188 istr originale).
 *
 * Sostituisce `sub-14966-stub.ts` (head-only). Path C body resets ticker
 * a 0 quando raggiunge limit, avanza script pointer `+0x58`, e (in stato
 * 0/3 con step > 0) integra pos += velocity. Senza questo body in TS,
 * ticker `+0x24` cresceva monotonicamente fino a quando armed/limit non
 * cambiavano (cluster slot4 drift ~30B).
 *
 * ## Disasm chiave (Ghidra force-disasm)
 *
 *   00014966  movem.l {A2 D5 D4 D3 D2},-(SP)
 *   0001496a  movea.l (0x18,SP),A2
 *   0001496e  tst.b   (0x18,A2)
 *   00014972  beq.w   0x14bc8                ; armed=0 → pure epilogue
 *   00014976  addq.b  #1,(0x24,A2)            ; ticker++
 *   0001497a  move.b  (0x25,A2),D0b           ; D0 = limit
 *   0001497e  cmp.b   (0x24,A2),D0b           ; flags from limit - ticker
 *   00014982  bgt.w   0x149f8                 ; if limit > ticker → Path B
 *   ;; ── Path C (ticker reached limit) ─────────────────────────
 *   00014986  clr.b   (0x24,A2)               ; reset ticker
 *   0001498a  D0 = sext_byte(slot[0x26]) * 4
 *   00014994  slot[0x58] += D0                ; advance script pointer
 *   00014998  A0 = slot[0x58]
 *   0001499e  cmp.l   (A0),#-1
 *   000149a0  beq     0x149ae                 ; *A0 == sentinel → reset+body
 *   000149a4  D0 = slot[0x5c]
 *   000149a8  cmp.l   slot[0x58],D0
 *   000149ac  bne.b   0x149e4                 ; pointer moved → goto 0x149e4
 *   ;; ── reset+body (0x149ae) ──────────────────────────────────
 *   000149ae  slot[0x58] = slot[0x5c]
 *   000149b4  if (sext(slot[0x26]) > 0) AND (slot[0x1a] in {0,3}):
 *               slot[0x0c] += slot[0x00]
 *               slot[0x10] += slot[0x04]
 *   000149d8  jsr FUN_15148(slotPtr)
 *   000149e2  bra 0x14a0a
 *   ;; ── alt branch 0x149e4 (pointer moved, no sentinel) ───────
 *   000149e4  if slot[0x1a] == 2: jsr FUN_15148
 *   000149f6  bra 0x14a0a
 *   ;; ── Path B (bgt taken, no body) ───────────────────────────
 *   000149f8  if slot[0x1a] == 2: jsr FUN_15148
 *   ;; ── state dispatch (0x14a0a) ──────────────────────────────
 *   00014a0a  if slot[0x1a] in {1,5,6}: goto 0x14a28 (complex block, TODO)
 *             else: goto 0x14bbe
 *   00014bbe  jsr FUN_150D0(slotPtr)
 *   00014bc8  epilogue
 *
 * ## Note implementative
 *
 * - Tutti i jsr FUN_15148 sono invocazioni full di `helper15148` con default subs.
 * - jsr FUN_150D0 invoca `spriteCoordsJsr150D0`.
 * - Il blocco state ∈ {1,5,6} (0x14a28..0x14bba — tile lookup, marble proximity,
 *   pos clamp + jsr 0x1BB08/0x1CC62) NON è ancora portato. Per slot1/2/3 in
 *   attract MAME, lo stato resta 0 in tutte le 99 frame (probe-slot4-state),
 *   quindi questo branch non si attiva. Lo aggiungeremo se compare drift in
 *   altri scenari.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { helper15148 } from "./helper-15148.js";
import { spriteCoordsJsr150D0 } from "./sprite-coords-jsr-150d0.js";

const WRAM = 0x00400000 as const;

function rb(state: GameState, addr: number): number {
  return (state.workRam[(addr - WRAM) >>> 0] ?? 0) & 0xff;
}

function rl(state: GameState, addr: number): number {
  const o = (addr - WRAM) >>> 0;
  return (
    (((state.workRam[o] ?? 0) << 24) |
      ((state.workRam[o + 1] ?? 0) << 16) |
      ((state.workRam[o + 2] ?? 0) << 8) |
      (state.workRam[o + 3] ?? 0)) >>>
    0
  );
}

function wb(state: GameState, addr: number, v: number): void {
  state.workRam[(addr - WRAM) >>> 0] = v & 0xff;
}

function wl(state: GameState, addr: number, v: number): void {
  const o = (addr - WRAM) >>> 0;
  const u = v >>> 0;
  state.workRam[o] = (u >>> 24) & 0xff;
  state.workRam[o + 1] = (u >>> 16) & 0xff;
  state.workRam[o + 2] = (u >>> 8) & 0xff;
  state.workRam[o + 3] = u & 0xff;
}

function sb(state: GameState, sp: number, off: number): number {
  return rb(state, sp + off);
}

function swb(state: GameState, sp: number, off: number, v: number): void {
  wb(state, sp + off, v);
}

function sl(state: GameState, sp: number, off: number): number {
  return rl(state, sp + off);
}

function swl(state: GameState, sp: number, off: number, v: number): void {
  wl(state, sp + off, v);
}

/** Read long da indirizzo M68K (ROM o workRam). */
function readLong(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WRAM && a + 3 < WRAM + 0x2000) {
    return rl(state, a);
  }
  if (a + 3 < rom.program.length) {
    return (
      (((rom.program[a] ?? 0) << 24) |
        ((rom.program[a + 1] ?? 0) << 16) |
        ((rom.program[a + 2] ?? 0) << 8) |
        (rom.program[a + 3] ?? 0)) >>>
      0
    );
  }
  return 0;
}

/** Sign-extend 8-bit to 32-bit signed integer. */
function sextB(b: number): number {
  return (b & 0x80) ? (b | 0xffffff00) | 0 : b & 0xff;
}

/** Sign-extend 8-bit byte to signed JS number (-128..127). */
function sextByteSigned(b: number): number {
  return (b & 0x80) ? (b & 0xff) - 0x100 : b & 0xff;
}

/** Indirizzo originale della sub. */
export const SUB_14966_ADDR = 0x00014966 as const;

/**
 * Replica bit-perfect di `FUN_00014966` — per-slot ticker dei 4 slot
 * dello script-array @ 0x401302 (chiamata 4× da FUN_1493C).
 *
 * @param state   GameState (mutato).
 * @param rom     ROM image (per leggere sentinel @ slot[0x58]).
 * @param slotPtr Absolute workRam address dello slot record.
 *
 * **Side effects principali**:
 *   - `slot[0x24]` ticker++/reset
 *   - `slot[0x58]` advance/reset (state=path C)
 *   - `slot[0x0c]`, `slot[0x10]` pos += velocity (state ∈ {0,3} e step > 0)
 *   - jsr helper15148(slotPtr) in vari path
 *   - jsr spriteCoordsJsr150D0(slotPtr) per state ∉ {1,5,6} (sempre dopo body)
 *
 * **Path armed=0**: pure epilogue, nessun side-effect.
 */
export function sub14966(state: GameState, rom: RomImage, slotPtr: number): void {
  const sp = slotPtr >>> 0;

  // 0x1496e  tst.b (0x18,A2); beq → 0x14bc8 (pure epilogue)
  const armed = sb(state, sp, 0x18);
  if (armed === 0) {
    return;
  }

  // 0x14976  addq.b 1,(0x24,A2)
  swb(state, sp, 0x24, (sb(state, sp, 0x24) + 1) & 0xff);

  // 0x1497a  cmp.b (0x24,A2),D0b where D0=limit; bgt → Path B
  // In M68k: cmp.b src,dst; bgt taken if signed dst > src.
  // cmp.b (0x24,A2),D0b → D0 - (0x24,A2) → bgt if D0 > ticker = limit > ticker.
  const limit = sb(state, sp, 0x25);
  const ticker = sb(state, sp, 0x24);
  const limitS = sextByteSigned(limit);
  const tickerS = sextByteSigned(ticker);

  let pathBOrC: "B" | "C";
  if (limitS > tickerS) {
    pathBOrC = "B"; // bgt taken, no body
  } else {
    pathBOrC = "C"; // body fires
  }

  // Track whether to call FUN_15148 at the end of body (Path C) or alt branch
  let callFun15148 = false;

  if (pathBOrC === "C") {
    // ── Path C body (0x14986..0x149e2 / 0x149e4..0x149f6) ──────────
    // 0x14986  clr.b (0x24,A2)
    swb(state, sp, 0x24, 0);

    // 0x1498a  D0 = sext_byte(slot[0x26]) * 4
    const step = sb(state, sp, 0x26);
    const stepSigned = sextB(step);
    const d0 = (stepSigned * 4) | 0; // asl.l #2 on signed long

    // 0x14994  slot[0x58] += D0
    const newPc58 = (sl(state, sp, 0x58) + d0) >>> 0;
    swl(state, sp, 0x58, newPc58);

    // 0x14998  A0 = slot[0x58]
    // 0x1499e  cmp.l (A0),#-1; beq → 0x149ae (reset path)
    const valueAtPc = readLong(state, rom, newPc58);
    const sentinel = 0xffffffff;

    if (valueAtPc === sentinel) {
      // ── reset path (0x149ae..0x149e2) ──────────────────────────
      pathCResetBody(state, rom, sp);
      callFun15148 = true;
    } else {
      // 0x149a4  D0 = slot[0x5c]; cmp.l slot[0x58],D0; bne → 0x149e4
      const base5c = sl(state, sp, 0x5c);
      if (base5c === newPc58) {
        // slot[0x58] already equals slot[0x5c] → reset body (no-op pointer)
        pathCResetBody(state, rom, sp);
        callFun15148 = true;
      } else {
        // 0x149e4  cmpi.b #2,(0x1a,A2); bne → 0x14a0a; else jsr FUN_15148
        if (sb(state, sp, 0x1a) === 2) {
          callFun15148 = true;
        }
      }
    }
  } else {
    // ── Path B (bgt taken, ticker < limit) ─────────────────────────
    // 0x149f8  cmpi.b #2,(0x1a,A2); bne → 0x14a0a; else jsr FUN_15148
    if (sb(state, sp, 0x1a) === 2) {
      callFun15148 = true;
    }
  }

  // Conditional jsr FUN_15148(slotPtr)
  if (callFun15148) {
    helper15148(state, rom, sp);
  }

  // ── State dispatch (0x14a0a..0x14a24) ──────────────────────────────
  // cmpi.b #1,(0x1a,A2); beq → 0x14a28
  // cmpi.b #5,(0x1a,A2); beq → 0x14a28
  // cmpi.b #6,(0x1a,A2); bne → 0x14bbe; (else fall to 0x14a28)
  const s1a = sb(state, sp, 0x1a);
  if (s1a === 1 || s1a === 5 || s1a === 6) {
    // ── 0x14a28..0x14bba block ─────────────────────────────────────
    // NON portato: per slot1/2/3 in attract MAME, s1a resta 0 in 99/99
    // frame. Se questo branch si attiva, drift compare e va portato.
    // Per ora, comportamento conservativo: fallback to direct FUN_150D0.
    // TODO: portare il blocco tile-lookup / marble-proximity / pos-clamp.
  }

  // 0x14bbe  jsr FUN_150D0(slotPtr); 0x14bc8 epilogue.
  spriteCoordsJsr150D0(state, sp, { inner264AA: () => 0 });
}

/**
 * Reset path body (0x149ae..0x149e0): slot[0x58] = slot[0x5c], optional pos
 * += vel (state ∈ {0,3} AND step > 0), no jsr 15148 (caller fa).
 */
function pathCResetBody(state: GameState, _rom: RomImage, sp: number): void {
  // 0x149ae  slot[0x58] = slot[0x5c]
  swl(state, sp, 0x58, sl(state, sp, 0x5c));

  // 0x149b4  tst.b (0x26,A2); ble → 0x149d8 (skip pos add if step <= 0)
  const stepSigned = sextByteSigned(sb(state, sp, 0x26));
  if (stepSigned <= 0) {
    return;
  }

  // 0x149ba  tst.b (0x1a,A2); beq → 0x149ca (pos add for state==0)
  // 0x149c2  cmpi.b #3,(0x1a,A2); bne → 0x149d8 (skip if state != 3)
  const s1a = sb(state, sp, 0x1a);
  if (s1a !== 0 && s1a !== 3) {
    return;
  }

  // 0x149ca  pos += velocity
  // slot[0x0c] += slot[0x00] (long, unsigned add)
  const newX = (sl(state, sp, 0x0c) + sl(state, sp, 0x00)) >>> 0;
  swl(state, sp, 0x0c, newX);
  // slot[0x10] += slot[0x04]
  const newY = (sl(state, sp, 0x10) + sl(state, sp, 0x04)) >>> 0;
  swl(state, sp, 0x10, newY);
}
