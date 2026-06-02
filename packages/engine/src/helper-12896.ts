/**
 * Bit-perfect port of `FUN_00012896`, the script-slot interpreter.
 *
 * The routine reads a word opcode from the sequence pointed to by `slot[0x36]`,
 * advances the script pointer by two bytes, and dispatches through the ROM
 * handler table. A handler that leaves D1=1 causes the interpreter to fetch the
 * next opcode immediately; D1=0 exits the routine.
 *
 * ## Prologue / epilogue
 *
 *   00012896  movem.l {D2-D5, A2-A4},-(SP)
 *   0001289a  movea.l (0x20,SP),A2          ; A2 = slotPtr
 *   0001289e  clr.b   D1b
 *   000128a0  movea.l (0x36,A2),A0          ; A0 = *slot[0x36]
 *   000128a4  addq.l  0x2,(0x36,A2)         ; slot[0x36] += 2
 *   000128a8  move.w  (A0),D0w              ; D0w = opcode (word)
 *   000128aa  ext.l   D0
 *   000128ac  exg     D0,A4                 ; A4 = opcode (for signed word compare)
 *   000128ae  cmpa.w  #0x0,A4
 *   000128b2  exg     D0,A4
 *   000128b4  blt.w   exit                  ; opcode < 0 → exit
 *   000128b8  exg     D0,A4
 *   000128ba  cmpa.w  #0x12,A4
 *   000128be  exg     D0,A4
 *   000128c0  bgt.w   exit                  ; opcode > 18 → exit
 *   000128c4  movea.l D0,A4                 ; A4 = opcode
 *   000128c6  move.l  A4,D0
 *   000128c8  movea.l D0,A4
 *   000128ca  adda.l  D0,A4                 ; A4 = opcode*2
 *   000128cc  move.l  A4,D0                 ; D0 = opcode*2
 *   000128ce  move.w  (0x128d6,PC,D0w*0x1),D0w   ; D0 = table[opcode]
 *   000128d2  jmp     (0x128d6,PC,D0w*0x1)        ; jump to handler
 *
 *   00012d3a  tst.b   D1b
 *   00012d3c  bne.w   0x1289e               ; D1b=1 → fetch next opcode
 *   00012d40  movem.l (SP)+,{D2-D5, A2-A4}
 *   00012d44  rts
 *
 * ## Opcodes (0..18)
 *
 *   0  (0x128fc): load 3 fixed-point fields + 2 byte fields, init slot[0x42],
 *                 optionally load 2 word fields + long base ptr → render update
 *   1  (0x12a2c): load timer word + limit byte, init slot[0x1a]=1, clr ctrs → D1=0
 *   2  (0x12a70): if slot[0x1f]==0xa → call FUN_158ac(0x60);
 *                 load timer word + limit byte, init slot[0x1a]=2, clr ctrs → D1=0
 *   3  (0x12ab6): load timer word, clr slot[0x1a] → D1=0
 *   4  (0x12b6c): read byte arg, store in slot[0x24]; save slot[0x36] in slot[0x2a] → D1=1
 *   5  (0x12b86): countdown slot[0x24]; if 0 → restore slot[0x36] from slot[0x2a] → D1=1
 *   6  (0x12baa): read byte arg, store in slot[0x25]; save slot[0x36] in slot[0x2e] → D1=1
 *   7  (0x12bc4): countdown slot[0x25]; if 0 → restore slot[0x36] from slot[0x2e] → D1=1
 *   8  (0x12acc): clr D2; probe marble-object list; cmp pos diff → FUN_158ac(0x31) → D1=1
 *   9  (0x12be8): slot[0x36] = *slot[0x36] (indirect jump) → D1=1
 *  10  (0x12bf6): slot[0x36] = *slot[0x36]++ (indirect call/save ret) → D1=1
 *  11  (0x12c08): slot[0x36] = slot[0x32] (restore saved) → D1=1
 *  12  (0x12c14): A1=*slot[0x36]++; slot[0x46]=A1, slot[0x3e]=A1, slot[0x36]=A1+4 → D1=1
 *  13  (0x12c2c): A1=*slot[0x36]++; slot[0x4a]=A1, slot[0x3e]=A1, slot[0x36]=A1+4 → D1=1
 *  14  (0x12c44): read 2 words → slot[0x00] and slot[0x04] (<<8 each) → D1=1
 *  15  (0x12c6c): jsr FUN_12F44(slotPtr, 1, 0) → D1=0
 *  16  (0x12a5c): slot[0x0c]+=slot[0x00]; slot[0x10]+=slot[0x04] (pos step) → D1=1
 *  17  (0x12c84): slot[0x32]=slot[0x36]-2; slot[0x1a]=4; load slot[0x1b] → D1=0
 *  18  (0x12ca8): search marble-object list (complex match) → D1=1
 *
 * ## Injectable subs
 *   - `objectRenderUpdate13334` (opcode 0 path)
 *   - `fun158ac` (opcodes 2, 8 — address-of-string-function)
 *   - `helper12F44` (opcode 15)
 *
 * ## Parity test
 *   `packages/cli/src/test-helper-12896-parity.ts` (500/500 vs musashi-wasm).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { objectRenderUpdate13334 } from "./object-render-update-13334.js";
import { helper12F44 } from "./helper-12f44.js";
import { slotInsertSorted18E6C } from "./slot-insert-sorted-18e6c.js";

// ROM address constant.

/** Absolute ROM address of this function. */
export const HELPER_12896_ADDR = 0x00012896 as const;

// Work RAM addresses.

const WRAM = 0x00400000 as const;

/** Number of marble-object records in RAM (used by opcode 8/18). */
const ADDR_OBJ_COUNT = 0x00400396 as const;
/** Base address of marble-object records (stride 0xe2 each). */
const ADDR_OBJ_BASE = 0x00400018 as const;

// ─── Slot field offsets (relative to slotPtr) ────────────────────────────────

const OFF_VX    = 0x00; // long +0x00 (velocity X / step value X)
const OFF_VY    = 0x04; // long +0x04 (velocity Y / step value Y)
const OFF_POS_X = 0x0c; // long +0x0c (position X, fixed-point)
const OFF_POS_Y = 0x10; // long +0x10 (position Y, fixed-point)
const OFF_KIND  = 0x1b; // byte +0x1b (object-record kind used in opcode 17/18)
const OFF_STATE  = 0x1a; // byte +0x1a (playback state)
const OFF_MODE   = 0x1e; // byte +0x1e
const OFF_KIND19 = 0x1f; // byte +0x1f (kind field: 0x0a, 0x6, etc.)
const OFF_CTR_A  = 0x20; // byte +0x20 (frame counter A)
const OFF_LIM_A  = 0x21; // byte +0x21 (limit for ctr A, set by opcode 1)
const OFF_CTR_B  = 0x22; // byte +0x22 (frame counter B)
const OFF_LIM_B  = 0x23; // byte +0x23 (limit for ctr B, set by opcode 2)
const OFF_LOOP_A = 0x24; // byte +0x24 (loop countdown A, opcodes 4/5)
const OFF_LOOP_B = 0x25; // byte +0x25 (loop countdown B, opcodes 6/7)
const OFF_W0     = 0x26; // word +0x26 (loaded by opcode 0 if slot[0x1e]==1)
const OFF_W1     = 0x28; // word +0x28 (loaded by opcode 0 if slot[0x1e]==1)
const OFF_PC     = 0x36; // long +0x36 (script program counter / ROM pointer)
const OFF_SAVED  = 0x32; // long +0x32 (saved return pointer for opcode 10/17)
const OFF_LOOP_A_DEST = 0x2a; // long +0x2a (loop-A jump target, saved by opcode 4)
const OFF_LOOP_B_DEST = 0x2e; // long +0x2e (loop-B jump target, saved by opcode 6)
const OFF_REC    = 0x3e; // long +0x3e (current animation record pointer)
const OFF_FINAL  = 0x42; // long +0x42 (written 0x20c14 by opcode 0)
const OFF_BASE   = 0x46; // long +0x46 (base animation pointer)
const OFF_ALT    = 0x4a; // long +0x4a (alt animation pointer)

// ─── Memory helpers ─────────────────────────────────────────────────────────

function rb(state: GameState, addr: number): number {
  return (state.workRam[(addr - WRAM) >>> 0] ?? 0) & 0xff;
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

function ww(state: GameState, addr: number, v: number): void {
  const o = (addr - WRAM) >>> 0;
  state.workRam[o] = (v >>> 8) & 0xff;
  state.workRam[o + 1] = v & 0xff;
}

function wl(state: GameState, addr: number, v: number): void {
  const o = (addr - WRAM) >>> 0;
  const u = v >>> 0;
  state.workRam[o] = (u >>> 24) & 0xff;
  state.workRam[o + 1] = (u >>> 16) & 0xff;
  state.workRam[o + 2] = (u >>> 8) & 0xff;
  state.workRam[o + 3] = u & 0xff;
}

/** Read slot byte at `off` from `sp` (absolute wram addr). */
function sb(state: GameState, sp: number, off: number): number {
  return rb(state, sp + off);
}

/** Write slot byte. */
function swb(state: GameState, sp: number, off: number, v: number): void {
  wb(state, sp + off, v);
}

/** Write slot word. */
function sww(state: GameState, sp: number, off: number, v: number): void {
  ww(state, sp + off, v);
}

/** Read slot long. */
function sl(state: GameState, sp: number, off: number): number {
  return rl(state, sp + off);
}

/** Write slot long. */
function swl(state: GameState, sp: number, off: number, v: number): void {
  wl(state, sp + off, v);
}

/**
 * Read a word from an absolute M68k address (ROM or workRam).
 * Returns sign-extended 32-bit value (M68k `move.w (A0),D0; ext.l D0`).
 */
function readWordSext(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  let w: number;
  if (a >= WRAM && a + 1 < WRAM + 0x2000) {
    w = rw(state, a);
  } else if (a + 1 < rom.program.length) {
    w = (((rom.program[a] ?? 0) << 8) | (rom.program[a + 1] ?? 0)) & 0xffff;
  } else {
    w = 0;
  }
  // sign-extend 16-bit to 32-bit
  return w & 0x8000 ? ((w | 0xffff0000) >>> 0) : w;
}

/**
 * Read a long from an absolute M68k address (ROM or workRam).
 */
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

/**
 * Advance `slot[0x36]` by 2 and return the word at the previous location,
 * sign-extended to a 32-bit value (M68k: movea.l (0x36,A2),A0; addq.l 2,(0x36,A2);
 * move.w (A0),D0w; ext.l D0).
 */
function fetchWordSext(state: GameState, rom: RomImage, sp: number): number {
  const a0 = sl(state, sp, OFF_PC);
  swl(state, sp, OFF_PC, (a0 + 2) >>> 0);
  return readWordSext(state, rom, a0);
}

/**
 * Advance `slot[0x36]` by 2 and return the word at the previous location
 * as unsigned 16-bit (for move.w (A0),(slot+off)).
 */
function fetchWord(state: GameState, rom: RomImage, sp: number): number {
  const a0 = sl(state, sp, OFF_PC);
  swl(state, sp, OFF_PC, (a0 + 2) >>> 0);
  const a = a0 >>> 0;
  if (a >= WRAM && a + 1 < WRAM + 0x2000) {
    return rw(state, a);
  }
  if (a + 1 < rom.program.length) {
    return (((rom.program[a] ?? 0) << 8) | (rom.program[a + 1] ?? 0)) & 0xffff;
  }
  return 0;
}

/**
 * Read byte at offset +1 from the current PC (M68k: movea.l (0x36,A2),A0; addq.l 2;
 * move.b (1,A0),(off,A2) — reads even-word at A0 but uses byte [1]).
 */
function fetchEvenWordByte1(state: GameState, rom: RomImage, sp: number): number {
  // The instruction reads a word-aligned pair then takes byte[1]:
  // movea.l (0x36,A2),A0  ; A0 = slot[0x36]
  // addq.l  0x2,(0x36,A2) ; slot[0x36] += 2
  // move.b  (0x1,A0),dst  ; read byte at A0+1
  const a0 = sl(state, sp, OFF_PC);
  swl(state, sp, OFF_PC, (a0 + 2) >>> 0);
  const a = (a0 + 1) >>> 0;
  if (a >= WRAM && a < WRAM + 0x2000) {
    return rb(state, a);
  }
  if (a < rom.program.length) {
    return (rom.program[a] ?? 0) & 0xff;
  }
  return 0;
}

// ─── Sub injection ────────────────────────────────────────────────────────────

/**
 * Injectable subs for `helper12896`.
 *
 * All have sensible defaults (no-op or direct forward).
 */
export interface Helper12896Subs {
  /**
   * `FUN_00013334` — objectRenderUpdate.
   * Called from opcode 0 with `(state, rom, slotPtr, subs)`.
   * Default: delegates to `objectRenderUpdate13334`.
   */
  objectRenderUpdate13334?: (state: GameState, rom: RomImage, slotPtr: number) => void;

  /**
   * `FUN_000158AC` — generic string/function call (called from opcodes 2 and 8).
   * Receives one long argument pushed on stack.
   * Default: no-op.
   */
  fun158ac?: (state: GameState, arg: number) => void;

  /**
   * `FUN_00012F44` — slot bind/free dispatch.
   * Called from opcode 15 with `(state, rom, slotPtr, 1, 0)`.
   * Default: delegates to `helper12F44`.
   */
  helper12F44?: (
    state: GameState,
    rom: RomImage,
    slotPtr: number,
    mode: number,
    scriptPtr: number,
  ) => void;

  /**
   * `FUN_00018E6C` — `slotInsertSorted18E6C`: registers the object in the
   * sorted-slot table. Called from opcode 0 (non-1e path) with
   * `(state, rom, slot[0x1f], slot[0x19])`.
   * Default: delegates to `slotInsertSorted18E6C`.
   */
  slotInsertSorted18E6C?: (state: GameState, rom: RomImage, typeCode: number, subIdx: number) => void;

  /**
   * `inner1D06A` passed through to `objectRenderUpdate13334` for palette
   * animations. Default: no-op.
   */
  inner1D06A?: (paletteByteSigned: number) => void;
}

// Main function.

/**
 * Execute the `FUN_00012896` script-slot interpreter.
 *
 * @param state Game state mutated by the script.
 * @param rom ROM image used to read bytecode.
 * @param slotPtr Absolute workRam address of the script-slot record.
 * @param subs Optional injectable stubs; defaults either no-op or forward.
 */
export function helper12896(
  state: GameState,
  rom: RomImage,
  slotPtr: number,
  subs?: Helper12896Subs,
): void {
  const sp = slotPtr >>> 0;

  // D1b = 0 initially (but the loop condition checks it AFTER the dispatch,
  // so the first iteration always runs unconditionally).
  // The main loop: fetch opcode, dispatch, if D1b=1 fetch next.

  for (;;) {
    // ─── Fetch opcode ──────────────────────────────────────────────────────
    //
    // 000128a0  movea.l (0x36,A2),A0       ; A0 = slot[0x36]
    // 000128a4  addq.l  0x2,(0x36,A2)      ; slot[0x36] += 2
    // 000128a8  move.w  (A0),D0w           ; D0w = word at A0
    // 000128aa  ext.l   D0                 ; sign-extend to 32-bit
    const a0Fetch = sl(state, sp, OFF_PC);
    swl(state, sp, OFF_PC, (a0Fetch + 2) >>> 0);
    const rawWord = readWordSext(state, rom, a0Fetch); // signed 32-bit

    // ─── Bounds check (signed compare as M68k does with exg D0,A4 trick) ──
    //
    // 000128ae  cmpa.w  #0x0,A4  → A4.w (low 16) compared signed
    // blt → if sext16(opcode) < 0 → exit
    // 000128ba  cmpa.w  #0x12,A4
    // bgt → if sext16(opcode) > 0x12 → exit
    const opcode16 = rawWord & 0xffff;
    const opcodeSigned = opcode16 & 0x8000 ? (opcode16 | 0xffff0000) : opcode16;
    if (opcodeSigned < 0 || opcodeSigned > 0x12) {
      // exit (D1b = 0 implicitly)
      return;
    }

    const opcode = opcodeSigned; // 0..18

    // ─── Dispatch ──────────────────────────────────────────────────────────
    //
    // D1b = 1 → continue (re-fetch), D1b = 0 → exit after dispatch
    let d1: 0 | 1;

    switch (opcode) {
      // ── opcode 0 (0x128fc): init fixed-point fields + optional render ──
      case 0: {
        // Read 3 × signed word → fixed-point longs (<<19 = sign-extend then <<19)
        //
        // Word1 → D0w; ext.l D0; moveq 0x13,D1; asl.l D1,D0 → slot[0x0c]
        {
          const w1 = fetchWordSext(state, rom, sp);
          swl(state, sp, OFF_POS_X, (w1 << 19) >>> 0);
        }
        // Word2 → slot[0x10]
        {
          const w2 = fetchWordSext(state, rom, sp);
          swl(state, sp, OFF_POS_Y, (w2 << 19) >>> 0);
        }
        // Word3 → D0w; ext.l D0; moveq 0x10,D1; asl.l D1,D0 → slot[0x14]
        // (OFF_14 = 0x14)
        {
          const w3 = fetchWordSext(state, rom, sp);
          wl(state, sp + 0x14, (w3 << 16) >>> 0);
        }

        // Byte from word-aligned fetch → slot[0x1e]
        {
          const b1 = fetchEvenWordByte1(state, rom, sp);
          swb(state, sp, OFF_MODE, b1);
        }
        // Byte from word-aligned fetch → slot[0x1f]
        {
          const b2 = fetchEvenWordByte1(state, rom, sp);
          swb(state, sp, OFF_KIND19, b2);
        }

        // slot[0x42] = 0x20c14
        swl(state, sp, OFF_FINAL, 0x00020c14);

        // if slot[0x1e] == 1:
        //   load word → slot[0x26], word → slot[0x28]
        //   movea.l (0x36,A2),A0; move.l (A0)+,(0x46,A2); move.l A0,(0x36,A2)
        //   slot[0x3e] = slot[0x46]
        //   jsr 0x13334(A2)
        //   bra done
        // else (bne to 0x1299a):
        //   continue to kind check
        if (sb(state, sp, OFF_MODE) === 1) {
          // ── slot[0x1e] == 1 path (0x12964..0x12998, then bra→0x129e0) ──
          //
          // load two word fields
          sww(state, sp, OFF_W0, fetchWord(state, rom, sp));
          sww(state, sp, OFF_W1, fetchWord(state, rom, sp));
          // movea.l (0x36,A2),A0; move.l (A0)+,(0x46,A2); move.l A0,(0x36,A2)
          {
            const a0 = sl(state, sp, OFF_PC);
            const longVal = readLong(state, rom, a0);
            swl(state, sp, OFF_BASE, longVal);
            swl(state, sp, OFF_PC, (a0 + 4) >>> 0);
          }
          swl(state, sp, OFF_REC, sl(state, sp, OFF_BASE));
          // jsr 0x13334(A2)
          if (subs?.objectRenderUpdate13334 !== undefined) {
            subs.objectRenderUpdate13334(state, rom, sp);
          } else {
            objectRenderUpdate13334(state, rom, sp, {
              inner1D06A: subs?.inner1D06A ?? ((_b: number): void => undefined),
            });
          }
          // bra.b 0x129e0 → skip the 0x1299a..0x129bb block
        } else {
          // ── slot[0x1e] != 1 path (bne.b → 0x1299a) ──────────────────────
          //
          // 0x1299a: move.l #0x20c14,(0x3e,A2)
          swl(state, sp, OFF_REC, 0x00020c14);
          // 0x129a2: move.b (0x19,A2),D1b; ext.w; ext.l; push
          // 0x129ac: move.b (0x1f,A2),D0b; ext.w; ext.l; push
          // 0x129b6: jsr FUN_18e6c(kind19=slot[0x1f], subIdx=slot[0x19])
          // Note: args reversed on stack: D0=typeCode (slot[0x1f]), D1=subIdx (slot[0x19])
          {
            const typeCode = sb(state, sp, OFF_KIND19);
            const subIdx   = rb(state, sp + 0x19);
            if (subs?.slotInsertSorted18E6C !== undefined) {
              subs.slotInsertSorted18E6C(state, rom, typeCode, subIdx);
            } else {
              slotInsertSorted18E6C(state, rom, typeCode, subIdx);
            }
          }
          // addq.l 0x8,SP (implicit in TS — stack cleanup, no-op here)
        }

        // 0x129bc: cmpi.b #6,(0x1f,A2)
        //   addq.l 0x8,SP  — this is a pop of the two pea args from 0x12998 jsr path
        //   The bne skips the kind==6 block.
        // NOTE: addq.l 0x8,SP at 0x129c2 is part of the control flow from the
        // render path (bra.b 0x129e0 at 0x12998 skips 0x129a0..0x129bb which are
        // padding, so we land at 0x129bc directly).

        if (sb(state, sp, OFF_KIND19) === 6) {
          // clr.w (0x52,A2)        ; slot[0x52].w = 0
          ww(state, sp + 0x52, 0);
          // move.w #0x500,(0x54,A2) ; slot[0x54].w = 0x500
          ww(state, sp + 0x54, 0x500);
          // clr.b (0x40075e).l     ; global flag = 0
          wb(state, 0x0040075e, 0);
          // addq.b 0x1,(0x40075c).l ; global counter++
          wb(state, 0x0040075c, (rb(state, 0x0040075c) + 1) & 0xff);
          // clr.b (0x25,A2)
          swb(state, sp, OFF_LOOP_B, 0);
        }

        // 0x129e0: cmpi.b #3,(0x1f,A2)
        //   bne.b 0x12a26 (skip kind-3 init)
        if (sb(state, sp, OFF_KIND19) === 3) {
          // move.l #-0x200,(0x4e,A2)   ; slot[0x4e] = -0x200 (0xFFFFFE00)
          wl(state, sp + 0x4e, 0xfffffe00);
          // move.l #0x211fe,(0x40044a)
          wl(state, 0x0040044a, 0x000211fe);
          // move.b #2,(0x400456)
          wb(state, 0x00400456, 2);
          // move.l #0x2126e,(0x40044e)
          wl(state, 0x0040044e, 0x0002126e);
          // move.b #3,(0x400458)
          wb(state, 0x00400458, 3);
          // move.l #0x212b2,(0x400452)
          wl(state, 0x00400452, 0x000212b2);
          // move.b #3,(0x40045a)
          wb(state, 0x0040045a, 3);
        }

        // 0x12a26: moveq 0x1,D1 ; bra.w exit_with_d1
        d1 = 1;
        break;
      }

      // ── opcode 1 (0x12a2c): load timer word + limit byte, set state=1, clr ctrs ──
      case 1: {
        // movea.l (0x36,A2),A0; addq.l 2,(0x36,A2); move.w (A0),(0x1c,A2)
        // slot[0x1c].w = next word from stream
        sww(state, sp, 0x1c, fetchWord(state, rom, sp));
        // movea.l (0x36,A2),A0; addq.l 2,(0x36,A2); move.b (1,A0),(0x21,A2)
        swb(state, sp, OFF_LIM_A, fetchEvenWordByte1(state, rom, sp));
        // move.l (0x4a,A2),(0x3e,A2)
        swl(state, sp, OFF_REC, sl(state, sp, OFF_ALT));
        // clr.b (0x20,A2)
        swb(state, sp, OFF_CTR_A, 0);
        // move.b #1,(0x1a,A2)
        swb(state, sp, OFF_STATE, 1);
        // clr.b D1b
        d1 = 0;
        break;
      }

      // ── opcode 2 (0x12a70): optionally call FUN_158ac, then load timer/limit, state=2 ──
      case 2: {
        // cmpi.b #0xa,(0x1f,A2); bne.b 0x12a86
        if (sb(state, sp, OFF_KIND19) === 0x0a) {
          // pea (0x60).l; jsr FUN_158ac; addq.l 4,SP
          subs?.fun158ac?.(state, 0x60);
        }
        // 0x12a86:
        // movea.l (0x36,A2),A0; addq.l 2,(0x36,A2); move.w (A0),(0x1c,A2)
        sww(state, sp, 0x1c, fetchWord(state, rom, sp));
        // movea.l (0x36,A2),A0; addq.l 2,(0x36,A2); move.b (1,A0),(0x23,A2)
        swb(state, sp, OFF_LIM_B, fetchEvenWordByte1(state, rom, sp));
        // move.l (0x46,A2),(0x3e,A2)
        swl(state, sp, OFF_REC, sl(state, sp, OFF_BASE));
        // clr.b (0x22,A2)
        swb(state, sp, OFF_CTR_B, 0);
        // move.b #2,(0x1a,A2)
        swb(state, sp, OFF_STATE, 2);
        // clr.b D1b
        d1 = 0;
        break;
      }

      // ── opcode 3 (0x12ab6): load timer word, clear state ──────────────────
      case 3: {
        // movea.l (0x36,A2),A0; addq.l 2,(0x36,A2); move.w (A0),(0x1c,A2)
        sww(state, sp, 0x1c, fetchWord(state, rom, sp));
        // clr.b (0x1a,A2)
        swb(state, sp, OFF_STATE, 0);
        // clr.b D1b
        d1 = 0;
        break;
      }

      // ── opcode 4 (0x12b6c): save jump-A target, load countdown byte ───────
      case 4: {
        // movea.l (0x36,A2),A0; addq.l 2,(0x36,A2); move.b (1,A0),(0x24,A2)
        swb(state, sp, OFF_LOOP_A, fetchEvenWordByte1(state, rom, sp));
        // move.l (0x36,A2),(0x2a,A2)
        swl(state, sp, OFF_LOOP_A_DEST, sl(state, sp, OFF_PC));
        // moveq 1,D1
        d1 = 1;
        break;
      }

      // ── opcode 5 (0x12b86): countdown loop-A ──────────────────────────────
      case 5: {
        // tst.b (0x24,A2); beq.b 0x12b9e
        if (sb(state, sp, OFF_LOOP_A) !== 0) {
          // subq.b 1,(0x24,A2)
          swb(state, sp, OFF_LOOP_A, (sb(state, sp, OFF_LOOP_A) - 1) & 0xff);
          // tst.b (0x24,A2); beq.b 0x12ba4
          // Note: if after decrement it's 0 → fall through to bne path: DON'T restore
          // if non-zero → restore pointer
          if (sb(state, sp, OFF_LOOP_A) !== 0) {
            // move.l (0x2a,A2),(0x36,A2)  (restore loop target)
            swl(state, sp, OFF_PC, sl(state, sp, OFF_LOOP_A_DEST));
          }
          // if zero after decrement: fall through to moveq 1,D1 (exit loop)
        } else {
          // already 0: also restore (loop body executes once more? No: beq→0x12b9e)
          // 0x12b9e: move.l (0x2a,A2),(0x36,A2)
          swl(state, sp, OFF_PC, sl(state, sp, OFF_LOOP_A_DEST));
        }
        // 0x12ba4: moveq 1,D1
        d1 = 1;
        break;
      }

      // ── opcode 6 (0x12baa): save jump-B target, load countdown byte ───────
      case 6: {
        // movea.l (0x36,A2),A0; addq.l 2,(0x36,A2); move.b (1,A0),(0x25,A2)
        swb(state, sp, OFF_LOOP_B, fetchEvenWordByte1(state, rom, sp));
        // move.l (0x36,A2),(0x2e,A2)
        swl(state, sp, OFF_LOOP_B_DEST, sl(state, sp, OFF_PC));
        // moveq 1,D1
        d1 = 1;
        break;
      }

      // ── opcode 7 (0x12bc4): countdown loop-B ──────────────────────────────
      case 7: {
        // tst.b (0x25,A2); beq.b 0x12bdc
        if (sb(state, sp, OFF_LOOP_B) !== 0) {
          // subq.b 1,(0x25,A2)
          swb(state, sp, OFF_LOOP_B, (sb(state, sp, OFF_LOOP_B) - 1) & 0xff);
          // tst.b (0x25,A2); beq.b 0x12be2
          if (sb(state, sp, OFF_LOOP_B) !== 0) {
            // move.l (0x2e,A2),(0x36,A2)
            swl(state, sp, OFF_PC, sl(state, sp, OFF_LOOP_B_DEST));
          }
        } else {
          // 0x12bdc: move.l (0x2e,A2),(0x36,A2)
          swl(state, sp, OFF_PC, sl(state, sp, OFF_LOOP_B_DEST));
        }
        // 0x12be2: moveq 1,D1
        d1 = 1;
        break;
      }

      // ── opcode 8 (0x12acc): search marble-object list, proximity check ────
      //
      // 00012acc  clr.b   D2b                  ; D2 = 0 (found flag)
      // 00012ace  movea.l (0x36,A2),A0
      // 00012ad2  addq.l  0x2,(0x36,A2)
      // 00012ad6  move.w  (A0),D0w             ; D0 = sext(stream word)
      // 00012ad8  ext.l   D0
      // 00012ada  exg     D0,A4                ; A4 = D0 (signed compare via exg trick)
      // 00012adc  cmpa.w  #0x0,A4
      // 00012ae0  exg     D0,A4
      // 00012ae2  bne.w   0x12b54              ; D0 != 0 → skip to epilogue
      // 00012ae6  movea.l #0x400018,A3         ; A3 = first object record
      // 00012aec  clr.b   D3b                  ; D3 = 0 (counter)
      // 00012aee  bra.w   0x12b48              ; jump to loop test
      //
      // Loop body (0x12af2):
      //   cmpi.b #1,(0x18,A3) ; bne 0x12b46   ; obj active?
      //   D0 = (A3.posX - A2.posX) >> 19 → D4w (signed word diff in world)
      //   D0 = (A3.posY - A2.posY) >> 19 → D1w
      //   if D4w < 0 → skip
      //   if D4w > 3 → skip
      //   if D1w < 0 → skip
      //   if D1w > 3 → skip
      //   D2 = 1; jsr FUN_158ac(0x31)
      // 0x12b3c: A3 += 0xe2 (next record)
      // 0x12b46: D3b++
      // 0x12b48: if D3b != [0x400396].w → loop
      // 0x12b54: tst.b D2b; beq 0x12b62
      //   A4 = *slot[0x36] → slot[0x36] = *slot[0x36] (indirect jump if D2)
      //   bra 0x12b66
      // 0x12b62: addq.l 2,slot[0x36] (skip the pointer word)
      // 0x12b66: moveq 1,D1
      case 8: {
        let d2 = 0;
        const streamVal = fetchWordSext(state, rom, sp);

        if (streamVal === 0) {
          const objCount = rw(state, ADDR_OBJ_COUNT);
          let a3 = ADDR_OBJ_BASE;
          for (let d3 = 0; ; ) {
            // check: D3 < objCount?
            // The loop check is: cmp.w (0x400396),D0 ; bne → loop back
            // D0 = D3b sign-extended. So loop while D3.w != objCount.w.
            if ((d3 & 0xffff) === objCount) break;

            // cmpi.b #1,(0x18,A3) ; bne 0x12b46 (skip)
            if (rb(state, a3 + 0x18) === 1) {
              // D0 = (A3.posX - A2.posX) >> 19  (both are fixed-point long)
              const dxRaw = ((rl(state, a3 + OFF_POS_X) - sl(state, sp, OFF_POS_X)) | 0);
              const dx = (dxRaw >> 19) & 0xffff; // signed word
              const dxSigned = dx & 0x8000 ? (dx | 0xffff0000) : dx;
              const dyRaw = ((rl(state, a3 + OFF_POS_Y) - sl(state, sp, OFF_POS_Y)) | 0);
              const dy = (dyRaw >> 19) & 0xffff;
              const dySigned = dy & 0x8000 ? (dy | 0xffff0000) : dy;

              // tst.w D4w; blt skip
              // moveq 3,D0; cmp.w D4w,D0w; ble skip (D0=3, if 3 <= D4w then D4w >= 3 → skip)
              // Note: cmp.w D4w,D0w → D0-D4 → ble means D0<=D4 i.e. 3<=dx → skip
              // So condition to NOT skip: 0 <= dx <= 3 AND 0 <= dy <= 3
              if (dxSigned >= 0 && dxSigned <= 3 && dySigned >= 0 && dySigned <= 3) {
                d2 = 1;
                subs?.fun158ac?.(state, 0x31);
              }
            }

            // A3 += 0xe2
            a3 = (a3 + 0xe2) >>> 0;
            d3 = (d3 + 1) & 0xff;
          }
        }

        // After loop:
        // tst.b D2b; beq 0x12b62
        if (d2 !== 0) {
          // movea.l (0x36,A2),A4; move.l (A4),(0x36,A2)
          // (indirect jump: slot[0x36] = *slot[0x36])
          const pcNow = sl(state, sp, OFF_PC);
          swl(state, sp, OFF_PC, readLong(state, rom, pcNow));
        } else {
          // addq.l 2,(0x36,A2)  (skip the jump-target word in stream)
          swl(state, sp, OFF_PC, (sl(state, sp, OFF_PC) + 2) >>> 0);
        }
        d1 = 1;
        break;
      }

      // ── opcode 9 (0x12be8): indirect jump ─────────────────────────────────
      //
      // 00012be8  movea.l (0x36,A2),A0
      // 00012bec  move.l  (A0),(0x36,A2)   ; slot[0x36] = *slot[0x36]
      // 00012bf0  moveq   1,D1
      case 9: {
        const pcNow = sl(state, sp, OFF_PC);
        swl(state, sp, OFF_PC, readLong(state, rom, pcNow));
        d1 = 1;
        break;
      }

      // ── opcode 10 (0x12bf6): call/push-return ─────────────────────────────
      //
      // 00012bf6  movea.l (0x36,A2),A0
      // 00012bfa  move.l  (A0)+,(0x36,A2)  ; slot[0x36] = *slot[0x36]; A0 += 4
      // 00012bfe  move.l  A0,(0x32,A2)     ; slot[0x32] = A0 (return addr)
      // 00012c02  moveq   1,D1
      case 10: {
        const pcNow = sl(state, sp, OFF_PC);
        const target = readLong(state, rom, pcNow);
        swl(state, sp, OFF_PC, target);
        swl(state, sp, OFF_SAVED, (pcNow + 4) >>> 0);
        d1 = 1;
        break;
      }

      // ── opcode 11 (0x12c08): return from call ─────────────────────────────
      //
      // 00012c08  move.l  (0x32,A2),(0x36,A2)  ; slot[0x36] = slot[0x32]
      // 00012c0e  moveq   1,D1
      case 11: {
        swl(state, sp, OFF_PC, sl(state, sp, OFF_SAVED));
        d1 = 1;
        break;
      }

      // ── opcode 12 (0x12c14): load base-anim ptr, set rec and script ptr ──
      //
      // 00012c14  movea.l (0x36,A2),A1     ; A1 = slot[0x36]
      // 00012c18  movea.l (A1)+,A0         ; A0 = *A1; A1 += 4
      // 00012c1a  move.l  A0,(0x46,A2)     ; slot[0x46] = A0
      // 00012c1e  move.l  A0,(0x3e,A2)     ; slot[0x3e] = A0
      // 00012c22  move.l  A1,(0x36,A2)     ; slot[0x36] = A1 (after the long)
      // 00012c26  moveq   1,D1
      case 12: {
        const a1 = sl(state, sp, OFF_PC);
        const a0 = readLong(state, rom, a1);
        swl(state, sp, OFF_BASE, a0);
        swl(state, sp, OFF_REC, a0);
        swl(state, sp, OFF_PC, (a1 + 4) >>> 0);
        d1 = 1;
        break;
      }

      // ── opcode 13 (0x12c2c): load alt-anim ptr, set rec and script ptr ───
      //
      // 00012c2c  movea.l (0x36,A2),A1
      // 00012c30  movea.l (A1)+,A0
      // 00012c32  move.l  A0,(0x4a,A2)    ; slot[0x4a] = A0
      // 00012c36  move.l  A0,(0x3e,A2)    ; slot[0x3e] = A0
      // 00012c3a  move.l  A1,(0x36,A2)
      // 00012c3e  moveq   1,D1
      case 13: {
        const a1 = sl(state, sp, OFF_PC);
        const a0 = readLong(state, rom, a1);
        swl(state, sp, OFF_ALT, a0);
        swl(state, sp, OFF_REC, a0);
        swl(state, sp, OFF_PC, (a1 + 4) >>> 0);
        d1 = 1;
        break;
      }

      // ── opcode 14 (0x12c44): load 2 velocity words (<<8) ─────────────────
      //
      // 00012c44  movea.l (0x36,A2),A0; addq.l 2,(0x36,A2)
      // 00012c4c  move.w  (A0),D0w; ext.l D0; asl.l #8,D0
      // 00012c52  move.l  D0,(A2)         ; slot[0x00] = sext_word_<<8
      // 00012c54  movea.l (0x36,A2),A0; addq.l 2,(0x36,A2)
      // 00012c5c  move.w  (A0),D0w; ext.l D0; asl.l #8,D0
      // 00012c62  move.l  D0,(0x4,A2)     ; slot[0x04] = sext_word_<<8
      // 00012c66  moveq   1,D1
      case 14: {
        const w1 = fetchWordSext(state, rom, sp);
        swl(state, sp, OFF_VX, (w1 << 8) >>> 0);
        const w2 = fetchWordSext(state, rom, sp);
        swl(state, sp, OFF_VY, (w2 << 8) >>> 0);
        d1 = 1;
        break;
      }

      // ── opcode 15 (0x12c6c): call FUN_12F44(slotPtr, mode=1, 0) ──────────
      //
      // 00012c6c  clr.l   -(SP)      ; arg3 = 0
      // 00012c6e  pea     (0x1).w    ; arg2 = 1 (mode = free)
      // 00012c72  move.l  A2,-(SP)   ; arg1 = slotPtr
      // 00012c74  jsr     0x12f44
      // 00012c7a  clr.b   D1b
      // 00012c7c  lea     (0xc,SP),SP
      case 15: {
        if (subs?.helper12F44 !== undefined) {
          subs.helper12F44(state, rom, sp, 1, 0);
        } else {
          helper12F44(state, rom, sp, 1, 0);
        }
        d1 = 0;
        break;
      }

      // ── opcode 16 (0x12a5c): advance position by velocity ─────────────────
      //
      // 00012a5c  move.l  (A2),D0        ; D0 = slot[0x00] (vx)
      // 00012a5e  add.l   D0,(0xc,A2)    ; slot[0x0c] += vx
      // 00012a62  move.l  (0x4,A2),D0    ; D0 = slot[0x04] (vy)
      // 00012a66  add.l   D0,(0x10,A2)   ; slot[0x10] += vy
      // 00012a6a  moveq   1,D1
      case 16: {
        swl(state, sp, OFF_POS_X, (sl(state, sp, OFF_POS_X) + sl(state, sp, OFF_VX)) >>> 0);
        swl(state, sp, OFF_POS_Y, (sl(state, sp, OFF_POS_Y) + sl(state, sp, OFF_VY)) >>> 0);
        d1 = 1;
        break;
      }

      // ── opcode 17 (0x12c84): set mode 4, save PC-2 in slot[0x32] ─────────
      //
      // 00012c84  movea.l (0x36,A2),A0  ; A0 = slot[0x36] (already advanced by fetch)
      // 00012c88  subq.l  0x2,A0        ; A0 -= 2 (undo advance to get opcode addr)
      // 00012c8a  move.l  A0,(0x32,A2)  ; slot[0x32] = opcode address
      // 00012c8e  move.b  #4,(0x1a,A2)  ; slot[0x1a] = 4
      // 00012c94  movea.l (0x36,A2),A0; addq.l 2,(0x36,A2)
      // 00012c9c  move.b  (1,A0),(0x1b,A2)  ; slot[0x1b] = next stream byte[1]
      // 00012ca2  clr.b   D1b
      case 17: {
        // slot[0x32] = current PC - 2  (= address of the opcode word itself)
        swl(state, sp, OFF_SAVED, (sl(state, sp, OFF_PC) - 2) >>> 0);
        swb(state, sp, OFF_STATE, 4);
        swb(state, sp, OFF_KIND, fetchEvenWordByte1(state, rom, sp));
        d1 = 0;
        break;
      }

      // ── opcode 18 (0x12ca8): search marble-object list, complex match ─────
      //
      // 00012ca8  movea.l #0x400018,A0   ; A0 = first object record
      // 00012cae  moveq   1,D2           ; D2 = 1 (found = true initially!)
      // 00012cb0  clr.b   D3b            ; D3 = 0 (counter)
      // 00012cb2  bra.b   0x12cf4        ; jump to loop test
      //
      // Inner loop body (0x12cb4):
      //   cmpi.b #1,(0x18,A0); bne 0x12ce8 (skip if not active)
      //   move.b (0x1b,A2),D0b; cmp.b (0x1b,A0),D0b; beq→0x12ce6 (match)
      //   move.b (0x1b,A0),D0b; ext.w D0; ext.l D0
      //   move.b (0x1b,A2),D1b; ext.w D1; ext.l D1; addq.l 1,D1
      //   cmp.l D1,D0; bne 0x12ce8
      //   cmpi.b #0x1e,(0x1b,A0); blt 0x12ce8
      //   → fall through to 0x12ce6
      // 0x12ce6:  clr.b D2b  (D2 = 0 = no direct match yet? invert semantics)
      //   Note: D2 starts at 1, cleared on match. At 0x12d04: tst.b D2b; beq→0x12d32
      //   So D2=0 means "match found", D2=1 means "no match".
      // 0x12ce8: A0 += 0xe2; D3b++
      // 0x12cf4 (loop test): D3b vs [0x400396]; bne → loop
      //
      // Post-loop (0x12d00):
      //   movea.l (0x36,A2),A0
      //   tst.b D2b; beq 0x12d32
      //   (D2=1: no match) → slot[0x36] = *(slot[0x36])
      //       slot[0x1b] calc + jsr FUN_158ac
      //   (D2=0: match) 0x12d32: addq.l 4,A0; slot[0x36] = A0
      //     moveq 1,D1
      // Note: looking at 0x12d32 and 0x12d38 more carefully:
      // 0x12d32 is 'addq.l 4,A0', not '(no instr)' — let me recheck bytes:
      // From earlier: 00012d32  addq.l 0x4,A0 ; 00012d34  move.l A0,(0x36,A2)
      // 00012d38  moveq 0x1,D1
      case 18: {
        const objCount = rw(state, ADDR_OBJ_COUNT);
        let a0 = ADDR_OBJ_BASE;
        let d2 = 1; // 1 = "not found yet"; cleared to 0 on match

        for (let d3 = 0; (d3 & 0xffff) !== objCount; d3 = (d3 + 1) & 0xff) {
          // cmpi.b #1,(0x18,A0); bne skip
          if (rb(state, a0 + 0x18) === 1) {
            const slotKind = sb(state, sp, OFF_KIND);    // slot[0x1b]
            const objKind  = rb(state, a0 + OFF_KIND);   // obj[0x1b]

            // cmp.b (0x1b,A0),D0b; beq→match
            if (slotKind === objKind) {
              d2 = 0;
            } else {
              // ext chain: D0 = sext(objKind); D1 = sext(slotKind)+1
              const d0 = objKind & 0x80 ? (objKind | 0xffffff00) >>> 0 : objKind;
              const d1ext = slotKind & 0x80 ? (slotKind | 0xffffff00) >>> 0 : slotKind;
              const d1val = (d1ext + 1) >>> 0;
              // cmp.l D1,D0; bne skip (D0 != D1)
              if (d0 === d1val) {
                // cmpi.b #0x1e,(0x1b,A0); blt skip
                if (objKind >= 0x1e) {
                  d2 = 0; // match
                }
              }
            }
          }
          a0 = (a0 + 0xe2) >>> 0;
        }

        // Post-loop: A0 = slot[0x36] (the stream pointer)
        const pcNow = sl(state, sp, OFF_PC);

        // tst.b D2b; beq 0x12d32
        if (d2 !== 0) {
          // D2=1: no match → indirect jump + FUN_158ac call
          // move.l (A0),(0x36,A2)  → slot[0x36] = *slot[0x36]
          const target = readLong(state, rom, pcNow);
          swl(state, sp, OFF_PC, target);
          // move.b (0x1b,A2),D1b; ext.w; ext.l; moveq 0x1e,D0; sub.l D0,D1
          // D1 = sext(slot[0x1b]) - 0x1e = kind - 0x1e
          const kindSigned = sb(state, sp, OFF_KIND) & 0x80
            ? (sb(state, sp, OFF_KIND) | 0xffffff00)
            : sb(state, sp, OFF_KIND);
          const index = (kindSigned - 0x1e) | 0;
          // asl.l #2,D0 → index * 4
          const tableIdx = (index * 4) | 0;
          // movea.l #0x1ef5a,A0; movea.l (0,A0,D0*1),A0
          const tableBase = 0x0001ef5a;
          const funcPtr = readLong(state, rom, (tableBase + tableIdx) >>> 0);
          // pea (A0); jsr FUN_158ac; addq.l 4,SP
          subs?.fun158ac?.(state, funcPtr);
          // bra.b 0x12d38
          // 0x12d38: moveq 1,D1
        } else {
          // D2=0: match → skip 4 bytes past the pointer
          // addq.l 4,A0; slot[0x36] = A0
          swl(state, sp, OFF_PC, (pcNow + 4) >>> 0);
          // moveq 1,D1
        }
        d1 = 1;
        break;
      }

      default:
        // unreachable (bounds-checked above)
        d1 = 0;
        break;
    }

    // ─── Continue or exit ──────────────────────────────────────────────────
    //
    // 00012d3a  tst.b  D1b
    // 00012d3c  bne.w  0x0001289e   ; D1b=1 → re-fetch
    // 00012d40  movem.l (SP)+,...   ; restore
    // 00012d44  rts
    if (d1 === 0) {
      return;
    }
    // D1b = 1: loop back to 0x1289e to fetch next opcode
  }
}
