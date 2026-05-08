/**
 * find-nearest-target-2637a.ts — replica `FUN_0002637A` (274 byte,
 * 0x2637A..0x2648C).
 *
 * "Find nearest reachable target" — scanner che itera su una tabella ROM
 * di candidati `{x, y, filter, _pad}` (4 byte ciascuno, terminata da
 * sentinel `0xFF` come primo byte) e seleziona quello più vicino
 * all'oggetto in `A2`, **filtrato** da un byte di categoria e validato
 * da una raycast/visibility check `FUN_17CB8`.
 *
 * **Caller** (xref unico): `FUN_000262B2 @ 0x000262D4 jsr 0x2637A` —
 * passa `A2` come long sullo stack.
 *
 * **Disasm 0x2637A..0x2648C** (274 byte, 1 arg long sullo stack = `objPtr`):
 *
 *   0x2637A:  link.w   A6,-0x2                          ; alloc 2-byte local
 *   0x2637E:  movem.l  {A4 A3 A2 D7 D6 D5 D4 D3 D2},-(SP)
 *   0x26382:  movea.l  (0x8,A6),A2                      ; A2 = arg (objPtr)
 *
 *   0x26386:  move.w   (0x00400394).l,D0w               ; D0.w = global @ 0x400394
 *   0x2638C:  ext.l    D0                                ; sign-ext word→long
 *   0x2638E:  asl.l    #0x2,D0                          ; D0 *= 4
 *   0x26390:  movea.l  #0x1ef1a,A0                      ; A0 = ROM pointer-table base
 *   0x26396:  movea.l  (0x0,A0,D0*0x1),A3               ; A3 = *(0x1EF1A + D0*1)
 *                                                       ;   long-aligned dispatch
 *
 *   0x2639A:  move.b   (0x1d,A2),(-0x1,A6)              ; local[-1] = A2[+0x1D].b
 *   0x263A0:  move.w   (-0x2,A6),D7w                    ; D7.w = local[-2..-1]
 *                                                       ; (high byte = uninit, low = byte)
 *   0x263A4:  ext.w    D7w                              ; sign-ext byte→word (.b LSB del long)
 *   0x263A6:  move.w   D7w,(-0x2,A6)                    ; local[-2..-1] = sign-extended word
 *
 *   0x263AA:  movea.w  #0x300,A4                        ; A4 = best-distance (init = 0x300)
 *
 * ── LOOP @ 0x263AE ──
 *   0x263AE:  cmpi.b   #-0x1,(A3)                       ; if A3[0].b == 0xFF: end
 *   0x263B2:  beq.w    0x00026484                       ; → epilog
 *
 *   0x263B6:  moveq    0x0,D0
 *   0x263B8:  move.b   (0x2,A3),D0b                     ; D0.b = A3[+2].b (filter)
 *   0x263BC:  cmp.w    (-0x2,A6),D0w                    ; cmp filter == byte from A2[+0x1D] (sign-ext)
 *   0x263C0:  bne.w    0x0002647E                       ; if !=, skip → next iter
 *
 * ── Filter MATCHES → compute weighted distance ──
 *   0x263C4:  moveq    0x0,D4
 *   0x263C6:  move.b   (A3),D4b                         ; D4.b = A3[+0].b (target X grid)
 *   0x263C8:  moveq    0x0,D5
 *   0x263CA:  move.b   (0x1,A3),D5b                     ; D5.b = A3[+1].b (target Y grid)
 *
 *   0x263CE:  move.w   (0x32,A2),D6w                    ; D6.w = A2[+0x32].w (objX, pixel)
 *   0x263D2:  sub.w    D4w,D6w                          ; D6 = objX - targetX (word)
 *   0x263D4:  tst.w    D6w
 *   0x263D6:  bge.b    0x000263E0                       ; if >= 0, skip neg
 *   0x263D8:  moveq    0x0,D0
 *   0x263DA:  move.w   D6w,D0w                          ; D0 = D6 (word, zero-extended hi)
 *   0x263DC:  neg.l    D0                               ; D0 = -D0 (long)
 *   0x263DE:  bra.b    0x000263E4
 *   0x263E0:  moveq    0x0,D0
 *   0x263E2:  move.w   D6w,D0w                          ; D0 = D6 (positive, zero-ext)
 *   0x263E4:  move.w   D0w,D1w                          ; D1.w = abs(diffX) low word
 *   0x263E6:  lsl.w    #0x4,D1w                         ; D1.w <<= 4 (16-bit shift)
 *
 *   0x263E8:  move.w   (0x34,A2),D3w                    ; D3.w = A2[+0x34].w (objY, pixel)
 *   0x263EC:  sub.w    D5w,D3w                          ; D3 = objY - targetY (word)
 *   0x263EE:  tst.w    D3w
 *   0x263F0:  bge.b    0x000263FA
 *   0x263F2:  moveq    0x0,D0
 *   0x263F4:  move.w   D3w,D0w
 *   0x263F6:  neg.l    D0                               ; D0 = abs(diffY)
 *   0x263F8:  bra.b    0x000263FE
 *   0x263FA:  moveq    0x0,D0
 *   0x263FC:  move.w   D3w,D0w
 *   0x263FE:  move.w   D0w,D3w                          ; D3.w = abs(diffY) low word
 *   0x26400:  lsl.w    #0x4,D3w                         ; D3.w <<= 4
 *
 *   0x26402:  cmp.w    D3w,D1w                          ; cmp |dX|<<4 vs |dY|<<4
 *   0x26404:  bls.b    0x00026418                       ; if D1 <= D3 (unsigned): branch B
 *
 * ── Branch A (|dX|<<4 > |dY|<<4) ──
 *   0x26406:  moveq    0x0,D2
 *   0x26408:  move.w   D3w,D2w                          ; D2 = |dY|<<4 (word, zero-ext hi)
 *   0x2640A:  lsr.l    #0x3,D2                          ; D2 >>= 3 (long)
 *   0x2640C:  mulu.w   #0x3,D2                          ; D2 *= 3 (16x16→32 unsigned mul)
 *   0x26410:  moveq    0x0,D0
 *   0x26412:  move.w   D1w,D0w                          ; D0 = |dX|<<4
 *   0x26414:  add.l    D0,D2                            ; D2 += D0 (long add)
 *   0x26416:  bra.b    0x00026428
 *
 * ── Branch B (|dX|<<4 <= |dY|<<4) ──
 *   0x26418:  moveq    0x0,D2
 *   0x2641A:  move.w   D1w,D2w                          ; D2 = |dX|<<4
 *   0x2641C:  lsr.l    #0x3,D2                          ; D2 >>= 3
 *   0x2641E:  mulu.w   #0x3,D2                          ; D2 *= 3
 *   0x26422:  moveq    0x0,D0
 *   0x26424:  move.w   D3w,D0w                          ; D0 = |dY|<<4
 *   0x26426:  add.l    D0,D2                            ; D2 += D0
 *
 * ── Convert (D4, D5) grid → (D6, D3) pixel-center ──
 *   0x26428:  move.w   D4w,D0w
 *   0x2642A:  ext.l    D0                               ; D0 = sign-ext D4.w (D4 < 256, no sign)
 *   0x2642C:  asl.l    #0x3,D0                          ; D0 = D4 << 3
 *   0x2642E:  move.w   D0w,D6w                          ; D6.w = D4 << 3 (low word)
 *   0x26430:  addq.w   0x4,D6w                          ; D6.w += 4 → pixel X center
 *
 *   0x26432:  move.w   D5w,D0w
 *   0x26434:  ext.l    D0
 *   0x26436:  asl.l    #0x3,D0
 *   0x26438:  move.w   D0w,D3w
 *   0x2643A:  addq.w   0x4,D3w                          ; D3.w = pixel Y center
 *
 * ── Visibility check FUN_17CB8(A2, D6, D3, 0x180) ──
 *   0x2643C:  pea      (0x180).w                        ; arg4 (long) = 0x180
 *   0x26440:  move.w   D3w,D0w
 *   0x26442:  ext.l    D0                               ; arg3 = sign-ext D3 (here ≥ 0)
 *   0x26444:  move.l   D0,-(SP)
 *   0x26446:  move.w   D6w,D0w
 *   0x26448:  ext.l    D0                               ; arg2 = sign-ext D6
 *   0x2644A:  move.l   D0,-(SP)
 *   0x2644C:  move.l   A2,-(SP)                         ; arg1 = objPtr
 *   0x2644E:  jsr      0x00017CB8.l
 *   0x26454:  tst.l    D0
 *   0x26456:  lea      (0x10,SP),SP                     ; cleanup 4 longs
 *   0x2645A:  bne.b    0x0002647E                       ; if D0 != 0 (blocked): skip
 *
 *   0x2645C:  cmp.l    A4,D2                            ; cmp distance vs best
 *   0x2645E:  bcc.b    0x0002647E                       ; if D2 >= A4 (unsigned): skip
 *
 * ── New best: update A4 + write globals ──
 *   0x26460:  movea.l  D2,A4                            ; A4 = D2 (new best)
 *   0x26462:  move.w   D6w,D0w
 *   0x26464:  ext.l    D0
 *   0x26466:  move.l   D0,(0x00400462).l                ; *0x400462.l = pixelX (sign-ext)
 *   0x2646C:  move.w   D3w,D0w
 *   0x2646E:  ext.l    D0
 *   0x26470:  move.l   D0,(0x00400466).l                ; *0x400466.l = pixelY
 *   0x26476:  move.b   (0x2,A3),(0x00400472).l          ; *0x400472.b = filter byte
 *
 * ── ITER NEXT ──
 *   0x2647E:  addq.l   0x4,A3                           ; A3 += 4 (next record)
 *   0x26480:  bra.w    0x000263AE                       ; → loop top
 *
 * ── EPILOG ──
 *   0x26484:  movem.l  (SP)+,{D2 D3 D4 D5 D6 D7 A2 A3 A4}
 *   0x26488:  unlk     A6
 *   0x2648A:  rts
 *
 * **Algoritmo (semantica)**: scanner di nearest-neighbor con filter +
 * line-of-sight check. Output:
 *   - `*0x400462.l` ← pixel-X del miglior target trovato (centro cella)
 *   - `*0x400466.l` ← pixel-Y del miglior target trovato
 *   - `*0x400472.b` ← byte di filter (≡ A2[+0x1D] sign-ext) del best
 *   - se nessun candidato passa, i globals NON vengono toccati
 *     (rimangono al valore precedente — caller `FUN_262B2` li azzera
 *     prima della jsr e usa la sentinel `*0x400472.b == 0xFF` per
 *     distinguere il caso "nessun target trovato").
 *
 * **Modellazione bit-perfect** delle sottigliezze M68k:
 *
 *   1. **Tabella di dispatch ROM @ 0x1EF1A**: 32-bit pointer indexed
 *      by `(*0x400394.w << 2)` — la sub-table dei candidati varia in
 *      base allo stato globale 0x400394. Il TS riceve `tableAddr`
 *      direttamente (scelto dal caller) per consentire injection in
 *      test. Il modulo NON legge ROM (no rom dependency).
 *
 *   2. **`ext.w D7w`** dopo `move.w (-2,A6),D7w`:
 *      la `move.w` carica i 2 byte da A6-2; la high byte è non
 *      inizializzata (link.w ha allocato senza azzerare). MA poi:
 *        - `ext.w D7w` sign-extends LOW BYTE → high byte di D7.w
 *          (cioè byte at A6-1 sign-extends su byte at A6-2, ignorando
 *          il valore che era a A6-2).
 *        - `move.w D7w,(-2,A6)` riscrive il word con high=sign-ext.
 *      Il `cmp.w (-2,A6),D0w` successivo confronta col valore corretto.
 *      Replicato come `signExt8(byteFromObj1D)` direttamente.
 *
 *   3. **`asl.l #4` / `lsl.w #4`**: il binario usa `lsl.w` (16-bit shift)
 *      sul .w di D1/D3. Per |diff| fino a 0x0FFF il risultato sta in 16 bit,
 *      ma per |diff| ≥ 0x1000 il bit alto viene perso: replicato con `& 0xFFFF`.
 *      Es. |diff|=0x1234 → lsl.w #4 → 0x2340 (NON 0x12340).
 *
 *   4. **`lsr.l #3` poi `mulu.w #3`**:
 *        - `lsr.l #3` opera su long → result in low long bits.
 *        - `mulu.w #3,D2` è 16x16→32: prende i low 16 bit di D2 e li
 *          moltiplica per 3, sovrascrivendo l'intero D2. Per D2 max ≈
 *          0xFFF0 → 0x2FFD0, fitsa in 32 bit.
 *      Replicato come `((D2 >>> 3) & 0xFFFF) * 3` (low word di D2 dopo
 *      shift, poi mul).
 *
 *   5. **`add.l D0,D2`**: D0 = |diff|<<4 zero-ext (max 0xFFF0), D2 max
 *      ≈ 0x2FFD0. Somma sta in 32 bit unsigned.
 *
 *   6. **`asl.l #3` su D4/D5 (byte coords)**: D4/D5 ∈ [0,0xFE] (0xFF è
 *      sentinel terminator — non dovrebbero mai essere 0xFF qui per via
 *      del controllo a 0x263AE). `D << 3` ∈ [0, 0x7F0]. `+4` → [4, 0x7F4].
 *      Replicato come `(coord << 3) + 4`.
 *
 *   7. **`cmp.w D3w,D1w; bls`**: confronto unsigned su .w. Replicato
 *      con `(d1Shifted & 0xFFFF) <= (d3Shifted & 0xFFFF)`.
 *
 *   8. **`cmp.l A4,D2; bcc`**: confronto unsigned su long. A4 inizia
 *      a 0x300 (zero-extended a 0x00000300 long). Replicato con
 *      `(d2 >>> 0) >= (a4 >>> 0)`.
 *
 *   9. **Output al best update**:
 *        - `*0x400462.l = sign-ext-long(D6.w)`. D6 = pixelX = (gridX<<3)+4
 *          ∈ [4, 0x7F4] → sign bit non set → ext.l = zero-ext.
 *        - `*0x400466.l = sign-ext-long(D3.w)`. Stesso ragionamento.
 *        - `*0x400472.b = A3[+2].b`.
 *
 *  10. **Sentinel terminator**: il loop termina quando `A3[0].b == 0xFF`
 *      (cmpi.b #-1). Il primo byte (X grid) è sentinel per fine record set.
 *
 *  11. **JSR esterna `FUN_17CB8`**: line-of-sight / raycast / collision check.
 *      Ritorna long in D0; 0 = passabile, !=0 = bloccato. Esposto come
 *      callback `lineOfSight17CB8(state, objPtr, pixelX, pixelY, range0x180)
 *      → number`. Default ritorna 0 (sempre passabile, comportamento
 *      "no obstacles"). Il parity test patcha FUN_17CB8 a un'implementazione
 *      deterministica in ROM (es. ritorna sempre 0 → tutti i candidati
 *      filtrati passano e si seleziona il più vicino).
 *
 * **Caller**: `FUN_000262B2 @ 0x000262D4` (1 xref). Il caller pusha
 * `A2`, chiama, poi `addq.l #4,SP`. Pattern cdecl standard.
 *
 * Verifica bit-perfect via
 * `cli/src/test-find-nearest-target-2637a-parity.ts`.
 */

import type { GameState } from "./state.js";
import { stringHelper17CB8 } from "./string-helper-17cb8.js";

/** Base assoluta della work RAM (0x400000 nel bus M68k). */
const WORK_RAM_BASE = 0x400000;
/** Limite superiore esclusivo workRam (0x400000 + 0x2000). */
const WORK_RAM_END = 0x402000;

/** Indirizzo entry-point del binario (per parity tests / cross-ref). */
export const FIND_NEAREST_TARGET_2637A_ADDR = 0x0002637a as const;

/** Globals scritti da FUN_2637A (assoluti M68k). */
export const FIND_NEAREST_TARGET_2637A_GLOBALS = {
  /** Long ← pixelX del best (sign-ext da D6.w, ma sempre ≥ 0). */
  bestPixelX_400462: 0x00400462,
  /** Long ← pixelY del best. */
  bestPixelY_400466: 0x00400466,
  /** Byte ← filter byte (≡ A2[+0x1D] sign-ext) del best. */
  bestFilter_400472: 0x00400472,
  /** Word ← stato globale di selezione tabella (letto, NON scritto). */
  stateSelector_400394: 0x00400394,
} as const;

/** Offset campi A2 letti. */
export const FIND_NEAREST_TARGET_2637A_FIELDS = {
  /** Byte: filter category source (sign-ext per cmp). */
  filterFrom1D: 0x1d,
  /** Word: pixel X dell'oggetto (per distance). */
  objPixelX_32: 0x32,
  /** Word: pixel Y dell'oggetto. */
  objPixelY_34: 0x34,
} as const;

/** Costanti del binario. */
export const FIND_NEAREST_TARGET_2637A_CONSTS = {
  /** Sentinel terminator del record set (byte at A3[0]). */
  recordTerminator: 0xff,
  /** Stride dei record candidati (byte): 4 byte = X|Y|filter|pad. */
  recordStride: 4,
  /** Best-distance iniziale (A4 = 0x300, zero-ext long). */
  initialBestDistance: 0x00000300,
  /** Range/mask passato a FUN_17CB8 (4° arg, long). */
  losRange0x180: 0x180,
  /** Indirizzo della tabella di dispatch ROM. */
  dispatchTableRom_1EF1A: 0x0001ef1a,
  /** Indirizzo di FUN_17CB8 (line-of-sight). */
  fun_17CB8_addr: 0x00017cb8,
} as const;

/**
 * Bag della singola sub-jsr esterna. Default: ritorna 0 (no obstacles).
 */
export interface FindNearestTarget2637ASubs {
  /**
   * `FUN_17CB8(objPtr, pixelX, pixelY, range)` — line-of-sight /
   * raycast / collision check. Ritorna long in D0:
   *   - 0 = path libero (target raggiungibile)
   *   - !=0 = bloccato (target scartato)
   *
   * Tutti gli arg sono long sign-extended (ma in pratica positivi).
   * Il parity test patcha FUN_17CB8 a `moveq #0,D0; rts` in ROM per
   * isolare il selector di FUN_2637A.
   */
  lineOfSight17CB8?: (
    state: GameState,
    objPtr: number,
    pixelX: number,
    pixelY: number,
    range: number,
  ) => number;
}

// ─── Helper interni: read/write byte/word/long su workRam (BE M68k) ──

function readU8(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

function writeU8(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return;
  workRam[a - WORK_RAM_BASE] = value & 0xff;
}

function readU16BE(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return 0;
  const off = a - WORK_RAM_BASE;
  return (((workRam[off] ?? 0) << 8) | (workRam[off + 1] ?? 0)) & 0xffff;
}

function writeU32BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value >>> 0;
  workRam[off] = (v >>> 24) & 0xff;
  workRam[off + 1] = (v >>> 16) & 0xff;
  workRam[off + 2] = (v >>> 8) & 0xff;
  workRam[off + 3] = v & 0xff;
}

/** Sign-extend un byte (.b → .w / .l). */
function signExt8(byte: number): number {
  const b = byte & 0xff;
  return b >= 0x80 ? b - 0x100 : b;
}

/** Read di un record candidato: bytes [x, y, filter, _pad]. */
function readCandidateRecord(
  reader: (addr: number) => number,
  recordAddr: number,
): { x: number; y: number; filter: number } {
  return {
    x: reader(recordAddr + 0) & 0xff,
    y: reader(recordAddr + 1) & 0xff,
    filter: reader(recordAddr + 2) & 0xff,
  };
}

/**
 * Replica `FUN_0002637A` — find nearest reachable target.
 *
 * Vedi disasm e semantica nell'header del file. La singola sub-jsr
 * esterna (`FUN_17CB8`) è esposta via `subs` (default: ritorna 0
 * = sempre passabile); le 3 scritture dirette sui globals
 * 0x400462/0x400466/0x400472 sono replicate bit-perfect.
 *
 * **Modello tabella candidati**: il binario fa un dispatch ROM
 * (`A0=0x1EF1A; A3 = *(A0 + (*0x400394.w * 4))`) per scegliere il
 * puntatore alla tabella corrente. Qui la tabella è passata come
 * parametro `tableReader`/`tableAddr` per consentire test isolati e
 * iniezione di candidate set deterministici.
 *
 * @param state         GameState corrente (`workRam` mutato in-place
 *                      sui 3 globals 0x400462/0x400466/0x400472).
 * @param objPtr        Puntatore assoluto M68k all'oggetto (es.
 *                      `0x004012XX`). Letti: A2[+0x1D].b (filter src),
 *                      A2[+0x32].w (objX), A2[+0x34].w (objY).
 * @param tableAddr     Indirizzo assoluto del primo record candidato
 *                      (replica del valore caricato in A3 dopo dispatch).
 *                      I record sono 4 byte ciascuno, terminati dal
 *                      byte sentinel 0xFF al primo offset (X grid).
 * @param tableReader   Reader bytewise per la tabella ROM (lettura
 *                      su [tableAddr, tableAddr + n*4]). Necessario
 *                      perché la tabella vive in ROM, non in workRam.
 *                      Tipicamente `(addr) => romBuf[addr] & 0xff`.
 * @param subs          Bag della 1 sub-jsr esterna. Default: ritorna 0.
 */
export function findNearestTarget2637A(
  state: GameState,
  objPtr: number,
  tableAddr: number,
  tableReader: (addr: number) => number,
  subs: FindNearestTarget2637ASubs = {},
): void {
  const wr = state.workRam;
  const objAbs = objPtr >>> 0;

  // 0x2639A..0x263A6: prepara filter byte da A2[+0x1D] sign-extended a word.
  const filterByte = readU8(
    wr,
    objAbs + FIND_NEAREST_TARGET_2637A_FIELDS.filterFrom1D,
  );
  const filterWordSE = signExt8(filterByte) & 0xffff; // word di confronto

  // 0x263AA: A4 = 0x300 (best distance, zero-ext long).
  let bestDist = FIND_NEAREST_TARGET_2637A_CONSTS.initialBestDistance >>> 0;

  // 0x263CE / 0x263E8: leggi objX, objY (word).
  const objX = readU16BE(
    wr,
    objAbs + FIND_NEAREST_TARGET_2637A_FIELDS.objPixelX_32,
  );
  const objY = readU16BE(
    wr,
    objAbs + FIND_NEAREST_TARGET_2637A_FIELDS.objPixelY_34,
  );

  // ── LOOP 0x263AE ──────────────────────────────────────────────────
  let recAddr = tableAddr >>> 0;
  // Safety bound: in caso di tabella malformata, evitiamo loop infinito.
  // Il binario non ha questo guard (legge ROM finché non trova 0xFF).
  // 256 record è sufficiente per qualsiasi tabella reale (tipicamente <32).
  const MAX_RECORDS = 256;
  for (let it = 0; it < MAX_RECORDS; it++) {
    // 0x263AE: cmpi.b #-1, (A3) → if A3[0].b == 0xFF: end
    const x0 = tableReader(recAddr) & 0xff;
    if (x0 === FIND_NEAREST_TARGET_2637A_CONSTS.recordTerminator) break;

    // 0x263B6..0x263BC: cmp filter byte (A3[+2]) vs filter word (A2+0x1D sign-ext)
    // D0 = zero-ext byte (moveq #0,D0; move.b → low byte; high byte di low word = 0).
    // cmp.w D0w vs filterWordSE: zero-ext byte vs sign-ext byte word.
    const recFilter = tableReader(recAddr + 2) & 0xff;
    const recFilterAsWord = recFilter; // zero-ext byte in word
    if (recFilterAsWord !== filterWordSE) {
      // 0x263C0: bne.w 0x2647E → next iter
      recAddr = (recAddr + FIND_NEAREST_TARGET_2637A_CONSTS.recordStride) >>> 0;
      continue;
    }

    // ── Filter MATCHES ──
    const rec = readCandidateRecord(tableReader, recAddr);

    // 0x263CE..0x263E6: |objX - targetX| << 4 (lsl.w → mask 16 bit)
    const diffX = (objX - rec.x) & 0xffff; // sub.w
    const absDiffX = (diffX & 0x8000) !== 0 ? (-(diffX | ~0xffff)) >>> 0 : diffX;
    const d1Shifted = (absDiffX << 4) & 0xffff; // lsl.w #4

    // 0x263E8..0x26400: |objY - targetY| << 4
    const diffY = (objY - rec.y) & 0xffff;
    const absDiffY = (diffY & 0x8000) !== 0 ? (-(diffY | ~0xffff)) >>> 0 : diffY;
    const d3Shifted = (absDiffY << 4) & 0xffff;

    // 0x26402..0x26426: weighted distance.
    //   if (d1Shifted > d3Shifted) {  // branch A
    //     d2 = ((d3Shifted >>> 3) * 3) + d1Shifted   (long math)
    //   } else {                       // branch B (d1 <= d3, unsigned word)
    //     d2 = ((d1Shifted >>> 3) * 3) + d3Shifted
    //   }
    let d2: number;
    if (d1Shifted > d3Shifted) {
      // Branch A: |dX| > |dY|
      // D2 = D3 (word), zero-ext to long (moveq #0,D2; move.w D3,D2w)
      let acc = d3Shifted >>> 0;
      acc = acc >>> 3; // lsr.l #3
      // mulu.w #3,D2: 16x16→32 unsigned. Low word di acc * 3.
      acc = (acc & 0xffff) * 3;
      // add.l D0,D2 dove D0 = zero-ext word(D1)
      acc = (acc + (d1Shifted >>> 0)) >>> 0;
      d2 = acc;
    } else {
      // Branch B: |dX| <= |dY|
      let acc = d1Shifted >>> 0;
      acc = acc >>> 3;
      acc = (acc & 0xffff) * 3;
      acc = (acc + (d3Shifted >>> 0)) >>> 0;
      d2 = acc;
    }

    // 0x26428..0x2643A: pixel-center conversion.
    //   D6.w = (D4 << 3) + 4
    //   D3.w = (D5 << 3) + 4
    // D4/D5 ∈ [0, 0xFE] → (val<<3) ∈ [0, 0x7F0] → +4 ∈ [4, 0x7F4]. No overflow.
    const pixelX = (((rec.x << 3) & 0xffff) + 4) & 0xffff;
    const pixelY = (((rec.y << 3) & 0xffff) + 4) & 0xffff;

    // 0x2643C..0x2645A: FUN_17CB8(objPtr, pixelX, pixelY, 0x180).
    // Tutti gli arg sono sign-extended a long. pixelX/pixelY sono in
    // [4, 0x7F4] → sign bit non set → sign-ext = zero-ext.
    const losResult =
      ((subs.lineOfSight17CB8 ?? stringHelper17CB8)(
        state,
        objAbs,
        pixelX & 0xffff,
        pixelY & 0xffff,
        FIND_NEAREST_TARGET_2637A_CONSTS.losRange0x180,
      )) | 0;
    if (losResult !== 0) {
      // 0x2645A: bne.b 0x2647E → blocked, skip
      recAddr = (recAddr + FIND_NEAREST_TARGET_2637A_CONSTS.recordStride) >>> 0;
      continue;
    }

    // 0x2645C..0x2645E: cmp.l A4,D2; bcc.b → if D2 >= A4 (unsigned): skip
    if ((d2 >>> 0) >= (bestDist >>> 0)) {
      recAddr = (recAddr + FIND_NEAREST_TARGET_2637A_CONSTS.recordStride) >>> 0;
      continue;
    }

    // ── New best ──
    // 0x26460: A4 = D2
    bestDist = d2 >>> 0;
    // 0x26462..0x26466: *0x400462 = sign-ext-long(D6.w). pixelX ≥ 0 → zero-ext.
    writeU32BE(
      wr,
      FIND_NEAREST_TARGET_2637A_GLOBALS.bestPixelX_400462,
      pixelX & 0xffff,
    );
    // 0x2646C..0x26470: *0x400466 = sign-ext-long(D3.w).
    writeU32BE(
      wr,
      FIND_NEAREST_TARGET_2637A_GLOBALS.bestPixelY_400466,
      pixelY & 0xffff,
    );
    // 0x26476: *0x400472.b = A3[+2].b (filter byte)
    writeU8(
      wr,
      FIND_NEAREST_TARGET_2637A_GLOBALS.bestFilter_400472,
      rec.filter,
    );

    // 0x2647E..0x26480: addq.l #4,A3; bra loop top.
    recAddr = (recAddr + FIND_NEAREST_TARGET_2637A_CONSTS.recordStride) >>> 0;
  }

  // 0x26484..0x2648A: epilog → no return value.
}
