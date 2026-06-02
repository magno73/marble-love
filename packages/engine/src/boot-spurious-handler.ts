/**
 * Replica of `FUN_000100D8`, the 68010 spurious-IRQ boot path.
 *
 * The handler stores the incoming D0 byte at `0x40000E`, branches into the
 * boot-main path at `0x100B0`, runs audio/counter setup, and ends by jumping to
 * the main loop at `0x117B2`.
 *
 * **Disasm 0x100D8..0x100E0** (entry, 8 byte):
 *
 *   000100d8    move.b D0b,(0x0040000e).l   ; *0x40000E = D0.b (sentinel)
 *   000100de    bra.b  0x000100b0           ; boot main path
 *
 * **Disasm 0x100B0..0x100D8** (boot main, 40 byte):
 *
 *   000100b0    move.l SP,(0x00400440).l     ; *0x400440 = SP (save)
 *   000100b6    clr.w  (0x00840000).l        ; MMIO clear (no workRam)
 *   000100bc    move.w #-0x1,(0x004003b6).l  ; *0x4003B6 = 0xFFFF
 *   000100c4    move.w #0x80,(0x004003ae).l  ; *0x4003AE = 0x0080
 *   000100cc    jsr    0x000100e0.l          ; FUN_100E0: audio init + counters
 *   000100d2    jmp    0x000117b2.l          ; main loop (NO RTS)
 *
 * `FUN_100E0` calls `FUN_4D98` through thunk `FUN_254` with args
 * 0x0080/0x0000, then:
 *
 *   - *0x4003B6 += 1   (wraps from 0xFFFF to 0x0000)
 *   - *0x4003B2 = 0    (byte)
 *   - *0x4003B8 = 0x012C
 *
 *
 *   - *0x401F44 = 0x80   (byte: bset.l #7 of D0 = 0x0080)
 *   - *0x401F45 = 0      (byte clear)
 *   - *0x401F5A = 0      (long clear)
 *   - MMIO: *0x860000 = 0 then 0x0080; *0xFE0000 = 0 (no workRam)
 *
 *     D0 at dispatch time is caller-provided and otherwise indeterminate.
 *
 * Because the ROM jumps to `0x117B2`, parity tests either run until that PC or
 * patch the last instruction to `rts`.
 *
 * **Side effects** in `state.workRam`:
 *
 *   workRam[0x000E]      = d0In & 0xFF        (byte)
 *   workRam[0x0440..3]   = spLong (BE long)   (if supplied)
 *   workRam[0x03AE..F]   = 0x0080 (BE word)
 *   workRam[0x03B2]      = 0x00               (byte; FUN_100E0)
 *   workRam[0x03B6..7]   = 0x0000 (BE word)   (FFFF + 1, wrap)
 *   workRam[0x03B8..9]   = 0x012C (BE word)   (FUN_100E0)
 *   workRam[0x1F44]      = 0x80               (byte; FUN_4D98)
 *   workRam[0x1F45]      = 0x00               (byte; FUN_4D98)
 *   workRam[0x1F5A..D]   = 0x00000000 (long)  (FUN_4D98)
 *
 * MMIO writes (no workRam): 0x840000 (word=0), 0x860000 (word=0 then 0x80),
 *
 * The two external calls are injectable: `FUN_100E0` and the nested
 * `FUN_254 -> FUN_4D98` path.
 */

import type { GameState } from "./state.js";

/** Work RAM offsets relative to `0x400000`. */
export const BSH_SENTINEL_OFF = 0x000e; // *0x40000E
export const BSH_SP_SAVE_OFF = 0x0440; // *0x400440 (long)
export const BSH_AV_CONTROL_OFF = 0x03ae; // *0x4003AE (word)
export const BSH_FRAME_FLAG_OFF = 0x03b2; // *0x4003B2 (byte)
export const BSH_FRAME_CTR_OFF = 0x03b6; // *0x4003B6 (word)
export const BSH_COUNTDOWN_OFF = 0x03b8; // *0x4003B8 (word) = 300
export const BSH_AUDIO_BASE_OFF = 0x1f44; // *0x401F44 (byte)
export const BSH_AUDIO_FLAG_OFF = 0x1f45; // *0x401F45 (byte)
export const BSH_AUDIO_ACK_OFF = 0x1f5a; // *0x401F5A (long)

/** Stub injection for the two JSR paths reached by the handler. */
export interface BootSpuriousHandlerSubs {
  /**
   * Boot-main audio init. Defaults to `defaultAudioInit80`, which delegates to
   * `audioReset80`.
   */
  audioInit80?: (state: GameState, subs: BootSpuriousHandlerSubs) => void;

  /**
   * Audio mailbox reset. Defaults to `defaultAudioReset80`; MMIO writes are
   * intentionally omitted because they do not affect work RAM parity.
   */
  audioReset80?: (state: GameState) => void;
}

/**
 * Default `audioReset80`, mirroring `FUN_4D98` work RAM effects only.
 *
 *   D0 = 0x0080 (low word of first arg)
 *   bclr #7, D0 -> 0x0000
 *   write 0x0000 to MMIO 0x860000          (skip workRam)
 *   write arg2 (0x0000) to MMIO 0xFE0000   (skip workRam)
 *   bset #7, D0 -> 0x0080
 *   *(A1=0x401F44) = D0.b = 0x80
 *   *(A1+1=0x401F45) = 0
 *   *(A1+0x16=0x401F5A) = 0 (long)
 *   write 0x0080 to MMIO 0x860000          (skip workRam)
 */
function defaultAudioReset80(state: GameState): void {
  const r = state.workRam;
  r[BSH_AUDIO_BASE_OFF] = 0x80;
  r[BSH_AUDIO_FLAG_OFF] = 0x00;
  r[BSH_AUDIO_ACK_OFF] = 0x00;
  r[BSH_AUDIO_ACK_OFF + 1] = 0x00;
  r[BSH_AUDIO_ACK_OFF + 2] = 0x00;
  r[BSH_AUDIO_ACK_OFF + 3] = 0x00;
}

/**
 * Default `FUN_100E0` work RAM effects, delegating the nested audio reset.
 *
 *   moveq #0, D0
 *   move.l D0, -(SP)                    ; arg2 = 0
 *   move.l D0, -(SP)                    ; arg1 = 0x0080
 *   jsr 0x254 -> FUN_4D98(arg1=0x80, arg2=0x00)
 *   addq.l #8, SP                       ; pop
 *   addq.w #1, *0x4003B6                ; FFFF + 1 = 0x0000 (wrap)
 *   move.w #0x12C, *0x4003B8            ; = 300
 *   rts
 */
function defaultAudioInit80(
  state: GameState,
  subs: BootSpuriousHandlerSubs,
): void {
  const r = state.workRam;

  // jsr FUN_4D98 (via thunk FUN_254): reset audio mailbox base.
  const audioReset = subs.audioReset80 ?? defaultAudioReset80;
  audioReset(state);

  const ctr =
    (((r[BSH_FRAME_CTR_OFF] ?? 0) << 8) | (r[BSH_FRAME_CTR_OFF + 1] ?? 0)) &
    0xffff;
  const ctrNext = (ctr + 1) & 0xffff;
  r[BSH_FRAME_CTR_OFF] = (ctrNext >>> 8) & 0xff;
  r[BSH_FRAME_CTR_OFF + 1] = ctrNext & 0xff;

  // clr.b *0x4003B2
  r[BSH_FRAME_FLAG_OFF] = 0;

  // move.w #0x12C, *0x4003B8
  r[BSH_COUNTDOWN_OFF] = 0x01;
  r[BSH_COUNTDOWN_OFF + 1] = 0x2c;
}

/**
 * Mirrors `FUN_000100D8` through the final `jmp 0x117B2`.
 *
 *   1. *0x40000E = d0In & 0xFF                (sentinel)
 *   2. (bra a 0x100B0)
 *   3. *0x400440 = spLong (long, BE)          (if supplied)
 *   4. clr.w MMIO 0x840000                    (no workRam)
 *   5. *0x4003B6 = 0xFFFF
 *   6. *0x4003AE = 0x0080
 *
 * `spLong` is optional because the TypeScript test harness does not always
 * model the machine stack.
 */
export function bootSpuriousHandler(
  state: GameState,
  d0In: number,
  spLong: number | null = null,
  subs: BootSpuriousHandlerSubs = {},
): void {
  const r = state.workRam;

  // 1. move.b D0b, (0x0040000E).l
  r[BSH_SENTINEL_OFF] = d0In & 0xff;

  // 2. bra.b 0x100B0 (control flow only)

  // 3. move.l SP, (0x00400440).l
  if (spLong !== null) {
    const sp = spLong >>> 0;
    r[BSH_SP_SAVE_OFF] = (sp >>> 24) & 0xff;
    r[BSH_SP_SAVE_OFF + 1] = (sp >>> 16) & 0xff;
    r[BSH_SP_SAVE_OFF + 2] = (sp >>> 8) & 0xff;
    r[BSH_SP_SAVE_OFF + 3] = sp & 0xff;
  }

  // 4. clr.w (0x00840000).l: MMIO, no workRam.

  // 5. move.w #-1, (0x004003B6).l
  r[BSH_FRAME_CTR_OFF] = 0xff;
  r[BSH_FRAME_CTR_OFF + 1] = 0xff;

  // 6. move.w #0x80, (0x004003AE).l
  r[BSH_AV_CONTROL_OFF] = 0x00;
  r[BSH_AV_CONTROL_OFF + 1] = 0x80;

  // 7. jsr 0x100E0: audio init + counter setup, wraps 0x3B6.
  const audioInit = subs.audioInit80 ?? defaultAudioInit80;
  audioInit(state, subs);

  // 8. jmp 0x117B2: control flow only, no RTS.
}

// Re-export defaults for focused tests.
export const _defaults = {
  audioInit80: defaultAudioInit80,
  audioReset80: defaultAudioReset80,
};
