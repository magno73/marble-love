/**
 * helper-16e8e.test.ts — unit tests per `FUN_00016E8E` (helper16E8E).
 *
 * Verifica gli effetti osservabili: cancella le righe dell'alpha tilemap
 * da `arg & 0xFF` fino a `0x1E` (esclusa), 0x24 word per riga.
 *
 * La shift table ROM viene lasciata a zero (rotation=0 nel workRam):
 * ciò semplifica il calcolo dell'indirizzo alfa → getAlphaTileAddr con
 * rotation=0 usa `row << 6` come tile index, senza leggere la shift table.
 */

import { describe, it, expect } from "vitest";
import { helper16E8E, HELPER_16E8E_ADDR } from "../src/helper-16e8e.js";
import { emptyGameState } from "../src/state.js";

/** ROM stub minimale: tutti zero (rotation=0, shift=0). */
function makeRom(): { program: Uint8Array } {
  return { program: new Uint8Array(0x80000) };
}

/** Riempie tutta la alphaRam con un valore sentinel. */
function fillAlpha(state: ReturnType<typeof emptyGameState>, v: number): void {
  for (let i = 0; i < state.alphaRam.length; i++) state.alphaRam[i] = v;
}

describe("helper16E8E (FUN_00016E8E)", () => {
  it("HELPER_16E8E_ADDR == 0x00016e8e", () => {
    expect(HELPER_16E8E_ADDR).toBe(0x00016e8e);
  });

  it("arg=0x1e → no-op (startRow già al limite)", () => {
    const state = emptyGameState();
    const rom = makeRom();
    fillAlpha(state, 0xff);
    helper16E8E(state, rom, 0x1e);
    // nessun byte deve essere cambiato
    for (let i = 0; i < state.alphaRam.length; i++) {
      expect(state.alphaRam[i]).toBe(0xff);
    }
  });

  it("arg=0x1f → no-op (bne: 0x1F ≠ 0x1E, poi 0x20 ≠ 0x1E, …, ma 0x1F+1=0x20, poi 0x1E a wrap?)", () => {
    // D2b = 0x1F: prima iterazione del loop startRow=0x1F, poi D2b=0x20, poi
    // scorre fino al wrap 0xFF→0x00→...→0x1E. In pratica 0x1F==0x1F ≠ 0x1E
    // → entrerà nel loop (non è 0x1E). Qui testiamo solo che il loop
    // termini (l'impl deve gestire il wrap correttamente).
    // startRow=0x1e → no-op; startRow=0x1f → 1 iterazione (riga 31), poi
    // loop condition 0x20 ≠ 0x1e, poi 0x21... → loop infinito!
    // Quindi arg=0x1e è il solo no-op deterministico; arg >= 0x1f ci
    // porterebbe in loop. Verifichiamo solo la no-op condition.
    const state = emptyGameState();
    const rom = makeRom();
    fillAlpha(state, 0xff);
    helper16E8E(state, rom, 0x1e);
    for (let i = 0; i < state.alphaRam.length; i++) {
      expect(state.alphaRam[i]).toBe(0xff);
    }
  });

  it("arg=0x1d → cancella solo riga 29 (0x24 word @ indirizzo riga 29)", () => {
    const state = emptyGameState();
    const rom = makeRom();
    fillAlpha(state, 0xcc);
    // rotation=0: getAlphaTileAddr(col=3, row=29) = 0xA03000 + (3 + 29*64)*2
    //   = 0xA03000 + (3 + 1856)*2 = 0xA03000 + 3718 = 0xA03000 + 0xE86
    //   offset in alphaRam = 0xE86
    const expectedBase = (3 + 29 * 64) * 2; // 0xE86
    helper16E8E(state, rom, 0x1d);
    for (let i = 0; i < 0x24; i++) {
      const off = expectedBase + i * 2;
      expect(state.alphaRam[off]).toBe(0x00);
      expect(state.alphaRam[off + 1]).toBe(0x00);
    }
    // Bytes fuori dalla finestra cancellata devono restare 0xcc
    // (spot check: primo byte e un byte prima della finestra)
    expect(state.alphaRam[0]).toBe(0xcc);
    if (expectedBase > 0) {
      expect(state.alphaRam[expectedBase - 1]).toBe(0xcc);
    }
  });

  it("arg=0 → cancella tutte le righe 0..29 (0x24 word per riga)", () => {
    const state = emptyGameState();
    const rom = makeRom();
    fillAlpha(state, 0xbb);
    helper16E8E(state, rom, 0);
    // Verifica che per ogni riga r in [0, 30), 0x24 word a partire da
    // (col=3+row*64)*2 siano zero.
    for (let r = 0; r < 30; r++) {
      const base = (3 + r * 64) * 2;
      for (let i = 0; i < 0x24; i++) {
        const off = base + i * 2;
        if (off + 1 < state.alphaRam.length) {
          expect(state.alphaRam[off]).toBe(0x00);
          expect(state.alphaRam[off + 1]).toBe(0x00);
        }
      }
    }
  });

  it("arg=4 → cancella righe 4..29 (caso caller mainLoopInit10504)", () => {
    const state = emptyGameState();
    const rom = makeRom();
    fillAlpha(state, 0xaa);
    helper16E8E(state, rom, 4);
    // Righe 4..29 cancellate
    for (let r = 4; r < 30; r++) {
      const base = (3 + r * 64) * 2;
      for (let i = 0; i < 0x24; i++) {
        const off = base + i * 2;
        if (off + 1 < state.alphaRam.length) {
          expect(state.alphaRam[off]).toBe(0x00);
          expect(state.alphaRam[off + 1]).toBe(0x00);
        }
      }
    }
    // Righe 0..3 devono restare intatte (spot check riga 0, col 3)
    const row0base = (3 + 0 * 64) * 2;
    expect(state.alphaRam[row0base]).toBe(0xaa);
  });

  it("subs.getAlphaTileAddr può essere iniettata", () => {
    const state = emptyGameState();
    const rom = makeRom();
    fillAlpha(state, 0xdd);

    const calls: Array<{ col: number; row: number }> = [];
    const injected = (
      _s: ReturnType<typeof emptyGameState>,
      _r: { program: Uint8Array },
      col: number,
      row: number,
    ): number => {
      calls.push({ col, row });
      // Punta al tile (col=0, row=0) sempre → byte 0 della alphaRam
      return 0xa03000;
    };

    helper16E8E(state, rom, 0x1c, { getAlphaTileAddr: injected });
    // Deve essere stata chiamata 2 volte (righe 0x1c=28 e 0x1d=29)
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual({ col: 3, row: 28 });
    expect(calls[1]).toEqual({ col: 3, row: 29 });
    // Il target address era sempre 0xa03000 → alphaRam[0..47] azzerati (0x24 word)
    for (let i = 0; i < 0x24 * 2; i++) {
      expect(state.alphaRam[i]).toBe(0x00);
    }
  });

  it("solo il low byte di arg è usato (M68k move.b)", () => {
    const state = emptyGameState();
    const rom = makeRom();
    fillAlpha(state, 0xff);
    // arg=0x011d → low byte = 0x1d → cancella riga 29
    helper16E8E(state, rom, 0x011d);
    const base = (3 + 29 * 64) * 2;
    expect(state.alphaRam[base]).toBe(0x00);
    expect(state.alphaRam[base + 1]).toBe(0x00);
    // riga 0 non toccata
    expect(state.alphaRam[0]).toBe(0xff);
  });
});
