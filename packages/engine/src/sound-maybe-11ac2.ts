/**
 * sound-maybe-11ac2.ts — replica `FUN_00011AC2` (22 byte).
 *
 * Questa funzione copia una tabella di 66 word (132 byte) dalla ROM
 * (indirizzo `0x1D370`) nella work RAM (offset `0x76E`, indirizzo assoluto
 * `0x40076E`). Non ha argomenti e non ha side-effect visibili al di fuori
 * della scrittura in work RAM.
 *
 * **Disasm 0x11AC2..0x11AD6** (22 byte):
 *
 *   00011ac2  movea.l  #0x40076e, A0    ; A0 = workRam + 0x76E (destinazione)
 *   00011ac8  movea.l  #0x0001d370, A1  ; A1 = ROM program + 0x1D370 (sorgente)
 *   00011ace  moveq    0x41, D0          ; D0.w = 65 (loop counter 0..65 → 66 iter)
 *   00011ad0  move.w   (A1)+, (A0)+      ; copia 1 word ROM → RAM; avanza entrambi
 *   00011ad2  dbf      D0w, 0x11ad0      ; decrement D0.w; branch se D0.w != -1
 *   00011ad6  rts
 *
 * **DBF semantica**: `dbf D0w, target` decrementa D0.w e salta se D0.w != -1
 * (0xFFFF). Con D0.w iniziale = 0x41 (65), il loop esegue 66 volte (0..65
 * inclusi). Totale copiato: 66 × 2 = 132 byte.
 *
 * **Sorgente ROM**: `0x1D370` cade nella ROM program (0x000000..0x07FFFF).
 * I byte sono letti come word big-endian (M68k big-endian bus).
 *
 * **Destinazione work RAM**: `0x40076E` → `workRam[0x76E..0x76E + 131]`.
 * Work RAM = 0x400000..0x401FFF (8 KB); offset 0x76E + 131 = 0x7F1 < 0x2000.
 *
 * **Caller**: `FUN_00010504` @ 0x105BE (hook `soundMaybe11AC2` in
 * `mainLoopInit10504Subs`) e `FUN_00012FD0` @ 0x1303C.
 *
 * **Nome "soundMaybe11AC2"**: assegnato dal Ghidra context `MainLoopInit10504Subs`.
 * La funzione non contiene istruzioni sound dirette, ma la tabella copiata
 * (66 word a 0x1D370) probabilmente contiene parametri usati più tardi da
 * logica sonora/animazione. Il nome segue la convenzione del progetto.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";

/** ROM program byte-offset della tabella sorgente (66 word big-endian). */
export const ROM_TABLE_OFFSET = 0x1d370 as const;

/** Work RAM byte-offset di destinazione (start of 132-byte region). */
export const WORK_RAM_DEST_OFFSET = 0x76e as const;

/** Numero di word copiate (DBF con D0.w=0x41 → 66 iterazioni). */
export const COPY_WORD_COUNT = 66 as const;

/** Indirizzo assoluto di questa funzione nella ROM. */
export const SOUND_MAYBE_11AC2_ADDR = 0x00011ac2 as const;

/**
 * Replica `FUN_00011AC2` — copia tabella ROM → work RAM.
 *
 * Copia `COPY_WORD_COUNT` (66) word big-endian da
 * `rom.program[ROM_TABLE_OFFSET..]` a `state.workRam[WORK_RAM_DEST_OFFSET..]`.
 *
 * Ogni iterazione del loop M68k:
 *   1. Legge 1 word (2 byte) da ROM (big-endian: byte alto poi byte basso).
 *   2. Scrive i 2 byte in sequenza in work RAM.
 *   3. Avanza entrambi i puntatori di 2.
 *
 * @param state  GameState con `workRam` (8 KB) da scrivere.
 * @param rom    RomImage contenente `program` (ROM del 68010).
 */
export function soundMaybe11AC2(state: GameState, rom: RomImage): void {
  const src = rom.program;
  const dst = state.workRam;

  let srcOff = ROM_TABLE_OFFSET;
  let dstOff = WORK_RAM_DEST_OFFSET;

  // DBF: 66 iterazioni (D0.w = 0x41 → loop body eseguito 66 volte).
  for (let i = 0; i < COPY_WORD_COUNT; i++) {
    // move.w (A1)+, (A0)+ : legge word big-endian dalla ROM, scrive in RAM.
    dst[dstOff] = src[srcOff] ?? 0;       // byte alto
    dst[dstOff + 1] = src[srcOff + 1] ?? 0; // byte basso
    srcOff += 2;
    dstOff += 2;
  }
}
