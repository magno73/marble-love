/**
 * state-sub-525c.ts — replica `FUN_0000525C` (40 byte).
 *
 * Sub di init "buffer + status flags" parametrica su un count `D0`. Esegue
 * due fasi:
 *
 *   1. **Buffer clear**: azzera `D0 * 0x14` (= D0 * 20) byte a partire da
 *      `A2 + 0x50`. La scansione è top-down (decrementing), ma il netto è
 *      semplicemente il clear del range `[A2+0x50 .. A2+0x50+D0*20-1]`.
 *
 *   2. **Status flags OR**: chiama `FUN_0000523A` `D0 * 2` volte con argomenti
 *      progressivi `D0 = 6, 7, 8, ...`. Ogni chiamata setta un bit nella
 *      bitmap long @ `0x00401F5E` (`STATUS_FLAGS_OFF`). Per `D0_arg >= 2`
 *      la posizione bit è `D0_arg - 2`. Quindi i bit settati sono
 *      `4, 5, 6, ..., 4 + D0*2 - 1` = `4 .. 3 + D0*2`.
 *
 * **Disasm 0x525C..0x5283** (40 byte):
 *
 *   move.l D2,-(SP)              ; preserve D2
 *   move.l D0,D2                 ; D2 = D0_orig (saved per fase 2)
 *   moveq  #0x14,D1              ; D1 = 20
 *   mulu.w D1w,D0                ; D0 = (D0_orig & 0xFFFF) * 20  (long)
 *   subq.l #1,D0                 ; D0 = D0*20 - 1 (loop top)
 *   loop1:
 *     clr.b  (0x50,A2,D0w*1)     ; *(A2 + 0x50 + signext_w(D0w)) = 0
 *   dbf    D0w,loop1              ; dbf decrements D0w; exit quando D0w == -1
 *   add.l  D2,D2                 ; D2 *= 2
 *   subq.l #1,D2                 ; D2 = D2 - 1 (loop top per fase 2)
 *   moveq  #6,D0                 ; D0 = 6 (primo bit-arg)
 *   loop2:
 *     move.l D0,-(SP)            ; preserve D0
 *     bsr.b  FUN_523A             ; chiama 523A(D0): set bit (D0-2 if D0>=2 else D0)
 *     move.l (SP)+,D0            ; restore D0
 *     addq.l #1,D0                ; D0++ (prossimo bit-arg)
 *   dbf    D2w,loop2              ; dbf D2w; exit quando D2w wraps a -1
 *   move.l (SP)+,D2              ; restore D2
 *   rts
 *
 * **FUN_0000523A (callee, 20 byte)**:
 *
 *   cmpi.l #2,D0
 *   bcs.b  skip                  ; if D0 < 2 (unsigned) skip subq
 *   subq.l #2,D0
 *   skip:
 *   moveq  #1,D1
 *   asl.l  D0,D1                 ; D1 = 1 << D0 (M68k: shift count mod 64; >=32 → 0)
 *   or.l   D1,(0x00401F5E).l     ; *0x401F5E |= D1 (long, big-endian)
 *   rts
 *
 * **Convenzione caller**:
 *   - `D0` (long) = "count" parametrico (numero di slot da inizializzare).
 *   - `A2` (long, ptr assoluto) = base struct in workRam. La regione clearata è
 *     `[A2+0x50, A2+0x50+D0*20)`. `A2` deve puntare in workRam (0x400000+).
 *   - `D2` salvato/ripristinato da prologue/epilogue (callee-saved per ABI).
 *
 * **Side effects**:
 *   1. workRam[A2-0x400000+0x50 .. +0x50+D0*20-1] = 0
 *   2. workRam[0x1F5E..0x1F61] (long BE) |= bitmask con bit `4..3+D0*2` set
 *      (per `D0*2 >= 32` i bit oltre 31 vengono persi: M68k `asl.l` con
 *      conteggio >= 32 produce 0 e l'OR è no-op per quei bit).
 *
 * **Edge cases bit-perfect**:
 *   - `D0 == 0`: `D0*20 - 1 = 0xFFFFFFFF`. La fase 1 esegue UNA scrittura a
 *     `A2 + 0x50 + (-1)` = `A2 + 0x4F` (D0w=0xFFFF sign-extended a long → -1),
 *     poi `dbf D0w` con D0w=0xFFFF esce immediatamente (decremento porterebbe
 *     a -2 ma il test su D0w==-1 PRIMA del decremento non è quello che fa dbf;
 *     vedi nota sotto). In fase 2, `D2 = -1` → dbf D2w cicla 65536 volte
 *     (decrementi 0xFFFF→0xFFFE→...→0→-1). Per evitare questa runaway nel
 *     code TS, il chiamante reale del binario chiama FUN_525C solo con
 *     `D0 >= 1`. Modelliamo comunque la semantica esatta per correttezza.
 *   - `D0` grande: `mulu.w` usa solo low word di D0. Es. `D0 = 0x10001` →
 *     low word 1, mulu = 20. Per `D0 = 0x10000` → mulu = 0. La replica TS
 *     deve usare `(D0 & 0xFFFF) * 20`.
 *   - `asl.l #shift,D1` con `shift >= 32`: M68k → risultato 0 (bit shifted
 *     out of register). JS `<<` masca lo shift a 5 bit, quindi guard esplicito.
 *
 * **Note dbf semantics** (per chi legge il codice):
 *   `dbf Dn, target`: Dn.w := Dn.w - 1; if Dn.w != -1 then branch.
 *   - Stato iniziale 0xFFFF (-1): decrementa a 0xFFFE (-2), test -2 != -1
 *     → branch. Quindi Dn=0xFFFF NON esce dal loop. Ciclic full-range.
 *   - Stato iniziale 0x0000: decrementa a -1, test -1 != -1 → fall through.
 *     Esce dopo 1 iterazione del body (totale: body eseguito 1 volta + dbf).
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-525c-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Offset workRam della status-flags bitmap u32 BE @ 0x401F5E. */
export const STATUS_FLAGS_OFF = 0x1f5e as const;

/** Offset (rispetto ad A2) dell'inizio della regione clearata (fase 1). */
export const BUFFER_OFFSET_FROM_A2 = 0x50 as const;

/** Stride per slot della regione clearata: ogni "count" libera 20 byte. */
export const STRIDE_PER_COUNT = 0x14 as const;

/** Bias del bit-arg di partenza per fase 2 (corrisponde a `moveq #6,D0`). */
export const PHASE2_FIRST_ARG = 6 as const;

/** WORK RAM base assoluta M68k. */
const WORK_RAM_BASE = 0x400000;

/**
 * Replica `FUN_0000523A` — set bit in status flags bitmap.
 *
 * Internal helper esposto per i caller che vogliono testarla isolata.
 *
 * @param state  GameState (workRam @ 0x1F5E mutato).
 * @param d0     argomento long (unsigned 32 bit). Il bit settato è
 *               `D1 = 1 << (d0 < 2 ? d0 : d0 - 2)`. Per shift `>= 32`
 *               il risultato è 0 (M68k asl.l mod 64).
 * @returns      void. Side effect: `*0x401F5E |= D1` (long BE).
 */
export function fun523A(state: GameState, d0: number): void {
  const d0u = d0 >>> 0;
  // cmpi.l #2,D0 + bcs.b → branch se D0 < 2 (unsigned).
  const shift = d0u < 2 ? d0u : (d0u - 2) >>> 0;
  // M68k asl.l con shift >= 32 produce 0 (i bit "escono" dal registro).
  // JS `<<` masca a 5 bit, quindi guard esplicito.
  const d1 = shift >= 32 ? 0 : ((1 << shift) >>> 0);

  // or.l D1,(0x00401F5E).l — long big-endian.
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
 * Replica `FUN_0000525C` — buffer clear + status flags OR.
 *
 * Vedi disasm e semantica nell'header file.
 *
 * @param state  GameState (workRam mutato in 2 zone: buffer @ A2+0x50 e
 *               long @ 0x1F5E).
 * @param d0     count (long). Tipicamente 1..N. Per `D0 == 0` la replica
 *               eseguirebbe il loop fase 2 65536 volte (vedi note); il
 *               binario originale ha lo stesso comportamento ma il caller
 *               garantisce `D0 >= 1`. Per safety questa funzione **clamp**
 *               implicitamente sui count > MAX_SAFE_COUNT NON applica un
 *               clamp: replica esattamente il binario. Il chiamante deve
 *               passare valori sani.
 * @param a2     pointer assoluto (long M68k) usato come base per la regione
 *               clearata. Deve puntare in workRam (0x400000..0x401FFF).
 *
 * @returns void. Side effects (workRam mutato):
 *   1. byte clear @ `[a2+0x50 .. a2+0x50+d0*20-1]` (assumendo `a2-0x400000`
 *      offset valido in workRam).
 *   2. long-BE OR @ `0x401F5E` con bitmask `bit 4..3+d0*2`.
 *
 * Modellazione bit-perfect:
 *   - `mulu.w D1w,D0` usa low word: `(d0 & 0xFFFF) * 20` (no overflow word
 *     perché 20 * 0xFFFF = 0x13FFEC fits in long).
 *   - `(0x50, A2, D0w*1)`: indexing displacement con D0w sign-extended.
 *     Per la sequenza standard di valori (D0w decrementa da `d0*20-1` a 0)
 *     tutti positivi se `d0*20 <= 0x8000`. Per d0 piccoli (≤ 1638) sicuro.
 *   - `dbf D0w,loop1`: continua finché D0w decrementa senza wrap a -1.
 *   - `add.l D2,D2; subq.l #1,D2` su `d0`: D2 = `d0*2 - 1`.
 *   - `dbf D2w,loop2`: come sopra; loop body esegue `d0*2` volte (per
 *     `d0*2 <= 0x10000`).
 *   - Fase 2 chiama FUN_523A con `D0 = 6, 7, 8, ..., 6+d0*2-1`.
 */
export function stateSub525C(
  state: GameState,
  d0: number,
  a2: number,
): void {
  const d0u = d0 >>> 0;
  const a2u = a2 >>> 0;
  const r = state.workRam;

  // ── Fase 1: clear buffer ───────────────────────────────────────────────
  // mulu.w D1w,D0  →  (d0 & 0xFFFF) * 20
  const productLong = ((d0u & 0xffff) * STRIDE_PER_COUNT) >>> 0;
  // subq.l #1,D0  →  productLong - 1 (può fare wrap a 0xFFFFFFFF se prod=0)
  const initialD0 = (productLong - 1) >>> 0;

  // dbf D0w cicla finché D0w (low word) decrementa senza fare wrap a -1.
  // Iterazione i=0,1,...: D0w corrente = (initialD0 - i) & 0xFFFF.
  // L'esecuzione del body usa D0w SIGN-EXTENDED a long come index.
  // Numero iterazioni dbf: `(initialD0 & 0xFFFF) + 1` se la low word
  // partiva > 0; per low word == 0 ne fa 1 (body+dbf esce). Per low word ==
  // 0xFFFF (-1) cicla l'intero range 16-bit.
  //
  // Equivalenza più semplice: il loop esegue il body
  //   N1 = ((initialD0 & 0xFFFF) + 1) iterazioni se initialD0 >= 0,
  // ma per initialD0 = 0xFFFFFFFF la low word è 0xFFFF e il loop NON esce
  // mai dopo 1 iterazione: il body viene eseguito una volta, poi dbf
  // decrementa a 0xFFFE → branch. Modelliamo iterazioni esplicite finché
  // il decremento porta a 0xFFFF (-1) sulla low word PRE-controllo.

  // Implementazione fedele: simula il loop come fa M68k.
  {
    // M68k: prima il body, poi dbf decrementa e testa.
    let d0w = initialD0 & 0xffff; // low word corrente
    let safety = 0x20000; // safety > 65536 per non andare in infinito su input rotti
    // Il loop body usa D0w PRE-decremento come index (sign-extended).
    // dbf semantics: do { body; D0w := D0w - 1 } while (D0w != -1);
    while (safety-- > 0) {
      // Index: sign-extend D0w (16-bit) a 32-bit signed.
      const idxSigned = d0w >= 0x8000 ? d0w - 0x10000 : d0w;
      // Indirizzo M68k assoluto: a2 + 0x50 + idxSigned (signed add, mod 2^32)
      const writeAddr = (a2u + BUFFER_OFFSET_FROM_A2 + idxSigned) >>> 0;
      // Scrittura solo se rientra in workRam; altrimenti silently skip.
      if (writeAddr >= WORK_RAM_BASE && writeAddr < WORK_RAM_BASE + 0x2000) {
        r[writeAddr - WORK_RAM_BASE] = 0;
      }
      // dbf: D0w -= 1; se D0w == -1 (i.e. era 0 prima) → fall through.
      if (d0w === 0) {
        // dopo decremento sarà 0xFFFF == -1 → exit
        break;
      }
      d0w = (d0w - 1) & 0xffff;
    }
    // safety == -1 significa che abbiamo loopato 0x20000 volte senza uscire:
    // input pathologico. Lasciamo proseguire (il binario farebbe lo stesso).
  }

  // ── Fase 2: bit OR loop ────────────────────────────────────────────────
  // add.l D2,D2 + subq.l #1,D2   →  d2 = d0*2 - 1 (long, mod 2^32)
  const d2Initial = ((d0u * 2) - 1) >>> 0;
  // dbf D2w esegue body finché low word di D2 decrementa senza wrap a -1.
  let d2w = d2Initial & 0xffff;
  let bitArg = 6; // moveq #6,D0
  let safety2 = 0x20000;
  while (safety2-- > 0) {
    // body: bsr 0x523A con D0 = bitArg
    fun523A(state, bitArg);
    bitArg = (bitArg + 1) >>> 0;
    if (d2w === 0) break;
    d2w = (d2w - 1) & 0xffff;
  }
  // safety2 == -1: pathologico, come sopra.
}
