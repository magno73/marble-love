/**
 * Rebuild `rom.program[0x80000..0x88000)` for the active slapstic bank.
 *
 * The active 8KB bank is copied from `rom.slapsticBanks` into
 * `rom.program[0x80000..0x82000)` and mirrored four times, matching the MAME
 * System 1 mapping. This keeps regular `rom.program[a]` reads correct for any
 * address in the protected slapstic window.
 */

import type { RomImage } from "../bus.js";

export const SLAPSTIC_BASE = 0x080000;
export const SLAPSTIC_END = 0x088000;
export const SLAPSTIC_BANK_SIZE = 0x2000; // 8KB
export const SLAPSTIC_MIRROR_COUNT = 4;

/**
 * Load a full main+slapstic ROM blob into `rom`.
 *
 * - `rom.program[0..0x80000)` receives the flat 512KB main ROM.
 * - `rom.slapsticBanks` receives the pristine 4 x 8KB slapstic banks.
 * - `rom.program[0x80000..0x88000)` receives the active bank mirrored 4 times.
 *
 * @param rom RomImage to populate.
 * @param raw Complete ROM dump, at least 0x88000 bytes.
 */
export function loadRomBlob(rom: RomImage, raw: Uint8Array): void {
  if (raw.length < SLAPSTIC_END) {
    throw new Error(`loadRomBlob: raw buffer too small (${raw.length} < ${SLAPSTIC_END})`);
  }
  // Main ROM (flat)
  rom.program.set(raw.subarray(0, SLAPSTIC_BASE), 0);
  // 4 bank pristine in slapsticBanks
  rom.slapsticBanks.set(raw.subarray(SLAPSTIC_BASE, SLAPSTIC_END));
  // Mirror active bank (default bankstart = 3) in program[0x80000..0x88000).
  applySlapsticBank(rom, rom.slapsticFsm.bank);
}

/**
 * Update `rom.program[0x80000..0x88000)` for the selected bank, mirrored 4x.
 *
 * @param rom RomImage mutated in place.
 * @param bank Bank to make active (0..3).
 */
export function applySlapsticBank(rom: RomImage, bank: number): void {
  const b = bank & 3;
  const src = rom.slapsticBanks.subarray(b * SLAPSTIC_BANK_SIZE, (b + 1) * SLAPSTIC_BANK_SIZE);
  // Mirror 4x: 0x80000-0x82000, 0x82000-0x84000, 0x84000-0x86000, 0x86000-0x88000.
  for (let i = 0; i < SLAPSTIC_MIRROR_COUNT; i++) {
    rom.program.set(src, SLAPSTIC_BASE + i * SLAPSTIC_BANK_SIZE);
  }
}
