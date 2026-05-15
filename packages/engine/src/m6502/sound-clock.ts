/**
 * sound-clock.ts — Cross-clock-domain accumulator per il sound subsystem.
 *
 * Atari System 1 hardware:
 *   - 6502 sound CPU: 1.789772 MHz
 *   - YM2151:         3.579545 MHz (~2× clock 6502)
 *   - POKEY:          1.789773 MHz (= clock 6502)
 *   - Main 68010:     7.159090 MHz (4× clock 6502)
 *
 * Frame NTSC ≈ 1/60 s. Cycle 6502 per frame: 1789772/60 ≈ 29830.
 *
 * Caller `soundChip.tickCycles(cyclesElapsed)`. `cyclesElapsed` e' espresso
 * in cycle 6502 (1.789 MHz). Il chip avanza il 6502 e a derived sub-domains
 * per i chip audio (Phase 5-6 V3) via fractional accumulator.
 *
 * Pattern mirror di `m68k/clock.ts` esistente nel main worktree.
 */

/** Frame NTSC = 60 Hz. Cycle 6502 per frame. */
export const SOUND_CYCLES_PER_FRAME = 29830;

/** Rapporto clock YM2151 / 6502: YM gira ~2× piu' veloce. Usato in Phase 5
 * envelope generator + operator phase accumulator. */
export const YM2151_CYCLES_PER_6502_CYCLE = 2;

/** Rapporto clock POKEY / 6502: 1:1 (stessa frequenza). */
export const POKEY_CYCLES_PER_6502_CYCLE = 1;
