/**
 * m6502-tom-harte.test.ts — Runner for oracle/tom_harte_m6502/*.json.
 *
 * Mirror pattern of the M68000 runner. For each `<hex>.json` file in
 * the oracle directory, runs all tests:
 *  1. Initialize zeroed Uint8Array(0x10000), apply sparse `initial.ram`.
 *  2. Create CPU with regs from `initial`.
 *  3. step() a single instruction.
 *  4. Compare regs (A,X,Y,SP,P,PC) and cycle count.
 *  5. Compare RAM only on bytes listed by `final.ram` (sparse comparison).
 *
 * If the oracle directory is empty (dataset not fetched), the file uses
 * `it.skip` → run is a no-op, NOT a failure.
 *
 * Status flag mask: NV-DIZC (exclude B and U from the compare because they are
 * "soft flags" that depend only on PHP/BRK; the upstream datasheet does not
 * always includes them consistently).
 *
 * Intent (CLAUDE Rule 9): if an opcode breaks (for example PHA forgetting
 * to decrement SP), these tests must fail. They validate WHY: every opcode
 * must behave like the real hardware.
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

// Mask for flag comparison: excludes B (0x10) and U (0x20) — soft flags.
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

        // Regs: compare directly
        expect(raw(cpu.rf.a)).toBe(t.final.a);
        expect(raw(cpu.rf.x)).toBe(t.final.x);
        expect(raw(cpu.rf.y)).toBe(t.final.y);
        expect(raw(cpu.rf.sp)).toBe(t.final.s);
        expect(raw(cpu.rf.pc)).toBe(t.final.pc);
        // Flags: exclude B/U (see comment above)
        expect((cpu.rf.p as number) & FLAG_MASK_COMPARE).toBe(t.final.p & FLAG_MASK_COMPARE);
        // Cycle count: length of upstream cycles array
        expect(cyclesUsed).toBe(t.cycles.length);

        // RAM: sparse compare; every byte listed by final.ram.
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
    it("placeholder — run oracle/tom_harte_m6502/build_subset.py to populate", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("m6502 Tom Harte SingleStepTests", () => {
    for (const f of files) runOpcodeFile(f);
  });
}
