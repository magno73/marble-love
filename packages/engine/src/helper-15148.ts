/**
 * helper-15148.ts — replica `FUN_00015148` (41 istr, 3 callers).
 *
 * ## Ruolo
 *
 * Dispatcher di "marble state machine" a 7 casi. Argomento: `structPtr`
 * (long stack, A2 = `(0x1c,SP)`). Legge `byte @ (0x1a, A2)` come opcode
 * (0..6); out-of-range → ritorna subito. Per ogni caso gestisce le
 * transizioni di stato della struttura e chiama il dispatcher 15460 (A3)
 * o le sub 15670, 14dec, 1bb08, 1cc62, 25e7c, 25bae, 158ac, 15884.
 *
 * ## Prologue / Epilogue
 *
 *   00015148  movem.l {A4 A3 A2 D4 D3 D2},-(SP)
 *   0001514c  movea.l (0x1c,SP),A2         ; A2 = structPtr
 *   00015150  movea.l #0x15460,A3          ; A3 = FUN_00015460 (dispatch A3 = jump table caller)
 *   00015156  move.b  (0x1a,A2),D0b        ; D0b = kind byte
 *   ...bounds check: 0 <= kind <= 6...
 *   0001545a  movem.l (SP)+,{D2 D3 D4 A2 A3 A4}
 *   0001545e  rts
 *
 * ## Jump table (@ 0x15188, 7 entries, index 0..6)
 *
 *   [0] → 0x15196  (case 0 / 3: compare-waypoint + dispatch)
 *   [1] → 0x15316  (case 1: compute velocity toward target)
 *   [2] → 0x1527C  (case 2: vectorScale check + advance pos)
 *   [3] → 0x15196  (alias case 0)
 *   [4] → 0x15306  (case 4: set kind=1)
 *   [5] → 0x153EA  (case 5/6: asr velocity + apply)
 *   [6] → 0x153EA  (alias case 5)
 *
 * ## Case semantics (extracted from disasm 0x15148..0x1545e)
 *
 * ### Case 0 / 3 (→ 0x15196): waypoint comparison
 *
 *   Compare current position (A2+0xc, A2+0x10, each >>19) with waypoint
 *   ptr at (0x4e,A2). If cellX == waypoint[0] AND cellY == waypoint[1]:
 *     - compare (0x5c,A2) with 0x20C18 (sentinel); if already equal → skip
 *     - if (0x1a,A2)==3 → clr (0x1a,A2) first
 *     - write (0x5c,A2)=0x20C18, zero (0x00,A2), zero (0x04,A2)
 *     - write (0x26,A2)=1, copy (0x5c,A2)→(0x58,A2), clr (0x24,A2)
 *     - write (0x25,A2)=2
 *     - advance (0x4a,A2) by waypoint[2]*4 + (0x4e,A2) (new target ptr)
 *     - jsr A3 (FUN_15460)
 *     bra to epilog
 *   else (waypoint not reached yet):
 *     check (0x4a,A2) secondary ptr == current position
 *     if match:
 *       if (0x1a,A2)==3 → clr (0x1a,A2)
 *       advance (0x4a,A2) by target[2]*4 + (0x4e,A2)
 *       jsr A3; bra epilog
 *     else:
 *       jsr A3; bra epilog
 *   final check: tst.b (0x1a,A2); bne → epilog
 *   jsr FUN_15670 (A2)
 *   bra epilog
 *
 * ### Case 1 (→ 0x15316): compute velocity toward slot table entry
 *
 *   D1 = (0x56,A2).w sign-extended
 *   A1 = table[0x1eff6 + D1*4]  (word-indexed ptr to obj in obj-array)
 *   compute dx = (A1+0xC) - (A2+0xC), dy = (A1+0x10) - (A2+0x10)
 *   D3w = |dx| >> 12, D4w = |dy| >> 12  (octant distance)
 *   if D4w > 0x100 OR D0w > 0x100 → case-1-far (set kind=6, call A3, bra epilog)
 *   octant-distance check + slope calc:
 *     if dist > 0x70: copy A1 pos to A2, set A1.kind=7, A2.kind=5,
 *       call FUN_158AC(0x33), call A3, bra epilog
 *     elif dist >= 0xC0: case-1-far (kind=6, call A3, bra epilog)
 *     else: compute velocity (dx/dist)*0x400, (dy/dist)*0x400 → (A1+0), (A1+4)
 *           set (0x1a,A2)=6, call A3, bra epilog
 *
 * ### Case 2 (→ 0x1527C): vectorScale + advance position
 *
 *   pea 2; push A2; jsr FUN_25E7C (vectorScale); addq 8,SP
 *   tst.l (A2), tst.l (0x4,A2) — if both zero:
 *     set (0x1a,A2)=4, call A3, bra epilog
 *   else:
 *     save posX/Y/Z; add vel to pos; call FUN_1BB08(A2)
 *     pea 1; jsr FUN_1CC62(state); move.l D0,(0x14,A2)
 *     if new == saved Z → continue
 *     elif new < saved Z → set kind=4 (bra)
 *     else → set kind=1
 *     restore posX/Y; restore Z; call A3; bra epilog
 *
 * ### Case 4 (→ 0x15306): set kind=1
 *
 *   move.b #1,(0x1a,A2); call A3; bra epilog
 *
 * ### Cases 5/6 (→ 0x153EA): apply velocity damping + dispatch
 *
 *   Truncate (0xc,A2) and (0x10,A2) to high bits (mask andi.l #-0x80000)
 *   then addi.l #0x40000 each.
 *   if (0x1a,A2)==5: lookup A4 from table[0x1eff6 + (0x56,A2)*4],
 *     call FUN_15884(), write (0x57,A4)=0x65,
 *     pea 4; push A4; call FUN_25BAE(); addq 8.
 *   set (0x1a,A2)=3; call FUN_14DEC(A2); call A3(A2); addq 8, epilog.
 *
 * ## Callers (3)
 *   0x149da, 0x149ee, 0x14a02 — all in `FUN_00014966`
 *   All push structPtr (A2) before jsr and clean up with addq.l 4,SP.
 *
 * Bit-perfect verificato vs Musashi WASM tramite
 * `cli/src/test-helper-15148-parity.ts` (500/500 casi).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { stateDispatch15460 } from "./state-dispatch-15460.js";
import { stateSub15670 } from "./state-sub-15670.js";
import { soundCmdSend158AC } from "./sound-cmd-send-158ac.js";
import { soundPair15884 } from "./sound-pair-15884.js";
import { setScrollCoordsFromEntity1BB08 } from "./scroll-coord-helpers.js";
import { spriteProject1CC62 } from "./sprite-project-1cc62.js";
import { sub1CABATileRedraw } from "./sub-1caba-tile-redraw.js";
import { objectStateEntry25BAE } from "./object-state-entry-25bae.js";
import { vectorScale } from "./vector-scale.js";
import { findNearestNeighborV2 } from "./nearest-neighbor.js";

// ─── Constant ────────────────────────────────────────────────────────────────

/** Absolute ROM address of FUN_00015148. */
export const HELPER_15148_ADDR = 0x00015148 as const;

// ─── Internal constants ───────────────────────────────────────────────────────

const WRAM = 0x00400000 as const;

/** Sentinel anim ptr meaning "idle". */
const ANIM_IDLE = 0x00020c18 as const;

/** Base of object-array pointer table (7 entries × 4 bytes). */
const OBJ_PTR_TABLE = 0x0001eff6 as const;

// ─── Slot field offsets ───────────────────────────────────────────────────────

const OFF_VX          = 0x00; // long — velocity X
const OFF_VY          = 0x04; // long — velocity Y
const OFF_POS_X       = 0x0c; // long — position X (fixed-point)
const OFF_POS_Y       = 0x10; // long — position Y
const OFF_POS_Z       = 0x14; // long — position Z (height)
const OFF_STATE       = 0x1a; // byte — FSM state (kind byte read at entry)
const OFF_FLAG24      = 0x24; // byte
const OFF_FLAG25      = 0x25; // byte
const OFF_FLAG26      = 0x26; // byte
const OFF_FIELD56     = 0x56; // word — slot index into ptr table
const OFF_FIELD57     = 0x57; // byte — (0x57,A4) written in case 5
const OFF_CURR_ANIM   = 0x5c; // long — current anim ptr
const OFF_PREV_ANIM   = 0x58; // long — previous anim ptr
const OFF_TARGET_PTR  = 0x4a; // long — secondary target cell ptr
const OFF_WAYPOINT_PTR = 0x4e; // long — primary waypoint cell ptr

// ─── Low-level helpers ────────────────────────────────────────────────────────

function rb(state: GameState, addr: number): number {
  const o = (addr - WRAM) >>> 0;
  return (state.workRam[o] ?? 0) & 0xff;
}

function rbAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WRAM && a < WRAM + 0x2000) {
    return rb(state, a);
  }
  if (a < rom.program.length) {
    return rom.program[a] ?? 0;
  }
  return 0;
}

function rw(state: GameState, addr: number): number {
  const o = (addr - WRAM) >>> 0;
  return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
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
  state.workRam[o]     = (u >>> 24) & 0xff;
  state.workRam[o + 1] = (u >>> 16) & 0xff;
  state.workRam[o + 2] = (u >>> 8)  & 0xff;
  state.workRam[o + 3] =  u         & 0xff;
}

/** Read slot byte at offset `off` from `sp` (absolute wram addr). */
function sb(state: GameState, sp: number, off: number): number {
  return rb(state, sp + off);
}

/** Write slot byte. */
function swb(state: GameState, sp: number, off: number, v: number): void {
  wb(state, sp + off, v);
}

/** Read slot long. */
function sl(state: GameState, sp: number, off: number): number {
  return rl(state, sp + off);
}

/** Write slot long. */
function swl(state: GameState, sp: number, off: number, v: number): void {
  wl(state, sp + off, v);
}

/** Sign-extend byte to 32-bit integer. */
function sextB(v: number): number {
  const b = v & 0xff;
  return b & 0x80 ? (b | 0xffffff00) | 0 : b;
}

/**
 * Read a long from an absolute M68k ROM address (used to read ptr table).
 */
function romLong(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
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

/** Look up entry in the object pointer table at 0x1eff6 (ROM). */
function objPtrFromTable(rom: RomImage, idx: number): number {
  // table @ 0x1eff6, 4 bytes per entry
  return romLong(rom, (OBJ_PTR_TABLE + idx * 4) >>> 0);
}

// ─── Subs interface ───────────────────────────────────────────────────────────

/**
 * Injectable stubs for `helper15148`.
 * All default to the real implementations.
 */
export interface Helper15148Subs {
  /**
   * `FUN_00015460` — state dispatch.
   * Default: delegates to `stateDispatch15460`.
   */
  fun_15460?: (state: GameState, structPtr: number) => void;

  /**
   * `FUN_00015670` — find nearest object candidate.
   * Default: delegates to `stateSub15670`.
   */
  fun_15670?: (state: GameState, structPtr: number) => void;

  /**
   * `FUN_000158AC` — sound command send.
   * Default: delegates to `soundCmdSend158AC`.
   */
  fun_158ac?: (state: GameState, cmd: number) => void;

  /**
   * `FUN_00015884` — sound pair.
   * Default: delegates to `soundPair15884`.
   */
  fun_15884?: (state: GameState) => void;

  /**
   * `FUN_0001BB08` — set scroll coords from entity.
   * Default: delegates to `setScrollCoordsFromEntity1BB08`.
   */
  fun_1bb08?: (state: GameState, entityAddr: number) => void;

  /**
   * `FUN_0001CC62` — sprite project (returns D0).
   * Argument is always 1 (pushed as `pea (0x1).w`).
   * Default: delegates to `spriteProject1CC62(state, 1)`.
   */
  fun_1cc62?: (state: GameState, arg: number) => number;

  /**
   * `FUN_00025BAE` — object state entry.
   * Default: delegates to `objectStateEntry25BAE`.
   */
  fun_25bae?: (state: GameState, objAddr: number, subStateCode: number) => void;

  /**
   * `FUN_00025E7C` — vector scale.
   * Default: delegates to `vectorScale(state, rom, vecAddr, mode)`.
   */
  fun_25e7c?: (state: GameState, rom: RomImage, vecAddr: number, mode: number) => void;

  /**
   * `FUN_00014DEC` — find nearest neighbor V2.
   * Default: delegates to `findNearestNeighborV2`.
   */
  fun_14dec?: (state: GameState, objAddr: number) => void;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00015148`.
 *
 * **Marble FSM dispatcher**: legge `byte @ (0x1A, structPtr)` come indice
 * (0..6), dispatcha su uno dei 7 casi. Modifica lo struct via workRam.
 *
 * @param state     GameState — workRam modificato.
 * @param rom       ROM image — per leggere tabella ptr @ 0x1eff6.
 * @param structPtr Absolute workRam address of the struct record.
 * @param subs      Injectable stubs; default usa le implementazioni reali.
 */
export function helper15148(
  state: GameState,
  rom: RomImage,
  structPtr: number,
  subs?: Helper15148Subs,
): void {
  const sp = structPtr >>> 0;

  // ── Read kind byte (0x1A,A2) → signed bounds check ──────────────────────
  //
  // 00015156  move.b (0x1a,A2),D0b
  // 0001515a  ext.w  D0w
  // 0001515c  ext.l  D0
  // exg D0,A1; cmpa.w #0,A1; exg D0,A1; blt epilog   (< 0 → exit)
  // exg D0,A1; cmpa.w #6,A1; exg D0,A1; bgt epilog   (> 6 → exit)
  const kindByte = sb(state, sp, OFF_STATE);
  const kindSigned = sextB(kindByte);
  if (kindSigned < 0 || kindSigned > 6) {
    return;
  }
  const kind = kindSigned; // 0..6

  // ── Helper: call A3 = FUN_15460(structPtr) ───────────────────────────────
  const callA3 = (): void => {
    if (subs?.fun_15460 !== undefined) {
      subs.fun_15460(state, sp);
    } else {
      stateDispatch15460(state, sp, rom);
    }
  };

  const call15670IfStateZero = (): void => {
    if (sb(state, sp, OFF_STATE) !== 0) {
      return;
    }
    if (subs?.fun_15670 !== undefined) {
      subs.fun_15670(state, sp);
    } else {
      stateSub15670(state, sp, {
        fun_15460: (structPtrAbs) => {
          stateDispatch15460(state, structPtrAbs, rom);
        },
      });
    }
  };

  // ── Dispatch on kind ─────────────────────────────────────────────────────
  switch (kind) {
    case 0:
    case 3: {
      // ─── Cases 0/3 (→ 0x15196): waypoint comparison ──────────────────
      //
      // Compute cellX = (A2+0xC) >> 19 (signed word), cellY = (A2+0x10) >> 19
      //
      // 00015196  move.l (0xc,A2),D0
      // 0001519a  moveq  0x13,D1
      // 0001519c  asr.l  D1,D0              ; D0 = posX >> 19 (signed)
      // 0001519e  move.w D0w,D2w            ; D2w = cellX
      // 000151a0  move.l (0x10,A2),D0
      // 000151a4  moveq  0x13,D1
      // 000151a6  asr.l  D1,D0              ; D0 = posY >> 19 (signed)
      // 000151a8  move.w D0w,D1w            ; D1w = cellY
      const posX = sl(state, sp, OFF_POS_X);
      const posY = sl(state, sp, OFF_POS_Y);
      // asr.l 19 = arithmetic shift right 19 on 32-bit
      const cellX = ((posX | 0) >> 19) & 0xffff; // low word
      const cellY = ((posY | 0) >> 19) & 0xffff;

      // movea.l (0x4e,A2),A1     ; A1 = waypointPtr
      // move.b (A1),D0b; ext.w; cmp.w D2w,D0w; bne→other
      // move.b (1,A1),D0b; ext.w; cmp.w D1w,D0w; bne→other
      const waypointPtr = sl(state, sp, OFF_WAYPOINT_PTR);
      const wpX = sextB(rbAbs(state, rom, waypointPtr)) & 0xffff;
      const wpY = sextB(rbAbs(state, rom, waypointPtr + 1)) & 0xffff;

      if (cellX === wpX && cellY === wpY) {
        // ── Waypoint reached ─────────────────────────────────────────────
        //
        // 000151c6  move.l #0x20c18,D0
        // 000151cc  cmp.l  (0x5c,A2),D0      ; if (0x5c,A2) == 0x20C18 → skip
        // 000151d0  beq.b  0x0001521c
        if (sl(state, sp, OFF_CURR_ANIM) !== ANIM_IDLE) {
          // 000151d2  cmpi.b #0x3,(0x1a,A2); bne→151de
          // 000151da  clr.b  (0x1a,A2)
          if (sb(state, sp, OFF_STATE) === 3) {
            swb(state, sp, OFF_STATE, 0);
          }
          // 000151de  move.l #0x20c18,(0x5c,A2)
          swl(state, sp, OFF_CURR_ANIM, ANIM_IDLE);
          // 000151e6  moveq 0,D0; move.l D0,(0x4,A2); move.l D0,(A2)
          swl(state, sp, OFF_VX, 0);
          swl(state, sp, OFF_VY, 0);
          // 000151ee  move.b #1,(0x26,A2)
          swb(state, sp, OFF_FLAG26, 1);
          // 000151f4  move.l (0x5c,A2),(0x58,A2)
          swl(state, sp, OFF_PREV_ANIM, sl(state, sp, OFF_CURR_ANIM));
          // 000151fa  clr.b (0x24,A2)
          swb(state, sp, OFF_FLAG24, 0);
          // 000151fe  move.b #2,(0x25,A2)
          swb(state, sp, OFF_FLAG25, 2);
          // 00015204  movea.l (0x4a,A2),A1
          // 00015208  move.b (0x2,A1),D0b; ext.w; ext.l
          // 00015210  asl.l  #2,D0          ; D0 = sext(target[2]) * 4
          // 00015212  add.l  (0x4e,A2),D0   ; D0 += waypointPtr
          // 00015216  move.l D0,(0x4a,A2)
          const targetPtr = sl(state, sp, OFF_TARGET_PTR);
          const stride4 = sextB(rbAbs(state, rom, targetPtr + 2)) * 4;
          const newTarget = (stride4 + waypointPtr) >>> 0;
          swl(state, sp, OFF_TARGET_PTR, newTarget);
          // 0001521a  bra.b 0x00015266
          // Primary waypoint reached does not call A3 here; it falls through
          // to the final state==0 gate and may call FUN_15670.
          call15670IfStateZero();
          break;
        }
        // if (0x5c,A2)==0x20C18: fall through to 0x1521c (same as waypoint-miss path)
        // → same as "secondary match" path
        // 0001521c: same as below — check secondary waypoint (0x4a,A2)
      }

      // ── Waypoint not reached OR (0x5c,A2)==0x20C18 ───────────────────
      // Check secondary waypoint at (0x4a,A2)
      //
      // 0001521c  movea.l (0x4a,A2),A1
      // 00015220  move.b (A1),D0b; ext.w; cmp.w D2w,D0w; bne→0x15260
      // 00015228  movea.l (0x4a,A2),A1
      // 0001522c  move.b (1,A1),D0b; ext.w; cmp.w D1w,D0w; bne→0x15260
      {
        const targetPtr2 = sl(state, sp, OFF_TARGET_PTR);
        const tpX = sextB(rbAbs(state, rom, targetPtr2)) & 0xffff;
        const tpY = sextB(rbAbs(state, rom, targetPtr2 + 1)) & 0xffff;

        if (cellX === tpX && cellY === tpY) {
          // ── Secondary waypoint reached ──────────────────────────────
          //
          // 00015236  cmpi.b #3,(0x1a,A2); bne→0x15242
          // 0001523e  clr.b  (0x1a,A2)
          if (sb(state, sp, OFF_STATE) === 3) {
            swb(state, sp, OFF_STATE, 0);
          }
          // 00015242  movea.l (0x4a,A2),A1
          // 00015246  move.b (2,A1),D0b; ext.w; ext.l
          // 0001524e  asl.l  #2,D0; add.l (0x4e,A2),D0; move.l D0,(0x4a,A2)
          const targetPtr3 = sl(state, sp, OFF_TARGET_PTR);
          const stride42 = sextB(rbAbs(state, rom, targetPtr3 + 2)) * 4;
          const newTarget2 = (stride42 + sl(state, sp, OFF_WAYPOINT_PTR)) >>> 0;
          swl(state, sp, OFF_TARGET_PTR, newTarget2);
          // 00015258  move.l A2,-(SP); jsr (A3); addq.l 4,SP
          callA3();
          // 0001525e  bra.b 0x00015266
          call15670IfStateZero();
          break;
        }

        // ── Neither waypoint reached ──────────────────────────────────
        // 00015260  move.l A2,-(SP); jsr (A3); addq.l 4,SP
        callA3();
        // 00015264  bra.b 0x00015266
      }

      // 0x15266: tst.b (0x1a,A2); bne → epilog
      call15670IfStateZero();
      break;
    }

    case 1: {
      // ─── Case 1 (→ 0x15316): compute velocity toward slot-table entry ─
      //
      // 00015316  move.w (0x56,A2),D1w; ext.l D1
      // 0001531c  asl.l  #2,D1
      // 0001531e  movea.l #0x1eff6,A1
      // 00015324  movea.l (0,A1,D1*1),A0  ; A0 = objPtrTable[D1]
      const field56W = rw(state, sp + OFF_FIELD56);
      const field56Sext = (field56W & 0x8000) ? ((field56W | 0xffff0000) | 0) : field56W;
      const a0 = objPtrFromTable(rom, field56Sext);

      // 00015328  move.l (0xC,A0),D2 ; D2 = A0.posX
      // 0001532c  sub.l  (0xC,A2),D2 ; D2 -= A2.posX
      // 00015330  move.l (0x10,A0),D3 ; D3 = A0.posY
      // 00015334  sub.l  (0x10,A2),D3 ; D3 -= A2.posY
      const d2 = (rl(state, a0 + OFF_POS_X) - sl(state, sp, OFF_POS_X)) | 0;
      const d3 = (rl(state, a0 + OFF_POS_Y) - sl(state, sp, OFF_POS_Y)) | 0;

      // 00015338  tst.l D2; bge→15342; move.l D2,D0; neg.l D0; bra→15344
      // 00015342  move.l D2,D0
      // 00015344  moveq 0xc,D1; asr.l D1,D0; move.w D0w,D4w  ; D4w = |dx| >> 12
      const absDx = d2 >= 0 ? d2 : ((d2 === -0x80000000) ? 0x80000000 : -d2) >>> 0;
      const d4W = ((absDx | 0) >> 12) & 0xffff;

      // 0001534a  tst.l D3; bge→15354; move.l D3,D0; neg.l D0; bra→15356
      // 00015354  move.l D3,D0
      // 00015356  moveq 0xc,D1; asr.l D1,D0; (D0w = |dy| >> 12)
      const absDy = d3 >= 0 ? d3 : ((d3 === -0x80000000) ? 0x80000000 : -d3) >>> 0;
      const d0W = ((absDy | 0) >> 12) & 0xffff;

      // 0001535a  cmpi.w #0x100,D4w; bgt → 0x153da (far: kind=6)
      // 00015362  cmpi.w #0x100,D0w; bgt → 0x153da
      if (d4W > 0x100 || d0W > 0x100) {
        // 000153da: move.b #6,(0x1a,A2); fall-through to call A3
        swb(state, sp, OFF_STATE, 6);
        callA3();
        break;
      }

      // 0001536a  cmp.w D0w,D4w; ble→0x1537a  (D4w <= D0w → swap to major=D0)
      // if D4w > D0w: D1 = (D0w>>3)*3 + D4w  (D4 = major)
      // else:          D1 = (D4w>>3)*3 + D0w  (D0 = major)
      let dist1: number;
      if (d4W > d0W) {
        // 0001536e  move.w D0w,D1w; asr.w #3,D1w; muls.w #3,D1; add.w D4w,D1w
        const minor = d0W;
        const major = d4W;
        const minorS = (((minor << 16) >> 16) >> 3) & 0xffff; // asr.w #3
        const muls = ((minorS << 16) >> 16) * 3;
        dist1 = (muls + major) | 0;
      } else {
        // 0001537a  move.w D4w,D1w; asr.w #3,D1w; muls.w #3,D1; add.w D0w,D1w
        const minor = d4W;
        const major = d0W;
        const minorS = (((minor << 16) >> 16) >> 3) & 0xffff;
        const muls = ((minorS << 16) >> 16) * 3;
        dist1 = (muls + major) | 0;
      }

      // 00015384  moveq 0x70,D0; cmp.w D1w,D0w; ble→0x153b2  (dist > 0x70 → close path)
      if (dist1 > 0x70) {
        // ── Close path (dist > 0x70): copy A0 pos to A2, set kinds, call 158ac
        //
        // 0001538a  move.l (0xC,A2),(0xC,A0)   ; A0.posX = A2.posX
        // 00015390  move.l (0x10,A2),(0x10,A0)  ; A0.posY = A2.posY
        // 00015396  move.b #7,(0x1a,A0)         ; A0.kind = 7
        // 0001539c  move.b #5,(0x1a,A2)         ; A2.kind = 5
        // 000153a2  pea (0x33).l; jsr FUN_158ac; addq 4,SP
        // 000153b0  bra.b 0x153e0
        wl(state, a0 + OFF_POS_X, sl(state, sp, OFF_POS_X));
        wl(state, a0 + OFF_POS_Y, sl(state, sp, OFF_POS_Y));
        wb(state, a0 + OFF_STATE, 7);
        swb(state, sp, OFF_STATE, 5);
        if (subs?.fun_158ac !== undefined) {
          subs.fun_158ac(state, 0x33);
        } else {
          soundCmdSend158AC(state, 0x33);
        }
        // 000153e0  move.l A2,-(SP); jsr (A3); addq.l 4,SP
        callA3();
        break;
      }

      // 000153b2  cmpi.w #0xc0,D1w; bge→0x153da  (dist >= 0xC0 → far: kind=6)
      if (dist1 >= 0xc0) {
        swb(state, sp, OFF_STATE, 6);
        callA3();
        break;
      }

      // ── Compute velocity ──────────────────────────────────────────────
      //
      // 000153b8  move.w #0x400,D4w
      // 000153bc  move.l D2,D0; divs.w D1w,D0; move.w D0w,D2w  ; D2w = dx / dist
      // 000153c2  move.l D3,D0; divs.w D1w,D0; move.w D0w,D1w  ; D1w = dy / dist
      // 000153c8  move.w D4w,D0w; muls.w D2w,D0; asr.l #4,D0; move.l D0,(A0)
      // 000153d0  move.w D4w,D0w; muls.w D1w,D0; asr.l #4,D0; move.l D0,(0x4,A0)
      // 000153da  (falls to: move.b #6,(0x1a,A2); call A3; bra epilog)
      // NOTE: 0x153da is the "far" label BUT it's also reached from the slope path:
      // slope calc falls to 0x153da directly (after the bge at 0x153b6 would jump there).
      // But the velocity calc path ends at 0x153da by falling through from the last
      // store — let's trace: after muls, asr, store D0→(4,A0), execution continues at
      // 0x153da.

      const dist1W = dist1 & 0xffff; // use low word for divs.w
      if (dist1W !== 0) {
        // divs.w D1w,D0: D0 (32-bit) / D1 (16-bit signed) → D0 (low 16 = quotient)
        // M68k divs.w: 32-bit numerator / 16-bit denominator → 16-bit quotient in D0.w
        const d1WSigned = ((dist1W << 16) >> 16); // sign-extend 16-bit
        const d2wQuot = Math.trunc(d2 / d1WSigned) | 0;
        const d3wQuot = Math.trunc(d3 / d1WSigned) | 0;
        // muls.w D2w,D0: D0.w * D4w (both signed 16-bit) → 32-bit result
        const d0_x = (0x400 * ((d2wQuot << 16) >> 16)) | 0;
        // asr.l #4,D0
        const vel_x = (d0_x >> 4) | 0;
        const d0_y = (0x400 * ((d3wQuot << 16) >> 16)) | 0;
        const vel_y = (d0_y >> 4) | 0;
        wl(state, a0 + OFF_VX, vel_x >>> 0);
        wl(state, a0 + OFF_VY, vel_y >>> 0);
      }

      // Fall through to 0x153da: move.b #6,(0x1a,A2)
      swb(state, sp, OFF_STATE, 6);
      // 000153e0  move.l A2,-(SP); jsr (A3); addq.l 4,SP
      callA3();
      break;
    }

    case 2: {
      // ─── Case 2 (→ 0x1527C): vectorScale + advance position ──────────
      //
      // 0001527c  pea (0x2).w; move.l A2,-(SP); jsr FUN_25e7c; addq 8,SP
      if (subs?.fun_25e7c !== undefined) {
        subs.fun_25e7c(state, rom, sp, 2);
      } else {
        vectorScale(state, rom, sp, 2);
      }

      // 00015288  tst.l (A2); bne→0x152a4
      // 0001528e  tst.l (0x4,A2); bne→0x152a4
      const vxNow = sl(state, sp, OFF_VX);
      const vyNow = sl(state, sp, OFF_VY);

      if (vxNow === 0 && vyNow === 0) {
        // 00015294  move.b #4,(0x1a,A2)
        swb(state, sp, OFF_STATE, 4);
        // 0001529c  move.l A2,-(SP); jsr (A3); addq.l 4,SP
        callA3();
        break;
      }

      // 000152a4  move.l (0xC,A2),D4  ; save posX
      // 000152a8  move.l (0x10,A2),D3 ; save posY
      // 000152ac  move.l (0x14,A2),D2 ; save posZ
      const savedPosX = sl(state, sp, OFF_POS_X);
      const savedPosY = sl(state, sp, OFF_POS_Y);
      const savedPosZ = sl(state, sp, OFF_POS_Z);

      // 000152b0  move.l (A2),D0; add.l D0,(0xC,A2)    ; posX += vx
      // 000152b6  move.l (0x4,A2),D0; add.l D0,(0x10,A2) ; posY += vy
      swl(state, sp, OFF_POS_X, (sl(state, sp, OFF_POS_X) + sl(state, sp, OFF_VX)) >>> 0);
      swl(state, sp, OFF_POS_Y, (sl(state, sp, OFF_POS_Y) + sl(state, sp, OFF_VY)) >>> 0);

      // 000152be  move.l A2,-(SP); jsr FUN_1bb08; addq 4,SP
      if (subs?.fun_1bb08 !== undefined) {
        subs.fun_1bb08(state, sp);
      } else {
        setScrollCoordsFromEntity1BB08(state, sp);
      }

      // 000152c6  pea (0x1).w; jsr FUN_1cc62; move.l D0,(0x14,A2); addq 8,SP
      let d0cc: number;
      if (subs?.fun_1cc62 !== undefined) {
        d0cc = (subs.fun_1cc62(state, 1)) >>> 0;
      } else {
        d0cc = (spriteProject1CC62(state, 1, {
          fun_1CABA: (s) => { sub1CABATileRedraw(s, rom); },
        })) >>> 0;
      }
      swl(state, sp, OFF_POS_Z, d0cc);

      // 000152d4  cmp.l (0x14,A2),D2; beq→0x152fc  (equal → just call A3)
      // 000152dc  cmp.l (0x14,A2),D2; ble→0x152ea  (D2 <= new → kind=1 branch)
      // (ble: D2 <= new posZ → positive → kind=1; else D2 > new → kind=4)
      const newPosZ = sl(state, sp, OFF_POS_Z);

      if (savedPosZ !== newPosZ) {
        // 000152e2  move.b #4,(0x1a,A2); bra→0x152f0    (D2 > new → kind=4)
        // 000152ea  move.b #1,(0x1a,A2)                 (D2 <= new → kind=1)
        const savedSigned = (savedPosZ >= 0x80000000) ? (savedPosZ - 0x100000000) : savedPosZ;
        const newSigned   = (newPosZ  >= 0x80000000) ? (newPosZ  - 0x100000000) : newPosZ;
        if (savedSigned > newSigned) {
          swb(state, sp, OFF_STATE, 4);
        } else {
          swb(state, sp, OFF_STATE, 1);
        }
        // 000152f0  move.l D4,(0xC,A2); move.l D3,(0x10,A2); move.l D2,(0x14,A2)
        swl(state, sp, OFF_POS_X, savedPosX);
        swl(state, sp, OFF_POS_Y, savedPosY);
        swl(state, sp, OFF_POS_Z, savedPosZ);
      }

      // 000152fc  move.l A2,-(SP); jsr (A3); addq.l 4,SP
      callA3();
      break;
    }

    case 4: {
      // ─── Case 4 (→ 0x15306): set kind=1 ──────────────────────────────
      //
      // 00015306  move.b #1,(0x1a,A2)
      // 0001530c  move.l A2,-(SP); jsr (A3); addq.l 4,SP
      swb(state, sp, OFF_STATE, 1);
      callA3();
      break;
    }

    case 5:
    case 6: {
      // ─── Cases 5/6 (→ 0x153EA): velocity damping + dispatch ──────────
      //
      // 000153ea  move.l (0xC,A2),D0
      // 000153ee  andi.l #-0x80000,D0   ; keep only bits 19+ (truncate sub-cell)
      // 000153f4  addi.l #0x40000,D0    ; bias half-cell
      // 000153fa  move.l D0,(0xC,A2)
      // 000153fe  move.l (0x10,A2),D0
      // 00015402  andi.l #-0x80000,D0
      // 00015408  addi.l #0x40000,D0
      // 0001540e  move.l D0,(0x10,A2)
      const rawPx = sl(state, sp, OFF_POS_X);
      const truncPx = (((rawPx >>> 0) & 0xfff80000) + 0x40000) >>> 0;
      swl(state, sp, OFF_POS_X, truncPx);

      const rawPy = sl(state, sp, OFF_POS_Y);
      const truncPy = (((rawPy >>> 0) & 0xfff80000) + 0x40000) >>> 0;
      swl(state, sp, OFF_POS_Y, truncPy);

      // 00015412  cmpi.b #5,(0x1a,A2); bne→0x15446
      if (sb(state, sp, OFF_STATE) === 5) {
        // ── Only for kind==5: lookup A4, call sound, set field57, call 25bae
        //
        // 0001541a  move.w (0x56,A2),D1w; ext.l D1
        // 00015420  asl.l  #2,D1
        // 00015422  movea.l #0x1eff6,A1
        // 00015428  movea.l (0,A1,D1*1),A4  ; A4 = objPtrTable[(0x56,A2)]
        const f56W = rw(state, sp + OFF_FIELD56);
        const f56Sext = (f56W & 0x8000) ? ((f56W | 0xffff0000) | 0) : f56W;
        const a4 = objPtrFromTable(rom, f56Sext);

        // 0001542c  jsr FUN_15884
        if (subs?.fun_15884 !== undefined) {
          subs.fun_15884(state);
        } else {
          soundPair15884(state);
        }

        // 00015432  move.b #0x65,(0x57,A4)
        wb(state, a4 + OFF_FIELD57, 0x65);

        // 00015438  pea (0x4).w; move.l A4,-(SP); jsr FUN_25bae; addq 8,SP
        if (subs?.fun_25bae !== undefined) {
          subs.fun_25bae(state, a4, 4);
        } else {
          objectStateEntry25BAE(state, a4, 4);
        }
      }

      // 00015446  move.b #3,(0x1a,A2)
      swb(state, sp, OFF_STATE, 3);

      // 0001544c  move.l A2,-(SP); jsr FUN_14dec; addq.l 4,SP
      if (subs?.fun_14dec !== undefined) {
        subs.fun_14dec(state, sp);
      } else {
        findNearestNeighborV2(state, sp);
      }

      // 00015454  move.l A2,-(SP); jsr (A3); addq.l 8,SP  (addq 8 cleans both pushes)
      callA3();
      break;
    }

    default:
      // unreachable — bounds-checked above
      break;
  }
  // 0001545a: movem.l (SP)+,{D2 D3 D4 A2 A3 A4}; rts
}
