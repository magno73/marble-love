/**
 * ym2151.ts — Yamaha YM2151 OPM FM synthesis chip, Phase 5 register-state parity.
 *
 * Scope V2 (vedi plan):
 *   - Register file 256 byte, scrivibile via address/data port ($1800/$1801).
 *   - Read status register: bit 0=Timer A overflow, bit 1=Timer B overflow.
 *   - Reg shadow esposto per diff vs MAME oracle (Phase 8 differential testing).
 *   - **NON** implementato in V2: envelope generator, operator FM synthesis, LFO,
 *     audio sample output. Quelli sono V3 (sample-level audio parity).
 *
 * Hardware ref (per MAME ym2151.cpp + Yamaha datasheet OPM):
 *   - 8 channels × 4 operators (32 operatori totali)
 *   - Clock 3.579545 MHz (Atari System 1)
 *   - 256-byte register file, indirizzato 2 step: WR_ADDR($1800) + WR_DATA($1801)
 *   - Status read da $1800 o $1801 (stessa risposta): Timer flags + busy bit
 *
 * Register map (riferimento, non decodificato in V2):
 *   0x01     TEST / LFO reset
 *   0x08     Key ON (operator slot mask + channel select)
 *   0x0F     Noise enable + freq
 *   0x10-12  Timer A high / Timer A low / Timer B
 *   0x14     IRQ enable / clear / reset
 *   0x18-1B  LFO frequency / waveform / PMD / AMD
 *   0x20-27  Channel: RL+FB+CONN
 *   0x28-2F  Channel: KC (key code)
 *   0x30-37  Channel: KF (key fraction)
 *   0x38-3F  Channel: PMS/AMS
 *   0x40-5F  Operator: DT1/MUL (32 reg, 4 op × 8 ch)
 *   0x60-7F  Operator: TL (total level)
 *   0x80-9F  Operator: KS/AR (key scale + attack rate)
 *   0xA0-BF  Operator: AMS-EN/D1R (decay 1 rate)
 *   0xC0-DF  Operator: DT2/D2R (decay 2 rate)
 *   0xE0-FF  Operator: D1L/RR (decay 1 level + release rate)
 *
 * Pattern d'uso (dal 6502 boot code Marble):
 *   STA $1800   ; write reg select (byte addr 0x00..0xFF)
 *   STA $1801   ; write reg data
 *   LDA $1800   ; read status → bit 0/1 timer overflow
 *
 * Phase 5 V2 stesso comportamento di MAME register file: scrittura a $1800
 * imposta `selectedReg`, scrittura a $1801 stora `regs[selectedReg] = data`.
 * Lo "status" non e' un registro nel file: e' calcolato da timerA/B internal
 * counters (stub V2: sempre 0, no overflow → boot code che attende busy clear
 * passa al primo poll).
 */

import type { u8 } from "../wrap.js";
import { as_u8 } from "../wrap.js";

export interface YM2151 {
  /** 256-byte register shadow. Esposto per oracle diff. NON mutare manualmente:
   * usa writeData() per simulare il path MAME (selectedReg → regs). */
  readonly regs: Uint8Array;
  /** Reg index selezionato dall'ultima writeAddr(). Default 0 a reset. */
  selectedReg: number;
  /** Timer A overflow flag (Phase 5 stub: sempre false). */
  timerAOverflow: boolean;
  /** Timer B overflow flag (Phase 5 stub: sempre false). */
  timerBOverflow: boolean;
}

export function createYM2151(): YM2151 {
  return {
    regs: new Uint8Array(256),
    selectedReg: 0,
    timerAOverflow: false,
    timerBOverflow: false,
  };
}

/** Write a $1800: imposta il register address per la prossima writeData. */
export function ym2151WriteAddr(ym: YM2151, addr: u8): void {
  ym.selectedReg = (addr as number) & 0xff;
}

/** Write a $1801: stora il byte nel reg selezionato. */
export function ym2151WriteData(ym: YM2151, data: u8): void {
  ym.regs[ym.selectedReg] = data as number;
  // Effetti collaterali Phase 6+ (key on, timer arm, IRQ clear): NON modellati
  // in V2. Il reg shadow basta per parity oracle.
}

/** Read da $1800/$1801: ritorna status byte. Phase 5 stub timer flags=false. */
export function ym2151ReadStatus(ym: YM2151): u8 {
  const b0 = ym.timerAOverflow ? 0x01 : 0;
  const b1 = ym.timerBOverflow ? 0x02 : 0;
  // bit 7 = busy: stub V2 sempre false (chip sempre pronto). Real hardware
  // setta busy per ~32 cycle dopo write, ma il sound code Marble non polla.
  return as_u8(b0 | b1);
}

/** Hard reset: pulisce reg file e flag. Chiamato da LS259 outlatch bit 0
 * (vedi `sound-mmu.ts` $1824). */
export function ym2151Reset(ym: YM2151): void {
  ym.regs.fill(0);
  ym.selectedReg = 0;
  ym.timerAOverflow = false;
  ym.timerBOverflow = false;
}
