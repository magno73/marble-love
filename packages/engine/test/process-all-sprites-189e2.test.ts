/**
 * process-all-sprites-189e2.test.ts — smoke for FUN_000189E2.
 *
 * Bit-perfect parity verified in
 * `packages/cli/src/test-process-all-sprites-189e2-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  processAllSprites,
  processAllSpritesWith,
  SPRITE_TABLE_BASE,
  SPRITE_TABLE_ENTRY_STRIDE,
  GATE_FLAG_ADDR,
  COUNT_ADDR,
} from "../src/process-all-sprites-189e2.js";
import { emptyGameState } from "../src/state.js";

const GATE_OFF = 0x394;
const COUNT_OFF = 0x396;

function setU16(
  s: ReturnType<typeof emptyGameState>,
  off: number,
  v: number,
): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

describe("processAllSprites (FUN_000189E2)", () => {
  it("gate flag != 0 → returns immediato senza call la callback", () => {
    const s = emptyGameState();
    setU16(s, GATE_OFF, 0x0001); // gate set
    setU16(s, COUNT_OFF, 5);
    let calls = 0;
    processAllSpritesWith(s, () => {
      calls++;
    });
    expect(calls).toBe(0);
  });

  it("gate=0, count=0 → loop a zero iterazioni", () => {
    const s = emptyGameState();
    setU16(s, GATE_OFF, 0);
    setU16(s, COUNT_OFF, 0);
    let calls = 0;
    processAllSpritesWith(s, () => {
      calls++;
    });
    expect(calls).toBe(0);
  });

  it("gate=0, count=N → calls con base+i*0xC per i in [0..N)", () => {
    const s = emptyGameState();
    setU16(s, GATE_OFF, 0);
    setU16(s, COUNT_OFF, 4);
    const seen: number[] = [];
    processAllSpritesWith(s, (_state, addr) => {
      seen.push(addr);
    });
    expect(seen).toEqual([
      0x40098c,
      0x40098c + 0xc,
      0x40098c + 0x18,
      0x40098c + 0x24,
    ]);
  });

  it("gate flag in upper byte (0x0100) → ancora skip (tst.w word)", () => {
    const s = emptyGameState();
    setU16(s, GATE_OFF, 0x0100); // bit alto of the word
    setU16(s, COUNT_OFF, 3);
    let calls = 0;
    processAllSpritesWith(s, () => {
      calls++;
    });
    expect(calls).toBe(0);
  });

  it("integration con computeSpriteCoords_v1: skip path (entry+0xA == 0xFF) non altera entry", () => {
    const s = emptyGameState();
    setU16(s, GATE_OFF, 0);
    setU16(s, COUNT_OFF, 1);
    // Entry @ 0x40098C: mark byte+0xA = 0xFF → computeSpriteCoords_v1 skip
    const entryOff = 0x98c;
    s.workRam[entryOff + 0xa] = 0xff;
    // Pre-fill output zone (entry+0x6..0x9) to verify it remains unchanged.
    s.workRam[entryOff + 0x6] = 0xde;
    s.workRam[entryOff + 0x7] = 0xad;
    s.workRam[entryOff + 0x8] = 0xbe;
    s.workRam[entryOff + 0x9] = 0xef;
    processAllSprites(s);
    expect(s.workRam[entryOff + 0x6]).toBe(0xde);
    expect(s.workRam[entryOff + 0x7]).toBe(0xad);
    expect(s.workRam[entryOff + 0x8]).toBe(0xbe);
    expect(s.workRam[entryOff + 0x9]).toBe(0xef);
  });

  it("costanti esportate matchano il binario", () => {
    expect(SPRITE_TABLE_BASE).toBe(0x40098c);
    expect(SPRITE_TABLE_ENTRY_STRIDE).toBe(0xc);
    expect(GATE_FLAG_ADDR).toBe(0x400394);
    expect(COUNT_ADDR).toBe(0x400396);
  });

  it("gate=0, count=2 con gate scritto in big-endian: tst.w only if both the bytes are 0", () => {
    const s = emptyGameState();
    // Only the low byte of the gate set (0x0001) → gate word = 1 → skip
    s.workRam[GATE_OFF] = 0x00;
    s.workRam[GATE_OFF + 1] = 0x01;
    setU16(s, COUNT_OFF, 2);
    let calls = 0;
    processAllSpritesWith(s, () => {
      calls++;
    });
    expect(calls).toBe(0);
  });
});
