/**
 * level-helper-2ffb8.ts — semantic wrapper for `FUN_0002FFB8`.
 *
 * The binary helper is the slapstic-protected table lookup already replicated
 * as `slapsticLookup`. Level/tilemap callers use it as a setup helper and
 * ignore D0 afterwards; this wrapper gives those call sites a domain name while
 * preserving the bit-perfect implementation in one place.
 */

import type { RomImage } from "./bus.js";
import { slapsticLookup } from "./slapstic-lookup.js";

export const LEVEL_HELPER_2FFB8_ADDR = 0x0002ffb8 as const;

export function levelHelper2FFB8(rom: RomImage, argLong: number): number {
  return slapsticLookup(rom, argLong & 0xffff);
}
