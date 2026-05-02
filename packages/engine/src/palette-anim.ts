/**
 * palette-anim.ts — replica del primo sotto-update di MainUpdate (Phase 4d).
 *
 * Funzione binaria: `FUN_00026BEE` (vedi `docs/static-overview.md`).
 *
 * Cosa fa: per ogni game object attivo (slot 0..count-1 nell'array @ 0x400018),
 * legge l'animation counter (offset 0x70), indicizza in una di due lookup
 * tables in ROM (0x20B34 o 0x20B54) basandosi sul "type" dell'oggetto
 * (offset 0x19), e scrive la word ottenuta in una di due palette entries
 * dell'alpha palette (entry 3 @ 0xB00006 o entry 7 @ 0xB0000E).
 *
 * Effetto visibile: alcuni colori dell'alpha overlay (HUD/score) lampeggiano
 * o ciclano in funzione degli oggetti attivi nel gioco.
 *
 * **Verificato bit-perfect** vs `FUN_00026BEE` via differential testing
 * (vedi `packages/cli/src/test-palette-anim-parity.ts`).
 *
 * Disassembly originale (commentato):
 * ```
 *   A1 = 0x400018; D1 = 0;
 *   while (D1 != count_at_0x400396) {
 *     if (obj[D1].field_0x70 == 0xFF) skip;   // disabled
 *     if (obj[D1].field_0xD8 != 0)    skip;    // skip flag
 *     if (obj[D1].field_0x19 != 0) {
 *       table = 0x20B54; pal_dest = 0xB0000E;
 *     } else {
 *       table = 0x20B34; pal_dest = 0xB00006;
 *     }
 *     idx = sext_i32(obj[D1].field_0x70) >> 2;  // arithmetic right shift
 *     pal_word = read_u16_BE(rom[table + idx*2]);
 *     write_u16_BE(colorRam[pal_dest - 0xB00000], pal_word);
 *     obj[D1].field_0x70 += 1;
 *     if (obj[D1].field_0x70 > 0x3F) obj[D1].field_0x70 = 0;
 *     skip: D1 += 1; A1 += 0xE2;
 *   }
 * ```
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Constants (verificate dal disassembly Phase 4d) ──────────────────────

/** Offset assoluto del game object array (in workRam). */
export const OBJ_BASE_ADDR = 0x400018 as const;
/** Stride per game object (Phase 2). */
export const OBJ_STRIDE = 0xe2 as const; // 226 byte
/** Offset del count u16 in Work RAM. */
export const OBJ_COUNT_ADDR = 0x400396 as const;

export const OBJ_FIELD_TYPE = 0x19 as const;     // u8: palette select
export const OBJ_FIELD_ANIM = 0x70 as const;     // u8: animation counter
export const OBJ_FIELD_SKIP = 0xd8 as const;     // u8: skip flag

/** Lookup tables in cartridge program ROM. */
export const TABLE_A_ROM_OFFSET = 0x20b54 as const; // type != 0
export const TABLE_B_ROM_OFFSET = 0x20b34 as const; // type == 0

/** Destinazione palette (offset assoluto del 68010, sottrai PAL_RAM_BASE per indicizzare colorRam). */
export const PAL_DEST_A_ADDR = 0xb0000e as const; // alpha entry 7
export const PAL_DEST_B_ADDR = 0xb00006 as const; // alpha entry 3
export const PAL_RAM_BASE = 0xb00000 as const;

const ANIM_COUNTER_MAX = 0x3f as const;
const ANIM_COUNTER_DISABLED = 0xff as const;

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Read u16 big-endian dalla ROM (program). */
function romReadU16BE(rom: RomImage, offset: number): number {
  return (((rom.program[offset] ?? 0) << 8) | (rom.program[offset + 1] ?? 0)) & 0xffff;
}

/** Read u16 big-endian dalla Work RAM. */
function workRamReadU16BE(state: GameState, offset: number): number {
  return (((state.workRam[offset] ?? 0) << 8) | (state.workRam[offset + 1] ?? 0)) & 0xffff;
}

/** Write u16 big-endian alla colorRam (palette). */
function colorRamWriteU16BE(state: GameState, offset: number, value: number): void {
  state.colorRam[offset] = (value >>> 8) & 0xff;
  state.colorRam[offset + 1] = value & 0xff;
}

/**
 * Arithmetic right shift su 32 bit (preserva il segno). 68010 `asr.l #2`.
 */
function asr_i32(value: number, shift: number): number {
  return value >> shift; // JS >> è arithmetic per int32
}

/** Sign-extend u8 → i32. */
function sext8_i32(byte: number): number {
  return ((byte & 0xff) << 24) >> 24;
}

// ─── Main tick ────────────────────────────────────────────────────────────

/**
 * Esegue un tick di palette animation 1 (FUN_00026BEE).
 *
 * Side effects:
 *   - state.workRam[obj_base + i*stride + 0x70]++ (con wrap a 0)
 *   - state.colorRam[0x06] o [0x0E] aggiornato
 *
 * Pure function: nessuna I/O, nessun random, deterministica. Bit-perfect
 * vs il binario.
 */
export function paletteAnim1Tick(state: GameState, rom: RomImage): void {
  // Count è un u16 BE in Work RAM @ 0x400396 (= workRam[0x396]).
  const count = workRamReadU16BE(state, OBJ_COUNT_ADDR - 0x400000);

  // Loop counter è byte: il binario incrementa D1.b. Per count > 127 il
  // sext.b → i16 wrappa; mantengo lo stesso comportamento.
  for (let i = 0; i < 256; i++) {
    const i_signed_w = sext8_i32(i) & 0xffff; // ext.w D0w from D0.b sign-extended
    if (i_signed_w !== count) {
      // Process object i
      const objBase = (OBJ_BASE_ADDR - 0x400000) + i * OBJ_STRIDE;

      const animCtr = state.workRam[objBase + OBJ_FIELD_ANIM] ?? 0;
      const skipFlag = state.workRam[objBase + OBJ_FIELD_SKIP] ?? 0;

      if (animCtr !== ANIM_COUNTER_DISABLED && skipFlag === 0) {
        const objType = state.workRam[objBase + OBJ_FIELD_TYPE] ?? 0;

        const tableRom = objType !== 0 ? TABLE_A_ROM_OFFSET : TABLE_B_ROM_OFFSET;
        const palDest = objType !== 0 ? PAL_DEST_A_ADDR : PAL_DEST_B_ADDR;

        // idx = (sext_i32(animCtr) >> 2) * 2  (poi + tableRom per byte addr)
        const idxSigned = asr_i32(sext8_i32(animCtr), 2);
        const tableByteOffset = idxSigned * 2;
        const tableAddr = (tableRom + tableByteOffset) >>> 0;

        // Read u16 from ROM at tableAddr
        const palWord = romReadU16BE(rom, tableAddr);

        // Write to color RAM
        const palOffset = palDest - PAL_RAM_BASE;
        colorRamWriteU16BE(state, palOffset, palWord);

        // Increment animation counter
        let newCtr = ((animCtr & 0xff) + 1) & 0xff;
        // Reset solo se SIGNED ctr > 0x3F. Il binario usa `cmpi.b #0x3F, ctr;
        // ble skip; clr.b ctr` — `ble` è signed. Quindi 64..127 (signed positive,
        // > 63) resetta a 0, ma 128..255 (signed negative, <= 63) NON resetta.
        const signedCtr = (newCtr & 0x80) !== 0 ? newCtr - 0x100 : newCtr;
        if (signedCtr > ANIM_COUNTER_MAX) {
          newCtr = 0;
        }
        state.workRam[objBase + OBJ_FIELD_ANIM] = newCtr;
      }

      // Continue iteration
    } else {
      // i == count: exit loop
      return;
    }
  }
}
