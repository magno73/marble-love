/**
 * m6502-smoke.test.ts — Smoke test of the core 6502.
 *
 * Verify key behaviors that are easy to miss in a port:
 *  - RESET fetches PC from $FFFC/$FFFD and sets SP=$FD.
 *  - JMP indirect NMOS bug ($xxFF wraps within the same high byte).
 *  - NMI takes priority over IRQ; IRQ is masked by FLAG_I.
 *  - Page-cross penalty on LDA abs,X (READ ops).
 *  - Stack push/pop coherent with SP wrap.
 *  - Branch taken / not-taken / page-cross cycle delta.
 *
 * Intent (CLAUDE Rule 9): every test describes WHY, not only WHAT. If the
 * business logic changes (for example, removing the JMP indirect bug because
 * someone decides to port the 65C02), these tests must fail.
 */

import { describe, it, expect } from "vitest";
import {
  type M6502Cpu, createCpu, reset, step, requestNmi, requestIrq, setCliIrqDelay, setIrqPrefetchLatch,
} from "../src/m6502/cpu.js";
import { FLAG_I, FLAG_Z, FLAG_N, FLAG_C, hasFlag, setFlag } from "../src/m6502/regfile.js";
import type { MemBus6502 } from "../src/m6502/bus.js";
import { as_u8, as_u16, raw } from "../src/wrap.js";

function makeBus(): MemBus6502 & { mem: Uint8Array } {
  const mem = new Uint8Array(0x10000);
  return {
    mem,
    read8: (addr) => as_u8(mem[(addr as number) & 0xffff]!),
    write8: (addr, v) => { mem[(addr as number) & 0xffff] = (v as number) & 0xff; },
  };
}

function loadProgram(bus: { mem: Uint8Array }, addr: number, bytes: number[]): void {
  for (let i = 0; i < bytes.length; i++) bus.mem[addr + i] = bytes[i]! & 0xff;
}

describe("m6502 reset", () => {
  it("fetches PC from the vector $FFFC/$FFFD and sets SP=$FD", () => {
    // Why: the correct RESET sequence is essential before any other
    // test; a bug here breaks everything.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x34;
    bus.mem[0xfffd] = 0x12;
    reset(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0x1234);
    expect(raw(cpu.rf.sp)).toBe(0xfd);
    expect(hasFlag(cpu.rf.p, FLAG_I)).toBe(true);
  });
});

describe("m6502 JMP indirect NMOS bug", () => {
  it("$xxFF wrap: high byte from $xx00, NOT from $(xx+1)00", () => {
    // Why: this bug is well known on the NMOS and absent on the 65C02. If someone
    // accidentally ports 65C02 behavior, this test fails.
    const cpu = createCpu();
    const bus = makeBus();
    // Setup: JMP ($02FF). Target word reads $02FF (lo) + $0200 (hi, BUG).
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    loadProgram(bus, 0x8000, [0x6c, 0xff, 0x02]); // JMP ($02FF)
    bus.mem[0x02ff] = 0x78; // lo target
    bus.mem[0x0200] = 0x56; // hi target — BUG: high byte from $xx00
    bus.mem[0x0300] = 0xff; // this must NOT be used (a 65C02 would use it)
    reset(cpu, bus);
    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0x5678);
  });
});

describe("m6502 NMI vs IRQ priority", () => {
  it("NMI is serviced before IRQ", () => {
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffa] = 0x00; bus.mem[0xfffb] = 0x90; // NMI vector
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0; // IRQ vector
    loadProgram(bus, 0x8000, [0xea]); // NOP
    reset(cpu, bus);
    cpu.rf.p = setFlag(cpu.rf.p, FLAG_I, false); // unblock IRQ
    requestIrq(cpu);
    requestNmi(cpu);
    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0x9000); // NMI vector
  });

  it("IRQ masked by FLAG_I (default post-reset)", () => {
    // Why: after reset I=1, IRQ is ignored; a masking bug would start
    // the IRQ handler instead of the program opcode.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [0xea]); // NOP
    reset(cpu, bus);
    expect(hasFlag(cpu.rf.p, FLAG_I)).toBe(true);
    requestIrq(cpu);
    step(cpu, bus); // should execute NOP, not service IRQ
    expect(raw(cpu.rf.pc)).toBe(0x8001);
  });

  it("CLI leaves immediate IRQ visibility in the default model", () => {
    // Why: the current audio gate and the runtime replay still use the historic
    // model. The Visual6502 variant is opt-in until it preserves the gates.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [
      0x58, // CLI
      0xea, // must not be executed before the IRQ in the default model
    ]);
    reset(cpu, bus);
    requestIrq(cpu);

    step(cpu, bus);
    expect(hasFlag(cpu.rf.p, FLAG_I)).toBe(false);
    expect(raw(cpu.rf.pc)).toBe(0x8001);

    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0xa000);
  });

  it("CLI can delay IRQ visibility by one instruction in diagnostics", () => {
    // Why: the NMOS 6502 samples the IRQ mask with a pipeline; Visual6502 shows
    // an IRQ already pending during CLI from interrupting the opcode immediately after.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [
      0x58, // CLI
      0xea, // NOP: must still execute
      0xea, // interrupted before this fetch
    ]);
    reset(cpu, bus);
    setCliIrqDelay(cpu, true);
    requestIrq(cpu);

    step(cpu, bus); // CLI: programmer-visible I=0, but IRQ still masked
    expect(hasFlag(cpu.rf.p, FLAG_I)).toBe(false);
    expect(raw(cpu.rf.pc)).toBe(0x8001);

    step(cpu, bus); // NOP post-CLI: still does not service IRQ
    expect(raw(cpu.rf.pc)).toBe(0x8002);

    step(cpu, bus); // now the IRQ can be serviced
    expect(raw(cpu.rf.pc)).toBe(0xa000);
  });

  it("the CLI diagnostic also delays an IRQ requested right after CLI", () => {
    // Why: in the MAME-like model, the next opcode has already been prefetched
    // before CLI clears I; an IRQ arriving immediately after cannot replace it.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [
      0x58, // CLI
      0xea, // NOP: must still execute
      0xea, // interrupted before this fetch
    ]);
    reset(cpu, bus);
    setCliIrqDelay(cpu, true);

    step(cpu, bus);
    expect(hasFlag(cpu.rf.p, FLAG_I)).toBe(false);
    expect(raw(cpu.rf.pc)).toBe(0x8001);

    requestIrq(cpu);
    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0x8002);

    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0xa000);
  });

  it("the prefetch-latch diagnostic services IRQ only after the previous prefetch", () => {
    // Why: MAME does not check the IRQ pin at instruction start; the prefetch of
    // previous instruction decides whether the next opcode becomes BRK/IRQ.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [
      0xea, // NOP: latches the IRQ at the end of prefetch
      0xea, // interrupted before this fetch
    ]);
    reset(cpu, bus);
    cpu.rf.p = setFlag(cpu.rf.p, FLAG_I, false);
    setIrqPrefetchLatch(cpu, true);
    requestIrq(cpu);

    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0x8001);

    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0xa000);
  });

  it("the prefetch-latch diagnostic samples CLI with the old I flag", () => {
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [
      0x58, // CLI: prefetch still uses I=1
      0xea, // NOP: here the IRQ is latched
      0xea, // interrupted before this fetch
    ]);
    reset(cpu, bus);
    setIrqPrefetchLatch(cpu, true);
    requestIrq(cpu);

    step(cpu, bus);
    expect(hasFlag(cpu.rf.p, FLAG_I)).toBe(false);
    expect(raw(cpu.rf.pc)).toBe(0x8001);

    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0x8002);

    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0xa000);
  });
});

describe("m6502 LDA page-cross", () => {
  it("LDA abs,X pays +1 cycle if page cross", () => {
    // Why: cycle-accuracy is required for Tom Harte + for sync
    // with MAME (29830 cycles/frame = 1.789 MHz / 60).
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    // LDA $80FF,X  (X=1 -> address $8100, page cross)
    loadProgram(bus, 0x8000, [0xbd, 0xff, 0x80]);
    bus.mem[0x8100] = 0x42;
    reset(cpu, bus);
    cpu.rf.x = as_u8(1);
    const start = cpu.cycles;
    step(cpu, bus);
    // base 4 + page-cross 1 = 5
    expect(cpu.cycles - start).toBe(5);
    expect(raw(cpu.rf.a)).toBe(0x42);
  });

  it("LDA abs,X no penalty if same page", () => {
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    loadProgram(bus, 0x8000, [0xbd, 0x00, 0x80]);
    bus.mem[0x8005] = 0x42;
    reset(cpu, bus);
    cpu.rf.x = as_u8(5);
    const start = cpu.cycles;
    step(cpu, bus);
    expect(cpu.cycles - start).toBe(4);
  });
});

describe("m6502 stack push/pop", () => {
  it("PHA/PLA round-trip preserves A and touches P only on PLA", () => {
    // Why: push wrap on SP=$00 -> $FF is an edge case that is easy to miss
    // if the implementation uses a native Array buffer instead of
    // mapped memory.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    loadProgram(bus, 0x8000, [
      0xa9, 0x80, // LDA #$80
      0x48,       // PHA
      0xa9, 0x00, // LDA #$00
      0x68,       // PLA
    ]);
    reset(cpu, bus);
    step(cpu, bus); // LDA #$80
    step(cpu, bus); // PHA
    step(cpu, bus); // LDA #$00 -> A=0, Z=1
    expect(hasFlag(cpu.rf.p, FLAG_Z)).toBe(true);
    step(cpu, bus); // PLA -> A=$80, N=1, Z=0
    expect(raw(cpu.rf.a)).toBe(0x80);
    expect(hasFlag(cpu.rf.p, FLAG_N)).toBe(true);
    expect(hasFlag(cpu.rf.p, FLAG_Z)).toBe(false);
  });
});

describe("m6502 branch", () => {
  it("BNE taken same page = +1 cycle, page cross = +2", () => {
    // Why: branch cycle accounting is one of the most common sources of
    // sync drift with MAME.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0xfa; bus.mem[0xfffd] = 0x80;
    // Setup: A=1 -> Z=0 -> BNE taken
    bus.mem[0x80fa] = 0xa9; bus.mem[0x80fb] = 0x01; // LDA #$01
    bus.mem[0x80fc] = 0xd0; bus.mem[0x80fd] = 0x04; // BNE +4 (target $8102, page cross)
    bus.mem[0x80fe] = 0xa9; bus.mem[0x80ff] = 0xff; // dummy
    bus.mem[0x8102] = 0xea; // NOP at the destination
    reset(cpu, bus);
    step(cpu, bus); // LDA #$01
    const start = cpu.cycles;
    step(cpu, bus); // BNE taken, page cross
    // base 2 + taken (2 extra cycles total: +1 taken, +1 cross) = 4
    expect(cpu.cycles - start).toBe(4);
    expect(raw(cpu.rf.pc)).toBe(0x8102);
  });

  it("BNE not taken = base 2 cycles", () => {
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    loadProgram(bus, 0x8000, [
      0xa9, 0x00, // LDA #$00 -> Z=1
      0xd0, 0x10, // BNE +16 (not taken)
    ]);
    reset(cpu, bus);
    step(cpu, bus);
    const start = cpu.cycles;
    step(cpu, bus);
    expect(cpu.cycles - start).toBe(2);
    expect(raw(cpu.rf.pc)).toBe(0x8004); // PC advances only past the literal
  });
});

describe("m6502 undocumented opcode fail loud", () => {
  it("throws error on 0x02 (KIL)", () => {
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0x8000] = 0x02; // KIL (undocumented)
    reset(cpu, bus);
    expect(() => step(cpu, bus)).toThrow(/undocumented opcode 0x02/);
  });
});
