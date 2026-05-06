/**
 * Test bootScreenInit (FUN_222E) — smoke tests sui rami principali.
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-boot-screen-init-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  bootScreenInit,
  BOOT_SCREEN_FRAME_COUNTER_OFF,
  BOOT_SCREEN_VECTOR_SLOT_1,
  BOOT_SCREEN_VECTOR_SLOT_2,
  BOOT_SCREEN_MAGIC_JMP_L,
  type BootScreenInitSubs,
} from "../src/boot-screen-init.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage, type RomImage } from "../src/bus.js";

/** Crea una ROM image con magic word controllato sui due vector slot. */
function makeRom(slot1Magic: number, slot2Magic: number): RomImage {
  const rom = emptyRomImage();
  rom.program[BOOT_SCREEN_VECTOR_SLOT_1] = (slot1Magic >>> 8) & 0xff;
  rom.program[BOOT_SCREEN_VECTOR_SLOT_1 + 1] = slot1Magic & 0xff;
  rom.program[BOOT_SCREEN_VECTOR_SLOT_2] = (slot2Magic >>> 8) & 0xff;
  rom.program[BOOT_SCREEN_VECTOR_SLOT_2 + 1] = slot2Magic & 0xff;
  return rom;
}

/** Bag che traccia l'ordine di chiamata delle subs. */
function makeTrackedSubs(): { calls: string[]; subs: BootScreenInitSubs } {
  const calls: string[] = [];
  return {
    calls,
    subs: {
      clearScreen: () => calls.push("clearScreen"),
      introSetup: () => calls.push("introSetup"),
      coldBootInit: () => calls.push("coldBootInit"),
      dispatchSlot1Hook: () => calls.push("dispatchSlot1Hook"),
      slot1Fallback: () => calls.push("slot1Fallback"),
      dispatchSlot2Hook: () => calls.push("dispatchSlot2Hook"),
      slot2Fallback: () => calls.push("slot2Fallback"),
    },
  };
}

describe("bootScreenInit (FUN_222E)", () => {
  it("scrive sempre i 6 register video a $B00000-$B0000A", () => {
    const s = emptyGameState();
    const rom = makeRom(0x0000, 0x0000);
    // workRam[0x16/17] != 0 → warm boot, ma le 6 write avvengono comunque
    s.workRam[BOOT_SCREEN_FRAME_COUNTER_OFF] = 0x42;
    bootScreenInit(s, rom);

    // BE word reads
    const w = (off: number) =>
      ((s.colorRam[off] ?? 0) << 8) | (s.colorRam[off + 1] ?? 0);
    expect(w(0x00)).toBe(0x0000);
    expect(w(0x02)).toBe(0x1fff);
    expect(w(0x04)).toBe(0x7fff);
    expect(w(0x06)).toBe(0xbfff);
    expect(w(0x08)).toBe(0x0000);
    expect(w(0x0a)).toBe(0x0000);
  });

  it("warm boot (frame_counter != 0): chiama solo clearScreen + introSetup", () => {
    const s = emptyGameState();
    s.workRam[BOOT_SCREEN_FRAME_COUNTER_OFF] = 0x01;
    const { calls, subs } = makeTrackedSubs();
    const rom = makeRom(BOOT_SCREEN_MAGIC_JMP_L, BOOT_SCREEN_MAGIC_JMP_L);

    bootScreenInit(s, rom, subs);

    expect(calls).toEqual(["clearScreen", "introSetup"]);
  });

  it("warm boot anche se frame_counter byte 0x16 = 0 ma 0x17 != 0 (tst.w)", () => {
    // tst.w legge BE word: branch warm se hi!=0 OR lo!=0
    const s = emptyGameState();
    s.workRam[BOOT_SCREEN_FRAME_COUNTER_OFF] = 0x00;
    s.workRam[BOOT_SCREEN_FRAME_COUNTER_OFF + 1] = 0x01;
    const { calls, subs } = makeTrackedSubs();
    const rom = makeRom(0x0000, 0x0000);

    bootScreenInit(s, rom, subs);

    // coldBootInit non chiamato perché word != 0
    expect(calls).toEqual(["clearScreen", "introSetup"]);
  });

  it("cold boot + entrambi i magic JMP.L: chiama hook su entrambi gli slot", () => {
    const s = emptyGameState();
    // frame_counter = 0
    const { calls, subs } = makeTrackedSubs();
    const rom = makeRom(BOOT_SCREEN_MAGIC_JMP_L, BOOT_SCREEN_MAGIC_JMP_L);

    bootScreenInit(s, rom, subs);

    expect(calls).toEqual([
      "clearScreen",
      "introSetup",
      "coldBootInit",
      "dispatchSlot1Hook",
      "dispatchSlot2Hook",
    ]);
  });

  it("cold boot + entrambi i magic NON JMP.L: chiama i fallback", () => {
    const s = emptyGameState();
    const { calls, subs } = makeTrackedSubs();
    const rom = makeRom(0x0000, 0x0000);

    bootScreenInit(s, rom, subs);

    expect(calls).toEqual([
      "clearScreen",
      "introSetup",
      "coldBootInit",
      "slot1Fallback",
      "slot2Fallback",
    ]);
  });

  it("cold boot mix: slot1 magic + slot2 NO magic (Marble Madness reale)", () => {
    const s = emptyGameState();
    const { calls, subs } = makeTrackedSubs();
    // Marble Madness: ROM[0x10048].w == 0x4EF9, ROM[0x1004E].w == 0x0000
    const rom = makeRom(BOOT_SCREEN_MAGIC_JMP_L, 0x0000);

    bootScreenInit(s, rom, subs);

    expect(calls).toEqual([
      "clearScreen",
      "introSetup",
      "coldBootInit",
      "dispatchSlot1Hook",
      "slot2Fallback",
    ]);
  });

  it("subs default no-op: non solleva su rom vuota + cold boot", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => bootScreenInit(s, rom)).not.toThrow();
    // E le 6 write sono comunque applicate
    const w6 = ((s.colorRam[0x06] ?? 0) << 8) | (s.colorRam[0x07] ?? 0);
    expect(w6).toBe(0xbfff);
  });
});
