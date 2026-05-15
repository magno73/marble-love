/**
 * m6502-sound-smoke.test.ts — Phase 4 success criterion smoke.
 *
 * Carica ROM reale Marble Madness (136033.421 + .422), istanzia CPU + MMU
 * collegati via createSoundMmu, esegue RESET sequence e verifica:
 *
 *   1) Reset vector $FFFC/$FFFD letto correttamente → PC valido (≥ $4000)
 *   2) runForCycles(1000): nessuna eccezione throw (no undocumented opcode
 *      hit nei primi N cycle del boot code).
 *
 * Se questo smoke fail, significa che il sound ROM ha opcode 6502 fuori dai
 * 151 documentati che `cpu.ts` lancia come Error. In quel caso il fix e' in
 * `opcodes.ts` (aggiungere il documented opcode mancante o implementare
 * undocumented stub) — non sopprimere l'errore.
 *
 * Le ROM file sono estratte una tantum a `/tmp/sound-roms/` (vedi
 * `unzip -o roms/marble.zip 136033.421 136033.422 -d /tmp/sound-roms/`).
 * Se mancano: skip con messaggio chiaro, non crash silente.
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

describe.skipIf(!haveRoms)("sound chip Phase 4 smoke (ROM reale)", () => {
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

  it("reset vector $FFFC/$FFFD: PC valido nel rom range", () => {
    const cpu = createCpu();
    const mmu = buildMmu();
    reset(cpu, mmu);
    const pc = cpu.rf.pc as number;
    expect(pc).toBeGreaterThanOrEqual(0x4000);
    expect(pc).toBeLessThanOrEqual(0xffff);
  });

  it("runForCycles(1000) post-reset: nessun opcode undocumented hit", () => {
    const cpu = createCpu();
    const mmu = buildMmu();
    reset(cpu, mmu);
    // 1000 cycle ≈ 0.56 ms di clock 6502 @ 1.789 MHz. Se boot code stalla in
    // un tight loop poll mailbox o YM2151 status, dovrebbe completare comunque
    // perche' la mailbox pending=false e lo stub YM2151 ritorna 0 (= "not busy").
    expect(() => runForCycles(cpu, mmu, 1000)).not.toThrow();
    // Dopo 1000 cycle, almeno qualche istruzione deve essere stata eseguita.
    expect(cpu.cycles).toBeGreaterThanOrEqual(1000);
  });

  it("mailbox round-trip via MMU non crasha durante boot", () => {
    const cpu = createCpu();
    const mmu = buildMmu();
    reset(cpu, mmu);
    // Simula un cmd dal 68K mentre boot gira:
    runForCycles(cpu, mmu, 500);
    mmu.mainToSound.value = 0x65 as never;
    mmu.mainToSound.pending = true;
    expect(() => runForCycles(cpu, mmu, 1000)).not.toThrow();
  });
});

describe.skipIf(haveRoms)("sound chip smoke: rom assenti, skip", () => {
  it.skip("estrai roms con: unzip -o roms/marble.zip 136033.421 136033.422 -d /tmp/sound-roms/", () => {});
});
