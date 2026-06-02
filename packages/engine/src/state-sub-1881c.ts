/**
 * state-sub-1881c.ts - port of `FUN_0001881C` (342 bytes).
 *
 * "Entity-vs-table proximity reactor". Receives an entity pointer on the stack.
 * When `entry[0x4]` and `entry[0x5]` match the "current spawn pair" globals
 * `*0x400697 / *0x400699`, it executes one of two branches:
 *
 *   1. **Math/sound branch**: when `entry[0x4]/[0x5]/[0x6]` also match
 *      `byte((long@0x400684)>>19)`, `byte((long@0x400688)>>19)`, and the word
 *      at `entity[0x14]`, then `entity[0x14]+=0xc0000`, both entity long pairs
 *      are damped with `(x>>1)+/-0x6000` via two RNG(2) draws, `entity[0x36]=2`,
 *      and sound 0x45 is played.
 *
 *   2. **Reflect branch**: when signed word distance
 *      `entity[0x14] - entry[0x6]` is less than 12, negate entity[0..3] and
 *      entity[4..7].
 *
 * `entity[0xc]=*0x400684` and `entity[0x10]=*0x400688` (long).
 *
 * Returns immediately unless mode 3 and the secondary gate are both active:
 * `if (gameMode != 3) goto exit0; if (byte760==0) goto exit0;`.
 *
 * Returns 1 (sext.w / sext.l) when at least one entry matched the first gates.
 *
 * **Disasm 0x1881C..0x18972** (342 bytes):
 *
 *   movem.l {A4 A3 A2 D7 D6 D5 D4 D3 D2}, -(SP)
 *   movea.l (0x28,SP), A2                 ; A2 = entity ptr
 *   moveq   #3, D0
 *   cmp.w   (0x00400394).l, D0w
 *   bne.w   check760                      ; if gameMode != 3 → check760
 *   tst.b   (0x00400760).l                ; (always reached if gameMode == 3)
 *   bne.b   enter_loop                    ; if byte760 != 0 → enter_loop
 *  check760:
 *   moveq   #0, D0
 *   bra.w   exit                          ; → return 0
 *  enter_loop:
 *   clr.b   D5b                           ; D5 = 0 (matched flag)
 *   move.b  (0x00400697).l, D6b
 *   move.b  (0x00400699).l, D7b
 *   movea.l D7, A4                        ; A4 = D7 (no-op alias)
 *   move.l  (0x00400684).l, D0
 *   moveq   #0x13, D1
 *   asr.l   D1, D0                        ; D0 = long@684 >> 19 (signed)
 *   move.b  D0b, D3b                      ; D3.b = byte
 *   move.l  (0x00400688).l, D0
 *   moveq   #0x13, D1
 *   asr.l   D1, D0
 *   move.b  D0b, D2b                      ; D2.b = byte((long@688) >> 19)
 *   movea.l #0x401650, A3                 ; A3 = table base
 *   clr.b   D4b                           ; D4 = 0 (loop counter)
 *  loop_top:
 *   moveq   #-1, D0
 *   cmp.w   (0x2,A3), D0w                 ; entry[0x2..0x3] (word) vs 0xFFFF
 *   bne.w   next_entry
 *   cmp.b   (0x4,A3), D6b                 ; entry[0x4] vs *0x400697
 *   bne.w   next_entry
 *   exg     D7, A4
 *   cmp.b   (0x5,A3), D7b                 ; entry[0x5] vs *0x400699 (D7 == A4)
 *   exg     D7, A4
 *   bne.w   next_entry
 *   move.l  (0x00400684).l, (0xc, A2)
 *   move.l  (0x00400688).l, (0x10, A2)
 *   cmp.b   (0x4,A3), D3b                 ; entry[0x4] vs byte((long@684)>>19)
 *   bne.w   reflect_block
 *   cmp.b   (0x5,A3), D2b
 *   bne.w   reflect_block
 *   move.w  (0x6,A3), D0w
 *   lea     (0x14,A2), A0
 *   cmp.w   (A0), D0w                     ; entry[0x6].w vs entity[0x14].w
 *   bne.w   reflect_block
 *   ; ─── math/sound branch ───────────────────────────────────────────
 *   move.l  #0x70000, (0x8,A2)
 *   addi.l  #0xc0000, (0x14,A2)
 *   pea     (0x2).w
 *   jsr     0x00013a98.l                  ; D0 = rng(2)
 *   tst.l   D0
 *   addq.l  #4, SP
 *   beq.b   neg_d1_a
 *   move.l  #0x6000, D1
 *   bra.b   apply_a
 *  neg_d1_a:
 *   move.l  #-0x6000, D1
 *  apply_a:
 *   move.l  (A2), D0                      ; entity[0..3] (long)
 *   asr.l   #1, D0                        ; D0 = entity[0..3] >> 1 (signed)
 *   add.l   D1, D0
 *   move.l  D0, (A2)
 *   pea     (0x2).w
 *   jsr     0x00013a98.l
 *   tst.l   D0
 *   addq.l  #4, SP
 *   beq.b   neg_d1_b
 *   move.l  #0x6000, D1
 *   bra.b   apply_b
 *  neg_d1_b:
 *   move.l  #-0x6000, D1
 *  apply_b:
 *   move.l  (0x4,A2), D0
 *   asr.l   #1, D0
 *   add.l   D1, D0
 *   move.l  D0, (0x4,A2)
 *   move.b  #2, (0x36,A2)
 *   pea     (0x45).l
 *   jsr     0x000158ac.l                  ; soundCommand(0x45)
 *   addq.l  #4, SP
 *   bra.b   matched
 *  reflect_block:
 *   lea     (0x14,A2), A0
 *   move.w  (A0), D0w
 *   ext.l   D0                            ; D0 = sext16(entity[0x14])
 *   move.w  (0x6,A3), D1w
 *   ext.l   D1                            ; D1 = sext16(entry[0x6])
 *   sub.l   D1, D0                        ; D0 = entity[0x14] - entry[0x6]
 *   moveq   #0xc, D1
 *   cmp.l   D0, D1                        ; D1 - D0
 *   ble.b   matched                       ; if 12 <= D0 → skip (no reflect)
 *   move.l  (A2), D0
 *   neg.l   D0
 *   move.l  D0, (A2)
 *   move.l  (0x4,A2), D0
 *   neg.l   D0
 *   move.l  D0, (0x4,A2)
 *  matched:
 *   moveq   #1, D5                        ; sticky "any match"
 *  next_entry:
 *   moveq   #0x10, D0
 *   adda.l  D0, A3                        ; A3 += 16
 *   addq.b  #1, D4b
 *   cmpi.b  #0x24, D4b                    ; 36 entries
 *   bne.w   loop_top
 *   move.b  D5b, D0b
 *   ext.w   D0w
 *   ext.l   D0                            ; result = sext(D5)
 *  exit:
 *   movem.l (SP)+, {D2 D3 D4 D5 D6 D7 A2 A3 A4}
 *   rts
 *
 * **External JSRs**:
 *   - RNG uses `rng.ts` and stays live for parity.
 *
 * **Side effects** in workRam (entity @ argAddr):
 *   - `entity[0xc..0xf]`   <- `*0x400684` (for each first match)
 *   - `entity[0x10..0x13]` <- `*0x400688` (for each first match)
 *   - math branch: `entity[0x8..0xb]=0x70000`, `entity[0x14..0x17]+=0xc0000`,
 *     `entity[0..3] = (entity[0..3] >> 1) +/- 0x6000`,
 *     `entity[0x4..0x7] = (entity[0x4..0x7] >> 1) +/- 0x6000`,
 *     `entity[0x36] = 2`.
 *   - reflect branch: `entity[0..3] = -entity[0..3]`,
 *     `entity[0x4..0x7] = -entity[0x4..0x7]`.
 *
 * **Known caller** (1 xref): `FUN_000121b8 @ 0x123ee` (UNCONDITIONAL_CALL).
 *
 */

import type { GameState } from "./state.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

// ─── Address constants (work RAM, base 0x400000) ─────────────────────────

export const GAME_MODE_OFFSET = 0x394 as const;
export const SECONDARY_GATE_OFFSET = 0x760 as const;
/** Byte: current spawn pair byte 1 (compared with entry[0x4]). */
export const SPAWN_BYTE0_OFFSET = 0x697 as const;
/** Byte: current spawn pair byte 2 (compared with entry[0x5]). */
export const SPAWN_BYTE1_OFFSET = 0x699 as const;
export const WORLD_X_OFFSET = 0x684 as const;
export const WORLD_Y_OFFSET = 0x688 as const;
export const TABLE_BASE_OFFSET = 0x1650 as const;

export const TABLE_ENTRY_COUNT = 0x24 as const; // 36
/** Byte stride of one entry. */
export const TABLE_ENTRY_STRIDE = 0x10 as const; // 16

// ─── Entity offsets ──────────────────────────────────────────────────────

export const ENTITY_LONG0_OFFSET = 0x00 as const;
export const ENTITY_LONG1_OFFSET = 0x04 as const;
/** Long: entity[0x8..0xb], set to 0x70000 in the math branch. */
export const ENTITY_LONG2_OFFSET = 0x08 as const;
/** Long: entity[0xc..0xf], overwritten with `*0x400684`. */
export const ENTITY_LONG3_OFFSET = 0x0c as const;
/** Long: entity[0x10..0x13], overwritten with `*0x400688`. */
export const ENTITY_LONG4_OFFSET = 0x10 as const;
/** Long: entity[0x14..0x17], incremented by 0xc0000 (read as word in compare). */
export const ENTITY_LONG5_OFFSET = 0x14 as const;
/** Byte: entity[0x36], set to 2 in the math branch. */
export const ENTITY_FLAG36_OFFSET = 0x36 as const;

// ─── Entry offsets (table @ 0x401650, stride 16) ─────────────────────────

/** Word: entry[0x2..0x3] (slot active flag, must == 0xFFFF). */
export const ENTRY_ACTIVE_OFFSET = 0x02 as const;
/** Byte: entry[0x4] (matched against `*0x400697` and `byte(long@684>>19)`). */
export const ENTRY_KEY_BYTE0_OFFSET = 0x04 as const;
/** Byte: entry[0x5] (matched against `*0x400699` and `byte(long@688>>19)`). */
export const ENTRY_KEY_BYTE1_OFFSET = 0x05 as const;
/** Word: entry[0x6..0x7] (matched against entity[0x14].w; reflect distance). */
export const ENTRY_KEY_WORD_OFFSET = 0x06 as const;

// ─── Magic constants ─────────────────────────────────────────────────────

export const GAME_MODE_ACTIVE = 0x0003 as const;
export const ACTIVE_SENTINEL = 0xffff as const;
export const KEY_SHIFT = 0x13 as const; // 19 bit
export const MATH_LONG2_VALUE = 0x00070000 as const;
/** Increment applied to entity[0x14..0x17] in the math branch. */
export const MATH_LONG5_INCREMENT = 0x000c0000 as const;
/** D1 magnitude (+/-0x6000) added to both damped entity long pairs. */
export const MATH_DAMP_MAGNITUDE = 0x6000 as const;
export const MATH_RNG_LIMIT = 0x0002 as const;
export const MATH_FLAG36_VALUE = 0x02 as const;
/** Sound id pushed as `pea (0x45).l; jsr 0x158ac`. */
export const MATH_SOUND_ID = 0x45 as const;
/** Signed threshold for the reflect block (`entity[0x14] - entry[0x6] < 12`). */
export const REFLECT_DISTANCE_THRESHOLD = 0x0c as const;

// ─── Sub injection ───────────────────────────────────────────────────────

export interface StateSub1881CSubs {
  soundCommand?: (cmd: number) => void;
}


export type EntryBranch = "math" | "reflect_neg" | "reflect_skip";

export interface EntryHit {
  /** Entry index (0..35). */
  index: number;
  branch: EntryBranch;
  rngSignA: number | null;
  rngSignB: number | null;
}

export interface StateSub1881CResult {
  earlyOut: boolean;
  result: number;
  hits: EntryHit[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff
  );
}

function readLongBE(state: GameState, off: number): number {
  return (
    ((state.workRam[off] ?? 0) << 24) |
    ((state.workRam[off + 1] ?? 0) << 16) |
    ((state.workRam[off + 2] ?? 0) << 8) |
    (state.workRam[off + 3] ?? 0)
  ) >>> 0;
}

function writeLongBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

/** Sign-extend 16-bit unsigned → signed JS number. */
function sext16(u: number): number {
  return ((u & 0xffff) << 16) >> 16;
}

/** RNG wrapper with `r mod limit` normalization, same as state-sub-1960e. */
function rng(state: GameState, limit: number): number {
  let r = rngNext(state.rng, as_u16(limit)) as unknown as number;
  if (limit > 0) {
    while (r >= limit) r -= limit;
  }
  return r & 0xffff;
}

// ─── Port ────────────────────────────────────────────────────────────────

/**
 *
 *                    `state.rng.seed`).
 *                    work RAM as `entityAddr - 0x400000`.
 * @param subs        Injection callbacks (default no-op). `subs.soundCommand(0x45)`
 *
 *
 *      RNG(2)#1, entity[0..3] update, RNG(2)#2, entity[4..7] update,
 *      entity[0x36], soundCommand).
 *   3. Reflect branch: only if signed word distance is less than 12; negate
 *      entity[0..3], then entity[0x4..0x7].
 */
export function stateSub1881C(
  state: GameState,
  entityAddr: number,
  subs?: StateSub1881CSubs,
): StateSub1881CResult {
  const off = (entityAddr - 0x400000) >>> 0;

  // ─── Early-out gate ─────────────────────────────────────────────────
  // Disasm:
  //   moveq #3, D0; cmp.w (0x400394).l, D0w; bne check760
  //   tst.b (0x400760).l; bne enter_loop
  //  check760: moveq #0, D0; bra exit
  //
  //
  //   enter loop iff (gameMode == 3 AND byte760 != 0).
  const gameMode = readWordBE(state, GAME_MODE_OFFSET);
  const byte760 = readByte(state, SECONDARY_GATE_OFFSET);
  if (gameMode !== GAME_MODE_ACTIVE || byte760 === 0) {
    return { earlyOut: true, result: 0, hits: [] };
  }

  // ─── Pre-loop: load globals ─────────────────────────────────────────
  const d6 = readByte(state, SPAWN_BYTE0_OFFSET); // *0x400697
  const d7 = readByte(state, SPAWN_BYTE1_OFFSET); // *0x400699 (== A4 alias)

  const long684 = readLongBE(state, WORLD_X_OFFSET);
  const long688 = readLongBE(state, WORLD_Y_OFFSET);

  // asr.l #0x13, D0 — arithmetic shift right by 19 (signed); take low byte.
  // long684 / long688 are read unsigned u32; convert to signed i32 (|0) before >>.
  const d3 = (((long684 | 0) >> KEY_SHIFT) | 0) & 0xff; // byte((long@684 >> 19))
  const d2 = (((long688 | 0) >> KEY_SHIFT) | 0) & 0xff; // byte((long@688 >> 19))

  const hits: EntryHit[] = [];
  let d5 = 0; // sticky "any match" flag

  // ─── Loop ───────────────────────────────────────────────────────────
  for (let i = 0; i < TABLE_ENTRY_COUNT; i++) {
    const entryOff = TABLE_BASE_OFFSET + i * TABLE_ENTRY_STRIDE;

    // First gate: entry[0x2..0x3] (word) == 0xFFFF
    const activeWord = readWordBE(state, entryOff + ENTRY_ACTIVE_OFFSET);
    if (activeWord !== ACTIVE_SENTINEL) continue;

    // Second gate: entry[0x4] == d6 (= *0x400697)
    const entryB0 = readByte(state, entryOff + ENTRY_KEY_BYTE0_OFFSET);
    if (entryB0 !== d6) continue;

    // Third gate: entry[0x5] == d7 (= *0x400699)
    const entryB1 = readByte(state, entryOff + ENTRY_KEY_BYTE1_OFFSET);
    if (entryB1 !== d7) continue;

    writeLongBE(state, off + ENTITY_LONG3_OFFSET, long684);
    writeLongBE(state, off + ENTITY_LONG4_OFFSET, long688);

    let branch: EntryBranch;
    let rngSignA: number | null = null;
    let rngSignB: number | null = null;

    const entryWord6 = readWordBE(state, entryOff + ENTRY_KEY_WORD_OFFSET);
    const entityWord14 = readWordBE(state, off + ENTITY_LONG5_OFFSET);

    if (entryB0 === d3 && entryB1 === d2 && entryWord6 === entityWord14) {
      // ─── Math/sound branch ────────────────────────────────────────
      branch = "math";

      // entity[0x8..0xb] = 0x70000
      writeLongBE(state, off + ENTITY_LONG2_OFFSET, MATH_LONG2_VALUE);

      // entity[0x14..0x17] += 0xc0000  (read u32, add, write u32 wrap-around)
      const long5Old = readLongBE(state, off + ENTITY_LONG5_OFFSET);
      const long5New = (long5Old + MATH_LONG5_INCREMENT) >>> 0;
      writeLongBE(state, off + ENTITY_LONG5_OFFSET, long5New);

      // RNG(2) #1.
      // Preserves D0.high (`move.w` -> only .w; `and.w` -> only .w). On entry:
      //   - D0.high = 0xFFFF (set by `moveq -0x1, D0` at the top of the loop)
      rngSignA = rng(state, MATH_RNG_LIMIT);
      const d0AfterRngA = ((0xffff << 16) | (rngSignA & 0xffff)) | 0;
      const d1a = d0AfterRngA === 0 ? -MATH_DAMP_MAGNITUDE : MATH_DAMP_MAGNITUDE;

      // entity[0..3] = (entity[0..3] >> 1 signed) + d1  (i32 wrap)
      // The second rng JSR — its HIGH word determines the `tst.l` check.
      const long0 = readLongBE(state, off + ENTITY_LONG0_OFFSET);
      const long0New = (((long0 | 0) >> 1) + d1a) | 0;
      writeLongBE(state, off + ENTITY_LONG0_OFFSET, long0New >>> 0);

      // ── RNG(2) #2 ──────────────────────────────────────────────────
      // D0 entering second rng = long0New (32-bit). FUN_13A98 preserves D0.high.
      // After JSR: D0 = (long0New & 0xFFFF0000) | rngSignB.
      // tst.l → zero iff (long0New & 0xFFFF0000) == 0 AND rngSignB == 0.
      rngSignB = rng(state, MATH_RNG_LIMIT);
      const d0AfterRngB = ((long0New & 0xffff0000) | (rngSignB & 0xffff)) | 0;
      const d1b = d0AfterRngB === 0 ? -MATH_DAMP_MAGNITUDE : MATH_DAMP_MAGNITUDE;

      const long1 = readLongBE(state, off + ENTITY_LONG1_OFFSET);
      const long1New = (((long1 | 0) >> 1) + d1b) | 0;
      writeLongBE(state, off + ENTITY_LONG1_OFFSET, long1New >>> 0);

      // entity[0x36] = 2
      writeByte(state, off + ENTITY_FLAG36_OFFSET, MATH_FLAG36_VALUE);

      // soundCommand(0x45)
      subs?.soundCommand?.(MATH_SOUND_ID);
    } else {
      // ─── Reflect block ───────────────────────────────────────────
      // dist = sext16(entity[0x14]) - sext16(entry[0x6])
      // if 12 <= dist (signed) → skip (no negate)
      // else → negate entity[0..3] and entity[4..7]
      const dist = (sext16(entityWord14) - sext16(entryWord6)) | 0;
      if (REFLECT_DISTANCE_THRESHOLD <= dist) {
        branch = "reflect_skip";
      } else {
        branch = "reflect_neg";
        const long0 = readLongBE(state, off + ENTITY_LONG0_OFFSET);
        writeLongBE(state, off + ENTITY_LONG0_OFFSET, (-(long0 | 0)) >>> 0);
        const long1 = readLongBE(state, off + ENTITY_LONG1_OFFSET);
        writeLongBE(state, off + ENTITY_LONG1_OFFSET, (-(long1 | 0)) >>> 0);
      }
    }

    hits.push({ index: i, branch, rngSignA, rngSignB });
    d5 = 1; // sticky
  }

  // ─── Return: ext.w(D5b) → ext.l(D0w) ────────────────────────────────
  // D5 is 0 or 1 (clr.b/moveq.l #1), so sext is identity. result ∈ {0, 1}.
  return { earlyOut: false, result: d5, hits };
}
