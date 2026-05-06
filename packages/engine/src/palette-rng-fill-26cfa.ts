/**
 * palette-rng-fill-26cfa.ts — replica `FUN_00026CFA` (84 byte).
 *
 * Sotto-update palette: scrive 8 entry da 5 word ciascuna in palette RAM,
 * a partire da `0xB00202`, con stride 32 byte. Per ogni entry sceglie via
 * RNG (FUN_13A98(2) → 0 o 1) una di due varianti da 6 byte (3 word) della
 * ROM table @ `0x20BB4` (8 entries × 12 byte = 96 byte di table).
 *
 * Layout per entry i (i=0..7):
 *   - dest    = 0xB00202 + i*32
 *   - tableI  = 0x20BB4 + i*12
 *   - rnd     = rngNext(state.rng, 2)         ; (0 o 1)
 *   - srcOff  = (rnd != 0) ? 6 : 0
 *   - src     = tableI + srcOff               ; 6 byte / 3 word
 *   - palette[dest + 0..1]  = 0xAFFF          ; (-0x5001 sext signed → u16)
 *   - palette[dest + 2..3]  = 0xCFC0          ; (-0x3040 sext signed → u16)
 *   - palette[dest + 4..5]  = ROM_BE_u16(src + 0)
 *   - palette[dest + 6..7]  = ROM_BE_u16(src + 2)
 *   - palette[dest + 8..9]  = ROM_BE_u16(src + 4)
 *
 * Vicino alle palette anim funcs (FUN_26BEE, 26C78, 26B88) ma struttura diversa:
 * iterazione fissa 0..7 (non per-object), niente skip flag né wrap counter.
 *
 * Dipendenze: `rngNext` da `rng.ts` (replica `FUN_00013A98`).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

// ─── Costanti ─────────────────────────────────────────────────────────────

/** Palette RAM destination base (entry 0). */
export const PAL_DEST_BASE = 0xb00202 as const;
/** Stride in palette RAM tra entry consecutive. */
export const PAL_DEST_STRIDE = 0x20 as const;
/** Numero di entry generate. */
export const ENTRY_COUNT = 8 as const;
/** ROM table base (8 entries × 12 byte). */
export const ROM_TABLE_BASE = 0x20bb4 as const;
/** Stride dell'entry nella ROM table (2 sub-entry da 6 byte). */
export const ROM_TABLE_STRIDE = 12 as const;
/** Offset della seconda sub-entry quando RNG ritorna != 0. */
export const ROM_SUBENTRY_ALT_OFFSET = 6 as const;

/** Header word 1 — `move.w #-0x5001, (A2)+`. */
export const HEADER_WORD_1 = 0xafff as const; // sext(-0x5001) & 0xffff
/** Header word 2 — `move.w #-0x3040, (A2)+`. */
export const HEADER_WORD_2 = 0xcfc0 as const; // sext(-0x3040) & 0xffff

/** Argomento passato a FUN_13A98 (range limit per LFSR). */
export const RNG_LIMIT = 2 as const;

/** Base palette RAM (per offset → byte index in `colorRam`). */
const PAL_RAM_BASE = 0xb00000 as const;

// ─── Helpers ──────────────────────────────────────────────────────────────

function romReadU16BE(rom: RomImage, offset: number): number {
  return (((rom.program[offset] ?? 0) << 8) | (rom.program[offset + 1] ?? 0)) & 0xffff;
}

function colorRamWriteU16BE(state: GameState, offset: number, value: number): void {
  state.colorRam[offset] = (value >>> 8) & 0xff;
  state.colorRam[offset + 1] = value & 0xff;
}

// ─── Tick ─────────────────────────────────────────────────────────────────

/**
 * Esegue `FUN_00026CFA`. Avanza l'RNG 8 volte (1 step per entry) e scrive
 * 8 × 5 word in palette RAM da `0xB00202`.
 *
 * Modifica `state.rng` (8 chiamate a `rngNext(_, 2)`) e `state.colorRam`.
 */
export function paletteRngFill26CFATick(
  state: GameState,
  rom: RomImage,
): void {
  let palOff = PAL_DEST_BASE - PAL_RAM_BASE;

  for (let i = 0; i < ENTRY_COUNT; i++) {
    const tableEntry = ROM_TABLE_BASE + i * ROM_TABLE_STRIDE;

    // FUN_13A98(2): chiama RNG, poi `tst.l D0; beq → use base; else +6`.
    //
    // Caveat: `rngNext` di `rng.ts` usa `while (r > limit) r -= limit` che
    // produce risultati in [0, limit] invece di [0, limit) — diverge dal
    // binario quando `r == limit` (per limit=2: TS può ritornare 2, binary
    // ritorna 0). Normalizziamo qui per matchare il binary semantics
    // `bgt → exit when limit > r`, equivalente a `r mod limit`.
    let rnd = rngNext(state.rng, as_u16(RNG_LIMIT)) as unknown as number;
    while (rnd >= RNG_LIMIT) rnd -= RNG_LIMIT;
    const src = tableEntry + (rnd !== 0 ? ROM_SUBENTRY_ALT_OFFSET : 0);

    // Header costanti
    colorRamWriteU16BE(state, palOff, HEADER_WORD_1);
    palOff += 2;
    colorRamWriteU16BE(state, palOff, HEADER_WORD_2);
    palOff += 2;

    // 3 word dalla ROM table sub-entry
    colorRamWriteU16BE(state, palOff, romReadU16BE(rom, src + 0));
    palOff += 2;
    colorRamWriteU16BE(state, palOff, romReadU16BE(rom, src + 2));
    palOff += 2;
    colorRamWriteU16BE(state, palOff, romReadU16BE(rom, src + 4));
    palOff += 2;

    // Skip 22 byte (11 word) → stride totale 32 byte
    palOff += 0x16;
  }
}
