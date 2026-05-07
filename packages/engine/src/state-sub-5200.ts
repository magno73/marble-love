/**
 * state-sub-5200.ts — replica `FUN_00005200` (14 byte, 0x005200–0x00520E).
 *
 * Sub di clear buffer + OR flag. Chiamata da `FUN_00004F38` a 0x509C e 0x51F6.
 *
 * **Disasm 0x5200..0x520E** (14 byte):
 *
 *   0x5200  moveq  #0x13, D0              ; D0 = 0x00000013 (19)
 *   0x5202  clr.b  (0x1e,A2,D0w*1)        ; clear byte at A2 + 0x1e + signext(D0w)
 *   0x5206  dbra   D0w, 0x5202            ; decrement D0w; loop while D0w != −1
 *   0x520a  moveq  #0x0c, D1              ; D1 = 0x0000000c (bits 2,3)
 *   0x520c  bra.b  0x5248                 ; tail-call FUN_5248 → or.l D1,(0x401F5E).l; rts
 *
 * **Loop semantics (dbra / DBF)**:
 *   `dbra D0w, target`: D0w := D0w − 1; if D0w != −1 branch.
 *   D0w starts at 19. After body at D0w=19,18,...,0 → dbra decrements to −1 →
 *   exit. Total: 20 executions of the clr.b body.
 *   Index values used: D0w = 19,18,...,0. Offset from A2: 0x1e+19=0x31 down to
 *   0x1e+0=0x1e. Cleared range: **A2[0x1e..0x31]** (20 byte).
 *
 * **Tail-call via bra.b 0x5248** (`FUN_00005248`):
 *   `or.l D1,(0x00401f5e).l` → *0x401F5E |= 0x0000000c (sets bits 2,3)
 *   `rts`
 *
 * **Side effects (workRam)**:
 *   1. byte clear: A2[0x1e..0x31] (20 byte, tutti azzerati)
 *   2. long-BE OR: *0x401F5E |= 0x0000000c (bits 2, 3)
 *
 * **Convenzione caller (FUN_4F38)**:
 *   - `A2` = pointer assoluto in workRam (struct slot base).
 *   - Nessun argomento stack; D0/D1 sono clobbered.
 *   - Callers a 0x509C e 0x51F6 precedono o seguono le chiamate a FUN_520E
 *     (che opera su range disgiunti: 0..8, 0xe..0x12, 0x14..0x1d), quindi
 *     non vi è overlap con questo range (0x1e..0x31).
 *
 * **Note bit-perfect M68k**:
 *   1. `clr.b (0x1e,A2,D0w*1)`: index displacement con D0w sign-extended a long.
 *      Per D0w in 0..19 tutti positivi, nessun wrap (safe).
 *   2. `moveq #0x13, D0`: azzeramento dei 24 bit superiori; D0 = 0x00000013.
 *      `dbra` usa solo D0w (low 16 bit), ma dopo moveq D0w = 0x0013 comunque.
 *   3. `bra.b 0x5248`: salto incondizionato — nessun `rts` in FUN_5200 stesso;
 *      il ritorno al caller avviene tramite l'`rts` di FUN_5248.
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-5200-parity.ts`.
 *
 * **Xrefs** (2 call):
 *   - 0x509C in FUN_00004F38 (UNCONDITIONAL_CALL)
 *   - 0x51F6 in FUN_00004F38 (UNCONDITIONAL_CALL)
 */

import type { GameState } from "./state.js";
import { orFlags5248 } from "./or-flags-5248.js";

/** Base assoluta work RAM M68k. */
const WORK_RAM_BASE = 0x400000;

/** Offset (relativo ad A2) del primo byte clearato (= 0x1e + 0). */
export const CLEAR_OFFSET_START = 0x1e as const;

/** Offset (relativo ad A2) dell'ultimo byte clearato (= 0x1e + 0x13). */
export const CLEAR_OFFSET_END = 0x31 as const;

/** Numero di byte clearati (= 0x14 = 20). */
export const CLEAR_COUNT = 0x14 as const;

/** Maschera OR applicata a *0x401F5E (D1 = moveq #0x0c). Bits 2,3. */
export const OR_MASK = 0x0000000c as const;

/**
 * Replica `FUN_00005200` — buffer clear + status flags OR.
 *
 * @param state  GameState. workRam mutato in due zone:
 *               (1) A2[0x1e..0x31] (20 byte → zero);
 *               (2) long-BE @ 0x1F5E OR-ato con 0x0000000c.
 * @param a2     Pointer assoluto M68k (uint32). Deve puntare in workRam
 *               (0x400000..0x401FFF). I byte clearati sono all'offset
 *               0x1e..0x31 da a2.
 *
 * @returns void.
 */
export function stateSub5200(state: GameState, a2: number): void {
  const a2u = a2 >>> 0;
  const r = state.workRam;
  const a2Off = (a2u - WORK_RAM_BASE) >>> 0;

  // ── Fase 1: clear A2[0x1e..0x31] (20 byte) ─────────────────────────────
  // M68k: D0 = 0x13; body: clr.b (0x1e, A2, D0w*1); dbra D0w.
  // D0w = 19,18,...,0 → 20 esecuzioni. Byte @ A2+0x1e+D0w per ogni D0w.
  // Equivalente diretto: azzera 20 byte consecutivi da A2+0x1e a A2+0x31.
  for (let i = 0; i < CLEAR_COUNT; i++) {
    const off = a2Off + CLEAR_OFFSET_START + i;
    if (off < r.length) r[off] = 0;
  }

  // ── Fase 2: OR *0x401F5E con 0x0000000c ─────────────────────────────────
  // D1 = moveq #0x0c; bra 0x5248 → or.l D1,(0x401F5E).l; rts.
  // Delegato a orFlags5248 per parità con FUN_5248.
  orFlags5248(state, OR_MASK);
}
