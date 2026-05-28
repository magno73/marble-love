/**
 * pokey.test.ts — Phase 6 register-state parity smoke.
 *
 * Intent: the Marble sound driver writes to the 4 POKEY channels to produce the
 * marble rumble. In V2, verify that the byte stored in writeRegs shadow exactly
 * matches the byte written by the 6502 CPU (= MAME shadow). Real waveform/LFSR
 * generation is V3.
 */

import { describe, it, expect } from "vitest";
import { as_u8 } from "../src/wrap.js";
import {
  POKEY_NATIVE_SAMPLE_RATE,
  createPOKEY,
  pokeyDrainDiagnosticChannelSamples,
  pokeyDrainDiagnosticRawTransitions,
  pokeyDrainSamples,
  pokeyRead,
  pokeyReset,
  pokeySampleRate,
  pokeySetDiagnosticChannelSamples,
  pokeySetDiagnosticRawTransitions,
  pokeySetSampleAfterClock,
  pokeySetSampleCycles,
  pokeyTickCycles,
  pokeyWrite,
} from "../src/audio/pokey.js";

describe("POKEY register file", () => {
  it("init pulita: writeRegs all 0", () => {
    const pk = createPOKEY();
    expect(pk.writeRegs.length).toBe(16);
    expect(Array.from(pk.writeRegs).every((b) => b === 0)).toBe(true);
  });

  it("write singolo: byte stora nel slot corretto", () => {
    const pk = createPOKEY();
    pokeyWrite(pk, as_u8(0x00), as_u8(0x40));  // AUDF1
    expect(pk.writeRegs[0x00]).toBe(0x40);
    expect(pk.writeRegs[0x01]).toBe(0);
  });

  it("write 4 channels marble rumble (pattern realistico)", () => {
    const pk = createPOKEY();
    // Marble sound driver pattern (approssimato per V1 mailbox tracing):
    const seq: Array<[number, number]> = [
      [0x00, 0xA0],  // AUDF1 = freq mid
      [0x01, 0xA8],  // AUDC1 = vol 8 + dist 5 (noise)
      [0x02, 0x60],  // AUDF2
      [0x03, 0xA6],
      [0x04, 0x40],  // AUDF3
      [0x05, 0xA4],
      [0x06, 0x20],  // AUDF4
      [0x07, 0xA2],
      [0x08, 0x00],  // AUDCTL: default clock 64KHz
      [0x0E, 0x00],  // IRQEN: tutto disabilitato
      [0x0F, 0x03],  // SKCTL: enable keyboard scan + 2-tone off
    ];
    for (const [addr, data] of seq) {
      pokeyWrite(pk, as_u8(addr), as_u8(data));
    }
    expect(pk.writeRegs[0x00]).toBe(0xA0);
    expect(pk.writeRegs[0x01]).toBe(0xA8);
    expect(pk.writeRegs[0x07]).toBe(0xA2);
    expect(pk.writeRegs[0x08]).toBe(0x00);
    expect(pk.writeRegs[0x0E]).toBe(0x00);
    expect(pk.writeRegs[0x0F]).toBe(0x03);
  });

  it("wrap addr 4-bit: $10 → $00", () => {
    const pk = createPOKEY();
    pokeyWrite(pk, as_u8(0x10), as_u8(0xAA));
    expect(pk.writeRegs[0x00]).toBe(0xAA);
    expect(pk.writeRegs.length).toBe(16);
  });
});

describe("POKEY PCM", () => {
  it("uses the POKEY clock/28 native sample cadence", () => {
    expect(POKEY_NATIVE_SAMPLE_RATE).toBeCloseTo(1_789_772 / 28, 5);
  });

  it("emits unipolar legacy-linear samples for a pure-tone AUDC voice", () => {
    const pk = createPOKEY();
    pokeyWrite(pk, as_u8(0x0f), as_u8(0x03));
    pokeyWrite(pk, as_u8(0x00), as_u8(0x04));
    pokeyWrite(pk, as_u8(0x01), as_u8(0xaf));

    pokeyTickCycles(pk, 28 * 600);
    const samples = pokeyDrainSamples(pk);
    const min = Math.min(...samples);
    const max = Math.max(...samples);

    expect(samples.length).toBe(600);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeGreaterThan(0);
  });

  it("advances channel counters while AUDC volume is zero", () => {
    const pk = createPOKEY();
    pokeyWrite(pk, as_u8(0x0f), as_u8(0x03));
    pokeyWrite(pk, as_u8(0x00), as_u8(0x04));
    pokeyWrite(pk, as_u8(0x01), as_u8(0xa0));

    pokeyTickCycles(pk, 28 * 6);

    expect(pk.channels[0]!.counter).not.toBe(0);
  });

  it("uses MAME's default pure-tone AUDC phase before the first AUDC write", () => {
    const pk = createPOKEY();
    pokeyWrite(pk, as_u8(0x0f), as_u8(0x03));
    pokeyWrite(pk, as_u8(0x00), as_u8(0x00));

    pokeyTickCycles(pk, 28 * 256);

    expect(pk.writeRegs[0x01]).toBe(0);
    expect(pk.channels[0]!.output).toBe(1);
  });

  it("can drain diagnostics-only per-channel sample buffers", () => {
    const pk = createPOKEY();
    pokeySetDiagnosticChannelSamples(pk, true);
    pokeyWrite(pk, as_u8(0x0f), as_u8(0x03));
    pokeyWrite(pk, as_u8(0x01), as_u8(0x1f)); // volume-only channel 1

    pokeyTickCycles(pk, 28 * 3);
    const mix = pokeyDrainSamples(pk);
    const channels = pokeyDrainDiagnosticChannelSamples(pk);

    expect(channels).toBeDefined();
    expect(channels).toHaveLength(4);
    expect(channels?.[0]).toHaveLength(mix.length);
    expect(channels?.[1]?.every((v) => v === 0)).toBe(true);
    for (let i = 0; i < mix.length; i++) {
      expect(channels?.[0]?.[i]).toBeCloseTo(mix[i] ?? 0, 7);
    }
    expect(pokeyDrainDiagnosticChannelSamples(pk)?.[0]).toEqual([]);
  });

  it("can use a diagnostics-only per-clock sample cadence", () => {
    const pk = createPOKEY();
    pokeySetSampleCycles(pk, 1);
    pokeyWrite(pk, as_u8(0x0f), as_u8(0x03));
    pokeyWrite(pk, as_u8(0x01), as_u8(0x1f)); // volume-only channel 1

    pokeyTickCycles(pk, 7);

    expect(pokeySampleRate(pk)).toBeCloseTo(1_789_772, 5);
    expect(pokeyDrainSamples(pk)).toHaveLength(7);
  });

  it("latches raw output after the stream catches up", () => {
    const pk = createPOKEY();
    pokeySetSampleCycles(pk, 1);
    pokeyWrite(pk, as_u8(0x0f), as_u8(0x03));
    pokeyWrite(pk, as_u8(0x01), as_u8(0x1f)); // volume-only channel 1

    pokeyTickCycles(pk, 2);
    const samples = pokeyDrainSamples(pk);

    expect(samples[0]).toBe(0);
    expect(samples[1]).toBeGreaterThan(0);
  });

  it("can sample after the clock edge for boundary diagnostics", () => {
    const pk = createPOKEY();
    pokeySetSampleCycles(pk, 1);
    pokeySetSampleAfterClock(pk, true);
    pokeyWrite(pk, as_u8(0x0f), as_u8(0x03));
    pokeyWrite(pk, as_u8(0x01), as_u8(0x1f)); // volume-only channel 1

    pokeyTickCycles(pk, 2);
    const samples = pokeyDrainSamples(pk);

    expect(samples[0]).toBeGreaterThan(0);
    expect(samples[1]).toBeGreaterThan(0);
  });

  it("can trace diagnostics-only raw latch transitions", () => {
    const pk = createPOKEY();
    pokeySetSampleCycles(pk, 1);
    pokeySetDiagnosticRawTransitions(pk, true);
    pokeyWrite(pk, as_u8(0x0f), as_u8(0x03));
    pokeyWrite(pk, as_u8(0x01), as_u8(0x1f)); // volume-only channel 1

    pokeyTickCycles(pk, 2);

    expect(pokeyDrainDiagnosticRawTransitions(pk)).toEqual([
      {
        cycle: 1,
        nativeSample: 1,
        cycleInNativeSample: 0,
        prevRaw: 0,
        raw: 0x000f,
        audf: [0, 0, 0, 0],
        audc: [0x1f, 0xb0, 0xb0, 0xb0],
        audctl: 0,
        skctl: 0x03,
        counters: [0, 0, 0, 0],
        borrowCnt: [0, 0, 0, 0],
        outputs: [0, 0, 0, 0],
        filterSamples: [0, 0, 0, 0],
        poly4: 1,
        poly5: 1,
        poly9: 1,
        poly17: 1,
        clockCnt28: 1,
        clockCnt114: 1,
      },
    ]);
    expect(pokeyDrainDiagnosticRawTransitions(pk)).toEqual([]);
  });
});

describe("POKEY read stubs (V2: sentinel constant)", () => {
  function pk() { return createPOKEY(); }

  it("POT0..POT7 = 0 (paddle non usati in marble)", () => {
    for (let i = 0; i < 8; i++) {
      expect(pokeyRead(pk(), as_u8(i)) as number).toBe(0);
    }
  });

  it("ALLPOT = 0xFF (tutti pot 'done', no scan in corso)", () => {
    expect(pokeyRead(pk(), as_u8(0x08)) as number).toBe(0xff);
  });

  it("KBCODE = 0, RANDOM = 0 (V3 LFSR not yet)", () => {
    expect(pokeyRead(pk(), as_u8(0x09)) as number).toBe(0);
    expect(pokeyRead(pk(), as_u8(0x0a)) as number).toBe(0);
  });

  it("IRQST = 0xFF (no IRQ pending, active-low)", () => {
    expect(pokeyRead(pk(), as_u8(0x0d)) as number).toBe(0xff);
  });

  it("SKSTAT = 0xFF (idle serial)", () => {
    expect(pokeyRead(pk(), as_u8(0x0f)) as number).toBe(0xff);
  });

  it("open bus reg ($0C, $0E) → 0xFF", () => {
    expect(pokeyRead(pk(), as_u8(0x0c)) as number).toBe(0xff);
    expect(pokeyRead(pk(), as_u8(0x0e)) as number).toBe(0xff);
  });
});

describe("POKEY reset", () => {
  it("reset pulisce writeRegs", () => {
    const pk = createPOKEY();
    pokeyWrite(pk, as_u8(0x05), as_u8(0xFF));
    pokeyWrite(pk, as_u8(0x08), as_u8(0xAB));
    pokeyReset(pk);
    expect(Array.from(pk.writeRegs).every((b) => b === 0)).toBe(true);
  });
});
