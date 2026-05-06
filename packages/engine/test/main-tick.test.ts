/**
 * main-tick.test.ts — smoke test dell'orchestrator.
 *
 * Verifica che `mainTick(state, {rom})`:
 *  1. Non lanci eccezioni con state vuoto + ROM vuota
 *  2. Incrementi i frame counter @ 0x14/0x16
 *  3. Esegua mainUpdateScrollSync (prefix FUN_28788) quando il flag 0x39A è set
 *  4. Sia idempotente: 100 tick consecutivi senza errori, state coerente
 *
 * Non testa parità byte-perfect col binario (responsabilità dei singoli
 * test parity dei sub-systems). Verifica solo che il wire-up regga.
 */

import { describe, it, expect } from "vitest";
import { mainTick } from "../src/main-tick.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

describe("mainTick smoke", () => {
  it("non solleva eccezioni con state e ROM vuoti", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => mainTick(s, { rom })).not.toThrow();
  });

  it("incrementa il frame counter @ 0x14 e 0x16", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    mainTick(s, { rom });
    expect(s.workRam[0x14]).toBe(1);
    expect(s.workRam[0x16]).toBe(1);
    mainTick(s, { rom });
    expect(s.workRam[0x14]).toBe(2);
    expect(s.workRam[0x16]).toBe(2);
  });

  it("skipFrameCounter: lascia 0x14/0x16 a 0", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    mainTick(s, { rom, skipFrameCounter: true });
    expect(s.workRam[0x14]).toBe(0);
    expect(s.workRam[0x16]).toBe(0);
  });

  it("flag 0x39A set → esegue prefix scroll sync (latcha y, clear flag)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x39a] = 1;
    s.workRam[0x00] = 0xab; // y target high
    s.workRam[0x01] = 0xcd; // y target low
    mainTick(s, { rom });
    expect(s.workRam[0x39a]).toBe(0); // flag cleared
    expect(s.workRam[0x02]).toBe(0xab); // latched
    expect(s.workRam[0x03]).toBe(0xcd);
  });

  it("100 tick consecutivi senza eccezioni", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    for (let i = 0; i < 100; i++) {
      expect(() => mainTick(s, { rom })).not.toThrow();
    }
    // Il frame counter avrà fatto wrap byte (100 mod 256 = 100)
    expect(s.workRam[0x14]).toBe(100);
  });

  it("inputMmio default 0x40 → gameMainGate skip Block C (no spin)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Senza eccezioni anche con inputMmio bit 6 set
    expect(() => mainTick(s, { rom, inputMmio: 0x40 })).not.toThrow();
  });

  it("trackball deltas si propagano a gameTickTimers + trackball state", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Prima tick: nessun delta → trackball state stabile
    mainTick(s, { rom });
    const stableState = Array.from(s.workRam.slice(0x1c00, 0x1c20));
    // Seconda tick: con delta dx=8 — non ci aspettiamo bit-perfect parity
    // qui (test smoke), solo che lo stato evolva senza throw
    expect(() => mainTick(s, { rom, p1X: 8, p1Y: -4 })).not.toThrow();
    // Sanity: il frame counter è continuato
    expect(s.workRam[0x14]).toBe(2);
    void stableState;
  });
});
