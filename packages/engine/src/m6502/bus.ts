/**
 * 6502 bus interface: 8-bit data, 16-bit address.
 *
 * The CPU core only issues `read8`/`write8`; 16-bit reads are two bus reads.
 * The sound MMU maps RAM, YM2151, mailbox/status, POKEY, and ROM. Tom Harte
 * tests use a transparent RAM-mapped bus, while the real sound MMU keeps MMIO
 * side effects such as ack-on-read mailbox clears outside the CPU core.
 */

import type { u8, u16 } from "../wrap.js";

export interface MemBus6502 {
  read8(addr: u16): u8;
  write8(addr: u16, value: u8): void;
}
