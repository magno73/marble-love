/**
 * Test auxTimer (FUN_10146) — smoke tests sui rami principali.
 *
 * Bit-perfect verificato vs binary tramite `cli/src/test-aux-timer-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  auxTimer,
  ACTIVE_FLAG_OFF,
  COUNTER_OFF,
  COUNTDOWN_HI_OFF,
  COUNTDOWN_LO_OFF,
} from "../src/aux-timer.js";
import {
  QUEUE_DATA_OFF,
  QUEUE_HEAD_OFF,
  QUEUE_TAIL_OFF,
} from "../src/byte-queue.js";
import { emptyGameState } from "../src/state.js";

function setQueue(s: ReturnType<typeof emptyGameState>, head: number, tail: number, buf: number[]) {
  s.workRam[QUEUE_HEAD_OFF] = head;
  s.workRam[QUEUE_TAIL_OFF] = tail;
  for (let i = 0; i < buf.length; i++) {
    s.workRam[QUEUE_DATA_OFF + ((head + i) & 0xf)] = buf[i] ?? 0;
  }
}

describe("auxTimer (FUN_10146)", () => {
  it("queue vuota: no-op (no side effects)", () => {
    const s = emptyGameState();
    s.workRam[COUNTDOWN_HI_OFF] = 0x01;
    s.workRam[COUNTDOWN_LO_OFF] = 0x2c;
    s.workRam[ACTIVE_FLAG_OFF] = 0x40;
    s.workRam[COUNTER_OFF] = 0x05;
    setQueue(s, 7, 7, []); // head==tail → empty

    auxTimer(s);

    // Tutti gli stati invariati.
    expect(s.workRam[COUNTDOWN_HI_OFF]).toBe(0x01);
    expect(s.workRam[COUNTDOWN_LO_OFF]).toBe(0x2c);
    expect(s.workRam[ACTIVE_FLAG_OFF]).toBe(0x40);
    expect(s.workRam[COUNTER_OFF]).toBe(0x05);
    expect(s.workRam[QUEUE_HEAD_OFF]).toBe(7); // head NON avanza
  });

  it("countdown != 0 + byte 0xFF: clear countdown, NO inc counter", () => {
    const s = emptyGameState();
    s.workRam[COUNTDOWN_HI_OFF] = 0x01;
    s.workRam[COUNTDOWN_LO_OFF] = 0x2c;
    s.workRam[COUNTER_OFF] = 0x05;
    setQueue(s, 0, 1, [0xff]);

    auxTimer(s);

    expect(s.workRam[COUNTDOWN_HI_OFF]).toBe(0);
    expect(s.workRam[COUNTDOWN_LO_OFF]).toBe(0);
    expect(s.workRam[COUNTER_OFF]).toBe(0x05); // invariato
    expect(s.workRam[QUEUE_HEAD_OFF]).toBe(1); // head avanzato
  });

  it("countdown != 0 + byte != 0xFF: fall-through (counter++)", () => {
    const s = emptyGameState();
    s.workRam[COUNTDOWN_HI_OFF] = 0x01;
    s.workRam[COUNTDOWN_LO_OFF] = 0x2c;
    s.workRam[ACTIVE_FLAG_OFF] = 0; // così salta anche il branch attivo
    s.workRam[COUNTER_OFF] = 0x10;
    setQueue(s, 0, 1, [0x42]);

    auxTimer(s);

    // Countdown invariato, attivo non si attiva, counter incrementa.
    expect(s.workRam[COUNTDOWN_HI_OFF]).toBe(0x01);
    expect(s.workRam[COUNTDOWN_LO_OFF]).toBe(0x2c);
    expect(s.workRam[COUNTER_OFF]).toBe(0x11);
  });

  it("countdown == 0 + active flag set + byte multiplo di 8: reset coppia", () => {
    const s = emptyGameState();
    s.workRam[COUNTDOWN_HI_OFF] = 0;
    s.workRam[COUNTDOWN_LO_OFF] = 0;
    s.workRam[ACTIVE_FLAG_OFF] = 0x40;
    s.workRam[COUNTER_OFF] = 0x07;
    setQueue(s, 0, 1, [0x08]); // 0x08 & 7 == 0

    auxTimer(s);

    expect(s.workRam[ACTIVE_FLAG_OFF]).toBe(0);
    expect(s.workRam[COUNTER_OFF]).toBe(0);
  });

  it("countdown == 0 + active flag set + byte non multiplo di 8: counter++", () => {
    const s = emptyGameState();
    s.workRam[COUNTDOWN_HI_OFF] = 0;
    s.workRam[COUNTDOWN_LO_OFF] = 0;
    s.workRam[ACTIVE_FLAG_OFF] = 0x40;
    s.workRam[COUNTER_OFF] = 0x07;
    setQueue(s, 0, 1, [0x09]); // 0x09 & 7 == 1

    auxTimer(s);

    expect(s.workRam[ACTIVE_FLAG_OFF]).toBe(0x40); // invariato
    expect(s.workRam[COUNTER_OFF]).toBe(0x08);
  });

  it("counter wrap modulo 256 (0xFF + 1 → 0)", () => {
    const s = emptyGameState();
    s.workRam[COUNTDOWN_HI_OFF] = 0;
    s.workRam[COUNTDOWN_LO_OFF] = 0;
    s.workRam[ACTIVE_FLAG_OFF] = 0;
    s.workRam[COUNTER_OFF] = 0xff;
    setQueue(s, 0, 1, [0x42]);

    auxTimer(s);

    expect(s.workRam[COUNTER_OFF]).toBe(0x00);
  });

  it("countdown != 0 + 0xFF prevale sul check active flag", () => {
    const s = emptyGameState();
    s.workRam[COUNTDOWN_HI_OFF] = 0x00;
    s.workRam[COUNTDOWN_LO_OFF] = 0x10;
    s.workRam[ACTIVE_FLAG_OFF] = 0x40; // sarebbe attivo
    s.workRam[COUNTER_OFF] = 0x20;
    setQueue(s, 0, 1, [0xff]);

    auxTimer(s);

    expect(s.workRam[COUNTDOWN_HI_OFF]).toBe(0);
    expect(s.workRam[COUNTDOWN_LO_OFF]).toBe(0);
    expect(s.workRam[ACTIVE_FLAG_OFF]).toBe(0x40); // NON resettato
    expect(s.workRam[COUNTER_OFF]).toBe(0x20); // NON incrementato
  });
});
