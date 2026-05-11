/**
 * apply-slapstic-bank.ts — rebuild della regione `rom.program[0x80000..0x88000)`
 * per riflettere il bank slapstic attivo, mirrorato 4 volte (mirror=0x6000
 * come in `atarisy1.cpp:434: map(0x080000, 0x081fff).mirror(0x6000)`).
 *
 * Il bank attivo (8KB) viene copiato da `rom.slapsticBanks[bank*0x2000..]` in
 * `rom.program[0x80000..0x82000)`, e replicato in [0x82000..0x88000) per il
 * mirror. Cosi' qualsiasi accesso `rom.program[a]` con `a` dentro la window
 * slapstic legge il byte del bank corrente correttamente.
 *
 * Chiamato da:
 *  - `loadSlapsticBanks` durante setup (inizializza il bank di reset)
 *  - `slapsticLookup` ogni volta che la FSM cambia bank
 *
 * **Performance**: 4 × 8KB memcpy = 32KB per cambio bank. Cambi bank avvengono
 * tipicamente 1-3 volte per body tick → impatto trascurabile.
 */

import type { RomImage } from "../bus.js";

export const SLAPSTIC_BASE = 0x080000;
export const SLAPSTIC_END = 0x088000;
export const SLAPSTIC_BANK_SIZE = 0x2000; // 8KB
export const SLAPSTIC_MIRROR_COUNT = 4;

/**
 * Carica un blob ROM completo (main + slapstic) in `rom`. Gestisce
 * correttamente la separazione tra main ROM piatta e regione slapstic:
 *  - `rom.program[0..0x80000)` ← `blob[0..0x80000)` (main ROM, 512KB)
 *  - `rom.slapsticBanks` ← `blob[0x80000..0x88000)` (4 bank pristine, 32KB)
 *  - `rom.program[0x80000..0x88000)` ← bank attivo mirrorato 4 volte
 *
 * @param rom    RomImage da popolare.
 * @param raw    Source buffer (ROM dump completo, >= 0x88000 byte).
 */
export function loadRomBlob(rom: RomImage, raw: Uint8Array): void {
  if (raw.length < SLAPSTIC_END) {
    throw new Error(`loadRomBlob: raw buffer too small (${raw.length} < ${SLAPSTIC_END})`);
  }
  // Main ROM (flat)
  rom.program.set(raw.subarray(0, SLAPSTIC_BASE), 0);
  // 4 bank pristine in slapsticBanks
  rom.slapsticBanks.set(raw.subarray(SLAPSTIC_BASE, SLAPSTIC_END));
  // Mirror bank attivo (default = bankstart = 3) in program[0x80000..0x88000)
  applySlapsticBank(rom, rom.slapsticFsm.bank);
}

/**
 * Aggiorna `rom.program[0x80000..0x88000)` per riflettere il `bank` indicato,
 * mirrorato 4 volte (4 copie da 8KB ciascuna).
 *
 * @param rom    RomImage (program e' mutato in place).
 * @param bank   Bank da rendere attivo (0..3).
 */
export function applySlapsticBank(rom: RomImage, bank: number): void {
  const b = bank & 3;
  const src = rom.slapsticBanks.subarray(b * SLAPSTIC_BANK_SIZE, (b + 1) * SLAPSTIC_BANK_SIZE);
  // Mirror 4 volte: 0x80000-0x82000, 0x82000-0x84000, 0x84000-0x86000, 0x86000-0x88000
  for (let i = 0; i < SLAPSTIC_MIRROR_COUNT; i++) {
    rom.program.set(src, SLAPSTIC_BASE + i * SLAPSTIC_BANK_SIZE);
  }
}
