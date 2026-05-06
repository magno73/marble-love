/**
 * state-sub-2abc.ts — replica `FUN_00002ABC` (148 byte).
 *
 * Sub-function "clear-string-chain" del state-machine scheduler. Chiamata
 * dal dispatcher root `FUN_00002E18` (vedi `game-state-machine.ts`,
 * `GameStateMachineSubs.fun_2abc`) quando lo slot è in `state == 2` con
 * `flag30[D4] != 0`. È anche chiamata in coda da `FUN_00002678`
 * (vedi `state-sub-2678.ts`).
 *
 * **Argomento (long sullo stack)**: `arg1Long` (A0) — pointer a struct
 * "string entry":
 *   +0  byte  col_byte (signed)
 *   +1  byte  tickOff (signed)
 *   +2  long  stringPtr → puntatore a stringa (byte sequence terminata da 0)
 *   +6  byte  marker (signed, usato col VAL_F00 per chain-traversal)
 *   +8  long  nextPtr → prossima entry nella catena (linked list)
 *
 * **Disasm 0x2ABC..0x2B4E** (148 byte):
 *
 *   movem.l {A4 A3 A2 D2}, -(SP)         ; salva 4 reg (16 byte)
 *   movea.l (0x14, SP), A0               ; A0 = arg1 long
 *   movea.l #0x401F42, A2                ; A2 = ROTATION_OFF
 *   chain_entry (0x2ACA):                 ; <- target del bra-loop
 *   movea.l #0xA03000, A3                ; A3 = ALPHA_RAM_BASE
 *   movea.l (0x2, A0), A4                ; A4 = stringPtr (long @ A0+2)
 *   tst.w  (A2)                           ; rotation == 0?
 *   beq.b  no_rot
 *     ; rotation != 0:
 *     moveq  #0x29, D2
 *     move.b (0x1, A0), D0b
 *     ext.w  D0w
 *     ext.l  D0
 *     sub.l  D0, D2                       ; D2 = 0x29 - sext_l(tickOff)
 *     bra.b  join
 *   no_rot:
 *     move.b (0x1, A0), D2b
 *     ext.w  D2w
 *     ext.l  D2
 *     asl.l  #6, D2                       ; D2 = sext_l(tickOff) << 6
 *   join:
 *   move.b (A0), D0b
 *   ext.w  D0w
 *   ext.l  D0                             ; D0 = sext_l(col_byte)
 *   move.w (A2), D1w
 *   ext.l  D1
 *   add.l  D1, D1                         ; D1 = 2 * rot (signed)
 *   movea.l #0x72A4, A1
 *   move.b (0x1, A1, D1*0x1), D1b         ; D1.b = byte @ 0x72A5 + 2*rot
 *   asl.l  D1, D0                         ; D0 = col << (D1 & 0x3f)
 *   add.l  D2, D0                         ; D0 += D2
 *   add.l  D0, D0                         ; D0 *= 2
 *   adda.l D0, A3                         ; A3 = 0xA03000 + D0 (alpha tile addr)
 *   inner_loop (0x2B0E):
 *   tst.b  (A4)+                          ; *(A4) == 0? post-inc A4
 *   beq.b  end_string
 *     clr.w (A3)                          ; *(A3).w = 0 (clear alpha tile)
 *     move.w (A2), D0w
 *     ext.l  D0
 *     add.l  D0, D0                       ; D0 = 2*rot
 *     movea.l #0x72A0, A1
 *     move.w (0x0, A1, D0*0x1), D0w       ; D0 = word @ 0x72A0 + 2*rot
 *     ext.l  D0
 *     add.l  D0, D0                       ; D0 = stride*2
 *     adda.l D0, A3                       ; A3 += stride*2
 *     bra.b  inner_loop
 *   end_string:
 *   move.b (0x6, A0), D0b
 *   ext.w  D0w
 *   ext.l  D0                             ; D0 = sext_l(marker @ A0+6)
 *   move.w (0x00401F00).l, D1w
 *   ext.l  D1                             ; D1 = sext_l(VAL_F00 word)
 *   add.l  D1, D0                         ; D0 = marker + VAL_F00 (sum)
 *   moveq  #1, D1                         ; D1 = 1
 *   cmp.l  D0, D1                         ; D1 - D0 (i.e., 1 - sum)
 *   bge.b  exit                           ; if 1 >= sum (sum <= 1) → exit
 *     movea.l (0x8, A0), A0               ; A0 = nextPtr (chain walk)
 *     bra.b  chain_entry                  ; ricomincia con nuova entry
 *   exit:
 *   movem.l (SP)+, {D2 A2 A3 A4}
 *   rts
 *
 * **Semantica**: dato un pointer a struct "string entry":
 *   1. Calcola la posizione iniziale nella alpha tilemap (@ 0xA03000):
 *        if rot == 0: D2 = sext(tickOff) << 6
 *        else:        D2 = 0x29 - sext(tickOff)
 *        shift = byte @ 0x72A5 + 2*rot (mascherato a 6 bit)
 *        D0 = ((sext(col) << shift) + D2) * 2
 *        a3 = 0xA03000 + D0
 *   2. Walk byte-by-byte della stringa @ stringPtr; per ogni byte non-zero
 *      scrive 0 nella alpha tilemap @ A3 (word) e avanza A3 di stride*2,
 *      dove stride = signed word @ 0x72A0 + 2*rot.
 *   3. Termina sul terminatore (byte 0) della stringa.
 *   4. Chain check: se sext(marker) + sext(VAL_F00) > 1 → A0 = *(A0+8)
 *      e ripete dal passo 1 (ricalcolo A3=0xA03000 + nuova posizione).
 *      Altrimenti → return.
 *
 * **Side effects**: scrive 0 in alpha RAM (@ 0xA03000..0xA03FFF) per ogni
 * carattere non-zero nelle stringhe della catena. Nessun side effect su
 * workRam/spriteRam/colorRam. Nessuna jsr/bsr (self-contained).
 *
 * **Stub injection**: FUN_2ABC NON ha jsr/bsr a sub-funzioni esterne.
 * L'interface `StateSub2ABCSubs` è vuota, mantenuta per simmetria col
 * pattern (state-sub-2678, state-sub-2da0).
 *
 * **Safety bound**: la chain-walk può loop infinito se la struttura punta
 * a se stessa (`*(A0+8) == A0`) o se forma un ciclo. Limitiamo a 1024
 * iterazioni — coerente col pattern `branchASpecial` di game-state-machine.
 *
 * **Verifica bit-perfect** vs `FUN_00002ABC` tramite
 * `cli/src/test-state-sub-2abc-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const VAL_F00_OFF = 0x1f00 as const;
const ROTATION_OFF = 0x1f42 as const;
const ALPHA_BASE = 0xa03000 as const;
const ROM_STRIDE_TABLE = 0x72a0 as const;
const ROM_SHIFT_TABLE = 0x72a4 as const;

/** Cap di sicurezza per chain-walk (evita infinite loop su catene self-referential). */
const CHAIN_SAFETY = 1024 as const;
/** Cap di sicurezza per inner loop su stringa (string max len). */
const STRING_SAFETY = 4096 as const;

/**
 * Stub injection (placeholder). FUN_2ABC NON chiama altre funzioni
 * tramite jsr — è completamente self-contained. La interface è
 * mantenuta per simmetria col pattern altrui (state-sub-2678, state-sub-2da0).
 */
export interface StateSub2ABCSubs {
  // Nessun jsr in FUN_2ABC — la struttura è mantenuta per simmetria.
}

// ─── Memory helpers ──────────────────────────────────────────────────────

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}
function readU16Signed(state: GameState, off: number): number {
  const w = readU16(state, off);
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Read byte at absolute address (subset memory map). */
function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a < 0x80000) return rom.program[a] ?? 0;
  if (a >= 0x400000 && a < 0x402000) return state.workRam[a - 0x400000] ?? 0;
  if (a >= 0xa02000 && a < 0xa03000) return state.spriteRam[a - 0xa02000] ?? 0;
  if (a >= 0xa03000 && a < 0xa04000) return state.alphaRam[a - 0xa03000] ?? 0;
  if (a >= 0xb00000 && a < 0xb00800) return state.colorRam[a - 0xb00000] ?? 0;
  return 0;
}

function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  return (
    ((readByteAbs(state, rom, addr) << 24) |
      (readByteAbs(state, rom, (addr + 1) >>> 0) << 16) |
      (readByteAbs(state, rom, (addr + 2) >>> 0) << 8) |
      readByteAbs(state, rom, (addr + 3) >>> 0)) >>>
    0
  );
}

/** Read signed word from ROM (big-endian). */
function readRomWordSigned(rom: RomImage, romAddr: number): number {
  const w = ((rom.program[romAddr] ?? 0) << 8) | (rom.program[romAddr + 1] ?? 0);
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Clear word in alpha RAM (only effect of FUN_2ABC on memory). */
function clearAlphaWord(state: GameState, addr: number): void {
  const a = addr >>> 0;
  if (a >= 0xa03000 && a < 0xa04000) {
    const off = a - 0xa03000;
    state.alphaRam[off] = 0;
    state.alphaRam[off + 1] = 0;
  }
}

// ─── Main function: replica FUN_2ABC ─────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00002ABC` — clear string chain.
 *
 * @param state    GameState (modifica alphaRam @ 0xA03000..0xA03FFF).
 * @param rom      RomImage (lettura tabelle stride/shift @ 0x72A0/0x72A4
 *                 + lettura A0/stringa se puntano a ROM).
 * @param arg1Long pointer (long) a struct "string entry": col@+0, tickOff@+1,
 *                 stringPtr@+2 (long), marker@+6, nextPtr@+8 (long).
 * @param _subs    placeholder (FUN_2ABC non ha jsr).
 *
 * **Side effects** in `state.alphaRam`:
 *   - Per ogni carattere non-zero in ogni stringa della catena, scrive 0
 *     (word) all'indirizzo alpha tilemap calcolato dalla formula
 *     col/tickOff/rot/stride/shift.
 *   - Catena terminata quando `sext(marker) + sext(VAL_F00) <= 1`.
 */
export function stateSub2ABC(
  state: GameState,
  rom: RomImage,
  arg1Long: number,
  _subs?: StateSub2ABCSubs,
): void {
  let a0 = arg1Long >>> 0;

  for (let chainIter = 0; chainIter < CHAIN_SAFETY; chainIter++) {
    // ── Setup posizione iniziale alpha tile ──
    // A4 = long @ A0+2 (stringPtr)
    let a4 = readLongAbs(state, rom, (a0 + 2) >>> 0);

    // Rotation (word @ 0x401F42)
    const rotationWord = readU16(state, ROTATION_OFF);
    const rotationSigned =
      rotationWord & 0x8000 ? rotationWord - 0x10000 : rotationWord;

    // D2 branch (rotation != 0 vs == 0)
    const tickOffByte = readByteAbs(state, rom, (a0 + 1) >>> 0);
    const tickOffSigned = tickOffByte & 0x80 ? tickOffByte - 0x100 : tickOffByte;
    let d2: number;
    if (rotationWord !== 0) {
      // D2 = 0x29 - sext_l(byte @ A0+1)
      d2 = (0x29 - tickOffSigned) | 0;
    } else {
      // D2 = sext_l(byte @ A0+1) << 6
      d2 = (tickOffSigned << 6) | 0;
    }

    // D0 = sext_l(byte @ A0)
    const colByte = readByteAbs(state, rom, a0);
    const colSigned = colByte & 0x80 ? colByte - 0x100 : colByte;
    let d0 = colSigned;

    // shift count = byte @ 0x72A4 + 1 + 2*rotSigned, mascherato a 6 bit
    const shiftIdx = ROM_SHIFT_TABLE + 1 + rotationSigned * 2;
    const shiftByte = rom.program[shiftIdx >>> 0] ?? 0;
    const shiftCount = shiftByte & 0x3f;
    if (shiftCount >= 32) {
      d0 = 0;
    } else {
      d0 = (d0 << shiftCount) | 0;
    }

    // D0 += D2; D0 *= 2
    d0 = (d0 + d2) | 0;
    d0 = (d0 * 2) | 0;

    // A3 = 0xA03000 + D0
    let a3 = (ALPHA_BASE + d0) >>> 0;

    // ── Inner loop: clear word per ogni char non-zero ──
    for (let strIter = 0; strIter < STRING_SAFETY; strIter++) {
      const ch = readByteAbs(state, rom, a4);
      a4 = (a4 + 1) >>> 0;
      if (ch === 0) break;

      clearAlphaWord(state, a3);

      // stride = signed word @ 0x72A0 + 2*rotSigned
      const stride = readRomWordSigned(rom, ROM_STRIDE_TABLE + rotationSigned * 2);
      a3 = (a3 + stride * 2) >>> 0;
    }

    // ── Chain check ──
    const markerByte = readByteAbs(state, rom, (a0 + 6) >>> 0);
    const markerSigned = markerByte & 0x80 ? markerByte - 0x100 : markerByte;
    const valF00Signed = readU16Signed(state, VAL_F00_OFF);
    const sum = (markerSigned + valF00Signed) | 0;
    // Termina se 1 >= sum (cmp.l D0,D1; bge), i.e., sum <= 1.
    if (sum <= 1) return;

    // Walk linked list: A0 = *(A0 + 8)
    a0 = readLongAbs(state, rom, (a0 + 8) >>> 0);
  }
}
