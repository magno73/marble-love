/**
 * hi-score-decode-41c8.ts — replica `FUN_000041C8` (198 byte) bit-perfect.
 *
 * Decodifica una entry della high-score table (10 righe da 5 byte) in un
 * buffer di lavoro a 0x401F7A:
 *   - 4 byte long: punteggio (24 bit BE, high byte = 0)
 *   - 3 byte ASCII: iniziali del giocatore (radix-40 unpack)
 *
 * Tabella sorgente: `*0x401FFC + 0x1E` (stessa zona usata da
 * `key-rank-lookup-4686` / FUN_4686 per il rank-search). Layout di una
 * entry da 5 byte:
 *   +0..+2  -> 24-bit BE score (byte[+0] = high)
 *   +3..+4  -> 16-bit BE word, packing radix-40 di 3 chars
 *
 * Il 16-bit word viene interpretato come `c0 * 1600 + c1 * 40 + c2` con
 * estrazione modulo 40 da LSB a MSB. I tre digit estratti vengono mappati a
 * ASCII e scritti in ordine BIG-ENDIAN nel buffer (digit "low" in byte +6,
 * digit "high" in byte +4 — vedi nota loop counter qui sotto).
 *
 * **Mapping radix-40 -> ASCII** (dal binario):
 *   - `digit == 0`     -> 0x20 (' ' space)
 *   - `1 <= digit <= 26`  -> digit + 0x40 (= 'A'..'Z')
 *   - `27 <= digit <= 39` -> digit + 0x15 (= '0'..'<')
 *
 * Il range "tail" (27..39) include numeri 0-9 e poi tre simboli (':' ';' '<'),
 * coerente con l'encoding radix-40 ATARI standard ma senza branch difensivo.
 *
 * **Disasm 0x41C8..0x428C** (198 byte / 0xC6):
 *
 *   0x41C8  movem.l {D5 D4 D3 D2},-(SP)         ; preserve D2,D3,D4,D5 (16 byte)
 *   0x41CC  move.l  (0x14,SP),D2                ; D2 = arg1 (record index)
 *   0x41D0  movea.l #0x401F7A,A1                ; A1 = output buffer (workRam)
 *   0x41D6  movea.l (0x00401FFC).l,A0           ; A0 = *0x401FFC (long ptr)
 *   0x41DC  moveq   #0x1E,D0
 *   0x41DE  adda.l  D0,A0                       ; A0 = ptr + 0x1E (table base)
 *   0x41E0  move.l  A0,D5                       ; D5 = table base (preserved)
 *   0x41E2  moveq   #0x9,D0
 *   0x41E4  cmp.l   D2,D0                       ; flags = 9 - arg1 (long)
 *   0x41E6  bcc.b   0x41EE                      ; bcc: 9 >= arg1 unsigned -> work
 *   0x41E8  moveq   #0x0,D0                     ; out-of-range: D0 = 0
 *   0x41EA  bra.w   0x4288                      ; -> epilogue (no buffer write)
 *
 *   0x41EE: movea.l D2,A0                        ; A0 = arg1 (long)
 *   0x41F0  asl.l   #0x2,D2                     ; D2 = arg1 * 4
 *   0x41F2  add.l   A0,D2                       ; D2 = arg1 * 5 (record byte off)
 *
 *   ; --- Read 24-bit BE score, store as long @ A1 (high byte = 0) ---
 *   0x41F4  move.l  D2,D0
 *   0x41F6  addq.l  #0x2,D0                     ; D0 = arg1*5 + 2
 *   0x41F8  movea.l D0,A0
 *   0x41FA  adda.l  D5,A0                       ; A0 = base + +2
 *   0x41FC  moveq   #0,D0
 *   0x41FE  move.b  (A0),D0b                    ; D0 = byte[+2] (zero-ext)
 *   0x4200  move.l  D2,D1
 *   0x4202  addq.l  #0x1,D1                     ; D1 = arg1*5 + 1
 *   0x4204  movea.l D1,A0
 *   0x4206  adda.l  D5,A0                       ; A0 = base + +1
 *   0x4208  moveq   #0,D3
 *   0x420A  move.b  (A0),D3b                    ; D3 = byte[+1]
 *   0x420C  lsl.l   #0x8,D3                     ; D3 = byte[+1] << 8
 *   0x420E  movea.l D2,A0
 *   0x4210  adda.l  D5,A0                       ; A0 = base + +0
 *   0x4212  moveq   #0,D4
 *   0x4214  move.b  (A0),D4b                    ; D4 = byte[+0]
 *   0x4216  moveq   #0x10,D1
 *   0x4218  lsl.l   D1,D4                       ; D4 = byte[+0] << 16
 *   0x421A  move.l  D4,D1                       ; D1 = byte[+0] << 16
 *   0x421C  add.l   D1,D3                       ; D3 = (b0<<16) | (b1<<8)
 *   0x421E  add.l   D3,D0                       ; D0 = b2 | (b1<<8) | (b0<<16)
 *   0x4220  move.l  D0,(A1)                     ; *A1 = score (4 byte BE, high=0)
 *
 *   ; --- Read 16-bit BE word @ +3 (radix-40 packed initials) ---
 *   0x4222  movea.l D2,A0
 *   0x4224  addq.l  #0x4,A0                     ; A0 = arg1*5 + 4
 *   0x4226  adda.l  D5,A0                       ; A0 = base + +4
 *   0x4228  moveq   #0,D3
 *   0x422A  move.b  (A0),D3b                    ; D3 = byte[+4] (low)
 *   0x422C  move.l  D2,D0
 *   0x422E  addq.l  #0x3,D0                     ; D0 = arg1*5 + 3
 *   0x4230  movea.l D0,A0
 *   0x4232  adda.l  D5,A0                       ; A0 = base + +3
 *   0x4234  moveq   #0,D0
 *   0x4236  move.b  (A0),D0b                    ; D0 = byte[+3]
 *   0x4238  lsl.w   #0x8,D0w                    ; D0.w = byte[+3] << 8
 *   0x423A  add.w   D0w,D3w                     ; D3.w = (b3<<8) | b4 (BE word)
 *
 *   ; --- Loop 3 iter: estrai 3 digit base-40, scrivi ASCII a A1+4..A1+6 ---
 *   0x423C  moveq   #0x2,D2                     ; D2 = 2 (loop counter, also write idx)
 *   0x423E: moveq   #0,D0
 *   0x4240  move.w  D3w,D0w                     ; D0 = D3.w (zero-ext)
 *   0x4242  divu.w  #0x28,D0                    ; D0.w = quot, swap.w = rem
 *   0x4246  swap    D0
 *   0x4248  andi.l  #0xFFFF,D0                  ; D0 = remainder (0..39)
 *   0x424E  move.w  D0w,D1w                     ; D1.w = remainder
 *   0x4250  bne.b   0x4256                      ; rem != 0 -> letter/digit branch
 *   0x4252  moveq   #0x20,D1                    ; rem == 0 -> D1 = 0x20 (' ')
 *   0x4254  bra.b   0x4266
 *   0x4256: moveq   #0x1A,D0
 *   0x4258  cmp.w   D1w,D0w                     ; flags = 0x1A - rem
 *   0x425A  bcc.b   0x4262                      ; bcc: 0x1A >= rem -> letter
 *   0x425C  addi.w  #0x15,D1w                   ; rem > 0x1A: D1 = rem + 0x15 (digit)
 *   0x4260  bra.b   0x4266
 *   0x4262: addi.w  #0x40,D1w                   ; rem <= 0x1A: D1 = rem + 0x40 (letter)
 *   0x4266: move.w  D2w,D0w                     ; D0 = loop counter (= write index)
 *   0x4268  lea     (0x4,A1),A0                 ; A0 = A1 + 4 (= 0x401F7E)
 *   0x426C  move.b  D1b,(0x0,A0,D0w*0x1)        ; *(A0 + D2) = D1.b (ASCII char)
 *   0x4270  moveq   #0,D0
 *   0x4272  move.w  D3w,D0w                     ; D0 = D3.w
 *   0x4274  divu.w  #0x28,D0                    ; D0.w = quot, hi.w = rem
 *   0x4278  andi.l  #0xFFFF,D0                  ; D0 = quotient only
 *   0x427E  move.w  D0w,D3w                     ; D3.w = quotient (next digit)
 *   0x4280  subq.w  #0x1,D2w
 *   0x4282  tst.w   D2w
 *   0x4284  bge.b   0x423E                      ; loop while D2.w >= 0 (signed)
 *
 *   0x4286  move.l  A1,D0                       ; D0 = A1 (return pointer)
 *   0x4288  movem.l (SP)+,{D2 D3 D4 D5}
 *   0x428C  rts
 *
 * **Modellazione bit-perfect**:
 *
 *   1. **Range check `bcc.b` su `cmp.l D2,D0` con D0=9**: il flag carry dopo
 *      `cmp` rappresenta `D0 < D2` unsigned. `bcc` = "branch if carry clear"
 *      = D0 >= D2 unsigned = 9 >= arg1 unsigned. Quindi arg1 in [0..9]
 *      unsigned passa al work-path; arg1 >= 10 (incluso negative sign-ext)
 *      -> early exit `D0 = 0`.
 *
 *   2. **`asl.l #2, D2; add.l A0, D2`**: D2 = (arg1 << 2) + arg1 = arg1 * 5
 *      (long, wrap a 32 bit ma per arg1 in [0..9] no overflow).
 *
 *   3. **24-bit BE score**: byte[+0] e' high (alti 16 bit), byte[+1] e' mid,
 *      byte[+2] e' low. Composizione: `(b0<<16) | (b1<<8) | b2` (long, high
 *      byte = 0 perche' b0 al massimo 0xFF e shift di 16 lascia bit 24..31
 *      a 0). Store come `move.l` BE @ A1 (4 byte: 0x00, b0, b1, b2).
 *
 *   4. **16-bit BE word @ +3**: `(b3<<8) | b4`, interpretato come radix-40
 *      packed: digit2 * 1600 + digit1 * 40 + digit0 (digit0 = LSB). Il loop
 *      estrae con divu.w #40 da basso (digit0 -> A1+6) ad alto (digit2 -> A1+4).
 *
 *   5. **`divu.w #0x28`**: divu.w divide D0 (32-bit) per word imm. Result
 *      basso 16 bit = quoziente, alto 16 bit = resto. Il pattern `swap +
 *      andi.l #0xFFFF` estrae il resto (high word -> low word), il pattern
 *      `andi.l #0xFFFF` direttamente estrae il quoziente. Per D3.w in
 *      [0..0xFFFF] e divisore 0x28 (40), quoziente max = 0xFFFF/40 = 1638
 *      (non overflowa la word: trap V su divu.w avviene solo per quotient
 *      > 0xFFFF, qui irrilevante).
 *
 *   6. **Loop counter D2.w**: parte da 2 long (sign-ext da byte 0x02 via
 *      moveq, high word = 0). `subq.w #1` decrementa solo la word,
 *      eventualmente a 0xFFFF (= -1 signed) terminando il `bge.b` (signed
 *      compare). Il store usa D0.w come index (`*(A0+D0w*1)`), quindi
 *      l'indice scritto e' 2, 1, 0. Il digit0 (LSB radix-40) finisce a +6,
 *      digit1 a +5, digit2 (MSB) a +4: ordine "BE-text" naturale.
 *
 *   7. **Mapping char**: rem == 0 -> 0x20 (space). Altrimenti, rem in
 *      [1..0x1A] -> rem + 0x40 (= 'A'..'Z'). rem in [0x1B..0x27] (27..39)
 *      -> rem + 0x15 (= 0x30..0x3C, cioe' '0'..'<'; 0..9 sono i primi 10).
 *      Per rem >= 40 il dividendo D3.w sarebbe > 0xFFFF (impossibile via
 *      divu.w #40), quindi unreachable. Il binario non ha clamp.
 *
 *   8. **Side effect su workRam**: writes 7 byte a 0x401F7A..0x401F80 in
 *      caso di arg1 valido (in [0..9]). Per arg1 invalido (>= 10): nessuna
 *      write (early exit prima del primo `move.l D0,(A1)`).
 *
 *   9. **Return value**: long unsigned 32-bit:
 *      - `0x00000000` se arg1 >= 10 (out-of-range, no write).
 *      - `0x00401F7A` se arg1 in [0..9] (puntatore al buffer scritto).
 *
 * **JSR interne**: nessuna. Funzione leaf, no stub injection necessaria.
 * **MMIO**: nessuna lettura/scrittura.
 *
 * **Stack layout** all'ingresso del corpo (dopo `movem.l` di 16 byte):
 *   SP+0x00..0x0F  saved D2,D3,D4,D5
 *   SP+0x10..0x13  return PC
 *   SP+0x14..0x17  arg1 long (record index)
 *
 * **Caller**: `thunk_FUN_000041C8` @ 0x1AE (jmp.l), chiamato 3 volte da
 * `FUN_00011FF8` (0x120C8, 0x120DC, 0x12018). Il caller passa un long
 * sign-ext'd da word.
 *
 * **Verifica bit-perfect** via `test-hi-score-decode-41c8-parity.ts` (500 casi).
 */

import type { GameState } from "./state.js";

/** WorkRam offset del long pointer @ 0x401FFC. */
const PTR_FFC_OFF = 0x1ffc;

/** Offset (byte) dal long-ptr alla testa della tabella high-score. */
export const TABLE_OFF_FROM_PTR = 0x1e as const;

/** Numero massimo di record validi (arg1 <= 9 -> 10 entry). */
export const MAX_INDEX = 9 as const;

/** Stride di un record (byte). */
export const RECORD_STRIDE = 5 as const;

/** Indirizzo M68k del buffer di output (workRam). */
export const OUTPUT_BUFFER_ADDR = 0x00401f7a as const;

/** Offset workRam del buffer di output. */
export const OUTPUT_BUFFER_OFF = OUTPUT_BUFFER_ADDR - 0x00400000;

/** Byte size totale del buffer scritto (4 byte score + 3 byte initials). */
export const OUTPUT_BUFFER_LEN = 7 as const;

/** Base radix-40 (numero di simboli supportati). */
const RADIX = 0x28; // 40

/** Numero di iterazioni del loop di unpack (= numero di chars in initials). */
const NUM_DIGITS = 3;

/** RAM base assoluta M68k. */
const WORK_RAM_BASE = 0x400000;

/** Limite superiore esclusivo workRam. */
const WORK_RAM_END = 0x402000;

/** Return code "index out of range" (`arg1 > 9` unsigned). M68k = 0x00000000. */
export const RET_INDEX_OOR = 0x00000000 as const;

/**
 * Read big-endian long da workRam @ offset (4 byte).
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
 * Read byte assoluto M68k da workRam. Indirizzi fuori workRam leggono 0
 * (semantica difensiva; il binario reale farebbe un bus access verso area
 * non mappata).
 */
function read8(workRam: Uint8Array, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

/**
 * Mapping radix-40 digit -> ASCII char (replica esatta del branch del binario).
 *
 *   digit == 0           -> 0x20 (' ')
 *   1 <= digit <= 0x1A   -> digit + 0x40 ('A'..'Z')
 *   0x1B <= digit <= 0x27 -> digit + 0x15 ('0'..'<')
 *
 * Per digit >= 40 il comportamento e' undefined nel binario (impossibile via
 * divu.w #40 con dividendo word valido); qui non clampiamo per evitare di
 * mascherare bug futuri.
 */
function radix40ToAscii(digit: number): number {
  // Replica bit-perfect del branch:
  //   bne.b 0x4256       (rem != 0 -> non-space)
  //   moveq #0x20,D1     (rem == 0 -> space)
  //   ...
  //   moveq #0x1A,D0; cmp.w D1w,D0w; bcc -> letter; addi.w #0x15 -> digit/symbol
  if (digit === 0) {
    return 0x20;
  }
  // bcc su `cmp.w D1w,D0w` con D0 = 0x1A: branch se 0x1A >= rem unsigned.
  // bcc -> letter path (+0x40). bcs (rem > 0x1A) -> digit/symbol path (+0x15).
  if (digit <= 0x1a) {
    return (digit + 0x40) & 0xff;
  }
  return (digit + 0x15) & 0xff;
}

/**
 * Replica bit-perfect di `FUN_000041C8` — high-score entry decode.
 *
 * Decodifica la i-esima entry della tabella high-score (10 × 5 byte) puntata
 * da `*0x401FFC + 0x1E` in un buffer a 7 byte all'indirizzo M68k 0x401F7A:
 *   - 4 byte long BE: score (24-bit, high byte = 0)
 *   - 3 byte ASCII: iniziali del giocatore (radix-40 unpack, MSB-first)
 *
 * @param state  GameState. Letture: workRam[0x1FFC..0x1FFF] (long ptr) +
 *               5 byte della entry @ ptrOff + 0x1E + arg1*5.
 *               Scritture: workRam[0x1F7A..0x1F80] (7 byte) se arg1 in [0..9].
 *
 * @param arg1   Record index (long M68k, sign-ext'd da word dal caller).
 *               Range valido [0..9] unsigned. Per `arg1 > 9` (incluso valori
 *               sign-ext negativi, che hanno bit 31 = 1 -> grandi unsigned)
 *               la funzione esce subito senza modificare workRam.
 *
 * @returns      D0 long unsigned 32-bit:
 *               - `0x00000000` se arg1 > 9 (out-of-range, no write).
 *               - `0x00401F7A` se arg1 in [0..9] (puntatore al buffer scritto).
 *
 * **Bit-perfect notes**: vedi disasm completo nell'header del file.
 */
export function hiScoreDecode41c8(state: GameState, arg1: number): number {
  const arg1l = arg1 >>> 0;

  // ── Range check: 9 >= arg1 unsigned (bcc su cmp.l). ──
  // arg1 negativo sign-ext -> bit 31 set -> grande unsigned -> > 9 -> OOR.
  if (arg1l > MAX_INDEX) {
    return RET_INDEX_OOR;
  }

  // ── A0 = *0x401FFC; D5 = A0 + 0x1E (table base). ──
  const ptr = readLongBE(state.workRam, PTR_FFC_OFF);
  const tableBase = (ptr + TABLE_OFF_FROM_PTR) >>> 0;

  // ── D2 = arg1 * 5 (record byte offset). ──
  // M68k: asl.l #2 (= *4), add A0 (= *5). arg1 in [0..9] -> D2 in [0..45].
  const recordOff = ((arg1l * RECORD_STRIDE) >>> 0);

  // ── Read 24-bit BE score @ base + recordOff..+2 ──
  const b0 = read8(state.workRam, (tableBase + recordOff) >>> 0);
  const b1 = read8(state.workRam, (tableBase + recordOff + 1) >>> 0);
  const b2 = read8(state.workRam, (tableBase + recordOff + 2) >>> 0);
  // M68k: D0 = b2 + (b1<<8) + (b0<<16). High byte = 0 (b0 max 0xFF).
  const scoreLong = (((b0 << 16) | (b1 << 8) | b2) >>> 0) & 0xffffff;

  // ── Read 16-bit BE word @ base + recordOff + 3 ──
  // M68k: D3.w = (byte[+3] << 8) | byte[+4]. High word D3 = 0.
  const b3 = read8(state.workRam, (tableBase + recordOff + 3) >>> 0);
  const b4 = read8(state.workRam, (tableBase + recordOff + 4) >>> 0);
  let packed = ((b3 << 8) | b4) & 0xffff;

  // ── Write score long BE @ A1 (= 0x401F7A..0x401F7D) ──
  // M68k: move.l D0,(A1) scrive 4 byte BE: high, mid-hi, mid-lo, lo.
  // High byte e' 0 (24-bit score), poi b0, b1, b2.
  state.workRam[OUTPUT_BUFFER_OFF + 0] = (scoreLong >>> 24) & 0xff;
  state.workRam[OUTPUT_BUFFER_OFF + 1] = (scoreLong >>> 16) & 0xff;
  state.workRam[OUTPUT_BUFFER_OFF + 2] = (scoreLong >>> 8) & 0xff;
  state.workRam[OUTPUT_BUFFER_OFF + 3] = scoreLong & 0xff;

  // ── Loop unpack radix-40: 3 digit, scritti BE (digit0 -> +6, digit2 -> +4) ──
  // M68k: D2 = 2 (loop counter / write index). Decremento word fino a -1.
  // Iter k (k = 2, 1, 0):
  //   rem = packed % 40       -> digit corrente (LSB)
  //   chr = ascii(rem)
  //   *(A1 + 4 + k) = chr     -> A1+4 = 0x401F7E. k=2 -> +6, k=1 -> +5, k=0 -> +4.
  //   packed = packed / 40    -> sposta al digit successivo
  for (let k = NUM_DIGITS - 1; k >= 0; k--) {
    const digit = packed % RADIX;
    const chr = radix40ToAscii(digit);
    state.workRam[OUTPUT_BUFFER_OFF + 4 + k] = chr & 0xff;
    packed = (packed / RADIX) | 0;
  }

  // ── D0 = A1 (= 0x00401F7A) ──
  return OUTPUT_BUFFER_ADDR;
}
