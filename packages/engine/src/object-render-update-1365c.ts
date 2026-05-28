/**
 * object-render-update-1365c.ts — `FUN_0001365C` replica (778 bytes,
 * 0x01365C-0x013966).
 *
 * `FUN_000121b8` @ `0x1241e` (single xref, UNCONDITIONAL_CALL). Receives one
 * long arg (`A2` = object struct ptr in work RAM).
 *
 *
 *      shift-left by 2 (word x 4), indexes the ROM long-table @ `0x1eb16`
 *
 *      `frame[-c].w = *(0x40069a)`, `frame[-a].w = *(0x40069c)`.
 *
 *   3. **Early-exit if POS unchanged**: if `A1 == frame[-c] && A4 == frame[-a]`
 *      -> epilogue.
 *
 *      D1b = byte 2 (sign-extended to word). D3b = 0 ("vertical" flag).
 *
 *   5. **Abs D6**: abs of signed word. Then: if D5 < 0 -> D3b=1 (vertical flag)
 *
 *   6. **Match-check**: (if D3b==1) D6w vs A4w and frame[-a]; (if D3b==0) D5w
 *
 *   7. **Inner scan loop** (`0x1371c`..`0x13762`): scans positions from
 *      `frame[-8]` (start) through `D1w` (count); tests A1/A4 and frame[-c]/[-a]
 *      to find D4b (dest) and D0b (src) flags.
 *
 *
 *
 *      slot @ `0x400a9c` (stride 0x56), finds slots with `+0x18.b==1` and
 *      `+0x1a.b==4` or `+0x1a.b==2` + `+0x1f.b∈{0xb,0xd}`, then handles
 *      `+0x36.l`, `FUN_158ac`, `FUN_12896`.
 *
 *
 *   - `0x1eb16` — long-table per-game-mode (entry-list ptr).
 *   - `0x1eb2e` — byte-table 6 entry (velocity X per game mode).
 *   - `0x1eb34` — byte-table 6 entry (velocity Y per game mode).
 *   - `0x1ef72` — long-table ptr (indicizzata da `A2+0x19.b`).
 *   - `0x1ef5a` — long-table ptr (indicizzata da `A3+0x1b.b - 0x1e`).
 *
 *
 * **External sub-jsrs (7 distinct)**:
 *   - `0x285b0`  `FUN_285B0(A2, longArg)` — mirrored; callback `fun285B0`.
 *   - `0x15884`  `soundPair15884(state, subs)` — mirrored, directly callable.
 *   - `0x158ac`  `FUN_158AC(longArg)` — mirrored; callback `fun158AC`.
 *   - `0x12f44`  `FUN_12F44(A3, 1, 0)` — mirrored; callback `fun12F44`.
 *   - `0x12896`  `FUN_12896(A3)` — mirrored; callback `fun12896`.
 *   - `0x13966`  `FUN_13966(A2)` — mirrored; callback `fun13966`.
 *
 * `packages/cli/src/test-object-render-update-1365c-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { paletteQueuePush } from "./palette-queue.js";
import { soundPair15884 } from "./sound-pair-15884.js";
import { helper285B0 } from "./helper-285b0.js";
import { postStateChange13966 } from "./post-state-change-13966.js";
import { helper12F44 } from "./helper-12f44.js";
import { helper12896 } from "./helper-12896.js";
import { soundCmdSend158AC } from "./sound-cmd-send-158ac.js";

const WORK_RAM_BASE = 0x400000 as const;

// ─── ROM table addresses ────────────────────────────────────────────────────
/** Long-table per game-mode -> entry-list ptr. */
const ROM_ENTRY_LIST_TABLE = 0x1eb16 as const;
/** Byte-table velocity-X (6 entries). */
const ROM_VEL_X_TABLE = 0x1eb2e as const;
/** Byte-table velocity-Y (6 entries). */
const ROM_VEL_Y_TABLE = 0x1eb34 as const;
/** Long-table indexed by `A2+0x19.b` → sound/anim ptr. */
const ROM_ANIM_TABLE_1EF72 = 0x1ef72 as const;
/** Long-table indexed by `A3+0x1b.b - 0x1e` → anim ptr. */
const ROM_ANIM_TABLE_1EF5A = 0x1ef5a as const;

// ─── Global addresses ────────────────────────────────────────────────────────
const GAME_MODE_ADDR = 0x400394 as const; // word
const POS_X_ADDR = 0x400696 as const; // word (tile X curr)
const POS_Y_ADDR = 0x400698 as const; // word (tile Y curr)
const POS_X_PREV_ADDR = 0x40069a as const; // word (tile X prev)
const POS_Y_PREV_ADDR = 0x40069c as const; // word (tile Y prev)
const GLOBAL_4003A4_ADDR = 0x4003a4 as const; // byte

// ─── Object struct offsets (A2) ─────────────────────────────────────────────
const A2_VEL_X_LONG_OFF = 0x00; // long (velocity X ← from table)
const A2_VEL_Y_LONG_OFF = 0x04; // long (velocity Y ← from table)
const A2_STATE_BYTE_OFF = 0x1a; // byte (obj state)
const A2_TILE_TYPE_OFF = 0x18; // byte
const A2_NEW_STATE_BYTE_OFF = 0x1b; // byte (tile state, updated by this fn)
const A2_PALETTE_IDX_OFF = 0x19; // byte (palette anim index)
const A2_TIMER_BYTE_OFF = 0x57; // byte (timer written = 0x1e)
const A2_SLOT109_OFF = 0x6d; // byte
const A2_SLOT110_OFF = 0x6e; // byte

const SLOT_ARRAY_BASE = 0x400a9c as const;
const SLOT_STRIDE = 0x56 as const;
const SLOT_COUNT = 0x19 as const; // 25 decimal

const S_TILE_TYPE_OFF = 0x18; // byte
const S_STATE_OFF = 0x1a; // byte
const S_NEW_STATE_OFF = 0x1b; // byte
const S_KIND_OFF = 0x1f; // byte
const S_ANIM_PTR_OFF = 0x36; // long

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readU8(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + workRam.length) return 0;
  return (workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

function writeU8(workRam: Uint8Array, addrAbs: number, v: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + workRam.length) return;
  workRam[a - WORK_RAM_BASE] = v & 0xff;
}

function readU16(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_BASE + workRam.length) return 0;
  const o = a - WORK_RAM_BASE;
  return (((workRam[o] ?? 0) << 8) | (workRam[o + 1] ?? 0)) & 0xffff;
}


function writeU32(workRam: Uint8Array, addrAbs: number, v: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_BASE + workRam.length) return;
  const o = a - WORK_RAM_BASE;
  const u = v >>> 0;
  workRam[o] = (u >>> 24) & 0xff;
  workRam[o + 1] = (u >>> 16) & 0xff;
  workRam[o + 2] = (u >>> 8) & 0xff;
  workRam[o + 3] = u & 0xff;
}

function readU32Rom(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a + 3 >= rom.program.length) return 0;
  return (
    (((rom.program[a] ?? 0) << 24) |
      ((rom.program[a + 1] ?? 0) << 16) |
      ((rom.program[a + 2] ?? 0) << 8) |
      (rom.program[a + 3] ?? 0)) >>>
    0
  );
}

function readU8Rom(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= rom.program.length) return 0;
  return (rom.program[a] ?? 0) & 0xff;
}

/**
 * Read byte from unified address space: work RAM or ROM.
 * Replicates m68k unified addressing for entries that can live in either.
 */
function readU8Any(
  workRam: Uint8Array,
  rom: RomImage,
  addr: number,
): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + workRam.length) {
    return (workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
  }
  if (a < rom.program.length) {
    return (rom.program[a] ?? 0) & 0xff;
  }
  return 0;
}

/** Sign-extend byte (8 bit) → i32. */
function sext8(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

/** Sign-extend word (16 bit) → i32. */
function sext16(w: number): number {
  return ((w & 0xffff) << 16) >> 16;
}

// ─── Sub-function injection ───────────────────────────────────────────────────

/**
 * Bag of sub-jsr callbacks for `objectRenderUpdate1365C`.
 * Replicated callees use real defaults. Differential tests that patch these
 * ROM callees to `rts` should pass explicit no-op callbacks.
 */
export interface ObjectRenderUpdate1365CSubs {
  /**
   * `FUN_000285B0(A2, longArg)` — object fields reset / respawn helper.
   * Called as `FUN_285B0(A2, gameMode<<1 | signBit | 3)`.
   * Default delegates to `helper285B0`.
   */
  fun285B0?: (state: GameState, objPtr: number, longArg: number) => void;

  /**
   * `FUN_000158AC(longArg)` — sound command sender.
   * The long arg is the sound ID (loaded from ROM @ `0x1ef72[idx]` or
   * `0x1ef5a[idx]`). Callers read the `A0` ptr and push it via `pea (A0)`.
   * Default delegates to `soundCmdSend158AC`.
   */
  fun158AC?: (soundPtr: number) => void;

  /**
   * `FUN_00012F44(A3, 1, 0)` — slot "trigger with args" helper.
   * Called as `FUN_12F44(slotPtr, 1, 0)`.
   * Default delegates to `helper12F44`.
   */
  fun12F44?: (state: GameState, slotPtr: number, arg1: number, arg2: number) => void;

  /**
   * `FUN_00012896(A3)` — slot reinit / state update.
   * Default delegates to `helper12896`.
   */
  fun12896?: (state: GameState, slotPtr: number) => void;

  /**
   * `FUN_00013966(A2)` — post-state-change hook.
   * Called whenever `A2+0x1b` changed from its pre-call value.
   * Default delegates to `postStateChange13966`.
   */
  fun13966?: (state: GameState, objPtr: number) => void;

  /**
   * Sound command for `soundPair15884` (passed through to the inner call).
   * Default delegates to `soundCmdSend158AC`.
   */
  soundCommand?: (cmd: number) => void;
}

// ─── Core replica ─────────────────────────────────────────────────────────────

/**
 *
 *                0x1eb34, 0x1ef72, 0x1ef5a).
 *                `0x400000..0x401FFF`.
 * @param subs    Callback injection for callee overrides/parity harnesses.
 */
export function objectRenderUpdate1365C(
  state: GameState,
  rom: RomImage,
  objPtr: number,
  subs: ObjectRenderUpdate1365CSubs = {},
): void {
  const a2 = objPtr >>> 0;
  const w = state.workRam;
  const sendSound = subs.soundCommand ?? ((cmd: number): void => {
    soundCmdSend158AC(state, cmd);
  });
  const fun158AC = subs.fun158AC ?? ((cmd: number): void => {
    soundCmdSend158AC(state, cmd);
  });
  const fun12F44 = subs.fun12F44 ?? ((
    st: GameState,
    slotPtr: number,
    mode: number,
    scriptPtr: number,
  ): void => {
    helper12F44(st, rom, slotPtr, mode, scriptPtr);
  });
  const fun12896 = subs.fun12896 ?? ((st: GameState, slotPtr: number): void => {
    helper12896(st, rom, slotPtr);
  });
  const fun13966 = subs.fun13966 ?? ((st: GameState, objPtr2: number): void => {
    postStateChange13966(st, rom, objPtr2);
  });
  const fun285B0 = subs.fun285B0 ?? ((st: GameState, objPtr2: number, longArg: number): void => {
    helper285B0(st, objPtr2, longArg, rom);
  });

  // A3 = 0x400394 (game-mode word)
  const gameMode = readU16(w, GAME_MODE_ADDR); // *A3.w
  // asl.w #2, D0w → D0w = gameMode << 2 (word arithmetic; mask to 16 bit)
  const d0w = (gameMode << 2) & 0xffff;
  // movea.l (0x0, A0=0x1eb16, D0w*1), D0 → long ptr
  const entryListBase = readU32Rom(rom, (ROM_ENTRY_LIST_TABLE + d0w) >>> 0);
  // subq.l #6, D0; movea.l D0, A0
  const a0Base = (entryListBase - 6) >>> 0;

  // movea.w (0x400696).l, A1 → A1w (zero-ext from word)
  const a1w = readU16(w, POS_X_ADDR); // POS_X curr
  // movea.w (0x400698).l, A4 -> A4w
  const a4w = readU16(w, POS_Y_ADDR); // POS_Y curr
  // move.w (0x40069a).l, frame[-c] -> saved prev X
  const frameMinusC = readU16(w, POS_X_PREV_ADDR); // prev POS_X
  // move.w (0x40069c).l, frame[-a] -> saved prev Y
  const frameMinusA = readU16(w, POS_Y_PREV_ADDR); // prev POS_Y

  // ── 3. Early-exit if POS unchanged ────────────────────────────────────────
  // cmpa.w (-0xc,A6),A1 -> compare A1w with frame[-c]
  // cmpa.w (-0xa,A6),A4 -> compare A4w with frame[-a]
  if (a1w === frameMinusC && a4w === frameMinusA) {
    return; // beq.w epilogue
  }

  const d2b = readU8(w, a2 + A2_NEW_STATE_BYTE_OFF);

  // ── 5-8. Inner scan loop over ROM entries ─────────────────────────────────
  // A0 starts at entryListBase-6; each iteration does A0 += 6 at top of loop.
  // Loop jumps back to 0x136ae (addq.l #6, A0) via 0x1394a/0x13954/0x13950.

  let a0 = a0Base;

  // The main loop: we enter at the top (addq.l #6,A0), scan the entry, and
  // either: jump to 0x1394a (next entry), fall through to action, or fall
  // through to 0x13938 (post-action cleanup).
  // 0x1394a: cmpi.b #-1,(0x3,A0); bne 0x136ae; cmpi.b #-1,(0x4,A0); bne 0x136ae
  // This means the loop terminates when BOTH byte[3] and byte[4] are 0xFF (-1).

  outerLoop: while (true) {
    // addq.l #6, A0
    a0 = (a0 + 6) >>> 0;

    // Read triple: D5b = *(A0), D6b = *(A0+1), D1b = *(A0+2)
    // A0 comes from ROM long table but entries can be in work RAM or ROM.
    const d5Raw = readU8Any(w, rom, a0);
    const d6Raw = readU8Any(w, rom, a0 + 1);
    const d1Raw = readU8Any(w, rom, a0 + 2);

    // ext.w D5w, ext.w D6w, ext.w D1w — sign-extend bytes to words
    let d5w = sext8(d5Raw); // signed word
    let d6w = sext8(d6Raw); // signed word (will be abs'd)
    const d1w = sext8(d1Raw); // count (signed)

    // D3b = 0 (vertical flag)
    let d3b = 0;

    // Abs D6:
    // tst.w D6w; bge → skip neg; neg.l D0; move.w D0w, D6w
    const absD6 = d6w < 0 ? -d6w : d6w;
    d6w = absD6 & 0xffff;
    // move.w D6w, frame[-8]
    let frameM8 = d6w & 0xffff;

    // tst.w D5w; bge 0x13704 (D5 >= 0 branch)
    if (d5w < 0) {
      // D3b = 1 (vertical)
      d3b = 1;
      // Abs D5: same pattern as D6
      const absD5 = -d5w;
      // move.w D0w, frame[-8]
      frameM8 = absD5 & 0xffff;
      d5w = absD5 & 0xffff; // D5w = abs(D5)

      // Check: D6w vs A4w and frame[-a]
      // cmp.w A4w, D6w; beq 0x13710; cmp.w frame[-a], D6w; beq 0x13710; bra 0x1394a
      if (d6w !== a4w && d6w !== frameMinusA) {
        // goto 0x1394a: check sentinel bytes
        const b3 = readU8Any(w, rom, a0 + 3);
        const b4 = readU8Any(w, rom, a0 + 4);
        if (b3 === 0xff && b4 === 0xff) break outerLoop;
        continue outerLoop;
      }
    } else {
      // D5 >= 0 branch: check D5w vs A1w and frame[-c]
      d5w = d5w & 0xffff;
      // cmp.w A1w, D5w; beq 0x13710; cmp.w frame[-c], D5w; bne 0x1394a
      if (d5w !== a1w && d5w !== frameMinusC) {
        // goto 0x1394a
        const b3 = readU8Any(w, rom, a0 + 3);
        const b4 = readU8Any(w, rom, a0 + 4);
        if (b3 === 0xff && b4 === 0xff) break outerLoop;
        continue outerLoop;
      }
    }

    // ── 7. Inner scan loop (0x1371c..0x13762) ─────────────────────────────
    // clr.b D0b; move.b D0b, D4b; move.w frame[-8], frame[-6]
    let d4b = 0; // "dest found" flag
    let d0 = 0; // "src found" bit
    let frameM6 = frameM8; // scan start (frame[-6] = frame[-8])

    // bra.b 0x13762 → jump to loop condition check first
    // Loop: while (frame[-6] <= D1w)
    //   0x1371c: move.w frame[-6], frame[-2]; move.w frame[-2], frame[-4]
    //   branch based on D3b → set frame[-4] or frame[-2]
    //   check frame[-2] vs A1/A4, frame[-4] vs A4/A1 → set D4b = 1
    //   check frame[-2] vs frame[-c], frame[-4] vs frame[-a] → set D0b = 1
    //   addq.w #1, frame[-6]
    // The check at top: move.w frame[-6], D7w; cmp.w D1w, D7w; ble loop

    // We scan from frameM6 through d1w (inclusive)
    // (D1w signed — sext8 of raw byte)
    for (let scan = frameM6; sext16(scan & 0xffff) <= d1w; scan = (scan + 1) & 0xffff) {
      // 0x1371c: frame[-2] = frame[-6] (scan value)
      // 0x13722: frame[-4] = frame[-2]
      let frameM2 = scan & 0xffff;
      let frameM4 = frameM2;

      // 0x13728: tst.b D3b; beq 0x13732
      if (d3b !== 0) {
        // move.w D6w, frame[-4]
        frameM4 = d6w & 0xffff;
      } else {
        // move.w D5w, frame[-2]
        frameM2 = d5w & 0xffff;
      }

      // 0x13736: cmp frame[-2] vs A1w
      // 0x1373c: cmp frame[-4] vs A4w → if both match: D4b=1
      if (frameM2 === a1w && frameM4 === a4w) {
        d4b = 1;
      }

      // 0x13748: cmp frame[-2] vs frame[-c]
      // 0x13756: cmp frame[-4] vs frame[-a] → if both match: D0b=1
      if (frameM2 === frameMinusC && frameM4 === frameMinusA) {
        d0 = 1;
      }

      // Update frameM6 (addq.w #1)
      frameM6 = scan; // will increment at for-loop head
    }

    // ── 8. Gate: (D4==0 ? 0xFF : 0) AND D0 ───────────────────────────────
    // 0x1376a: moveq #0, D1
    // 0x1376c: tst.b D4b; seq D1b; neg.b D1b  → D1b = (D4b==0) ? 0xFF : 0
    // Actually: seq sets D1b=0xFF if D4b==0 (Z set because tst.b 0), then
    //   neg.b: 0xFF → 0x01 (−0xFF mod 256). Wait — re-read disasm:
    //   tst.b D4b → sets Z if D4b==0
    //   seq D1b → D1b = 0xFF if Z (D4b==0), else 0x00
    //   neg.b D1b → D1b = (−D1b) mod 256 → if 0xFF: −255 mod 256 = 1; if 0: 0
    // So D1b = 1 if D4b==0, else 0.
    // 0x13772: ext.w D0w; ext.l D0 (sign-extend D0b to long)
    // 0x13776: and.l D0, D1
    // 0x13778: beq 0x1394a → if (D1 & D0) == 0 → skip
    const d1Final = d4b === 0 ? 1 : 0;
    const d0ExtL = sext8(d0 & 0xff); // sign-extend D0b (0 or 1 → no sign change)
    // actually D0 accumulated as 0 or 1 — ext.w then ext.l of a 0/1 byte is still 0/1
    if ((d1Final & d0ExtL) === 0) {
      // goto 0x1394a
      const b3 = readU8Any(w, rom, a0 + 3);
      const b4 = readU8Any(w, rom, a0 + 4);
      if (b3 === 0xff && b4 === 0xff) break outerLoop;
      continue outerLoop;
    }

    // ── Write new state byte to A2+0x1b ──────────────────────────────────
    // 0x1377c: tst.b D3b; beq 0x13786
    // D3b==1 (vertical): cmpa.w D6w, A4; ble 0x1378c → low branch
    //   else → 0x13794
    // D3b==0 (horizontal): cmpa.w D5w, A1; bgt 0x13794
    //   else → 0x1378c
    // 0x1378c: move.b (0x3,A0),(0x1b,A2) — "lower" new state
    // 0x13794: move.b (0x4,A0),(0x1b,A2) — "upper" new state
    const byteAt3 = readU8Any(w, rom, a0 + 3);
    const byteAt4 = readU8Any(w, rom, a0 + 4);

    let newStateByte: number;
    if (d3b !== 0) {
      // vertical: cmpa.w D6w, A4 → compare a4w with d6w as signed words
      // ble (branch if a4w <= d6w signed) → 0x1378c
      if (sext16(a4w) <= sext16(d6w)) {
        newStateByte = byteAt3;
      } else {
        newStateByte = byteAt4;
      }
    } else {
      // horizontal: cmpa.w D5w, A1 → compare a1w with d5w
      // bgt (branch if a1w > d5w) → 0x13794
      if (sext16(a1w) > sext16(d5w)) {
        newStateByte = byteAt4;
      } else {
        newStateByte = byteAt3;
      }
    }

    writeU8(w, a2 + A2_NEW_STATE_BYTE_OFF, newStateByte);

    // ── 9. cmpi.b #-1, (0x1b,A2) → 0x1379a ─────────────────────────────
    const curNewState = readU8(w, a2 + A2_NEW_STATE_BYTE_OFF);

    if (curNewState === 0xff) {
      // 0x137a4: cmpi.b #-1, (0x4003a4).l; bne 0x137f2
      const global3a4 = readU8(w, GLOBAL_4003A4_ADDR);

      if (global3a4 === 0xff) {
        // 0x137ae: cmpi.b #2, (0x18,A2); beq 0x137f2
        const tileType = readU8(w, a2 + A2_TILE_TYPE_OFF);
        if (tileType !== 0x02) {
          // 0x137b6: move.b (0x19,A2), (0x4003a4).l
          const palIdx = readU8(w, a2 + A2_PALETTE_IDX_OFF);
          writeU8(w, GLOBAL_4003A4_ADDR, palIdx);

          // 0x137c6: ext.w D0w; ext.l D0 — D0 = sext_l(palIdx)
          let d0Arg = sext8(palIdx);

          // 0x137c8: moveq #0,D1; tst.w (A3=0x400394) → sgt D1b; neg.b D1b
          // D1b = (gameMode > 0) ? 1 : 0, then neg: D1b = (gameMode>0)?-1:0
          // as byte: (gameMode>0)?0xFF:0
          // asl.l #1, D1 → D1 = (gameMode>0) ? 0xFFFFFFFE : 0
          // add.l D1, D0 → D0 += D1
          // addq.l #4, D0
          // So: D0 = sext(palIdx) + (gameMode>0 ? -2 : 0) + 4
          //       = sext(palIdx) + 4 - 2*(gameMode>0 ? 1 : 0)
          const d1ForPush = gameMode > 0 ? -2 : 0;
          d0Arg = (d0Arg + d1ForPush + 4) | 0;
          // move.l D0, -(SP); jsr 0x26b66 — paletteQueuePush(sext(byte))
          paletteQueuePush(state, d0Arg);

          // 0x137dc: move.w (A3), D0w; ext.l D0; asl.l #1,D0; addq.l #3,D0
          // D0 = sext_l(gameMode) * 2 + 3
          const d0For285 = ((sext16(gameMode) << 1) + 3) | 0;
          // jsr 0x285b0 — FUN_285B0(A2, D0_long)
          fun285B0(state, a2, d0For285 >>> 0);
        }
      }
      // 0x137f2 (both paths converge here):
      // move.b (0x6e,A2), (0x6d,A2)
      const byte6e = readU8(w, a2 + A2_SLOT110_OFF);
      writeU8(w, a2 + A2_SLOT109_OFF, byte6e);
      // move.b #-1, (0x6e,A2)
      writeU8(w, a2 + A2_SLOT110_OFF, 0xff);

      // jsr 0x15884 — soundPair15884(state, subs)
      soundPair15884(state, { soundCommand: sendSound });

      // 0x13804: move.b #6, (0x1a,A2)
      writeU8(w, a2 + A2_STATE_BYTE_OFF, 0x06);

      // 0x1380a: tst.w (A3=0x400394); bne 0x13826
      if (gameMode === 0) {
        // 0x1380e: cmpi.b #3, D2b; beq 0x1381c
        // 0x13816: cmpi.b #4, D2b; bne 0x13826
        if (d2b === 0x03 || d2b === 0x04) {
          // 0x1381c: moveq #0,D1; move.l D1,(0x4,A2); move.l D1,(A2)
          writeU32(w, a2 + A2_VEL_X_LONG_OFF, 0);
          writeU32(w, a2 + A2_VEL_Y_LONG_OFF, 0);
          // bra 0x13858
        } else {
          // 0x13826: move.w (A3),D0w → gameMode==0 here so D0w=0
          // movea.l #0x1eb2e, A0
          // move.b (0x0,A0,D0w*1),D0b → rom[0x1eb2e + 0]
          // ext.w D0w; ext.l D0; move.l D0,D1
          // moveq #0x10,D0; asl.l D0,D1 → D1 = sext_l(byte) << 16
          // move.l D1, (A2) → A2+0x0 = vel X
          const velX = readU8Rom(rom, (ROM_VEL_X_TABLE + 0) >>> 0);
          const d1VelX = (sext8(velX) << 16) >>> 0;
          writeU32(w, a2 + A2_VEL_X_LONG_OFF, d1VelX);

          // move.w (A3),D0w → 0 again
          // movea.l #0x1eb34,A0
          // move.b (0x0,A0,D0w*1),D0b → rom[0x1eb34 + 0]
          // ext.w; ext.l; move.l D0,D1; asl.l #0x10,D1; move.l D1,(0x4,A2)
          const velY = readU8Rom(rom, (ROM_VEL_Y_TABLE + 0) >>> 0);
          const d1VelY = (sext8(velY) << 16) >>> 0;
          writeU32(w, a2 + A2_VEL_Y_LONG_OFF, d1VelY);
        }
      } else {
        // 0x13826 (gameMode != 0):
        // move.w (A3),D0w → D0w = gameMode (non-zero)
        // movea.l #0x1eb2e,A0
        // move.b (0x0,A0,D0w*1),D0b → rom[0x1eb2e + gameMode] (D0w as index)
        const gmIdx = gameMode & 0xffff;
        const velX = readU8Rom(rom, (ROM_VEL_X_TABLE + gmIdx) >>> 0);
        const d1VelX = (sext8(velX) << 16) >>> 0;
        writeU32(w, a2 + A2_VEL_X_LONG_OFF, d1VelX);

        const velY = readU8Rom(rom, (ROM_VEL_Y_TABLE + gmIdx) >>> 0);
        const d1VelY = (sext8(velY) << 16) >>> 0;
        writeU32(w, a2 + A2_VEL_Y_LONG_OFF, d1VelY);
      }

      // 0x13858: move.b #0x1e,(0x57,A2)
      writeU8(w, a2 + A2_TIMER_BYTE_OFF, 0x1e);

      // 0x1385e: move.b (0x19,A2),D0b → palIdx
      // ext.w D0w; ext.l D0; asl.l #2,D0
      // movea.l #0x1ef72,A0; movea.l (0x0,A0,D0*1),A0
      // pea (A0); jsr 0x158ac
      const palIdx2 = readU8(w, a2 + A2_PALETTE_IDX_OFF);
      const palIdxL = sext8(palIdx2); // ext.w; ext.l
      const tblAddr = (ROM_ANIM_TABLE_1EF72 + (palIdxL << 2)) >>> 0;
      const soundPtr = readU32Rom(rom, tblAddr);
      fun158AC(soundPtr);

      // bra.w 0x13938 → post-action
    } else if (curNewState === 0x04) {
      // 0x13886: cmpi.b #4,(0x1b,A2); bne.w 0x13938
      // 0x1388a: moveq #3,D1; cmp.w (A3),D1w; bne.w 0x13938
      if (gameMode !== 3) {
        // fall to 0x13938
      } else {
        // 0x13892: movea.l #0x400a9c,A3
        // clr.b D3b (loop counter)
        // Loop 25 slots (0x1389a..0x13934):
        let slotAddr = SLOT_ARRAY_BASE;

        for (let si = 0; si < SLOT_COUNT; si++, slotAddr = (slotAddr + SLOT_STRIDE) >>> 0) {
          // 0x1389a: cmpi.b #1,(0x18,A3); bne 0x1392a
          const slotTileType = readU8(w, slotAddr + S_TILE_TYPE_OFF);
          if (slotTileType !== 0x01) {
            continue;
          }

          // 0x138a4: cmpi.b #4,(0x1a,A3); bne 0x138c2
          const slotState = readU8(w, slotAddr + S_STATE_OFF);
          if (slotState === 0x04) {
            // 0x138ac: clr.l -(SP); pea (0x1).w; move.l A3,-(SP)
            // jsr 0x12f44 — FUN_12F44(A3, 1, 0)
            fun12F44(state, slotAddr, 1, 0);
            // bra 0x1392a
          } else if (slotState === 0x02) {
            // 0x138c8: cmpi.b #2,(0x1a,A3); bne 0x1392a
            // 0x138cc: cmpi.b #0xb,(0x1f,A3); bne 0x138de
            const slotKind = readU8(w, slotAddr + S_KIND_OFF);

            if (slotKind === 0x0b) {
              // 0x138d4: move.l #0x1d752,(0x36,A3)
              writeU32(w, slotAddr + S_ANIM_PTR_OFF, 0x1d752);
            } else if (slotKind === 0x0d) {
              // 0x138e6: move.l #0x1d798,(0x36,A3)
              writeU32(w, slotAddr + S_ANIM_PTR_OFF, 0x1d798);
            }

            // 0x138ee: cmpi.b #0xd,(0x1f,A3); beq 0x13900
            // 0x138f8: cmpi.b #0xb,(0x1f,A3); bne 0x1392a
            if (slotKind === 0x0b || slotKind === 0x0d) {
              // 0x13900: move.b (0x1b,A3),D0b → slot new state
              const slotNewState = readU8(w, slotAddr + S_NEW_STATE_OFF);
              // ext.w D0w; ext.l D0
              const snsSextL = sext8(slotNewState);
              // moveq #0x1e,D1; sub.l D1,D0 → D0 = sext(slotNewState) - 0x1e
              const idx158 = snsSextL - 0x1e;
              // asl.l #2, D0 → D0 = (sext(slotNewState)-0x1e) << 2
              const tblAddr158 = (ROM_ANIM_TABLE_1EF5A + (idx158 << 2)) >>> 0;
              // movea.l (0x0,A0=0x1ef5a,D0*1),A0
              const soundPtr158 = readU32Rom(rom, tblAddr158);
              // pea (A0); jsr 0x158ac
              fun158AC(soundPtr158);

              // move.l A3,-(SP); jsr 0x12896 — FUN_12896(A3)
              fun12896(state, slotAddr);
            }
          }
          // 0x1392a: moveq #0x56,D1; adda.l D1,A3 — handled by for-loop
        }
      }
    }
    // (both rami 0x1379a and 0x13880 fall through to 0x13938)

    // ── 11. Post-action: 0x13938 ──────────────────────────────────────────
    // 0x13938: cmp.b (0x1b,A2), D2b; beq 0x1395e (epilogue)
    const finalNewState = readU8(w, a2 + A2_NEW_STATE_BYTE_OFF);
    if (finalNewState !== d2b) {
      // 0x1393e: move.l A2,-(SP); jsr 0x13966; addq.l #4,SP
      fun13966(state, a2);
    }

    // Done — epilogue (0x1395e): restore registers, rts.
    return;
  }

  // Reached end of table (double 0xff sentinel) → epilogue.
}
