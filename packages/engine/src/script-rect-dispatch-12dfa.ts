/**
 * script-rect-dispatch-12dfa.ts — replica `FUN_00012DFA` (330 byte) bit-perfect.
 *
 * Funzione "rect-list spawn + region-bound despawn" chiamata dal main update
 * loop (`FUN_000144E4` @ 0x14572). Riceve due long arg dal caller, ma usa
 * solo i due *low byte*:
 *   - `arg1.b` (D2.b) = la coordinata corrente / soglia "x"
 *   - `arg2.b` (D3.b) = la coordinata correlata / soglia "y" (signed byte)
 *
 * Esegue **due passi** sulle stesse due tabelle in ROM/RAM:
 *
 * **Passo A — rect-list spawn**:
 *   Risolve il puntatore alla rect-list dalla ROM-table @ `0x1DEC0`, indicizzata
 *   da `(*0x400394).w` (selettore u16) shiftato `<<2`. La lista è una sequenza
 *   di record da 6 byte:
 *     `[0]=lo.b`, `[1]=hi.b`, `[2..5]=long` (script ptr o 0 = pick random group).
 *   Termina quando `*A2 == 0xFF` (sentinel).
 *   Per ogni rect:
 *     1. `slotMatch12DAE(rect)` — se ritorna 1, skip (slot già attivo).
 *     2. Test su D2/D3:
 *          - D3 deve essere == record[0] OR record[1] (signed byte). Else skip.
 *          - Se D2 ∈ [record[0], record[1]] (signed, both inclusive) → skip.
 *     3. Se record[2..5] == 0:
 *        - `D0 = rng(4)` via `FUN_13A98(4)` → group ∈ [0,3].
 *        - `A0 = 0x1DED8 + group*16` → 4 longs (script-ptr group).
 *        - Per i = 0..3: alloca slot via `findFirstFreeSlot_1F016`. Se -1, EXIT.
 *          Scrive slot+0x52 = sext(record[0]).w, slot+0x54 = sext(record[1]).w.
 *          Bind via `FUN_12F44(slot, mode=0, scriptPtr=*A0)` (= mode-0 inlined).
 *          A0++ (advance long).
 *     4. Else (record[2..5] != 0): alloca 1 slot, scrive 0x52/0x54, bind con
 *        scriptPtr = record[2..5] long.
 *     5. A2 += 6 (next record).
 *
 * **Passo B — region-bound despawn**:
 *   Scansiona i 25 slot @ `0x400A9C` (stride 0x56). Per ogni slot occupato
 *   (`slot+0x18 != 0`) testa una condizione "fuori range":
 *     despawn se:
 *       (D2 == slot[0x52] AND D3 < slot[0x52]) OR
 *       (D2 == slot[0x54] AND D3 > slot[0x54])
 *     dove `slot[0x52]/0x54` sono word signed.
 *   Se despawn → `FUN_12F44(slot, mode=1, 0)` (free-slot inlined, neutralizza
 *   FUN_18F46 — vedi note).
 *
 * **Disasm 0x12DFA..0x12F44** vedi `/tmp/marble-cand/012DFA.txt`.
 *
 * **`FUN_12F44` mode-1 path** (free-slot, inlined nel post-loop):
 *   - Se A0 (slot ptr) == `*0x400974`.l:
 *       `*0x400978`.l = 0; `*0x400974`.l = 0
 *   - `slot+0x18`.b = 0
 *   - `slot+0x1A`.b = 0
 *   - Se `slot+0x1F`.b == 6: `*0x40075C`.b -= 1
 *   - Se `slot+0x1E`.b == 1: return (no FUN_18F46)
 *   - Else: chiama `FUN_18F46(slot+0x1F sext.l, slot+0x19 sext.l)`.
 *
 * **Strategia parity**:
 *   - `FUN_12DAE`, `FUN_12D6E`, `FUN_13A98` lasciate live (read-only o RNG
 *     piccolo già replicato in `rng.ts` / `slot-search.ts` / `slot-match-12dae.ts`).
 *   - `FUN_18F46` (137 byte, side-effect su `0x4003BC` + ROM table @ `0x1F0E2`)
 *     **stubbata con RTS** (0x4E75) lato binario; lato TS la chiamata viene
 *     emulata come no-op. Caller-side responsabilità di tenere stub coerente.
 *
 * **Side effects (TS)** sulla work RAM:
 *   - Spawn: slot+0x18 = 1, slot+0x1A = 3, slot+0x3A.l = scriptPtr,
 *     slot+0x52.w / slot+0x54.w = sext(record[0..1]).
 *   - Despawn: slot+0x18 = 0, slot+0x1A = 0; opzionali clear di
 *     `*0x400974`/`*0x400978` se A0 match, decrement di `*0x40075C` se
 *     `slot+0x1F == 6`. NESSUNA chiamata a FUN_18F46.
 *
 * **Ritorno (D0)**: `movem.l (SP)+,{D2 D3 D4 A2 A3}; rts` — D0 NON viene
 *   esplicitamente caricato dal codice mainline; il valore al ritorno è
 *   l'ultimo D0 prodotto (tipicamente da un branch interno: `tst.l (0x2,A2)`
 *   o `cmpi.b #-0x1,(A2)`). NON è un valore osservabile contractuale, quindi
 *   il TS ritorna `void` e il parity test NON confronta D0.
 *
 * **Caller**: `FUN_000144E4` @ 0x14572 (chiamata incondizionata).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

const WORK_RAM_BASE = 0x400000 as const;

/** Selector word @ `0x400394`, indicizza la table @ `0x1DEC0` (`<<2`). */
const SELECTOR_ADDR = 0x400394 as const;

/** Tabella ROM dei puntatori a rect-list, indicizzata da selector*4. */
const RECT_LIST_TABLE_ROM = 0x1dec0 as const;

/** Tabella ROM dei "gruppi di 4 script-ptr" usati nel zero-path. */
const SCRIPT_GROUP_TABLE_ROM = 0x1ded8 as const;

/** Stride di un gruppo (4 longs = 16 byte). */
const SCRIPT_GROUP_STRIDE = 16 as const;

/** Tabella ROM dei puntatori-slot (`FUN_12D6E` legge da qui, 25 entries). */
const SLOT_PTR_TABLE_ROM = 0x1f016 as const;

/** Tabella slot in work RAM (post-loop). */
const SLOT_TABLE_RAM = 0x400a9c as const;
const SLOT_STRIDE = 0x56 as const;
const SLOT_COUNT = 0x19 as const; // 25

/** Sentinel di fine rect-list (`cmpi.b #-1,(A2)`). */
const RECT_END_BYTE = 0xff as const;

/** Stride di un rect record (2 byte + 1 long). */
const RECT_STRIDE = 6 as const;

/** Mark "occupato" per il post-loop (`tst.b (0x18,A2); beq skip`). */
// (any non-zero treated as occupied; despawn read uses != 0 check)

/** Offsets nello slot (mode-0 / mode-1 di FUN_12F44 + Passo A scrive 0x52/54). */
const SLOT_OCCUPIED_OFF = 0x18; // byte
const SLOT_STATE_OFF = 0x1a; // byte
// const SLOT_KIND1E_OFF = 0x1e; // byte (gate per FUN_18F46): non usato in TS
//                                       perché FUN_18F46 è no-op (stub-RTS).
const SLOT_TYPE1F_OFF = 0x1f; // byte (== 0xC alt-match-key, == 6 dec counter)
const SLOT_SCRIPT_LONG_OFF = 0x3a; // long (script ptr)
const SLOT_RECT_LO_OFF = 0x52; // word (sext byte da rect[0])
const SLOT_RECT_HI_OFF = 0x54; // word (sext byte da rect[1])

/** Globali toccati dal mode-1 (free-slot). */
const GLOBAL_LONG_400974 = 0x400974 as const;
const GLOBAL_LONG_400978 = 0x400978 as const;
const GLOBAL_BYTE_40075C = 0x40075c as const;

/** RNG limit per la pesca random del gruppo nel zero-path (`pea (4).w`). */
const RNG_GROUP_LIMIT = 4 as const;

// ─── Helpers ────────────────────────────────────────────────────────────

function readU16Ram(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff
  );
}

function readU32Ram(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function writeU16Ram(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function writeU32Ram(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

function readU32Rom(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>>
    0
  );
}

function readByteRom(rom: RomImage, addr: number): number {
  return (rom.program[addr] ?? 0) & 0xff;
}

/** sign-extend byte → signed integer (-128..127). */
function sextByte(v: number): number {
  const b = v & 0xff;
  return b < 0x80 ? b : b - 0x100;
}

/** sign-extend word → signed integer (-32768..32767). */
function sextWord(v: number): number {
  const w = v & 0xffff;
  return w < 0x8000 ? w : w - 0x10000;
}

/**
 * `rng(4)` con la stessa normalizzazione "while r >= limit" usata da
 * `FUN_13A98` (`cmp.w D0,D1; bgt exit; sub D1,D0`). `rngNext` produce
 * `r ∈ [0, limit]`; clamping a `[0, limit)` matcha il binario.
 */
function rng4(state: GameState): number {
  let r = rngNext(state.rng, as_u16(RNG_GROUP_LIMIT)) as unknown as number;
  while (r >= RNG_GROUP_LIMIT) r -= RNG_GROUP_LIMIT;
  return r & 0xffff;
}

/**
 * Replica `FUN_12DAE` inline per il caso "argPtr in ROM" (la rect-list che
 * stiamo iterando). Il binario fa `move.l A2,-(SP); jsr 0x12DAE` con A2 che
 * punta dentro la rect-list ROM; `FUN_12DAE` legge `*(arg+2)` (long) e poi
 * scansiona i 25 slot @ 0x400A9C cercando match per chiave o type=0xC.
 *
 * Read-only sulla work RAM. Identica logica a
 * `slotMatchesPtr_400A9C` / `slotMatch12DAE` ma con `target` letto da ROM.
 */
function slotMatchKeyOrType0C_rom(
  state: GameState,
  rom: RomImage,
  argPtr: number,
): boolean {
  const target = readU32Rom(rom, argPtr + 2);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = SLOT_TABLE_RAM + i * SLOT_STRIDE - WORK_RAM_BASE;
    if ((state.workRam[slotOff + SLOT_OCCUPIED_OFF] ?? 0) !== 1) continue;
    if (readU32Ram(state, slotOff + SLOT_SCRIPT_LONG_OFF) === target) return true;
    if (target !== 0) continue;
    if ((state.workRam[slotOff + SLOT_TYPE1F_OFF] ?? 0) === 0x0c) return true;
  }
  return false;
}

/**
 * `FUN_12D6E` — primo slot libero nella tabella ROM @ 0x1F016 (25 entries).
 * Inlined per evitare dipendenza di import. Identico a `findFirstFreeSlot_1F016`
 * in `slot-search.ts`.
 */
function findFirstFreeSlot1F016(
  state: GameState,
  rom: RomImage,
): number {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const ptr = readU32Rom(rom, SLOT_PTR_TABLE_ROM + i * 4);
    const ptrOff = (ptr - WORK_RAM_BASE) >>> 0;
    if ((state.workRam[ptrOff + SLOT_OCCUPIED_OFF] ?? 0) === 0) return ptr;
  }
  return 0xffffffff >>> 0;
}

/**
 * `FUN_12F44` mode-0 (bind) inlined. Scrive 3 campi nello slot.
 *
 * @param slotPtr   Indirizzo m68k assoluto del slot (in work RAM).
 * @param scriptPtr Long da scrivere in slot+0x3A (big-endian).
 */
function slotBindMode0(
  state: GameState,
  slotPtr: number,
  scriptPtr: number,
): void {
  const slotOff = (slotPtr - WORK_RAM_BASE) >>> 0;
  writeU32Ram(state, slotOff + SLOT_SCRIPT_LONG_OFF, scriptPtr >>> 0);
  state.workRam[slotOff + SLOT_STATE_OFF] = 0x03;
  state.workRam[slotOff + SLOT_OCCUPIED_OFF] = 0x01;
}

/**
 * `FUN_12F44` mode-1 (free-slot) inlined. Scrive slot+0x18=0, slot+0x1A=0,
 * tocca i globali condizionali e (se `slot+0x1E != 1`) **chiamerebbe**
 * `FUN_18F46` — qui no-op (FUN_18F46 stub-RTS lato binario per parity).
 */
function slotFreeMode1(state: GameState, slotPtr: number): void {
  const slotOff = (slotPtr - WORK_RAM_BASE) >>> 0;

  // cmpa.l (0x400974).l, A0 → se uguale, azzera 974/978
  const active = readU32Ram(state, GLOBAL_LONG_400974 - WORK_RAM_BASE);
  if ((slotPtr >>> 0) === active) {
    writeU32Ram(state, GLOBAL_LONG_400978 - WORK_RAM_BASE, 0);
    writeU32Ram(state, GLOBAL_LONG_400974 - WORK_RAM_BASE, 0);
  }

  state.workRam[slotOff + SLOT_OCCUPIED_OFF] = 0;
  state.workRam[slotOff + SLOT_STATE_OFF] = 0;

  // cmpi.b #6, slot+0x1F → se 6, decrementa byte @ 0x40075C
  if ((state.workRam[slotOff + SLOT_TYPE1F_OFF] ?? 0) === 0x06) {
    const off75c = GLOBAL_BYTE_40075C - WORK_RAM_BASE;
    state.workRam[off75c] = ((state.workRam[off75c] ?? 0) - 1) & 0xff;
  }

  // cmpi.b #1, slot+0x1E → se 1, return (no FUN_18F46). Altrimenti
  // FUN_18F46(slot+0x1F sext, slot+0x19 sext) — qui no-op (stub-RTS).
  // Nessuna scrittura ulteriore in TS.
  // (Il binario, anche con stub-RTS, ritorna senza side effect.)
}

/**
 * Passo A: rect-list spawn loop. Ritorna `true` se il loop è stato interrotto
 * da "no slot free" (early-exit a 0x12EE6, salta direttamente al post-loop).
 */
function rectListSpawnLoop(
  state: GameState,
  rom: RomImage,
  d2Sext: number,
  d3Sext: number,
  rectListPtr: number,
): void {
  let a2 = rectListPtr >>> 0;

  // Loop @ 0x12E18.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rect0 = readByteRom(rom, a2);
    if (rect0 === RECT_END_BYTE) return; // exit to post-loop (0x12EE6)

    // jsr FUN_12DAE(a2): se ritorna 1, skip questo rect.
    // Nota: a2 è ROM ptr → leggiamo *(a2+2) da ROM.
    if (slotMatchKeyOrType0C_rom(state, rom, a2)) {
      a2 = (a2 + RECT_STRIDE) >>> 0;
      continue;
    }

    const rect1 = readByteRom(rom, a2 + 1);
    const rect0s = sextByte(rect0);
    const rect1s = sextByte(rect1);
    const rectLong = readU32Rom(rom, a2 + 2);

    // Test su D3: D3 == rect[0] (signed byte) OR D3 == rect[1].
    if (d3Sext !== rect0s && d3Sext !== rect1s) {
      a2 = (a2 + RECT_STRIDE) >>> 0;
      continue;
    }

    // Test su D2: se D2 ∈ [rect[0], rect[1]] (signed) → skip.
    // Disasm: blt → fall-through to "do spawn"; ble → skip. Net:
    //   spawn se D2 < rect[0] OR D2 > rect[1].
    if (!(d2Sext < rect0s || d2Sext > rect1s)) {
      a2 = (a2 + RECT_STRIDE) >>> 0;
      continue;
    }

    if (rectLong === 0) {
      // Zero-path: pesca random group, spawn 4 marble.
      const group = rng4(state);
      const groupBase = SCRIPT_GROUP_TABLE_ROM + group * SCRIPT_GROUP_STRIDE;

      for (let k = 0; k < 4; k++) {
        const slotPtr = findFirstFreeSlot1F016(state, rom);
        if (slotPtr === 0xffffffff >>> 0) {
          // Bra a 0x12EE6 → exit immediato dal Passo A.
          return;
        }
        const slotOff = (slotPtr - WORK_RAM_BASE) >>> 0;
        // sext byte → signed word, scritto come word in big-endian.
        writeU16Ram(state, slotOff + SLOT_RECT_LO_OFF, rect0s & 0xffff);
        writeU16Ram(state, slotOff + SLOT_RECT_HI_OFF, rect1s & 0xffff);

        const scriptPtr = readU32Rom(rom, groupBase + k * 4);
        slotBindMode0(state, slotPtr, scriptPtr);
      }
    } else {
      // Non-zero path: alloca 1 slot, scrive 0x52/0x54, bind con rectLong.
      const slotPtr = findFirstFreeSlot1F016(state, rom);
      if (slotPtr === 0xffffffff >>> 0) return; // bra 0x12EE6

      const slotOff = (slotPtr - WORK_RAM_BASE) >>> 0;
      writeU16Ram(state, slotOff + SLOT_RECT_LO_OFF, rect0s & 0xffff);
      writeU16Ram(state, slotOff + SLOT_RECT_HI_OFF, rect1s & 0xffff);

      slotBindMode0(state, slotPtr, rectLong);
    }

    a2 = (a2 + RECT_STRIDE) >>> 0;
  }
}

/**
 * Passo B: scansione 25 slot @ 0x400A9C, despawn slot occupati fuori range.
 */
function regionDespawnLoop(
  state: GameState,
  d2Sext: number,
  d3Sext: number,
): void {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotPtr = (SLOT_TABLE_RAM + i * SLOT_STRIDE) >>> 0;
    const slotOff = slotPtr - WORK_RAM_BASE;

    // tst.b (0x18,A2); beq skip. Skip-cond: byte == 0.
    if ((state.workRam[slotOff + SLOT_OCCUPIED_OFF] ?? 0) === 0) continue;

    const lo = sextWord(readU16Ram(state, slotOff + SLOT_RECT_LO_OFF));
    const hi = sextWord(readU16Ram(state, slotOff + SLOT_RECT_HI_OFF));

    // Despawn cond:
    //   (D2 == lo && D3 < lo) || (D2 == hi && D3 > hi)
    let despawn = false;
    if (d2Sext === lo) {
      if (d3Sext < lo) {
        despawn = true;
      } else if (d2Sext === hi && d3Sext > hi) {
        // Caso degenere lo == hi.
        despawn = true;
      }
    } else if (d2Sext === hi && d3Sext > hi) {
      despawn = true;
    }

    if (despawn) slotFreeMode1(state, slotPtr);
  }
}

/**
 * Replica `FUN_00012DFA` — rect-list spawn + region-bound despawn.
 *
 * @param state  GameState (legge `*0x400394`, `*0x400974`, `*0x40075C`,
 *               work RAM slot table; scrive `state.rng.seed` via `rngNext`,
 *               i campi degli slot e i globali sopra).
 * @param rom    ROM image (legge tabelle @ `0x1DEC0`, `0x1DED8`, `0x1F016`,
 *               e i record della rect-list).
 * @param arg1   Long arg1; usato solo low byte (`SP+0x1B`) → D2.b sign-ext.
 * @param arg2   Long arg2; usato solo low byte (`SP+0x1F`) → D3.b sign-ext.
 *
 * Il binario non ritorna un valore osservabile in D0 (epilogo `movem` non
 * tocca D0; il valore al ritorno dipende dall'ultima operazione). Quindi TS
 * ritorna `void`.
 */
export function scriptRectDispatch12DFA(
  state: GameState,
  rom: RomImage,
  arg1: number,
  arg2: number,
): void {
  // D2.b / D3.b sono i byte BASSI (offset +3 nel long) dell'arg sul stack.
  const d2 = sextByte(arg1 & 0xff);
  const d3 = sextByte(arg2 & 0xff);

  // Risoluzione rect-list dal selector @ 0x400394.
  const selectorWord = readU16Ram(state, SELECTOR_ADDR - WORK_RAM_BASE);
  // asl.w #2: shift modulo 0x10000.
  const d0wAfterAsl = (selectorWord << 2) & 0xffff;
  // adda.w D0w,A0 sign-extends D0.w.
  const d0Sext = sextWord(d0wAfterAsl);
  const tableAddr = (RECT_LIST_TABLE_ROM + d0Sext) >>> 0;
  const rectListPtr = readU32Rom(rom, tableAddr);

  rectListSpawnLoop(state, rom, d2, d3, rectListPtr);
  regionDespawnLoop(state, d2, d3);
}
