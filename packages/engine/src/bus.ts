/**
 * bus.ts - 68010 memory map and MMIO dispatch for Atari System 1.
 *
 * Memory map verified from `docs/hardware-map.md` and
 * `mame/src/mame/atari/atarisy1.cpp:80-143` + `address_map main_map_noslapstic`
 * `:405-429`:
 *
 *   0x000000-0x07FFFF  ROM program (cartridge + motherboard BIOS, 512 KB)
 *   0x080000-0x087FFF  Slapstic-protected ROM (4 banks x 8 KB)
 *   0x2E0000-0x2E0001  Sprite IRQ state (read)
 *   0x400000-0x401FFF  Work RAM (8 KB)
 *   0x800000           Playfield X scroll (write, 9 bit)
 *   0x820000           Playfield Y scroll (write, 9 bit)
 *   0x840000           Playfield priority pen mask (write, 8 bit)
 *   0x860001           Audio/video control (write, 8 bit)
 *   0x880001           Watchdog reset (write strobe)
 *   0x8A0001           VBLANK IRQ ack (write strobe)
 *   0x8C0001           EEPROM unlock (write strobe)
 *   0x900000-0x9FFFFF  Cartridge external RAM/ROM (1 MB)
 *   0xA00000-0xA01FFF  Playfield RAM (8 KB)
 *   0xA02000-0xA02FFF  Motion Object RAM (4 KB, 8 banks)
 *   0xA03000-0xA03FFF  Alphanumerics RAM (4 KB)
 *   0xB00000-0xB007FF  Palette RAM (2 KB, IRGB-4444)
 *   0xF00000-0xF003FF  EEPROM (1 KB, 8-bit)
 *   0xF20000-0xF20007  Trackball ports (Marble: rotated 45 degrees)
 *   0xF40000-0xF4001F  Joystick / ADC (unused by Marble)
 *   0xF60000           Switch inputs (start/vblank/coin-pending bits)
 *   0xFC0000           Sound response read
 *   0xFE0000           Sound command write
 *
 * All access goes through `read8/read16/read32` and `write8/write16/write32`.
 * The bus is 16-bit big-endian, so read32 is two consecutive read16 calls.
 *
 * This does not emulate the 68010 CPU. It provides correct dispatch for higher
 * layers, direct TS game-logic ports, and future emulator work. RAM regions are
 * read/write, while MMIO returns stable values or records side effects.
 */

import type { GameState } from "./state.js";
import { createSlapsticFsm, type SlapsticFsm } from "./m68k/slapstic-103.js";
import type { u8, u16, u32 } from "./wrap.js";
import {
  as_u8,
  as_u16,
  u16_pack8,
  u32_pack16,
} from "./wrap.js";

// ─── ROM image ────────────────────────────────────────────────────────────

export interface RomImage {
  /**
   * 68010 program ROM, with even/odd chips already merged big-endian.
   *
   * Layout:
   *   0x000000-0x07FFFF  main program ROM (512KB)
   *   0x080000-0x087FFF  slapstic-mapped window (8KB visible, 4-way mirrored).
   *                      This region reflects the active slapstic-103 bank,
   *                      mirrored four times. `slapsticBanks` keeps pristine
   *                      copies of all four banks.
   *
   * Call `applySlapsticBank` after a bank change to keep this region coherent.
   */
  program: Uint8Array;
  /**
   * Pristine backup of the four slapstic banks (32 KB = 4 x 8 KB), indexed as
   * `slapsticBanks[bank*0x2000 + offset]`.
   */
  slapsticBanks: Uint8Array;
  /**
   * State machine slapstic 137412-103 — bank-switching tracking.
   * Default state: bank = bankstart (3), state = IDLE.
   * Mutated by `slapsticLookup`; impacts `program[0x080000-0x087FFF]` through
   * `applySlapsticBank`.
   */
  slapsticFsm: SlapsticFsm;
  /** Sound CPU 6502. */
  sound: Uint8Array;
  /** Tile graphics (planar, multiple banks). */
  tiles: Uint8Array;
  /** Sprite/MO graphics (in shared region with tiles). */
  sprites: Uint8Array;
  /** PROMs (color/remap tables). */
  proms: Uint8Array;
}

export function emptyRomImage(): RomImage {
  return {
    program: new Uint8Array(0x88000),  // 544 KB (incl. slapstic at 0x80000)
    slapsticBanks: new Uint8Array(0x8000), // 32KB = 4 × 8KB pristine banks
    slapsticFsm: createSlapsticFsm(),
    sound: new Uint8Array(0x10000),
    tiles: new Uint8Array(0x100000),
    sprites: new Uint8Array(0),
    proms: new Uint8Array(0x400),
  };
}

// ─── Bus ──────────────────────────────────────────────────────────────────

export interface Bus {
  rom: RomImage;
  state: GameState;
  /** Count of undocumented MMIO accesses, used only for debugging. */
  unmappedAccesses: number;
}

export function createBus(rom: RomImage, state: GameState): Bus {
  return { rom, state, unmappedAccesses: 0 };
}

// ─── Memory map constants ─────────────────────────────────────────────────

export const ROM_BASE         = 0x000000 as const;
export const ROM_END          = 0x080000 as const;
export const SLAPSTIC_BASE    = 0x080000 as const;
export const SLAPSTIC_END     = 0x088000 as const;
export const INT3_STATE       = 0x2E0000 as const;
export const WORK_RAM_BASE    = 0x400000 as const;
export const WORK_RAM_END     = 0x402000 as const;
export const MMIO_PF_XSCROLL  = 0x800000 as const;
export const MMIO_PF_YSCROLL  = 0x820000 as const;
export const MMIO_PF_PRIORITY = 0x840000 as const;
export const MMIO_AV_CONTROL  = 0x860000 as const; // word-addressable, low byte at 860001
export const MMIO_WATCHDOG    = 0x880000 as const;
export const MMIO_VBLANK_ACK  = 0x8A0000 as const;
export const MMIO_EEPROM_UNLOCK = 0x8C0000 as const;
export const CART_RAM_BASE    = 0x900000 as const;
export const CART_RAM_END     = 0xA00000 as const;
export const PF_RAM_BASE      = 0xA00000 as const;
export const PF_RAM_END       = 0xA02000 as const;
export const SPRITE_RAM_BASE  = 0xA02000 as const;
export const SPRITE_RAM_END   = 0xA03000 as const;
export const ALPHA_RAM_BASE   = 0xA03000 as const;
export const ALPHA_RAM_END    = 0xA04000 as const;
export const PAL_RAM_BASE     = 0xB00000 as const;
export const PAL_RAM_END      = 0xB00800 as const;
export const EEPROM_BASE      = 0xF00000 as const;
export const EEPROM_END       = 0xF00400 as const;
export const MMIO_TRAKBALL_BASE = 0xF20000 as const; // F20000-F20007 (4 ports)
export const MMIO_TRAKBALL_END  = 0xF20008 as const;
export const MMIO_ADC_BASE    = 0xF40000 as const;
export const MMIO_ADC_END     = 0xF40020 as const;
export const MMIO_SWITCHES    = 0xF60000 as const;
export const MMIO_SOUND_RESP  = 0xFC0000 as const;
export const MMIO_SOUND_CMD   = 0xFE0000 as const;
export const MMIO_SOUND_CMD_ALT = 0xF80000 as const; // alt write (used by roadbls2)

/** Cartridge external RAM size (`0x900000-0x9FFFFF`, 1 MB). */
const CART_RAM_SIZE = 0x100000;

// Map from Bus instance to lazily allocated cartridge RAM. Keep it out of Bus
// by default because it is 1 MB per instance.
const cartRamMap = new WeakMap<Bus, Uint8Array>();

function cartRam(bus: Bus): Uint8Array {
  let r = cartRamMap.get(bus);
  if (r === undefined) {
    r = new Uint8Array(CART_RAM_SIZE);
    cartRamMap.set(bus, r);
  }
  return r;
}

// ─── Read 8-bit ───────────────────────────────────────────────────────────

export function read8(bus: Bus, addr: number): u8 {
  const a = addr >>> 0;

  // ROM 0x000000-0x07FFFF
  if (a < ROM_END) {
    return as_u8(bus.rom.program[a] ?? 0);
  }

  // Slapstic ROM 0x080000-0x087FFF (bank-switched, 4×8KB with mirrors).
  // The `rom.program[0x80000..0x88000)` region reflects the active bank
  // mirrored 4 times; `applySlapsticBank` updates it when the FSM changes
  // banks. For typical bus reads, reading the program array is enough. The
  // FSM is advanced only by helper subs that explicitly call `slapsticTick`
  // or `slapsticLookup`.
  if (a >= SLAPSTIC_BASE && a < SLAPSTIC_END) {
    return as_u8(bus.rom.program[a] ?? 0);
  }

  // Sprite IRQ state read (always returns 0 since IRQ3 not used by Marble)
  if (a === INT3_STATE || a === INT3_STATE + 1) {
    return as_u8(0);
  }

  // Work RAM 0x400000-0x401FFF
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    return as_u8(bus.state.workRam[a - WORK_RAM_BASE] ?? 0);
  }

  // Cartridge RAM 0x900000-0x9FFFFF
  if (a >= CART_RAM_BASE && a < CART_RAM_END) {
    return as_u8(cartRam(bus)[a - CART_RAM_BASE] ?? 0);
  }

  // Playfield RAM
  if (a >= PF_RAM_BASE && a < PF_RAM_END) {
    return as_u8(bus.state.workRam[a - PF_RAM_BASE] ?? 0); // PF tilemap RAM
  }

  // Sprite RAM 0xA02000-0xA02FFF
  if (a >= SPRITE_RAM_BASE && a < SPRITE_RAM_END) {
    return as_u8(bus.state.spriteRam[a - SPRITE_RAM_BASE] ?? 0);
  }

  // Alpha RAM 0xA03000-0xA03FFF
  if (a >= ALPHA_RAM_BASE && a < ALPHA_RAM_END) {
    return as_u8(bus.state.spriteRam[a - ALPHA_RAM_BASE] ?? 0);
  }

  // Palette RAM 0xB00000-0xB007FF
  if (a >= PAL_RAM_BASE && a < PAL_RAM_END) {
    return as_u8(bus.state.colorRam[a - PAL_RAM_BASE] ?? 0);
  }

  // EEPROM 0xF00000-0xF003FF
  if (a >= EEPROM_BASE && a < EEPROM_END) {
    // umask16(0x00ff): low byte only. Return erased EEPROM value for now.
    return as_u8(0xff);
  }

  // Trackball 0xF20000-0xF20007 (Marble: m_trackball_type=1, rotated 45 deg).
  if (a >= MMIO_TRAKBALL_BASE && a < MMIO_TRAKBALL_END) {
    return readTrackball(bus, a);
  }

  // Switches 0xF60000-0xF60003
  if (a >= MMIO_SWITCHES && a < MMIO_SWITCHES + 4) {
    return readSwitches(bus, a);
  }

  // Sound response
  if (a === MMIO_SOUND_RESP || a === MMIO_SOUND_RESP + 1) {
    // No response yet; the sound mailbox path owns future behavior here.
    return as_u8(0);
  }

  // Unmapped access
  bus.unmappedAccesses++;
  return as_u8(0xff);
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

// ─── Write 8-bit ──────────────────────────────────────────────────────────

export function write8(bus: Bus, addr: number, value: u8): void {
  const a = addr >>> 0;
  const v = value as unknown as number;

  // ROM is read-only. Slapstic-window writes can trigger hardware state, but
  // this model drives bank changes through `slapsticLookup`, the binary path
  // that performs the required access sequence.
  if (a < SLAPSTIC_END) {
    return;
  }

  // Work RAM
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    bus.state.workRam[a - WORK_RAM_BASE] = v;
    return;
  }

  // Cartridge RAM
  if (a >= CART_RAM_BASE && a < CART_RAM_END) {
    cartRam(bus)[a - CART_RAM_BASE] = v;
    return;
  }

  // Video MMIO — playfield scroll registers (9-bit each, big-endian word
  // at 0x800000 / 0x820000). High byte = bits 8 (clamp), low byte = bits 0..7.
  if (a === MMIO_PF_XSCROLL) {
    bus.state.videoScrollX = ((bus.state.videoScrollX & 0x00ff) | (v << 8)) & 0x1ff;
    return;
  }
  if (a === MMIO_PF_XSCROLL + 1) {
    bus.state.videoScrollX = ((bus.state.videoScrollX & 0x100) | (v & 0xff)) & 0x1ff;
    return;
  }
  if (a === MMIO_PF_YSCROLL) {
    bus.state.videoScrollY = ((bus.state.videoScrollY & 0x00ff) | (v << 8)) & 0x1ff;
    return;
  }
  if (a === MMIO_PF_YSCROLL + 1) {
    bus.state.videoScrollY = ((bus.state.videoScrollY & 0x100) | (v & 0xff)) & 0x1ff;
    return;
  }
  if (a === MMIO_PF_PRIORITY || a === MMIO_PF_PRIORITY + 1) {
    return;
  }
  if (a === MMIO_AV_CONTROL || a === MMIO_AV_CONTROL + 1) {
    return;
  }
  if (a === MMIO_WATCHDOG || a === MMIO_WATCHDOG + 1) {
    return; // strobe; no state
  }
  if (a === MMIO_VBLANK_ACK || a === MMIO_VBLANK_ACK + 1) {
    return; // ack handled at IRQ level
  }
  if (a === MMIO_EEPROM_UNLOCK || a === MMIO_EEPROM_UNLOCK + 1) {
    return;
  }

  // Playfield RAM
  if (a >= PF_RAM_BASE && a < PF_RAM_END) {
    bus.state.workRam[a - PF_RAM_BASE] = v;
    return;
  }

  // Sprite RAM
  if (a >= SPRITE_RAM_BASE && a < SPRITE_RAM_END) {
    bus.state.spriteRam[a - SPRITE_RAM_BASE] = v;
    return;
  }

  // Alpha RAM
  if (a >= ALPHA_RAM_BASE && a < ALPHA_RAM_END) {
    bus.state.spriteRam[a - ALPHA_RAM_BASE] = v;
    return;
  }

  // Palette RAM
  if (a >= PAL_RAM_BASE && a < PAL_RAM_END) {
    bus.state.colorRam[a - PAL_RAM_BASE] = v;
    return;
  }

  // EEPROM (8-bit, low byte only)
  if (a >= EEPROM_BASE && a < EEPROM_END) {
    return; // EEPROM persistence is intentionally not modeled yet.
  }

  // Sound command (mailbox 68010 → 6502)
  if (a === MMIO_SOUND_CMD || a === MMIO_SOUND_CMD + 1) {
    // AudioEvent dispatcher path; currently tracked by higher-level sound code.
    return;
  }
  if (a === MMIO_SOUND_CMD_ALT || a === MMIO_SOUND_CMD_ALT + 1) {
    return; // alt path, used by roadbls2
  }

  // ADC (Marble does not use it, but we write a no-op)
  if (a >= MMIO_ADC_BASE && a < MMIO_ADC_END) {
    return;
  }

  bus.unmappedAccesses++;
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

// ─── MMIO handlers ────────────────────────────────────────────────────────

/**
 * Trackball read per Marble Madness (`m_trackball_type=1`, rotated 45°).
 *
 * Replica `atarisys1.cpp:281-319 trakball_r`:
 *   F20000 (P1, X read): cur[0][0] = posx + posy  (rotated)
 *   F20002 (P1, Y read): cur[0][1] = posx - posy
 *   F20004 (P2, X read): cur[1][0]
 *   F20006 (P2, Y read): cur[1][1]
 *
 * posx/posy values as from `state.input.trackballDx/Dy`.
 */
function readTrackball(bus: Bus, addr: number): u8 {
  const a = addr - MMIO_TRAKBALL_BASE;
  const player = (a >>> 1) & 1;
  const which = a & 1; // bit 0 = byte high/low (rotated mapping)
  const port = (a >>> 2) & 1; // word index inside player's pair

  // Marble is P1-only here; P2 reads as 0.
  if (player !== 0) return as_u8(0);

  const dx = (bus.state.input.trackballDx as unknown as number) | 0;
  const dy = (bus.state.input.trackballDy as unknown as number) | 0;

  // Sign-extend u8 → i8
  const posx = (dx & 0x80) ? (dx - 0x100) : dx;
  const posy = (dy & 0x80) ? (dy - 0x100) : dy;

  let result: number;
  if (port === 0) {
    // Even ports: rotated values
    result = which === 0 ? posx + posy : posx - posy;
  } else {
    // Odd ports: should return same value (cached in m_cur)
    result = which === 0 ? posx + posy : posx - posy;
  }
  return as_u8(result & 0xff);
}

/**
 * Switch port read (`atarisy1.cpp:481-499` per marble):
 *   F60000 word: bit 0 = START1, bit 1 = START2, bit 4 = VBLANK live,
 *                bit 6 = self-test, bit 7 = sound command pending
 */
function readSwitches(bus: Bus, addr: number): u8 {
  const a = addr - MMIO_SWITCHES;
  if (a === 0) {
    // High byte of word
    return as_u8(0xff); // active-low: all unpressed bits are 1.
  }
  if (a === 1) {
    // Low byte: bit 0/1 START, bit 4 VBLANK, bit 6 test, bit 7 sound pending
    let v = 0xff; // active-low default
    const buttons = bus.state.input.buttons as unknown as number;
    if (buttons & 0x1) v &= ~0x01; // START1 pressed = 0
    if (buttons & 0x2) v &= ~0x02; // START2
    // Bit 4 = VBLANK live. At frame_done parity points this should read active.
    v &= ~0x10;
    return as_u8(v);
  }
  return as_u8(0xff);
}
