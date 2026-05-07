/**
 * state-sub-14c46.ts — replica `FUN_00014C46` (422 byte).
 *
 * "Range-boundary slot spawn/despawn dispatcher". Riceve due byte arg via
 * stack (D2 = arg1 LSB, D3 = arg2 LSB) e in due fasi:
 *
 *   1. **Entry walk** — itera la lista di "entry" 8-byte (terminator
 *      `entry[0] == 0xFF`) puntata da `ROM[0x2257A + mode*4]`, dove
 *      `mode = *0x400394.w`. Per ogni entry:
 *        - chiama `slotMatchesPtr(entryPtr)` (FUN_14C0C). Se match → skip.
 *        - else, gate: `D3 ∈ {entry[0], entry[1]}` AND
 *                       (`D2 < entry[0]` OR `D2 > entry[1]`) (signed byte).
 *        - se gated → INIZIALIZZA il primo free slot (FUN_14BCE) col
 *          contenuto dell'entry + chiama `FUN_1BB08(slotPtr)`,
 *          `FUN_1CC62(1)`, `FUN_150D0(slotPtr)`, `FUN_18E6C(4, sext_l(slot[0x19]))`.
 *
 *   2. **Tail walk** — itera i 4 slot @ `0x401302` stride `0x60`. Per ogni
 *      slot in uso (`slot[0x18] != 0`):
 *        - se `(D2 == slot[0x52] AND D3 < slot[0x52])` OR
 *             `(D2 == slot[0x54] AND D3 > slot[0x54])` (signed word):
 *          → TEARDOWN: `slot[0x18] = 0` + `FUN_18F46(4, sext_l(slot[0x19]))`.
 *
 * **Caller noto** (1 xref): `FUN_000144E4` @ `0x14546`.
 *
 * **Disasm 0x14C46..0x14DEC** (422 byte):
 *
 *   00014c46  movem.l {A3,A2,D4,D3,D2},-(SP)
 *   00014c4a  move.b  (0x1B,SP),D2b              ; D2 = arg1 LSB
 *   00014c4e  move.b  (0x1F,SP),D3b              ; D3 = arg2 LSB
 *   00014c52  move.w  (0x00400394).l,D0w
 *   00014c58  asl.w   #2,D0w                     ; D0 = mode * 4
 *   00014c5a  movea.l #0x2257A,A0
 *   00014c60  movea.l (0,A0,D0w*1),A3            ; A3 = ROM[0x2257A+mode*4]
 *   00014c64 entry_loop_top:
 *           cmpi.b   #-1,(A3)
 *           beq.w    tail_walk                   ; sentinel 0xFF → done
 *
 *           jsr      0x14BCE                     ; D0 = findFreeSlot()
 *           move.l   D0,D1
 *           movea.l  D1,A2                       ; A2 = slotPtr
 *           moveq    #-1,D0
 *           cmp.l    D1,D0
 *           beq.w    tail_walk                   ; slotPtr == -1 → done
 *
 *           move.l   A3,-(SP)
 *           jsr      0x14C0C                     ; D0 = slotMatchesPtr(entry)
 *           tst.l    D0
 *           addq.l   #4,SP
 *           bne.w    entry_advance               ; matched → skip
 *
 *           cmp.b    (A3),D3b                    ; D3 == entry[0]?
 *           beq.b    check_d2
 *           cmp.b    (1,A3),D3b                  ; D3 == entry[1]?
 *           bne.w    entry_advance               ; neither → skip
 *   check_d2:
 *           cmp.b    (A3),D2b                    ; D2 < entry[0]?
 *           blt.w    do_init
 *           cmp.b    (1,A3),D2b                  ; D2 <= entry[1]?
 *           ble.w    entry_advance               ; in range → skip
 *
 *   do_init:                                     ; init slot from entry
 *           move.l   (2,A3),D0                   ; D0 = entry[2..5] (long)
 *           move.l   D0,(0x4A,A2)
 *           movea.l  D0,A0
 *           move.l   A0,(0x4E,A2)
 *           move.b   (6,A3),(0x1B,A2)            ; slot[0x1B] = entry[6]
 *           move.b   (A3),D0b
 *           ext.w    D0w
 *           move.w   D0w,(0x52,A2)               ; slot[0x52] = sext_w(entry[0])
 *           move.b   (1,A3),D0b
 *           ext.w    D0w
 *           move.w   D0w,(0x54,A2)               ; slot[0x54] = sext_w(entry[1])
 *
 *           move.b   (A0),D0b                    ; A0 = D0 (entry data ptr)
 *           ext.w    D0w
 *           move.b   (1,A0),D4b
 *           ext.w    D4w
 *           ext.l    D0
 *           moveq    #0x13,D1
 *           asl.l    D1,D0                       ; sext_l(byte0) << 19
 *           addi.l   #0x40000,D0
 *           move.l   D0,(0x0C,A2)
 *           move.w   D4w,D0w
 *           ext.l    D0
 *           moveq    #0x13,D1
 *           asl.l    D1,D0                       ; sext_l(byte1) << 19
 *           addi.l   #0x40000,D0
 *           move.l   D0,(0x10,A2)
 *
 *           move.l   A2,-(SP)
 *           jsr      0x1BB08                     ; FUN_1BB08(slotPtr)
 *           pea      (1).w
 *           jsr      0x1CC62                     ; D0 = FUN_1CC62(1)
 *           move.l   D0,(0x14,A2)
 *           moveq    #0,D0
 *           move.l   D0,(0x4,A2)
 *           move.l   D0,(A2)
 *           move.b   #1,(0x18,A2)                ; slot[0x18] = 1
 *           clr.b    (0x1A,A2)
 *           clr.l    (0x28,A2)
 *           clr.b    D4b
 *           addq.l   #8,SP                       ; pop slot ptr + pea(1)
 *
 *   clr_loop:                                    ; clear 5 words (slot+0x2C..+0x44 stride 6)
 *           move.b   D4b,D0b
 *           ext.w    D0w
 *           mulu.w   #6,D0
 *           lea      (0x2C,A2),A0
 *           clr.w    (0,A0,D0w*1)
 *           addq.b   #1,D4b
 *           cmpi.b   #5,D4b
 *           bne.b    clr_loop
 *
 *           move.l   #0x20C18,D0
 *           move.l   D0,(0x5C,A2)
 *           move.l   D0,(0x58,A2)
 *           move.b   #1,(0x26,A2)
 *           clr.b    (0x24,A2)
 *           move.b   #2,(0x25,A2)
 *
 *           move.l   A2,-(SP)
 *           jsr      0x150D0                     ; FUN_150D0(slotPtr)
 *           move.b   (0x19,A2),D0b
 *           ext.w    D0w
 *           ext.l    D0
 *           move.l   D0,-(SP)
 *           pea      (4).w
 *           jsr      0x18E6C                     ; FUN_18E6C(4, sext_l(slot[0x19]))
 *           lea      (0xC,SP),SP                 ; pop 12 bytes
 *
 *   entry_advance:                               ; @ 0x14D80
 *           addq.l   #8,A3
 *           bra.w    entry_loop_top
 *
 *   tail_walk:                                   ; @ 0x14D86
 *           movea.l  #0x401302,A2
 *           clr.b    D4b
 *
 *   tail_top:                                    ; @ 0x14D8E
 *           tst.b    (0x18,A2)
 *           beq.w    tail_advance
 *
 *           move.b   D2b,D0b
 *           ext.w    D0w
 *           cmp.w    (0x52,A2),D0w               ; D2 == slot[0x52]?
 *           bne.b    check_upper
 *           move.b   D3b,D0b
 *           ext.w    D0w
 *           cmp.w    (0x52,A2),D0w               ; D3 < slot[0x52]?
 *           blt.w    do_teardown
 *
 *   check_upper:                                 ; @ 0x14DAC
 *           move.b   D2b,D0b
 *           ext.w    D0w
 *           cmp.w    (0x54,A2),D0w               ; D2 == slot[0x54]?
 *           bne.b    tail_advance
 *           move.b   D3b,D0b
 *           ext.w    D0w
 *           cmp.w    (0x54,A2),D0w               ; D3 > slot[0x54]?
 *           ble.b    tail_advance                ; ≤ → skip
 *
 *   do_teardown:                                 ; @ 0x14DC0
 *           clr.b    (0x18,A2)                   ; slot[0x18] = 0
 *           move.b   (0x19,A2),D0b
 *           ext.w    D0w
 *           ext.l    D0
 *           move.l   D0,-(SP)
 *           pea      (4).w
 *           jsr      0x18F46                     ; FUN_18F46(4, sext_l(slot[0x19]))
 *           addq.l   #8,SP
 *
 *   tail_advance:                                ; @ 0x14DDA
 *           moveq    #0x60,D0
 *           adda.l   D0,A2
 *           addq.b   #1,D4b
 *           cmpi.b   #4,D4b
 *           bne.b    tail_top
 *
 *           movem.l  (SP)+,{D2,D3,D4,A2,A3}
 *           rts
 *
 * **Side effects** in `state.workRam` (off ridotto WORK_RAM_BASE = 0x400000):
 *   - `0x401302..0x4014C2` (4 slot × 0x60). Per ogni slot eventualmente
 *     inizializzato:
 *       - `slot[0x00..0x07] = 0`, `slot[0x18] = 1`, `slot[0x1A] = 0`,
 *         `slot[0x1B] = entry[6]`, `slot[0x24] = 0`, `slot[0x25] = 2`,
 *         `slot[0x26] = 1`, `slot[0x28..0x2B] = 0`,
 *         `slot[0x2C/0x32/0x38/0x3E/0x44] = 0` (5 word),
 *         `slot[0x4A..0x4D] = entry[2..5] (long)`,
 *         `slot[0x4E..0x51] = entry[2..5] (long)`,
 *         `slot[0x52..0x53] = sext_w(entry[0])`,
 *         `slot[0x54..0x55] = sext_w(entry[1])`,
 *         `slot[0x58..0x5B] = 0x20C18`, `slot[0x5C..0x5F] = 0x20C18`,
 *         `slot[0x0C..0x0F] = (sext_l(*entryDataPtr[0]) << 19) + 0x40000`,
 *         `slot[0x10..0x13] = (sext_l(*entryDataPtr[1]) << 19) + 0x40000`,
 *         `slot[0x14..0x17] = D0_from_subs.fun_1cc62`.
 *   - Per ogni slot teardown: `slot[0x18] = 0`.
 *   - Effetti delle 5 sub-callback se invocate (1BB08, 1CC62, 150D0,
 *     18E6C, 18F46).
 *
 * **JSR esterne** (5):
 *   - `FUN_00014BCE` (`findFreeSlotInTable`) — replicato live (slot-search.ts).
 *   - `FUN_00014C0C` (`slotMatchesPtr`) — replicato live (slot-search.ts).
 *   - `FUN_0001BB08` (deriveSpriteFromArg_v1) — replicato live (sprite-derive.ts).
 *   - `FUN_0001CC62` — sub-injection (`subs.fun_1cc62(slotPtr) → number`).
 *   - `FUN_000150D0` — sub-injection (`subs.fun_150d0(slotPtr)`).
 *   - `FUN_00018E6C` — sub-injection (`subs.fun_18e6c(typeCode, subIdx)`).
 *   - `FUN_00018F46` — sub-injection (`subs.fun_18f46(arg1, arg2)`).
 *
 * Verifica bit-perfect via
 * `packages/cli/src/test-state-sub-14c46-parity.ts` (500 casi).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { findFreeSlotInTable, slotMatchesPtr } from "./slot-search.js";
import { deriveSpriteFromArg_v1 } from "./sprite-derive.js";

// ─── Costanti m68k → workRam ─────────────────────────────────────────────

const WORK_RAM_BASE = 0x00400000;

/** Address word `*0x400394` = mode discriminator. */
export const MODE_ADDR = 0x00400394 as const;

/** ROM table (long ptr × N), indicizzata da `mode * 4`. */
export const ROM_ENTRY_TABLE = 0x0002257a as const;

/** Slot array base (4 slot × 0x60, condiviso con FUN_1493C/FUN_14C0C). */
export const SLOT_ARRAY_ADDR = 0x00401302 as const;
/** Stride slot. */
export const SLOT_STRIDE = 0x60 as const;
/** Numero slot. */
export const SLOT_COUNT = 4 as const;

/** Sentinel terminator entry list. */
export const ENTRY_SENTINEL = 0xff as const;
/** Stride entry. */
export const ENTRY_STRIDE = 8 as const;
/** Massimo numero di entry da iterare (safety cap; il binario è bounded
 *  solo dal sentinel 0xFF — la tabella in ROM termina sempre con 0xFF). */
export const ENTRY_MAX_ITER = 256 as const;

/** Constante `0x20C18` scritta in `slot[0x58]` e `slot[0x5C]` (ROM ptr). */
export const SLOT_SUB_PTR_INIT = 0x00020c18 as const;

/** Costante usata in init delle longs `slot[0x0C]` e `slot[0x10]`. */
export const POSITION_BIAS = 0x00040000 as const;
/** Shift count (0x13 = 19) usato negli `asl.l` di init. */
export const POSITION_SHIFT = 0x13 as const;

/** Argomento long pushato a `FUN_1CC62` (init path). */
export const FUN_1CC62_ARG = 0x1 as const;
/** Type-code passato a `FUN_18E6C` (init path) e `FUN_18F46` (teardown). */
export const FUN_18E6C_18F46_ARG1 = 0x4 as const;

// ─── Sub injection ──────────────────────────────────────────────────────

/**
 * Stub injection per le 4 JSR esterne non-trivially-replicate.
 *
 * Le 3 sub `findFreeSlotInTable` (`FUN_14BCE`), `slotMatchesPtr`
 * (`FUN_14C0C`) e `deriveSpriteFromArg_v1` (`FUN_1BB08`) sono replicate
 * live nei moduli rispettivi e NON sono injection.
 */
export interface StateSub14C46Subs {
  /**
   * `FUN_0001CC62(arg=1)` (sprite-project). Riceve l'arg long pushato (=1) e
   * lo state. Ritorna il long che il binario lascia in D0 — scritto in
   * `slot[0x14..0x17]`. Default: 0.
   */
  fun_1cc62?: (state: GameState, arg: number) => number;
  /**
   * `FUN_000150D0(slotPtr)` (sprite-coords + jsr 264AA). Riceve il pointer
   * assoluto del slot (= A2). Default: no-op.
   */
  fun_150d0?: (state: GameState, slotPtr: number) => void;
  /**
   * `FUN_00018E6C(typeCode=4, subIdx=sext_l(slot[0x19]))` (slot-insert-sorted).
   * Default: no-op.
   */
  fun_18e6c?: (state: GameState, typeCode: number, subIdx: number) => void;
  /**
   * `FUN_00018F46(arg1=4, arg2=sext_l(slot[0x19]))` (slot teardown). Default:
   * no-op.
   */
  fun_18f46?: (state: GameState, arg1: number, arg2: number) => void;
}

// ─── Risultato ───────────────────────────────────────────────────────────

/** Quale azione è stata fatta su uno specifico slot. */
export type SlotAction = "init" | "teardown" | "noop";

/** Per-slot action trace (4 elementi, uno per slot). */
export interface SlotTrace {
  /** Index slot (0..3). */
  slotIdx: number;
  /** Pointer assoluto del slot (`SLOT_ARRAY_ADDR + slotIdx * 0x60`). */
  slotPtr: number;
  /** Azione effettuata. */
  action: SlotAction;
}

/** Per-entry action trace (entry-walk). */
export interface EntryTrace {
  /** Pointer assoluto dell'entry letta. */
  entryPtr: number;
  /** Bytes [0..7] dell'entry (oss: per terminator solo entry[0]=0xFF). */
  entryBytes: number[];
  /** True se `slotMatchesPtr(entry)` ha ritornato non-zero. */
  matched: boolean;
  /** True se il gate (D3 boundary + D2 fuori range) è passato. */
  gated: boolean;
  /** True se il init è stato eseguito (gated && !matched && slot found). */
  initialized: boolean;
  /** Pointer del slot inizializzato (se `initialized`). */
  initSlotPtr: number | null;
}

/** Risultato finale. */
export interface StateSub14C46Result {
  /** Mode word letto a `0x400394` (selettore tabella ROM). */
  mode: number;
  /** Pointer della entry list (= `ROM[0x2257A + mode*4]`). */
  entryListPtr: number;
  /** True se la entry list iniziava già col sentinel (0xFF) — early exit. */
  emptyEntryList: boolean;
  /** Trace di ogni entry visitata. */
  entries: EntryTrace[];
  /** Trace dei 4 slot (tail walk). */
  slots: SlotTrace[];
  /** Numero di chiamate effettive a `subs.fun_1cc62` (= numero init). */
  fun1CC62Calls: number;
  /** Numero di chiamate effettive a `subs.fun_150d0` (= numero init). */
  fun150D0Calls: number;
  /** Numero di chiamate effettive a `subs.fun_18e6c` (= numero init). */
  fun18E6CCalls: number;
  /** Numero di chiamate effettive a `subs.fun_18f46` (= numero teardown). */
  fun18F46Calls: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function r8(s: GameState, off: number): number {
  return (s.workRam[off] ?? 0) & 0xff;
}

function w8(s: GameState, off: number, v: number): void {
  s.workRam[off] = v & 0xff;
}

function rWordBE(s: GameState, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}

function wWordBE(s: GameState, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

function wLongBE(s: GameState, off: number, v: number): void {
  const u = v >>> 0;
  s.workRam[off] = (u >>> 24) & 0xff;
  s.workRam[off + 1] = (u >>> 16) & 0xff;
  s.workRam[off + 2] = (u >>> 8) & 0xff;
  s.workRam[off + 3] = u & 0xff;
}

function romReadByte(rom: RomImage, off: number): number {
  return (rom.program[off] ?? 0) & 0xff;
}

function romReadLongBE(rom: RomImage, off: number): number {
  return (
    ((rom.program[off] ?? 0) << 24) |
    ((rom.program[off + 1] ?? 0) << 16) |
    ((rom.program[off + 2] ?? 0) << 8) |
    (rom.program[off + 3] ?? 0)
  ) >>> 0;
}

/** Sign-extend byte (8 → 32 signed). */
function sext8(v: number): number {
  const x = v & 0xff;
  return x & 0x80 ? x - 0x100 : x;
}

/** Sign-extend word (16 → 32 signed). */
function sext16(v: number): number {
  const x = v & 0xffff;
  return x & 0x8000 ? x - 0x10000 : x;
}

/**
 * Read u8 da addr m68k assoluto. Supporta sia ROM (program area) che workRam.
 *
 * Nel binario la `move.b (A0)` legge il byte puntato dall'entry's data ptr
 * `entry[2..5]`. Quel pointer punta tipicamente in ROM (tabelle dati). Per
 * sicurezza accettiamo entrambe le aree.
 */
function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + state.workRam.length) {
    return r8(state, a - WORK_RAM_BASE);
  }
  // ROM area.
  return romReadByte(rom, a);
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00014C46`.
 *
 * @param state  GameState (modifica `workRam[0x1302..0x14C2]` e altri offset
 *               nei singoli slot inizializzati).
 * @param rom    RomImage (legge da ROM la entry-list table).
 * @param arg1   Long arg1 pushato dal caller (`(0x1B,SP)` LSB → D2.b).
 * @param arg2   Long arg2 pushato dal caller (`(0x1F,SP)` LSB → D3.b).
 * @param subs   Stub injection per le 4 JSR esterne.
 *
 * @returns      Trace dettagliato di entry-walk, slot tail-walk e counter
 *               delle JSR esterne.
 *
 * **Ordine di esecuzione** (rilevante per parity):
 *   1. Legge `mode = *0x400394` (word).
 *   2. Carica `entryListPtr = ROM[0x2257A + mode*4]`.
 *   3. Per ogni entry (fino a sentinel `entry[0] == 0xFF`):
 *      a. Chiama `findFreeSlotInTable()` (sempre, prima del match check).
 *      b. Se nessun slot free → break (early exit, salta tail walk?
 *         NO — il binario `beq.w 0x14d86` salta al tail walk).
 *      c. Chiama `slotMatchesPtr(entry)`. Se match → skip.
 *      d. Verifica gate `(D3 ∈ {entry[0], entry[1]}) AND (D2 fuori range)`.
 *      e. Se gated → init slot:
 *           - scrive 14 campi del slot
 *           - chiama `subs.fun_1cc62`, `subs.fun_150d0`, `subs.fun_18e6c`
 *      f. Avanza A3 += 8.
 *   4. Tail walk sui 4 slot @ 0x401302:
 *      - per ogni slot in uso, se boundary cross → teardown +
 *        `subs.fun_18f46`.
 */
export function stateSub14C46(
  state: GameState,
  rom: RomImage,
  arg1: number,
  arg2: number,
  subs?: StateSub14C46Subs,
): StateSub14C46Result {
  // D2/D3 = LSB del long arg (byte 3 BE = LSB).
  const d2 = arg1 & 0xff;
  const d3 = arg2 & 0xff;
  const d2s = sext8(d2);

  // mode = *0x400394.w (word BE).
  const mode = rWordBE(state, MODE_ADDR - WORK_RAM_BASE);

  // entryListPtr = ROM[0x2257A + mode*4] (long BE).
  // asl.w #2,D0w → D0 = (mode * 4) come word; il binario poi indicizza con
  // D0w*1 (segno-esteso). Ma `mode * 4` in pratica è sempre piccolo.
  // Per sicurezza usa il word con sign-extension.
  const tableIdxWord = (mode << 2) & 0xffff;
  const tableIdxSigned = sext16(tableIdxWord);
  const entryListPtr = romReadLongBE(rom, (ROM_ENTRY_TABLE + tableIdxSigned) >>> 0);

  let fun1CC62Calls = 0;
  let fun150D0Calls = 0;
  let fun18E6CCalls = 0;
  let fun18F46Calls = 0;

  const entries: EntryTrace[] = [];

  // ─── Entry walk (loop @ 0x14C64) ─────────────────────────────────────
  let a3 = entryListPtr >>> 0;
  let emptyEntryList = false;

  for (let iter = 0; iter < ENTRY_MAX_ITER; iter++) {
    // cmpi.b #-1,(A3); beq exit (sentinel).
    const entry0 = readByteAbs(state, rom, a3);
    if (entry0 === ENTRY_SENTINEL) {
      if (iter === 0) emptyEntryList = true;
      break;
    }

    // jsr 0x14BCE → D0 = findFreeSlotInTable() (long, may be 0xFFFFFFFF).
    const slotPtr = findFreeSlotInTable(state, rom) >>> 0;
    const isMinusOne = slotPtr === 0xffffffff;
    const tracedEntry: EntryTrace = {
      entryPtr: a3,
      entryBytes: [
        entry0,
        readByteAbs(state, rom, a3 + 1),
        readByteAbs(state, rom, a3 + 2),
        readByteAbs(state, rom, a3 + 3),
        readByteAbs(state, rom, a3 + 4),
        readByteAbs(state, rom, a3 + 5),
        readByteAbs(state, rom, a3 + 6),
        readByteAbs(state, rom, a3 + 7),
      ],
      matched: false,
      gated: false,
      initialized: false,
      initSlotPtr: null,
    };

    if (isMinusOne) {
      // Binario: `beq.w 0x14d86` (jump to tail walk). NON traccia l'entry
      // completamente: i check successivi non avvengono. Spingi l'entry
      // così com'è e BREAK loop.
      entries.push(tracedEntry);
      break;
    }

    // jsr 0x14C0C(entryPtr) → D0 = slotMatchesPtr(entry).
    const matched = slotMatchesPtr(state, a3) !== 0;
    tracedEntry.matched = matched;

    if (matched) {
      // bne.w 0x14d80 → entry_advance.
      entries.push(tracedEntry);
      a3 = (a3 + ENTRY_STRIDE) >>> 0;
      continue;
    }

    // Gate: D3 == entry[0] OR D3 == entry[1].
    const e0 = tracedEntry.entryBytes[0]!;
    const e1 = tracedEntry.entryBytes[1]!;
    const d3MatchesBoundary = d3 === e0 || d3 === e1;
    if (!d3MatchesBoundary) {
      entries.push(tracedEntry);
      a3 = (a3 + ENTRY_STRIDE) >>> 0;
      continue;
    }

    // Gate: D2 < entry[0] (signed) OR D2 > entry[1] (signed).
    const e0s = sext8(e0);
    const e1s = sext8(e1);
    const d2Outside = d2s < e0s || d2s > e1s;
    if (!d2Outside) {
      entries.push(tracedEntry);
      a3 = (a3 + ENTRY_STRIDE) >>> 0;
      continue;
    }

    // ─── Init slot ─────────────────────────────────────────────────────
    tracedEntry.gated = true;
    tracedEntry.initialized = true;
    tracedEntry.initSlotPtr = slotPtr;

    const slotOff = (slotPtr - WORK_RAM_BASE) >>> 0;

    // move.l (2,A3),D0 → entry[2..5] long.
    const entryDataLong = (
      ((tracedEntry.entryBytes[2]! << 24) |
        (tracedEntry.entryBytes[3]! << 16) |
        (tracedEntry.entryBytes[4]! << 8) |
        tracedEntry.entryBytes[5]!) >>> 0
    );

    // slot[0x4A..0x4D] = entryDataLong.
    wLongBE(state, slotOff + 0x4a, entryDataLong);
    // slot[0x4E..0x51] = entryDataLong.
    wLongBE(state, slotOff + 0x4e, entryDataLong);

    // slot[0x1B] = entry[6] (byte).
    w8(state, slotOff + 0x1b, tracedEntry.entryBytes[6]!);

    // slot[0x52..0x53] = sext_w(entry[0]) (word BE).
    wWordBE(state, slotOff + 0x52, sext8(e0) & 0xffff);
    // slot[0x54..0x55] = sext_w(entry[1]) (word BE).
    wWordBE(state, slotOff + 0x54, sext8(e1) & 0xffff);

    // Read entry data ptr bytes (A0 = entryDataLong).
    const dataByte0 = readByteAbs(state, rom, entryDataLong);
    const dataByte1 = readByteAbs(state, rom, (entryDataLong + 1) >>> 0);

    // slot[0x0C..0x0F] = (sext_l(byte0) << 19) + 0x40000.
    // asl.l #19 di un valore signed: in TS preserva con cast a 32.
    const long0 = (((sext8(dataByte0) << POSITION_SHIFT) + POSITION_BIAS) | 0) >>> 0;
    wLongBE(state, slotOff + 0x0c, long0);

    // slot[0x10..0x13] = (sext_l(byte1) << 19) + 0x40000.
    const long1 = (((sext8(dataByte1) << POSITION_SHIFT) + POSITION_BIAS) | 0) >>> 0;
    wLongBE(state, slotOff + 0x10, long1);

    // jsr 0x1BB08(slotPtr) — deriveSpriteFromArg_v1.
    deriveSpriteFromArg_v1(state, slotPtr);

    // pea (1).w; jsr 0x1CC62 → D0 (long).
    const cc62Ret = (subs?.fun_1cc62?.(state, FUN_1CC62_ARG) ?? 0) >>> 0;
    fun1CC62Calls++;
    // slot[0x14..0x17] = D0.
    wLongBE(state, slotOff + 0x14, cc62Ret);

    // moveq #0,D0; move.l D0,(0x4,A2); move.l D0,(A2)
    wLongBE(state, slotOff + 0x04, 0);
    wLongBE(state, slotOff + 0x00, 0);
    // move.b #1,(0x18,A2)
    w8(state, slotOff + 0x18, 1);
    // clr.b (0x1A,A2)
    w8(state, slotOff + 0x1a, 0);
    // clr.l (0x28,A2)
    wLongBE(state, slotOff + 0x28, 0);

    // clr_loop: 5 word clears at slot+0x2C, +0x32, +0x38, +0x3E, +0x44.
    for (let k = 0; k < 5; k++) {
      const o = slotOff + 0x2c + k * 6;
      wWordBE(state, o, 0);
    }

    // move.l #0x20C18,D0; move.l D0,(0x5C,A2); move.l D0,(0x58,A2)
    wLongBE(state, slotOff + 0x5c, SLOT_SUB_PTR_INIT);
    wLongBE(state, slotOff + 0x58, SLOT_SUB_PTR_INIT);

    // move.b #1,(0x26,A2); clr.b (0x24,A2); move.b #2,(0x25,A2)
    w8(state, slotOff + 0x26, 1);
    w8(state, slotOff + 0x24, 0);
    w8(state, slotOff + 0x25, 2);

    // jsr 0x150D0(slotPtr) — sprite-coords + jsr 264AA.
    subs?.fun_150d0?.(state, slotPtr);
    fun150D0Calls++;

    // jsr 0x18E6C(typeCode=4, subIdx=sext_l(slot[0x19])) — slot-insert-sorted.
    const slot19 = r8(state, slotOff + 0x19);
    const slot19Sext = sext8(slot19);
    subs?.fun_18e6c?.(state, FUN_18E6C_18F46_ARG1, slot19Sext);
    fun18E6CCalls++;

    entries.push(tracedEntry);
    a3 = (a3 + ENTRY_STRIDE) >>> 0;
  }

  // ─── Tail walk (loop @ 0x14D86) ──────────────────────────────────────
  const slots: SlotTrace[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotPtr = (SLOT_ARRAY_ADDR + i * SLOT_STRIDE) >>> 0;
    const slotOff = slotPtr - WORK_RAM_BASE;

    const trace: SlotTrace = {
      slotIdx: i,
      slotPtr,
      action: "noop",
    };

    // tst.b (0x18,A2); beq → tail_advance.
    if (r8(state, slotOff + 0x18) === 0) {
      slots.push(trace);
      continue;
    }

    // Word reads (BE) di slot[0x52] e slot[0x54].
    const slot52 = sext16(rWordBE(state, slotOff + 0x52));
    const slot54 = sext16(rWordBE(state, slotOff + 0x54));

    // Test condizione lower-cross: D2 == slot52 (sext_w) AND D3 < slot52.
    // Il binario fa cmp.w slot52,D0w dove D0 = sext_w(D2.b). slot52 in workRam
    // è già word (signed quando comparato con bgt/blt). Per il check di
    // uguaglianza basta confrontare i word values; per `<` usa signed.
    const d2Word = sext8(d2) & 0xffff; // sext_w(sext_b(D2.b))
    const d3Word = sext8(d3) & 0xffff;
    const d2WordSigned = sext16(d2Word);
    const d3WordSigned = sext16(d3Word);

    let teardown = false;
    if (d2WordSigned === slot52 && d3WordSigned < slot52) {
      teardown = true;
    } else if (d2WordSigned === slot54 && d3WordSigned > slot54) {
      teardown = true;
    }

    if (teardown) {
      // clr.b (0x18,A2)
      w8(state, slotOff + 0x18, 0);
      // jsr 0x18F46(arg1=4, arg2=sext_l(slot[0x19])).
      const slot19 = r8(state, slotOff + 0x19);
      subs?.fun_18f46?.(state, FUN_18E6C_18F46_ARG1, sext8(slot19));
      fun18F46Calls++;
      trace.action = "teardown";
    }

    slots.push(trace);
  }

  return {
    mode,
    entryListPtr,
    emptyEntryList,
    entries,
    slots,
    fun1CC62Calls,
    fun150D0Calls,
    fun18E6CCalls,
    fun18F46Calls,
  };
}
