/**
 * state-sub-15670.ts — replica `FUN_00015670` (532 byte).
 *
 * **Intento sub-routine**: data una "main struct" `A2` (puntata dal caller),
 * scorre l'array di N oggetti @ `0x400018` stride `0xE2` (count = word @
 * `0x400396`) e cerca un "candidato" che soddisfi:
 *   - `obj.state (0x18) == 1`
 *   - `obj.zorder (0x1B) == arg.zorder`
 *   - `|obj_x| + |obj_y| > 0xC000` (dove `obj_x = (long*)0` e
 *      `obj_y = (long*)4`, considerati come long con valore assoluto)
 *   - `obj.field36 (0x36) != 2`
 *   - `obj.kind (0x1A) ∈ {0, 1, 5}`
 * Per ogni candidato, scansiona inoltre l'array-4 marble-slot @ `0x401302`
 * stride `0x60` (4 entry) cercando "collision":
 *   - skip iter dove A2 == ptr corrente (`0x401302`)
 *   - `slot.state (0x18) == 1`
 *   - `slot.kind (0x1A) == 1`
 *   - `slot.field56 (0x56).w == signExt(obj.field19 (0x19))`
 * Se almeno una collision viene trovata (`D4 = 1`), il candidato è
 * scartato. Altrimenti `D2.b -= 1` e `A1 = obj` (memorizza il candidato
 * "buono" più recente).
 *
 * Dopo il loop esterno:
 *   - se `D2 == word(*0x400396)` (cioè il counter non è mai stato
 *     decrementato) → epilog (no-op).
 *   - se `word(*0x400396) == 2` E `D2 == 0` (caso speciale: solo 2
 *     oggetti, entrambi candidati no-collision) → si chiama
 *     `FUN_00015FE6(obj0, obj1)` per scegliere quello "above" via depth
 *     comparison: `A1 = obj1` se ritorna != 0, altrimenti `A1 = obj0`.
 *   - poi si calcola la "distanza octant-approx" tra `arg` (`A2`) e il
 *     candidato `A1`:
 *       `dx = |arg.x (0xC) - A1.x (0xC)| >> 12`  → low word `D3`
 *       `dy = |arg.y (0x10) - A1.y (0x10)| >> 12` → low word `D4`
 *       `dist = (min(D3,D4) >> 3) * 3 + max(D3,D4)`
 *     (la formula è l'approssimazione octant-distance: il "lato corto"
 *      contribuisce con un fattore 3/8, il "lato lungo" intero. Lo
 *      shift e la moltiplicazione operano sull'intero word esteso a long
 *      tramite `move.w D?w, D?w; lsr.l #3; muls.w #3`.)
 *   - scrive `(0x56, A2).w = signExt(D2.b)`.
 *   - se `0x180 < dist < 0x280` (entrambe le bound-checks `ble`/`bge`
 *      sono escluse): scrive `(0x1A, A2) = 1` e chiama
 *      `FUN_00015460(A2)`.
 *
 * **Caller noto** (1 sito):
 *   - `0x15270` in `FUN_00015148`: `move.l A2,-(SP); jsr 0x15670.l;
 *     addq.l #4,SP`. L'arg è il ptr di una struct di stato in workRam.
 *
 * **Disasm 0x15670..0x15883** (532 byte) — compatto:
 *
 *   movem.l  {A5 A4 A3 A2 D6 D5 D4 D3 D2}, -(SP)   ; salva 9 reg (36 byte)
 *   movea.l  (0x28,SP),A2                          ; A2 = arg1 long
 *   movea.l  #0x400018,A3                          ; A3 = obj-array base
 *   movea.l  #0x400396,A4                          ; A4 = count word ptr
 *   move.b   (0x1A,A2),D0b                         ; D0 = arg.kind (UNUSED!)
 *   move.b   (1,A4),D2b                            ; D2 = low byte of count
 *                                                  ;   (count è word, byte
 *                                                  ;    0x397 è il LSB BE)
 *   movea.l  A3,A0                                 ; A0 = obj iter ptr
 *   moveq    0,D6                                  ; D6 = 0
 *   movea.l  D6,A1                                 ; A1 = nullptr (best obj)
 *   clr.b    D5b                                   ; D5 = 0 (loop counter)
 *   bra.w    test_outer                            ; jump to count check
 *  obj_iter:                                       ; @ 0x15698
 *   D1 = abs((long*)A0[0])
 *   D3 = abs((long*)A0[4])
 *   if A0.state (0x18) != 1 → next
 *   if (1B,A2) != (1B,A0) → next
 *   if (D3 + D1) <= 0xC000 → next       ; signed long
 *   if (0x36,A0) == 2 → next
 *   if (0x1A,A0) ∉ {0,1,5} → next
 *   ; inner: 4-slot collision check @ 0x401302 stride 0x60
 *   D1 = #0x401302; D4 = 0; D3 = 0
 *  inner_iter:
 *   if A2 == D1 → skip body
 *   else if (1, A5=D1).state == 1 AND (1, A5).kind == 1 AND
 *          (0x56, A5).w == signExt((0x19, A0).b) → D4 = 1
 *   D1 += 0x60; D3.b += 1
 *   if D3 != 4 → inner_iter
 *   if D4 != 0 → next                   ; collision: skip
 *   D2.b -= 1                            ; conta candidati validi
 *   A1 = A0                              ; save last good
 *  next:
 *   D6 = A0; D6 += 0xE2; A0 = D6
 *   D5.b += 1
 *  test_outer:                          ; @ 0x15758
 *   D0 = signExt(D5.b).w
 *   if D0 != count(A4).w → obj_iter
 *
 *   D0 = signExt(D2.b).w
 *   if D0 == count(A4).w → epilog       ; nessun candidato decrementato
 *
 *   if count(A4).w == 2 AND D2 == 0:
 *     ret = FUN_15FE6(A3, A3+0xE2)
 *     A1 = (ret != 0 ? A3+0xE2 : A3)
 *
 *   ; Process A1 candidate (no-op block: D0 viene riscritto)
 *   D2.b = (0x19, A1)
 *   ; (calcoli "dead" che riassegnano D0=1 in vari rami, poi sovrascritti)
 *   D0 = (0xC, A1) - (0xC, A2)          ; long signed
 *   D3.w = abs(D0) >> 12                 ; low 16
 *   D0 = (0x10, A1) - (0x10, A2)
 *   D4.w = abs(D0) >> 12
 *   if D3 > D4 (unsigned word):
 *     D1 = (D4 >> 3) * 3 + D3            ; octant-approx
 *   else:
 *     D1 = (D3 >> 3) * 3 + D4
 *   (0x56, A2).w = signExt(D2.b).w
 *   if 0x180 < D1 < 0x280:               ; ble.b → skip; bge.b → skip
 *     (0x1A, A2) = 1
 *     FUN_15460(A2)
 *  epilog:
 *   movem.l (SP)+, {D2 D3 D4 D5 D6 A2 A3 A4 A5}
 *   rts
 *
 * **Side effects diretti** (su workRam):
 *   - `(0x56, A2).w = signExt(D2.b).w` (sempre, se almeno un cand passa
 *     il count check finale).
 *   - `(0x1A, A2) = 1` (solo se condition di distanza match).
 *
 * **Side effects indiretti**:
 *   - `subs.fun_15fe6(obj0Abs, obj1Abs)` — chiamata SOLO se count == 2
 *     E D2 == 0 (entrambi candidati). Default: replica reale di
 *     `FUN_00015FE6` via `compareObjDepth` (vedi `object-compare.ts`).
 *   - `subs.fun_15460(structPtrAbs)` — chiamata se distanza in
 *     `[0x181..0x27F]`. Default no-op (FUN_15460 non ancora replicata).
 *
 * **Memory model**: la funzione legge solo da memoria assoluta che il
 * caller reale FA cadere in workRam (`0x400018..0x401302+0x180`,
 * `0x400396`, e A2 nello stesso range). La replica accede a
 * `state.workRam`; address fuori range producono 0 nei read e no-op
 * nei write. Il binario originale leggerebbe da memoria assoluta
 * generica — non occorre modellarlo qui, il caller punta sempre in
 * workRam.
 *
 * Verifica bit-perfect via `cli/src/test-state-sub-15670-parity.ts`.
 */

import type { GameState } from "./state.js";
import { compareObjDepth } from "./object-compare.js";

// ─── Costanti di layout ──────────────────────────────────────────────────

/** WORK RAM base assoluta M68k. */
const WORK_RAM_BASE = 0x00400000;
/** Dimensione workRam (8 KB). */
const WORK_RAM_SIZE = 0x2000;

/** Indirizzo assoluto base array oggetti. */
export const OBJ_ARRAY_BASE = 0x00400018 as const;
/** Stride tra oggetti adiacenti. */
export const OBJ_STRIDE = 0xe2 as const;
/** Indirizzo assoluto del word "count" (numero oggetti attivi). */
export const OBJ_COUNT_ADDR = 0x00400396 as const;

/** Indirizzo assoluto base array marble-slot (4 entry × 0x60). */
export const SLOT_ARRAY_BASE = 0x00401302 as const;
/** Stride dei marble-slot. */
export const SLOT_STRIDE = 0x60 as const;
/** Numero di marble-slot. */
export const SLOT_COUNT = 4 as const;

// Per-obj field offsets
const OBJ_X_OFF = 0x00; // long signed
const OBJ_Y_OFF = 0x04; // long signed
const OBJ_STATE_OFF = 0x18; // byte
const OBJ_FLAG19_OFF = 0x19; // byte (target word value via signExt)
const OBJ_KIND_OFF = 0x1a; // byte
const OBJ_ZORDER_OFF = 0x1b; // byte
const OBJ_FIELD36_OFF = 0x36; // byte

// Marble-slot field offsets (stesso 0x18/0x1A per state/kind)
const SLOT_STATE_OFF = 0x18; // byte
const SLOT_KIND_OFF = 0x1a; // byte
const SLOT_FIELD56_OFF = 0x56; // word

// "main struct" A2 field offsets
const ARG_FX_OFF = 0x0c; // long signed (fixed-point pos x)
const ARG_FY_OFF = 0x10; // long signed (fixed-point pos y)
const ARG_KIND_OFF = 0x1a; // byte (mutato a 1 nel ramo trigger)
const ARG_ZORDER_OFF = 0x1b; // byte
const ARG_FIELD56_OFF = 0x56; // word (scritto = signExt(D2.b))

/** Soglia su (|obj.x| + |obj.y|): l'oggetto è candidato se sum > 0xC000. */
const ACTIVE_SUM_THRESHOLD = 0xc000 as const;
/** Distanza minima esclusiva (`> 0x180`) per il trigger. */
const DIST_LO_EXCL = 0x180 as const;
/** Distanza massima esclusiva (`< 0x280`) per il trigger. */
const DIST_HI_EXCL = 0x280 as const;
/** Shift applicato alle differenze posizionali (fixed-point → tile-ish). */
const POS_DIFF_SHIFT = 12 as const;
/** Valore scritto in `arg.kind` quando il trigger si attiva. */
const TRIGGERED_KIND = 1 as const;

// ─── Stub injection ──────────────────────────────────────────────────────

/**
 * Stub injection per le 2 JSR di `FUN_00015670`.
 *
 * - `fun_15fe6`: chiamata SOLO nel ramo `count == 2 && D2 == 0` per
 *   scegliere fra i 2 oggetti (depth comparison). Default: chiama la
 *   replica reale `compareObjDepth` (`object-compare.ts`) che è
 *   bit-perfect verificata.
 * - `fun_15460`: chiamata nel ramo "distanza in range" con `arg = A2`
 *   (struct ptr assoluto). Default no-op.
 */
export interface StateSub15670Subs {
  /**
   * `FUN_00015FE6(obj0Abs, obj1Abs) → 0/1` (long signed). Returns 1 se
   * `obj0` "vince" su `obj1` per depth-ordering.
   */
  fun_15fe6?: (obj0Abs: number, obj1Abs: number) => number;
  /**
   * `FUN_00015460(structPtrAbs) → void`. Side-effect handler invocato
   * quando la distanza arg↔candidato cade in `(0x180, 0x280)`.
   */
  fun_15460?: (structPtrAbs: number) => void;
}

// ─── Helpers di accesso memoria (workRam-only) ───────────────────────────

function readByteAbs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + WORK_RAM_SIZE) return 0;
  return state.workRam[a - WORK_RAM_BASE] ?? 0;
}

function readU16Abs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a + 2 > WORK_RAM_BASE + WORK_RAM_SIZE || a < WORK_RAM_BASE) return 0;
  const r = state.workRam;
  const off = a - WORK_RAM_BASE;
  return (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
}

function readLongSignedAbs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a + 4 > WORK_RAM_BASE + WORK_RAM_SIZE || a < WORK_RAM_BASE) return 0;
  const r = state.workRam;
  const off = a - WORK_RAM_BASE;
  const u =
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0;
  // Re-interpret as int32 signed
  return u | 0;
}

function writeU16Abs(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a + 2 > WORK_RAM_BASE + WORK_RAM_SIZE || a < WORK_RAM_BASE) return;
  const off = a - WORK_RAM_BASE;
  state.workRam[off] = (value >>> 8) & 0xff;
  state.workRam[off + 1] = value & 0xff;
}

function writeByteAbs(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + WORK_RAM_SIZE) return;
  state.workRam[a - WORK_RAM_BASE] = value & 0xff;
}

/** Sign-extend low byte 0..0xFF a int32 signed. */
function sextByteL(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

/** asr.l signed 32-bit. */
function asrL(value: number, count: number): number {
  return (value | 0) >> (count & 0x1f);
}

/** Valore assoluto signed 32-bit (nega se negativo, mantiene 0x80000000). */
function absL(v: number): number {
  // M68k `tst.l` + `bge` + `neg.l` su 0x80000000 produce 0x80000000 (overflow).
  // In JS: 0x80000000 | 0 = -0x80000000; -(-0x80000000) | 0 = -0x80000000.
  // Comportamento coincide.
  const x = v | 0;
  return x < 0 ? -x | 0 : x;
}

// ─── Replica principale ──────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00015670`.
 *
 * @param state          GameState. Letti vari campi @ workRam (vedi header
 *                       file). Scritti: `arg+0x56` (sempre se almeno un
 *                       candidato si decrementa) e `arg+0x1A` (solo se
 *                       distanza in range trigger).
 * @param structPtrLong  long: pointer assoluto allo struct "arg" (A2).
 * @param subs           Stub iniettabili (vedi `StateSub15670Subs`).
 *                       Default: `fun_15fe6 = compareObjDepth(state,..)`,
 *                       `fun_15460 = no-op`.
 */
export function stateSub15670(
  state: GameState,
  structPtrLong: number,
  subs?: StateSub15670Subs,
): void {
  const a2 = structPtrLong >>> 0;
  const a3 = OBJ_ARRAY_BASE >>> 0;
  // count è word @ 0x400396 — il binario lo legge sempre come word (cmp.w).
  const count = readU16Abs(state, OBJ_COUNT_ADDR);
  // D2 inizia con (1, A4) = byte LSB del word count (BE: 0x397).
  // Per `cmp.w`/`ext.w` operations che seguono, D2.b è low byte del word.
  let d2Byte = readByteAbs(state, OBJ_COUNT_ADDR + 1);

  let a1: number = 0; // "best candidate" obj abs ptr (0 = none)

  // ─── Outer loop: scan obj-array ──────────────────────────────────────
  for (let i = 0; i < count; i++) {
    const objAbs = (a3 + i * OBJ_STRIDE) >>> 0;

    const x = readLongSignedAbs(state, objAbs + OBJ_X_OFF);
    const y = readLongSignedAbs(state, objAbs + OBJ_Y_OFF);
    const ax = absL(x);
    const ay = absL(y);

    // Filter: state == 1
    if (readByteAbs(state, objAbs + OBJ_STATE_OFF) !== 1) continue;
    // Filter: arg.zorder == obj.zorder (cmp.b)
    if (
      readByteAbs(state, a2 + ARG_ZORDER_OFF) !==
      readByteAbs(state, objAbs + OBJ_ZORDER_OFF)
    ) {
      continue;
    }
    // Filter: ax + ay > 0xC000 (long signed). cmpi.l #0xc000,D0; ble.w skip.
    // L'add è long signed: in caso di overflow su negativo, ble lo gestisce.
    const sum = (ax + ay) | 0;
    if (sum <= ACTIVE_SUM_THRESHOLD) continue;
    // Filter: obj.field36 != 2
    if (readByteAbs(state, objAbs + OBJ_FIELD36_OFF) === 2) continue;
    // Filter: obj.kind ∈ {0, 1, 5}
    const objKind = readByteAbs(state, objAbs + OBJ_KIND_OFF);
    if (objKind !== 0 && objKind !== 1 && objKind !== 5) continue;

    // ─── Inner loop: marble-slot collision check ──────────────────────
    let collision = false;
    const targetWord = sextByteL(readByteAbs(state, objAbs + OBJ_FLAG19_OFF));
    // I 16 bit bassi del long signed sono i word usati nel cmp.w sotto.
    const targetW = targetWord & 0xffff;
    for (let s = 0; s < SLOT_COUNT; s++) {
      const slotAbs = (SLOT_ARRAY_BASE + s * SLOT_STRIDE) >>> 0;
      // Skip se A2 == slotAbs
      if (slotAbs === a2) continue;
      if (readByteAbs(state, slotAbs + SLOT_STATE_OFF) !== 1) continue;
      if (readByteAbs(state, slotAbs + SLOT_KIND_OFF) !== 1) continue;
      // (0x56, A5).w cmp.w D0w (= signExt(obj.0x19))
      const slotW = readU16Abs(state, slotAbs + SLOT_FIELD56_OFF);
      if (slotW !== targetW) continue;
      collision = true;
      // Il binario non fa break — continua il loop fino a D3==4. Il flag D4
      // resta a 1 indipendentemente. Per bit-perfect non importa: il loop
      // body senza side effect. Ma per replicare il flow, continuiamo.
    }

    if (collision) continue;

    // Candidato valido: D2.b -= 1, A1 = A0 (latest good)
    d2Byte = (d2Byte - 1) & 0xff;
    a1 = objAbs;
  }

  // ─── Post-loop: count-match check ────────────────────────────────────
  // cmp.w (A4), signExt(D2.b).w == count.w → epilog
  // Nota: count.w è 16-bit unsigned (lo abbiamo letto come 0..0xFFFF).
  // signExt(D2.b).w è il word risultante da ext.w D0 dopo move.b D2,D0.
  // Confronto cmp.w è 16-bit (su low word del registro).
  const d2WordSext = sextByteL(d2Byte) & 0xffff;
  if (d2WordSext === (count & 0xffff)) {
    return; // nessun candidato → epilog
  }

  // ─── Special case: count == 2 && D2 == 0 → depth compare obj0 vs obj1 ─
  if (count === 2 && d2Byte === 0) {
    const obj0Abs = a3 >>> 0;
    const obj1Abs = (a3 + OBJ_STRIDE) >>> 0;
    const fun15fe6 =
      subs?.fun_15fe6 ??
      ((p0: number, p1: number): number => compareObjDepth(state, p0, p1));
    const ret = fun15fe6(obj0Abs, obj1Abs) | 0;
    a1 = ret !== 0 ? obj1Abs : obj0Abs;
  }

  // ─── Riassegna D2 = (0x19, A1) ────────────────────────────────────
  // Il binario riassegna D2.b col flag19 del candidato selezionato. Tutto
  // il blocco D0=0/D0=1 fra 0x15794..0x15803 è dead code (D0 sovrascritto a
  // 0x15804 con `move.l (0xC,A1),D0`), ma D2.b è il valore che finisce in
  // (0x56,A2).w via signExt.
  d2Byte = readByteAbs(state, a1 + OBJ_FLAG19_OFF);

  // ─── Distanza octant-approx tra arg (A2) e candidato (A1) ───────────
  // Se per qualche motivo a1 === 0 (no candidate selezionato e count != 2):
  // il binario originale qui userebbe whatever A1 contiene (potrebbe essere
  // 0 dal moveq iniziale). Read da addr 0 → out-of-range → 0. Replichiamo.
  const argX = readLongSignedAbs(state, a2 + ARG_FX_OFF);
  const argY = readLongSignedAbs(state, a2 + ARG_FY_OFF);
  const a1X = readLongSignedAbs(state, a1 + ARG_FX_OFF);
  const a1Y = readLongSignedAbs(state, a1 + ARG_FY_OFF);

  // dx long signed; |dx| poi asr 12 (signed) → low word
  const dxAbs = absL((a1X - argX) | 0);
  const dyAbs = absL((a1Y - argY) | 0);
  const d3W = asrL(dxAbs, POS_DIFF_SHIFT) & 0xffff;
  const d4W = asrL(dyAbs, POS_DIFF_SHIFT) & 0xffff;

  // Confronto cmp.w D4w,D3w; bls (unsigned <=) → swap branch.
  // bls = "branch if lower or same" unsigned: se D3 <= D4 unsigned → swap.
  //
  // Sequenza M68k:
  //   moveq #0,D1; move.w <minor>,D1w  ; D1 = minor zero-extended (long unsigned)
  //   lsr.l #3, D1                      ; D1 >>= 3 (long unsigned)
  //   muls.w #3, D1                     ; D1 = (D1.w as int16) * 3 → long signed
  //   moveq #0,D0; move.w <major>,D0w  ; D0 = major zero-extended
  //   add.l D0, D1                      ; D1 += D0 (long add)
  //
  // Dato che minor e major sono [0..0xFFFF] unsigned (vengono da `move.w
  // D0w,D3w/D4w` dopo asr.l → low 16 bit di un long), `minor >> 3` sta in
  // [0..0x1FFF] (positivo come int16). `* 3` rimane in [0..0x5FFD]. La
  // somma con `major` (treated as zero-extended long) è positiva long.
  let dist: number;
  if (d3W > d4W) {
    // D3 > D4 unsigned: D1 = ((D4 >> 3) * 3) + D3
    const minor = d4W; // 0..0xFFFF
    const major = d3W;
    const minorShifted = (minor >>> 3) & 0xffff; // [0..0x1FFF]
    // muls.w: low word (positivo) × 3 → long signed positivo
    const muls = ((minorShifted << 16) >> 16) * 3; // safe: max 0x5FFD
    dist = (muls + major) | 0;
  } else {
    // D3 <= D4 unsigned: D1 = ((D3 >> 3) * 3) + D4
    const minor = d3W;
    const major = d4W;
    const minorShifted = (minor >>> 3) & 0xffff;
    const muls = ((minorShifted << 16) >> 16) * 3;
    dist = (muls + major) | 0;
  }

  // Always-write: (0x56, A2).w = signExt(D2.b).w
  writeU16Abs(state, a2 + ARG_FIELD56_OFF, sextByteL(d2Byte) & 0xffff);

  // Range check: 0x180 < dist < 0x280 (signed long)
  // ble (signed) → skip se dist <= 0x180
  // bge (signed) → skip se dist >= 0x280
  if (dist <= DIST_LO_EXCL) return;
  if (dist >= DIST_HI_EXCL) return;

  // Trigger: (0x1A, A2) = 1; FUN_15460(A2)
  writeByteAbs(state, a2 + ARG_KIND_OFF, TRIGGERED_KIND);
  subs?.fun_15460?.(a2);
}
