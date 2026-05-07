/**
 * state-dispatch-15460.ts — replica `FUN_00015460` (528 byte).
 *
 * Dispatcher 7-way su `kind = byte @ structPtr+0x1A` (con bounds check
 * signed `0 <= kind <= 6`; out-of-range → solo l'epilog comune). Usa una
 * jump-table di 7 word-offsets @ 0x1549A; per ogni `kind` sceglie un
 * "case" e infine applica un epilog comune che:
 *   - copia `(0x5c,A0) → (0x58,A0)` (snapshot anim ptr corrente come "prev")
 *   - azzera `(0x24,A0)`
 *   - scrive `(0x25,A0) = 0x02` se `kind ∈ {0, 4}`, altrimenti `0x01`
 *
 * **Jump table** (letta dal binario @ 0x1549A, word-offsets da 0x1549A):
 *   - kind 0 → 0x154A8 (case track-marble)
 *   - kind 1 → 0x1561C (case anim 0x20CD8 + clr +0x27)
 *   - kind 2 → 0x15578 (case anim 0x20D64 / delta-asr-2 dispatch)
 *   - kind 3 → 0x154A8 (alias del case 0)
 *   - kind 4 → 0x155C2 (case velocity-magnitude → 4-way anim)
 *   - kind 5 → 0x15630 (case anim 0x20E28, no scrittura +0x26)
 *   - kind 6 → 0x1563A (case anim 0x20D6C, no scrittura +0x26)
 *
 * **Caller noti** (find_xrefs, 8 sites tutti UNCONDITIONAL_CALL o
 *  COMPUTED_CALL):
 *   - `0x14fc6` in `FUN_00014e92`
 *   - `0x15876` in `FUN_00015670`
 *   - `0x15456`, `0x1530e`, `0x1529c`, `0x152fe`, `0x153e2`, `0x1525a`,
 *     `0x15262` in `FUN_00015148` (computed dispatch interno)
 * Tutti passano `structPtr` come arg1 long sullo stack (cdecl-like).
 *
 * **Disasm 0x15460..0x1566F** (528 byte; il prompt cita 514 byte ma il
 * size effettivo è 0x210 = 528 byte fino al rts incluso):
 *
 *   movem.l {D5,D4,D3,D2},-(SP)            ; prologue (16 byte)
 *   movea.l (0x14,SP),A0                   ; A0 = structPtr (arg1)
 *   move.b  (0x1A,A0),D0b
 *   ext.w   D0w
 *   ext.l   D0                             ; D0 = signExt_l(kind byte)
 *   exg     D0,A1
 *   cmpa.w  #0x0,A1                        ; cmp signed: kind < 0?
 *   exg     D0,A1
 *   blt.w   0x15642                        ; OUT-OF-RANGE → epilog only
 *   exg     D0,A1
 *   cmpa.w  #0x6,A1                        ; cmp signed: kind > 6?
 *   exg     D0,A1
 *   bgt.w   0x15642                        ; OUT-OF-RANGE → epilog only
 *   movea.l D0,A1
 *   move.l  A1,D0
 *   movea.l D0,A1
 *   adda.l  D0,A1                          ; A1 = D0 * 2 (word index)
 *   move.l  A1,D0
 *   move.w  (0x1549A,PC,D0w*1),D0w         ; D0 = jumpTable[kind]
 *   jmp     (0x1549A,PC,D0w*1)             ; goto target
 *
 *   ; --- jump table @ 0x1549A (14 byte, 7 word-offsets) ---
 *   ; (offsets relative to 0x1549A, sign-extended to 32 bit when added)
 *
 *   ; ============ CASE 0 / 3 (track marble) @ 0x154A8 ============
 *   clr.b   D3b                             ; D3 = 0 (X-vel direction)
 *   clr.b   D2b                             ; D2 = 0 (Y-vel direction)
 *   move.l  (0xC,A0),D0
 *   moveq   #0x13,D1
 *   asr.l   D1,D0                           ; D0 = pos_x >> 19 (signed)
 *   move.w  D0w,D4w                         ; D4w = cellX
 *   move.l  (0x10,A0),D0
 *   moveq   #0x13,D1
 *   asr.l   D1,D0
 *   move.w  D0w,D5w                         ; D5w = cellY
 *   movea.l (0x4A,A0),A1                    ; A1 = targetCellPtr (long @ +0x4A)
 *   move.b  (A1),D1b
 *   ext.w   D1w                             ; D1w = signExt(target.x)
 *   movea.l (0x4A,A0),A1
 *   move.b  (1,A1),D0b
 *   ext.w   D0w                             ; D0w = signExt(target.y)
 *   tst.l   (A0)                            ; tst.l vel_x (long @ A0)
 *   bne.b   0x154F6                         ; vel_x != 0 → Y-priority path
 *   ; --- vel_x == 0: X-first path ---
 *   cmp.w   D1w,D4w
 *   ble.b   0x154DE
 *   moveq   #-0x8,D3                        ; cellX > target.x → D3=-8 (left)
 *   bra.b   0x15514
 *   cmp.w   D1w,D4w                         ; @ 0x154DE
 *   bge.b   0x154E6                         ; cellX == target.x → try Y
 *   moveq   #0x8,D3                         ; cellX < target.x → D3=+8 (right)
 *   bra.b   0x15514
 *   cmp.w   D0w,D5w                         ; @ 0x154E6
 *   ble.b   0x154EE
 *   moveq   #-0x8,D2                        ; cellY > target.y → D2=-8 (up)
 *   bra.b   0x15514
 *   cmp.w   D0w,D5w                         ; @ 0x154EE
 *   bge.b   0x15514                         ; cellY == target.y → no-move
 *   moveq   #0x8,D2                         ; cellY < target.y → D2=+8 (down)
 *   bra.b   0x15514
 *   ; --- vel_x != 0: Y-first path @ 0x154F6 ---
 *   cmp.w   D0w,D5w
 *   ble.b   0x154FE
 *   moveq   #-0x8,D2
 *   bra.b   0x15514
 *   cmp.w   D0w,D5w                         ; @ 0x154FE
 *   bge.b   0x15506
 *   moveq   #0x8,D2
 *   bra.b   0x15514
 *   cmp.w   D1w,D4w                         ; @ 0x15506
 *   ble.b   0x1550E
 *   moveq   #-0x8,D3
 *   bra.b   0x15514
 *   cmp.w   D1w,D4w                         ; @ 0x1550E
 *   bge.b   0x15514
 *   moveq   #0x8,D3
 *   ; --- decide animation ptr & write velocities @ 0x15514 ---
 *   tst.b   D2b
 *   ble.b   0x15522
 *   move.l  #0x20C6C,(0x5C,A0)              ; D2 > 0 (down) → anim 0x20C6C
 *   bra.b   0x15554
 *   tst.b   D2b                             ; @ 0x15522
 *   bge.b   0x15530
 *   move.l  #0x20C90,(0x5C,A0)              ; D2 < 0 (up) → anim 0x20C90
 *   bra.b   0x15554
 *   tst.b   D3b                             ; @ 0x15530
 *   ble.b   0x1553E
 *   move.l  #0x20C48,(0x5C,A0)              ; D3 > 0 (right) → anim 0x20C48
 *   bra.b   0x15554
 *   tst.b   D3b                             ; @ 0x1553E
 *   bge.b   0x1554C
 *   move.l  #0x20CB4,(0x5C,A0)              ; D3 < 0 (left) → anim 0x20CB4
 *   bra.b   0x15554
 *   move.l  #0x20C18,(0x5C,A0)              ; @ 0x1554C: idle → 0x20C18
 *   ; --- write velocities & flag @ 0x15554 ---
 *   move.b  D3b,D0b
 *   ext.w   D0w
 *   ext.l   D0
 *   moveq   #0x10,D1
 *   asl.l   D1,D0                           ; D0 = signExt(D3) << 16
 *   move.l  D0,(A0)                         ; vel_x = D3 << 16 (16.16 fp)
 *   move.b  D2b,D0b
 *   ext.w   D0w
 *   ext.l   D0
 *   moveq   #0x10,D1
 *   asl.l   D1,D0
 *   move.l  D0,(0x4,A0)                     ; vel_y = D2 << 16
 *   move.b  #0x1,(0x26,A0)                  ; (0x26,A0) = 1
 *   bra.w   0x15642                         ; → epilog
 *
 *   ; ============ CASE 2 (anim 0x20D64 / delta-asr-2) @ 0x15578 ============
 *   move.l  #0x20D64,D0
 *   cmp.l   (0x5C,A0),D0
 *   beq.w   0x15642                         ; (0x5C,A0)==0x20D64 → epilog only
 *   move.l  (0x5C,A0),D0
 *   cmp.l   (0x58,A0),D0
 *   bne.b   0x155A2                         ; current != prev → delta path
 *   move.l  #0x20D64,(0x5C,A0)              ; current == prev → set 0x20D64
 *   move.b  #0x1,(0x26,A0)
 *   bra.w   0x15642
 *   ; @ 0x155A2:
 *   move.l  (0x58,A0),D0                    ; D0 = prev_anim
 *   sub.l   (0x5C,A0),D0                    ; D0 = prev - current (signed long)
 *   asr.l   #0x2,D0                          ; D0 = (prev - current) >> 2
 *   move.w  D0w,D1w                          ; D1w = low word of D0
 *   moveq   #0x4,D0
 *   cmp.w   D1w,D0w                          ; cmp D1w (delta), D0w(=4)
 *   bgt.b   0x155B8                          ; 4 > delta → -1
 *   moveq   #0x1,D0
 *   bra.b   0x155BA
 *   moveq   #-0x1,D0                         ; @ 0x155B8
 *   move.b  D0b,(0x26,A0)                    ; @ 0x155BA: write ±1
 *   bra.w   0x15642
 *
 *   ; ============ CASE 4 (velocity magnitude) @ 0x155C2 ============
 *   move.l  (0x1C,A0),D1                    ; D1 = field @ +0x1C (vel-x)
 *   move.l  (0x20,A0),D0                    ; D0 = field @ +0x20 (vel-y)
 *   tst.l   D1
 *   bge.b   0x155D4
 *   move.l  D1,D3
 *   neg.l   D3                              ; D3 = -D1 (negative case)
 *   bra.b   0x155D6
 *   move.l  D1,D3                           ; @ 0x155D4: D3 = D1 (non-neg)
 *   tst.l   D0                              ; @ 0x155D6
 *   bge.b   0x155E0
 *   move.l  D0,D2
 *   neg.l   D2
 *   bra.b   0x155E2
 *   move.l  D0,D2                           ; @ 0x155E0
 *   cmp.l   D2,D3                           ; @ 0x155E2: |D1| vs |D0|
 *   ble.b   0x155FE                         ; |D1| <= |D0| → Y-axis
 *   tst.l   D1
 *   ble.b   0x155F4
 *   move.l  #0x20DD8,(0x5C,A0)              ; D1 > 0 → anim 0x20DD8
 *   bra.b   0x15614
 *   move.l  #0x20E14,(0x5C,A0)              ; @ 0x155F4: D1 <= 0 → 0x20E14
 *   bra.b   0x15614
 *   tst.l   D0                              ; @ 0x155FE
 *   ble.b   0x1560C
 *   move.l  #0x20DEC,(0x5C,A0)              ; D0 > 0 → anim 0x20DEC
 *   bra.b   0x15614
 *   move.l  #0x20E00,(0x5C,A0)              ; @ 0x1560C: D0 <= 0 → 0x20E00
 *   move.b  #0x1,(0x26,A0)                  ; @ 0x15614
 *   bra.b   0x15642
 *
 *   ; ============ CASE 1 (anim 0x20CD8) @ 0x1561C ============
 *   move.l  #0x20CD8,(0x5C,A0)
 *   clr.b   (0x27,A0)                       ; clear byte @ +0x27 (case 1 only)
 *   move.b  #0x1,(0x26,A0)
 *   bra.b   0x15642
 *
 *   ; ============ CASE 5 (anim 0x20E28) @ 0x15630 ============
 *   move.l  #0x20E28,(0x5C,A0)
 *   bra.b   0x15642                          ; nessuna scrittura +0x26
 *
 *   ; ============ CASE 6 (anim 0x20D6C) @ 0x1563A ============
 *   move.l  #0x20D6C,(0x5C,A0)
 *   ; fall-through al common epilog
 *
 *   ; ============ COMMON EPILOG @ 0x15642 ============
 *   move.l  (0x5C,A0),(0x58,A0)             ; prevAnim = currentAnim
 *   clr.b   (0x24,A0)
 *   tst.b   (0x1A,A0)
 *   beq.w   0x1565C                         ; kind == 0 → write 0x02
 *   cmpi.b  #0x4,(0x1A,A0)
 *   bne.b   0x15664                         ; kind != 4 → write 0x01
 *   move.b  #0x2,(0x25,A0)                  ; @ 0x1565C: kind ∈ {0,4} → 0x02
 *   bra.b   0x1566A
 *   move.b  #0x1,(0x25,A0)                  ; @ 0x15664: altrimenti 0x01
 *   movem.l (SP)+,{D2,D3,D4,D5}             ; @ 0x1566A: restore
 *   rts
 *
 * **Side effects** (tutti diretti su workRam, 0 JSR):
 *   - `(0x00,A0..0x03,A0)`: writes vel_x (long, 16.16) — solo case 0/3
 *   - `(0x04,A0..0x07,A0)`: writes vel_y (long, 16.16) — solo case 0/3
 *   - `(0x24,A0)`: cleared in epilog (sempre)
 *   - `(0x25,A0)`: 0x02 se kind ∈ {0,4}, 0x01 altrimenti — sempre in epilog
 *   - `(0x26,A0)`: 0x01 nei case 0/3/1/4; ±1 in case 2 (delta-based);
 *                 NON scritto in case 5/6 e nei rami out-of-range
 *   - `(0x27,A0)`: cleared solo nel case 1
 *   - `(0x58..0x5B,A0)`: copia di `(0x5C..0x5F,A0)` (sempre in epilog)
 *   - `(0x5C..0x5F,A0)`: anim ptr — scritto in case 0/1/2/3/4/5/6
 *
 * **Out-of-range kinds** (kind < 0 oppure kind > 6 signed): saltano tutti
 * i case e finiscono diretti nell'epilog. (0x5C,A0) NON viene toccato,
 * quindi `(0x58,A0) ← (0x5C,A0)` propaga il vecchio valore. (0x26,A0) e
 * `(0x27,A0)` rimangono intatti. (0x25,A0) viene comunque scritto in base
 * al test `kind == 0 || kind == 4` (per byte fuori range il byte letto
 * dalla mem è > 6 o ha bit alto, quindi != 0 e != 4 → 0x01).
 *
 * Verifica bit-perfect via `cli/src/test-state-dispatch-15460-parity.ts`.
 */

import type { GameState } from "./state.js";

/** WORK RAM base assoluta M68k. */
const WORK_RAM_BASE = 0x00400000;
/** Dimensione workRam (8 KB). */
const WORK_RAM_SIZE = 0x2000;

/** Offset campo `kind` (byte) dentro lo struct. */
export const KIND_BYTE_OFF = 0x1a as const;

/** Pos X (long, 16.16 fixed-point) @ structPtr+0x0C. */
export const POS_X_OFF = 0x0c as const;
/** Pos Y (long, 16.16 fixed-point) @ structPtr+0x10. */
export const POS_Y_OFF = 0x10 as const;
/** Field @ structPtr+0x1C (long, used da case 4 come "vel-x magnitude"). */
export const FIELD_1C_OFF = 0x1c as const;
/** Field @ structPtr+0x20 (long, used da case 4 come "vel-y magnitude"). */
export const FIELD_20_OFF = 0x20 as const;
/** Vel X (long) @ structPtr+0x00. */
export const VEL_X_OFF = 0x00 as const;
/** Vel Y (long) @ structPtr+0x04. */
export const VEL_Y_OFF = 0x04 as const;
/** Byte flag @ structPtr+0x24 (cleared in epilog). */
export const FLAG_24_OFF = 0x24 as const;
/** Byte flag @ structPtr+0x25 (1 o 2 in epilog). */
export const FLAG_25_OFF = 0x25 as const;
/** Byte flag @ structPtr+0x26 (1 o ±1 nei case). */
export const FLAG_26_OFF = 0x26 as const;
/** Byte @ structPtr+0x27 (cleared solo in case 1). */
export const FLAG_27_OFF = 0x27 as const;
/** Long ptr @ structPtr+0x4A → target cell ptr (case 0/3). */
export const TARGET_PTR_OFF = 0x4a as const;
/** Long anim ptr "previous" @ structPtr+0x58. */
export const PREV_ANIM_OFF = 0x58 as const;
/** Long anim ptr "current" @ structPtr+0x5C. */
export const CURR_ANIM_OFF = 0x5c as const;

/** Animation pointer constants (ROM data addresses). */
export const ANIM_IDLE = 0x00020c18 as const;
export const ANIM_RIGHT = 0x00020c48 as const;
export const ANIM_DOWN = 0x00020c6c as const;
export const ANIM_UP = 0x00020c90 as const;
export const ANIM_LEFT = 0x00020cb4 as const;
export const ANIM_CASE1 = 0x00020cd8 as const;
export const ANIM_CASE2_FINAL = 0x00020d64 as const;
export const ANIM_CASE6 = 0x00020d6c as const;
export const ANIM_CASE4_X_POS = 0x00020dd8 as const;
export const ANIM_CASE4_Y_POS = 0x00020dec as const;
export const ANIM_CASE4_Y_NEG = 0x00020e00 as const;
export const ANIM_CASE4_X_NEG = 0x00020e14 as const;
export const ANIM_CASE5 = 0x00020e28 as const;

/** asr.l signed (count clamp 0..63 come m68k). */
function asrL(value: number, count: number): number {
  const c = count & 0x3f;
  return ((value | 0) >> c) | 0;
}

/** asl.l (logical/arith, no diff per shift positivo) — count 0..63. */
function aslL(value: number, count: number): number {
  const c = count & 0x3f;
  return ((value | 0) << c) | 0;
}

/** Sign-extend byte 0..0xFF a int32. */
function sextByteL(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

/** Sign-extend low word a int32. */
function sextWordL(w: number): number {
  return ((w & 0xffff) << 16) >> 16;
}

/** Read big-endian long from workRam (or 0 if out-of-range). */
function readLongAbs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a + 4 > WORK_RAM_BASE + WORK_RAM_SIZE) return 0;
  const off = (a - WORK_RAM_BASE) >>> 0;
  const r = state.workRam;
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

/** Write big-endian long to workRam (no-op if out-of-range). */
function writeLongAbs(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a + 4 > WORK_RAM_BASE + WORK_RAM_SIZE) return;
  const off = (a - WORK_RAM_BASE) >>> 0;
  const u = value >>> 0;
  const r = state.workRam;
  r[off] = (u >>> 24) & 0xff;
  r[off + 1] = (u >>> 16) & 0xff;
  r[off + 2] = (u >>> 8) & 0xff;
  r[off + 3] = u & 0xff;
}

/** Read unsigned byte from workRam (or 0 if out-of-range). */
function readByteAbs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + WORK_RAM_SIZE) return 0;
  return state.workRam[a - WORK_RAM_BASE] ?? 0;
}

/** Write unsigned byte to workRam (no-op if out-of-range). */
function writeByteAbs(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + WORK_RAM_SIZE) return;
  state.workRam[a - WORK_RAM_BASE] = value & 0xff;
}

/**
 * Case 0/3 — track marble verso target cell.
 *
 * Calcola direzioni D2 (Y) e D3 (X) di velocità in {-8, 0, +8} basate
 * sul confronto fra `(pos>>19)` corrente e `(target.x, target.y)`.
 * Sceglie l'animazione in base a quale direzione è impostata, scrive
 * vel_x = D3<<16, vel_y = D2<<16, flag (0x26)=1.
 */
function caseTrackMarble(state: GameState, a0: number): void {
  // Cell coords (>>19 di pos)
  const posX = readLongAbs(state, a0 + POS_X_OFF);
  const posY = readLongAbs(state, a0 + POS_Y_OFF);
  // D4w/D5w sono word; ma nei cmp.w usiamo word signed.
  const cellX = sextWordL(asrL(posX, 0x13));
  const cellY = sextWordL(asrL(posY, 0x13));

  // Target cell ptr (long @ +0x4A)
  const targetPtr = readLongAbs(state, a0 + TARGET_PTR_OFF);
  const targetX = sextByteL(readByteAbs(state, targetPtr));
  const targetY = sextByteL(readByteAbs(state, targetPtr + 1));

  // tst.l (A0) — signed long
  const velXCurrent = readLongAbs(state, a0 + VEL_X_OFF) | 0;

  let d3 = 0; // X-direction
  let d2 = 0; // Y-direction

  if (velXCurrent === 0) {
    // X-priority path
    if (cellX > targetX) {
      d3 = -8;
    } else if (cellX < targetX) {
      d3 = 8;
    } else {
      // X aligned → try Y
      if (cellY > targetY) {
        d2 = -8;
      } else if (cellY < targetY) {
        d2 = 8;
      }
      // else: aligned both → d2=d3=0 (idle)
    }
  } else {
    // Y-priority path
    if (cellY > targetY) {
      d2 = -8;
    } else if (cellY < targetY) {
      d2 = 8;
    } else {
      // Y aligned → try X
      if (cellX > targetX) {
        d3 = -8;
      } else if (cellX < targetX) {
        d3 = 8;
      }
    }
  }

  // Animation selection — D2 has priority over D3.
  // tst.b D2b: ble (D2 <= 0) → if D2 > 0 → DOWN
  // tst.b D2b: bge (D2 >= 0) → if D2 < 0 → UP
  // (NB: the compare is on D2.b, but per come scriviamo d2 (-8/0/+8),
  // il segno del byte coincide col segno del long.)
  let animPtr: number;
  if (d2 > 0) {
    animPtr = ANIM_DOWN;
  } else if (d2 < 0) {
    animPtr = ANIM_UP;
  } else if (d3 > 0) {
    animPtr = ANIM_RIGHT;
  } else if (d3 < 0) {
    animPtr = ANIM_LEFT;
  } else {
    animPtr = ANIM_IDLE;
  }
  writeLongAbs(state, a0 + CURR_ANIM_OFF, animPtr);

  // vel_x = signExt(D3.b) << 16 ; vel_y = signExt(D2.b) << 16
  const velX = aslL(sextByteL(d3 & 0xff), 0x10);
  const velY = aslL(sextByteL(d2 & 0xff), 0x10);
  writeLongAbs(state, a0 + VEL_X_OFF, velX);
  writeLongAbs(state, a0 + VEL_Y_OFF, velY);

  writeByteAbs(state, a0 + FLAG_26_OFF, 0x01);
}

/**
 * Case 1 — set anim 0x20CD8, clear (0x27,A0), flag (0x26)=1.
 */
function caseAnim20CD8(state: GameState, a0: number): void {
  writeLongAbs(state, a0 + CURR_ANIM_OFF, ANIM_CASE1);
  writeByteAbs(state, a0 + FLAG_27_OFF, 0x00);
  writeByteAbs(state, a0 + FLAG_26_OFF, 0x01);
}

/**
 * Case 2 — anim 0x20D64 / delta-based ±1 dispatch.
 *
 * - Se `(0x5C,A0) == 0x20D64` → no-op (esce diretto in epilog).
 * - Altrimenti se `(0x5C,A0) == (0x58,A0)` (corrente == prev) →
 *   `(0x5C,A0) = 0x20D64`, `(0x26,A0) = 1`.
 * - Altrimenti calcola `delta = ((prev - curr) >> 2)` (asr signed long),
 *   prende low word signed, scrive `(0x26,A0) = (4 > delta) ? -1 : 1`
 *   (cmp signed word).
 */
function caseAnim20D64(state: GameState, a0: number): void {
  const curr = readLongAbs(state, a0 + CURR_ANIM_OFF) | 0;
  if ((curr >>> 0) === ANIM_CASE2_FINAL) {
    return; // no scrittura +0x26; epilog only
  }
  const prev = readLongAbs(state, a0 + PREV_ANIM_OFF) | 0;
  if ((curr >>> 0) === (prev >>> 0)) {
    writeLongAbs(state, a0 + CURR_ANIM_OFF, ANIM_CASE2_FINAL);
    writeByteAbs(state, a0 + FLAG_26_OFF, 0x01);
    return;
  }
  // Delta path: ((prev - curr) >> 2) low word signed; cmp con 4.
  const delta32 = (prev - curr) | 0;
  const delta = asrL(delta32, 0x02);
  const deltaW = sextWordL(delta & 0xffff);
  // cmp.w D1w (delta), D0w (4): bgt → 4 > delta → write -1, else +1.
  const flag = 4 > deltaW ? -1 : 1;
  writeByteAbs(state, a0 + FLAG_26_OFF, flag & 0xff);
}

/**
 * Case 4 — velocity magnitude → 4-way anim.
 *
 * Confronta `|D1| = |(0x1C,A0)|` con `|D0| = |(0x20,A0)|` (cmp.l signed
 * post-abs). Se `|D1| > |D0|` → asse X; altrimenti asse Y. Sceglie
 * l'animazione in base al segno del field originale.
 */
function caseVelocityMagnitude(state: GameState, a0: number): void {
  const d1Orig = readLongAbs(state, a0 + FIELD_1C_OFF) | 0;
  const d0Orig = readLongAbs(state, a0 + FIELD_20_OFF) | 0;

  // tst.l + neg.l: if signed neg → negate, else identity.
  // bge è ">= 0" → se >= 0, identità; se < 0 → neg.
  const d3 = (d1Orig >= 0 ? d1Orig : -d1Orig) | 0;
  const d2 = (d0Orig >= 0 ? d0Orig : -d0Orig) | 0;

  // cmp.l D2,D3 ; ble.b 0x155FE: condition (D3 <= D2) → Y axis.
  // |D1| > |D0| → X axis; |D1| <= |D0| → Y axis.
  let animPtr: number;
  if (d3 > d2) {
    // X axis: if D1 > 0 → ANIM_CASE4_X_POS, else ANIM_CASE4_X_NEG
    // (tst.l D1; ble.b 0x155F4: if D1 <= 0 → X_NEG, else X_POS)
    animPtr = d1Orig > 0 ? ANIM_CASE4_X_POS : ANIM_CASE4_X_NEG;
  } else {
    // Y axis: if D0 > 0 → Y_POS, else Y_NEG
    animPtr = d0Orig > 0 ? ANIM_CASE4_Y_POS : ANIM_CASE4_Y_NEG;
  }
  writeLongAbs(state, a0 + CURR_ANIM_OFF, animPtr);
  writeByteAbs(state, a0 + FLAG_26_OFF, 0x01);
}

/**
 * Case 5 — anim 0x20E28 (NO scrittura +0x26).
 */
function caseAnim20E28(state: GameState, a0: number): void {
  writeLongAbs(state, a0 + CURR_ANIM_OFF, ANIM_CASE5);
}

/**
 * Case 6 — anim 0x20D6C (NO scrittura +0x26).
 */
function caseAnim20D6C(state: GameState, a0: number): void {
  writeLongAbs(state, a0 + CURR_ANIM_OFF, ANIM_CASE6);
}

/**
 * Common epilog @ 0x15642 — applicato sempre, anche per kind out-of-range.
 *
 *   - `(0x58,A0) ← (0x5C,A0)` (snapshot anim ptr come "prev")
 *   - `(0x24,A0) ← 0`
 *   - `(0x25,A0) ← (kind ∈ {0,4}) ? 0x02 : 0x01`  (read kind from struct)
 */
function commonEpilog(state: GameState, a0: number): void {
  // Copy current anim to prev slot.
  const curr = readLongAbs(state, a0 + CURR_ANIM_OFF);
  writeLongAbs(state, a0 + PREV_ANIM_OFF, curr);
  // Clear flag @ +0x24.
  writeByteAbs(state, a0 + FLAG_24_OFF, 0x00);
  // Write flag @ +0x25 based on kind byte (re-read from memory).
  const kindByte = readByteAbs(state, a0 + KIND_BYTE_OFF);
  const flag25 = kindByte === 0x00 || kindByte === 0x04 ? 0x02 : 0x01;
  writeByteAbs(state, a0 + FLAG_25_OFF, flag25);
}

/**
 * Replica bit-perfect di `FUN_00015460` — dispatcher 7-way su `kind`
 * byte @ structPtr+0x1A, con epilog comune.
 *
 * @param state          GameState. Letto/scritto su `workRam` agli offset
 *                       relativi a `structPtrLong - 0x400000`. Vedi sezione
 *                       "Side effects" del docstring del modulo.
 * @param structPtrLong  long (A0): pointer assoluto allo struct (workRam).
 * @returns void. Tutti i side effects sono scritture dirette su workRam;
 *          la funzione originale non chiama altre subroutine.
 *
 * **Comportamento per kind**:
 *   - kind 0 → `caseTrackMarble`, poi epilog (write 0x25=2)
 *   - kind 1 → `caseAnim20CD8`, poi epilog (write 0x25=1)
 *   - kind 2 → `caseAnim20D64`, poi epilog (write 0x25=1)
 *   - kind 3 → `caseTrackMarble`, poi epilog (write 0x25=1) — **NB: kind 3
 *               usa lo stesso case 0 ma 0x25 finisce a 0x01 (kind != 0/4)**
 *   - kind 4 → `caseVelocityMagnitude`, poi epilog (write 0x25=2)
 *   - kind 5 → `caseAnim20E28`, poi epilog (write 0x25=1; +0x26 NON toccato)
 *   - kind 6 → `caseAnim20D6C`, poi epilog (write 0x25=1; +0x26 NON toccato)
 *   - kind <0 (signed, byte 0x80..0xFF) o kind > 6: skip case body, solo epilog.
 */
export function stateDispatch15460(
  state: GameState,
  structPtrLong: number,
): void {
  const a0 = structPtrLong >>> 0;

  // Read kind byte and sign-extend.
  const kindByte = readByteAbs(state, a0 + KIND_BYTE_OFF);
  const kindSigned = sextByteL(kindByte);

  // Bounds check signed: 0 <= kind <= 6.
  if (kindSigned >= 0 && kindSigned <= 6) {
    switch (kindSigned) {
      case 0:
      case 3:
        caseTrackMarble(state, a0);
        break;
      case 1:
        caseAnim20CD8(state, a0);
        break;
      case 2:
        caseAnim20D64(state, a0);
        break;
      case 4:
        caseVelocityMagnitude(state, a0);
        break;
      case 5:
        caseAnim20E28(state, a0);
        break;
      case 6:
        caseAnim20D6C(state, a0);
        break;
    }
  }

  // Common epilog — applied always.
  commonEpilog(state, a0);
}
