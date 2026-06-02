/**
 * sync-av-toggle-1e08.ts — `FUN_00001E08` replica (54 bytes).
 *
 * Synchronization spin-loop: "AV-control toggle on event-flag pair, gated".
 * Synchronizes the video chip with the event bus.
 *
 * **Disasm 0x1E08..0x1E3D** (54 byte):
 *
 *   00001e08    move.l  D2,-(SP)             ; save D2
 * loop_top:
 *   00001e0a    jsr     FUN_00000F6A         ; D0.l = detectRisingEdgesAndPass()
 *   00001e10    move.w  D0w,D2w              ; D2.w = D0 low word (high nibble | rising)
 *   00001e12    jsr     FUN_00002548         ; D0 = consumeEventFlag()
 *   00001e18    tst.l   D0
 *   00001e1a    beq.b   0x00001e12           ; while D0 == 0: pop next bit
 *   00001e1c    clr.w   (0x00860000).l       ; MMIO AV-control = 0x0000
 *   00001e22    jsr     FUN_00002548         ; D0 = consumeEventFlag()
 *   00001e28    tst.l   D0
 *   00001e2a    beq.b   0x00001e22           ; while D0 == 0: pop next bit
 *   00001e2c    move.w  #0x80,(0x00860000).l ; MMIO AV-control = 0x0080
 *   00001e34    btst.l  #0,D2                ; bit 0 of D2 (= bit 0 of rising)
 *   00001e38    beq.b   0x00001e0a           ; if NOT set → restart outer loop
 *   00001e3a    move.l  (SP)+,D2             ; restore D2
 *   00001e3c    rts
 *
 *      D2.w takes high-nibble | rising-bits of the long returned.
 *      from point 1.
 *
 * here we use `iterations` as the safety cap).
 *
 *
 * **External JSRs** (2): FUN_F6A (`detectRisingEdgesAndPass` in
 * order to preserve coherent side effects on `*0x40017C` and `*0x400006`.
 *
 *
 * from an external IRQ/I/O. The TS replica requires an explicit `maxIterations`;
 *
 */

import type { GameState } from "./state.js";
import {
  consumeEventFlag,
  detectRisingEdgesAndPass,
} from "./event-flags.js";

/** Absolute AV-control MMIO (`*0x860000.w`). */
export const MMIO_AV_CONTROL_ADDR = 0x00860000 as const;

/** Default cap for `maxIterations` (enough for any smoke check). */
export const DEFAULT_MAX_ITERATIONS = 256 as const;

/**
 * Stub injection for MMIO 0x860000 writes (not reflected in workRam).
 *
 *
 */
export interface SyncAvToggle1E08Subs {
  /** Hook MMIO write @ 0x860000. Default: no-op. */
  onMmioWrite?: (addr: number, valueWord: number) => void;
  /**
   */
  maxIterations?: number;
  /**
   * Total cap for event-flag bit pops (internal). Defensive: if the queue
   */
  maxFlagPops?: number;
}

/**
 *
 *   `false` if it reached the `maxIterations` or `maxFlagPops` cap.
 * - `flagPops`: total `consumeEventFlag` pops for debugging and parity.
 */
export interface SyncAvToggle1E08Result {
  iterations: number;
  terminated: boolean;
  flagPops: number;
}

/**
 *
 * @param state         GameState. Mutated: `*0x40017C` (via FUN_F6A) and
 *                      `*0x400006` (via FUN_2548).
 * @param subs          optional stub injection (see {@link SyncAvToggle1E08Subs}).
 *
 * @returns `{ iterations, terminated, flagPops }` - see
 *          {@link SyncAvToggle1E08Result}.
 *
 * **Side effects** in `state.workRam`:
 *   - `*0x400006..7` (word, big-endian): shifted right once for each
 *     `consumeEventFlag` (see `flagPops`).
 *
 * **MMIO writes** (no workRam, reported via `subs.onMmioWrite`):
 */
export function syncAvToggle1E08(
  state: GameState,
  subs: SyncAvToggle1E08Subs = {},
): SyncAvToggle1E08Result {
  const maxIter = subs.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxPops = subs.maxFlagPops ?? 100_000;
  const onMmio = subs.onMmioWrite;

  let iterations = 0;
  let flagPops = 0;
  let terminated = false;

  // do { ... } while (bit0(D2) == 0): emulates `bne fall-through, beq loop_top`.
  // then jumps to `jsr FUN_F6A`.
  while (iterations < maxIter) {
    iterations++;

    // 1. jsr FUN_F6A → D0.l, D2.w = D0.w
    const d0Long = detectRisingEdgesAndPass(state) >>> 0;
    // move.w D0w, D2w → D2 low word = D0 low word.
    // (D2 saved upper, D0w lower): D0w bit 0 = rising-bits bit 0.
    // The high nibble lands in bits 12..15 and does not interfere with bit 0.
    const d2Word = d0Long & 0xffff;
    const bit0 = d2Word & 1;

    // 2. inner loop 1: pop until D0 == 1
    while (true) {
      if (flagPops >= maxPops) {
        return { iterations, terminated: false, flagPops };
      }
      const popped = consumeEventFlag(state);
      flagPops++;
      if (popped !== 0) break;
    }

    // 3. clr.w (0x00860000).l
    onMmio?.(MMIO_AV_CONTROL_ADDR, 0x0000);

    // 4. inner loop 2: pop until D0 == 1
    while (true) {
      if (flagPops >= maxPops) {
        return { iterations, terminated: false, flagPops };
      }
      const popped = consumeEventFlag(state);
      flagPops++;
      if (popped !== 0) break;
    }

    // 5. move.w #0x80, (0x00860000).l
    onMmio?.(MMIO_AV_CONTROL_ADDR, 0x0080);

    if (bit0 !== 0) {
      terminated = true;
      break;
    }
  }

  return { iterations, terminated, flagPops };
}
