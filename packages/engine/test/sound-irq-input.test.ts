/**
 * sound-irq-input.test.ts — smoke + corner cases of soundIrqInputTick.
 *
 * Bit-perfect parity verified vs binary via
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
  it("does not throw with empty state and cmd 0", () => {
    const s = emptyGameState();
    expect(() => soundIrqInputTick(s, 0)).not.toThrow();
  });

  it("ack==0, idx=0: writes byte to buffer[0] and idx → 1", () => {
    const s = emptyGameState();
    s.workRam[SND_IRQ_IDX_OFF] = 0;
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0);

    soundIrqInputTick(s, 0xab);

    expect(s.workRam[SND_IRQ_BUF_OFF]).toBe(0xab);
    expect(s.workRam[SND_IRQ_IDX_OFF]).toBe(1);
  });

  it("ack==0, idx=14: writes to buffer[14] and idx → 15", () => {
    const s = emptyGameState();
    s.workRam[SND_IRQ_IDX_OFF] = 14;
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0);

    soundIrqInputTick(s, 0x42);

    expect(s.workRam[SND_IRQ_BUF_OFF + 14]).toBe(0x42);
    expect(s.workRam[SND_IRQ_IDX_OFF]).toBe(15);
  });

  it("ack==0, idx=15: wrap → idx=0, writes to buffer[15]", () => {
    const s = emptyGameState();
    s.workRam[SND_IRQ_IDX_OFF] = 15;
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0);

    soundIrqInputTick(s, 0xcc);

    // PRE-increment idx was 15 → buffer[15] (offset 0x401F46+15 = 0x401F55)
    expect(s.workRam[SND_IRQ_BUF_OFF + 15]).toBe(0xcc);
    // after addq.b 1 -> 16; bcs (idxPre<0xF) does not branch -> clr.b -> 0.
    expect(s.workRam[SND_IRQ_IDX_OFF]).toBe(0);
  });

  it("ack!=0, counter>1: incr ackPtr, decr counter, writes to ackPtr (PRE)", () => {
    const s = emptyGameState();
    // ackPtr points inside workRam (offset 0x1FE0 = 0x401FE0)
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0x00401fe0);
    s.workRam[SND_IRQ_CNT_OFF] = 5;

    soundIrqInputTick(s, 0x77);

    // mmioByte written to 0x401FE0 (PRE-increment).
    expect(s.workRam[0x1fe0]).toBe(0x77);
    // ackPtr incremented by 1 (long)
    expect(getLong(s.workRam, SND_IRQ_ACK_PTR_OFF)).toBe(0x00401fe1);
    // counter decremented
    expect(s.workRam[SND_IRQ_CNT_OFF]).toBe(4);
  });

  it("ack!=0, counter==1: writes byte, then clears ackPtr (sequence closed)", () => {
    const s = emptyGameState();
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0x00401fe0);
    s.workRam[SND_IRQ_CNT_OFF] = 1;

    soundIrqInputTick(s, 0x55);

    expect(s.workRam[0x1fe0]).toBe(0x55);
    // counter dec -> 0 -> ackPtr cleared.
    expect(getLong(s.workRam, SND_IRQ_ACK_PTR_OFF)).toBe(0);
    expect(s.workRam[SND_IRQ_CNT_OFF]).toBe(0);
  });

  it("ack==0, byte=0: writes 0 into the buffer (cmd 0)", () => {
    const s = emptyGameState();
    s.workRam[SND_IRQ_IDX_OFF] = 5;
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0);
    s.workRam[SND_IRQ_BUF_OFF + 5] = 0xff; // sentinel pre-existing

    soundIrqInputTick(s, 0);

    expect(s.workRam[SND_IRQ_BUF_OFF + 5]).toBe(0);
    expect(s.workRam[SND_IRQ_IDX_OFF]).toBe(6);
  });

  it("ack!=0, counter==0 → wrap subq.b → 0xFF, ackPtr stays set", () => {
    // Atypical case: counter starts at 0, subq.b 1 → 0xFF, bne skips clr.l.
    const s = emptyGameState();
    setLong(s.workRam, SND_IRQ_ACK_PTR_OFF, 0x00401fe0);
    s.workRam[SND_IRQ_CNT_OFF] = 0;

    soundIrqInputTick(s, 0x33);

    expect(s.workRam[0x1fe0]).toBe(0x33);
    expect(getLong(s.workRam, SND_IRQ_ACK_PTR_OFF)).toBe(0x00401fe1);
    expect(s.workRam[SND_IRQ_CNT_OFF]).toBe(0xff);
  });
});
