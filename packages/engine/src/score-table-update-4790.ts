/**
 * score-table-update-4790.ts — replica `FUN_00004790` (1178 byte) bit-perfect.
 *
 * Aggiorna la tabella interna delle statistiche di punteggio partendo dai due
 * accumulatori del timer delta (@ 0x401F86 e 0x401F8A), poi applica un decay
 * pass opzionale e invia i comandi di suono condizionali.
 *
 * **Indirizzi fissi hardcoded nel binario**:
 *   A4 = 0x5236 = `setFlagBit` (FUN_00005236, event-flags)
 *   A3 = 0x4442 = sound command dispatcher (FUN_00004442)
 *   A1/D6 = 0x40D8 = config-field fetch (FUN_000040D8)
 *   JSR 0x43D6 = `timerDeltaAccumulate` (FUN_000043D6)
 *   ROM[0x1006F] = config byte (max-records count + field selectors)
 *   ROM[0x7974]  = small lookup table (4 entry, selettore da (ROM[0x1006F]>>3)&3)
 *   0x401FFC     = long ptr alla struttura base (workRam)
 *   0x401F92     = accumulatore punteggio corrente (long, workRam)
 *
 * **Stack al link.w A6,-0x10** (argomenti a A6+8..A6+20):
 *   A6+0x08 = arg1 (D4) — score delta principale (long)
 *   A6+0x0C = arg2 (D2) — row-index cap (long)
 *   A6+0x10 = arg3 (D3) — score delta secondario (long, usato per 2ª entry)
 *   A6+0x14 = arg4      — running-max row cap (long, aggiornato in-place)
 *   A6+0x18 = arg5      — bonus long per campo 7
 *   A6+0x1C = arg6      — bonus long per campo 8
 *   A6+0x20 = arg7      — bonus long per campo 9
 *
 * **Locali @ A6-1..A6-16**:
 *   -0x1  count1     : byte, conta quante entry sono state processate
 *   -0x2  flag2      : byte, flag "count overflow": 1 se almeno un contatore
 *                      di cella ha fatto wrap 0xFF→0x00 (segnala decay necessario)
 *   -0x3  romByte2   : byte = ROM[0x1006F] (second read, per local[-4])
 *   -0x4/-0x5 word2  : word = (sign_ext(ROM[0x1006F]) >> 5) & 7
 *   -0x5  romByte1   : byte = ROM[0x1006F] (first read, per local[-6])
 *   -0x6  numRec     : word = sign_ext(ROM[0x1006F]) & 7  (numRecords)
 *   -0x7  tblByte    : byte = ROM[0x7974 + ((ROM[0x1006F]>>3)&3)]
 *   -0x8  divisorW   : word = sign_ext(tblByte) * 0x3C (= tblByte * 60, 16-bit)
 *   -0xC  basePtr    : long = *0x401FFC + 0x50  (record base, workRam-relative)
 *   -0x10 savedDelta : long = prima accumulazione letta da A2 (e azzerata)
 *
 * **Disasm** completo → `/tmp/marble-cand/004790.txt` (449 righe).
 *
 * **Verifica bit-perfect**: `cli/src/test-score-table-update-4790-parity.ts`
 * (500 casi).
 */

import type { GameState } from "./state.js";
import { timerDeltaAccumulate } from "./timer-delta.js";
import { setFlagBit } from "./event-flags.js";

// ─── Costanti layout ────────────────────────────────────────────────────────

/** WorkRam offset di `*0x401FFC` (long pointer alla struct base). */
const PTR_FFC_OFF = 0x1ffc;

/** Offset dal long-ptr alla base dei record: `A0 += 0x50`. */
const RECORD_BASE_PLUS = 0x50;

/** Indirizzo M68k assoluto dell'accumulatore punteggio (workRam). */
const SCORE_ACCUM_ADDR = 0x00401f92 as const;

/** WorkRam offset dell'accumulatore punteggio. */
const SCORE_ACCUM_OFF = SCORE_ACCUM_OFF_CALC();
function SCORE_ACCUM_OFF_CALC(): number { return SCORE_ACCUM_ADDR - 0x400000; }

/** Massimo valore cella (se count == 0 dopo ++, scrive 0xFF e setta flag). */
const CELL_WRAP_SENTINEL = 0xff;

/** Massimo A0 (col offset) clamped a 17 = 0x11. */
const COL_CLAMP_MAX = 0x11;

/** Costante moltiplicatore per divisore: 0x3C = 60. */
const DIVISOR_MUL = 0x3c;

/** Offset della soglia "accum >= 0xE10" per il wrap punteggio (3600 dec). */
const SCORE_WRAP_THRESHOLD = 0xe10;

/** Posizione "campo score" dentro un record: base[row*20+18..+19] (2 byte BE). */
const SCORE_FIELD_OFF = 0x12; // 18

/** Aggiustamento per `subi.w #0x12, D0w` → torna al row*20 base. */
const SCORE_FIELD_ADJ = 0x12;

/** divs.w #0xa per ricavare il "row-index" finale dal row*20 value. */
const ROW_INDEX_DIV = 0x0a;

/** Addendo +6 per setFlagBit (row*2 + 6 / row*2 + 7). */
const FLAG_BIT_OFFSET = 6;

// ─── Helpers ────────────────────────────────────────────────────────────────

function readU32(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

function writeU32(r: Uint8Array, off: number, v: number): void {
  const x = v >>> 0;
  r[off] = (x >>> 24) & 0xff;
  r[off + 1] = (x >>> 16) & 0xff;
  r[off + 2] = (x >>> 8) & 0xff;
  r[off + 3] = x & 0xff;
}

// ─── Subs injection types ───────────────────────────────────────────────────

/**
 * Signature del sound-command dispatcher (FUN_00004442 via A3).
 * Riceve `cmdIndex` (long) e `data` (long); ritorna long.
 */
export type SoundDispatch = (cmdIndex: number, data: number) => number;

/**
 * Signature del config-field fetch (FUN_000040D8 via D6/A5).
 * Riceve `state` e `fieldId` (long); ritorna long signed.
 */
export type FieldFetch40D8 = (state: GameState, fieldId: number) => number;

// ─── Subs container ─────────────────────────────────────────────────────────

/** Callback iniettabili per le JSR interne di FUN_004790. */
export interface ScoreTableUpdate4790Subs {
  /**
   * ROM raw byte @ 0x1006F (non mascherato). Il binario lo legge due volte:
   *   - prima read: `sign_ext & 7` → numRecords (local[-6])
   *   - seconda read: `(sign_ext >> 5) & 7` → col-offset threshold (local[-4])
   * Per il marble program = `0xE3`.
   */
  romByte1006F?: number;

  /**
   * ROM 4-byte lookup table @ 0x7974. Index = `(ROM[0x1006F]>>3) & 3`.
   * Il valore indexato è un byte che moltiplicato × 60 da il divisore locale
   * (local[-8]). Per il marble program, il byte tipicamente rilevante = 0x05
   * (→ divisore = 300).
   */
  romTable7974?: readonly [number, number, number, number];

  /**
   * Sound dispatcher (FUN_00004442 via A3). Default = no-op (ritorna 0).
   * Le chiamate avvengono via JSR (A3) con `pea cmdIndex` prima sul stack:
   *   - cmdIndex = 5 per score field 5 (A6+8 = arg1)
   *   - cmdIndex = 6 per score field 6 (A2+4)
   *   - cmdIndex = 7 per bonus field @ A6+18
   *   - cmdIndex = 8 per bonus field @ A6+1C
   *   - cmdIndex = 9 per bonus field @ A6+20
   */
  soundDispatch?: SoundDispatch;

  /**
   * Config-field fetch (FUN_000040D8 via D6). Non usato direttamente in
   * FUN_004790 (la funzione usa D6 solo come contenitore del ptr per le jsr
   * nel loop punteggio finale); lasciato per uniformità con il pattern del
   * progetto. Default = () => 0.
   */
  fieldFetch40D8?: FieldFetch40D8;
}

// ─── Implementazione ────────────────────────────────────────────────────────

/**
 * Elabora UNA entry timer-delta nella tabella score.
 *
 * Corrisponde al blocco 0x484E..0x496C (prima entry) e al blocco simmetrico
 * 0x497C..0x4AAA (seconda entry). La logica è identica; la differenza è che
 * la prima entry usa `arg1/D4` come score delta e la seconda usa `arg3/D3`.
 *
 * @param r          workRam
 * @param baseOff    offset workRam della base dei record (= *0x401FFC + 0x50 - 0x400000)
 * @param deltaVal   valore letto dalla cella dell'accumulatore (local[-16] / (A2))
 * @param scoreDelta arg score delta (D4 per prima, D3 per seconda entry)
 * @param divisorW   local[-8].word = tblByte * 60
 * @param colThresh  local[-4].word = (sign_ext(ROM[0x1006F]) >> 5) & 7
 * @param numRecW    local[-6].word = ROM[0x1006F] & 7 (numRecords)
 * @param rowCap     running-max row cap (D2 per prima, (A6+0x14) per seconda)
 * @param count1     { value: byte } local[-1] (mutato in-place)
 * @param flag2      { value: byte } local[-2] (mutato in-place)
 * @param setFlagFn  callback per setFlagBit (0x5236)
 * @returns          row index D5 (= (row*20 + 18 - 18) / 10 = row*2) usato per flag;
 *                   oppure -1 se entry saltata
 */
function processEntry(
  r: Uint8Array,
  state: GameState,
  baseOff: number,
  deltaVal: number,
  scoreDelta: number,
  divisorW: number,
  colThresh: number,
  numRecW: number,
  rowCap: number,
  count1: { value: number },
  flag2: { value: number },
  setFlagFn: (st: GameState, bit: number) => void,
): { rowPair: number; skipped: boolean } {
  const SKIP = { rowPair: 0, skipped: true };

  // tst.w (-0x6,A6) → numRecords; beq → skip
  if ((numRecW & 0xffff) === 0) return SKIP;

  // ── Calcola col offset (A0.w) ─────────────────────────────────────────
  // divu.w local[-8], D1 con D1 = deltaVal
  // Replica `divu.w` (unsigned 32-bit / 16-bit word → 16-bit quotient).
  let colA0 = 0;
  if (divisorW !== 0) {
    // divu.w: D1 / divisorW.w (unsigned)
    const quotD1 = Math.floor((deltaVal >>> 0) / (divisorW & 0xffff));
    // movea.w D1w, A0 → A0 = quotient word zero-ext
    const a0Quot = quotD1 & 0xffff;
    // cmpa.w (-0x4,A6), A0 → compare A0.w with colThresh.w
    // bcc: A0.w >= colThresh unsigned → A0 - colThresh; else A0 = 0
    if (a0Quot < (colThresh & 0xffff)) {
      colA0 = 0;
    } else {
      colA0 = (a0Quot - (colThresh & 0xffff)) & 0xffff;
    }
  }

  // Clamp colA0 a max 0x11 (17)
  // moveq 0x11,D0; cmp.w A0w,D0w; bcc ok else D7=0x11,A0=D7
  if (colA0 > COL_CLAMP_MAX) colA0 = COL_CLAMP_MAX;

  // ── Calcola row (D2) ──────────────────────────────────────────────────
  // cmp.l D2, numRecW → if numRecW > rowCap (unsigned) skip; else D2 = numRecW-1
  let rowD2 = rowCap >>> 0;
  const numRecU = numRecW & 0xffff;
  if (numRecU <= rowD2) {
    rowD2 = (numRecU - 1) & 0xffffffff;
  }

  // ── D5 = rowD2*20 + colA0 ────────────────────────────────────────────
  // asl.w #2, D5w → *4; save D0; asl.w #2 → *4 more (=*16); add D0 → *20; add A0
  const d5 = ((((rowD2 & 0xffff) * 20) & 0xffff) + colA0) & 0xffff;

  // ── addq.b #1, base[d5] ──────────────────────────────────────────────
  const cellOff = (baseOff + d5) | 0;
  const prev = (r[cellOff] ?? 0) & 0xff;
  const next = (prev + 1) & 0xff;
  r[cellOff] = next;
  // tst.b: if next == 0 → count wrapped → set 0xFF and raise flag2
  if (next === 0) {
    r[cellOff] = CELL_WRAP_SENTINEL;
    flag2.value = 1;
  }

  // ── count1++ ─────────────────────────────────────────────────────────
  count1.value = (count1.value + 1) & 0xff;

  // ── D5' = row*20 + 18 (score field offset) ───────────────────────────
  // move.w D5w, D0w; sub.w A0w, D0w → D5 - colA0 = row*20
  // addi.w #0x12, D0w → row*20 + 18
  const d5prime = ((d5 - colA0) + SCORE_FIELD_OFF) & 0xffff;

  // ── D4.w = (scoreDelta + 0x80) >> 8 (round-nearest of scoreDelta/256) ──
  // move.l D4,D0; addi.l #0x80,D0; lsr.l #0x8,D0; move.w D0w,D4w
  const scoreRounded = (((scoreDelta >>> 0) + 0x80) >>> 8) & 0xffff;

  // ── Leggi 2-byte BE score @ base + d5' e base + d5' + 1 ─────────────
  // base[d5'+1] → D1.b; base[d5'] → D2.b; D2 <<= 8; D1 |= D2
  const scoreOff = (baseOff + d5prime) | 0;
  const existHi = (r[scoreOff] ?? 0) & 0xff;
  const existLo = (r[scoreOff + 1] ?? 0) & 0xff;
  const existScore = ((existHi << 8) | existLo) >>> 0;

  // ── cmp.l D1, D0 → if D0 <= D1 (unsigned): skip write ───────────────
  // D0 = scoreRounded (long zero-ext from word), D1 = existScore (BE word)
  if ((scoreRounded >>> 0) > (existScore >>> 0)) {
    // Scrivi nuovo score: high byte = scoreRounded >> 8, low byte = scoreRounded & 0xFF
    // move.w D4w,D1w; lsr.w #8,D1w; move.b D1b,(base+d5')
    r[scoreOff] = (scoreRounded >>> 8) & 0xff;
    // move.b D4b,D1b; andi.b #-0x1,D1b; move.b D1b,(base+d5'+1)
    r[scoreOff + 1] = scoreRounded & 0xff;
  }

  // ── Calcola rowPair = (d5' - 0x12) / 10 = row*20 / 10 = row*2 ──────
  // move.w D5w,D0w; subi.w #0x12,D0w → D0 = row*20
  // ext.l D1; divs.w #0xa,D1 → D1.w = row*20 / 10 = row*2
  const rowBase = (d5prime - SCORE_FIELD_ADJ) & 0xffff;
  // divs.w #0xa: signed 32/16, replicated for small values (no overflow possible)
  const rowPair = Math.trunc(rowBase / ROW_INDEX_DIV) & 0xffff;

  // ── setFlagBit(rowPair + 6) e setFlagBit(rowPair + 7) ────────────────
  setFlagFn(state, (rowPair + FLAG_BIT_OFFSET) >>> 0);
  setFlagFn(state, (rowPair + FLAG_BIT_OFFSET + 1) >>> 0);

  return { rowPair, skipped: false };
}

/**
 * Replica bit-perfect di `FUN_00004790` — score-table update.
 *
 * Legge i due accumulatori del timer delta (via `timerDeltaAccumulate`),
 * inserisce i contributi nella tabella score @ `*0x401FFC + 0x50`, esegue
 * un decay pass su tutte le celle se si è verificato un overflow, e invia
 * i comandi sonori condizionali per i campi 5..9.
 *
 * @param state      GameState. Letture/scritture su workRam:
 *                   - 0x401FFC..0x1FFF (long ptr)
 *                   - ptr+0x50 .. ptr+0x50+numRec*20-1 (tabella score)
 *                   - 0x401F86..0x401F8B (due accumulatori timer delta)
 *                   - 0x401F92..0x401F95 (accumulatore punteggio totale)
 *                   - 0x401F5E..0x401F61 (status flag bitmap, via setFlagBit)
 * @param arg1       Score delta principale (D4, arg @ A6+8). Contribuisce
 *                   al campo 5 dello score.
 * @param arg2       Row-index cap (D2, arg @ A6+C). Usato come limite massimo
 *                   del row index nella tabella. Se numRecords > arg2 unsigned,
 *                   il cap diventa numRecords-1.
 * @param arg3       Score delta secondario (D3, arg @ A6+10). Contribuisce
 *                   al campo 6 dello score.
 * @param arg4       Running-max row cap (arg @ A6+14). Simile ad arg2 ma
 *                   usato per la seconda entry; aggiornato in-place dal
 *                   binario (il modulo TS legge solo il valore iniziale).
 * @param arg5       Bonus long per campo 7 (arg @ A6+18). Se != 0, viene
 *                   sommato al valore corrente del campo 7 e il dispatcher
 *                   sonoro viene chiamato con cmdIndex=7.
 * @param arg6       Bonus long per campo 8 (arg @ A6+1C). Come arg5 per 8.
 * @param arg7       Bonus long per campo 9 (arg @ A6+20). Come arg5 per 9.
 * @param subs       Callback iniettabili (ROM bytes, sound dispatcher, ecc.).
 *
 * @returns          void (D0 non significativo al caller nel binario: l'ultimo
 *                   `movem.l (SP)+,{...}; unlk; rts` non setta D0 esplicitamente).
 *
 * **Bit-perfect notes**:
 *
 * 1. `timerDeltaAccumulate(state, 0)` replica `clr.l -(SP); jsr 0x43D6`.
 *    Ritorna 0x401F86. I due long a (ret) e (ret+4) sono le accumulazioni
 *    "opzionali bit-0" e "opzionali bit-1". Dopo la lettura vengono azzerati
 *    (`clr.l (A2)` a 0x4852 e `clr.l (A2)` a 0x49AA).
 *
 * 2. `divisorW = sign_ext(ROM[0x7974 + idx]) * 0x3C` (word, può essere negativo
 *    per tblByte >= 0x80; in quel caso `mulu.w` opera sul low word e il
 *    risultato è comunque il prodotto unsigned 16-bit. In TS usiamo la stessa
 *    semantica: `(tblByte * 60) & 0xffff`).
 *
 * 3. Il decay pass scorre tutti i byte della tabella (numRecords × 20 celle)
 *    e fa `lsr.b #1` su ciascuno (right-shift logico byte, inserisce 0 in
 *    alto). L'ordine di scansione è: col 0..18 per ogni row 0..numRecords-1
 *    (outer = row in unità da 20 byte, inner = colonna 0..18).
 *
 * 4. I blocchi "score wrap" (@ 0x4B3E..0x4B88 e 0x4B89..0x4BC1) sommano
 *    `savedDelta` all'accumulatore @ 0x401F92, poi se >= 0xE10 (3600):
 *    divisione intera per 0xE10, incremento campo 5 via sound dispatcher,
 *    sottrazione del multiplo. Analogo per il secondo long (A2+4).
 *
 * 5. I bonus args 5..7 (@ A6+18..A6+20) sono sommati "on top" al valore
 *    corrente del campo (letto via fieldFetch40D8 se fornito, o via sound
 *    dispatcher (A5)) prima di passare a JSR (A3). Il binario usa:
 *    `pea cmdIdx; jsr D6(=40D8); D0=ret; addq +1; D0+bonus; pea sum; pea cmdIdx; jsr A3`.
 */
export function scoreTableUpdate4790(
  state: GameState,
  arg1: number,   // D4 = score delta principale
  arg2: number,   // D2 = row cap iniziale
  arg3: number,   // D3 = score delta secondario
  arg4: number,   // A6+14 = second row cap
  arg5: number,   // A6+18 = bonus field 7
  arg6: number,   // A6+1C = bonus field 8
  arg7: number,   // A6+20 = bonus field 9
  subs: ScoreTableUpdate4790Subs = {},
): void {
  const r = state.workRam;

  // ── Normalizza args a long unsigned ─────────────────────────────────────
  let d4 = arg1 >>> 0;     // score delta principale
  let d2 = arg2 >>> 0;     // row cap
  const d3 = arg3 >>> 0;   // score delta secondario
  const a6_14 = arg4 >>> 0;
  const a6_18 = arg5 >>> 0;
  const a6_1c = arg6 >>> 0;
  const a6_20 = arg7 >>> 0;

  // ── Leggi ROM bytes / tabella ────────────────────────────────────────────
  // move.b (0x1006F).l, (-0x5,A6)
  const romB = (subs.romByte1006F ?? 0xe3) & 0xff;
  const tbl7974: readonly [number, number, number, number] =
    subs.romTable7974 ?? [0x05, 0x05, 0x05, 0x05];

  // ── Calcola locali ───────────────────────────────────────────────────────
  // local[-6].word = sign_ext(romB) & 7 = romB & 7  (numRecords)
  // M68k: ext.w (sign byte→word) poi andi.w #7.
  // sign_ext byte: (romB & 0x80) ? (romB | 0xFFFFFF00) : romB → & 7 = romB & 7
  const numRecW = romB & 0x7; // 0..7

  // local[-7] = ROM[0x7974 + ((romB >> 3) & 3)]
  const tblIdx = (romB >>> 3) & 3;
  const tblByte = tbl7974[tblIdx]! & 0xff;

  // local[-8].word = sign_ext(tblByte) * 0x3C (mulu.w, word)
  // M68k: ext.w sign_ext(tblByte) → poi mulu.w #0x3C
  // sign_ext byte → word, poi mulu.w (unsigned word * imm) → 32-bit result
  // In pratica divisorW = ((tblByte as int8) * 60) & 0xffff
  // Usiamo int8 semantics:
  const tblByteSigned = (tblByte & 0x80) ? (tblByte - 0x100) : tblByte;
  const divisorW = (tblByteSigned * DIVISOR_MUL) & 0xffff;

  // local[-3] = romB (seconda lettura a 0x4818)
  // local[-4].word = (sign_ext(romB) >> 5) & 7  (asr.w #5, andi.w #7)
  // sign_ext byte romB → int16, asr 5 (arithmetic), & 7
  const romBSigned16 = (romB & 0x80) ? (romB | 0xff00) : romB;
  // arithmetic right shift 5 of 16-bit signed:
  const colThresh = ((romBSigned16 >> 5) & 0x7) & 0xffff; // 0..7

  // ── base = *0x401FFC + 0x50 (workRam offset) ─────────────────────────────
  const ptrFFC = readU32(r, PTR_FFC_OFF);
  const baseAbsAddr = (ptrFFC + RECORD_BASE_PLUS) >>> 0;
  const baseOff = (baseAbsAddr - 0x400000) | 0;

  // ── timerDeltaAccumulate(state, 0) → A2 = 0x401F86 ──────────────────────
  // clr.l -(SP); jsr 0x43D6; movea.l D0,A2
  const a2Abs = timerDeltaAccumulate(state, 0); // = 0x401F86
  const a2Off = a2Abs - 0x400000; // = 0x1F86

  // ── Locali mutabili ───────────────────────────────────────────────────────
  let count1 = 0; // local[-1]
  let flag2 = 0;  // local[-2]

  // ── Prima entry (A2 = 0x401F86) ──────────────────────────────────────────
  // move.l (A2), local[-10]; addq #4,SP; beq 0x496E
  const savedDelta1 = readU32(r, a2Off);
  if (savedDelta1 !== 0) {
    // addq.b #1,(-0x1,A6); clr.l (A2)
    count1 = (count1 + 1) & 0xff;
    writeU32(r, a2Off, 0);

    const c1 = { value: count1 };
    const f2 = { value: flag2 };
    processEntry(
      r, state, baseOff, savedDelta1, d4,
      divisorW, colThresh, numRecW, d2,
      c1, f2, setFlagBit,
    );
    count1 = c1.value;
    flag2 = f2.value;
  }

  // 0x496e: addq #4, A2 → A2 = 0x401F8A
  const a2bOff = a2Off + 4; // 0x1F8A

  // ── Seconda entry (A2+4 = 0x401F8A) ──────────────────────────────────────
  // tst.l (A2+4); beq 0x4AAC
  const nextVal = readU32(r, a2bOff);
  if (nextVal !== 0) {
    // addq.b #1,(-0x1,A6)
    count1 = (count1 + 1) & 0xff;

    // move.l (-0x10,A6),D7; add.l (A2),D7; move.l D7,(-0x10,A6)
    // (local[-16] accumulates; per la seconda entry si riusa savedDelta1 + nextVal)
    const savedDelta2 = (savedDelta1 + nextVal) >>> 0;

    // move.l (A2),D1; divu.w local[-8],D1; ...
    // clr.l (A2) (azzera A2+4)
    writeU32(r, a2bOff, 0);

    // Per la seconda entry il row cap viene da (A6+14) invece di D2
    // Il binario aggiorna (A6+14) allo stesso modo in cui aggiorna D2
    // nella prima entry: `if numRecW <= rowCap → rowCap = numRecW-1`
    let rowCapB = a6_14;
    if ((numRecW & 0xffff) <= (rowCapB >>> 0)) {
      rowCapB = ((numRecW - 1) & 0xffffffff) >>> 0;
    }

    const c1b = { value: count1 };
    const f2b = { value: flag2 };
    processEntry(
      r, state, baseOff, nextVal, d3,
      divisorW, colThresh, numRecW, rowCapB,
      c1b, f2b, setFlagBit,
    );
    count1 = c1b.value;
    flag2 = f2b.value;

    // ── Score wrap (0x4B3E..0x4B88): saved delta → accumulator campo 5 ───
    // move.l (-0x10,A6), D0; add.l D0, (0x401F92).l
    let scoreAccum1 = readU32(r, SCORE_ACCUM_OFF);
    scoreAccum1 = (scoreAccum1 + savedDelta2) >>> 0;
    writeU32(r, SCORE_ACCUM_OFF, scoreAccum1);

    // cmpi.l #0xE10, (0x401F92).l; bls skip_wrap_1
    if (scoreAccum1 > SCORE_WRAP_THRESHOLD) {
      // divu.w #0xE10, D1 → D1.w = quotient
      const wrapDiv = Math.floor(scoreAccum1 / SCORE_WRAP_THRESHOLD) & 0xffff;
      const d2w = wrapDiv;
      // pea 5; jsr D6(=40D8) → D0 = fieldFetch(5); D0+1+d2w; pea sum; pea 5; jsr A3
      const ff5 = subs.fieldFetch40D8
        ? (subs.fieldFetch40D8(state, 5) >>> 0)
        : 0;
      const sum5 = (ff5 + 1 + d2w) >>> 0;
      (subs.soundDispatch ?? (() => 0))(5, sum5);
      // mulu.w #0xE10, D0 → D0 = wrapDiv * 0xE10; sub.l D0, (0x401F92).l
      const subVal1 = (d2w * SCORE_WRAP_THRESHOLD) >>> 0;
      writeU32(r, SCORE_ACCUM_OFF, (scoreAccum1 - subVal1) >>> 0);
    }

    // ── Score wrap per A2+4 (0x4B89..0x4BC1): campo 6 ────────────────────
    // addq #4, A2; cmpi.l #0xE10, (A2); bls skip_wrap_2
    if (nextVal > SCORE_WRAP_THRESHOLD) {
      const wrapDiv2 = Math.floor(nextVal / SCORE_WRAP_THRESHOLD) & 0xffff;
      const ff6 = subs.fieldFetch40D8
        ? (subs.fieldFetch40D8(state, 6) >>> 0)
        : 0;
      const sum6 = (ff6 + 1 + wrapDiv2) >>> 0;
      (subs.soundDispatch ?? (() => 0))(6, sum6);
    }
  }

  // ── Decay pass (0x4AAC..0x4B12): se flag2 → dimezza ogni cella ──────────
  // tst.b (-0x2,A6); beq skip_decay
  if (flag2 !== 0) {
    // clr.w D3w (outer = 0)
    let outer = 0;
    const maxOuter = numRecW * 20; // (numRecW & 0xffff) × 20
    // Loop: while outer < numRecW*20 step 20
    //   inner 0..18: base[outer+inner] >>= 1 (lsr.b #1)
    //   outer += 20
    while (outer < maxOuter) {
      let inner = 0;
      while (inner <= 0x12) { // inner in 0..18
        const off = (baseOff + outer + inner) | 0;
        const b = (r[off] ?? 0) & 0xff;
        r[off] = b >>> 1; // lsr.b #1 (logical right shift byte)
        inner++;
      }
      outer += 0x14; // addi.w #0x14 (20 decimal)
    }

    // ── Calcola rowPair per il decay call ─────────────────────────────────
    // divu.w #0x14, D1 (con D1 = outer che ha raggiunto maxOuter - 20 prima della
    // fine del loop, ma il binario usa il valore finale di D3 dopo il loop).
    // Il binario incrementa D3 di 0x14 DOPO l'inner loop, poi controlla se
    // D3 < numRecW*0x14. Quando il loop finisce D3 = numRecW*20 = maxOuter.
    // divu.w #0x14, D1 con D1 = D3w (low word di D3 = maxOuter & 0xffff)
    // → quotient = maxOuter / 20 = numRecW (row count)
    const d3Loop = maxOuter & 0xffff;
    const rowPairDecay = Math.floor(d3Loop / 0x14) & 0xffff; // = numRecW

    // addq.l #6, D1 → arg = rowPairDecay + 6; jsr A4 (setFlagBit)
    setFlagBit(state, (rowPairDecay + FLAG_BIT_OFFSET) >>> 0);
    setFlagBit(state, (rowPairDecay + FLAG_BIT_OFFSET + 1) >>> 0);
  }

  // ── count1 check (0x4B14..0x4B3C) ────────────────────────────────────────
  // tst.b (-0x1,A6); beq skip_count1_dispatch
  if (count1 !== 0) {
    // move.b (-0x1,A6),D3b; ext.w D3w; addq.w #2,D3w → D3.w = count1 + 2
    const d3w = ((count1 & 0xff) + 2) & 0xffff;
    // moveq 0,D2; move.w D3w,D2w; move.l D2,-(SP); jsr D6(=40D8) → D0
    const retFf = subs.fieldFetch40D8
      ? (subs.fieldFetch40D8(state, d3w >>> 0) >>> 0)
      : 0;
    // addq.l #1,D1; (D1 = D0+1); addq.l #4,SP
    const d1 = (retFf + 1) >>> 0;
    // move.l D1,-(SP); moveq 0,D0; move.w D3w,D0w; move.l D0,-(SP); jsr A3
    (subs.soundDispatch ?? (() => 0))(d3w >>> 0, d1);
    // addq.l #8,SP
  }

  // ── Bonus fields 7, 8, 9 (0x4BC2..0x4C20) ────────────────────────────────
  // Ogni blocco: if arg != 0 → fetch via D6, +bonus, dispatch via A3
  const bonusArgs: ReadonlyArray<[number, number]> = [
    [7, a6_18],
    [8, a6_1c],
    [9, a6_20],
  ];
  for (const [cmdIdx, bonus] of bonusArgs) {
    if (bonus !== 0) {
      // pea cmdIdx; jsr D6(=40D8) → D0; D0 += bonus; pea sum; pea cmdIdx; jsr A3
      const ff = subs.fieldFetch40D8
        ? (subs.fieldFetch40D8(state, cmdIdx) >>> 0)
        : 0;
      const sum = (ff + bonus) >>> 0;
      (subs.soundDispatch ?? (() => 0))(cmdIdx, sum);
    }
  }

  // ── Epilogo: movem.l (SP)+,{D2..D7,A2..A5}; unlk; rts ──────────────────
  // D0 non viene impostato prima del rts → valore non definito per il caller.
  // La funzione non ritorna un valore significativo.
  void d4; void d2; // usati sopra tramite processEntry
}
