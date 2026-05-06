/**
 * field-fetch-4058.ts — replica `FUN_00004058` (128 byte) bit-perfect.
 *
 * Lookup di un campo (byte o word big-endian) dentro un array di record da
 * 20 byte. La base dell'array e' a `*0x401FFC + 0x50`, il numero massimo di
 * record consentiti viene letto da una costante ROM @ `0x1006F` (mascherata
 * a 3 bit), e il caller specifica:
 *   - `arg1` = indice del record (0-based)
 *   - `arg2` = byte-offset dentro il record (0..0x12)
 *
 * Validazione (in ordine):
 *   1. Se `arg2 > 0x12`  -> ritorna `-1` (D0 = 0xFFFFFFFF, "offset out of range")
 *   2. Se `arg1 >= D4`   -> ritorna `-2` (D0 = 0xFFFFFFFE, "index out of range")
 *      Nota: `D4` = `(int8)ROM[0x1006F]` sign-ext-long & 7 (range 0..7).
 *      Per la ROM marble madness `ROM[0x1006F] = 0xE3` -> `D4 = 3`.
 *   3. Se `arg2 == 0x12` -> ritorna word big-endian a `record_base + 0x12`
 *      (cioe' `(byte[+0x12] << 8) | byte[+0x13]`). Range 0..0xFFFF.
 *   4. Altrimenti        -> ritorna byte a `record_base + arg2` (range 0..0xFF).
 *
 * **Disasm 0x4058..0x40D6** (128 byte / 0x80):
 *
 *   0x4058  movem.l {D5 D4 D3 D2},-(SP)        ; preserve D2,D3,D4,D5 (16 byte)
 *   0x405C  move.l  (0x14,SP),D2               ; D2 = arg1 (record index)
 *   0x4060  move.l  (0x18,SP),D1               ; D1 = arg2 (byte offset)
 *   0x4064  movea.l (0x401FFC).l,A0            ; A0 = *0x401FFC (long ptr)
 *   0x406A  moveq   #0x50,D0
 *   0x406C  adda.l  D0,A0                      ; A0 = ptr + 0x50 (struct base)
 *   0x406E  move.l  A0,D5                      ; D5 = base (preserved)
 *   0x4070  move.b  (0x1006F).l,D4b            ; D4b = ROM[0x1006F]
 *   0x4076  ext.w   D4w                        ; D4w = signext byte
 *   0x4078  ext.l   D4                         ; D4l = signext word -> long
 *   0x407A  moveq   #0x7,D0
 *   0x407C  and.l   D0,D4                      ; D4 = D4 & 7 (max records)
 *   0x407E  moveq   #0x0,D3                    ; D3 = 0 (out-of-range flag)
 *   0x4080  moveq   #0x12,D0
 *   0x4082  cmp.l   D1,D0                      ; flags = D0 - D1 = 0x12 - arg2
 *   0x4084  scs     D3b                        ; D3b = 0xFF se carry (0x12 < arg2)
 *   0x4086  neg.b   D3b                        ; D3b = 1 se arg2 > 0x12, else 0
 *   0x4088  bne.w   0x4092                     ; if D3 != 0 -> fail path
 *   0x408C  move.l  D4,D0
 *   0x408E  cmp.l   D2,D0                      ; flags = D0 - D2 = D4 - arg1
 *   0x4090  bhi.b   0x409E                     ; if D4 > arg1 unsigned -> work
 *   0x4092: tst.l   D3
 *   0x4094  beq.b   0x409A                     ; D3 == 0 -> ret -2
 *   0x4096  moveq   #-0x1,D0                   ; ret -1 (offset OOR)
 *   0x4098  bra.b   0x409C
 *   0x409A  moveq   #-0x2,D0                   ; ret -2 (index OOR)
 *   0x409C  bra.b   0x40D2                     ; -> epilogue
 *   0x409E: asl.l   #2,D2                      ; D2 *= 4
 *   0x40A0  move.l  D2,D0                      ; D0 = D2 (= orig*4)
 *   0x40A2  asl.l   #2,D2                      ; D2 *= 4 -> orig*16
 *   0x40A4  add.l   D0,D2                      ; D2 += D0 -> orig*20
 *   0x40A6  add.l   D1,D2                      ; D2 += arg2 (= record_off)
 *   0x40A8  moveq   #0x12,D0
 *   0x40AA  cmp.l   D1,D0
 *   0x40AC  bne.b   0x40C8                     ; if arg2 != 0x12 -> single byte
 *
 *   ; word path (arg2 == 0x12): read big-endian word.
 *   0x40AE  move.l  D2,D0
 *   0x40B0  addq.l  #1,D0                      ; D0 = record_off + 1 (= +0x13)
 *   0x40B2  movea.l D0,A0
 *   0x40B4  adda.l  D5,A0                      ; A0 = base + record_off + 0x13
 *   0x40B6  moveq   #0,D1
 *   0x40B8  move.b  (A0),D1b                   ; D1 = low byte
 *   0x40BA  movea.l D2,A0
 *   0x40BC  adda.l  D5,A0                      ; A0 = base + record_off + 0x12
 *   0x40BE  moveq   #0,D0
 *   0x40C0  move.b  (A0),D0b                   ; D0 = high byte
 *   0x40C2  lsl.l   #8,D0                      ; D0 <<= 8
 *   0x40C4  add.l   D0,D1                      ; D1 = (high<<8) | low
 *   0x40C6  bra.b   0x40D0
 *
 *   ; single-byte path (arg2 != 0x12).
 *   0x40C8: movea.l D2,A0
 *   0x40CA  adda.l  D5,A0                      ; A0 = base + record_off
 *   0x40CC  moveq   #0,D1
 *   0x40CE  move.b  (A0),D1b                   ; D1 = byte (zero-extended)
 *   0x40D0: move.l  D1,D0                      ; D0 = D1 (return value)
 *   0x40D2  movem.l (SP)+,{D2 D3 D4 D5}
 *   0x40D6  rts
 *
 * **Modellazione bit-perfect**:
 *
 *   1. **`scs` + `neg.b`**: produce 1 se la condizione (carry su `cmp.l D1,D0`
 *      con D0=0x12) e' vera, cioe' se 0x12 < D1 unsigned (= arg2 > 0x12).
 *      `scs` setta tutti i bit del byte (0xFF) se carry, poi `neg.b 0xFF` =
 *      `0 - 0xFF & 0xFF = 1`. Per arg2 <= 0x12: D3.b = 0.
 *      I bit alti di D3 restano 0 (D3 era inizializzato a 0 a 0x407E).
 *
 *   2. **`tst.l D3`**: testa l'intero long. D3 era 0x00000000 o 0x00000001.
 *      `beq` -> branch se D3 == 0 (cioe' arg2 <= 0x12). Quindi nel fail path:
 *      - D3 == 0  -> ret -2  (significato: arg1 >= D4, "index out of range")
 *      - D3 == 1  -> ret -1  (significato: arg2 > 0x12, "offset out of range")
 *
 *   3. **`cmp.l D2,D0` con D0=D4**: compara D4 con arg1 long. `bhi` = unsigned
 *      higher (= !C and !Z), cioe' D4 > arg1 unsigned. arg1 e' un long preso
 *      dallo stack: il caller passa sempre `ext.l` di un word (0x57da-0x57e0,
 *      0x58ee-0x58f2, etc.), quindi i bit alti di arg1 sono 0 o 0xFFFFFFFF
 *      (sign-ext). Per arg1 >= 0x80000000 (sign-ext negativo) il confronto
 *      unsigned con D4 in [0..7] e' sempre `D4 < arg1`, cioe' bhi non scatta:
 *      cade nel fail path -> ret -2. (Il caller binario non passa mai valori
 *      negativi in pratica, ma la modellazione lo gestisce.)
 *
 *   4. **`add.l D0,D2`** dopo i 2 shift: D2 e' diventato `arg1 << 4 = arg1 * 16`,
 *      D0 e' rimasto `arg1 << 2 = arg1 * 4`. Poi `D2 += D0` -> `arg1 * 20`.
 *      Tutti gli add/shift sono long, wrap a 32 bit. Per arg1 in [0..7]
 *      (range valido), `arg1 * 20 + arg2 + 0x50 + ptr_base` non overflowa.
 *
 *   5. **`add.l D1,D2`**: D2 += arg2. arg2 e' in [0..0x12] nel path work
 *      (verificato dal check 0x4082). Quindi `D2 = arg1*20 + arg2`.
 *
 *   6. **Word read big-endian**: il byte high e' a `record_off + 0x12`, quello
 *      low a `record_off + 0x13`. M68k big-endian standard.
 *
 *   7. **Sign-ext della costante ROM**: `move.b ROM[0x1006F],D4b; ext.w; ext.l`
 *      sign-extende il byte. Poi `& 7` butta via il segno. Quindi solo i 3 bit
 *      bassi del byte ROM contano. Per il marble program, ROM[0x1006F] = 0xE3
 *      -> D4 = 3.
 *
 * **Side effects**: nessuno. La funzione e' puro lookup. Non scrive in memoria
 * (ne' workRam, ne' MMIO, ne' altro). Restituisce solo D0.
 *
 * **JSR interne**: nessuna. Funzione leaf, no stub injection necessaria.
 *
 * **Stack layout** all'ingresso del corpo (dopo `movem` di 16 byte):
 *   SP+0x00..0x0F  saved D2,D3,D4,D5 (16 byte)
 *   SP+0x10..0x13  return PC (4 byte)
 *   SP+0x14..0x17  arg1 long (record index, push-RTL second-from-top arg)
 *   SP+0x18..0x1B  arg2 long (byte offset, push-RTL bottom arg)
 *
 * Il caller spinge tutti i due come long via `ext.l` di un word. La funzione
 * legge i long pieni: i bit alti vengono usati nel `cmp.l` (vedi nota 3).
 *
 * **Caller sites** (FUN_00005688, 3 chiamate):
 *   - 0x57E2: arg1 = signext(A3.w), arg2 = signext(D5.w)  (loop scan record)
 *   - 0x583A: arg1 = signext(A3.w), arg2 = signext(0)     (read byte 0)
 *   - 0x58F4: arg1 = signext(A3.w), arg2 = 0x12           (read word @ +0x12)
 *
 * **Verifica bit-perfect** via `test-field-fetch-4058-parity.ts` (500 casi).
 */

import type { GameState } from "./state.js";

/** WorkRam offset di `*0x401FFC` (long pointer alla struct). */
const PTR_FFC_OFF = 0x1ffc;

/** Offset costante che sposta dal long-ptr alla base dei record. */
const RECORD_BASE_PLUS = 0x50;

/** Dimensione di ogni record in byte (= 20 = arg1 * 20 hard-coded nel binario). */
export const RECORD_SIZE = 20 as const;

/** Offset interno del campo "word" dentro il record (0x12, ultimi 2 byte). */
export const RECORD_WORD_OFF = 0x12 as const;

/** Indirizzo ROM della costante "max records" (sign-ext-long & 7). */
export const ROM_MAX_RECORDS_ADDR = 0x0001006f as const;

/** Maschera applicata alla costante ROM dopo sign-ext (low 3 bit). */
const MAX_RECORDS_MASK = 0x7;

/** RAM base assoluta M68k. */
const WORK_RAM_BASE = 0x400000;

/** Limite superiore esclusivo workRam. */
const WORK_RAM_END = 0x402000;

/** Return code "offset out of range" (`arg2 > 0x12`). Long M68k = 0xFFFFFFFF. */
export const RET_OFFSET_OOR = 0xffffffff as const;

/** Return code "index out of range" (`arg1 >= D4`). Long M68k = 0xFFFFFFFE. */
export const RET_INDEX_OOR = 0xfffffffe as const;

/**
 * Sub injection: il binario fa `move.b (0x1006F).l,D4b` per leggere la
 * costante "max records valid". Il default usa `rom.program[0x1006F]`,
 * ma per testabilita' isolata e' iniettabile via opts.
 */
export interface FieldFetch4058Subs {
  /**
   * Provider della costante ROM @ 0x1006F (byte raw, non ancora masked).
   * Il modulo applica internamente sign-ext + `& 7` come da disasm.
   * Default: il caller deve passare il byte come parametro `romMaxRecordsByte`.
   */
  romMaxRecordsByte?: number;
}

/**
 * Read byte assoluto M68k da workRam. Indirizzi fuori `0x400000..0x401FFF`
 * leggono `0` (semantica difensiva uniforme col resto del codebase).
 */
function read8(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (state.workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

/**
 * Read big-endian long from workRam @ offset (4 byte).
 */
function readLongBE(workRam: Uint8Array, off: number): number {
  return (
    (((workRam[off] ?? 0) << 24) |
      ((workRam[off + 1] ?? 0) << 16) |
      ((workRam[off + 2] ?? 0) << 8) |
      (workRam[off + 3] ?? 0)) >>>
    0
  );
}

/**
 * Replica bit-perfect di `FUN_00004058` — record-field lookup.
 *
 * @param state                GameState (legge `workRam[0x1FFC..]` per il long
 *                             ptr, e i byte del record ai vari offset).
 * @param arg1                 Record index (long M68k, sign-ext'd da word dal
 *                             caller). Il check unsigned `D4 > arg1` significa
 *                             che valori negativi (high-bit set) cadono nel
 *                             "fail" path con ret -2.
 * @param arg2                 Byte offset dentro il record (long M68k). Range
 *                             valido [0..0x12]. Per arg2 == 0x12 ritorna word.
 * @param romMaxRecordsByte    Byte ROM @ 0x1006F (raw, non masked). Per il
 *                             marble program e' `0xE3` -> D4 = 3 record validi.
 *                             Esposto come param per testabilita' (parity test
 *                             usa la ROM reale, smoke test puo' iniettare
 *                             arbitrario).
 *
 * @returns                    D0 long unsigned 32-bit:
 *                             - `0xFFFFFFFF` se arg2 > 0x12
 *                             - `0xFFFFFFFE` se arg2 <= 0x12 ma arg1 >= D4
 *                             - `0..0xFFFF`  se arg2 == 0x12 (word BE @ +0x12)
 *                             - `0..0xFF`    se arg2 != 0x12 (byte @ arg2)
 *
 * **Bit-perfect notes** (vedi disasm completo nell'header del file).
 */
export function fieldFetch4058(
  state: GameState,
  arg1: number,
  arg2: number,
  romMaxRecordsByte: number,
): number {
  // ── arg1, arg2: long M68k unsigned 32-bit (caller li passa sign-ext'd
  //    da word, ma li trattiamo come long pieni come fa il binario). ──
  const arg1l = arg1 >>> 0;
  const arg2l = arg2 >>> 0;

  // ── A0 = *0x401FFC (long ptr in workRam, big-endian). ──
  const ptr = readLongBE(state.workRam, PTR_FFC_OFF);
  // D5 = ptr + 0x50 (record base, long add wrap a 32-bit).
  const recordBase = (ptr + RECORD_BASE_PLUS) >>> 0;

  // ── D4 = sign-ext-long(byte ROM[0x1006F]) & 7. ──
  // sign-ext byte: byte 0..0x7F resta 0..0x7F; byte 0x80..0xFF diventa
  // 0xFFFFFF80..0xFFFFFFFF. Poi `& 7` recupera solo i 3 bit bassi.
  // In pratica equivalente a `byte & 7`: il sign-ext non cambia i 3 bit bassi.
  const d4 = (romMaxRecordsByte & 0xff & MAX_RECORDS_MASK) >>> 0;

  // ── 0x4080..0x4088: D3 = (arg2 > 0x12) ? 1 : 0. Long unsigned compare. ──
  // M68k: cmp.l D1,D0 con D0=0x12 -> carry se 0x12 < D1 unsigned.
  // arg2l e' unsigned 32-bit. arg2l > 0x12 unsigned -> D3 = 1 (offset OOR).
  const d3 = arg2l > 0x12 ? 1 : 0;

  // ── 0x408C..0x4090: bhi se D4 > arg1 unsigned -> work path. ──
  const goWork = !(d3 !== 0) && d4 > arg1l;

  if (!goWork) {
    // 0x4092 fail path: tst.l D3; beq -> ret -2 else ret -1.
    if (d3 === 0) {
      return RET_INDEX_OOR;
    }
    return RET_OFFSET_OOR;
  }

  // ── 0x409E work path: D2 = arg1*20 + arg2 (record byte offset). ──
  // M68k: asl.l #2,D2; mov D0,D2; asl.l #2,D2; add D0,D2; add D1,D2.
  // arg1l * 4 = D0 dopo primo shift. arg1l * 16 = D2 dopo secondo shift.
  // D2 += D0 -> arg1l * 20. D2 += arg2l -> record byte offset.
  // Long add wrap a 32 bit.
  const recordOff = (((arg1l * 20) >>> 0) + arg2l) >>> 0;

  // ── 0x40A8..0x40AC: branch su (arg2 == 0x12). ──
  // M68k: cmp.l D1,D0 con D0=0x12; bne -> single byte path.
  if (arg2l !== RECORD_WORD_OFF) {
    // 0x40C8 single-byte path: D1 = byte @ recordBase + recordOff (zero-ext).
    const addr = (recordBase + recordOff) >>> 0;
    return read8(state, addr) & 0xff;
  }

  // 0x40AE word path: leggi byte @ recordOff (high) e recordOff+1 (low).
  // M68k: D0 = recordOff+1; A0 = D5+D0; D1 = byte (low).
  //       A0 = D5+recordOff; D0 = byte (high); D0 <<= 8; D1 += D0.
  const addrHi = (recordBase + recordOff) >>> 0;
  const addrLo = (recordBase + recordOff + 1) >>> 0;
  const high = read8(state, addrHi);
  const low = read8(state, addrLo);
  return (((high << 8) | low) & 0xffff) >>> 0;
}
