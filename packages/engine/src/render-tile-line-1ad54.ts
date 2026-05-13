/**
 * render-tile-line-1ad54.ts — replica `FUN_0001AD54` (982 byte,
 * 0x01AD54-0x01B12A).
 *
 * **Tile-line renderer.** Disegna una "linea" di tile in un buffer di celle
 * a 8 byte ciascuna (@0x400A9C in workRam) su una griglia di 0x16 (22)
 * colonne. Per ogni cella (row, col) scrive D1.w in 1..4 slot word (offset
 * 0/2/4/6 dentro la cella da 8 byte) in base alla posizione della cella
 * rispetto ai bordi del rettangolo di rendering.
 *
 * **Argomenti** (convenzione M68k cdecl push-RTL, ogni arg è un long, reads
 * sul low word):
 *   - `ptrAbs`  (A6+0x8, long)  : pointer assoluto M68k a un descrittore di
 *                                  8 byte (struct 8-byte, vedi sotto).
 *   - `d5`      (A6+0xE, word)  : offset "D5" per il calcolo della colonna.
 *   - `d4`      (A6+0x12, word) : offset "D4" per il calcolo della riga.
 *   - `limit`   (A6+0x16, word) : limite sup. esclusivo della colonna (clip).
 *   - `flag`    (A6+0x1A, word) : se zero → early-exit (solo A4 flag).
 *
 * **Struct descrittore** (8 byte @ ptrAbs):
 *   byte[0]  : x_base (signed, esteso a word)
 *   byte[1]  : x_count (unsigned)
 *   byte[2]  : y_base (signed, esteso a word)
 *   byte[3]  : y_count (unsigned)
 *   byte[4..5]: flags_word — bit 1 del high byte attiva mask A4; bit[3:2]
 *               + 0x10 vengono OR-ati in A4.
 *   byte[6]  : extra — bit 7 → A4 |= 0x80; bit[6:5] → A4 |= (bit[6:5]);
 *               bit[4:0] → sub-index nella pointer-table.
 *   byte[7]  : lookup_byte — bit 3 → "sub mode"; bit[2:0] → indice nella
 *               direction table ROM @0x1ECEA (8 coppie dx/dy word).
 *
 * **Direction table ROM @0x1ECEA**: 8 coppie di word signed (dx, dy) di
 * 2 word ciascuna (4 byte per coppia) per indici 0..7. `dx = local[-12]`,
 * `dy = local[-14]`.
 *   - dx < 0 → outer var = y (local[-4]), end = local[-2] - 1
 *   - dx >= 0 → outer var = local[-2], end = local[-4] + 1
 *   - dy < 0 → inner start = local[-6], end = local[-8] - 1
 *   - dy >= 0 → inner start = local[-8], end = local[-6] + 1
 *
 * **Pointer-table** (letta in workRam via `*(0x400474)` + `*(A1+0x20)`):
 *   Entry = long @ base + sub_index*4. Legge la entry come "data pointer"
 *   A2 (scan ptr). Ogni byte di A2 è un valore signed; se il byte è 0x80
 *   A2 viene resettato al puntatore originale (loop del dato).
 *
 * **Buffer output** @0x400A9C in workRam (base assoluta 0x400000):
 *   cellAddr = (row * 0x16 + col) * 8 + 0x400A9C
 *   dove `row = A0w`, `col = A1w >> 1` (con clip).
 *
 * **Return** (D0): A4 flag word (sign-extended a long).
 *
 * **Caller noto**: FUN_0001A444 @ 0x1A53A (UNCONDITIONAL_CALL).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { applySlapsticBank } from "./m68k/apply-slapstic-bank.js";
import { slapsticTick } from "./m68k/slapstic-103.js";

// ─── Costanti ────────────────────────────────────────────────────────────────

const WORK_RAM_BASE = 0x400000 as const;
const WORK_RAM_END  = 0x402000 as const;
const ROM_END       = 0x88000  as const;
const SLAPSTIC_BASE = 0x80000 as const;

/** Offset assoluto nel workRam del buffer di celle output. */
export const CELL_BUF_ABS  = 0x400a9c as const;
/** Numero di colonne nella griglia (stride). */
export const GRID_COLS     = 0x16     as const;
/** Dimensione in byte di ogni cella. */
export const CELL_BYTES    = 8        as const;

/** Indirizzo assoluto del puntatore-radice della pointer-table. */
export const PTR_TABLE_ROOT = 0x400474 as const;

/** Base assoluta della direction table ROM. */
export const DIR_TABLE_ROM  = 0x1ecea  as const;

// ─── Helpers mem ─────────────────────────────────────────────────────────────

function rd8(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a < ROM_END) {
    if (a >= SLAPSTIC_BASE) touchSlapstic(rom, a);
    return (rom.program[a] ?? 0) & 0xff;
  }
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    return (state.workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
  }
  return 0;
}

function touchSlapstic(rom: RomImage, abs: number): void {
  const prevBank = rom.slapsticFsm.bank;
  slapsticTick(rom.slapsticFsm, abs >>> 0);
  if (rom.slapsticFsm.bank !== prevBank) applySlapsticBank(rom, rom.slapsticFsm.bank);
}

function slapsticEvent2BC5C(rom: RomImage, flagsWord: number): void {
  const d2 = flagsWord & 0xffff;
  touchSlapstic(rom, 0x80000);
  if ((d2 & 0x01) !== 0) touchSlapstic(rom, 0x86984);
  if ((d2 & 0x02) !== 0) touchSlapstic(rom, 0x80000);
  if ((d2 & 0x10) !== 0) {
    const index = (d2 & 0x0c) >> 2;
    // The Slapstic tap observes the whole CPU address space. During the
    // table-store helper, the 68010 prefetch at 0x02ff5a matches the chip-103
    // alternate-banking `alt1` test_any pattern before the protected R/W pair.
    touchSlapstic(rom, 0x2ff5a);
    touchSlapstic(rom, 0x87a28);
    touchSlapstic(rom, (0x87a48 + index * 2) >>> 0);
  }
  if ((d2 & 0x80) !== 0) touchSlapstic(rom, 0x80000);
  touchSlapstic(rom, (0x80080 + (d2 & 0x60)) >>> 0);
}

function rd16(state: GameState, rom: RomImage, abs: number): number {
  return ((rd8(state, rom, abs) << 8) | rd8(state, rom, (abs + 1) >>> 0)) & 0xffff;
}

function rd32(state: GameState, rom: RomImage, abs: number): number {
  const hi = rd16(state, rom, abs);
  const lo = rd16(state, rom, (abs + 2) >>> 0);
  return ((hi << 16) | lo) >>> 0;
}

function wr8(state: GameState, abs: number, v: number): void {
  const a = abs >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    state.workRam[a - WORK_RAM_BASE] = v & 0xff;
  }
}

function wr16(state: GameState, abs: number, v: number): void {
  wr8(state, abs,               (v >>> 8) & 0xff);
  wr8(state, (abs + 1) >>> 0,   v & 0xff);
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect `FUN_0001AD54`.
 *
 * @param state    GameState — workRam letto/scritto.
 * @param rom      ROM image — letto per le lookup table.
 * @param ptrAbs   Pointer M68k assoluto al descrittore 8-byte.
 * @param d5       Valore D5 (word signed) — offset colonna.
 * @param d4       Valore D4 (word signed) — offset riga.
 * @param limit    Limite sup. esclusivo colonna (arg @ A6+0x16).
 * @param flag     Se != 0, esegue il rendering completo; se 0 early-exit.
 * @returns        Valore A4 (flag bitmask) sign-extended a 32-bit (D0).
 */
export function renderTileLine1AD54(
  state: GameState,
  rom: RomImage,
  ptrAbs: number,
  d5: number,
  d4: number,
  limit: number,
  flag: number,
): number {
  // ── Inizializzazione ──────────────────────────────────────────────────────

  // D5 e D4 sono word signed
  d5 = (d5 << 16) >> 16; // sign-extend to int32
  d4 = (d4 << 16) >> 16;
  limit = limit & 0xffff;
  flag  = flag & 0xffff;

  // A4 = 0 (flag accumulator)
  let a4 = 0;

  // Leggi byte[0] = x_base (signed)
  const byte0 = rd8(state, rom, ptrAbs);
  // sign-extend byte → word
  const loc_neg2 = ((byte0 & 0xff) << 24) >> 24; // signed int8 → int32

  // btst.b #0, byte0: se bit 0 == 0 → A4 |= 1
  if ((byte0 & 0x01) === 0) {
    a4 |= 1;
  }

  // Leggi word at ptrAbs (A0), advance by 2; AND 0xFF → x_count (unsigned byte)
  const loc_neg8 = rd16(state, rom, ptrAbs) & 0xff; // byte[1]
  const ptrAbs2  = (ptrAbs + 2) >>> 0;

  // Leggi byte[2] = y_base (signed)
  const byte2    = rd8(state, rom, ptrAbs2);
  const loc_neg4_init = ((byte2 & 0xff) << 24) >> 24; // signed int8 → int32

  // Leggi word at ptrAbs+2, advance 2; AND 0xFF → y_count (unsigned byte)
  const loc_neg6_init = rd16(state, rom, ptrAbs2) & 0xff; // byte[3]
  const ptrAbs4  = (ptrAbs2 + 2) >>> 0;

  // btst.l #2, sign_ext32(loc_neg6_init) + sign_ext32(loc_neg4_init)
  const sumYX = (loc_neg6_init + loc_neg4_init) | 0;
  if ((sumYX & 0x4) !== 0) {
    a4 |= 2;
  }

  // Adjust:
  // local[-4] += local[-2] - 1
  // local[-6] += local[-8] - 1
  let loc_neg4 = ((loc_neg4_init + loc_neg2 - 1) << 16) >> 16; // keep as word
  let loc_neg6 = ((loc_neg6_init + loc_neg8 - 1) << 16) >> 16;

  // Leggi flags_word = word at ptrAbs+4
  const flags_word = rd16(state, rom, ptrAbs4); // byte[4..5]
  const ptrAbs6    = (ptrAbs4 + 2) >>> 0;
  // btst.b #1, low byte of flags_word (byte[5]).
  if ((flags_word & 0x0002) !== 0) {
    const bits = ((flags_word & 0xc) + 0x10) & 0xffff;
    a4 = (a4 | bits) & 0xffff;
  }

  // Leggi byte[6] = extra flags (read as byte, sign-extend to word)
  const byte6 = rd8(state, rom, ptrAbs6);
  let d1 = ((byte6 & 0xff) << 24) >> 24; // signed int8 → int32

  // btst.l #7, D1
  if ((d1 & 0x80) !== 0) {
    a4 |= 0x80;
  }
  a4 = (a4 | (d1 & 0x60)) & 0xffff;

  // ── Early exit se flag == 0 ───────────────────────────────────────────────
  if (flag === 0) {
    // move.w A4w, D0w; ext.l D0 → return sign-ext(A4 low word) as int32
    slapsticEvent2BC5C(rom, a4);
    return ((a4 & 0xffff) << 16) >> 16;
  }

  // ── Lettura sub-index + lookup_byte ──────────────────────────────────────

  d1 &= 0x1f; // sub-index nella pointer-table (5 bit)

  // Leggi word at ptrAbs+6; AND 0xFF → D3 = byte[7]
  const d3_raw = rd16(state, rom, ptrAbs6) & 0xff;

  // ── Pointer-table dereference ─────────────────────────────────────────────
  // A0 = d1 * 4
  // A1 = *(0x400474)   [long in workRam]
  // A0 += *(A1+0x20)   [long dereference]
  // A2 = *(A0)         [long: data ptr]
  const tableRoot = rd32(state, rom, PTR_TABLE_ROOT);
  const tableBase = rd32(state, rom, (tableRoot + 0x20) >>> 0);
  const entryAddr = (tableBase + (d1 << 2)) >>> 0;
  const a2Init    = rd32(state, rom, entryAddr) >>> 0;
  let   a2        = a2Init;

  // ── Direction table ────────────────────────────────────────────────────────
  const subMode = d3_raw & 0x8;  // local[-a] = D3 & 8
  const dirIdx  = d3_raw & 0x7;  // D3 &= 7
  // ROM @0x1ECEA, 8 pairs × 4 byte each
  const dirOff  = DIR_TABLE_ROM + dirIdx * 4;
  const dx      = (rd16(state, rom, dirOff    ) << 16) >> 16; // signed word
  const dy      = (rd16(state, rom, dirOff + 2) << 16) >> 16;

  // ── Setup iteration bounds ─────────────────────────────────────────────────
  // local[-12] = dx, local[-14] = dy
  // if dx < 0:  outer_start = loc_neg4 (y), outer_end = loc_neg2 - 1
  // else:       outer_start = loc_neg2 (y), outer_end = loc_neg4 + 1

  let outerStart: number;
  let outerEnd:   number;
  if (dx < 0) {
    outerStart = loc_neg4 & 0xffff;
    outerEnd   = ((loc_neg2 - 1) << 16 >> 16) & 0xffff;
  } else {
    outerStart = loc_neg2 & 0xffff;
    outerEnd   = ((loc_neg4 + 1) << 16 >> 16) & 0xffff;
  }

  // if dy < 0:  inner_start = loc_neg6 (x), inner_end = loc_neg8 - 1
  // else:       inner_start = loc_neg8 (x), inner_end = loc_neg6 + 1
  let innerStart: number;
  let innerEnd:   number;
  if (dy < 0) {
    innerStart = loc_neg6 & 0xffff;
    innerEnd   = ((loc_neg8 - 1) << 16 >> 16) & 0xffff;
  } else {
    innerStart = loc_neg8 & 0xffff;
    innerEnd   = ((loc_neg6 + 1) << 16 >> 16) & 0xffff;
  }

  // Snap signed-word values to JS numbers for comparison
  const loc_neg2w = (loc_neg2 << 16) >> 16;
  const loc_neg4w = (loc_neg4 << 16) >> 16;
  const loc_neg6w = (loc_neg6 << 16) >> 16;
  const loc_neg8w = (loc_neg8 << 16) >> 16;

  // ── D3 < 4 → "row-major" (outer = row A3, inner = col D6)
  // ── D3 >= 4 → "column-major" (outer = col A3, inner = row D6)
  const rowMajor = dirIdx < 4;

  // ── Outer/inner loop ──────────────────────────────────────────────────────
  // Row-major:
  //   outer var = A3 (a3_row), starts at outerStart, ends when A3 == outerEnd
  //   inner var = D6 (d6_col), starts at innerStart, ends when D6 == innerEnd
  //   step: A3 += dx (local[-12]), D6 += dy (local[-14])
  //
  // Column-major:
  //   outer var = A3 (a3_col), same structure but swapped semantics
  //   inner var = D6 (d6_row)

  // Safety cap
  const OUTER_MAX = 512;
  const INNER_MAX = 512;

  if (rowMajor) {
    // ── Row-major path @ 0x1AED4-0x1AFF5 ──────────────────────────────────
    let d6 = innerStart & 0xffff;
    // Jump to outer loop check: cmp.w inner_end, D6; beq → exit outer
    let outerIter = 0;
    while (outerIter++ < OUTER_MAX) {
      // Outer loop check: cmp.w (-0x10,A6),D6w; beq → exit
      if ((d6 & 0xffff) === (innerEnd & 0xffff)) break;

      // movea.w (-0x18,A6),A3 → a3 = outerStart
      let a3 = outerStart & 0xffff;
      // Jump to inner loop check
      let innerIter = 0;
      while (innerIter++ < INNER_MAX) {
        // Inner loop check: cmpa.w (-0xe,A6),A3; bne → body
        if ((a3 & 0xffff) === (outerEnd & 0xffff)) break;

        // ── Inner body @ 0x1AEE4 ──────────────────────────────────────────
        // A1 = D6 + A3 - D5 (all 16-bit signed arithmetic)
        const a1_raw = (d6 + a3 - d5) & 0xffff;
        const a1_s   = (a1_raw << 16) >> 16; // signed

        // clip: A1 < 0 → skip; A1 >= limit → skip
        if (a1_s < 0 || a1_raw >= limit) {
          // goto post-write (add A2 etc.)
        } else {
          // A0 = A1 >> 1 (signed) + (D4 - A3)
          const a0_raw = ((a1_s >> 1) + ((d4 - a3) & 0xffff)) & 0xffff;
          const a0_s   = (a0_raw << 16) >> 16;

          if (a0_s >= 0) {
            const d2 = a0_raw & 0xffff;
            // D0 = 0x16 - (A1 & 1)
            const d0 = 0x16 - (a1_raw & 1);
            if (d2 < d0) {
              // cellAddr = (A1 * 0x16 + A0) * 8 + 0x400A9C
              const cellIdx = (a1_raw * 0x16 + a0_raw) >>> 0;
              const cellBase = (CELL_BUF_ABS + cellIdx * 8) >>> 0;

              // Compute D1 (value to write)
              const a2byte = (rd8(state, rom, a2) & 0xff);
              const a2byteS = (a2byte << 24) >> 24; // sign-extend
              let   d1w: number;
              if (subMode !== 0) {
                // local[-a] != 0: D1 = local[-c] - (signed)*A2
                d1w = ((flags_word & 0xffff) - a2byteS) & 0xffff;
              } else {
                // local[-a] == 0: D1 = (signed)*A2 + local[-c]
                d1w = (a2byteS + (flags_word & 0xffff)) & 0xffff;
              }

              // Write dispatch — row-major
              writeDispatch(state, cellBase, d1w, a3, d6,
                loc_neg2w, loc_neg4w, loc_neg6w, loc_neg8w);
            }
          }
        }

        // ── Post-write @ 0x1AFC8 ─────────────────────────────────────────
        a2 = (a2 + 1) >>> 0;
        const a2byte = rd8(state, rom, a2) & 0xff;
        if (a2byte === 0x80) {
          a2 = a2Init;
        }

        // adda.w (-0x12,A6),A3 → A3 += dx
        a3 = ((a3 + dx) << 16 >> 16) & 0xffff;
      }

      // add.w (-0x14,A6),D6w → D6 += dy
      d6 = ((d6 + dy) << 16 >> 16) & 0xffff;
    }
  } else {
    // ── Column-major path @ 0x1AFF6-0x1B113 ──────────────────────────────
    let a3 = outerStart & 0xffff;
    let outerIter = 0;
    while (outerIter++ < OUTER_MAX) {
      // Outer check: cmpa.w (-0xe,A6),A3; bne → body
      if ((a3 & 0xffff) === (outerEnd & 0xffff)) break;

      let d6 = innerStart & 0xffff;
      let innerIter = 0;
      while (innerIter++ < INNER_MAX) {
        // Inner check: cmp.w (-0x10,A6),D6w; bne → body
        if ((d6 & 0xffff) === (innerEnd & 0xffff)) break;

        // ── Inner body @ 0x1B006 ─────────────────────────────────────────
        const a1_raw = (d6 + a3 - d5) & 0xffff;
        const a1_s   = (a1_raw << 16) >> 16;

        if (a1_s < 0 || a1_raw >= limit) {
          // skip, fall through to post-write
        } else {
          const a0_raw = ((a1_s >> 1) + ((d4 - a3) & 0xffff)) & 0xffff;
          const a0_s   = (a0_raw << 16) >> 16;

          if (a0_s >= 0) {
            const d2 = a0_raw & 0xffff;
            const d0 = 0x16 - (a1_raw & 1);
            if (d2 < d0) {
              const cellIdx  = (a1_raw * 0x16 + a0_raw) >>> 0;
              const cellBase = (CELL_BUF_ABS + cellIdx * 8) >>> 0;

              const a2byte  = (rd8(state, rom, a2) & 0xff);
              const a2byteS = (a2byte << 24) >> 24;
              let d1w: number;
              if (subMode !== 0) {
                d1w = ((flags_word & 0xffff) - a2byteS) & 0xffff;
              } else {
                d1w = (a2byteS + (flags_word & 0xffff)) & 0xffff;
              }

              writeDispatch(state, cellBase, d1w, a3, d6,
                loc_neg2w, loc_neg4w, loc_neg6w, loc_neg8w);
            }
          }
        }

        // ── Post-write @ 0x1B0EA ─────────────────────────────────────────
        a2 = (a2 + 1) >>> 0;
        const a2byte = rd8(state, rom, a2) & 0xff;
        if (a2byte === 0x80) {
          a2 = a2Init;
        }

        // add.w (-0x14,A6),D6w → D6 += dy
        d6 = ((d6 + dy) << 16 >> 16) & 0xffff;
      }

      // adda.w (-0x12,A6),A3 → A3 += dx
      a3 = ((a3 + dx) << 16 >> 16) & 0xffff;
    }
  }

  // ── Exit @ 0x1B114 ────────────────────────────────────────────────────────
  // jsr 0x2bc5c (side-effect call on A4); return D0 = sign-ext(A4.w)
  slapsticEvent2BC5C(rom, a4);
  return ((a4 & 0xffff) << 16) >> 16;
}

// ─── Write dispatch ──────────────────────────────────────────────────────────

/**
 * Scrive `value` in 1..4 slot (word) nella cella `cellBase` in base alla
 * posizione (a3, d6) rispetto ai bordi del rettangolo.
 *
 * Corrisponde alle sequenze 0x1AF5A-0x1AFC6 (row-major) e
 * 0x1B07C-0x1B0E8 (column-major) che sono identiche strutturalmente.
 *
 * Legenda offsets dentro la cella da 8 byte:
 *   +0, +2, +4, +6 (word offsets)
 *
 * - prima riga (a3 == first_row), prima col (d6 == first_col):   write +4
 * - prima riga, ultima col (d6 == last_col):                     write +6
 * - prima riga, col media:                                       write +4, +6
 * - ultima riga (a3 == last_row), prima col:                     write +2
 * - ultima riga, ultima col:                                     write +0
 * - ultima riga, col media:                                      write +0, +2
 * - riga media, prima col:                                       write +2, +4
 * - riga media, ultima col:                                      write +0, +6
 * - riga media, col media:                                       write +0, +2, +4, +6
 */
function writeDispatch(
  state: GameState,
  cellBase: number,
  value: number,
  a3: number,
  d6: number,
  first_row: number,
  last_row:  number,
  last_col:  number,
  first_col: number,
): void {
  const a3w = (a3 << 16) >> 16;
  const d6w = (d6 << 16) >> 16;
  const frw = (first_row << 16) >> 16;
  const lrw = (last_row  << 16) >> 16;
  const lcw = (last_col  << 16) >> 16;
  const fcw = (first_col << 16) >> 16;

  if (a3w === frw) {
    // First row
    if (d6w === fcw) {
      wr16(state, (cellBase + 4) >>> 0, value);
    } else if (d6w === lcw) {
      wr16(state, (cellBase + 6) >>> 0, value);
    } else {
      wr16(state, (cellBase + 4) >>> 0, value);
      wr16(state, (cellBase + 6) >>> 0, value);
    }
  } else if (a3w === lrw) {
    // Last row
    if (d6w === fcw) {
      wr16(state, (cellBase + 2) >>> 0, value);
    } else if (d6w === lcw) {
      wr16(state, (cellBase + 0) >>> 0, value);
    } else {
      wr16(state, (cellBase + 0) >>> 0, value);
      wr16(state, (cellBase + 2) >>> 0, value);
    }
  } else {
    // Middle row
    if (d6w === fcw) {
      wr16(state, (cellBase + 2) >>> 0, value);
      wr16(state, (cellBase + 4) >>> 0, value);
    } else if (d6w === lcw) {
      wr16(state, (cellBase + 0) >>> 0, value);
      wr16(state, (cellBase + 6) >>> 0, value);
    } else {
      wr16(state, (cellBase + 0) >>> 0, value);
      wr16(state, (cellBase + 2) >>> 0, value);
      wr16(state, (cellBase + 4) >>> 0, value);
      wr16(state, (cellBase + 6) >>> 0, value);
    }
  }
}
