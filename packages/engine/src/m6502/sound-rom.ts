/**
 * Marble Madness sound ROM loader for `136033.421` and `136033.422`.
 *
 * MAME `atarisy1.cpp` `ROM_START(marble)`, audiocpu region:
 *   ROM_LOAD( "136033.421",  0x8000, 0x4000 )  // 16KB, mapped $8000-$BFFF
 *   ROM_LOAD( "136033.422",  0xC000, 0x4000 )  // 16KB, mapped $C000-$FFFF
 *
 * Sound CPU ROM address map: $4000-$FFFF (48KB). Marble uses only the final
 * 32KB at $8000-$FFFF; $4000-$7FFF remains open bus ($FF).
 *
 * `sound-mmu.ts` accetta un Uint8Array di 0xC000 byte (48KB) e mappa
 * `rom[i]` a addr `$4000 + i`. Layout del buffer prodotto qui:
 *
 *   buffer[0x0000..0x4000] = 0xFF        (area $4000-$7FFF: open bus)
 *   buffer[0x4000..0x8000] = rom421      (area $8000-$BFFF: low ROM)
 *   buffer[0x8000..0xC000] = rom422      (area $C000-$FFFF: high ROM)
 *
 * Reset/NMI/IRQ vectors land in the final bytes of `rom422`.
 */

export const SOUND_ROM_BUFFER_SIZE = 0xC000;  // 48KB, mapped $4000-$FFFF
const ROM_BANK_SIZE = 0x4000;                 // 16KB per bank

export interface SoundRomFiles {
  /** 136033.421 — 16KB, mapped $8000-$BFFF. */
  rom421: Uint8Array;
  /** 136033.422 — 16KB, mapped $C000-$FFFF, with reset/NMI/IRQ vectors. */
  rom422: Uint8Array;
}

/**
 * Build the 48KB `createSoundMmu` ROM buffer from the two 16KB ROM files.
 * Throws on incorrect file sizes so corrupt dumps fail early.
 */
export function buildSoundRom(files: SoundRomFiles): Uint8Array {
  if (files.rom421.length !== ROM_BANK_SIZE) {
    throw new Error(
      `sound-rom: 136033.421 size atteso 0x4000 (16KB), ricevuto 0x${files.rom421.length.toString(16)}`,
    );
  }
  if (files.rom422.length !== ROM_BANK_SIZE) {
    throw new Error(
      `sound-rom: 136033.422 size atteso 0x4000 (16KB), ricevuto 0x${files.rom422.length.toString(16)}`,
    );
  }
  const buffer = new Uint8Array(SOUND_ROM_BUFFER_SIZE).fill(0xff);
  buffer.set(files.rom421, 0x4000);
  buffer.set(files.rom422, 0x8000);
  return buffer;
}
