/**
 * boot-init.ts — sequenza di boot del game engine.
 *
 * Replica progressivamente la sequenza di reset del binario originale,
 * portando uno `emptyGameState()` a un primo stato "post-boot pre-tick"
 * coerente. Pensato per essere chiamato UNA volta prima del primo `tick()`.
 *
 * **Sequenza nel binario** (reset vector @ 0x004 → entry @ 0x466):
 *
 *   Hardware init (0x466..0x4FE):
 *     - SR = 0x2700                              ; disable IRQ
 *     - watchdog kick loop @ 0x486 (4000 iter)
 *     - clear MMIO 0x860000, 0xF40010
 *     - clear alpha RAM 0xA00000..0xA03FFE word-by-word (0x4000 byte!)
 *     - test bit 6 of MMIO 0xF60001 (= test mode? skip if 0)
 *     - init color RAM 0xB00000..0xB0061E con pattern decrescente:
 *         word[i] = (-0x1000 + (i+1)*4) & 0xFFFF
 *     - init work RAM 0x400000..0x401FFE (clear words via test routine
 *       a 0x84E che azzera + verifica con cmp + branch)
 *
 *   High-level init (FUN_FA0, indirect call dopo hw init):
 *     - if *0x400016 == 0 (cold boot):
 *         copy 3 long ROM ptrs (0x10074, 0x10078, 0x1007C) →
 *             workRam (0x400140, 0x400154, 0x400168) via FUN_1D74
 *     - clear *0x40017C (word) e MMIO 0x860000
 *     - jsr 0x1CEA = paletteRamInitFull
 *     - jsr 0xE24 = paletteBootstrapInit
 *     - jsr 0x31D0 = gameStateMachineInit (state machine + alpha RAM clear)
 *     - molti altri setup di workRam globals (per ora STUB)
 *
 * **Stato dopo bootInit()**: `tick(state, {rom})` può procedere senza UB.
 * Per parità byte-perfect con FUN_FA0 servirebbe replicare l'intera funzione
 * (~1KB). Per ora bootInit copre i pezzi "visibili": palette inizializzata,
 * alpha RAM cleared, state machine globals impostati.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

import {
  paletteRamInitFull,
  paletteBootstrapInit,
  gameStateMachineInit,
} from "./init-helpers.js";

/**
 * Inizializza color RAM con il pattern decrescente del RESET handler
 * (0x4C4..0x4DC):
 *
 *   D0 = -0x1000
 *   loop until A0 >= 0xB0061E:
 *     D0 += 4
 *     *(A0)+ = D0  (word)
 *
 * Output: 783 word @ 0xB00000..0xB0061E, valori 0xFFFC, 0xFFF8, 0xFFF4, ...
 */
function colorRamHardwareInit(state: GameState): void {
  let d0 = -0x1000 & 0xffff;
  // Loop limit 0xB0061E exclusive di 0xB00000 → 0x61E byte = 0x30F word.
  // Ma il loop scrive con `(A0)+` quindi quando A0 == 0xB0061E loop stop.
  // Il bne controlla cmpa.l A0,A1 dove A1 = 0xB0061E. Quindi 0x30F+1 iter:
  // A0 va da 0xB00000 a 0xB0061E (inclusive write quando A0=0xB0061C).
  for (let off = 0; off < 0x61e; off += 2) {
    d0 = (d0 + 4) & 0xffff;
    state.colorRam[off] = (d0 >>> 8) & 0xff;
    state.colorRam[off + 1] = d0 & 0xff;
  }
}

/**
 * Replica i 3 long copy condizionali di FUN_FA0 (0xfc2..0xff8):
 *
 *   if *0x400016 == 0:
 *     FUN_1D74(workRam[0x140], ROM[0x10074])  // long copy
 *     FUN_1D74(workRam[0x168], ROM[0x1007C])
 *     FUN_1D74(workRam[0x154], ROM[0x10078])
 *
 * `FUN_1D74` è una mem-copy long. ROM[0x10074..0x1007C] sono ptr long che
 * vengono copiati in workRam globals. Sono usati come "callback table"
 * dalla state machine.
 */
function bootCallbackTableInit(state: GameState, rom: RomImage): void {
  if ((state.workRam[0x16] ?? 0) !== 0) return; // warm boot

  function readLong(buf: Uint8Array, off: number): number {
    return (
      ((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)
    ) >>> 0;
  }
  function writeLong(buf: Uint8Array, off: number, v: number): void {
    buf[off] = (v >>> 24) & 0xff;
    buf[off + 1] = (v >>> 16) & 0xff;
    buf[off + 2] = (v >>> 8) & 0xff;
    buf[off + 3] = v & 0xff;
  }

  writeLong(state.workRam, 0x140, readLong(rom.program, 0x10074));
  writeLong(state.workRam, 0x168, readLong(rom.program, 0x1007c));
  writeLong(state.workRam, 0x154, readLong(rom.program, 0x10078));
}

/**
 * Esegue la sequenza di boot completa.
 *
 * Va chiamato UNA volta su uno `emptyGameState()` prima del primo `tick()`.
 * È idempotente (può essere richiamato senza side-effect dannosi grazie al
 * gate `*0x400016 == 0`), ma in pratica chiamarlo una volta sola.
 */
export function bootInit(state: GameState, rom: RomImage): void {
  // 1. Hardware init (RESET 0x466)
  colorRamHardwareInit(state);
  // alpha RAM clear: già 0 in emptyGameState
  // work RAM clear: già 0 in emptyGameState

  // 2. FUN_FA0 cold-boot conditional (3 long copies)
  bootCallbackTableInit(state, rom);
  state.workRam[0x17c] = 0;
  state.workRam[0x17d] = 0;

  // 3. Sub-init replicate
  paletteRamInitFull(state, rom);
  paletteBootstrapInit(state);
  gameStateMachineInit(state, rom);

  // TODO: replicare il resto di FUN_FA0 (sub di setup workRam globals,
  // copyRomToWorkram66Words, etc.). Per ora gli campi non inizializzati
  // restano 0 → il primo tick gira ma alcuni state-machine slot saranno
  // inattivi finché il game engine non li popola.
}
