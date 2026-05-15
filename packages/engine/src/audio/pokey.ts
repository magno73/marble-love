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

export interface POKEY {
  /** 16-byte WRITE register shadow. Esposto per oracle diff. */
  readonly writeRegs: Uint8Array;
}

export function createPOKEY(): POKEY {
  return {
    writeRegs: new Uint8Array(16),
  };
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

/** Hard reset: pulisce write reg file. */
export function pokeyReset(pk: POKEY): void {
  pk.writeRegs.fill(0);
}
