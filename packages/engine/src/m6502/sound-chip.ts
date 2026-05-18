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

import { type M6502Cpu, createCpu, reset as cpuReset, requestNmi, requestIrq, clearIrq, step as cpuStep } from "./cpu.js";
import { type SoundMmu, createSoundMmu } from "./sound-mmu.js";
import {
  type Mailbox8,
  createMailbox, mailboxWrite, mailboxRead,
} from "./mailbox.js";
import { type YM2151, createYM2151, ym2151TickCycles, ym2151DrainSamples, YM2151_NATIVE_SAMPLE_RATE } from "../audio/ym2151.js";
import { type POKEY, createPOKEY, pokeyTickCycles, pokeyDrainSamples, POKEY_NATIVE_SAMPLE_RATE } from "../audio/pokey.js";
import { type SoundRomFiles, buildSoundRom } from "./sound-rom.js";
import { SOUND_CYCLES_PER_FRAME } from "./sound-clock.js";
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
  /** Reset hold: il sound 6502 e' tenuto in reset dal main CPU finche' main
   * non scrive `$860001` bit 7 = 1 (atarisy1.cpp bankselect_w). Mentre in
   * hold, RAM resta 0, PC stuck a reset vector, no cycle consumed. Default
   * true (= hardware power-on behaviour). Release via `releaseSoundReset()`. */
  inReset: boolean;
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
      // CRITICAL: auto-clear pending immediatamente (simula 68K IRQ6 che
      // legge $FC0001 in microsecondi). Senza auto-clear, l'NMI handler
      // del sound 6502 stalla nel polling loop a $9569 (BIT $1820 BNE -7)
      // finche' drainReplyEvents a fine frame non chiama mailboxRead.
      // Stall mid-frame su NMI causa drift di 1 frame nel music dispatcher
      // (verificato 2026-05-18 via ym_writes diff: TS lagga 4 IRQ = 1 frame
      // sul cmd $08 a frame 375).
      replyQueue.push(soundToMain.value as number);
      soundToMain.pending = false;
    },
  });

  // Esegue reset sequence: PC = vector $FFFC/$FFFD.
  cpuReset(cpu, mmu);
  // Sound 6502 parte in HOLD reset (hardware). Main 68K dovra' chiamare
  // releaseSoundReset() per liberare il 6502 e farlo iniziare a girare.
  return { cpu, mmu, ym2151, pokey, mainToSound, soundToMain, replyQueue, inReset: true };
}

/** Main CPU rilascia il 6502 dal reset hold. Equivale a write `$860001` bit
 * 7 = 1 (atarisy1.cpp bankselect_w). Re-esegue reset sequence per fresh PC.
 *
 * NON re-asserisce NMI sui cmd pending: il boot code del sound 6502 marble
 * legge esplicitamente `$1810` a `$80DF LDA $1810` per consumare il cmd in
 * arrivo durante il reset hold. NMI durante reset non e' latched dal CPU
 * (matching ymfm/hardware), quindi non c'e' edge "in arrivo" da
 * ri-asserire. Una versione precedente firava NMI qui ma causava NMI
 * service prima del boot init → 6502 saltava setup stack/zp → infinito
 * loop nel handler. Restituita no-op per matching hardware corretto. */
export function releaseSoundReset(chip: SoundChip): void {
  chip.inReset = false;
  cpuReset(chip.cpu, chip.mmu);
  chip.cpu.cycles = 0;
}

/** Main CPU mette il 6502 in reset hold. Equivale a $860001 bit 7 = 0. */
export function holdSoundReset(chip: SoundChip): void {
  chip.inReset = true;
  // Pulisci stato volatile: RAM, mailbox, chip shadow (hardware behaviour).
  chip.mmu.ram.fill(0);
  chip.cpu.cycles = 0;
  chip.cpu.nmi = false;
  chip.cpu.irq = false;
}

/** Avanza il 6502 per `cycles` cycle. Processa NMI/IRQ pendenti prima del
 * prossimo opcode. V3: avanza anche Timer A/B YM2151 e asserisce IRQ 6502
 * su overflow se IRQA/B enable.
 *
 * IRQ wiring: il pin IRQ del 6502 e' "wire OR" con multiple sources
 * (YM2151 timer, POKEY IRQ). V3 minimal: solo YM2151 Timer A/B. POKEY IRQ
 * deferito. */
export function tickCycles(chip: SoundChip, cycles: number): number {
  // Reset hold: no cycle consumed. RAM resta 0, chip resta a fresh state.
  if (chip.inReset) return 0;
  // Interleave CPU step + chip tick + IRQ pin update per matching hardware
  // real-time IRQ line behavior. Senza questo, cpu.irq restava settato per
  // tutto il frame anche dopo che l'handler IRQ aveva clearato il timer flag
  // → CPU rientrava nell'handler ad ogni istruzione (infinite IRQ loop).
  // Chunk size 32 cycle 6502 = 1 Timer A tick (64 cycle YM) → granularity OK
  // per Timer A IRQ semantics.
  const start = chip.cpu.cycles;
  while (chip.cpu.cycles - start < cycles) {
    const stepStart = chip.cpu.cycles;
    cpuStep(chip.cpu, chip.mmu);
    const stepCycles = chip.cpu.cycles - stepStart;
    ym2151TickCycles(chip.ym2151, stepCycles);
    pokeyTickCycles(chip.pokey, stepCycles);
    // IRQ pin = (timerA_overflow AND timer_a_enable) OR (timerB...). Aggiorna
    // dopo ogni istruzione cosi' il CPU vede l'IRQ line real-time. In MAME's
    // ymfm, l'IRQ pin riflette lo status TIMERA bit live; il flag viene clearato
    // dal write $14 bit 4 (reset_timer_a) dentro l'handler.
    const irqPin =
      (chip.ym2151.timerAOverflow && chip.ym2151.timerAIrqEnable) ||
      (chip.ym2151.timerBOverflow && chip.ym2151.timerBIrqEnable);
    if (irqPin) requestIrq(chip.cpu);
    else clearIrq(chip.cpu);
  }
  return chip.cpu.cycles - start;
}

/** Main CPU scrive cmd al sound: equivale a write $FE0001 (68K side).
 * Asserisce NMI al 6502 sulla transizione false→true del pending.
 *
 * Sopprime NMI durante reset hold: real hardware il sound 6502 e' in reset
 * quando il main scrive $FE0001 prima di rilasciare $860001 bit7=1 (verificato
 * via MAME write taps a f244 nel marble attract: ordering e' $FE0001=cmd →
 * $860001=$80 release). NMI e' edge-triggered, ma con CPU in reset l'edge
 * negativo non viene latched internamente. Quando il reset si rilascia, NMI
 * line resta LOW (pending) ma senza un nuovo edge il 6502 non lo serve mai.
 * Il sound code legge $1810 esplicitamente via polling del status bit a $1820
 * durante boot init.
 *
 * Bug fix: senza questa guardia, TS asseriva NMI durante reset hold, e quando
 * `releaseSoundReset` veniva chiamato (con `cpuReset` che NON azzera
 * `cpu.nmi`), il primo opcode dopo reset era SKIPPED in favore di NMI service
 * → il NMI handler partiva con stato non-init (boot $8002 mai eseguito) →
 * loop infinito in PC=$9569. */
export function submitCommand(chip: SoundChip, byte: u8): void {
  mailboxWrite(chip.mainToSound, byte, () => {
    if (!chip.inReset) {
      requestNmi(chip.cpu);
    }
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

/** Drain accumulated YM2151 sample stream (interleaved L/R Float32-style numbers
 * at YM2151 native sample rate 55930 Hz). Caller resample a output context rate. */
export function drainYm2151Samples(chip: SoundChip): number[] {
  return ym2151DrainSamples(chip.ym2151);
}

/** Drain accumulated POKEY mono samples @ POKEY_NATIVE_SAMPLE_RATE (13990 Hz). */
export function drainPokeySamples(chip: SoundChip): number[] {
  return pokeyDrainSamples(chip.pokey);
}

export { YM2151_NATIVE_SAMPLE_RATE, POKEY_NATIVE_SAMPLE_RATE };

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

/** Cmd-tape replay API (Phase A7 bypass A0).
 *
 * Quando il main TS engine non emette cmd al sound 6502 (blocker A0 nel
 * dominio Codex), possiamo bypassare il main e iniettare direttamente i cmd
 * registrati da MAME via `oracle/mame_sound_cmd_capture.lua`. Il chip TS
 * riceve gli stessi byte in input agli stessi frame e produce gli stessi
 * sample stream — audio bit-perfect senza dipendere da gameplay events.
 *
 * Formato tape:
 *   { cmds: [{frame: N, byte: B}, ...] }
 *
 * `loadCmdTape` raggruppa i cmd per frame in O(1) lookup. `tickFrameWithTape`
 * lo combina con il normale `tickCycles(SOUND_CYCLES_PER_FRAME)`. */
export interface CmdTape {
  cmds: ReadonlyArray<{ readonly frame: number; readonly byte: number }>;
}

export interface LoadedCmdTape {
  byFrame: Map<number, number[]>;
  totalFrames: number;
  cmdCount: number;
}

export function loadCmdTape(tape: CmdTape): LoadedCmdTape {
  const byFrame = new Map<number, number[]>();
  let maxFrame = 0;
  for (const c of tape.cmds) {
    let bucket = byFrame.get(c.frame);
    if (bucket === undefined) {
      bucket = [];
      byFrame.set(c.frame, bucket);
    }
    bucket.push(c.byte & 0xff);
    if (c.frame > maxFrame) maxFrame = c.frame;
  }
  return { byFrame, totalFrames: maxFrame + 1, cmdCount: tape.cmds.length };
}

/** Avanza il sound chip per un frame (SOUND_CYCLES_PER_FRAME cycle 6502)
 * iniettando i cmd del tape registrati per quel frame.
 *
 * Cmd spread sub-frame: per frame con >1 cmd, distribuisce le `submitCommand`
 * uniformemente nei cycle 6502 del frame, tickando un pezzo di cycle fra una
 * submit e l'altra. Senza questo spread, cmd back-to-back nel medesimo frame
 * collassano nel mailbox (write con pending=true non rifa NMI edge-trigger) e
 * il 6502 vede solo l'ultimo byte. MAME registra il frame solo, non il
 * sub-cycle offset, quindi lo spread e' uniforme. */
export function tickFrameWithTape(chip: SoundChip, tape: LoadedCmdTape, frame: number): number {
  const cmds = tape.byFrame.get(frame);
  if (cmds === undefined || cmds.length === 0) {
    return tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  }
  if (cmds.length === 1) {
    submitCommand(chip, as_u8(cmds[0]!));
    return tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  }
  // Spread N cmd su N slot egual-cycle. Ogni slot e' `slotCycles` cycle.
  const slotCycles = Math.floor(SOUND_CYCLES_PER_FRAME / cmds.length);
  let consumed = 0;
  for (let i = 0; i < cmds.length; i++) {
    submitCommand(chip, as_u8(cmds[i]!));
    const remaining = i === cmds.length - 1
      ? SOUND_CYCLES_PER_FRAME - consumed
      : slotCycles;
    consumed += tickCycles(chip, remaining);
  }
  return consumed;
}

/** Hard reset: pulisce tutto, ritorna a hold. */
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
  chip.mmu.ram.fill(0);
  chip.inReset = true;
}
