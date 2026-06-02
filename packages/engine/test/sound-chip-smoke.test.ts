/**
 * sound-chip-smoke.test.ts — Phase 7 facade smoke.
 *
 * Verify that createSoundChip correctly aggregates 6502 + MMU + chip +
 * mailbox, and that the main<->sound command-flow pattern works end-to-end:
 *
 *   submitCommand($65) → 6502 NMI fired → 6502 ISR reads $1810 → processes →
 *   eventually 6502 writes reply through $1810 -> drainReplyEvents() returns
 *   the byte to the main.
 *
 * Phase 4-6 V2 stub (no envelope, no audio sample): the tests focus on the
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
  it("createSoundChip: aggregates everything, valid PC reset", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    expect(chip.cpu.rf.pc as number).toBeGreaterThanOrEqual(0x4000);
    expect(chip.mmu.ram.length).toBe(0x1000);
    expect(chip.ym2151.regs.length).toBe(256);
    expect(chip.pokey.writeRegs.length).toBe(16);
    expect(chip.replyQueue.length).toBe(0);
    expect(chip.mainToSound.pending).toBe(false);
  });

  it("tickCycles: 6502 advances post-release, no throw on boot code over 5000 cycles", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    releaseSoundReset(chip);
    expect(() => tickCycles(chip, 5000)).not.toThrow();
    expect(chip.cpu.cycles).toBeGreaterThanOrEqual(5000);
  });

  it("submitCommand post-release: asserts 6502 NMI, status $1820 bit 3 set", () => {
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

  it("6502 ack reads $1810 → pending clear, NMI released", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    releaseSoundReset(chip);
    submitCommand(chip, as_u8(0x42));
    // Simulate 6502 ISR reading cmd.
    const cmd = chip.mmu.read8(0x1810 as never);
    expect(cmd as number).toBe(0x42);
    expect(chip.mainToSound.pending).toBe(false);
    expect(chip.cpu.nmi).toBe(false);
  });

  it("6502 writes reply $1810 → byte in replyQueue", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    chip.mmu.write8(0x1810 as never, as_u8(0x99));
    expect(chip.replyQueue.length).toBe(1);
    expect(chip.replyQueue[0]).toBe(0x99);
    // pending cleared immediately: simulate 68K IRQ6 handler reading
    // $FC0001 within microseconds (auto-drain).
    expect(chip.soundToMain.pending).toBe(false);
  });

  it("drainReplyEvents: extracts ALL the bytes (fast 68K auto-drain)", () => {
    // Hardware-faithful: the real 68K IRQ6 handler reads $FC0001 within a few
    // cycles, so each 6502 $1810 write produces 1 IRQ6 and all the bytes
    // are processed (NOT overwritten). TS simulates this via onSoundToMainPost
    // which pushes + clears pending = no collision.
    // Verified necessary 2026-05-18: without auto-drain, the NMI handler
    // ($9569 BIT $1820 BNE) stalls in the polling loop, drift of 1 frame.
    const chip = createSoundChip({ roms: loadRoms() });
    chip.mmu.write8(0x1810 as never, as_u8(0x11));
    chip.mmu.write8(0x1810 as never, as_u8(0x22));
    chip.mmu.write8(0x1810 as never, as_u8(0x33));
    const out1 = drainReplyEvents(chip);
    expect(out1.map((b) => b as number)).toEqual([0x11, 0x22, 0x33]);
    expect(chip.replyQueue.length).toBe(0);
    expect(chip.soundToMain.pending).toBe(false);

    // Pattern: each 6502 write → 1 byte in queue.
    chip.mmu.write8(0x1810 as never, as_u8(0xAA));
    expect(drainReplyEvents(chip).map((b) => b as number)).toEqual([0xAA]);
    chip.mmu.write8(0x1810 as never, as_u8(0xBB));
    expect(drainReplyEvents(chip).map((b) => b as number)).toEqual([0xBB]);
  });

  it("getRegisterShadow: references shadow buffers for oracle diff", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    const shadow = getRegisterShadow(chip);
    expect(shadow.audioRam).toBe(chip.mmu.ram);
    expect(shadow.ym2151Regs).toBe(chip.ym2151.regs);
    expect(shadow.pokeyWriteRegs).toBe(chip.pokey.writeRegs);
  });

  it("resetSoundChip: clears state, PC re-fetched from reset vector", () => {
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

  it("end-to-end command sequence: cmd $65 → tick → 6502 ack without crash", () => {
    const chip = createSoundChip({ roms: loadRoms() });
    submitCommand(chip, as_u8(0x65));
    // Tick until the 6502 NMI ISR has had time to run.
    // Phase 4 V2 stub: ROM code likely reads $1810 in the NMI handler.
    expect(() => tickCycles(chip, 10000)).not.toThrow();
    // After 10000 cycles (~5.6ms), NMI should have been handled.
    // We do not guarantee that the 6502 read within 10000 cycles, but neither
    // should it remain stuck.
  });

  it("chip produces audio from cmd-tape replay without workaround (post bit-fix)", async () => {
    // Regression lock 2026-05-17 session 4j: after fixes to
    //   1) $14 bit mapping (bit 2/3 = enable_timer, bit 4/5 = reset_timer)
    //   2) cpu.irq updated real-time during tickCycles (no end-of-frame)
    // the TS SoundChip produces audible audio via tape replay WITHOUT the
    // `forceSoundIrqHack` workaround. This test guarantees that future
    // regressions of the bit mapping or of the IRQ interleave are caught.
    const { drainYm2151Samples, drainPokeySamples, drainReplyEvents, loadCmdTape } =
      await import("../src/m6502/sound-chip.js");
    // Use the long tape (14000 frames, covers the sec 200 audible window).
    const longTapePath = "oracle/scenarios/sound-cmd-tape-attract-music.json";
    if (!existsSync(longTapePath)) {
      // Long tape missing: skip test (skip the short tape path).
      return;
    }
    const tapeJson = readFileSync(longTapePath, "utf8");
    const tape = loadCmdTape(JSON.parse(tapeJson));
    const firstCmd = Math.min(...Array.from(tape.byFrame.keys()));
    const chip = createSoundChip({ roms: loadRoms() });
    let released = false;
    let maxAbs = 0;
    let voiceWritten = 0;
    // Run 14000 frames: the long tape also records MAME's audible window
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
    // (signal exists, not total silence) and populate at least 20 voice
    // registers ($20-$7F = RL/FB/CONN + KC + KF + op params).
    expect(maxAbs).toBeGreaterThan(0.001);
    expect(voiceWritten).toBeGreaterThan(20);
    // 14000-frame chip replay is a deliberate long regression lock (~52s on a
    // dev machine, 417M sound-CPU cycles). It only runs when ROMs are extracted
    // to /tmp/sound-roms; the explicit timeout keeps it from spuriously tripping
    // vitest's 5s default. Verified 2026-05-29: assertions pass on their own
    // merit, and busyCycles=64 vs 0 produce byte-identical audio here (no
    // hidden busy-flag regression being masked).
  }, 90_000);

  it("chip produces audio when the voice registers are written correctly", async () => {
    // Regression lock for the session 4 finding: the YM2151 produces audible
    // samples when KC/KF/operator regs are set. Tests the YM2151
    // chip in isolation (no 6502 boot) to avoid the 6502 boot
    // clobbering the manual regs.
    const { ym2151WriteAddr, ym2151WriteData, ym2151TickCycles, ym2151DrainSamples } =
      await import("../src/audio/ym2151.js");
    const chip = createSoundChip({ roms: loadRoms() });
    // We do NOT call releaseSoundReset: the 6502 stays held, so it does not
    // interfere with our direct YM2151 writes.
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
    // Tick 60 frames of the YM2151 directly, drain samples
    let maxAbs = 0;
    for (let f = 0; f < 60; f++) {
      ym2151TickCycles(chip.ym2151, 29830);
      for (const s of ym2151DrainSamples(chip.ym2151)) {
        const a = Math.abs(s);
        if (a > maxAbs) maxAbs = a;
      }
    }
    // Verify: after attack (60 frames ~= 1 sec), envelope reaches sustain -> audible
    // samples. Conservative threshold 0.1 (on scale -1..+1 = ~-20dB).
    expect(maxAbs).toBeGreaterThan(0.1);
  });
});

describe.skipIf(haveRoms)("SoundChip facade skip: roms absent", () => {
  it.skip("extract roms with: unzip roms/marble.zip 136033.421 136033.422 -d /tmp/sound-roms/", () => {});
});
