/**
 * object-step-17f66.ts — replica `FUN_00017F66` (344 byte) bit-perfect.
 *
 * Sub di "step" su un oggetto-entita' (struct puntata da A2, arg long sullo
 * stack). Decide tra 3 path:
 *
 *   1. **Skip** (`(0x18,A2) ∈ {2,3}`) → ritorna senza side-effect.
 *   2. **Special-dispatch** (`*0x400390 == 1`) → chiama `FUN_1815A(A2)` e
 *      ritorna.
 *   3. **Movement / stuck**: legge byte di "stato/comando" `(0x58,A2)` e
 *      sceglie tra:
 *        - **Movement path** (whitelist comandi: byte ∈ {0, 0x2D-0x31,
 *          0x38-0x3B}): se `*0x400396 == 1` chiama `FUN_180BE()` (no args),
 *          altrimenti scrive 2 byte globali, calcola dx/dy scalati e
 *          aggiorna `(A2)+0` / `(A2)+4` (long add).
 *        - **Stuck path** (`(0x36,A2) == 2` oppure byte fuori whitelist): se
 *          `(0x36,A2) != 0`, sottrae 0x6000 da `(0x8,A2)` (long); se il byte
 *          di comando ha bit7 set, **clamp** `(0x8,A2) = -0x50000`.
 *      Entrambi i path terminano chiamando `FUN_26196(A2)`.
 *
 * **Disasm 0x17F66..0x180BD** (344 byte, 1 arg long, 0 ret):
 *
 *   0x17F66  movem.l { A2 D3 D2 }, -(SP)         ; preserve callee-saved
 *   0x17F6A  movea.l (0x10,SP), A2                ; A2 = arg1 (struct ptr)
 *   0x17F6E  cmpi.b  #0x2, (0x18,A2)
 *   0x17F74  beq.w   0x180B8                      ; skip path
 *   0x17F78  cmpi.b  #0x3, (0x18,A2)
 *   0x17F7E  beq.w   0x180B8                      ; skip path
 *   0x17F82  moveq   #1, D0
 *   0x17F84  cmp.w   (0x400390).l, D0w
 *   0x17F8A  bne.b   0x17F9A
 *   0x17F8C  move.l  A2, -(SP)                    ; FUN_1815A(A2)
 *   0x17F8E  jsr     0x1815A.l
 *   0x17F94  addq.l  #4, SP
 *   0x17F96  bra.w   0x180B8                      ; skip epilogue (no jsr 26196)
 *
 *   0x17F9A  move.b  (0x58,A2), D0b               ; D0 = command byte
 *   0x17F9E  cmpi.b  #0x2, (0x36,A2)
 *   0x17FA4  beq.w   0x1808E                      ; stuck if state36 == 2
 *   0x17FA8  tst.b   D0b                           ; whitelist tests
 *   0x17FAA  beq.w   0x17FF6                       ; D0 == 0 → movement
 *   0x17FAE  cmpi.b  #0x3B, D0b → 0x17FF6
 *   0x17FB6  cmpi.b  #0x2D, D0b → 0x17FF6
 *   0x17FBE  cmpi.b  #0x2E, D0b → 0x17FF6
 *   0x17FC6  cmpi.b  #0x38, D0b → 0x17FF6
 *   0x17FCE  cmpi.b  #0x39, D0b → 0x17FF6
 *   0x17FD6  cmpi.b  #0x3A, D0b → 0x17FF6
 *   0x17FDE  cmpi.b  #0x2F, D0b → 0x17FF6
 *   0x17FE6  cmpi.b  #0x30, D0b → 0x17FF6
 *   0x17FEE  cmpi.b  #0x31, D0b → 0x17FF6 ELSE → 0x1808E
 *
 *   ; Movement path:
 *   0x17FF6  moveq   #1, D0
 *   0x17FF8  cmp.w   (0x400396).l, D0w
 *   0x17FFE  bne.b   0x18008
 *   0x18000  jsr     0x180BE.l                    ; FUN_180BE() no args
 *   0x18006  bra.b   0x18018                      ; salta lo store dei due byte
 *   0x18008  move.b  (0xC6,A2), (0x4006AA).l
 *   0x18010  move.b  (0xC7,A2), (0x4006A8).l
 *
 *   0x18018  move.b  (0x4006A8).l, D3b
 *   0x1801E  ext.w   D3w                           ; sign-ext byte → word
 *   0x18020  ext.l   D3                            ; word → long
 *   0x18022  move.b  (0x4006AA).l, D2b
 *   0x18028  ext.w   D2w; ext.l D2; neg.l D2       ; D2 = -sext(byte)
 *   0x1802E  move.w  D3w, D0w; ext.l D0
 *   0x18032  muls.w  #0x160, D0                    ; D0 = D3w * 0x160 (signed)
 *   0x18036  move.l  D0, D3
 *   0x18038  move.w  D2w, D0w; ext.l D0
 *   0x1803C  muls.w  #0x160, D0
 *   0x18040  move.l  D0, D2
 *
 *   ; Optional scaling block (mode in 0x1A,A2 ∈ {1, 5}):
 *   0x18042  cmpi.b  #1, (0x1A,A2); beq 0x18054
 *   0x1804C  cmpi.b  #5, (0x1A,A2); bne 0x18082    ; skip scaling
 *   0x18054  moveq   #0x1F, D1
 *   0x18056  move.b  (0x56,A2), D0b; ext.w D0w
 *   0x1805C  sub.w   D0w, D1w                      ; D1.w = 0x1F - sext(byte)
 *   0x1805E  cmpi.b  #5, (0x1A,A2); bne 0x1806E
 *   0x18066  moveq   #4, D0; cmp.w D1w, D0w; ble.b 0x1806E
 *   0x1806C  moveq   #4, D1                        ; clamp D1 = max(D1, 4)
 *   0x1806E  move.l  D3, D0; asr.l #8, D0
 *   0x18072  muls.w  D1w, D0; asl.l #3, D0
 *   0x18076  move.l  D0, D3
 *   0x18078  move.l  D2, D0; asr.l #8, D0
 *   0x1807C  muls.w  D1w, D0; asl.l #3, D0
 *   0x18080  move.l  D0, D2
 *
 *   0x18082  move.l  D3, D0; add.l D0, (A2)        ; (A2)+0 += dx
 *   0x18086  move.l  D2, D0; add.l D0, (4,A2)      ; (A2)+4 += dy
 *   0x1808C  bra.b   0x180AE                       ; jsr FUN_26196
 *
 *   ; Stuck path:
 *   0x1808E  tst.b   (0x36,A2); beq.b 0x180AE      ; if state36 == 0 skip
 *   0x18094  addi.l  #-0x6000, (0x8,A2)            ; (8,A2) -= 0x6000 (long)
 *   0x1809C  cmpi.l  #-0x50000, (0x8,A2)           ; cmp (8,A2) con -0x50000
 *   0x180A4  bge.b   0x180AE                        ; (8,A2) >= -0x50000 → skip
 *   0x180A6  move.l  #-0x50000, (0x8,A2)            ; clamp MIN a -0x50000
 *
 *   ; Common epilogue (movement / stuck):
 *   0x180AE  move.l  A2, -(SP); jsr 0x26196.l; addq.l #4, SP
 *   0x180B8  movem.l (SP)+, { D2 D3 A2 }
 *   0x180BC  rts
 *
 * **Modello bit-perfect**:
 *
 *   1. **`(0x18,A2) ∈ {2,3}`**: due `cmpi.b + beq` consecutivi. Skip pulito,
 *      nessun side-effect, nessuna jsr.
 *
 *   2. **`*0x400390 == 1`**: `cmp.w (0x400390).l, D0w` con `D0=1`. Confronto
 *      a livello WORD del valore (long globale, ma solo low word usato).
 *      Stessa cosa per `*0x400396` nel movement path.
 *
 *   3. **Whitelist `(0x58,A2)`**: 10 valori ammessi: `{0x00, 0x2D, 0x2E,
 *      0x2F, 0x30, 0x31, 0x38, 0x39, 0x3A, 0x3B}`. Se NON in whitelist →
 *      stuck path.
 *
 *   4. **`muls.w #0x160`**: il valore D3 prima dello shift e' `byte * 0x160`
 *      con `byte` signed (range [-128,127] × 352 = [-45056, 44704]). Sta in
 *      32-bit. Idem D2 (con sign flip via `neg.l`).
 *
 *   5. **`asr.l #8`**: in M68k il count di una shift register (numero, non
 *      register) e' modulo 64. ASR.L #8 significa shift right aritmetico 8.
 *      Per JS: `(d3 >> 8) | 0` (signed shift su i32). Ma D3 era stato scritto
 *      come long signed da `muls.w`, quindi e' i32 in JS bit-perfect.
 *
 *   6. **`muls.w D1w, D0`**: usa solo low word di D1 e di D0. D1 dopo
 *      `0x1F - sext.w(byte)` puo' essere [0x1F-127, 0x1F+128] = [-96, 159],
 *      che in word = [0xFFA0..0x009F] → low word signed: range -96..159. Per
 *      D0 dopo asr.l #8: low word puo' essere qualsiasi.
 *
 *   7. **`asl.l #3`**: shift left 3. In JS: `(d * 8) | 0`. Possibile overflow
 *      out of 32-bit → discardiamo gli alti.
 *
 *   8. **`add.l D0, (A2)`**: long add su memoria (big-endian 4 byte). Modulo 2^32.
 *
 *   9. **`addi.l #-0x6000, (0x8,A2)`**: long add su memoria. Sets flags ma le
 *      flag vengono ricalcolate dal `cmpi.l` immediato successivo.
 *
 *   10. **`cmpi.l #-0x50000, (0x8,A2); bge`**: cmp.l calcola
 *       `(0x8,A2) - (-0x50000)`. bge ≡ result ≥ 0 signed ≡ `(0x8,A2) >=
 *       -0x50000` signed. Se true, salta lo store. Altrimenti (cioe' se
 *       `(0x8,A2) < -0x50000` signed dopo l'`addi`), CLAMP MIN al valore
 *       -0x50000 (= 0xFFFB0000 unsigned).
 *
 *   11. **`move.l #-0x50000, (0x8,A2)`**: long literal -0x50000 = 0xFFFB0000.
 *
 * **Callees** (3, non ancora replicati in TS — esposti come callback):
 *   - `FUN_1815A(A2)` — special-dispatch. Riceve A2 long sullo stack.
 *   - `FUN_180BE()` — alt-source per i 2 byte (no args, no ret). Modifica
 *     workRam @ 0x4006A8 / 0x4006AA "in qualche altro modo" (TBD).
 *   - `FUN_26196(A2)` — post-step. Riceve A2 long sullo stack.
 *
 *   Pattern higher-order: il chiamante passa `callees` come oggetto di
 *   callback. La parita' vs il binario si verifica patchando le 3 sub con
 *   stub osservabili (vedi `cli/src/test-object-step-17f66-parity.ts`).
 *
 * **Side effects** sintetici:
 *   - skip path (`state18 ∈ {2,3}`): nessuno.
 *   - special-dispatch (`global390 == 1`): `callees.fun1815A(a2)`.
 *   - movement path (whitelist & state36 != 2):
 *       se `global396 == 1`: `callees.fun180BE()`
 *       altrimenti: scrive `0x4006AA` e `0x4006A8` (2 byte da (0xC6,A2) /
 *       (0xC7,A2)).
 *       Poi: `(A2)+=dx`, `(4,A2)+=dy` con dx/dy long calcolati da byte
 *       signed * 0x160, eventualmente scalati da (0x1A,A2) ∈ {1,5}.
 *       Infine: `callees.fun26196(a2)`.
 *   - stuck path (whitelist fail OR state36==2):
 *       se `state36 != 0`:
 *         `(8,A2) -= 0x6000` (long, modulo 2^32).
 *         se `(8,A2)` (post-addi, signed) `< -0x50000`: clamp a -0x50000.
 *       Poi: `callees.fun26196(a2)`.
 *
 * **Layout struct** (bytes letti/scritti relativi ad A2):
 *   - +0x00..+0x03 : long pos.x   (R+W: += dx)
 *   - +0x04..+0x07 : long pos.y   (R+W: += dy)
 *   - +0x08..+0x0B : long stuck-z (R+W: -= 0x6000 / clamp 0xFFFB0000)
 *   - +0x18        : byte state18 (R: skip se 2/3)
 *   - +0x1A        : byte mode    (R: scaling se 1/5)
 *   - +0x36        : byte state36 (R: stuck se 2; gate stuck mods)
 *   - +0x56        : byte depth   (R: scaling factor)
 *   - +0x58        : byte command (R: whitelist test, bit7 clamp)
 *   - +0xC6        : byte cmd-x   (R: → 0x4006AA)
 *   - +0xC7        : byte cmd-y   (R: → 0x4006A8)
 *
 * **WorkRam globals**:
 *   - 0x400390 (long): special-dispatch flag (low word, == 1 → FUN_1815A)
 *   - 0x400396 (long): alt-source flag (low word, == 1 → FUN_180BE)
 *   - 0x4006A8 (byte): cmd-y output (anche letto per dy calc)
 *   - 0x4006AA (byte): cmd-x output (anche letto per dx calc)
 *
 * **Caller sites** (3 xrefs in FUN_253EC):
 *   - 0x2573A, 0x2575E, 0x257CC.
 *
 * **Verifica bit-perfect** via `test-object-step-17f66-parity.ts` (500 casi).
 */

import type { GameState } from "./state.js";

/** WorkRam base (M68k absolute address). */
const WORK_RAM_BASE = 0x400000;

/** Globals (WorkRam). */
const G_390 = 0x0390;
const G_396 = 0x0396;
const G_6A8 = 0x06a8;
const G_6AA = 0x06aa;

/** Struct field offsets (from A2). */
const F_POS_X = 0x00; // long
const F_POS_Y = 0x04; // long
const F_STUCK_Z = 0x08; // long
const F_STATE18 = 0x18; // byte
const F_MODE = 0x1a; // byte
const F_STATE36 = 0x36; // byte
const F_DEPTH = 0x56; // byte
const F_CMD = 0x58; // byte
const F_CMD_X = 0xc6; // byte (mapped to G_6AA)
const F_CMD_Y = 0xc7; // byte (mapped to G_6A8)

/**
 * Whitelist di byte command a 0x58(A2) che inducono il movement path.
 * Ordine identico al binario (test sequenziali con beq.w).
 */
export const COMMAND_WHITELIST: ReadonlySet<number> = new Set<number>([
  0x00, 0x3b, 0x2d, 0x2e, 0x38, 0x39, 0x3a, 0x2f, 0x30, 0x31,
]);

/** Long literals dal binario (conservati come immutabili). */
export const STUCK_DELTA = -0x6000; // addi.l #-0x6000
export const STUCK_CLAMP = -0x50000 >>> 0; // 0xFFFB0000 (move.l #-0x50000)
/** Soglia min signed per il clamp post-addi (cmpi.l #-0x50000). */
export const STUCK_DELTA_MIN = -0x50000; // signed i32
export const VEL_SCALE = 0x160; // muls.w #0x160
export const DEPTH_BASE = 0x1f; // moveq #0x1F, D1
export const MODE_5_FLOOR = 4; // clamp D1 a min 4 nel mode==5

/**
 * Tipo dei callback invocati dal modulo.
 *   - `fun1815A(a2)` — chiamato in special-dispatch (`*0x400390 == 1`).
 *   - `fun180BE()`   — chiamato in movement path se `*0x400396 == 1` (no args).
 *   - `fun26196(a2)` — chiamato dopo movement / stuck (epilogue).
 */
export interface ObjectStepCallees {
  fun1815A: (a2Addr: number) => void;
  fun180BE: () => void;
  fun26196: (a2Addr: number) => void;
}

/**
 * Path eseguito (per debug / introspezione test). Nessun effetto runtime;
 * il binario non lo espone.
 */
export type StepPath = "skip" | "special" | "movement" | "stuck";

/** Ritorno opzionale del modulo (per test). */
export interface StepResult {
  path: StepPath;
  /** Numero di chiamate ai callees (per ordine: 1815a, 180be, 26196). */
  calls: { fun1815A: number; fun180BE: number; fun26196: number };
}

// ─── Helpers di lettura/scrittura long big-endian su Uint8Array ────────

function readU32BE(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

function writeU32BE(buf: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  buf[off] = (u >>> 24) & 0xff;
  buf[off + 1] = (u >>> 16) & 0xff;
  buf[off + 2] = (u >>> 8) & 0xff;
  buf[off + 3] = u & 0xff;
}

/** sign-extend byte → i32. */
function sextB(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

/** sign-extend word (16 bit signed) → i32. */
function sextW(w: number): number {
  return ((w & 0xffff) << 16) >> 16;
}

/** Read 16-bit word (BE) at workRam offset. */
function readWordBE(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

/**
 * Replica bit-perfect di `FUN_00017F66` — object step.
 *
 * @param state    GameState. Legge globals @ 0x400390 / 0x400396 e bytes @
 *                 0x4006A8 / 0x4006AA. Modifica i 2 byte globali nel movement
 *                 path standard. Modifica struct @ a2Addr (long add a +0/+4/+8
 *                 e/o byte read; il binario non scrive byte struct in questa
 *                 sub).
 *
 * @param a2Addr   Indirizzo M68k del struct (es. 0x401234). Deve essere
 *                 within workRam: `0x400000 <= a2Addr < 0x402000`. Il modulo
 *                 indicizza `state.workRam[a2Addr - 0x400000 + offset]`.
 *
 * @param callees  Callback per le 3 sub interne. `fun1815A(a2Addr)` e
 *                 `fun26196(a2Addr)` ricevono l'indirizzo M68k del struct
 *                 (NON l'offset workRam) per coerenza con la convenzione
 *                 push 68k. `fun180BE()` non riceve args.
 *
 * @returns        `StepResult` con il path eseguito e il count di chiamate
 *                 callee. Utile per asserzioni in test; il binario non
 *                 ritorna alcun valore.
 */
export function objectStep17F66(
  state: GameState,
  a2Addr: number,
  callees: ObjectStepCallees,
): StepResult {
  const r = state.workRam;
  const a2Off = (a2Addr - WORK_RAM_BASE) >>> 0;

  const calls = { fun1815A: 0, fun180BE: 0, fun26196: 0 };

  // ── 0x17F6E..0x17F7E: skip path ──────────────────────────────────────
  const state18 = (r[a2Off + F_STATE18] ?? 0) & 0xff;
  if (state18 === 2 || state18 === 3) {
    return { path: "skip", calls };
  }

  // ── 0x17F82..0x17F96: special-dispatch path ─────────────────────────
  // cmp.w (0x400390).l, D0w  con D0=1 → confronto su WORD letto a 0x400390.
  const g390W = readWordBE(r, G_390);
  if (g390W === 1) {
    callees.fun1815A(a2Addr >>> 0);
    calls.fun1815A++;
    return { path: "special", calls };
  }

  // ── 0x17F9A..0x17FF2: whitelist test ────────────────────────────────
  const cmd = (r[a2Off + F_CMD] ?? 0) & 0xff;
  const state36 = (r[a2Off + F_STATE36] ?? 0) & 0xff;
  // beq.w 0x1808E se state36 == 2 → stuck path.
  // Altrimenti, whitelist test su cmd.
  const goStuck = state36 === 2 || !COMMAND_WHITELIST.has(cmd);

  if (!goStuck) {
    // ── 0x17FF6..0x18018: movement path ────────────────────────────────
    const g396W = readWordBE(r, G_396);
    if (g396W === 1) {
      callees.fun180BE();
      calls.fun180BE++;
      // bra.b 0x18018: salta lo store dei 2 byte.
    } else {
      // 0x18008: scrivi 0x4006AA da (0xC6,A2), 0x4006A8 da (0xC7,A2).
      r[G_6AA] = (r[a2Off + F_CMD_X] ?? 0) & 0xff;
      r[G_6A8] = (r[a2Off + F_CMD_Y] ?? 0) & 0xff;
    }

    // 0x18018..0x18040: leggi i 2 byte globali, calcola dx/dy long.
    const byA8 = (r[G_6A8] ?? 0) & 0xff;
    const byAA = (r[G_6AA] ?? 0) & 0xff;
    const d3_0 = sextB(byA8); // sign-ext byte → long
    const d2_0 = -sextB(byAA) | 0; // neg.l after sign-ext

    // muls.w #0x160 — usa solo low word di D0 (sign-extended dal byte sopra).
    // Math.imul produce 32-bit signed multiply, equivalente per word*0x160.
    let d3 = Math.imul(sextW(d3_0 & 0xffff), VEL_SCALE) | 0;
    let d2 = Math.imul(sextW(d2_0 & 0xffff), VEL_SCALE) | 0;

    // ── 0x18042..0x18080: scaling block (mode ∈ {1, 5}) ────────────────
    const mode = (r[a2Off + F_MODE] ?? 0) & 0xff;
    if (mode === 1 || mode === 5) {
      // moveq #0x1F, D1; D1.w -= sext.w(byte 0x56(A2)).
      const depthB = (r[a2Off + F_DEPTH] ?? 0) & 0xff;
      const depthW = sextW(sextB(depthB) & 0xffff); // sext byte → word (signed)
      let d1 = sextW((DEPTH_BASE - depthW) & 0xffff);

      // Solo nel mode == 5: clamp D1 = max(D1, 4).
      // cmp.w D1w, D0w con D0w = 4 → ble = D0 <= D1 signed.
      // Se 4 <= D1: skip. Altrimenti (D1 < 4): D1 = 4.
      if (mode === 5) {
        if (4 > d1) {
          d1 = 4;
        }
      }

      // asr.l #8; muls.w D1w; asl.l #3.
      // asr.l: shift right aritmetico 8 (signed shift in JS via i32).
      // muls.w: low word di D0 (post-shift) × low word di D1.
      const d3sh = (d3 >> 8) | 0;
      const d2sh = (d2 >> 8) | 0;
      d3 = (Math.imul(sextW(d3sh & 0xffff), sextW(d1 & 0xffff)) << 3) | 0;
      d2 = (Math.imul(sextW(d2sh & 0xffff), sextW(d1 & 0xffff)) << 3) | 0;
    }

    // ── 0x18082..0x1808A: (A2) += d3 (long), (4,A2) += d2 (long) ───────
    const px = readU32BE(r, a2Off + F_POS_X);
    const py = readU32BE(r, a2Off + F_POS_Y);
    writeU32BE(r, a2Off + F_POS_X, (px + d3) >>> 0);
    writeU32BE(r, a2Off + F_POS_Y, (py + d2) >>> 0);

    // ── 0x180AE: jsr FUN_26196 ─────────────────────────────────────────
    callees.fun26196(a2Addr >>> 0);
    calls.fun26196++;
    return { path: "movement", calls };
  }

  // ── 0x1808E..0x180AC: stuck path ────────────────────────────────────
  // tst.b (0x36,A2); beq 0x180AE → se state36 == 0, salta entrambi i mod.
  if (state36 !== 0) {
    // addi.l #-0x6000, (0x8,A2) — long modulo 2^32.
    const sz = readU32BE(r, a2Off + F_STUCK_Z);
    const szPost = (sz + STUCK_DELTA) >>> 0;
    writeU32BE(r, a2Off + F_STUCK_Z, szPost);

    // cmpi.l #-0x50000, (0x8,A2); bge 0x180AE.
    // bge ≡ (0x8,A2) >= -0x50000 signed → skip clamp.
    // Else (signed < -0x50000): clamp a -0x50000.
    const szPostSigned = szPost | 0; // i32 view
    if (szPostSigned < (STUCK_DELTA_MIN | 0)) {
      writeU32BE(r, a2Off + F_STUCK_Z, STUCK_CLAMP);
    }
  }

  // ── 0x180AE: jsr FUN_26196 ──────────────────────────────────────────
  callees.fun26196(a2Addr >>> 0);
  calls.fun26196++;
  return { path: "stuck", calls };
}
