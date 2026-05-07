/**
 * slot-match-12dae.ts — replica `FUN_00012DAE` (76 byte) bit-perfect.
 *
 * Funzione di "match con condizione alternativa" sulla tabella di slot
 * script in work RAM @ `0x400A9C`, stride `0x56`, 25 entries (`0x19`).
 *
 * Confrontata con la famiglia di `slotMatchesPtr_*` in `slot-search.ts`,
 * questa funzione ha una **seconda condizione di match** che le altre
 * varianti non hanno: se il long letto da `*(arg+2)` è 0, fa match anche
 * gli slot occupati con `byte+0x1F == 0x0C` (verosimilmente uno script
 * "type=0xC", forse il main script di partenza).
 *
 * **Disasm 0x12DAE..0x12DF8** (76 byte):
 *
 *   move.l  D2,-(SP)                   ; save D2
 *   movea.l (0x8,SP),A0                ; A0 = arg (script header ptr)
 *   clr.b   D2b                        ; D2 = 0 (return value, default no-match)
 *   movea.l #0x400a9c,A1               ; A1 = slot table base
 *   clr.b   D1b                        ; D1 = 0 (loop counter)
 * loop:
 *   cmpi.b  #0x1,(0x18,A1)             ; slot+0x18 == 1 (occupato)?
 *   bne.b   next
 *   move.l  (0x2,A0),D0                ; D0 = *(arg+2).l
 *   cmp.l   (0x3a,A1),D0               ; slot+0x3A == D0 ?
 *   beq.w   match
 *   tst.l   (0x2,A0)                   ; *(arg+2).l == 0 ?
 *   bne.b   next
 *   cmpi.b  #0xc,(0x1f,A1)             ; slot+0x1F == 0xC ?
 *   bne.b   next
 * match:
 *   moveq   #0x1,D2                    ; D2 = 1, esci dal loop
 *   bra.b   done
 * next:
 *   moveq   #0x56,D0
 *   adda.l  D0,A1                      ; A1 += 0x56 (stride)
 *   addq.b  #0x1,D1b
 *   cmpi.b  #0x19,D1b                  ; loop 25 volte
 *   bne.b   loop
 * done:
 *   move.b  D2b,D0b                    ; D0 = D2 (byte)
 *   ext.w   D0w                        ; sign-extend (D2 ∈ {0,1} → D0 = 0 o 1)
 *   ext.l   D0
 *   move.l  (SP)+,D2                   ; restore D2
 *   rts
 *
 * **Argomento (`argPtr`)**: long puntatore a uno script header. Solo il long a
 * `*(argPtr+2)` viene letto (il "key" da cercare nello slot). Se è 0, attiva
 * la matching path alternativa via `slot+0x1F == 0xC`.
 *
 * **Ritorno (D0)** — bit-perfect vs binario (sign-extension da byte):
 *   - 0 = nessuno slot fa match (nessuno occupato col target o type 0xC).
 *   - 1 = almeno uno slot fa match (ESCE al primo match → early-exit).
 *
 * **Side effects**: nessuno (read-only sulla work RAM).
 *
 * **Nota duplicato**: una replica equivalente esiste già come
 * `slotMatchesPtr_400A9C` in `slot-search.ts`, ma quella vive in un modulo
 * generico raggruppato con altre `slotMatchesPtr_*`. Questo modulo dedicato
 * isola FUN_12DAE come unità testabile a sé (smoke + parity 500/500) per
 * tracciabilità nel call-graph senza dover re-scaffoldare la family generica.
 */

import type { GameState } from "./state.js";

const WORK_RAM_BASE = 0x400000 as const;

/** Tabella slot script in work RAM. */
const SLOT_TABLE_BASE = 0x400a9c as const;

/** Stride del record slot. */
const SLOT_STRIDE = 0x56 as const;

/** Numero di slot scansionati. */
const SLOT_COUNT = 0x19 as const; // 25

/** Byte mark "occupato" letto a `slot+0x18`. */
const SLOT_OCCUPIED_BYTE_OFF = 0x18 as const;

/** Byte di tipo (cmpi.b #0xC) letto a `slot+0x1F`. */
const SLOT_TYPE_BYTE_OFF = 0x1f as const;

/** Long "script ptr" letto a `slot+0x3A` (confronto principale). */
const SLOT_SCRIPT_LONG_OFF = 0x3a as const;

/** Mark "occupato" atteso. */
const OCCUPIED_VALUE = 0x01 as const;

/** Type byte alternativo di match (sull'arg-zero path). */
const ALT_MATCH_TYPE = 0x0c as const;

/**
 * Legge un long big-endian dalla work RAM all'offset (rispetto a 0x400000).
 * Il binario fa `cmp.l (0x3a,A1),D0` che è un m68k long-fetch, quindi
 * big-endian.
 */
function readU32WorkRam(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

/**
 * Replica `FUN_00012DAE` — scan della tabella slot @ 0x400A9C.
 *
 * @param state   GameState (legge `state.workRam`).
 * @param argPtr  Long argument (puntatore a script header). La funzione legge
 *                solo il long a `*(argPtr+2)` (vedi disasm: `move.l (0x2,A0),D0`).
 *                Per default `argPtr` punta in work RAM (0x4xxxxx); se punta
 *                altrove (ROM, MMIO) il caller è responsabile della validità.
 * @returns       D0 al ritorno (sign-extended da D2.b ∈ {0,1}):
 *                - 0 = nessuno slot occupato fa match.
 *                - 1 = almeno uno slot fa match (early-exit al primo trovato).
 */
export function slotMatch12DAE(state: GameState, argPtr: number): number {
  // *(arg+2).l in m68k big-endian. argPtr è un VA (work RAM base 0x400000).
  const argOff = (argPtr - WORK_RAM_BASE) >>> 0;
  const target = readU32WorkRam(state, argOff + 2);

  // D2 = 0 (default no-match).
  let d2 = 0;

  // Scansione 25 entries, stride 0x56, partendo da 0x400A9C.
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = (SLOT_TABLE_BASE + i * SLOT_STRIDE) - WORK_RAM_BASE;

    // cmpi.b #0x1,(0x18,A1)
    const occupied = state.workRam[slotOff + SLOT_OCCUPIED_BYTE_OFF] ?? 0;
    if (occupied !== OCCUPIED_VALUE) continue;

    // cmp.l (0x3a,A1),D0 con D0 = *(arg+2).l
    const scriptLong = readU32WorkRam(state, slotOff + SLOT_SCRIPT_LONG_OFF);
    if (scriptLong === target) {
      d2 = 1;
      break;
    }

    // tst.l (0x2,A0): se target != 0 → next slot
    if (target !== 0) continue;

    // cmpi.b #0xC,(0x1f,A1): se slot+0x1F == 0xC → match
    const typeByte = state.workRam[slotOff + SLOT_TYPE_BYTE_OFF] ?? 0;
    if (typeByte === ALT_MATCH_TYPE) {
      d2 = 1;
      break;
    }
  }

  // move.b D2b,D0b; ext.w; ext.l → D2 ∈ {0,1} ⇒ D0 = 0 o 1 (no sign issues).
  return d2;
}
