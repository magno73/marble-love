/**
 * refresh-helper-1912c.ts — replica `FUN_0001912C` (130 byte).
 *
 * "Refresh-frame entity ticker with slot-scan flag". Chiamato ogni frame dal
 * refresh-frame handler `FUN_00010FCE`. Gated su `*0x400394.w == 4`.
 *
 * **Struttura**:
 *   1. Gate: `*0x400394.w == 4` — se != 4 → rts immediato.
 *   2. Slot scan (`A1 = 0x400018`, stride `0xE2`, count `= *0x400396.w`):
 *      per ogni slot con `slot[0x18]==1 && slot[0x14..0x15].w == 0x3F6E &&
 *      slot[0x1b]==1` → D3 = 1. D3 inizia a 0.
 *   3. Entity loop (`A2 = 0x401890`, stride `0x28`, count 9):
 *      per ogni entity con `entity[0x18] != 0`:
 *        a. `entity[0x24]++`
 *        b. Se `entity[0x1A] != 2`: `entity[0x1A] = D3`
 *        c. threshold D0: `entity[0x1A]==1` → 1, altrimenti → 3
 *        d. Se `D0 > entity[0x24]` (signed byte): chiama solo FUN_199D6(entity)
 *        e. Altrimenti: `entity[0x24] = 0`; branch su `entity[0x25]`:
 *             - `== 7` AND `entity[0x1A]==2`:
 *                 `entity[0x1C] += 4`; A0 = entity[0x1C];
 *                 se `[A0] == 0xFFFFFFFF`: chiama FUN_194BA(entity);
 *                 chiama FUN_199D6(entity)
 *             - `== 7` AND `entity[0x1A] != 2`:
 *                 `entity[0x0C] += entity[0x00]`; `entity[0x10] += entity[0x04]`;
 *                 `entity[0x1B]++`;
 *                 se `entity[0x1B] < 4`: chiama FUN_199D6(entity)
 *                 altrimenti: chiama FUN_194BA(entity); `entity[0x1B] = 0`;
 *                 chiama FUN_199D6(entity)
 *             - `!= 7`:
 *                 `entity[0x1C] += 4`; A0 = entity[0x1C];
 *                 se `[A0] == 0xFFFFFFFF`:
 *                   `entity[0x0C] += entity[0x00]`; `entity[0x10] += entity[0x04]`;
 *                   chiama FUN_194BA(entity);
 *                 chiama FUN_199D6(entity)
 *
 * **Disasm 0x1912C..0x1924D** (130 byte, ricostruito forzando branch target
 * nascosti da padding/dati):
 *
 *   0x1912c  movem.l {D2,D3,D4,A2},-(SP)
 *   0x19130  moveq   0x4,D0
 *   0x19132  cmp.w   (0x400394).l,D0w        ; gate: game-mode word == 4?
 *   0x19138  bne.w   epilog
 *   0x1913c  clr.b   D3b                     ; D3 = 0 (slot-scan flag)
 *   0x1913e  movea.l #0x400018,A1            ; A1 = slot-array base
 *   0x19144  clr.b   D2b                     ; D2 = 0 (scan index)
 *   0x19146  bra.b   check_slot              ; → 0x19170
 *
 *   slot_scan_body @ 0x19148:
 *   0x19148  cmpi.b  #0x1,(0x18,A1)          ; slot[0x18] == 1?
 *   0x1914e  bne.b   skip_slot
 *   0x19150  lea     (0x14,A1),A0
 *   0x19154  cmpi.w  #0x3f6e,(A0)            ; slot[0x14..0x15] == 0x3F6E?
 *   0x19158  bne.b   skip_slot
 *   0x1915a  cmpi.b  #0x1,(0x1b,A1)          ; slot[0x1b] == 1?
 *   0x19160  bne.b   skip_slot
 *   0x19162  moveq   0x1,D3                  ; D3 = 1
 *   skip_slot @ 0x19164:
 *   0x19164  move.l  A1,D4
 *   0x19166  addi.l  #0xe2,D4                ; D4 = A1 + 0xE2 (stride)
 *   0x1916c  movea.l D4,A1                   ; A1 = next slot
 *   0x1916e  addq.b  0x1,D2b                 ; D2++
 *   check_slot @ 0x19170:
 *   0x19170  move.b  D2b,D0b
 *   0x19172  ext.w   D0w
 *   0x19174  cmp.w   (0x400396).l,D0w        ; D2.w vs *0x400396 (slot count)
 *   0x1917a  bne.b   slot_scan_body          ; loop until D2 == count
 *
 *   entity loop @ 0x1917c:
 *   0x1917c  movea.l #0x401890,A2            ; A2 = entity table base
 *   0x19182  clr.b   D2b                     ; D2 = 0 (entity index, 0..8)
 *   entity_top @ 0x19184:
 *   0x19184  tst.b   (0x18,A2)
 *   0x19188  beq.w   entity_advance          ; entity[0x18] == 0 → skip
 *   0x1918c  addq.b  0x1,(0x24,A2)           ; entity[0x24]++
 *   0x19190  cmpi.b  #0x2,(0x1a,A2)
 *   0x19196  beq.b   skip_d3_write           ; entity[0x1A] == 2 → skip
 *   0x19198  move.b  D3b,(0x1a,A2)           ; entity[0x1A] = D3
 *   skip_d3_write @ 0x1919c:
 *   0x1919c  cmpi.b  #0x1,(0x1a,A2)
 *   0x191a2  bne.b   d0_eq_3
 *   0x191a4  moveq   0x1,D0                  ; D0 = 1
 *   0x191a6  bra.b   threshold_check
 *   d0_eq_3 @ 0x191a8:
 *   0x191a8  moveq   0x3,D0                  ; D0 = 3
 *   threshold_check @ 0x191aa:
 *   0x191aa  cmp.b   (0x24,A2),D0b          ; D0.b vs entity[0x24] (signed)
 *   0x191ae  bgt.w   call_199d6_only         ; D0 > entity[0x24] → only v2
 *   0x191b2  clr.b   (0x24,A2)               ; entity[0x24] = 0
 *   0x191b6  cmpi.b  #0x7,(0x25,A2)          ; state == 7?
 *   0x191bc  bne.b   case_not7               ; → 0x1920a
 *   ; state == 7
 *   0x191be  cmpi.b  #0x2,(0x1a,A2)          ; kind == 2?
 *   0x191c4  bne.b   case_kind_not2          ; → 0x191e0
 *   ; state==7 AND kind==2:
 *   0x191c6  addq.l  0x4,(0x1c,A2)           ; entity[0x1C] += 4
 *   0x191ca  movea.l (0x1c,A2),A0
 *   0x191ce  moveq   -0x1,D0                 ; D0 = 0xFFFFFFFF
 *   0x191d0  cmp.l   (A0),D0                 ; [A0] == 0xFFFFFFFF?
 *   0x191d2  bne.b   call_199d6_only         ; no → only v2
 *   0x191d4  move.l  A2,-(SP)
 *   0x191d6  jsr     0x194ba.l               ; FUN_194BA(entity)
 *   0x191dc  addq.l  0x4,SP
 *   0x191de  bra.b   call_199d6_only
 *   ; state==7 AND kind!=2:
 *   case_kind_not2 @ 0x191e0:
 *   0x191e0  move.l  (A2),D0                 ; D0 = entity[0x00..0x03]
 *   0x191e2  add.l   D0,(0xc,A2)             ; entity[0x0C] += entity[0x00]
 *   0x191e6  move.l  (0x4,A2),D0
 *   0x191ea  add.l   D0,(0x10,A2)            ; entity[0x10] += entity[0x04]
 *   0x191ee  addq.b  0x1,(0x1b,A2)           ; entity[0x1B]++
 *   0x191f2  cmpi.b  #0x4,(0x1b,A2)
 *   0x191f8  blt.b   call_199d6_only         ; entity[0x1B] < 4 → only v2
 *   0x191fa  move.l  A2,-(SP)
 *   0x191fc  jsr     0x194ba.l               ; FUN_194BA(entity)
 *   0x19202  clr.b   (0x1b,A2)               ; entity[0x1B] = 0
 *   0x19206  addq.l  0x4,SP
 *   0x19208  bra.b   call_199d6_only
 *   ; state != 7:
 *   case_not7 @ 0x1920a:
 *   0x1920a  addq.l  0x4,(0x1c,A2)           ; entity[0x1C] += 4
 *   0x1920e  movea.l (0x1c,A2),A0
 *   0x19212  moveq   -0x1,D0                 ; D0 = 0xFFFFFFFF
 *   0x19214  cmp.l   (A0),D0                 ; [A0] == 0xFFFFFFFF?
 *   0x19216  bne.b   call_199d6_only         ; no → only v2
 *   0x19218  move.l  (A2),D0
 *   0x1921a  add.l   D0,(0xc,A2)             ; entity[0x0C] += entity[0x00]
 *   0x1921e  move.l  (0x4,A2),D0
 *   0x19222  add.l   D0,(0x10,A2)            ; entity[0x10] += entity[0x04]
 *   0x19226  move.l  A2,-(SP)
 *   0x19228  jsr     0x194ba.l               ; FUN_194BA(entity)
 *   0x1922e  addq.l  0x4,SP
 *   call_199d6_only @ 0x19230:
 *   0x19230  move.l  A2,-(SP)
 *   0x19232  jsr     0x199d6.l               ; FUN_199D6(entity)
 *   0x19238  addq.l  0x4,SP
 *   entity_advance @ 0x1923a:
 *   0x1923a  moveq   0x28,D0
 *   0x1923c  adda.l  D0,A2                   ; A2 += 0x28
 *   0x1923e  addq.b  0x1,D2b                 ; D2++
 *   0x19240  cmpi.b  #0x9,D2b                ; D2 == 9?
 *   0x19244  bne.w   entity_top
 *   epilog @ 0x19248:
 *   0x19248  movem.l (SP)+,{D2,D3,D4,A2}
 *   0x1924c  rts
 *
 * **Addresses/memory layout**:
 *   - `0x400394`: game-mode word (gate == 4).
 *   - `0x400396`: slot-scan count word (how many slots to scan).
 *   - `0x400018`: slot-array base; each slot is 0xE2 bytes.
 *   - `0x401890`: entity table base; 9 entities × 0x28 bytes.
 *
 * **Slot struct offsets** (scanned for D3 flag):
 *   - `+0x18` (byte): active flag (must == 1).
 *   - `+0x14..+0x15` (word): type id (must == 0x3F6E).
 *   - `+0x1b` (byte): sub-flag (must == 1).
 *
 * **Entity struct offsets** (accessed in body):
 *   - `+0x00..+0x03` (long): velocity-X or delta (added to entity[0x0C]).
 *   - `+0x04..+0x07` (long): velocity-Y or delta (added to entity[0x10]).
 *   - `+0x0C..+0x0F` (long): position-X accumulator.
 *   - `+0x10..+0x13` (long): position-Y accumulator.
 *   - `+0x18` (byte): active flag (loop guard).
 *   - `+0x1A` (byte): kind byte (0/1/2; controls threshold + D3-write guard).
 *   - `+0x1B` (byte): sub-counter (incremented in state==7/kind!=2 path).
 *   - `+0x1C..+0x1F` (long): script/fn ptr (advanced by +4 in script paths).
 *   - `+0x24` (byte): animation counter (incremented every active tick).
 *   - `+0x25` (byte): animation threshold / state selector.
 *
 * **JSR esterne** (via sub-injection):
 *   - `FUN_000194BA` (`objectTypeDispatch194BA`) — già replicato in
 *     `object-type-dispatch-194ba.ts`. Iniettabile come `subs.fun_194ba`.
 *   - `FUN_000199D6` (`computeSpriteCoords_v2`) — già replicato in
 *     `sprite-coords.ts`. Iniettabile come `subs.fun_199d6`.
 *
 * **Caller noto** (1 xref): `FUN_00010FCE` @ 0x10FF8.
 *
 * Verifica bit-perfect via
 * `packages/cli/src/test-refresh-helper-1912c-parity.ts` (500 casi).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Addresses ───────────────────────────────────────────────────────────────

/** Required value @ workRam[0x394].w to enable the function body. */
export const GAME_MODE_WORD_OFF = 0x394 as const;
/** Word at 0x400396: how many slots to scan in slot-scan phase. */
export const SLOT_COUNT_WORD_OFF = 0x396 as const;
/** m68k base addr of slot array scanned for D3 flag. */
export const SLOT_ARRAY_BASE = 0x00400018 as const;
/** Stride (bytes) between consecutive slots in the slot array. */
export const SLOT_STRIDE = 0xe2 as const;
/** Sentinel word value at slot+0x14 that contributes to D3 flag. */
export const SLOT_TYPE_SENTINEL = 0x3f6e as const;

/** m68k base addr of entity table. */
export const ENTITY_TABLE_BASE = 0x00401890 as const;
/** Stride (bytes) per entity. */
export const ENTITY_STRIDE = 0x28 as const;
/** Number of entities in the loop. */
export const ENTITY_COUNT = 9 as const;

/** Required game-mode value for gate pass. */
export const GAME_MODE_REQUIRED = 4 as const;

// ─── Entity offsets ──────────────────────────────────────────────────────────

/** Long @ entity[0x00]: delta / velocity component added to entity[0x0C]. */
export const ENTITY_DELTA_X_OFFSET = 0x00 as const;
/** Long @ entity[0x04]: delta / velocity component added to entity[0x10]. */
export const ENTITY_DELTA_Y_OFFSET = 0x04 as const;
/** Long @ entity[0x0C]: position-X accumulator. */
export const ENTITY_POS_X_OFFSET = 0x0c as const;
/** Long @ entity[0x10]: position-Y accumulator. */
export const ENTITY_POS_Y_OFFSET = 0x10 as const;
/** Byte @ entity[0x18]: active flag (0 = inactive, skip entity). */
export const ENTITY_ACTIVE_OFFSET = 0x18 as const;
/** Byte @ entity[0x1A]: kind byte (0/1/2). Controls threshold + D3 guard. */
export const ENTITY_KIND_OFFSET = 0x1a as const;
/** Byte @ entity[0x1B]: sub-counter incremented in state==7/kind!=2 path. */
export const ENTITY_SUB_COUNTER_OFFSET = 0x1b as const;
/** Long @ entity[0x1C]: script/fn pointer advanced by +4 in script paths. */
export const ENTITY_SCRIPT_PTR_OFFSET = 0x1c as const;
/** Byte @ entity[0x24]: animation counter incremented each active tick. */
export const ENTITY_ANIM_COUNTER_OFFSET = 0x24 as const;
/** Byte @ entity[0x25]: animation threshold / state selector. */
export const ENTITY_STATE_OFFSET = 0x25 as const;

/** State value that triggers the "state==7" branch. */
export const STATE_TRIGGER = 0x07 as const;
/** Kind byte value that means "clamped / keep-ptr" (guard for D3 write). */
export const KIND_CLAMPED = 0x02 as const;
/** Kind byte value that selects threshold==1 (vs default 3). */
export const KIND_ONE_THRESHOLD = 0x01 as const;
/** Threshold for kind==1 entity (D0=1). */
export const THRESHOLD_KIND1 = 1 as const;
/** Threshold for other kinds (D0=3). */
export const THRESHOLD_DEFAULT = 3 as const;
/** Sub-counter limit in state==7/kind!=2 path: call FUN_194BA when >= this. */
export const SUB_COUNTER_LIMIT = 4 as const;

// ─── Sub injection ───────────────────────────────────────────────────────────

/**
 * Stub injection per le 2 JSR esterne. Default: tutte no-op (matching del
 * binario stubbato con RTS nel parity test).
 */
export interface RefreshHelper1912CSubs {
  /**
   * `FUN_000194BA` (`objectTypeDispatch194BA`) — chiamato nei path
   * "state==7/kind==2 con terminator" e "state==7/kind!=2 quando counter>=4"
   * e "state!=7 con terminator".
   */
  fun_194ba?: (state: GameState, entityAddr: number) => void;
  /**
   * `FUN_000199D6` (`computeSpriteCoords_v2`) — chiamato per ogni entity
   * attiva che supera il guard `entity[0x18]!=0`.
   */
  fun_199d6?: (state: GameState, entityAddr: number) => void;
}

// ─── Result ──────────────────────────────────────────────────────────────────

/** Quale branch della dispatch state/kind è stato preso. */
export type EntityBranch =
  | "threshold_only"    // D0 > entity[0x24]: solo FUN_199D6
  | "state7_kind2_term" // state==7 AND kind==2 AND [ptr]==0xFFFF_FFFF
  | "state7_kind2_cont" // state==7 AND kind==2 AND [ptr]!=0xFFFF_FFFF
  | "state7_kindx_lt4"  // state==7 AND kind!=2 AND sub_counter < 4
  | "state7_kindx_ge4"  // state==7 AND kind!=2 AND sub_counter >= 4
  | "not7_term"         // state!=7 AND [ptr]==0xFFFF_FFFF
  | "not7_cont";        // state!=7 AND [ptr]!=0xFFFF_FFFF

/** Dettaglio del tick di una singola entity. */
export interface EntityTickRecord {
  /** Index entity (0..8). */
  slot: number;
  /** True se l'entity era attiva (entity[0x18] != 0). */
  wasActive: boolean;
  /** Branch preso (null se entity non attiva). */
  branch: EntityBranch | null;
}

/** Risultato aggregato di `refreshHelper1912C`. */
export interface RefreshHelper1912CResult {
  /** True se la funzione è uscita early (gate != 4). */
  gatedOut: boolean;
  /**
   * True se D3 flag è stato alzato durante lo slot scan (almeno uno slot con
   * slot[0x18]==1 && slot[0x14..0x15]==0x3F6E && slot[0x1b]==1).
   */
  slotFlagSet: boolean;
  /** Dettaglio per-entity. Vuoto se gatedOut. */
  perEntity: EntityTickRecord[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
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

/**
 * Read a 32-bit BE long from m68k absolute address, dispatching by region.
 *
 * `entity[0x1C]` (script ptr) può puntare in ROM (valori iniziali) oppure in
 * workRam dopo i `addq.l #4`. La funzione dispatch:
 *   - addr < 0x400000 → ROM (rom.program)
 *   - 0x400000 ≤ addr < 0x402000 → workRam
 *   - altrove → 0 (safe default)
 */
function readLongFromAddr(state: GameState, rom: RomImage, addr: number): number {
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

/** Sign-extend byte (8-bit) to signed JS number. */
function sextByte(b: number): number {
  const v = b & 0xff;
  return v & 0x80 ? v - 0x100 : v;
}

// ─── Replica ─────────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_0001912C`.
 *
 * @param state  GameState. Modifica `state.workRam` per le entity attive.
 * @param rom    RomImage — usata per leggere i long puntati da
 *               `entity[0x1C]` quando il puntatore è in ROM (< 0x400000).
 * @param subs   Stub injection per le 2 JSR esterne. Default: tutte no-op.
 *
 * @returns dettaglio del gate, del slot-scan flag e del per-entity tick.
 */
export function refreshHelper1912C(
  state: GameState,
  rom: RomImage,
  subs?: RefreshHelper1912CSubs,
): RefreshHelper1912CResult {
  // ─── Gate: *0x400394.w == 4 ──────────────────────────────────────────────
  const gameMode = readWordBE(state, GAME_MODE_WORD_OFF);
  if (gameMode !== GAME_MODE_REQUIRED) {
    return { gatedOut: true, slotFlagSet: false, perEntity: [] };
  }

  // ─── Slot scan: D3 flag ───────────────────────────────────────────────────
  // D3 = 0 ; A1 = 0x400018 ; D2 = 0
  // loop: slot_scan_body, check_slot (until D2 == *0x400396)
  let d3Flag = 0;
  const slotCount = readWordBE(state, SLOT_COUNT_WORD_OFF);

  // Compute initial slot array offset in workRam (0x400018 → 0x18).
  let a1Off = SLOT_ARRAY_BASE - 0x400000; // 0x18

  for (let d2 = 0; d2 !== (slotCount & 0xffff); ) {
    // slot_scan_body: check conditions for D3 = 1
    const slotActive = readByte(state, a1Off + 0x18);
    if (slotActive === 1) {
      const slotType = readWordBE(state, a1Off + 0x14);
      if (slotType === SLOT_TYPE_SENTINEL) {
        const slotSubFlag = readByte(state, a1Off + 0x1b);
        if (slotSubFlag === 1) {
          d3Flag = 1;
        }
      }
    }

    // skip_slot / advance: A1 += 0xE2, D2++
    a1Off = (a1Off + SLOT_STRIDE) >>> 0;
    d2 = (d2 + 1) & 0xff;
    // check_slot: compare D2 (byte→word zero-extended) with *0x400396 (word)
    // loop exits when D2.w == slotCount
  }

  // ─── Entity loop: D2 = 0..8 (cmpi.b #0x9,D2b; bne → loop) ──────────────
  const perEntity: EntityTickRecord[] = [];

  for (let d2 = 0; d2 < ENTITY_COUNT; d2++) {
    const entityAddr = (ENTITY_TABLE_BASE + d2 * ENTITY_STRIDE) >>> 0;
    const off = entityAddr - 0x400000;

    const rec: EntityTickRecord = {
      slot: d2,
      wasActive: false,
      branch: null,
    };

    // tst.b (0x18,A2) ; beq → entity_advance
    if (readByte(state, off + ENTITY_ACTIVE_OFFSET) === 0) {
      perEntity.push(rec);
      continue;
    }
    rec.wasActive = true;

    // addq.b #1,(0x24,A2)
    const newCounter = (readByte(state, off + ENTITY_ANIM_COUNTER_OFFSET) + 1) & 0xff;
    writeByte(state, off + ENTITY_ANIM_COUNTER_OFFSET, newCounter);

    // cmpi.b #0x2,(0x1a,A2) ; beq → skip_d3_write
    const kind = readByte(state, off + ENTITY_KIND_OFFSET);
    if (kind !== KIND_CLAMPED) {
      // move.b D3b,(0x1a,A2)
      writeByte(state, off + ENTITY_KIND_OFFSET, d3Flag);
    }

    // Re-read after potential write (matches binary: cmpi reads updated value).
    const kindAfter = readByte(state, off + ENTITY_KIND_OFFSET);

    // D0 = (kindAfter == 1) ? 1 : 3
    const threshold = kindAfter === KIND_ONE_THRESHOLD ? THRESHOLD_KIND1 : THRESHOLD_DEFAULT;

    // cmp.b (0x24,A2),D0b ; bgt.w call_199d6_only
    // cmp.b src=(0x24,A2), dst=D0b. bgt: D0 > entity[0x24] signed.
    const thresholdS = sextByte(threshold);
    const counterS = sextByte(newCounter);

    if (thresholdS > counterS) {
      // bgt → just call FUN_199D6
      rec.branch = "threshold_only";
      subs?.fun_199d6?.(state, entityAddr);
      perEntity.push(rec);
      continue;
    }

    // clr.b (0x24,A2)
    writeByte(state, off + ENTITY_ANIM_COUNTER_OFFSET, 0);

    // cmpi.b #0x7,(0x25,A2)
    const stateByte = readByte(state, off + ENTITY_STATE_OFFSET);

    if (stateByte === STATE_TRIGGER) {
      // state == 7
      if (kindAfter === KIND_CLAMPED) {
        // kind == 2: script-ptr advance path
        // addq.l 0x4,(0x1c,A2)
        const scriptPtr = (readLongBE(state, off + ENTITY_SCRIPT_PTR_OFFSET) + 4) >>> 0;
        writeLongBE(state, off + ENTITY_SCRIPT_PTR_OFFSET, scriptPtr);

        // movea.l (0x1c,A2),A0 ; moveq -1,D0 ; cmp.l (A0),D0
        const scriptVal = readLongFromAddr(state, rom, scriptPtr);

        if (scriptVal === 0xffffffff) {
          // [A0] == 0xFFFFFFFF → call FUN_194BA then FUN_199D6
          rec.branch = "state7_kind2_term";
          subs?.fun_194ba?.(state, entityAddr);
        } else {
          // bne → only FUN_199D6
          rec.branch = "state7_kind2_cont";
        }
      } else {
        // kind != 2: position-update path
        // entity[0x0C] += entity[0x00] (long)
        const deltaX = readLongBE(state, off + ENTITY_DELTA_X_OFFSET);
        const posX = (readLongBE(state, off + ENTITY_POS_X_OFFSET) + deltaX) >>> 0;
        writeLongBE(state, off + ENTITY_POS_X_OFFSET, posX);

        // entity[0x10] += entity[0x04] (long)
        const deltaY = readLongBE(state, off + ENTITY_DELTA_Y_OFFSET);
        const posY = (readLongBE(state, off + ENTITY_POS_Y_OFFSET) + deltaY) >>> 0;
        writeLongBE(state, off + ENTITY_POS_Y_OFFSET, posY);

        // addq.b 0x1,(0x1b,A2)
        const subCounter = (readByte(state, off + ENTITY_SUB_COUNTER_OFFSET) + 1) & 0xff;
        writeByte(state, off + ENTITY_SUB_COUNTER_OFFSET, subCounter);

        // cmpi.b #0x4,(0x1b,A2) ; blt → call_199d6_only
        if (subCounter < SUB_COUNTER_LIMIT) {
          rec.branch = "state7_kindx_lt4";
        } else {
          // >= 4: call FUN_194BA, clear sub_counter, call FUN_199D6
          rec.branch = "state7_kindx_ge4";
          subs?.fun_194ba?.(state, entityAddr);
          writeByte(state, off + ENTITY_SUB_COUNTER_OFFSET, 0);
        }
      }
    } else {
      // state != 7: script-ptr advance path
      // addq.l 0x4,(0x1c,A2)
      const scriptPtr = (readLongBE(state, off + ENTITY_SCRIPT_PTR_OFFSET) + 4) >>> 0;
      writeLongBE(state, off + ENTITY_SCRIPT_PTR_OFFSET, scriptPtr);

      // movea.l (0x1c,A2),A0 ; moveq -1,D0 ; cmp.l (A0),D0
      const scriptVal = readLongFromAddr(state, rom, scriptPtr);

      if (scriptVal === 0xffffffff) {
        // [A0] == 0xFFFFFFFF → update positions + call FUN_194BA + call FUN_199D6
        rec.branch = "not7_term";

        // entity[0x0C] += entity[0x00] (long)
        const deltaX = readLongBE(state, off + ENTITY_DELTA_X_OFFSET);
        const posX = (readLongBE(state, off + ENTITY_POS_X_OFFSET) + deltaX) >>> 0;
        writeLongBE(state, off + ENTITY_POS_X_OFFSET, posX);

        // entity[0x10] += entity[0x04] (long)
        const deltaY = readLongBE(state, off + ENTITY_DELTA_Y_OFFSET);
        const posY = (readLongBE(state, off + ENTITY_POS_Y_OFFSET) + deltaY) >>> 0;
        writeLongBE(state, off + ENTITY_POS_Y_OFFSET, posY);

        subs?.fun_194ba?.(state, entityAddr);
      } else {
        // bne → only FUN_199D6
        rec.branch = "not7_cont";
      }
    }

    // All active-entity paths converge here: call FUN_199D6.
    subs?.fun_199d6?.(state, entityAddr);

    perEntity.push(rec);
  }

  return {
    gatedOut: false,
    slotFlagSet: d3Flag !== 0,
    perEntity,
  };
}

export const REFRESH_HELPER_1912C_ADDR = 0x0001912c as const;
