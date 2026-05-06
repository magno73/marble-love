/**
 * key-rank-lookup-4686.ts — replica `FUN_00004686` (164 byte) bit-perfect.
 *
 * Lookup table-driven "rank" di una chiave a 24 bit dentro una tabella
 * sorted (10 righe × 5 byte) puntata via `*0x401FFC + 0x1E`. Self-contained:
 * **NESSUNA JSR** interna, nessuna MMIO, nessuna scrittura su workRam (solo
 * letture). Il ritorno e' un long signed in `D0`.
 *
 * **Caller**: `FUN_0000472A` (gate-check) — secondo il commento in
 * `eeprom-commit-request.ts` (FUN_472A push un long e fa varie call). I 164
 * byte fra 0x4686 e 0x4729 sono fra il prologue di FUN_472A e la jsr a
 * FUN_3FC6 a 0x4748, quindi 0x4686 e' una funzione separata che pre-elabora
 * un argomento di FUN_472A. NON ha xref oltre a "EXTERNAL", quindi e'
 * presumibilmente chiamata via PC-relative o tramite tabella; il nome
 * "key-rank-lookup" descrive il comportamento osservato.
 *
 * **Disasm 0x4686..0x4729** (164 byte):
 *
 *   0x4686  link.w  A6,-0x4              ; locals[4] @ A6-4
 *   0x468a  movem.l {D4 D3 D2},-(SP)     ; preserve D2/D3/D4
 *   0x468e  move.l  (0x8,A6),D2          ; D2 = arg long (caller pushed)
 *   0x4692  move.l  (0x00401FFC).l,D1    ; D1 = *0x401FFC (struct base ptr)
 *   0x4698  moveq   #0x1E,D0
 *   0x469a  add.l   D0,D1                ; D1 = ptr + 0x1E (table base)
 *   0x469c  move.l  D1,D4                ; D4 = table base (long)
 *   0x469e  moveq   #2,D3                ; D3 = 2 (loop counter)
 *   ; ── Loop pack: byte-explode di D2 (3 bytes BE) in locals[0..2] ──────
 *   0x46a0  loop_pack:
 *   0x46a0  move.w  D3w,D1w              ; D1.w = D3.w (= idx in locals)
 *   0x46a2  lea     (-0x4,A6),A0         ; A0 = &locals[0]
 *   0x46a6  move.b  D2b,D0b              ; D0.b = D2.b (low byte)
 *   0x46a8  andi.b  #-0x1,D0b            ; D0 &= 0xFF (effettivo no-op)
 *   0x46ac  move.b  D0b,(0x0,A0,D1w*1)   ; locals[D3] = D2.b
 *   0x46b0  move.l  D2,D1
 *   0x46b2  lsr.l   #8,D1                ; D1 = D2 >> 8
 *   0x46b4  move.l  D1,D2                ; D2 >>= 8
 *   0x46b6  subq.w  #1,D3w               ; D3--
 *   0x46b8  tst.w   D3w
 *   0x46ba  bge.b   0x46a0               ; while D3 >= 0 (3 iter: 2,1,0)
 *   ; Dopo loop: locals[2]=arg.b0(LSB), locals[1]=arg.b1, locals[0]=arg.b2;
 *   ; D2 = arg >> 24 (high byte). locals[3] NON inizializzato.
 *   0x46bc  tst.l   D2
 *   0x46be  beq.b   0x46c6               ; se arg fits in 24 bit → continua
 *   0x46c0  moveq   #-1,D0               ; altrimenti D0 = -1
 *   0x46c2  bra.w   0x4722               ; → exit (return -1)
 *   ; ── Outer loop: row in {0,5,10,...,45} (10 righe da 5 byte) ─────────
 *   0x46c6  clr.w   D3w                  ; D3 = 0 (outer = row*5 byte offset)
 *   0x46c8  outer_top:
 *   0x46c8  clr.w   D2w                  ; D2 = 0 (inner = colonna 0..2)
 *   0x46ca  inner_top:
 *   0x46ca  move.w  D2w,D0w              ; D0 = inner zext
 *   0x46cc  ext.l   D0
 *   0x46ce  move.w  D3w,D1w              ; D1 = outer zext
 *   0x46d0  ext.l   D1
 *   0x46d2  add.l   D1,D0                ; D0 = outer + inner (byte offset)
 *   0x46d4  movea.l D0,A0
 *   0x46d6  adda.l  D4,A0                ; A0 = table[outer+inner] address
 *   0x46d8  move.b  (A0),D0b             ; D0.b = table[outer+inner]
 *   0x46da  move.w  D2w,D1w              ; D1.w = inner
 *   0x46dc  lea     (-0x4,A6),A0         ; A0 = &locals[0]
 *   0x46e0  cmp.b   (0x0,A0,D1w*1),D0b   ; flags = locals[inner] - tableByte
 *   0x46e4  bhi.w   0x4718               ; bhi: locals > tableByte (unsigned)
 *                                          ; → row failed, advance row
 *   ; locals[inner] <= tableByte
 *   0x46e8  move.w  D2w,D0w              ; ricalcolo identico (compiler boil.)
 *   0x46ea  ext.l   D0
 *   0x46ec  move.w  D3w,D1w
 *   0x46ee  ext.l   D1
 *   0x46f0  add.l   D1,D0
 *   0x46f2  movea.l D0,A0
 *   0x46f4  adda.l  D4,A0
 *   0x46f6  move.b  (A0),D0b             ; D0.b = table[outer+inner] (di nuovo)
 *   0x46f8  move.w  D2w,D1w
 *   0x46fa  lea     (-0x4,A6),A0
 *   0x46fe  cmp.b   (0x0,A0,D1w*1),D0b
 *   0x4702  bcc.b   0x4710               ; bcc: locals >= tableByte (unsigned)
 *                                          ; → equality (gia' escluso bhi)
 *                                          ; → next col
 *   ; locals[inner] < tableByte → MATCH FOUND
 *   0x4704  move.w  D3w,D0w              ; D0 = outer
 *   0x4706  ext.l   D0
 *   0x4708  divs.w  #5,D0                ; D0 = outer / 5 (signed div)
 *                                          ; risultato in D0w (.w in low,
 *                                          ; resto in D0 high word)
 *   0x470c  ext.l   D0                   ; sign-ext D0w → D0l
 *   0x470e  bra.b   0x4722               ; → exit
 *   ; equality case: avanza inner
 *   0x4710  addq.w  #1,D2w               ; inner++
 *   0x4712  moveq   #3,D0
 *   0x4714  cmp.w   D2w,D0w              ; flags = D0(=3) - D2(=inner)
 *   0x4716  bgt.b   0x46ca               ; bgt: 3 > inner (signed) → next col
 *                                          ; loop while inner < 3 (cols 0,1,2)
 *   ; row exhaustion: tutti e 3 i byte sono "==" oppure "<" finiti senza match.
 *   ; In realta' bcc=`>=` esce solo per equality (bhi gia' filtrato `>`),
 *   ; quindi la row e' "tutti uguali" — ma bcc fa anche jump per equality
 *   ; cosi' il codice ricicla. Una row "all-equal" con bhi mai triggered:
 *   ; ogni col fa `bcc` → next col, fino a inner=3 → fall-through a row+=5.
 *   ; In pratica row "==" key esattamente = matcha solo se lasciata alla fine.
 *   0x4718  addq.w  #5,D3w               ; outer += 5 (row stride)
 *   0x471a  moveq   #0x32,D0
 *   0x471c  cmp.w   D3w,D0w              ; flags = D0(=0x32) - D3
 *   0x471e  bgt.b   0x46c8               ; bgt: 0x32 > outer → next row
 *                                          ; (10 row max: outer 0,5,...,45)
 *   ; Tutti i 10 row consumati senza match → fall-through
 *   0x4720  moveq   #10,D0               ; D0 = 10 (default rank "out-of-range")
 *   0x4722  exit:
 *   0x4722  movem.l (SP)+,{D4 D3 D2}
 *   0x4726  unlk    A6
 *   0x4728  rts
 *
 * **Semantica**:
 *
 *   La funzione converte un argomento long in una "chiave" 3-byte BE
 *   (`locals[0..2] = arg.b1, arg.b2, arg.b3`, dove `arg.b0` deve essere 0,
 *   altrimenti ritorna -1). Poi confronta lessicograficamente la chiave
 *   con 10 righe da 5 byte di una tabella sorted DESCENDENTE in
 *   `*0x401FFC + 0x1E`, considerando solo i primi 3 byte di ogni riga.
 *
 *   **Direzione del cmp.b** (CRITICO): `cmp.b src, dst` (Motorola) calcola
 *   `dst - src` settando i flag. Qui:
 *     - `cmp.b (0x0,A0,D1w*1), D0b` → `D0b - locals[inner]`
 *       (dst=D0b=tableByte, src=mem=locals[inner])
 *     - `bhi`: C=0 AND Z=0 → tableByte > locals[inner] (unsigned strict)
 *     - `bcc`: C=0 → tableByte >= locals[inner] (unsigned)
 *     - fall-through (bcs): C=1 → tableByte < locals[inner]
 *
 *   **Path semantico**:
 *     - bhi (tableByte > key) → advance row (row prefix troppo grande,
 *       per tabella DESC → continua a row successive che hanno prefix
 *       minori e potrebbero matchare)
 *     - == (3 col uguali) → advance row (la row "all-equal" non matcha,
 *       artefatto del codice: `bcc` post-bhi-filter cattura "==" e fa
 *       advance col fino a inner=3 → fall-through outer += 5)
 *     - tableByte < key → return outer/5 = row index r
 *
 *   **Ritorni** (per tabella DESC sorted strict):
 *     - se key > tutti i prefix → ritorna 0 (la prima row gia' < key)
 *     - se row[r-1].prefix > key > row[r].prefix → ritorna r (= prima
 *       row con prefix < key, scanning top-down DESC)
 *     - se key < tutti i prefix → ritorna 10 (mai trova match: tutti i
 *       cmp dicono tableByte > key → bhi → advance, 10 row consumate)
 *     - se arg.b0 != 0 (key non sta in 24 bit) → ritorna -1
 *
 *   **Nota di fedelta'** sul caso == esatto (key matcha row r byte-per-byte):
 *   il binario fa due cmp.b consecutivi sullo stesso byte (0x46e0 e 0x46fe).
 *   Il primo (bhi) filtra strict >. Il secondo (bcc) include il caso ==.
 *   Quindi quando 3 col sono tutti == il loop inner finisce e si avanza
 *   row. Effetto: key == row r esatto NON matcha la row r ma la row r+1
 *   (se DESC sorted la r+1 ha prefix minore di r ≤ key → bcs → return r+1).
 *   Se r=9, fall-through finale → return 10.
 *
 * **Layout 4-byte locals @ A6-4**:
 *
 *   locals[0] = (arg >> 16) & 0xFF   ; byte alto della chiave 24-bit
 *   locals[1] = (arg >> 8)  & 0xFF
 *   locals[2] =  arg        & 0xFF   ; byte basso
 *   locals[3] = ??? (NON inizializzato dal codice!)
 *
 *   **MA**: il loop `inner` scorre solo i_index in {0,1,2}, quindi
 *   locals[3] NON viene mai letto. Sicuro ignorarlo nella replica TS.
 *
 * **Tabella @ ptr+0x1E**: 10 righe × 5 byte. Solo i primi 3 byte di ogni
 *   riga sono confrontati con la chiave; gli altri 2 byte (col 3,4) sono
 *   payload o padding. Il codice non legge mai col >= 3.
 *
 * **Side effects**: nessuno. Solo letture da:
 *   - workRam @ 0x401FFC (4 byte ptr long)
 *   - workRam @ ptr+0x1E .. ptr+0x1E+47 (50 byte tabella)
 *
 * **MMIO**: nessuna.
 * **JSR**: nessuna (self-contained).
 *
 * **Convenzioni stack/registri**:
 *   - link.w A6,-0x4: A6 = SP (post-link), SP -= 4 per locals.
 *     Argomento a (0x8, A6) = caller's pushed long (stack post-jsr =
 *     ret_addr@0, A6_saved@4, arg@8 prima del SP -= 4).
 *   - movem.l {D4,D3,D2},-(SP): preserve D2/D3/D4 (12 byte).
 *   - Restauro inverso: movem.l (SP)+,{D2,D3,D4} (m68k movem reverse order).
 *
 * **Verifica bit-perfect**: `cli/src/test-key-rank-lookup-4686-parity.ts`
 *   (500 casi).
 */

import type { GameState } from "./state.js";

/** WorkRam offset del long pointer @ 0x401FFC. */
const PTR_FFC_OFF = 0x1ffc;

/** RAM base. */
const WORK_RAM_BASE = 0x400000;

/** Offset di byte dal ptr base per la testa della tabella. */
const TABLE_OFF_FROM_PTR = 0x1e;

/** Numero massimo di righe della tabella. */
const NUM_ROWS = 10;

/** Stride (byte) tra una riga e la successiva. */
const ROW_STRIDE = 5;

/** Numero di colonne effettivamente confrontate per riga (3 byte chiave). */
const KEY_LEN = 3;

/**
 * Replica bit-perfect di `FUN_00004686`.
 *
 * Lookup di rank per una chiave 24-bit (low 24 bit di `argLong`) dentro
 * una tabella sorted di 10 righe × 5 byte puntata da `*0x401FFC + 0x1E`.
 *
 * @param state    GameState. Solo letture. workRam letta a:
 *                   - off 0x1FFC..0x1FFF (long ptr)
 *                   - (ptr - 0x400000) + 0x1E .. + 0x1E + 49 (50 byte tabella)
 * @param argLong  Argomento long (32-bit). Il binario lo legge da
 *                 `(0x8, A6)` come pushato dal caller via `move.l Dn,-(SP)`.
 *                 Se il byte alto (`(argLong >> 24) & 0xFF`) e' diverso da
 *                 zero, ritorna -1 (la chiave non sta in 24 bit).
 *
 * @returns  long signed (D0 al rts):
 *            - **-1** (= 0xFFFFFFFF) se `(argLong >> 24) & 0xFF != 0`.
 *            - **0..9** indice della prima row la cui chiave-prefix e'
 *              strettamente minore della chiave dell'argomento (DESC sort).
 *            - **10** se nessuna delle 10 righe e' strettamente minore
 *              (key < tutti i prefix delle 10 righe).
 *
 * **Modellazione bit-perfect**:
 *
 *   1. Estrae 4 bytes dal long: `arg.b3` (LSB) → locals[2], `arg.b2` →
 *      locals[1], `arg.b1` → locals[0]. Il quarto byte (`arg.b0` = MSB)
 *      e' tenuto in D2 dopo lo shift e testato a 0x46bc.
 *   2. Se `arg.b0 != 0`: return -1 (signed long).
 *   3. Per ogni `outer` in {0, 5, 10, 15, 20, 25, 30, 35, 40, 45}:
 *      Per ogni `inner` in {0, 1, 2}:
 *        - `tableByte = workRam[ptrOff + 0x1E + outer + inner]`
 *        - `keyByte = locals[inner]`
 *        - se `tableByte > keyByte` (unsigned): break inner, next outer.
 *        - se `tableByte < keyByte` (unsigned): return outer/5.
 *        - se `tableByte == keyByte`: next inner.
 *      Se inner finisce (3 cols tutte ==): next outer.
 *   4. Se nessun match: return 10.
 *
 * **Edge case `divs.w #5, D0`**: nel binario la divisione e' una divs.w
 * (signed 32/16 → 16q + 16r). Per outer ∈ {0, 5, 10, ..., 45}, il quoziente
 * e' sempre 0..9 e il resto 0. La sign-ext successiva (`ext.l D0`) prende
 * D0.w (low word del result) e la estende a long. Il risultato e' identico
 * a `outer / 5` con divisione intera. Nessun overflow possibile.
 */
export function keyRankLookup4686(state: GameState, argLong: number): number {
  const r = state.workRam;

  // ─── Estrai key bytes (BE) e high byte ───────────────────────────────
  // Equivalente al loop @ 0x46a0..0x46ba.
  const arg = argLong >>> 0;
  const argB0 = (arg >>> 24) & 0xff; // testato a 0x46bc
  const argB1 = (arg >>> 16) & 0xff; // locals[0]
  const argB2 = (arg >>> 8) & 0xff;  // locals[1]
  const argB3 = arg & 0xff;          // locals[2]

  // ─── Check high byte: se != 0 → return -1 ────────────────────────────
  if (argB0 !== 0) {
    // moveq #-1,D0 → D0 = 0xFFFFFFFF (signed -1).
    // In TS rappresentiamo come signed -1 (cosi il caller TS puo' testare
    // `< 0` o `=== -1`); il binario ritorna 0xFFFFFFFF (long).
    return -1;
  }

  // locals[0..2] in array (locals[3] NON inizializzato e mai letto).
  const locals = [argB1, argB2, argB3];

  // ─── Leggi ptr da *0x401FFC (long BE) ────────────────────────────────
  const ptr =
    (((r[PTR_FFC_OFF] ?? 0) << 24) |
      ((r[PTR_FFC_OFF + 1] ?? 0) << 16) |
      ((r[PTR_FFC_OFF + 2] ?? 0) << 8) |
      (r[PTR_FFC_OFF + 3] ?? 0)) >>>
    0;
  const tableBase = ((ptr - WORK_RAM_BASE) >>> 0) + TABLE_OFF_FROM_PTR;

  // ─── Outer loop: row in {0, 5, 10, ..., 45} ─────────────────────────
  // Nota chiave su `cmp.b src,dst` Motorola: con `cmp.b mem, D0b` calcola
  // `D0b - mem` = `tableByte - locals[inner]`. Quindi:
  //   - bhi (C=0,Z=0): tableByte > locals[inner] (unsigned) → advance row
  //   - bcc (C=0): tableByte >= locals[inner] (qui = "==" perche' bhi
  //     gia' filtrato il caso strict>): advance inner col
  //   - fall-through (bcs, C=1): tableByte < locals[inner] → return outer/5
  //
  // Comportamento atteso: la tabella e' sorted DESCENDENTE (row 0 prefix
  // piu' grande). Il match (return) avviene alla prima riga la cui prefix
  // 3-byte e' lessicograficamente < key. Se key > prefix di tutte le 10
  // righe (= key piu' grande della prima riga, in DESC) → return 10 e'
  // impossibile perche' la prima row gia' < key triggera return r=0.
  // Se key < prefix di tutte le 10 righe → ogni cmp.b dice tableByte >
  // locals[inner] al primo col (col 0) → bhi → advance row → 10 row
  // consumate → fall-through a moveq #10,D0 → return 10.
  // Quindi:
  //   - tutti i prefix > key → return 10 (key "troppo piccola" per la
  //     tabella DESC)
  //   - prima row r con prefix == key (3 byte tutti uguali) → la row
  //     stessa NON matcha (ogni col fa bcc → next col, fino a esaurimento
  //     col → fall-through outer += 5). Il match arriva alla row r+1
  //     (assumendo desc-sort → row r+1 < row r ≤ key → fall-through → r+1)
  //   - prima row r con prefix < key → return r (rank "soglia" nel
  //     contesto DESC sorted)
  for (let outer = 0; outer < NUM_ROWS * ROW_STRIDE; outer += ROW_STRIDE) {
    let advanceRow = false;
    for (let inner = 0; inner < KEY_LEN; inner++) {
      const tableByte = (r[tableBase + outer + inner] ?? 0) & 0xff;
      const keyByte = locals[inner]! & 0xff;

      // bhi (unsigned strict >): tableByte > keyByte → advance row
      if (tableByte > keyByte) {
        advanceRow = true;
        break;
      }
      // bcc (unsigned >=) post-bhi → equality → advance inner col
      if (tableByte === keyByte) {
        continue;
      }
      // tableByte < keyByte (bcs path) → return outer/5
      return (outer / ROW_STRIDE) | 0;
    }
    if (!advanceRow) {
      // Caso "row tutta uguale alla key" (3 col tutti ==): fall-through a
      // outer += 5 (la row stessa non matcha, replica esatta del binario).
      continue;
    }
    // advanceRow=true → outer += 5 al prossimo iter (gia' fatto da `for`)
  }

  // Nessuna row con prefix < key: return 10.
  return NUM_ROWS;
}
