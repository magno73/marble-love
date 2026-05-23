import { describe, expect, it } from "vitest";

import { bus as busNs, state as stateNs, alphaTilemap as alphaTilemapNs } from "@marble-love/engine";
import {
  COIN_START_RUNTIME_PULSE_FRAMES,
  consumeRuntimeStartCredit,
  inputMmioWithStartPulse,
  isCoinStartAttractReady,
  prepareBrowserCoinStartAttract,
  readWorkWordBE,
  writeBrowserCreditDigit,
} from "../src/coin-start-flow.js";

function writeWordBE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = (value >>> 8) & 0xff;
  buf[off + 1] = value & 0xff;
}

describe("coin/start browser flow helpers", () => {
  it("arms the initial browser coin/start screen through the staged attract rebuild", () => {
    const state = stateNs.emptyGameState();
    state.playfieldRam.fill(0xff);
    state.clock.levelIntroBannerBaseTimer = 55;
    state.clock.levelIntroBannerResumeTick = 9;
    state.clock.mode0Init11452Stage = 7;
    state.clock.mode2BottomHudDelay = 1;

    prepareBrowserCoinStartAttract(state);

    expect(readWorkWordBE(state, 0x390)).toBe(1);
    expect(readWorkWordBE(state, 0x392)).toBe(2);
    expect(readWorkWordBE(state, 0x75a)).toBe(0x012c);
    expect(state.workRam[0x3a8]).toBe(0x6f);
    expect(state.workRam[0x3aa]).toBe(0x6f);
    expect(state.workRam[0x3ac]).toBe(0x00);
    expect(state.clock.mode0Init11452Stage).toBeUndefined();
    expect(state.clock.mode2BottomHudDelay).toBeUndefined();
    expect(state.clock.mode2Init11452Stage).toBe(0);
    expect(state.clock.levelIntroBannerBaseTimer).toBeUndefined();
    expect(state.clock.levelIntroBannerResumeTick).toBeUndefined();
    expect(isCoinStartAttractReady(state)).toBe(false);
  });

  it("detects the stable attract gate after timeout rebuild", () => {
    const state = stateNs.emptyGameState();
    writeWordBE(state.workRam, 0x390, 1);
    writeWordBE(state.workRam, 0x392, 2);
    writeWordBE(state.workRam, 0x75a, 0x12c);

    expect(readWorkWordBE(state, 0x390)).toBe(1);
    expect(isCoinStartAttractReady(state)).toBe(true);

    state.clock.mode2Init11452Stage = 1;
    expect(isCoinStartAttractReady(state)).toBe(false);

    state.clock.mode2Init11452Stage = undefined;
    writeWordBE(state.workRam, 0x392, 0);
    expect(isCoinStartAttractReady(state)).toBe(true);

    state.clock.levelIntroBannerResumeTick = 1;
    expect(isCoinStartAttractReady(state)).toBe(false);
    state.clock.levelIntroBannerResumeTick = undefined;

    state.playfieldRam.fill(1, 0, 1_001);
    expect(isCoinStartAttractReady(state)).toBe(false);
  });

  it("updates the visible credit digit without requiring the high-score gate", () => {
    const state = stateNs.emptyGameState();
    const rom = busNs.emptyRomImage();

    const wrote = writeBrowserCreditDigit(state, rom, 3);
    const off = alphaTilemapNs.getAlphaTileAddr(state, rom, 34, 28) - 0xa03000;
    const word = ((state.alphaRam[off] ?? 0) << 8) | (state.alphaRam[off + 1] ?? 0);

    expect(wrote).toBe(true);
    expect(word).toBe(0x1433);
  });

  it("holds START1 low in the runtime switch byte for the MAME pulse window", () => {
    expect(inputMmioWithStartPulse(0x6f, COIN_START_RUNTIME_PULSE_FRAMES)).toBe(0x6e);
    expect(inputMmioWithStartPulse(0x6f, 0)).toBe(0x6f);
    expect(inputMmioWithStartPulse(0x6e, COIN_START_RUNTIME_PULSE_FRAMES)).toBe(0x6e);
  });

  it("consumes one runtime credit only for START1 gate acceptance", () => {
    expect(consumeRuntimeStartCredit(1, 1)).toEqual({ accepted: true, credits: 0 });
    expect(consumeRuntimeStartCredit(2, 1)).toEqual({ accepted: true, credits: 1 });
    expect(consumeRuntimeStartCredit(0, 1)).toEqual({ accepted: false, credits: 0 });
    expect(consumeRuntimeStartCredit(1, 2)).toEqual({ accepted: false, credits: 1 });
  });
});
