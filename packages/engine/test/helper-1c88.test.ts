/**
 * helper-1c88.test.ts — unit test di `helper1C88` (FUN_00001C88).
 *
 * `packages/cli/src/test-helper-1c88-parity.ts` vs Musashi.
 */

import { describe, it, expect, vi } from "vitest";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import { helper1C88, HELPER_1C88_ADDR } from "../src/helper-1c88.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeWordBE(arr: Uint8Array, off: number, v: number): void {
  arr[off]     = (v >>> 8) & 0xff;
  arr[off + 1] = v & 0xff;
}

function readWordBE(arr: Uint8Array, off: number): number {
  return (((arr[off] ?? 0) & 0xff) << 8) | ((arr[off + 1] ?? 0) & 0xff);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("helper1C88 (FUN_00001C88)", () => {
  it("HELPER_1C88_ADDR è corretto", () => {
    expect(HELPER_1C88_ADDR).toBe(0x1c88);
  });

  it("non crasha con state vuoto e rom undefined", () => {
    const s = emptyGameState();
    expect(() => helper1C88(s, undefined)).not.toThrow();
  });

  it("non crasha con emptyRomImage", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => helper1C88(s, rom)).not.toThrow();
  });

  // ── Loop 1: Alpha RAM azzerata ────────────────────────────────────────────

  it("azzera tutta alphaRam (0xA03000-0xA03FFE, 2048 word)", () => {
    const s = emptyGameState();
    s.alphaRam.fill(0xab);
    helper1C88(s, undefined);
    for (let i = 0; i <= 0x0fff; i++) {
      expect(s.alphaRam[i]).toBe(0);
    }
  });

  it("copre tutti i 4096 byte di alphaRam (0 .. 0xFFF)", () => {
    const s = emptyGameState();
    s.alphaRam.fill(0xff);
    helper1C88(s, undefined);
    // 2048 word = 4096 byte totali
    for (let off = 0; off <= 0x0ffe; off += 2) {
      expect(readWordBE(s.alphaRam, off)).toBe(0);
    }
  });

  // ── Loop 2: Playfield RAM riempita ────────────────────────────────────────

  it("riempie playfieldRam con 0 quando vblankFlag == 0 e ROM16[0x10060] == 0", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // workRam[0x16..0x17] = 0 (default), ROM[0x10060] = 0 → fillWord = 0
    s.playfieldRam.fill(0xcd);
    helper1C88(s, rom);
    for (let off = 0; off <= 0x1ffe; off += 2) {
      expect(readWordBE(s.playfieldRam, off)).toBe(0);
    }
  });

  it("copre tutti i 8192 byte di playfieldRam (0 .. 0x1FFF)", () => {
    const s = emptyGameState();
    s.playfieldRam.fill(0xff);
    helper1C88(s, undefined);
    for (let i = 0; i <= 0x1fff; i++) {
      expect(s.playfieldRam[i]).toBe(0);
    }
  });

  it("riempie playfieldRam con 0 quando vblankFlag != 0 (indipendente da ROM)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Set ROM[0x10060] = 0x1234 and vblankFlag = 1 -> fillWord must be 0.
    rom.program[0x10060] = 0x12;
    rom.program[0x10061] = 0x34;
    writeWordBE(s.workRam, 0x16, 1); // vblankFlag = 1
    s.playfieldRam.fill(0xab);
    helper1C88(s, rom);
    for (let off = 0; off <= 0x1ffe; off += 2) {
      expect(readWordBE(s.playfieldRam, off)).toBe(0);
    }
  });

  it("riempie playfieldRam con ROM16[0x10060] quando vblankFlag == 0 e ROM != 0", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // vblankFlag = 0, ROM[0x10060] = 0x0042 → fillWord = 0x0042
    rom.program[0x10060] = 0x00;
    rom.program[0x10061] = 0x42;
    writeWordBE(s.workRam, 0x16, 0); // vblankFlag = 0
    s.playfieldRam.fill(0xab);
    helper1C88(s, rom);
    for (let off = 0; off <= 0x1ffe; off += 2) {
      expect(readWordBE(s.playfieldRam, off)).toBe(0x0042);
    }
  });

  it("sign-estende il fill word negativo: ROM16[0x10060] = 0x8000 → fillWord = 0x8000", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x10060] = 0x80;
    rom.program[0x10061] = 0x00;
    writeWordBE(s.workRam, 0x16, 0);
    helper1C88(s, rom);
    for (let off = 0; off <= 0x1ffe; off += 2) {
      expect(readWordBE(s.playfieldRam, off)).toBe(0x8000);
    }
  });

  it("usa vblankFlag come word (2 byte): workRam[0x17] != 0 → fillWord = 0", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x10060] = 0x12;
    rom.program[0x10061] = 0x34;
    writeWordBE(s.workRam, 0x16, 0x0001);
    s.playfieldRam.fill(0xab);
    helper1C88(s, rom);
    for (let off = 0; off <= 0x1ffe; off += 2) {
      expect(readWordBE(s.playfieldRam, off)).toBe(0);
    }
  });

  // ── Epilog: sprite RAM ────────────────────────────────────────────────────

  it("azzera word a spriteRam[0x000] (0xA02000)", () => {
    const s = emptyGameState();
    s.spriteRam[0] = 0xff;
    s.spriteRam[1] = 0xff;
    helper1C88(s, undefined);
    expect(readWordBE(s.spriteRam, 0x000)).toBe(0);
  });

  it("azzera word a spriteRam[0x180] (0xA02180)", () => {
    const s = emptyGameState();
    s.spriteRam[0x180] = 0xff;
    s.spriteRam[0x181] = 0xff;
    helper1C88(s, undefined);
    expect(readWordBE(s.spriteRam, 0x180)).toBe(0);
  });

  it("preserva spriteRam fuori dai due offset azzerati (es. 0x002 e 0x182)", () => {
    const s = emptyGameState();
    s.spriteRam.fill(0x55);
    helper1C88(s, undefined);
    // Only offsets 0x000 and 0x180 are zeroed; the rest must remain.
    expect(readWordBE(s.spriteRam, 0x002)).toBe(0x5555);
    expect(readWordBE(s.spriteRam, 0x17e)).toBe(0x5555);
    expect(readWordBE(s.spriteRam, 0x182)).toBe(0x5555);
  });

  // ── Epilog: palette RAM ───────────────────────────────────────────────────

  it("azzera word a colorRam[0x400] (0xB00400)", () => {
    const s = emptyGameState();
    s.colorRam[0x400] = 0xff;
    s.colorRam[0x401] = 0xff;
    helper1C88(s, undefined);
    expect(readWordBE(s.colorRam, 0x400)).toBe(0);
  });

  it("preserva colorRam fuori dall'offset 0x400", () => {
    const s = emptyGameState();
    s.colorRam.fill(0x77);
    helper1C88(s, undefined);
    expect(readWordBE(s.colorRam, 0x000)).toBe(0x7777);
    expect(readWordBE(s.colorRam, 0x3fe)).toBe(0x7777);
    expect(readWordBE(s.colorRam, 0x402)).toBe(0x7777);
  });

  // ── Hook AV-control ───────────────────────────────────────────────────────

  it("chiama subs.onAvControl esattamente una volta", () => {
    const s = emptyGameState();
    const onAvControl = vi.fn();
    helper1C88(s, undefined, { onAvControl });
    expect(onAvControl).toHaveBeenCalledTimes(1);
    expect(onAvControl).toHaveBeenCalledWith(s);
  });

  it("funziona senza subs (default no-op)", () => {
    const s = emptyGameState();
    expect(() => helper1C88(s, undefined, {})).not.toThrow();
    expect(() => helper1C88(s, undefined, undefined)).not.toThrow();
  });

  // ── Isolamento RAM ────────────────────────────────────────────────────────

  it("non tocca workRam (eccetto la lettura del vblankFlag)", () => {
    const s = emptyGameState();
    s.workRam.fill(0xaa);
    helper1C88(s, undefined);
    for (let i = 0; i < s.workRam.length; i++) {
      expect(s.workRam[i]).toBe(0xaa);
    }
  });

  it("sequenza completa: tutte e 4 le regioni RAM modificate correttamente", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.alphaRam.fill(0xff);
    s.playfieldRam.fill(0xff);
    s.spriteRam.fill(0xff);
    s.colorRam.fill(0xff);
    rom.program[0x10060] = 0x00;
    rom.program[0x10061] = 0x55;
    writeWordBE(s.workRam, 0x16, 0); // vblankFlag = 0

    helper1C88(s, rom);

    expect(s.alphaRam[0]).toBe(0);
    expect(s.alphaRam[0xffe]).toBe(0);
    expect(readWordBE(s.playfieldRam, 0)).toBe(0x0055);
    expect(readWordBE(s.playfieldRam, 0x1ffe)).toBe(0x0055);
    // spriteRam[0] and [0x180] zeroed, rest 0xff.
    expect(readWordBE(s.spriteRam, 0x000)).toBe(0);
    expect(readWordBE(s.spriteRam, 0x180)).toBe(0);
    expect(s.spriteRam[2]).toBe(0xff);
    expect(readWordBE(s.colorRam, 0x400)).toBe(0);
    expect(s.colorRam[0]).toBe(0xff);
  });
});
