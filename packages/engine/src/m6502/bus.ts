/**
 * bus.ts — Interface bus 6502 (8-bit data, 16-bit address).
 *
 * Il 6502 ha solo read8/write8 (no fetch16 nativo: le letture 16-bit sono
 * sequenze di 2 read8). L'implementazione concreta (`sound-mmu.ts` in
 * Phase 4) mappa $0000-$0FFF RAM, $1800-$1801 YM2151, $1810 mailbox, $1820
 * status, $1870-$187F POKEY, $4000-$FFFF ROM. Per Tom Harte test bus =
 * `Map<u16, u8>`.
 *
 * Side effect awareness: le read e write su MMIO sono observable (es. read
 * di $1810 ack-on-read clear del NMI pending). I test Tom Harte usano bus
 * "trasparente" RAM-mapped, quindi non triggherano side effects. La CPU
 * core non deve conoscere semantica MMIO, solo bus access.
 */

import type { u8, u16 } from "../wrap.js";

export interface MemBus6502 {
  read8(addr: u16): u8;
  write8(addr: u16, value: u8): void;
}
