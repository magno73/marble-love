/**
 * dispatch-table-1eea0.ts — replica `FUN_00011AD8` (64 byte).
 *
 * Iteratore "fan-out su tabella @0x1EEA0" parametrico per indice di partenza:
 * dato un byte `argIdx` legge dallo stack (low byte di arg1 long), itera
 * `D2.b` da `argIdx` finché `D2.b == 0x0A` (confronto byte) e per ogni
 * iterazione chiama `FUN_0000428E` (via thunk @0x1B4) con due long arg:
 *   - `arg1Long` = sign-extend(D2.b) (byte → word → long, m68k `ext.w/ext.l`)
 *   - `arg2Long` = ptrCorrente in tabella (`0x1EEA0 + idxIniziale*8 + k*8`,
 *      `k` = numero di iterazione 0-based)
 *
 * **Chi è `argIdx`**: il binario fa `move.b (0xf, SP), D1.b`; con `jsr`+
 * `movem` da prologo SP+12 = arg1 long, SP+15 = low byte di arg1 long
 * (big-endian m68k). Quindi se il caller pusha `pea $XXX`, il low byte di
 * `XXX` è ciò che arriva qui — di norma 0..9 (slot index).
 *
 * **Chi è `FUN_0000428E`**: una grossa routine "score/initials registration"
 * (link.w A6,-6; movem; usa pointer a buffer di stringa @ `(0x401FFC).l + 0x1E`,
 * shift di un long su buffer locale, scansione entry, ecc.). Per FUN_11AD8
 * basta sapere la signature di chiamata: `void fun_428e(long idxLong, long
 * entryPtrLong)`. La replica TS la inietta come stub (default no-op).
 *
 * **Disasm 0x11AD8..0x11B17** (64 byte):
 *
 *   movem.l {D3,D2},-(SP)         ; salva D2/D3 (8 byte)
 *   move.b  (0xF, SP), D1.b       ; D1.b = low byte di arg1 long (SP+12 + 3)
 *   move.b  D1.b, D0.b
 *   ext.w   D0.w
 *   ext.l   D0                    ; D0 = signExt(argIdx)
 *   asl.l   #3, D0                ; D0 = signExt(argIdx) * 8
 *   addi.l  #0x1EEA0, D0          ; D0 = 0x1EEA0 + signExt(argIdx)*8
 *   move.l  D0, D3                ; D3 = ptr corrente in tabella
 *   move.b  D1.b, D2.b            ; D2.b = argIdx (loop counter byte)
 *   bra.b   0x11B0C               ; → test
 *   ; loop @ 0x11AF4:
 *     move.l  D3, D0              ; D0 = ptr corrente
 *     addq.l  #8, D3              ; D3 += 8 (next entry)
 *     move.l  D0, -(SP)           ; push arg2 = ptrCorrente (long)
 *     move.b  D2.b, D0.b          ; D0.b = D2.b
 *     ext.w   D0.w
 *     ext.l   D0                  ; D0 = signExt(D2.b)
 *     move.l  D0, -(SP)           ; push arg1 = signExt(D2.b) (long)
 *     jsr     0x1B4.l             ; FUN_0000428E (via thunk @0x1B4 → 0x428E)
 *     addq.l  #8, SP              ; pop 2 long
 *     addq.b  #1, D2.b            ; D2.b++ (byte add: wraps 0xFF→0x00)
 *   ; test @ 0x11B0C:
 *     cmpi.b  #0x0A, D2.b         ; D2.b == 0x0A?
 *     bne.b   0x11AF4             ; no → loop
 *   movem.l (SP)+, {D2,D3}        ; restore
 *   rts
 *
 * **Sequenza chiamate (esempi)**:
 *   - argIdx = 0: 10 chiamate (D2.b = 0,1,2,...,9; ptr 0x1EEA0,0x1EEA8,..,0x1EEE8)
 *   - argIdx = 9: 1 chiamata  (D2.b = 9; ptr 0x1EEA0+9*8 = 0x1EEE8)
 *   - argIdx = 0x0A: 0 chiamate (test fallisce subito → loop saltato)
 *   - argIdx = 0x0B: 255 chiamate (D2.b: 0x0B,0x0C,...,0xFF,0x00,...,0x09)
 *     in totale `(0x100 - 0x0B) + 0x0A = 0xFF` iterazioni; il ptr D3 parte
 *     da 0x1EEA0 + signExt(0x0B)*8 = 0x1EEA0 + 0x58 = 0x1EEF8 ed avanza di
 *     8 ad ogni iter (NON considera il sign-extend del low-byte D2 nel ptr,
 *     solo per arg1 della call).
 *   - argIdx = 0xFF (signed -1): D3 parte 0x1EEA0 - 8 = 0x1EE98, e ASL preserva
 *     il segno del long (`asl.l #3` su 0xFFFFFFFF → 0xFFFFFFF8). 11 iter
 *     (D2.b: 0xFF,0x00,...,0x09).
 *
 * **Caller noti**: `FUN_0001464A` con due `jsr 0x11AD8.l` @ 0x148F8 e 0x14918,
 * pattern "score/initials register" (post-game register-name screen).
 *
 * Nessun side effect diretto sulla work RAM dentro a FUN_11AD8 stesso (oltre
 * a quelli del callee `FUN_428E`). Il return D0 non è significativo (D0 viene
 * sovrascritto solo come scratch nel loop e non c'è `moveq` finale).
 *
 * Verifica bit-perfect via `cli/src/test-dispatch-table-1eea0-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Base della tabella in ROM @ `0x1EEA0`. Stride = 8 byte/entry. */
export const TABLE_BASE = 0x0001eea0 as const;
/** Stride fra entry consecutive (asl.l #3 = ×8). */
export const ENTRY_STRIDE = 8 as const;
/** Sentinel del loop counter byte: il ciclo termina quando `D2.b == 0x0A`. */
export const LOOP_SENTINEL = 0x0a as const;

/**
 * Stub injection per la JSR a `FUN_0000428E` (callee binario, raggiunto via
 * thunk `jmp` @ `0x1B4`).
 *
 * **Signature** binaria: due long sullo stack, low byte di arg1 (SP+0xB dal
 * punto di vista del callee post-prologo) usato come "row index/code" e arg2
 * come pointer ad entry @ `0x1EEA0 + i*8`.
 *
 * Default: no-op (matching `rts`-patch nel parity test).
 */
export interface DispatchTable1EEA0Subs {
  /**
   * `FUN_428E(arg1Long, arg2Long, state)`.
   *
   * - `arg1Long`: sign-extend(D2.b) come long (es. byte 0xFF → long 0xFFFFFFFF).
   * - `arg2Long`: ptr corrente nella tabella `0x1EEA0 + (signExt(argIdx)*8) + k*8`.
   *   Nota: il ptr usa il sign-extend dell'argIdx ORIGINALE per il base; le
   *   iterazioni successive incrementano di 8 il ptr ma NON re-signextendono
   *   D2.b — è puro `addq.l #8, D3`.
   * - `state`: passato per comodità (la callee binaria modifica work RAM).
   */
  fun_428e?: (arg1Long: number, arg2Long: number, state: GameState) => void;
}

/**
 * Sign-extend di un byte a long (32 bit) — replica `ext.w D0w; ext.l D0`
 * dopo `move.b X, D0.b`. Su m68k i bit alti di D0 NON sono toccati dal
 * `move.b`, ma `ext.w` riempie i bit 8..15 col bit 7, e `ext.l` riempie i
 * bit 16..31 col bit 15 (= bit 7 originale). Risultato: long con sign-ext.
 */
function signExtByte(b: number): number {
  return ((b & 0x80) !== 0 ? (b | 0xffffff00) : (b & 0xff)) >>> 0;
}

/**
 * Replica bit-perfect di `FUN_00011AD8` — itera `D2.b` da `argIdxByte` a
 * (esclusivo) `0x0A` (con wrap byte se argIdxByte > 0x0A), chiamando
 * `FUN_0000428E(signExt(D2.b), basePtr + k*8)` per ogni k = 0,1,...
 *
 * @param state    GameState passato alla callback (FUN_11AD8 in sé non
 *                 tocca la work RAM; tutti gli effetti vengono dal callee).
 * @param argIdxByte Low byte dell'arg1 long del caller (`(0xF, SP).b` nel
 *                 binario). Solo i bit 0..7 contano; il chiamante TS deve
 *                 passare un valore in [0, 255] o lasciare che `& 0xff`
 *                 lo normalizzi. NB: `argIdxByte = 0x0A` produce 0
 *                 iterazioni; `argIdxByte > 0x0A` produce molte iterazioni
 *                 (loop wrap-around byte).
 * @param subs     Stub injection per la JSR a `FUN_0000428E`. Se omessa, le
 *                 chiamate sono no-op (la funzione resta un puro contatore).
 */
export function dispatchTable1EEA0(
  state: GameState,
  argIdxByte: number,
  subs?: DispatchTable1EEA0Subs,
): void {
  const cb = subs?.fun_428e;

  // D1.b = (0xF, SP).b → byte di partenza.
  const argByte = argIdxByte & 0xff;

  // D0 = ext.l(ext.w(D1.b)); D0 *= 8; D0 += 0x1EEA0; D3 = D0
  // Nota: l'ASL è sul long sign-extended, quindi negativi slittano in modo
  // signed (es. 0xFFFFFFFF * 8 = 0xFFFFFFF8 con .l), poi `addi.l` a 0x1EEA0.
  // In TS uso aritmetica modulo 2^32 con `>>> 0`.
  const baseSignExt = signExtByte(argByte);
  // ASL.L #3 su un long: equivale a (x << 3) modulo 2^32.
  const baseShifted = (baseSignExt << 3) >>> 0;
  let ptr = (baseShifted + TABLE_BASE) >>> 0;

  // D2.b = argByte. Il loop continua finché D2.b != 0x0A (cmp byte-only).
  let counterByte = argByte;

  // Limite di sicurezza: il loop binario può iterare al massimo 256 volte
  // (D2.b copre tutti i 256 valori prima di tornare al punto di partenza).
  // Senza questo bound non ci sono casi infiniti, ma metto un assert
  // hard-cap a 256 + 1 per safety.
  for (let safety = 0; safety <= 256; safety++) {
    if (counterByte === LOOP_SENTINEL) return;

    // jsr 0x1B4 → FUN_428E. Args (RTL push):
    //   arg1Long = signExt(D2.b)
    //   arg2Long = ptr corrente (D3 PRE-incremento, dato che il binario fa
    //              `move.l D3, D0; addq.l #8, D3; move.l D0, -(SP)`).
    const arg1Long = signExtByte(counterByte);
    const arg2Long = ptr;
    cb?.(arg1Long, arg2Long, state);

    // addq.l #8, D3 (post-call la addq è già stata eseguita prima, ma
    // siamo coerenti col modello: D3 += 8 per la prossima iter).
    ptr = (ptr + ENTRY_STRIDE) >>> 0;

    // addq.b #1, D2.b (byte add con wrap)
    counterByte = (counterByte + 1) & 0xff;
  }

  // Unreachable (il sentinel 0x0A è sempre raggiunto in ≤256 iter).
  /* c8 ignore next */
  throw new Error("dispatchTable1EEA0: loop di sicurezza superato");
}
