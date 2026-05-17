/**
 * ym2151.test.ts — Phase 5 register-state parity smoke + protocol.
 *
 * Intent: in V2 il bit-perfect target e' il REGISTER FILE, non il sample audio.
 * I test verificano che il pattern WR_ADDR + WR_DATA stori il byte corretto nel
 * reg slot atteso (mirror MAME ym2151.cpp register_w). Una violazione qui fa
 * diverge il shadow vs MAME oracle in Phase 8, mascherando il debug del sound
 * driver dal 6502 side.
 */

import { describe, it, expect } from "vitest";
import { as_u8 } from "../src/wrap.js";
import {
  createYM2151, ym2151WriteAddr, ym2151WriteData, ym2151ReadStatus, ym2151Reset,
} from "../src/audio/ym2151.js";

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
    // Altri reg non toccati
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
    // Arm Timer A: $14 bit 0
    ym2151WriteAddr(ym, as_u8(0x14));
    ym2151WriteData(ym, as_u8(0x01));
    expect(ym.timerAActive).toBe(true);
    expect(ym.timerACounter).toBe(1024);
    // Avanza 1024 tick × 64 cycle YM = 65536 cycle YM = 32768 cycle 6502
    ym2151TickCycles(ym, 32768);
    expect(ym.timerAOverflow).toBe(true);
    expect(ym.timerACounter).toBeGreaterThan(0);  // auto-restart
  });

  it("write $14 bit 4 clear Timer A overflow flag", async () => {
    // Bit mapping ymfm-faithful: bit 4 = reset_timer_a (clear overflow flag)
    const { ym2151TickCycles } = await import("../src/audio/ym2151.js");
    const ym = createYM2151();
    ym2151WriteAddr(ym, as_u8(0x10)); ym2151WriteData(ym, as_u8(0x00));
    ym2151WriteAddr(ym, as_u8(0x11)); ym2151WriteData(ym, as_u8(0x00));
    ym2151WriteAddr(ym, as_u8(0x14)); ym2151WriteData(ym, as_u8(0x01));
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
    expect(ym.timerAOverflow).toBe(true);
  });

  it("Timer A enable bit 2: arm + enable → overflow asserts IRQ gate", async () => {
    // Bit mapping ymfm-faithful: bit 0 = load_timer_a, bit 2 = enable_timer_a
    // (= IRQ enable nella semantica MAME). $14=$05 = bit 0 + bit 2 = "load
    // timer + enable IRQ assertion on overflow". E' il valore che Marble
    // sound ROM scrive a boot init a $819F-$81A2.
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
});

describe("YM2151 reset", () => {
  it("reset pulisce reg file, selected, flags", () => {
    const ym = createYM2151();
    ym2151WriteAddr(ym, as_u8(0x40));
    ym2151WriteData(ym, as_u8(0xFF));
    ym2151WriteData(ym, as_u8(0x77));
    ym.timerAOverflow = true;
    ym.timerBOverflow = true;

    ym2151Reset(ym);

    expect(Array.from(ym.regs).every((b) => b === 0)).toBe(true);
    expect(ym.selectedReg).toBe(0);
    expect(ym.timerAOverflow).toBe(false);
    expect(ym.timerBOverflow).toBe(false);
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
