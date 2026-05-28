/**
 * state-sub-186ac.ts - port of `FUN_000186AC` (368 bytes).
 *
 * "Mode-3 entity scan + slot-table init/teardown" around the sentinel byte
 * `*0x400394 == 3` (mode 3, distinct from the mode-4 path in `bbox-hit-test-19d94`).
 *
 *      stride `0xE2` @ `0x400018` for `*0x400396` slots. D1 (boolean flag)
 *      becomes 1 when any object satisfies
 *      `obj[0x18] == 1 && (obj[0x1B] == 4 || obj[0x1B] == 5)`.
 *   2. **Branch on sentinel** `*0x400760`:
 *      - **(sentinel == 0 && hasArmed)**: **INIT path**. Chooses a variant via
 *        RNG for entries D2 >= 0x18, then fills 0x24 entries x 0x10 bytes from
 *        `0x401650`:
 *          entry[0]   = D2 (byte)
 *          entry[2..3]= u16 BE from ROM[0x242C6 + D2*2] when D2 < 0x18
 *          entry[4]   = byte ROM[0x24406 + D2]
 *          entry[5]   = byte ROM[0x2442A + D2]
 *          (call FUN_1BB28(entryAddr))
 *          entry[6..7]= u16 BE da ROM[0x2444E + D2*2]
 *        The teardown selector is stored and `*0x400760 = 1`.
 *      - **(sentinel != 0 && !hasArmed)**: **TEARDOWN path**. For each entry:
 *          entry[2..3] = 0   (u16)
 *          entry[4]    = 0   (byte)
 *          entry[5]    = 0   (byte)
 *          entry[6..7] = 0   (u16)
 *        At the end, `*0x400760 = 0`.
 *      - Any other sentinel/armed combination is a no-op that goes to epilogue.
 *
 * **Disasm 0x000186AC..0x0001881A** (368 byte):
 *
 *   movem.l {D2,D3,D4,A2,A3,A4},-(SP)        ; save regs (24 bytes)
 *   movea.l #0x400760,A3                     ; A3 = sentinel addr
 *   movea.l #0x400764,A4                     ; A4 = pointer-long addr
 *   moveq   #3,D0
 *   cmp.w   (0x00400394).l,D0w               ; D0 == game_mode?
 *   bne.w   epilogue                         ; mode != 3 → exit (NOP)
 *
 *   movea.l #0x400018,A0                     ; A0 = obj base
 *   clr.b   D1b                              ; D1 = "hasArmed" flag
 *   clr.b   D2b                              ; D2 = scan idx
 *   bra.b   scan_test
 *
 * scan_body:                                 ; @ 0x186D4
 *   cmpi.b  #1,(0x18,A0)                     ; obj[0x18] == 1?
 *   bne.b   advance
 *   cmpi.b  #4,(0x1B,A0)                     ; obj[0x1B] == 4?
 *   beq.w   set_flag
 *   cmpi.b  #5,(0x1B,A0)                     ; obj[0x1B] == 5?
 *   bne.b   advance
 * set_flag:                                  ; @ 0x186EE
 *   moveq   #1,D1                            ; D1 = 1 (ANY armed found)
 * advance:                                   ; @ 0x186F0
 *   move.l  A0,D4
 *   addi.l  #0xE2,D4
 *   movea.l D4,A0                            ; A0 += 0xE2
 *   addq.b  #1,D2b
 * scan_test:                                 ; @ 0x186FC
 *   move.b  D2b,D0b
 *   ext.w   D0w
 *   cmp.w   (0x00400396).l,D0w               ; D0 == count?
 *   bne.b   scan_body
 *
 *   tst.b   (A3)                             ; sentinel != 0?
 *   bne.w   teardown_check                   ; → teardown path
 *   tst.b   D1b                              ; hasArmed?
 *
 *   ; ─── INIT path ────────────────────────────────────────────────────────
 *   movea.l #0x401650,A2                     ; A2 = slot-table base
 *   pea     (0x4).w
 *   jsr     0x00013A98.l                     ; D0 = rng(4) ∈ [0..3]
 *   move.b  D0b,D3b                          ; D3 = variant
 *   move.b  D3b,D0b
 *   ext.w   D0w
 *   asl.w   #2,D0w                           ; D0 = D3 * 4
 *   movea.l #0x243E6,A0
 *   move.l  (0,A0,D0w*1),(A4)                ; *A4 = ROM[0x243E6 + D3*4]
 *   clr.b   D2b
 *   addq.l  #4,SP                            ; pop pea(4)
 *
 * init_body:                                 ; @ 0x1873A
 *   move.b  D2b,(A2)                         ; entry[0] = D2
 *   cmpi.b  #0x18,D2b
 *   bge.b   sec_path                         ; D2 >= 0x18 → secondary base
 *   ; primary path D2 ∈ [0..0x17]
 *   move.b  D2b,D0b
 *   ext.w   D0w
 *   add.w   D0w,D0w                          ; D0 = D2 * 2
 *   movea.l #0x242C6,A0
 *   move.w  (0,A0,D0w*1),(0x2,A2)            ; entry[2..3] = ROM_u16[0x242C6 + D2*2]
 *   bra.b   common
 * sec_path:                                  ; @ 0x18756
 *   move.b  D2b,D0b
 *   ext.w   D0w
 *   ext.l   D0
 *   moveq   #0x18,D1
 *   sub.l   D1,D0                            ; D0 = D2 - 0x18
 *   add.l   D0,D0                            ; D0 = (D2-0x18) * 2
 *   movea.l D0,A0
 *   adda.l  (A4),A0                          ; A0 = *A4 + (D2-0x18) * 2
 *   move.w  (A0),(0x2,A2)                    ; entry[2..3] = u16 BE @ A0
 * common:                                    ; @ 0x1876A
 *   move.b  D2b,D0b
 *   ext.w   D0w
 *   movea.l #0x24406,A0
 *   move.b  (0,A0,D0w*1),(0x4,A2)            ; entry[4] = ROM[0x24406 + D2]
 *   move.b  D2b,D0b
 *   ext.w   D0w
 *   movea.l #0x2442A,A0
 *   move.b  (0,A0,D0w*1),(0x5,A2)            ; entry[5] = ROM[0x2442A + D2]
 *   move.l  A2,-(SP)
 *   jsr     0x0001BB28.l                     ; FUN_1BB28(entryAddr)
 *   move.b  D2b,D0b
 *   ext.w   D0w
 *   add.w   D0w,D0w
 *   movea.l #0x2444E,A0
 *   move.w  (0,A0,D0w*1),(0x6,A2)            ; entry[6..7] = ROM_u16[0x2444E + D2*2]
 *   moveq   #0x10,D0
 *   adda.l  D0,A2                            ; A2 += 0x10
 *   addq.l  #4,SP                            ; pop pushed A2
 *   addq.b  #1,D2b
 *   cmpi.b  #0x24,D2b
 *   bne.b   init_body                        ; loop while D2 != 0x24
 *
 *   move.b  D3b,D0b
 *   ext.w   D0w
 *   asl.w   #2,D0w                           ; D0 = D3 * 4
 *   movea.l #0x243F6,A0
 *   move.l  (0,A0,D0w*1),(A4)                ; *A4 = ROM[0x243F6 + D3*4]
 *   move.b  #1,(A3)                          ; sentinel = 1
 *   bra.b   epilogue
 *
 * teardown_check:                            ; @ 0x187C8
 *   tst.b   D1b
 *   tst.b   (A3)
 *
 *   ; ─── TEARDOWN path ───────────────────────────────────────────────────
 *   movea.l #0x401650,A2
 *   clr.b   D2b
 * teardown_body:                             ; @ 0x187D8
 *   moveq   #-1,D0
 *   cmp.w   (0x2,A2),D0w                     ; entry[2..3] == 0xFFFF?
 *   bne.b   teardown_clear                   ; no → skip the call
 *   move.b  (A2),D0b
 *   ext.w   D0w
 *   ext.l   D0                               ; D0 = sext_l(entry[0])
 *   move.l  D0,-(SP)                         ; arg2
 *   pea     (0x29).w                         ; arg1 = sext_l(0x29) = 0x29
 *   jsr     0x00018F46.l                     ; FUN_18F46(0x29, sext_l(entry[0]))
 *   addq.l  #8,SP
 * teardown_clear:                            ; @ 0x187F4
 *   clr.w   D0w
 *   move.w  D0w,(0x6,A2)                     ; entry[6..7] = 0
 *   move.b  D0b,(0x5,A2)                     ; entry[5] = 0
 *   move.b  D0b,(0x4,A2)                     ; entry[4] = 0
 *   ext.w   D0w
 *   move.w  D0w,(0x2,A2)                     ; entry[2..3] = 0
 *   moveq   #0x10,D0
 *   adda.l  D0,A2                            ; A2 += 0x10
 *   addq.b  #1,D2b
 *   cmpi.b  #0x24,D2b
 *   bne.b   teardown_body
 *   clr.b   (A3)                             ; sentinel = 0
 *
 * epilogue:                                  ; @ 0x18816
 *   movem.l (SP)+,{A4,A3,A2,D4,D3,D2}
 *   rts
 *
 * **Touched globals (workRam offsets relative to 0x400000)**:
 *   - `*0x394` (word) game_mode (read).
 *   - `*0x396` (word) object count (read).
 *   - `*0x760` (byte) sentinel (read/write).
 *   - `*0x764..0x767` (long) selector ptr (written in the INIT path).
 *   - `*0x1650..0x188F` (576 byte) slot-table 0x24 entries × 0x10 byte
 *
 * **ROM tables** (read-only, in `RomImage.program`):
 *   - `0x242C6` u16 BE × 0x18 entries — primary table for entry[2..3].
 *   - `0x24406` byte × 0x24 — table for entry[4].
 *   - `0x2442A` byte × 0x24 — table for entry[5].
 *   - `0x2444E` u16 BE × 0x24 — table for entry[6..7].
 *   - `0x243E6` long BE × 4 — selector pointers (init).
 *   - `0x243F6` long BE × 4 — selector pointers (post-init / teardown).
 *
 * **External JSRs** (via `StateSub186ACSubs`):
 *   - `FUN_0001BB28` is called 0 or 0x24 times (once per entry, INIT only).
 *   - `FUN_00018F46` is called 0..0x24 times (TEARDOWN only, gated by
 *     `entry[2..3] == 0xFFFF`).
 *
 * **Known caller** (1 xref): `FUN_00013966 @ 0x13A16`.
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

// ─── Address constants (workRam offsets relative to 0x400000) ─────────────

/** WORK RAM base (absolute M68k address). */
export const WORK_RAM_BASE = 0x00400000 as const;

/** Sentinel byte: `*0x400760` (init-done flag). */
export const SENTINEL_ADDR = 0x00400760 as const;
/** Pointer-long: `*0x400764..0x400767` (secondary selector base). */
export const SELECTOR_PTR_ADDR = 0x00400764 as const;
/** Word: `*0x400394` game-mode discriminator. */
export const GAME_MODE_ADDR = 0x00400394 as const;
/** Word: `*0x400396` object count. */
export const OBJ_COUNT_ADDR = 0x00400396 as const;
export const OBJ_BASE_ADDR = 0x00400018 as const;
/** Stride object struct. */
export const OBJ_STRIDE = 0xe2 as const;
/** Slot-table base: `0x401650`. */
export const SLOT_TABLE_ADDR = 0x00401650 as const;
/** Slot-table entry stride. */
export const SLOT_ENTRY_STRIDE = 0x10 as const;
/** Number of slot-table entries. */
export const SLOT_ENTRY_COUNT = 0x24 as const;
/** Cutoff index for the primary/secondary path. */
export const SECONDARY_PATH_CUTOFF = 0x18 as const;

/** Required game mode before the function can continue. */
export const REQUIRED_GAME_MODE = 0x0003 as const;

/** Object field: `(0x18,A0)`. */
export const OBJ_STATE_OFF = 0x18 as const;
/** Object field: `(0x1B,A0)`. */
export const OBJ_SUBSTATE_OFF = 0x1b as const;
export const OBJ_ARMED_STATE = 0x01 as const;
export const OBJ_ARMED_SUBSTATE_A = 0x04 as const;
export const OBJ_ARMED_SUBSTATE_B = 0x05 as const;

// ─── ROM tables ──────────────────────────────────────────────────────────

/** ROM u16 BE x 0x18 - primary table for entry[2..3]. */
export const ROM_TABLE_PRIMARY_W16 = 0x000242c6 as const;
/** ROM byte x 0x24 - table for entry[4]. */
export const ROM_TABLE_BYTE_4 = 0x00024406 as const;
/** ROM byte x 0x24 - table for entry[5]. */
export const ROM_TABLE_BYTE_5 = 0x0002442a as const;
/** ROM u16 BE x 0x24 - table for entry[6..7]. */
export const ROM_TABLE_W16_67 = 0x0002444e as const;
/** ROM long BE x 4 - selector pointers (init). */
export const ROM_SELECTOR_INIT = 0x000243e6 as const;
/** ROM long BE x 4 - selector pointers (post-init). */
export const ROM_SELECTOR_POST = 0x000243f6 as const;

// ─── Variant constants ───────────────────────────────────────────────────

/** Variant count = `rng(4)`. */
export const VARIANT_RNG_LIMIT = 0x4 as const;

/** Sentinel value written in the init path. */
export const SENTINEL_INIT_VALUE = 0x01 as const;

/** `0xFFFF` marker in entry[2..3] that gates the FUN_18F46 call. */
export const TEARDOWN_TRIGGER_WORD = 0xffff as const;

/** FUN_18F46 arg1 constant (`pea (0x29).w`). */
export const FUN_18F46_ARG1 = 0x29 as const;

// ─── Sub injection types ─────────────────────────────────────────────────

/**
 * Stub injection for the two external JSRs.
 *
 * - `fun_1bb28(entryAddr, state)`: called 0 or 0x24 times (init path,
 *   once per entry). Receives the absolute long address of the current entry slot
 *   (`SLOT_TABLE_ADDR + i*SLOT_ENTRY_STRIDE`).
 * - `fun_18f46(arg1Long, arg2Long, state)`: called 0..0x24 times
 *   (teardown path, gated by `entry[2..3] == 0xFFFF`). Receives
 *   `arg1Long = 0x29` (constant) and `arg2Long = sext_l(entry[0])`.
 *
 */
export interface StateSub186ACSubs {
  /** FUN_1BB28(entryAddrLong, state). */
  fun_1bb28?: (entryAddrLong: number, state: GameState) => void;
  /** FUN_18F46(arg1=0x29, arg2=sext_l(entry[0]), state). */
  fun_18f46?: (arg1Long: number, arg2Long: number, state: GameState) => void;
}


export type Branch = "early_exit" | "init" | "teardown" | "noop";

export interface StateSub186ACResult {
  /** Branch that executed. */
  branch: Branch;
  /** True when `*0x400394 == 3` (gate passed). */
  modeMatched: boolean;
  /** True when any object has (state==1 && sub in {4,5}). */
  hasArmed: boolean;
  sentinelBefore: number;
  variant: number;
  fun1BB28Calls: number;
  fun18F46Calls: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function writeWordBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function writeLongBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

function romReadByte(rom: RomImage, off: number): number {
  return (rom.program[off] ?? 0) & 0xff;
}

function romReadWordBE(rom: RomImage, off: number): number {
  return (((rom.program[off] ?? 0) << 8) | (rom.program[off + 1] ?? 0)) & 0xffff;
}

function romReadLongBE(rom: RomImage, off: number): number {
  return (
    ((rom.program[off] ?? 0) << 24) |
    ((rom.program[off + 1] ?? 0) << 16) |
    ((rom.program[off + 2] ?? 0) << 8) |
    (rom.program[off + 3] ?? 0)
  ) >>> 0;
}

/**
 * Wrapper around `rngNext` with the same normalization used by the original:
 * `r` is reduced to [0, limit), while default `rngNext` produces [0, limit].
 */
function rng(state: GameState, limit: number): number {
  let r = rngNext(state.rng, as_u16(limit)) as unknown as number;
  if (limit > 0) {
    while (r >= limit) r -= limit;
  }
  return r & 0xffff;
}

/**
 */
function readWordAbs(state: GameState, rom: RomImage, addrLong: number): number {
  const a = addrLong >>> 0;
  if (a >= WORK_RAM_BASE && a + 1 < WORK_RAM_BASE + state.workRam.length) {
    return readWordBE(state, a - WORK_RAM_BASE);
  }
  // ROM (program area).
  return romReadWordBE(rom, a);
}

// ─── Port ────────────────────────────────────────────────────────────────

/**
 *
 * @param state  GameState. Reads `workRam[0x394..0x395]`,
 *               sentinel @ `0x760`, selector ptr @ `0x764..0x767`,
 *               slot-table @ `0x1650..0x188F`. Writes are described in the
 *               init and teardown sections in this module JSDoc.
 *
 * @returns Branch detail plus external JSR counters.
 *
 *   1. `entry[0] = D2`
 *   2. `entry[2..3] = ROM_u16[primary or secondary]`
 *   3. `entry[4] = ROM_byte[0x24406 + D2]`
 *   4. `entry[5] = ROM_byte[0x2442A + D2]`
 *   6. `entry[6..7] = ROM_u16[0x2444E + D2*2]`
 *
 *     unchanged).
 *   - Then: `entry[6..7] = 0`, `entry[5] = 0`, `entry[4] = 0`, `entry[2..3] = 0`.
 */
export function stateSub186AC(
  state: GameState,
  rom: RomImage,
  subs?: StateSub186ACSubs,
): StateSub186ACResult {
  const r = state.workRam;

  const result: StateSub186ACResult = {
    branch: "noop",
    modeMatched: false,
    hasArmed: false,
    sentinelBefore: 0,
    variant: -1,
    fun1BB28Calls: 0,
    fun18F46Calls: 0,
  };

  // ─── Gate game_mode == 3 ─────────────────────────────────────────────
  const modeOff = GAME_MODE_ADDR - WORK_RAM_BASE;
  const gameMode = (((r[modeOff] ?? 0) << 8) | (r[modeOff + 1] ?? 0)) & 0xffff;
  if (gameMode !== REQUIRED_GAME_MODE) {
    result.branch = "early_exit";
    return result;
  }
  result.modeMatched = true;

  // ─── Entity scan: hasArmed = any entity with state==1 && sub in {4,5} ────
  const countOff = OBJ_COUNT_ADDR - WORK_RAM_BASE;
  const count = (((r[countOff] ?? 0) << 8) | (r[countOff + 1] ?? 0)) & 0xffff;
  // sext.w is positive for 0..0x7F; counts are normally small here.
  let hasArmed = false;
  let objAddr = OBJ_BASE_ADDR >>> 0;
  for (let i = 0; i < count; i++) {
    const objStateOff = (objAddr + OBJ_STATE_OFF) - WORK_RAM_BASE;
    const objSubOff = (objAddr + OBJ_SUBSTATE_OFF) - WORK_RAM_BASE;
    const objState = (r[objStateOff] ?? 0) & 0xff;
    if (objState === OBJ_ARMED_STATE) {
      const objSub = (r[objSubOff] ?? 0) & 0xff;
      if (objSub === OBJ_ARMED_SUBSTATE_A || objSub === OBJ_ARMED_SUBSTATE_B) {
        hasArmed = true;
      }
    }
    objAddr = (objAddr + OBJ_STRIDE) >>> 0;
  }
  result.hasArmed = hasArmed;

  // ─── Branch on sentinel ───────────────────────────────────────────────
  const sentinelOff = SENTINEL_ADDR - WORK_RAM_BASE;
  const sentinel = (r[sentinelOff] ?? 0) & 0xff;
  result.sentinelBefore = sentinel;

  if (sentinel === 0 && hasArmed) {
    // ─── INIT path ──────────────────────────────────────────────────────
    result.branch = "init";

    // D3 = rng(4) ∈ [0..3]
    const variant = rng(state, VARIANT_RNG_LIMIT) & 0xff;
    result.variant = variant;

    // *A4 = ROM long BE @ (0x243E6 + D3 * 4)
    const initSelector = romReadLongBE(rom, ROM_SELECTOR_INIT + variant * 4);
    const selectorOff = SELECTOR_PTR_ADDR - WORK_RAM_BASE;
    writeLongBE(state, selectorOff, initSelector);

    // Loop D2 ∈ [0..0x24)
    let entryAddr = SLOT_TABLE_ADDR >>> 0;
    for (let d2 = 0; d2 < SLOT_ENTRY_COUNT; d2++) {
      const entryOff = entryAddr - WORK_RAM_BASE;

      // entry[0] = D2 (byte)
      writeByte(state, entryOff + 0, d2);

      // entry[2..3]
      let w23: number;
      if (d2 < SECONDARY_PATH_CUTOFF) {
        // primary: ROM u16 BE @ (0x242C6 + D2*2)
        w23 = romReadWordBE(rom, ROM_TABLE_PRIMARY_W16 + d2 * 2);
      } else {
        // secondary: u16 BE @ (*A4 + (D2 - 0x18) * 2)
        const selectorPtr =
          (((r[selectorOff] ?? 0) << 24) |
            ((r[selectorOff + 1] ?? 0) << 16) |
            ((r[selectorOff + 2] ?? 0) << 8) |
            (r[selectorOff + 3] ?? 0)) >>> 0;
        const secAddr = (selectorPtr + (d2 - SECONDARY_PATH_CUTOFF) * 2) >>> 0;
        w23 = readWordAbs(state, rom, secAddr);
      }
      writeWordBE(state, entryOff + 2, w23);

      // entry[4] = ROM byte @ (0x24406 + D2)
      writeByte(state, entryOff + 4, romReadByte(rom, ROM_TABLE_BYTE_4 + d2));
      // entry[5] = ROM byte @ (0x2442A + D2)
      writeByte(state, entryOff + 5, romReadByte(rom, ROM_TABLE_BYTE_5 + d2));

      subs?.fun_1bb28?.(entryAddr, state);
      result.fun1BB28Calls++;

      // entry[6..7] = ROM u16 BE @ (0x2444E + D2*2)
      writeWordBE(
        state,
        entryOff + 6,
        romReadWordBE(rom, ROM_TABLE_W16_67 + d2 * 2),
      );

      entryAddr = (entryAddr + SLOT_ENTRY_STRIDE) >>> 0;
    }

    // *A4 = ROM long BE @ (0x243F6 + D3 * 4)
    const postSelector = romReadLongBE(rom, ROM_SELECTOR_POST + variant * 4);
    writeLongBE(state, selectorOff, postSelector);

    // sentinel = 1
    writeByte(state, sentinelOff, SENTINEL_INIT_VALUE);
    return result;
  }

  if (!hasArmed && sentinel !== 0) {
    // ─── TEARDOWN path ──────────────────────────────────────────────────
    result.branch = "teardown";

    let entryAddr = SLOT_TABLE_ADDR >>> 0;
    for (let d2 = 0; d2 < SLOT_ENTRY_COUNT; d2++) {
      const entryOff = entryAddr - WORK_RAM_BASE;

      // Gate: cmp.w entry[2..3] with -1 (0xFFFF).
      const entryWord = readWordBE(state, entryOff + 2);
      if (entryWord === TEARDOWN_TRIGGER_WORD) {
        // FUN_18F46(0x29, sext_l(entry[0]))
        const byte0 = readByte(state, entryOff + 0);
        const arg2 = (((byte0 & 0xff) << 24) >> 24) >>> 0;
        subs?.fun_18f46?.(FUN_18F46_ARG1, arg2, state);
        result.fun18F46Calls++;
      }

      writeWordBE(state, entryOff + 6, 0);
      writeByte(state, entryOff + 5, 0);
      writeByte(state, entryOff + 4, 0);
      writeWordBE(state, entryOff + 2, 0);

      entryAddr = (entryAddr + SLOT_ENTRY_STRIDE) >>> 0;
    }

    // sentinel = 0
    writeByte(state, sentinelOff, 0);
    return result;
  }

  // (sentinel == 0 && !hasArmed) || (sentinel != 0 && hasArmed) → no-op
  result.branch = "noop";
  return result;
}
