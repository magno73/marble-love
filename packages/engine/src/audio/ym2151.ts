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
  /** Timer A overflow flag (status bit 0). Settato da counter overflow,
   * cleared via write $14 bit 2. */
  timerAOverflow: boolean;
  /** Timer B overflow flag (status bit 1). */
  timerBOverflow: boolean;
  /** Timer A active (count-down running). Armato via $14 bit 0. */
  timerAActive: boolean;
  /** Timer A countdown counter in tick units (1 tick = 64 cycle YM2151). */
  timerACounter: number;
  /** Timer A IRQ enable (write $14 bit 4). */
  timerAIrqEnable: boolean;
  /** Timer B active (count-down running). Armato via $14 bit 1. */
  timerBActive: boolean;
  /** Timer B countdown counter in tick units (1 tick = 1024 cycle YM2151). */
  timerBCounter: number;
  /** Timer B IRQ enable. */
  timerBIrqEnable: boolean;
  /** YM2151 cycle accumulator (modulo 64 / 1024 per scattare Timer A/B tick).
   * tickCycles converte cycle 6502 in cycle YM (×2 ratio). */
  ymCycleAccumulator: number;
}

export function createYM2151(): YM2151 {
  return {
    regs: new Uint8Array(256),
    selectedReg: 0,
    timerAOverflow: false,
    timerBOverflow: false,
    timerAActive: false,
    timerACounter: 0,
    timerAIrqEnable: false,
    timerBActive: false,
    timerBCounter: 0,
    timerBIrqEnable: false,
    ymCycleAccumulator: 0,
  };
}

/** Carica il Timer A counter dal valore corrente di reg $10/$11 (10-bit:
 * high8 = $10, low2 = $11 bit 1-0). Period = 1024 - val tick. */
function timerALoadValue(ym: YM2151): number {
  const high8 = ym.regs[0x10] ?? 0;
  const low2 = (ym.regs[0x11] ?? 0) & 0x03;
  const val10 = (high8 << 2) | low2;
  return 1024 - val10;
}

/** Carica il Timer B counter dal valore di reg $12 (8-bit). Period = 256 -
 * val tick. */
function timerBLoadValue(ym: YM2151): number {
  return 256 - (ym.regs[0x12] ?? 0);
}

/** Write a $1800: imposta il register address per la prossima writeData. */
export function ym2151WriteAddr(ym: YM2151, addr: u8): void {
  ym.selectedReg = (addr as number) & 0xff;
}

/** Write a $1801: stora il byte nel reg selezionato + processa side effects
 * Timer A/B (V3). */
export function ym2151WriteData(ym: YM2151, data: u8): void {
  const reg = ym.selectedReg;
  const v = data as number;
  ym.regs[reg] = v;
  // Side effects V3 Timer A/B (reg $14 = control register):
  //   bit 0 = load A (arm Timer A countdown se 1)
  //   bit 1 = load B
  //   bit 2 = clear flag A (write 1 cancella overflow flag)
  //   bit 3 = clear flag B
  //   bit 4 = IRQA enable
  //   bit 5 = IRQB enable
  //   bit 6 = chip reset (raro)
  //   bit 7 = CSM (key-on-with-timer, V3 deferito)
  if (reg === 0x14) {
    // Clear flag prima dell'arm: hardware atomic
    if ((v & 0x04) !== 0) ym.timerAOverflow = false;
    if ((v & 0x08) !== 0) ym.timerBOverflow = false;
    ym.timerAIrqEnable = (v & 0x10) !== 0;
    ym.timerBIrqEnable = (v & 0x20) !== 0;
    // Arm Timer A: solo sulla transizione 0→1 (se gia' active, ricarica)
    if ((v & 0x01) !== 0) {
      ym.timerACounter = timerALoadValue(ym);
      ym.timerAActive = true;
    } else {
      ym.timerAActive = false;
    }
    if ((v & 0x02) !== 0) {
      ym.timerBCounter = timerBLoadValue(ym);
      ym.timerBActive = true;
    } else {
      ym.timerBActive = false;
    }
  }
}

/** Avanza i Timer A/B per N cycle 6502 (clock 1.789 MHz). Internamente
 * converte a cycle YM2151 (×2 ratio = 3.579 MHz). Timer A tick = 64 cycle YM,
 * Timer B tick = 1024 cycle YM.
 *
 * On overflow: set flag bit. IRQ wire al 6502 e' lasciato al chiamante
 * (SoundChip facade chiama requestIrq se timer*IrqEnable e overflow set). */
export function ym2151TickCycles(ym: YM2151, cycles6502: number): void {
  // 2× ratio: 6502 @ 1.789 MHz, YM2151 @ 3.579 MHz
  ym.ymCycleAccumulator += cycles6502 * 2;
  // Timer A: 1 tick ogni 64 cycle YM
  // Timer B: 1 tick ogni 1024 cycle YM (= 16× Timer A)
  while (ym.ymCycleAccumulator >= 64) {
    ym.ymCycleAccumulator -= 64;
    if (ym.timerAActive) {
      ym.timerACounter--;
      if (ym.timerACounter <= 0) {
        ym.timerAOverflow = true;
        ym.timerACounter = timerALoadValue(ym);
        // Auto-restart: hardware behaviour (Timer A is free-running)
      }
    }
    if (ym.timerBActive) {
      // Timer B: 1 ogni 16 Timer A ticks (= 1024 YM cycle)
      // Track sub-counter implicit via accumulator: ogni 16 tick di TimerA
      // = 1 tick TimerB. Più semplice: aggiungi separato sub-accumulator.
      // Implementazione: usa modulo su un counter incrementale.
      // (Conta tick YM totali per modulo, ma per semplicità qui: scatta ogni
      // 16-esimo loop del while.)
    }
  }
  // Timer B counter via passes sul wide modulo (semplice approssimazione):
  // ogni 1024 cycle YM = 512 cycle 6502, conta 1 tick.
  // Approssimazione: usa un sub-accumulatore separato per Timer B.
  // (Per semplicita' V3 minimal, NON serve Timer B per Marble; sound code
  // usa principalmente Timer A. Lasciamo Timer B come state-tracked-only.)
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
  ym.timerAActive = false;
  ym.timerACounter = 0;
  ym.timerAIrqEnable = false;
  ym.timerBActive = false;
  ym.timerBCounter = 0;
  ym.timerBIrqEnable = false;
  ym.ymCycleAccumulator = 0;
}
