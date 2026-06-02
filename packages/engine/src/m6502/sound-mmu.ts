/**
 * Atari System 1 sound-chip memory map for Marble Madness.
 *
 * Address space 64KB visto from the 6502:
 *
 *  $0000-$0FFF  RAM 4KB                                              [R/W]
 *  $1800-$1801  YM2151 register select / data                        [R/W]
 *  $1810        bidirectional mailbox:
 *                 read  = main-to-sound latch (ack pending, release NMI)
 *                 write = sound-to-main latch (set pending, assert IRQ6 to 68010)
 *  $1820        status register read:
 *                 bit 3 = sound→main pending
 *                 bit 4 = main-to-sound pending (inverse of "input ready")
 *                 other bits: coin/test switches
 *  $1820-$1827  LS259 latch (write_d0 alias). addr low bits select latch bit. [W]
 *  $1870-$187F  POKEY                                                [R/W]
 *  $4000-$FFFF  ROM 48KB (Marble uses the final 32KB as two 16KB ROMs) [R]
 *
 * Addresses outside these regions read as 0xFF and ignore writes. Mailbox pin
 * assertions are supplied through callbacks from `mailbox.ts`.
 */

import type { u8, u16 } from "../wrap.js";
import { as_u8 } from "../wrap.js";
import type { MemBus6502 } from "./bus.js";
import {
  type Mailbox8,
  mailboxRead, mailboxWrite,
} from "./mailbox.js";
import {
  type YM2151,
  createYM2151,
  ym2151WriteAddr, ym2151WriteData, ym2151ReadStatus, ym2151Reset,
} from "../audio/ym2151.js";
import {
  type POKEY,
  createPOKEY,
  pokeyWrite, pokeyRead,
} from "../audio/pokey.js";

export interface SoundMmuConfig {
  /**
   * ROM bytes mapped at $4000-$FFFF (48KB). Marble uses only the final 32KB;
   * unused leading bytes remain 0xFF for open-bus convention.
   */
  rom: Uint8Array;
  /** Mailbox main→sound (write 68K $FE0001, read 6502 $1810). */
  mainToSound: Mailbox8;
  /** Mailbox sound→main (write 6502 $1810, read 68K $FC0001). */
  soundToMain: Mailbox8;
  /** YM2151 FM device. Default: `createYM2151()` when omitted. */
  ym2151?: YM2151;
  /** POKEY device. Default: `createPOKEY()` when omitted. */
  pokey?: POKEY;
  /** Callback when the 6502 reads and acknowledges the main-to-sound mailbox. */
  onMainToSoundAck?: () => void;
  /** Diagnostic callback for 6502 reads of the main→sound command latch. */
  onMainToSoundRead?: (event: { readonly val: u8 }) => void;
  /** Callback when the 6502 posts a sound-to-main mailbox byte. */
  onSoundToMainPost?: () => void;
  /** Diagnostic override for the fixed/self-test/coin bits returned by $1820.
   * Default is $87 (self-test idle + coin pull-ups high). Bits 3/4 are still
   * ORed from mailbox pending state. */
  statusBase?: u8;
  /** Replay-time provider for input/status base bits. When present, this wins
   * over `statusBase`; mailbox pending bits are still ORed in below. */
  statusBaseProvider?: () => u8 | undefined;
  /** Diagnostics hook to service cross-CPU events before sampling $1820. */
  beforeStatusRead?: () => void;
  /** Diagnostics-only experiment: ignore LS259 bit 0 writes that reset the
   * YM2151. Default false preserves the Atari System 1 latch wiring. */
  disableYmReset?: boolean;
  /** Diagnostic callback for YM2151 data-port writes. */
  onYmWrite?: (event: { readonly reg: number; readonly val: number }) => void;
  /** Diagnostic callback for POKEY writes. */
  onPokeyWrite?: (event: { readonly reg: number; readonly val: number }) => void;
  /** Optional hook used by the sound-chip facade to apply chip I/O stores at
   * their estimated 6502 bus cycle instead of at opcode start. Returning true
   * means the caller has queued `apply` and the MMU must not apply it now. */
  deferChipWrite?: (event: {
    readonly kind: "ym2151Addr" | "ym2151Data" | "pokey";
    readonly address: number;
    readonly reg: number;
    readonly val: number;
  }, apply: () => void) => boolean;
}

export interface SoundMmu extends MemBus6502 {
  readonly ram: Uint8Array;       // 4KB, inspectable for oracle diffs
  readonly rom: Uint8Array;       // 48KB, immutable after construction
  readonly mainToSound: Mailbox8; // Reference from config
  readonly soundToMain: Mailbox8;
  /** YM2151 device, exposed for oracle diffs. */
  readonly ym2151: YM2151;
  /** POKEY device, exposed for oracle diffs. */
  readonly pokey: POKEY;
  /** Last LS259 output state per bit-addressed address ($1820-$1827). */
  readonly ls259Shadow: Uint8Array;
}

export function createSoundMmu(cfg: SoundMmuConfig): SoundMmu {
  if (cfg.rom.length !== 0xC000) {
    throw new Error(
      `sound-mmu: rom length expected 0xC000 (48KB), got 0x${cfg.rom.length.toString(16)}`,
    );
  }
  const ram = new Uint8Array(0x1000);          // $0000-$0FFF
  const ym2151 = cfg.ym2151 ?? createYM2151();
  const pokey = cfg.pokey ?? createPOKEY();
  const ls259Shadow = new Uint8Array(8);

  function read8(addr: u16): u8 {
    const a = addr as number;
    if (a < 0x1000) {
      return as_u8(ram[a]!);
    }
    if (a === 0x1800 || a === 0x1801) {
      // YM2151 status (Phase 5): bit 0 timer A overflow, bit 1 timer B
      // overflow, bit 7 busy. Same status byte is visible at $1800 and $1801.
      return ym2151ReadStatus(ym2151);
    }
    if (a === 0x1810) {
      const value = mailboxRead(cfg.mainToSound, cfg.onMainToSoundAck);
      cfg.onMainToSoundRead?.({ val: value });
      return value;
    }
    if (a === 0x1820) {
      cfg.beforeStatusRead?.();
      // status per atarisy1.cpp::switch_6502_r:
      //   bit 7 ($80) = self-test switch (idle = 1; real pull-up)
      //   bit 3 ($08) = main→sound pending (cmd buffer full, NMI source)
      //   bit 4 ($10) = sound→main pending (response buffer full)
      //   bit 0-2 = coin inputs (idle = 1, pressed = 0)
      // Verified 2026-05-17 via oracle/mame_1820_value_tap.lua: MAME returns
      // $8F at boot ($87 base + bit 3 main pending). Without high pull-up bits,
      // boot address $8018 takes the wrong branch.
      const base = (cfg.statusBaseProvider?.() as number | undefined) ??
        (cfg.statusBase as number | undefined) ?? 0x87;
      const b3 = cfg.mainToSound.pending ? 0x08 : 0;
      const b4 = cfg.soundToMain.pending ? 0x10 : 0;
      return as_u8(base | b3 | b4);
    }
    if (a >= 0x1870 && a < 0x1880) {
      return pokeyRead(pokey, as_u8(a - 0x1870));
    }
    if (a >= 0x4000) {
      return as_u8(cfg.rom[a - 0x4000]!);
    }
    // Open bus: $1000-$17FF, $1802-$180F, $1811-$181F, $1821-$186F,
    //          $1880-$3FFF
    return as_u8(0xff);
  }

  function write8(addr: u16, value: u8): void {
    const a = addr as number;
    const v = value as number;
    if (a < 0x1000) {
      ram[a] = v;
      return;
    }
    if (a === 0x1800) {
      const apply = (): void => ym2151WriteAddr(ym2151, value);
      if (cfg.deferChipWrite?.({
        kind: "ym2151Addr",
        address: a,
        reg: 0,
        val: v & 0xff,
      }, apply) === true) return;
      apply();
      return;
    }
    if (a === 0x1801) {
      const reg = ym2151.selectedReg & 0xff;
      cfg.onYmWrite?.({ reg: ym2151.selectedReg & 0xff, val: v & 0xff });
      const apply = (): void => ym2151WriteData(ym2151, value);
      if (cfg.deferChipWrite?.({
        kind: "ym2151Data",
        address: a,
        reg,
        val: v & 0xff,
      }, apply) === true) return;
      apply();
      return;
    }
    if (a === 0x1810) {
      mailboxWrite(cfg.soundToMain, value, cfg.onSoundToMainPost);
      return;
    }
    if (a >= 0x1820 && a <= 0x1827) {
      // LS259 outlatch. MAME maps $1820-$1827 to write_d0: the address selects
      // the output bit, and only data bit 0 is latched. Q0 drives YM reset.
      const bit = a - 0x1820;
      const d0 = v & 0x01;
      ls259Shadow[bit] = d0;
      if (bit === 0 && d0 !== 0 && cfg.disableYmReset !== true) {
        ym2151Reset(ym2151);
      }
      return;
    }
    if (a >= 0x1870 && a < 0x1880) {
      cfg.onPokeyWrite?.({ reg: a - 0x1870, val: v & 0xff });
      const apply = (): void => pokeyWrite(pokey, as_u8(a - 0x1870), value);
      if (cfg.deferChipWrite?.({
        kind: "pokey",
        address: a,
        reg: a - 0x1870,
        val: v & 0xff,
      }, apply) === true) return;
      apply();
      return;
    }
    // ROM range write: open bus, ignored (mirror MAME).
    // Tutte le altre region: ignored.
  }

  return {
    read8, write8,
    ram, rom: cfg.rom,
    mainToSound: cfg.mainToSound,
    soundToMain: cfg.soundToMain,
    ym2151,
    pokey,
    ls259Shadow,
  };
}
