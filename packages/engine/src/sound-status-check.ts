/**
 * sound-status-check.ts — replica `FUN_00004C3E` (sound command sender).
 *
 * Sub chiamata da `FUN_00004CA0` (soundTick) dopo aver invocato il sound chip
 * writer (FUN_4DCC). Decide se è possibile inviare un nuovo comando al sound
 * CPU (6502) o se occorre ritentare al prossimo tick.
 *
 * **Disasm 0x4C3E..0x4C6D** (48 byte):
 *
 *   move    SR,D1w               ; salva interrupt mask
 *   move    #0x2500,SR           ; disabilita IRQ sotto livello 5
 *   btst.b  #0x7,(0xF60001).l    ; bit 7 dell'switch port = "sound cmd pending"
 *   bne     fail                 ; → se ancora pending, abort
 *   tst.l   (0x16,A1)            ; long @ A1+0x16 (slot occupato?)
 *   bne     fail                 ; → se !=0 abort
 *   move.w  D0w,(0xFE0000).l     ; scrive low word di D0 al sound cmd latch
 *   swap    D0
 *   move.b  D0b,(0x14,A1)        ; byte a A1+0x14 = (D0_originale >> 16) & 0xFF
 *   move.l  A0,(0x16,A1)         ; long a A1+0x16 = A0 (mark slot occupato)
 *   moveq   #1,D0                ; success
 *   bra     done
 * fail:
 *   moveq   #0,D0
 * done:
 *   move    D1w,SR               ; ripristina IRQ mask
 *   rts
 *
 * **Convenzione caller (FUN_4CA0)**: imposta `D0 = 0x10003`, `A0 = 0x401F44`,
 * `A1 = 0x401F44` (A1 == A0). Ritorna Z flag in D0:
 *   0 = retry needed (caller incrementa retry counter saturato a 0xFF)
 *   1 = ok (caller skippa retry)
 *
 * **MMIO interaction** (cfr `bus.ts`):
 *   0xF60001 bit 7 = sound command pending (active high; il sound CPU lo
 *                    azzera quando ha letto il comando precedente)
 *   0xFE0000      = mailbox sound CPU (write-only, 16 bit ma solo low byte
 *                    arriva al 6502 in MAME)
 *
 * **Side effects sulla work RAM** (quando va a buon fine):
 *   workRam[A0+0x14] ← (D0 >> 16) & 0xFF       (byte: comando "logico")
 *   workRam[A0+0x16..0x19] ← A0 (long, big-endian, slot owner pointer)
 *
 * In TS il valore scritto a 0xFE0000 (sound mailbox) è effetto laterale puro
 * sul chip esterno: lo modello come byte opzionale nel return path se serve;
 * in default lo trascuro perché `audio.ts` lo gestisce a un livello superiore.
 */

import type { GameState } from "./state.js";

/** Offset (relativi alla base A1) usati come "slot record" del sender. */
const SLOT_TYPE_BYTE_OFF = 0x14; // (0x14, A1) byte
const SLOT_OWNER_LONG_OFF = 0x16; // (0x16, A1) long (A0 ptr); 0 = libero

/** WORK RAM base per sottrarre dagli indirizzi assoluti A0/A1. */
const WORK_RAM_BASE = 0x400000;

/**
 * Replica `FUN_00004C3E` — sound command sender.
 *
 * @param state    GameState (workRam usato per leggere/scrivere lo slot record)
 * @param d0       D0 (long, 32 bit). Bit 31..16 = "type byte" (in low 8),
 *                 bit 15..0 = parola spedita al chip.
 * @param a0       A0 (puntatore assoluto, tipicamente 0x401F44). Funge sia da
 *                 "owner" salvato nello slot, sia (==A1 nel caller) da base
 *                 dei campi `+0x14` / `+0x16` modificati on-success.
 * @param soundPending  Modella bit 7 di MMIO `0xF60001`. Quando true (sound
 *                 CPU non ha ancora consumato il latch precedente) la funzione
 *                 ritorna 0 senza side-effects. Default false (chip ready).
 * @returns 0 = retry needed (Z flag set nel binario), 1 = ok (Z=0).
 *
 * NOTE: la `move.w` a 0xFE0000 è side-effect verso il sound CPU 6502 e NON è
 * modellata qui (gestita da `audio.ts`/Bus a livello più alto). I path di
 * fallimento NON la eseguono nemmeno nel binario originale.
 */
export function soundStatusCheck(
  state: GameState,
  d0: number,
  a0: number,
  soundPending: boolean = false,
): number {
  // Path "fail": bit 7 di 0xF60001 set → comando precedente ancora in coda
  if (soundPending) {
    return 0;
  }

  // Offset dello slot record nella work RAM. A1 == A0 nel caller di Marble,
  // quindi usiamo direttamente A0 come base (parità dimostrata vs binario).
  const slotBase = (a0 - WORK_RAM_BASE) >>> 0;
  const ownerOff = slotBase + SLOT_OWNER_LONG_OFF;

  // tst.l (0x16, A1): se long != 0, slot già occupato → fail.
  const owner =
    (((state.workRam[ownerOff] ?? 0) << 24) |
      ((state.workRam[ownerOff + 1] ?? 0) << 16) |
      ((state.workRam[ownerOff + 2] ?? 0) << 8) |
      (state.workRam[ownerOff + 3] ?? 0)) >>>
    0;
  if (owner !== 0) {
    return 0;
  }

  // Path "ok": commit dello slot.
  // - move.b (D0 >> 16) & 0xFF → workRam[A0+0x14]
  // - move.l A0                → workRam[A0+0x16..0x19] (big-endian)
  const typeByteOff = slotBase + SLOT_TYPE_BYTE_OFF;
  state.workRam[typeByteOff] = (d0 >>> 16) & 0xff;

  const a0u = a0 >>> 0;
  state.workRam[ownerOff] = (a0u >>> 24) & 0xff;
  state.workRam[ownerOff + 1] = (a0u >>> 16) & 0xff;
  state.workRam[ownerOff + 2] = (a0u >>> 8) & 0xff;
  state.workRam[ownerOff + 3] = a0u & 0xff;

  return 1;
}
