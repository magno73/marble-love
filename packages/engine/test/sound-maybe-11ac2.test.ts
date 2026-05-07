/**
 * sound-maybe-11ac2.test.ts — unit test per soundMaybe11AC2 (FUN_11AC2).
 *
 * Bit-perfect parity verificata vs binary in
 * `packages/cli/src/test-sound-maybe-11ac2-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { soundMaybe11AC2, COPY_WORD_COUNT, ROM_TABLE_OFFSET, WORK_RAM_DEST_OFFSET } from "../src/sound-maybe-11ac2.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

/** Costruisce un RomImage con pattern noto nella tabella a ROM_TABLE_OFFSET. */
function makeRomWithTable(words: readonly number[]): ReturnType<typeof emptyRomImage> {
  const rom = emptyRomImage();
  for (let i = 0; i < words.length; i++) {
    const w = (words[i] ?? 0) & 0xffff;
    rom.program[ROM_TABLE_OFFSET + i * 2] = (w >>> 8) & 0xff;
    rom.program[ROM_TABLE_OFFSET + i * 2 + 1] = w & 0xff;
  }
  return rom;
}

describe("soundMaybe11AC2 (FUN_11AC2)", () => {
  it("copia esattamente 66 word (132 byte) da ROM a workRam", () => {
    const state = emptyGameState();
    const words = Array.from({ length: COPY_WORD_COUNT }, (_, i) => i + 1);
    const rom = makeRomWithTable(words);

    // Pre-condizione: workRam è tutto zero (emptyGameState).
    expect(state.workRam[WORK_RAM_DEST_OFFSET]).toBe(0);

    soundMaybe11AC2(state, rom);

    // Verifica tutte e 66 word.
    for (let i = 0; i < COPY_WORD_COUNT; i++) {
      const expected = (i + 1) & 0xffff;
      const hi = state.workRam[WORK_RAM_DEST_OFFSET + i * 2] ?? 0;
      const lo = state.workRam[WORK_RAM_DEST_OFFSET + i * 2 + 1] ?? 0;
      const got = (hi << 8) | lo;
      expect(got, `word[${i}]`).toBe(expected);
    }
  });

  it("non tocca i byte immediatamente prima del range di destinazione", () => {
    const state = emptyGameState();
    // Poni un marcatore subito prima.
    if (WORK_RAM_DEST_OFFSET > 0) {
      state.workRam[WORK_RAM_DEST_OFFSET - 1] = 0xAB;
    }
    const rom = makeRomWithTable(Array(COPY_WORD_COUNT).fill(0x1234));
    soundMaybe11AC2(state, rom);
    if (WORK_RAM_DEST_OFFSET > 0) {
      expect(state.workRam[WORK_RAM_DEST_OFFSET - 1]).toBe(0xAB);
    }
  });

  it("non tocca i byte immediatamente dopo il range di destinazione", () => {
    const state = emptyGameState();
    const endOff = WORK_RAM_DEST_OFFSET + COPY_WORD_COUNT * 2;
    state.workRam[endOff] = 0xCD;
    const rom = makeRomWithTable(Array(COPY_WORD_COUNT).fill(0xBEEF));
    soundMaybe11AC2(state, rom);
    expect(state.workRam[endOff]).toBe(0xCD);
  });

  it("copia word big-endian correttamente (byte alto poi byte basso)", () => {
    const state = emptyGameState();
    const rom = makeRomWithTable([0xDEAD, 0xBEEF]);
    soundMaybe11AC2(state, rom);

    // Prima word: 0xDEAD → byte 0 = 0xDE, byte 1 = 0xAD.
    expect(state.workRam[WORK_RAM_DEST_OFFSET + 0]).toBe(0xDE);
    expect(state.workRam[WORK_RAM_DEST_OFFSET + 1]).toBe(0xAD);
    // Seconda word: 0xBEEF → byte 2 = 0xBE, byte 3 = 0xEF.
    expect(state.workRam[WORK_RAM_DEST_OFFSET + 2]).toBe(0xBE);
    expect(state.workRam[WORK_RAM_DEST_OFFSET + 3]).toBe(0xEF);
  });

  it("sovrascrive il contenuto precedente di workRam nel range", () => {
    const state = emptyGameState();
    // Pre-riempi il range con 0xFF.
    for (let i = 0; i < COPY_WORD_COUNT * 2; i++) {
      state.workRam[WORK_RAM_DEST_OFFSET + i] = 0xFF;
    }
    const rom = makeRomWithTable(Array(COPY_WORD_COUNT).fill(0x0000));
    soundMaybe11AC2(state, rom);
    for (let i = 0; i < COPY_WORD_COUNT * 2; i++) {
      expect(state.workRam[WORK_RAM_DEST_OFFSET + i], `byte[${i}]`).toBe(0x00);
    }
  });

  it("con ROM tutta zero → workRam[0x76E..0x7F1] tutto zero", () => {
    const state = emptyGameState();
    // Pre-sporciamo la zona.
    for (let i = 0; i < COPY_WORD_COUNT * 2; i++) {
      state.workRam[WORK_RAM_DEST_OFFSET + i] = 0xAA;
    }
    const rom = emptyRomImage(); // ROM tutta zero.
    soundMaybe11AC2(state, rom);
    for (let i = 0; i < COPY_WORD_COUNT * 2; i++) {
      expect(state.workRam[WORK_RAM_DEST_OFFSET + i], `byte[${i}]`).toBe(0);
    }
  });

  it("l'ultima word viene copiata (boundary: i = 65)", () => {
    const state = emptyGameState();
    const words = Array(COPY_WORD_COUNT).fill(0x0000) as number[];
    words[COPY_WORD_COUNT - 1] = 0x5A5A;
    const rom = makeRomWithTable(words);
    soundMaybe11AC2(state, rom);

    const lastByteOff = WORK_RAM_DEST_OFFSET + (COPY_WORD_COUNT - 1) * 2;
    expect(state.workRam[lastByteOff]).toBe(0x5A);
    expect(state.workRam[lastByteOff + 1]).toBe(0x5A);
  });

  it("non modifica altri campi di GameState (spriteRam, alphaRam, colorRam, playfieldRam)", () => {
    const state = emptyGameState();
    const rom = makeRomWithTable(Array(COPY_WORD_COUNT).fill(0xFF00));
    const beforeSprite = new Uint8Array(state.spriteRam);
    const beforeAlpha = new Uint8Array(state.alphaRam);
    const beforeColor = new Uint8Array(state.colorRam);
    const beforePf = new Uint8Array(state.playfieldRam);

    soundMaybe11AC2(state, rom);

    expect(state.spriteRam).toEqual(beforeSprite);
    expect(state.alphaRam).toEqual(beforeAlpha);
    expect(state.colorRam).toEqual(beforeColor);
    expect(state.playfieldRam).toEqual(beforePf);
  });

  it("idempotente: seconda chiamata sovrascrive identicamente con stessa ROM", () => {
    const state = emptyGameState();
    const rom = makeRomWithTable(Array.from({ length: COPY_WORD_COUNT }, (_, i) => (i * 3 + 7) & 0xffff));
    soundMaybe11AC2(state, rom);
    const after1 = new Uint8Array(state.workRam);
    soundMaybe11AC2(state, rom);
    expect(state.workRam).toEqual(after1);
  });
});
