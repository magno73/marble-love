/**
 * pokey.ts — Atari POKEY (custom co-processor), Phase 6 register-state parity.
 *
 * Scope V2 (vedi plan):
 *   - Register file 16 byte read + 16 byte write (address space distinto per
 *     read/write, mirror MAME pokey.cpp).
 *   - Decoder write a $00-$0F (AUDF1/AUDC1..AUDF4/AUDC4, AUDCTL, IRQEN, SKCTL).
 *   - Reg shadow esposto per oracle diff (Phase 8).
 *   - **NON** implementato V2: 4-tone channel waveform, LFSR poly 4/5/9/17 bit,
 *     pot scan, serial I/O, KBCODE, IRQ generation. V3 sample-level audio.
 *
 * Hardware ref (MAME pokey.cpp + Atari Hardware Manual):
 *   - 4 tone channels indipendenti
 *   - 17-bit poly LFSR (noise source) + 9-bit + 5-bit + 4-bit poly
 *   - Clock 1.789773 MHz (Atari System 1 sound CPU clock)
 *   - 8 paddle pot inputs (marble: probabilmente non usati)
 *   - Serial I/O + keyboard scan (marble: non usati)
 *
 * Register map WRITE ($1870-$187F):
 *   $00 AUDF1   Frequency channel 1 (low byte)
 *   $01 AUDC1   Control channel 1 (volume + distortion poly select)
 *   $02 AUDF2   Frequency channel 2
 *   $03 AUDC2   Control channel 2
 *   $04 AUDF3   Frequency channel 3
 *   $05 AUDC3   Control channel 3
 *   $06 AUDF4   Frequency channel 4
 *   $07 AUDC4   Control channel 4
 *   $08 AUDCTL  Clock + filter + 16-bit join + poly 9-bit mode
 *   $09 STIMER  Start timers (write-only trigger)
 *   $0A SKRES   Serial reset
 *   $0B POTGO   Start pot scan
 *   $0D SEROUT  Serial out
 *   $0E IRQEN   IRQ enable mask
 *   $0F SKCTL   Serial control + 2-tone mode
 *
 * Register map READ ($1870-$187F):
 *   $00-$07 POT0..POT7  Paddle pots (stub V2: 0)
 *   $08 ALLPOT  Pot done flags (stub V2: 0xFF = all done)
 *   $09 KBCODE  Keyboard scan code (stub V2: 0)
 *   $0A RANDOM  LFSR output (stub V2: 0)
 *   $0B SERIN   Serial in (stub V2: 0)
 *   $0D IRQST   IRQ status (stub V2: 0xFF = no IRQ pending, active-low)
 *   $0F SKSTAT  Serial status (stub V2: 0xFF)
 *
 * Marble usage (da V1 mailbox tracing `docs/sound-system.md`): POKEY genera
 * il "rumble" della biglia durante il rotolamento (4 tone channel + noise
 * LFSR mod). Sample-level fedele richiede poly accurato (V3).
 */

import type { u8 } from "../wrap.js";
import { as_u8 } from "../wrap.js";

/** POKEY clock: 1.789773 MHz = stesso del 6502.
 * Sample output rate: 1.789773 / 28 = 63920 Hz (28-cycle base divider).
 * Per semplicità V3 minimal: 1 sample ogni 128 cycle 6502 = 13990 Hz.
 * Resamplato a output context rate via renderer. */
export const POKEY_NATIVE_SAMPLE_RATE = 13990;
const POKEY_CYCLES_PER_SAMPLE = 128;

interface PokeyChannel {
  /** Period counter: decrementa ogni base clock tick. Toggle output a zero. */
  counter: number;
  /** Output flip-flop: -1 / +1. */
  output: number;
}

export interface POKEY {
  /** 16-byte WRITE register shadow. Esposto per oracle diff. */
  readonly writeRegs: Uint8Array;
  /** 4 tone channels indipendenti. */
  readonly channels: PokeyChannel[];
  /** 17-bit LFSR (default poly). MAME seed canonico verificato. */
  poly17: number;
  /** 9-bit LFSR. */
  poly9: number;
  /** 5-bit LFSR (filtra le altre poly). */
  poly5: number;
  /** 4-bit LFSR (high-tones). */
  poly4: number;
  /** Cycle accumulator (cycle 6502 → POKEY base clock). */
  cycleAccumulator: number;
  /** Sample buffer (mono Float32, drainabile). */
  sampleBuffer: number[];
}

export function createPOKEY(): POKEY {
  return {
    writeRegs: new Uint8Array(16),
    channels: Array.from({ length: 4 }, () => ({ counter: 0, output: 1 })),
    poly17: 0x1ffff,  // 17-bit init (tutti 1)
    poly9: 0x1ff,
    poly5: 0x1f,
    poly4: 0xf,
    cycleAccumulator: 0,
    sampleBuffer: [],
  };
}

/** Avanza un poly LFSR di 1 step (taps standard MAME pokey.cpp). */
function tickPoly17(p: number): number {
  // 17-bit XOR tap 13 + 16 (LSB feedback)
  const bit = ((p >> 0) ^ (p >> 5)) & 1;
  return ((p >> 1) | (bit << 16)) & 0x1ffff;
}
function tickPoly9(p: number): number {
  const bit = ((p >> 0) ^ (p >> 4)) & 1;
  return ((p >> 1) | (bit << 8)) & 0x1ff;
}
function tickPoly5(p: number): number {
  const bit = ((p >> 0) ^ (p >> 2)) & 1;
  return ((p >> 1) | (bit << 4)) & 0x1f;
}
function tickPoly4(p: number): number {
  const bit = ((p >> 0) ^ (p >> 1)) & 1;
  return ((p >> 1) | (bit << 3)) & 0xf;
}

/** Sample output stereo (mono in realtà, replicato L=R). */
function pokeySample(pk: POKEY): number {
  let mix = 0;
  for (let ch = 0; ch < 4; ch++) {
    const audf = pk.writeRegs[ch * 2] ?? 0;
    const audc = pk.writeRegs[ch * 2 + 1] ?? 0;
    const vol = audc & 0xf;
    if (vol === 0) continue;
    const channel = pk.channels[ch]!;
    // Decrement counter; quando arriva a 0 toggle output + advance poly.
    channel.counter--;
    if (channel.counter <= 0) {
      channel.counter = audf;
      // Distortion bit 7=1 → pure tone (toggle deterministic).
      // Distortion bit 7=0 → noise dal poly17 (o poly9 se AUDCTL bit 7 set).
      const pureTone = (audc & 0x80) !== 0;
      if (pureTone) {
        channel.output = -channel.output;
      } else {
        // Noise mode: usa bit 0 di poly17/poly9 come "toggle" se 1.
        const audctl = pk.writeRegs[0x08] ?? 0;
        const usePoly9 = (audctl & 0x80) !== 0;
        const polyBit = usePoly9 ? (pk.poly9 & 1) : (pk.poly17 & 1);
        channel.output = polyBit !== 0 ? 1 : -1;
        // Advance poly LFSR
        pk.poly17 = tickPoly17(pk.poly17);
        pk.poly9 = tickPoly9(pk.poly9);
      }
      // Avanza poly5 sempre (high-freq filter)
      pk.poly5 = tickPoly5(pk.poly5);
      pk.poly4 = tickPoly4(pk.poly4);
    }
    // vol 0..15 → -1..+1 scale
    mix += channel.output * (vol / 15) * 0.15;  // 0.15 = headroom per 4 ch mix
  }
  return Math.tanh(mix);
}

/** Avanza POKEY per N cycle 6502, produce sample @ POKEY_NATIVE_SAMPLE_RATE. */
export function pokeyTickCycles(pk: POKEY, cycles6502: number): void {
  pk.cycleAccumulator += cycles6502;
  while (pk.cycleAccumulator >= POKEY_CYCLES_PER_SAMPLE) {
    pk.cycleAccumulator -= POKEY_CYCLES_PER_SAMPLE;
    pk.sampleBuffer.push(pokeySample(pk));
  }
}

/** Drain mono samples. */
export function pokeyDrainSamples(pk: POKEY): number[] {
  const buf = pk.sampleBuffer;
  pk.sampleBuffer = [];
  return buf;
}

/** Write a $1870..$187F: stora il byte nel reg corrispondente. */
export function pokeyWrite(pk: POKEY, addr: u8, data: u8): void {
  const idx = (addr as number) & 0x0f;
  pk.writeRegs[idx] = data as number;
  // Side effect Phase 6+ (start timer, pot scan, etc.): NON modellati in V2.
}

/** Read da $1870..$187F: dispatch sui READ register (address space distinto).
 * Phase 6 stub: pot/keyboard/serial = sentinel, RANDOM = 0. */
export function pokeyRead(_pk: POKEY, addr: u8): u8 {
  const idx = (addr as number) & 0x0f;
  switch (idx) {
    case 0x00: case 0x01: case 0x02: case 0x03:
    case 0x04: case 0x05: case 0x06: case 0x07:
      return as_u8(0);     // POT0..POT7
    case 0x08: return as_u8(0xff);   // ALLPOT (all done)
    case 0x09: return as_u8(0);      // KBCODE
    case 0x0a: return as_u8(0);      // RANDOM (V3 LFSR)
    case 0x0b: return as_u8(0);      // SERIN
    case 0x0d: return as_u8(0xff);   // IRQST (no IRQ pending, active-low)
    case 0x0f: return as_u8(0xff);   // SKSTAT
    default:   return as_u8(0xff);   // open bus
  }
}

/** Hard reset: pulisce write reg file + poly + channel state. */
export function pokeyReset(pk: POKEY): void {
  pk.writeRegs.fill(0);
  pk.poly17 = 0x1ffff;
  pk.poly9 = 0x1ff;
  pk.poly5 = 0x1f;
  pk.poly4 = 0xf;
  for (const ch of pk.channels) { ch.counter = 0; ch.output = 1; }
  pk.cycleAccumulator = 0;
  pk.sampleBuffer = [];
}
