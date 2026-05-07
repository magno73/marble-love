/**
 * mo-block-emit-1a8d2.ts — replica `FUN_0001A8D2` (250 byte / 0xFA).
 *
 * **Sprite / Motion-Object "block emit" loop.** Legge una header-struct
 * puntata da `arg0_ptr` (long), poi itera un body (lista di sub-record di
 * lunghezza variabile) e per ogni iter emette **4 word** in 4 buffer
 * separati i cui cursor pointer-long vivono in workRam @
 *   0x4003F6 (A3), 0x4003FA (A1), 0x4003FE (A2), 0x400402 (A4)
 * più un counter word @ 0x400406 (D7) — incrementato di +1 ad ogni iter.
 *
 * I quattro cursor sono **post-incrementanti** (`(An)+`); a fine routine
 * vengono ri-scritti in workRam (commit dei nuovi valori di A1/A2/A3/A4
 * dopo il consumo). I caller (FUN_26F3E) inizializzano i cursor a regioni
 * di sprite-RAM @ `0xA02000`/`0xA02080`/`0xA02100`/`0xA02180-2` e ri-usano
 * il counter D7 attraverso più chiamate consecutive a `FUN_1A8D2`,
 * costruendo cumulatively una display-list.
 *
 * **Calling convention** (4 arg long, RTL):
 *   - `arg0` (long, push first / SP+0x28): pointer assoluto M68k a header
 *     o `-1` (0xFFFFFFFF) ⇒ early-exit (solo writeback dei cursor).
 *   - `arg1` (low word @ SP+0x2E, sign-ext): "X bias" word, sommato al
 *     low byte (signed) di header[+0] e poi `<< 5 & 0x3FE0` ⇒ posto in
 *     bit 5..13 del primo output.
 *   - `arg2` (low word @ SP+0x32, sign-ext): "Y bias" word, sommato al
 *     low byte (signed) di header[+1] (e in long-branch sommato anche al
 *     byte successivo del body) e `<< 5 & 0x3FE0`.
 *   - `arg3` (low word @ SP+0x36, sign-ext): "OR mask" word, OR'd col
 *     primo output di ogni iter.
 *
 * **Header layout** (puntato da arg0):
 *   off +0x0  byte    "x_bias_byte"  (signed, sommato a arg1)
 *   off +0x1  byte    "y_bias_byte"  (signed, sommato a arg2)
 *   off +0x2  ?       (non letto)
 *   off +0x4  ?       (non letto)
 *   off +0x8  long    "body_ptr"     (LSB = "high-bit flag" — bclr.l #0,D0)
 *
 *   - `bit0` di header[+8]: se 1 ⇒ `D4w = 0x8000` (high-bit pre-set) e
 *     `D5w = 0xFF00` (passo di D1 = -0x100 per iter, i.e. **decrescente**).
 *     Se 0 ⇒ `D4w = 0` e `D5w = 0x0100` (passo +0x100 = **crescente**).
 *     Il `bclr.l #0,D0` clear il bit0 PRIMA del cast a pointer ⇒ il vero
 *     `body_ptr` è `header[+8] & ~1` (allineato a even).
 *
 * **Body layout — modalità "word-stream" (long branch)**:
 *   Si attiva quando il primo byte del body (`body[0]`) NON è `0xFF`.
 *   - `body[0]` = count (D6b, n. iterazioni del loop).
 *   - `body[1]` = byte signed sommato a (arg1 + header[+0]) ⇒ pre-shift X.
 *   - `body[2]` = byte OR'd nel low byte di D4w (high mask: alti 8 bit
 *     di "categoria/flags" del 3° output, A3).
 *   - `body[3]` = byte signed sommato a (arg2 + header[+1]) ⇒ pre-shift Y.
 *   - `body[4..]` = N word (1 word/iter), ognuna OR'd con arg3 ⇒ 1° output.
 *   Per iter i (1..N):
 *     A1: `(word_i | arg3) & 0xFFFF`         (1° output, "code/sprite" + flags)
 *     A2: `D1w` (= X corrente, scalato 0x3FE0 inizialmente, poi += D5w)
 *     A3: `D2w` (= Y scalato, costante per tutto il loop)
 *     A4: `D7w` (counter cumulativo, post-inc)
 *
 * **Body layout — modalità "triple-stream" (short branch)**:
 *   Si attiva quando `body[0] == 0xFF`. Il binario fa `addq.l #1,A0` per
 *   skippare un byte addizionale, quindi consume:
 *   - `body[2]` = count (D6b).
 *   - `body[3]` = byte signed sommato a (arg1 + header[+0]) ⇒ pre-shift X.
 *   - `body[4..]` = sequenza di N triple `(byte_d4, byte_d2_delta, word)`,
 *     6 byte/iter.
 *   Per iter i (1..N):
 *     A2: `D1w`                                (X scalato, += D5w post-iter)
 *     A3: `((D2_orig + byte_d2_delta) << 5 & 0x3FE0) | D4_high8 | D4_byte_or`
 *         dove D4 mantiene `D4 & 0x8000` (high-bit-flag) e accumula `byte_d4`
 *         nel low byte (NUOVO byte ogni iter, NON accumulato tra iter perché
 *         D4 viene re-mascherato a 0x8000 ad ogni inizio iter).
 *     A1: `(word_i | arg3) & 0xFFFF`
 *     A4: `D7w`
 *
 *   IMPORTANTE: in short-branch D2 NON viene pre-trasformato (asl/and) prima
 *   del loop come in long-branch — il calcolo `D0 = (D2 + delta) << 5 & 0x3FE0`
 *   avviene ad ogni iter usando il **D2 originale** (= arg2 + header[+1]),
 *   poi OR con D4 e scritto. Cioè D2 stesso non è mai scritto a (A3): è D0
 *   ad essere scritto.
 *
 *   Inoltre in short-branch il **primo output** di ogni iter è A2 (D1),
 *   non A1 come nel long-branch. L'ordine è: A2, A3, A1, A4.
 *   In long-branch è: A1, A2, A3, A4.
 *
 * **Disasm** — vedi `tools/ghidra_disasm_at.py 0x1A8D2`.
 *
 *   0x1A8D2: movem.l {A4..D2},-(SP)             ; preserve 9 reg (36 byte)
 *   0x1A8D6: movea.l (0x28,SP),A0               ; A0 = arg0 ptr
 *   0x1A8DA: move.w  (0x2E,SP),D1w              ; D1w = arg1 word
 *   0x1A8DE: move.w  (0x32,SP),D2w              ; D2w = arg2 word
 *   0x1A8E2: move.w  (0x36,SP),D3w              ; D3w = arg3 word
 *   0x1A8E6: A1 = *workRam[0x3FA]               ; output cursor 1 (A1 dest)
 *   0x1A8EC: A2 = *workRam[0x3FE]               ; output cursor 2 (A2 dest)
 *   0x1A8F2: A3 = *workRam[0x3F6]               ; output cursor 3 (A3 dest)
 *   0x1A8F8: A4 = *workRam[0x402]               ; output cursor 4 (A4 dest)
 *   0x1A8FE: D7 = *workRam[0x406].w             ; counter
 *   0x1A904: if (arg0_ptr == -1) goto exit
 *
 *   ; Header read (4 byte struct + long ptr)
 *   0x1A90C: D1w += sign_ext_byte(*A0)           ; X bias
 *   0x1A912: D2w += sign_ext_byte(*(A0+1))       ; Y bias
 *   0x1A91A: D0  = *long(A0+8)                   ; body_ptr (with bit0 flag)
 *   0x1A91E: bclr.l #0,D0; flag = (bit0 of D0 BEFORE clear)
 *   0x1A922: if (flag == 0) goto FLAG_LO
 *   0x1A924:    D4w = 0x8000;  D5w = 0xFF00   (high-bit set, decrement step)
 *   0x1A92C:    bra A0_load
 *   0x1A92E: FLAG_LO: D4w = 0;  D5w = 0x0100  (low-bit, increment step)
 *   0x1A934: A0_load: A0 = D0 (body_ptr)
 *
 *   0x1A936: D6b = *(A0)+
 *   0x1A93C: if (D6b == 0xFF) goto SHORT_BRANCH
 *
 *   ; LONG BRANCH (word-stream): body[0]=count, body[1..3]=header bytes,
 *   ; body[4..] = N word.
 *   0x1A93E: D1w += sign_ext_byte(*(A0)+);  D1w = (D1w << 5) & 0x3FE0
 *   0x1A94A: D4b |= *(A0)+                  ; high-mask byte
 *   0x1A94C: D2w += sign_ext_byte(*(A0)+);  D2w = (D2w << 5) & 0x3FE0; D2w |= D4w
 *
 *   ; LONG_LOOP:
 *   0x1A95A: D0w = *(A0)+ word
 *   0x1A95C: D0w |= D3w
 *   0x1A95E: *(A1)+ = D0w
 *   0x1A960: *(A2)+ = D1w
 *   0x1A962: *(A3)+ = D2w
 *   0x1A964: *(A4)+ = D7w
 *   0x1A966: D7w += 1
 *   0x1A968: D1w += D5w
 *   0x1A96A: D6b -= 1; if (D6b != 0) goto LONG_LOOP
 *   0x1A96E: bra exit
 *
 *   ; SHORT BRANCH (triple-stream): body[2]=count, body[3]=X-delta byte
 *   ;   body[4..] = N triples (byte_d4, byte_d2_delta, word).
 *   0x1A970: A0 += 1                        ; skip 1 byte (header was 0xFF)
 *   0x1A972: D6b = *(A0)+                   ; count
 *   0x1A974: D1w += sign_ext_byte(*(A0)+);  D1w = (D1w << 5) & 0x3FE0
 *
 *   ; SHORT_LOOP:
 *   0x1A980: *(A2)+ = D1w
 *   0x1A982: D4w &= 0x8000                  ; KEEP high-bit, CLEAR low byte
 *   0x1A986: D4b |= *(A0)+                  ; new high-mask byte
 *   0x1A988: D0w = D2w + sign_ext_byte(*(A0)+); D0w = (D0w << 5) & 0x3FE0
 *   0x1A994: D0w |= D4w
 *   0x1A996: *(A3)+ = D0w
 *   0x1A998: D0w = *(A0)+ word; D0w |= D3w
 *   0x1A99C: *(A1)+ = D0w
 *   0x1A99E: *(A4)+ = D7w
 *   0x1A9A0: D7w += 1
 *   0x1A9A2: D1w += D5w
 *   0x1A9A4: D6b -= 1; if (D6b != 0) goto SHORT_LOOP
 *
 *   ; EXIT:
 *   0x1A9A8: writeback A1,A2,A3,A4 → workRam[0x3FA, 0x3FE, 0x3F6, 0x402]
 *   0x1A9C0: writeback D7w → workRam[0x406]
 *   0x1A9C6: movem.l (SP)+,...; rts
 *
 * **Modellazione bit-perfect**:
 *
 *   1. **Word arg sign-ext**: `move.w (0x2E,SP),D1w` legge 2 byte BE dal
 *      caller-pushed long e ZERO-EXT in D1w (move.w mantiene low word, alti
 *      16 bit di D1 sono indeterminati MA non sono mai letti come long ⇒
 *      irrilevante). Il modello tiene D1/D2/D3 in `& 0xFFFF`.
 *
 *   2. **`ext.w D0w`** dopo `move.b (...),D0b`: sign-ext byte→word. Modellato
 *      con `(byte << 24) >> 24` (signed) e cast a 16-bit con `& 0xFFFF`.
 *      L'add `add.w D0w,D1w` opera in 16-bit (`& 0xFFFF` post-add).
 *
 *   3. **`asl.w #5,D1w; andi.w #0x3FE0,D1w`**: shift logico 5 + mask =
 *      `(D1w * 32) & 0x3FE0`. Il mask `0x3FE0 = 0011_1111_1110_0000`
 *      tiene i bit 5..13. JS: `((d1w << 5) & 0x3FE0)`. Sicuro perché
 *      input è 16-bit pre-shift.
 *
 *   4. **`bclr.l #0,D0`**: cancella bit0 di D0 (long), Z = (bit0 was 0).
 *      Modellato come `flag = D0 & 1; D0 = D0 & ~1`. Z = !flag (the beq
 *      taken means flag was 0).
 *
 *   5. **`add.w D5w,D1w`** con D5w == 0xFF00: in 16-bit 2's-complement
 *      è -0x100. Modellato come `(D1w + D5w) & 0xFFFF` (wrap word).
 *
 *   6. **`andi.w #-0x8000,D4w`** = `D4w & 0x8000` (mask bit 15 only).
 *      In short-branch ad ogni iter D4 viene "resettato" tenendo solo il
 *      bit 15, poi D4b è OR'd con un nuovo byte. Quindi tra iter il low
 *      byte di D4 NON si accumula.
 *
 *   7. **Output cursor cross-region**: i pointer @ 0x3F6/3FA/3FE/402
 *      tipicamente puntano a sprite-RAM (0xA02xxx). Le scritture word
 *      `move.w Dn,(An)+` toccano sprite-RAM. Il modello dispatcha la
 *      scrittura via `writeWordAbs` con region routing
 *      (workRam/spriteRam/alphaRam/colorRam).
 *
 *   8. **Header reads cross-region**: `*long(A0+8)` legge 4 byte BE dal
 *      ptr di header. Anche A0 può puntare ovunque (in pratica ROM o
 *      workRam). Il modello dispatcha via `readByteAbs` / `readLongAbs`.
 *
 *   9. **Early exit `arg0 == -1`**: in early exit i 4 cursor + D7 counter
 *      vengono ri-scritti in workRam (no-op se già al valore corretto).
 *      Il modello replica il writeback anche in early-exit per parità
 *      bit-perfect (nessuna divergenza visibile, ma per completezza).
 *
 *   10. **D7w wrap**: counter `addq.w #1,D7w` opera in 16-bit; al 0xFFFF
 *       successivo wrappa a 0. Il modello mantiene D7 in `& 0xFFFF`.
 *
 *   11. **Stride della header**: il binario legge `(0,A0)`, `(1,A0)`,
 *       `(8,A0)`. La struct header è quindi almeno 12 byte (offset 8 long
 *       = 8..11). Offsets 2..7 non sono letti.
 *
 *   12. **Body data origin**: body_ptr (= header[+8] & ~1) può puntare a
 *       ROM, workRam o ovunque. Le `(A0)+` byte/word reads sono dispatchate
 *       via `readByteAbs` / `readWordAbs` (region routing).
 *
 * **Side effect bit-perfect**:
 *   - Letture: header @ arg0 (1+1+4 byte = 6 byte usati), body @ body_ptr
 *     (variabile), workRam[0x3F6..0x405] (5 long + 1 word = 24 byte).
 *   - Scritture: variabili in sprite/work/alpha/color RAM (4 buffer paralleli),
 *     workRam[0x3F6..0x405] (writeback finale).
 *
 * Verifica bit-perfect via `packages/cli/src/test-mo-block-emit-1a8d2-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── Region constants ────────────────────────────────────────────────────────

/** Base assoluta workRam M68k. */
const WORK_RAM_BASE = 0x400000;
const WORK_RAM_END = 0x402000;
const PF_RAM_BASE = 0xa00000;
const PF_RAM_END = 0xa02000;
const SPRITE_RAM_BASE = 0xa02000;
const SPRITE_RAM_END = 0xa03000;
const ALPHA_RAM_BASE = 0xa03000;
const ALPHA_RAM_END = 0xa04000;
const PAL_RAM_BASE = 0xb00000;
const PAL_RAM_END = 0xb00800;

// ─── Cursor / state addresses ────────────────────────────────────────────────

/** Output cursor "A1" (1° buffer, write target dei `*(A1)+ = word`) — long. */
export const CURSOR_A1_ADDR = 0x004003fa as const;
/** Output cursor "A2" (2° buffer) — long. */
export const CURSOR_A2_ADDR = 0x004003fe as const;
/** Output cursor "A3" (3° buffer) — long. */
export const CURSOR_A3_ADDR = 0x004003f6 as const;
/** Output cursor "A4" (4° buffer) — long. */
export const CURSOR_A4_ADDR = 0x00400402 as const;
/** Counter D7 (incrementato di 1 per ogni iter del body loop) — word. */
export const COUNTER_D7_ADDR = 0x00400406 as const;

/** Sentinel "no-op" arg0 (-1 long) — in tale caso solo writeback dei cursor. */
export const ARG0_SENTINEL = 0xffffffff as const;

// ─── Helpers — cross-region reads/writes ────────────────────────────────────

/**
 * Legge 1 byte dall'indirizzo M68k assoluto, con region routing
 * (ROM via subs.romRead, workRam, spriteRam, alphaRam, colorRam).
 */
function readByteAbs(
  state: GameState,
  abs: number,
  romRead: (off: number) => number,
): number {
  const a = abs >>> 0;
  // ROM: assume 0..ROM_SIZE handled by romRead (caller sets program length).
  if (a < 0x080000) {
    return romRead(a) & 0xff;
  }
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    return (state.workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
  }
  if (a >= PF_RAM_BASE && a < PF_RAM_END) {
    // PF tilemap RAM (placeholder shares workRam in current model).
    return (state.workRam[a - PF_RAM_BASE] ?? 0) & 0xff;
  }
  if (a >= SPRITE_RAM_BASE && a < SPRITE_RAM_END) {
    return (state.spriteRam[a - SPRITE_RAM_BASE] ?? 0) & 0xff;
  }
  if (a >= ALPHA_RAM_BASE && a < ALPHA_RAM_END) {
    // Alpha RAM placeholder shares spriteRam.
    return (state.spriteRam[a - ALPHA_RAM_BASE] ?? 0) & 0xff;
  }
  if (a >= PAL_RAM_BASE && a < PAL_RAM_END) {
    return (state.colorRam[a - PAL_RAM_BASE] ?? 0) & 0xff;
  }
  return 0;
}

/** Legge 2 byte BE come unsigned 16-bit (cross-region). */
function readWordAbs(
  state: GameState,
  abs: number,
  romRead: (off: number) => number,
): number {
  const hi = readByteAbs(state, abs, romRead);
  const lo = readByteAbs(state, abs + 1, romRead);
  return ((hi << 8) | lo) & 0xffff;
}

/** Legge 4 byte BE come unsigned 32-bit (cross-region). */
function readLongAbs(
  state: GameState,
  abs: number,
  romRead: (off: number) => number,
): number {
  const w0 = readWordAbs(state, abs, romRead);
  const w1 = readWordAbs(state, abs + 2, romRead);
  return ((w0 << 16) | w1) >>> 0;
}

/**
 * Scrive 1 byte all'indirizzo M68k assoluto, con region routing.
 * ROM è readonly: i write a ROM sono no-op (silente).
 */
function writeByteAbs(state: GameState, abs: number, value: number): void {
  const a = abs >>> 0;
  const v = value & 0xff;
  if (a < 0x080000) {
    return; // ROM: readonly
  }
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    state.workRam[a - WORK_RAM_BASE] = v;
    return;
  }
  if (a >= PF_RAM_BASE && a < PF_RAM_END) {
    state.workRam[a - PF_RAM_BASE] = v;
    return;
  }
  if (a >= SPRITE_RAM_BASE && a < SPRITE_RAM_END) {
    state.spriteRam[a - SPRITE_RAM_BASE] = v;
    return;
  }
  if (a >= ALPHA_RAM_BASE && a < ALPHA_RAM_END) {
    state.spriteRam[a - ALPHA_RAM_BASE] = v;
    return;
  }
  if (a >= PAL_RAM_BASE && a < PAL_RAM_END) {
    state.colorRam[a - PAL_RAM_BASE] = v;
    return;
  }
  // Out of mapped regions: no-op.
}

/** Scrive 2 byte BE (cross-region). */
function writeWordAbs(state: GameState, abs: number, value: number): void {
  const v = value & 0xffff;
  writeByteAbs(state, abs, (v >>> 8) & 0xff);
  writeByteAbs(state, abs + 1, v & 0xff);
}

/** Scrive 4 byte BE (cross-region). */
function writeLongAbs(state: GameState, abs: number, value: number): void {
  const v = value >>> 0;
  writeWordAbs(state, abs, (v >>> 16) & 0xffff);
  writeWordAbs(state, abs + 2, v & 0xffff);
}

/** Sign-extend byte (8-bit) → JS signed integer. */
function s8(b: number): number {
  const x = b & 0xff;
  return x & 0x80 ? x - 0x100 : x;
}

// ─── Subs (testabilità) ──────────────────────────────────────────────────────

/**
 * Hook per leggere ROM byte (offset assoluto). Default: nullo (ritorna 0).
 *
 * I caller production passano `(off) => rom.program[off] ?? 0`. Esposto come
 * subs per disaccoppiare il modulo dalla `RomImage` (e permettere injection
 * di una ROM stub nei test).
 */
export interface MoBlockEmit1A8D2Subs {
  /**
   * Lettura byte ROM @ offset `off` (assoluto, < 0x80000). Default ritorna 0.
   *
   * @param off  Offset ROM assoluto (M68k addr quando < 0x80000).
   * @returns    Byte unsigned 8-bit (0..0xFF).
   */
  romRead?: (off: number) => number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Replica `FUN_0001A8D2` — sprite/MO block emit con header-pointed body.
 *
 * Vedi semantica completa nell'header del file. Mutation: i 4 buffer indicati
 * dai cursor pointer in workRam[0x3F6/3FA/3FE/402], il counter D7 in
 * workRam[0x406], e i cursor stessi (writeback finale).
 *
 * @param state    GameState (workRam letto/scritto, sprite/alpha/color
 *                 scritti via cursor cross-region).
 * @param arg0Ptr  Pointer assoluto M68k al header struct, o `0xFFFFFFFF`
 *                 (-1 long) per early-exit.
 * @param arg1     Word arg1 (X bias). Solo i 16 bit bassi sono usati.
 * @param arg2     Word arg2 (Y bias). Solo i 16 bit bassi sono usati.
 * @param arg3     Word arg3 (OR mask sull'output A1).
 * @param subs     Callback bag (default: ROM read = 0).
 */
export function moBlockEmit1A8D2(
  state: GameState,
  arg0Ptr: number,
  arg1: number,
  arg2: number,
  arg3: number,
  subs: MoBlockEmit1A8D2Subs = {},
): void {
  const romRead = subs.romRead ?? ((_o: number): number => 0);

  // 0x1A8DA..0x1A8E2: load arg words (low 16 bit).
  let D1 = arg1 & 0xffff;
  let D2 = arg2 & 0xffff;
  const D3 = arg3 & 0xffff;

  // 0x1A8E6..0x1A8FE: load cursor pointers + counter from workRam.
  let A1 = readLongAbs(state, CURSOR_A1_ADDR, romRead) >>> 0;
  let A2 = readLongAbs(state, CURSOR_A2_ADDR, romRead) >>> 0;
  let A3 = readLongAbs(state, CURSOR_A3_ADDR, romRead) >>> 0;
  let A4 = readLongAbs(state, CURSOR_A4_ADDR, romRead) >>> 0;
  let D7 = readWordAbs(state, COUNTER_D7_ADDR, romRead) & 0xffff;

  const ptr = arg0Ptr >>> 0;

  // 0x1A904..0x1A908: if (arg0_ptr == -1) early-exit (only writeback).
  if (ptr !== ARG0_SENTINEL) {
    // 0x1A90C: D1w += sign_ext_byte(*(A0+0))
    const xBiasByte = readByteAbs(state, ptr, romRead);
    D1 = (D1 + s8(xBiasByte)) & 0xffff;

    // 0x1A912: D2w += sign_ext_byte(*(A0+1))
    const yBiasByte = readByteAbs(state, ptr + 1, romRead);
    D2 = (D2 + s8(yBiasByte)) & 0xffff;

    // 0x1A91A: D0 = *long(A0+8); flag = D0 & 1; D0 = D0 & ~1
    const headerLong = readLongAbs(state, ptr + 8, romRead) >>> 0;
    const flagBit0 = headerLong & 1;
    const bodyPtr = (headerLong & ~1) >>> 0;

    // 0x1A922..0x1A930: branch on flag.
    let D4: number;
    let D5: number;
    if (flagBit0 !== 0) {
      // bit0 was 1: D4w = 0x8000, D5w = 0xFF00 (decrement step).
      D4 = 0x8000;
      D5 = 0xff00;
    } else {
      // bit0 was 0: D4w = 0, D5w = 0x0100.
      D4 = 0x0000;
      D5 = 0x0100;
    }

    // 0x1A934: A0 = body_ptr.
    let A0 = bodyPtr;

    // 0x1A936: D6b = *(A0)+
    let D6 = readByteAbs(state, A0, romRead) & 0xff;
    A0 = (A0 + 1) >>> 0;

    // 0x1A938..0x1A93C: if (D6b == 0xFF) → SHORT_BRANCH.
    if (D6 === 0xff) {
      // ─── SHORT BRANCH (triple-stream) ────────────────────────────────────

      // 0x1A970: A0 += 1 (skip 1 byte).
      A0 = (A0 + 1) >>> 0;

      // 0x1A972: D6b = *(A0)+   (real count).
      D6 = readByteAbs(state, A0, romRead) & 0xff;
      A0 = (A0 + 1) >>> 0;

      // 0x1A974: D1w += sign_ext_byte(*(A0)+); D1w = (D1w << 5) & 0x3FE0
      const dxByte = readByteAbs(state, A0, romRead);
      A0 = (A0 + 1) >>> 0;
      D1 = (D1 + s8(dxByte)) & 0xffff;
      D1 = ((D1 << 5) & 0x3fe0) & 0xffff;

      // SHORT_LOOP @ 0x1A980 — `subq.b/bne` ⇒ do/while
      // (D6 == 0 in ingresso ⇒ 256 iter; D6 == 1 ⇒ 1 iter).
      do {
        // 0x1A980: *(A2)+ = D1w
        writeWordAbs(state, A2, D1);
        A2 = (A2 + 2) >>> 0;

        // 0x1A982: D4w &= 0x8000   (clear low byte, KEEP high bit-15).
        D4 = D4 & 0x8000;

        // 0x1A986: D4b |= *(A0)+
        const d4Byte = readByteAbs(state, A0, romRead);
        A0 = (A0 + 1) >>> 0;
        D4 = (D4 & 0xff00) | ((D4 | d4Byte) & 0xff);

        // 0x1A988: D0w = D2w + sign_ext_byte(*(A0)+); D0w = (D0w << 5) & 0x3FE0;
        // D0w |= D4w
        const dyByte = readByteAbs(state, A0, romRead);
        A0 = (A0 + 1) >>> 0;
        let D0 = (D2 + s8(dyByte)) & 0xffff;
        D0 = ((D0 << 5) & 0x3fe0) & 0xffff;
        D0 = (D0 | D4) & 0xffff;

        // 0x1A996: *(A3)+ = D0w
        writeWordAbs(state, A3, D0);
        A3 = (A3 + 2) >>> 0;

        // 0x1A998..0x1A99C: D0w = *(A0)+ word; D0w |= D3w; *(A1)+ = D0w
        const wordVal = readWordAbs(state, A0, romRead);
        A0 = (A0 + 2) >>> 0;
        const a1Out = (wordVal | D3) & 0xffff;
        writeWordAbs(state, A1, a1Out);
        A1 = (A1 + 2) >>> 0;

        // 0x1A99E: *(A4)+ = D7w
        writeWordAbs(state, A4, D7);
        A4 = (A4 + 2) >>> 0;

        // 0x1A9A0: D7w += 1
        D7 = (D7 + 1) & 0xffff;

        // 0x1A9A2: D1w += D5w
        D1 = (D1 + D5) & 0xffff;

        // 0x1A9A4: D6b -= 1
        D6 = (D6 - 1) & 0xff;
      } while (D6 !== 0);
    } else {
      // ─── LONG BRANCH (word-stream) ────────────────────────────────────────

      // 0x1A93E: D1w += sign_ext_byte(*(A0)+); D1w = (D1w << 5) & 0x3FE0
      const dxByte = readByteAbs(state, A0, romRead);
      A0 = (A0 + 1) >>> 0;
      D1 = (D1 + s8(dxByte)) & 0xffff;
      D1 = ((D1 << 5) & 0x3fe0) & 0xffff;

      // 0x1A94A: D4b |= *(A0)+
      const d4Byte = readByteAbs(state, A0, romRead);
      A0 = (A0 + 1) >>> 0;
      D4 = (D4 & 0xff00) | ((D4 | d4Byte) & 0xff);

      // 0x1A94C: D2w += sign_ext_byte(*(A0)+); D2w = (D2w << 5) & 0x3FE0;
      // D2w |= D4w
      const dyByte = readByteAbs(state, A0, romRead);
      A0 = (A0 + 1) >>> 0;
      D2 = (D2 + s8(dyByte)) & 0xffff;
      D2 = ((D2 << 5) & 0x3fe0) & 0xffff;
      D2 = (D2 | D4) & 0xffff;

      // LONG_LOOP @ 0x1A95A — `subq.b/bne` ⇒ do/while
      // (D6 == 0 in ingresso ⇒ 256 iter; D6 == 1 ⇒ 1 iter).
      do {
        // 0x1A95A..0x1A95E: D0w = *(A0)+ word; D0w |= D3w; *(A1)+ = D0w
        const wordVal = readWordAbs(state, A0, romRead);
        A0 = (A0 + 2) >>> 0;
        const a1Out = (wordVal | D3) & 0xffff;
        writeWordAbs(state, A1, a1Out);
        A1 = (A1 + 2) >>> 0;

        // 0x1A960: *(A2)+ = D1w
        writeWordAbs(state, A2, D1);
        A2 = (A2 + 2) >>> 0;

        // 0x1A962: *(A3)+ = D2w
        writeWordAbs(state, A3, D2);
        A3 = (A3 + 2) >>> 0;

        // 0x1A964: *(A4)+ = D7w
        writeWordAbs(state, A4, D7);
        A4 = (A4 + 2) >>> 0;

        // 0x1A966: D7w += 1
        D7 = (D7 + 1) & 0xffff;

        // 0x1A968: D1w += D5w
        D1 = (D1 + D5) & 0xffff;

        // 0x1A96A: D6b -= 1
        D6 = (D6 - 1) & 0xff;
      } while (D6 !== 0);
    }
  }

  // 0x1A9A8..0x1A9C0: writeback A1, A2, A3, A4 (long), D7 (word).
  writeLongAbs(state, CURSOR_A1_ADDR, A1);
  writeLongAbs(state, CURSOR_A2_ADDR, A2);
  writeLongAbs(state, CURSOR_A3_ADDR, A3);
  writeLongAbs(state, CURSOR_A4_ADDR, A4);
  writeWordAbs(state, COUNTER_D7_ADDR, D7);
}
