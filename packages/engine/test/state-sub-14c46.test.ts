/**
 * state-sub-14c46.test.ts — smoke tests per `FUN_00014C46`.
 *
 * Verifica:
 *  1. Empty entry list (sentinel 0xFF) → early exit, nessuna init/teardown.
 *  2. Init slot quando `D3 == entry[0]` AND `D2 < entry[0]`.
 *  3. Tail walk teardown quando `D2 == slot[0x52]` AND `D3 < slot[0x52]`.
 *  4. Tail walk no-op se slot[0x18] == 0 (slot libero).
 *  5. Match-skip: `slotMatchesPtr` ritorna 1 → entry skippato senza init.
 *  6. Sub-injection invocate corret-volte (fun_1cc62/150d0/18e6c/18f46).
 */

import { describe, it, expect } from "vitest";
import { stateSub14C46 } from "../src/state-sub-14c46.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;
const SLOT0_PTR = 0x401302;
const SLOT0_OFF = SLOT0_PTR - WORK_RAM_BASE;

/** Helper: scrivi un byte. */
function setByte(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = v & 0xff;
}

/** Helper: scrivi una word BE. */
function setWordBE(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

/** Helper: scrivi un long BE. */
function setLongBE(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  const u = v >>> 0;
  s.workRam[off] = (u >>> 24) & 0xff;
  s.workRam[off + 1] = (u >>> 16) & 0xff;
  s.workRam[off + 2] = (u >>> 8) & 0xff;
  s.workRam[off + 3] = u & 0xff;
}

/** Helper: legge byte. */
function readByte(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (s.workRam[off] ?? 0) & 0xff;
}

/** Helper: legge long BE. */
function readLongBE(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    ((s.workRam[off] ?? 0) << 24) |
    ((s.workRam[off + 1] ?? 0) << 16) |
    ((s.workRam[off + 2] ?? 0) << 8) |
    (s.workRam[off + 3] ?? 0)
  ) >>> 0;
}

/** Helper: legge word BE (signed). */
function readWordBESigned(
  s: ReturnType<typeof emptyGameState>,
  off: number,
): number {
  const u =
    (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
  return u & 0x8000 ? u - 0x10000 : u;
}

/**
 * Costruisce una RomImage di test con:
 *   - sentinel 0xFF a `0x2257A` (entry list slot 0 = vuota di default)
 *   - opzionale: scrivi tabella ROM[0x2257A + mode*4] e l'entry list.
 */
function makeRom(): RomImage {
  return emptyRomImage();
}

/** Patch ROM long BE. */
function setRomLongBE(rom: RomImage, off: number, v: number): void {
  const u = v >>> 0;
  rom.program[off] = (u >>> 24) & 0xff;
  rom.program[off + 1] = (u >>> 16) & 0xff;
  rom.program[off + 2] = (u >>> 8) & 0xff;
  rom.program[off + 3] = u & 0xff;
}

/** Patch ROM byte. */
function setRomByte(rom: RomImage, off: number, v: number): void {
  rom.program[off] = v & 0xff;
}

describe("stateSub14C46 (FUN_00014C46)", () => {
  it("empty entry list (sentinel 0xFF a entryListPtr) → early exit, no init", () => {
    const s = emptyGameState();
    const rom = makeRom();
    // mode = 0 (default). ROM[0x2257A] = pointer to ROM[0x10000].
    // ROM[0x10000] = 0xFF (sentinel).
    setRomLongBE(rom, 0x2257a, 0x00010000);
    setRomByte(rom, 0x10000, 0xff);

    const r = stateSub14C46(s, rom, 0, 0);
    expect(r.emptyEntryList).toBe(true);
    expect(r.entries).toHaveLength(0);
    expect(r.fun1CC62Calls).toBe(0);
    expect(r.fun150D0Calls).toBe(0);
    expect(r.fun18E6CCalls).toBe(0);
    expect(r.fun18F46Calls).toBe(0);
    // Tail walk fa 4 noop (tutti slot[0x18] == 0 di default).
    expect(r.slots).toHaveLength(4);
    expect(r.slots.every(sl => sl.action === "noop")).toBe(true);
  });

  it("init slot quando D3 == entry[0] AND D2 < entry[0] (gate boundary lower)", () => {
    const s = emptyGameState();
    const rom = makeRom();
    // Setup: mode = 0. ROM[0x2257A] → ROM[0x10000] = entry list.
    // entry: [10, 20, dataPtr_b3, dataPtr_b2, dataPtr_b1, dataPtr_b0, 0x33, 0x00], poi sentinel.
    // dataPtr punta a ROM[0x10100] dove byte 0 = 5, byte 1 = -3.
    setRomLongBE(rom, 0x2257a, 0x00010000);
    // entry[0]=10, entry[1]=20
    setRomByte(rom, 0x10000, 10);
    setRomByte(rom, 0x10001, 20);
    // entry[2..5] = 0x00010100 (data ptr)
    setRomLongBE(rom, 0x10002, 0x00010100);
    // entry[6] = 0x33
    setRomByte(rom, 0x10006, 0x33);
    // entry[7] = padding
    setRomByte(rom, 0x10007, 0x00);
    // sentinel
    setRomByte(rom, 0x10008, 0xff);
    // data ptr bytes
    setRomByte(rom, 0x10100, 5);
    setRomByte(rom, 0x10101, 0xfd); // = -3 signed

    // Importante: tutti gli slot @ 0x401302 stride 0x60 hanno byte+0x18 = 0
    // (free), così FUN_14BCE ritorna l'ultimo slot iterato (= slot 3).
    // FUN_14BCE legge ROM[0x1F006 + i*4] (4 entries) → questi devono puntare
    // a slot validi (0x401302, 0x401362, 0x4013C2, 0x401422).
    setRomLongBE(rom, 0x1f006, 0x00401302);
    setRomLongBE(rom, 0x1f006 + 4, 0x00401362);
    setRomLongBE(rom, 0x1f006 + 8, 0x004013c2);
    setRomLongBE(rom, 0x1f006 + 12, 0x00401422);

    let cc62Calls = 0;
    let d150Calls = 0;
    let e6cCalls = 0;

    // D2 = 5 (< 10 = entry[0]), D3 = 10 (== entry[0]) → gate passato.
    const r = stateSub14C46(s, rom, 5, 10, {
      fun_1cc62: () => {
        cc62Calls++;
        return 0xdeadbeef;
      },
      fun_150d0: () => {
        d150Calls++;
      },
      fun_18e6c: () => {
        e6cCalls++;
      },
    });

    expect(r.emptyEntryList).toBe(false);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.gated).toBe(true);
    expect(r.entries[0]!.initialized).toBe(true);
    expect(r.entries[0]!.matched).toBe(false);
    expect(cc62Calls).toBe(1);
    expect(d150Calls).toBe(1);
    expect(e6cCalls).toBe(1);

    // Slot scritto = ultimo iterato (slot 3 = 0x401422). FUN_14BCE itera 4
    // entries e salva l'ULTIMO che ha byte+0x18 == 0, quindi slot 3.
    const slotPtr = r.entries[0]!.initSlotPtr!;
    expect(slotPtr).toBe(0x00401422);
    const slotOff = slotPtr - WORK_RAM_BASE;

    // Verifica scritture:
    expect(readLongBE(s, slotOff + 0x4a)).toBe(0x00010100);
    expect(readLongBE(s, slotOff + 0x4e)).toBe(0x00010100);
    expect(readByte(s, slotOff + 0x1b)).toBe(0x33);
    expect(readWordBESigned(s, slotOff + 0x52)).toBe(10);
    expect(readWordBESigned(s, slotOff + 0x54)).toBe(20);
    // slot[0x0C..0x0F] = (5 << 19) + 0x40000 = 0x280000 + 0x40000 = 0x2C0000
    expect(readLongBE(s, slotOff + 0x0c)).toBe(((5 << 19) + 0x40000) >>> 0);
    // slot[0x10..0x13] = (-3 << 19) + 0x40000 (signed asl)
    const expectedLong1 = ((((-3) << 19) | 0) + 0x40000) >>> 0;
    expect(readLongBE(s, slotOff + 0x10)).toBe(expectedLong1);
    // slot[0x14..0x17] = cc62 ret
    expect(readLongBE(s, slotOff + 0x14)).toBe(0xdeadbeef);
    expect(readLongBE(s, slotOff + 0x00)).toBe(0);
    expect(readLongBE(s, slotOff + 0x04)).toBe(0);
    expect(readByte(s, slotOff + 0x18)).toBe(1);
    expect(readByte(s, slotOff + 0x1a)).toBe(0);
    expect(readLongBE(s, slotOff + 0x28)).toBe(0);
    expect(readLongBE(s, slotOff + 0x58)).toBe(0x00020c18);
    expect(readLongBE(s, slotOff + 0x5c)).toBe(0x00020c18);
    expect(readByte(s, slotOff + 0x24)).toBe(0);
    expect(readByte(s, slotOff + 0x25)).toBe(2);
    expect(readByte(s, slotOff + 0x26)).toBe(1);
  });

  it("teardown slot quando D2 == slot[0x52] AND D3 < slot[0x52] (lower cross)", () => {
    const s = emptyGameState();
    const rom = makeRom();
    // mode = 0, sentinel direct.
    setRomLongBE(rom, 0x2257a, 0x00010000);
    setRomByte(rom, 0x10000, 0xff);

    // Slot 0 in uso: byte 0x18 = 1, slot[0x52] = 15, slot[0x54] = 25.
    setByte(s, SLOT0_OFF + 0x18, 1);
    setByte(s, SLOT0_OFF + 0x19, 7); // sub-idx
    setWordBE(s, SLOT0_OFF + 0x52, 15);
    setWordBE(s, SLOT0_OFF + 0x54, 25);

    let f46Calls = 0;
    let f46Arg2: number | null = null;

    // D2 = 15 (== slot[0x52]), D3 = 14 (< slot[0x52]) → teardown.
    const r = stateSub14C46(s, rom, 15, 14, {
      fun_18f46: (_st, _arg1, arg2) => {
        f46Calls++;
        f46Arg2 = arg2;
      },
    });

    expect(r.entries).toHaveLength(0);
    expect(r.slots[0]!.action).toBe("teardown");
    expect(r.slots[1]!.action).toBe("noop");
    expect(r.slots[2]!.action).toBe("noop");
    expect(r.slots[3]!.action).toBe("noop");
    expect(readByte(s, SLOT0_OFF + 0x18)).toBe(0);
    expect(f46Calls).toBe(1);
    expect(f46Arg2).toBe(7); // sext_l(7) = 7
    expect(r.fun18F46Calls).toBe(1);
  });

  it("teardown slot quando D2 == slot[0x54] AND D3 > slot[0x54] (upper cross)", () => {
    const s = emptyGameState();
    const rom = makeRom();
    setRomLongBE(rom, 0x2257a, 0x00010000);
    setRomByte(rom, 0x10000, 0xff);

    setByte(s, SLOT0_OFF + 0x18, 1);
    setByte(s, SLOT0_OFF + 0x19, 0xfb); // -5 signed
    setWordBE(s, SLOT0_OFF + 0x52, 15);
    setWordBE(s, SLOT0_OFF + 0x54, 25);

    let f46Arg2: number | null = null;
    // D2 = 25 (== slot[0x54]), D3 = 26 (> slot[0x54]) → teardown.
    const r = stateSub14C46(s, rom, 25, 26, {
      fun_18f46: (_st, _arg1, arg2) => {
        f46Arg2 = arg2;
      },
    });

    expect(r.slots[0]!.action).toBe("teardown");
    expect(readByte(s, SLOT0_OFF + 0x18)).toBe(0);
    // sext_l(0xFB) = -5
    expect(f46Arg2).toBe(-5);
  });

  it("no teardown quando D3 dentro [slot[0x52], slot[0x54]] o D2 mismatch", () => {
    const s = emptyGameState();
    const rom = makeRom();
    setRomLongBE(rom, 0x2257a, 0x00010000);
    setRomByte(rom, 0x10000, 0xff);

    setByte(s, SLOT0_OFF + 0x18, 1);
    setWordBE(s, SLOT0_OFF + 0x52, 15);
    setWordBE(s, SLOT0_OFF + 0x54, 25);

    // D2 = 15 (== slot52), D3 = 20 (>= slot52, dentro range) → no teardown
    // dal lower-cross. Poi D2 != slot54 → skip upper.
    const r = stateSub14C46(s, rom, 15, 20);
    expect(r.slots[0]!.action).toBe("noop");
    expect(readByte(s, SLOT0_OFF + 0x18)).toBe(1);
  });

  it("entry skip se slotMatchesPtr ritorna 1 (entry duplicato)", () => {
    const s = emptyGameState();
    const rom = makeRom();
    // Setup di entry valida ma con un slot già occupato che fa match.
    setRomLongBE(rom, 0x2257a, 0x00010000);
    // entry[0..7] di test.
    setRomByte(rom, 0x10000, 10);
    setRomByte(rom, 0x10001, 20);
    setRomLongBE(rom, 0x10002, 0x00010100);
    setRomByte(rom, 0x10006, 0x33);
    setRomByte(rom, 0x10008, 0xff);

    // ROM table FUN_14BCE @ 0x1F006 (4 entries).
    setRomLongBE(rom, 0x1f006, 0x00401302);
    setRomLongBE(rom, 0x1f006 + 4, 0x00401362);
    setRomLongBE(rom, 0x1f006 + 8, 0x004013c2);
    setRomLongBE(rom, 0x1f006 + 12, 0x00401422);

    // Slot 0 in uso: byte 0x18 = 1, slot[0x4E..0x51] = entry[2..5] (= 0x00010100)
    // → slotMatchesPtr = 1 (duplicato).
    setByte(s, SLOT0_OFF + 0x18, 1);
    setLongBE(s, SLOT0_OFF + 0x4e, 0x00010100);
    // Note: slotMatchesPtr legge `*(arg+2)` come long → arg+2 punta a
    // entry[2..5] in ROM = 0x00010100. Match con slot[0x4E].
    // Però arg punta in ROM, e slotMatchesPtr fa `argOff = argPtr - 0x400000`,
    // quindi `argOff = 0x10000 - 0x400000` (negativo!) → readU32Workram legge
    // garbage. Per evitare questo, mettiamo l'entry in workRam, non in ROM.

    // STRATEGIA ALT: scrivi entry list in workRam, poi punta ROM[0x2257A] al
    // workRam address.
    // Reset
    s.workRam.fill(0);
    setByte(s, SLOT0_OFF + 0x18, 1);
    setLongBE(s, SLOT0_OFF + 0x4e, 0x00010100);

    // Scrivi entry list a workRam @ 0x400500.
    const entryWorkRamOff = 0x500;
    setByte(s, entryWorkRamOff + 0, 10);
    setByte(s, entryWorkRamOff + 1, 20);
    setLongBE(s, entryWorkRamOff + 2, 0x00010100); // *(arg+2) = 0x00010100
    setByte(s, entryWorkRamOff + 6, 0x33);
    setByte(s, entryWorkRamOff + 7, 0);
    setByte(s, entryWorkRamOff + 8, 0xff); // sentinel

    setRomLongBE(rom, 0x2257a, 0x00400500); // entryListPtr → workRam

    // D2 = 5 (< 10), D3 = 10 (== entry[0]) → gate ok, ma matched → skip.
    const r = stateSub14C46(s, rom, 5, 10);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.matched).toBe(true);
    expect(r.entries[0]!.initialized).toBe(false);
    expect(r.fun1CC62Calls).toBe(0);
  });

  it("findFreeSlotInTable ritorna -1 → break entry walk + tail walk parte da 0x401302", () => {
    const s = emptyGameState();
    const rom = makeRom();
    // Setup entry list non-vuota (1 entry + sentinel).
    setRomLongBE(rom, 0x2257a, 0x00010000);
    setRomByte(rom, 0x10000, 10);
    setRomByte(rom, 0x10001, 20);
    setRomLongBE(rom, 0x10002, 0x00010100);
    setRomByte(rom, 0x10008, 0xff);

    // ROM table FUN_14BCE: ALL slots in uso → ritorna -1.
    setRomLongBE(rom, 0x1f006, 0x00401302);
    setRomLongBE(rom, 0x1f006 + 4, 0x00401362);
    setRomLongBE(rom, 0x1f006 + 8, 0x004013c2);
    setRomLongBE(rom, 0x1f006 + 12, 0x00401422);
    // Mark all 4 slots as in-use (byte 0x18 != 0).
    setByte(s, SLOT0_OFF + 0x18, 1);
    setByte(s, SLOT0_OFF + 0x60 + 0x18, 1);
    setByte(s, SLOT0_OFF + 0xc0 + 0x18, 1);
    setByte(s, SLOT0_OFF + 0x120 + 0x18, 1);

    // Setup tail-walk teardown su slot 1 (slot 0x401362).
    setWordBE(s, SLOT0_OFF + 0x60 + 0x52, 30);
    setWordBE(s, SLOT0_OFF + 0x60 + 0x54, 40);

    // D2 = 30 (== slot1.0x52), D3 = 25 (< 30) → teardown su slot 1.
    const r = stateSub14C46(s, rom, 30, 25);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.initialized).toBe(false);
    expect(r.slots[1]!.action).toBe("teardown");
  });
});
