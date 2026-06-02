/**
 * state-sub-16a20.ts — replica `FUN_0001016A20` (1134 byte,
 * 0x016A20..0x016E8E).
 *
 * @ `0x400018` (stride `0xE2`, count `*0x400396`) in four phases:
 *
 * **Phase 1 - scan (D4 / A0 setup)**:
 *   Loop D2 in [0..count): for each entity:
 *     - If `entity[0x18] == 1`, D4 += 1 and A0 = entity (via `beq.w 0x16a54`).
 *     - If `entity[0x18] == 3`, D4 += 1 and A0 = entity (via fall-through).
 *   -> D4 counts entities with state==1 OR state==3.
 *   If D4==0, dispatch sound based on game mode (`*0x400394`):
 *     - mode==3 -> soundCmd(0xF), soundCmd(0x11)
 *     - mode==4 -> soundCmd(0x17), soundCmd(0x15)
 *
 * **Phase 2 - display loop (state==2 entities)**:
 *   Loop D2 in [0..count): for each entity:
 *     - `entity[0x6d] = entity[0x6e]`, `entity[0x6e] = 0xFF`.
 *     - If `entity[0x18] != 2`, skip to advance.
 *     - If mode==4, `*0x400654 += 1`.
 *     - If mode==5, `*0x400656 += 1`.
 *     - `soundPair15884()`.
 *     - If `entity[0x36] == 2`, soundCmd(0x46).
 *     - If `entity[0x58] == 0x10`, soundCmd(0x44).
 *     - D5 = ROM[0x2399c + (count + D2 - 1) & 0xFFFF] (byte).
 *     - D6 = (D2 != 0) ? 0x2400 : 0x2000.
 *     - If count == 2:
 *         renderStr(0x22E96, D5, 0x16, D6)
 *         renderStr(ROM[0x1EEF0 + D2*4], D5, 0x17, D6)
 *     - renderStr(0x22E96, D5, 0x18, D6)
 *     - renderStr(0x22E8E, D5, 0x19, D6)
 *     - renderStr(0x22E96, D5, 0x1A, D6)
 *     - renderStr(0x22E92, D5, 0x1B, D6)
 *     - renderStr(0x22E96, D5, 0x1C, D6)
 *   Post-loop: `waitVblankStateGated(0xB4)`, `clearDisplayRows(0x14)`.
 *
 * **Phase 3 - secondary loop (state==1 entities, gated by D4==1)**:
 *   Loop D2 in [0..count): for each entity:
 *     - If `entity[0x18] != 1`, skip.
 *     - If `D4 != 1`, skip.
 *     - D5 = ROM[0x2399c + (count + D2 - 1) & 0xFFFF].
 *     - D6 = (D2 != 0) ? 0x2400 : 0x2000.
 *     - renderStr(0x22E96, D5, 0x18, D6)
 *     - renderStr(ROM[0x1EEF0 + D2*4], D5, 0x19, D6)
 *     - renderStr(0x22E96, D5, 0x1A, D6)
 *     - renderStr(0x22EA6, D5, 0x1B, D6)
 *     - renderStr(0x22E96, D5, 0x1C, D6)
 *     - `waitVblankStateGated(0x3C)`
 *     - renderStr(0x22EAA, D5, 0x1B, D6)
 *     - `waitVblankStateGated(0x3C)`
 *     - renderStr(0x22EAE, D5, 0x1B, D6)
 *     - `waitVblankStateGated(0x3C)`
 *     - `entity[0x6e] = entity[0x6d]`.
 *     - `*0x400390 = 0`.
 *     - `clearDisplayRows(0x14)`.
 *   For every entity, the state==3 check writes `*0x400390 = 0`.
 *
 * **Phase 4 - state-transition loop (gated by count==2 && D4==1)**:
 *   Loop D2 in [0..count): for each entity:
 *     - If `entity[0x18] != 2`, skip.
 *     - If `entity[0x1A] != 0`, go to the else branch.
 *     - If `entity[0x58] == 0 || entity[0x58] == 0x10` && `entity[0x36] == 0`:
 *         -> `objectStateEntry25BAE(entity, 2)`.
 *         -> otherwise `entity[0x18] = 0`, `FUN_18F46(1, sext_l(entity[0x19]))`.
 *
 * **ROM tables** (read-only, in `RomImage.program`):
 *   - `0x1EEF0` long BE × count — player tag ROM pointers.
 *   - `0x1EF92` long BE × mode — sound command lookup (mode ≥ 5).
 *
 * **Globals (workRam offsets relative to 0x400000)**:
 *   - `*0x394` (word) game_mode (read).
 *   - `*0x396` (word) object count (read).
 *   - `*0x654` (byte): incremented when mode==4 (phase 2).
 *   - `*0x656` (byte): incremented when mode==5 (phase 2).
 *     - `entity[0x6D]`, `entity[0x6E]` (byte): updated in phases 2 and 3.
 *
 *   - `FUN_000001BA` (trampoline→`FUN_43D6`, object-slot alloc): 1 call.
 *   - `FUN_0000158AC` (soundCmd): 2-3 calls in phase 1 plus several in phase 2.
 *   - `FUN_00015884` (soundPair15884): 1 call per state==2 entity in phase 2.
 *   - `FUN_000286B0` (renderStringEntry286B0, via A3): N call per entity.
 *   - `FUN_00028DB8` (waitVblankStateGated): 1 in phase 2, 3x in phase 3.
 *   - `FUN_00016E8E` (clearDisplayRows): 1 in phase 2, 1 per entity in phase 3.
 *   - `FUN_00025BAE` (objectStateEntry25BAE): 0/1 per entity in phase 4.
 *   - `FUN_00018F46` (fun_18f46): 0/1 per entity in phase 4 (else branch).
 *
 * **Known caller** (1 xref): `FUN_0001101E` @ 0x000111DE (UNCONDITIONAL_CALL).
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants (absolute M68k work RAM addresses) ────────────────────

/** WORK RAM base (absolute M68k address). */
export const WORK_RAM_BASE = 0x00400000 as const;

export const OBJ_BASE_ADDR = 0x00400018 as const;
/** Stride object struct. */
export const OBJ_STRIDE = 0xe2 as const;
/** Word: `*0x400396` object count. */
export const OBJ_COUNT_ADDR = 0x00400396 as const;
/** Word: `*0x400394` game-mode. */
export const GAME_MODE_ADDR = 0x00400394 as const;
export const DISPLAY_CTRL_ADDR = 0x00400390 as const;
/** Byte: `*0x400654`; incremented when mode==4 in phase 2. */
export const COUNTER_MODE4_ADDR = 0x00400654 as const;
/** Byte: `*0x400656`; incremented when mode==5 in phase 2. */
export const COUNTER_MODE5_ADDR = 0x00400656 as const;

// ─── Object field offsets (relative to the start of the entity) ───────────────

/** Byte: `entity[0x18]` state byte. */
export const OBJ_STATE_OFF = 0x18 as const;
/** Byte: `entity[0x19]` player id. */
export const OBJ_PLAYER_ID_OFF = 0x19 as const;
/** Byte: `entity[0x1A]` sub-state. */
export const OBJ_SUBSTATE_OFF = 0x1a as const;
/** Byte: `entity[0x36]`. */
export const OBJ_FIELD_36_OFF = 0x36 as const;
/** Byte: `entity[0x58]`. */
export const OBJ_FIELD_58_OFF = 0x58 as const;
/** Byte: `entity[0x6D]` (phase 2/3). */
export const OBJ_FIELD_6D_OFF = 0x6d as const;
/** Byte: `entity[0x6E]` (phase 2/3). */
export const OBJ_FIELD_6E_OFF = 0x6e as const;

// ─── ROM table bases ──────────────────────────────────────────────────────────

export const ROM_COLOR_TABLE = 0x00002399c as const;
/** ROM long BE × player — tag string ptr table: `ROM[0x1EEF0 + D2*4]`. */
export const ROM_TAG_TABLE = 0x0001eef0 as const;
/** ROM long BE × mode — sound cmd lookup (game_mode ≥ 5): `ROM[0x1EF92 + mode*4]`. */
export const ROM_SOUND_MODE_TABLE = 0x0001ef92 as const;

// ─── ROM string pointer constants ─────────────────────────────────────────────

export const STR_22E96 = 0x00022e96 as const;
/** String ptr `0x22E8E` - phase 2, col 0x19. */
export const STR_22E8E = 0x00022e8e as const;
/** String ptr `0x22E92` - phase 2, col 0x1B. */
export const STR_22E92 = 0x00022e92 as const;
export const STR_22EA6 = 0x00022ea6 as const;
/** String ptr `0x22EAA` - phase 3, col 0x1B second pass. */
export const STR_22EAA = 0x00022eaa as const;
/** String ptr `0x22EAE` - phase 3, col 0x1B third pass. */
export const STR_22EAE = 0x00022eae as const;

// ─── Misc constants ───────────────────────────────────────────────────────────

export const SOUND_CMD_POST_INIT = 0x3f as const;
export const SOUND_CMD_MODE3_A = 0x0f as const;
/** Second sound command for mode==3. */
export const SOUND_CMD_MODE3_B = 0x11 as const;
export const SOUND_CMD_MODE4_A = 0x17 as const;
/** Second sound command for mode==4. */
export const SOUND_CMD_MODE4_B = 0x15 as const;
/** Sound command for entity[0x36]==2 in phase 2. */
export const SOUND_CMD_FIELD36 = 0x46 as const;
/** Sound command for entity[0x58]==0x10 in phase 2. */
export const SOUND_CMD_FIELD58 = 0x44 as const;

/** Byte written to entity[0x6E] in phase 2. */
export const FIELD_6E_RESET_VALUE = 0xff as const;
/** game-mode value 3. */
export const GAME_MODE_3 = 3 as const;
/** game-mode value 4. */
export const GAME_MODE_4 = 4 as const;
/** game-mode value 5. */
export const GAME_MODE_5 = 5 as const;

/** Ticks for waitVblankStateGated in phase 2. */
export const WAIT_PHASE2_TICKS = 0xb4 as const;
/** Ticks for waitVblankStateGated in phase 3 (x3). */
export const WAIT_PHASE3_TICKS = 0x3c as const;
/** Arg for clearDisplayRows in both phases. */
export const CLEAR_ROWS_ARG = 0x14 as const;
/** Palette attr for D2==0 (first player). */
export const ATTR_PLAYER0 = 0x2000 as const;
/** Palette attr for D2!=0 (second player). */
export const ATTR_PLAYER1 = 0x2400 as const;
/** Attr `objectStateEntry25BAE` sub-state code. */
export const OBJ_STATE_ENTRY_CODE = 0x2 as const;
/** Arg1 for `FUN_18F46` in the phase-4 else branch. */
export const FUN_18F46_ARG1 = 0x1 as const;

// ─── Sub injection ────────────────────────────────────────────────────────────

/**
 * Bag of every external JSR used by `FUN_0001016A20`.
 * All callbacks are optional and default to no-op.
 */
export interface StateSub16A20Subs {
  /**
   * `FUN_000001BA` (trampoline → `FUN_43D6`, object-slot alloc).
   * Default: no-op.
   */
  fun_1ba?: (state: GameState, slotArg: number) => void;

  /**
   * `FUN_0000158AC` (sound command sender). Arg: byte `cmd`.
   * Called 2-3 times in phase 1 (when D4==0) plus several times in phase 2
   * for state==2 entities. Default: no-op.
   */
  soundCmd?: (state: GameState, cmd: number) => void;

  /**
   * Internal subroutine side effects. Called once per state==2 entity in phase 2.
   * Default: no-op.
   */
  soundPair?: (state: GameState) => void;

  /**
   * `FUN_000286B0` (renderStringEntry286B0). Args:
   *   - `col`        : byte (LSB of arg2, = D5 sext_l).
   *   - `attr`       : word (LSW of arg4, = D6).
   * Called N times per entity in loops 2 and 3. Default: no-op.
   */
  renderStr?: (
    state: GameState,
    strPtrLong: number,
    col: number,
    tickOff: number,
    attr: number,
  ) => void;

  /**
   * `FUN_00028DB8` (waitVblankStateGated). Arg: word `ticks`.
   * Called once after phase 2 (ticks=0xB4) and three times per entity in
   * phase 3 (ticks=0x3C). Default: no-op.
   */
  waitVblank?: (state: GameState, ticks: number) => void;

  /**
   * `FUN_00016E8E` (clearDisplayRows helper). Arg: byte `startRow` (= 0x14).
   * Called once after phase 2 and once per state==1 entity in phase 3.
   * Default: no-op.
   */
  clearDisplayRows?: (state: GameState, startRow: number) => void;

  /**
   * `FUN_00025BAE` (objectStateEntry25BAE). Args:
   *   - `code`    : long (0x2).
   * Called 0/1 times per state==2 entity in phase 4 when the conditions pass.
   * Default: no-op.
   */
  objectStateEntry?: (
    state: GameState,
    objAddr: number,
    code: number,
  ) => void;

  /**
   * `FUN_00018F46` (sound-state reset). Args:
   *   - `arg1Long` : long (= 1, constant).
   *   - `arg2Long` : long (= sext_l(entity[0x19])).
   * Called 0/1 times per entity in the phase-4 else branch. Default: no-op.
   */
  fun_18f46?: (state: GameState, arg1Long: number, arg2Long: number) => void;
}


export interface StateSub16A20Result {
  d4: number;
  slotArg: number;
  gameMode: number;
  /** Total entity count (count word). */
  entityCount: number;
  /** Number of state==2 entities processed in phase 2. */
  phase2Matched: number;
  /** Number of state==1 entities processed in phase 3 (D4==1 gate). */
  phase3Matched: number;
  phase4Executed: boolean;
  /** Number of `objectStateEntry` calls in phase 4. */
  phase4StateEntryCalls: number;
  /** Number of `fun_18f46` calls in phase 4. */
  phase4Fun18F46Calls: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function romReadLongBE(rom: RomImage, off: number): number {
  return (
    ((rom.program[off] ?? 0) << 24) |
    ((rom.program[off + 1] ?? 0) << 16) |
    ((rom.program[off + 2] ?? 0) << 8) |
    (rom.program[off + 3] ?? 0)
  ) >>> 0;
}

function romReadByte(rom: RomImage, off: number): number {
  return (rom.program[off] ?? 0) & 0xff;
}

/** sign-extend byte (8-bit signed) to 32-bit unsigned representation. */
function sextByte(b: number): number {
  const v = b & 0xff;
  return (v & 0x80) !== 0 ? (v | 0xffffff00) >>> 0 : v >>> 0;
}

// ─── Port ────────────────────────────────────────────────────────────────────

/**
 *
 * @param state  GameState. Reads `workRam[0x394..0x395]` (game_mode).
 *               Writes `workRam[0x390..0x391]` (phase 3), `workRam[0x654]`
 *               (phase 2 mode==4), `workRam[0x656]` (phase 2 mode==5),
 *               entity[0x6D], entity[0x6E] (phases 2 and 3), and entity[0x18]
 *               (phase-4 else branch).
 * @param rom    RomImage. Reads `0x2399C` (color table), `0x1EEF0` (tag
 *               ptr table), `0x1EF92` (sound mode table).
 * @param subs   Sub injection. All external JSRs are controllable and default
 *               to no-op.
 *
 * @returns Run details: D4, slotArg, game mode, entity count, match counts by
 *          phase, phase-4 execution, and call counts.
 */
export function stateSub16A20(
  state: GameState,
  rom: RomImage,
  subs?: StateSub16A20Subs,
): StateSub16A20Result {
  const countOff = OBJ_COUNT_ADDR - WORK_RAM_BASE;
  const gameModeOff = GAME_MODE_ADDR - WORK_RAM_BASE;
  const count = readWordBE(state, countOff);
  const gameMode = readWordBE(state, gameModeOff);

  // ─── Phase 1: scan loop ──────────────────────────────────────────────────
  // D4 = count of entities with state==3
  // A0 = last entity with state==1 or state==3 seen
  let d4 = 0;
  let lastObjAddr = 0; // A0
  let objAddr = OBJ_BASE_ADDR >>> 0;

  for (let d2 = 0; (d2 & 0xffff) !== (count & 0xffff); d2 = (d2 + 1) & 0xff) {
    const stateOff = (objAddr + OBJ_STATE_OFF) - WORK_RAM_BASE;
    const stateByte = readByte(state, stateOff);
    if (stateByte === 0x01 || stateByte === 0x03) {
      // beq.w 0x16a54 (state==1) or fall-through (state==3):
      //   addq.b #1, D4b; movea.l A2, A0
      // state==others: bne.b to advance (no D4 increment, no A0 update)
      d4 = (d4 + 1) & 0xff;
      lastObjAddr = objAddr;
    }
    objAddr = (objAddr + OBJ_STRIDE) >>> 0;
  }

  // Post-scan: call FUN_1BA
  let slotArg: number;
  if (d4 === 0) {
    slotArg = 0;
  } else {
    // move.b (0x19,A0), D0b; ext.w; ext.l; addq.l #1, D0
    const playerByte = readByte(state, (lastObjAddr + OBJ_PLAYER_ID_OFF) - WORK_RAM_BASE);
    slotArg = (sextByte(playerByte) + 1) >>> 0;
  }
  subs?.fun_1ba?.(state, slotArg);

  if (d4 === 0) {
    // Sound dispatch based on game mode
    if (gameMode === GAME_MODE_3) {
      subs?.soundCmd?.(state, SOUND_CMD_MODE3_A);
      subs?.soundCmd?.(state, SOUND_CMD_MODE3_B);
    } else if (gameMode === GAME_MODE_4) {
      subs?.soundCmd?.(state, SOUND_CMD_MODE4_A);
      subs?.soundCmd?.(state, SOUND_CMD_MODE4_B);
    } else {
      // mode ≥ 5 (or other): ROM[0x1ef92 + mode*4] as long → send
      const romOff = (ROM_SOUND_MODE_TABLE + (gameMode << 2)) >>> 0;
      const ptrLong = romReadLongBE(rom, romOff);
      subs?.soundCmd?.(state, ptrLong & 0xff);
    }
    subs?.soundCmd?.(state, SOUND_CMD_POST_INIT);
  }

  // ─── Phase 2: display loop ───────────────────────────────────────────────
  let phase2Matched = 0;
  objAddr = OBJ_BASE_ADDR >>> 0;

  for (let d2 = 0; (d2 & 0xffff) !== (count & 0xffff); d2 = (d2 + 1) & 0xff) {
    const entityOff = objAddr - WORK_RAM_BASE;

    // entity[0x6d] = entity[0x6e]; entity[0x6e] = 0xFF
    writeByte(state, entityOff + OBJ_FIELD_6D_OFF, readByte(state, entityOff + OBJ_FIELD_6E_OFF));
    writeByte(state, entityOff + OBJ_FIELD_6E_OFF, FIELD_6E_RESET_VALUE);

    const stateByte = readByte(state, entityOff + OBJ_STATE_OFF);
    if (stateByte !== 0x02) {
      objAddr = (objAddr + OBJ_STRIDE) >>> 0;
      continue;
    }
    phase2Matched++;

    // game-mode counter increments
    const gameModeNow = readWordBE(state, gameModeOff);
    if (gameModeNow === GAME_MODE_4) {
      const off654 = COUNTER_MODE4_ADDR - WORK_RAM_BASE;
      writeByte(state, off654, (readByte(state, off654) + 1) & 0xff);
    } else if (gameModeNow === GAME_MODE_5) {
      const off656 = COUNTER_MODE5_ADDR - WORK_RAM_BASE;
      writeByte(state, off656, (readByte(state, off656) + 1) & 0xff);
    }

    // soundPair15884()
    subs?.soundPair?.(state);

    // conditional sound cmds
    if (readByte(state, entityOff + OBJ_FIELD_36_OFF) === 0x02) {
      subs?.soundCmd?.(state, SOUND_CMD_FIELD36);
    }
    if (readByte(state, entityOff + OBJ_FIELD_58_OFF) === 0x10) {
      subs?.soundCmd?.(state, SOUND_CMD_FIELD58);
    }

    // D5 = ROM[0x2399c + (count + d2 - 1) & 0xffff]
    const d5idx = (count + d2 - 1) & 0xffff;
    const d5 = romReadByte(rom, (ROM_COLOR_TABLE + d5idx) >>> 0);

    // D6 = d2 != 0 ? 0x2400 : 0x2000
    const d6 = (d2 !== 0) ? ATTR_PLAYER1 : ATTR_PLAYER0;

    // if count == 2: extra 2 renders
    if (count === 2) {
      subs?.renderStr?.(state, STR_22E96, d5, 0x16, d6);
      const tagPtr = (ROM_TAG_TABLE + (d2 << 2)) >>> 0;
      const strLong = romReadLongBE(rom, tagPtr);
      subs?.renderStr?.(state, strLong, d5, 0x17, d6);
    }

    // 5 fixed renders
    subs?.renderStr?.(state, STR_22E96, d5, 0x18, d6);
    subs?.renderStr?.(state, STR_22E8E, d5, 0x19, d6);
    subs?.renderStr?.(state, STR_22E96, d5, 0x1a, d6);
    subs?.renderStr?.(state, STR_22E92, d5, 0x1b, d6);
    subs?.renderStr?.(state, STR_22E96, d5, 0x1c, d6);

    objAddr = (objAddr + OBJ_STRIDE) >>> 0;
  }

  // Post-phase-2: wait + clear
  subs?.waitVblank?.(state, WAIT_PHASE2_TICKS);
  subs?.clearDisplayRows?.(state, CLEAR_ROWS_ARG);

  // ─── Phase 3: secondary loop ─────────────────────────────────────────────
  let phase3Matched = 0;
  objAddr = OBJ_BASE_ADDR >>> 0;

  for (let d2 = 0; (d2 & 0xffff) !== (count & 0xffff); d2 = (d2 + 1) & 0xff) {
    const entityOff = objAddr - WORK_RAM_BASE;
    const stateByte = readByte(state, entityOff + OBJ_STATE_OFF);

    if (stateByte === 0x01 && d4 === 0x01) {
      phase3Matched++;

      // D5 = ROM[0x2399c + (count + d2 - 1) & 0xffff]
      const d5idx = (count + d2 - 1) & 0xffff;
      const d5 = romReadByte(rom, (ROM_COLOR_TABLE + d5idx) >>> 0);

      // D6 = d2 != 0 ? 0x2400 : 0x2000
      const d6 = (d2 !== 0) ? ATTR_PLAYER1 : ATTR_PLAYER0;

      // 5 renders
      subs?.renderStr?.(state, STR_22E96, d5, 0x18, d6);
      const tagPtr = (ROM_TAG_TABLE + (d2 << 2)) >>> 0;
      const strLong = romReadLongBE(rom, tagPtr);
      subs?.renderStr?.(state, strLong, d5, 0x19, d6);
      subs?.renderStr?.(state, STR_22E96, d5, 0x1a, d6);
      subs?.renderStr?.(state, STR_22EA6, d5, 0x1b, d6);
      subs?.renderStr?.(state, STR_22E96, d5, 0x1c, d6);

      subs?.waitVblank?.(state, WAIT_PHASE3_TICKS);

      subs?.renderStr?.(state, STR_22EAA, d5, 0x1b, d6);
      subs?.waitVblank?.(state, WAIT_PHASE3_TICKS);

      subs?.renderStr?.(state, STR_22EAE, d5, 0x1b, d6);
      subs?.waitVblank?.(state, WAIT_PHASE3_TICKS);

      // entity[0x6e] = entity[0x6d]
      writeByte(state, entityOff + OBJ_FIELD_6E_OFF, readByte(state, entityOff + OBJ_FIELD_6D_OFF));

      // *0x400390 = 0
      writeWordBE(state, DISPLAY_CTRL_ADDR - WORK_RAM_BASE, 0);

      // clearDisplayRows(0x14)
      subs?.clearDisplayRows?.(state, CLEAR_ROWS_ARG);
    }

    // state==3 check (always, after the state==1 block)
    if (stateByte === 0x03) {
      writeWordBE(state, DISPLAY_CTRL_ADDR - WORK_RAM_BASE, 0);
    }

    objAddr = (objAddr + OBJ_STRIDE) >>> 0;
  }

  // ─── Phase 4: state-transition loop (gated by count==2 && D4==1) ─────────
  let phase4Executed = false;
  let phase4StateEntryCalls = 0;
  let phase4Fun18F46Calls = 0;

  if (count === 2 && d4 === 0x01) {
    phase4Executed = true;
    objAddr = OBJ_BASE_ADDR >>> 0;

    for (let d2 = 0; (d2 & 0xffff) !== (count & 0xffff); d2 = (d2 + 1) & 0xff) {
      const entityOff = objAddr - WORK_RAM_BASE;
      const stateByte = readByte(state, entityOff + OBJ_STATE_OFF);

      if (stateByte === 0x02) {
        const subState = readByte(state, entityOff + OBJ_SUBSTATE_OFF);
        if (subState === 0) {
          // tst.b (0x1a,A2) == 0 branch
          const field58 = readByte(state, entityOff + OBJ_FIELD_58_OFF);
          const field36 = readByte(state, entityOff + OBJ_FIELD_36_OFF);
          // condition: (field58==0 || field58==0x10) && field36==0
          // disasm: tst.b (0x58,A2); beq→0x16e40; cmpi.b #0x10,(0x58,A2); bne→0x16e56
          //   [0x16e40]: tst.b (0x36,A2); bne→0x16e56
          const field58ok = (field58 === 0x00) || (field58 === 0x10);
          if (field58ok && field36 === 0x00) {
            subs?.objectStateEntry?.(state, objAddr, OBJ_STATE_ENTRY_CODE);
            phase4StateEntryCalls++;
          } else {
            // else-branch
            writeByte(state, entityOff + OBJ_STATE_OFF, 0x00);
            const playerByte = readByte(state, entityOff + OBJ_PLAYER_ID_OFF);
            const arg2 = sextByte(playerByte);
            subs?.fun_18f46?.(state, FUN_18F46_ARG1, arg2);
            phase4Fun18F46Calls++;
          }
        } else {
          // subState != 0: bne→0x16e56 (else-branch)
          writeByte(state, entityOff + OBJ_STATE_OFF, 0x00);
          const playerByte = readByte(state, entityOff + OBJ_PLAYER_ID_OFF);
          const arg2 = sextByte(playerByte);
          subs?.fun_18f46?.(state, FUN_18F46_ARG1, arg2);
          phase4Fun18F46Calls++;
        }
      }

      objAddr = (objAddr + OBJ_STRIDE) >>> 0;
    }
  }

  return {
    d4,
    slotArg,
    gameMode,
    entityCount: count,
    phase2Matched,
    phase3Matched,
    phase4Executed,
    phase4StateEntryCalls,
    phase4Fun18F46Calls,
  };
}
