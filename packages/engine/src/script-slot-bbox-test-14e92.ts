/**
 * script-slot-bbox-test-14e92.ts — replica `FUN_00014E92` (574 byte) bit-perfect.
 *
 * "Marble-vs-script-slot bbox overlap test sull'array `0x401302` (4 slot,
 * stride `0x60`)". Gated da `*0x400394 ∈ {1, 2, 5}`. Per ogni slot armato
 * (`slot[0x18] != 0`) costruisce una bbox 3-D dalla posizione dello slot e
 * dai 4 byte puntati da `slot[0x58]` (offset +4..+7) e la confronta col
 * volume marble (`*0x400690..0x400695`, espanso ±3 sugli assi X/Y, +0xE su Z).
 * La prima slot in collisione termina la scansione e dispatcha un cocktail di
 * scritture su `slot` e sull'entity arg (`A2`).
 *
 * **Disasm 0x14E92..0x150D0** vedi `/tmp/marble-cand/014E92.txt`.
 *
 * Pattern parallelo a `script-slot-claim.ts` (allocazione slot da tabella
 * ROM) — questo è invece la "controparte di hit-test" che usa l'array fissato.
 *
 * **Selettore early-exit (`*0x400394`)**: word; deve essere 1, 2 o 5. Altri
 * valori → la funzione non tocca nulla e ritorna direttamente al caller via
 * il `movem.l (SP)+; unlk; rts` saltando il calcolo di D0 → D0 al ritorno è
 * il valore caller-provided (non parte del contratto). Per parity in TS:
 * `void`, niente confronto su D0.
 *
 * **Volume marble** (calcolato una volta prima del loop):
 *   X range = [worldX - 3, worldX + 3]   (D6, A4)
 *   Y range = [worldY - 3, worldY + 3]   (A1, sp[-2])
 *   Z range = [worldZ,     worldZ + 0xE] (sp[-6], sp[-4])
 *
 * **Volume slot** (per ciascun slot):
 *   - Se `*(slot[0x58]).l == -1`: bbox di default `(D0=-4, D3=-4, D2=8, D4=8)`.
 *     Cioè effettivamente bbox (-4, -4, 8+(-4), 8+(-4)) = (-4, -4, 4, 4).
 *     **Nota**: non `(-1, -1, ...)` perché il `moveq #-4, D0` sovrascrive D0
 *     prima del calcolo `D5 = slot[0xC] + D0`.
 *   - Else: legge i 4 byte signed `(0x4..0x7, *slot[0x58])` come deltas:
 *     D0 = bbox[0].b sext, D3 = bbox[1].b sext, D2 = bbox[2].b sext, D4 = bbox[3].b sext.
 *
 *   Gli range slot sono:
 *     X: [slot[0xC] + D0, slot[0xC] + D0 + D2]      (D5, sp[-8])
 *     Y: [slot[0x10] + D3, slot[0x10] + D3 + D4]    (D0, D3)
 *     Z: [slot[0x14], slot[0x14] + 0x10]            (D2, D4)
 *
 * **Test di overlap** (signed word, 16-bit):
 *   X: marble.X ∩ slot.X non vuoto (ovvero `slot.minX <= marble.maxX AND
 *      marble.minX <= slot.maxX`).
 *   Y: idem.
 *   Z: idem.
 *
 * **Hit (passa tutti e 3)**: imposta D2=1 e dispatcha su `slot[0x1A]`.
 *   - Se `slot[0x1A] ∈ {0, 3}`:
 *       slot[0x1A] = 2.
 *       jsr FUN_15460(slot) — dispatcher di direzione (514 byte, `/tmp/marble-cand/015460.txt`).
 *       slot[0..3]    = entity[0..3]   (long copy)
 *       slot[0x1C..0x1F] = entity[0..3] (long copy, stesso valore)
 *       slot[0x4..0x7]  = entity[0x4..0x7] (long copy)
 *       slot[0x20..0x23] = entity[0x4..0x7] (long copy, stesso valore)
 *   - Test "alt-key match": se `slot[0x1A] ∈ {1, 5, 6}` AND `entity[0x19].b sext.w
 *     == slot[0x56].w` → AND se `slot[0x1A] ∈ {1, 6}` exit immediato (D2=1).
 *     Else cade in 0x15020.
 *   - 0x15020: se `entity[0x1A] != 5 AND slot[0x1A] != 5` → scrive
 *     `slot[0x56].w = sext(entity[0x19].b)`.
 *   - 0x1503A: scrive globali in entity:
 *       entity[0xC..0xF]   = *(0x400684).l
 *       entity[0x10..0x13] = *(0x400688).l
 *       entity[0..3]       = 0
 *       entity[0x4..0x7]   = 0
 *   - Branch su `entity[0x1A]`:
 *       == 1: entity[0x5F] = 0; entity[0x60] = 2; entity[0x5A..0x5D] = 0x20FB6
 *       != 1 AND != 5: jsr FUN_158AC(0x39); entity[0x5F] = 0; entity[0x60] = 2;
 *                      entity[0x5A..0x5D] = 0x20FAA
 *       == 5: skip questo blocco
 *   - Final: se `entity[0x1A] != 5 AND entity[0x1A] != 7`:
 *       entity[0x1A] = 5; entity[0x56] = 0x32.
 *   - Exit (D2 = 1).
 *
 * **Ordine delle 4 slot iterate**: 0x401302, 0x401362, 0x4013C2, 0x401422.
 * Loop interrotto al primo hit. Slot non-armed (`slot[0x18] == 0`) saltati.
 *
 * **Side effects sub-callate**:
 *   - `FUN_15460(slot)`: dispatcher di direzione che scrive `slot[0x5C..0x5F]`
 *     (long), `slot[0x58..0x5B]` (long), `slot[0x24..0x27]` (4 byte). Solo
 *     chiamata se `slot[0x1A] ∈ {0, 3}`. Replica completa NON inclusa qui:
 *     stub injection via `subs.fun_15460`. Default = no-op (matching parity
 *     test che patcha FUN_15460 a RTS, oppure a un thunk-mirror lato TS).
 *   - `FUN_158AC(0x39)`: sound command (`sound-cmd-send.ts`). Default no-op.
 *
 * **Caller**: `FUN_000121B8` @ 0x123C6 (chiamata incondizionata).
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { stateDispatch15460 } from "./state-dispatch-15460.js";

const WORK_RAM_BASE = 0x400000 as const;

// ─── Globals (offset workRam relativi a 0x400000) ────────────────────────

/** Selector word @ `0x400394` — gate del loop (deve essere 1, 2 o 5). */
export const SELECTOR_WORD_OFF = 0x394 as const;
/** Word @ `0x400690` — marble world X. */
export const WORLD_X_WORD_OFF = 0x690 as const;
/** Word @ `0x400692` — marble world Y. */
export const WORLD_Y_WORD_OFF = 0x692 as const;
/** Word @ `0x400694` — marble world Z. */
export const WORLD_Z_WORD_OFF = 0x694 as const;
/** Long @ `0x400684` — copiato in `entity[0xC]` su hit. */
export const GLOBAL_684_LONG_OFF = 0x684 as const;
/** Long @ `0x400688` — copiato in `entity[0x10]` su hit. */
export const GLOBAL_688_LONG_OFF = 0x688 as const;

// ─── Slot array @ 0x401302 ───────────────────────────────────────────────

/** Indirizzo assoluto m68k della slot 0 (`movea.l #0x401302, A3`). */
export const SLOT_ARRAY_BASE_ADDR = 0x401302 as const;
/** Stride tra due slot consecutive (`moveq #0x60, D0; adda.l D0, A3`). */
export const SLOT_STRIDE = 0x60 as const;
/** Numero di slot iterate (`cmpi.b #4, D1b`). */
export const SLOT_COUNT = 4 as const;

// Field offsets all'interno di una slot.
/** Byte: gate "armed" (skip slot se 0). */
export const SLOT_ARMED_OFF = 0x18 as const;
/** Byte: state (controlla bind/dispatch path). */
export const SLOT_STATE_OFF = 0x1a as const;
/** Word BE: slot X position. */
export const SLOT_X_OFF = 0x0c as const;
/** Word BE: slot Y position. */
export const SLOT_Y_OFF = 0x10 as const;
/** Word BE: slot Z position. */
export const SLOT_Z_OFF = 0x14 as const;
/** Long BE: pointer al record bbox-extents (4 byte signed @ +4..+7). */
export const SLOT_BBOX_PTR_OFF = 0x58 as const;
/** Word BE: alt-match key (entity[0x19] confrontato con questo). */
export const SLOT_KEY_WORD_OFF = 0x56 as const;
/** Long BE: campo scritto su hit (insieme a +0x1C). */
export const SLOT_FIELD_0_OFF = 0x00 as const;
/** Long BE: copia di slot[0x00] su hit. */
export const SLOT_FIELD_1C_OFF = 0x1c as const;
/** Long BE: campo scritto su hit (insieme a +0x20). */
export const SLOT_FIELD_4_OFF = 0x04 as const;
/** Long BE: copia di slot[0x04] su hit. */
export const SLOT_FIELD_20_OFF = 0x20 as const;

// ─── Entity (A2 arg) field offsets ───────────────────────────────────────

/** Long BE: clear su hit (e copiato in slot[0] / slot[0x1C]). */
export const ENTITY_FIELD_0_OFF = 0x00 as const;
/** Long BE: clear su hit (e copiato in slot[0x04] / slot[0x20]). */
export const ENTITY_FIELD_4_OFF = 0x04 as const;
/** Long BE: scritto da global 0x400684 su hit. */
export const ENTITY_FIELD_C_OFF = 0x0c as const;
/** Long BE: scritto da global 0x400688 su hit. */
export const ENTITY_FIELD_10_OFF = 0x10 as const;
/** Byte: alt-match key (sext.w confrontato con slot[0x56].w). */
export const ENTITY_KEY_BYTE_OFF = 0x19 as const;
/** Byte: state (controlla branch del dispatch finale). */
export const ENTITY_STATE_OFF = 0x1a as const;
/** Byte: scritto a 0x32 nel ramo final (se state != 5/7). */
export const ENTITY_FIELD_56_OFF = 0x56 as const;
/** Long BE: script ptr scritto su hit (0x20FAA o 0x20FB6). */
export const ENTITY_SCRIPT_PTR_OFF = 0x5a as const;
/** Byte: clear nel ramo dispatch (state == 1, oppure default). */
export const ENTITY_FIELD_5F_OFF = 0x5f as const;
/** Byte: scritto a 2 nel ramo dispatch (state == 1, oppure default). */
export const ENTITY_FIELD_60_OFF = 0x60 as const;

// ─── Constants scritte su hit ────────────────────────────────────────────

/** Valori del selettore che ATTIVANO il loop (`*0x400394 ∈ {1, 2, 5}`). */
export const VALID_SELECTORS = [0x0001, 0x0002, 0x0005] as const;

/** `slot[0x1A] = 2` quando state era 0/3 e cade nel bind path. */
export const SLOT_NEW_STATE = 0x02 as const;

/** Stati di slot che triggerano il bind via FUN_15460 + copia entity. */
export const SLOT_BIND_STATES = [0x00, 0x03] as const;

/** Stati di slot che triggerano il path "alt-key match" (return early se key match). */
export const SLOT_KEY_MATCH_STATES = [0x01, 0x05, 0x06] as const;

/** Stati di slot che fanno return immediato dopo key match (sottoinsieme di sopra). */
export const SLOT_KEY_EARLY_EXIT_STATES = [0x01, 0x06] as const;

/** Sound command id pushato via `pea (0x39).l; jsr FUN_158AC` (state default). */
export const SOUND_CMD_DEFAULT = 0x39 as const;

/** Script ptr scritto in entity[0x5A] quando `entity[0x1A] == 1`. */
export const SCRIPT_PTR_STATE_1 = 0x00020fb6 as const;
/** Script ptr scritto in entity[0x5A] nel ramo default (state != 1, != 5). */
export const SCRIPT_PTR_DEFAULT = 0x00020faa as const;

/** Stati di entity che CAUSANO skip del blocco "set state=5 + field56=0x32". */
export const ENTITY_FINAL_SKIP_STATES = [0x05, 0x07] as const;

/** Valore `entity[0x1A] = 5` nel blocco final se non skip. */
export const ENTITY_FINAL_STATE = 0x05 as const;
/** Valore `entity[0x56] = 0x32` nel blocco final se non skip. */
export const ENTITY_FINAL_FIELD_56 = 0x32 as const;

/** "BBox sentinel": `*(slot[0x58]).l == -1` → usa default (-4, -4, 8, 8). */
export const BBOX_SENTINEL = 0xffffffff >>> 0;
/** Default bbox D0 (X-near delta) quando sentinel. */
export const BBOX_DEFAULT_D0 = -4 as const;
/** Default bbox D3 (Y-near delta) quando sentinel. */
export const BBOX_DEFAULT_D3 = -4 as const;
/** Default bbox D2 (X-extent) quando sentinel. */
export const BBOX_DEFAULT_D2 = 8 as const;
/** Default bbox D4 (Y-extent) quando sentinel. */
export const BBOX_DEFAULT_D4 = 8 as const;

/** Marble bbox half-extent X (`subq.w #3, D6`). */
export const MARBLE_X_DELTA_NEAR = 3 as const;
/** Marble bbox half-extent X (`addq.w #6, A4` dopo subq #3 → +3 effettivo). */
export const MARBLE_X_DELTA_FAR = 3 as const;
/** Marble bbox half-extent Y (uguale a X, simmetrico). */
export const MARBLE_Y_DELTA_NEAR = 3 as const;
export const MARBLE_Y_DELTA_FAR = 3 as const;
/** Marble bbox Z near = worldZ + 0 (`*0x400694` direttamente). */
export const MARBLE_Z_DELTA_NEAR = 0 as const;
/** Marble bbox Z far = worldZ + 0xE. */
export const MARBLE_Z_DELTA_FAR = 0x0e as const;
/** Slot Z extent: `D4 = D2 + 0x10`. */
export const SLOT_Z_EXTENT = 0x10 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Sub-functions stub iniettabili.
 *
 * - `FUN_00015460(slotPtr)`: dispatcher di direzione (514 byte). Riceve il
 *   puntatore allo slot e scrive vari campi (slot[0x5C..0x5F] long,
 *   slot[0x58..0x5B] long, slot[0x24..0x27]). Default no-op (matching
 *   parity test che patcha FUN_15460 con RTS).
 *
 * - `FUN_000158AC(cmd)`: sound command sender (vedi `sound-cmd-send.ts`).
 *   Default no-op (matching pattern di `bbox-hit-test-19d94.ts` /
 *   `state-sub-186ac.ts`). Il caller passa `cmd = 0x39`.
 */
export interface ScriptSlotBboxTest14E92Subs {
  /** FUN_15460(slotPtr, state). Default no-op. */
  fun_15460?: (slotPtr: number, state: GameState) => void;
  /** FUN_158AC(cmd, state). Default no-op. */
  soundCommand?: (cmd: number, state: GameState) => void;
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
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

function canReadAbs(state: GameState, rom: RomImage | undefined, addr: number, length: number): boolean {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a + length <= WORK_RAM_BASE + state.workRam.length) {
    return true;
  }
  return rom !== undefined && a + length <= rom.program.length;
}

function readByteAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + state.workRam.length) {
    return readByte(state, a - WORK_RAM_BASE);
  }
  if (rom !== undefined && a < rom.program.length) {
    return (rom.program[a] ?? 0) & 0xff;
  }
  return 0;
}

function readLongAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a + 4 <= WORK_RAM_BASE + state.workRam.length) {
    return readLongBE(state, a - WORK_RAM_BASE);
  }
  if (rom !== undefined && a + 4 <= rom.program.length) {
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

/** sign-extend byte → JS signed integer (-128..127). */
function sextByte(v: number): number {
  const b = v & 0xff;
  return b < 0x80 ? b : b - 0x100;
}

/** sign-extend word → JS signed integer (-32768..32767). */
function sextWord(v: number): number {
  const w = v & 0xffff;
  return w < 0x8000 ? w : w - 0x10000;
}

/** Word arithmetic mod 0x10000 (preserva il behavior di `add.w`/`subq.w`). */
function asWord(v: number): number {
  return v & 0xffff;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00014E92` — bbox-overlap dispatch sull'array
 * @ 0x401302 (4 slot stride 0x60).
 *
 * @param state       GameState.
 * @param entityAddr  Indirizzo assoluto m68k della struct entity (A2 = arg
 *                    long pushato dal caller).
 * @param subs        Stub injection per le due JSR. Default no-op.
 *
 * @returns void. Il binario produce `D0 = D2 sext.l` ma D2 è inizializzato a
 *          1 SOLO nel ramo hit; nel ramo "no slot match" oppure "selettore
 *          fuori range" D0 al ritorno dipende dallo stato di entrata
 *          (movem.l ripristina D2 dal frame caller). Il valore D0 NON è
 *          quindi parte del contratto osservabile.
 *
 * **Side effects** in `state.workRam` (max una volta — primo slot in hit):
 *   - Slot[i] (per i ∈ [0..3]): vedi sezione "Hit" nella docstring header.
 *   - Entity (A2): clear di [0..7], scrittura di [0xC..0x13], possibile
 *     scrittura di state (0x1A), key (0x19 → slot[0x56]), script ptr (0x5A),
 *     field 56/5F/60.
 */
export function scriptSlotBboxTest14E92(
  state: GameState,
  entityAddr: number,
  subs?: ScriptSlotBboxTest14E92Subs,
  rom?: RomImage,
): void {
  // Selector gate: `*0x400394 == 1 || == 2 || == 5`.
  const selector = readWordBE(state, SELECTOR_WORD_OFF);
  if (selector !== 0x0001 && selector !== 0x0002 && selector !== 0x0005) {
    return;
  }

  // Calcola il volume marble (signed word).
  const worldX = sextWord(readWordBE(state, WORLD_X_WORD_OFF));
  const worldY = sextWord(readWordBE(state, WORLD_Y_WORD_OFF));
  const worldZ = sextWord(readWordBE(state, WORLD_Z_WORD_OFF));

  // X: [worldX - 3, worldX + 3] (D6, A4)
  // Il binario fa `subq.w #3, D6w` (= worldX - 3) poi `addq.w #6, A4w`
  // (= worldX + 3). Le operazioni sono modulo 0x10000.
  const marbleXNear = sextWord(asWord(worldX - 3));
  const marbleXFar = sextWord(asWord(worldX + 3));
  // Y: [worldY - 3, worldY + 3] (A1, sp[-2])
  const marbleYNear = sextWord(asWord(worldY - 3));
  const marbleYFar = sextWord(asWord(worldY + 3));
  // Z: [worldZ, worldZ + 0xE] (sp[-6], sp[-4])
  const marbleZNear = sextWord(asWord(worldZ));
  const marbleZFar = sextWord(asWord(worldZ + 0x0e));

  // Loop sui 4 slot.
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotPtr = (SLOT_ARRAY_BASE_ADDR + i * SLOT_STRIDE) >>> 0;
    const slotOff = slotPtr - WORK_RAM_BASE;

    // Test "armed" (`tst.b (0x18,A3); beq next`).
    if (readByte(state, slotOff + SLOT_ARMED_OFF) === 0) continue;

    // Risoluzione bbox: `A0 = (0x58, A3); A0 = (A0)`.
    const bboxPtrLong = readLongBE(state, slotOff + SLOT_BBOX_PTR_OFF);
    const bboxRecPtr = bboxPtrLong; // pointer m68k absoluto (in workRam o ROM).

    // Deref bboxRecPtr per leggere il primo long (sentinel check). In demo
    // mode questo punta spesso in ROM (es. 0x20CBC -> 0x21B06), quindi il
    // caller runtime passa `rom`. I parity test workRam-only restano supportati.
    const derefLong = canReadAbs(state, rom, bboxRecPtr, 4)
      ? readLongAbs(state, rom, bboxRecPtr)
      : 0;

    // Bbox extents: 4 byte signed @ +4..+7 del record puntato (oppure default
    // se sentinel).
    let d0: number, d3: number, d2: number, d4: number;
    if (derefLong === BBOX_SENTINEL) {
      d0 = BBOX_DEFAULT_D0;
      d3 = BBOX_DEFAULT_D3;
      d2 = BBOX_DEFAULT_D2;
      d4 = BBOX_DEFAULT_D4;
    } else {
      const recordPtr = derefLong;
      if (canReadAbs(state, rom, recordPtr, 8)) {
        d0 = sextByte(readByteAbs(state, rom, recordPtr + 4));
        d3 = sextByte(readByteAbs(state, rom, recordPtr + 5));
        d2 = sextByte(readByteAbs(state, rom, recordPtr + 6));
        d4 = sextByte(readByteAbs(state, rom, recordPtr + 7));
      } else {
        // Record non leggibile nel test harness: conserva il vecchio fallback.
        d0 = BBOX_DEFAULT_D0;
        d3 = BBOX_DEFAULT_D3;
        d2 = BBOX_DEFAULT_D2;
        d4 = BBOX_DEFAULT_D4;
      }
    }

    // Slot bbox (signed word, mod 0x10000).
    const slotX = sextWord(readWordBE(state, slotOff + SLOT_X_OFF));
    const slotY = sextWord(readWordBE(state, slotOff + SLOT_Y_OFF));
    const slotZ = sextWord(readWordBE(state, slotOff + SLOT_Z_OFF));

    // D5 = slotX + D0 (X near)
    const slotXNear = sextWord(asWord(slotX + d0));
    // sp[-8] = slotXNear + D2 (X far)
    const slotXFar = sextWord(asWord(slotXNear + d2));
    // D0 = slotY + D3 (Y near)
    const slotYNear = sextWord(asWord(slotY + d3));
    // D3 = slotYNear + D4 (Y far)
    const slotYFar = sextWord(asWord(slotYNear + d4));
    // D2 = slotZ (Z near)
    const slotZNear = slotZ;
    // D4 = slotZ + 0x10 (Z far)
    const slotZFar = sextWord(asWord(slotZ + SLOT_Z_EXTENT));

    // ─── Z overlap test ────────────────────────────────────────────────
    // (cmp.w sp[-6], D2; bgt 14F64)
    //   if slotZNear > marbleZNear → entra in 14F64 (test "out of range")
    //   else (slotZNear <= marbleZNear): test cmp.w D4, marbleZNear; ble 14F76
    //     if marbleZNear <= slotZFar → pass (overlap)
    //     else: fall through to 14F64
    // 14F64: cmp.w sp[-4], D2; bgt skip
    //   if slotZNear > marbleZFar → skip
    //   cmp.w D4, marbleZFar; bgt skip
    //   if marbleZFar > slotZFar → skip
    let zPass = false;
    if (slotZNear <= marbleZNear && marbleZNear <= slotZFar) {
      zPass = true;
    } else if (slotZNear <= marbleZFar && marbleZFar <= slotZFar) {
      zPass = true;
    }
    if (!zPass) continue;

    // ─── X overlap test ────────────────────────────────────────────────
    // (cmp.w D6, D5; bgt 14F82)
    //   if slotXNear > marbleXNear → 14F82
    //   else: cmp.w sp[-8], D6; ble 14F90
    //     if marbleXNear <= slotXFar → pass
    //     else: 14F82
    // 14F82: cmp.w A4, D5; bgt skip
    //        cmpa.w sp[-8], A4; bgt skip
    let xPass = false;
    if (slotXNear <= marbleXNear && marbleXNear <= slotXFar) {
      xPass = true;
    } else if (slotXNear <= marbleXFar && marbleXFar <= slotXFar) {
      xPass = true;
    }
    if (!xPass) continue;

    // ─── Y overlap test ────────────────────────────────────────────────
    // (cmp.w A1, D0; bgt 14F9A)
    //   if slotYNear > marbleYNear → 14F9A
    //   else: cmpa.w D3, A1; ble 14FAC
    //     if marbleYNear <= slotYFar → pass
    //     else: 14F9A
    // 14F9A: cmp.w sp[-2], D0; bgt skip
    //        move.w sp[-2], D7; cmp.w D3, D7; bgt skip
    let yPass = false;
    if (slotYNear <= marbleYNear && marbleYNear <= slotYFar) {
      yPass = true;
    } else if (slotYNear <= marbleYFar && marbleYFar <= slotYFar) {
      yPass = true;
    }
    if (!yPass) continue;
    state.debug ??= {};
    state.debug.lastScriptSlotCollision = {
      frame: Number(state.clock.frame),
      entityAddr,
      slotIndex: i,
      slotAddr: slotPtr,
      slotState: readByte(state, slotOff + SLOT_STATE_OFF),
      entityState: readByte(state, (entityAddr - WORK_RAM_BASE) + ENTITY_STATE_OFF),
      slotX,
      slotY,
      slotZ,
      bboxX0: slotXNear,
      bboxY0: slotYNear,
      bboxX1: slotXFar,
      bboxY1: slotYFar,
      marbleX0: marbleXNear,
      marbleY0: marbleYNear,
      marbleZ0: marbleZNear,
      marbleX1: marbleXFar,
      marbleY1: marbleYFar,
      marbleZ1: marbleZFar,
    };

    // ─── HIT path (D2 = 1) ──────────────────────────────────────────────
    // tst.b (0x1A, A3) — slot state == 0?
    // cmpi.b #3, (0x1A, A3) — state == 3?
    // se uno dei due → bind via FUN_15460 + copia entity fields.
    const slotState0 = readByte(state, slotOff + SLOT_STATE_OFF);
    const entityOff = (entityAddr - WORK_RAM_BASE) >>> 0;

    if (slotState0 === 0x00 || slotState0 === 0x03) {
      writeByte(state, slotOff + SLOT_STATE_OFF, SLOT_NEW_STATE);
      // jsr FUN_15460(slotPtr) — dispatcher di direzione, stub injection.
      if (subs?.fun_15460 !== undefined) {
        subs.fun_15460(slotPtr, state);
      } else if (rom !== undefined) {
        stateDispatch15460(state, slotPtr, rom);
      }
      // Copia entity[0..3] in slot[0] AND slot[0x1C].
      const entityField0 = readLongBE(state, entityOff + ENTITY_FIELD_0_OFF);
      writeLongBE(state, slotOff + SLOT_FIELD_0_OFF, entityField0);
      writeLongBE(state, slotOff + SLOT_FIELD_1C_OFF, entityField0);
      // Copia entity[4..7] in slot[4] AND slot[0x20].
      const entityField4 = readLongBE(state, entityOff + ENTITY_FIELD_4_OFF);
      writeLongBE(state, slotOff + SLOT_FIELD_4_OFF, entityField4);
      writeLongBE(state, slotOff + SLOT_FIELD_20_OFF, entityField4);
    }

    // Re-leggi state (può essere cambiato a 2 dal blocco sopra).
    const slotState1 = readByte(state, slotOff + SLOT_STATE_OFF);

    // ─── Branch 14FE2: alt-key match path ──────────────────────────────
    // Disasm flow:
    //   14FE2: se slotState1 ∈ {1, 5, 6} → goto 14FFE (test key)
    //          else → goto 1500C
    //   14FFE: se entity[0x19].b sext.w != slot[0x56].w → goto 15020
    //                                                   (skip 1500C)
    //          se ==                                    → fall through to 1500C
    //   1500C: se slotState1 ∈ {1, 6} → exit (150C2, hit consumato)
    //          else → fall through to 15020
    //   15020: write-key gate (entity[0x1A] == 5 OR slotState1 == 5 → skip).
    //
    // Quindi early-exit = (slotState1 ∈ {1, 6}) AND
    //                     ((slotState1 ∈ {1, 5, 6} AND key match) OR slotState1 ∉ {1, 5, 6})
    //                   = slotState1 ∈ {1, 6} AND
    //                     (key match OR slotState1 ∉ {1, 5, 6})
    //                   = slotState1 ∈ {1, 6} AND key match (perché {1,6} ⊂ {1,5,6}).
    // E il "skip-write-key" è gated SOLO da entity/slot state == 5 al 15020.
    {
      let earlyExit = false;
      if (slotState1 === 0x01 || slotState1 === 0x06) {
        const entityKey = sextWord(sextByte(readByte(state, entityOff + ENTITY_KEY_BYTE_OFF)));
        const slotKey = sextWord(readWordBE(state, slotOff + SLOT_KEY_WORD_OFF));
        if (entityKey === slotKey) {
          earlyExit = true;
        }
      }
      if (earlyExit) {
        // Goto 0x150C2: D2 = 1, return.
        return;
      }
    }

    // ─── Block 0x15020: condizione skip-write-key ─────────────────────
    // se entity[0x1A] != 5 AND slotState1 != 5 → write slot[0x56] = sext(entity[0x19]).
    {
      const entityStateAtKeyCheck = readByte(state, entityOff + ENTITY_STATE_OFF);
      if (entityStateAtKeyCheck !== 0x05 && slotState1 !== 0x05) {
        const entityKeyByte = readByte(state, entityOff + ENTITY_KEY_BYTE_OFF);
        const sextKey = sextWord(sextByte(entityKeyByte));
        writeWordBE(state, slotOff + SLOT_KEY_WORD_OFF, sextKey & 0xffff);
      }
    }

    // ─── Block 0x1503A: scrivi globali in entity ──────────────────────
    const global684 = readLongBE(state, GLOBAL_684_LONG_OFF);
    const global688 = readLongBE(state, GLOBAL_688_LONG_OFF);
    writeLongBE(state, entityOff + ENTITY_FIELD_C_OFF, global684);
    writeLongBE(state, entityOff + ENTITY_FIELD_10_OFF, global688);
    writeLongBE(state, entityOff + ENTITY_FIELD_4_OFF, 0);
    writeLongBE(state, entityOff + ENTITY_FIELD_0_OFF, 0);

    // ─── Block 0x15052: dispatch su entity[0x1A] ──────────────────────
    const entityState1 = readByte(state, entityOff + ENTITY_STATE_OFF);
    if (entityState1 === 0x01) {
      writeByte(state, entityOff + ENTITY_FIELD_5F_OFF, 0x00);
      writeByte(state, entityOff + ENTITY_FIELD_60_OFF, 0x02);
      writeLongBE(state, entityOff + ENTITY_SCRIPT_PTR_OFF, SCRIPT_PTR_STATE_1);
    } else if (entityState1 === 0x05) {
      // skip blocco entirely (bra 0x15096).
    } else {
      // Default path: sound 0x39 + setup script_ptr_default.
      subs?.soundCommand?.(SOUND_CMD_DEFAULT, state);
      writeByte(state, entityOff + ENTITY_FIELD_5F_OFF, 0x00);
      writeByte(state, entityOff + ENTITY_FIELD_60_OFF, 0x02);
      writeLongBE(state, entityOff + ENTITY_SCRIPT_PTR_OFF, SCRIPT_PTR_DEFAULT);
    }

    // ─── Block 0x15096: final state transition ────────────────────────
    // se entity[0x1A] != 5 AND != 7 → entity[0x1A] = 5; entity[0x56] = 0x32.
    const entityState2 = readByte(state, entityOff + ENTITY_STATE_OFF);
    if (entityState2 !== 0x05 && entityState2 !== 0x07) {
      writeByte(state, entityOff + ENTITY_STATE_OFF, ENTITY_FINAL_STATE);
      writeByte(state, entityOff + ENTITY_FIELD_56_OFF, ENTITY_FINAL_FIELD_56);
    }

    // Hit consumato → exit (single match per call).
    return;
  }
}
