/**
 * m6502-smoke.test.ts — Smoke test del core 6502.
 *
 * Verify key behaviors that are easy to miss in a port:
 *  - RESET fetches PC from $FFFC/$FFFD and sets SP=$FD.
 *  - JMP indirect NMOS bug ($xxFF wraps within the same high byte).
 *  - NMI prevale su IRQ; IRQ e' masked da FLAG_I.
 *  - Page-cross penalty su LDA abs,X (READ ops).
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
  it("fetcha PC dal vector $FFFC/$FFFD e setta SP=$FD", () => {
    // Why: the correct RESET sequence is essential before any other
    // test; un bug qui rompe tutto.
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
  it("$xxFF wrap: high byte da $xx00, NON da $(xx+1)00", () => {
    // Why: questo bug e' ben noto del NMOS e ASSENTE nel 65C02. Se qualcuno
    // accidentalmente porta 65C02 behavior questo test fallisce.
    const cpu = createCpu();
    const bus = makeBus();
    // Setup: JMP ($02FF). Target word reads $02FF (lo) + $0200 (hi, BUG).
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    loadProgram(bus, 0x8000, [0x6c, 0xff, 0x02]); // JMP ($02FF)
    bus.mem[0x02ff] = 0x78; // lo target
    bus.mem[0x0200] = 0x56; // hi target — BUG: high byte da $xx00
    bus.mem[0x0300] = 0xff; // questo NON deve essere usato (65C02 lo userebbe)
    reset(cpu, bus);
    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0x5678);
  });
});

describe("m6502 NMI vs IRQ priority", () => {
  it("NMI viene servito prima di IRQ", () => {
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffa] = 0x00; bus.mem[0xfffb] = 0x90; // NMI vector
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0; // IRQ vector
    loadProgram(bus, 0x8000, [0xea]); // NOP
    reset(cpu, bus);
    cpu.rf.p = setFlag(cpu.rf.p, FLAG_I, false); // sblocca IRQ
    requestIrq(cpu);
    requestNmi(cpu);
    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0x9000); // NMI vector
  });

  it("IRQ masked da FLAG_I (default post-reset)", () => {
    // Why: after reset I=1, IRQ is ignored; a masking bug would start
    // l'IRQ handler invece dell'opcode di programma.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [0xea]); // NOP
    reset(cpu, bus);
    expect(hasFlag(cpu.rf.p, FLAG_I)).toBe(true);
    requestIrq(cpu);
    step(cpu, bus); // dovrebbe eseguire NOP, non servire IRQ
    expect(raw(cpu.rf.pc)).toBe(0x8001);
  });

  it("CLI lascia la visibilita' IRQ immediata nel modello default", () => {
    // Why: il gate audio corrente e il replay runtime usano ancora il modello
    // storico. La variante Visual6502 va opt-in finche' non preserva i gate.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [
      0x58, // CLI
      0xea, // non deve essere eseguito prima dell'IRQ nel default
    ]);
    reset(cpu, bus);
    requestIrq(cpu);

    step(cpu, bus);
    expect(hasFlag(cpu.rf.p, FLAG_I)).toBe(false);
    expect(raw(cpu.rf.pc)).toBe(0x8001);

    step(cpu, bus);
    expect(raw(cpu.rf.pc)).toBe(0xa000);
  });

  it("CLI puo' ritardare la visibilita' IRQ di una istruzione in diagnostica", () => {
    // Why: the NMOS 6502 samples the IRQ mask with a pipeline; Visual6502 shows
    // an IRQ already pending during CLI from interrupting the opcode immediately after.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [
      0x58, // CLI
      0xea, // NOP: deve ancora eseguire
      0xea, // interrotto prima di questo fetch
    ]);
    reset(cpu, bus);
    setCliIrqDelay(cpu, true);
    requestIrq(cpu);

    step(cpu, bus); // CLI: programmer-visible I=0, ma IRQ ancora mascherato
    expect(hasFlag(cpu.rf.p, FLAG_I)).toBe(false);
    expect(raw(cpu.rf.pc)).toBe(0x8001);

    step(cpu, bus); // NOP post-CLI: ancora non serve IRQ
    expect(raw(cpu.rf.pc)).toBe(0x8002);

    step(cpu, bus); // ora l'IRQ puo' essere servito
    expect(raw(cpu.rf.pc)).toBe(0xa000);
  });

  it("il diagnostico CLI ritarda anche un IRQ richiesto subito dopo CLI", () => {
    // Why: in the MAME-like model, the next opcode has already been prefetched
    // before CLI clears I; an IRQ arriving immediately after cannot replace it.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [
      0x58, // CLI
      0xea, // NOP: deve ancora eseguire
      0xea, // interrotto prima di questo fetch
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

  it("il diagnostico prefetch latch serve IRQ solo dopo il prefetch precedente", () => {
    // Why: MAME does not check the IRQ pin at instruction start; the prefetch of
    // previous instruction decides whether the next opcode becomes BRK/IRQ.
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [
      0xea, // NOP: latchea l'IRQ a fine prefetch
      0xea, // interrotto prima di questo fetch
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

  it("il diagnostico prefetch latch campiona CLI con il vecchio I flag", () => {
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0xfffe] = 0x00; bus.mem[0xffff] = 0xa0;
    loadProgram(bus, 0x8000, [
      0x58, // CLI: prefetch usa ancora I=1
      0xea, // NOP: qui viene latched l'IRQ
      0xea, // interrotto prima di questo fetch
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
  it("LDA abs,X paga +1 cycle se page cross", () => {
    // Why: cycle-accuracy e' necessaria per Tom Harte + per la sincronia
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

  it("LDA abs,X no penalty se same page", () => {
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
  it("PHA/PLA round-trip preserva A e tocca P solo su PLA", () => {
    // Why: push wrap on SP=$00 -> $FF is an edge case that is easy to miss
    // if the implementation uses a native Array buffer instead of
    // memoria mappata.
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
    bus.mem[0x8102] = 0xea; // NOP all'arrivo
    reset(cpu, bus);
    step(cpu, bus); // LDA #$01
    const start = cpu.cycles;
    step(cpu, bus); // BNE taken, page cross
    // base 2 + taken(2 cycles totali extra: +1 taken, +1 cross) = 4
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
    expect(raw(cpu.rf.pc)).toBe(0x8004); // PC avanza solo del literal
  });
});

describe("m6502 undocumented opcode fail loud", () => {
  it("lancia errore su 0x02 (KIL)", () => {
    const cpu = createCpu();
    const bus = makeBus();
    bus.mem[0xfffc] = 0x00; bus.mem[0xfffd] = 0x80;
    bus.mem[0x8000] = 0x02; // KIL (undocumented)
    reset(cpu, bus);
    expect(() => step(cpu, bus)).toThrow(/undocumented opcode 0x02/);
  });
});
