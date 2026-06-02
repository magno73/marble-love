/**
 * string-viewport-hit-175c8.ts — `FUN_000175C8` replica (266 bytes).
 *
 * **"string-bbox vs viewport" hit-test sub** invoked by
 * `FUN_000121b8` (1 xref @ `0x123da`, JSR.L) as part of the update pipeline.
 * It uses a dimensional bbox derived from a pointer chain
 * `slot[+0x3a] → ptrPtr → bboxPtr`; if `bboxPtr == 0xFFFFFFFF`, it uses
 * `(*0x400690 ± 3, *0x400692 ± 3)` (a 6×6 square around the "marble" /
 * world cursor). On overlap with the **first** colliding slot:
 *   - `slot[+0x25] = 0x1c`;
 *     and `FUN_158AC(0x5e)` (sound trigger);
 *
 *
 * **Disasm 0x175C8..0x176D0** (266 byte):
 *
 *   000175c8   link.w  A6, -0x2                  ; locVar @ -2(A6) (1 word)
 *   000175cc   movem.l { A4 A3 A2 D7 D6 D5 D4 D3 D2 }, -(SP)   ; 9 longs
 *   000175d0   movea.l (0x8, A6), A2             ; A2 = arg long (objPtr)
 *
 *   ;-- game-mode gate: state ∈ {2, 5} ----------------------------------
 *   000175d4   moveq   #2, D0
 *   000175d6   cmp.w   (0x400394).l, D0w
 *   000175dc   beq.b   0x175ee                   ; state == 2 → enter
 *   000175de   moveq   #5, D0
 *   000175e0   cmp.w   (0x400394).l, D0w
 *   000175e6   beq.b   0x175ee                   ; state == 5 → enter
 *   000175e8   moveq   #0, D0                    ; else: return 0
 *   000175ea   bra.w   0x176ca                   ; → epilog
 *
 *   ;-- viewport bounds: a square 6×6 (signed word) around marble (-3..+3) -
 *   000175ee   move.w  (0x400690).l, D6w         ; D6w = marble.x
 *   000175f4   subq.w  #3, D6w                   ; D6w = mx - 3 (viewLeft)
 *   000175f6   movea.w D6w, A4                   ; A4 (signed sext) = viewLeft
 *   000175f8   addq.w  #6, A4                    ; A4 = viewLeft + 6 = mx + 3 (viewRight)
 *   000175fa   movea.w (0x400692).l, A1          ; A1 (sext) = marble.y
 *   00017600   subq.w  #3, A1                    ; A1 = my - 3 (viewTop)
 *   00017602   move.w  A1w, (-0x2, A6)           ; locVar = viewTop
 *   00017606   addq.w  #6, (-0x2, A6)            ; locVar = viewTop + 6 = my + 3 (viewBottom)
 *
 *   ;-- loop sui 7 slot ------------------------------------------------
 *   0001760a   movea.l #0x401482, A3
 *   00017610   clr.b   D1b                        ; counter
 *   ; loop @ 0x17612:
 *   00017612   tst.b   (0x18, A3)                 ; slot.active?
 *   00017616   beq.w   0x176b6                    ; → next_iter
 *   0001761a   movea.l (0x3a, A3), A0             ; A0 = bboxPtrPtr
 *   0001761e   movea.l (A0), A0                   ; A0 = bboxPtr
 *   00017620   moveq   #-1, D0
 *   00017622   cmp.l   A0, D0
 *   00017624   bne.b   0x17630                    ; bboxPtr != -1 → readBbox
 *
 *   ; default branch (bboxPtr == 0xFFFFFFFF):
 *   00017626   moveq   #-2, D2                    ; D2.w = -2 (xMin)
 *   00017628   move.w  D2w, D3w                   ; D3.w = -2 (yMin)
 *   0001762a   moveq   #0xC, D0                   ; D0.w = 12 (width)
 *   0001762c   move.w  D0w, D4w                   ; D4.w = 12 (height)
 *   0001762e   bra.b   0x17648
 *
 *   ; readBbox branch:
 *   00017630   move.b (0x4, A0), D2b ; ext.w D2w  ; D2w = sext(xMin)
 *   00017636   move.b (0x5, A0), D3b ; ext.w D3w  ; D3w = sext(yMin)
 *   0001763c   move.b (0x6, A0), D0b ; ext.w D0w  ; D0w = sext(width)
 *   00017642   move.b (0x7, A0), D4b ; ext.w D4w  ; D4w = sext(height)
 *
 *   ; computeBbox @ 0x17648 (D0=width, D2=xMin, D3=yMin, D4=height):
 *   00017648   lea     (0xc, A3), A0
 *   0001764c   move.w  (A0), D5w                  ; D5w = slot.x = slot[+0xC].w
 *   0001764e   add.w   D2w, D5w                   ; D5 = slot.x + xMin = leftEdge
 *   00017650   move.w  D0w, D2w                   ; D2 = width
 *   00017652   add.w   D5w, D2w                   ; D2 = width + leftEdge = rightEdge
 *   00017654   lea     (0x10, A3), A0
 *   00017658   move.w  (A0), D0w                  ; D0w = slot.y = slot[+0x10].w
 *   0001765a   add.w   D3w, D0w                   ; D0 = slot.y + yMin = topEdge
 *   0001765c   move.w  D4w, D3w                   ; D3 = height
 *   0001765e   add.w   D0w, D3w                   ; D3 = height + topEdge = bottomEdge
 *
 *   ;-- AABB-vs-viewport overlap test (signed word) ---------------------
 *   00017660   cmp.w   D6w, D5w                   ; cmp leftEdge, viewLeft
 *   00017662   bgt.b   0x1766a                    ; leftEdge > viewLeft → check viewBound
 *   00017664   cmp.w   D2w, D6w                   ; cmp viewLeft, rightEdge
 *   00017666   ble.w   0x17672                    ; viewLeft <= rightEdge → X overlap
 *   0001766a   cmp.w   A4w, D5w                   ; cmp leftEdge, viewRight
 *   0001766c   bgt.b   0x176b6                    ; leftEdge > viewRight → miss → next
 *   0001766e   cmpa.w  D2w, A4                    ; cmp viewRight, rightEdge
 *   00017670   bgt.b   0x176b6                    ; viewRight > rightEdge → miss → next
 *
 *   00017672   cmp.w   A1w, D0w                   ; cmp topEdge, viewTop
 *   00017674   bgt.b   0x1767c                    ; topEdge > viewTop → check Y
 *   00017676   cmpa.w  D3w, A1                    ; cmp viewTop, bottomEdge
 *   00017678   ble.w   0x1768a                    ; viewTop <= bottomEdge → OVERLAP!
 *   0001767c   cmp.w   (-0x2, A6), D0w            ; cmp topEdge, viewBottom
 *   00017680   bgt.b   0x176b6                    ; topEdge > viewBottom → miss → next
 *   00017682   move.w  (-0x2, A6), D7w            ; D7w = viewBottom
 *   00017686   cmp.w   D3w, D7w
 *   00017688   bgt.b   0x176b6                    ; viewBottom > bottomEdge → miss → next
 *
 *   ;-- OVERLAP path: bind state + sounds + exit with retval = 1 ---------
 *   0001768a   moveq   #1, D2                     ; D2 = 1 (return value)
 *   0001768c   pea     (0x9).w
 *   00017690   move.l  A2, -(SP)
 *   00017692   jsr     0x00025bae.l               ; FUN_25BAE(objPtr, 9)
 *   00017698   pea     (0x5e).l
 *   0001769e   jsr     0x000158ac.l               ; FUN_158AC(0x5e) — sound
 *   000176a4   move.b  (0x19, A3), (0x58, A2)     ; obj[+0x58] = slot[+0x19]
 *   000176aa   move.b  #0x1c, (0x25, A3)          ; slot[+0x25] = 0x1c
 *   000176b0   lea     (0xc, SP), SP              ; pop 12 byte (3 longs)
 *   000176b4   bra.b   0x176c4                    ; → epilog with D2 = 1
 *
 *   ;-- next_iter @ 0x176b6 ---------------------------------------------
 *   000176b6   moveq   #0x42, D0
 *   000176b8   adda.l  D0, A3                     ; A3 += 0x42
 *   000176ba   addq.b  #1, D1b                    ; counter++
 *   000176bc   cmpi.b  #7, D1b
 *   000176c0   bne.w   0x17612                    ; loop while counter != 7
 *
 *   ;-- epilog @ 0x176c4 ------------------------------------------------
 *   000176c4   move.b  D2b, D0b
 *   000176c6   ext.w   D0w
 *   000176c8   ext.l   D0                          ; D0 = sext_long(D2.b)
 *   000176ca   movem.l (SP)+, { D2 D3 D4 D5 D6 D7 A2 A3 A4 }
 *   000176ce   unlk    A6
 *   000176d0   rts
 *
 *     return 0). Same "discriminator" word of `bbox-hit-test-19d94.ts`
 *   - `*0x400690` (word)  = marble world x.
 *   - `*0x400692` (word)  = marble world y.
 *
 * of `dispatch-strings-17230.ts`, `string-slot-match-1730c.ts`,
 *   - `slot[+0x18]` byte: "active" gate (read; skip if 0)
 *   - `slot[+0x25]` byte: state (write `0x1c` su hit)
 *   - `slot[+0xC..+0xD]` word BE: x position (signed 16-bit)
 *   - `slot[+0x10..+0x11]` word BE: y position (signed 16-bit)
 *   - `slot[+0x3a..+0x3d]` long BE: pointer-to-pointer al bbox struct
 *
 * **Bbox struct** (raggiunto via `slot[+0x3a] → ptrPtr → bboxPtr`):
 *   - `bboxPtr+0x4` byte signed: xMin
 *   - `bboxPtr+0x5` byte signed: yMin
 *   - `bboxPtr+0x6` byte signed: width
 *   - `bboxPtr+0x7` byte signed: height
 *   If `bboxPtr == 0xFFFFFFFF` (sentinel): default (-2,-2,12,12).
 *
 * **Entity arg** (A2 = `objPtr`):
 *   - `obj[+0x58]` byte (out: written to `slot[+0x19]` on hit)
 *
 * **Word semantics**:
 *   - `subq.w`/`addq.w` -> wrap modulo 0x10000.
 *   - `movea.w` with An destination: sign-extension to 32-bit (A4 = sext(D6w),
 *     A1 = sext(memWord)).
 *     identical to a signed 16-bit compare.
 *
 * **Return value** (D0):
 *   - `1` (sign-extended from byte 0x01 -> 0x00000001) on first overlapping slot.
 *
 * **JSR injection**:
 *   - `FUN_00025BAE(objPtr, 9)`: entity state transition. Stubbed with RTS in
 *     parity (TS `subs.entityStateTransition` default no-op).
 *   - `FUN_000158AC(0x5e)`: sound command. Stubbed with RTS in parity (TS
 *     `subs.soundCommand` default no-op).
 *
 * **Side effects** in `state.workRam`:
 *   - For the **first** slot in overlap (early-exit):
 *       1. `obj[+0x58] = slot[+0x19]` (byte)
 *       2. `slot[+0x25] = 0x1c` (byte)
 *
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";

// ─── Globals (offset workRam relativi a 0x400000) ────────────────────────

/** workRam offset of the "game mode" word (absolute = 0x400394). */
export const GAME_MODE_WORD_OFF = 0x394 as const;
/** workRam offset of the marble x-word (absolute = 0x400690). */
export const MARBLE_X_WORD_OFF = 0x690 as const;
/** workRam offset of the marble y-word (absolute = 0x400692). */
export const MARBLE_Y_WORD_OFF = 0x692 as const;

export const REQUIRED_GAME_MODE_A = 0x0002 as const;
export const REQUIRED_GAME_MODE_B = 0x0005 as const;


export const SLOT_BASE_ADDR = 0x00401482 as const;
/** Stride between due slot consecutive (`moveq #0x42, D0`). */
export const SLOT_STRIDE = 0x42 as const;
/** Numero of slot iterate (`cmpi.b #7, D1b`). */
export const SLOT_COUNT = 7 as const;

/** Byte: "active" gate (skip if 0). */
export const SLOT_ACTIVE_OFF = 0x18 as const;
/** Byte: scriptId/index (copiato su `obj[+0x58]` su hit). */
export const SLOT_SCRIPT_ID_OFF = 0x19 as const;
export const SLOT_NEW_STATE_OFF = 0x25 as const;
/** Word BE: slot x position (signed 16-bit). */
export const SLOT_X_OFF = 0x0c as const;
/** Word BE: slot y position (signed 16-bit). */
export const SLOT_Y_OFF = 0x10 as const;
/** Long BE: pointer-to-pointer al bbox struct. */
export const SLOT_BBOX_PTRPTR_OFF = 0x3a as const;

// ─── Bbox struct (raggiunto via deref doppio) ────────────────────────────

/** Sentinel `cmp.l A0, D0` with `D0 = moveq #-1`. */
export const BBOX_SENTINEL = 0xffffffff as const;
/** Offset byte signed in the bbox struct. */
export const BBOX_XMIN_OFF = 4 as const;
export const BBOX_YMIN_OFF = 5 as const;
export const BBOX_WIDTH_OFF = 6 as const;
export const BBOX_HEIGHT_OFF = 7 as const;
/** Defaults used when `bboxPtr == 0xFFFFFFFF`: (-2,-2,12,12). */
export const DEFAULT_XMIN = -2 as const;
export const DEFAULT_YMIN = -2 as const;
export const DEFAULT_WIDTH = 12 as const;
export const DEFAULT_HEIGHT = 12 as const;

// ─── 6×6 Viewport Square Around The Marble ───────────────────────────────

/** `subq.w #3, D6w` (left  = mx - 3). */
export const VIEW_HALF_LEFT = 3 as const;
/** `addq.w #6, A4` (right = (mx-3) + 6 = mx + 3). */
export const VIEW_X_SPAN = 6 as const;
/** `subq.w #3, A1` (top   = my - 3). */
export const VIEW_HALF_TOP = 3 as const;
/** `addq.w #6, locVar` (bottom = (my-3) + 6 = my + 3). */
export const VIEW_Y_SPAN = 6 as const;


export const HIT_SLOT_NEW_STATE = 0x1c as const;
/** Entity offset (A2): "scriptId" byte written on hit. */
export const ENTITY_SCRIPT_ID_OFF = 0x58 as const;

/** Arg long pushed to `FUN_25BAE` as second arg (`pea (0x9).w`). */
export const FUN_25BAE_ARG_MODE = 0x9 as const;
/** Arg long pushato a `FUN_158AC` (`pea (0x5e).l`). */
export const SOUND_HIT_COMMAND = 0x5e as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 *   - `FUN_00025BAE(objPtr, mode=9)` → entity state-transition (modifies
 *   - `FUN_000158AC(cmd=0x5e)` -> sound command sender. Stubbed with RTS
 *     in the parity → TS no-op.
 *
 */
export interface StringViewportHit175C8Subs {
  /**
   * `FUN_00025BAE`: entity state-transition. Args: `objPtr` (long), `mode`
   */
  entityStateTransition?: (objPtr: number, mode: number) => void;
  /**
   * Default no-op.
   */
  soundCommand?: (cmd: number) => void;
}


export type SlotResult = "skip_inactive" | "miss" | "hit" | "skipped_after_hit";

export interface StringViewportHit175C8Result {
  earlyExit: boolean;
  /**
   *  hit avviene to the slot `i`, the slot `i+1..6` ricevono `skipped_after_hit`. */
  perSlot: SlotResult[];
  hitSlotIndex: number;
  retVal: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Base of the work RAM (0x400000..0x401FFF, 8 KB). */
const WORK_RAM_BASE = 0x400000;
/** End of the work RAM (exclusive). */
const WORK_RAM_END = 0x402000;

function rb(state: GameState, addr: number): number {
  const off = (addr >>> 0) - WORK_RAM_BASE;
  if (off < 0 || off >= WORK_RAM_END - WORK_RAM_BASE) return 0;
  return (state.workRam[off] ?? 0) & 0xff;
}

function rwU(state: GameState, addr: number): number {
  return ((rb(state, addr) << 8) | rb(state, addr + 1)) >>> 0;
}

function rlU(state: GameState, addr: number): number {
  return (
    (((rb(state, addr) << 24) >>> 0) |
      (rb(state, addr + 1) << 16) |
      (rb(state, addr + 2) << 8) |
      rb(state, addr + 3)) >>>
    0
  );
}

function rbAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return rb(state, a);
  if (rom !== undefined && a < rom.program.length) return rom.program[a] ?? 0;
  return 0;
}

function rlAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  return (
    (((rbAbs(state, rom, addr) << 24) >>> 0) |
      (rbAbs(state, rom, addr + 1) << 16) |
      (rbAbs(state, rom, addr + 2) << 8) |
      rbAbs(state, rom, addr + 3)) >>>
    0
  );
}

function wb(state: GameState, addr: number, v: number): void {
  const off = (addr >>> 0) - WORK_RAM_BASE;
  if (off < 0 || off >= WORK_RAM_END - WORK_RAM_BASE) return;
  state.workRam[off] = v & 0xff;
}

/** Sign-extend byte (0..255) → JS signed int (−128..127). */
function sextB(b: number): number {
  const v = b & 0xff;
  return v & 0x80 ? v - 0x100 : v;
}

/** Sign-extend 16-bit (0..65535) → JS signed int (−32768..32767). */
function sextW(w: number): number {
  const v = w & 0xffff;
  return v & 0x8000 ? v - 0x10000 : v;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 *
 * Iterates the 7 string-slots @ `SLOT_BASE_ADDR` (stride `SLOT_STRIDE`) and,
 * on overlap with viewport words `(marble ± 3, marble ± 3)`, marks obj/slot,
 * triggers entity-transition + sound, and returns `1`. Without
 *
 *
 * @param state         GameState. Reads: `workRam[0x394..0x395]`,
 *                      ptr+ptr+bbox chain in workRam/ROM (with bounds check).
 *                      Writes (on first overlap):
 *                        - `obj[+0x58] = slot[+0x19]`
 *                        - `slot[+0x25] = 0x1c`
 * @param subs          Injection for `FUN_25BAE` and `FUN_158AC`. Default no-op.
 *                      — consistent with the parity test calling `setRegister("d2", 0)`.
 *
 * @returns per-slot details + early-exit + hit index + D0 retVal.
 *
 *   1. `subs.entityStateTransition(objPtr, 9)`
 *   2. `subs.soundCommand(0x5e)`
 *   3. `obj[+0x58] = slot[+0x19]`
 *   4. `slot[+0x25] = 0x1c`
 *   Poi early-exit (slot successivi non visitati).
 */
export function stringViewportHit175C8(
  state: GameState,
  objAddr: number,
  subs?: StringViewportHit175C8Subs,
  initialD2Byte: number = 0,
  rom?: RomImage,
): StringViewportHit175C8Result {
  // ─── Game-mode gate: state ∈ {2, 5} ────────────────────────────────────
  // moveq #2,D0; cmp.w mem.w; beq enter.
  // moveq #5,D0; cmp.w mem.w; beq enter.
  // else: D0 = 0; bra epilog (return 0).
  const gameMode = rwU(state, WORK_RAM_BASE + GAME_MODE_WORD_OFF);
  if (gameMode !== REQUIRED_GAME_MODE_A && gameMode !== REQUIRED_GAME_MODE_B) {
    return { earlyExit: true, perSlot: [], hitSlotIndex: -1, retVal: 0 };
  }

  // ─── Viewport (signed word) around the marble ──────────────────────────
  // D6w = mx - 3 = viewLeft;  A4 = sext(D6w) + 6 = viewRight (long signed).
  // A1 = sext(my) - 3 = viewTop (long); locVar = (A1.w & 0xffff) + 6.
  // Operationally equivalent to signed 16-bit comparisons.
  const marbleX = sextW(rwU(state, WORK_RAM_BASE + MARBLE_X_WORD_OFF));
  const marbleY = sextW(rwU(state, WORK_RAM_BASE + MARBLE_Y_WORD_OFF));
  // viewLeft  = (mx - 3) wrap word, viewRight  = viewLeft + 6 wrap word.
  const viewLeft16 = (marbleX - VIEW_HALF_LEFT) & 0xffff;
  const viewLeft = sextW(viewLeft16);
  const viewRight = sextW((viewLeft16 + VIEW_X_SPAN) & 0xffff);
  // viewTop   = (my - 3) wrap word, viewBottom = viewTop  + 6 wrap word.
  const viewTop16 = (marbleY - VIEW_HALF_TOP) & 0xffff;
  const viewTop = sextW(viewTop16);
  const viewBottom = sextW((viewTop16 + VIEW_Y_SPAN) & 0xffff);

  // ─── Loop sui 7 slot ────────────────────────────────────────────────────
  const perSlot: SlotResult[] = [];
  // (low byte of width + leftEdge sext word). Sul hit-path: D2 = 1.
  let d2Byte = initialD2Byte & 0xff;
  let hitIndex = -1;

  for (let i = 0; i < SLOT_COUNT; i++) {
    if (hitIndex !== -1) {
      perSlot.push("skipped_after_hit");
      continue;
    }
    const slotAddr = (SLOT_BASE_ADDR + i * SLOT_STRIDE) >>> 0;

    // tst.b (0x18, A3); beq.w next_iter
    if (rb(state, slotAddr + SLOT_ACTIVE_OFF) === 0) {
      perSlot.push("skip_inactive");
      continue;
    }

    // ─── Resolve bbox via deref doppio ───────────────────────────────────
    // movea.l (0x3a, A3), A0  ; movea.l (A0), A0
    const bboxPtrPtr = rlU(state, slotAddr + SLOT_BBOX_PTRPTR_OFF);
    const bboxPtr = rlAbs(state, rom, bboxPtrPtr);

    let xMin: number;
    let yMin: number;
    let width: number;
    let height: number;
    if (bboxPtr === BBOX_SENTINEL) {
      // moveq #-2,D2; move.w D2w,D3w; moveq #0xC,D0; move.w D0w,D4w
      // ⇒ xMin=-2, yMin=-2, width=12, height=12 (signed long).
      xMin = DEFAULT_XMIN;
      yMin = DEFAULT_YMIN;
      width = DEFAULT_WIDTH;
      height = DEFAULT_HEIGHT;
    } else {
      // 4 byte signed @ bboxPtr+4..+7
      xMin = sextB(rbAbs(state, rom, bboxPtr + BBOX_XMIN_OFF));
      yMin = sextB(rbAbs(state, rom, bboxPtr + BBOX_YMIN_OFF));
      width = sextB(rbAbs(state, rom, bboxPtr + BBOX_WIDTH_OFF));
      height = sextB(rbAbs(state, rom, bboxPtr + BBOX_HEIGHT_OFF));
    }

    // ─── computeBbox (word arithmetic, signed) ───────────────────────────
    // D5w = slot.x + xMin = leftEdge
    // D2w = width + leftEdge = rightEdge   (D2 modified -> D2.b changes)
    // D0w = slot.y + yMin = topEdge
    // D3w = height + topEdge = bottomEdge
    const slotX = sextW(rwU(state, slotAddr + SLOT_X_OFF));
    const slotY = sextW(rwU(state, slotAddr + SLOT_Y_OFF));
    const leftEdge16 = (slotX + xMin) & 0xffff;
    const leftEdge = sextW(leftEdge16);
    const rightEdge16 = (width + leftEdge16) & 0xffff;
    const rightEdge = sextW(rightEdge16);
    const topEdge16 = (slotY + yMin) & 0xffff;
    const topEdge = sextW(topEdge16);
    const bottomEdge16 = (height + topEdge16) & 0xffff;
    const bottomEdge = sextW(bottomEdge16);

    d2Byte = rightEdge16 & 0xff;

    // ─── Overlap test X-axis (signed word) ──────────────────────────────
    //   cmp.w D6w,D5w; bgt 0x1766a    (leftEdge > viewLeft → block2)
    //   cmp.w D2w,D6w; ble 0x17672    (viewLeft <= rightEdge → X-overlap)
    //   ;-- block2 (0x1766a):
    //   cmp.w A4w,D5w; bgt next       (leftEdge > viewRight → miss)
    //   cmpa.w D2w,A4; bgt next       (viewRight > rightEdge → miss)
    //   ;-- 0x17672 = X-overlap, fall through to Y-test
    let xMatch = false;
    if (leftEdge <= viewLeft && viewLeft <= rightEdge) {
      xMatch = true;
    } else {
      // block2: tenta path alternativo
      if (leftEdge > viewRight) { perSlot.push("miss"); continue; }
      if (viewRight > rightEdge) { perSlot.push("miss"); continue; }
      xMatch = true;
    }
    if (!xMatch) { perSlot.push("miss"); continue; }

    // ─── Overlap test Y-axis (same structure) ───────────────────────────
    //   cmp.w A1w,D0w; bgt 0x1767c    (topEdge > viewTop → block2)
    //   cmpa.w D3w,A1; ble 0x1768a    (viewTop <= bottomEdge → HIT)
    //   ;-- block2 (0x1767c):
    //   cmp.w (-2,A6),D0w; bgt next   (topEdge > viewBottom → miss)
    //   move.w (-2,A6),D7w; cmp.w D3w,D7w; bgt next  (viewBottom > bottomEdge → miss)
    //   ;-- 0x1768a = Y-overlap → HIT
    let yMatch = false;
    if (topEdge <= viewTop && viewTop <= bottomEdge) {
      yMatch = true;
    } else {
      if (topEdge > viewBottom) { perSlot.push("miss"); continue; }
      if (viewBottom > bottomEdge) { perSlot.push("miss"); continue; }
      yMatch = true;
    }
    if (!yMatch) { perSlot.push("miss"); continue; }

    d2Byte = 0x01; // moveq #1, D2

    // 1. FUN_25BAE(objPtr, 9)
    subs?.entityStateTransition?.(objAddr >>> 0, FUN_25BAE_ARG_MODE);

    // 2. FUN_158AC(0x5e)
    subs?.soundCommand?.(SOUND_HIT_COMMAND);

    // 3. obj[+0x58] = slot[+0x19]
    const scriptId = rb(state, slotAddr + SLOT_SCRIPT_ID_OFF);
    wb(state, objAddr + ENTITY_SCRIPT_ID_OFF, scriptId);

    // 4. slot[+0x25] = 0x1c
    wb(state, slotAddr + SLOT_NEW_STATE_OFF, HIT_SLOT_NEW_STATE);

    // bra.b 0x176c4 → epilog with D2 = 1
    perSlot.push("hit");
    hitIndex = i;
  }

  // ─── Epilog ────────────────────────────────────────────────────────────
  // `move.b D2b, D0b; ext.w D0w; ext.l D0` → D0 = sext_long(D2.b).
  const retSigned = sextB(d2Byte);
  const retLong = (retSigned < 0 ? retSigned + 0x100000000 : retSigned) >>> 0;
  return {
    earlyExit: false,
    perSlot,
    hitSlotIndex: hitIndex,
    retVal: retLong,
  };
}
