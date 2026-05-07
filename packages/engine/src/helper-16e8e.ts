/**
 * helper-16e8e.ts — replica bit-perfect di `FUN_00016E8E`.
 *
 * **Funzione**: cancella le righe dell'alpha tilemap da `arg & 0xFF`
 * (inclusa) fino a `0x1E` (esclusa). Per ogni riga chiama `getAlphaTileAddr`
 * (thunk 0x224 → FUN_37E4) con col=3, row=r, poi azzera 0x24 words (72 byte)
 * a partire dall'indirizzo restituito.
 *
 * **Disassembly completo** (FUN_00016E8E, 25 istruzioni):
 *
 *   00016e8e    move.l  D2,-(SP)           ; save D2
 *   00016e90    move.w  (0xa,SP),D0w       ; D0w = low word of arg
 *   00016e94    move.b  D0b,D2b            ; D2b = D0b (low byte = startRow)
 *   00016e96    bra.b   0x00016ebc         ; → loop condition
 *
 *   ; ── LOOP BODY ─────────────────────────────────────────────────────────
 *   00016e98    move.b  D2b,D0b            ; D0b = D2b
 *   00016e9a    ext.w   D0w                ; sign-extend byte → word
 *   00016e9c    ext.l   D0                 ; sign-extend word → long
 *   00016e9e    move.l  D0,-(SP)           ; push row (long) as arg
 *   00016ea0    pea     (0x3).w            ; push col=3 as arg
 *   00016ea4    jsr     0x00000224.l       ; → getAlphaTileAddr(col=3, row=D0)
 *   00016eaa    movea.l D0,A0              ; A0 = returned address
 *   00016eac    clr.b   D0b               ; D0b = 0 (inner counter)
 *   00016eae    addq.l  0x8,SP             ; pop 2 × 4 byte args
 *
 *   ; ── INNER LOOP (0x24 iterations) ──────────────────────────────────────
 *   00016eb0    clr.w   (A0)+              ; *(A0) = 0; A0 += 2
 *   00016eb2    addq.b  0x1,D0b            ; D0b++
 *   00016eb4    cmpi.b  #0x24,D0b          ; D0b == 36?
 *   00016eb8    bne.b   0x00016eb0         ; no → repeat inner
 *
 *   00016eba    addq.b  0x1,D2b            ; D2b++ (outer row counter)
 *
 *   ; ── LOOP CONDITION ────────────────────────────────────────────────────
 *   00016ebc    cmpi.b  #0x1e,D2b          ; D2b == 0x1E (30)?
 *   00016ec0    bne.b   0x00016e98         ; no → back to loop body
 *
 *   00016ec2    move.l  (SP)+,D2           ; restore D2
 *   00016ec4    rts
 *
 * **Argomento stack**: long pushed via `pea` or `move.l`:
 *   - `move.w (0xa,SP),D0w` → reads low word of the long at stack offset 10
 *     (= 4 bytes saved D2 + 4 bytes return addr + 2 byte word alignment pad).
 *     Effettivamente: low word → low byte usato come `startRow`.
 *
 * **Side effects**: azzera parole di `alphaRam` dall'indirizzo calcolato da
 *   `getAlphaTileAddr(col=3, row=r)` per ogni riga r in [startRow, 0x1E).
 *
 * **Nota**: l'inner loop esegue `clr.w (A0)+` — scrive 0 a word e avanza A0.
 *   Se A0 punta dentro alphaRam (0xA03000-0xA03FFF), le scritture finiscono in
 *   `state.alphaRam`. Scritture out-of-range vengono silenziate.
 *
 * **Callers**:
 *   - `FUN_00010504` @ `0x10E9C`: `pea (0x4).w` → startRow=4
 *   - `FUN_00016A20` @ `0x16C8A`: callers vari
 *   - `FUN_00016A20` @ `0x16DD0`: callers vari
 */

import type { GameState } from "./state.js";
import { getAlphaTileAddr } from "./alpha-tilemap.js";

export const HELPER_16E8E_ADDR = 0x00016e8e as const;

/** thunk 0x224 → FUN_37E4 address */
export const GET_ALPHA_TILE_ADDR_THUNK = 0x00000224 as const;

// ── Sub injection interface ───────────────────────────────────────────────────

export interface Helper16E8ESubs {
  /**
   * `FUN_37E4` via thunk `0x224` — calcola l'indirizzo alpha tile per
   * (col=3, row=r). Default: `getAlphaTileAddr(state, rom, col, row)`.
   *
   * Signature M68K: getAlphaTileAddr(col: number, row: number) → address.
   * Qui wrapped come TypeScript: (state, rom, col, row) → number.
   */
  getAlphaTileAddr?: (
    state: GameState,
    rom: { program: Uint8Array },
    col: number,
    row: number,
  ) => number;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00016E8E`.
 *
 * Cancella le righe dell'alpha tilemap da `arg & 0xFF` fino a `0x1E` (escl.).
 * Per ogni riga r:
 *  1. `addr = getAlphaTileAddr(col=3, row=r)` (via thunk 0x224)
 *  2. Scrive 0x24 word a zero da `addr` (= 72 byte)
 *
 * @param state   GameState — `alphaRam` viene azzerata nelle righe target.
 * @param rom     ROM image — richiesta da `getAlphaTileAddr` per la shift table @ 0x72A4.
 * @param arg     Long stack arg (il binario usa il low byte come startRow).
 * @param subs    Injection per la JSR non-replicata (default: usa `getAlphaTileAddr`).
 */
export function helper16E8E(
  state: GameState,
  rom: { program: Uint8Array },
  arg: number,
  subs: Helper16E8ESubs = {},
): void {
  // move.w (0xa,SP),D0w → low word of arg; move.b D0b,D2b → low byte
  let d2b = arg & 0xff;

  // bra → jump to condition check first (do-while equivalent)
  const addrFn = subs.getAlphaTileAddr ?? getAlphaTileAddr;

  // Loop condition check first (bra to 0x16ebc)
  while (d2b !== 0x1e) {
    // sign-extend D2b → D0 (ext.w; ext.l)
    const d0 = (d2b & 0x80) ? ((d2b & 0xff) - 0x100) : (d2b & 0xff);

    // jsr 0x224 with args: pea(3) on top, then D0 below
    // getAlphaTileAddr(col=3, row=d0)
    const a0 = addrFn(state, rom, 3, d0) >>> 0;

    // Inner loop: clr.w (A0)+ × 0x24
    const ALPHA_BASE = 0xa03000;
    const ALPHA_END = 0xa04000;
    let addr = a0;
    for (let d0b = 0; d0b < 0x24; d0b++) {
      if (addr >= ALPHA_BASE && addr + 1 < ALPHA_END) {
        const off = addr - ALPHA_BASE;
        state.alphaRam[off] = 0;
        state.alphaRam[off + 1] = 0;
      }
      addr = (addr + 2) >>> 0;
    }

    // addq.b 0x1,D2b — byte increment (wraps mod 256)
    d2b = (d2b + 1) & 0xff;
    // loop condition: cmpi.b #0x1e,D2b / bne back
  }
}
