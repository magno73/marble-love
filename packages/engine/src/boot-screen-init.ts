/**
 * boot-screen-init.ts — replica `FUN_0000222E` (118 byte).
 *
 * Helper riusato chiamato da `FUN_00000FA0` (1 xref) come parte della sequenza
 * di boot/cold-start. Funzione utility che:
 *
 *   1. Cancella video RAM (alpha + MO + MMIO 0x860000 / 0xB00400) via FUN_1C88.
 *   2. Inizializza i 6 registri di controllo MO/palette priority a
 *      `$B00000..$B0000A` (low 12 byte di palette RAM = priority masks).
 *   3. Esegue il setup "intro" (FUN_22A4 — text rendering screens).
 *   4. **Solo a cold-boot** (`frame_counter == 0` @ 0x400016):
 *        - chiama FUN_3A9C (init RAM globals + scroll).
 *        - dispatch via due ROM "vector slot" a 0x10048 e 0x1004E:
 *            se ROM[slot].w == 0x4EF9 (opcode JMP.L) → JSR (slot)
 *            altrimenti → JSR fallback default (FUN_5E00(0) o FUN_5DEC).
 *
 * **Disasm 0x222E..0x22A3** (118 byte, 0 args, 0 ret):
 *
 *   jsr     0x1C88.l                  ; clearScreen (alpha+MO+0x860000+0xB00400)
 *   clr.w   ($B00000).l               ; MO/palette priority reg 0
 *   move.w  #0x1FFF, ($B00002).l      ; reg 1 — 13-bit priority mask
 *   move.w  #0x7FFF, ($B00004).l      ; reg 2 — 15-bit priority mask
 *   move.w  #-0x4001, ($B00006).l     ; reg 3 = 0xBFFF
 *   clr.w   ($B00008).l               ; reg 4
 *   clr.w   ($B0000A).l               ; reg 5
 *   jsr     0x22A4.l                  ; introSetup (text/string render)
 *   tst.w   ($400016).l               ; frame counter low (cold boot if 0)
 *   bne.b   end                       ; warm boot → return
 *   jsr     0x3A9C.l                  ; coldBootInit (RAM globals + scroll)
 *   movea.l #0x10048, A0
 *   cmpi.w  #0x4EF9, (A0)             ; "JMP.L" opcode in ROM slot 1?
 *   bne.b   slot1_fallback
 *     jsr   (A0)                      ; → ROM at 0x10048 = JMP.L target
 *     bra.b slot2
 *   slot1_fallback:
 *     clr.l -(SP); jsr 0x5E00.l; addq.l #4,SP   ; FUN_5E00(0)
 *   slot2:
 *   movea.l #0x1004E, A0
 *   cmpi.w  #0x4EF9, (A0)
 *   bne.b   slot2_fallback
 *     jsr   (A0)                      ; → ROM at 0x1004E = JMP.L target
 *     bra.b end
 *   slot2_fallback:
 *     jsr   0x5DEC.l
 *   end: rts
 *
 * **Convenzione vector slot**: Atari System II usa due "patch points" in ROM
 * (0x10048, 0x1004E) come hook table per game-specific cold-boot logic.
 * Se la cella inizia con `0x4EF9` (opcode `JMP.L abs.l`) la ROM contiene un
 * trampolino verso una routine custom, altrimenti viene usato il default
 * shippato col core (FUN_5E00 / FUN_5DEC). In Marble Madness lo slot a
 * 0x10048 è popolato (`JMP.L 0x1A798`) e quello a 0x1004E NO (zero).
 *
 * **Side effect bit-perfect** (escluse le 6 sub-jsr, modellate come callback):
 *   colorRam[0x00..0x01] = 0x0000     (BE word @ 0xB00000)
 *   colorRam[0x02..0x03] = 0x1FFF     (BE word @ 0xB00002)
 *   colorRam[0x04..0x05] = 0x7FFF     (BE word @ 0xB00004)
 *   colorRam[0x06..0x07] = 0xBFFF     (BE word @ 0xB00006, = -0x4001 unsigned)
 *   colorRam[0x08..0x09] = 0x0000     (BE word @ 0xB00008)
 *   colorRam[0x0A..0x0B] = 0x0000     (BE word @ 0xB0000A)
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-boot-screen-init-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Offset workRam del frame-counter low byte (assoluto = 0x400016). */
const FRAME_COUNTER_OFF = 0x16 as const;

/** Offset ROM dei due "vector slot" per cold-boot dispatch. */
const VECTOR_SLOT_1 = 0x10048 as const;
const VECTOR_SLOT_2 = 0x1004e as const;

/** Opcode M68K per `JMP.L abs.l` (big-endian, 1° word). */
const OPCODE_JMP_L = 0x4ef9 as const;

/**
 * Callback bag per le 6 sub-jsr. Default: no-op. Chiamate nell'ordine binary:
 *   clearScreen → introSetup → (se cold-boot) coldBootInit
 *                                         → dispatchSlot1 (hook OR fallback)
 *                                         → dispatchSlot2 (hook OR fallback)
 */
export interface BootScreenInitSubs {
  /** FUN_1C88: clear MO/alpha RAM, MMIO $860000, palette $B00400. */
  clearScreen?: (state: GameState) => void;
  /** FUN_22A4: text rendering screen (game over / coin / press start). */
  introSetup?: (state: GameState) => void;
  /** FUN_3A9C: cold-boot RAM globals + scroll init. Solo se frame==0. */
  coldBootInit?: (state: GameState) => void;
  /** Trampoline a ROM[0x10048] (jmp.l target). Chiamata se magic == 0x4EF9. */
  dispatchSlot1Hook?: (state: GameState) => void;
  /** Default fallback: FUN_5E00(0). Chiamata se magic != 0x4EF9. */
  slot1Fallback?: (state: GameState) => void;
  /** Trampoline a ROM[0x1004E] (jmp.l target). Chiamata se magic == 0x4EF9. */
  dispatchSlot2Hook?: (state: GameState) => void;
  /** Default fallback: FUN_5DEC. Chiamata se magic != 0x4EF9. */
  slot2Fallback?: (state: GameState) => void;
}

/** Scrive una word big-endian in colorRam (palette RAM, 0xB00000-0xB007FF). */
function writePaletteWord(state: GameState, off: number, word: number): void {
  state.colorRam[off] = (word >>> 8) & 0xff;
  state.colorRam[off + 1] = word & 0xff;
}

/** Legge una word big-endian dalla ROM. */
function readRomWord(rom: RomImage, off: number): number {
  return (
    (((rom.program[off] ?? 0) << 8) | (rom.program[off + 1] ?? 0)) & 0xffff
  );
}

/**
 * Replica `FUN_0000222E` — boot screen init helper.
 *
 * Zero argomenti, zero return value. Side effects su:
 *   - `state.colorRam[0..0xB]` (6 word di priority register)
 *   - tutto ciò che le sub-callback toccano (alpha/MO/work/color RAM)
 *
 * @param state GameState. Mutato in-place.
 * @param rom   ROM image (serve per il magic check sui due vector slot).
 * @param subs  Callback bag per le 6 sub-jsr. Default tutte no-op.
 */
export function bootScreenInit(
  state: GameState,
  rom: RomImage,
  subs: BootScreenInitSubs = {},
): void {
  // 0x222E: jsr 0x1C88 — clear screen.
  subs.clearScreen?.(state);

  // 0x2234..0x225C: 6 register init writes a $B00000..$B0000A.
  writePaletteWord(state, 0x00, 0x0000);
  writePaletteWord(state, 0x02, 0x1fff);
  writePaletteWord(state, 0x04, 0x7fff);
  writePaletteWord(state, 0x06, 0xbfff); // = -0x4001 unsigned word
  writePaletteWord(state, 0x08, 0x0000);
  writePaletteWord(state, 0x0a, 0x0000);

  // 0x225E: jsr 0x22A4 — intro setup (text screens).
  subs.introSetup?.(state);

  // 0x2264: tst.w *0x400016. bne → return early (warm boot).
  // tst.w è word: bit 0..15 di 0x400016/0x400017. Il binario ha uno *byte*
  // counter a 0x400016, ma tst.w legge 2 byte big-endian. Essendo il counter
  // un byte e 0x400017 essere scratchpad/zero in RAM iniziale, la condizione
  // "bne" è equivalente a "byte 0x400016 != 0 OR byte 0x400017 != 0".
  const fc = state.workRam[FRAME_COUNTER_OFF] ?? 0;
  const fc1 = state.workRam[FRAME_COUNTER_OFF + 1] ?? 0;
  if (((fc << 8) | fc1) !== 0) {
    return;
  }

  // 0x226C: jsr 0x3A9C — cold-boot init.
  subs.coldBootInit?.(state);

  // 0x2272..0x228B: vector slot 1 dispatch.
  if (readRomWord(rom, VECTOR_SLOT_1) === OPCODE_JMP_L) {
    subs.dispatchSlot1Hook?.(state);
  } else {
    subs.slot1Fallback?.(state);
  }

  // 0x228C..0x22A1: vector slot 2 dispatch.
  if (readRomWord(rom, VECTOR_SLOT_2) === OPCODE_JMP_L) {
    subs.dispatchSlot2Hook?.(state);
  } else {
    subs.slot2Fallback?.(state);
  }
}

// ─── Costanti esposte per i test ──────────────────────────────────────────
export const BOOT_SCREEN_FRAME_COUNTER_OFF = FRAME_COUNTER_OFF;
export const BOOT_SCREEN_VECTOR_SLOT_1 = VECTOR_SLOT_1;
export const BOOT_SCREEN_VECTOR_SLOT_2 = VECTOR_SLOT_2;
export const BOOT_SCREEN_MAGIC_JMP_L = OPCODE_JMP_L;
