/**
 *
 * Le 4 palette anim (FUN_26BEE, FUN_26C78, FUN_26D4E, FUN_26B88) condividono
 * the same loop structure but differ in:
 *   - lookup tables in ROM (per type==0 and type!=0)
 *   - destination addresses in palette RAM (per type==0 and type!=0)
 *   - asr shift (div 2 o div 4 per indice)
 *   - wrap value (signed > N → reset to 0)
 *
 *
 * `cli/src/test-palette-anim-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Constants common ────────────────────────────────────────────────────

export const OBJ_BASE_ADDR = 0x400018 as const;
export const OBJ_STRIDE = 0xe2 as const;
export const OBJ_COUNT_ADDR = 0x400396 as const;
export const OBJ_FIELD_TYPE = 0x19 as const;
export const OBJ_FIELD_SKIP = 0xd8 as const;
export const PAL_RAM_BASE = 0xb00000 as const;

const ANIM_COUNTER_DISABLED = 0xff as const;

// Backwards-compat label (anim 1 uses offset 0x70).
export const OBJ_FIELD_ANIM = 0x70 as const;

// Parameters for each palette animation.

export interface PaletteAnimParams {
  ctrOffset: number;
  /** Lookup table per type == 0 (in ROM program). */
  tableTypeZero: number;
  /** Lookup table per type != 0. */
  tableTypeNonZero: number;
  /** Palette destination per type == 0 (offset assoluto 68010). */
  palDestTypeZero: number;
  /** Palette destination per type != 0. */
  palDestTypeNonZero: number;
  asrShift: number;
  wrapMax: number;
  /** If true, also checks `field_0xD8` (skip flag) — only anim 1 does this. */
  checkSkipFlag: boolean;
}

/** FUN_00026BEE — anim 1 (counter +0x70, tables 0x20B34/0x20B54). */
export const ANIM1_PARAMS: PaletteAnimParams = {
  ctrOffset: 0x70,
  tableTypeZero: 0x20b34,
  tableTypeNonZero: 0x20b54,
  palDestTypeZero: 0xb00006,
  palDestTypeNonZero: 0xb0000e,
  asrShift: 2,
  wrapMax: 0x3f,
  checkSkipFlag: true,  // only anim that checks the skip flag
};

/** FUN_00026C78 — anim 2 (counter +0x71, tables 0x20B74/0x20B94). */
export const ANIM2_PARAMS: PaletteAnimParams = {
  ctrOffset: 0x71,
  tableTypeZero: 0x20b74,
  tableTypeNonZero: 0x20b94,
  palDestTypeZero: 0xb00016,
  palDestTypeNonZero: 0xb0001e,
  asrShift: 1,
  wrapMax: 0x1f,
  checkSkipFlag: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function romReadU16BE(rom: RomImage, offset: number): number {
  return (((rom.program[offset] ?? 0) << 8) | (rom.program[offset + 1] ?? 0)) & 0xffff;
}

function workRamReadU16BE(state: GameState, offset: number): number {
  return (((state.workRam[offset] ?? 0) << 8) | (state.workRam[offset + 1] ?? 0)) & 0xffff;
}

function colorRamWriteU16BE(state: GameState, offset: number, value: number): void {
  state.colorRam[offset] = (value >>> 8) & 0xff;
  state.colorRam[offset + 1] = value & 0xff;
}

function sext8_i32(byte: number): number {
  return ((byte & 0xff) << 24) >> 24;
}

// ─── Generic tick ─────────────────────────────────────────────────────────

/**
 * Esegue una palette animation parametrica. Replica:
 *   for i in 0..count-1:
 *     if obj[i].ctr == 0xFF or obj[i].skip != 0: continue
 *     table = (obj[i].type != 0) ? params.tableA : params.tableB
 *     palDest = (obj[i].type != 0) ? params.palDestA : params.palDestB
 *     idx = (sext_i32(obj[i].ctr) >> asrShift) * 2
 *     palette[palDest] = rom[table + idx]   (u16 BE)
 *     obj[i].ctr += 1
 *     if signed(obj[i].ctr) > wrapMax: obj[i].ctr = 0
 */
export function paletteAnimTick(
  state: GameState,
  rom: RomImage,
  params: PaletteAnimParams,
): void {
  const count = workRamReadU16BE(state, OBJ_COUNT_ADDR - 0x400000);

  for (let i = 0; i < 256; i++) {
    const i_signed_w = sext8_i32(i) & 0xffff;
    if (i_signed_w === count) return;

    const objBase = (OBJ_BASE_ADDR - 0x400000) + i * OBJ_STRIDE;
    const animCtr = state.workRam[objBase + params.ctrOffset] ?? 0;

    if (animCtr === ANIM_COUNTER_DISABLED) continue;
    if (params.checkSkipFlag) {
      const skipFlag = state.workRam[objBase + OBJ_FIELD_SKIP] ?? 0;
      if (skipFlag !== 0) continue;
    }

    const objType = state.workRam[objBase + OBJ_FIELD_TYPE] ?? 0;
    const tableRom = objType !== 0 ? params.tableTypeNonZero : params.tableTypeZero;
    const palDest = objType !== 0 ? params.palDestTypeNonZero : params.palDestTypeZero;

    const idxSigned = sext8_i32(animCtr) >> params.asrShift;
    const tableAddr = (tableRom + idxSigned * 2) >>> 0;
    const palWord = romReadU16BE(rom, tableAddr);

    const palOffset = palDest - PAL_RAM_BASE;
    colorRamWriteU16BE(state, palOffset, palWord);

    let newCtr = ((animCtr & 0xff) + 1) & 0xff;
    // ble skip; clr.b ctr` → 64..127 (signed pos > wrapMax) reset, but
    // 128..255 (signed neg) NO.
    const signedCtr = (newCtr & 0x80) !== 0 ? newCtr - 0x100 : newCtr;
    if (signedCtr > params.wrapMax) {
      newCtr = 0;
    }
    state.workRam[objBase + params.ctrOffset] = newCtr;
  }
}

// ─── Convenience wrappers (back-compat) ───────────────────────────────────

/** FUN_00026BEE — palette animation 1. */
export function paletteAnim1Tick(state: GameState, rom: RomImage): void {
  paletteAnimTick(state, rom, ANIM1_PARAMS);
}

/** FUN_00026C78 — palette animation 2. */
export function paletteAnim2Tick(state: GameState, rom: RomImage): void {
  paletteAnimTick(state, rom, ANIM2_PARAMS);
}

// ─── Backwards-compat exports for old constants ───────────────────────────

/** @deprecated use ANIM1_PARAMS.tableTypeZero */
export const TABLE_B_ROM_OFFSET = ANIM1_PARAMS.tableTypeZero;
/** @deprecated use ANIM1_PARAMS.tableTypeNonZero */
export const TABLE_A_ROM_OFFSET = ANIM1_PARAMS.tableTypeNonZero;
/** @deprecated use ANIM1_PARAMS.palDestTypeZero */
export const PAL_DEST_B_ADDR = ANIM1_PARAMS.palDestTypeZero;
/** @deprecated use ANIM1_PARAMS.palDestTypeNonZero */
export const PAL_DEST_A_ADDR = ANIM1_PARAMS.palDestTypeNonZero;
