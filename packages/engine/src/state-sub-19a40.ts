/**
 * state-sub-19a40.ts — replica `FUN_00019A40` (362 byte, 0x019A40-0x019BAA).
 *
 * "Entity-table spawn dispatcher": itera i 5 pair `(D6,D7)` letti da ROM @
 * `0x244F6` (5 × 2 = 10 byte) e, per ciascuno, scansiona la tabella entity @
 * `0x4019F8` (10 entity × 0x38 byte stride). Conta i match `entity[0x0C]>>3 ==
 * D6_signed_byte` con `entity[0x18] == 1`. Se esiste **esattamente un** match
 * (D3 == 1) verifica la prossimità lungo Y; se la distanza
 * `|D7 - entity[0x10]>>3| < 4` → skip. In tutti i casi proseguibili cerca il
 * **primo slot libero** (`entity[0x18] != 1`) e ne inizializza i campi:
 *
 *   entity[0x18] = 1
 *   entity[0x1A] = 1
 *   entity[0x0C] = sext(D6) << 0x13 + 0x40000   ; X (long, fixed-point)
 *   entity[0x10] = sext(D7) << 0x13 + 0x40000   ; Y
 *   entity[0x14] = 0x3FD80000                   ; Z?
 *   entity[0x24] = 0
 *   entity[0x1B] = 0
 *   entity[0x25] = 0x08                         ; state-byte
 *   entity[0x1C] = 0x000224CA                   ; ptr (likely AI script)
 *   entity[0x04] = 0xFFFC0000                   ; long (likely vel)
 *
 * Quindi chiama 3 sub:
 *   - `FUN_00019E42(entityPtr)` — marble-cell-dispatch (already replicato)
 *   - `FUN_00018E6C(0xF, sext_l(entity[0x19]))` — slot-insert-sorted
 *   - `FUN_000158AC(*(0x24500 + D5*4))` — sound/event by mid-loop index
 *
 * Se nessun slot libero (tutti 10 entity hanno `entity[0x18] == 1`) → exit
 * IMMEDIATO della funzione.
 *
 * Ogni iterazione del **mid-loop** (D5: 0..4): consuma un pair `(D6,D7)` da
 * `(A1)+`, fa il match-scan, eventualmente spawna **una sola** entity e poi
 * va al D4-increment (NON ad altro D5++, perchè il `bra 0x19b98` salta
 * `addq.b #1,D5`).
 *
 * Ogni iterazione del **outer-loop** (D4: 0..1): resetta A1 a 0x244F6, D5 a 0
 * e ripete. D4 funge da threshold del compare `cmp.b D4,D3; bgt skip`: alla
 * prima iter (D4=0) si spawna solo se D3 == 0, alla seconda (D4=1) anche se
 * D3 == 1. (Pass progressivamente più permissivo per spawnare in slot dove
 * c'è già 1 entity con la stessa X.)
 *
 * **Disasm 0x19A40..0x19BAA** (capstone M68K_010, 362 byte) — vedi
 * `/tmp/marble-cand/019A40.txt` + bytes raw nel ROM. Tutte le istruzioni
 * coperte:
 *   prologue:                link.w A6,-2 / movem.l {D2-D7,A2-A4},-(SP)
 *   A3 = #0x4019F8
 *   D4 = 0
 *   outer_loop @ 0x19A50:    A2 = A3 ; A1 = #0x244F6 ; D5 = 0
 *   mid_loop @ 0x19A5A:      D6 = (A1)+.b ; D7 = (A1)+.b ; A4 = sext_l(D7)
 *                            A2 = A3 ; D3 = 0 ; D2 = 0
 *   inner_scan @ 0x19A66:    if (entity[0x18] == 1) {
 *                              D0 = sext_w(D6.b)
 *                              D1 = (entity[0x0C..0x0D].w) >> 3 (asr.w #3)
 *                              if (D0 == D1) { D3++ ; if (D3 < 2) save D2 }
 *                            }
 *                            A2 += 0x38 ; D2++ ; if (D2 != 10) goto inner
 *   @ 0x19A96:               if (D3 > D4) goto next_mid (skip spawn)
 *                            if (D3 == 1) {
 *                              ; proximity Y-check
 *                              idx = (-1, A6).b sext_l ; D0 = idx*4
 *                              A2 = *(0x1F0BA + D0)         ; entity ptr
 *                              D1 = sext_l(D7)               ; (== A4)
 *                              D0 = (entity[0x10..0x11].w) sext_l asr.l #3
 *                              D1 -= D0
 *                              if (4 > D1) goto next_mid    ; |dy|<4 skip
 *                            }
 *   find_free @ 0x19AD2:     A2 = A3 ; D2 = 0
 *                            while (entity[0x18] == 1) { A2 += 0x38; D2++;
 *                                                        if (D2 == 10) break }
 *                            if (D2 == 10) goto epilogue (no slot free)
 *   spawn @ 0x19AF4:         init the entity (vedi sopra)
 *                            push A2 ; jsr 0x19E42
 *                            push sext_l(entity[0x19].b) ; push #0xF
 *                              ; jsr 0x18E6C
 *                            D0 = D5.b sext_w ; D0 *= 2 (asl.w #2)? no: asl.w #2
 *                              wait — `asl.w #0x2,D0w` → D0 *= 4
 *                            A0 = *(0x24500 + D0.w)
 *                            push A0 ; jsr 0x158AC
 *                            lea (0x10, SP), SP             ; pop 16 bytes (4 args)
 *                            bra @ 0x19B98 (skip mid-inc)
 *   next_mid @ 0x19B8E:      D5++ ; if (D5 != 5) goto mid_loop
 *   next_outer @ 0x19B98:    D4++ ; if (D4 < 2) goto outer_loop
 *   epilogue @ 0x19BA2:      movem.l (SP)+,{D2-D7,A2-A4} / unlk A6 / rts
 *
 * **Tabelle ROM lette** (read-only):
 *   - `0x244F6` (10 byte): 5 pair `(X.b, Y.b)` signed.
 *     Valori @ Marble Madness: 39 3F | 37 3F | 31 3A | 2F 3A | 29 3A.
 *   - `0x1F0BA` (40 byte = 10 long): entity ptr table
 *     [0x4019F8 + i*0x38 for i in 0..9]. Equivalent a `A3 + i*0x38`.
 *   - `0x24500` (20 byte = 5 long): event ID table (byte per pair).
 *
 * **WorkRAM scritta**:
 *   - 10 byte di entity scelto (offsets 0x04, 0x0C-0x0F, 0x10-0x13, 0x14-0x17,
 *     0x18, 0x1A, 0x1B, 0x1C-0x1F, 0x24, 0x25). Solo se spawn esegue.
 *
 * **Sub injections** (3 callee):
 *   - `fun_19E42(state, entityAddr)` — marble-cell-dispatch (replicato in
 *     `marble-cell-dispatch-19e42.ts`).
 *   - `fun_18E6C(state, arg1, arg2)` — slot-insert-sorted (replicato in
 *     `slot-insert-sorted-18e6c.ts`). Argomenti long: arg1 = 0xF, arg2 =
 *     sext_l(entity[0x19]).
 *   - `fun_158AC(state, arg)` — sound/event dispatcher (replicato in
 *     `sound-pair-15884.ts`). Argomento long: ROM[0x24500 + D5*4] (32-bit BE).
 *
 * Tutti i 3 hanno default no-op per matching del binario stubbed con RTS in
 * parity testing.
 *
 * **Caller noto** (1 xref): `FUN_00019BAA` @ 0x019BCE.
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-19a40-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── ROM table addresses ─────────────────────────────────────────────────

/** ROM addr of (X.b, Y.b) pair table — 5 pair, 10 byte. */
export const ROM_PAIR_TABLE = 0x000244f6 as const;
/** ROM addr of entity ptr table — 10 long. */
export const ROM_ENTITY_PTR_TABLE = 0x0001f0ba as const;
/** ROM addr of event-ID table for `fun_158ac` — 5 long. */
export const ROM_EVENT_TABLE = 0x00024500 as const;

// ─── Entity layout ───────────────────────────────────────────────────────

/** Base address (m68k) della tabella entity. */
export const ENTITY_TABLE_BASE = 0x004019f8 as const;
/** Stride (byte) di una entity. */
export const ENTITY_STRIDE = 0x38 as const;
/** Numero di entity nella tabella. */
export const ENTITY_COUNT = 10 as const;

/** Byte: state slot (1 = occupato, != 1 = libero). */
export const ENTITY_OCCUPIED_OFFSET = 0x18 as const;
/** Byte: secondary state. */
export const ENTITY_SUBSTATE_OFFSET = 0x1a as const;
/** Long: position X (fixed-point). */
export const ENTITY_POS_X_OFFSET = 0x0c as const;
/** Long: position Y. */
export const ENTITY_POS_Y_OFFSET = 0x10 as const;
/** Long: position Z (?). */
export const ENTITY_POS_Z_OFFSET = 0x14 as const;
/** Byte: clear in init. */
export const ENTITY_CLEAR24_OFFSET = 0x24 as const;
/** Byte: clear in init. */
export const ENTITY_CLEAR1B_OFFSET = 0x1b as const;
/** Byte: state. */
export const ENTITY_STATE_OFFSET = 0x25 as const;
/** Long: AI script ptr. */
export const ENTITY_AI_OFFSET = 0x1c as const;
/** Long: velocity (?) */
export const ENTITY_VEL_OFFSET = 0x04 as const;
/** Byte: read for fun_18E6C arg2. */
export const ENTITY_KEY19_OFFSET = 0x19 as const;

// ─── Init constants ──────────────────────────────────────────────────────

/** entity[0x14] init value. */
export const INIT_POS_Z = 0x3fd80000 as const;
/** entity[0x1C] init value. */
export const INIT_AI_PTR = 0x000224ca as const;
/** entity[0x04] init value. */
export const INIT_VEL = 0xfffc0000 as const;
/** entity[0x25] init value. */
export const INIT_STATE = 0x08 as const;
/** Bias add a pos X/Y dopo `<< 0x13`. */
export const POS_BIAS = 0x40000 as const;
/** Shift sx applicato a pos X/Y (sext_l(byte) << 0x13). */
export const POS_SHIFT = 0x13 as const;
/** Y-distance threshold: skip se `|dy| < 4`. */
export const PROX_Y_THRESHOLD = 4 as const;

/** D5 wraps at 5 (mid-loop iter count = 5 pairs). */
export const MID_LOOP_COUNT = 5 as const;
/** D4 wraps at 2 (outer-loop iter count = 2 passes). */
export const OUTER_LOOP_COUNT = 2 as const;
/** Arg1 long passed to `fun_18e6c`. */
export const FUN_18E6C_ARG1 = 0x0f as const;

// ─── Sub injections ──────────────────────────────────────────────────────

/**
 * Stub injection per le 3 callee invocate in coda allo spawn-block.
 *
 * Tutte default no-op (matching del binario stubbed con RTS in parity).
 */
export interface StateSub19A40Subs {
  /** `FUN_00019E42(entityAddr)` — marble-cell-dispatch. */
  fun_19e42?: (state: GameState, entityAddr: number) => void;
  /** `FUN_00018E6C(arg1Long, arg2Long)` — slot-insert-sorted. */
  fun_18e6c?: (state: GameState, arg1Long: number, arg2Long: number) => void;
  /** `FUN_000158AC(arg)` — sound/event dispatcher. */
  fun_158ac?: (state: GameState, arg: number) => void;
}

// ─── Result ──────────────────────────────────────────────────────────────

export interface SpawnRecord {
  /** Outer-loop pass index (0 o 1). */
  outerD4: number;
  /** Mid-loop iter index (0..4). */
  midD5: number;
  /** Pair index nella ROM table (uguale a midD5 perchè A1 avanza solo qui). */
  pairIndex: number;
  /** Indirizzo m68k dell'entity spawnata. */
  entityAddr: number;
  /** Index (0..9) dell'entity spawnata nella table. */
  entitySlot: number;
  /** Argomento long passato a `fun_158ac`. */
  eventArg: number;
}

export interface StateSub19A40Result {
  /** Numero totale di spawn eseguiti (max 10, in pratica 0..10). */
  spawnCount: number;
  /** Record dettaglio di ogni spawn. */
  spawns: SpawnRecord[];
  /**
   * True se la funzione è uscita anticipata (tabella entity tutta piena
   * prima di completare le 2×5 iterazioni). False se completate tutte.
   */
  earlyExit: boolean;
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

function writeLongBE(state: GameState, off: number, v: number): void {
  const x = v >>> 0;
  state.workRam[off] = (x >>> 24) & 0xff;
  state.workRam[off + 1] = (x >>> 16) & 0xff;
  state.workRam[off + 2] = (x >>> 8) & 0xff;
  state.workRam[off + 3] = x & 0xff;
}

function romByte(rom: RomImage, addr: number): number {
  return (rom.program[addr] ?? 0) & 0xff;
}

function romLongBE(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>>
    0
  );
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

/** Convert m68k address to workRam offset. */
function addrToOff(addr: number): number {
  return (addr - 0x400000) >>> 0;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00019A40` (362 byte).
 *
 * @param state  GameState (modifica `state.workRam` per le entity spawnate).
 * @param rom    RomImage (lettura tabelle @ 0x244F6, 0x1F0BA, 0x24500).
 * @param subs   sub injections; default no-op per le 3 callee.
 *
 * @returns dettaglio degli spawn eseguiti, conteggio e flag earlyExit.
 *
 * **Side effects**:
 *   - per ogni spawn: scrittura di 10 campi in `entity[0x04..0x25]` (vedi
 *     elenco nell'header del modulo).
 *   - chiamata a `subs.fun_19e42`, `subs.fun_18e6c`, `subs.fun_158ac` (in
 *     quest'ordine, una volta per spawn).
 *
 * **Ordine d'esecuzione** (rilevante per parity):
 *   1. outer D4 = 0..1 (early-exit interrompe l'outer)
 *   2. mid D5 = 0..4: per ogni iter consume pair @ ROM[0x244F6 + D5*2]
 *   3. inner scan: 10 entity, conta match `entity[0x0C..0x0D].w >> 3 == X`
 *      con `entity[0x18] == 1`. Salva l'index del primo match.
 *   4. se `D3 > D4` → skip spawn, vai a D5++.
 *   5. se `D3 == 1`: proximity-check Y; se distanza < 4 → skip.
 *   6. find first free slot; se nessuno → exit IMMEDIATO della funzione.
 *   7. spawn: scrive i campi (vedi header), chiama subs in ordine.
 *   8. dopo spawn: salta D5++ (resta D5 per outer reset, ma `bra` va a D4++).
 *      Quindi UN SOLO spawn per outer iteration.
 */
export function stateSub19A40(
  state: GameState,
  rom: RomImage,
  subs?: StateSub19A40Subs,
): StateSub19A40Result {
  const spawns: SpawnRecord[] = [];
  let earlyExit = false;

  // Outer loop: D4 = 0..1
  outer: for (let d4 = 0; d4 < OUTER_LOOP_COUNT; d4++) {
    // A1 reset al ROM_PAIR_TABLE all'inizio di ogni outer.
    let pairIdx = 0;

    // Mid loop: D5 = 0..4. NB: dopo uno spawn, `bra 0x19b98` SALTA `D5++`,
    // quindi continueremo da subito al D4++. Per questo usiamo `break` qui
    // dopo lo spawn invece di `continue`.
    for (let d5 = 0; d5 < MID_LOOP_COUNT; d5++) {
      // D6 = (A1)+.b ; D7 = (A1)+.b
      const d6Byte = romByte(rom, ROM_PAIR_TABLE + pairIdx * 2);
      const d7Byte = romByte(rom, ROM_PAIR_TABLE + pairIdx * 2 + 1);
      pairIdx++;
      const d6Sext = sextByte(d6Byte); // signed for compare

      // Inner scan: count matches and remember first match index.
      let d3 = 0; // match count
      let firstMatchSlot = 0; // saved at (-1, A6), only when D3 < 2
      for (let d2 = 0; d2 < ENTITY_COUNT; d2++) {
        const entityAddr = ENTITY_TABLE_BASE + d2 * ENTITY_STRIDE;
        const off = addrToOff(entityAddr);
        if (readByte(state, off + ENTITY_OCCUPIED_OFFSET) === 1) {
          // D0 = sext_w(D6.b) → poi cmp.w D1,D0 con D1 = (A2[0xC..0xD]).w >>3 (asr.w)
          const xWord = readWordBE(state, off + ENTITY_POS_X_OFFSET);
          const xSigned = sextWord(xWord);
          // asr.w #3 — arithmetic shift right (signed), retain sign.
          const xShifted = xSigned >> 3; // >> in JS è arithm. su int32
          // cmp.w D1, D0: word-level compare. D0 = sext_w(d6Byte).
          if ((xShifted & 0xffff) === (d6Sext & 0xffff)) {
            d3++;
            if (d3 < 2) {
              firstMatchSlot = d2;
            }
          }
        }
      }

      // if (D3 > D4) skip spawn.
      if (d3 > d4) {
        continue;
      }

      // if (D3 == 1): proximity Y-check via the matched entity.
      if (d3 === 1) {
        // A2 = *(0x1F0BA + firstMatchSlot * 4) — long ROM.
        const entityAddr = romLongBE(
          rom,
          ROM_ENTITY_PTR_TABLE + firstMatchSlot * 4,
        );
        const off = addrToOff(entityAddr);
        // D1 = sext_l(D7); D0 = sext_l((A2[0x10..0x11]).w) >> 3 (asr.l #3)
        const d1Long = sextByte(d7Byte); // A4 was sext_l(D7.b)
        const yWord = readWordBE(state, off + ENTITY_POS_Y_OFFSET);
        const ySigned = sextWord(yWord);
        const yShifted = ySigned >> 3; // signed asr.l
        const diff = d1Long - yShifted;
        // cmp.l D1, D0 with D0 = 4: bgt if 4 > D1 → skip
        if (4 > diff) {
          continue;
        }
      }

      // Find first free slot (entity[0x18] != 1).
      let freeSlot: number = ENTITY_COUNT;
      for (let d2 = 0; d2 < ENTITY_COUNT; d2++) {
        const entityAddr = ENTITY_TABLE_BASE + d2 * ENTITY_STRIDE;
        const off = addrToOff(entityAddr);
        if (readByte(state, off + ENTITY_OCCUPIED_OFFSET) !== 1) {
          freeSlot = d2;
          break;
        }
      }
      if (freeSlot === ENTITY_COUNT) {
        // No slot free → exit function entirely.
        earlyExit = true;
        break outer;
      }

      // Spawn into the free slot.
      const entityAddr = ENTITY_TABLE_BASE + freeSlot * ENTITY_STRIDE;
      const off = addrToOff(entityAddr);

      writeByte(state, off + ENTITY_OCCUPIED_OFFSET, 1);
      writeByte(state, off + ENTITY_SUBSTATE_OFFSET, 1);

      // entity[0x0C] = sext_l(D6.b) << 0x13 + 0x40000
      const xLong = ((d6Sext << POS_SHIFT) + POS_BIAS) >>> 0;
      writeLongBE(state, off + ENTITY_POS_X_OFFSET, xLong);

      // entity[0x10] = sext_l(D7.b) << 0x13 + 0x40000
      const d7Sext = sextByte(d7Byte);
      const yLong = ((d7Sext << POS_SHIFT) + POS_BIAS) >>> 0;
      writeLongBE(state, off + ENTITY_POS_Y_OFFSET, yLong);

      writeLongBE(state, off + ENTITY_POS_Z_OFFSET, INIT_POS_Z);
      writeByte(state, off + ENTITY_CLEAR24_OFFSET, 0);
      writeByte(state, off + ENTITY_CLEAR1B_OFFSET, 0);
      writeByte(state, off + ENTITY_STATE_OFFSET, INIT_STATE);
      writeLongBE(state, off + ENTITY_AI_OFFSET, INIT_AI_PTR);
      writeLongBE(state, off + ENTITY_VEL_OFFSET, INIT_VEL);

      // Sub-call 1: fun_19e42(entityAddr).
      subs?.fun_19e42?.(state, entityAddr);

      // Sub-call 2: fun_18e6c(arg1=0xF, arg2=sext_l(entity[0x19].b)).
      const key19 = readByte(state, off + ENTITY_KEY19_OFFSET);
      const key19Sext = sextByte(key19);
      subs?.fun_18e6c?.(state, FUN_18E6C_ARG1, key19Sext);

      // Sub-call 3: fun_158ac(arg = ROM[0x24500 + d5*4]).
      // m68k: D0 = D5.b sext_w; asl.w #2,D0w; A0 = *(0x24500 + D0.w).
      // D5.w * 4: per d5 in [0,5) is in [0,16), nessun overflow word.
      const eventArg = romLongBE(rom, ROM_EVENT_TABLE + d5 * 4);
      subs?.fun_158ac?.(state, eventArg);

      spawns.push({
        outerD4: d4,
        midD5: d5,
        pairIndex: pairIdx - 1,
        entityAddr,
        entitySlot: freeSlot,
        eventArg,
      });

      // After spawn: `bra 0x19b98` SALTA `D5++`. Quindi esci dal mid-loop
      // direttamente al D4++.
      break;
    }
  }

  return {
    spawnCount: spawns.length,
    spawns,
    earlyExit,
  };
}
