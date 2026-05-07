/**
 * object-charcode-broadcast-1bbaa.ts — replica `FUN_0001BBAA` (222 byte).
 *
 * "Object charcode broadcast under flag-gated, progress-gated dispatch":
 * scansiona l'array di object struct @ `0x400018` (stride `0xE2`, count
 * `*0x400396`); per ogni object con `state == 1`, `flag@0x1A == 0` e
 * `signedWord@0x6A ∈ [3,6]`, **se** il suo charcode `+0x1B` appare nella
 * char-list ROM (puntatore selezionato dal level-index globale `*0x400394`),
 * azzera il flag `*0x40076C` e marca **tutti** gli altri object con
 * `state == 1` settando `+0xCB = 1`. Esce subito se uno dei tre gate
 * iniziali fallisce (flag `*0x40076C == 0`, oppure progress `*0x400444 ≥
 * threshold ROM`, oppure char-list vuota = primo byte = 0xFF).
 *
 * **Disasm 0x1BBAA..0x1BC87** (222 byte). Annotato con etichette logiche.
 *
 *   ; --- prologo + 3 early-exit gate ---
 *   movem.l {A2,D3,D2},-(SP)             ; salva A2,D3,D2 (12 byte)
 *   move.w  (0x00400394).l, D0w          ; D0w = level index (word)
 *   asl.w   #2, D0w                      ; D0w *= 4 (long-sized index)
 *   movea.l #0x24aae, A0                 ; A0 = ROM ptr-table base
 *   movea.l (0x0,A0,D0w*0x1), A2         ; A2 = ROM long @ (0x24aae + index*4)
 *                                        ;       (puntatore alla char-list)
 *   tst.b   (0x0040076c).l               ; gate flag byte
 *   beq.w   exit                         ; se 0 → exit
 *   move.w  (0x00400394).l, D0w          ; ricarica index
 *   movea.l #0x24a94, A0                 ; A0 = ROM byte-table base
 *   move.b  (0x0,A0,D0w*0x1), D0b        ; D0b = ROM byte[index] (threshold)
 *   cmp.b   (0x00400444).l, D0b          ; cmp threshold con progress byte
 *   bls.w   exit                         ; se threshold (D0b) ≤ progress → exit
 *                                        ;       (BLS = unsigned <=)
 *   cmpi.b  #-1, (A2)                    ; primo byte char-list == 0xFF?
 *   beq.w   exit                         ; sì (lista vuota) → exit
 *
 *   ; --- outer loop su array obj @ 0x400018, count = *0x400396 ---
 *   movea.l #0x400018, A0                ; A0 = obj_iter (outer)
 *   clr.b   D2b                          ; D2.b = i_outer = 0
 *   bra.w   outer_test
 * outer_body:
 *   clr.b   D1b                          ; D1.b = match_flag = 0
 *   movea.l A2, A1                       ; A1 = char-list scan ptr
 * char_scan_loop:
 *   cmpi.b  #-1, (A1)                    ; *A1 == 0xFF (terminator)?
 *   beq.b   after_char_scan              ; sì → fine scan
 *   move.b  (0x1b, A0), D0b              ; D0b = obj.charcode (+0x1B)
 *   cmp.b   (A1)+, D0b                   ; cmp + post-incr A1
 *   bne.b   char_scan_loop               ; non match → continua
 *   moveq   #1, D1                       ; D1.l = 1 (match_flag)
 *   bra.b   char_scan_loop               ; comunque continua fino a 0xFF
 *                                        ;       (consuma tutta la lista)
 * after_char_scan:
 *   ; --- 3 filtri sull'object corrente ---
 *   cmpi.b  #1, (0x18, A0)               ; obj.state (+0x18) == 1?
 *   bne.w   outer_next                   ; no → skip
 *   tst.b   (0x1a, A0)                   ; obj.flag (+0x1A) == 0?
 *   bne.b   outer_next                   ; no → skip
 *   moveq   #7, D0
 *   cmp.w   (0x6a, A0), D0w              ; signed: 7 - obj.6a
 *   ble.b   outer_next                   ; 7 ≤ obj.6a → skip
 *   moveq   #2, D0
 *   cmp.w   (0x6a, A0), D0w              ; signed: 2 - obj.6a
 *   bge.b   outer_next                   ; 2 ≥ obj.6a → skip
 *                                        ; combo: obj.6a (signed) ∈ [3,6]
 *   tst.b   D1b                          ; match_flag set?
 *   beq.b   outer_next                   ; no → skip
 *
 *   ; --- broadcast block: trovato 1 object qualificato ---
 *   clr.b   (0x0040076c).l               ; *0x40076C = 0
 *   movea.l #0x400018, A1                ; A1 = obj_iter (inner)
 *   clr.b   D1b                          ; D1.b = j_inner = 0
 *   bra.b   inner_test
 * inner_body:
 *   cmpi.b  #1, (0x18, A1)               ; inner_obj.state == 1?
 *   bne.b   inner_next                   ; no → skip
 *   move.b  #1, (0xcb, A1)               ; inner_obj.flag (+0xCB) = 1
 * inner_next:
 *   move.l  A1, D3
 *   addi.l  #0xe2, D3                    ; A1 += 0xE2 (next inner obj)
 *   movea.l D3, A1
 *   addq.b  #1, D1b                      ; j++
 * inner_test:
 *   move.b  D1b, D0b                     ; D0b = j
 *   ext.w   D0w                          ; sign-extend a word
 *   cmp.w   (0x00400396).l, D0w          ; j == count?
 *   bne.b   inner_body                   ; no → loop body
 *
 * outer_next:
 *   move.l  A0, D3
 *   addi.l  #0xe2, D3                    ; A0 += 0xE2 (next outer obj)
 *   movea.l D3, A0
 *   addq.b  #1, D2b                      ; i++
 * outer_test:
 *   move.b  D2b, D0b
 *   ext.w   D0w
 *   cmp.w   (0x00400396).l, D0w          ; i == count?
 *   bne.w   outer_body                   ; no → outer body
 *
 * exit:
 *   movem.l (SP)+, {D2,D3,A2}            ; ripristina regs
 *   rts
 *
 * **Side effects diretti** in `state.workRam`:
 *   - `*0x40076C = 0` (1 byte) **se** trovato almeno 1 outer-obj qualificato
 *     con charcode in lista. Solo allora parte il broadcast inner.
 *   - per ogni inner-obj con `obj.state == 1`: `obj+0xCB = 1`.
 *     Notare: il broadcast inner viene rieseguito una volta per ogni outer
 *     match — operazione idempotente (assegnazione a 1, non incremento).
 *
 * **Letture esterne**:
 *   - ROM: `0x24a94 + idx` (byte threshold) e `0x24aae + idx*4` (long ptr)
 *     dove `idx = *0x400394 (word)`. Il long ptr punta a una sequenza
 *     `0xFF`-terminata di byte-charcodes nella ROM.
 *   - workRam: `*0x400394` (word, level idx), `*0x40076C` (byte, gate flag),
 *     `*0x400444` (byte, progress), `*0x400396` (word, object count).
 *   - obj fields: `+0x18` state, `+0x1A` filter flag, `+0x1B` charcode,
 *     `+0x6A` signed-word range, `+0xCB` (write only).
 *
 * **Edge case `count == 0`**: prima del outer body c'è `bra outer_test` →
 * primo cmp.w `0 == count(=0)` → equal → bne non preso → fall-through diretto
 * a `exit`. Quindi count=0 → no body. Coperto da `for (i=0; i<count; i++)`.
 * Identico ragionamento per inner (vedi `state-sub-15bd0.ts`).
 *
 * **Loop counter overflow**: D2/D1 sono byte counters sign-estesi a word per
 * il cmp con `*0x400396`. Per `count > 127` il loop avrebbe edge case (D0w
 * passa da 0x7F a 0xFF80 sign-extension), ma i call site reali hanno
 * count ≤ ~16 (PRD §6.2). Replicato fedelmente con `< count` JS che è
 * equivalente per count piccolo.
 *
 * **Char-list scan trick**: il binario continua il scan fino al terminator
 * 0xFF anche dopo aver trovato match (`bra.b char_scan_loop` invece di
 * `bra after_char_scan`). Effetto pratico: il match flag è "any-match"
 * (D1=1 se almeno uno matcha). Replicato 1:1 con `for` su byte-list.
 *
 * **Stride 0xE2**: identico a `state-sub-15bd0.ts` e a `OBJ_STRIDE` di
 * `state.ts` (Phase 4). NON re-importato — ridichiarato qui per autonomia.
 *
 * Verifica bit-perfect via `cli/src/test-object-charcode-broadcast-1bbaa-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants ───────────────────────────────────────────────────

/** ROM base della ptr-table indicizzata da `*0x400394 << 2` (long ptr). */
export const ROM_PTR_TABLE_BASE = 0x00024aae as const;
/** ROM base della byte-table indicizzata da `*0x400394` (threshold). */
export const ROM_BYTE_TABLE_BASE = 0x00024a94 as const;

/** WorkRam absolute address: word "level index". */
export const LEVEL_IDX_ADDR = 0x00400394 as const;
/** WorkRam absolute address: byte "gate flag" (cleared on match). */
export const GATE_FLAG_ADDR = 0x0040076c as const;
/** WorkRam absolute address: byte "progress" (cmp con threshold ROM). */
export const PROGRESS_ADDR = 0x00400444 as const;
/** WorkRam absolute address: word "object count" (loop limit). */
export const OBJ_COUNT_ADDR = 0x00400396 as const;

/** Base address dell'array di object struct (assoluto 0x400018). */
export const OBJ_BASE_ADDR = 0x00400018 as const;
/** Stride tra object struct adiacenti. */
export const OBJ_STRIDE = 0xe2 as const;

/** Object field offsets (relative to obj base). */
export const OBJ_STATE_OFF = 0x18 as const;
export const OBJ_FILTER_FLAG_OFF = 0x1a as const;
export const OBJ_CHARCODE_OFF = 0x1b as const;
export const OBJ_SIGNED_RANGE_OFF = 0x6a as const;
export const OBJ_BROADCAST_FLAG_OFF = 0xcb as const;

/** Char-list terminator byte. */
const TERMINATOR = 0xff;

/** WORK RAM base assoluta M68k. */
const WORK_RAM_BASE = 0x00400000;
/** Dimensione workRam (8 KB). */
const WORK_RAM_SIZE = 0x2000;

// ─── Implementation ──────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_0001BBAA` — object charcode broadcast.
 *
 * @param state  GameState. Side effects in `workRam`:
 *               - `[GATE_FLAG_ADDR - WORK_RAM_BASE] = 0` se almeno 1 outer
 *                 match (vedi disasm).
 *               - `[obj+0xCB]` = 1 per ogni inner-obj con `state == 1`,
 *                 ripetuto N volte (1 per outer match). Idempotente.
 * @param rom    RomImage per leggere `0x24a94 + idx` (threshold byte) e
 *               `0x24aae + idx*4` (ptr long → char-list `0xFF`-terminated).
 *
 * **Sequenza** (vedi disasm completo nel doc-comment del modulo):
 *   1. Carica `idx = *0x400394` (word). Calcola `listPtr = ROM long @
 *      0x24aae + idx*4`.
 *   2. Se `*0x40076C == 0` → exit.
 *   3. Carica `threshold = ROM byte @ 0x24a94 + idx`. Se
 *      `threshold (unsigned) ≤ *0x400444 (unsigned)` → exit.
 *   4. Se `*listPtr == 0xFF` (lista vuota) → exit.
 *   5. Scan outer loop su obj array, count = `*0x400396`. Per ogni obj:
 *      - Match charcode (+0x1B) contro la lista 0xFF-terminata da listPtr.
 *      - Se `obj.state == 1`, `obj.flag1A == 0`, `signedW(obj.6a) ∈ [3,6]`
 *        e `match_flag = 1`:
 *          - `*0x40076C = 0`.
 *          - Inner loop: per ogni inner-obj con `state == 1`:
 *              `inner_obj+0xCB = 1`.
 *
 * **Nessuna JSR** — la funzione è autocontenuta. Niente sub-injection.
 *
 * **Nessun valore di ritorno significativo**: l'rts del binario lascia in D0
 * residui dei `cmp.w`. Restituiamo `void`.
 */
export function objectCharcodeBroadcast1BBAA(
  state: GameState,
  rom: RomImage,
): void {
  const r = state.workRam;
  const prog = rom.program;

  // ─── Step 1: load idx, listPtr ──────────────────────────────────────
  const idxOff = LEVEL_IDX_ADDR - WORK_RAM_BASE;
  // word @ 0x400394 (big-endian, sign-irrelevant: usiamo come unsigned per
  // l'indexing, poi shift left 2 per il long-aligned access).
  const idxWord =
    (((r[idxOff] ?? 0) << 8) | (r[idxOff + 1] ?? 0)) & 0xffff;
  // asl.w #2 → su word low. Per idx che fitta in 14 bit, equivalente a
  // moltiplicazione *4 senza overflow. Per idx ≥ 0x4000 il shift produce
  // overflow word (bit alti scartati), ma l'indexing M68k usa il word
  // sign-extended come offset signed: per fedeltà replichiamo il sign-extension.
  const idxShifted = (idxWord << 2) & 0xffff;
  const idxShiftedSigned =
    idxShifted & 0x8000 ? idxShifted - 0x10000 : idxShifted;
  const ptrAddr = (ROM_PTR_TABLE_BASE + idxShiftedSigned) >>> 0;
  // long big-endian @ ptrAddr
  const listPtr =
    (((prog[ptrAddr] ?? 0) << 24) |
      ((prog[ptrAddr + 1] ?? 0) << 16) |
      ((prog[ptrAddr + 2] ?? 0) << 8) |
      (prog[ptrAddr + 3] ?? 0)) >>>
    0;

  // ─── Step 2: gate flag ──────────────────────────────────────────────
  const gateOff = GATE_FLAG_ADDR - WORK_RAM_BASE;
  if ((r[gateOff] ?? 0) === 0) return;

  // ─── Step 3: threshold cmp ──────────────────────────────────────────
  // Il binario rilegge *0x400394 (D0w sovrascritto). Riusiamo idxWord (la
  // RAM non è cambiata in mezzo).
  // Per indexing del byte-table con `(0,A0,D0w*1)` il M68k usa
  // sign-extended word come offset, ma per idx piccolo è equivalente a unsigned.
  const idxSignedW = idxWord & 0x8000 ? idxWord - 0x10000 : idxWord;
  const thresholdAddr = (ROM_BYTE_TABLE_BASE + idxSignedW) >>> 0;
  const thresholdByte = (prog[thresholdAddr] ?? 0) & 0xff;
  const progressByte = (r[PROGRESS_ADDR - WORK_RAM_BASE] ?? 0) & 0xff;
  // bls = unsigned <= → exit
  if (thresholdByte <= progressByte) return;

  // ─── Step 4: char-list non-empty ────────────────────────────────────
  // listPtr punta in ROM (per i call site reali). Per indirizzi fuori ROM
  // l'oracle Musashi legge bus → 0 (work RAM zero-init), quindi il
  // confronto può non essere 0xFF, ma in tal caso entriamo nel loop dove
  // potrebbe match-are byte casuali. Per parity bit-perfect leggiamo dalla
  // stessa sorgente del binary (ROM) via una helper.
  const firstByte = readByteAbs(state, rom, listPtr);
  if (firstByte === TERMINATOR) return;

  // ─── Step 5: outer loop ─────────────────────────────────────────────
  const countOff = OBJ_COUNT_ADDR - WORK_RAM_BASE;
  const count =
    (((r[countOff] ?? 0) << 8) | (r[countOff + 1] ?? 0)) & 0xffff;

  let outerObjAddr = OBJ_BASE_ADDR >>> 0;
  for (let i = 0; i < count; i++) {
    // 5a. Char-list scan (binario consuma fino a 0xFF anche post-match).
    let matchFlag = false;
    const charcode =
      r[(outerObjAddr + OBJ_CHARCODE_OFF - WORK_RAM_BASE) >>> 0] ?? 0;
    let scanPtr = listPtr >>> 0;
    while (true) {
      const lb = readByteAbs(state, rom, scanPtr);
      if (lb === TERMINATOR) break;
      if (lb === charcode) {
        matchFlag = true;
      }
      scanPtr = (scanPtr + 1) >>> 0;
    }

    // 5b. Filtri obj corrente.
    const stateByte =
      r[(outerObjAddr + OBJ_STATE_OFF - WORK_RAM_BASE) >>> 0] ?? 0;
    if (stateByte !== 1) {
      outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
      continue;
    }
    const filterByte =
      r[(outerObjAddr + OBJ_FILTER_FLAG_OFF - WORK_RAM_BASE) >>> 0] ?? 0;
    if (filterByte !== 0) {
      outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
      continue;
    }
    // signed-word @ +0x6A. Big-endian.
    const wOff = (outerObjAddr + OBJ_SIGNED_RANGE_OFF - WORK_RAM_BASE) >>> 0;
    const wU = (((r[wOff] ?? 0) << 8) | (r[wOff + 1] ?? 0)) & 0xffff;
    const wS = wU & 0x8000 ? wU - 0x10000 : wU;
    // moveq #7,D0; cmp.w (0x6a,A0),D0w; ble → 7 ≤ wS → skip
    if (7 <= wS) {
      outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
      continue;
    }
    // moveq #2,D0; cmp.w (0x6a,A0),D0w; bge → 2 ≥ wS → skip
    if (2 >= wS) {
      outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
      continue;
    }
    // tst.b D1; beq → match_flag == 0 → skip
    if (!matchFlag) {
      outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
      continue;
    }

    // 5c. Broadcast block.
    r[gateOff] = 0;
    let innerObjAddr = OBJ_BASE_ADDR >>> 0;
    for (let j = 0; j < count; j++) {
      const innerStateByte =
        r[(innerObjAddr + OBJ_STATE_OFF - WORK_RAM_BASE) >>> 0] ?? 0;
      if (innerStateByte === 1) {
        const flagOff =
          (innerObjAddr + OBJ_BROADCAST_FLAG_OFF - WORK_RAM_BASE) >>> 0;
        // L'address potrebbe cadere fuori workRam per object più alti — il
        // binario originale scriverebbe comunque sul bus. Per safety
        // (workRam è 0x2000 byte) controlliamo bound prima di scrivere.
        if (flagOff < WORK_RAM_SIZE) {
          r[flagOff] = 1;
        }
      }
      innerObjAddr = (innerObjAddr + OBJ_STRIDE) >>> 0;
    }

    outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
  }
}

/**
 * Helper bit-perfect: legge 1 byte all'indirizzo assoluto M68k. La regola:
 *   - 0x400000..0x401FFF → workRam (gli aggiornamenti recenti sono visibili).
 *   - 0x000000..0x087FFF → rom.program (program ROM + slapstic bank 0).
 *   - altrove → 0 (work zone non popolata; il binary su Musashi legge
 *     comunque da bus regions zero-init, comportamento equivalente).
 *
 * NOTA: la char-list nel binario reale punta sempre in ROM
 * (0x024a9a..0x024aaa nei call site noti), ma per robustezza supportiamo
 * sia ROM che workRam come sorgente del scan.
 */
function readByteAbs(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + WORK_RAM_SIZE) {
    return state.workRam[a - WORK_RAM_BASE] ?? 0;
  }
  if (a < rom.program.length) {
    return rom.program[a] ?? 0;
  }
  return 0;
}
