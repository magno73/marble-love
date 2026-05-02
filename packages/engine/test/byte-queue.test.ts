/**
 * Test dequeueByte (FUN_4D68) + orPairBytes (FUN_53EA).
 *
 * Bit-perfect verificati vs binary tramite `cli/src/test-byte-queue-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  dequeueByte,
  orPairBytes,
  QUEUE_BASE_OFF,
  QUEUE_DATA_OFF,
  QUEUE_HEAD_OFF,
  QUEUE_TAIL_OFF,
} from "../src/byte-queue.js";
import { emptyGameState } from "../src/state.js";

describe("dequeueByte (FUN_4D68)", () => {
  function setupQueue(head: number, tail: number, buffer: number[]): ReturnType<typeof emptyGameState> {
    const s = emptyGameState();
    s.workRam[QUEUE_HEAD_OFF] = head;
    s.workRam[QUEUE_TAIL_OFF] = tail;
    for (let i = 0; i < buffer.length; i++) {
      s.workRam[QUEUE_DATA_OFF + i] = buffer[i] ?? 0;
    }
    return s;
  }

  it("queue vuota (head==tail): ritorna 0xFFFFFFFF", () => {
    const s = setupQueue(0, 0, []);
    expect(dequeueByte(s)).toBe(0xFFFFFFFF);
    expect(s.workRam[QUEUE_HEAD_OFF]).toBe(0); // unchanged
  });

  it("queue vuota a metà (head==tail==5)", () => {
    const s = setupQueue(5, 5, []);
    expect(dequeueByte(s)).toBe(0xFFFFFFFF);
    expect(s.workRam[QUEUE_HEAD_OFF]).toBe(5);
  });

  it("dequeue uno: head=0 tail=1 buffer[0]=0xAB → ritorna 0xAB, head=1", () => {
    const s = setupQueue(0, 1, [0xAB]);
    expect(dequeueByte(s)).toBe(0xAB);
    expect(s.workRam[QUEUE_HEAD_OFF]).toBe(1);
  });

  it("head=15 (wrap): dopo dequeue head torna a 0", () => {
    const s = setupQueue(15, 14, [
      0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0, 0xCC, // buffer[15] = 0xCC
    ]);
    expect(dequeueByte(s)).toBe(0xCC);
    expect(s.workRam[QUEUE_HEAD_OFF]).toBe(0);
  });

  it("head=14 (no wrap): dopo dequeue head=15", () => {
    const s = setupQueue(14, 13, [
      0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0, 0xDD,
    ]);
    expect(dequeueByte(s)).toBe(0xDD);
    expect(s.workRam[QUEUE_HEAD_OFF]).toBe(15);
  });

  it("byte ritornato è unsigned (0..255)", () => {
    const s = setupQueue(0, 1, [0xFF]);
    expect(dequeueByte(s)).toBe(0xFF); // not -1
  });

  it("non modifica tail", () => {
    const s = setupQueue(2, 5, [0,0,0xAA]);
    dequeueByte(s);
    expect(s.workRam[QUEUE_TAIL_OFF]).toBe(5);
  });
});

describe("orPairBytes (FUN_53EA)", () => {
  it("entrambi 0 → 0", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0;
    s.workRam[0x101] = 0;
    expect(orPairBytes(s, 0x400100)).toBe(0);
  });

  it("solo primo set → primo byte", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0xAB;
    s.workRam[0x101] = 0;
    expect(orPairBytes(s, 0x400100)).toBe(0xAB);
  });

  it("solo secondo set → secondo byte", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0;
    s.workRam[0x101] = 0xCD;
    expect(orPairBytes(s, 0x400100)).toBe(0xCD);
  });

  it("entrambi: OR bitwise", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0x33;
    s.workRam[0x101] = 0xCC;
    expect(orPairBytes(s, 0x400100)).toBe(0xFF);
  });

  it("ritorna sempre long (high bits 0)", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0xFF;
    s.workRam[0x101] = 0xFF;
    expect(orPairBytes(s, 0x400100)).toBe(0xFF); // not 0xFFFFFFFF
  });
});
