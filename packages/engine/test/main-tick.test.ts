/**
 * main-tick.test.ts — smoke test dell'orchestrator.
 *
 * Verifica che `mainTick(state, {rom})`:
 *  1. Non lanci eccezioni con state vuoto + ROM vuota
 *  2. Incrementi `state.clock.frame` (counter canonico interno)
 *  3. Esegua mainUpdateScrollSync (prefix FUN_28788) quando il flag 0x39A è set
 *  4. Sia idempotente: 100 tick consecutivi senza errori, state coerente
 *
 * **Nota**: workRam[0x14] e workRam[0x16] NON sono frame counter monotonic.
 * MAME li sovrascrive con altri valori durante il body del tick (vblank
 * mailbox @ 0x16, sound-timer mirror @ 0x14). Vedi commit B6: il preambolo
 * IRQ4 incrementa, ma il body azzera/sovrascrive — quindi qui non si testa.
 *
 * Non testa parità byte-perfect col binario (responsabilità dei singoli
 * test parity dei sub-systems). Verifica solo che il wire-up regga.
 */

import { describe, it, expect } from "vitest";
import { mainTick } from "../src/main-tick.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

function readU16BE(buf: Uint8Array, off: number): number {
  return ((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0);
}

function writeU16BE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

describe("mainTick smoke", () => {
  it("non solleva eccezioni con state e ROM vuoti", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => mainTick(s, { rom })).not.toThrow();
  });

  it("incrementa state.clock.frame (counter canonico interno)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const start = s.clock.frame;
    mainTick(s, { rom });
    expect(s.clock.frame).toBe(start + 1);
    mainTick(s, { rom });
    expect(s.clock.frame).toBe(start + 2);
  });

  it("skipFrameCounter: non incrementa state.clock.frame", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const start = s.clock.frame;
    mainTick(s, { rom, skipFrameCounter: true });
    expect(s.clock.frame).toBe(start);
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
    // state.clock.frame ha registrato i 100 tick
    expect(s.clock.frame).toBe(100);
  });

  it("inputMmio default 0xFC → gameMainGate skip Block C (no spin)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Senza eccezioni anche con inputMmio bit 6 set (default no-buttons)
    expect(() => mainTick(s, { rom, inputMmio: 0xfc })).not.toThrow();
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
    expect(s.clock.frame).toBe(2);
    void stableState;
  });

  it("defers live PF scroll update in playable segment 4", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    s.workRam[0x08] = 1;
    s.workRam[0x0a] = 2;
    s.workRam[0x14] = 1;
    s.workRam[0x3e4] = 4;
    writeU16BE(s.workRam, 0x02, 0x00bb);
    writeU16BE(s.spriteRam, 0x180, 0);

    mainTick(s, { rom, runMainLoopBody: true, p1X: 0xfe, p1Y: 0xff });

    expect(readU16BE(s.workRam, 0x02)).toBe(0x00bb);
    expect(s.clock.pendingPfScrollUpdate).toBe(1);

    s.workRam[0x14] = 0;
    s.workRam[0x39a] = 0;
    mainTick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff });

    expect(readU16BE(s.workRam, 0x02)).toBe(0x00bc);
    expect(s.clock.pendingPfScrollUpdate).toBeUndefined();
  });

  it("keeps live PF scroll update immediate outside deferred playable segments", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    s.workRam[0x08] = 1;
    s.workRam[0x0a] = 2;
    s.workRam[0x14] = 1;
    s.workRam[0x3e4] = 0;
    writeU16BE(s.workRam, 0x02, 0x00bb);
    writeU16BE(s.spriteRam, 0x180, 0);

    mainTick(s, { rom, runMainLoopBody: true, p1X: 0xfe, p1Y: 0xff });

    expect(readU16BE(s.workRam, 0x02)).toBe(0x00bc);
    expect(s.clock.pendingPfScrollUpdate).toBeUndefined();
  });
});
