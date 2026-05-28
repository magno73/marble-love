/**
 * state-sub-19baa.ts — `FUN_00019BAA` replica (490 bytes, 0x019BAA-0x019D94).
 *
 * "Per-frame entity tick": gates on global `*0x400394 == 4`, optionally
 * triggers the spawn dispatcher (`FUN_00019A40`) every 8 frames, then iterates.
 *   1. tick anim counter `entity[0x24]++`
 *   2. if anim counter reaches threshold `entity[0x25]`: advance
 *      script ptr `entity[0x1C] += 4`. If long `*entity[0x1C] == -1`
 *      (terminator) and `entity[0x1A] != 2`: **scan-other-entities** for
 *      the D4 flag, then reset `entity[0x1C] = 0x000224D6`, clear
 *      `entity[0x1A]`, decrement `entity[0x1B]` (if nonzero), and — if
 *      `entity[0x1B]` reaches 0 — branch on `entity[0x4]`:
 *        - if `entity[0x4] == 0xFFFE0000` AND D4 != 0:
 *            entity[0x25] = 1
 *            entity[0x4]  = 0xFFFC0000
 *            entity[0x1B] = (rng(2) + 4) & 0xFF
 *            entity[0x25] = 4
 *            entity[0x4]  = 0xFFFE0000
 *            entity[0x1B] = (rng(2) + 1) & 0xFF
 *      Also, if on the re-check `*entity[0x1C] == -1` and `entity[0x1A] == 2`:
 *      clear `entity[0x18]` and jsr `FUN_18F46(0xF, sext_l(entity[0x19]))`.
 *   3. movement block: if `entity[0x1A] == 0`, move Y by entity[0x4].
 *      `FUN_1CC62(1)` → D0; if `D0 > entity[0x14]`:
 *        restore entity[0x10] = (oldY & 0xFFFC0000)
 *        entity[0x1C] = 0x000224E2
 *        entity[0x24] = 0
 *        entity[0x25] = 1
 *        entity[0x1A] = 2
 *        D3 = 1     (= flag "spawn sound trigger")
 *   4. AI block: jsr `FUN_19E42(entityAddr)`. If D3 != 0 (sound trigger
 *      armed by step 3) and `(entity[0x0C..0x0D].w >> 3) > 0x35` (signed
 *
 * **Disasm 0x19BAA..0x19D94** (decoded from raw bytes):
 *
 *   movem.l {A2,D4,D3,D2}, -(SP)        ; save 4 regs (16 bytes)
 *   moveq   #4, D0
 *   cmp.w   (0x00400394).l, D0w
 *   bne.w   epilogue                    ; gate: if *0x394 != 4 → return
 *   tst.b   (0x00400762).l
 *   beq.b   skip_spawn
 *   move.l  (0x00400010).l, D0
 *   moveq   #7, D1
 *   and.l   D1, D0
 *   bne.b   skip_spawn                  ; spawn every 8 frames
 *   jsr     0x00019A40.l                ; FUN_19A40 spawn dispatcher
 * skip_spawn:
 *   movea.l #0x4019F8, A2               ; A2 = entity table base
 *   clr.b   D2                          ; D2 = entity index (0..9)
 *   clr.b   D3                          ; D3 = sound-trigger flag
 *
 * outer_loop @ 0x19BDC:                  (D2 = 0..9; A2 += 0x38 each iter)
 *   tst.b   (0x18, A2)
 *   beq.w   next_entity                 ; entity[0x18] == 0 → skip
 *   addq.b  #1, (0x24, A2)
 *   move.b  (0x25, A2), D0
 *   cmp.b   (0x24, A2), D0
 *   bgt.w   movement_block              ; entity[0x25] > entity[0x24] (signed)
 *   clr.b   (0x24, A2)
 *   addq.l  #4, (0x1C, A2)              ; advance script ptr
 *   movea.l (0x1C, A2), A0
 *   moveq   #-1, D0
 *   cmp.l   (A0), D0
 *   bne.w   recheck_terminator          ; *script != -1 → recheck path
 *   cmpi.b  #2, (0x1A, A2)
 *   beq.w   recheck_terminator
 *
 *   ; --- scan the other 9 entities for "below-other-with-same-X" check ---
 *   movea.l #0x4019F8, A1
 *   moveq   #1, D4                      ; D4 = 1 (init "no other entity above")
 *   clr.b   D1                          ; D1 = scan iter (0..9)
 *  scan_loop @ 0x19C1E:
 *   cmpa.l  A2, A1
 *   beq.b   scan_next                   ; skip self
 *   cmpi.b  #1, (0x18, A1)
 *   bne.b   scan_next                   ; A1 not active
 *   move.w  (0xC, A1), D0w
 *   cmp.w   (0xC, A2), D0w
 *   bne.b   scan_next                   ; X word differs → no match
 *   move.w  (0x10, A2), D0w
 *   cmp.w   (0x10, A1), D0w             ; A2.y - A1.y
 *   ble.b   scan_next                   ; A2.y <= A1.y → no match (above/eq)
 *   clr.b   D4                          ; A2 below A1 (same X) → mark D4 = 0
 *   bra.b   after_scan                  ; (not break: jumps to script-reset)
 *  scan_next @ 0x19C4A:
 *   moveq   #0x38, D0
 *   adda.l  D0, A1
 *   addq.b  #1, D1
 *   cmpi.b  #10, D1
 *   bne.b   scan_loop
 *
 *  after_scan @ 0x19C56:
 *   move.l  #0x000224D6, (0x1C, A2)     ; reset script ptr
 *   clr.b   (0x1A, A2)
 *   tst.b   (0x1B, A2)
 *   beq.b   skip_dec
 *   subq.b  #1, (0x1B, A2)
 *  skip_dec:
 *   tst.b   (0x1B, A2)
 *   cmpi.l  #0xFFFE0000, (0x4, A2)
 *   bne.b   else_branch
 *   tst.b   D4
 *   beq.b   else_branch
 *
 *   ; --- "if" branch: entity[4]==0xFFFE0000 AND D4!=0 (no other entity above) ---
 *   move.b  #1, (0x25, A2)
 *   move.l  #0xFFFC0000, (0x4, A2)
 *   pea     (2).w
 *   jsr     0x00013A98.l                ; rng(2) → D0
 *   addq.b  #4, D0                      ; D0 = (rng + 4)
 *   move.b  D0, (0x1B, A2)              ; entity[0x1B] = D0.b
 *   addq.l  #4, SP
 *   bra.b   movement_block
 *
 *  else_branch @ 0x19CA4:
 *   move.b  #4, (0x25, A2)
 *   move.l  #0xFFFE0000, (0x4, A2)
 *   pea     (2).w
 *   jsr     0x00013A98.l
 *   addq.b  #1, D0
 *   move.b  D0, (0x1B, A2)              ; entity[0x1B] = (rng + 1).b
 *   addq.l  #4, SP
 *   bra.b   movement_block
 *
 *  recheck_terminator @ 0x19CC6:
 *   movea.l (0x1C, A2), A0
 *   moveq   #-1, D0
 *   cmp.l   (A0), D0
 *   bne.b   movement_block              ; non terminator → skip
 *   cmpi.b  #2, (0x1A, A2)
 *   bne.b   movement_block
 *   clr.b   (0x18, A2)                  ; deactivate entity
 *   move.b  (0x19, A2), D1
 *   ext.w   D1
 *   ext.l   D1
 *   move.l  D1, -(SP)
 *   pea     (0x0F).w
 *   jsr     0x00018F46.l                ; FUN_18F46(0xF, sext_l(entity[0x19]))
 *   addq.l  #8, SP
 *
 *  movement_block @ 0x19CF2:
 *   tst.b   (0x1A, A2)
 *   bne.b   ai_block                    ; entity[0x1A] != 0 → skip movement
 *   move.l  (0x10, A2), D4              ; D4 = saved Y
 *   move.l  (0x4, A2), D0
 *   add.l   D0, (0x10, A2)              ; entity[0x10] += entity[0x4]
 *   move.l  A2, -(SP)
 *   jsr     0x0001BB08.l                ; FUN_1BB08(entityAddr)
 *   pea     (1).w
 *   jsr     0x0001CC62.l                ; FUN_1CC62(1) → D0
 *   cmp.l   (0x14, A2), D0
 *   addq.l  #8, SP
 *   ble.b   ai_block                    ; D0 <= entity[0x14] → no clamp
 *
 *   move.l  D4, D0
 *   andi.l  #0xFFFC0000, D0             ; mask high
 *   move.l  D0, (0x10, A2)              ; restore Y to clamped value
 *   move.l  #0x000224E2, (0x1C, A2)
 *   clr.b   (0x24, A2)
 *   move.b  #1, (0x25, A2)
 *   move.b  #2, (0x1A, A2)
 *   moveq   #1, D3                      ; arm sound-trigger flag
 *
 *  ai_block @ 0x19D44:
 *   move.l  A2, -(SP)
 *   jsr     0x00019E42.l                ; FUN_19E42(entityAddr)
 *   tst.b   D3
 *   addq.l  #4, SP
 *   beq.b   next_entity                 ; D3 == 0 → no sound
 *   lea     (0xC, A2), A0
 *   move.w  (A0), D0w
 *   asr.w   #3, D0
 *   moveq   #0x35, D1
 *   cmp.w   D0, D1
 *   ble.b   next_entity                 ; 0x35 <= D0 (signed) → skip
 *   move.w  (0x22, A2), D0w
 *   andi.w  #0xFFFF, D0w                ; (no-op)
 *   tst.w   D0
 *   blt.b   next_entity                 ; signed < 0 → skip
 *   cmpi.w  #0xF0, D0
 *   bge.b   next_entity                 ; D0 >= 0xF0 → skip
 *   pea     (0x59).l
 *   jsr     0x000158AC.l                ; FUN_158AC(0x59)
 *   addq.l  #4, SP
 *
 *  next_entity @ 0x19D80:
 *   moveq   #0x38, D0
 *   adda.l  D0, A2
 *   addq.b  #1, D2
 *   cmpi.b  #10, D2
 *                                       ; tra entity diverse, intenzionale)
 *
 *  epilogue @ 0x19D8E:
 *   movem.l (SP)+, {D2,D3,D4,A2}
 *   rts
 *
 * **Important D3 persistence quirk**:
 *   Once the flag is armed (D3=1), every later entity in the loop sees D3=1
 *   as long as the X<0x35 and 0<=Y<0xF0 gates pass. This is replicated exactly.
 *
 * **External JSRs** (sub injections plus live RNG):
 *   - `FUN_00013A98` = RNG — **live** via `rngNext(rng, 2)` (cfr `rng.ts`).
 *   - `FUN_0001BB08` = `spriteSetXY` (sprite-derive wrapper) — **sub
 *     injection**. Default no-op.
 *     injection**. Default no-op.
 *   - `FUN_000158AC` = sound command sender — **sub injection**. Default no-op.
 *
 *
 * **Known caller**: `FUN_00010FCE` @ 0x10FFE (UNCONDITIONAL_CALL).
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";
import { sub1BB08 } from "./sub-1bb08.js";

// ─── Global addresses (workRam offsets) ──────────────────────────────────

/** Word @ 0x400394: "game mode" — gate: must be 4. */
export const GAME_MODE_WORD_OFF = 0x394 as const;
/** Byte @ 0x400762: spawn-enable flag. */
export const SPAWN_ENABLE_BYTE_OFF = 0x762 as const;
/** Long @ 0x400010: frame counter. Spawn fires every 8 frames (low 3 bits == 0). */
export const FRAME_COUNTER_LONG_OFF = 0x10 as const;

/** Required value @ workRam[0x394].w to enable the function body. */
export const GAME_MODE_REQUIRED = 4 as const;
/** Mask applied to `*0x400010` to gate spawn dispatcher. */
export const SPAWN_FRAME_MASK = 7 as const;

// ─── Entity table layout ─────────────────────────────────────────────────

/** Base m68k addr of entity table. */
export const ENTITY_TABLE_BASE = 0x004019f8 as const;
/** Stride per entity (byte). */
export const ENTITY_STRIDE = 0x38 as const;
/** Number of entities. */
export const ENTITY_COUNT = 10 as const;

/** Long @ entity[0x04]: vel/state long. */
export const ENTITY_VEL_OFFSET = 0x04 as const;
/** Long @ entity[0x0C]: position X (fixed-point). */
export const ENTITY_POS_X_OFFSET = 0x0c as const;
/** Long @ entity[0x10]: position Y (fixed-point). */
export const ENTITY_POS_Y_OFFSET = 0x10 as const;
/** Long @ entity[0x14]: position-Z / depth threshold. */
export const ENTITY_POS_Z_OFFSET = 0x14 as const;
/** Byte @ entity[0x18]: active flag. */
export const ENTITY_ACTIVE_OFFSET = 0x18 as const;
/** Byte @ entity[0x19]: key for FUN_18F46 arg2. */
export const ENTITY_KEY19_OFFSET = 0x19 as const;
/** Byte @ entity[0x1A]: substate (0,1,2 osservati). */
export const ENTITY_SUBSTATE_OFFSET = 0x1a as const;
/** Byte @ entity[0x1B]: timer/counter (decremented). */
export const ENTITY_TIMER_OFFSET = 0x1b as const;
/** Long @ entity[0x1C]: script ptr. */
export const ENTITY_SCRIPT_PTR_OFFSET = 0x1c as const;
/** Word @ entity[0x22]: screen-Y for visibility check. */
export const ENTITY_SCREEN_Y_OFFSET = 0x22 as const;
/** Byte @ entity[0x24]: animation counter. */
export const ENTITY_ANIM_COUNTER_OFFSET = 0x24 as const;
/** Byte @ entity[0x25]: anim threshold / state byte. */
export const ENTITY_STATE_OFFSET = 0x25 as const;

// ─── Constants ───────────────────────────────────────────────────────────

/** Script-ptr reset value (after terminator hit). */
export const SCRIPT_PTR_RESET = 0x000224d6 as const;
/** Script-ptr value set when Y clamps to depth threshold. */
export const SCRIPT_PTR_CLAMP = 0x000224e2 as const;
/** Vel-long pivot: if entity[0x4] == this AND scan flag → "if" branch. */
export const VEL_PIVOT_IF = 0xfffe0000 as const;
/** Vel-long set in "if" branch. */
export const VEL_IF_SET = 0xfffc0000 as const;
/** Vel-long set in "else" branch. */
export const VEL_ELSE_SET = 0xfffe0000 as const;
/** Mask applied to saved Y on Y-clamp (high 14 bits). */
export const Y_CLAMP_MASK = 0xfffc0000 as const;
/** State-byte set in "if" branch + Y-clamp. */
export const STATE_IF = 1 as const;
/** State-byte set in "else" branch. */
export const STATE_ELSE = 4 as const;
/** Substate set in Y-clamp path. */
export const SUBSTATE_CLAMPED = 2 as const;
/** Timer offset in "if" branch (rng + 4). */
export const TIMER_IF_OFFSET = 4 as const;
/** Timer offset in "else" branch (rng + 1). */
export const TIMER_ELSE_OFFSET = 1 as const;
/** RNG limit passed to FUN_13A98. */
export const RNG_LIMIT = 2 as const;
/** Arg1 long for FUN_18F46. */
export const FUN_18F46_ARG1 = 0x0f as const;
/** Arg long for FUN_158AC sound trigger. */
export const SOUND_TRIGGER_ARG = 0x59 as const;
/** Arg long for FUN_1CC62. */
export const FUN_1CC62_ARG = 0x01 as const;
/** Sound-gate threshold: `(entity[0x0C..0x0D].w >> 3) < this`. */
export const SOUND_X_THRESHOLD = 0x35 as const;
/** Sound-gate upper bound on entity[0x22..0x23].w. */
export const SOUND_Y_UPPER = 0x00f0 as const;

// ─── Sub injections ──────────────────────────────────────────────────────

/**
 * stubbed with RTS in parity testing).
 *
 * `rngNext(state.rng, 2)`.
 */
export interface StateSub19BAASubs {
  /** `FUN_00019A40(state)` — spawn dispatcher (gated). */
  fun_19a40?: (state: GameState) => void;
  /** `FUN_00018F46(state, arg1, arg2)` — slot-insert-sorted parente. */
  fun_18f46?: (state: GameState, arg1Long: number, arg2Long: number) => void;
  /** `FUN_0001BB08(state, entityAddr)` — sprite-set-XY wrapper. */
  fun_1bb08?: (state: GameState, entityAddr: number) => void;
  fun_1cc62?: (state: GameState, arg: number) => number;
  /** `FUN_00019E42(state, entityAddr)` — marble-cell-dispatch. */
  fun_19e42?: (state: GameState, entityAddr: number) => void;
  /** `FUN_000158AC(state, arg)` — sound command. */
  fun_158ac?: (state: GameState, arg: number) => void;
}

// ─── Result ──────────────────────────────────────────────────────────────

export interface EntityTickRecord {
  slot: number;
  wasActive: boolean;
  /** True if it executed the "script-advance" branch (anim counter reached). */
  scriptAdvanced: boolean;
  /** True if it entered the "scan-other-entities" block (terminator hit). */
  enteredScanBlock: boolean;
  /** True if it entered the state-update branch (entity[0x1B] reached 0). */
  enteredStateBranch: boolean;
  ifBranchTaken: boolean | null;
  enteredMovement: boolean;
  /** True if the movement block clamped Y. */
  yClamped: boolean;
  /** True if it invoked `FUN_158AC` (sound trigger). */
  soundFired: boolean;
}

export interface StateSub19BAAResult {
  gatedOut: boolean;
  spawnDispatched: boolean;
  perEntity: EntityTickRecord[];
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
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function writeLongBE(state: GameState, off: number, v: number): void {
  const x = v >>> 0;
  state.workRam[off] = (x >>> 24) & 0xff;
  state.workRam[off + 1] = (x >>> 16) & 0xff;
  state.workRam[off + 2] = (x >>> 8) & 0xff;
  state.workRam[off + 3] = x & 0xff;
}

/** Convert m68k absolute addr to workRam offset. */
function addrToOff(addr: number): number {
  return (addr - 0x400000) >>> 0;
}

/**
 * Read a long (32-bit BE) from m68k absolute addr, dispatching by region.
 *
 * dispatch fa:
 *   - addr < 0x400000 → ROM (rom.program)
 *   - 0x400000 ≤ addr < 0x402000 → workRam
 *   - altrove → 0 (default safe)
 */
function readLongFromAddr(
  state: GameState,
  rom: RomImage,
  addr: number,
): number {
  const a = addr >>> 0;
  if (a < 0x400000) {
    return (
      (((rom.program[a] ?? 0) << 24) |
        ((rom.program[a + 1] ?? 0) << 16) |
        ((rom.program[a + 2] ?? 0) << 8) |
        (rom.program[a + 3] ?? 0)) >>>
      0
    );
  }
  if (a >= 0x400000 && a < 0x402000) {
    const o = a - 0x400000;
    return (
      (((state.workRam[o] ?? 0) << 24) |
        ((state.workRam[o + 1] ?? 0) << 16) |
        ((state.workRam[o + 2] ?? 0) << 8) |
        (state.workRam[o + 3] ?? 0)) >>>
      0
    );
  }
  return 0;
}

/** Sign-extend byte to signed 32-bit integer. */
function sextByte(b: number): number {
  const v = b & 0xff;
  return v & 0x80 ? v - 0x100 : v;
}

/** Sign-extend word to signed 32-bit integer. */
function sextWord(w: number): number {
  const v = w & 0xffff;
  return v & 0x8000 ? v - 0x10000 : v;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 *
 * @param state GameState (modifica `state.workRam` per le entity attive +
 *              consuma RNG via `state.rng` per i path "state-branch").
 * @param subs  injection stub per le 6 sub esterne. Default tutte no-op (e
 *
 * @returns dettaglio del gate, dello spawn-dispatch e del per-entity tick.
 */
export function stateSub19BAA(
  state: GameState,
  rom: RomImage,
  subs?: StateSub19BAASubs,
): StateSub19BAAResult {
  // ─── Gate: *0x400394.w == 4 ────────────────────────────────────────────
  // moveq 4,D0 ; cmp.w (0x394).l, D0w ; bne → exit
  // beq path: word(0x394) == 4.
  const gameMode = readWordBE(state, GAME_MODE_WORD_OFF);
  if (gameMode !== GAME_MODE_REQUIRED) {
    return { gatedOut: true, spawnDispatched: false, perEntity: [] };
  }

  // ─── Optional spawn dispatcher ─────────────────────────────────────────
  // tst.b (0x762).l ; beq → skip
  // move.l (0x10).l, D0 ; moveq 7,D1 ; and.l D1,D0 ; bne → skip
  // jsr FUN_19A40
  let spawnDispatched = false;
  if (readByte(state, SPAWN_ENABLE_BYTE_OFF) !== 0) {
    const frameLong = readLongBE(state, FRAME_COUNTER_LONG_OFF);
    if ((frameLong & SPAWN_FRAME_MASK) === 0) {
      subs?.fun_19a40?.(state);
      spawnDispatched = true;
    }
  }

  // ─── Outer loop: D2 = 0..9 ─────────────────────────────────────────────
  let d3SoundFlag = 0;
  const perEntity: EntityTickRecord[] = [];

  for (let d2 = 0; d2 < ENTITY_COUNT; d2++) {
    const entityAddr = ENTITY_TABLE_BASE + d2 * ENTITY_STRIDE;
    const off = addrToOff(entityAddr);

    const rec: EntityTickRecord = {
      slot: d2,
      wasActive: false,
      scriptAdvanced: false,
      enteredScanBlock: false,
      enteredStateBranch: false,
      ifBranchTaken: null,
      enteredMovement: false,
      yClamped: false,
      soundFired: false,
    };

    // tst.b (0x18,A2) ; beq.w next_entity
    if (readByte(state, off + ENTITY_ACTIVE_OFFSET) === 0) {
      perEntity.push(rec);
      continue;
    }
    rec.wasActive = true;

    // addq.b #1,(0x24,A2) ; D0 = (0x25,A2) ; cmp.b (0x24,A2),D0 ; bgt → movement
    // cmp.b src=(0x24,A2), dst=D0=(0x25,A2). bgt: D0 > (0x24,A2) signed.
    // Increment first, then compare: counter = old+1, threshold = entity[0x25].
    // bgt = signed compare of state-byte > new-counter.
    const newCounter = (readByte(state, off + ENTITY_ANIM_COUNTER_OFFSET) + 1) & 0xff;
    writeByte(state, off + ENTITY_ANIM_COUNTER_OFFSET, newCounter);
    const stateByte = readByte(state, off + ENTITY_STATE_OFFSET);

    // Signed byte compare:
    const stateByteS = sextByte(stateByte);
    const newCounterS = sextByte(newCounter);

    let goToMovementBlock = false;
    let goToRecheckTerminator = false;

    if (stateByteS > newCounterS) {
      // bgt → movement_block (skip script-advance)
      goToMovementBlock = true;
    } else {
      // Script-advance branch.
      rec.scriptAdvanced = true;
      writeByte(state, off + ENTITY_ANIM_COUNTER_OFFSET, 0);

      // entity[0x1C] += 4 (long add).
      const scriptPtr = (readLongBE(state, off + ENTITY_SCRIPT_PTR_OFFSET) + 4) >>> 0;
      writeLongBE(state, off + ENTITY_SCRIPT_PTR_OFFSET, scriptPtr);

      // movea.l (0x1C,A2),A0 ; moveq -1,D0 ; cmp.l (A0),D0 ; bne → recheck
      const scriptVal = readLongFromAddr(state, rom, scriptPtr);
      const minusOne = 0xffffffff;

      if (scriptVal !== minusOne) {
        // Not terminator → recheck path (will re-read; outcome same).
        goToRecheckTerminator = true;
      } else if (readByte(state, off + ENTITY_SUBSTATE_OFFSET) === SUBSTATE_CLAMPED) {
        // Substate == 2 → recheck path.
        goToRecheckTerminator = true;
      } else {
        // ─── scan-other-entities block ──────────────────────────────────
        rec.enteredScanBlock = true;
        let d4Flag = 1;
        for (let d1 = 0; d1 < ENTITY_COUNT; d1++) {
          const otherAddr = ENTITY_TABLE_BASE + d1 * ENTITY_STRIDE;
          if (otherAddr === entityAddr) continue; // skip self
          const otherOff = addrToOff(otherAddr);
          if (readByte(state, otherOff + ENTITY_ACTIVE_OFFSET) !== 1) continue;
          // move.w (0xC,A1),D0w ; cmp.w (0xC,A2),D0w ; bne → next
          // word(other.x) compared to word(self.x).
          const otherX = readWordBE(state, otherOff + ENTITY_POS_X_OFFSET);
          const selfX = readWordBE(state, off + ENTITY_POS_X_OFFSET);
          if (otherX !== selfX) continue;
          // move.w (0x10,A2),D0w ; cmp.w (0x10,A1),D0w ; ble → next
          // ble: signed self.y <= other.y → no match.
          const selfY = sextWord(readWordBE(state, off + ENTITY_POS_Y_OFFSET));
          const otherY = sextWord(readWordBE(state, otherOff + ENTITY_POS_Y_OFFSET));
          if (selfY <= otherY) continue;
          // self.y > other.y (signed) → mark D4 = 0 and break (bra to after_scan).
          d4Flag = 0;
          break;
        }

        // after_scan: reset script ptr + clear substate + dec timer.
        writeLongBE(state, off + ENTITY_SCRIPT_PTR_OFFSET, SCRIPT_PTR_RESET);
        writeByte(state, off + ENTITY_SUBSTATE_OFFSET, 0);
        const timer = readByte(state, off + ENTITY_TIMER_OFFSET);
        if (timer !== 0) {
          writeByte(state, off + ENTITY_TIMER_OFFSET, (timer - 1) & 0xff);
        }
        const newTimer = readByte(state, off + ENTITY_TIMER_OFFSET);
        if (newTimer !== 0) {
          goToMovementBlock = true;
        } else {
          // Timer arrivato a 0: state branch.
          rec.enteredStateBranch = true;
          const vel = readLongBE(state, off + ENTITY_VEL_OFFSET);
          if (vel === VEL_PIVOT_IF && d4Flag !== 0) {
            // "if" branch.
            rec.ifBranchTaken = true;
            writeByte(state, off + ENTITY_STATE_OFFSET, STATE_IF);
            writeLongBE(state, off + ENTITY_VEL_OFFSET, VEL_IF_SET);
            //   while (limit <= D0): D0 -= limit
            // Upstream `rngNext` uses `<` instead of `<=`. For limit=2,
            const rngRaw = rngNext(state.rng, as_u16(RNG_LIMIT)) as unknown as number;
            const rngVal = rngRaw % RNG_LIMIT;
            const newTimerVal = (rngVal + TIMER_IF_OFFSET) & 0xff;
            writeByte(state, off + ENTITY_TIMER_OFFSET, newTimerVal);
          } else {
            // "else" branch.
            rec.ifBranchTaken = false;
            writeByte(state, off + ENTITY_STATE_OFFSET, STATE_ELSE);
            writeLongBE(state, off + ENTITY_VEL_OFFSET, VEL_ELSE_SET);
            //   while (limit <= D0): D0 -= limit
            // Upstream `rngNext` uses `<` instead of `<=`. For limit=2,
            const rngRaw = rngNext(state.rng, as_u16(RNG_LIMIT)) as unknown as number;
            const rngVal = rngRaw % RNG_LIMIT;
            const newTimerVal = (rngVal + TIMER_ELSE_OFFSET) & 0xff;
            writeByte(state, off + ENTITY_TIMER_OFFSET, newTimerVal);
          }
          goToMovementBlock = true;
        }
      }
    }

    // ─── Recheck-terminator path ──────────────────────────────────────────
    if (goToRecheckTerminator) {
      // movea.l (0x1C,A2),A0 ; moveq -1,D0 ; cmp.l (A0),D0 ; bne → movement
      const scriptPtr = readLongBE(state, off + ENTITY_SCRIPT_PTR_OFFSET);
      const scriptVal = readLongFromAddr(state, rom, scriptPtr);
      if (scriptVal === 0xffffffff) {
        // cmpi.b #2,(0x1A,A2) ; bne → movement
        if (readByte(state, off + ENTITY_SUBSTATE_OFFSET) === SUBSTATE_CLAMPED) {
          // clr.b (0x18,A2) ; ext sext byte ; jsr FUN_18F46(0xF, sext_l(byte))
          writeByte(state, off + ENTITY_ACTIVE_OFFSET, 0);
          const key19 = readByte(state, off + ENTITY_KEY19_OFFSET);
          subs?.fun_18f46?.(state, FUN_18F46_ARG1, sextByte(key19));
        }
      }
      goToMovementBlock = true;
    }

    // ─── Movement block @ 0x19CF2 ─────────────────────────────────────────
    // Always reached (every path falls into it eventually).
    void goToMovementBlock;
    // tst.b (0x1A,A2) ; bne → ai_block
    if (readByte(state, off + ENTITY_SUBSTATE_OFFSET) === 0) {
      rec.enteredMovement = true;
      // d4Flag from the scan block. The M68k code shares the physical register,
      // but the TS port keeps separate variables for readability.
      const savedY = readLongBE(state, off + ENTITY_POS_Y_OFFSET);
      const vel = readLongBE(state, off + ENTITY_VEL_OFFSET);
      // entity[0x10] += entity[0x4] (32-bit wrap).
      const newY = (savedY + vel) >>> 0;
      writeLongBE(state, off + ENTITY_POS_Y_OFFSET, newY);

      if (subs?.fun_1bb08 !== undefined) {
        subs.fun_1bb08(state, entityAddr);
      } else {
        sub1BB08(state, entityAddr);
      }

      // jsr FUN_1CC62(1) → D0.
      const cc62Result = (subs?.fun_1cc62?.(state, FUN_1CC62_ARG) ?? 0) >>> 0;

      // cmp.l (0x14,A2),D0 ; ble → ai_block
      // cmp.l src=(0x14,A2), dst=D0. ble: D0 <= (0x14,A2) signed.
      const depthThreshold = readLongBE(state, off + ENTITY_POS_Z_OFFSET);
      // Signed comparison on 32-bit values:
      const cc62S = cc62Result | 0;
      const depthS = depthThreshold | 0;
      if (cc62S > depthS) {
        // Y-clamp branch.
        rec.yClamped = true;
        const clampedY = (savedY & Y_CLAMP_MASK) >>> 0;
        writeLongBE(state, off + ENTITY_POS_Y_OFFSET, clampedY);
        writeLongBE(state, off + ENTITY_SCRIPT_PTR_OFFSET, SCRIPT_PTR_CLAMP);
        writeByte(state, off + ENTITY_ANIM_COUNTER_OFFSET, 0);
        writeByte(state, off + ENTITY_STATE_OFFSET, STATE_IF);
        writeByte(state, off + ENTITY_SUBSTATE_OFFSET, SUBSTATE_CLAMPED);
        d3SoundFlag = 1;
      }
    }

    // ─── AI block @ 0x19D44 ───────────────────────────────────────────────
    subs?.fun_19e42?.(state, entityAddr);

    // tst.b D3 ; beq → next_entity
    if (d3SoundFlag !== 0) {
      // D0w = (0xC,A2).w ; asr.w #3,D0w ; cmp.w D0,D1=#0x35 ; ble → next
      // ble: D1 <= D0 signed → skip. So proceed only if D1 > D0 → 0x35 > D0_signed.
      const xWord = readWordBE(state, off + ENTITY_POS_X_OFFSET);
      const xSigned = sextWord(xWord);
      const xShifted = xSigned >> 3; // asr.w #3 (signed)
      // The `cmp.w D0,D1` compares D1.w - D0.w. ble: D1 <= D0 (signed word).
      // After asr.w, D0.w = xShifted & 0xFFFF. D1.w = 0x35. ble if 0x35 <= D0.w_s.
      const d0w = sextWord(xShifted & 0xffff);
      if (SOUND_X_THRESHOLD > d0w) {
        // D0w = (0x22,A2).w ; andi.w #-1,D0 ; tst.w D0 ; blt → next
        const yWord = readWordBE(state, off + ENTITY_SCREEN_Y_OFFSET);
        const ySigned = sextWord(yWord);
        if (ySigned >= 0 && ySigned < SOUND_Y_UPPER) {
          // jsr FUN_158AC(0x59).
          subs?.fun_158ac?.(state, SOUND_TRIGGER_ARG);
          rec.soundFired = true;
        }
      }
    }

    perEntity.push(rec);
  }

  return {
    gatedOut: false,
    spawnDispatched,
    perEntity,
  };
}
