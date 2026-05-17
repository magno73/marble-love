/**
 * sound-mmu.ts — Memory map del sound chip Atari System 1 (Marble Madness).
 *
 * Address space 64KB visto dal 6502:
 *
 *  $0000-$0FFF  RAM 4KB                                              [R/W]
 *  $1800-$1801  YM2151 register select / data                        [R/W] (stub)
 *  $1810        mailbox bidirezionale:
 *                 read  = main→sound latch (ack pending, rilascia NMI)
 *                 write = sound→main latch (set pending, asserisce IRQ6 al 68010)
 *  $1820        status register read:
 *                 bit 3 = sound→main pending
 *                 bit 4 = main→sound pending (inverso di "input ready")
 *                 altri bit: switch coin/test (stub, ritorna 0)
 *  $1824-$1825  LS259 latch (write_d0 alias). bit 0 = YM2151 reset.           [W]
 *               In stub: write loggata ma nessun side effect attivo.
 *  $1870-$187F  POKEY                                                [R/W] (stub)
 *  $4000-$FFFF  ROM 48KB (marble usa solo $C000-$FFFF in 2 da 16KB)  [R]
 *
 * Ogni address fuori da queste regioni: read=0xFF, write=ignored (open bus).
 *
 * Pattern stub YM2151/POKEY/LS259: write ignorate, read=0. Phase 5/6 li
 * sostituiranno con device emulator full. La mailbox e' invece full real
 * gia' in Phase 4 (e' la pre-condizione per scambio cmd 68K↔6502).
 *
 * Pin assertions (NMI 6502, IRQ6 68010): le mailbox callback (vedi
 * `mailbox.ts`) ricevono i callback come parametri di factory.
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
  /** ROM bytes mapped a $4000-$FFFF (48KB). Marble usa solo gli ultimi 32KB.
   * Caller deve fornire un Uint8Array di esattamente 0xC000 byte (48KB);
   * gli unused leading bytes restano 0xFF (open bus convention). */
  rom: Uint8Array;
  /** Mailbox main→sound (write 68K $FE0001, read 6502 $1810). */
  mainToSound: Mailbox8;
  /** Mailbox sound→main (write 6502 $1810, read 68K $FC0001). */
  soundToMain: Mailbox8;
  /** YM2151 FM device. Default: createYM2151() se omesso. */
  ym2151?: YM2151;
  /** POKEY device. Default: createPOKEY() se omesso. */
  pokey?: POKEY;
  /** Callback: 6502 ha letto la mailbox main→sound (ack). Wiring: rilascia
   * pin NMI 6502. Phase 4: opzionale (se assente, NMI line non modellata). */
  onMainToSoundAck?: () => void;
  /** Callback: 6502 ha scritto la mailbox sound→main (post). Wiring:
   * asserisce IRQ6 al 68010. Phase 4: opzionale. */
  onSoundToMainPost?: () => void;
}

export interface SoundMmu extends MemBus6502 {
  readonly ram: Uint8Array;       // 4KB, ispezionabile per oracle diff
  readonly rom: Uint8Array;       // 48KB, immutabile post-construct
  readonly mainToSound: Mailbox8; // ref a quella passata in config
  readonly soundToMain: Mailbox8;
  /** YM2151 device (Phase 5 register-state parity). Esposto per oracle diff. */
  readonly ym2151: YM2151;
  /** POKEY device (Phase 6 register-state parity). Esposto per oracle diff. */
  readonly pokey: POKEY;
  /** Last LS259 byte scritto per ognuno dei 2 indirizzi ($1824/$1825). */
  readonly ls259Shadow: Uint8Array;
}

export function createSoundMmu(cfg: SoundMmuConfig): SoundMmu {
  if (cfg.rom.length !== 0xC000) {
    throw new Error(
      `sound-mmu: rom length atteso 0xC000 (48KB), ricevuto 0x${cfg.rom.length.toString(16)}`,
    );
  }
  const ram = new Uint8Array(0x1000);          // $0000-$0FFF
  const ym2151 = cfg.ym2151 ?? createYM2151();
  const pokey = cfg.pokey ?? createPOKEY();
  const ls259Shadow = new Uint8Array(2);

  function read8(addr: u16): u8 {
    const a = addr as number;
    if (a < 0x1000) {
      return as_u8(ram[a]!);
    }
    if (a === 0x1800 || a === 0x1801) {
      // YM2151 status (Phase 5): bit 0 timer A overflow, bit 1 timer B
      // overflow, bit 7 busy. Stub V2 sempre 0. Stesso byte da $1800 e $1801.
      return ym2151ReadStatus(ym2151);
    }
    if (a === 0x1810) {
      return mailboxRead(cfg.mainToSound, cfg.onMainToSoundAck);
    }
    if (a === 0x1820) {
      // status: per atarisy1.cpp::switch_6502_r:
      //   bit 7 ($80) = self-test switch (idle = 1; pull-up reale)
      //   bit 3 ($08) = main→sound pending (cmd buffer full, NMI source)
      //   bit 4 ($10) = sound→main pending (response buffer full)
      //   bit 0-2 = coin inputs (idle = 1, pressed = 0)
      // Verificato 2026-05-17 via oracle/mame_1820_value_tap.lua: MAME al boot
      // ritorna $8F (= $87 base + bit 3 main pending). Senza i bit di pull-up
      // alti, boot $8018 `LDA $1820 AND #$80 BEQ` prende ramo divergente.
      const base = 0x87;
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
      ym2151WriteAddr(ym2151, value);
      return;
    }
    if (a === 0x1801) {
      ym2151WriteData(ym2151, value);
      return;
    }
    if (a === 0x1810) {
      mailboxWrite(cfg.soundToMain, value, cfg.onSoundToMainPost);
      return;
    }
    if (a === 0x1824 || a === 0x1825) {
      // LS259 outlatch alias. write_d0 = scrive solo bit 0 in hardware MAME;
      // qui salva intero byte per debug shadow. Side effect: bit 0 di $1824
      // controlla YM2151 reset (active low? convention varia, vedi MAME).
      ls259Shadow[a - 0x1824] = v;
      if (a === 0x1824 && (v & 0x01) === 0) {
        // YM2151 reset (active low). Stub V2: pulisce reg file + flag.
        ym2151Reset(ym2151);
      }
      return;
    }
    if (a >= 0x1870 && a < 0x1880) {
      pokeyWrite(pokey, as_u8(a - 0x1870), value);
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
