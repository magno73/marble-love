/**
 * mo-grid-init-2404.ts — replica `FUN_00002404` (100 byte, fino al `rts` @ 0x2466).
 *
 * Inizializzatore di un "bank" di Motion Object (sprite) RAM: scrive 56 slot
 * sprite con coordinate Y/X estratte da due tabelle ROM (@ 0x2468 e 0x24D8),
 * link-index sequenziali 1..56 e un campo "code" derivato da `arg1` + costante
 * ROM @ 0x1006A. Inoltre scrive una volta a MMIO AV-control (`*0x860000.w`).
 *
 * **Disasm 0x2404..0x2466** (100 byte / 0x64):
 *
 *   0x2404  movem.l {A2 D7 D6},-(SP)        ; preserve D6,D7,A2 (callee-saved)
 *   0x2408  lea    (0xA02000).l,A0           ; A0 = SPRITE_RAM_BASE
 *   0x240E  move.l (0x10,SP),D0              ; D0 = arg1 (long, SP+0x10 dopo
 *                                            ;   movem 12 byte + ret addr 4 byte = 16)
 *   0x2412  asl.l  #0x3,D0                   ; D0 = arg1 << 3
 *   0x2414  move.w D0w,(0x00860000).l        ; *MMIO_AV_CONTROL = (arg1<<3) word
 *   0x241A  asl.l  #0x6,D0                   ; D0 = arg1 << 9 (3+6 cumulati)
 *   0x241C  adda.l D0,A0                     ; A0 = SPRITE_RAM_BASE + (arg1<<9)
 *                                            ;   bank size = 0x200 byte = 64×4 word
 *                                            ;   arg1 ∈ {0..7} per stare in 4KB
 *   0x241E  move.w #0x37,D7w                 ; D7 = 55 (loop counter, dbf → 56 iter)
 *   0x2422  moveq  0x1,D1                    ; D1 = 1 (slot link index counter)
 *   0x2424  lea    (0x2468).l,A1             ; A1 = TABLE_Y_ADDR (56-word table)
 *   0x242A  lea    (0x24D8).l,A2             ; A2 = TABLE_X_ADDR (56-word table)
 *
 *   0x2430: loop_top:
 *   0x2430    move.l (0x10,SP),D0            ; D0 = arg1 (long, ricaricato fresco)
 *   0x2434    add.w  (0x0001006A).l,D0w      ; D0w += word ROM @ 0x1006A (=0x0002)
 *   0x243A    move.w D0w,(0x80,A0)           ; sprite[A0+0x80] = (arg1+ROM[1006A])w
 *                                            ;   campo "code/sprite-idx" del MO slot
 *   0x243E    move.w D7w,D6w                 ; D6 = D7 (table index, sarà *=2)
 *   0x2440    asl.w  #0x1,D6w                ; D6 = D7 * 2 (offset in byte)
 *   0x2442    move.w D1w,(0x180,A0)          ; sprite[A0+0x180] = D1 (link index)
 *   0x2446    addq.w 0x1,D1w                 ; D1++
 *   0x2448    move.w (0x0,A2,D6w*0x1),D0w    ; D0w = TABLE_X[D7] (X coord raw)
 *   0x244C    addi.w #0x10,D0w               ; D0w += 0x10
 *   0x2450    asl.w  #0x5,D0w                ; D0w <<= 5
 *   0x2452    move.w D0w,(0x100,A0)          ; sprite[A0+0x100] = (X+0x10)<<5
 *   0x2456    move.w (0x0,A1,D6w*0x1),D0w    ; D0w = TABLE_Y[D7] (Y coord raw)
 *   0x245A    asl.w  #0x5,D0w                ; D0w <<= 5
 *   0x245C    move.w D0w,(A0)+               ; sprite[A0] = Y<<5; A0 += 2
 *   0x245E    dbf    D7w,0x00002430          ; D7--; if D7 != -1 → loop
 *
 *   0x2462    movem.l (SP)+,{D6 D7 A2}       ; restore D6,D7,A2
 *   0x2466    rts
 *
 * **Layout MO bank** (`SPRITE_RAM_BASE + arg1 * 0x200`, 56 slot scritti):
 *   - `+0x000..0x06F` (56 word) : Y coord = (TABLE_Y[D7] << 5) & 0xFFFF
 *   - `+0x080..0x0EF` (56 word) : code/idx = (arg1 + ROM[0x1006A]) & 0xFFFF
 *   - `+0x100..0x16F` (56 word) : X coord = ((TABLE_X[D7] + 0x10) << 5) & 0xFFFF
 *   - `+0x180..0x1EF` (56 word) : link index = 1, 2, ..., 56
 *
 *   **Importante**: l'indice di tabella `D7` parte da 55 e decrementa a 0,
 *   mentre A0 incrementa di 2 ad ogni iterazione e D1 incrementa da 1.
 *   Quindi:
 *     iter i (1..56):
 *       slot_pos      = A0_initial + (i-1)*2  (Y/code/X scritti qui)
 *       table_index   = 56 - i                (Y, X letti dalle tabelle)
 *       link_index    = i
 *
 *   In altre parole, le tabelle Y/X sono lette **a ritroso** rispetto alla
 *   posizione in RAM. Per le tabelle correnti (tutte uniformi a blocchi di
 *   16) il risultato finale è simmetrico, ma la replica deve essere
 *   bit-perfect comunque.
 *
 * **Tabelle ROM** (immutabili, lette dal binario ad ogni call):
 *   - `0x2468..0x24D7` (TABLE_Y, 56 word BE):
 *       16× 0x00C8, 16× 0x00A0, 16× 0x0078, 8× 0x0050
 *     Dopo `<< 5`: 0x1900, 0x1400, 0x0F00, 0x0A00 — Y screen-coord (in HW pixel
 *     unit del MOKAM, 1 = 1/32 pixel), suddivisi per "row" 0..3.
 *   - `0x24D8..0x2547` (TABLE_X, 56 word BE):
 *       4× la sequenza [0x008, 0x018, 0x028, 0x038, 0x048, 0x058, 0x068, 0x078,
 *                       0x090, 0x0A0, 0x0B0, 0x0C0, 0x0D0, 0x0E0, 0x0F0, 0x100]
 *       (l'ultima riga è troncata a 8 elementi per arrivare a 56 totali)
 *     Dopo (`+0x10`) e `<< 5`: X screen-coord per ogni colonna 0..15 (con un
 *     gap a metà tra colonna 7 e 8, ~0x18 di gap invece di 0x10).
 *
 * **ROM[0x1006A].w** = 0x0002 nella ROM marble corrente (immutabile). Sommato
 *   ad arg1 forma il campo "code" del MO.
 *
 * **MMIO writes**:
 *   - `*0x860000.w = (arg1 << 3) & 0xFFFF` — UNA volta, prima del loop.
 *     Probabile selettore MOKAM bank o display-list pointer. Tracciato via
 *     callback `subs.onMmioWrite` opzionale.
 *
 * **Convenzione caller** (verificata @ 0x11B2):
 *   - arg1 (long, push first / SP+0x10 dopo movem 12 + ret 4 = 16) — pushed
 *     come `move.l (A0),-(SP)` dove `(A0) = *0x40000C.w sign-extended`. Poi
 *     `*0x40000C` viene incrementato. Quindi arg1 è un counter monotonico.
 *   - return D0 non significativo (nessun caller lo usa).
 *   - D6, D7, A2 callee-saved (preserved/restored da movem.l).
 *
 * **Side effects**:
 *   - `state.spriteRam[bank_off..bank_off+0x1EF]` (224 byte = 112 word) modificati.
 *   - MMIO 0x860000 (segnalato via `subs.onMmioWrite`).
 *   - Nessuna scrittura a workRam.
 *
 * **Modellazione bit-perfect** delle sottigliezze M68k:
 *
 *   1. **`asl.l #0x3,D0` / `asl.l #0x6,D0`**: shift su long. Se arg1 è grande,
 *      i bit alti possono "uscire" dal long. Il word write `move.w D0w,...`
 *      prende solo i 16 bit bassi.
 *
 *   2. **`move.w D0w,(0x00860000).l`** (MMIO AV-control): scrive solo 2 byte
 *      al MMIO, non riflesso in alcuna RAM. Tracciato via callback.
 *
 *   3. **`add.w (0x1006A).l,D0w`** (dentro loop): legge word BE da ROM e somma
 *      al low word di D0. Il D0 è freshly loaded a inizio iter, quindi
 *      D0w = (arg1 + ROM[0x1006A].w) & 0xFFFF wrap word.
 *
 *   4. **`asl.w #0x5,D0w`**: shift word di 5. I bit oltre il 16° vengono
 *      persi. JS `<<` masca a 5 bit count → OK con count=5 (`& 0xFFFF`).
 *
 *   5. **`move.w D0w,(A0)+`**: scrive 2 byte BE a A0, poi A0 += 2. La replica
 *      TS scrive `hi` e `lo` separatamente in `spriteRam[off]`/`[off+1]`.
 *
 *   6. **Indici tabella decrescenti**: D7 va 55→0, D6 = D7*2 va 0x6E→0x00.
 *      Le tabelle sono indexate `(0,A1,D6w*1)` cioè byte-offset = 2*D7 dato
 *      che ogni entry è word. Quindi index nella tabella = D7 dell'iter
 *      corrente. Per replicare devo iterare con `i = 0..55` e leggere
 *      table[55-i] mentre scrivo a slot[i].
 *
 *   7. **`dbf D7w,...`**: decrementa D7 word, branch se D7 != -1 (signed).
 *      Quindi 56 iter (D7 = 55, 54, ..., 1, 0, poi -1 → exit).
 *
 *   8. **D1 inizia a 1, incrementa post-uso**: link index dello slot N (1..56)
 *      è proprio N (matching `move.w D1w,(0x180,A0); addq.w #1,D1w`).
 *
 * Verifica bit-perfect via `packages/cli/src/test-mo-grid-init-2404-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Costanti / indirizzi ─────────────────────────────────────────────────

/** SPRITE_RAM_BASE assoluto M68k (`0xA02000`). */
export const SPRITE_RAM_BASE_ADDR = 0x00a02000 as const;

/** Indirizzo MMIO AV-control (`*0x860000.w`). */
export const MMIO_AV_CONTROL_ADDR = 0x00860000 as const;

/** Indirizzo della tabella Y in ROM (56 word BE @ 0x2468). */
export const TABLE_Y_ROM_ADDR = 0x00002468 as const;

/** Indirizzo della tabella X in ROM (56 word BE @ 0x24D8). */
export const TABLE_X_ROM_ADDR = 0x000024d8 as const;

/** Indirizzo della costante "code bias" in ROM (word BE @ 0x1006A). */
export const ROM_CODE_BIAS_ADDR = 0x0001006a as const;

/** Numero di slot scritti per call (D7 = 0x37 + 1 = 56). */
export const NUM_SLOTS = 56 as const;

/** Dimensione di un bank MO in byte (= 64 × 4 word = 0x200). */
export const MO_BANK_SIZE = 0x200 as const;

/** Offset interno del campo Y nello slot MO (relativo al bank). */
export const MO_FIELD_Y_OFF = 0x000 as const;
/** Offset interno del campo "code/idx" (`(arg1 + ROM[0x1006A]).w`). */
export const MO_FIELD_CODE_OFF = 0x080 as const;
/** Offset interno del campo X (`((TABLE_X[i] + 0x10) << 5).w`). */
export const MO_FIELD_X_OFF = 0x100 as const;
/** Offset interno del campo "link index" (1..56). */
export const MO_FIELD_LINK_OFF = 0x180 as const;

// ─── Stub injection ───────────────────────────────────────────────────────

/**
 * Stub injection per le scritture MMIO 0x860000 (non riflesse in spriteRam
 * né in workRam). La JSR-injection NON è necessaria: `FUN_00002404` non
 * effettua alcun `jsr`/`bsr`. È un loop self-contained.
 *
 * - `onMmioWrite(addr, valueWord)`: chiamata UNA volta per call con
 *   `addr = 0x860000` e `valueWord = (arg1 << 3) & 0xFFFF`.
 */
export interface MoGridInit2404Subs {
  /** Hook MMIO write @ 0x860000 (chiamato 1× per call). Default: no-op. */
  onMmioWrite?: (addr: number, valueWord: number) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Read big-endian 16-bit word da una Uint8Array a offset arbitrario. */
function readWordBE(buf: Uint8Array, off: number): number {
  const hi = buf[off] ?? 0;
  const lo = buf[off + 1] ?? 0;
  return ((hi << 8) | lo) & 0xffff;
}

/** Write big-endian 16-bit word in spriteRam a offset arbitrario (no-op se
 *  fuori bound). */
function writeWordBE(buf: Uint8Array, off: number, value: number): void {
  const v = value & 0xffff;
  if (off < 0 || off + 1 >= buf.length) return;
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

// ─── Funzione principale ──────────────────────────────────────────────────

/**
 * Replica `FUN_00002404` — Motion Object grid initializer.
 *
 * Inizializza 56 slot sprite nel bank `arg1` della MO RAM con coordinate
 * Y/X da tabelle ROM, link 1..56 e code = arg1 + ROM[0x1006A].
 *
 * @param state  GameState. Modificato: `state.spriteRam` (224 byte nel bank
 *               selezionato). `workRam` non modificato.
 * @param rom    RomImage. Solo letto: tabelle @ 0x2468, 0x24D8 e word @
 *               0x1006A.
 * @param arg1   Sprite-bank index (long). Tipicamente 0..7. La funzione lo
 *               tratta esattamente come il binario:
 *               - bank offset = `(arg1 << 9) & 0xFFFFFFFF` (long shift)
 *               - MMIO write   = `(arg1 << 3) & 0xFFFF`     (word di long)
 *               - code field   = `(arg1 + ROM[0x1006A].w) & 0xFFFF`
 *               Se il bank offset porta fuori dai 4 KB di spriteRam, gli slot
 *               che cadono fuori bound vengono semplicemente saltati (no-op).
 * @param subs   Stub injection opzionali (vedi {@link MoGridInit2404Subs}).
 *
 * @returns nulla (la funzione è void; il D0 a fine binario è "junk", non
 *          usato dai caller).
 *
 * **Bit-perfect notes** (vedi header del file per dettagli completi):
 *   - `arg1 << 9` come long shift: per arg1 ≥ `0x800000` può overfloware il
 *     32-bit. Lo replichiamo con `>>> 0`.
 *   - L'indice di tabella decresce da 55 a 0 mentre la posizione in RAM
 *     cresce da 0 a 0x6E (entrambi step 2). Per ogni `i` da 0 a 55:
 *       slot_offset    = bank_off + i*2
 *       table_index    = 55 - i
 *       link_index     = i + 1
 *   - Le tabelle ROM sono lette via `rom.program` BE-style.
 *   - L'unico jsr non c'è — la funzione è leaf.
 */
export function moGridInit2404(
  state: GameState,
  rom: RomImage,
  arg1: number,
  subs: MoGridInit2404Subs = {},
): void {
  const onMmio = subs.onMmioWrite;

  const arg1Long = arg1 >>> 0;

  // 1. MMIO AV-control = (arg1 << 3) word.
  //    M68k: `asl.l #0x3, D0; move.w D0w, (0x860000)`. Il word write prende
  //    i 16 bit bassi del long shift.
  const mmioVal = ((arg1Long << 3) >>> 0) & 0xffff;
  onMmio?.(MMIO_AV_CONTROL_ADDR, mmioVal);

  // 2. Bank offset = arg1 << 9 (cumulativo: <<3 poi <<6 = <<9 long).
  //    Convertito in offset locale di state.spriteRam (base = 0xA02000).
  const bankOffsetLong = ((arg1Long << 9) >>> 0) >>> 0;
  // L'address assoluto è SPRITE_RAM_BASE_ADDR + bankOffsetLong (long add wrap
  // a 32 bit). L'offset locale è bankOffsetLong direttamente (la base è
  // SPRITE_RAM_BASE_ADDR e state.spriteRam parte da 0).
  const bankOff = bankOffsetLong;

  // 3. Code bias (letto UNA volta dal binario? NO — letto AD OGNI ITER perché
  //    `add.w (0x1006A).l,D0w` è dentro il loop. Il valore è invariante per
  //    una ROM costante, quindi posso pre-leggerlo e cachare. Per fedeltà
  //    perfetta lo leggo 56 volte sotto, ma essendo pure-read deterministico
  //    da ROM è equivalente.).
  const codeBias = readWordBE(rom.program, ROM_CODE_BIAS_ADDR);

  // 4. Loop 56 iter. M68k iter 1..56 corrisponde a:
  //      slot_pos     = bank_off + (i-1)*2  (i=1..56)
  //      table_index  = 56 - i
  //      link_index   = i
  //    Riformulato come loop i=0..55 con TS-friendly indici:
  //      slot_pos     = bank_off + i*2
  //      table_index  = 55 - i
  //      link_index   = i + 1
  for (let i = 0; i < NUM_SLOTS; i++) {
    const slotPos = bankOff + i * 2;
    const tableIdx = NUM_SLOTS - 1 - i;
    const linkIdx = i + 1;

    // 4a. code/idx field @ +0x80
    //     M68k: D0 long = arg1; D0w += ROM[0x1006A].w; move.w D0w,(0x80,A0)
    //     Il word add wrap mod 0x10000 (i high bits di D0 restano arg1>>16).
    //     Il word write prende solo i 16 bit bassi.
    const codeWord = (arg1Long + codeBias) & 0xffff;
    writeWordBE(state.spriteRam, slotPos + MO_FIELD_CODE_OFF, codeWord);

    // 4b. link index field @ +0x180
    //     M68k: move.w D1w,(0x180,A0). D1 inizia a 1, +1 ad ogni iter.
    writeWordBE(
      state.spriteRam,
      slotPos + MO_FIELD_LINK_OFF,
      linkIdx & 0xffff,
    );

    // 4c. X coord field @ +0x100
    //     M68k: D0w = TABLE_X[tableIdx]; D0w += 0x10; D0w <<= 5; move.w D0w,(0x100,A0)
    //     TABLE_X word read è BE da ROM. (+0x10) e (<<5) operano word-wise
    //     con wrap mod 0x10000.
    const xRaw = readWordBE(rom.program, TABLE_X_ROM_ADDR + tableIdx * 2);
    const xCoord = (((xRaw + 0x10) & 0xffff) << 5) & 0xffff;
    writeWordBE(state.spriteRam, slotPos + MO_FIELD_X_OFF, xCoord);

    // 4d. Y coord field @ +0x000
    //     M68k: D0w = TABLE_Y[tableIdx]; D0w <<= 5; move.w D0w,(A0)+
    //     Il post-incremento di A0 è già gestito dall'avanzamento di slotPos.
    const yRaw = readWordBE(rom.program, TABLE_Y_ROM_ADDR + tableIdx * 2);
    const yCoord = (yRaw << 5) & 0xffff;
    writeWordBE(state.spriteRam, slotPos + MO_FIELD_Y_OFF, yCoord);
  }
}
