/**
 * Test tilemapBlit17044 (FUN_17044) — smoke tests sui rami principali.
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-tilemap-blit-17044-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  tilemapBlit17044,
  ROM_SOURCE_ADDR,
  PF_RAM_BASE_ADDR,
  PF_DEST_ADDR,
  ROW_COUNT,
  WORDS_PER_ROW,
  BYTES_PER_ROW,
  ROW_SKIP_BYTES,
  ROW_STRIDE_BYTES,
  TOTAL_BYTES_COPIED,
} from "../src/tilemap-blit-17044.js";
import { emptyRomImage } from "../src/bus.js";

const PF_SIZE = 0x2000; // 8 KB PF RAM
const DEST_OFF = PF_DEST_ADDR - PF_RAM_BASE_ADDR; // 0x116

function fillRomSource(rom: ReturnType<typeof emptyRomImage>, byteFn: (i: number) => number): void {
  for (let i = 0; i < TOTAL_BYTES_COPIED; i++) {
    rom.program[ROM_SOURCE_ADDR + i] = byteFn(i) & 0xff;
  }
}

describe("tilemapBlit17044 (FUN_17044)", () => {
  it("costanti coerenti col disasm", () => {
    expect(ROM_SOURCE_ADDR).toBe(0x19f04);
    expect(PF_RAM_BASE_ADDR).toBe(0xa00000);
    expect(PF_DEST_ADDR).toBe(0xa00116);
    expect(ROW_COUNT).toBe(6); // outer cmpi.b #0x6
    expect(WORDS_PER_ROW).toBe(0x14); // inner cmpi.b #0x14
    expect(BYTES_PER_ROW).toBe(40); // 20 word × 2
    expect(ROW_SKIP_BYTES).toBe(0x58); // moveq #0x58
    expect(ROW_STRIDE_BYTES).toBe(0x80); // 40 + 88
    expect(TOTAL_BYTES_COPIED).toBe(240); // 6 × 40
  });

  it("copia 240 byte contigui dalla ROM in 6 finestre da 40 byte (preservando i 88 byte di skip)", () => {
    const rom = emptyRomImage();
    // Pattern incrementale per beccare ogni byte univocamente.
    fillRomSource(rom, (i) => (i + 1) & 0xff);
    const pf = new Uint8Array(PF_SIZE).fill(0xcc);

    tilemapBlit17044(rom, pf);

    // Pre-DEST byte = 0xCC preservati
    for (let i = 0; i < DEST_OFF; i++) expect(pf[i]).toBe(0xcc);

    // Per ogni riga: prima 40 byte = ROM[i*40..(i+1)*40), poi 88 byte = 0xCC
    for (let row = 0; row < ROW_COUNT; row++) {
      const base = DEST_OFF + row * ROW_STRIDE_BYTES;
      for (let j = 0; j < BYTES_PER_ROW; j++) {
        const expected = ((row * BYTES_PER_ROW + j) + 1) & 0xff;
        expect(pf[base + j]).toBe(expected);
      }
      for (let j = BYTES_PER_ROW; j < ROW_STRIDE_BYTES; j++) {
        expect(pf[base + j]).toBe(0xcc);
      }
    }

    // Dopo l'ultima riga (oltre 0xA003BD = offset 0x3BE) il buffer è preservato.
    const afterLast = DEST_OFF + (ROW_COUNT - 1) * ROW_STRIDE_BYTES + BYTES_PER_ROW;
    expect(afterLast).toBe(0x3be);
    for (let i = afterLast; i < PF_SIZE; i++) {
      // a partire da afterLast, i byte successivi sono "skip" della riga 5
      // (88 byte) e oltre. Tutti devono restare 0xCC.
      expect(pf[i]).toBe(0xcc);
    }
  });

  it("preserva PF RAM fuori dal range [0x116..0x3BD] in modo bit-perfect", () => {
    const rom = emptyRomImage();
    fillRomSource(rom, () => 0x42);
    const pf = new Uint8Array(PF_SIZE);
    // Sentinel pattern in tutto il buffer
    for (let i = 0; i < PF_SIZE; i++) pf[i] = (i * 7) & 0xff;
    const before = new Uint8Array(pf);

    tilemapBlit17044(rom, pf);

    // [0..0x115] preservati
    for (let i = 0; i < DEST_OFF; i++) expect(pf[i]).toBe(before[i]);

    // Per ogni riga 0..5, i 40 byte iniziali = 0x42, i restanti 88 byte = before
    for (let row = 0; row < ROW_COUNT; row++) {
      const base = DEST_OFF + row * ROW_STRIDE_BYTES;
      for (let j = 0; j < BYTES_PER_ROW; j++) expect(pf[base + j]).toBe(0x42);
      for (let j = BYTES_PER_ROW; j < ROW_STRIDE_BYTES; j++) {
        expect(pf[base + j]).toBe(before[base + j]);
      }
    }

    // Dopo riga 5 (offset 0x3BE..0x3FFF circa di skip della riga 5) preservato
    const lastBlitEnd = DEST_OFF + (ROW_COUNT - 1) * ROW_STRIDE_BYTES + BYTES_PER_ROW;
    for (let i = lastBlitEnd; i < PF_SIZE; i++) {
      expect(pf[i]).toBe(before[i]);
    }
  });

  it("ROM all-zero → scrive zero in 6 finestre da 40 byte (ma 0xFF altrove)", () => {
    const rom = emptyRomImage(); // program zero-init
    const pf = new Uint8Array(PF_SIZE).fill(0xff);

    tilemapBlit17044(rom, pf);

    // Conta i byte azzerati: devono essere esattamente 6×40 = 240
    let zeros = 0;
    for (let i = 0; i < PF_SIZE; i++) if (pf[i] === 0) zeros++;
    expect(zeros).toBe(TOTAL_BYTES_COPIED);
  });

  it("BE word preservato: high byte all'offset pari, low byte al dispari", () => {
    const rom = emptyRomImage();
    // ROM ha pattern 0xAB,0xCD,0xAB,0xCD,... → ogni word = 0xABCD
    for (let i = 0; i < TOTAL_BYTES_COPIED; i += 2) {
      rom.program[ROM_SOURCE_ADDR + i] = 0xab;
      rom.program[ROM_SOURCE_ADDR + i + 1] = 0xcd;
    }
    const pf = new Uint8Array(PF_SIZE);
    tilemapBlit17044(rom, pf);

    for (let row = 0; row < ROW_COUNT; row++) {
      const base = DEST_OFF + row * ROW_STRIDE_BYTES;
      for (let w = 0; w < WORDS_PER_ROW; w++) {
        expect(pf[base + w * 2]).toBe(0xab);
        expect(pf[base + w * 2 + 1]).toBe(0xcd);
      }
    }
  });

  it("idempotente con la stessa ROM: due chiamate == una", () => {
    const rom = emptyRomImage();
    fillRomSource(rom, (i) => (i ^ 0x5a) & 0xff);

    const a = new Uint8Array(PF_SIZE).fill(0x33);
    tilemapBlit17044(rom, a);

    const b = new Uint8Array(PF_SIZE).fill(0x33);
    tilemapBlit17044(rom, b);
    tilemapBlit17044(rom, b);

    expect(b).toEqual(a);
  });

  it("buffer più corto: bound-safe, no overflow", () => {
    const rom = emptyRomImage();
    fillRomSource(rom, (i) => (i + 1) & 0xff);
    // Buffer da 0x200 byte: copre solo riga 0 e parzialmente riga 1.
    const small = new Uint8Array(0x200).fill(0xee);
    tilemapBlit17044(rom, small);
    // [0..0x115] preservati
    for (let i = 0; i < DEST_OFF; i++) expect(small[i]).toBe(0xee);
    // Riga 0: 0x116..0x13D = ROM[0..39]+1
    for (let j = 0; j < BYTES_PER_ROW; j++) {
      expect(small[DEST_OFF + j]).toBe((j + 1) & 0xff);
    }
    // Skip riga 0: 0x13E..0x195 preservati
    for (let j = BYTES_PER_ROW; j < ROW_STRIDE_BYTES; j++) {
      expect(small[DEST_OFF + j]).toBe(0xee);
    }
    // Riga 1: parziale fino alla fine del buffer (0x196..0x1FF = 0x6A byte)
    const row1Base = DEST_OFF + ROW_STRIDE_BYTES;
    const row1Available = small.length - row1Base; // 0x200 - 0x196 = 0x6A
    for (let j = 0; j < Math.min(BYTES_PER_ROW, row1Available); j++) {
      expect(small[row1Base + j]).toBe((BYTES_PER_ROW + j + 1) & 0xff);
    }
  });

  it("non legge ROM oltre 0x19F04 + 240 byte (no over-read da rom.program)", () => {
    // Costruiamo ROM in cui solo gli esatti 240 byte richiesti hanno valore
    // distintivo, e oltre c'è 0xFF. Verifichiamo che NESSUN 0xFF compaia in
    // PF RAM nelle 6 finestre da 40 byte (= la funzione non sfora la sorgente).
    const rom = emptyRomImage();
    // Dapprima riempiamo TUTTA la ROM con 0xFF.
    rom.program.fill(0xff);
    // Poi sovrascriviamo i 240 byte sorgenti con un pattern non-FF.
    for (let i = 0; i < TOTAL_BYTES_COPIED; i++) {
      rom.program[ROM_SOURCE_ADDR + i] = (i + 1) & 0xff;
    }
    // (Il byte successivo a 0x19F04+240 = 0x19FF4 è 0xFF.)
    const pf = new Uint8Array(PF_SIZE);
    tilemapBlit17044(rom, pf);
    // I 240 byte scritti in PF nei 6 blocchi devono essere tutti != 0xFF
    // (nessuno dei pattern 1..240 mod 256 è 0xFF tranne i==254 → ma 240 max < 254).
    for (let row = 0; row < ROW_COUNT; row++) {
      const base = DEST_OFF + row * ROW_STRIDE_BYTES;
      for (let j = 0; j < BYTES_PER_ROW; j++) {
        const v = pf[base + j] ?? 0;
        const expected = (row * BYTES_PER_ROW + j + 1) & 0xff;
        expect(v).toBe(expected);
        expect(v).not.toBe(0xff);
      }
    }
  });
});
