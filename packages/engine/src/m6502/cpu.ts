/**
 * cpu.ts - MOS 6502 NMOS core driver (step, runForCycles, RESET/NMI/IRQ).
 *
 * Public API:
 *  - `createCpu()` -> `{ rf, irq, nmi, resetPending }`
 *  - `reset(cpu, bus)`        - runs reset and fetches vector $FFFC/$FFFD
 *  - `step(cpu, bus)`         - executes one instruction and returns cycle count
 *  - `runForCycles(cpu, bus, budget)` - steps until accumulated cycles >= budget
 *  - `requestIrq(cpu)`        - asserts level-sensitive IRQ, masked by FLAG_I
 *  - `requestNmi(cpu)`        - asserts edge-triggered NMI
 *
 * Interrupt priority: RESET > NMI > IRQ. All are modeled as pending flags that
 * `cpu.step` processes before opcode fetch. IRQ is level-sensitive and remains
 * asserted until the external chip releases it.
 *
 * Undocumented opcodes throw. Callers should catch and log with enough context.
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
  /** Cycle accumulator, incremental per step and resettable by the caller. */
  cycles: number;
  /** Diagnostic PC of the opcode currently executing. */
  lastOpcodePc: number | undefined;
  /** Diagnostics-only NMOS CLI IRQ sampling delay. Default false. */
  cliIrqDelayEnabled: boolean;
  /** Instruction boundaries that must still see the old IRQ mask after CLI. */
  irqMaskDelayInstructions: number;
  /** Diagnostics-only MAME-style IRQ recognition latch at opcode prefetch. */
  irqPrefetchLatchEnabled: boolean;
  /** IRQ responif thetched by the previous opcode prefetch. */
  irqTakenPending: boolean;
  /** Status byte visible at the most recent opcode prefetch point. */
  irqPrefetchStatus: number | undefined;
}

export function createCpu(): M6502Cpu {
  return {
    rf: createRegFile(),
    irq: false,
    nmi: false,
    cycles: 0,
    lastOpcodePc: undefined,
    cliIrqDelayEnabled: false,
    irqMaskDelayInstructions: 0,
    irqPrefetchLatchEnabled: false,
    irqTakenPending: false,
    irqPrefetchStatus: undefined,
  };
}

export function setCliIrqDelay(cpu: M6502Cpu, enabled: boolean): void {
  cpu.cliIrqDelayEnabled = enabled;
  if (!enabled) cpu.irqMaskDelayInstructions = 0;
}

export function setIrqPrefetchLatch(cpu: M6502Cpu, enabled: boolean): void {
  cpu.irqPrefetchLatchEnabled = enabled;
  if (!enabled) {
    cpu.irqTakenPending = false;
    cpu.irqPrefetchStatus = undefined;
  }
}

export function sampleIrqPrefetch(cpu: M6502Cpu): void {
  if (!cpu.irqPrefetchLatchEnabled || cpu.irqPrefetchStatus === undefined) return;
  cpu.irqTakenPending = cpu.irq && !hasFlag(as_u8(cpu.irqPrefetchStatus), FLAG_I);
}

// ─── Reset / Interrupts ───────────────────────────────────────────────────

/** Runs the reset sequence: 7 cycles, fetch PC from $FFFC/$FFFD, clear IRQ/NMI. */
export function reset(cpu: M6502Cpu, bus: MemBus6502): void {
  cpu.rf = createRegFile();
  const lo = bus.read8(as_u16(0xfffc)) as number;
  const hi = bus.read8(as_u16(0xfffd)) as number;
  cpu.rf.pc = as_u16(lo | (hi << 8));
  cpu.irq = false;
  cpu.nmi = false;
  cpu.lastOpcodePc = undefined;
  cpu.irqMaskDelayInstructions = 0;
  cpu.irqTakenPending = false;
  cpu.irqPrefetchStatus = undefined;
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
  // whether to release it). No automatic reset here.
  cpu.cycles += 7;
}

export function requestIrq(cpu: M6502Cpu): void { cpu.irq = true; }
export function clearIrq(cpu: M6502Cpu): void { cpu.irq = false; }
export function requestNmi(cpu: M6502Cpu): void { cpu.nmi = true; }

// ─── Step / Run ───────────────────────────────────────────────────────────

/** Execute one instruction or service a pending interrupt.
 * Returns consumed cycles and throws on undocumented opcodes. */
export function step(cpu: M6502Cpu, bus: MemBus6502): number {
  const cyclesBefore = cpu.cycles;

  // Service interrupts before opcode fetch.
  if (cpu.nmi) {
    cpu.lastOpcodePc = undefined;
    cpu.irqMaskDelayInstructions = 0;
    cpu.irqTakenPending = false;
    cpu.irqPrefetchStatus = undefined;
    serviceNmi(cpu, bus);
    return cpu.cycles - cyclesBefore;
  }
  if (
    cpu.irqPrefetchLatchEnabled
      ? cpu.irqTakenPending
      : cpu.irq && !hasFlag(cpu.rf.p, FLAG_I) && cpu.irqMaskDelayInstructions <= 0
  ) {
    cpu.lastOpcodePc = undefined;
    cpu.irqMaskDelayInstructions = 0;
    cpu.irqTakenPending = false;
    cpu.irqPrefetchStatus = undefined;
    serviceIrq(cpu, bus);
    return cpu.cycles - cyclesBefore;
  }
  if (cpu.irqMaskDelayInstructions > 0) {
    cpu.irqMaskDelayInstructions--;
  }

  // Fetch opcode (advances PC).
  cpu.lastOpcodePc = cpu.rf.pc as number;
  const statusBeforeOpcode = cpu.rf.p;
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
  if (cpu.cliIrqDelayEnabled && opcode === 0x58) {
    // NMOS 6502: CLI clears the programmer-visible I flag immediately, but
    // MAME/real prefetch already sampled the next opcode with the old mask.
    cpu.irqMaskDelayInstructions = Math.max(cpu.irqMaskDelayInstructions, 1);
  }
  if (cpu.irqPrefetchLatchEnabled) {
    // MAME samples IRQ during opcode prefetch. CLI/SEI/PLP update I after that
    // prefetch, unlike most status-affecting opcodes.
    cpu.irqPrefetchStatus = opcode === 0x28 || opcode === 0x58 || opcode === 0x78
      ? statusBeforeOpcode
      : cpu.rf.p;
    sampleIrqPrefetch(cpu);
  }
  cpu.cycles += base + extra;
  return cpu.cycles - cyclesBefore;
}

/** Esegue step finche' cpu.cycles >= start + budget. Ritorna cycle consumed. */
export function runForCycles(cpu: M6502Cpu, bus: MemBus6502, budget: number): number {
  const start = cpu.cycles;
  while (cpu.cycles - start < budget) {
    step(cpu, bus);
  }
  return cpu.cycles - start;
}
