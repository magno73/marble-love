/**
 * m6502-mailbox.test.ts — protocol test mailbox bidirezionale 68K↔6502.
 *
 * Intent: il pattern hardware Atari System 1 richiede che (1) le mailbox
 * latch byte con pending flag, (2) write side asserisca NMI/IRQ solo sulla
 * transizione false→true (edge-triggered), (3) read side faccia ack al
 * pending e rilasci la pin. I test verificano che il modello TS mantenga
 * questa semantica byte-per-byte, perche' una violazione fa diverge il
 * protocollo cmd 68K→6502 (es. doppio NMI = ISR rientrante).
 */

import { describe, it, expect } from "vitest";
import { as_u8, as_u16 } from "../src/wrap.js";
import {
  createMailbox, mailboxWrite, mailboxRead, mailboxReset,
} from "../src/m6502/mailbox.js";
import { createSoundMmu } from "../src/m6502/sound-mmu.js";

describe("mailbox base latch", () => {
  it("init pulita: pending=false, value=0", () => {
    const mb = createMailbox();
    expect(mb.pending).toBe(false);
    expect(mb.value as number).toBe(0);
  });

  it("write set pending + chiama callback edge-triggered una volta", () => {
    const mb = createMailbox();
    let cbCount = 0;
    mailboxWrite(mb, as_u8(0x42), () => cbCount++);
    expect(mb.pending).toBe(true);
    expect(mb.value as number).toBe(0x42);
    expect(cbCount).toBe(1);
    // Write multipli senza read intermedio: pending resta true, callback NON
    // ri-triggera (edge-triggered, non level).
    mailboxWrite(mb, as_u8(0x99), () => cbCount++);
    expect(mb.value as number).toBe(0x99);
    expect(cbCount).toBe(1);
  });

  it("read ack pending + chiama callback solo se era pending", () => {
    const mb = createMailbox();
    mailboxWrite(mb, as_u8(0x42));
    let ackCount = 0;
    const v = mailboxRead(mb, () => ackCount++);
    expect(v as number).toBe(0x42);
    expect(mb.pending).toBe(false);
    expect(ackCount).toBe(1);
    // Re-read senza nuova write: valore persiste (latch), MA callback non
    // ri-triggera perche' pending era gia' false.
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
    // Vector RESET a $FFFC/$FFFD (= addr 0xBFFC/0xBFFD nel rom offset).
    rom[0xBFFC] = 0x00;
    rom[0xBFFD] = 0x80;  // PC start = $8000
    // ROM marker a $C000 (offset 0x8000 nel rom buffer).
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
    // RAM mirror NON modellato: $1000 NON deve aliasare $0000.
    expect(mmu.read8(as_u16(0x1000)) as number).toBe(0xff);
  });

  it("ROM $4000-$FFFF read-only: scrittura ignorata, valore persiste", () => {
    const mmu = buildMmu();
    expect(mmu.read8(as_u16(0xC000)) as number).toBe(0xAB);
    expect(mmu.read8(as_u16(0xC001)) as number).toBe(0xCD);
    expect(mmu.read8(as_u16(0xFFFC)) as number).toBe(0x00);
    expect(mmu.read8(as_u16(0xFFFD)) as number).toBe(0x80);
    // Write a ROM: open-bus convention, valore non cambia.
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
    // 68K simula write a $FE0001 (= mailboxWrite con NMI callback).
    mailboxWrite(mainToSound, as_u8(0x77), () => nmiAsserted++);
    expect(nmiAsserted).toBe(1);
    expect(mmu.read8(as_u16(0x1820)) as number & 0x10).toBe(0x10); // bit 4 main pending
    // 6502 legge il byte da $1810 → ack
    const v = mmu.read8(as_u16(0x1810));
    expect(v as number).toBe(0x77);
    expect(nmiReleased).toBe(1);
    expect(mmu.read8(as_u16(0x1820)) as number & 0x10).toBe(0); // pending clear
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
    expect(mmu.read8(as_u16(0x1820)) as number & 0x08).toBe(0x08); // bit 3 sound pending
    // 68K simula read da $FC0001 → ack
    const v = mailboxRead(soundToMain);
    expect(v as number).toBe(0x55);
    expect(mmu.read8(as_u16(0x1820)) as number & 0x08).toBe(0); // pending clear
  });

  it("status $1820 combinato: bit3 sound-pending + bit4 main-pending coesistono", () => {
    const mainToSound = createMailbox();
    const soundToMain = createMailbox();
    const mmu = createSoundMmu({
      rom: new Uint8Array(0xC000).fill(0xff),
      mainToSound, soundToMain,
    });
    mailboxWrite(mainToSound, as_u8(0x11));
    mmu.write8(as_u16(0x1810), as_u8(0x22));
    expect(mmu.read8(as_u16(0x1820)) as number).toBe(0x18); // bit3+bit4 = 0x18
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

  it("YM2151 $1800/$1801: write salvati in shadow, read ritorna 0 (Phase 4 stub)", () => {
    const mmu = buildMmu();
    mmu.write8(as_u16(0x1800), as_u8(0x20));  // register select
    mmu.write8(as_u16(0x1801), as_u8(0xC0));  // register data
    expect(mmu.ym2151.regs[0x20]).toBe(0xC0);
    expect(mmu.read8(as_u16(0x1801)) as number).toBe(0);
  });

  it("POKEY $1870-$187F: write salvati in shadow, read ritorna 0", () => {
    const mmu = buildMmu();
    mmu.write8(as_u16(0x1875), as_u8(0xAB));
    mmu.write8(as_u16(0x187F), as_u8(0xCD));
    expect(mmu.pokey.writeRegs[0x05]).toBe(0xAB);
    expect(mmu.pokey.writeRegs[0x0F]).toBe(0xCD);
    expect(mmu.read8(as_u16(0x1875)) as number).toBe(0);
  });

  it("LS259 $1824/$1825: write salvati in shadow", () => {
    const mmu = buildMmu();
    mmu.write8(as_u16(0x1824), as_u8(0x01));
    mmu.write8(as_u16(0x1825), as_u8(0x00));
    expect(mmu.ls259Shadow[0]).toBe(0x01);
    expect(mmu.ls259Shadow[1]).toBe(0x00);
  });

  it("Open bus $1830, $1850, $1880, $2000: read=0xff", () => {
    const mmu = buildMmu();
    expect(mmu.read8(as_u16(0x1830)) as number).toBe(0xff);
    expect(mmu.read8(as_u16(0x1850)) as number).toBe(0xff);
    expect(mmu.read8(as_u16(0x1880)) as number).toBe(0xff);
    expect(mmu.read8(as_u16(0x2000)) as number).toBe(0xff);
  });
});
