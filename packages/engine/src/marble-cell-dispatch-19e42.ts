/**
 * marble-cell-dispatch-19e42.ts — replica `FUN_00019E42` (194 byte).
 *
 * Variante "compute coords + cell-test + dispatch / clear" del pattern
 * `sprite-coords-jsr-150d0.ts`. Riceve un puntatore long entity (A1) e:
 *
 *   1. Copia il word @ entity[0xC..0xD] in `*0x400690` (POS_X global).
 *   2. Copia il word @ entity[0x10..0x11] in `*0x400692` (POS_Y global).
 *   3. Calcola un long packato (yMinusX_signed << 16) | adjustedX_word, lo
 *      stesso schema di `FUN_150D0`, e lo scrive a `entity[0x20..0x23]`
 *      (NB: in `FUN_150D0` la dest è `+0x28`, qui è `+0x20`).
 *   4. Calcola `cellX = (entity.x_word >> 3)` (signed) — low byte.
 *      Calcola `cellY = (entity.y_word >> 3)` (signed) — low byte.
 *   5. Se `cellX ∈ {0x29, 0x31, 0x39}` AND `cellY >= 0x34` (signed byte):
 *        → chiama `FUN_000264AA(entity, 3)` (dispatch su sub esterna).
 *      Altrimenti:
 *        → azzera 3 word a `entity[0x26]`, `entity[0x2C]`, `entity[0x32]`
 *          (loop `i=0..2`, offset = `0x26 + i*6`, `clr.w` per due byte).
 *   6. Ritorna (D0 non deterministico ma irrilevante: i 2 caller noti lo
 *      ignorano subito dopo il `jsr`).
 *
 * **Disasm 0x19E42..0x19F03** (194 byte):
 *
 *   00019e42  movem.l {D2,D3,A2,A3},-(SP)         ; salva 4 long (16 byte)
 *   00019e46  movea.l (0x14,SP),A1                ; A1 = arg long (entity)
 *   00019e4a  movea.l #0x400692,A3                ; A3 → POS_Y global
 *   00019e50  movea.l #0x400690,A2                ; A2 → POS_X global
 *   00019e56  lea     (0xc,A1),A0
 *   00019e5a  move.w  (A0),(A2)                   ; *0x400690 = entity[0xC]
 *   00019e5c  lea     (0x10,A1),A0
 *   00019e60  move.w  (A0),(A3)                   ; *0x400692 = entity[0x10]
 *   00019e62  move.w  (A3),D3w
 *   00019e64  sub.w   (A2),D3w                    ; D3w = posY - posX
 *   00019e66  addi.w  #0x88,D3w                   ; D3w += 0x88
 *   00019e6a  lea     (0x14,A1),A0
 *   00019e6e  move.w  (A0),D0w                    ; D0w = entity[0x14] (w4)
 *   00019e70  move.w  (0x40097e).l,D2w            ; D2w = HUD_OFFSET
 *   00019e76  add.w   D0w,D2w                     ; D2w += w4
 *   00019e78  addi.w  #0x54,D2w                   ; D2w += 0x54
 *   00019e7c  move.w  (A3),D0w
 *   00019e7e  ext.l   D0                          ; D0 = sext_l(posY)
 *   00019e80  move.w  (A2),D1w
 *   00019e82  ext.l   D1                          ; D1 = sext_l(posX)
 *   00019e84  add.l   D1,D0                       ; D0 = posY_s + posX_s
 *   00019e86  asr.l   #0x1,D0                     ; D0 >>= 1 (signed)
 *   00019e88  sub.w   D0w,D2w                     ; D2w -= avg_low16
 *   00019e8a  move.w  D2w,D0w
 *   00019e8c  ext.l   D0
 *   00019e8e  move.l  D0,D2
 *   00019e90  andi.l  #0xffff,D2                  ; D2 = D2w (zero high)
 *   00019e96  move.w  D3w,D0w
 *   00019e98  ext.l   D0
 *   00019e9a  move.l  D0,D1
 *   00019e9c  moveq   #0x10,D0
 *   00019e9e  asl.l   D0,D1                       ; D1 = sext_l(D3w) << 16
 *   00019ea0  add.l   D1,D2                       ; D2 = (D3<<16) + D2(zext)
 *   00019ea2  move.l  D2,(0x20,A1)                ; entity[0x20..0x23] = D2
 *
 *   00019ea6  lea     (0xc,A1),A0
 *   00019eaa  move.w  (A0),D0w                    ; D0w = entity.x
 *   00019eac  asr.w   #0x3,D0w                    ; D0w = entity.x >> 3 (signed)
 *   00019eae  move.b  D0b,D1b                     ; D1b = cellX (low byte)
 *   00019eb0  lea     (0x10,A1),A0
 *   00019eb4  move.w  (A0),D0w                    ; D0w = entity.y
 *   00019eb6  asr.w   #0x3,D0w                    ; D0w = entity.y >> 3 (signed)
 *   ;                                              ; D0b = cellY
 *
 *   00019eb8  cmpi.b  #0x39,D1b                   ; cellX == 0x39 ?
 *   00019ebc  beq.w   0x00019ece                  ; → check cellY
 *   00019ec0  cmpi.b  #0x31,D1b                   ; cellX == 0x31 ?
 *   00019ec4  beq.w   0x00019ece
 *   00019ec8  cmpi.b  #0x29,D1b                   ; cellX == 0x29 ?
 *   00019ecc  bne.b   0x00019ee4                  ; → clear loop
 *
 *   00019ece  cmpi.b  #0x34,D0b                   ; cellY < 0x34 (signed) ?
 *   00019ed2  blt.b   0x00019ee4                  ; → clear loop
 *
 *   ;  HIT: cellX in {0x29,0x31,0x39} && cellY >= 0x34
 *   00019ed4  pea     (0x3).w                     ; push 3 (long)
 *   00019ed8  move.l  A1,-(SP)                    ; push entity ptr (long)
 *   00019eda  jsr     0x000264aa.l                ; FUN_264AA(entity, 3)
 *   00019ee0  addq.l  #0x8,SP
 *   00019ee2  bra.b   0x00019efe                  ; → epilogue
 *
 *   ;  MISS: clear loop
 *   00019ee4  clr.b   D1b                         ; i = 0
 *   00019ee6  move.b  D1b,D0b
 *   00019ee8  ext.w   D0w
 *   00019eea  mulu.w  #0x6,D0                     ; D0 = i * 6
 *   00019eee  lea     (0x26,A1),A0
 *   00019ef2  clr.w   (0x0,A0,D0w*0x1)            ; entity[0x26 + i*6 .. +1] = 0
 *   00019ef6  addq.b  #0x1,D1b
 *   00019ef8  cmpi.b  #0x3,D1b
 *   00019efc  bne.b   0x00019ee6                  ; i in {0,1,2}
 *
 *   00019efe  movem.l (SP)+,{D2,D3,A2,A3}
 *   00019f02  rts
 *
 * **Globals scritti** (sempre):
 *   - `*0x400690..0x400691` (POS_X word) ← entity[0xC..0xD]
 *   - `*0x400692..0x400693` (POS_Y word) ← entity[0x10..0x11]
 *
 * **Globals letti**:
 *   - `*0x40097E` (HUD_OFFSET word).
 *
 * **Entity scritti** (sempre):
 *   - `entity[0x20..0x23]` (long, big-endian).
 *
 * **Entity scritti** (solo MISS branch):
 *   - `entity[0x26..0x27] = 0`
 *   - `entity[0x2C..0x2D] = 0`
 *   - `entity[0x32..0x33] = 0`
 *
 * **Entity scritti** (solo HIT branch):
 *   - `FUN_264AA(entity, 3)` può modificare l'entity (sub non replicata, lo
 *     stub ROM in parity è `move.l (8,SP), D0; rts` → no-side-effects).
 *
 * **Caller noti** (2 xref):
 *   - `FUN_00019A40` @ 0x19B56 (`move.l A2,-(SP); jsr 0x19E42; ...`)
 *   - `FUN_00019BAA` @ 0x19D46 (`move.l A2,-(SP); jsr 0x19E42; tst.b D3b`)
 *   Entrambi ignorano `D0` post-jsr.
 *
 * **NO INTEGRAZIONE**: `FUN_264AA` (~object update sub) non è ancora
 * replicato in TS. Modelliamo via callback `inner` (vedi `Inner264AA` in
 * `object-enter-1281c.ts`). Il parity test patcha la `jsr` con uno stub
 * `move.l (8,SP),D0; rts` per esporre il `mode=3` come `D0`.
 *
 * Verifica bit-perfect via
 * `cli/src/test-marble-cell-dispatch-19e42-parity.ts` (500 casi).
 */

import type { GameState } from "./state.js";

/** Base della work RAM. */
const WORK_RAM_BASE = 0x400000;

// ─── Globals (offset workRam relativi a 0x400000) ────────────────────────

/** Offset workRam di POS_X (assoluto = 0x400690). Word big-endian. */
export const POS_X_WORD_OFF = 0x690 as const;
/** Offset workRam di POS_Y (assoluto = 0x400692). Word big-endian. */
export const POS_Y_WORD_OFF = 0x692 as const;
/** Offset workRam di HUD_OFFSET (assoluto = 0x40097E). Word big-endian. */
export const HUD_OFFSET_WORD_OFF = 0x97e as const;

// ─── Offsets entity (A1) ─────────────────────────────────────────────────

/** Word @ entity+0xC: posizione x (origine globale POS_X). */
export const ENTITY_X_OFF = 0x0c as const;
/** Word @ entity+0x10: posizione y (origine globale POS_Y). */
export const ENTITY_Y_OFF = 0x10 as const;
/** Word @ entity+0x14: input ausiliario w4 per il calcolo HUD-relativo. */
export const ENTITY_W4_OFF = 0x14 as const;
/** Long @ entity+0x20: destinazione coords packed scritta sempre. */
export const ENTITY_PACKED_OFF = 0x20 as const;
/** Base entity per il clear loop (3 word a `0x26 + i*6`, i ∈ {0,1,2}). */
export const ENTITY_CLEAR_BASE_OFF = 0x26 as const;
/** Stride del clear loop (in byte). */
export const CLEAR_STRIDE = 6 as const;
/** Numero di word azzerate nel branch MISS. */
export const CLEAR_COUNT = 3 as const;

// ─── Costanti algoritmo ──────────────────────────────────────────────────

/** Addendo per `D3w = posY - posX + 0x88`. */
export const YMINUSX_BIAS = 0x88 as const;
/** Addendo per `D2w = HUD + w4 + 0x54`. */
export const HUD_BIAS = 0x54 as const;
/** Shift `asr.w #3` applicato alle coordinate per derivare cellX/cellY. */
export const CELL_SHIFT = 3 as const;

/** Mode hard-coded passato come secondo arg long alla jsr `FUN_264AA`. */
export const INNER_MODE = 3 as const;

/** Set di `cellX` che soddisfa il test sul ramo HIT (`cmpi.b` + `beq.w`). */
export const HIT_CELLX_SET: readonly number[] = [0x29, 0x31, 0x39] as const;
/** Soglia minima signed di `cellY` per il ramo HIT (`cmpi.b #0x34; blt`). */
export const HIT_CELLY_THRESHOLD = 0x34 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Callback che modella `FUN_000264AA`. Riceve `(structPtr, mode)` come long
 * pushati dallo shim. Lo shim ritorna verbatim il `D0` della callback. La
 * firma è identica a `Inner264AA` di `object-enter-1281c.ts` /
 * `sprite-coords-jsr-150d0.ts`.
 *
 * @param structPtr  = `A1` (verbatim, non normalizzato).
 * @param mode       hard-coded a `INNER_MODE = 3`.
 */
export type Inner264AA = (structPtr: number, mode: number) => number;

/** Stub injection per la `jsr FUN_264AA`. */
export interface MarbleCellDispatch19E42Subs {
  /**
   * `FUN_264AA`: dispatch su sub esterna. Default: no-op che ritorna 0.
   * Per parity bit-perfect col binario stubbato `move.l (8,SP), D0; rts`,
   * passare `(_, m) => m`.
   */
  inner264AA?: Inner264AA;
}

// ─── Risultato ───────────────────────────────────────────────────────────

/** Quale ramo è stato preso al termine della funzione. */
export type DispatchBranch = "hit" | "miss";

export interface MarbleCellDispatch19E42Result {
  /** Ramo selezionato in base al test cellX/cellY. */
  branch: DispatchBranch;
  /** `cellX = (entity.x_word >> 3)` low byte (signed/unsigned identico
   *   sui valori usati dal test). */
  cellX: number;
  /** `cellY = (entity.y_word >> 3)` low byte. */
  cellY: number;
  /** Long packed scritto a `entity[0x20..0x23]`. */
  packed: number;
  /** Numero di chiamate effettuate a `subs.inner264AA` (= 1 su hit, 0 su miss). */
  innerCalls: number;
  /** Valore di ritorno della callback inner sul ramo hit (0 su miss). */
  innerReturn: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readU16(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function writeU16(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function writeU32(state: GameState, off: number, v: number): void {
  const u = v >>> 0;
  state.workRam[off] = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8) & 0xff;
  state.workRam[off + 3] = u & 0xff;
}

/**
 * Sign-extend 16-bit → JS signed 32-bit. Usato per `ext.l Dn` e per il
 * confronto signed di `cmpi.b #0x34, D0b; blt`.
 */
function sext16(w: number): number {
  return (w & 0x8000) !== 0 ? w - 0x10000 : w;
}

/** Sign-extend 8-bit → JS signed. Usato per `cmpi.b ..; blt` (signed). */
function sext8(b: number): number {
  return (b & 0x80) !== 0 ? b - 0x100 : b;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00019E42`.
 *
 * @param state       GameState. Letture: `workRam[0x97E]`,
 *                    `entity[0xC, 0x10, 0x14]`. Scritture sempre:
 *                    `workRam[0x690..0x693]`, `entity[0x20..0x23]`.
 *                    Scritture solo MISS: `entity[0x26, 0x2C, 0x32]` (word).
 * @param entityAddr  Indirizzo assoluto m68k della struct entity (A1 nel
 *                    binario, long pushato dal caller). Convertito a offset
 *                    `entityAddr - 0x400000` per accedere a `workRam`.
 * @param subs        Injection. `subs.inner264AA(entity, 3)` chiamato una
 *                    volta solo nel ramo HIT. Default: ritorna 0.
 *
 * @returns Dettaglio sul ramo, valori cellX/cellY, packed, e contatori
 *          chiamate inner.
 *
 * **Ordine delle scritture** (rilevante per parity):
 *   1. `workRam[0x690..0x691]` = entity[0xC..0xD]
 *   2. `workRam[0x692..0x693]` = entity[0x10..0x11]
 *   3. `entity[0x20..0x23]` = packed long
 *   4. (solo HIT)  `subs.inner264AA(entity, 3)`
 *      (solo MISS) `entity[0x26]=0; entity[0x2C]=0; entity[0x32]=0` (word)
 */
export function marbleCellDispatch19E42(
  state: GameState,
  entityAddr: number,
  subs?: MarbleCellDispatch19E42Subs,
): MarbleCellDispatch19E42Result {
  const a1 = entityAddr >>> 0;
  const argOff = (a1 - WORK_RAM_BASE) >>> 0;

  // ─── Step 1+2: copia POS_X / POS_Y dall'entity ai globals ──────────────
  // `lea (0xC,A1),A0; move.w (A0),(A2)` → *0x400690 = entity[0xC..0xD]
  // `lea (0x10,A1),A0; move.w (A0),(A3)` → *0x400692 = entity[0x10..0x11]
  const w0 = readU16(state, argOff + ENTITY_X_OFF);
  const w2 = readU16(state, argOff + ENTITY_Y_OFF);
  const w4 = readU16(state, argOff + ENTITY_W4_OFF);

  writeU16(state, POS_X_WORD_OFF, w0);
  writeU16(state, POS_Y_WORD_OFF, w2);

  // ─── Step 3: calcolo packed long → entity[0x20..0x23] ─────────────────
  // D3.w = (posY - posX + 0x88) (word arithmetic).
  const yMinusX = ((w2 - w0) + YMINUSX_BIAS) & 0xffff;

  // D2.w = HUD + w4 + 0x54  (word arithmetic).
  const hudOff = readU16(state, HUD_OFFSET_WORD_OFF);
  let d2w = (hudOff + w4 + HUD_BIAS) & 0xffff;

  // D0 (long) = sext_l(posY) + sext_l(posX); D0 >>= 1 (asr.l #1, signed).
  // Solo D0w viene poi sub-tratto da D2w (sub.w D0w,D2w) → low 16-bit ok.
  const yS = sext16(w2);
  const xS = sext16(w0);
  const avgLong = (yS + xS) >> 1; // signed >> preserva il segno
  d2w = (d2w - (avgLong & 0xffff)) & 0xffff;

  // D2 (long) = D2w (zero-extended)
  const d2Long = d2w & 0xffff;

  // D1 = sext_l(D3w) << 16  (low 16 bit del prodotto è 0).
  const d3Signed = sext16(yMinusX);
  const d1Long = ((d3Signed << 16) | 0) >>> 0;

  // packed = D1 + D2 (add.l D1,D2)
  const packed = (d1Long + d2Long) >>> 0;

  writeU32(state, argOff + ENTITY_PACKED_OFF, packed);

  // ─── Step 4: derive cellX / cellY (asr.w #3 = signed shift right) ─────
  //   cellX_word = sext16(entity.x) >> 3
  //   cellY_word = sext16(entity.y) >> 3
  //   cellX = low byte di cellX_word
  //   cellY = low byte di cellY_word
  const cellXWord = xS >> CELL_SHIFT;
  const cellYWord = yS >> CELL_SHIFT;
  const cellX = cellXWord & 0xff;
  const cellY = cellYWord & 0xff;

  // ─── Step 5: dispatch HIT / MISS ──────────────────────────────────────
  // HIT: cellX ∈ {0x39, 0x31, 0x29}  AND  cellY (signed) >= 0x34
  // (cmpi.b #0x34, D0b; blt → MISS  ⇔  cellY < 0x34 signed)
  const cellXMatch =
    cellX === 0x39 || cellX === 0x31 || cellX === 0x29;
  const cellYOk = sext8(cellY) >= HIT_CELLY_THRESHOLD;

  if (cellXMatch && cellYOk) {
    // HIT branch: jsr FUN_264AA(entity, 3)
    const innerReturn =
      subs?.inner264AA !== undefined
        ? subs.inner264AA(a1, INNER_MODE) >>> 0
        : 0;
    return {
      branch: "hit",
      cellX,
      cellY,
      packed,
      innerCalls: subs?.inner264AA !== undefined ? 1 : 0,
      innerReturn,
    };
  }

  // MISS branch: clear loop su 3 word a `entity[0x26 + i*6]`, i ∈ {0,1,2}.
  for (let i = 0; i < CLEAR_COUNT; i++) {
    writeU16(state, argOff + ENTITY_CLEAR_BASE_OFF + i * CLEAR_STRIDE, 0);
  }

  return {
    branch: "miss",
    cellX,
    cellY,
    packed,
    innerCalls: 0,
    innerReturn: 0,
  };
}
