/**
 * cpu.ts — Core driver del MOS 6502 NMOS (step, runForCycles, RESET/NMI/IRQ).
 *
 * Public API:
 *  - `createCpu()` -> `{ rf, irq, nmi, resetPending }`
 *  - `reset(cpu, bus)`        — esegue reset sequence, fetcha vector $FFFC/$FFFD
 *  - `step(cpu, bus)`         — esegue una singola istruzione, ritorna cycle count
 *  - `runForCycles(cpu, bus, budget)` — itera step finche' cycle accumulato >= budget
 *  - `requestIrq(cpu)`        — pin IRQ asserito (level-sensitive, masked da FLAG_I)
 *  - `requestNmi(cpu)`        — pin NMI asserito (edge-triggered)
 *
 * Interrupt priority: RESET > NMI > IRQ. Tutti sono modellati come pending
 * flag che cpu.step processa prima dell'opcode fetch. IRQ e' level-sensitive
 * (resta asserito finche' il chip esterno non lo rilascia); nel nostro caso
 * il chip esterno (YM2151 in Phase 5) controllera' la pin.
 *
 * Undocumented opcode -> throw (Rule 12 fail loud). Caller deve catchare e
 * loggare per debug.
 */

import { as_u8, as_u16 } from "../wrap.js";
import {
  type M6502RegFile, createRegFile,
  FLAG_I, FLAG_B, FLAG_U,
  setFlag, hasFlag,
} from "./regfile.js";
import type { MemBus6502 } from "./bus.js";
import { OPCODES } from "./opcodes.js";
import { baseCyclesFor } from "./cycle-table.js";

export interface M6502Cpu {
  rf: M6502RegFile;
  irq: boolean;
  nmi: boolean;
  /** Cycle accumulator (incremental per step). Resettabile dal caller. */
  cycles: number;
}

export function createCpu(): M6502Cpu {
  return { rf: createRegFile(), irq: false, nmi: false, cycles: 0 };
}

// ─── Reset / Interrupts ───────────────────────────────────────────────────

/** Esegue reset sequence: 7 cycle, fetcha PC da $FFFC/$FFFD. Pulisce flag
 * NMI/IRQ pending. */
export function reset(cpu: M6502Cpu, bus: MemBus6502): void {
  cpu.rf = createRegFile();
  const lo = bus.read8(as_u16(0xfffc)) as number;
  const hi = bus.read8(as_u16(0xfffd)) as number;
  cpu.rf.pc = as_u16(lo | (hi << 8));
  cpu.irq = false;
  cpu.nmi = false;
  cpu.cycles += 7;
}

function pushPCandStatus(rf: M6502RegFile, bus: MemBus6502, brkFlag: boolean): void {
  // Push PC hi, PC lo, status
  bus.write8(as_u16(0x0100 | (rf.sp as number)), as_u8((rf.pc as number) >>> 8));
  rf.sp = as_u8(((rf.sp as number) - 1) & 0xff);
  bus.write8(as_u16(0x0100 | (rf.sp as number)), as_u8((rf.pc as number) & 0xff));
  rf.sp = as_u8(((rf.sp as number) - 1) & 0xff);
  const pPush = brkFlag ? ((rf.p as number) | FLAG_B | FLAG_U) : ((rf.p as number) & ~FLAG_B) | FLAG_U;
  bus.write8(as_u16(0x0100 | (rf.sp as number)), as_u8(pPush));
  rf.sp = as_u8(((rf.sp as number) - 1) & 0xff);
}

function serviceNmi(cpu: M6502Cpu, bus: MemBus6502): void {
  pushPCandStatus(cpu.rf, bus, /* brkFlag */ false);
  cpu.rf.p = setFlag(cpu.rf.p, FLAG_I, true);
  const lo = bus.read8(as_u16(0xfffa)) as number;
  const hi = bus.read8(as_u16(0xfffb)) as number;
  cpu.rf.pc = as_u16(lo | (hi << 8));
  cpu.nmi = false;
  cpu.cycles += 7;
}

function serviceIrq(cpu: M6502Cpu, bus: MemBus6502): void {
  pushPCandStatus(cpu.rf, bus, /* brkFlag */ false);
  cpu.rf.p = setFlag(cpu.rf.p, FLAG_I, true);
  const lo = bus.read8(as_u16(0xfffe)) as number;
  const hi = bus.read8(as_u16(0xffff)) as number;
  cpu.rf.pc = as_u16(lo | (hi << 8));
  // IRQ e' level-sensitive: lasciamo cpu.irq al caller (chip esterno deciders
  // se rilasciarlo). Nessun reset automatico qui.
  cpu.cycles += 7;
}

export function requestIrq(cpu: M6502Cpu): void { cpu.irq = true; }
export function clearIrq(cpu: M6502Cpu): void { cpu.irq = false; }
export function requestNmi(cpu: M6502Cpu): void { cpu.nmi = true; }

// ─── Step / Run ───────────────────────────────────────────────────────────

/** Esegue una singola istruzione (o serve interrupt pending). Ritorna i
 * cycle consumati. Throws su undocumented opcode. */
export function step(cpu: M6502Cpu, bus: MemBus6502): number {
  const cyclesBefore = cpu.cycles;

  // Service interrupts prima dell'opcode fetch
  if (cpu.nmi) {
    serviceNmi(cpu, bus);
    return cpu.cycles - cyclesBefore;
  }
  if (cpu.irq && !hasFlag(cpu.rf.p, FLAG_I)) {
    serviceIrq(cpu, bus);
    return cpu.cycles - cyclesBefore;
  }

  // Fetch opcode (avanza PC)
  const opcode = bus.read8(cpu.rf.pc) as number;
  cpu.rf.pc = as_u16(((cpu.rf.pc as number) + 1) & 0xffff);

  const entry = OPCODES[opcode];
  if (entry == null) {
    throw new Error(
      `m6502: undocumented opcode 0x${opcode.toString(16).padStart(2, "0")} ` +
      `at PC=0x${(((cpu.rf.pc as number) - 1) & 0xffff).toString(16).padStart(4, "0")}`,
    );
  }

  const base = baseCyclesFor(as_u8(opcode));
  const extra = entry.exec(cpu.rf, bus);
  cpu.cycles += base + extra;
  return cpu.cycles - cyclesBefore;
}

/** Esegue step finche' cpu.cycles >= start + budget. Ritorna cycle consumati. */
export function runForCycles(cpu: M6502Cpu, bus: MemBus6502, budget: number): number {
  const start = cpu.cycles;
  while (cpu.cycles - start < budget) {
    step(cpu, bus);
  }
  return cpu.cycles - start;
}
