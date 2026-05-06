/**
 * sound-irq-input.test.ts — smoke + corner cases di soundIrqInputTick.
 *
 * Bit-perfect parity verificata vs binary tramite
 * `cli/src/test-sound-irq-input-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  soundIrqInputTick,
  SND_IRQ_BUF_OFF,
  SND_IRQ_IDX_OFF,
  SND_IRQ_CNT_OFF,
  SND_IRQ_ACK_PTR_OFF,
} from "../src/sound-irq-input.js";
import { emptyGameState } from "../src/state.js";

function setLong(buf: Uint8Array, off: number, val: number): void {
  buf[off] = (val >>> 24) & 0xff;
  buf[off + 1] = (val >>> 16) & 0xff;
  buf[off + 2] = (val >>> 8) & 0xff;
  buf[off + 3] = val & 0xff;
}

function getLong(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

describe("soundIrqInputTick (FUN_4D1A)", () => {
  it("non solleva con state vuoto e cmd 0", () => {
    const s = emptyGameState();
    expect(() => soundIrqInputTick(s, 0)).not.toThrow();
  });

  it("ack==0, idx=0: scrive byte a buffer[0] e idx → 1", () => {
    const s = emptyGameState();
    s.workRam[SND_IRQ_IDX_OFF] = 0;
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0);

    soundIrqInputTick(s, 0xab);

    expect(s.workRam[SND_IRQ_BUF_OFF]).toBe(0xab);
    expect(s.workRam[SND_IRQ_IDX_OFF]).toBe(1);
  });

  it("ack==0, idx=14: scrive a buffer[14] e idx → 15", () => {
    const s = emptyGameState();
    s.workRam[SND_IRQ_IDX_OFF] = 14;
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0);

    soundIrqInputTick(s, 0x42);

    expect(s.workRam[SND_IRQ_BUF_OFF + 14]).toBe(0x42);
    expect(s.workRam[SND_IRQ_IDX_OFF]).toBe(15);
  });

  it("ack==0, idx=15: wrap → idx=0, scrive a buffer[15]", () => {
    const s = emptyGameState();
    s.workRam[SND_IRQ_IDX_OFF] = 15;
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0);

    soundIrqInputTick(s, 0xcc);

    // PRE-increment idx era 15 → buffer[15] (offset 0x401F46+15 = 0x401F55)
    expect(s.workRam[SND_IRQ_BUF_OFF + 15]).toBe(0xcc);
    // dopo addq.b 1 → 16; bcs (idxPre<0xF) non scatta → clr.b → 0
    expect(s.workRam[SND_IRQ_IDX_OFF]).toBe(0);
  });

  it("ack!=0, counter>1: incr ackPtr, decr counter, scrive a ackPtr (PRE)", () => {
    const s = emptyGameState();
    // ackPtr punta dentro workRam (offset 0x1FE0 = 0x401FE0)
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0x00401fe0);
    s.workRam[SND_IRQ_CNT_OFF] = 5;

    soundIrqInputTick(s, 0x77);

    // mmioByte scritto a 0x401FE0 (PRE-increment)
    expect(s.workRam[0x1fe0]).toBe(0x77);
    // ackPtr incrementato di 1 (long)
    expect(getLong(s.workRam, SND_IRQ_ACK_PTR_OFF)).toBe(0x00401fe1);
    // counter decrementato
    expect(s.workRam[SND_IRQ_CNT_OFF]).toBe(4);
  });

  it("ack!=0, counter==1: scrive byte, poi azzera ackPtr (sequenza chiusa)", () => {
    const s = emptyGameState();
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0x00401fe0);
    s.workRam[SND_IRQ_CNT_OFF] = 1;

    soundIrqInputTick(s, 0x55);

    expect(s.workRam[0x1fe0]).toBe(0x55);
    // counter dec → 0 → ackPtr azzerato
    expect(getLong(s.workRam, SND_IRQ_ACK_PTR_OFF)).toBe(0);
    expect(s.workRam[SND_IRQ_CNT_OFF]).toBe(0);
  });

  it("ack==0, byte=0: scrive 0 nel buffer (cmd 0)", () => {
    const s = emptyGameState();
    s.workRam[SND_IRQ_IDX_OFF] = 5;
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0);
    s.workRam[SND_IRQ_BUF_OFF + 5] = 0xff; // sentinel pre-existing

    soundIrqInputTick(s, 0);

    expect(s.workRam[SND_IRQ_BUF_OFF + 5]).toBe(0);
    expect(s.workRam[SND_IRQ_IDX_OFF]).toBe(6);
  });

  it("ack!=0, counter==0 → wrap subq.b → 0xFF, ackPtr restano valorizzati", () => {
    // Caso atipico: counter parte a 0, subq.b 1 → 0xFF, bne salta clr.l.
    const s = emptyGameState();
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0x00401fe0);
    s.workRam[SND_IRQ_CNT_OFF] = 0;

    soundIrqInputTick(s, 0x33);

    expect(s.workRam[0x1fe0]).toBe(0x33);
    expect(getLong(s.workRam, SND_IRQ_ACK_PTR_OFF)).toBe(0x00401fe1);
    expect(s.workRam[SND_IRQ_CNT_OFF]).toBe(0xff);
  });
});
