/**
 * object-array-init-25b40.ts — replica `FUN_00025B40` (110 byte, 0x25B40..0x25BAE).
 *
 * Helper invocato da `FUN_2591A` (object-initializer @ 0x25992) e da
 * `FUN_259B4` (caller @ 0x25AAE). Riceve un puntatore oggetto (long sullo
 * stack), azzera 1 byte @ A1+0xCA e popola 3 array di 8 word ciascuno
 * @ A1+0x74, A1+0x84, A1+0x94.
 *
 * **Disasm 0x25B40..0x25BAE** (110 byte / 0x6E, 1 arg long sullo stack = `objPtr`):
 *
 *   0x25B40:  movem.l {D3,D2},-(SP)               ; preserve D2, D3
 *   0x25B44:  movea.l (0xC,SP),A1                 ; A1 = arg long (objPtr)
 *                                                  ;   (offset 0xC = 2*4 saved regs + 4 ret addr)
 *
 *   0x25B48:  clr.b   (0xCA,A1)                    ; A1[+0xCA].b = 0
 *
 *   0x25B4C:  clr.b   D1b                          ; D1.b = 0 (loop counter i)
 *
 *   loop_top (0x25B4E, 8 iterations: i in 0..7):
 *     0x25B4E:  move.b D1b,D0b
 *     0x25B50:  ext.w  D0w                          ; D0w = sext_b(i)
 *     0x25B52:  movea.l #0x1D3F4,A0
 *     0x25B58:  move.b (0,A0,D0w*1),D3b             ; D3.b = ROM[0x1D3F4 + i]
 *     0x25B5C:  ext.w  D3w                          ; D3w = sext_b(D3.b)
 *     0x25B5E:  moveq  #0xB,D0
 *     0x25B60:  asl.w  D0,D3w                       ; D3w <<= 11 (word-wide)
 *
 *     0x25B62:  move.b D1b,D0b
 *     0x25B64:  ext.w  D0w
 *     0x25B66:  movea.l #0x1D3FC,A0
 *     0x25B6C:  move.b (0,A0,D0w*1),D2b             ; D2.b = ROM[0x1D3FC + i]
 *     0x25B70:  ext.w  D2w
 *     0x25B72:  moveq  #0xB,D0
 *     0x25B74:  asl.w  D0,D2w                       ; D2w <<= 11
 *
 *     0x25B76:  move.b D1b,D0b
 *     0x25B78:  ext.w  D0w
 *     0x25B7A:  add.w  D0w,D0w                      ; D0w = i*2
 *     0x25B7C:  lea    (0x74,A1),A0
 *     0x25B80:  move.w D3w,(0,A0,D0w*1)             ; A1[+0x74 + i*2].w = D3w
 *
 *     0x25B84:  move.b D1b,D0b
 *     0x25B86:  ext.w  D0w
 *     0x25B88:  add.w  D0w,D0w
 *     0x25B8A:  lea    (0x84,A1),A0
 *     0x25B8E:  move.w D2w,(0,A0,D0w*1)             ; A1[+0x84 + i*2].w = D2w
 *
 *     0x25B92:  move.b D1b,D0b
 *     0x25B94:  ext.w  D0w
 *     0x25B96:  add.w  D0w,D0w
 *     0x25B98:  lea    (0x94,A1),A0
 *     0x25B9C:  clr.w  (0,A0,D0w*1)                 ; A1[+0x94 + i*2].w = 0
 *
 *     0x25BA0:  addq.b #1,D1b
 *     0x25BA2:  cmpi.b #0x8,D1b
 *     0x25BA6:  bne.b  loop_top                     ; loop while i != 8
 *
 *   0x25BA8:  movem.l (SP)+,{D2,D3}                  ; restore
 *   0x25BAC:  rts
 *
 * **Side effects su A1** (per ogni i in 0..7):
 *   - A1[+0x74 + i*2]  word  ← (sext_b(ROM[0x1D3F4 + i])) << 11   (16 bit wrap)
 *   - A1[+0x84 + i*2]  word  ← (sext_b(ROM[0x1D3FC + i])) << 11   (16 bit wrap)
 *   - A1[+0x94 + i*2]  word  ← 0
 * E una volta:
 *   - A1[+0xCA]        byte  ← 0
 *
 * Range scritti su A1: bytes [0x74, 0x83] + [0x84, 0x93] + [0x94, 0xA3] +
 * [0xCA, 0xCA]. Totale 49 byte (24 word contigue 0x74..0xA3 + 1 byte @ 0xCA).
 *
 * **Modellazione bit-perfect** delle sottigliezze M68k:
 *
 *   1. **`asl.w D0,D3w` con D0=11**: shift count = D0.b & 63 = 11. Operazione
 *      a 16 bit: `(D3 & 0xFFFF) << 11 & 0xFFFF` produce esattamente lo stesso
 *      pattern. NON tocca i flag che useremmo dopo (V/C non leggibili in TS).
 *
 *   2. **Sign extension `ext.w` su byte negativi**: byte 0xFE (-2) sext to
 *      0xFFFE; poi `asl.w #11` → `(0xFFFE << 11) & 0xFFFF = 0xF000`. In TS
 *      replichiamo tramite `(b >= 0x80 ? b - 0x100 : b)` poi mask 0xFFFF
 *      e shift `<< 11 & 0xFFFF`.
 *
 *   3. **Big-endian word writes**: `move.w` BE su workRam.
 *
 *   4. **Index addressing `(0,A0,D0w*1)`**: usa SOLO la low word di D0
 *      come signed offset (sign-extended in indexing). D0w è
 *      `sext_b(i) * 2`. Per i in [0..7], D0w è in [0..14], sempre
 *      positivo.
 *
 *   5. **ROM è read-only**: tabelle fisse a 0x1D3F4 (8 byte) e 0x1D3FC
 *      (8 byte). Esposte come costanti `OBJECT_ARRAY_INIT_25B40_TABLE_A_ROM`,
 *      `OBJECT_ARRAY_INIT_25B40_TABLE_B_ROM`.
 *
 * **Caller noti** (2, da xref):
 *   - 0x25994 in FUN_2591A   (object initializer)
 *   - 0x25AAE in FUN_259B4   (state-machine entry adiacente)
 *
 * Verifica bit-perfect via `cli/src/test-object-array-init-25b40-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Base assoluta della work RAM (0x400000 nel bus M68k). */
const WORK_RAM_BASE = 0x400000;
/** Limite superiore esclusivo workRam (0x400000 + 0x2000). */
const WORK_RAM_END = 0x402000;

/** Offset ROM tabella A (8 byte, letta byte-by-byte e sign-extended). */
export const OBJECT_ARRAY_INIT_25B40_TABLE_A_ROM = 0x0001d3f4 as const;
/** Offset ROM tabella B (8 byte, letta byte-by-byte e sign-extended). */
export const OBJECT_ARRAY_INIT_25B40_TABLE_B_ROM = 0x0001d3fc as const;

/** Indirizzo entry-point del binario (per parity tests / cross-ref). */
export const OBJECT_ARRAY_INIT_25B40_ADDR = 0x00025b40 as const;

/** Numero iterazioni del loop (8: i in 0..7). */
export const OBJECT_ARRAY_INIT_25B40_COUNT = 8 as const;

/** Shift count della asl.w (11 bit). */
export const OBJECT_ARRAY_INIT_25B40_SHIFT = 11 as const;

/** Offsets delle scritture dirette su A1. */
export const OBJECT_ARRAY_INIT_25B40_FIELDS = {
  /** Base array A (8 word a +0x74, +0x76, ..., +0x82). */
  arrayABase: 0x74,
  /** Base array B (8 word a +0x84, +0x86, ..., +0x92). */
  arrayBBase: 0x84,
  /** Base array Z (8 word a +0x94, +0x96, ..., +0xA2). Sempre 0. */
  arrayZBase: 0x94,
  /** Byte clear @ +0xCA. */
  byteAtCA: 0xca,
} as const;

/** Range completo dei byte scritti (per neighbor checks). */
export const OBJECT_ARRAY_INIT_25B40_WRITTEN_RANGE = {
  /** [0x74, 0xA3] inclusive — 48 byte contigui (24 word). */
  contiguousLow: 0x74,
  contiguousHigh: 0xa3,
  /** Byte isolato. */
  isolatedByte: 0xca,
} as const;

// ─── Helper interno ───────────────────────────────────────────────────────

/** Read byte da ROM program. 0 se fuori range. */
function readRomByte(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= rom.program.length) return 0;
  return (rom.program[a] ?? 0) & 0xff;
}

/** Sign-extend byte a word (16 bit unsigned representation). */
function sextByteToWord(b: number): number {
  const v = b & 0xff;
  return v >= 0x80 ? (v - 0x100) & 0xffff : v;
}

/** Write big-endian word su workRam (assoluto M68k). No-op se fuori range. */
function writeU16BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value & 0xffff;
  workRam[off] = (v >>> 8) & 0xff;
  workRam[off + 1] = v & 0xff;
}

/** Write byte su workRam (assoluto M68k). No-op se fuori range. */
function writeU8(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return;
  workRam[a - WORK_RAM_BASE] = value & 0xff;
}

/**
 * Replica `FUN_00025B40` — popola array A1+0x74/0x84/0x94 (3 × 8 word) e
 * azzera A1+0xCA.
 *
 * Vedi disasm e semantica nell'header del file.
 *
 * @param state   GameState corrente (`workRam` mutato in-place).
 * @param rom     RomImage (legge tabelle @ 0x1D3F4 e 0x1D3FC, 8 byte cad.).
 * @param objPtr  Puntatore assoluto M68k all'oggetto (es. `0x004012XX`).
 *                Deve cadere all'interno della work RAM e lasciare almeno
 *                0xCB byte disponibili (campo più alto: A1+0xCA).
 */
export function objectArrayInit25B40(
  state: GameState,
  rom: RomImage,
  objPtr: number,
): void {
  const wr = state.workRam;
  const objAbs = objPtr >>> 0;

  // 0x25B48: A1[+0xCA].b = 0
  writeU8(wr, objAbs + 0xca, 0);

  // 0x25B4C..0x25BA6: loop i in 0..7
  for (let i = 0; i < OBJECT_ARRAY_INIT_25B40_COUNT; i++) {
    // tableA[i]: byte → sext_w → << 11 (16 bit wrap)
    const ba = readRomByte(rom, OBJECT_ARRAY_INIT_25B40_TABLE_A_ROM + i);
    const va = (sextByteToWord(ba) << OBJECT_ARRAY_INIT_25B40_SHIFT) & 0xffff;

    // tableB[i]: byte → sext_w → << 11 (16 bit wrap)
    const bb = readRomByte(rom, OBJECT_ARRAY_INIT_25B40_TABLE_B_ROM + i);
    const vb = (sextByteToWord(bb) << OBJECT_ARRAY_INIT_25B40_SHIFT) & 0xffff;

    // A1[+0x74 + i*2].w = va
    writeU16BE(wr, objAbs + OBJECT_ARRAY_INIT_25B40_FIELDS.arrayABase + i * 2, va);
    // A1[+0x84 + i*2].w = vb
    writeU16BE(wr, objAbs + OBJECT_ARRAY_INIT_25B40_FIELDS.arrayBBase + i * 2, vb);
    // A1[+0x94 + i*2].w = 0
    writeU16BE(wr, objAbs + OBJECT_ARRAY_INIT_25B40_FIELDS.arrayZBase + i * 2, 0);
  }
}
