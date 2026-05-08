/**
 * eeprom-helper-40d8.ts — replica `FUN_000040D8` (240 byte) bit-perfect.
 *
 * Despite the historical "eeprom" label in nearby tasks, this is a config
 * field accessor over the struct pointed at by `*0x401FFC`. A ROM table at
 * `0x795A` maps keys 0..12 to packed field descriptors; key 13 returns the
 * sign-extended ROM byte at `0x1006F`.
 *
 * Descriptor byte 0:
 *   - bits 0..4: base offset from `*0x401FFC`
 *   - bit 7: read a big-endian word at offset
 *   - bit 6: read 12 bits as `(byte[offset] << 4) | (byte[offset + 1] >> 4)`
 *   - bit 5: read 12 bits as `((byte[offset] & 0x0F) << 8) | byte[offset + 1]`
 *
 * Descriptor byte 1:
 *   - if `< 0x40`, append byte at `*0x401FFC + 0x14 + descriptor1`:
 *     `value = (value << 8) | appendedByte`
 *   - if `>= 0x40`, no append
 *
 * Key 11 has one final adjustment: `value >>= 8`.
 *
 * Side effects: none. The function only reads work RAM and one ROM byte param.
 * JSRs: none.
 */

import type { GameState } from "./state.js";

const WORK_RAM_BASE = 0x400000;
const WORK_RAM_END = 0x402000;
const PTR_FFC_OFF = 0x1ffc;
const APPEND_BASE_PLUS = 0x14;
const MAX_KEY = 0x0d;
const KEY_ROM_MAX_RECORDS = 0x0d;
const KEY_DROP_LOW_BYTE = 0x0b;

/** ROM address of the special key-13 byte (`move.b (0x1006F).l,D0b`). */
export const ROM_MAX_RECORDS_ADDR = 0x0001006f as const;

/** Marble program byte at `ROM_MAX_RECORDS_ADDR`; callers may override it. */
export const DEFAULT_ROM_MAX_RECORDS_BYTE = 0xe3 as const;

/** Return code for keys greater than 13 (`moveq #-1,D0`). */
export const RET_KEY_OUT_OF_RANGE = 0xffffffff as const;

/** Packed descriptor table copied from ROM `0x795A..0x7975`. */
export const EEPROM_HELPER_40D8_TABLE = Object.freeze([
  [0x00, 0x00],
  [0x01, 0x01],
  [0x02, 0x02],
  [0x43, 0x03],
  [0x24, 0x04],
  [0x46, 0x05],
  [0x27, 0x06],
  [0x0e, 0x07],
  [0x0f, 0x08],
  [0x10, 0x09],
  [0x91, 0x40],
  [0x8a, 0x40],
  [0x8c, 0x40],
  [0x0a, 0x0f],
] as const);

function readLongBE(ram: Uint8Array, off: number): number {
  return (
    (((ram[off] ?? 0) << 24) |
      ((ram[off + 1] ?? 0) << 16) |
      ((ram[off + 2] ?? 0) << 8) |
      (ram[off + 3] ?? 0)) >>>
    0
  );
}

function read8(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (state.workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

function signExtendByteToLong(byte: number): number {
  const b = byte & 0xff;
  return (b & 0x80 ? b | 0xffffff00 : b) >>> 0;
}

/**
 * Replica bit-perfect di `FUN_000040D8`.
 *
 * @param state                GameState; reads `*0x401FFC` and bytes relative
 *                             to that pointer.
 * @param key                  Long key from the stack. Valid unsigned range is
 *                             `0..13`; larger values return `0xFFFFFFFF`.
 * @param romMaxRecordsByte    Raw ROM byte at `0x1006F`, used only by key 13.
 *                             Defaults to the Marble Madness program byte.
 * @returns                    D0 long unsigned 32-bit.
 */
export function eepromHelper40D8(
  state: GameState,
  key: number,
  romMaxRecordsByte: number = DEFAULT_ROM_MAX_RECORDS_BYTE,
): number {
  const keyLong = key >>> 0;
  const structPtr = readLongBE(state.workRam, PTR_FFC_OFF);

  if (keyLong === KEY_ROM_MAX_RECORDS) {
    return signExtendByteToLong(romMaxRecordsByte);
  }

  if (keyLong > MAX_KEY) {
    return RET_KEY_OUT_OF_RANGE;
  }

  const [descriptor, appendIndex] = EEPROM_HELPER_40D8_TABLE[keyLong]!;
  const flags = descriptor & 0xe0;
  const fieldOff = descriptor & 0x1f;
  const fieldAddr = (structPtr + fieldOff) >>> 0;

  let value = read8(state, fieldAddr);

  if ((flags & 0x80) !== 0) {
    value = (((value << 8) >>> 0) + read8(state, (fieldAddr + 1) >>> 0)) >>> 0;
  } else if ((flags & 0x40) !== 0) {
    value = (((value << 4) >>> 0) + (read8(state, (fieldAddr + 1) >>> 0) >>> 4)) >>> 0;
  } else if ((flags & 0x20) !== 0) {
    value = (((value & 0x0f) << 8) + read8(state, (fieldAddr + 1) >>> 0)) >>> 0;
  }

  if (appendIndex < 0x40) {
    const appendAddr = (structPtr + APPEND_BASE_PLUS + appendIndex) >>> 0;
    value = (((value << 8) >>> 0) + read8(state, appendAddr)) >>> 0;
  }

  if (keyLong === KEY_DROP_LOW_BYTE) {
    value >>>= 8;
  }

  return value >>> 0;
}
