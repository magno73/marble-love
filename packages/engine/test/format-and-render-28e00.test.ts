/**
 * Test formatAndRender28E00 (FUN_28E00) — smoke tests sui rami principali.
 *
 * Bit-perfect verificato vs binary (500/500) tramite
 * `cli/src/test-format-and-render-28e00-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  formatAndRender28E00,
  BUFEND_PTR_OFF,
  STRUCT_BASE_OFF,
  ATTR_WORD,
} from "../src/format-and-render-28e00.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

/** Helper: scrive un long big-endian in workRam @ off. */
function writeWorkLong(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 24) & 0xff;
  ram[off + 1] = (value >>> 16) & 0xff;
  ram[off + 2] = (value >>> 8) & 0xff;
  ram[off + 3] = value & 0xff;
}

describe("formatAndRender28E00 (FUN_28E00)", () => {
  it("formatHex: scrive cifre hex backward dal bufEnd letto da *0x400436, terminato da NUL", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    // Setup: *0x400436 = 0x00401D00 → buffer in workRam @ 0x1D00.
    // Rotation default 0, tickOff 0, marker 0 → renderStringChain esce subito
    // dopo il primo render della stringa puntata da struct[+2].
    // struct +2 = workRam[0x436] = bufEnd ptr letto da formatHex.
    writeWorkLong(s.workRam, BUFEND_PTR_OFF, 0x00401d00);

    // arg2Word = 4 (numDigits), arg1Long = 0xABCD
    // arg3Word/arg4Word = 0/0 (col, tickOff). callerD2Word = 0 (no spaces).
    formatAndRender28E00(s, rom, 0xabcd, 4, 0, 0, 0);

    // formatHex con value=0xABCD numDigits=4: scrive 4 cifre hex + null.
    // Backward dal bufEnd+numDigits = 0x401D04: '\0' @ 1D04, 'D' @ 1D03,
    // 'C' @ 1D02, 'B' @ 1D01, 'A' @ 1D00.
    expect(s.workRam[0x1d00]).toBe(0x41); // 'A'
    expect(s.workRam[0x1d01]).toBe(0x42); // 'B'
    expect(s.workRam[0x1d02]).toBe(0x43); // 'C'
    expect(s.workRam[0x1d03]).toBe(0x44); // 'D'
    expect(s.workRam[0x1d04]).toBe(0x00); // null term
  });

  it("initStructHeader (via FUN_28FDE): scrive arg3.lo @ 0x434, arg4.lo @ 0x435, 0 @ 0x43A", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    // Pre-pollute 0x434/0x435/0x43A per vedere che vengono scritti.
    s.workRam[STRUCT_BASE_OFF] = 0xff;
    s.workRam[STRUCT_BASE_OFF + 1] = 0xff;
    s.workRam[STRUCT_BASE_OFF + 6] = 0xff;
    // Imposta bufEnd a un'area "scratch" innocua.
    writeWorkLong(s.workRam, BUFEND_PTR_OFF, 0x00401e00);

    // arg3=0x12, arg4=0xAB → scrive low byte di ognuno.
    formatAndRender28E00(s, rom, 0, 0, 0x12, 0xab, 0);

    expect(s.workRam[STRUCT_BASE_OFF]).toBe(0x12); // 0x434 = arg3.lowByte
    expect(s.workRam[STRUCT_BASE_OFF + 1]).toBe(0xab); // 0x435 = arg4.lowByte
    expect(s.workRam[STRUCT_BASE_OFF + 6]).toBe(0x00); // 0x43A azzerato
  });

  it("renderStringChain: il render usa attrWord=0x3400 e struct@0x400434 (smoke render)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    // *0x400436 = string buffer ptr — coincide col campo `struct+2` letto da
    // renderStringChain (formatHex scrive PROPRIO nel buffer che poi viene
    // renderizzato). Punta a workRam[0x500].
    writeWorkLong(s.workRam, BUFEND_PTR_OFF, 0x00400500);

    // value=0, numDigits=0 (no formatHex digits: scrive solo '0' come case
    // speciale "value==0" e il null terminator). arg3 (col) = 0, arg4
    // (tickOff) = 0. State machine dummy: rotation 0, tick 0, marker 0.
    s.alphaRam.fill(0x00);
    formatAndRender28E00(s, rom, 0, 0, 0, 0, 0);

    // formatHex con value=0 numDigits=0: scrive null @ bufEnd+0=0x500, poi
    // (value==0 special) scrive '0' @ bufEnd-1 = 0x4FF, poi numDigits diventa
    // -1 e (D0-=1) = -2 → bmi exit. Quindi buffer = ['0', '\0', ...].
    expect(s.workRam[0x4ff]).toBe(0x30); // '0'
    expect(s.workRam[0x500]).toBe(0x00); // null

    // renderStringChain legge string ptr = *0x400436 = 0x400500 (LO è il null
    // terminator per il loop char), quindi NON renderizza nulla. Verify alpha
    // intatto.
    for (let i = 0; i < 16; i++) {
      expect(s.alphaRam[i]).toBe(0x00);
    }
    expect(ATTR_WORD).toBe(0x3400);
  });

  it("callerD2Word usato come showSpaces: value==0 + showSpaces==1 → leading spaces", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    writeWorkLong(s.workRam, BUFEND_PTR_OFF, 0x00401d00);

    // value=0, numDigits=4, showSpaces=1. formatHex: il primo char (value==0)
    // scrive '0' a bufEnd+numDigits-1 = 0x1D03; poi loop con D1==0 e
    // showSpaces==1 produce ' ' (0x20) per le rimanenti cifre.
    formatAndRender28E00(s, rom, 0, 4, 0, 0, /*callerD2Word*/ 1);

    expect(s.workRam[0x1d03]).toBe(0x30); // '0' (primo digit pre-loop)
    expect(s.workRam[0x1d02]).toBe(0x20); // ' ' (showSpaces effetto)
    expect(s.workRam[0x1d01]).toBe(0x20); // ' '
    expect(s.workRam[0x1d00]).toBe(0x20); // ' '
    expect(s.workRam[0x1d04]).toBe(0x00); // null term
  });

  it("arg2Word negativo (signed sext): numDigits ≤ 0 → formatHex no-op (oltre il '0' iniziale)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    writeWorkLong(s.workRam, BUFEND_PTR_OFF, 0x00401d00);
    s.workRam.fill(0x55, 0x1d00, 0x1d10); // sentinel

    // arg2Word = 0x8000 → sext_l = -32768. formatHex con numDigits=-32768:
    //   bufEnd + numDigits = 0x401D00 - 0x8000 = 0x399D00 (out-of-range);
    //   il null e i digit finiscono fuori workRam (no-op via writeMemoryU8).
    formatAndRender28E00(s, rom, 0xdeadbeef, 0x8000, 0, 0, 0);

    // Sentinel 0x55 deve essere preservato @ 0x1D00..0x1D0F (formatHex non
    // tocca questa area perché bufEnd è altrove).
    for (let i = 0; i < 16; i++) {
      expect(s.workRam[0x1d00 + i]).toBe(0x55);
    }
  });
});
