/**
 * sort-adjacent-objects-1a7a8.ts — replica `FUN_0001A7A8` (98 byte).
 *
 * **Single-pass adjacent-pair "ordering" sweep** sopra un array di byte-index
 * in workRam (`0x4003BC..0x4003DC`, 32 byte). Per ogni indice i del walk
 * prende la coppia `(a[i], a[i+stride])`, dereferenzia via la lookup-table
 * ROM @ `0x1F0E2` (16 entry × 4 byte = pointer in workRam alle 16
 * "rectangle struct" che iniziano @ `0x4001DC`, stride 14 byte/struct), e
 * chiama `FUN_0001A80A` (rect-overlap / z-order test). Se il risultato è
 * non-zero ⇒ swap dei due **byte-index** in workRam (NON dei rectangle).
 *
 * Il walk si arresta NON-appena uno dei due byte vale `0xFF` (terminatore
 * "fine entity-list") oppure quando uno dei due puntatori raggiunge il
 * sentinel-end `A5 = 0x4003DC`. Quindi il numero massimo di iterazioni è
 * `0x20 - stride` (per stride=1: 31, stride=2: 30, stride=3: 29).
 *
 * **Caller noto** (`FUN_00026F3E` @ 0x26FA8/26FB2/26FBC, 3 chiamate
 * back-to-back con stride 1/2/3) — questo è il classico **shell-sort**
 * (Shellsort) con gap = {1, 2, 3} pre-computati. Curiosamente la sequenza è
 * applicata in ordine 1→2→3 anziché il canonico 3→2→1, quindi NON è uno
 * shell-sort "puro": è più simile a un'iterazione manuale di compare-swap
 * passes con stride crescente. Effetto netto: dopo le 3 chiamate l'array è
 * "parzialmente sorted" rispetto al criterio di `FUN_1A80A`.
 *
 * **Disasm 0x1A7A8..0x1A809** (98 byte / 0x62):
 *
 *   0x1A7A8:  movem.l {A5 A4 A3 A2},-(SP)        ; preserve A2..A5 (16 byte)
 *   0x1A7AC:  moveq   #0,D0
 *   0x1A7AE:  move.b  (0x17,SP),D0b              ; D0.b = arg byte (LSB del long
 *                                                ;   pushato dal caller a SP+0x14;
 *                                                ;   +3 = LSB BE ⇒ SP+0x17)
 *   0x1A7B2:  movea.l #0x4003BC,A2               ; A2 = base array byte-index
 *   0x1A7B8:  movea.l A2,A3                      ; A3 = A2
 *   0x1A7BA:  adda.l  D0,A3                      ; A3 += D0 (stride)
 *   0x1A7BC:  lea     (0x20,A2),A5               ; A5 = A2 + 0x20 (sentinel-end exclusive)
 *   0x1A7C0:  lea     (0x1F0E2).l,A4             ; A4 = ROM lookup table base
 *
 *   loop @ 0x1A7C6:
 *   0x1A7C6:  cmpi.b  #-1,(A2)                   ; if byte[A2] == 0xFF
 *   0x1A7CA:  beq.b   0x1A804                    ;   → exit
 *   0x1A7CC:  cmpi.b  #-1,(A3)                   ; if byte[A3] == 0xFF
 *   0x1A7D0:  beq.b   0x1A804                    ;   → exit
 *   0x1A7D2:  moveq   #0,D0
 *   0x1A7D4:  move.b  (A3),D0b                   ; D0 = byte[A3] (zero-ext)
 *   0x1A7D6:  asl.l   #2,D0                      ; D0 = idx * 4
 *   0x1A7D8:  move.l  (0,A4,D0*1),-(SP)          ; push lookup[idx_A3] (long)
 *   0x1A7DC:  moveq   #0,D0
 *   0x1A7DE:  move.b  (A2),D0b                   ; D0 = byte[A2] (zero-ext)
 *   0x1A7E0:  asl.l   #2,D0
 *   0x1A7E2:  move.l  (0,A4,D0*1),-(SP)          ; push lookup[idx_A2] (long)
 *   0x1A7E6:  jsr     0x1A80A.l                  ; D0 = compare(lookup_A2, lookup_A3)
 *   0x1A7EC:  tst.l   D0
 *   0x1A7EE:  addq.l  #8,SP                      ; pop 2 long args
 *   0x1A7F0:  beq.b   0x1A7F8                    ; if D0 == 0 → no swap
 *   0x1A7F2:  move.b  (A2),D0b                   ; saved = byte[A2]
 *   0x1A7F4:  move.b  (A3),(A2)                  ; byte[A2] = byte[A3]
 *   0x1A7F6:  move.b  D0b,(A3)                   ; byte[A3] = saved
 *
 *   0x1A7F8:  addq.l  #1,A2                      ; A2++
 *   0x1A7FA:  cmpa.l  A5,A2
 *   0x1A7FC:  beq.b   0x1A804                    ; if A2 == A5 → exit
 *   0x1A7FE:  addq.l  #1,A3
 *   0x1A800:  cmpa.l  A5,A3
 *   0x1A802:  bne.b   0x1A7C6                    ; if A3 != A5 → loop
 *
 *   0x1A804:  movem.l (SP)+,{A2 A3 A4 A5}        ; restore
 *   0x1A808:  rts                                ; (no return value semantically)
 *
 * **FUN_0001A80A** (rect compare, ~200 byte). Riceve due ptr (A1, A0) a
 * struct di 14 byte con la seguente forma:
 *
 *   off +0x0  ?       (non letto — header/flag)
 *   off +0x2  word    "x_lo"   (left edge)
 *   off +0x4  word    "x_mid"  (?)
 *   off +0x6  word    "x_hi"   (right edge — top of D4/D2 sum)
 *   off +0x8  word    "y_lo"   (top edge)
 *   off +0xA  word    "y_mid"  (?)
 *   off +0xC  word    "y_hi"   (bottom edge — top of D3/D5 sum)
 *
 * (A1 = arg1 = lookup_A2, A0 = arg2 = lookup_A3 — caller pusha A3-pointer
 * PRIMA di A2-pointer, RTL ⇒ A1 a SP+0x14 = arg secondo-pushato = A2-ptr,
 * A0 a SP+0x18 = arg primo-pushato = A3-ptr.)
 *
 *   D4 = ext.l(+6,A1) + ext.l(+4,A1) + ext.l(+2,A1)        ; A1 sum-x
 *   D3 = ext.l(+C,A1) + ext.l(+A,A1) + ext.l(+8,A1)        ; A1 sum-y
 *   D2 = ext.l(+6,A0) + ext.l(+4,A0) + ext.l(+2,A0)        ; A0 sum-x
 *   D5 = ext.l(+C,A0) + ext.l(+A,A0) + ext.l(+8,A0)        ; A0 sum-y
 *
 *   if (D3 <= D2)            return 0   ; A1.sumY <= A0.sumX (cmp.l D2,D3 ≤)
 *   if (D5 <= D4)            return 1   ; A0.sumY <= A1.sumX
 *   if ((+4,A0).w >= (+A,A1).w)  return 0
 *   if ((+4,A1).w >= (+A,A0).w)  return 1
 *   if ((+2,A0).w >= (+8,A1).w)  return 0
 *   if ((+2,A1).w >= (+8,A0).w)  return 1
 *   if ((+6,A0).w >= (+C,A1).w)  return 0
 *   else                     return 1
 *
 * Il return value passa per `ext.w D0w; ext.l D0` quindi è 0 o 1 long
 * (sign-extended da byte 0/1). Solo il bit "zero vs non-zero" è osservato
 * da FUN_1A7A8.
 *
 * **Modellazione bit-perfect**:
 *
 *   1. **Arg byte LSB**: il caller fa `pea (0x1).w` (≡ pusha 0x00000001 long)
 *      e `(0x17,SP)` legge il byte +3 di quel long ⇒ `arg & 0xFF`. Per
 *      `pea (0x1).w` il long è 0x00000001 ⇒ byte LSB = 1. Per `pea (0x2).w`
 *      ⇒ byte = 2. Etc. Il modello accetta direttamente lo `stride` byte.
 *
 *   2. **Sentinel `0xFF`**: `cmpi.b #-1,(A2)` confronta come byte signed,
 *      `beq` testa il flag Z di una sub byte: il match è bit-exact con `== 0xFF`.
 *
 *   3. **A2/A3 == A5 exit**: A5 è `A2_initial + 0x20` (esclusivo). Per stride
 *      `s`: A2 raggiunge A5 dopo 0x20 - 0 = 32 step (massimo); A3 dopo
 *      `0x20 - s` step. Quindi il loop è limitato a `min(32, 32-s) = 32-s`
 *      iter (per stride > 0). Per stride=0 entrambi avanzano in lockstep,
 *      ma A2 e A3 puntano alla stessa cella ⇒ la `swap` è no-op (byte=byte)
 *      e le condizioni di exit sono identiche; max 32 iter.
 *
 *   4. **Word reads in FUN_1A80A**: BE 16-bit signed word; sign-ext a long
 *      per le `add.l` e `cmp.l`. Le ultime 4 condizioni sono `cmp.w` →
 *      compare di word (signed-word) NON di long. Importante: `(+4,A0).w`
 *      è il byte coppia [+4,+5] read BE, signed.
 *
 *   5. **Out-of-range byte index**: il binario indicizza ROM[0x1F0E2 + byte*4]
 *      anche per byte > 15 (la table ha 16 entry "valide" 0..15 contigue,
 *      poi byte successivi dipendono dal contenuto ROM). Il modello legge
 *      la ROM come array e lascia che il valore sia "ciò che c'è"; se il
 *      pointer letto cade fuori workRam le `read16` ritornano 0 (semantica
 *      difensiva). Nei caller noti i byte sono sempre 0..15 (slot di entità).
 *
 *   6. **Pure mutation**: la funzione modifica SOLO i byte
 *      `workRam[0x3BC..0x3DC)` (al massimo 32 byte). Gli struct di
 *      rectangle a `0x1DC..0x2BC` sono LETTI e mai scritti. Anche la ROM
 *      è solo letta.
 *
 * **Side effect bit-perfect**:
 *   - workRam[0x3BC..0x3DC] subisce 0..31 swap (a coppie distanti `stride`).
 *   - Nessun'altra scrittura.
 *
 * Verifica bit-perfect via `packages/cli/src/test-sort-adjacent-objects-1a7a8-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Base assoluta workRam M68k. */
const WORK_RAM_BASE = 0x400000;
/** Limite superiore esclusivo workRam. */
const WORK_RAM_END = 0x402000;

/** Offset workRam dell'array byte-index (assoluto = 0x4003BC). */
export const BYTE_ARRAY_OFF = 0x3bc as const;
/** Lunghezza dell'array byte-index (32 byte, fino a 0x4003DC esclusivo). */
export const BYTE_ARRAY_LEN = 0x20 as const;
/** Sentinel byte (0xFF) — interrompe il walk se trovato in A2 o A3. */
export const SENTINEL_BYTE = 0xff as const;

/** Offset ROM della lookup table 16×4 (pointer assoluti M68k). */
export const ROM_LOOKUP_OFF = 0x1f0e2 as const;
/** Numero di entry della lookup table (entry = 4 byte = pointer long). */
export const ROM_LOOKUP_COUNT = 16 as const;

/**
 * Legge un long BE da una `Uint8Array` a un offset, ritornando unsigned 32-bit.
 *
 * Difensivo: se l'offset è out-of-range ritorna 0 (i byte assenti contano 0).
 */
function readU32BE(buf: Uint8Array, off: number): number {
  const o = off | 0;
  const b0 = (buf[o] ?? 0) & 0xff;
  const b1 = (buf[o + 1] ?? 0) & 0xff;
  const b2 = (buf[o + 2] ?? 0) & 0xff;
  const b3 = (buf[o + 3] ?? 0) & 0xff;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

/**
 * Legge una word BE da workRam a un indirizzo M68k assoluto.
 *
 * Ritorna unsigned 16-bit. Out-of-range workRam ⇒ 0 (difensivo).
 */
function readU16WorkRamAbs(state: GameState, abs: number): number {
  const a = abs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return 0;
  const off = a - WORK_RAM_BASE;
  const b0 = (state.workRam[off] ?? 0) & 0xff;
  const b1 = (state.workRam[off + 1] ?? 0) & 0xff;
  return ((b0 << 8) | b1) & 0xffff;
}

/** Sign-extend word (16-bit) → 32-bit signed JS number. */
function s16(w: number): number {
  const x = w & 0xffff;
  return x & 0x8000 ? x - 0x10000 : x;
}

/**
 * Replica `FUN_0001A80A` — rect overlap / z-order compare.
 *
 * Inputs: due puntatori assoluti M68k a struct di 14 byte in workRam (i
 * "rectangle slot" indicizzati dalla ROM lookup-table). Ritorna 0 oppure 1.
 *
 * Vedi disasm sopra per la semantica completa. Esposto per testabilità
 * isolata.
 *
 * @param state  GameState (workRam letto, non scritto).
 * @param ptrA1  Pointer a "rect A1" (M68k assoluto, tipicamente 0x4001DC..).
 * @param ptrA0  Pointer a "rect A0".
 * @returns      `0` o `1` (long, ma osservato come "zero vs non-zero").
 */
export function fun1A80A(
  state: GameState,
  ptrA1: number,
  ptrA0: number,
): number {
  // Word reads
  const a1_2 = readU16WorkRamAbs(state, ptrA1 + 2);
  const a1_4 = readU16WorkRamAbs(state, ptrA1 + 4);
  const a1_6 = readU16WorkRamAbs(state, ptrA1 + 6);
  const a1_8 = readU16WorkRamAbs(state, ptrA1 + 8);
  const a1_a = readU16WorkRamAbs(state, ptrA1 + 0xa);
  const a1_c = readU16WorkRamAbs(state, ptrA1 + 0xc);

  const a0_2 = readU16WorkRamAbs(state, ptrA0 + 2);
  const a0_4 = readU16WorkRamAbs(state, ptrA0 + 4);
  const a0_6 = readU16WorkRamAbs(state, ptrA0 + 6);
  const a0_8 = readU16WorkRamAbs(state, ptrA0 + 8);
  const a0_a = readU16WorkRamAbs(state, ptrA0 + 0xa);
  const a0_c = readU16WorkRamAbs(state, ptrA0 + 0xc);

  // Long sums (ext.l + add.l): no overflow risk con 16-bit signed * 3 ⇒ ±98304.
  const D4 = s16(a1_6) + s16(a1_4) + s16(a1_2);
  const D3 = s16(a1_c) + s16(a1_a) + s16(a1_8);
  const D2 = s16(a0_6) + s16(a0_4) + s16(a0_2);
  const D5 = s16(a0_c) + s16(a0_a) + s16(a0_8);

  // 0x1A86E: cmp.l D2,D3; bgt → 1A878. bgt = D3 > D2. Else (D3 <= D2) → return 0.
  if (D3 <= D2) return 0;
  // 0x1A878: cmp.l D4,D5; bgt → 1A880. bgt = D5 > D4. Else (D5 <= D4) → return 1.
  if (D5 <= D4) return 1;

  // 0x1A880: word compares, signed.
  // cmp.w (0xa,A1),D0w  (D0w = (+4,A0).w).  blt → 1A88E. blt = D0w < (+a,A1).w
  //    Else (D0w >= a1_a) → return 0.
  if (s16(a0_4) >= s16(a1_a)) return 0;
  // cmp.w (0xa,A0),D0w  (D0w = (+4,A1).w). blt → 1A89C. Else → return 1.
  if (s16(a1_4) >= s16(a0_a)) return 1;
  // cmp.w (0x8,A1),D0w  (D0w = (+2,A0).w). blt → 1A8AA. Else → return 0.
  if (s16(a0_2) >= s16(a1_8)) return 0;
  // cmp.w (0x8,A0),D0w  (D0w = (+2,A1).w). blt → 1A8B8. Else → return 1.
  if (s16(a1_2) >= s16(a0_8)) return 1;
  // cmp.w (0xc,A1),D0w  (D0w = (+6,A0).w). blt → 1A8C6. Else → return 0.
  if (s16(a0_6) >= s16(a1_c)) return 0;
  // moveq #1
  return 1;
}

/**
 * Resolver per il pointer indicizzato dalla ROM lookup table.
 *
 * @param rom        ROM image (program).
 * @param byteIdx    Byte index 0..255 (zero-extended dalla move.b di FUN_1A7A8).
 * @returns          Pointer assoluto M68k long (potenzialmente fuori workRam).
 */
export function lookupRectPtr(rom: RomImage, byteIdx: number): number {
  const idx = byteIdx & 0xff;
  // Read long BE @ ROM[0x1F0E2 + idx*4]
  return readU32BE(rom.program, ROM_LOOKUP_OFF + idx * 4) >>> 0;
}

/**
 * Bag di callback iniettabile per testabilità avanzata. Default: implementazione
 * bit-perfect inline. Il caller può sovrascrivere `compare` (per es. con un
 * thunk di binary-oracle che invoca direttamente FUN_1A80A nel WASM, utile
 * a isolare il bug "ho replicato 1A7A8 male" da "ho replicato 1A80A male").
 */
export interface SortAdjacentObjects1A7A8Subs {
  /**
   * Replica di `FUN_0001A80A`. Default: `fun1A80A` (bit-perfect inline).
   *
   * @param state  GameState.
   * @param ptrA1  Pointer al "rect A1" (lookup di byte[A2_walk]).
   * @param ptrA0  Pointer al "rect A0" (lookup di byte[A3_walk]).
   * @returns      0 o 1 (osservato solo come "zero vs non-zero").
   */
  compare?: (state: GameState, ptrA1: number, ptrA0: number) => number;
}

/**
 * Replica `FUN_0001A7A8` — single-pass adjacent-pair sweep con stride.
 *
 * Vedi disasm e semantica nell'header del file.
 *
 * @param state    GameState (workRam[0x3BC..0x3DC) MUTATO via swap).
 * @param rom      ROM image (lookup-table @ 0x1F0E2 letta).
 * @param stride   Byte stride tra A2 e A3 (arg LSB del caller). I caller noti
 *                 passano 1, 2, 3 in successione. Range valido 0..31.
 *                 - `0`: A2 == A3 ⇒ swap no-op, ma il loop avanza fino al
 *                   primo 0xFF o fino A2 == A5 (32 iter max).
 *                 - `>= 0x20`: A3 inizia già fuori range ⇒ exit immediato
 *                   (modellato come no-op, A3 == A5 prima del primo cmp;
 *                   in realtà il binario fa il primo `cmp.b -1,(A2)`, quindi
 *                   se byte[A2] != 0xFF entra, dereferenzia, ma poi al post-
 *                   incremento A3 sarebbe già "passato"; il binario non fa
 *                   alcun guard pre-loop, quindi è UB se stride > 31. Il
 *                   modello replica esattamente l'andamento del binario).
 * @param subs     Callback bag (default = inline).
 *
 * **Mutation**: solo `workRam[0x3BC..0x3DC)`. Le strutture rect a `0x1DC..`
 * sono lette via la lookup-table ROM ma mai scritte.
 */
export function sortAdjacentObjects1A7A8(
  state: GameState,
  rom: RomImage,
  stride: number,
  subs: SortAdjacentObjects1A7A8Subs = {},
): void {
  const compare = subs.compare ?? fun1A80A;

  // D0 = byte arg (LSB del long pushato dal caller). Modellato direttamente.
  const strideByte = stride & 0xff;

  // A2, A3, A5 come offset workRam (interno al modulo).
  let a2Off: number = BYTE_ARRAY_OFF; // 0x3BC
  let a3Off: number = (BYTE_ARRAY_OFF + strideByte) | 0; // 0x3BC + stride
  const a5Off: number = (BYTE_ARRAY_OFF + BYTE_ARRAY_LEN) | 0; // 0x3DC

  const r = state.workRam;

  // Helper inline: read byte da workRam offset (no bounds check perché restiamo
  // sotto 0x2000 nei caller noti; se il caller passa stride > 0x20 usciamo
  // appena uno dei due raggiunge a5Off).
  const read8 = (off: number): number => (r[off] ?? 0) & 0xff;

  // Loop @ 0x1A7C6. Max iterazioni: 32 (cap per a2 == a5).
  // Safety cap aggiuntivo non necessario: il loop è strettamente limitato
  // da a2/a3 monotono crescenti verso a5Off, quindi termina in <=32 step.
  let safety = BYTE_ARRAY_LEN + 1; // 33 (cap difensivo)
  while (safety-- > 0) {
    // 0x1A7C6: cmpi.b #-1,(A2); beq exit
    if (read8(a2Off) === SENTINEL_BYTE) break;
    // 0x1A7CC: cmpi.b #-1,(A3); beq exit
    // Se a3Off >= a5Off (stride iniziale > 31 o post-walk già fuori) il read
    // è da workRam offset 0x3DC..0x3DD+ — che è ancora dentro workRam (8KB),
    // quindi il binario legge byte casuali. Se quei byte non sono 0xFF,
    // procede. Modelliamo esattamente lo stesso comportamento (read raw).
    if (read8(a3Off) === SENTINEL_BYTE) break;

    // 0x1A7D2..0x1A7E2: lookup ROM e push args (modellati come var locali).
    const idxA2 = read8(a2Off);
    const idxA3 = read8(a3Off);
    const ptrA1 = lookupRectPtr(rom, idxA2); // arg secondo-pushato → A1 in 1A80A
    const ptrA0 = lookupRectPtr(rom, idxA3); // arg primo-pushato → A0 in 1A80A

    // 0x1A7E6: jsr 1A80A
    const cmp = compare(state, ptrA1, ptrA0) | 0;

    // 0x1A7EC..0x1A7F6: if cmp != 0 → swap
    if (cmp !== 0) {
      const saved = read8(a2Off);
      r[a2Off] = read8(a3Off);
      r[a3Off] = saved;
    }

    // 0x1A7F8: addq.l #1,A2
    a2Off = (a2Off + 1) | 0;
    // 0x1A7FA: cmpa.l A5,A2; beq exit
    if (a2Off === a5Off) break;
    // 0x1A7FE: addq.l #1,A3
    a3Off = (a3Off + 1) | 0;
    // 0x1A800: cmpa.l A5,A3; bne loop (else exit)
    if (a3Off === a5Off) break;
  }
}
