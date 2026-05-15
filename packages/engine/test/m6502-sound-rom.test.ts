/**
 * m6502-sound-rom.test.ts — loader buffer 48KB da 136033.421 + .422.
 *
 * Intent: il sound chip 6502 fetcha reset vector da $FFFC/$FFFD, che fisicamente
 * vivono negli ultimi 4 byte di rom422 (offset $3FFC/$3FFD nel file). Se il
 * loader sbaglia bank order o offset di base, il CPU resetta a un PC arbitrario
 * e crasha al primo step. Questi test sigillano il mapping vs MAME atarisy1.cpp.
 */

import { describe, it, expect } from "vitest";
import { buildSoundRom, SOUND_ROM_BUFFER_SIZE } from "../src/m6502/sound-rom.js";

describe("buildSoundRom layout", () => {
  it("buffer 48KB con 421 a $8000 (offset 0x4000) e 422 a $C000 (offset 0x8000)", () => {
    const rom421 = new Uint8Array(0x4000);
    const rom422 = new Uint8Array(0x4000);
    rom421[0] = 0xAA;
    rom421[0x3FFF] = 0xBB;
    rom422[0] = 0xCC;
    rom422[0x3FFF] = 0xDD;
    const buf = buildSoundRom({ rom421, rom422 });
    expect(buf.length).toBe(SOUND_ROM_BUFFER_SIZE);
    // Area $4000-$7FFF (buffer 0x0000-0x3FFF): open bus 0xFF
    expect(buf[0x0000]).toBe(0xff);
    expect(buf[0x3FFF]).toBe(0xff);
    // 136033.421 mapped a $8000 → buffer offset 0x4000
    expect(buf[0x4000]).toBe(0xAA);
    expect(buf[0x7FFF]).toBe(0xBB);
    // 136033.422 mapped a $C000 → buffer offset 0x8000
    expect(buf[0x8000]).toBe(0xCC);
    expect(buf[0xBFFF]).toBe(0xDD);
  });

  it("reset vector $FFFC/$FFFD finisce in rom422 offset $3FFC/$3FFD", () => {
    const rom421 = new Uint8Array(0x4000);
    const rom422 = new Uint8Array(0x4000);
    rom422[0x3FFC] = 0x00;
    rom422[0x3FFD] = 0x80;  // PC start = $8000
    const buf = buildSoundRom({ rom421, rom422 });
    // $FFFC nel address space 6502 → buffer offset $FFFC - $4000 = $BFFC
    expect(buf[0xBFFC]).toBe(0x00);
    expect(buf[0xBFFD]).toBe(0x80);
  });

  it("fail loud su size sbagliato (Rule 12)", () => {
    const tooSmall = new Uint8Array(0x2000);
    const ok = new Uint8Array(0x4000);
    expect(() => buildSoundRom({ rom421: tooSmall, rom422: ok }))
      .toThrow(/136033\.421 size atteso 0x4000/);
    expect(() => buildSoundRom({ rom421: ok, rom422: tooSmall }))
      .toThrow(/136033\.422 size atteso 0x4000/);
  });
});
