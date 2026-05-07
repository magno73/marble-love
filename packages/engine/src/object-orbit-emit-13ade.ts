/**
 * object-orbit-emit-13ade.ts — replica `FUN_00013ADE` (602 byte) bit-perfect.
 *
 * Subroutine "emit 9 sprite entries su traiettoria circolare" chiamata da due
 * siti in `FUN_000253ec` (xrefs @ 0x255d0, 0x25880). Riceve un singolo long
 * argument (struct ptr A0, slot record in work RAM).
 *
 * Il record ha un counter `(A0+0x57).b` che viene decrementato a ogni call;
 * se il valore iniziale cade in tre "reset trigger" specifici (0x64, 0x65,
 * 0x66) la funzione prima azzera `(A0+0x2e).w` e imposta un nuovo valore al
 * counter, poi continua. Dopodichè l'angolo corrente `(A0+0x2e).w` avanza di
 * 0x0A ogni call (modulo 0x192=402 unità = cerchio intero in gradi 12-bit).
 *
 * La tabella seno/coseno è a `A2 = 0x1EDA2` (word-table, 402 entry per mezzo
 * cerchio [0..0x191]; ogni quadrante è mappato via riflessione). Per un angolo
 * D3 ∈ [0..0x191]:
 *
 *   quadrante 0 (D3 ≤ 0x64):          cos = tbl[D3],        sin = tbl[0x64-D3]
 *   quadrante 1 (0x65 ≤ D3 ≤ 0xC8):   cos = -tbl[0xC8-D3],  sin = tbl[D3-0x64]
 *   quadrante 2 (0xC9 ≤ D3 ≤ 0x12D):  cos = -tbl[D3-0xC9],  sin = -tbl[0x12D-D3]
 *   quadrante 3 (0x12E ≤ D3 ≤ 0x191): cos = tbl[0x191-D3],  sin = -tbl[D3-0x12D]
 *
 * Il raggio (D6) è `D1 >> 1` dove D1 = angolo pre-decrement (il valore letto
 * da `(A0+0x57).b` PRIMA del decrement). La funzione poi legge 2 byte signed
 * per iterazione dal tile-delta stream @ `A4 = 0x1EF32` (18 byte × 2 = 36
 * byte totali; avanza A4 di 2 a ogni iter).
 *
 * Per ogni iterazione del loop (iter ∈ [0..8]):
 *   x_out = (D6 * cos_D3 >> 12) + (A0+0x1e).high_word - A1.w + tile_dx
 *   y_out = (D6 * sin_D3 >> 12) + (A0+0x1e).low_word  + (A0+0x2e).w - avg + tile_dy
 *   record is SKIPPED if x_out ∈ [-8..0x11F] AND y_out ∈ [-8..0xEF] fails
 *   (skip: x < -8 || x >= 0x120 || y < -8 || y >= 0xF0)
 *
 * Emit destinazione (mirror di FUN_00013D38 / FUN_00013ADE):
 *   emit_index < 4 → A0+0xA4 + emit*6
 *   emit_index ≥ 4 → A0+0x38 + (emit-4)*6
 * Ogni record: [charcode.w = iter+0x10B, x.w, y.w]
 *
 * **Disasm 0x13ADE..0x13D38** (602 byte):
 *
 *   link.w A6,-0xa           ; frame size 10 byte
 *   movem.l {A4,A3,A2,D6,D5,D4,D3,D2},-(SP)
 *   movea.l (0x8,A6),A0      ; A0 = arg (slot ptr)
 *   movea.l #0x1eda2,A2      ; A2 = sin/cos table ROM
 *
 *   ; --- counter reset triggers ---
 *   move.b (0x57,A0),D1b     ; D1b = counter
 *   ext.w D1w                ; sext byte→word
 *   moveq 0x64,D0; cmp.w D1w,D0w; bne.b →next1
 *     move.b #0x30,(0x57,A0) ; counter = 0x30
 *     clr.w (0x2e,A0)        ; angle = 0
 *     bra.b →post_trigger
 *   next1: moveq 0x65,D0; cmp.w D1w,D0w; bne.b →next2
 *     move.b #0x18,(0x57,A0)
 *     clr.w (0x2e,A0)
 *     bra.b →post_trigger
 *   next2: moveq 0x66,D0; cmp.w D1w,D0w; bne.b →post_trigger
 *     move.b #0x24,(0x57,A0)
 *     clr.w (0x2e,A0)
 *   post_trigger:
 *
 *   ; --- read counter (after potential reset), compute radius ---
 *   move.b (0x57,A0),D1b; ext.w D1w   ; D1 = counter (potentially reset)
 *   subq.b #0x1,(0x57,A0)             ; counter--
 *   cmpi.b #0xb,(0x1a,A0); bne.b →no_mirror
 *     moveq 0x24,D2; sub.w D1w,D2w; move.w D2w,D1w ; D1 = 0x24 - D1 (mirror)
 *   no_mirror:
 *   move.w D1w,(-0xa,A6)   ; frame[-A] = D1 (for y-average later)
 *   move.w D1w,D6w         ; D6w = D1 (radius base)
 *   asr.w #0x1,D6w         ; D6w >>= 1 (actual radius)
 *
 *   ; --- angle advance ---
 *   move.w (0x2e,A0),D3w       ; D3 = current angle
 *   addi.w #0xa,D3w            ; D3 += 10
 *   cmpi.w #0x192,D3w; blt.b →ok_wrap
 *     subi.w #0x192,D3w        ; wrap modulo 402
 *   ok_wrap: move.w D3w,(0x2e,A0)  ; write back angle
 *
 *   movea.l #0x1ef32,A4    ; A4 = tile delta stream
 *   clr.w (-0x6,A6)        ; frame[-6] = emit_index = 0
 *
 *   ; --- read (A0+0x1e).l split into high/low ---
 *   move.l (0x1e,A0),D2
 *   move.l D2,D0
 *   moveq 0x10,D1; asr.l D1,D0
 *   move.w D0w,(-0x8,A6)   ; frame[-8] = highWord(A0+0x1e) (int16 via sext)
 *   move.w D2w,(-0x4,A6)   ; frame[-4] = lowWord(A0+0x1e)
 *   andi.w #-0x1,(-0x4,A6) ; no-op mask
 *
 *   ; --- pre-clear 4 record charcode words at A0+0x38 and A0+0xA4 ---
 *   lea (0x38,A0),A3; lea (0xa4,A0),A1
 *   clr.w (-0x2,A6)   ; iter counter = 0
 * clear_loop:
 *   clr.w (A3); clr.w (A1)
 *   addq.l #0x6,A3; addq.l #0x6,A1
 *   addq.w #0x1,(-0x2,A6); moveq 0x4,D0; cmp.w (-0x2,A6),D0w; bgt →clear_loop
 *
 *   ; --- main loop: iter ∈ [0..8], 9 iterations ---
 *   clr.w (-0x2,A6)  ; iter = 0
 * loop_top: (0x13ba6)
 *   [sin/cos lookup for D3, compute D2w=cos, D4w=sin per quadrant]
 *   [muls.w + asr.l #12 → A1.w = cos_scaled, D0w = sin_scaled]
 *   [read tile_dx = sext(*(A4++)), tile_dy = sext(*(A4++))]
 *   [x = D0w + frame[-8] - A1w + tile_dx]
 *   [y = frame[-A] + frame[-4] - (D0w+A1w+1)/2 + tile_dy]  (NOTE: avg = (sin_scaled+cos_scaled)>>1, signed)
 *   [range check x ∈ [-8..0x11F] && y ∈ [-8..0xEF]]
 *   [if in range: emit record to A0+0xA4 or A0+0x38 based on emit_index]
 *   [D3w += 0x32; wrap 0x192; iter++; while iter <= 8]
 *
 *   ; --- epilogue ---
 *   move.b #0x1,(0x1c,A0)
 *   moveq #0,D0; tst.b (0x57,A0); seq D0b; neg.b D0b
 *
 * **Ritorno D0**: 0x01 se counter post == 0, 0x00 altrimenti.
 * (Identico pattern di FUN_00013D38.)
 *
 * **Side effects** (`state.workRam`):
 *   - `(argPtr+0x57).b` = nuovamente decrementato (con eventuale reset trigger).
 *   - `(argPtr+0x2e).w` = angolo aggiornato.
 *   - `(argPtr+0x1c).b` = 1.
 *   - Fino a 4 record × 6 byte @ `(argPtr+0xA4)..(argPtr+0xBB)`.
 *   - Fino a 4 record × 6 byte @ `(argPtr+0x38)..(argPtr+0x4F)`.
 *   - Charcode word per ciascuno dei 4 record per metà PRE-azzerato.
 *
 * **Letture ROM**:
 *   - `0x1EDA2` (sin/cos table, word-indexed).
 *   - `0x1EF32` (tile delta stream, byte signed, 18 coppie).
 *
 * **Callers noti**: `FUN_000253ec` @ 0x255d0 e 0x25880.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const WORK_RAM_BASE = 0x400000 as const;

/** ROM address della sin/cos table (word-indexed). */
const SINCOS_TABLE_ROM = 0x1eda2 as const;

/** ROM address del tile delta stream (byte signed, consumati a coppie). */
const DELTA_STREAM_ROM = 0x1ef32 as const;

/** Offsets nel record A0. */
const ARG_READY_BYTE_OFF = 0x1c; // byte: scritto = 1 in epilogue
const ARG_COORDS_LONG_OFF = 0x1e; // long: hi word = ref-X, lo word = ref-Y
const ARG_MIRROR_BYTE_OFF = 0x1a; // byte: == 0x0B → mirror D1 = 0x24 - D1
const ARG_ANGLE_WORD_OFF = 0x2e; // word: angolo corrente (0..0x191 modulo)
const ARG_OUT_2ND_HALF_OFF = 0x38; // 4 record da 6 byte (emit index 4..7)
const ARG_OUT_1ST_HALF_OFF = 0xa4; // 4 record da 6 byte (emit index 0..3)
const ARG_COUNTER_BYTE_OFF = 0x57; // byte: counter decrementato ogni call

/** Numero di record per "metà" destinazione. */
const HALF_RECORDS = 4 as const;
/** Stride dei record emessi (6 byte = 3 word). */
const RECORD_STRIDE = 6 as const;
/** Offset charcode base: iter + 0x10B. */
const CHARCODE_BASE = 0x10b as const;
/**
 * Numero di iterazioni del main loop: `bgt.w` (strictly >), quindi il loop
 * continua finché 8 > iter, ovvero iter ∈ [0..7] = 8 iterazioni, NON 9.
 */
const ITER_COUNT = 8 as const;
/** Step angolo per iterazione (0x32 unità). */
const ANGLE_STEP = 0x32 as const;
/** Ampiezza cerchio (402 unità = 0x192). */
const ANGLE_MODULO = 0x192 as const;
/** Step angolo avanzamento per call (0x0A). */
const ANGLE_ADVANCE = 0x0a as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

function readU16Rom(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  return (((rom.program[a] ?? 0) << 8) | (rom.program[a + 1] ?? 0)) & 0xffff;
}

/** Signed word read dalla ROM (replica `move.w (idx,A2), Dn; ext.l Dn`). */
function readS16Rom(rom: RomImage, addr: number): number {
  const u = readU16Rom(rom, addr);
  return ((u << 16) >> 16) | 0;
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

/** sign-extend word (16-bit) → int32. */
function sextWord(v: number): number {
  return ((v & 0xffff) << 16) >> 16;
}

/** sign-extend byte (8-bit) → int32. */
function sextByte(v: number): number {
  const b = v & 0xff;
  return b < 0x80 ? b : b - 0x100;
}

/**
 * Lookup seno (quadrature) dalla tabella ROM @ 0x1EDA2 per angolo D3.
 *
 * La tabella contiene i valori del 1° quadrante [0..0x64]. Il mapping è:
 *
 *   Q0 (0..0x64):         cos = tbl[D3],        sin = tbl[0x64-D3]
 *   Q1 (0x65..0xC8):      cos = -tbl[0xC8-D3],  sin = tbl[D3-0x64]
 *   Q2 (0xC9..0x12D):     cos = -tbl[D3-0xC9],  sin = -tbl[0x12D-D3]
 *   Q3 (0x12E..0x191):    cos = tbl[0x191-D3],  sin = -tbl[D3-0x12D]
 *
 * I valori D2w (cos) e D4w (sin) vengono restituiti come signed int16.
 */
function lookupSinCos(
  rom: RomImage,
  d3w: number,
): { d2w: number; d4w: number } {
  const d3 = d3w & 0xffff;

  let d2: number; // cos
  let d4: number; // sin

  if (d3 <= 0x64) {
    // Q0: D3 ≤ 0x64
    // cos: move.w D3w,D0w; ext.l D0; add.l D0,D0; tbl[D0]
    d2 = readS16Rom(rom, SINCOS_TABLE_ROM + d3 * 2);
    // sin: moveq 0x64,D0; ext.l D1(=D3w); sub.l D1,D0; add.l D0,D0; tbl[D0]
    d4 = readS16Rom(rom, SINCOS_TABLE_ROM + (0x64 - d3) * 2);
  } else if (d3 <= 0xc8) {
    // Q1: 0x65 ≤ D3 ≤ 0xC8
    // cos: move.l #0xc8,D1; D0=D3; sub.l D0,D1; D0=D1; add.l D0,D0; tbl[D0]; neg
    const cosIdx = 0xc8 - d3;
    const cosRaw = readS16Rom(rom, SINCOS_TABLE_ROM + cosIdx * 2);
    d2 = (-cosRaw) & 0xffff; // neg.l D0; move.w D0w,D2w
    // sin: D0=D3; ext.l D0; moveq 0x64,D1; sub.l D1,D0; add.l D0,D0; tbl[D0]
    const sinIdx = d3 - 0x64;
    d4 = readS16Rom(rom, SINCOS_TABLE_ROM + sinIdx * 2);
  } else if (d3 <= 0x12d) {
    // Q2: 0xC9 ≤ D3 ≤ 0x12D
    // cos: D1=D3; ext.l; subi.l #0xC9; D0=D1; add.l; tbl[D0]; neg
    const cosIdx = d3 - 0xc9;
    const cosRaw = readS16Rom(rom, SINCOS_TABLE_ROM + cosIdx * 2);
    d2 = (-cosRaw) & 0xffff;
    // sin: move.l #0x12D,D1; D0=D3; ext.l; sub.l D0,D1; D0=D1; add.l; tbl[D0]; neg
    const sinIdx = 0x12d - d3;
    const sinRaw = readS16Rom(rom, SINCOS_TABLE_ROM + sinIdx * 2);
    d4 = (-sinRaw) & 0xffff;
  } else {
    // Q3: 0x12E ≤ D3 ≤ 0x191
    // cos: move.l #0x191,D0; D1=D3; ext.l; sub.l D1,D0; add.l D0,D0; tbl[D0]
    const cosIdx = 0x191 - d3;
    d2 = readS16Rom(rom, SINCOS_TABLE_ROM + cosIdx * 2);
    // sin: D1=D3; ext.l; subi.l #0x12D,D1; D0=D1; add.l; tbl[D0]; neg
    const sinIdx = d3 - 0x12d;
    const sinRaw = readS16Rom(rom, SINCOS_TABLE_ROM + sinIdx * 2);
    d4 = (-sinRaw) & 0xffff;
  }

  // Risultato come int16 (signed word).
  return { d2w: d2 & 0xffff, d4w: d4 & 0xffff };
}

/**
 * Replica bit-perfect di `FUN_00013ADE` — emette 9 sprite entries su una
 * traiettoria circolare nello slot `argPtr`.
 *
 * @param state   GameState. Modifica `workRam` su:
 *                - `(argPtr+0x57).b` decrement (con eventuale reset trigger)
 *                - `(argPtr+0x2e).w` angolo aggiornato
 *                - `(argPtr+0x1c).b = 1`
 *                - fino a 4 record × 6 byte @ `(argPtr+0xA4)..(argPtr+0xBB)`
 *                - fino a 4 record × 6 byte @ `(argPtr+0x38)..(argPtr+0x4F)`
 * @param rom     ROM image (per sin/cos table @ `0x1EDA2` e delta stream
 *                @ `0x1EF32`).
 * @param argPtr  Long pushato dal caller. DEVE essere in work RAM
 *                (`0x400000..0x401FFF`).
 * @returns       D0 al ritorno (low byte effettivo, high zero):
 *                - `0x00000001` se dopo il decrement `(argPtr+0x57).b == 0`.
 *                - `0` altrimenti.
 */
export function objectOrbitEmit13ADE(
  state: GameState,
  rom: RomImage,
  argPtr: number,
): number {
  const a0 = argPtr >>> 0;
  const argOff = (a0 - WORK_RAM_BASE) >>> 0;

  // ── Counter reset triggers ──────────────────────────────────────────
  // Legge counter prima di decrementare per confrontare con 0x64/0x65/0x66.
  let d1b = state.workRam[argOff + ARG_COUNTER_BYTE_OFF] ?? 0;
  const d1wSext = sextByte(d1b); // ext.w D1w (sign-extend byte → word)

  if (d1wSext === 0x64) {
    state.workRam[argOff + ARG_COUNTER_BYTE_OFF] = 0x30;
    writeU16Ram(state, argOff + ARG_ANGLE_WORD_OFF, 0);
  } else if (d1wSext === 0x65) {
    state.workRam[argOff + ARG_COUNTER_BYTE_OFF] = 0x18;
    writeU16Ram(state, argOff + ARG_ANGLE_WORD_OFF, 0);
  } else if (d1wSext === 0x66) {
    state.workRam[argOff + ARG_COUNTER_BYTE_OFF] = 0x24;
    writeU16Ram(state, argOff + ARG_ANGLE_WORD_OFF, 0);
  }

  // ── Legge counter (eventualmente resettato), calcola raggio ─────────
  // move.b (0x57,A0),D1b; ext.w D1w  ← rilegge (potrebbe essere cambiato)
  d1b = state.workRam[argOff + ARG_COUNTER_BYTE_OFF] ?? 0;
  let d1w = sextByte(d1b) & 0xffff; // ext.w → word

  // subq.b #0x1,(0x57,A0) ← decrement (modulo 256)
  state.workRam[argOff + ARG_COUNTER_BYTE_OFF] = (d1b - 1) & 0xff;

  // cmpi.b #0xB,(0x1A,A0); mirror se == 11
  const mirrorByte = state.workRam[argOff + ARG_MIRROR_BYTE_OFF] ?? 0;
  if ((mirrorByte & 0xff) === 0x0b) {
    // moveq 0x24,D2; sub.w D1w,D2w; move.w D2w,D1w
    d1w = (0x24 - d1w) & 0xffff;
  }

  // frame[-A] = D1 (valore usato per y-sum: D1w)
  const frameMinusA = d1w; // move.w D1w,(-0xa,A6)

  // D6w = D1w >> 1 (asr.w #1 = divisione intera con segno, ma D1w è unsigned
  // nel range tipico; sul word arithmetic m68k è identica a >> 1 int16).
  const d6w = (sextWord(d1w) >> 1) & 0xffff;

  // ── Angolo: avanza di 0x0A e avvolgi a 0x192 ──────────────────────
  let d3w = (
    ((state.workRam[argOff + ARG_ANGLE_WORD_OFF] ?? 0) << 8) |
    (state.workRam[argOff + ARG_ANGLE_WORD_OFF + 1] ?? 0)
  ) & 0xffff;
  d3w = (d3w + ANGLE_ADVANCE) & 0xffff;
  if (d3w >= ANGLE_MODULO) d3w = (d3w - ANGLE_MODULO) & 0xffff;
  writeU16Ram(state, argOff + ARG_ANGLE_WORD_OFF, d3w);

  // movea.l #0x1ef32,A4  (stream ptr gestito come indice ROM)
  let a4 = DELTA_STREAM_ROM >>> 0;

  // ── Legge (A0+0x1e).l e divide in high/low word ───────────────────
  const coordsLong = readU32Ram(state, argOff + ARG_COORDS_LONG_OFF);
  // move.l D2,D0; moveq 0x10,D1; asr.l D1,D0 → signed right shift 16
  const frameMinusEight = (coordsLong >>> 16) & 0xffff; // high word (signed via asr.l)
  // NB: asr.l #0x10 sul long dà la high word zero-extended ma con segno;
  // poi move.w D0w,(-0x8,A6) salva solo il word → salviamo come uint16
  const frameMinusFour = coordsLong & 0xffff; // low word

  // ── Pre-clear: charcode word dei 4 record per ciascuna metà ────────
  for (let k = 0; k < HALF_RECORDS; k++) {
    writeU16Ram(state, argOff + ARG_OUT_2ND_HALF_OFF + k * RECORD_STRIDE, 0);
    writeU16Ram(state, argOff + ARG_OUT_1ST_HALF_OFF + k * RECORD_STRIDE, 0);
  }

  // ── Main loop: iter ∈ [0..7], 8 iterazioni ────────────────────────
  // (`bgt` con D0=8: loop while 8 > iter → exit quando iter == 8)
  let emitIndex = 0; // (-0x6, A6)
  let iterCtr = 0;  // (-0x2, A6)

  while (iterCtr < ITER_COUNT) {
    // ── Sin/cos lookup ────────────────────────────────────────────
    const { d2w, d4w } = lookupSinCos(rom, d3w);

    // ── muls.w + asr.l #0xC (shift-by-12 = /4096) ────────────────
    // cosScaled = (D6w * D2w) >> 12 (signed multiply → long → asr.l #0xC)
    // A1w = low word of cosScaled (used as signed word)
    const cosLong = (sextWord(d6w) * sextWord(d2w)) | 0;
    const cosScaledLong = cosLong >> 12; // asr.l #0xC
    const a1w = cosScaledLong & 0xffff; // movea.w D0w,A1 → low word

    // sinScaled = (D6w * D4w) >> 12
    const sinLong = (sextWord(d6w) * sextWord(d4w)) | 0;
    const sinScaledLong = sinLong >> 12; // asr.l #0xC
    const d0w = sinScaledLong & 0xffff; // move.w D0w → D0w post-asr

    // ── Read tile deltas from stream ──────────────────────────────
    const tileDx = sextByte(rom.program[a4] ?? 0); // move.b (A4)+,D4b; ext.w
    a4 = (a4 + 1) >>> 0;
    const tileDy = sextByte(rom.program[a4] ?? 0); // move.b (A4)+,D5b; ext.w
    a4 = (a4 + 1) >>> 0;

    // ── Compute x ────────────────────────────────────────────────
    // D2w = D0w(sinScaled) + frame[-8] - A1w
    // D4w(tile) + D2w → x_out
    // Disasm:
    //   move.w D0w,D2w                 ; D2 = sin_scaled
    //   add.w (-0x8,A6),D2w            ; D2 += frame[-8]
    //   sub.w A1w,D2w                  ; D2 -= cos_scaled
    //   add.w D2w,D4w                  ; D4 = tile_dx + D2 → x_out
    let d2wX = (sextWord(d0w) + sextWord(frameMinusEight) - sextWord(a1w)) & 0xffff;
    const xOut = (sextWord(tileDx & 0xffff) + sextWord(d2wX)) & 0xffff;

    // ── Compute y ─────────────────────────────────────────────────
    // D5w = tile_dy (già in D5w come ext.w)
    // D2w = frame[-A] + frame[-4]     (sum)
    // avg_long = (sin_scaled_long + cos_scaled_long) >> 1 (asr.l #1, signed)
    // D2w -= avg_long.w
    // y_out = D5w + D2w
    // Disasm:
    //   move.w (-0xa,A6),D2w           ; D2 = frame[-A] = D1 (radius-like)
    //   add.w (-0x4,A6),D2w            ; D2 += frame[-4] = low word of coords
    //   move.w D0w,D1w; ext.l D1       ; D1 = sext_l(sin_scaled)
    //   move.w A1w,D0w; ext.l D0       ; D0 = sext_l(cos_scaled)
    //   add.l D0,D1                    ; D1 = sin_long + cos_long
    //   asr.l #0x1,D1                  ; D1 >>= 1 (avg)
    //   move.w D1w,D0w                 ; D0w = avg.w
    //   sub.w D0w,D2w                  ; D2 -= avg.w
    //   add.w D2w,D5w                  ; D5 = tile_dy + D2 → y_out
    const sumLong = (sinScaledLong + cosScaledLong) | 0; // add.l (signed)
    const avgLong = sumLong >> 1; // asr.l #1
    const avgW = avgLong & 0xffff; // move.w D1w,D0w
    let d2wY = (sextWord(frameMinusA) + sextWord(frameMinusFour) - sextWord(avgW)) & 0xffff;
    const yOut = (tileDy + sextWord(d2wY)) & 0xffff;

    // ── Bounds check ─────────────────────────────────────────────
    // Disasm: skip (goto epilogue) when:
    //   cmp.w D4w,D0w(-8); bge → branch if -8 >= x_out → skip when x_out <= -8
    //   cmpi.w #0x120,D4w; bge → skip when x_out >= 0x120
    //   cmp.w D5w,D0w(-8); bge → skip when y_out <= -8
    //   cmpi.w #0xF0,D5w; bge  → skip when y_out >= 0xF0
    // Keep (emit) when: x_out > -8 AND x_out < 0x120 AND y_out > -8 AND y_out < 0xF0
    const xS = sextWord(xOut);
    const yS = sextWord(yOut);
    const inRange =
      xS > -8 && xS < 0x120 && yS > -8 && yS < 0xf0;

    if (inRange) {
      // ── Calcola destinazione ────────────────────────────────
      let destOff: number;
      if (emitIndex < HALF_RECORDS) {
        // Prima metà: A0+0xA4 + emitIndex*6
        destOff = argOff + ARG_OUT_1ST_HALF_OFF + emitIndex * RECORD_STRIDE;
      } else {
        // Seconda metà: A0+0x38 + (emitIndex-4)*6
        destOff =
          argOff + ARG_OUT_2ND_HALF_OFF + (emitIndex - HALF_RECORDS) * RECORD_STRIDE;
      }
      emitIndex++;

      // charcode = iterCtr + 0x10B
      writeU16Ram(state, destOff, (iterCtr + CHARCODE_BASE) & 0xffff);
      writeU16Ram(state, destOff + 2, xOut);
      writeU16Ram(state, destOff + 4, yOut);
    }

    // ── Angolo del prossimo step ──────────────────────────────────
    d3w = (d3w + ANGLE_STEP) & 0xffff;
    if (d3w >= ANGLE_MODULO) d3w = (d3w - ANGLE_MODULO) & 0xffff;

    iterCtr++;
    // bgt: `moveq 0x8,D0; cmp.w iter,D0w; bgt loop_top`
    // → loop while 8 > iter → iter ∈ [0..7], 8 iters total
  }

  // ── Epilogue ──────────────────────────────────────────────────────
  state.workRam[argOff + ARG_READY_BYTE_OFF] = 0x01;

  // moveq #0,D0; tst.b (0x57,A0); seq D0b; neg.b D0b
  const counterPost = state.workRam[argOff + ARG_COUNTER_BYTE_OFF] ?? 0;
  return counterPost === 0 ? 0x00000001 : 0x00000000;
}
