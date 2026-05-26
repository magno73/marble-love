/**
 * sound-clock.ts — Cross-clock-domain accumulator per il sound subsystem.
 *
 * Atari System 1 hardware:
 *   - 6502 sound CPU: 14.318181 MHz / 8 = 1.789772625 MHz
 *   - YM2151:         14.318181 MHz / 4 = 3.57954525 MHz (~2× clock 6502)
 *   - POKEY:          same nominal domain; the PCM model uses MAME's
 *                     `marble -listxml` device clock, 1.789772 MHz.
 *   - Main 68010:     7.159090 MHz (4× clock 6502)
 *
 * Marble's MAME screen cadence is slightly below 60 Hz. The screen is clocked
 * at 14.318181 MHz / 2 over 456x262 raw pixels, so one video frame is exactly
 * 456 * 262 / 4 = 29,868 sound-CPU cycles.
 *
 * Caller `soundChip.tickCycles(cyclesElapsed)`. `cyclesElapsed` e' espresso
 * in cycle 6502 (1.789 MHz). Il chip avanza il 6502 e a derived sub-domains
 * per i chip audio (Phase 5-6 V3) via fractional accumulator.
 *
 * Pattern mirror di `m68k/clock.ts` esistente nel main worktree.
 */

/** Sound CPU cycles per video frame, rounded to the nearest whole 6502 cycle. */
export const SOUND_CYCLES_PER_FRAME = 29868;

/** Rapporto clock YM2151 / 6502: YM gira ~2× piu' veloce. Usato in Phase 5
 * envelope generator + operator phase accumulator. */
export const YM2151_CYCLES_PER_6502_CYCLE = 2;

/** Rapporto clock POKEY / 6502: 1:1 (stessa frequenza). */
export const POKEY_CYCLES_PER_6502_CYCLE = 1;
