/**
 * bsearch-table-1abd4.test.ts — smoke tests per `FUN_0001ABD4`.
 *
 * La funzione fa una bisezione su un array di word ordinato, le cui
 * estremita' sono nei due slot long `*(0x40065A)` e `*(0x40065E)`.
 * Step iniziale = 0x400 byte, halvato ogni iter, probe clampato a
 * `[base, end]`. Termina solo all'equality.
 */

import { describe, it, expect } from "vitest";
import { bsearchTable1ABD4 } from "../src/bsearch-table-1abd4.js";
import { emptyGameState } from "../src/state.js";

const BASE_PTR_OFF = 0x65a; // workRam offset of *(0x40065A) slot
const END_PTR_OFF = 0x65e;

const WORK_RAM_BASE_ADDR = 0x00400000;

function writeLongBE(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

function writeWordBE(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

/**
 * Helper: setup di una tabella di word @ workRam offset `tableOff`.
 * Configura *(0x40065A) e *(0x40065E) puntando in absolute addressing
 * (workRam = 0x400000+).
 */
function setupTable(
  s: ReturnType<typeof emptyGameState>,
  tableOff: number,
  words: number[],
): void {
  for (let i = 0; i < words.length; i++) {
    writeWordBE(s, tableOff + i * 2, words[i]! & 0xffff);
  }
  const baseAbs = WORK_RAM_BASE_ADDR + tableOff;
  const endAbs = WORK_RAM_BASE_ADDR + tableOff + (words.length - 1) * 2;
  writeLongBE(s, BASE_PTR_OFF, baseAbs);
  writeLongBE(s, END_PTR_OFF, endAbs);
}

describe("bsearchTable1ABD4 (FUN_0001ABD4)", () => {
  it("trova il match esatto e ritorna l'indice di word", () => {
    const s = emptyGameState();
    // Tabella di 5 word @ workRam off 0x800: [0x10, 0x20, 0x30, 0x40, 0x50]
    // Stride 2 byte; step iniziale 0x400 → primo step va FUORI range, ma il
    // clamp riporta dentro. Garantito dal test che il match esiste.
    const tableOff = 0x800;
    setupTable(s, tableOff, [0x10, 0x20, 0x30, 0x40, 0x50]);

    // Cerca 0x10 → match al primo probe (probeAbs == baseAbs).
    // Indice di word = (matchPtr - basePtr) / 2 = 0.
    expect(bsearchTable1ABD4(s, 0x10)).toBe(0);
  });

  it("ritorna 0 quando target == base.word (no iter di bisezione)", () => {
    const s = emptyGameState();
    const tableOff = 0x1000;
    // Tabella con base.word = 0xABCD; un altro a +0x400 byte (= word 0x200)
    setupTable(s, tableOff, [0xabcd]);
    // Forza end-pointer 1024 byte oltre base, riempi un terminator
    writeLongBE(s, END_PTR_OFF, WORK_RAM_BASE_ADDR + tableOff + 0x400);
    writeWordBE(s, tableOff + 0x400, 0xffff);

    expect(bsearchTable1ABD4(s, 0xabcd)).toBe(0);
  });

  it("usa solo la low-word di targetLong (mask 0xFFFF)", () => {
    const s = emptyGameState();
    const tableOff = 0x900;
    setupTable(s, tableOff, [0x1234, 0x5678, 0x9abc]);

    // arg long = 0xCAFE5678 → low word 0x5678 deve matchare entry 1.
    // Pero' attenzione: il loop bisezione cerca con step iniziale 0x400 byte
    // = 512 word. Con tabella di 3 word, il primo probe avanza/indietreggia
    // di 512 word e va fuori range; il clamp lo riporta a [base, end].
    // Per un test semplice, usiamo una tabella piu' grande "sintetica":
    const tableOff2 = 0xc00;
    const words: number[] = [];
    for (let i = 0; i < 0x201; i++) words.push(0xffff); // riempitivo
    words[0] = 0x5678;
    setupTable(s, tableOff2, words);
    expect(bsearchTable1ABD4(s, 0xcafe5678)).toBe(0);
  });

  it("non scrive in workRam (puro lookup)", () => {
    const s = emptyGameState();
    const tableOff = 0x800;
    setupTable(s, tableOff, [0x10, 0x20, 0x30]);

    // Snapshot di tutto il workRam tranne la table + i due slot pointer
    // setup-ati dal test (gli unici a non essere zero-initialized).
    const snapshot = new Uint8Array(s.workRam);
    bsearchTable1ABD4(s, 0x10);
    expect(s.workRam).toEqual(snapshot);
  });
});
