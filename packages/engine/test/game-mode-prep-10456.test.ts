/**
 * game-mode-prep-10456.test.ts — unit test di FUN_00010456.
 *
 */

import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import {
  gameModePrep10456,
  GAME_MODE_PREP_10456_ADDR,
} from "../src/game-mode-prep-10456.js";

const WRAM = 0x00400000;

function rb(state: ReturnType<typeof emptyGameState>, addr: number): number {
  return state.workRam[addr - WRAM] ?? 0;
}

function wb(state: ReturnType<typeof emptyGameState>, addr: number, value: number): void {
  state.workRam[addr - WRAM] = value & 0xff;
}

function rw(state: ReturnType<typeof emptyGameState>, addr: number): number {
  return (((state.workRam[addr - WRAM] ?? 0) << 8) | (state.workRam[addr - WRAM + 1] ?? 0)) & 0xffff;
}

function ww(state: ReturnType<typeof emptyGameState>, addr: number, value: number): void {
  state.workRam[addr - WRAM] = (value >>> 8) & 0xff;
  state.workRam[addr - WRAM + 1] = value & 0xff;
}

function rl(state: ReturnType<typeof emptyGameState>, addr: number): number {
  const o = addr - WRAM;
  return (((state.workRam[o] ?? 0) << 24) | ((state.workRam[o + 1] ?? 0) << 16) |
    ((state.workRam[o + 2] ?? 0) << 8) | (state.workRam[o + 3] ?? 0)) >>> 0;
}

describe("gameModePrep10456 (FUN_00010456)", () => {
  it("GAME_MODE_PREP_10456_ADDR è 0x00010456", () => {
    expect(GAME_MODE_PREP_10456_ADDR).toBe(0x00010456);
  });

  it("smoke: esegue senza errori su stato vuoto", () => {
    const s = emptyGameState();
    expect(() => gameModePrep10456(s)).not.toThrow();
  });

  describe("slot 0 (base 0x400018) con mode=0", () => {
    it("clr.l slot0+0xbc → [0x4000d4].l = 0", () => {
      const s = emptyGameState();
      // Pre-load some non-zero bytes at slot0+0xbc = 0x400018+0xbc = 0x4000d4
      s.workRam[0xd4] = 0xaa;
      s.workRam[0xd5] = 0xbb;
      s.workRam[0xd6] = 0xcc;
      s.workRam[0xd7] = 0xdd;
      gameModePrep10456(s);
      expect(rl(s, 0x4000d4)).toBe(0);
    });

    it("clr.w slot0+0xd2 → [0x4000ea].w = 0", () => {
      const s = emptyGameState();
      s.workRam[0xea] = 0xfe;
      s.workRam[0xeb] = 0xed;
      gameModePrep10456(s);
      expect(rw(s, 0x4000ea)).toBe(0);
    });

    it("slot0+0x19 = 0 (slot index)", () => {
      const s = emptyGameState();
      gameModePrep10456(s);
      expect(rb(s, 0x400031)).toBe(0);
    });

    it("mode=0: slot0+0x18=0 (i=0 >= mode=0 → inattivo)", () => {
      const s = emptyGameState();
      ww(s, 0x400396, 0);
      gameModePrep10456(s);
      expect(rb(s, 0x400030)).toBe(0);
    });

    it("mode=1: slot0+0x18=3 e slot0+0x1a=6 (i=0 < mode=1 → attivo)", () => {
      const s = emptyGameState();
      ww(s, 0x400396, 1);
      gameModePrep10456(s);
      expect(rb(s, 0x400030)).toBe(3);
      expect(rb(s, 0x400032)).toBe(6);
    });

    it("mode=2: slot0+0x18=3 e slot0+0x1a=6 (i=0 < mode=2 → attivo)", () => {
      const s = emptyGameState();
      ww(s, 0x400396, 2);
      gameModePrep10456(s);
      expect(rb(s, 0x400030)).toBe(3);
      expect(rb(s, 0x400032)).toBe(6);
    });
  });

  describe("slot 1 (base 0x4000fa) con mode=1", () => {
    it("clr.l slot1+0xbc → [0x4001b6].l = 0", () => {
      const s = emptyGameState();
      s.workRam[0x1b6] = 0x11;
      s.workRam[0x1b7] = 0x22;
      s.workRam[0x1b8] = 0x33;
      s.workRam[0x1b9] = 0x44;
      gameModePrep10456(s);
      expect(rl(s, 0x4001b6)).toBe(0);
    });

    it("clr.w slot1+0xd2 → [0x4001cc].w = 0", () => {
      const s = emptyGameState();
      s.workRam[0x1cc] = 0x55;
      s.workRam[0x1cd] = 0x66;
      gameModePrep10456(s);
      expect(rw(s, 0x4001cc)).toBe(0);
    });

    it("slot1+0x19 = 1 (slot index)", () => {
      const s = emptyGameState();
      gameModePrep10456(s);
      expect(rb(s, 0x400113)).toBe(1);
    });

    it("mode=1: slot1+0x18=0 (i=1 >= mode=1 → inattivo)", () => {
      const s = emptyGameState();
      ww(s, 0x400396, 1);
      gameModePrep10456(s);
      expect(rb(s, 0x400112)).toBe(0);
    });

    it("mode=2: slot1+0x18=3 e slot1+0x1a=6 (i=1 < mode=2 → attivo)", () => {
      const s = emptyGameState();
      ww(s, 0x400396, 2);
      gameModePrep10456(s);
      expect(rb(s, 0x400112)).toBe(3);
      expect(rb(s, 0x400114)).toBe(6);
    });
  });

  describe("scritture a [0x40098c] array", () => {
    it("slot i=0: [0x40098c + 0 + 0xa] = 0xff → [0x400996] = 0xff", () => {
      const s = emptyGameState();
      gameModePrep10456(s);
      expect(rb(s, 0x400996)).toBe(0xff);
    });

    it("slot i=1: [0x40098c + 12 + 0xa] = 0xff → [0x4009a2] = 0xff", () => {
      const s = emptyGameState();
      gameModePrep10456(s);
      expect(rb(s, 0x4009a2)).toBe(0xff);
    });
  });

  describe("globali post-loop", () => {
    it("[0x4003a4] = 0xff", () => {
      const s = emptyGameState();
      gameModePrep10456(s);
      expect(rb(s, 0x4003a4)).toBe(0xff);
    });

    it("[0x4003ba] = 0", () => {
      const s = emptyGameState();
      wb(s, 0x4003ba, 0xab);
      gameModePrep10456(s);
      expect(rb(s, 0x4003ba)).toBe(0);
    });

    it("[0x4003e0] = 0", () => {
      const s = emptyGameState();
      wb(s, 0x4003e0, 0xcd);
      gameModePrep10456(s);
      expect(rb(s, 0x4003e0)).toBe(0);
    });

    it("[0x400010].l = 0", () => {
      const s = emptyGameState();
      s.workRam[0x10] = 0x12;
      s.workRam[0x11] = 0x34;
      s.workRam[0x12] = 0x56;
      s.workRam[0x13] = 0x78;
      gameModePrep10456(s);
      expect(rl(s, 0x400010)).toBe(0);
    });

    it("[0x4003e8] = 1", () => {
      const s = emptyGameState();
      gameModePrep10456(s);
      expect(rb(s, 0x4003e8)).toBe(1);
    });
  });

  describe("mascheramento [0x400398] = [0x4003dc] & 0x30", () => {
    it("dc=0x00 → 0x400398=0x00", () => {
      const s = emptyGameState();
      wb(s, 0x4003dc, 0x00);
      gameModePrep10456(s);
      expect(rb(s, 0x400398)).toBe(0x00);
    });

    it("dc=0x30 → 0x400398=0x30", () => {
      const s = emptyGameState();
      wb(s, 0x4003dc, 0x30);
      gameModePrep10456(s);
      expect(rb(s, 0x400398)).toBe(0x30);
    });

    it("dc=0x10 → 0x400398=0x10", () => {
      const s = emptyGameState();
      wb(s, 0x4003dc, 0x10);
      gameModePrep10456(s);
      expect(rb(s, 0x400398)).toBe(0x10);
    });

    it("dc=0xff → 0x400398=0x30 (solo bit 5-4 passano)", () => {
      const s = emptyGameState();
      wb(s, 0x4003dc, 0xff);
      gameModePrep10456(s);
      expect(rb(s, 0x400398)).toBe(0x30);
    });

    it("dc=0x55 → 0x400398=0x10", () => {
      const s = emptyGameState();
      wb(s, 0x4003dc, 0x55);
      gameModePrep10456(s);
      expect(rb(s, 0x400398)).toBe(0x10);
    });
  });

  describe("azzeramento byte [0x400654..0x400658]", () => {
    it("[0x400658] = 0", () => {
      const s = emptyGameState();
      wb(s, 0x400658, 0x99);
      gameModePrep10456(s);
      expect(rb(s, 0x400658)).toBe(0);
    });

    it("[0x400656] = 0", () => {
      const s = emptyGameState();
      wb(s, 0x400656, 0x88);
      gameModePrep10456(s);
      expect(rb(s, 0x400656)).toBe(0);
    });

    it("[0x400654] = 0", () => {
      const s = emptyGameState();
      wb(s, 0x400654, 0x77);
      gameModePrep10456(s);
      expect(rb(s, 0x400654)).toBe(0);
    });
  });
});
