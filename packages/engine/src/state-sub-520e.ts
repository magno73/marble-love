/**
 * state-sub-520e.ts — replica `FUN_0000520E` (64 byte, fino al `rts` @ 0x524E).
 *
 * Sub di re-init "slot record" parametrica su `A2` (base struct in workRam).
 * Eseguita 3 volte da `FUN_00004F38` (call sites @ 0x5032, 0x5078, 0x51FA) come
 * step di reset di un record di sound/voice channel. Tre fasi distinte di clear
 * + due `OR` su una bitmap di status flags @ `0x401F5E`. Replica bit-perfect.
 *
 * **Disasm 0x520E..0x524E** (66 byte / 0x42; il prompt cita "40 byte" inteso
 * come hex 0x40 = 64 = lunghezza codice utile fino all'`rts`):
 *
 *   0x520E:  moveq  #8,D0                 ; D0 = 0x00000008
 *   0x5210:  loop1: clr.b (0x0,A2,D0w*1)  ; *(A2 + D0w) = 0
 *   0x5214:        dbf D0w, loop1         ; clears A2+0..A2+8 (9 byte)
 *   0x5218:  moveq  #4,D0                 ; D0 = 0x00000004
 *   0x521A:  loop2: clr.b (0xE,A2,D0w*1)
 *   0x521E:        dbf D0w, loop2         ; clears A2+0xE..A2+0x12 (5 byte)
 *   0x5222:  moveq  #3,D1                 ; D1 = 3 (mask)
 *   0x5224:  bsr.b   0x5248                ; → or.l D1,(0x401F5E).l (sets bits 0,1)
 *   0x5226:  moveq  #9,D0                 ; D0 = 0x00000009
 *   0x5228:  loop3: clr.b (0x14,A2,D0w*1)
 *   0x522C:        dbf D0w, loop3         ; clears A2+0x14..A2+0x1D (10 byte)
 *   0x5230:  move.b (0x9,A2),D0b          ; D0 = 0x0000FF00 | byte_at_A2+9
 *                                          ; (D0w high byte = 0xFF da loop3
 *                                          ;  finale, low byte = pre-existing
 *                                          ;  byte at A2+9, MAI clearato)
 *   0x5234:  bsr.b   0x523A                ; → fun523A(D0): set bit
 *                                          ;   shift = (D0 - 2) & 0x3F (D0 ≥ 2)
 *                                          ;   |0x401F5E |= (1 << shift) o no-op
 *   0x5236:  move.l (0x4,SP),D0           ; D0 = long-BE @ SP+4 (vedi sotto)
 *   0x523A:  fun523A: cmpi.l #2,D0
 *   0x5240:           bcs.b skip
 *   0x5242:           subq.l #2,D0
 *   0x5244:  skip:    moveq  #1,D1
 *   0x5246:           asl.l  D0,D1         ; D1 = 1 << (D0 & 0x3F), 0 se ≥32
 *   0x5248:           or.l   D1,(0x401F5E).l
 *   0x524E:           rts
 *
 * **Note flow control critiche**:
 *   - `bsr.b 0x523A` @ 0x5234 spinge return address 0x5236 in stack. `rts` di
 *     0x523A ritorna a 0x5236. Il codice a 0x5236 (`move.l (4,SP),D0`) viene
 *     ESEGUITO, poi cade per fall-through dentro 0x523A di nuovo.
 *   - Il `bsr.b 0x5248` @ 0x5224 invece va direttamente al subroutine `or.l`
 *     senza fall-through (0x5248 è già il body, non la testa di FUN_523A).
 *
 * **Convention caller (FUN_4F38 @ stack frame established al 0x4FA2)**:
 *   - `A2` = pointer in workRam (struct base)
 *   - SP punta a return-address di FUN_520E. Layout stack a 0x5236:
 *     • SP[0..3]  = return address al caller (e.g. 0x5036)
 *     • SP[4..7]  = bottom dei `movem.l ...,-(SP)` di FUN_4F38 = saved A3
 *     • SP[8..11] = saved A2 (originale)
 *     • SP[12..23] = saved D5,D4,D3,D2
 *     • SP[24..27] = original entry return address di FUN_4F38
 *   - Quindi `(4,SP)` @ 0x5236 = saved A3, che FUN_4F38 setta a `0xF00001`
 *     @ 0x4FA4 con `lea (0xF00001).l, A3`.
 *   - Per A3 = 0x00F00001: D0 ≥ 2 → subq → 0x00EFFFFF → `& 0x3F` = 0x3F = 63
 *     → asl.l shift=63 → D1 = 0 → `or.l 0` no-op. **L'effetto pratico in
 *     produzione è zero**.
 *
 * **Side effects (workRam)**:
 *   1. byte clear:  A2[0..8]      (9 byte, offsets 0,1,...,8)
 *   2. byte clear:  A2[0xE..0x12] (5 byte)
 *   3. long-BE OR:  *0x401F5E |= 0x00000003  (bits 0,1)
 *   4. byte clear:  A2[0x14..0x1D] (10 byte)
 *   5. long-BE OR:  *0x401F5E |= bitFromByteA2_9      (1 bit, byte∈[2,33] → bits 0..31)
 *   6. long-BE OR:  *0x401F5E |= bitFromStackD0       (1 bit, derivata da `(4,SP)`)
 *
 * Il byte @ A2+9 NON è clearato da nessuna delle tre fasi (offsets 0..8, 0xE..
 * 0x12, 0x14..0x1D escludono 0x9..0xD). Quindi conserva il valore preesistente
 * in workRam.
 *
 * **Modellazione TS**:
 *   - Il valore del long @ SP+4 è effetto del frame stack di FUN_4F38; in
 *     produzione è sempre `0x00F00001` (saved A3 dopo `lea`). Lo esponiamo
 *     come parametro `stackD0` (default `0x00F00001`) per testabilità: la
 *     parity test passa il long-BE letto da workRam @ posizione SP+4 al
 *     momento della chiamata, leggendola PRIMA dell'esecuzione (i clear di
 *     fase 1/2/3 non toccano quel range, quindi il valore è stable).
 *   - L'`asl.l Dn,D1` M68k con shift count ≥ 32 produce 0; JS `<<` masca a
 *     5 bit, quindi guard esplicito.
 *   - Il count shift è `D0 & 0x3F` perché `asl.l` usa shift count modulo 64.
 *     Per D0 = 0xFF + byte_at_A2_9, il `0xFF00` masca via i bit alti, lasciando
 *     soltanto `(byte_at_A2_9 - 2) & 0x3F` perché 0xFF00 & 0x3F = 0.
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-520e-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Offset workRam della status-flags bitmap u32 BE @ 0x401F5E. */
export const STATUS_FLAGS_OFF = 0x1f5e as const;

/** WORK RAM base assoluta M68k. */
const WORK_RAM_BASE = 0x400000;

/** Maschera fissa OR-ed dal `bsr 0x5248` con D1=3 (bits 0,1). */
export const FIXED_OR_MASK = 0x00000003 as const;

/** Default per `stackD0`: in produzione FUN_4F38 setta A3 = 0x00F00001. */
export const PRODUCTION_STACK_D0 = 0x00f00001 as const;

/**
 * Helper interno: replica `FUN_0000523A` (cmpi.l #2 / subq / asl / or).
 *
 * Setta `*0x401F5E |= 1 << ((d0 ≥ 2 ? d0 - 2 : d0) & 0x3F)` se shift < 32,
 * altrimenti no-op. Esposto per testabilità isolata.
 *
 * @param state  GameState (workRam @ 0x1F5E mutato).
 * @param d0     argomento long unsigned 32 bit.
 */
export function fun523AInner(state: GameState, d0: number): void {
  const d0u = d0 >>> 0;
  // cmpi.l #2,D0 + bcs.b → branch se D0 < 2 (unsigned).
  const beforeShift = d0u < 2 ? d0u : (d0u - 2) >>> 0;
  // M68k asl.l usa shift count mod 64. JS `<<` masca a 5 bit, quindi mod 64
  // esplicito. Per shift count ≥ 32 il risultato è 0 (i bit escono dal long).
  const shift = beforeShift & 0x3f;
  const d1 = shift >= 32 ? 0 : ((1 << shift) >>> 0);
  if (d1 === 0) return; // OR con 0 = no-op

  const r = state.workRam;
  const cur =
    (((r[STATUS_FLAGS_OFF] ?? 0) << 24) |
      ((r[STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[STATUS_FLAGS_OFF + 3] ?? 0)) >>>
    0;
  const next = (cur | d1) >>> 0;
  r[STATUS_FLAGS_OFF] = (next >>> 24) & 0xff;
  r[STATUS_FLAGS_OFF + 1] = (next >>> 16) & 0xff;
  r[STATUS_FLAGS_OFF + 2] = (next >>> 8) & 0xff;
  r[STATUS_FLAGS_OFF + 3] = next & 0xff;
}

/**
 * Replica `FUN_0000520E` — slot record reset + status flags OR.
 *
 * Vedi disasm e semantica nell'header del file.
 *
 * @param state    GameState mutato in due regioni:
 *                 (1) workRam @ A2 (3 range disgiunti di clear);
 *                 (2) workRam @ 0x1F5E (long-BE OR cumulativo).
 * @param a2       Pointer assoluto M68k (long). Deve puntare in workRam
 *                 (`0x400000..0x401FFF`). I range clearati sono:
 *                   - `[A2+0,    A2+8]`  (9 byte)
 *                   - `[A2+0xE,  A2+0x12]` (5 byte)
 *                   - `[A2+0x14, A2+0x1D]` (10 byte)
 *                 Byte @ A2+9 NON è clearato (preserva preexisting per il
 *                 successivo OR derivato).
 * @param stackD0  Long letto da `(4,SP)` @ 0x5236. In produzione (caller
 *                 FUN_4F38) è sempre `0x00F00001` (saved A3 dopo
 *                 `lea (0xF00001).l, A3`). Default: `PRODUCTION_STACK_D0`.
 *                 Per parity testing si passa il long-BE letto da workRam
 *                 alla posizione fisica SP+4 PRIMA dell'esecuzione.
 *
 * @returns void. Side effects elencati nell'header.
 */
export function stateSub520E(
  state: GameState,
  a2: number,
  stackD0: number = PRODUCTION_STACK_D0,
): void {
  const a2u = a2 >>> 0;
  const r = state.workRam;

  // ── Pre-cattura del byte @ A2+9 ────────────────────────────────────────
  // Le tre fasi di clear NON toccano il byte a A2+9 (offsets clearati:
  // 0..8, 0xE..0x12, 0x14..0x1D), quindi il valore osservato dall'istruzione
  // `move.b (9,A2),D0b` @ 0x5230 è quello PRESENTE in workRam all'entrata.
  // Per chiarezza lo leggiamo subito (è equivalente a leggerlo dopo le clear).
  const a2Off = (a2u - WORK_RAM_BASE) >>> 0;
  const byteAtA2Plus9Addr = a2Off + 9;
  const byteAtA2Plus9 =
    byteAtA2Plus9Addr < r.length ? (r[byteAtA2Plus9Addr] ?? 0) & 0xff : 0;

  // ── Fase 1: clear A2+0..A2+8 (9 byte) ─────────────────────────────────
  // M68k: D0 = 8, decrementa via dbf, scrive `(0,A2,D0w*1)`. Esegue body
  // 9 volte (D0 = 8,7,...,0). Replica come loop diretto.
  for (let i = 0; i <= 8; i++) {
    const off = a2Off + i;
    if (off < r.length) r[off] = 0;
  }

  // ── Fase 2: clear A2+0xE..A2+0x12 (5 byte) ────────────────────────────
  // M68k: D0 = 4, decrementa via dbf, scrive `(0xE,A2,D0w*1)`. Esegue 5 volte.
  for (let i = 0; i <= 4; i++) {
    const off = a2Off + 0xe + i;
    if (off < r.length) r[off] = 0;
  }

  // ── OR fisso: bits 0,1 (mask 0x3) @ 0x401F5E ──────────────────────────
  // bsr.b 0x5248 con D1=3 (moveq #3,D1 @ 0x5222). 0x5248 fa solo `or.l`.
  // Equivalente a fun523AInner con d0 tale che (1 << shift) = 3? No: il
  // bsr 0x5248 NON passa per la testa di FUN_523A; D1 è settato direttamente
  // a 3 dal moveq. Quindi è un OR diretto con maschera 3.
  applyStatusFlagsOr(r, FIXED_OR_MASK);

  // ── Fase 3: clear A2+0x14..A2+0x1D (10 byte) ──────────────────────────
  for (let i = 0; i <= 9; i++) {
    const off = a2Off + 0x14 + i;
    if (off < r.length) r[off] = 0;
  }

  // ── OR derivato dal byte @ A2+9 ───────────────────────────────────────
  // M68k: D0w high byte è 0xFF (da `dbf D0w` finale del loop3 con uscita
  // su D0w = 0xFFFF). `move.b (9,A2),D0b` aggiorna SOLO D0 low byte.
  // Quindi D0 = 0x0000FF00 | byte_at_A2_9.
  // Notare: bits alti di D0 (bit 16..31) sono 0 perché `moveq` @ 0x5226
  // azzera tutto il long e dbf decrementa solo low word.
  const d0FromByte = (0xff00 | byteAtA2Plus9) >>> 0;
  fun523AInner(state, d0FromByte);

  // ── Path "dead-code reachable": (4,SP) load + fall-through in 523A ────
  // bsr.b 0x523A @ 0x5234 ritorna a 0x5236, che esegue `move.l (4,SP),D0`
  // (long-BE da SP+4) e POI cade nel body di 523A di nuovo.
  // In produzione SP+4 = saved A3 = 0x00F00001 → shift = 63 → D1 = 0 → no-op.
  fun523AInner(state, stackD0 >>> 0);
}

/** Helper interno: OR cumulativo di una maschera nel long-BE @ 0x401F5E. */
function applyStatusFlagsOr(r: Uint8Array, mask: number): void {
  const m = mask >>> 0;
  if (m === 0) return;
  const cur =
    (((r[STATUS_FLAGS_OFF] ?? 0) << 24) |
      ((r[STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[STATUS_FLAGS_OFF + 3] ?? 0)) >>>
    0;
  const next = (cur | m) >>> 0;
  r[STATUS_FLAGS_OFF] = (next >>> 24) & 0xff;
  r[STATUS_FLAGS_OFF + 1] = (next >>> 16) & 0xff;
  r[STATUS_FLAGS_OFF + 2] = (next >>> 8) & 0xff;
  r[STATUS_FLAGS_OFF + 3] = next & 0xff;
}
