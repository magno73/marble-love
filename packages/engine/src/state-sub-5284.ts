/**
 * state-sub-5284.ts — `FUN_00005284` replica (30 bytes) + helper `FUN_000052A2`.
 *
 * Busy-wait loop: invokes the sound chip writer, waits a short delay, pets
 * the watchdog, checks two long-BE status-flag bitmaps in work RAM, and
 *
 * **Disasm 0x5284..0x52A1** (30 byte):
 *
 *   0x5284  jsr    0x00004DCC.l       ; sound chip writer (FUN_4DCC). No args.
 *                                     ;   Side effect: addq.l #1,(0x00401FF8).l
 *                                     ;   Rest of the sub interacts with the chip
 *                                     ;   YM2151 via MMIO 0xF00001 — stub-injectabile.
 *   0x528A  move.l #0x1A0A,D0         ; D0 = 0x1A0A = 6666 (delay seed)
 *   0x5290  subq.l #1,D0              ; D0--
 *                                     ;   At exit: D0 == 0 (long).
 *   0x5294  move.w D0w,(0x00880000).l ; write 0 (word) al watchdog reset latch.
 *                                     ;   resetta il watchdog timer del System1
 *   0x529C  bne.b  0x5284             ; if D0 != 0 → loop back to 0x5284
 *   0x529E  bra.w  0x00004F38         ; tail-call FUN_4F38 (state machine entry)
 *
 * **FUN_000052A2** (10 byte, helper inline):
 *
 *   0x52A2  move.l (0x00401F76).l,D0  ; D0 = secondary flags long-BE
 *   0x52A8  or.l   (0x00401F5E).l,D0  ; D0 |= primary flags long-BE
 *   0x52AE  beq.b  0x52B2             ; if D0 == 0 -> fall through with D0=0, Z=1
 *   0x52B0  moveq  #1,D0              ; else D0=1
 *   0x52B2  rts                       ; Z flag reflects D0 (Z=1 iff D0==0)
 *
 *     (entry state must be zero, or the IRQ source must be
 *
 * **Side effects on workRam** ("ok" path = flags zero at check):
 *   - FUN_4DCC default: `*0x401FF8 += 1` (long-BE), wrap mod 2^32.
 *   - FUN_52A2: pure read.
 *
 * **Side effects su workRam** (path "loop" = flags non-zero al check):
 *   - Watchdog: N strobe.
 *
 * FUN_4F38 (entry point of the sound/EEPROM/init state machine). In the replica
 *
 *   3. **`bne.b 0x5284`**: branch al body (loop completo, riparte da jsr 4DCC).
 *      Test su Z flag dal D0 ritornato da FUN_52A2: D0=0 → exit, D0=1 → loop.
 *   4. **`bra.w 0x4F38`**: tail-call (no rts).
 *
 *
 * **Xrefs** (4 ref):
 *   - 0x50E8 in FUN_4F38: bra.w 0x5284 (path "init phase 1 done")
 *   - 0x51FC in FUN_4F38: bra.w 0x5284 (path "init phase 2 done")
 *   - 0x529C in FUN_5284: bne.b 0x5284 (self loop)
 */

import type { GameState } from "./state.js";

export const PRIMARY_FLAGS_ADDR = 0x00401f5e as const;

export const SECONDARY_FLAGS_ADDR = 0x00401f76 as const;

export const WATCHDOG_ADDR = 0x00880000 as const;

export const DELAY_LOOP_SEED = 0x1a0a as const;

/** workRam offset of long-BE `0x401FF8` (counter incremented by FUN_4DCC). */
const SND_TICK_COUNTER_OFF = 0x1ff8;

/** workRam offsets of the two checked long-BE flags (relative to base 0x400000). */
const PRIMARY_FLAGS_OFF = 0x1f5e;
const SECONDARY_FLAGS_OFF = 0x1f76;

/**
 */
export const DEFAULT_MAX_ITERATIONS = 1 as const;

/**
 */
export interface StateSub5284Subs {
  /**
   * `FUN_00004DCC` — sound chip writer. No args, no return.
   * Default: increments long-BE @ `0x401FF8` (mod 2^32).
   */
  fun_4dcc?: (state: GameState) => void;
  /**
   * `FUN_00004F38` — state machine head (tail-call target). No args, no return
   * il loop). Default: no-op.
   */
  fun_4f38?: (state: GameState) => void;
  /**
   */
  irq?: (state: GameState, iter: number) => void;
}

/**
 * Replica `FUN_000052A2` — status flags OR check.
 *
 *
 */
export function fun52A2(state: GameState): number {
  const r = state.workRam;
  const primary =
    (((r[PRIMARY_FLAGS_OFF] ?? 0) << 24) |
      ((r[PRIMARY_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[PRIMARY_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[PRIMARY_FLAGS_OFF + 3] ?? 0)) >>>
    0;
  const secondary =
    (((r[SECONDARY_FLAGS_OFF] ?? 0) << 24) |
      ((r[SECONDARY_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[SECONDARY_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[SECONDARY_FLAGS_OFF + 3] ?? 0)) >>>
    0;
  return (primary | secondary) === 0 ? 0 : 1;
}

/** Default impl di `FUN_4DCC`: replica `addq.l #1,(0x00401FF8).l` long-BE. */
function defaultFun4DCC(state: GameState): void {
  const r = state.workRam;
  let cnt =
    (((r[SND_TICK_COUNTER_OFF] ?? 0) << 24) |
      ((r[SND_TICK_COUNTER_OFF + 1] ?? 0) << 16) |
      ((r[SND_TICK_COUNTER_OFF + 2] ?? 0) << 8) |
      (r[SND_TICK_COUNTER_OFF + 3] ?? 0)) >>>
    0;
  cnt = (cnt + 1) >>> 0;
  r[SND_TICK_COUNTER_OFF] = (cnt >>> 24) & 0xff;
  r[SND_TICK_COUNTER_OFF + 1] = (cnt >>> 16) & 0xff;
  r[SND_TICK_COUNTER_OFF + 2] = (cnt >>> 8) & 0xff;
  r[SND_TICK_COUNTER_OFF + 3] = cnt & 0xff;
}

/**
 *
 *                    runs at least one iteration).
 */
export interface StateSub5284Result {
  iterations: number;
  flagsCleared: boolean;
}

/**
 * `FUN_00005284` replica — sound writer + watchdog pet + status flags wait
 *
 *   1. `fun_4dcc(state)` — sound chip writer (default: increments `0x401FF8`).
 *   4. `irq(state, iter)` hook (default no-op; lets tests clear flags to
 *      emulate a sound IRQ).
 *
 * @param state    GameState (workRam mutated by default `fun_4dcc`; flags
 * @param subs     Optional subs: `fun_4dcc`, `fun_4f38`, `irq`.
 *                 enter with flags=0 and one iter is enough; tests can raise
 *                 the cap to simulate the loop until `irq` clears it.
 *
 *                 deterministica).
 *
 */
export function stateSub5284(
  state: GameState,
  subs?: StateSub5284Subs,
  maxIter: number = DEFAULT_MAX_ITERATIONS,
): StateSub5284Result {
  const dccImpl = subs?.fun_4dcc ?? defaultFun4DCC;
  const f4f38 = subs?.fun_4f38;
  const irqHook = subs?.irq;

  const cap = maxIter < 1 ? 1 : maxIter | 0;

  let iter = 0;
  for (; iter < cap; iter++) {
    // 1. jsr 0x4DCC — sound chip writer.
    dccImpl(state);

    //    Lasciato esplicito per documentazione (DELAY_LOOP_SEED esportato).

    // 3. move.w D0w,(0x880000).l — watchdog strobe. No-op in TS (MMIO write

    if (irqHook !== undefined) {
      irqHook(state, iter);
    }

    // 4. bsr 0x52A2 — status check. If both flags are zero → exit the loop.
    if (fun52A2(state) === 0) {
      // 5. bra.w 0x4F38 — tail-call (modellato come callback).
      if (f4f38 !== undefined) {
        f4f38(state);
      }
      return { iterations: iter + 1, flagsCleared: true };
    }
    // bne.b 0x5284 — loop body again.
  }

  // raggiunto in produzione.
  return { iterations: iter, flagsCleared: false };
}
