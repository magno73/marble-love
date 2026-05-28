/**
 * slapstic-lookup.ts - replica `FUN_0002FFB8` (32 byte): IRQ-safe lookup in
 * Slapstic-protected ROM.
 *
 * Callers such as FUN_16EC6, FUN_16F6C, FUN_1A444, and FUN_1ACE0 pass a long
 * argument whose low word indexes a `move.w` read from protected ROM
 * `0x080000-0x087FFF`.
 *
 *
 *   move    SR,D1w                        ; save interrupt mask
 *   move.w  (0x080000).l, D0w             ; "trigger" slapstic (low word di D0
 *   move.w  (0x6,SP), D0w                 ; D0w = arg word (caller pushed
 *                                         ;  a long ext.l from word)
 *   asl.l   #0x5, D0                      ; D0 (long) <<= 5; low-word index
 *   move.w  (0x0,A0,D0w*0x1), D0w         ; D0w = readWord(A0 + signExt16(D0w))
 *   move    D1w,SR                        ; restore IRQ mask
 *
 * (`0x80080..0x800E0`).
 *
 * **Slapstic & side effects**:
 *
 *
 * **Return value**: low word of D0 (D0w). High bits of D0 remain dirty after
 * `asl.l`; callers use the low word.
 *
 * (500/500 cases).
 */

import type { RomImage } from "./bus.js";
import { slapsticTick, type SlapsticFsm } from "./m68k/slapstic-103.js";
import { applySlapsticBank } from "./m68k/apply-slapstic-bank.js";

export const SLAPSTIC_LOOKUP_BASE = 0x080080 as const;

export const SLAPSTIC_TRIGGER_ADDR = 0x080000 as const;

type SlapsticRuntimeRom = {
  slapsticBanks?: Uint8Array;
  slapsticFsm?: SlapsticFsm;
};

const loadedSlapsticBankSets = new WeakSet<Uint8Array>();

function hasLoadedSlapsticBanks(rom: RomImage): rom is RomImage & Required<SlapsticRuntimeRom> {
  const banks = (rom as SlapsticRuntimeRom).slapsticBanks;
  const fsm = (rom as SlapsticRuntimeRom).slapsticFsm;
  if (banks === undefined || fsm === undefined) return false;
  if (loadedSlapsticBankSets.has(banks)) return true;

  for (let i = 0; i < banks.length; i += 1) {
    if ((banks[i] ?? 0) !== 0) {
      loadedSlapsticBankSets.add(banks);
      return true;
    }
  }
  return false;
}

/**
 * Replica `FUN_0002FFB8` - IRQ-safe lookup in Slapstic ROM.
 *
 * Reads a big-endian word from `0x80080 + idx` in the ROM blob.
 *
 * Accesses are modeled as flat reads from the ROM image:
 *   - `rom.program[address]` for offsets `0x080000..0x087FFF` (Slapstic bank 0)
 *   - address < `0x080000` falls back to main program ROM
 *
 * @param rom    RomImage, the only external dependency.
 * @param argW   Caller argument word; the routine overwrites D0w from `(0x6,SP)`.
 */
export function slapsticLookup(rom: RomImage, argW: number): number {
  const arg = argW & 0xffff;

  // asl.l #5 on the low word produces (arg << 5) & 0xFFFF; sign-extend to the
  // i32 displacement used by `(0x0, A0, D0w*1)`.
  const shifted = (arg << 5) & 0xffff;
  const idx = (shifted << 16) >> 16; // signExt16 to i32.

  // EA = 0x80080 + idx, computed as unsigned 32-bit with 68K-style wrap.
  const addr = (SLAPSTIC_LOOKUP_BASE + idx) >>> 0;

  // Synthetic fixtures write directly into `program[0x80000..]`, so only apply
  // Slapstic banking when a loaded bank set is present.
  if (hasLoadedSlapsticBanks(rom)) {
    const prevBank = rom.slapsticFsm.bank;
    slapsticTick(rom.slapsticFsm, SLAPSTIC_TRIGGER_ADDR);
    slapsticTick(rom.slapsticFsm, addr);
    if (rom.slapsticFsm.bank !== prevBank) {
      applySlapsticBank(rom, rom.slapsticFsm.bank);
    }
  }

  return readRomWordBE(rom, addr);
}

/**
 * Flat big-endian ROM word read.
 */
function readRomWordBE(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  // Slapstic area (0x80000..0x87FFF) is treated as bank 0. Address >= 0x88000 -> 0.
  if (a >= rom.program.length - 1) {
    if (a >= rom.program.length) return 0;
    return ((rom.program[a] ?? 0) << 8) & 0xffff;
  }
  const hi = rom.program[a] ?? 0;
  const lo = rom.program[a + 1] ?? 0;
  return ((hi << 8) | lo) & 0xffff;
}
