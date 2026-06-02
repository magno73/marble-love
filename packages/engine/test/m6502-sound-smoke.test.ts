/**
 * m6502-sound-smoke.test.ts — Phase 4 success criterion smoke.
 *
 * Loads the real Marble Madness ROM (136033.421 + .422), instantiates CPU + MMU
 * wired through createSoundMmu, runs the RESET sequence, and verifies:
 *
 *   1) Reset vector $FFFC/$FFFD read correctly -> valid PC (>= $4000)
 *   2) runForCycles(1000): no exception thrown (no undocumented opcode
 *      hit in the first N cycle of the boot code).
 *
 * If this smoke fails, the sound ROM has 6502 opcodes outside the documented
 * 151 that `cpu.ts` throws as Error. In that case the fix is in
 * `opcodes.ts` (add the missing documented opcode or implement an
 * undocumented stub) — do not suppress the error.
 *
 * The ROM files are extracted once to `/tmp/sound-roms/` (see
 * `unzip -o roms/marble.zip 136033.421 136033.422 -d /tmp/sound-roms/`).
 * If they are missing: skip with a clear message, not a silent crash.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createCpu, reset, runForCycles } from "../src/m6502/cpu.js";
import { createSoundMmu } from "../src/m6502/sound-mmu.js";
import { createMailbox } from "../src/m6502/mailbox.js";
import { buildSoundRom } from "../src/m6502/sound-rom.js";

const ROM_DIR = "/tmp/sound-roms";
const ROM_421 = `${ROM_DIR}/136033.421`;
const ROM_422 = `${ROM_DIR}/136033.422`;

const haveRoms = existsSync(ROM_421) && existsSync(ROM_422);

describe.skipIf(!haveRoms)("sound chip Phase 4 smoke (real ROM)", () => {
  function buildMmu() {
    const rom = buildSoundRom({
      rom421: new Uint8Array(readFileSync(ROM_421)),
      rom422: new Uint8Array(readFileSync(ROM_422)),
    });
    return createSoundMmu({
      rom,
      mainToSound: createMailbox(),
      soundToMain: createMailbox(),
    });
  }

  it("reset vector $FFFC/$FFFD: valid PC in the rom range", () => {
    const cpu = createCpu();
    const mmu = buildMmu();
    reset(cpu, mmu);
    const pc = cpu.rf.pc as number;
    expect(pc).toBeGreaterThanOrEqual(0x4000);
    expect(pc).toBeLessThanOrEqual(0xffff);
  });

  it("runForCycles(1000) post-reset: no opcode undocumented hit", () => {
    const cpu = createCpu();
    const mmu = buildMmu();
    reset(cpu, mmu);
    // 1000 cycles ≈ 0.56 ms of 6502 clock @ 1.789 MHz. If the boot code stalls in
    // a tight polling loop on mailbox or YM2151 status should still complete
    // because mailbox pending=false and the YM2151 stub returns 0 (= "not busy").
    expect(() => runForCycles(cpu, mmu, 1000)).not.toThrow();
    // After 1000 cycles, at least a few instructions must have executed.
    expect(cpu.cycles).toBeGreaterThanOrEqual(1000);
  });

  it("mailbox round-trip via MMU does not crash during boot", () => {
    const cpu = createCpu();
    const mmu = buildMmu();
    reset(cpu, mmu);
    // Simulate a command from the 68K while boot is running:
    runForCycles(cpu, mmu, 500);
    mmu.mainToSound.value = 0x65 as never;
    mmu.mainToSound.pending = true;
    expect(() => runForCycles(cpu, mmu, 1000)).not.toThrow();
  });
});

describe.skipIf(haveRoms)("sound chip smoke: roms absent, skip", () => {
  it.skip("extract roms with: unzip -o roms/marble.zip 136033.421 136033.422 -d /tmp/sound-roms/", () => {});
});
