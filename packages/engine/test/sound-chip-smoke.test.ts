/**
 * sound-chip-smoke.test.ts — Phase 7 facade smoke.
 *
 * Verifica che createSoundChip aggrega correttamente 6502 + MMU + chip +
 * mailbox, e che il pattern command-flow main↔sound funziona end-to-end:
 *
 *   submitCommand($65) → 6502 NMI fired → 6502 ISR reads $1810 → processa →
 *   eventualmente 6502 scrive reply via $1810 → drainReplyEvents() restituisce
 *   il byte al main.
 *
 * Phase 4-6 V2 stub (no envelope, no audio sample): test si concentrano sul
 * protocol mailbox + facade API, non sull'output sonoro.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { as_u8 } from "../src/wrap.js";
import {
  createSoundChip, tickCycles, submitCommand, drainReplyEvents, releaseSoundReset,
  getRegisterShadow, resetSoundChip,
} from "../src/m6502/sound-chip.js";

const ROM_421 = "/tmp/sound-roms/136033.421";
const ROM_422 = "/tmp/sound-roms/136033.422";
const haveRoms = existsSync(ROM_421) && existsSync(ROM_422);

function loadRoms() {
  return {
    rom421: new Uint8Array(readFileSync(ROM_421)),
    rom422: new Uint8Array(readFileSync(ROM_422)),
  };
}

describe.skipIf(!haveRoms)("SoundChip facade", () => {
  it("createSoundChip: aggrega tutto, PC reset valido", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    expect(chip.cpu.rf.pc as number).toBeGreaterThanOrEqual(0x4000);
    expect(chip.mmu.ram.length).toBe(0x1000);
    expect(chip.ym2151.regs.length).toBe(256);
    expect(chip.pokey.writeRegs.length).toBe(16);
    expect(chip.replyQueue.length).toBe(0);
    expect(chip.mainToSound.pending).toBe(false);
  });

  it("tickCycles: 6502 avanza post-release, no throw su boot code 5000 cycle", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    releaseSoundReset(chip);
    expect(() => tickCycles(chip, 5000)).not.toThrow();
    expect(chip.cpu.cycles).toBeGreaterThanOrEqual(5000);
  });

  it("submitCommand post-release: asserisce NMI 6502, status $1820 bit 3 set", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    // Hardware-faithful: NMI assertion solo dopo reset release (durante hold,
    // l'edge non viene latched dal CPU in reset).
    releaseSoundReset(chip);
    submitCommand(chip, as_u8(0x65));
    expect(chip.mainToSound.pending).toBe(true);
    expect(chip.mainToSound.value as number).toBe(0x65);
    expect(chip.cpu.nmi).toBe(true);
    // bit 3 ($08) = main→sound pending per atarisy1.cpp::switch_6502_r
    expect(chip.mmu.read8(0x1820 as never) as number & 0x08).toBe(0x08);
  });

  it("6502 ack legge $1810 → pending clear, NMI rilasciato", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    releaseSoundReset(chip);
    submitCommand(chip, as_u8(0x42));
    // Simula 6502 ISR che legge cmd
    const cmd = chip.mmu.read8(0x1810 as never);
    expect(cmd as number).toBe(0x42);
    expect(chip.mainToSound.pending).toBe(false);
    expect(chip.cpu.nmi).toBe(false);
  });

  it("6502 scrive reply $1810 → byte in replyQueue", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    chip.mmu.write8(0x1810 as never, as_u8(0x99));
    expect(chip.replyQueue.length).toBe(1);
    expect(chip.replyQueue[0]).toBe(0x99);
    expect(chip.soundToMain.pending).toBe(true);
  });

  it("drainReplyEvents: estrae byte edge-triggered, hardware-correct", () => {
    // Comportamento hardware: sound→main latch e' overwrite-on-write quando
    // pending. Il main DEVE leggere $FC0001 tra scritture per non perdere
    // byte. Edge-triggered callback push solo sulla transizione false→true.
    const chip = createSoundChip({ roms: loadRoms() });
    chip.mmu.write8(0x1810 as never, as_u8(0x11));
    // Senza ack del main, una seconda write 6502 sovrascrive il latch ma NON
    // ri-arma il callback (gia' pending). Realismo: 6502 farebbe poll $1820
    // bit 3 prima di STA $1810.
    chip.mmu.write8(0x1810 as never, as_u8(0x22));
    chip.mmu.write8(0x1810 as never, as_u8(0x33));
    const out1 = drainReplyEvents(chip);
    expect(out1.map((b) => b as number)).toEqual([0x11]);
    expect(chip.replyQueue.length).toBe(0);
    expect(chip.soundToMain.pending).toBe(false);

    // Pattern corretto: main legge → 6502 scrive nuovo → main legge → ...
    chip.mmu.write8(0x1810 as never, as_u8(0xAA));
    expect(drainReplyEvents(chip).map((b) => b as number)).toEqual([0xAA]);
    chip.mmu.write8(0x1810 as never, as_u8(0xBB));
    expect(drainReplyEvents(chip).map((b) => b as number)).toEqual([0xBB]);
  });

  it("getRegisterShadow: ref a buffer shadow per oracle diff", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    const shadow = getRegisterShadow(chip);
    expect(shadow.audioRam).toBe(chip.mmu.ram);
    expect(shadow.ym2151Regs).toBe(chip.ym2151.regs);
    expect(shadow.pokeyWriteRegs).toBe(chip.pokey.writeRegs);
  });

  it("resetSoundChip: pulisce stato, PC ri-fetch da reset vector", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    submitCommand(chip, as_u8(0xff));
    chip.mmu.write8(0x1810 as never, as_u8(0xee));
    tickCycles(chip, 1000);
    expect(chip.replyQueue.length).toBeGreaterThan(0);

    resetSoundChip(chip);

    expect(chip.mainToSound.pending).toBe(false);
    expect(chip.soundToMain.pending).toBe(false);
    expect(chip.replyQueue.length).toBe(0);
    expect(Array.from(chip.ym2151.regs).every((b) => b === 0)).toBe(true);
    expect(Array.from(chip.pokey.writeRegs).every((b) => b === 0)).toBe(true);
    expect(chip.cpu.rf.pc as number).toBeGreaterThanOrEqual(0x4000);
  });

  it("end-to-end command sequence: cmd $65 → tick → 6502 ack senza crash", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    submitCommand(chip, as_u8(0x65));
    // Tick fino a che il NMI ISR del 6502 ha avuto tempo di girare.
    // Phase 4 V2 stub: il codice ROM probabilmente legge $1810 nel handler NMI.
    expect(() => tickCycles(chip, 10000)).not.toThrow();
    // Dopo 10000 cycle (~5.6ms), il NMI dovrebbe essere stato gestito.
    // Non garantiamo che il 6502 abbia letto entro 10000 cycle, ma neanche
    // dovrebbe rimanere stuck.
  });
});

describe.skipIf(haveRoms)("SoundChip facade skip: rom assenti", () => {
  it.skip("estrai roms con: unzip roms/marble.zip 136033.421 136033.422 -d /tmp/sound-roms/", () => {});
});
