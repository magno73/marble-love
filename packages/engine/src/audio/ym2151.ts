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
import {
  type Channel,
  createChannel,
  channelSample,
  channelKeyOn,
  channelKeyOff,
} from "./ym2151-channel.js";
import { operatorSetFreq } from "./ym2151-operator.js";
import { KC_TO_FREQ } from "./ym2151-tables.js";
import { tickEnvClock } from "./ym2151-envelope.js";

/** Sample rate native YM2151: clock 3.579545 MHz / 64 = 55930 Hz. */
export const YM2151_NATIVE_SAMPLE_RATE = 55930;

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
  /** 8 channels FM (V3 chip-perfect). Ogni channel ha 4 operatori. */
  readonly channels: Channel[];
  /** Sample accumulator: cycle 6502 → sample stream YM (1 sample ogni 64 YM cycle = 128 cycle 6502). */
  sampleAccumulator: number;
  /** Output sample buffer (interleaved L/R Float32). Drain via getSampleBuffer. */
  sampleBuffer: number[];
  // ─── LFO state (Phase A2) ───────────────────────────────────────────────
  /** LFO frequency (LFRQ, reg $18). Bassa = lenta, alta = veloce. */
  lfoFreq: number;
  /** LFO waveform: 0=saw, 1=square, 2=triangle, 3=random (reg $1B bit 1-0). */
  lfoWaveform: number;
  /** Amplitude modulation depth (AMD, reg $19 bit 6-0). */
  lfoAmd: number;
  /** Phase modulation depth (PMD, reg $19 bit 7-set indicates PMD value). */
  lfoPmd: number;
  /** LFO phase accumulator 0..1 (normalized). */
  lfoPhase: number;
  /** LFO output corrente: -1..+1 (saw/triangle) o 0..1 (square/random). */
  lfoOutput: number;
  /** Busy flag remaining in YM master cycles. Real hardware: 64 master clock
   * dopo write a $1801 (data); $1800 (addr) NON triggera busy. Verificato
   * 2026-05-18 via oracle/mame_1801_busy_tap.lua. Boot $8FED polla bit 7.
   * Modello pronto ma non attivo: settando busy=64 raggiunge cycle-perfect
   * boot vs MAME ma rompe music driver (tight-loops post-boot). */
  busyCycles: number;
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
    channels: Array.from({ length: 8 }, () => createChannel()),
    sampleAccumulator: 0,
    sampleBuffer: [],
    lfoFreq: 0,
    lfoWaveform: 0,
    lfoAmd: 0,
    lfoPmd: 0,
    lfoPhase: 0,
    lfoOutput: 0,
    busyCycles: 0,
  };
}

/** Avanza LFO per 1 sample @ YM native rate (55930 Hz).
 * Hardware: LFO frequency tabella esponenziale, LFRQ 0..255.
 * V3 approssimazione: phase += freq_hz / sample_rate, wrap mod 1. */
function tickLfo(ym: YM2151): void {
  if (ym.lfoFreq === 0) {
    ym.lfoOutput = 0;
    return;
  }
  // LFRQ → freq Hz: tabella exponential MAME. V3 approx: 0..30 Hz.
  // freq = 0.005 * exp(LFRQ / 32)
  const freqHz = 0.005 * Math.exp(ym.lfoFreq / 32);
  ym.lfoPhase += freqHz / YM2151_NATIVE_SAMPLE_RATE;
  if (ym.lfoPhase >= 1) ym.lfoPhase -= 1;
  // Compute output based on waveform
  switch (ym.lfoWaveform & 3) {
    case 0: // Saw (down)
      ym.lfoOutput = 1 - 2 * ym.lfoPhase;
      break;
    case 1: // Square
      ym.lfoOutput = ym.lfoPhase < 0.5 ? 1 : -1;
      break;
    case 2: // Triangle
      ym.lfoOutput = ym.lfoPhase < 0.5
        ? (4 * ym.lfoPhase - 1)
        : (3 - 4 * ym.lfoPhase);
      break;
    case 3: // Random (sample-and-hold)
      // Cambia value solo ai wraparound
      if (ym.lfoPhase < freqHz / YM2151_NATIVE_SAMPLE_RATE) {
        ym.lfoOutput = Math.random() * 2 - 1;
      }
      break;
  }
}

/** Apply reg shadow → channel/operator params. Chiamato da writeData. */
function applyReg(ym: YM2151, reg: number, val: number): void {
  // LFO control (Phase A2): $18 LFRQ, $19 AMD/PMD, $1B waveform
  if (reg === 0x18) { ym.lfoFreq = val & 0xff; return; }
  if (reg === 0x19) {
    // bit 7: select PMD (1) or AMD (0); bit 6-0 = value
    if ((val & 0x80) !== 0) ym.lfoPmd = val & 0x7f;
    else ym.lfoAmd = val & 0x7f;
    return;
  }
  if (reg === 0x1b) { ym.lfoWaveform = val & 3; return; }
  // Channel-level reg ($20..$3F): RL+FB+CONN, KC, KF, PMS+AMS
  if (reg >= 0x20 && reg < 0x40) {
    const ch = ym.channels[reg & 7];
    if (ch === undefined) return;
    if (reg < 0x28) {
      // $20-$27: RL(7-6) + FB(5-3) + CONN/alg(2-0)
      ch.lr = val & 0xc0;
      ch.fb = (val >> 3) & 7;
      ch.alg = val & 7;
    } else if (reg < 0x30) {
      // $28-$2F: KC (key code)
      const baseFreq = KC_TO_FREQ[val] ?? 0;
      for (const op of ch.op) operatorSetFreq(op, baseFreq, YM2151_NATIVE_SAMPLE_RATE);
    } else if (reg < 0x38) {
      // $30-$37: KF (key fraction, fine pitch)
      // V3 minimal: ignored (small detune)
    } else {
      // $38-$3F: PMS(6-4) + AMS(1-0)
      ch.pms = (val >> 4) & 7;
      ch.ams = val & 3;
    }
    return;
  }
  // Operator-level reg ($40..$FF): 32 op indexed by (reg - $40)
  // Layout: per 8-byte block, slot in (reg-base)/8, channel in (reg-base)&7
  if (reg >= 0x40 && reg < 0x100) {
    const opIdx = reg & 0x1f;
    const ch = ym.channels[opIdx & 7];
    if (ch === undefined) return;
    const op = ch.op[(opIdx >> 3) & 3];
    if (op === undefined) return;
    if (reg < 0x60) {
      // $40-$5F: DT1(6-4) + MUL(3-0)
      op.dt1 = (val >> 4) & 7;
      op.mul = val & 0xf;
    } else if (reg < 0x80) {
      // $60-$7F: TL (total level, bit 6-0)
      op.tl = val & 0x7f;
    } else if (reg < 0xa0) {
      // $80-$9F: KS(7-6) + AR(4-0)
      op.ks = (val >> 6) & 3;
      op.ar = val & 0x1f;
    } else if (reg < 0xc0) {
      // $A0-$BF: AMS-EN(7) + D1R(4-0)
      op.d1r = val & 0x1f;
    } else if (reg < 0xe0) {
      // $C0-$DF: DT2(7-6) + D2R(4-0)
      op.d2r = val & 0x1f;
    } else {
      // $E0-$FF: D1L(7-4) + RR(3-0)
      op.d1l = (val >> 4) & 0xf;
      op.rr = val & 0xf;
    }
    return;
  }
  // Reg $08: KEY ON byte
  if (reg === 0x08) {
    const chIdx = val & 7;
    const ch = ym.channels[chIdx];
    if (ch !== undefined) {
      // Slot mask convention: bit3=SM1=op1, bit4=SM2=op3, bit5=C1=op2, bit6=C2=op4
      // (OPM mapping: cmp Yamaha datasheet § 4.4.1)
      // V3 minimal: tutto bit set → keyOn, bit clear → keyOff
      const keyMask =
        ((val & 0x08) !== 0 ? 0x10 : 0) |  // op1
        ((val & 0x10) !== 0 ? 0x20 : 0) |  // op2
        ((val & 0x20) !== 0 ? 0x40 : 0) |  // op3
        ((val & 0x40) !== 0 ? 0x80 : 0);   // op4
      if (keyMask !== 0) channelKeyOn(ch, keyMask);
      else channelKeyOff(ch, 0);
    }
  }
}

/** Produce 1 sample stereo da tutti 8 channel attivi. Output [-1..+1] L+R.
 * Phase A2: LFO advance. Phase A4: PM (phase modulation) + AM scale. */
export function ym2151Sample(ym: YM2151): [number, number] {
  tickLfo(ym);
  let left = 0, right = 0;
  for (const ch of ym.channels) {
    // AM: lfoOutput (-1..+1) × PMS × AMD applicato come scale all'output channel
    const amScale = ch.ams === 0 || ym.lfoAmd === 0
      ? 1
      : 1 - (ch.ams * Math.abs(ym.lfoOutput) * ym.lfoAmd) / (127 * 4);
    // PM (Phase A4 vibrato): lfoOutput × lfoPmd × channel.pms → phase offset
    // applicato a phase accumulator di TUTTI gli op del channel.
    // PMS scale: 0=no PM, 7=max vibrato. PMD 0..127.
    const pmOffset = ym.lfoPmd === 0 || ch.pms === 0
      ? 0
      : Math.round(ym.lfoOutput * ym.lfoPmd * ch.pms * 4);  // phase units
    if (pmOffset !== 0) {
      for (const op of ch.op) {
        op.phase = (op.phase + pmOffset) & ((1 << 20) - 1);
      }
    }
    const [l, r] = channelSample(ch);
    left += l * amScale;
    right += r * amScale;
  }
  return [Math.tanh(left * 0.5), Math.tanh(right * 0.5)];
}

/** Drain accumulated sample buffer. Caller uses returned arrays then sampleBuffer.length = 0. */
export function ym2151DrainSamples(ym: YM2151): number[] {
  const buf = ym.sampleBuffer;
  ym.sampleBuffer = [];
  return buf;
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
 * Timer A/B (V3) + apply al channel/operator params (V3 chip-perfect). */
export function ym2151WriteData(ym: YM2151, data: u8): void {
  const reg = ym.selectedReg;
  const v = data as number;
  ym.regs[reg] = v;
  // BUSY model NON attivo: settando busyCycles=64 raggiunge cycle-perfect
  // boot path vs MAME ma rompe music driver state machine (audio→0). Da
  // re-attivare quando i tight-loop del music driver sono mappati. Vedi
  // commento di YM2151.busyCycles + ym2151ReadStatus.
  // V3 chip-perfect: applica il reg ai parametri channel/operator.
  applyReg(ym, reg, v);
  // Side effects V3 Timer A/B (reg $14 = control register).
  //
  // Bit mapping CORRETTO (verificato 2026-05-17 contro ymfm_opm.h + ymfm_fm.ipp
  // → handler ymfm::set_reset_status):
  //   bit 0 = load_timer_a  (arm Timer A counter from regs $10/$11)
  //   bit 1 = load_timer_b
  //   bit 2 = enable_timer_a (= IRQ "enable" semantica MAME: quando timer overflows
  //                            E enable_timer_a=1, status TIMERA = 1 → IRQ asserito)
  //   bit 3 = enable_timer_b
  //   bit 4 = reset_timer_a (= clear status TIMERA = clear overflow flag)
  //   bit 5 = reset_timer_b
  //   bit 6 = unused
  //   bit 7 = CSM (key-on-with-timer, V3 deferito)
  //
  // ❌ Era SBAGLIATO prima (commit 7671a9d): bit 2/3 trattati come "clear flag",
  // bit 4/5 come "IRQA/B enable". Esattamente l'opposto del bit layout MAME ymfm.
  // Conseguenza: boot init scrive $14=$05 = LOAD A + bit 2 → in MAME = abilita
  // Timer A IRQ → IRQ fires su overflow. In TS interpretava bit 2 come "clear
  // flag" → Timer A IRQ MAI abilitato → chicken-and-egg con $14=$11 mai scritto.
  if (reg === 0x14) {
    // Reset overflow flag (bit 4/5 = reset_timer_a/b)
    if ((v & 0x10) !== 0) ym.timerAOverflow = false;
    if ((v & 0x20) !== 0) ym.timerBOverflow = false;
    // Enable bits (bit 2/3 = enable_timer_a/b: gates IRQ assertion on overflow)
    ym.timerAIrqEnable = (v & 0x04) !== 0;
    ym.timerBIrqEnable = (v & 0x08) !== 0;
    // Arm Timer A: load from regs $10/$11 (bit 0 = load_timer_a)
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
  const ymCycles = cycles6502 * 2;
  if (ym.busyCycles > 0) {
    ym.busyCycles = Math.max(0, ym.busyCycles - ymCycles);
  }
  ym.ymCycleAccumulator += ymCycles;
  // Timer A: 1 tick ogni 64 cycle YM
  // Timer B: 1 tick ogni 1024 cycle YM (= 16× Timer A)
  // Sample: 1 stereo sample ogni 64 cycle YM (= 55930 Hz native rate)
  while (ym.ymCycleAccumulator >= 64) {
    ym.ymCycleAccumulator -= 64;
    // Tick global envelope clock (used by MAME-faithful rate table)
    tickEnvClock();
    // Genera 1 sample stereo (carrier op output per ogni channel attivo)
    const [l, r] = ym2151Sample(ym);
    ym.sampleBuffer.push(l, r);
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
  // bit 7 = BUSY: rimane high per 64 master clock dopo write a $1801 (data).
  // Verificato via oracle/mame_1801_busy_tap.lua 2026-05-18: read $1801 a
  // Δ=24..30 cyc post-write = busy; Δ=38..44 cyc post-write = clear. Write
  // a $1800 (addr) NON triggera busy.
  const b7 = ym.busyCycles > 0 ? 0x80 : 0;
  return as_u8(b0 | b1 | b7);
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
