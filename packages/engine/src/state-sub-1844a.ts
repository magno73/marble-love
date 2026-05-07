/**
 * state-sub-1844a.ts — replica `FUN_0001844A` (610 byte, 0x1844A..0x186AA).
 *
 * "Slot-table tick: timer decrement, insert-sorted trigger, sprite-coord
 * update, and 3-bucket sound dispatch". Gated da `(*0x400394).w == 3` e
 * `*0x400760 != 0`. Itera la slot-table di 36 entry × 16 byte @ 0x401650.
 *
 * **Flow per ogni entry** (D2 = 0..0x23, A2 avanza di 0x10):
 *
 *   1. `w = sext16(entry[0x2..0x3])`:
 *      - **w >= 0 (decrement path, @0x18490..0x184FE)**:
 *          * `entry[0x2]--`
 *          * Se nuovo valore == 0:
 *              - `entry[0x8..0xB] = 0x21342`
 *              - `entry[0x2..0x3] = 0xFFFF` (= -1)
 *              - `slotInsertSorted(typeCode=0x29, subIdx=sext_l(entry[0]))`
 *              - Track min-address nei 3 bucket (D2<0xC → local-0xC,
 *                D2<0x18 → local-0x8, else → local-0x4) per le entry inserite
 *              - `bra → sprite_check`
 *          * Se nuovo valore > 0: `bra → sprite_check`
 *      - **w < 0 (pointer-walk path, @0x18500..0x1855A)**:
 *          * Se `entry[0x2..0x3].w != -1`: skip entry (→ sprite_check)
 *          * `entry[0x8..0xB] += 4`
 *          * A0 = `entry[0x8..0xB]`; se `*(A0) != -1` (long in ROM): skip
 *          * `fun_18f46(0x29, sext_l(entry[0]))` (callback iniettabile)
 *          * Ricarica timer da ROM:
 *              - Se `entry[0].b < 0x18`: `entry[0x2..0x3] = ROM_u16[0x242F6 + entry[0]*2]`
 *              - Altrimenti: `entry[0x2..0x3] = u16 @ (*0x400764 + (entry[0]-0x18)*2)`
 *
 *   2. **sprite_check (@0x1855C)**: se `entry[0x2..0x3] == -1` →
 *      `computeSpriteCoords_v4(entryAddr)` (FUN_18972 iniettabile)
 *
 *   3. Avanza A2 += 0x10, D2++, loop finché D2 != 0x24.
 *
 * **Post-loop (3-bucket sound dispatch)**:
 *   Per ciascuno dei 3 bucket local (−0xC, −0x8, −0x4), se il valore != 0x402000:
 *     * `D1.b = rng(2)` (FUN_13A98, live)
 *     * A0 = bucket_entry; `D2.w = entry[0xE..0xF] andi 0xFFFF`
 *     * Se `−0x17 > D2.w` (signed) **OPPURE** `D2.w > 0xE0`:
 *       `D0 = sext_l(D1.b) + bucket_offset; A0 = ROM[0x1EFD6 + D0*4]; call soundCommand(A0)`
 *     * Altrimenti (`−0x17 <= D2.w <= 0xE0`):
 *       `D0 = sext_l(D1.b) + bucket_offset; A0 = RAM[0x1EFB6 + D0*4]; call soundCommand(A0)`
 *   (bucket_offset: 0 per −0xC, +2 per −0x8, +4 per −0x4)
 *
 * **Disasm 0x1844A..0x186AA** (610 byte):
 *
 *   0x1844a  link.w A6,-0xc
 *   0x1844e  movem.l {A4,A3,A2,D2},-(SP)
 *   0x18452  movea.l #0x158ac,A3           ; A3 = soundCommand ptr
 *   0x18458  movea.l #0x1efb6,A4           ; A4 = ROM ptr-table B (low range)
 *   0x1845e  moveq 0x3,D0
 *   0x18460  cmp.w (0x00400394).l,D0w
 *   0x18466  bne.w 0x000186a4             ; gameMode != 3 → epilogue
 *   0x1846a  tst.b (0x00400760).l
 *   0x18470  beq.w 0x000186a4             ; byte760 == 0 → epilogue
 *   0x18474  movea.l #0x401650,A2
 *   0x1847a  movea.l #0x402000,A0
 *   0x18480  move.l A0,(-0x4,A6)          ; local-0x4 = 0x402000 (sentinel)
 *   0x18484  move.l D0,(-0x8,A6)          ;   D0 was 3, but after cmp it's 3
 *   ...wait actually move.l A0,(-0x4) then move.l A0,D0 then move.l D0,(-0x8/−0xC).
 *   Reading verbatim:
 *   0x18480  move.l A0,(-0x4,A6)
 *   0x18484  move.l A0,D0                  ; D0 = 0x402000
 *   0x18486  move.l D0,(-0x8,A6)
 *   0x1848a  move.l D0,(-0xc,A6)
 *   0x1848e  clr.b D2b                    ; D2 = 0 (loop counter)
 *
 * [loop body @ 0x18490 — see module body for detail]
 *
 * **Globals (workRam offsets relativo a 0x400000)**:
 *   - `0x394` (word) game_mode (read)
 *   - `0x760` (byte) secondary gate (read)
 *   - `0x764..0x767` (long) selector ptr (read nel timer-reload secondary path)
 *   - `0x1650..0x188F` (576 byte) slot-table 0x24 × 0x10 (r/w)
 *
 * **ROM reads**:
 *   - `0x242F6` u16 BE × 0x18 — primary timer table per entry[0]<0x18
 *   - `0x1EFD6` long BE × N — function ptr table (high D2 range)
 *   - long reads at `entry[0x8..0xB]` (pointer-walk sentinels; starts 0x21342)
 *   - pointer read at `(entry[0x8..0xB])` for ROM long sentinel check
 *   - `0x1EFB6` — base per la tabella RAM? (A4 = 0x1EFB6 è in ROM per questo
 *     binario: 0x1EFXX < 0x402000 quindi è ROM; stride = 4 byte/slot)
 *
 * **JSR esterne** (via `StateSub1844ASubs`):
 *   - `FUN_00013A98` (RNG): live via `rngNext` di `rng.ts`.
 *   - `FUN_00018E6C` (slotInsertSorted): iniettabile via `subs.fun_18e6c`.
 *   - `FUN_00018F46` (teardown/timer-reset): iniettabile via `subs.fun_18f46`.
 *   - `FUN_00018972` (computeSpriteCoords_v4): iniettabile via `subs.fun_18972`.
 *   - `FUN_0001584C` (soundCommand, via A3=0x158AC): iniettabile via
 *     `subs.soundCommand(ptrArg)`.
 *
 * **Caller noto** (1 xref): `FUN_00010FCE @ 0x11004` (UNCONDITIONAL_CALL).
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-1844a-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

// ─── Address constants (workRam offsets relativi a 0x400000) ─────────────

const WORK_RAM_BASE = 0x00400000 as const;

/** Word: game-mode discriminator (== 3 per abilitare il loop). */
export const GAME_MODE_OFFSET = 0x394 as const;
/** Byte: secondary gate (non-zero per abilitare). */
export const SECONDARY_GATE_OFFSET = 0x760 as const;
/** Long: selector pointer letto nel timer-reload secondary path. */
export const SELECTOR_PTR_OFFSET = 0x764 as const;
/** Base slot-table (0x24 × 0x10 byte = 0x240 byte). */
export const SLOT_TABLE_OFFSET = 0x1650 as const;

/** Numero di entry nella slot-table. */
export const SLOT_ENTRY_COUNT = 0x24 as const;
/** Stride (byte) per entry. */
export const SLOT_ENTRY_STRIDE = 0x10 as const;

/** Game-mode richiesto. */
export const GAME_MODE_REQUIRED = 0x0003 as const;

/** Sentinel long addr che inizializza i 3 bucket (0x402000, fuori workRam). */
export const BUCKET_SENTINEL_ADDR = 0x00402000 as const;

// ─── ROM constants ──────────────────────────────────────────────────────────

/** Valore iniziale del pointer-walk pointer (ROM), scritto in entry[0x8..0xB]
 *  quando il timer tocca 0. */
export const PTR_WALK_INIT = 0x00021342 as const;

/** ROM u16 BE × 0x18 — primary timer-reload table per entry[0].b < 0x18. */
export const ROM_TIMER_TABLE_PRIMARY = 0x000242f6 as const;

/** ROM ptr-table "high range" (D2.w > 0xE0 or D2.w < -0x17). Stride 4. */
export const ROM_PTR_TABLE_HI = 0x0001efd6 as const;

/** ROM ptr-table "low/mid range" (-0x17..0xE0). Base = 0x1EFB6, stride 4. */
export const ROM_PTR_TABLE_LO = 0x0001efb6 as const;

// ─── Entry field offsets ────────────────────────────────────────────────────

/** Byte entry[0]: subIndex usato come arg per slotInsertSorted / fun_18f46. */
export const ENTRY_SUB_IDX_OFF = 0x00 as const;
/** Word entry[0x2..0x3]: countdown timer (signed; -1 == active/walking). */
export const ENTRY_TIMER_OFF = 0x02 as const;
/** Long entry[0x8..0xB]: pointer-walk current ptr (ROM). */
export const ENTRY_PTR_WALK_OFF = 0x08 as const;
/** Word entry[0xE..0xF]: D2.w field usato nel bucket sound dispatch. */
export const ENTRY_DISPATCH_WORD_OFF = 0x0e as const;

// ─── Magic constants ─────────────────────────────────────────────────────────

/** Timer sentinel value (word -1 = 0xFFFF). */
export const TIMER_ACTIVE_SENTINEL = 0xffff as const;
/** Long sentinel in ROM that terminates pointer-walk. */
export const PTR_WALK_ROM_SENTINEL = 0xffffffff as const;

/** typeCode per slotInsertSorted (sempre 0x29, da `pea (0x29).w`). */
export const INSERT_TYPE_CODE = 0x29 as const;
/** arg1 di fun_18f46 (sempre 0x29, da `pea (0x29).w`). */
export const FUN_18F46_ARG1 = 0x29 as const;

/** Cutoff per bucket D2 < 0x0C → bucket[0]. */
export const BUCKET0_CUTOFF = 0x0c as const;
/** Cutoff per bucket D2 < 0x18 → bucket[1]. */
export const BUCKET1_CUTOFF = 0x18 as const;

/** Limite RNG post-loop. */
export const POST_LOOP_RNG_LIMIT = 0x0002 as const;

/** Soglia bassa per dispatch (signed): se D2.w < -0x17 → HI table. */
export const DISPATCH_LO_THRESHOLD = -0x17 as const; // -23
/** Soglia alta per dispatch: se D2.w > 0xE0 → HI table. */
export const DISPATCH_HI_THRESHOLD = 0x00e0 as const; // 224

/** Bucket offsets aggiunti a D0 prima di *4 nell'accesso alle ptr-table. */
export const BUCKET_OFFSET: readonly [number, number, number] = [0, 2, 4] as const;

// ─── Sub injection ───────────────────────────────────────────────────────────

/**
 * Stub injection per le JSR esterne.
 *
 * - `fun_18e6c(typeCode, subIdx, state, rom)`:
 *     Replica di `FUN_00018E6C` (slotInsertSorted). Chiamata 0..0x24 volte
 *     (solo quando il timer di una entry tocca 0). Default no-op.
 * - `fun_18f46(arg1Long, arg2Long, state)`:
 *     Replica di `FUN_00018F46`. Chiamata quando la pointer-walk raggiunge un
 *     long == 0xFFFFFFFF in ROM. Default no-op.
 * - `fun_18972(entryAddr, state)`:
 *     Replica di `FUN_00018972` (computeSpriteCoords_v4). Chiamata ogni
 *     iterazione in cui `entry[0x2..0x3] == -1`. Default no-op.
 * - `soundCommand(ptrArg)`:
 *     Replica di `FUN_0001584C` (via A3). Riceve il long ptr (da ROM) passato
 *     come unico argomento. Chiamato 0..3 volte (una per bucket != sentinel).
 *     Default no-op.
 * - `readRomLong(romAddr)`:
 *     Legge un long BE dalla ROM all'indirizzo assoluto dato. Usato per:
 *       1. Il pointer-walk sentinel check: `*(entry[0x8..0xB])` in ROM.
 *       2. La ptr-table HI/LO dispatch: `ROM[0x1EFD6 + D0*4]` o
 *          `ROM[0x1EFB6 + D0*4]`.
 *     Con `RomImage` disponibile usa `rom.program[addr]`. Se non si dispone
 *     di ROM, iniettare questa callback.
 *
 * `FUN_00013A98` (RNG) è sempre live tramite `rngNext` (non iniettabile).
 */
export interface StateSub1844ASubs {
  /** FUN_18E6C(typeCode=0x29, subIdx=sext_l(entry[0]), state, rom). */
  fun_18e6c?: (
    typeCode: number,
    subIdx: number,
    state: GameState,
    rom: RomImage,
  ) => void;
  /** FUN_18F46(arg1=0x29, arg2=sext_l(entry[0]), state). */
  fun_18f46?: (arg1Long: number, arg2Long: number, state: GameState) => void;
  /** FUN_18972(entryAbsAddr, state). */
  fun_18972?: (entryAbsAddr: number, state: GameState) => void;
  /** FUN_0001584C via jsr (A3); ptrArg = long pushato prima del jsr. */
  soundCommand?: (ptrArg: number) => void;
}

// ─── Risultato ───────────────────────────────────────────────────────────────

/** Dettaglio di una entry processata nel loop principale. */
export interface EntryResult {
  /** Indice entry (0..35). */
  index: number;
  /**
   * Quale percorso è stato preso:
   * - `"skip"` — entry non processata (timer == -1 ma != -1 check fallisce,
   *   oppure timer > 0 e non ha toccato 0)
   * - `"decrement"` — timer decrementato, non ancora zero
   * - `"insert"` — timer toccato 0: insert sorted + ptr reset
   * - `"ptr_walk_no_sentinel"` — ptr-walk: pointer avanzato ma sentinel non trovato
   * - `"ptr_walk_sentinel"` — ptr-walk: sentinel trovato, fun_18f46 chiamato +
   *   timer ricaricato
   */
  path:
    | "skip"
    | "decrement"
    | "insert"
    | "ptr_walk_no_sentinel"
    | "ptr_walk_sentinel";
  /** True se computeSpriteCoords_v4 è stata chiamata su questa entry. */
  spriteUpdated: boolean;
  /** True se questa entry è stata scelta come bucket[0] min. */
  bucket0: boolean;
  /** True se questa entry è stata scelta come bucket[1] min. */
  bucket1: boolean;
  /** True se questa entry è stata scelta come bucket[2] min. */
  bucket2: boolean;
}

export interface StateSub1844AResult {
  /** True se il gate ha fallito (gameMode != 3 o byte760 == 0). */
  earlyOut: boolean;
  /** Risultati per-entry (vuoto se earlyOut). */
  entries: EntryResult[];
  /** Quante chiamate a soundCommand sono state effettuate (0..3). */
  soundCalls: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function r8(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}
function rw16(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}
function ww16(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}
function rl32(state: GameState, off: number): number {
  return (
    ((state.workRam[off] ?? 0) << 24) |
    ((state.workRam[off + 1] ?? 0) << 16) |
    ((state.workRam[off + 2] ?? 0) << 8) |
    (state.workRam[off + 3] ?? 0)
  ) >>> 0;
}
function wl32(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}
/** Sign-extend 16-bit. */
function sext16(u: number): number {
  return ((u & 0xffff) << 16) >> 16;
}
/** Sign-extend 8-bit. */
function sext8(u: number): number {
  return ((u & 0xff) << 24) >> 24;
}

/** Read long BE from ROM (program area). */
function romRl32(rom: RomImage, addr: number): number {
  return (
    ((rom.program[addr] ?? 0) << 24) |
    ((rom.program[addr + 1] ?? 0) << 16) |
    ((rom.program[addr + 2] ?? 0) << 8) |
    (rom.program[addr + 3] ?? 0)
  ) >>> 0;
}
/** Read word BE from ROM. */
function romRw16(rom: RomImage, addr: number): number {
  return (((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0)) & 0xffff;
}

/**
 * Read long from absolute M68k addr — either ROM or workRam.
 * Used for pointer-walk sentinel check (`*(entry[0x8..0xB])`).
 */
function readLongAbsolute(state: GameState, rom: RomImage, absAddr: number): number {
  const a = absAddr >>> 0;
  if (a >= WORK_RAM_BASE && a + 3 < WORK_RAM_BASE + state.workRam.length) {
    return rl32(state, a - WORK_RAM_BASE);
  }
  // ROM area.
  return romRl32(rom, a);
}

/** RNG wrapper: same as state-sub-1881c et al. */
function rng(state: GameState, limit: number): number {
  let r = rngNext(state.rng, as_u16(limit)) as unknown as number;
  if (limit > 0) {
    while (r >= limit) r -= limit;
  }
  return r & 0xffff;
}

// ─── Replica ─────────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_0001844A`.
 *
 * @param state  GameState. Letture: workRam @ 0x394, 0x760, 0x764, slot-table
 *               @ 0x1650. Scritture: slot-table (timer, ptr-walk ptr).
 * @param rom    RomImage. Letture: 0x242F6 (timer), 0x21342..
 *               (ptr-walk sentinel), 0x1EFD6/0x1EFB6 (sound dispatch).
 * @param subs   Stub injection (default: tutti no-op).
 *
 * @returns Risultato con entries per-iter e contatore soundCalls.
 *
 * **Ordine scritture critico**:
 *   - Insert path: prima `entry[0x8..0xB] = 0x21342`, poi `entry[0x2..0x3] =
 *     0xFFFF`, poi `fun_18e6c`. Il bucket tracking avviene DOPO l'insert (min
 *     tracking dei ptr A2 aggiornato prima di chiamare fun_18e6c).
 *   - Ptr-walk path: `entry[0x8..0xB] += 4` PRIMA del sentinel check.
 *   - Timer-reload: avviene DOPO la call a fun_18f46.
 *   - sprite_check (@0x1855C): avviene DOPO tutti i path (incluso skip) se
 *     `entry[0x2..0x3] == -1` al termine dell'iterazione.
 */
export function stateSub1844A(
  state: GameState,
  rom: RomImage,
  subs?: StateSub1844ASubs,
): StateSub1844AResult {
  // ─── Gate ───────────────────────────────────────────────────────────────
  const gameMode = rw16(state, GAME_MODE_OFFSET);
  const byte760 = r8(state, SECONDARY_GATE_OFFSET);
  if (gameMode !== GAME_MODE_REQUIRED || byte760 === 0) {
    return { earlyOut: true, entries: [], soundCalls: 0 };
  }

  // ─── Init 3 bucket locals (all 0x402000 = sentinel) ─────────────────────
  // Disasm: move.l A0,(-0x4,A6); move.l A0,D0; move.l D0,(-0x8,A6); move.l D0,(-0xC,A6)
  // A0 = 0x402000; D0 = 0x402000. All 3 start as sentinel.
  const buckets: [number, number, number] = [
    BUCKET_SENTINEL_ADDR,
    BUCKET_SENTINEL_ADDR,
    BUCKET_SENTINEL_ADDR,
  ];

  const entryResults: EntryResult[] = [];

  // ─── Main loop (D2 = 0..0x23) ────────────────────────────────────────────
  for (let d2 = 0; d2 < SLOT_ENTRY_COUNT; d2++) {
    const entryOff = SLOT_TABLE_OFFSET + d2 * SLOT_ENTRY_STRIDE;
    // Absolute M68k addr of this entry (needed for fun_18972 and bucket tracking).
    const entryAbsAddr = WORK_RAM_BASE + entryOff;

    const result: EntryResult = {
      index: d2,
      path: "skip",
      spriteUpdated: false,
      bucket0: false,
      bucket1: false,
      bucket2: false,
    };

    const timerWord = rw16(state, entryOff + ENTRY_TIMER_OFF);
    const timerSigned = sext16(timerWord);

    if (timerSigned >= 0) {
      // ─── Decrement path (@0x18490..0x184FE) ────────────────────────────

      // subq.w #1, (0x2,A2)
      const newTimer = (timerWord - 1) & 0xffff;
      ww16(state, entryOff + ENTRY_TIMER_OFF, newTimer);

      const newTimerSigned = sext16(newTimer);

      if (newTimerSigned > 0) {
        // bgt → sprite_check
        result.path = "decrement";
      } else {
        // newTimerSigned <= 0: bgt not taken → insert block.
        // Covers: timerWord==0 → newTimer=0xFFFF (-1), timerWord==1 → newTimer=0 (0).
        result.path = "insert";

        // move.l #0x21342, (0x8,A2)
        wl32(state, entryOff + ENTRY_PTR_WALK_OFF, PTR_WALK_INIT);
        // move.w #-1, (0x2,A2)
        ww16(state, entryOff + ENTRY_TIMER_OFF, TIMER_ACTIVE_SENTINEL);

        // Read entry[0] for subIdx args.
        const subIdx = sext8(r8(state, entryOff + ENTRY_SUB_IDX_OFF));

        // Call slotInsertSorted(typeCode=0x29, subIdx=sext_l(entry[0]))
        subs?.fun_18e6c?.(INSERT_TYPE_CODE, subIdx, state, rom);

        // ── Bucket min tracking ────────────────────────────────────────────
        // Disasm: cmpi.b #0xC, D2b; bge → check0x18
        //         cmpa.l (-0xC,A6),A2; bcc → after_track (if A2 >= local-0xC, skip)
        //         move.l A2,(-0xC,A6) ; bra after_track
        // [check0x18]: cmpi.b #0x18, D2b; bge → check_hi
        //         cmpa.l (-0x8,A6),A2; bcc → after_track
        //         move.l A2,(-0x8,A6); bra after_track
        // [check_hi]: cmpa.l (-0x4,A6),A2; bcc → after_track
        //         move.l A2,(-0x4,A6)
        //
        // bcc = branch carry clear = unsigned >=.
        // "if A2 >= local[n], skip" = keep the SMALLER address (min tracking).
        if (d2 < BUCKET0_CUTOFF) {
          if (entryAbsAddr < buckets[0]) {
            buckets[0] = entryAbsAddr;
            result.bucket0 = true;
          }
        } else if (d2 < BUCKET1_CUTOFF) {
          if (entryAbsAddr < buckets[1]) {
            buckets[1] = entryAbsAddr;
            result.bucket1 = true;
          }
        } else {
          if (entryAbsAddr < buckets[2]) {
            buckets[2] = entryAbsAddr;
            result.bucket2 = true;
          }
        }

        // After tracking, fall through to bra → sprite_check.
      }
    } else {
      // ─── Ptr-walk path (@0x18500..0x1855A) ─────────────────────────────
      // timerSigned < 0: check if timer == -1 exactly.

      // moveq -0x1,D0; cmp.w (0x2,A2),D0w; bne → sprite_check
      if (timerWord !== TIMER_ACTIVE_SENTINEL) {
        result.path = "skip";
        // fall through to sprite_check
      } else {
        // Timer == -1 (active): advance ptr-walk and check sentinel.

        // addq.l #4, (0x8,A2)
        const ptrOld = rl32(state, entryOff + ENTRY_PTR_WALK_OFF);
        const ptrNew = (ptrOld + 4) >>> 0;
        wl32(state, entryOff + ENTRY_PTR_WALK_OFF, ptrNew);

        // movea.l (0x8,A2),A0; moveq -0x1,D0; cmp.l (A0),D0; bne → sprite_check
        // ptrNew is already stored; read long at address ptrNew.
        const ptrTarget = readLongAbsolute(state, rom, ptrNew);

        if (ptrTarget !== PTR_WALK_ROM_SENTINEL) {
          result.path = "ptr_walk_no_sentinel";
          // bne → sprite_check (no call, no timer reload)
        } else {
          result.path = "ptr_walk_sentinel";

          // Sentinel found: call fun_18f46(0x29, sext_l(entry[0]))
          const subIdx = sext8(r8(state, entryOff + ENTRY_SUB_IDX_OFF));
          subs?.fun_18f46?.(FUN_18F46_ARG1, subIdx, state);

          // Timer reload from ROM table.
          // cmpi.b #0x18,(A2) — check entry[0].b
          const b0 = r8(state, entryOff + ENTRY_SUB_IDX_OFF);
          if (b0 < BUCKET1_CUTOFF) {
            // Primary: ROM u16 BE @ (0x242F6 + entry[0]*2)
            const idx = b0 & 0xff;
            const newTimerVal = romRw16(rom, ROM_TIMER_TABLE_PRIMARY + idx * 2);
            ww16(state, entryOff + ENTRY_TIMER_OFF, newTimerVal);
          } else {
            // Secondary: u16 @ (*0x400764 + (entry[0] - 0x18) * 2)
            // D0 = sext_l(b0); D1 = 0x18; sub.l D1,D0 → D0 = b0 - 0x18;
            // add.l D0,D0 → D0 = (b0-0x18)*2; movea.l D0,A0;
            // adda.l (0x00400764).l,A0 → A0 = *0x400764 + (b0-0x18)*2
            const d0 = (sext8(b0) - 0x18) * 2;
            const selectorPtr = rl32(state, SELECTOR_PTR_OFFSET);
            const secAddr = (selectorPtr + d0) >>> 0;
            // move.w (A0),(0x2,A2): read u16 from secAddr (may be ROM or workRam)
            let newTimerVal: number;
            if (secAddr >= WORK_RAM_BASE && secAddr + 1 < WORK_RAM_BASE + state.workRam.length) {
              newTimerVal = rw16(state, secAddr - WORK_RAM_BASE);
            } else {
              newTimerVal = romRw16(rom, secAddr);
            }
            ww16(state, entryOff + ENTRY_TIMER_OFF, newTimerVal);
          }
        }
      }
    }

    // ─── sprite_check (@0x1855C) ─────────────────────────────────────────
    // moveq -0x1,D0; cmp.w (0x2,A2),D0w; bne → advance
    // If entry[0x2..0x3] == -1 (0xFFFF) → call fun_18972(entryAbsAddr)
    const timerAfter = rw16(state, entryOff + ENTRY_TIMER_OFF);
    if (timerAfter === TIMER_ACTIVE_SENTINEL) {
      subs?.fun_18972?.(entryAbsAddr, state);
      result.spriteUpdated = true;
    }

    entryResults.push(result);
  }

  // ─── Post-loop: 3-bucket sound dispatch ─────────────────────────────────
  let soundCalls = 0;

  for (let b = 0; b < 3; b++) {
    const bucketAddr = buckets[b] ?? BUCKET_SENTINEL_ADDR;
    // cmpi.l #0x402000, bucket; beq → skip
    if (bucketAddr === BUCKET_SENTINEL_ADDR) continue;

    // pea (0x2).w; jsr 0x13A98 → D1.b = rng(2)
    const d1b = rng(state, POST_LOOP_RNG_LIMIT) & 0xff;

    // movea.l bucket,A0; move.w (0xE,A0),D2w; andi.w #-0x1,D2w
    const bucketOff = bucketAddr - WORK_RAM_BASE;
    const d2w = rw16(state, bucketOff + ENTRY_DISPATCH_WORD_OFF) & 0xffff;
    const d2Signed = sext16(d2w);

    // moveq -0x17,D0; cmp.w D2w,D0w; addq.l #4,SP
    // bgt → dispatch_hi_path: -0x17 > D2.w (signed) → D2.w < -0x17
    // else: cmpi.w #0xE0,D2w; ble → dispatch_lo_path (D2.w <= 0xE0)
    // else → dispatch_hi_path (D2.w > 0xE0)
    //
    // Summary: use HI table if d2Signed < DISPATCH_LO_THRESHOLD || d2Signed > DISPATCH_HI_THRESHOLD
    const useHiTable =
      d2Signed < DISPATCH_LO_THRESHOLD || d2Signed > DISPATCH_HI_THRESHOLD;

    // D0 = sext_l(D1.b) + bucket_offset[b]; D0 <<= 2; table[D0]
    const d0base = sext8(d1b) + (BUCKET_OFFSET[b] ?? 0);
    const tableIdx = (d0base * 4) | 0;

    let ptrArg: number;
    if (useHiTable) {
      // movea.l #0x1EFD6,A0; movea.l (0,A0,D0*1),A0 — read long from ROM table
      ptrArg = romRl32(rom, ROM_PTR_TABLE_HI + tableIdx);
    } else {
      // movea.l A4,A0; movea.l (0,A0,D0*1),A0 — A4 = 0x1EFB6 (ROM)
      ptrArg = romRl32(rom, ROM_PTR_TABLE_LO + tableIdx);
    }

    // pea (A0); jsr (A3) — call soundCommand(ptrArg)
    subs?.soundCommand?.(ptrArg);
    soundCalls++;
  }

  return { earlyOut: false, entries: entryResults, soundCalls };
}
