/**
 * boot-spurious-handler.test.ts — smoke + corner cases of bootSpuriousHandler.
 *
 * `cli/src/test-boot-spurious-handler-parity.ts`.
 */

import { describe, it, expect } from "vitest";

import {
  bootSpuriousHandler,
  BSH_SENTINEL_OFF,
  BSH_SP_SAVE_OFF,
  BSH_AV_CONTROL_OFF,
  BSH_FRAME_FLAG_OFF,
  BSH_FRAME_CTR_OFF,
  BSH_COUNTDOWN_OFF,
  BSH_AUDIO_BASE_OFF,
  BSH_AUDIO_FLAG_OFF,
  BSH_AUDIO_ACK_OFF,
} from "../src/boot-spurious-handler.js";
import { emptyGameState } from "../src/state.js";

function getWord(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

function getLong(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

describe("bootSpuriousHandler (FUN_100D8, 48 bytes)", () => {
  it("smoke: empty state + d0=0 does not raise", () => {
    const s = emptyGameState();
    expect(() => bootSpuriousHandler(s, 0)).not.toThrow();
  });

  it("writes sentinel byte d0 to workRam[0xE]", () => {
    const s = emptyGameState();
    bootSpuriousHandler(s, 0xab);
    expect(s.workRam[BSH_SENTINEL_OFF]).toBe(0xab);
  });

  it("writes sentinel masked to 8 bits (d0=0x1FF → 0xFF)", () => {
    const s = emptyGameState();
    bootSpuriousHandler(s, 0x1ff);
    expect(s.workRam[BSH_SENTINEL_OFF]).toBe(0xff);
  });

  it("sets the boot main-path counters: 0x3B6=0x0000 (FFFF+1), 0x3AE=0x0080, 0x3B8=0x012C, 0x3B2=0", () => {
    const s = emptyGameState();
    // Pre-populate with sentinel pattern to verify overwrite.
    s.workRam[BSH_FRAME_CTR_OFF] = 0x12;
    s.workRam[BSH_FRAME_CTR_OFF + 1] = 0x34;
    s.workRam[BSH_AV_CONTROL_OFF] = 0xde;
    s.workRam[BSH_AV_CONTROL_OFF + 1] = 0xad;
    s.workRam[BSH_FRAME_FLAG_OFF] = 0xff;
    s.workRam[BSH_COUNTDOWN_OFF] = 0xff;
    s.workRam[BSH_COUNTDOWN_OFF + 1] = 0xff;

    bootSpuriousHandler(s, 0x42);

    // 0x4003B6: FFFF then addq.w #1 → wraps to 0x0000.
    expect(getWord(s.workRam, BSH_FRAME_CTR_OFF)).toBe(0x0000);
    // 0x4003AE: 0x0080
    expect(getWord(s.workRam, BSH_AV_CONTROL_OFF)).toBe(0x0080);
    // 0x4003B8: 0x012C (300)
    expect(getWord(s.workRam, BSH_COUNTDOWN_OFF)).toBe(0x012c);
    // 0x4003B2: 0
    expect(s.workRam[BSH_FRAME_FLAG_OFF]).toBe(0);
  });

  it("saves SP (long) to workRam[0x440] only if provided", () => {
    const s1 = emptyGameState();
    bootSpuriousHandler(s1, 0, null);
    expect(getLong(s1.workRam, BSH_SP_SAVE_OFF)).toBe(0); // skip → stays 0

    const s2 = emptyGameState();
    bootSpuriousHandler(s2, 0, 0x00401f00);
    expect(getLong(s2.workRam, BSH_SP_SAVE_OFF)).toBe(0x00401f00);
  });

  it("audio mailbox reset (FUN_4D98 effects): 0x1F44=0x80, 0x1F45=0, 0x1F5A=0", () => {
    const s = emptyGameState();
    // Pre-populate to verify an explicit clear.
    s.workRam[BSH_AUDIO_BASE_OFF] = 0x12;
    s.workRam[BSH_AUDIO_FLAG_OFF] = 0x34;
    s.workRam[BSH_AUDIO_ACK_OFF] = 0xab;
    s.workRam[BSH_AUDIO_ACK_OFF + 1] = 0xcd;
    s.workRam[BSH_AUDIO_ACK_OFF + 2] = 0xef;
    s.workRam[BSH_AUDIO_ACK_OFF + 3] = 0x99;

    bootSpuriousHandler(s, 0);

    expect(s.workRam[BSH_AUDIO_BASE_OFF]).toBe(0x80);
    expect(s.workRam[BSH_AUDIO_FLAG_OFF]).toBe(0);
    expect(getLong(s.workRam, BSH_AUDIO_ACK_OFF)).toBe(0);
  });

  it("subs.audioInit80 override: the default is not called", () => {
    const s = emptyGameState();
    let calls = 0;
    bootSpuriousHandler(s, 0, null, {
      audioInit80: () => {
        calls++;
      },
    });
    expect(calls).toBe(1);
    // (set from the main path a step 5).
    expect(getWord(s.workRam, BSH_FRAME_CTR_OFF)).toBe(0xffff);
    expect(getWord(s.workRam, BSH_COUNTDOWN_OFF)).toBe(0x0000);
    // Audio mailbox NOT initialized.
    expect(s.workRam[BSH_AUDIO_BASE_OFF]).toBe(0);
  });

  it("subs.audioReset80 override: called by the default audioInit80", () => {
    const s = emptyGameState();
    let resetCalls = 0;
    bootSpuriousHandler(s, 0, null, {
      audioReset80: () => {
        resetCalls++;
      },
    });
    expect(resetCalls).toBe(1);
    expect(getWord(s.workRam, BSH_FRAME_CTR_OFF)).toBe(0x0000); // wrap
    expect(getWord(s.workRam, BSH_COUNTDOWN_OFF)).toBe(0x012c);
    expect(s.workRam[BSH_AUDIO_BASE_OFF]).toBe(0);
  });

  it("does not write outside the expected range (no spurious workRam writes)", () => {
    const s = emptyGameState();
    bootSpuriousHandler(s, 0xff, 0x00400000);

    // Scan workRam: only expected offsets must be != 0.
    const expectedNonZero = new Set<number>([
      BSH_SENTINEL_OFF,
      BSH_SP_SAVE_OFF + 1, // 0x441 = 0x40
      BSH_AV_CONTROL_OFF + 1, // 0x3AF = 0x80
      BSH_COUNTDOWN_OFF, // 0x3B8 = 0x01
      BSH_COUNTDOWN_OFF + 1, // 0x3B9 = 0x2C
      BSH_AUDIO_BASE_OFF, // 0x1F44 = 0x80
    ]);
    // Written sentinel = 0xFF.
    expect(s.workRam[BSH_SENTINEL_OFF]).toBe(0xff);
    // SP long = 0x00400000 -> MSB=0,0,0x40,0x00 -> only 0x441=0x40.
    expect(s.workRam[BSH_SP_SAVE_OFF]).toBe(0);
    expect(s.workRam[BSH_SP_SAVE_OFF + 1]).toBe(0x40);
    expect(s.workRam[BSH_SP_SAVE_OFF + 2]).toBe(0);
    expect(s.workRam[BSH_SP_SAVE_OFF + 3]).toBe(0);
    // FRAME_CTR (0x3B6/7) ends at 0x0000 (wrap) -> both bytes are 0.
    expect(s.workRam[BSH_FRAME_CTR_OFF]).toBe(0);
    expect(s.workRam[BSH_FRAME_CTR_OFF + 1]).toBe(0);

    let unexpected = 0;
    for (let off = 0; off < s.workRam.length; off++) {
      const v = s.workRam[off] ?? 0;
      if (v === 0) continue;
      if (expectedNonZero.has(off)) continue;
      unexpected++;
    }
    expect(unexpected).toBe(0);
  });
});
