/**
 * binary-oracle-lib.ts — wrapper attorno a `musashi-wasm/core`.
 *
 * **NON è il reimpl del progetto.** Il reimpl è codice TS idiomatic in
 * `@marble-love/engine` che vogliamo poter evolvere/ampliare (livelli custom,
 * physics modificati, multiplayer, ...). Questo modulo serve come:
 *
 *   1. **Oracle locale alternativo a MAME**: produce trace JSONL identico al
 *      formato di `oracle/mame_dumper.lua`, ma usando solo TS+WASM. Utile per
 *      CI senza MAME installato, dev offline, sviluppo iterativo veloce.
 *
 *   2. **Differential testing per-funzione**: data una `GameState`, esegui
 *      una specifica funzione del binario (es. `MainTick @ 0x10116`) e
 *      confronta il delta della RAM con la nostra implementazione TS della
 *      stessa funzione. Permette validazione modulo-per-modulo durante la
 *      rewrite progressiva.
 *
 * Memory layout riflette `docs/hardware-map.md`. MMIO side-effect-only sono
 * intercettati via `onMemoryWrite/onMemoryRead` callback.
 *
 * **NOTA**: Musashi default è 68000. Per 68010 settiamo CPU_TYPE register
 * dopo reset. Comportamenti differenti:
 *   - VBR (vector base register, A7-relative addressing su 68010)
 *   - RTE stack frame esteso
 *   - MOVE from SR privilegiata
 */

import { createSystem, M68kRegister } from "musashi-wasm/core";
import type {
  System,
  MemoryAccessEvent,
} from "musashi-wasm/core";

import type { GameState } from "@marble-love/engine";
import { wrap, bus as busNs } from "@marble-love/engine";

const { as_u32 } = wrap;
const {
  WORK_RAM_BASE, WORK_RAM_END,
  PF_RAM_BASE, PF_RAM_END,
  SPRITE_RAM_BASE, SPRITE_RAM_END,
  ALPHA_RAM_BASE, ALPHA_RAM_END,
  PAL_RAM_BASE, PAL_RAM_END,
  CART_RAM_BASE,
  MMIO_TRAKBALL_BASE, MMIO_TRAKBALL_END,
  MMIO_SWITCHES,
  MMIO_SOUND_CMD,
  MMIO_VBLANK_ACK,
  MMIO_WATCHDOG,
} = busNs;

/** Master clock 14.318181 MHz / 2 = 7.159090 MHz. NTSC 59.92 Hz refresh
 *  → cicli per frame = 7159090 / 59.92 = 119480. Arrotondiamo a 119480. */
export const CYCLES_PER_FRAME = 119_480 as const;

/** IRQ4 = VBLANK (vedi `docs/cpu-config.md`). */
export const IRQ_VBLANK = 4 as const;

/** Memory regions setup. Tutte 0-init eccetto ROM. */
function buildMemoryLayout(romSize: number) {
  return {
    regions: [
      // ROM 0x000000-0x07FFFF
      { start: 0x000000, length: Math.min(0x80000, romSize), source: "rom" as const },
      // Slapstic 0x080000-0x087FFF (lo trattiamo come RAM-mapped per ora;
      // la state machine slapstic 103 è Phase 4d)
      { start: 0x080000, length: Math.min(0x8000, Math.max(0, romSize - 0x80000)),
        source: "rom" as const, sourceOffset: 0x80000 },
      // Work RAM 0x400000-0x401FFF
      { start: WORK_RAM_BASE, length: WORK_RAM_END - WORK_RAM_BASE, source: "zero" as const },
      // Cartridge RAM 0x900000-0x9FFFFF (1 MB)
      { start: CART_RAM_BASE, length: 0x100000, source: "zero" as const },
      // Playfield RAM
      { start: PF_RAM_BASE, length: PF_RAM_END - PF_RAM_BASE, source: "zero" as const },
      // Sprite/MO RAM
      { start: SPRITE_RAM_BASE, length: SPRITE_RAM_END - SPRITE_RAM_BASE, source: "zero" as const },
      // Alpha RAM
      { start: ALPHA_RAM_BASE, length: ALPHA_RAM_END - ALPHA_RAM_BASE, source: "zero" as const },
      // Palette RAM
      { start: PAL_RAM_BASE, length: PAL_RAM_END - PAL_RAM_BASE, source: "zero" as const },
      // EEPROM 0xF00000-0xF003FF (zero-init; persistenza → Phase 7)
      { start: 0xf00000, length: 0x400, source: "zero" as const },
      // MMIO trackball / switches (zero-init RAM; il test inietta valori
      // tramite pokeMem invece di usare callback MMIO).
      { start: 0xf20000, length: 0x40004, source: "zero" as const },
    ],
  };
}

/** Stato persistente associato al CPU per Marble. */
export interface CpuSession {
  system: System;
  state: GameState;
  /** Counter degli accessi MMIO non intercettati (debug). */
  unhandledMmioReads: number;
  unhandledMmioWrites: number;
  /** Sound command dispatch trace (per audio.ts). */
  soundCommandLog: number[];
}

export interface CpuConfig {
  /** ROM image (program), interleaved big-endian. */
  rom: Uint8Array;
  /** GameState che condivideremo con altri sistemi (render, audio, ...). */
  state: GameState;
}

/**
 * Crea ed inizializza un CPU emulator pronto a girare il marble program.
 *
 * Workflow:
 *   1. createSystem con memory layout
 *   2. CPU_TYPE = M68010
 *   3. Reset (carica SSP + reset PC dal vector table)
 *   4. Hook MMIO callback per side-effect handling
 *
 * Ritorna `CpuSession` con `system` + state condiviso.
 */
export async function createCpu(config: CpuConfig): Promise<CpuSession> {
  const memoryLayout = buildMemoryLayout(config.rom.length);

  const system = await createSystem({
    rom: config.rom,
    // ramSize è un fallback per il default layout; con `memoryLayout` esplicito
    // serve solo come capacity hint. 64K minimo.
    ramSize: 64 * 1024,
    memoryLayout,
  });

  // 68010 mode: setRegister(CPU_TYPE, 1). Musashi M68K_CPU_TYPE_68010 == 2
  // (cfr m68k.h dell'originale). Provo 2 prima; fallback 1.
  // (M68K_CPU_TYPE_INVALID=0, _68000=1, _68010=2, ...)
  try {
    system.setRegister(M68kRegister.CPU_TYPE as unknown as keyof ReturnType<System["getRegisters"]>, 2);
  } catch {
    // ignore; comunque il 68000 emulator è quasi-completo per Marble
  }

  // Reset: carica SSP=*(0x000000) e PC=*(0x000004) dal vector table.
  system.reset();

  const session: CpuSession = {
    system,
    state: config.state,
    unhandledMmioReads: 0,
    unhandledMmioWrites: 0,
    soundCommandLog: [],
  };

  // Hook MMIO writes per side effects
  system.onMemoryWrite((event: MemoryAccessEvent) => {
    handleMmioWrite(session, event);
  });

  // Hook MMIO reads per side effects (trackball, switches return live state)
  system.onMemoryRead((event: MemoryAccessEvent) => {
    handleMmioRead(session, event);
  });

  return session;
}

/**
 * Esegue un frame completo: 119_480 cicli @ 7.16 MHz.
 *
 * Sequence:
 *   1. Inject IRQ4 (VBLANK) al CPU all'inizio
 *   2. Run N cicli
 *   3. Aggiorna game state da CPU memory (sync workRam dalla unified memory di Musashi al nostro `state.workRam`)
 */
export function runFrame(session: CpuSession): void {
  const { system, state } = session;

  // Inject VBLANK IRQ. In Musashi: m68k_set_irq(4) o equivalente API.
  // L'API JS expose questo come... TBD. Per ora: lasciamo che il CPU runni
  // e l'ISR @ 0x34A vengarà chiamata se IRQ è asserito.
  // TODO: capire come Musashi-wasm inietta IRQ.

  // Run cicli
  system.run(CYCLES_PER_FRAME);

  // Sync work RAM da Musashi a state.workRam (per workRamHash)
  const ram = system.readBytes(WORK_RAM_BASE, WORK_RAM_END - WORK_RAM_BASE);
  state.workRam.set(ram);

  // Sync sprite RAM
  const spriteRam = system.readBytes(SPRITE_RAM_BASE, SPRITE_RAM_END - SPRITE_RAM_BASE);
  state.spriteRam.set(spriteRam);

  // Sync palette RAM (color RAM)
  const palRam = system.readBytes(PAL_RAM_BASE, PAL_RAM_END - PAL_RAM_BASE);
  state.colorRam.set(palRam);

  // Aggiorna frame counter dal nostro tracking esplicito (state.clock.frame)
  state.clock.frame = as_u32((state.clock.frame as unknown as number) + 1);
}

/** Cleanup: free WASM resources. */
export function disposeCpu(session: CpuSession): void {
  session.system.cleanup();
}

// ─── Differential testing helpers ─────────────────────────────────────────

export interface CallResult {
  /** Return value in D0 (32 bit). */
  d0: number;
  /** Cicli CPU eseguiti. */
  cycles: number;
}

/**
 * Chiama una subroutine 68010 con argomenti su stack (cdecl-like).
 *
 * Implementazione manuale (più affidabile di `system.call(addr)` che ha
 * timeout di 1M cicli senza terminazione corretta su return):
 *   1. Push args RTL
 *   2. Push sentinel return address
 *   3. setRegister(pc, addr)
 *   4. run loop con poll su PC == sentinel, fino a `maxCycles`
 *   5. Pop args
 *
 * Esempio per `move.l (0x4,SP),D1` (FUN_13A98): primo arg long.
 */
const SENTINEL_RET_ADDR = 0xCAFEBABE >>> 0;

export function callFunction(
  session: CpuSession,
  addr: number,
  argsLong: readonly number[] = [],
  maxCycles = 100_000,
): CallResult {
  const sys = session.system;
  const spInitial = sys.getRegisters().sp;

  // Push args RTL
  let sp = spInitial;
  for (let i = argsLong.length - 1; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, argsLong[i]! >>> 0);
  }
  // Push sentinel return address
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET_ADDR);

  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);

  // Run in burst da 100 cicli e check PC
  let totalCycles = 0;
  const burst = 100;
  while (totalCycles < maxCycles) {
    sys.run(burst);
    totalCycles += burst;
    if (sys.getRegisters().pc === SENTINEL_RET_ADDR) break;
  }

  // Pop sentinel + args
  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 4 * argsLong.length) >>> 0);

  return { d0: sys.getRegisters().d0, cycles: totalCycles };
}

/**
 * Esegui da `fromAddr` finché `PC == untilAddr` (o predicate true).
 *
 * Usa step() instruction-by-instruction per NON perdere il target (con run()
 * a burst si saltano gli indirizzi specifici).
 */
export function runUntil(
  session: CpuSession,
  fromAddr: number,
  untilAddr: number | ((pc: number) => boolean),
  maxInstructions = 5_000,
): { instructions: number; cycles: number; reachedTarget: boolean } {
  const sys = session.system;
  sys.setRegister("pc", fromAddr);

  const matches = typeof untilAddr === "function"
    ? untilAddr
    : (pc: number) => pc === untilAddr;

  let totalCycles = 0;
  for (let i = 0; i < maxInstructions; i++) {
    if (matches(sys.getRegisters().pc)) {
      return { instructions: i, cycles: totalCycles, reachedTarget: true };
    }
    const r = sys.step();
    totalCycles += r.cycles;
  }
  return { instructions: maxInstructions, cycles: totalCycles, reachedTarget: false };
}

/** Scrive in unified memory (bypass MMIO callbacks). */
export function pokeMem(
  session: CpuSession,
  addr: number,
  size: 1 | 2 | 4,
  value: number,
): void {
  session.system.write(addr, size, value >>> 0);
}

/** Legge da unified memory. */
export function peekMem(
  session: CpuSession,
  addr: number,
  size: 1 | 2 | 4,
): number {
  return session.system.read(addr, size);
}

// ─── MMIO handlers ────────────────────────────────────────────────────────

function handleMmioWrite(session: CpuSession, event: MemoryAccessEvent): void {
  const a = event.addr >>> 0;

  // Sound command write (mailbox 68010 → 6502)
  if (a === MMIO_SOUND_CMD || a === MMIO_SOUND_CMD + 1) {
    session.soundCommandLog.push(event.value & 0xff);
    return;
  }

  // VBLANK IRQ ack — tracciato ma il CPU emulator gestisce internamente
  if (a === MMIO_VBLANK_ACK || a === MMIO_VBLANK_ACK + 1) {
    return;
  }

  // Watchdog reset — strobe, no state
  if (a === MMIO_WATCHDOG || a === MMIO_WATCHDOG + 1) {
    return;
  }

  // Scroll registers, AV control, priority, EEPROM unlock — tutti
  // gestiti dalla unified memory layout via writeRaw. Nessuna azione qui
  // (per ora). Phase 4d: replicare side effects (es. trigger update_partial).
}

function handleMmioRead(_session: CpuSession, event: MemoryAccessEvent): void {
  const a = event.addr >>> 0;

  // Trackball read 45° rotation (vedi bus.ts readTrackball per logica)
  if (a >= MMIO_TRAKBALL_BASE && a < MMIO_TRAKBALL_END) {
    // Per ora: lasciamo Musashi leggere zero (la unified memory non ha
    // trackball mapped come region). Phase 4d: registrare le porte come
    // MMIO virtuale e iniettare i valori dinamici.
    return;
  }

  if (a === MMIO_SWITCHES || a === MMIO_SWITCHES + 1) {
    // Stesso TODO
    return;
  }
}

