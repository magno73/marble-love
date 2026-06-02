/**
 * m6502-mailbox.test.ts — protocol test mailbox bidirezionale 68K↔6502.
 *
 * Intent: the Atari System 1 hardware pattern requires that (1) mailboxes latch
 * bytes with pending flags, and (2) the write side asserts NMI/IRQ only on the
 * transizione false→true (edge-triggered), (3) read side does ack to the
 * pending and releases the pin. The tests verify that the TS model keeps
 * this semantic byte-for-byte because any violation makes the
 * protocollo cmd 68K→6502 (e.g. doppio NMI = ISR rientrante).
 */

import { describe, it, expect } from "vitest";
import { as_u8, as_u16 } from "../src/wrap.js";
import {
  createMailbox, mailboxWrite, mailboxRead, mailboxReset,
} from "../src/m6502/mailbox.js";
import { createSoundMmu } from "../src/m6502/sound-mmu.js";

describe("mailbox baif thetch", () => {
  it("init pulita: pending=false, value=0", () => {
    const mb = createMailbox();
    expect(mb.pending).toBe(false);
    expect(mb.value as number).toBe(0);
  });

  it("write set pending + calls callback edge-triggered una time", () => {
    const mb = createMailbox();
    let cbCount = 0;
    mailboxWrite(mb, as_u8(0x42), () => cbCount++);
    expect(mb.pending).toBe(true);
    expect(mb.value as number).toBe(0x42);
    expect(cbCount).toBe(1);
    // Multiple writes without an intervening read: pending remains true, callback does not
    // retriggers (edge-triggered, not level-triggered).
    mailboxWrite(mb, as_u8(0x99), () => cbCount++);
    expect(mb.value as number).toBe(0x99);
    expect(cbCount).toBe(1);
  });

  it("read ack pending + calls callback only if era pending", () => {
    const mb = createMailbox();
    mailboxWrite(mb, as_u8(0x42));
    let ackCount = 0;
    const v = mailboxRead(mb, () => ackCount++);
    expect(v as number).toBe(0x42);
    expect(mb.pending).toBe(false);
    expect(ackCount).toBe(1);
    // Re-read without a new write: value persists in the latch, but callback
    // does not retrigger because pending was already false.
    const v2 = mailboxRead(mb, () => ackCount++);
    expect(v2 as number).toBe(0x42);
    expect(ackCount).toBe(1);
  });

  it("reset hard: pending=false, value=0", () => {
    const mb = createMailbox();
    mailboxWrite(mb, as_u8(0xff));
    mailboxReset(mb);
    expect(mb.pending).toBe(false);
    expect(mb.value as number).toBe(0);
  });
});

describe("sound-mmu RAM + ROM regions", () => {
  function buildMmu() {
    const rom = new Uint8Array(0xC000).fill(0xff);
    // Vector RESET a $FFFC/$FFFD (= addr 0xBFFC/0xBFFD in the rom offset).
    rom[0xBFFC] = 0x00;
    rom[0xBFFD] = 0x80;  // PC start = $8000
    // ROM marker a $C000 (offset 0x8000 in the rom buffer).
    rom[0x8000] = 0xAB;
    rom[0x8001] = 0xCD;
    return createSoundMmu({
      rom,
      mainToSound: createMailbox(),
      soundToMain: createMailbox(),
    });
  }

  it("RAM $0000-$0FFF read-write trasparente, mirror nessuno", () => {
    const mmu = buildMmu();
    mmu.write8(as_u16(0x0000), as_u8(0x42));
    mmu.write8(as_u16(0x0FFF), as_u8(0x99));
    expect(mmu.read8(as_u16(0x0000)) as number).toBe(0x42);
    expect(mmu.read8(as_u16(0x0FFF)) as number).toBe(0x99);
    // RAM mirror not modeled: $1000 must not alias $0000.
    expect(mmu.read8(as_u16(0x1000)) as number).toBe(0xff);
  });

  it("ROM $4000-$FFFF read-only: scrittura ignorata, value persiste", () => {
    const mmu = buildMmu();
    expect(mmu.read8(as_u16(0xC000)) as number).toBe(0xAB);
    expect(mmu.read8(as_u16(0xC001)) as number).toBe(0xCD);
    expect(mmu.read8(as_u16(0xFFFC)) as number).toBe(0x00);
    expect(mmu.read8(as_u16(0xFFFD)) as number).toBe(0x80);
    // Write to ROM: open-bus convention, value does not change.
    mmu.write8(as_u16(0xC000), as_u8(0x00));
    expect(mmu.read8(as_u16(0xC000)) as number).toBe(0xAB);
  });
});

describe("sound-mmu mailbox $1810 bidirezionale", () => {
  it("read $1810 = main→sound latch, ack su read, NMI callback edge-triggered", () => {
    const mainToSound = createMailbox();
    const soundToMain = createMailbox();
    let nmiAsserted = 0;
    let nmiReleased = 0;
    const mmu = createSoundMmu({
      rom: new Uint8Array(0xC000).fill(0xff),
      mainToSound, soundToMain,
      onMainToSoundAck: () => nmiReleased++,
    });
    // 68K simulates write to $FE0001 (= mailboxWrite with NMI callback).
    mailboxWrite(mainToSound, as_u8(0x77), () => nmiAsserted++);
    expect(nmiAsserted).toBe(1);
    // bit 3 ($08) = main→sound pending (NMI source) per atarisy1.cpp::switch_6502_r
    expect((mmu.read8(as_u16(0x1820)) as number) & 0x08).toBe(0x08);
    // 6502 reads the byte from $1810 -> ack.
    const v = mmu.read8(as_u16(0x1810));
    expect(v as number).toBe(0x77);
    expect(nmiReleased).toBe(1);
    expect((mmu.read8(as_u16(0x1820)) as number) & 0x08).toBe(0); // pending clear
  });

  it("write $1810 = sound→main latch, IRQ6 callback edge-triggered", () => {
    const mainToSound = createMailbox();
    const soundToMain = createMailbox();
    let irq6Asserted = 0;
    const mmu = createSoundMmu({
      rom: new Uint8Array(0xC000).fill(0xff),
      mainToSound, soundToMain,
      onSoundToMainPost: () => irq6Asserted++,
    });
    mmu.write8(as_u16(0x1810), as_u8(0x55));
    expect(irq6Asserted).toBe(1);
    // bit 4 ($10) = sound→main pending (response buffer full)
    expect((mmu.read8(as_u16(0x1820)) as number) & 0x10).toBe(0x10);
    // 68K simula read da $FC0001 → ack
    const v = mailboxRead(soundToMain);
    expect(v as number).toBe(0x55);
    expect((mmu.read8(as_u16(0x1820)) as number) & 0x10).toBe(0); // pending clear
  });

  it("status $1820 combinato: bit3 main-pending + bit4 sound-pending coesistono", () => {
    const mainToSound = createMailbox();
    const soundToMain = createMailbox();
    const mmu = createSoundMmu({
      rom: new Uint8Array(0xC000).fill(0xff),
      mainToSound, soundToMain,
    });
    mailboxWrite(mainToSound, as_u8(0x11));
    mmu.write8(as_u16(0x1810), as_u8(0x22));
    // bit 7 + bits 0-2 ($87 pull-up base) + bit3 ($08 main pending) + bit4 ($10 sound pending) = $9F
    expect(mmu.read8(as_u16(0x1820)) as number).toBe(0x9f);
  });

  it("status $1820 supporta un override diagnostico of the base coin/self-test", () => {
    const mainToSound = createMailbox();
    const soundToMain = createMailbox();
    const mmu = createSoundMmu({
      rom: new Uint8Array(0xC000).fill(0xff),
      mainToSound,
      soundToMain,
      statusBase: as_u8(0x86),
    });
    expect(mmu.read8(as_u16(0x1820)) as number).toBe(0x86);
    mailboxWrite(mainToSound, as_u8(0x11));
    mmu.write8(as_u16(0x1810), as_u8(0x22));
    expect(mmu.read8(as_u16(0x1820)) as number).toBe(0x9e);
  });
});

describe("sound-mmu YM2151 / POKEY / LS259 stub", () => {
  function buildMmu() {
    return createSoundMmu({
      rom: new Uint8Array(0xC000).fill(0xff),
      mainToSound: createMailbox(),
      soundToMain: createMailbox(),
    });
  }

  it("YM2151 $1800/$1801: write salvati in shadow, read returns status", () => {
    const mmu = buildMmu();
    mmu.write8(as_u16(0x1800), as_u8(0x20));  // register select
    mmu.write8(as_u16(0x1801), as_u8(0xC0));  // register data
    expect(mmu.ym2151.regs[0x20]).toBe(0xC0);
    // Read $1801 returns the status byte. After write, busy bit (b7) is set (~68
    // master clock). Timer flag bits 0/1 = 0 (no overflow). Mask only timer bits.
    expect((mmu.read8(as_u16(0x1801)) as number) & 0x03).toBe(0);
  });

  it("POKEY $1870-$187F: write salvati in shadow, read returns 0", () => {
    const mmu = buildMmu();
    mmu.write8(as_u16(0x1875), as_u8(0xAB));
    mmu.write8(as_u16(0x187F), as_u8(0xCD));
    expect(mmu.pokey.writeRegs[0x05]).toBe(0xAB);
    expect(mmu.pokey.writeRegs[0x0F]).toBe(0xCD);
    expect(mmu.read8(as_u16(0x1875)) as number).toBe(0);
  });

  it("puo' differire le write chip mantenendo i callback diagnostici", () => {
    const deferred: Array<{ event: { kind: string; reg: number; val: number }; apply: () => void }> = [];
    const ymWrites: Array<{ reg: number; val: number }> = [];
    const pokeyWrites: Array<{ reg: number; val: number }> = [];
    const mmu = createSoundMmu({
      rom: new Uint8Array(0xC000).fill(0xff),
      mainToSound: createMailbox(),
      soundToMain: createMailbox(),
      onYmWrite: (event) => ymWrites.push(event),
      onPokeyWrite: (event) => pokeyWrites.push(event),
      deferChipWrite: (event, apply) => {
        deferred.push({ event, apply });
        return true;
      },
    });

    mmu.write8(as_u16(0x1800), as_u8(0x20));
    expect(mmu.ym2151.selectedReg).toBe(0);
    expect(deferred[0]!.event).toMatchObject({ kind: "ym2151Addr", val: 0x20 });
    deferred.shift()!.apply();
    expect(mmu.ym2151.selectedReg).toBe(0x20);

    mmu.write8(as_u16(0x1801), as_u8(0xc0));
    expect(ymWrites).toEqual([{ reg: 0x20, val: 0xc0 }]);
    expect(mmu.ym2151.regs[0x20]).toBe(0);
    deferred.shift()!.apply();
    expect(mmu.ym2151.regs[0x20]).toBe(0xc0);

    mmu.write8(as_u16(0x1875), as_u8(0xab));
    expect(pokeyWrites).toEqual([{ reg: 0x05, val: 0xab }]);
    expect(mmu.pokey.writeRegs[0x05]).toBe(0);
    expect(deferred[0]!.event).toMatchObject({ kind: "pokey", reg: 0x05, val: 0xab });
    deferred.shift()!.apply();
    expect(mmu.pokey.writeRegs[0x05]).toBe(0xab);
  });

  it("LS259 $1820-$1827: address selects the latched bit and D0 selects state", () => {
    const mmu = buildMmu();
    mmu.write8(as_u16(0x1824), as_u8(0x02));
    mmu.write8(as_u16(0x1825), as_u8(0x01));
    expect(mmu.ls259Shadow[4]).toBe(0x00);
    expect(mmu.ls259Shadow[5]).toBe(0x01);
  });

  it("LS259 bit 0 drives YM2151 reset", () => {
    const mmu = buildMmu();
    mmu.write8(as_u16(0x1800), as_u8(0x20));
    mmu.write8(as_u16(0x1801), as_u8(0xc0));
    expect(mmu.ym2151.regs[0x20]).toBe(0xc0);

    mmu.write8(as_u16(0x1824), as_u8(0x02));
    expect(mmu.ym2151.regs[0x20]).toBe(0xc0);

    mmu.write8(as_u16(0x1820), as_u8(0x01));
    expect(mmu.ls259Shadow[0]).toBe(0x01);
    expect(mmu.ym2151.regs[0x20]).toBe(0);
  });

  it("Open bus $1830, $1850, $1880, $2000: read=0xff", () => {
    const mmu = buildMmu();
    expect(mmu.read8(as_u16(0x1830)) as number).toBe(0xff);
    expect(mmu.read8(as_u16(0x1850)) as number).toBe(0xff);
    expect(mmu.read8(as_u16(0x1880)) as number).toBe(0xff);
    expect(mmu.read8(as_u16(0x2000)) as number).toBe(0xff);
  });
});
