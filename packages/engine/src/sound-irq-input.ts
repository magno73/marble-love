/**
 * sound-irq-input.ts — IRQ handler che campiona un byte MMIO e lo deposita
 * in un buffer circolare a 16 entries.
 *
 * Replica `FUN_00004D1A` (0x4D1A..0x4D67, 78 byte). È un IRQ handler
 * (probabile mailbox sound CPU su 0xFC0001) che:
 *
 *   1. Salva A1/A0/D0 sullo stack (irrilevante in TS).
 *   2. A1 = 0x401F44 (base struct mailbox).
 *   3. A0 = (long *)(A1+0x16) = LONG @ 0x401F5A. Lo chiamiamo `ackPtr`.
 *   4. Se ackPtr == 0 (nessun ack pending):
 *        - idx = (byte)*(A1+0x13) @ 0x401F57   (cyclic index 0..14)
 *        - A0 = A1 + 2 + idx                    @ 0x401F46+idx (entry buffer)
 *        - *(A1+0x13)++                         (post-increment)
 *        - se idx_pre == 0xF: *(A1+0x13) = 0    (wrap reset, valore già scritto è 0x10 → 0)
 *      Se ackPtr != 0 (ack pending: target esterno):
 *        - *(A1+0x16) (long) ++                 (avanza pointer di 1 byte)
 *        - *(A1+0x14) (byte) --                 (decrementa counter)
 *        - se counter==0: *(A1+0x16) = 0        (chiude la sequenza)
 *        - A0 rimane = ackPtr (pointer raw, NON ricaricato dopo l'inc)
 *   5. *(A0) = mmioByte                         (scrive il byte letto)
 *   6. RTE → return.
 *
 * Note bit-perfect:
 *  - Il campo `idx` è un BYTE, ma viene esteso a word con `ext.w` prima
 *    dell'indicizzazione. Il `cmpi.b #0xF, D0` confronta con il valore
 *    PRE-increment (D0 contiene il byte caricato prima dell'incremento di
 *    `(0x13,A1)`).  Quindi: dopo l'incremento, se idx_pre era 0xF, ora
 *    `(0x13,A1)` vale 0x10 → viene azzerato (wrap). Se idx_pre < 0xF,
 *    l'incremento normale porta a idx_pre+1.
 *  - Nel branch "ack pending", la scrittura `move.b mmio,(A0)` scrive a
 *    `ackPtr` (valore PRE-increment letto in A0), non a ackPtr+1. La long
 *    in RAM è già stata incrementata però.
 *  - L'offset `(0x14,A1) = 0x401F58` è un BYTE counter (subq.b), wrap a 256
 *    in caso di subq da 0 (passa a 0xFF).
 *
 * Side effects: aggiorna 0x401F46..0x401F55 (buffer 16 entries),
 * 0x401F57 (idx), 0x401F58 (counter), 0x401F5A..0x401F5D (long ackPtr),
 * più la scrittura del byte MMIO al puntatore corrente.
 */

import type { GameState } from "./state.js";

const A1_BASE = 0x1f44; // base struct mailbox (workRam offset)
const BUF_OFF = 0x1f46; // buffer 16-entry @ A1+2 .. A1+0x11
const IDX_OFF = 0x1f57; // byte cyclic index @ A1+0x13
const CNT_OFF = 0x1f58; // byte ack counter @ A1+0x14
const ACK_PTR_OFF = 0x1f5a; // long ack pointer @ A1+0x16

/**
 * Replica `FUN_00004D1A` — IRQ sound input mailbox.
 *
 * @param state  GameState (workRam viene mutato)
 * @param mmioByte  byte letto da MMIO 0xFC0001 (il chiamante deve fornirlo;
 *                  in IRQ reale è un read M68k diretto)
 *
 * Effetti collaterali (scritture):
 *  - workRam @ 0x1F46+idx (branch ack==0) o workRam-equivalente di ackPtr
 *    (branch ack!=0). Nel caso ackPtr punti FUORI da workRam (es. VRAM, MMIO,
 *    sprite RAM), questa funzione non può scriverlo: in quel caso il
 *    chiamante deve gestire la scrittura tramite `bus.write`.
 *    Per ora, se `ackPtr` è in range workRam (0x400000..0x401FFF) scriviamo
 *    nel workRam locale; altrimenti la scrittura viene IGNORATA (no-op
 *    visibile nel workRam — coerente con il bit-perfect test che pre-imposta
 *    `ackPtr` a un indirizzo workRam-safe).
 */
export function soundIrqInputTick(state: GameState, mmioByte: number): void {
  const r = state.workRam;

  // Carica long ackPtr @ 0x401F5A (big-endian, M68k).
  const ackPtr =
    (((r[ACK_PTR_OFF] ?? 0) << 24) |
      ((r[ACK_PTR_OFF + 1] ?? 0) << 16) |
      ((r[ACK_PTR_OFF + 2] ?? 0) << 8) |
      (r[ACK_PTR_OFF + 3] ?? 0)) >>>
    0;

  let writeAddr: number; // indirizzo assoluto M68k dove scrivere mmioByte

  if (ackPtr === 0) {
    // Branch A: nessun ack in corso → push nel buffer circolare a 16 entries.
    // M68k esegue `ext.w` sul byte (sign-extend), quindi idx>=0x80 punta
    // INDIETRO rispetto a A1+2 (es. 0xFF → A1+1 = 0x401F45).
    const idxPre = (r[IDX_OFF] ?? 0) & 0xff;
    const idxSigned = idxPre >= 0x80 ? idxPre - 0x100 : idxPre;
    writeAddr = (0x00400000 + A1_BASE + 2 + idxSigned) >>> 0;

    // post-increment idx (byte, wraps 0xFF→0)
    const idxNext = (idxPre + 1) & 0xff;

    // Confronto bcs su valore PRE-increment: se idxPre >= 0xF (≡ idxPre==0xF
    // dato che valori validi sono 0..0xF) → wrap a 0.
    // M68k: cmpi.b #0xF, D0; bcs => unsigned <. Quindi il wrap scatta quando
    // D0 (= idxPre) NON è < 0xF, cioè >= 0xF. Per byte 0..255 questo include
    // anche valori "rotti" >0xF (es. dopo init 0xFF), ma in regime stazionario
    // il counter è 0..0xF.
    if (idxPre < 0xf) {
      r[IDX_OFF] = idxNext;
    } else {
      // M68k: addq.b 1 ha già scritto idxNext; il branch `bcs` non scatta
      // (idxPre>=0xF) → clr.b azzera. Risultato netto: 0.
      r[IDX_OFF] = 0;
    }
  } else {
    // Branch B: ack in corso. Avanza pointer (long ++) e decrementa counter
    // (byte --). Nota: A0 in disasm rimane = ackPtr (PRE-incremento).
    writeAddr = ackPtr;

    const ackNext = (ackPtr + 1) >>> 0;
    r[ACK_PTR_OFF] = (ackNext >>> 24) & 0xff;
    r[ACK_PTR_OFF + 1] = (ackNext >>> 16) & 0xff;
    r[ACK_PTR_OFF + 2] = (ackNext >>> 8) & 0xff;
    r[ACK_PTR_OFF + 3] = ackNext & 0xff;

    const cntPre = (r[CNT_OFF] ?? 0) & 0xff;
    const cntNext = (cntPre - 1) & 0xff;
    r[CNT_OFF] = cntNext;

    // subq.b 1 → bne.w salta clr.l. Quindi il clr.l avviene quando cntNext==0.
    if (cntNext === 0) {
      r[ACK_PTR_OFF] = 0;
      r[ACK_PTR_OFF + 1] = 0;
      r[ACK_PTR_OFF + 2] = 0;
      r[ACK_PTR_OFF + 3] = 0;
    }
  }

  // Scrive mmioByte a writeAddr. Mappiamo solo il range workRam; gli altri
  // sono ignorati (vedi nota in jsdoc).
  if (writeAddr >= 0x00400000 && writeAddr < 0x00402000) {
    r[writeAddr - 0x00400000] = mmioByte & 0xff;
  }
}

// Esportazioni offset (utili per i test).
export const SND_IRQ_BUF_OFF = BUF_OFF;
export const SND_IRQ_IDX_OFF = IDX_OFF;
export const SND_IRQ_CNT_OFF = CNT_OFF;
export const SND_IRQ_ACK_PTR_OFF = ACK_PTR_OFF;
export const SND_IRQ_BASE_OFF = A1_BASE;
