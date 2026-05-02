/**
 * bus.ts — memory map e dispatch MMIO del 68010 (Atari System 1).
 *
 * **Status: STUB.** La memory map vera viene popolata in Phase 1 leggendo
 * `mame/src/mame/atari/atarisy1.cpp` e producendo `docs/hardware-map.md`.
 *
 * Layout atteso (placeholder, da confermare):
 *   0x000000-0x0FFFFF — ROM (program)
 *   0x800000-0x80xxxx — work RAM (16K)
 *   0x900000-...      — sprite/motion-object RAM
 *   0xA00000-...      — color RAM (palette)
 *   0xB00000-...      — MMIO (input, sound mailbox, video control)
 *
 * Tutti gli accessi passano da `read8/read16/read32` e `write8/write16/write32`.
 * Il bus è 16 bit (dual byte), quindi read32 = due read16 consecutive.
 */

import type { GameState } from "./state.js";
import type { u8, u16, u32 } from "./wrap.js";
import {
  as_u8,
  as_u16,
  u16_pack8,
  u32_pack16,
} from "./wrap.js";

export interface RomImage {
  /** Programma 68010 (interleaved even/odd già fuso da `tools/rom_prep.py`). */
  program: Uint8Array;
  /** Sound CPU 6502. */
  sound: Uint8Array;
  /** Tile graphics. */
  tiles: Uint8Array;
  /** Sprite graphics. */
  sprites: Uint8Array;
  /** Eventuali alpha layer / proms. */
  proms: Uint8Array;
}

export interface Bus {
  rom: RomImage;
  state: GameState;
}

/** Range del memory map. Da rimpiazzare in Phase 1 con i valori esatti. */
export const ROM_BASE = 0x000000;
export const WORK_RAM_BASE = 0x800000;
export const SPRITE_RAM_BASE = 0x900000;
export const COLOR_RAM_BASE = 0xa00000;
export const MMIO_BASE = 0xb00000;

// ─── Read ─────────────────────────────────────────────────────────────────

export function read8(bus: Bus, addr: number): u8 {
  const a = addr >>> 0;
  if (a < bus.rom.program.length) {
    return as_u8(bus.rom.program[a] ?? 0);
  }
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + bus.state.workRam.length) {
    return as_u8(bus.state.workRam[a - WORK_RAM_BASE] ?? 0);
  }
  if (a >= SPRITE_RAM_BASE && a < SPRITE_RAM_BASE + bus.state.spriteRam.length) {
    return as_u8(bus.state.spriteRam[a - SPRITE_RAM_BASE] ?? 0);
  }
  if (a >= COLOR_RAM_BASE && a < COLOR_RAM_BASE + bus.state.colorRam.length) {
    return as_u8(bus.state.colorRam[a - COLOR_RAM_BASE] ?? 0);
  }
  if (a >= MMIO_BASE) {
    return readMmio8(bus, a);
  }
  return as_u8(0);
}

export function read16(bus: Bus, addr: number): u16 {
  const hi = read8(bus, addr);
  const lo = read8(bus, addr + 1);
  return u16_pack8(hi, lo);
}

export function read32(bus: Bus, addr: number): u32 {
  const hi = read16(bus, addr);
  const lo = read16(bus, addr + 2);
  return u32_pack16(hi, lo);
}

// ─── Write ────────────────────────────────────────────────────────────────

export function write8(bus: Bus, addr: number, value: u8): void {
  const a = addr >>> 0;
  const v = value as unknown as number;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + bus.state.workRam.length) {
    bus.state.workRam[a - WORK_RAM_BASE] = v;
    return;
  }
  if (a >= SPRITE_RAM_BASE && a < SPRITE_RAM_BASE + bus.state.spriteRam.length) {
    bus.state.spriteRam[a - SPRITE_RAM_BASE] = v;
    return;
  }
  if (a >= COLOR_RAM_BASE && a < COLOR_RAM_BASE + bus.state.colorRam.length) {
    bus.state.colorRam[a - COLOR_RAM_BASE] = v;
    return;
  }
  if (a >= MMIO_BASE) {
    writeMmio8(bus, a, value);
    return;
  }
  // Write a ROM è no-op
}

export function write16(bus: Bus, addr: number, value: u16): void {
  const v = value as unknown as number;
  write8(bus, addr, as_u8(v >>> 8));
  write8(bus, addr + 1, as_u8(v));
}

export function write32(bus: Bus, addr: number, value: u32): void {
  const v = value as unknown as number;
  write16(bus, addr, as_u16(v >>> 16));
  write16(bus, addr + 2, as_u16(v));
}

// ─── MMIO dispatch ────────────────────────────────────────────────────────

/** STUB. Gli MMIO concreti (input, sound mailbox, video control) vanno
 *  popolati in Phase 1 da `atarisy1.cpp`. */
function readMmio8(_bus: Bus, _addr: number): u8 {
  return as_u8(0);
}
function writeMmio8(_bus: Bus, _addr: number, _value: u8): void {
  // no-op stub
}
