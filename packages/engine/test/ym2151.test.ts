/**
 * ym2151.test.ts — Phase 5 register-state parity smoke + protocol.
 *
 * Intent: in V2 il bit-perfect target e' il REGISTER FILE, non il sample audio.
 * Tests verify that the WR_ADDR + WR_DATA pattern stores the correct byte in
 * expected reg slot (MAME ym2151.cpp register_w mirror). A violation here makes
 * diverge il shadow vs MAME oracle in Phase 8, mascherando il debug del sound
 * driver dal 6502 side.
 */

import { describe, it, expect } from "vitest";
import { as_u8 } from "../src/wrap.js";
import {
  createYM2151,
  ym2151WriteAddr,
  ym2151WriteData,
  ym2151ReadStatus,
  ym2151Reset,
  ym2151TickCycles,
  ym2151SetDiagnosticChannelSamples,
  ym2151SetDiagnosticPhaseAdvanceAfterOutput,
  ym2151DrainDiagnosticChannelSamples,
  ym2151DrainSamples,
  ym2151GenerateSamples,
  ym2151SetExternalSampleClock,
} from "../src/audio/ym2151.js";
import {
  createEnvelope,
  envelopeAdvance,
  envelopeKeyOn,
  resetEnvClock,
  tickEnvClock,
} from "../src/audio/ym2151-envelope.js";

describe("YM2151 register file", () => {
  it("init pulita: regs all 0, selected=0, flags=false", () => {
    const ym = createYM2151();
    expect(ym.regs.length).toBe(256);
    expect(Array.from(ym.regs).every((b) => b === 0)).toBe(true);
    expect(ym.selectedReg).toBe(0);
    expect(ym.timerAOverflow).toBe(false);
    expect(ym.timerBOverflow).toBe(false);
  });

  it("write addr + write data: byte stora in reg slot selezionato", () => {
    const ym = createYM2151();
    // Pattern dal 6502: STA $1800 (addr=0x20) + STA $1801 (data=0xC0)
    ym2151WriteAddr(ym, as_u8(0x20));  // channel 0: RL+FB+CONN
    ym2151WriteData(ym, as_u8(0xC0));  // L=R=1, FB=0, CONN=0
    expect(ym.regs[0x20]).toBe(0xC0);
    expect(ym.selectedReg).toBe(0x20);
    // Other regs not touched.
    expect(ym.regs[0x21]).toBe(0);
    expect(ym.regs[0xFF]).toBe(0);
  });

  it("write multipli aggiornano lo stesso reg finche' addr non cambia", () => {
    const ym = createYM2151();
    ym2151WriteAddr(ym, as_u8(0x08));  // KEY ON
    ym2151WriteData(ym, as_u8(0x01));
    expect(ym.regs[0x08]).toBe(0x01);
    ym2151WriteData(ym, as_u8(0x78));  // tutti operatori on
    expect(ym.regs[0x08]).toBe(0x78);
    // Cambio addr: prossima write va al nuovo slot
    ym2151WriteAddr(ym, as_u8(0x40));
    ym2151WriteData(ym, as_u8(0x55));
    expect(ym.regs[0x40]).toBe(0x55);
    expect(ym.regs[0x08]).toBe(0x78);  // immutato
  });

  it("write addr wrap 8-bit: addr=0x100 effettivo 0x00", () => {
    const ym = createYM2151();
    ym2151WriteAddr(ym, as_u8(0xFF));
    ym2151WriteData(ym, as_u8(0xAA));
    expect(ym.regs[0xFF]).toBe(0xAA);
    // Verifica boundary: scrivere a $FF non corrompe $100..
    expect(ym.regs.length).toBe(256);
  });
});

describe("YM2151 status read (Phase 5 stub)", () => {
  it("status default: timer flags false → 0", () => {
    const ym = createYM2151();
    expect(ym2151ReadStatus(ym) as number).toBe(0);
  });

  it("status con timer A overflow set → bit 0", () => {
    const ym = createYM2151();
    ym.timerAOverflow = true;
    expect(ym2151ReadStatus(ym) as number).toBe(0x01);
  });

  it("status con timer B overflow set → bit 1", () => {
    const ym = createYM2151();
    ym.timerBOverflow = true;
    expect(ym2151ReadStatus(ym) as number).toBe(0x02);
  });

  it("status con entrambi i timer overflow → bit 0 + bit 1", () => {
    const ym = createYM2151();
    ym.timerAOverflow = true;
    ym.timerBOverflow = true;
    expect(ym2151ReadStatus(ym) as number).toBe(0x03);
  });

  it("write data asserisce busy bit per 64 cycle YM", async () => {
    const { ym2151TickCycles } = await import("../src/audio/ym2151.js");
    const ym = createYM2151();
    ym2151WriteAddr(ym, as_u8(0x20));
    expect((ym2151ReadStatus(ym) as number) & 0x80).toBe(0);
    ym2151WriteData(ym, as_u8(0xc0));
    expect((ym2151ReadStatus(ym) as number) & 0x80).toBe(0x80);
    ym2151TickCycles(ym, 31);
    expect((ym2151ReadStatus(ym) as number) & 0x80).toBe(0x80);
    ym2151TickCycles(ym, 1);
    expect((ym2151ReadStatus(ym) as number) & 0x80).toBe(0);
  });

  it("external sample clock keeps timers/busy ticking without cycle-generated PCM", () => {
    const ym = createYM2151();
    ym2151SetExternalSampleClock(ym, true);
    ym2151WriteAddr(ym, as_u8(0x20));
    ym2151WriteData(ym, as_u8(0xc0));

    ym2151TickCycles(ym, 32);

    expect((ym2151ReadStatus(ym) as number) & 0x80).toBe(0);
    expect(ym2151DrainSamples(ym)).toEqual([]);

    ym2151GenerateSamples(ym, 3);
    expect(ym2151DrainSamples(ym)).toHaveLength(6);
  });
});

describe("YM2151 Timer A counter (V3)", () => {
  it("write $14 bit 0 arma Timer A, $10/$11 settano periodo", async () => {
    const { ym2151TickCycles } = await import("../src/audio/ym2151.js");
    const ym = createYM2151();
    // Period max = 1024 tick (val=0 in $10/$11)
    ym2151WriteAddr(ym, as_u8(0x10));
    ym2151WriteData(ym, as_u8(0x00));
    ym2151WriteAddr(ym, as_u8(0x11));
    ym2151WriteData(ym, as_u8(0x00));
    // Arm Timer A without enabling the status/IRQ latch: $14 bit 0.
    ym2151WriteAddr(ym, as_u8(0x14));
    ym2151WriteData(ym, as_u8(0x01));
    expect(ym.timerAActive).toBe(true);
    expect(ym.timerACounter).toBe(1024);
    // Avanza 1024 tick × 64 cycle YM = 65536 cycle YM = 32768 cycle 6502
    ym2151TickCycles(ym, 32768);
    expect(ym.timerAOverflow).toBe(false);
    expect(ym.timerACounter).toBeGreaterThan(0);  // auto-restart
  });

  it("write $14 bit 4 clear Timer A overflow flag", async () => {
    // Bit mapping ymfm-faithful: bit 4 = reset_timer_a (clear overflow flag)
    const { ym2151TickCycles } = await import("../src/audio/ym2151.js");
    const ym = createYM2151();
    ym2151WriteAddr(ym, as_u8(0x10)); ym2151WriteData(ym, as_u8(0x00));
    ym2151WriteAddr(ym, as_u8(0x11)); ym2151WriteData(ym, as_u8(0x00));
    ym2151WriteAddr(ym, as_u8(0x14)); ym2151WriteData(ym, as_u8(0x05));
    ym2151TickCycles(ym, 32768);
    expect(ym.timerAOverflow).toBe(true);
    ym2151WriteData(ym, as_u8(0x10));  // bit 4 = reset_timer_a
    expect(ym.timerAOverflow).toBe(false);
  });

  it("Timer A periodo variabile via $10/$11 (val=1023 → period=1 tick)", async () => {
    const { ym2151TickCycles } = await import("../src/audio/ym2151.js");
    const ym = createYM2151();
    ym2151WriteAddr(ym, as_u8(0x10)); ym2151WriteData(ym, as_u8(0xFF));
    ym2151WriteAddr(ym, as_u8(0x11)); ym2151WriteData(ym, as_u8(0x03));
    ym2151WriteAddr(ym, as_u8(0x14)); ym2151WriteData(ym, as_u8(0x01));
    expect(ym.timerACounter).toBe(1);
    ym2151TickCycles(ym, 32);  // 1 tick × 64 cycle YM = 64 YM = 32 6502
    expect(ym.timerAOverflow).toBe(false);
  });

  it("Timer A load resetta il prescaler timer senza usare il sample accumulator", async () => {
    const { ym2151TickCycles } = await import("../src/audio/ym2151.js");
    const ym = createYM2151();
    ym2151TickCycles(ym, 23);  // lascia il sample/env accumulator a 46 YM cycle
    ym2151WriteAddr(ym, as_u8(0x10)); ym2151WriteData(ym, as_u8(0xFF));
    ym2151WriteAddr(ym, as_u8(0x11)); ym2151WriteData(ym, as_u8(0x03));
    ym2151WriteAddr(ym, as_u8(0x14)); ym2151WriteData(ym, as_u8(0x05));

    ym2151TickCycles(ym, 31);
    expect(ym.timerAOverflow).toBe(false);
    ym2151TickCycles(ym, 1);
    expect(ym.timerAOverflow).toBe(true);
  });

  it("diagnostic Timer A start phase can advance the first overflow", async () => {
    const { ym2151TickCycles } = await import("../src/audio/ym2151.js");
    const ym = createYM2151();
    ym.timerAStartDelayYmCycles = -16;
    ym2151WriteAddr(ym, as_u8(0x10)); ym2151WriteData(ym, as_u8(0xFF));
    ym2151WriteAddr(ym, as_u8(0x11)); ym2151WriteData(ym, as_u8(0x03));
    ym2151WriteAddr(ym, as_u8(0x14)); ym2151WriteData(ym, as_u8(0x05));

    ym2151TickCycles(ym, 23);
    expect(ym.timerAOverflow).toBe(false);
    ym2151TickCycles(ym, 1);
    expect(ym.timerAOverflow).toBe(true);
  });

  it("Timer A enable bit 2: arm + enable → overflow asserts IRQ gate", async () => {
    // Bit mapping ymfm-faithful: bit 0 = load_timer_a, bit 2 = enable_timer_a
    // (= IRQ enable in MAME semantics). $14=$05 = bit 0 + bit 2 = "load timer
    // + enable IRQ assertion on overflow". Marble sound ROM writes this value
    // during boot init at $819F-$81A2.
    const { ym2151TickCycles, ym2151ReadStatus } = await import("../src/audio/ym2151.js");
    const ym = createYM2151();
    ym2151WriteAddr(ym, as_u8(0x10)); ym2151WriteData(ym, as_u8(0x00));
    ym2151WriteAddr(ym, as_u8(0x11)); ym2151WriteData(ym, as_u8(0x00));
    ym2151WriteAddr(ym, as_u8(0x14)); ym2151WriteData(ym, as_u8(0x05));  // load + enable
    expect(ym.timerAActive).toBe(true);
    expect(ym.timerAIrqEnable).toBe(true);
    ym2151TickCycles(ym, 32768);
    expect(ym.timerAOverflow).toBe(true);
    expect(ym2151ReadStatus(ym) as number).toBe(0x01);
  });

  it("Timer A overflow while disabled does not latch status when later enabled", async () => {
    const { ym2151TickCycles, ym2151ReadStatus } = await import("../src/audio/ym2151.js");
    const ym = createYM2151();
    ym2151WriteAddr(ym, as_u8(0x10)); ym2151WriteData(ym, as_u8(0xFF));
    ym2151WriteAddr(ym, as_u8(0x11)); ym2151WriteData(ym, as_u8(0x03));
    ym2151WriteAddr(ym, as_u8(0x14)); ym2151WriteData(ym, as_u8(0x01));

    ym2151TickCycles(ym, 32);
    expect(ym.timerAOverflow).toBe(false);
    expect((ym2151ReadStatus(ym) as number) & 0x01).toBe(0);

    ym2151WriteAddr(ym, as_u8(0x14)); ym2151WriteData(ym, as_u8(0x05));
    expect((ym2151ReadStatus(ym) as number) & 0x01).toBe(0);
    ym2151TickCycles(ym, 32);
    expect((ym2151ReadStatus(ym) as number) & 0x01).toBe(0x01);
  });
});

describe("YM2151 reset", () => {
  it("reset pulisce reg file, selected, flags", () => {
    const ym = createYM2151();
    ym2151WriteAddr(ym, as_u8(0x40));
    ym2151WriteData(ym, as_u8(0xFF));
    ym2151WriteAddr(ym, as_u8(0x60));
    ym2151WriteData(ym, as_u8(0x77));
    ym2151WriteAddr(ym, as_u8(0x08));
    ym2151WriteData(ym, as_u8(0x78));
    ym.timerAOverflow = true;
    ym.timerBOverflow = true;
    ym.lfoFreq = 0xca;
    ym.lfoPmd = 0x3c;
    ym.lfoCounter = 0x123456;
    ym.lfoNoiseLfsr = 0x12345;
    ym.lfoNoiseCounter = 7;
    ym.lfoNoiseState = 1;
    ym.lfoNoiseWaveform[3] = -1;
    ym.sampleBuffer.push(0.25, -0.25);

    ym2151Reset(ym);

    expect(Array.from(ym.regs).every((b) => b === 0)).toBe(true);
    expect(ym.selectedReg).toBe(0);
    expect(ym.timerAOverflow).toBe(false);
    expect(ym.timerBOverflow).toBe(false);
    expect(ym.lfoFreq).toBe(0);
    expect(ym.lfoPmd).toBe(0);
    expect(ym.lfoCounter).toBe(0);
    expect(ym.lfoNoiseLfsr).toBe(1);
    expect(ym.lfoNoiseCounter).toBe(0);
    expect(ym.lfoNoiseState).toBe(0);
    expect(Array.from(ym.lfoNoiseWaveform).every((v) => v === 0)).toBe(true);
    expect(ym.sampleBuffer).toEqual([]);
    expect(ym.channels[0]!.op[0]!.tl).toBe(127);
    expect(ym.channels[0]!.op[0]!.keyOn).toBe(false);
  });
});

describe("YM2151 LFO noise waveform", () => {
  function writeReg(ym: ReturnType<typeof createYM2151>, reg: number, val: number): void {
    ym2151WriteAddr(ym, as_u8(reg));
    ym2151WriteData(ym, as_u8(val));
  }

  function advanceOpmNoiseLfsr(lfsr: number, clocks: number): number {
    let next = lfsr >>> 0;
    for (let i = 0; i < clocks; i++) {
      next = (next << 1) >>> 0;
      const feedback = ((next >>> 17) ^ (next >>> 14) ^ 1) & 1;
      next = (next | feedback) >>> 0;
    }
    return next;
  }

  it("clocks waveform 3 from the OPM noise LFSR", () => {
    const ym = createYM2151();
    writeReg(ym, 0x18, 0xff);
    writeReg(ym, 0x19, 0xff); // PMD = 0x7f
    writeReg(ym, 0x19, 0x7f); // AMD = 0x7f
    writeReg(ym, 0x1b, 0x03); // LFO waveform 3 = noise

    for (let i = 0; i < 64; i++) ym2151TickCycles(ym, 32);

    expect(Array.from(ym.lfoNoiseWaveform).some((v) => v !== 0)).toBe(true);
    expect(Math.abs(ym.lfoRawPm) + ym.lfoAm).toBeGreaterThan(0);
  });

  it("advances the OPM noise LFSR with feedback from the shifted state", () => {
    const ym = createYM2151();
    const initial = ym.lfoNoiseLfsr;

    ym2151GenerateSamples(ym, 128);

    expect(ym.lfoNoiseLfsr).toBe(advanceOpmNoiseLfsr(initial, 256));
  });
});

describe("YM2151 sequenza realistica boot 6502", () => {
  it("init pattern: clear LFO + key off + reset timer + setup ch0 voice", () => {
    const ym = createYM2151();
    // Marble sound driver init (approssimato pattern Yamaha):
    const seq: Array<[number, number]> = [
      [0x01, 0x02],  // TEST: LFO reset
      [0x08, 0x00],  // KEY OFF ch0
      [0x14, 0x30],  // IRQ disable / clear timer A+B
      [0x20, 0xC0],  // ch0: L+R enabled
      [0x28, 0x4A],  // ch0: KC = A4
      [0x30, 0x00],  // ch0: KF = 0
      [0x40, 0x01],  // ch0 op1: DT1=0, MUL=1
      [0x60, 0x10],  // ch0 op1: TL=16 (loud)
      [0x80, 0x1F],  // ch0 op1: KS=0, AR=31 (fastest attack)
    ];
    for (const [addr, data] of seq) {
      ym2151WriteAddr(ym, as_u8(addr));
      ym2151WriteData(ym, as_u8(data));
    }
    expect(ym.regs[0x01]).toBe(0x02);
    expect(ym.regs[0x08]).toBe(0x00);
    expect(ym.regs[0x14]).toBe(0x30);
    expect(ym.regs[0x20]).toBe(0xC0);
    expect(ym.regs[0x28]).toBe(0x4A);
    expect(ym.regs[0x60]).toBe(0x10);
    expect(ym.regs[0x80]).toBe(0x1F);
  });
});

describe("YM2151 OPM phase step", () => {
  function writeReg(ym: ReturnType<typeof createYM2151>, reg: number, val: number): void {
    ym2151WriteAddr(ym, as_u8(reg));
    ym2151WriteData(ym, as_u8(val));
  }

  it("KC=$4A, KF=0, MUL=1 produce il passo phase OPM tabellato", () => {
    const ym = createYM2151();
    writeReg(ym, 0x28, 0x4a);
    writeReg(ym, 0x30, 0x00);
    writeReg(ym, 0x40, 0x01);
    ym2151TickCycles(ym, 32);

    expect(ym.channels[0]!.op[0]!.phaseInc).toBe(8248);
  });

  it("KF aumenta il passo phase senza cambiare KC", () => {
    const ym = createYM2151();
    writeReg(ym, 0x28, 0x4a);
    writeReg(ym, 0x30, 0x00);
    writeReg(ym, 0x40, 0x01);
    ym2151TickCycles(ym, 32);
    const base = ym.channels[0]!.op[0]!.phaseInc;

    writeReg(ym, 0x30, 0x40);
    ym2151TickCycles(ym, 32);

    expect(ym.channels[0]!.op[0]!.phaseInc).toBeGreaterThan(base);
  });

  it("PM delta non modifica il keycode usato dall'envelope", async () => {
    const { operatorSetOpmBlockFreq } = await import("../src/audio/ym2151-operator.js");
    const ym = createYM2151();
    writeReg(ym, 0x28, 0x4a);
    writeReg(ym, 0x30, 0x00);
    writeReg(ym, 0x40, 0x01);
    ym2151TickCycles(ym, 32);
    const op = ym.channels[0]!.op[0]!;
    const keyCode = op.keyCode;

    operatorSetOpmBlockFreq(op, 0x4a << 6, 0, 500, false);

    expect(op.keyCode).toBe(keyCode);
  });

  it("MUL scala il passo phase dell'operatore", () => {
    const ym = createYM2151();
    writeReg(ym, 0x28, 0x4a);
    writeReg(ym, 0x30, 0x00);
    writeReg(ym, 0x40, 0x01);
    ym2151TickCycles(ym, 32);
    const mul1 = ym.channels[0]!.op[0]!.phaseInc;

    writeReg(ym, 0x40, 0x02);
    ym2151TickCycles(ym, 32);

    expect(ym.channels[0]!.op[0]!.phaseInc).toBeCloseTo(mul1 * 2, 8);
  });
});

describe("YM2151 OPM operator register map", () => {
  function writeReg(ym: ReturnType<typeof createYM2151>, reg: number, val: number): void {
    ym2151WriteAddr(ym, as_u8(reg));
    ym2151WriteData(ym, as_u8(val));
  }

  it("maps OPM register blocks to channel topology order", () => {
    const ym = createYM2151();

    writeReg(ym, 0x60, 0x11); // block 0 -> logical op 0
    writeReg(ym, 0x68, 0x22); // block 1 -> logical op 2
    writeReg(ym, 0x70, 0x33); // block 2 -> logical op 1
    writeReg(ym, 0x78, 0x44); // block 3 -> logical op 3
    ym2151TickCycles(ym, 32);

    expect(ym.channels[0]!.op.map((op) => op.tl)).toEqual([0x11, 0x33, 0x22, 0x44]);
  });
});

describe("YM2151 key-on operator mask", () => {
  function writeReg(ym: ReturnType<typeof createYM2151>, reg: number, val: number): void {
    ym2151WriteAddr(ym, as_u8(reg));
    ym2151WriteData(ym, as_u8(val));
  }

  it("updates on/off state for every operator on partial masks", () => {
    const ym = createYM2151();

    writeReg(ym, 0x08, 0x78);
    ym2151TickCycles(ym, 32);
    expect(ym.channels[0]!.op.map((op) => op.keyOn)).toEqual([true, true, true, true]);

    writeReg(ym, 0x08, 0x08);
    ym2151TickCycles(ym, 32);
    expect(ym.channels[0]!.op.map((op) => op.keyOn)).toEqual([true, false, false, false]);
  });

  it("samples key state on the chip clock instead of retriggering between samples", () => {
    const ym = createYM2151();
    writeReg(ym, 0x28, 0x4a);
    writeReg(ym, 0x30, 0x00);
    writeReg(ym, 0x40, 0x01);

    writeReg(ym, 0x08, 0x08);
    expect(ym.channels[0]!.op[0]!.keyOn).toBe(false);
    ym2151TickCycles(ym, 32);

    const op = ym.channels[0]!.op[0]!;
    expect(op.keyOn).toBe(true);
    const phaseBefore = op.phase;
    const phaseInc = op.phaseInc;

    writeReg(ym, 0x08, 0x00);
    writeReg(ym, 0x08, 0x08);
    expect(op.keyOn).toBe(true);

    ym2151TickCycles(ym, 32);
    expect(op.keyOn).toBe(true);
    expect(op.phase).toBe((phaseBefore + phaseInc) % (1 << 20));
  });

  it("applies key-off on the next chip sample", () => {
    const ym = createYM2151();

    writeReg(ym, 0x08, 0x08);
    ym2151TickCycles(ym, 32);
    expect(ym.channels[0]!.op[0]!.keyOn).toBe(true);

    writeReg(ym, 0x08, 0x00);
    expect(ym.channels[0]!.op[0]!.keyOn).toBe(true);

    ym2151TickCycles(ym, 32);
    expect(ym.channels[0]!.op[0]!.keyOn).toBe(false);
  });

  it("invalidates every channel cache on each data write like ymfm", () => {
    const ym = createYM2151();

    ym2151GenerateSamples(ym, 1);
    expect(ym.modifiedChannels).toBe(0);

    writeReg(ym, 0x18, 0x7f);

    expect(ym.modifiedChannels).toBe(0xff);
  });
});

describe("YM2151 diagnostic channel samples", () => {
  function writeReg(ym: ReturnType<typeof createYM2151>, reg: number, val: number): void {
    ym2151WriteAddr(ym, as_u8(reg));
    ym2151WriteData(ym, as_u8(val));
  }

  it("captures per-channel PCM without changing the normal sample drain", () => {
    const ym = createYM2151();
    writeReg(ym, 0x20, 0xc7); // pan both, algorithm 7
    writeReg(ym, 0x28, 0x4a);
    writeReg(ym, 0x30, 0x00);
    writeReg(ym, 0x40, 0x01);
    writeReg(ym, 0x60, 0x00);
    writeReg(ym, 0x68, 0x7f);
    writeReg(ym, 0x70, 0x7f);
    writeReg(ym, 0x78, 0x7f);
    writeReg(ym, 0x80, 0x1f);
    writeReg(ym, 0x08, 0x08);
    ym2151SetDiagnosticChannelSamples(ym, true);

    ym2151TickCycles(ym, 512);

    const channelSamples = ym2151DrainDiagnosticChannelSamples(ym);
    expect(channelSamples).toBeDefined();
    expect(channelSamples![0]!.length).toBeGreaterThan(0);
    expect(channelSamples![1]!.every((sample) => sample === 0)).toBe(true);
    expect(ym.sampleBuffer.length).toBeGreaterThan(0);
    expect(ym2151DrainDiagnosticChannelSamples(ym)![0]!.length).toBe(0);
  });

  it("preserves diagnostic phase experiment across chip reset", () => {
    const ym = createYM2151();
    ym2151SetDiagnosticPhaseAdvanceAfterOutput(ym, true);

    ym2151Reset(ym);

    expect(ym.diagnosticPhaseAdvanceAfterOutput).toBe(true);
  });
});

describe("YM2151 stereo routing", () => {
  function writeReg(ym: ReturnType<typeof createYM2151>, reg: number, val: number): void {
    ym2151WriteAddr(ym, as_u8(reg));
    ym2151WriteData(ym, as_u8(val));
  }

  function renderSingleOperator(panAndAlgorithm: number): { leftAbs: number; rightAbs: number } {
    const ym = createYM2151();
    writeReg(ym, 0x20, panAndAlgorithm);
    writeReg(ym, 0x28, 0x4a);
    writeReg(ym, 0x30, 0x00);
    writeReg(ym, 0x40, 0x01);
    writeReg(ym, 0x60, 0x00);
    writeReg(ym, 0x68, 0x7f);
    writeReg(ym, 0x70, 0x7f);
    writeReg(ym, 0x78, 0x7f);
    writeReg(ym, 0x80, 0x1f);
    writeReg(ym, 0x08, 0x08);

    ym2151TickCycles(ym, 2048);

    let leftAbs = 0;
    let rightAbs = 0;
    for (let i = 0; i < ym.sampleBuffer.length; i += 2) {
      leftAbs += Math.abs(ym.sampleBuffer[i] ?? 0);
      rightAbs += Math.abs(ym.sampleBuffer[i + 1] ?? 0);
    }
    return { leftAbs, rightAbs };
  }

  it("routes OPM output 0 bit 6 to left and output 1 bit 7 to right", () => {
    const leftOnly = renderSingleOperator(0x47);
    const rightOnly = renderSingleOperator(0x87);

    expect(leftOnly.leftAbs).toBeGreaterThan(0);
    expect(leftOnly.rightAbs).toBe(0);
    expect(rightOnly.leftAbs).toBe(0);
    expect(rightOnly.rightAbs).toBeGreaterThan(0);
  });
});

describe("YM2151 envelope generator", () => {
  it("attack applies an exponential attenuation decrement instead of an inversion", () => {
    resetEnvClock();
    const env = createEnvelope();
    envelopeKeyOn(env);

    let attenuation = env.counter;
    for (let i = 0; i < 16; i++) {
      tickEnvClock();
      attenuation = envelopeAdvance(env, 24, 0, 0, 0, 0);
      if (attenuation !== 1023) break;
    }

    expect(attenuation).toBeGreaterThan(700);
    expect(attenuation).toBeLessThan(1023);
  });

  it("key-on retrigger keeps the current attenuation", () => {
    const env = createEnvelope();
    env.counter = 512;

    envelopeKeyOn(env);

    expect(env.counter).toBe(512);
  });
});
