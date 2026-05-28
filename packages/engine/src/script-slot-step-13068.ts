/**
 * script-slot-step-13068.ts — replica `FUN_00013068` (~400 byte,
 * 0x13068..0x132DE).
 *
 * Runs once per slot at `0x400a9c + i*0x56`.
 *
 *
 *
 *      Resets and advances pointers `[0x40044a]`, `[0x40044e]`, `[0x400452]`.
 *
 *   3. **Dispatch on `slot[0x1a]` (0..4)**:
 *      - **case 3**: reset slot `[0x3e]=0x20c14`, `[0x46]=0x20c14`,
 *      - **case 4**: `slot[0x3e] = 0x20c14`; D2=1.
 *      - **case 0**: decrements `slot[0x1c].w`; if it reaches 0 and
 *        `slot[0x18]==1`, calls `fun12896(slotPtr)`; then D2=1.
 *      - **case 1**: increments `slot[0x20]` when `slot[0x21]!=0`.
 *      - **case 2**: similar to case 1, but uses `slot[0x22]/[0x23]`.
 *
 *
 *   5. **Closeout**: if `slot[0x1e]!=1` and D2!=0, calls `FUN_13334(slotPtr)`.
 *
 * **Helper interno `FUN_132E0`** (0x132e0..0x13332 = 82 byte):
 *   Advances `slot[0x3e]` by +4, with an extra +4 when `slot[0x1e]!=0`.
 *
 * **Sub esterne**:
 *     Riceve (state, slotPtr).
 *   - `FUN_13334`: replicata come `objectRenderUpdate13334` in
 *     `advanceAndWrap132E0`.
 *
 * **Disasm** (estratto chiave da 0x13068..0x132DE):
 *
 *   00013068  movem.l {A5,A4,A3,A2,D4,D3,D2},-(SP)
 *   0001306c  movea.l (0x20,SP),A2          ; A2 = slotPtr
 *   00013070  movea.l #0x400456,A3          ; A3 = &timer456
 *   00013076  movea.l #0x40044a,A1          ; A1 = &ptr44a
 *   0001307c  movea.l #0x12896,A4           ; A4 = FUN_12896
 *   00013082  tst.b   (0x18,A2)             ; active?
 *   00013086  beq.w   0x132da               ; no → epilogue
 *   0001308a  move.b  (0x1a,A2),D3b         ; D3b = slot[0x1a] (initial)
 *   0001308e  clr.b   D2b                   ; D2b = 0
 *   00013090  cmpi.b  #3,(0x1f,A2)          ; slot[0x1f] == 3?
 *   00013096  bne.w   0x13142               ; no → dispatch
 *   (...block kind==3 updates globals...)
 *   00013142  ...dispatch on slot[0x1a]...
 *   ...
 *   000132da  movem.l (SP)+,...; rts
 *
 * Parity test: `cli/src/test-script-slot-step-13068-parity.ts` (500/500).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { objectRenderUpdate13334 } from "./object-render-update-13334.js";

// ─── Base ─────────────────────────────────────────────────────────────────

const WRAM = 0x00400000 as const;
const WRAM_END = 0x00402000 as const;

// ─── Absolute Address Constants ────────────────────────────────────────────

/** Absolute address of this function in ROM. */
export const SCRIPT_SLOT_STEP_13068_ADDR = 0x00013068 as const;

/** Byte @ 0x400456: countdown timer / reload for ptr44a. */
const ADDR_TIMER_456 = 0x00400456 as const;
/** Long @ 0x40044a: ROM pointer for animation sequence A. */
const ADDR_PTR_44A = 0x0040044a as const;
/** Long @ 0x40044e: ROM pointer for animation sequence B. */
const ADDR_PTR_44E = 0x0040044e as const;
/** Long @ 0x400452: ROM pointer for animation sequence C. */
const ADDR_PTR_452 = 0x00400452 as const;
/** Byte @ 0x400458: countdown timer for ptr44e. */
const ADDR_TIMER_458 = 0x00400458 as const;
/** Byte @ 0x40045a: countdown timer for ptr452. */
const ADDR_TIMER_45A = 0x0040045a as const;
/** Word @ 0x40045c: intermediate result for case-2 path (slot[0x1f]==0x19). */
const ADDR_WORD_45C = 0x0040045c as const;
/** Byte @ 0x40075e: scripting-trigger-enable flag. */
const ADDR_FLAG_75E = 0x0040075e as const;

// Timer/ptr reset constants (ROM sequence pointers)
const PTR_44A_A = 0x0002121e as const; // ptr44a reset A (if prev == 0x211f2)
const PTR_44A_B = 0x000211fe as const; // ptr44a reset B
const PTR_44A_SENTINEL = 0x000211f2 as const; // sentinel for prev entry check
const PTR_44E_RESET = 0x0002126e as const;
const PTR_452_RESET = 0x000212b2 as const;
const TIMER_456_RELOAD_A = 0x0f as const; // reload when prev == PTR_44A_SENTINEL
const TIMER_456_RELOAD_B = 0x1e as const;
const TIMER_458_RELOAD = 3 as const;
const TIMER_45A_RELOAD = 3 as const;

// Dispatch case constants
const SLOT_3E_INIT = 0x00020c14 as const; // initial ROM ptr loaded in case 3 / 4

// Tombstone sentinel
const TOMBSTONE = 0xffffffff as const;

// ─── Slot Offsets (relative to slotPtr) ────────────────────────────────────

const OFF_W0 = 0x00; // long @ +0x00 (velocity X or anim step)
const OFF_W2 = 0x04; // long @ +0x04 (velocity Y or anim step)
const OFF_POS_X = 0x0c; // long @ +0x0c (position X)
const OFF_POS_Y = 0x10; // long @ +0x10 (position Y)
const OFF_TIMER16 = 0x1c; // word @ +0x1c (frame countdown timer)
const OFF_ACTIVE = 0x18; // byte @ +0x18 (slot active flag)
const OFF_STATE = 0x1a; // byte @ +0x1a (dispatch state / case index 0..4)
const OFF_MODE = 0x1e; // byte @ +0x1e (mode byte for render-update-13334)
const OFF_KIND = 0x1f; // byte @ +0x1f (kind: 3 = animseq driven)
const OFF_CTR_A = 0x20; // byte @ +0x20 (frame counter for case 1)
const OFF_LIM_A = 0x21; // byte @ +0x21 (frame limit for case 1)
const OFF_CTR_B = 0x22; // byte @ +0x22 (frame counter for case 2)
const OFF_LIM_B = 0x23; // byte @ +0x23 (frame limit for case 2)
const OFF_ANIM_IDX = 0x25; // byte @ +0x25 (anim index for kind==6/case-2)
const OFF_COPY = 0x36; // long @ +0x36 (← slot[0x3a] in case 3)
const OFF_SRC = 0x3a; // long @ +0x3a (source copy for case 3)
const OFF_REC_PTR = 0x3e; // long @ +0x3e (current ROM record ptr)
// OFF_FINAL = 0x42 — written by FUN_13334 (objectRenderUpdate13334), not directly here
const OFF_BASE_PTR = 0x46; // long @ +0x46 (base ROM ptr, reset target for 1a==2)
const OFF_ALT_PTR = 0x4a; // long @ +0x4a (alt ROM ptr, reset target otherwise)


function rb(state: GameState, addr: number): number {
  const off = (addr - WRAM) >>> 0;
  return (state.workRam[off] ?? 0) & 0xff;
}

function rw(state: GameState, addr: number): number {
  const off = (addr - WRAM) >>> 0;
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function rl(state: GameState, addr: number): number {
  const off = (addr - WRAM) >>> 0;
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function wb(state: GameState, addr: number, v: number): void {
  state.workRam[(addr - WRAM) >>> 0] = v & 0xff;
}

function ww(state: GameState, addr: number, v: number): void {
  const off = (addr - WRAM) >>> 0;
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function wl(state: GameState, addr: number, v: number): void {
  const off = (addr - WRAM) >>> 0;
  const u = v >>> 0;
  state.workRam[off] = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8) & 0xff;
  state.workRam[off + 3] = u & 0xff;
}

/** Read slot byte at offset `off` from slotPtr (absolute workRam addr). */
function sb(state: GameState, slotPtr: number, off: number): number {
  return rb(state, slotPtr + off);
}

/** Write slot byte. */
function swb(state: GameState, slotPtr: number, off: number, v: number): void {
  wb(state, slotPtr + off, v);
}

/** Read slot word (big-endian). */
function sw(state: GameState, slotPtr: number, off: number): number {
  return rw(state, slotPtr + off);
}

/** Write slot word. */
function sww(state: GameState, slotPtr: number, off: number, v: number): void {
  ww(state, slotPtr + off, v);
}

/** Read slot long (big-endian). */
function sl(state: GameState, slotPtr: number, off: number): number {
  return rl(state, slotPtr + off);
}

/** Write slot long. */
function swl(state: GameState, slotPtr: number, off: number, v: number): void {
  wl(state, slotPtr + off, v);
}

/**
 * Dereference a 32-bit pointer that may live in ROM or work RAM.
 * Returns the 32-bit value at the address, or 0 if out of range.
 */
function derefLong(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WRAM && a + 3 < WRAM_END) {
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

// ─── Subs interface ───────────────────────────────────────────────────────

/**
 * Callback injection for `FUN_00013068`.
 *
 * The only non-replicated JSR is `FUN_12896`, loaded into A4 at the start
 * and called with the slot pointer as the single long argument.
 * Default is no-op when not injected.
 */
export interface ScriptSlotStep13068Subs {
  /**
   * `FUN_00012896(slotPtr)` — slot state update / re-init.
   * Not yet replicated in TS. Default: no-op.
   */
  fun12896?: (state: GameState, slotPtr: number) => void;
  /**
   * `inner1D06A` passed through to `objectRenderUpdate13334` when called
   * from this function. Default: no-op.
   */
  inner1D06A?: (paletteByteSigned: number) => void;
}

// ─── Helper: FUN_132E0 ────────────────────────────────────────────────────

/**
 * Replica of `FUN_132E0` (0x132e0..0x13332, 82 bytes).
 *
 *   2. If `*slot[0x3e] == 0xFFFFFFFF` (tombstone):
 *      - Reset `slot[0x3e]` to `slot[0x46]` (if `slot[0x1a]==2`) or
 *
 * @returns  1 if tombstone hit with slot[0x1c] == 0 post-decrement, 0 otherwise.
 */
function advanceAndWrap132E0(
  state: GameState,
  rom: RomImage,
  slotPtr: number,
): number {
  // addq.l 0x4,(0x3e,A0)
  let recPtr = (sl(state, slotPtr, OFF_REC_PTR) + 4) >>> 0;
  swl(state, slotPtr, OFF_REC_PTR, recPtr);

  // tst.b (0x1e,A0) ; beq skip ; addq.l 0x4,(0x3e,A0)
  if (sb(state, slotPtr, OFF_MODE) !== 0) {
    recPtr = (recPtr + 4) >>> 0;
    swl(state, slotPtr, OFF_REC_PTR, recPtr);
  }

  // clr.b D1b (default return 0)
  let d1 = 0;

  // movea.l (0x3e,A0),A1 ; moveq -1,D0 ; cmp.l (A1),D0
  const dereffed = derefLong(state, rom, recPtr);
  if (dereffed !== TOMBSTONE) {
    // bne.b 0x1332c → done
    // move.b D1b, D0b ; ext.w ; ext.l ; rts
    return 0;
  }

  // Tombstone hit:
  // moveq 0x1, D1
  d1 = 1;

  // cmpi.b #2,(0x1a,A0) ; bne 0x13310
  const state1a = sb(state, slotPtr, OFF_STATE);
  if (state1a === 2) {
    // move.l (0x46,A0),(0x3e,A0)
    swl(state, slotPtr, OFF_REC_PTR, sl(state, slotPtr, OFF_BASE_PTR));
  } else {
    // move.l (0x4a,A0),(0x3e,A0)
    swl(state, slotPtr, OFF_REC_PTR, sl(state, slotPtr, OFF_ALT_PTR));
  }

  // tst.w (0x1c,A0) ; beq 0x1332a (clr D1; bra done)
  const timer16 = sw(state, slotPtr, OFF_TIMER16);
  if (timer16 === 0) {
    // clr.b D1b → 0
    d1 = 0;
  } else {
    // subq.w 0x1,(0x1c,A0)
    const newTimer = (timer16 - 1) & 0xffff;
    sww(state, slotPtr, OFF_TIMER16, newTimer);
    // tst.w (0x1c,A0) ; beq 0x1332c (keep D1=1)
    if (newTimer === 0) {
      // D1 stays 1 → return 1
      d1 = 1;
    } else {
      // clr.b D1b → 0
      d1 = 0;
    }
  }

  return d1;
}

// ─── Main implementation ──────────────────────────────────────────────────

/**
 *
 * @param state    GameState. Modifica workRam (slot fields, globals 0x400456 etc.).
 * @param rom      ROM image (per dereferenziare record ptr ROM-side).
 * @param slotPtr  Absolute workRam address of the script-state slot
 *                 (0x400a9c + i*0x56, i ∈ 0..24).
 * @param subs     Stub injection per `FUN_12896` (e `inner1D06A` passthrough).
 */
export function scriptSlotStep13068(
  state: GameState,
  rom: RomImage,
  slotPtr: number,
  subs?: ScriptSlotStep13068Subs,
): void {
  const sp = slotPtr >>> 0;

  //
  // tst.b (0x18,A2) ; beq.w epilogue
  if (sb(state, sp, OFF_ACTIVE) === 0) {
    return;
  }

  // D3b = slot[0x1a] (initial state for re-dispatch detection)
  // D2b = 0 (D2b will be set to 1 by certain paths to trigger FUN_13334 at end)
  let d3b = sb(state, sp, OFF_STATE);
  let d2b = 0;

  // ── Block kind==3 (slot[0x1f]==3): update three global timers/ptrs ─────
  //
  // cmpi.b #3,(0x1f,A2) ; bne.w dispatch
  if (sb(state, sp, OFF_KIND) === 3) {
    // --- Timer 456 / ptr44a ---
    //
    // A3 = 0x400456, A1 = 0x40044a
    // subq.b 0x1,(A3)
    {
      let t456 = (rb(state, ADDR_TIMER_456) - 1) & 0xff;
      wb(state, ADDR_TIMER_456, t456);
      // tst.b (A3) ; bne.b 0x130d6
      if (t456 === 0) {
        // move.b #2,(A3)
        wb(state, ADDR_TIMER_456, 2);

        // addq.l 0x4,(A1)
        let ptr44a = (rl(state, ADDR_PTR_44A) + 4) >>> 0;
        wl(state, ADDR_PTR_44A, ptr44a);

        // move.l (A1),D1 ; moveq -1,D0 ; exg D1,A5 ; cmp.l (A5),D0 ; exg D1,A5
        // → checks *ptr44a == -1 (tombstone)?
        const deref44a = derefLong(state, rom, ptr44a);
        if (deref44a === TOMBSTONE) {
          // move.l #0x211f2,D0 ; movea.l (A1),A0 ; subq.l 0x4,A0
          // cmp.l (A0),D0 ; bne 0x130cc
          const prev44a = derefLong(state, rom, (ptr44a - 4) >>> 0);
          if (prev44a === PTR_44A_SENTINEL) {
            // move.l #0x2121e,(A1) ; addi.b #0xf,(A3)
            wl(state, ADDR_PTR_44A, PTR_44A_A);
            t456 = (rb(state, ADDR_TIMER_456) + TIMER_456_RELOAD_A) & 0xff;
            wb(state, ADDR_TIMER_456, t456);
          } else {
            // move.l #0x211fe,(A1) ; addi.b #0x1e,(A3)
            wl(state, ADDR_PTR_44A, PTR_44A_B);
            t456 = (rb(state, ADDR_TIMER_456) + TIMER_456_RELOAD_B) & 0xff;
            wb(state, ADDR_TIMER_456, t456);
          }
        }
      }
    }

    // --- Timer 458 / ptr44e ---
    //
    // subq.b 0x1,(0x400458) ; tst.b ; bne.b 0x1310c
    {
      let t458 = (rb(state, ADDR_TIMER_458) - 1) & 0xff;
      wb(state, ADDR_TIMER_458, t458);
      if (t458 === 0) {
        // move.b #3,(0x400458)
        wb(state, ADDR_TIMER_458, TIMER_458_RELOAD);

        // addq.l 0x4,(0x40044e)
        let ptr44e = (rl(state, ADDR_PTR_44E) + 4) >>> 0;
        wl(state, ADDR_PTR_44E, ptr44e);

        // check tombstone at *ptr44e
        const deref44e = derefLong(state, rom, ptr44e);
        if (deref44e === TOMBSTONE) {
          // move.l #0x2126e,(0x40044e)
          wl(state, ADDR_PTR_44E, PTR_44E_RESET);
        }
      }
    }

    // --- Timer 45a / ptr452 ---
    //
    // subq.b 0x1,(0x40045a) ; tst.b ; bne.b dispatch
    {
      let t45a = (rb(state, ADDR_TIMER_45A) - 1) & 0xff;
      wb(state, ADDR_TIMER_45A, t45a);
      if (t45a === 0) {
        // move.b #3,(0x40045a)
        wb(state, ADDR_TIMER_45A, TIMER_45A_RELOAD);

        // addq.l 0x4,(0x400452)
        let ptr452 = (rl(state, ADDR_PTR_452) + 4) >>> 0;
        wl(state, ADDR_PTR_452, ptr452);

        // check tombstone
        const deref452 = derefLong(state, rom, ptr452);
        if (deref452 === TOMBSTONE) {
          // move.l #0x212b2,(0x400452)
          wl(state, ADDR_PTR_452, PTR_452_RESET);
        }
      }
    }
  }
  // ── Dispatch on slot[0x1a] ────────────────────────────────────────────

  // 0x13142: move.b (0x1a,A2),D0b ; ext.w ; ext.l → D0 = sext(slot[0x1a])
  // bounds check: 0..4 → blt / bgt 0x132a8
  dispatchLoop: for (;;) {
    const caseVal = sb(state, sp, OFF_STATE);

    // cmpa.w #0,A5 (where A5=D0) ; blt 0x132a8
    // cmpa.w #4,A5 ; bgt 0x132a8
    if (caseVal > 4) {
      // out of range → jump to post-dispatch (same as no-op from dispatch)
      break dispatchLoop;
    }

    // Dispatch table @ 0x13176:
    //   case 0 → 0x131a4
    //   case 1 → 0x131d6
    //   case 2 → 0x13224
    //   case 3 → 0x13180
    //   case 4 → 0x131c8
    switch (caseVal) {
      case 3: {
        // ── Case 3 (0x13180) ─────────────────────────────────────────────
        //
        // move.l (0x3a,A2),(0x36,A2)   ; slot[0x36] = slot[0x3a]
        swl(state, sp, OFF_COPY, sl(state, sp, OFF_SRC));
        // move.l #0x20c14,D0
        // move.l D0,(0x4a,A2)          ; slot[0x4a] = 0x20c14
        swl(state, sp, OFF_ALT_PTR, SLOT_3E_INIT);
        // movea.l D0,A0 ; move.l A0,(0x46,A2) ; move.l A0,(0x3e,A2)
        swl(state, sp, OFF_BASE_PTR, SLOT_3E_INIT);
        swl(state, sp, OFF_REC_PTR, SLOT_3E_INIT);
        // move.l A2,-(SP) ; jsr (A4) ; addq.l 0x4,SP
        subs?.fun12896?.(state, sp);
        // bra.w 0x132a8
        break dispatchLoop;
      }

      case 4: {
        // ── Case 4 (0x131c8) ─────────────────────────────────────────────
        //
        // move.l #0x20c14,(0x3e,A2)
        swl(state, sp, OFF_REC_PTR, SLOT_3E_INIT);
        // moveq 0x1,D2
        d2b = 1;
        // bra.w 0x132a8
        break dispatchLoop;
      }

      case 0: {
        // ── Case 0 (0x131a4) ─────────────────────────────────────────────
        //
        // tst.w (0x1c,A2) ; beq 0x131c2
        if (sw(state, sp, OFF_TIMER16) !== 0) {
          // subq.w 0x1,(0x1c,A2)
          sww(state, sp, OFF_TIMER16, (sw(state, sp, OFF_TIMER16) - 1) & 0xffff);
          // tst.w (0x1c,A2) ; bne 0x131c2
          if (sw(state, sp, OFF_TIMER16) === 0) {
            // cmpi.b #1,(0x18,A2) ; bne 0x131c2
            if (sb(state, sp, OFF_ACTIVE) === 1) {
              // move.l A2,-(SP) ; jsr (A4) ; addq.l 0x4,SP
              subs?.fun12896?.(state, sp);
            }
          }
        }
        // 0x131c2: moveq 0x1,D2
        d2b = 1;
        // bra.w 0x132a8
        break dispatchLoop;
      }

      case 1: {
        // ── Case 1 (0x131d6) ─────────────────────────────────────────────
        //
        // tst.b (0x21,A2) ; beq 0x131e0
        if (sb(state, sp, OFF_LIM_A) !== 0) {
          // addq.b 0x1,(0x20,A2)
          swb(state, sp, OFF_CTR_A, (sb(state, sp, OFF_CTR_A) + 1) & 0xff);
        }
        // move.b (0x21,A2),D0b ; cmp.b (0x20,A2),D0b ; bne 0x1321e
        if (sb(state, sp, OFF_LIM_A) !== sb(state, sp, OFF_CTR_A)) {
          // 0x1321e: moveq 0x1,D2 ; bra 0x132a8
          d2b = 1;
          break dispatchLoop;
        }
        // clr.b (0x20,A2)
        swb(state, sp, OFF_CTR_A, 0);
        // move.l (A2),D0 ; add.l D0,(0xc,A2)
        swl(state, sp, OFF_POS_X, (sl(state, sp, OFF_POS_X) + sl(state, sp, OFF_W0)) >>> 0);
        // move.l (0x4,A2),D0 ; add.l D0,(0x10,A2)
        swl(state, sp, OFF_POS_Y, (sl(state, sp, OFF_POS_Y) + sl(state, sp, OFF_W2)) >>> 0);
        // move.l A2,-(SP) ; jsr 0x13334
        objectRenderUpdate13334(state, rom, sp, {
          inner1D06A: subs?.inner1D06A ?? ((_b: number): void => undefined),
        });
        // move.l A2,-(SP) ; jsr 0x132e0
        {
          const r = advanceAndWrap132E0(state, rom, sp);
          // tst.l D0 ; addq.l 0x8,SP ; beq 0x132a8
          if (r !== 0) {
            // move.l A2,-(SP) ; jsr (A4) ; addq.l 0x4,SP
            subs?.fun12896?.(state, sp);
          }
        }
        // bra.w 0x132a8
        break dispatchLoop;
      }

      case 2: {
        // ── Case 2 (0x13224) ─────────────────────────────────────────────
        //
        // tst.b (0x23,A2) ; beq 0x1322e
        if (sb(state, sp, OFF_LIM_B) !== 0) {
          // addq.b 0x1,(0x22,A2)
          swb(state, sp, OFF_CTR_B, (sb(state, sp, OFF_CTR_B) + 1) & 0xff);
        }
        // move.b (0x23,A2),D0b ; cmp.b (0x22,A2),D0b ; bne 0x132a6
        if (sb(state, sp, OFF_LIM_B) !== sb(state, sp, OFF_CTR_B)) {
          // 0x132a6: moveq 0x1,D2 ; (falls to 0x132a8)
          d2b = 1;
          break dispatchLoop;
        }
        // clr.b (0x22,A2)
        swb(state, sp, OFF_CTR_B, 0);

        // cmpi.b #6,(0x1f,A2) ; bne 0x1325a
        if (sb(state, sp, OFF_KIND) === 6) {
          // addq.b 0x1,(0x25,A2)
          swb(state, sp, OFF_ANIM_IDX, (sb(state, sp, OFF_ANIM_IDX) + 1) & 0xff);
          // cmpi.b #0x1e,(0x25,A2) ; bne 0x1325a
          if (sb(state, sp, OFF_ANIM_IDX) === 0x1e) {
            // move.b #1,(0x40075e)
            wb(state, ADDR_FLAG_75E, 1);
          }
        }

        // 0x1325a: cmpi.b #0x19,(0x1f,A2) ; bne 0x13288
        if (sb(state, sp, OFF_KIND) === 0x19) {
          // move.l (0x3e,A2),D0 ; sub.l (0x46,A2),D0 ; lsr.l #2 ; move.l D0,D4 ; lsr.l #1,D4
          const recPtrNow = sl(state, sp, OFF_REC_PTR);
          const basePtrNow = sl(state, sp, OFF_BASE_PTR);
          const diff = ((recPtrNow - basePtrNow) >>> 0) >>> 3; // >>2 then >>1 = >>3
          // movea.l D4,A0 ; move.w A0w,(0x40045c)
          const d4w = diff & 0xffff;
          ww(state, ADDR_WORD_45C, d4w);
          // move.w (0x40045c),D0w ; muls.w #0x90,D0 ; move.w D0w,(0x40045c)
          const d0w = rw(state, ADDR_WORD_45C);
          // muls.w #0x90 = signed multiply 16-bit
          const mulResult = (((d0w << 16) >> 16) * 0x90) & 0xffff;
          ww(state, ADDR_WORD_45C, mulResult);
        }

        // 0x13288: move.l A2,-(SP) ; jsr 0x13334
        objectRenderUpdate13334(state, rom, sp, {
          inner1D06A: subs?.inner1D06A ?? ((_b: number): void => undefined),
        });
        // move.l A2,-(SP) ; jsr 0x132e0
        {
          const r = advanceAndWrap132E0(state, rom, sp);
          // tst.l D0 ; addq.l 0x8,SP ; beq 0x132a8
          if (r !== 0) {
            // move.l A2,-(SP) ; jsr (A4) ; addq.l 0x4,SP
            subs?.fun12896?.(state, sp);
          }
        }
        // bra.b 0x132a8
        break dispatchLoop;
      }

      default:
        // caseVal > 4 already handled above; this is unreachable
        break dispatchLoop;
    }
  }

  // ── Post-dispatch: check for re-dispatch loop ─────────────────────────
  //
  // 0x132a8: cmp.b (0x1a,A2),D3b ; beq 0x132c4
  //          cmpi.b #1,(0x1a,A2) ; bne 0x132c4
  //          tst.b (0x21,A2) ; bne 0x132c4
  //          move.b (0x1a,A2),D3b ; bra.w 0x13142 (re-dispatch)
  {
    const newState = sb(state, sp, OFF_STATE);
    if (newState !== d3b && newState === 1 && sb(state, sp, OFF_LIM_A) === 0) {
      // Update D3b and re-run the dispatch for the new state==1
      d3b = newState;
      // Re-run case 1 inline (loop back to dispatch):
      // We just re-call the entire dispatch section with the new caseVal=1.
      // This is equivalent to re-running case 1 once.

      // Case 1 re-run:
      if (sb(state, sp, OFF_LIM_A) !== 0) {
        swb(state, sp, OFF_CTR_A, (sb(state, sp, OFF_CTR_A) + 1) & 0xff);
      }
      if (sb(state, sp, OFF_LIM_A) !== sb(state, sp, OFF_CTR_A)) {
        d2b = 1;
      } else {
        swb(state, sp, OFF_CTR_A, 0);
        swl(state, sp, OFF_POS_X, (sl(state, sp, OFF_POS_X) + sl(state, sp, OFF_W0)) >>> 0);
        swl(state, sp, OFF_POS_Y, (sl(state, sp, OFF_POS_Y) + sl(state, sp, OFF_W2)) >>> 0);
        objectRenderUpdate13334(state, rom, sp, {
          inner1D06A: subs?.inner1D06A ?? ((_b: number): void => undefined),
        });
        const r2 = advanceAndWrap132E0(state, rom, sp);
        if (r2 !== 0) {
          subs?.fun12896?.(state, sp);
        }
      }

      // But the re-dispatch path itself ends at 0x132a8 as well.
      // The post-dispatch loop check at 0x132a8 compares the CURRENT slot[0x1a]
      // (which may have changed again) with d3b (now updated).
      // The original loop can only iterate ONCE because after re-running case 1
      // the slot[0x1a] would need to change AGAIN to 1 AND slot[0x21]==0 to loop.
      // Since the binary uses a "bra.w 0x13142" (not a "jsr"), this is a tail
      // loop but the condition at 0x132a8 checks newState != d3b, and d3b was
      // just updated to the new value, so the loop terminates after one iteration.
      // (The loop could theoretically iterate again if case 1 re-changes slot[0x1a]
      // but case 1 does not write slot[0x1a], so it cannot loop more than once.)
    }
  }

  //
  // 0x132c4: cmpi.b #1,(0x1e,A2) ; beq 0x132da (epilogue)
  //          tst.b D2b ; beq 0x132da
  //          move.l A2,-(SP) ; jsr 0x13334 ; addq.l 0x4,SP
  if (sb(state, sp, OFF_MODE) !== 1 && d2b !== 0) {
    objectRenderUpdate13334(state, rom, sp, {
      inner1D06A: subs?.inner1D06A ?? ((_b: number): void => undefined),
    });
  }

  // 0x132da: movem.l (SP)+,...; rts
}
