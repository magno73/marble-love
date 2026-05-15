/**
 * m6502-tom-harte.test.ts — Runner per oracle/tom_harte_m6502/*.json.
 *
 * Pattern mirror del runner M68000. Per ogni file `<hex>.json` nella
 * directory oracle, esegue tutti i test:
 *  1. Inizializza Uint8Array(0x10000) zero, applica sparse `initial.ram`.
 *  2. Crea CPU con regs da `initial`.
 *  3. step() una singola istruzione.
 *  4. Confronta regs (A,X,Y,SP,P,PC) e cycle count.
 *  5. Confronta RAM solo su byte che `final.ram` lista (sparse comparison).
 *
 * Se la directory oracle e' vuota (dataset non fetched), il file usa
 * `it.skip` → run e' un no-op, NON falla.
 *
 * Status flag mask: NV-DIZC (escludiamo B e U dal compare perche' sono
 * "soft flags" che dipendono solo da PHP/BRK; il datasheet upstream non
 * sempre li include in modo consistente).
 *
 * Intent (CLAUDE Rule 9): se un opcode si rompe (es. PHA che dimentica
 * di decrementare SP), questi test devono fallire. Validano WHY: ogni
 * opcode deve comportarsi come l'hardware reale.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCpu, step } from "../src/m6502/cpu.js";
import type { MemBus6502 } from "../src/m6502/bus.js";
import { as_u8, as_u16, raw } from "../src/wrap.js";

interface HarteState {
  pc: number;
  s: number;
  a: number;
  x: number;
  y: number;
  p: number;
  ram: Array<[number, number]>;
}

interface HarteTest {
  name: string;
  initial: HarteState;
  final: HarteState;
  cycles: Array<[number, number, "read" | "write"]>;
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ORACLE_DIR = join(__dirname, "..", "..", "..", "oracle", "tom_harte_m6502");

function listOpcodeFiles(): string[] {
  if (!existsSync(ORACLE_DIR)) return [];
  return readdirSync(ORACLE_DIR)
    .filter((f) => /^[0-9a-f]{2}\.json$/i.test(f))
    .sort();
}

function makeBusFromRam(initRam: Array<[number, number]>): MemBus6502 & { mem: Uint8Array } {
  const mem = new Uint8Array(0x10000);
  for (const [addr, val] of initRam) mem[addr & 0xffff] = val & 0xff;
  return {
    mem,
    read8: (addr) => as_u8(mem[(addr as number) & 0xffff]!),
    write8: (addr, v) => { mem[(addr as number) & 0xffff] = (v as number) & 0xff; },
  };
}

// Maschera per comparison flag: esclude B (0x10) e U (0x20) — soft flags.
const FLAG_MASK_COMPARE = 0xcf;

function runOpcodeFile(file: string): void {
  const fullPath = join(ORACLE_DIR, file);
  const raw_data = readFileSync(fullPath, "utf-8");
  const tests: HarteTest[] = JSON.parse(raw_data);

  describe(`opcode ${file.replace(".json", "")} (${tests.length} tests)`, () => {
    for (const t of tests) {
      it(t.name, () => {
        const cpu = createCpu();
        cpu.rf.pc = as_u16(t.initial.pc);
        cpu.rf.sp = as_u8(t.initial.s);
        cpu.rf.a = as_u8(t.initial.a);
        cpu.rf.x = as_u8(t.initial.x);
        cpu.rf.y = as_u8(t.initial.y);
        cpu.rf.p = as_u8(t.initial.p);

        const bus = makeBusFromRam(t.initial.ram);

        const cyclesUsed = step(cpu, bus);

        // Regs: confronta direttamente
        expect(raw(cpu.rf.a)).toBe(t.final.a);
        expect(raw(cpu.rf.x)).toBe(t.final.x);
        expect(raw(cpu.rf.y)).toBe(t.final.y);
        expect(raw(cpu.rf.sp)).toBe(t.final.s);
        expect(raw(cpu.rf.pc)).toBe(t.final.pc);
        // Flag: escludi B/U (vedi commento sopra)
        expect((cpu.rf.p as number) & FLAG_MASK_COMPARE).toBe(t.final.p & FLAG_MASK_COMPARE);
        // Cycle count: lunghezza array cycles upstream
        expect(cyclesUsed).toBe(t.cycles.length);

        // RAM: confronta sparse — ogni byte che final.ram lista
        for (const [addr, expected] of t.final.ram) {
          expect(bus.mem[addr & 0xffff]).toBe(expected & 0xff);
        }
      });
    }
  });
}

const files = listOpcodeFiles();

if (files.length === 0) {
  describe.skip("m6502 Tom Harte (dataset not fetched)", () => {
    it("placeholder — run oracle/tom_harte_m6502/build_subset.py per popolare", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("m6502 Tom Harte SingleStepTests", () => {
    for (const f of files) runOpcodeFile(f);
  });
}
