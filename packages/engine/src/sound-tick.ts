/**
 * sound-tick.ts — sound dispatcher wrapper.
 *
 * Replica `FUN_00004CA0` (sound dispatcher, called by FUN_28788 via thunk
 * 0x15A). This wrapper manages the sound-command buffer at 0x401F44 and
 * dispatches to the sound engine proper (FUN_4DCC).
 *
 * **Wrapper logic** (4CA0..4D18):
 *   1. Reads command byte at 0x401F44 (D0)
 *   2. If D0 < 0x40 (valid pending command):
 *      a. Reset retry counter 0x401FF4 = 0
 *      b. Se 0x401F45 ha bit 7 set (last sent was pending):
 *           - If cmd != last sent: call FUN_3E1A((D0<<8)|D1)
 *      c. *0x401F45 = *0x401F44 | 0x80 (mark as sent)
 *   3. *0x401F44 |= 0x80 (mark as sent)
 *   4. Chiama FUN_4DCC (sound chip ops) — STUB
 *   5. Call FUN_4C3E with D0=0x10003, A0=0x401F44 — STUB
 *      If it returns 0:
 *        *0x401FF4++; if it overflows to 0, decrement back to saturate
 *
 * Sub-functions `fun_3e1a`, `fun_4dcc`, and `fun_4c3e` are injectable via
 * opts. Default no-op/status-ok behavior makes FUN_4C3E return 1 ("skip retry").
 *
 * **Wrapper side effects**: updates 0x401F44, 0x401F45, 0x401FF4.
 */

import type { GameState } from "./state.js";
import { notifySoundCmd as notifyGlobalSoundCmd } from "./sound-hook.js";

const SND_CMD_OFF = 0x1f44; // *0x401F44: current sound command byte
const SND_LAST_SENT_OFF = 0x1f45; // *0x401F45: last sent (bit 7 = pending)
const SND_RETRY_OFF = 0x1ff4; // *0x401FF4: retry counter (saturated)
const SND_TICK_COUNTER_OFF = 0x1ff8; // *0x401FF8: long counter (FUN_4DCC inc per call)

export interface SoundTickSubs {
  /** FUN_3E1A: ack/dispatch send. arg long, no return. Default no-op. */
  fun_3e1a?: (argLong: number) => void;
  /** FUN_4DCC: sound chip writer. No args, no return. Default no-op. */
  fun_4dcc?: (state: GameState) => void;
  /**
   * FUN_4C3E: status check. Args D0=long, A0=ptr. Returns Z flag (0 = retry,
   * 1 = ok). Default returns 1 (no retry -> skip retry counter).
   */
  fun_4c3e?: (state: GameState, d0: number, a0: number) => number;
}

/**
 * Replica `FUN_00004CA0` - sound dispatcher wrapper.
 *
 * Called by mainTick in place of the old `FUN_4CA0 (sound)` stub.
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
        // Chip path: notify the global hook with the current command byte so
        // SoundChip receives it through the mailbox.
        notifyGlobalSoundCmd(d0 & 0xff);
      }
    }

    // *0x401F45 = *0x401F44, then |= 0x80
    r[SND_LAST_SENT_OFF] = (r[SND_CMD_OFF] ?? 0) | 0x80;
  }

  // *0x401F44 |= 0x80
  r[SND_CMD_OFF] = (r[SND_CMD_OFF] ?? 0) | 0x80;

  // FUN_4DCC sound-chip writer. Default behavior increments the long counter at
  // 0x401FF8, the first deterministic instruction in FUN_4DCC. The real chip
  // interaction is handled by the dedicated sound CPU/chip path or by custom
  // subs in tests.
  if (subs?.fun_4dcc !== undefined) {
    subs.fun_4dcc(state);
  } else {
    let cnt =
      ((r[SND_TICK_COUNTER_OFF] ?? 0) << 24) |
      ((r[SND_TICK_COUNTER_OFF + 1] ?? 0) << 16) |
      ((r[SND_TICK_COUNTER_OFF + 2] ?? 0) << 8) |
      (r[SND_TICK_COUNTER_OFF + 3] ?? 0);
    cnt = (cnt + 1) >>> 0;
    r[SND_TICK_COUNTER_OFF] = (cnt >>> 24) & 0xff;
    r[SND_TICK_COUNTER_OFF + 1] = (cnt >>> 16) & 0xff;
    r[SND_TICK_COUNTER_OFF + 2] = (cnt >>> 8) & 0xff;
    r[SND_TICK_COUNTER_OFF + 3] = cnt & 0xff;
    // Simulate the sound-CPU M6502 ack: in MAME the sound CPU reads mailbox
    // *0x401F44 within the same frame and writes 0x00, so frame-done dumps see 0.
    // Without this, the 68k bset #7 leaves 0x80 and diverges from the oracle.
    r[SND_CMD_OFF] = 0;
  }

  // FUN_4C3E(D0=0x10003, A0=0x401F44) — sub
  // Default returns 1 (= ok, skip retry); 0 increments the saturated retry counter.
  // A0 must be the ABSOLUTE work-RAM address 0x401F44: soundStatusCheck subtracts
  // WORK_RAM_BASE (0x400000) to index workRam. Passing the relative 0x1F44 here
  // underflowed to an out-of-bounds slot, so the slot/retry logic never engaged.
  const status = subs?.fun_4c3e?.(state, 0x10003, 0x401f44) ?? 1;
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
