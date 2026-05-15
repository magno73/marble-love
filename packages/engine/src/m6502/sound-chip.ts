/**
 * sound-chip.ts — Facade del sound subsystem Atari System 1.
 *
 * Aggrega:
 *   - M6502 CPU (sound CPU, 1.789 MHz)
 *   - Sound MMU (memory map + mailbox + device wiring)
 *   - YM2151 device (Phase 5: register-state parity, V3 audio sample-level)
 *   - POKEY device (Phase 6: register-state parity, V3 audio sample-level)
 *   - Mailbox 68K↔6502 con NMI/IRQ pin
 *
 * API pubblica (Phase 7 V2):
 *   - createSoundChip({ rom421, rom422 })  factory che istanzia tutto
 *   - tickCycles(chip, cycles6502)         avanza il 6502 per N cycle, processa NMI/IRQ
 *   - submitCommand(chip, byte)            simula write 68K $FE0001 (cmd to sound)
 *   - drainReplyEvents(chip)               estrae byte scritti 6502→68K (cmd reply)
 *   - getRegisterShadow(chip)              snapshot YM2151+POKEY reg per oracle diff
 *   - reset(chip)                          reset hardware completo
 *
 * Wire NMI/IRQ:
 *   - main→sound mailbox write asserisce NMI al 6502 (edge-triggered).
 *   - 6502 read $1810 → NMI rilasciato.
 *   - sound→main mailbox write asserisce IRQ6 al 68010 (qui: replyQueue).
 *   - 68010 read $FC0001 simula via drainReplyEvents (pop).
 *
 * Phase 8 (differential testing) usera' getRegisterShadow per probe-sound-diff
 * vs MAME oracle. Phase 9 (Web Audio) connettera' YM2151/POKEY sample output
 * a un AudioWorklet via ring buffer.
 */

import { type M6502Cpu, createCpu, reset as cpuReset, requestNmi, requestIrq, clearIrq, runForCycles } from "./cpu.js";
import { type SoundMmu, createSoundMmu } from "./sound-mmu.js";
import {
  type Mailbox8,
  createMailbox, mailboxWrite, mailboxRead,
} from "./mailbox.js";
import { type YM2151, createYM2151, ym2151TickCycles } from "../audio/ym2151.js";
import { type POKEY, createPOKEY } from "../audio/pokey.js";
import { type SoundRomFiles, buildSoundRom } from "./sound-rom.js";
import { as_u8 } from "../wrap.js";
import type { u8 } from "../wrap.js";

export interface SoundChip {
  cpu: M6502Cpu;
  mmu: SoundMmu;
  ym2151: YM2151;
  pokey: POKEY;
  mainToSound: Mailbox8;
  soundToMain: Mailbox8;
  /** Coda dei byte scritti dal 6502 al main (drain via drainReplyEvents).
   * Pattern: ogni write $1810 da 6502 push qui; main pop in ordine FIFO. */
  replyQueue: number[];
}

export interface SoundChipConfig {
  roms: SoundRomFiles;
  /** Istanze chip preesistenti (per testing / state restore). Default: create
   * fresh. */
  ym2151?: YM2151;
  pokey?: POKEY;
}

export function createSoundChip(cfg: SoundChipConfig): SoundChip {
  const cpu = createCpu();
  const mainToSound = createMailbox();
  const soundToMain = createMailbox();
  const ym2151 = cfg.ym2151 ?? createYM2151();
  const pokey = cfg.pokey ?? createPOKEY();
  const replyQueue: number[] = [];

  const mmu = createSoundMmu({
    rom: buildSoundRom(cfg.roms),
    mainToSound,
    soundToMain,
    ym2151,
    pokey,
    onMainToSoundAck: () => {
      // 6502 ha letto cmd via $1810: rilascia NMI line.
      cpu.nmi = false;
    },
    onSoundToMainPost: () => {
      // 6502 ha scritto reply via $1810: push in queue per main drain.
      replyQueue.push(soundToMain.value as number);
    },
  });

  // Esegue reset sequence: PC = vector $FFFC/$FFFD.
  cpuReset(cpu, mmu);

  return { cpu, mmu, ym2151, pokey, mainToSound, soundToMain, replyQueue };
}

/** Avanza il 6502 per `cycles` cycle. Processa NMI/IRQ pendenti prima del
 * prossimo opcode. V3: avanza anche Timer A/B YM2151 e asserisce IRQ 6502
 * su overflow se IRQA/B enable.
 *
 * IRQ wiring: il pin IRQ del 6502 e' "wire OR" con multiple sources
 * (YM2151 timer, POKEY IRQ). V3 minimal: solo YM2151 Timer A/B. POKEY IRQ
 * deferito. */
export function tickCycles(chip: SoundChip, cycles: number): number {
  const consumed = runForCycles(chip.cpu, chip.mmu, cycles);
  ym2151TickCycles(chip.ym2151, consumed);
  // IRQ logic: 6502 IRQ pin = (timerA_overflow AND irqA_enable) OR
  //                          (timerB_overflow AND irqB_enable)
  const irqPin =
    (chip.ym2151.timerAOverflow && chip.ym2151.timerAIrqEnable) ||
    (chip.ym2151.timerBOverflow && chip.ym2151.timerBIrqEnable);
  if (irqPin) requestIrq(chip.cpu);
  else clearIrq(chip.cpu);
  return consumed;
}

/** Main CPU scrive cmd al sound: equivale a write $FE0001 (68K side).
 * Asserisce NMI al 6502 sulla transizione false→true del pending. */
export function submitCommand(chip: SoundChip, byte: u8): void {
  mailboxWrite(chip.mainToSound, byte, () => {
    requestNmi(chip.cpu);
  });
}

/** Main CPU drain dei byte reply dal sound. Equivale a read $FC0001 ripetute
 * finche' coda vuota. Ritorna array dei byte in ordine FIFO. */
export function drainReplyEvents(chip: SoundChip): u8[] {
  const out: u8[] = chip.replyQueue.map((b) => as_u8(b));
  chip.replyQueue.length = 0;
  // Pending bit reset: simula multipli read da $FC0001 ognuno con ack.
  if (chip.soundToMain.pending) {
    mailboxRead(chip.soundToMain);
  }
  return out;
}

/** Snapshot register shadow per oracle diff (Phase 8). Ritorna riferimenti
 * shallow ai Uint8Array — caller non deve mutarli. */
export function getRegisterShadow(chip: SoundChip): {
  audioRam: Uint8Array;
  ym2151Regs: Uint8Array;
  pokeyWriteRegs: Uint8Array;
} {
  return {
    audioRam: chip.mmu.ram,
    ym2151Regs: chip.ym2151.regs,
    pokeyWriteRegs: chip.pokey.writeRegs,
  };
}

/** Hard reset: pulisce tutto. */
export function resetSoundChip(chip: SoundChip): void {
  cpuReset(chip.cpu, chip.mmu);
  chip.mainToSound.value = as_u8(0);
  chip.mainToSound.pending = false;
  chip.soundToMain.value = as_u8(0);
  chip.soundToMain.pending = false;
  chip.replyQueue.length = 0;
  chip.ym2151.regs.fill(0);
  chip.ym2151.selectedReg = 0;
  chip.ym2151.timerAOverflow = false;
  chip.ym2151.timerBOverflow = false;
  chip.pokey.writeRegs.fill(0);
}
