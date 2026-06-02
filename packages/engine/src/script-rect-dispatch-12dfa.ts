/**
 * script-rect-dispatch-12dfa.ts - replica `FUN_00012DFA`.
 *
 * Called from the scroll/range loop (`FUN_000144E4` @ 0x14572). The caller
 * passes two long arguments, but this routine uses only their low bytes:
 *   - `arg2.b` (D3.b) = correlated coordinate / "y" threshold (signed byte)
 *
 *
 * **Step A - rect-list spawn**:
 *   The selector chooses a ROM list of 6-byte records:
 *     `[0]=lo.b`, `[1]=hi.b`, `[2..5]=long` (script ptr or 0 = pick random group).
 *   For each rect:
 *     2. Test D2/D3:
 *          - D3 must equal record[0] OR record[1] (signed byte). Else skip.
 *          - If D2 is in [record[0], record[1]] (signed, inclusive), skip.
 *     3. If record[2..5] == 0:
 *        - `D0 = rng(4)` via `FUN_13A98(4)` gives group in [0,3].
 *        - `A0 = 0x1DED8 + group*16` points to four long script pointers.
 *        - For i = 0..3: allocate via `findFirstFreeSlot_1F016`; if -1, exit.
 *          Bind via `FUN_12F44(slot, mode=0, scriptPtr=*A0)` (= mode-0 inlined).
 *          A0++ (advance long).
 *        scriptPtr = record[2..5] long.
 *     5. A2 += 6 (next record).
 *
 * **Step B - region-bound despawn**:
 *   Scans the 25 slots at `0x400A9C` (stride 0x56). Each occupied slot despawns
 *   when:
 *       (D2 == slot[0x52] AND D3 < slot[0x52]) OR
 *       (D2 == slot[0x54] AND D3 > slot[0x54])
 *     where `slot[0x52]/0x54` are signed words.
 *   Despawn calls `FUN_12F44(slot, mode=1, 0)` with the free-slot path inlined.
 *
 * **Disassembly 0x12DFA..0x12F44**: see `/tmp/marble-cand/012DFA.txt`.
 *
 * **`FUN_12F44` mode-1 path** (free-slot, inlined nel post-loop):
 *   - Se A0 (slot ptr) == `*0x400974`.l:
 *       `*0x400978`.l = 0; `*0x400974`.l = 0
 *   - `slot+0x18`.b = 0
 *   - `slot+0x1A`.b = 0
 *   - Se `slot+0x1F`.b == 6: `*0x40075C`.b -= 1
 *   - Se `slot+0x1E`.b == 1: return (no FUN_18F46)
 *
 * **Parity strategy**:
 *   - `FUN_12DAE`, `FUN_12D6E`, and `FUN_13A98` stay live (read-only or RNG).
 *   - `FUN_18F46` has side effects on `0x4003BC` and ROM table @ `0x1F0E2`.
 *
 * **Side effects (TS)** on work RAM:
 *   - Spawn: slot+0x18 = 1, slot+0x1A = 3, slot+0x3A.l = scriptPtr,
 *     slot+0x52.w / slot+0x54.w = sext(record[0..1]).
 *   - Despawn: slot+0x18 = 0, slot+0x1A = 0; optional clear of
 *     `*0x400974`/`*0x400978` when A0 matches, decrement of `*0x40075C` when
 *
 *   The final D0 comes from the last internal branch, typically `tst.l (0x2,A2)`.
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

const WORK_RAM_BASE = 0x400000 as const;

/** Selector word @ `0x400394`, indexes the table @ `0x1DEC0` (`<<2`). */
const SELECTOR_ADDR = 0x400394 as const;

const RECT_LIST_TABLE_ROM = 0x1dec0 as const;

const SCRIPT_GROUP_TABLE_ROM = 0x1ded8 as const;

/** Stride of one group (4 longs = 16 bytes). */
const SCRIPT_GROUP_STRIDE = 16 as const;

const SLOT_PTR_TABLE_ROM = 0x1f016 as const;

const SLOT_TABLE_RAM = 0x400a9c as const;
const SLOT_STRIDE = 0x56 as const;
const SLOT_COUNT = 0x19 as const; // 25

/** End-of-rect-list sentinel (`cmpi.b #-1,(A2)`). */
const RECT_END_BYTE = 0xff as const;

/** Stride of one rect record (2 bytes + 1 long). */
const RECT_STRIDE = 6 as const;

/** Mark "occupied" for the post-loop (`tst.b (0x18,A2); beq skip`). */
// (any non-zero treated as occupied; despawn read uses != 0 check)

const SLOT_OCCUPIED_OFF = 0x18; // byte
const SLOT_STATE_OFF = 0x1a; // byte
const SLOT_TYPE1F_OFF = 0x1f; // byte (== 0xC alt-match-key, == 6 dec counter)
const SLOT_SCRIPT_LONG_OFF = 0x3a; // long (script ptr)
const SLOT_RECT_LO_OFF = 0x52; // word (sext byte da rect[0])
const SLOT_RECT_HI_OFF = 0x54; // word (sext byte da rect[1])

const GLOBAL_LONG_400974 = 0x400974 as const;
const GLOBAL_LONG_400978 = 0x400978 as const;
const GLOBAL_BYTE_40075C = 0x40075c as const;

/** RNG limit for random group selection in the zero-path (`pea (4).w`). */
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

/** Sign-extend byte to signed integer (-128..127). */
function sextByte(v: number): number {
  const b = v & 0xff;
  return b < 0x80 ? b : b - 0x100;
}

/** Sign-extend word to signed integer (-32768..32767). */
function sextWord(v: number): number {
  const w = v & 0xffff;
  return w < 0x8000 ? w : w - 0x10000;
}

/**
 * `FUN_13A98` (`cmp.w D0,D1; bgt exit; sub D1,D0`). `rngNext` produces
 */
function rng4(state: GameState): number {
  let r = rngNext(state.rng, as_u16(RNG_GROUP_LIMIT)) as unknown as number;
  while (r >= RNG_GROUP_LIMIT) r -= RNG_GROUP_LIMIT;
  return r & 0xffff;
}

/**
 * Scans the 25 slots at 0x400A9C looking for a key match or type=0xC.
 *
 * Read-only on work RAM. Same logic as
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
 * Inlined to avoid an import dependency. Same behavior as `findFirstFreeSlot_1F016`
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
 *
 * @param scriptPtr Long written to slot+0x3A (big-endian).
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
 */
function slotFreeMode1(state: GameState, slotPtr: number): void {
  const slotOff = (slotPtr - WORK_RAM_BASE) >>> 0;

  const active = readU32Ram(state, GLOBAL_LONG_400974 - WORK_RAM_BASE);
  if ((slotPtr >>> 0) === active) {
    writeU32Ram(state, GLOBAL_LONG_400978 - WORK_RAM_BASE, 0);
    writeU32Ram(state, GLOBAL_LONG_400974 - WORK_RAM_BASE, 0);
  }

  state.workRam[slotOff + SLOT_OCCUPIED_OFF] = 0;
  state.workRam[slotOff + SLOT_STATE_OFF] = 0;

  // cmpi.b #6, slot+0x1F -> if 6, decrement byte @ 0x40075C
  if ((state.workRam[slotOff + SLOT_TYPE1F_OFF] ?? 0) === 0x06) {
    const off75c = GLOBAL_BYTE_40075C - WORK_RAM_BASE;
    state.workRam[off75c] = ((state.workRam[off75c] ?? 0) - 1) & 0xff;
  }

  // FUN_18F46(slot+0x1F sext, slot+0x19 sext) — qui no-op (stub-RTS).
}

/**
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
  while (true) {
    const rect0 = readByteRom(rom, a2);
    if (rect0 === RECT_END_BYTE) return; // exit to post-loop (0x12EE6)

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

    // Test on D2: if D2 is in [rect[0], rect[1]] (signed) -> skip.
    // Disasm: blt → fall-through to "do spawn"; ble → skip. Net:
    //   spawn if D2 < rect[0] OR D2 > rect[1].
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
          // Branch to 0x12EE6 -> immediate exit from Step A.
          return;
        }
        const slotOff = (slotPtr - WORK_RAM_BASE) >>> 0;
        // sext byte -> signed word, written as a big-endian word.
        writeU16Ram(state, slotOff + SLOT_RECT_LO_OFF, rect0s & 0xffff);
        writeU16Ram(state, slotOff + SLOT_RECT_HI_OFF, rect1s & 0xffff);

        const scriptPtr = readU32Rom(rom, groupBase + k * 4);
        slotBindMode0(state, slotPtr, scriptPtr);
      }
    } else {
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
 *               and the rect-list records).
 *
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
