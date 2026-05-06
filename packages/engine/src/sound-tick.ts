/**
 * sound-tick.ts — sound dispatcher wrapper.
 *
 * Replica `FUN_00004CA0` (sound dispatcher, chiamato da FUN_28788 via thunk
 * 0x15A). Si tratta del wrapper che gestisce il buffer di comandi sound
 * a 0x401F44 e dispatcha al motore sonoro vero e proprio (FUN_4DCC).
 *
 * **Wrapper logic** (4CA0..4D18):
 *   1. Legge byte cmd a 0x401F44 (D0)
 *   2. Se D0 < 0x40 (cmd valido pendente):
 *      a. Reset retry counter 0x401FF4 = 0
 *      b. Se 0x401F45 ha bit 7 set (last sent was pending):
 *           - Se cmd ≠ last sent: chiama FUN_3E1A((D0<<8)|D1) — STUB
 *      c. *0x401F45 = *0x401F44 | 0x80 (mark as sent)
 *   3. *0x401F44 |= 0x80 (mark as sent)
 *   4. Chiama FUN_4DCC (sound chip ops) — STUB
 *   5. Chiama FUN_4C3E con D0=0x10003, A0=0x401F44 — STUB
 *      Se ritorna 0:
 *        *0x401FF4++; se overflow (==0): *0x401FF4-- (saturate)
 *
 * Le sub-functions `fun_3e1a`, `fun_4dcc`, `fun_4c3e` sono stub iniettabili
 * via opts. Default no-op (FUN_4C3E ritorna 1 = "skip retry").
 *
 * **Side effect** sul wrapper: aggiorna 0x401F44, 0x401F45, 0x401FF4.
 */

import type { GameState } from "./state.js";

const SND_CMD_OFF = 0x1f44; // *0x401F44: current sound command byte
const SND_LAST_SENT_OFF = 0x1f45; // *0x401F45: last sent (bit 7 = pending)
const SND_RETRY_OFF = 0x1ff4; // *0x401FF4: retry counter (saturated)

export interface SoundTickSubs {
  /** FUN_3E1A: ack/dispatch send. arg long, no return. Default no-op. */
  fun_3e1a?: (argLong: number) => void;
  /** FUN_4DCC: sound chip writer. No args, no return. Default no-op. */
  fun_4dcc?: (state: GameState) => void;
  /**
   * FUN_4C3E: status check. Args D0=long, A0=ptr. Returns Z flag (0 = retry,
   * 1 = ok). Default ritorna 1 (no retry → skip retry counter).
   */
  fun_4c3e?: (state: GameState, d0: number, a0: number) => number;
}

/**
 * Replica `FUN_00004CA0` — sound dispatcher wrapper.
 *
 * Va chiamato dal mainTick al posto del vecchio STUB `// FUN_4CA0 (sound) — STUB`.
 */
export function soundTick(state: GameState, subs?: SoundTickSubs): void {
  const r = state.workRam;

  const d0 = r[SND_CMD_OFF] ?? 0;

  // if (D0 < 0x40): queue dispatch logic
  if (d0 < 0x40) {
    // Reset retry counter
    r[SND_RETRY_OFF] = 0;

    let d1 = r[SND_LAST_SENT_OFF] ?? 0;
    // bpl: if D1 bit 7 == 0, skip the dispatch
    if ((d1 & 0x80) !== 0) {
      d1 = d1 & 0x7f; // bclr.l #7, D1

      // if (D0 != D1): call FUN_3E1A((D0<<8) | D1)
      if (d0 !== d1) {
        const arg = ((d0 << 8) | d1) >>> 0;
        subs?.fun_3e1a?.(arg);
      }
    }

    // *0x401F45 = *0x401F44, then |= 0x80
    r[SND_LAST_SENT_OFF] = (r[SND_CMD_OFF] ?? 0) | 0x80;
  }

  // *0x401F44 |= 0x80
  r[SND_CMD_OFF] = (r[SND_CMD_OFF] ?? 0) | 0x80;

  // FUN_4DCC (sound chip writer) — sub
  subs?.fun_4dcc?.(state);

  // FUN_4C3E(D0=0x10003, A0=0x401F44) — sub
  // Default ritorna 1 (= ok, skip retry); se 0 incrementa retry counter saturato
  const status = subs?.fun_4c3e?.(state, 0x10003, 0x1f44) ?? 1;
  if (status === 0) {
    const retry = ((r[SND_RETRY_OFF] ?? 0) + 1) & 0xff;
    if (retry === 0) {
      // overflow: decrement back (saturated)
      r[SND_RETRY_OFF] = 0xff;
    } else {
      r[SND_RETRY_OFF] = retry;
    }
  }
}
