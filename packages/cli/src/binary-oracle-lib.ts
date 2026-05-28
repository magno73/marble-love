/**
 * binary-oracle-lib.ts - wrapper around `musashi-wasm/core`.
 *
 *
 *
 *      progressive rewrite.
 *
 * The memory layout mirrors `docs/hardware-map.md`. MMIO endpoints that only
 * produce side effects are intercepted through `onMemoryWrite/onMemoryRead`.
 *
 *   - VBR (vector base register, A7-relative addressing on 68010)
 *   - extended RTE stack frame
 *   - privileged MOVE from SR
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
 *  gives cycles per frame = 7159090 / 59.92 = 119480. Rounded to 119480. */
export const CYCLES_PER_FRAME = 119_480 as const;

/** IRQ4 = VBLANK (see `docs/cpu-config.md`). */
export const IRQ_VBLANK = 4 as const;

/** Memory region setup. Everything is zero-initialized except ROM. */
function buildMemoryLayout(romSize: number) {
  return {
    regions: [
      // ROM 0x000000-0x07FFFF
      { start: 0x000000, length: Math.min(0x80000, romSize), source: "rom" as const },
      // Slapstic 0x080000-0x087FFF (temporarily treated as RAM-mapped).
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
      // EEPROM 0xF00000-0xF003FF (zero-init; persistence comes later).
      { start: 0xf00000, length: 0x400, source: "zero" as const },
      // Tests poke this through memory instead of using MMIO callbacks.
      { start: 0xf20000, length: 0x40004, source: "zero" as const },
    ],
  };
}

export interface CpuSession {
  system: System;
  state: GameState;
  /** Count of MMIO accesses that no handler intercepted (debug). */
  unhandledMmioReads: number;
  unhandledMmioWrites: number;
  /** Sound command dispatch trace (per audio.ts). */
  soundCommandLog: number[];
}

export interface CpuConfig {
  /** ROM image (program), interleaved big-endian. */
  rom: Uint8Array;
  /** GameState shared with the render, audio, and probe systems. */
  state: GameState;
}

/**
 *
 * Workflow:
 *   1. createSystem with memory layout
 *   2. CPU_TYPE = M68010
 *   4. Hook MMIO callback per side-effect handling
 *
 */
export async function createCpu(config: CpuConfig): Promise<CpuSession> {
  const memoryLayout = buildMemoryLayout(config.rom.length);

  const system = await createSystem({
    rom: config.rom,
    ramSize: 64 * 1024,
    memoryLayout,
  });

  // 68010 mode: setRegister(CPU_TYPE, 1). Musashi M68K_CPU_TYPE_68010 == 2
  // (M68K_CPU_TYPE_INVALID=0, _68000=1, _68010=2, ...)
  try {
    system.setRegister(M68kRegister.CPU_TYPE as unknown as keyof ReturnType<System["getRegisters"]>, 2);
  } catch {
  }

  system.reset();

  const session: CpuSession = {
    system,
    state: config.state,
    unhandledMmioReads: 0,
    unhandledMmioWrites: 0,
    soundCommandLog: [],
  };

  // Hook MMIO writes for side effects.
  system.onMemoryWrite((event: MemoryAccessEvent) => {
    handleMmioWrite(session, event);
  });

  // Hook MMIO reads for side effects; trackball and switches return live state.
  system.onMemoryRead((event: MemoryAccessEvent) => {
    handleMmioRead(session, event);
  });

  return session;
}

/**
 * Runs one full frame: 119_480 cycles at 7.16 MHz.
 *
 * Sequence:
 *   1. Inject IRQ4 (VBLANK) at the start of the frame
 *   2. Run N cycles
 */
export function runFrame(session: CpuSession): void {
  const { system, state } = session;

  // Inject VBLANK IRQ. In Musashi: m68k_set_irq(4) or equivalent API.
  // TODO: confirm how musashi-wasm exposes IRQ injection.

  // Run cycles.
  system.run(CYCLES_PER_FRAME);

  // Sync work RAM from Musashi to state.workRam for workRamHash.
  const ram = system.readBytes(WORK_RAM_BASE, WORK_RAM_END - WORK_RAM_BASE);
  state.workRam.set(ram);

  // Sync sprite RAM
  const spriteRam = system.readBytes(SPRITE_RAM_BASE, SPRITE_RAM_END - SPRITE_RAM_BASE);
  state.spriteRam.set(spriteRam);

  // Sync palette RAM (color RAM)
  const palRam = system.readBytes(PAL_RAM_BASE, PAL_RAM_END - PAL_RAM_BASE);
  state.colorRam.set(palRam);

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
  /** CPU cycles executed. */
  cycles: number;
}

/**
 *
 *   1. Push args RTL
 *   2. Push sentinel return address
 *   3. setRegister(pc, addr)
 *   4. run loop polling PC == sentinel, up to `maxCycles`
 *   5. Pop args
 *
 * Example for `move.l (0x4,SP),D1` (FUN_13A98): first long argument.
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

  // Push args RTL.
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

  // Run in 100-cycle bursts and check PC.
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
 *
 * Uses step() instruction-by-instruction so target addresses are not skipped by
 * a burst run().
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

export function pokeMem(
  session: CpuSession,
  addr: number,
  size: 1 | 2 | 4,
  value: number,
): void {
  session.system.write(addr, size, value >>> 0);
}

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

  // Sound command write (68010 -> 6502 mailbox).
  if (a === MMIO_SOUND_CMD || a === MMIO_SOUND_CMD + 1) {
    session.soundCommandLog.push(event.value & 0xff);
    return;
  }

  // VBLANK IRQ ack: tracked, while the CPU emulator handles it internally.
  if (a === MMIO_VBLANK_ACK || a === MMIO_VBLANK_ACK + 1) {
    return;
  }

  // Watchdog reset: strobe only, no retained state.
  if (a === MMIO_WATCHDOG || a === MMIO_WATCHDOG + 1) {
    return;
  }

  // For now this is ignored; later phases can mirror effects such as update_partial.
}

function handleMmioRead(_session: CpuSession, event: MemoryAccessEvent): void {
  const a = event.addr >>> 0;

  // Trackball read with 45-degree rotation; see bus.ts readTrackball.
  if (a >= MMIO_TRAKBALL_BASE && a < MMIO_TRAKBALL_END) {
    // For now Musashi reads zero because unified memory has no trackball region.
    return;
  }

  if (a === MMIO_SWITCHES || a === MMIO_SWITCHES + 1) {
    // Same TODO as trackball reads.
    return;
  }
}
