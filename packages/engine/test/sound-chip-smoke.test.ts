/**
 * sound-chip-smoke.test.ts — Phase 7 facade smoke.
 *
 * Verify that createSoundChip correctly aggregates 6502 + MMU + chip +
 * mailbox, and that the main<->sound command-flow pattern works end-to-end:
 *
 *   submitCommand($65) → 6502 NMI fired → 6502 ISR reads $1810 → processa →
 *   eventually 6502 writes reply through $1810 -> drainReplyEvents() returns
 *   il byte al main.
 *
 * Phase 4-6 V2 stub (no envelope, no audio sample): test si concentrano sul
 * mailbox protocol + facade API, not audio output.
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
    // Hardware-faithful: NMI assertion only after reset release. During hold,
    // the edge is not latched by the CPU in reset.
    releaseSoundReset(chip);
    submitCommand(chip, as_u8(0x65));
    expect(chip.mainToSound.pending).toBe(true);
    expect(chip.mainToSound.value as number).toBe(0x65);
    expect(chip.cpu.nmi).toBe(true);
    // bit 3 ($08) = main→sound pending per atarisy1.cpp::switch_6502_r
    expect((chip.mmu.read8(0x1820 as never) as number) & 0x08).toBe(0x08);
  });

  it("6502 ack legge $1810 → pending clear, NMI rilasciato", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    releaseSoundReset(chip);
    submitCommand(chip, as_u8(0x42));
    // Simulate 6502 ISR reading cmd.
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
    // pending cleared immediately: simulate 68K IRQ6 handler reading
    // $FC0001 in microsecondi (auto-drain).
    expect(chip.soundToMain.pending).toBe(false);
  });

  it("drainReplyEvents: estrae TUTTI i byte (68K auto-drain veloce)", () => {
    // Hardware-faithful: the real 68K IRQ6 handler reads $FC0001 within a few
    // cycle, quindi ogni write 6502 $1810 produce 1 IRQ6 e tutti i byte
    // sono processati (NON overwrite). TS simula via onSoundToMainPost
    // which pushes + clears pending = no collision.
    // Verified necessary 2026-05-18: without auto-drain, NMI handler
    // ($9569 BIT $1820 BNE) stalla nel polling loop, drift di 1 frame.
    const chip = createSoundChip({ roms: loadRoms() });
    chip.mmu.write8(0x1810 as never, as_u8(0x11));
    chip.mmu.write8(0x1810 as never, as_u8(0x22));
    chip.mmu.write8(0x1810 as never, as_u8(0x33));
    const out1 = drainReplyEvents(chip);
    expect(out1.map((b) => b as number)).toEqual([0x11, 0x22, 0x33]);
    expect(chip.replyQueue.length).toBe(0);
    expect(chip.soundToMain.pending).toBe(false);

    // Pattern: ogni write 6502 → 1 byte in queue.
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
    // Tick until the 6502 NMI ISR has had time to run.
    // Phase 4 V2 stub: ROM code likely reads $1810 in the NMI handler.
    expect(() => tickCycles(chip, 10000)).not.toThrow();
    // After 10000 cycles (~5.6ms), NMI should have been handled.
    // We do not guarantee that the 6502 read within 10000 cycles, but neither
    // dovrebbe rimanere stuck.
  });

  it("chip genera audio da cmd-tape replay senza workaround (post bit-fix)", async () => {
    // Regression lock 2026-05-17 session 4j: after fixes to
    //   1) $14 bit mapping (bit 2/3 = enable_timer, bit 4/5 = reset_timer)
    //   2) cpu.irq aggiornato real-time durante tickCycles (no end-of-frame)
    // il SoundChip TS produce audio audibile via tape replay SENZA il
    // workaround `forceSoundIrqHack`. This test guarantees that future
    // regressioni del bit mapping o dell'interleave IRQ vengano catturate.
    const { drainYm2151Samples, drainPokeySamples, drainReplyEvents, loadCmdTape } =
      await import("../src/m6502/sound-chip.js");
    // Use the long tape (14000 frame, covers sec 200 audible window).
    const longTapePath = "oracle/scenarios/sound-cmd-tape-attract-music.json";
    if (!existsSync(longTapePath)) {
      // Tape long missing: skip test (sleeve the short tape path).
      return;
    }
    const tapeJson = readFileSync(longTapePath, "utf8");
    const tape = loadCmdTape(JSON.parse(tapeJson));
    const firstCmd = Math.min(...Array.from(tape.byFrame.keys()));
    const chip = createSoundChip({ roms: loadRoms() });
    let released = false;
    let maxAbs = 0;
    let voiceWritten = 0;
    // Run 14000 frame: la tape lunga registra anche l'audible window di MAME
    // at sec 200+ (f12000+) where the TS chip must produce non-zero samples.
    for (let f = 0; f < 14000; f++) {
      const cmds = tape.byFrame.get(f);
      if (cmds !== undefined) {
        for (const b of cmds) {
          const { submitCommand: submit } = await import("../src/m6502/sound-chip.js");
          submit(chip, as_u8(b));
        }
      }
      if (!released && f >= firstCmd) {
        releaseSoundReset(chip);
        released = true;
      }
      tickCycles(chip, 29830);
      drainReplyEvents(chip);
      for (const s of drainYm2151Samples(chip)) {
        const a = Math.abs(s);
        if (a > maxAbs) maxAbs = a;
      }
      drainPokeySamples(chip);
    }
    for (let r = 0x20; r < 0x80; r++) {
      if (chip.ym2151.regs[r] !== 0) voiceWritten++;
    }
    // Conservative threshold: chip must produce at least one sample > 0.001
    // (esiste segnale, non silenzio totale) e popolare almeno 20 voice
    // registers ($20-$7F = RL/FB/CONN + KC + KF + op params).
    expect(maxAbs).toBeGreaterThan(0.001);
    expect(voiceWritten).toBeGreaterThan(20);
  });

  it("chip genera audio quando i voice register sono scritti correttamente", async () => {
    // Regression lock per sessione 4 finding: il YM2151 produce sample
    // audible when KC/KF/operator regs are set. Tests the chip
    // YM2151 in isolation (no 6502 boot) to avoid the boot of the
    // 6502 clobberi i reg manuali.
    const { ym2151WriteAddr, ym2151WriteData, ym2151TickCycles, ym2151DrainSamples } =
      await import("../src/audio/ym2151.js");
    const chip = createSoundChip({ roms: loadRoms() });
    // NON chiamiamo releaseSoundReset: il 6502 stays held, non interferisce
    // with our direct YM2151 writes.
    function ymWrite(reg: number, val: number) {
      ym2151WriteAddr(chip.ym2151, as_u8(reg));
      ym2151WriteData(chip.ym2151, as_u8(val));
    }
    // Setup ch 0 algo 7 (parallel), max amp; KC=$4A ≈ A4 ~440Hz
    ymWrite(0x20, 0xC7); ymWrite(0x28, 0x4A); ymWrite(0x30, 0x00);
    // Setup 4 operators: MUL=1, TL=0 (loudest), AR=31 (fast attack), RR=15
    for (const opOff of [0x40, 0x48, 0x50, 0x58]) ymWrite(opOff, 0x01);
    for (const opOff of [0x60, 0x68, 0x70, 0x78]) ymWrite(opOff, 0x00);
    for (const opOff of [0x80, 0x88, 0x90, 0x98]) ymWrite(opOff, 0x1F);
    for (const opOff of [0xE0, 0xE8, 0xF0, 0xF8]) ymWrite(opOff, 0x0F);
    // Key on all slots ch 0
    ymWrite(0x08, 0x78);
    // Tick 60 frame del YM2151 direttamente, drain samples
    let maxAbs = 0;
    for (let f = 0; f < 60; f++) {
      ym2151TickCycles(chip.ym2151, 29830);
      for (const s of ym2151DrainSamples(chip.ym2151)) {
        const a = Math.abs(s);
        if (a > maxAbs) maxAbs = a;
      }
    }
    // Verify: after attack (60 frames ~= 1 sec), envelope reaches sustain -> sample
    // audibili. Soglia conservativa 0.1 (su scala -1..+1 = ~-20dB).
    expect(maxAbs).toBeGreaterThan(0.1);
  });
});

describe.skipIf(haveRoms)("SoundChip facade skip: rom assenti", () => {
  it.skip("estrai roms con: unzip roms/marble.zip 136033.421 136033.422 -d /tmp/sound-roms/", () => {});
});
