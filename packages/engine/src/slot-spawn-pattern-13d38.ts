/**
 *
 * (xref single: `FUN_000253ec` @ 0x25648, JSR.L). Riceve un singolo long arg
 * `script-rect-dispatch-12dfa`).
 *
 * The A0 record has a `(A0+0x57).b` counter that decrements on every call and
 * I "tile delta" (A3 = ROM table @ `0x1EF32`) are coppie of byte signed
 *
 *   - the first 4 in `(A0+0xA4)..(A0+0xBB)`
 *   - i secondthe 4 in `(A0+0x38)..(A0+0x4F)`
 *
 *   - charcode = `iter + 0x10B` (iter ∈ 0..7)
 *
 * following writes still fill the slot stride.
 *
 * **Disasm 0x13D38..0x13EE6** (430 byte):
 *
 *   00013d38  link.w  A6,-0xc
 *   00013d3c  movem.l {A4,A3,A2,D7,D6,D5,D4,D3,D2},-(SP)
 *   00013d40  movea.l (0x8,A6),A0                 ; A0 = arg (slot ptr)
 *   00013d44  moveq   #0x20,D2                    ; D2 = 0x20 (decremented)
 *   00013d46  move.b  (0x57,A0),D0b
 *   00013d4a  ext.w   D0w
 *   00013d4c  sub.w   D0w,D2w                     ; D2 = 0x20 - sext(A0+0x57)
 *   00013d4e  subq.b  #0x1,(0x57,A0)              ; (A0+0x57)-- (counter--)
 *   00013d52  movea.l #0x1ef32,A3                 ; A3 = ROM delta-stream
 *   00013d58  move.b  (0x58,A0),D0b
 *   00013d5c  ext.w   D0w
 *   00013d5e  ext.l   D0
 *   00013d60  asl.l   #0x2,D0                     ; D0 = sext(A0+0x58) << 2
 *   00013d62  movea.l #0x1f016,A1
 *   00013d68  movea.l (0x0,A1,D0*0x1),A1          ; A1 = romTable[selector]
 *   0001 3d6c  move.l  (0x4e,A1),D5                ; D5 = readU32(A1+0x4E)
 *   00013d70  move.l  D5,D0
 *   00013d72  moveq   #0x10,D1
 *   00013d74  asr.l   D1,D0                       ; D0 = D5 >> 16 (signed)
 *   00013d76  move.w  D0w,D4w                     ; D4w = highWord(A1+0x4E)
 *   00013d78  move.w  D5w,D3w                     ; D3w = lowWord(A1+0x4E)
 *   00013d7a  andi.w  #-0x1,D3w                   ; (no-op mask)
 *
 *   00013d7e  move.l  (0x1e,A0),D5                ; D5 = readU32(A0+0x1E)
 *   00013d82  move.l  D5,D0
 *   00013d84  moveq   #0x10,D1
 *   00013d86  asr.l   D1,D0                       ; D0 = D5 >> 16
 *   00013d88  move.w  D0w,(-0x6,A6)               ; frame[-6] = sext(D5_high)
 *   00013d8c  movea.w D5w,A4                      ; A4 = D5_low (zero-ext)
 *   00013d8e  move.l  A4,D7
 *   00013d90  andi.w  #-0x1,D7w                   ; (no-op mask)
 *   00013d94  movea.w D7w,A4                      ; A4 = lowWord(A0+0x1E)
 *
 *   00013d96  cmpi.b  #0xd,(0x1f,A1)              ; A1 selector type == 0xD?
 *   00013d9c  bne.b   0x00013db0                  ;   no → 'else' branch
 *   00013d9e  subq.w  #0x5,D4w                    ; D4 -= 5
 *   00013da0  addq.w  #0x5,D3w                    ; D3 += 5
 *   00013da2  move.w  D4w,D5w                     ; D5w = D4
 *   00013da4  subi.w  #0x1c,D5w                   ; D5w -= 0x1c
 *   00013da8  move.w  D3w,D6w                     ; D6w = D3
 *   00013daa  subi.w  #0xe,D6w                    ; D6w -= 0xe
 *   00013dae  bra.b   0x00013dc0
 *   00013db0  addq.w  #0x3,D4w                    ; D4 += 3
 *   00013db2  addq.w  #0x5,D3w                    ; D3 += 5
 *   00013db4  move.w  D4w,D5w
 *   00013db6  addi.w  #0x1c,D5w                   ; D5w += 0x1c
 *   00013dba  move.w  D3w,D6w
 *   00013dbc  subi.w  #0xe,D6w                    ; D6w -= 0xe
 *
 *   00013dc0  move.w  D5w,(-0xa,A6)
 *   00013dc4  move.w  (-0xa,A6),D7w
 *   00013dc8  sub.w   (-0x6,A6),D7w
 *   00013dcc  move.w  D7w,(-0xa,A6)               ; frame[-A] = D5 - frame[-6]
 *   00013dd0  move.w  D6w,(-0xc,A6)
 *   00013dd4  move.w  (-0xc,A6),D7w
 *   00013dd8  sub.w   A4w,D7w
 *   00013dda  move.w  D7w,(-0xc,A6)               ; frame[-C] = D6 - A4
 *   00013dde  move.w  D4w,(-0x2,A6)
 *   00013de2  move.w  (-0x2,A6),D7w
 *   00013de6  sub.w   D5w,D7w
 *   00013de8  move.w  D7w,(-0x2,A6)               ; frame[-2] = D4 - D5
 *   00013dec  move.w  D3w,(-0x4,A6)
 *   00013df0  move.w  (-0x4,A6),D7w
 *   00013df4  sub.w   D6w,D7w
 *   00013df6  move.w  D7w,(-0x4,A6)               ; frame[-4] = D3 - D6
 *
 *   00013dfa  lea     (0x38,A0),A2
 *   00013dfe  lea     (0xa4,A0),A1
 *   00013e02  clr.w   D4w                         ; clear loop ctr
 *   00013e04  clr.w   (A2)                        ; clear word @ A0+0x38..
 *   00013e06  clr.w   (A1)                        ; clear word @ A0+0xA4..
 *   00013e08  addq.l  #0x6,A2
 *   00013e0a  addq.l  #0x6,A1
 *   00013e0c  addq.w  #0x1,D4w
 *   00013e0e  moveq   #0x4,D0
 *   00013e10  cmp.w   D4w,D0w
 *   00013e12  bgt.b   0x00013e04                  ; clear 4 pairs of words
 *
 *   00013e14  clr.w   (-0x8,A6)                   ; emit_index = 0
 *   00013e18  clr.w   D4w                         ; D4 = iter = 0
 *
 *   ; ── main loop body (iter ∈ [0..7]) ────────────────────────────────
 * loop_top:
 *   00013e1a  move.w  D4w,D0w
 *   00013e1c  ext.l   D0
 *   00013e1e  asl.l   #0x1,D0
 *   00013e20  neg.l   D0
 *   00013e22  move.w  D0w,D1w
 *   00013e24  add.w   D2w,D1w                     ; D1 = D2 - iter*2 (signed)
 *   00013e26  tst.w   D1w
 *   00013e28  bge.b   0x00013e32                  ; if D1 >= 0 → check_8
 *   ; D1 < 0: use orig
 *   00013e2a  move.w  (-0x6,A6),D3w               ; D3 = orig Y high
 *   00013e2e  move.w  A4w,D1w                     ; D1 = orig X low
 *   00013e30  bra.b   0x00013e76                  ; → emit
 *
 * check_8:
 *   00013e32  moveq   #0x8,D0
 *   00013e34  cmp.w   D1w,D0w
 *   00013e36  ble.w   0x00013ec2                  ; if 8 <= D1 → SKIP (A3+=2)
 *   00013e3a  moveq   #0x4,D0
 *   00013e3c  cmp.w   D1w,D0w
 *   00013e3e  ble.b   0x00013e5c                  ; if 4 <= D1 → far branch
 *   ; 0 <= D1 < 4: use frame[-A]/[-C], offset by frame[-6]/A4
 *   00013e40  move.w  D1w,D0w
 *   00013e42  muls.w  (-0xa,A6),D0
 *   00013e46  asr.l   #0x2,D0                     ; D0 = (D1*frame[-A]) >> 2
 *   00013e48  move.w  D0w,D3w
 *   00013e4a  add.w   (-0x6,A6),D3w               ; D3 = ... + frame[-6]
 *   00013e4e  move.w  D1w,D0w
 *   00013e50  muls.w  (-0xc,A6),D0
 *   00013e54  asr.l   #0x2,D0
 *   00013e56  move.w  D0w,D1w
 *   00013e58  add.w   A4w,D1w                     ; D1 = ... + A4
 *   00013e5a  bra.b   0x00013e76
 *
 * far_branch (4 <= D1 < 8):
 *   00013e5c  subq.w  #0x4,D1w                    ; D1 -= 4 → [0..3]
 *   00013e5e  move.w  D1w,D0w
 *   00013e60  muls.w  (-0x2,A6),D0
 *   00013e64  asr.l   #0x2,D0                     ; D0 = (D1*frame[-2]) >> 2
 *   00013e66  move.w  D0w,D3w
 *   00013e68  add.w   D5w,D3w                     ; D3 += D5 (modified!)
 *   00013e6a  move.w  D1w,D0w
 *   00013e6c  muls.w  (-0x4,A6),D0
 *   00013e70  asr.l   #0x2,D0
 *   00013e72  move.w  D0w,D1w
 *   00013e74  add.w   D6w,D1w                     ; D1 += D6 (modified!)
 *
 * emit:
 *   00013e76  moveq   #0x4,D0
 *   00013e78  cmp.w   (-0x8,A6),D0w
 *   00013e7c  ble.b   0x00013e90                  ; if 4 <= emit_index → second half
 *   ; first 4 records: A0+0xA4 + emit*6
 *   00013e7e  move.w  (-0x8,A6),D0w
 *   00013e82  mulu.w  #0x6,D0
 *   00013e86  lea     (0xa4,A0),A1
 *   00013e8a  adda.w  D0w,A1
 *   00013e8c  movea.l A1,A2
 *   00013e8e  bra.b   0x00013ea4
 *   ; second 4 records: A0+0x38 + (emit-4)*6
 *   00013e90  move.w  (-0x8,A6),D0w
 *   00013e94  ext.l   D0
 *   00013e96  subq.l  #0x4,D0
 *   00013e98  mulu.w  #0x6,D0
 *   00013e9c  lea     (0x38,A0),A1
 *   00013ea0  adda.w  D0w,A1
 *   00013ea2  movea.l A1,A2
 *
 *   00013ea4  addq.w  #0x1,(-0x8,A6)              ; emit_index++
 *   00013ea8  move.w  D4w,D0w
 *   00013eaa  addi.w  #0x10b,D0w                  ; charcode = iter + 0x10B
 *   00013eae  move.w  D0w,(A2)+
 *   00013eb0  move.b  (A3)+,D0b
 *   00013eb2  ext.w   D0w
 *   00013eb4  add.w   D3w,D0w                     ; x = sextByte(*A3++) + D3
 *   00013eb6  move.w  D0w,(A2)+
 *   00013eb8  move.b  (A3)+,D0b
 *   00013eba  ext.w   D0w
 *   00013ebc  add.w   D1w,D0w                     ; y = sextByte(*A3++) + D1
 *   00013ebe  move.w  D0w,(A2)
 *   00013ec0  bra.b   0x00013ec4
 * skip_emit:
 *   00013ec2  addq.l  #0x2,A3                     ; A3 += 2 (consume but no emit)
 *   00013ec4  addq.w  #0x1,D4w
 *   00013ec6  moveq   #0x8,D0
 *   00013ec8  cmp.w   D4w,D0w
 *   00013eca  bgt.w   0x00013e1a                  ; while iter < 8
 *
 *   00013ece  move.b  #0x1,(0x1c,A0)              ; A0+0x1C = 1 (mark "ready")
 *   00013ed4  moveq   #0x0,D0
 *   00013ed6  tst.b   (0x57,A0)                   ; counter == 0?
 *   00013eda  seq     D0b
 *   00013edc  neg.b   D0b                         ; D0 = (counter == 0) ? 0xFF : 0
 *
 *   - `moveq #0,D0` → D0 = 0 (intero long).
 *       - if D0.b was 0xFF -> -0xFF mod 256 = 0x01 -> D0.b = 0x01
 *       - if D0.b was 0x00 -> 0 -> D0.b = 0x00
 *
 * **Side effects** (`state.workRam`):
 *   - `(A0+0x57).b` decrementato (modulo 256).
 *   - `(A0+0x1C).b` = 1 (mark "pattern emesso").
 *   - 4 word triples @ `(A0+0xA4)..(A0+0xBB)` (four 6-byte records).
 *   - 4 word triples @ `(A0+0x38)..(A0+0x4F)` (four 6-byte records).
 *     consecutive (charcode, x, y).
 *     the two words in a skipped record can keep the pre-clear or existing pattern.
 *
 * **Reads**:
 *   - ROM @ `0x1EF32` (signed-byte delta stream; 16 bytes consumed: 8 pairs).
 *   - ROM @ `0x1F016 + (selector<<2)` (slot-ptr table, 25 entries; out-of-range
 *   - ROM @ pointed slot `A1`: `(A1+0x4E).l` (packed sprite coords) and
 *     `(A1+0x1F).b` (kind, gating +/- branch).
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const WORK_RAM_BASE = 0x400000 as const;

/** ROM table: signed-byte x/y delta stream consumed as pairs in the loop. */
const DELTA_STREAM_ROM = 0x1ef32 as const;

/** ROM table: 25 slot pointers (same table as `findFirstFreeSlot_1F016`). */
const SLOT_PTR_TABLE_ROM = 0x1f016 as const;

/** Offsets in slot record A0 (stride 0x56 in work RAM). */
const ARG_READY_BYTE_OFF = 0x1c; // byte: scritto = 1 in epilogue
const ARG_COORDS_LONG_OFF = 0x1e; // long: sole source coords (Y_high|X_low)
const ARG_OUT_2ND_HALF_OFF = 0x38; // word: four 6-byte records (record 4..7)
const ARG_OUT_1ST_HALF_OFF = 0xa4; // word: four 6-byte records (record 0..3)
const ARG_COUNTER_BYTE_OFF = 0x57; // byte: decremented counter; gates return D0
const ARG_SELECTOR_BYTE_OFF = 0x58; // byte: selector for ROM table @0x1F016

/** Offsets in ROM-pointed slot A1. */
const A1_COORDS_LONG_OFF = 0x4e; // long: D5_high = D4 base, D5_low = D3 base
const A1_KIND_BYTE_OFF = 0x1f; // byte: == 0xD selects the "subtract" branch

/** Stride of emitted records (6 bytes = 3 words). */
const RECORD_STRIDE = 6 as const;

const ITER_COUNT = 8 as const;

const HALF_RECORDS = 4 as const;

/** Base charcode offset written to (A2): `iter + 0x10B`. */
const CHARCODE_BASE = 0x10b as const;

// ─── Helpers ────────────────────────────────────────────────────────────

function readU32Rom(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>>
    0
  );
}

function readByteRom(rom: RomImage, addr: number): number {
  return (rom.program[addr] ?? 0) & 0xff;
}

function readU32Ram(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function writeU16Ram(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

/** Sign-extend byte to int32 (-128..127). */
function sextByte(v: number): number {
  const b = v & 0xff;
  return b < 0x80 ? b : b - 0x100;
}

/** Sign-extend word to int32 (-32768..32767). */
function sextWord(v: number): number {
  const w = v & 0xffff;
  return w < 0x8000 ? w : w - 0x10000;
}

/**
 */
function asr2(longSigned: number): number {
  return (longSigned | 0) >> 2;
}

/**
 * Emit eight 6-byte records (charcode + x + y) into slot `argPtr`.
 *
 * @param state   GameState. Mutates `workRam` at:
 *                - `(argPtr+0x57).b` decrement
 *                - `(argPtr+0x1C).b = 1`
 *                - 4 word triples @ `(argPtr+0xA4)..(argPtr+0xBB)`
 *                - 4 word triples @ `(argPtr+0x38)..(argPtr+0x4F)`
 * @param rom     ROM image used to read the table @ `0x1F016`, delta stream
 *                @ `0x1EF32`, and `(A1+0x4E)` / `(A1+0x1F)`.
 *                `(A0, ...)` accesses touch work RAM. `seq` produces 0xFF, then
 *                `neg.b` turns it into 0x01.
 */
export function slotSpawnPattern13D38(
  state: GameState,
  rom: RomImage,
  argPtr: number,
): number {
  const a0 = argPtr >>> 0;
  const argOff = (a0 - WORK_RAM_BASE) >>> 0;

  // ── Prologue ────────────────────────────────────────────────────────
  // D2.w = 0x20 - sext_w(byte @A0+0x57)
  const counterPre = state.workRam[argOff + ARG_COUNTER_BYTE_OFF] ?? 0;
  const d2w = (0x20 - sextByte(counterPre)) & 0xffff;

  // (A0+0x57).b -= 1 (modulo 256).
  state.workRam[argOff + ARG_COUNTER_BYTE_OFF] = (counterPre - 1) & 0xff;

  // ── Resolve A1 from ROM table indexed by (A0+0x58).b sext.l << 2 ─────
  const selectorByte = state.workRam[argOff + ARG_SELECTOR_BYTE_OFF] ?? 0;
  const selectorSextL = sextByte(selectorByte);
  // Signed displacement used by adda.
  const selectorIdx = ((selectorSextL | 0) << 2) | 0;
  // movea.l (0x0,A1,D0*1),A1 -> A1 = readU32(0x1F016 + selectorIdx).
  // but full 32-bit indirizzamento; per parity basta `>>>0`).
  const a1Addr = (SLOT_PTR_TABLE_ROM + selectorIdx) >>> 0;
  const a1 = readU32Rom(rom, a1Addr) >>> 0;

  // ── Read base coords from A1+0x4E ──────────────────────────────────
  const a1CoordsAddr = (a1 + A1_COORDS_LONG_OFF) >>> 0;
  let a1CoordsLong: number;
  if (a1CoordsAddr >= WORK_RAM_BASE && a1CoordsAddr + 3 < WORK_RAM_BASE + state.workRam.length) {
    a1CoordsLong = readU32Ram(state, a1CoordsAddr - WORK_RAM_BASE);
  } else if (a1CoordsAddr + 3 < rom.program.length) {
    a1CoordsLong = readU32Rom(rom, a1CoordsAddr);
  } else {
    a1CoordsLong = 0;
  }

  // D5 = readU32(A1+0x4E); D4w = high; D3w = low
  let d4w = (a1CoordsLong >>> 16) & 0xffff;
  let d3w = a1CoordsLong & 0xffff;

  // ── Read coords from A0+0x1E ───────────────────────────────────────
  const argCoordsLong = readU32Ram(state, argOff + ARG_COORDS_LONG_OFF);
  const frameMinus6 = (argCoordsLong >>> 16) & 0xffff;
  const a4w = argCoordsLong & 0xffff;

  // ── Branch su (A1+0x1F).b == 0xD ───────────────────────────────────
  const a1KindAddr = (a1 + A1_KIND_BYTE_OFF) >>> 0;
  let a1KindByte: number;
  if (a1KindAddr >= WORK_RAM_BASE && a1KindAddr < WORK_RAM_BASE + state.workRam.length) {
    a1KindByte = state.workRam[a1KindAddr - WORK_RAM_BASE] ?? 0;
  } else if (a1KindAddr < rom.program.length) {
    a1KindByte = rom.program[a1KindAddr] ?? 0;
  } else {
    a1KindByte = 0;
  }

  let d5w: number;
  let d6w: number;
  if (a1KindByte === 0x0d) {
    // Branch "subtract": D4 -= 5; D3 += 5; D5w = D4 - 0x1c; D6w = D3 - 0xe.
    d4w = (d4w - 5) & 0xffff;
    d3w = (d3w + 5) & 0xffff;
    d5w = (d4w - 0x1c) & 0xffff;
    d6w = (d3w - 0x0e) & 0xffff;
  } else {
    // Branch "add": D4 += 3; D3 += 5; D5w = D4 + 0x1c; D6w = D3 - 0xe.
    d4w = (d4w + 3) & 0xffff;
    d3w = (d3w + 5) & 0xffff;
    d5w = (d4w + 0x1c) & 0xffff;
    d6w = (d3w - 0x0e) & 0xffff;
  }

  // ── Compute frame deltas ────────────────────────────────────────────
  // frame[-A] = D5 - frame[-6]   (delta-Y per range "0..3")
  // frame[-C] = D6 - A4          (delta-X per range "0..3")
  // frame[-2] = D4 - D5          (delta-Y per range "4..7")
  // frame[-4] = D3 - D6          (delta-X per range "4..7")
  const frameMinusA = (d5w - frameMinus6) & 0xffff;
  const frameMinusC = (d6w - a4w) & 0xffff;
  const frameMinus2 = (d4w - d5w) & 0xffff;
  const frameMinus4 = (d3w - d6w) & 0xffff;

  // ── Pre-clear: 4 record × 2 destinations (charcode word @ +0x38/+0xA4
  //   stride 6) ────────────────────────────────────────────────────────
  // pre-call contents. Mirror exactly.
  for (let k = 0; k < HALF_RECORDS; k++) {
    writeU16Ram(state, argOff + ARG_OUT_2ND_HALF_OFF + k * RECORD_STRIDE, 0);
    writeU16Ram(state, argOff + ARG_OUT_1ST_HALF_OFF + k * RECORD_STRIDE, 0);
  }

  // ── Main loop ──────────────────────────────────────────────────────
  let emitIndex = 0; // (-8, A6)
  let a3 = DELTA_STREAM_ROM >>> 0; // ROM ptr (advances even on skip)

  for (let iter = 0; iter < ITER_COUNT; iter++) {
    // D1.w = D2 - iter*2 (signed word arithmetic).
    const d1Long = (d2w | 0) - iter * 2; // already in safe int range
    const d1w = d1Long & 0xffff;
    const d1Sext = sextWord(d1w);

    let d3OutW: number;
    let d1OutW: number;
    let skip = false;

    if (d1Sext < 0) {
      // Path "use originals".
      d3OutW = frameMinus6;
      d1OutW = a4w;
    } else if (d1Sext >= 8) {
      // Skip emit, A3 += 2.
      skip = true;
      d3OutW = 0;
      d1OutW = 0;
    } else if (d1Sext >= 4) {
      // Range [4..7]: D1 -= 4, then mul/asr2 with frame[-2]/[-4], offset D5/D6.
      const d1Adj = (d1Sext - 4) & 0xffff;
      const d1AdjSext = sextWord(d1Adj);
      const mul1 = (d1AdjSext * sextWord(frameMinus2)) | 0;
      const r1 = asr2(mul1);
      d3OutW = (r1 + sextWord(d5w)) & 0xffff;
      const mul2 = (d1AdjSext * sextWord(frameMinus4)) | 0;
      const r2 = asr2(mul2);
      d1OutW = (r2 + sextWord(d6w)) & 0xffff;
    } else {
      // Range [0..3]: mul/asr2 with frame[-A]/[-C], offset frame[-6]/A4.
      const mul1 = (d1Sext * sextWord(frameMinusA)) | 0;
      const r1 = asr2(mul1);
      d3OutW = (r1 + sextWord(frameMinus6)) & 0xffff;
      const mul2 = (d1Sext * sextWord(frameMinusC)) | 0;
      const r2 = asr2(mul2);
      d1OutW = (r2 + sextWord(a4w)) & 0xffff;
    }

    if (skip) {
      a3 = (a3 + 2) >>> 0;
    } else {
      // Pick destination based on emit_index.
      let destOff: number;
      if (emitIndex < HALF_RECORDS) {
        // First half: A0 + 0xA4 + emit*6.
        destOff = argOff + ARG_OUT_1ST_HALF_OFF + emitIndex * RECORD_STRIDE;
      } else {
        // Second half: A0 + 0x38 + (emit-4)*6.
        destOff =
          argOff + ARG_OUT_2ND_HALF_OFF + (emitIndex - HALF_RECORDS) * RECORD_STRIDE;
      }
      emitIndex++;

      // Write charcode = iter + 0x10B (word).
      writeU16Ram(state, destOff, (iter + CHARCODE_BASE) & 0xffff);
      // Write x = sextByte(*A3++) + D3 (word, low 16).
      const dx = sextByte(readByteRom(rom, a3));
      a3 = (a3 + 1) >>> 0;
      writeU16Ram(state, destOff + 2, (dx + sextWord(d3OutW)) & 0xffff);
      // Write y = sextByte(*A3++) + D1 (word, low 16).
      const dy = sextByte(readByteRom(rom, a3));
      a3 = (a3 + 1) >>> 0;
      writeU16Ram(state, destOff + 4, (dy + sextWord(d1OutW)) & 0xffff);
    }
  }

  // ── Epilogue ───────────────────────────────────────────────────────
  state.workRam[argOff + ARG_READY_BYTE_OFF] = 0x01;

  // D0 = (A0+0x57.b == 0) ? 0x01 : 0x00 (low byte; high bytes 0).
  // Catena: moveq #0,D0 → seq D0b (Z?0xFF:0x00) → neg.b D0b (0xFF→0x01, 0→0).
  const counterPost = state.workRam[argOff + ARG_COUNTER_BYTE_OFF] ?? 0;
  return counterPost === 0 ? 0x00000001 : 0x00000000;
}
