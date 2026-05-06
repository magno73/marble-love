/**
 * state-sub-540a.test.ts — corner cases di stateSub540A (FUN_540A).
 *
 * Bit-perfect parity verificata vs binary in `test-state-sub-540a-parity.ts`.
 * Qui copriamo i path principali (header tipici, D3 boundary, early-exit) e
 * gli edge case M68k (asl.l count >= 32, signed-word negativo, byte sub wrap).
 */

import { describe, it, expect } from "vitest";
import { stateSub540A, fun53EA } from "../src/state-sub-540a.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;

/** Scrive una stringa null-terminated in workRam @ off, ritorna lunghezza+1. */
function writeStr(workRam: Uint8Array, off: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    workRam[off + i] = s.charCodeAt(i) & 0xff;
  }
  workRam[off + s.length] = 0;
  return s.length + 1;
}

/**
 * Costruisce un record `[hdr, str0\0, str1\0, ...]` in workRam @ off.
 * Il numero di stringhe è derivato dal header tramite la formula M68k:
 *   shift_byte = ((hdr>>4)+1 - (hdr&0xF)) & 0xFF
 *   count_word = (1 << (shift_byte & 63)) & 0xFFFF, signed-word
 *   numStrings = count_word + 1 se count_word_signed >= 0, else 0
 *
 * Il caller deve passare le stringhe esatte da scrivere.
 * @returns offset dopo il record (next header position).
 */
function writeRecord(
  workRam: Uint8Array,
  off: number,
  hdr: number,
  strings: readonly string[],
): number {
  workRam[off] = hdr & 0xff;
  let cur = off + 1;
  for (const s of strings) {
    cur += writeStr(workRam, cur, s);
  }
  return cur;
}

describe("fun53EA (FUN_53EA) — read byte-pair OR", () => {
  it("ritorna byte[ptr] | byte[ptr+1]", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0x12;
    s.workRam[0x101] = 0x34;
    expect(fun53EA(s, 0x400100)).toBe(0x12 | 0x34);
  });

  it("0 0 → 0 (sentinel pair)", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0;
    s.workRam[0x101] = 0;
    expect(fun53EA(s, 0x400100)).toBe(0);
  });

  it("XX 00 → XX (un byte solo non zero)", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0xff;
    s.workRam[0x101] = 0x00;
    expect(fun53EA(s, 0x400100)).toBe(0xff);
  });

  it("00 XX → XX", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0x00;
    s.workRam[0x101] = 0x80;
    expect(fun53EA(s, 0x400100)).toBe(0x80);
  });

  it("ptr fuori workRam → 0 (defensive)", () => {
    const s = emptyGameState();
    expect(fun53EA(s, 0x500000)).toBe(0);
  });
});

describe("stateSub540A (FUN_540A) — record walker", () => {
  it("D3=0 con pair non-zero a A2 → ritorna A2 (no walk)", () => {
    // D3=0 entra direttamente in exit_path. Il pair viene letto:
    // se non-zero ritorna A2.
    const s = emptyGameState();
    const a2 = 0x401000;
    const off = a2 - WORK_RAM_BASE;
    s.workRam[off] = 0x42;
    s.workRam[off + 1] = 0x00;
    expect(stateSub540A(s, a2, 0)).toBe(a2);
  });

  it("D3=0 con pair zero a A2 → ritorna 0 (sentinel)", () => {
    const s = emptyGameState();
    const a2 = 0x401000;
    // workRam è già zero-initialized
    expect(stateSub540A(s, a2, 0)).toBe(0);
  });

  it("Early-exit: pair 00 00 in testa → ritorna 0 senza decrementare D3", () => {
    const s = emptyGameState();
    const a2 = 0x401000;
    // workRam già zero → fun53EA(a2)==0 → early exit nel body.
    expect(stateSub540A(s, a2, 5)).toBe(0);
  });

  it("D3=1, hdr=0x10 (hi=1, lo=0 → shift=2, count=4, num strings=5): walk 1 record", () => {
    // shift_byte = (1+1) - 0 = 2. count = 1<<2 = 4. D0w = 4 (signed positivo).
    // bge → body. Inner loop: D0w=4,3,2,1,0 → 5 body executions, ognuna skip
    // una stringa null-terminated. Quindi servono 5 stringhe nel record.
    const s = emptyGameState();
    const a2 = 0x401000;
    const off = a2 - WORK_RAM_BASE;
    const nextOff = writeRecord(s.workRam, off, 0x10, [
      "AAA",
      "BBB",
      "CCC",
      "DDD",
      "EEE",
    ]);
    // Mette pair non-zero al record successivo per non triggerare ritorno 0.
    s.workRam[nextOff] = 0xab;
    s.workRam[nextOff + 1] = 0x00;

    const ret = stateSub540A(s, a2, 1);
    // Atteso: A2 avanzato a `nextOff` come indirizzo assoluto.
    expect(ret).toBe(WORK_RAM_BASE + nextOff);
  });

  it("D3=1, hdr=0x00 (hi=0, lo=0 → shift=1, count=2, num strings=3)", () => {
    // shift_byte = 1. count = 2. D0w = 2 → body 3 volte (D0w=2,1,0).
    const s = emptyGameState();
    const a2 = 0x401100;
    const off = a2 - WORK_RAM_BASE;
    const nextOff = writeRecord(s.workRam, off, 0x00, ["X", "Y", "Z"]);
    s.workRam[nextOff] = 0x01;

    const ret = stateSub540A(s, a2, 1);
    expect(ret).toBe(WORK_RAM_BASE + nextOff);
  });

  it("D3=1, hdr con shift negativo (count=0 dopo asl) → body 1 volta", () => {
    // hdr = 0x05 (hi=0, lo=5). shift_byte = (0+1) - 5 = -4 & 0xFF = 0xFC.
    // count = (1 << (0xFC & 63)) = 1 << 60 = 0 (>= 32 → 0).
    // D0w = 0 → bge passa (0 >= 0) → body 1 volta poi -1 → exit.
    const s = emptyGameState();
    const a2 = 0x401200;
    const off = a2 - WORK_RAM_BASE;
    const nextOff = writeRecord(s.workRam, off, 0x05, ["only"]);
    s.workRam[nextOff] = 0x99;

    const ret = stateSub540A(s, a2, 1);
    expect(ret).toBe(WORK_RAM_BASE + nextOff);
  });

  it("D3=1, hdr=0xF0 (hi=15, lo=0 → shift=16): count=0 → body 1 volta", () => {
    // shift_byte = (15+1) - 0 = 16. count = (1 << 16) & 0xFFFF = 0.
    // D0w = 0 (signed 0 ≥ 0) → body 1 volta.
    const s = emptyGameState();
    const a2 = 0x401300;
    const off = a2 - WORK_RAM_BASE;
    const nextOff = writeRecord(s.workRam, off, 0xf0, ["one"]);
    s.workRam[nextOff] = 0x77;

    const ret = stateSub540A(s, a2, 1);
    expect(ret).toBe(WORK_RAM_BASE + nextOff);
  });

  it("D3=2, due record contigui → walk completo", () => {
    const s = emptyGameState();
    const a2 = 0x401400;
    const off = a2 - WORK_RAM_BASE;
    // record1: hdr=0x00, 3 stringhe. record2: hdr=0x05 (shift neg → 1 stringa).
    let cur = off;
    cur = writeRecord(s.workRam, cur, 0x00, ["a", "b", "c"]);
    cur = writeRecord(s.workRam, cur, 0x05, ["d"]);
    s.workRam[cur] = 0xee; // pair non-zero a fine

    const ret = stateSub540A(s, a2, 2);
    expect(ret).toBe(WORK_RAM_BASE + cur);
  });

  it("D3=2 ma record 2 ha pair 00 00 → early-exit ritorna 0", () => {
    const s = emptyGameState();
    const a2 = 0x401500;
    const off = a2 - WORK_RAM_BASE;
    let cur = off;
    cur = writeRecord(s.workRam, cur, 0x00, ["a", "b", "c"]);
    // record2: pair 00 00 (terminatore tabella)
    s.workRam[cur] = 0;
    s.workRam[cur + 1] = 0;

    const ret = stateSub540A(s, a2, 2);
    expect(ret).toBe(0);
  });

  it("D3=3 walk completo, record finale ha pair non-zero: ritorna A2 finale", () => {
    const s = emptyGameState();
    const a2 = 0x401600;
    const off = a2 - WORK_RAM_BASE;
    let cur = off;
    cur = writeRecord(s.workRam, cur, 0x00, ["a", "b", "c"]);
    cur = writeRecord(s.workRam, cur, 0x05, ["x"]);
    cur = writeRecord(s.workRam, cur, 0x10, ["1", "2", "3", "4", "5"]);
    s.workRam[cur] = 0x42; // sentinel non-zero

    const ret = stateSub540A(s, a2, 3);
    expect(ret).toBe(WORK_RAM_BASE + cur);
  });

  it("Stringa vuota nel record (byte 0 immediatamente, ma hdr non-zero)", () => {
    // hdr=0x10 → 5 stringhe. Una è vuota. Hdr non-zero così byte[A2]|byte[A2+1]
    // != 0 (l'header byte è 0x10) e non triggera early-exit.
    // ATTENZIONE: se hdr=0 E byte[A2+1]=0 (cioè prima string vuota) la coppia
    // diventa 00 00 e la funzione esce subito (semantica corretta del binario).
    const s = emptyGameState();
    const a2 = 0x401700;
    const off = a2 - WORK_RAM_BASE;
    const nextOff = writeRecord(s.workRam, off, 0x10, [
      "x",
      "",
      "ok",
      "",
      "z",
    ]);
    s.workRam[nextOff] = 0x88;

    const ret = stateSub540A(s, a2, 1);
    expect(ret).toBe(WORK_RAM_BASE + nextOff);
  });

  it("hdr con shift=15 (count=0x8000 → D0w signed negativo): body skipped", () => {
    // shift_byte = 15. count = 1 << 15 = 0x8000. D0w = 0x8000 = -32768 signed.
    // bge fallisce → body NON eseguito → A2 non avanza per stringhe.
    // Solo l'header byte è consumato.
    const s = emptyGameState();
    const a2 = 0x401800;
    const off = a2 - WORK_RAM_BASE;
    // hdr che produce shift=15: (hi+1)-lo = 15. Es. hi=14, lo=0 → hdr=0xE0.
    s.workRam[off] = 0xe0;
    // A2+1 deve essere non-zero per il pair check finale.
    s.workRam[off + 1] = 0xab;
    s.workRam[off + 2] = 0xcd;

    // D3=1: dopo 1 record, A2 = a2 + 1 (solo header consumato).
    const ret = stateSub540A(s, a2, 1);
    expect(ret).toBe(a2 + 1);
  });

  it("Pure read: workRam non viene mai scritta", () => {
    const s = emptyGameState();
    const a2 = 0x401900;
    const off = a2 - WORK_RAM_BASE;
    const nextOff = writeRecord(s.workRam, off, 0x00, ["foo", "bar", "baz"]);
    s.workRam[nextOff] = 0x77;
    // Snapshot
    const before = new Uint8Array(s.workRam);

    stateSub540A(s, a2, 1);

    // Identico
    expect(s.workRam).toEqual(before);
  });
});
