/**
 * state-sub-535e.ts — replica `FUN_0000535E` (42 byte).
 *
 * Trampoline minimale: legge due byte globali in work RAM (`0x401F98` e
 * `0x401F99`), li sign-extende a long e li passa — assieme all'argomento del
 * caller (un long sullo stack) — alla sub `FUN_00005388`. Mirror esatto di
 * `FUN_00005334`, che applica lo stesso pattern ma chiama `FUN_000052DA`.
 *
 * **Disasm 0x535E..0x5387** (42 byte):
 *
 *   move.l (0x4,SP),D0           ; D0 = arg long del caller
 *   move.l D0,-(SP)              ; push arg → diventa (0x10,SP) per il callee
 *   move.b (0x00401F99).l,D0b    ; D0b = byte @ 0x401F99
 *   ext.w  D0w                   ; sign-extend byte → word
 *   ext.l  D0                    ; sign-extend word → long
 *   move.l D0,-(SP)              ; push byte99 (signed long) → (0x0C,SP) callee
 *   move.b (0x00401F98).l,D0b    ; D0b = byte @ 0x401F98
 *   ext.w  D0w
 *   ext.l  D0                    ; signed long
 *   move.l D0,-(SP)              ; push byte98 (signed long) → (0x08,SP) callee
 *   jsr    0x00005388.l          ; chiama inner(byte98_s, byte99_s, arg)
 *   lea    (0xC,SP),SP           ; pop 3 long
 *   rts                          ; D0 = return di FUN_5388
 *
 * **Convenzione caller** (osservata sui 3 callsite reali — tutti pushano UN
 *   long arg prima del jsr):
 *   - `0x56DA`: arg = `(A3w + 1)` ext.l (long), risultato di pre-calcolo locale
 *   - `0x5900`: arg = altro long calcolato
 *   - `0x5B96`: arg = altro long calcolato
 *
 *   Il binario in 0x5358..0x535C (FUN_5334) ha la stessa shape (mirror); i due
 *   trampolini sono presumibilmente formattatori "signed-byte pair + value"
 *   delegati a due implementazioni diverse del callee.
 *
 * **Side effects** in questo modulo: NESSUNO. Tutti gli effetti (workRam,
 * MMIO, ecc.) avvengono dentro `FUN_00005388` che è injectabile come `inner`.
 *
 * **Sign-extend semantica**:
 *   `move.b → ext.w → ext.l`. Per byte `0xFF` ⇒ `D0 = 0xFFFFFFFF` (-1 long).
 *   Per byte `0x80` ⇒ `D0 = 0xFFFFFF80` (-128). Per byte `0x7F` ⇒ `0x7F`.
 *   La replica TS deve usare `(byte << 24) >> 24` (signed shift) e poi `>>>0`
 *   per normalizzare a unsigned 32-bit (il long M68k è agnostico, ma JS
 *   distingue: scegliamo la rappresentazione unsigned per coerenza con i
 *   moduli vicini).
 *
 * **Ritorno (D0)**: pass-through del valore restituito da `inner`. Il binario
 * non altera D0 dopo il `jsr`.
 *
 * **TS convention**: `inner` è iniettabile per test. Default `() => 0` (no-op
 * compatibile con D0=0 = "nessun effetto"). Il differential test usa lo stub
 * inner per catturare i 3 long che il binario passa al callee.
 */

import type { GameState } from "./state.js";

/** Indirizzo assoluto del primo byte globale letto e propagato. */
export const GLOBAL_BYTE_98_ADDR = 0x00401f98 as const;

/** Indirizzo assoluto del secondo byte globale letto e propagato. */
export const GLOBAL_BYTE_99_ADDR = 0x00401f99 as const;

/** WORK RAM base per derivare l'offset all'interno di `state.workRam`. */
const WORK_RAM_BASE = 0x00400000;

/**
 * Signature dell'inner sub (FUN_00005388). Riceve `(byte98_signed_long,
 * byte99_signed_long, arg_long)` — tutti long unsigned 32 bit (la signedness
 * è già materializzata via sign-extend) — e ritorna un long.
 */
export type Sub535ECallee = (
  byte98: number,
  byte99: number,
  arg: number,
) => number;

/**
 * Sign-extende un byte (0..0xFF) a long M68k (0..0xFFFFFFFF) con bit 7 = sign.
 *
 * `byte 0x7F → 0x0000007F`, `byte 0x80 → 0xFFFFFF80`, `byte 0xFF →
 * 0xFFFFFFFF`. Equivalente a `(b << 24) >> 24` (signed shift right) seguito
 * da `>>> 0`.
 */
function signExtendByteToLong(b: number): number {
  return (((b & 0xff) << 24) >> 24) >>> 0;
}

/**
 * Replica bit-perfect di `FUN_0000535E` — trampoline a 3 argomenti.
 *
 * Legge i due byte globali in work RAM, li sign-extende, e li passa con `arg`
 * al callback `inner`.
 *
 * @param state  GameState (solo letture: `workRam[0x1F98]` e `workRam[0x1F99]`).
 * @param arg    long (unsigned 32 bit). L'unico argomento esplicito del caller,
 *               propagato come terzo argomento all'inner.
 * @param inner  callback che modella `FUN_00005388`. Default = `() => 0`. Il
 *               valore ritornato è propagato come D0 della trampoline.
 * @returns      D0 = pass-through del valore ritornato da `inner` (>>> 0).
 *
 * Note di low-level fidelity:
 *   - Le letture sono byte (8 bit) sign-extese a long. Lo store è agnostico:
 *     conta la rappresentazione unsigned 32-bit conforme alla semantica del
 *     binario quando il valore long viene riletto come signed.
 *   - L'ordine di lettura del binario è `0x401F99` PRIMA di `0x401F98`
 *     (push order: prima byte99, poi byte98 sopra). La replica TS preserva
 *     l'ordine di valutazione benché in TS sia osservabile solo via `state`,
 *     che non muta tra le due letture.
 *   - `arg` viene normalizzato a unsigned 32-bit (`>>> 0`) prima di essere
 *     propagato (input negativi → wraparound a complemento 2 long).
 *   - Nessuna scrittura in `state.workRam`. Tutti gli effetti restano nell'inner.
 */
export function stateSub535E(
  state: GameState,
  arg: number,
  inner: Sub535ECallee = () => 0,
): number {
  const r = state.workRam;
  // Offset assoluti → relativi a workRam (0x400000 base).
  const off98 = (GLOBAL_BYTE_98_ADDR - WORK_RAM_BASE) >>> 0;
  const off99 = (GLOBAL_BYTE_99_ADDR - WORK_RAM_BASE) >>> 0;

  // Lettura + sign-extend: byte → long M68k.
  // Ordine binario: prima byte99 (push primo nel listing → arg2 callee),
  // poi byte98 (push secondo → arg1 callee). In TS l'ordine non altera lo
  // stato: replichiamo per fedeltà documentale.
  const byte99Signed = signExtendByteToLong(r[off99] ?? 0);
  const byte98Signed = signExtendByteToLong(r[off98] ?? 0);

  // Normalizza arg a unsigned long.
  const argU = arg >>> 0;

  // jsr inner(byte98, byte99, arg) — order matches stack push of binary
  // (callee vede arg1=(0x4,SP)=byte98, arg2=(0x8,SP)=byte99, arg3=(0xC,SP)=arg).
  return inner(byte98Signed, byte99Signed, argU) >>> 0;
}
