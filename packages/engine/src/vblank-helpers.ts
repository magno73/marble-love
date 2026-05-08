/**
 * vblank-helpers.ts — replica `FUN_00028DEA` + `FUN_00028DB8` + `FUN_000121A6`.
 *
 * Tre helper di synchronization vblank, chiamati da molte sub:
 *
 * **FUN_28DEA** (`vblankAck28DEA`, 5 instr, 15 callers): busy-wait che
 *   azzera `*0x400016` (flag vblank) e attende che diventi non-zero
 *   (settato dall'IRQ4 al vblank). Quindi incrementa `*0x4003F0`.
 *   In TS non c'è IRQ async: simuliamo "vblank è arrivato" istantaneamente
 *   (non azzeriamo il flag perché il caller imposta lo state successivo).
 *
 * **FUN_28DB8** (`wait28DB8`, 18 instr, 19 callers): frame countdown
 *   "gated by state". Aspetta N frame (arg word) ma se `*0x400390`
 *   cambia rispetto al valore catturato all'inizio, resetta il countdown
 *   a 0 (= early exit).
 *
 * **FUN_121A6** (`clearPaletteRam121A6`, 5 instr, 4 callers): clear di
 *   tutta la colorRam (`0xB00000..0xB007FF`, 2 KB) con `clr.l` loop.
 */

import type { GameState } from "./state.js";

export const VBLANK_ACK_28DEA_ADDR = 0x00028dea as const;
export const WAIT_28DB8_ADDR = 0x00028db8 as const;
export const CLEAR_PALETTE_RAM_121A6_ADDR = 0x000121a6 as const;

/**
 * Replica `FUN_00028DEA` — vblank ack + frame counter increment.
 *
 * Disasm:
 *   clr.b   *0x400016         ; clear vblank flag
 *   loop: tst.b *0x400016
 *         beq loop             ; wait until non-zero
 *   addq.b  #1, *0x4003F0      ; counter++
 *
 * In TS simuliamo "vblank già arrivato": settiamo `workRam[0x16] = 1`
 * (= flag set come post-IRQ) e incrementiamo `*0x3F0`. Il busy-wait
 * non ha equivalente nel modello synchronous TS.
 */
export function vblankAck28DEA(state: GameState): void {
  // In MAME: clr → wait → IRQ → set. In TS: salta direttamente al post-IRQ.
  state.workRam[0x16] = 1;
  state.workRam[0x3f0] = ((state.workRam[0x3f0] ?? 0) + 1) & 0xff;
}

/**
 * Replica `FUN_00028DB8` — frame countdown gated by state.
 *
 * Disasm:
 *   D0 = arg (word, frame count)
 *   D2 = *0x400391 (low byte of state machine state)
 *   D3 = D0 (counter)
 *   loop check: if D3 <= 0 done
 *     jsr FUN_28DEA              ; vblank ack
 *     if D2.w == *0x400390: D3 stays  (= state non cambiato)
 *     else: D3 = 0  (= state cambiato → exit early)
 *     D3--
 *   rts
 *
 * Logica: aspetta `frames` frame (incrementando *0x3F0), early exit
 * se state machine state cambia. Loop body è eseguito `frames` volte
 * (assumendo state stabile). In TS non c'è "wait async": eseguiamo le
 * `frames` chiamate a `vblankAck28DEA` in sequenza.
 */
export function wait28DB8(state: GameState, frames: number): void {
  // Cattura state byte all'inizio (low byte of word @ 0x390).
  const initialStateByte = state.workRam[0x391] ?? 0;
  let counter = frames & 0xffff;
  while (counter > 0) {
    vblankAck28DEA(state);
    // Confronta state byte attuale con quello catturato.
    // Logica binario: se *0x400390 (word, sign-ext) != saved D2.w → D3 = 0.
    // D2 = saved state byte LOW. cmp.w D0 (= D2 ext.w), *0x400390.w.
    // Sign-ext byte → word. Se equal → preserva counter, else zero counter.
    const initialStateWord = initialStateByte & 0x80
      ? initialStateByte | 0xff00
      : initialStateByte;
    const currentStateWord =
      ((state.workRam[0x390] ?? 0) << 8) | (state.workRam[0x391] ?? 0);
    if (currentStateWord !== (initialStateWord & 0xffff)) {
      counter = 0;
    } else {
      counter -= 1;
    }
  }
}

/**
 * Replica `FUN_000121A6` — clear colorRam (2 KB).
 *
 * Disasm:
 *   lea 0xB00000, A0
 *   D0 = 0x1FF
 *   clr.l (A0)+
 *   dbf D0, loop          ; 0x200 iter × 4 byte = 2048 byte
 *   rts
 */
export function clearPaletteRam121A6(state: GameState): void {
  state.colorRam.fill(0);
}
