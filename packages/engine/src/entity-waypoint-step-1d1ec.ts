/**
 * entity-waypoint-step-1d1ec.ts — replica `FUN_0001D1EC` (86 byte).
 *
 * Sub-function "advance-script-cursor-when-at-waypoint" del subsystem
 * entity. Ricevuta dal caller (FUN_00017346 e FUN_0001725A: 3 call site
 * @ 0x1747a, 0x17536, 0x172ac), cui passa una struct entity tramite long
 * pointer sullo stack.
 *
 * **Argomento (1 long sullo stack)**: `entityPtr` = pointer alla struct
 * entity (in WORK_RAM o altrove). Layout dei campi rilevanti:
 *
 *   off 0x0c (long) : posizione X 32-bit fixed-point.
 *   off 0x10 (long) : posizione Y 32-bit fixed-point.
 *   off 0x2c (long) : cursor pointer dentro array di triplette di byte.
 *   off 0x30 (long) : base pointer dell'array (per branch back-relative).
 *
 * **Disasm 0x1D1EC..0x1D241** (86 byte):
 *
 *   move.l  D2,-(SP)                 ; salva D2
 *   movea.l (0x8,SP),A0              ; A0 = entityPtr (SP+8: ret(4)+saved D2(4))
 *   move.l  (0xc,A0),D1              ; D1 = pos.X long
 *   moveq   #0x13,D0
 *   asr.l   D0,D1                    ; D1 = signed_asr(pos.X, 19)
 *   move.w  D1w,D2w                  ; D2.w = D1 low word (cella X)
 *   move.l  (0x10,A0),D1             ; D1 = pos.Y long
 *   moveq   #0x13,D0
 *   asr.l   D0,D1                    ; D1 = signed_asr(pos.Y, 19) (low word usata)
 *   movea.l (0x2c,A0),A1             ; A1 = cursor
 *   move.b  (A1),D0b                 ; D0.b = cursor[0] (cellaX target, signed byte)
 *   ext.w   D0w
 *   cmp.w   D2w,D0w                  ; cmp cursor[0], entity.cellX
 *   bne.b   skip                     ; mismatch X → skip
 *   movea.l (0x2c,A0),A1
 *   move.b  (0x1,A1),D0b             ; D0.b = cursor[1] (cellaY target)
 *   ext.w   D0w
 *   cmp.w   D1w,D0w                  ; cmp cursor[1], entity.cellY
 *   bne.b   skip                     ; mismatch Y → skip
 *   ; X e Y matchano: avanza cursor
 *   movea.l (0x2c,A0),A1
 *   move.b  (0x2,A1),D0b             ; D0.b = cursor[2] (signed byte = step)
 *   ext.w   D0w
 *   ext.l   D0                       ; D0 sign-extended a long
 *   asl.l   #2,D0                    ; D0 = step * 4
 *   add.l   (0x30,A0),D0             ; D0 += base
 *   move.l  D0,(0x2c,A0)             ; cursor = base + step*4
 *  skip:
 *   move.l  A0,-(SP)                 ; push entityPtr
 *   jsr     0x0001d242.l             ; FUN_1D242(entityPtr) — follow-up
 *   addq.l  #4,SP                    ; pop arg
 *   move.l  (SP)+,D2                 ; restore D2
 *   rts
 *
 * **Semantica**: se la cella corrente dell'entity (X = pos.X >> 19,
 * Y = pos.Y >> 19, asr signed troncata a word) coincide con il waypoint
 * puntato dal cursor (`(cursor[0], cursor[1])` come signed byte = signed
 * word), avanza cursor a `base + signed(cursor[2]) * 4`. Poi forwarda a
 * `FUN_0001D242(entityPtr)` (logica di follow-up indipendente).
 *
 * **Edge cases**:
 *   - Confronto cmp.w: i byte cursor[0/1] sono sign-extended a word;
 *     coordinate (asr.l 19) sono troncate a word ma `(>>19).low16` di un
 *     long signed corrisponde al signed sign-extended cell index.
 *   - `cursor[2]` è signed byte (ext.w → ext.l → *4): step può essere
 *     negativo (jump back-relative).
 *   - `asl.l #2`: shift logico/aritmetico (su 68k asl=lsl, ma qui
 *     comportamento è uguale per il 32-bit risultato; usiamo `<< 2`).
 *   - L'add con (A0+0x30) avviene a 32 bit; il risultato è lo stesso
 *     `(>>> 0)`.
 *
 * **JSR target identificato**: `FUN_0001D242` (alias `fun_1d242` nel
 * `EntityWaypointStep1D1ECSubs`). NON è replicata qui: viene esposta via
 * stub injection. La funzione FUN_1D242 (più grande) gestisce la logica di
 * "decide direction" successiva.
 *
 * Verifica bit-perfect via `cli/src/test-entity-waypoint-step-1d1ec-parity.ts`
 * con FUN_1D242 patched a `rts` e callback no-op.
 */

import type { GameState } from "./state.js";

/** Stub injection per la JSR a 0x1D242. */
export interface EntityWaypointStep1D1ECSubs {
  /** FUN_1D242(entityPtr). Default no-op (matching `rts`). */
  fun_1d242?: (entityPtr: number) => void;
}

/** Read a big-endian long from workRam given an absolute address. */
function readLongAbs(state: GameState, addr: number): number {
  const off = (addr - 0x400000) >>> 0;
  const r = state.workRam;
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

/** Read signed byte from workRam at absolute address. */
function readSByteAbs(state: GameState, addr: number): number {
  const off = (addr - 0x400000) >>> 0;
  const v = state.workRam[off] ?? 0;
  return v & 0x80 ? v - 0x100 : v;
}

/** Write a big-endian long to workRam at absolute address. */
function writeLongAbs(state: GameState, addr: number, value: number): void {
  const off = (addr - 0x400000) >>> 0;
  const r = state.workRam;
  const v = value >>> 0;
  r[off] = (v >>> 24) & 0xff;
  r[off + 1] = (v >>> 16) & 0xff;
  r[off + 2] = (v >>> 8) & 0xff;
  r[off + 3] = v & 0xff;
}

/** Signed asr.l su 32 bit (count clamped a [0..63]; usiamo cast). */
function asrL(value: number, count: number): number {
  // value è 32-bit unsigned; convertiamo a signed via `| 0` poi `>>` (signed)
  const c = count & 0x3f;
  return ((value | 0) >> c) | 0;
}

/**
 * Replica bit-perfect di `FUN_0001D1EC`.
 *
 * @param state      GameState (legge/scrive workRam tramite entityPtr).
 * @param entityPtr  long: pointer della struct entity (assoluto, big-endian).
 * @param subs       stub injection per `fun_1d242` (default no-op).
 *
 * **Side effects** in `state.workRam`:
 *   - Se il cursor corrente (offset 0x2c) punta a (X,Y) coincidenti con
 *     la cella derivata da pos.X/pos.Y dell'entity, allora
 *     `*(long*)(entityPtr+0x2c) = (long*)(entityPtr+0x30) + signed(cursor[2])*4`.
 *   - Forwarda a `subs.fun_1d242(entityPtr)`.
 *
 * **Pre-conditions**: `entityPtr` e il cursor `(entityPtr+0x2c)` puntano in
 * memoria leggibile (nel test, allochiamo struct e cursor in WORK_RAM).
 */
export function entityWaypointStep1D1EC(
  state: GameState,
  entityPtr: number,
  subs?: EntityWaypointStep1D1ECSubs,
): void {
  const a0 = entityPtr >>> 0;

  // D1 = pos.X long; D1 = asr.l 19; D2.w = D1 low word
  const posX = readLongAbs(state, a0 + 0x0c);
  const cellX = asrL(posX, 0x13) & 0xffff; // word

  // D1 = pos.Y long; D1 = asr.l 19; (low word usato per cmp)
  const posY = readLongAbs(state, a0 + 0x10);
  const cellY = asrL(posY, 0x13) & 0xffff; // word

  // A1 = cursor; D0 = ext.w(cursor[0])
  const cursor = readLongAbs(state, a0 + 0x2c);
  const c0 = readSByteAbs(state, cursor + 0) & 0xffff; // ext.w → low word

  // cmp.w D2w,D0w; bne → skip
  if (c0 === cellX) {
    const c1 = readSByteAbs(state, cursor + 1) & 0xffff; // ext.w
    if (c1 === cellY) {
      // ext.w → ext.l → asl.l #2 → +base → store
      const stepB = readSByteAbs(state, cursor + 2); // signed byte
      const stepL = (stepB << 2) | 0; // ext.l + asl.l #2 (signed * 4)
      const base = readLongAbs(state, a0 + 0x30);
      const newCursor = (base + stepL) >>> 0;
      writeLongAbs(state, a0 + 0x2c, newCursor);
    }
  }

  // jsr FUN_1D242(entityPtr)
  subs?.fun_1d242?.(a0);
}
