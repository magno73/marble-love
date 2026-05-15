import { alphaTilemap as alphaTilemapNs } from "@marble-love/engine";

interface CoinStartClockState {
  mainThreadWaitDelay: number | undefined;
  mode0Init11452Stage: number | undefined;
  mode2BottomHudDelay: number | undefined;
  mode2Init11452Stage: number | undefined;
  mode2TilemapBlitDelay: number | undefined;
}

interface CoinStartState {
  alphaRam: Uint8Array;
  clock: CoinStartClockState;
  playfieldRam: Uint8Array;
  workRam: Uint8Array;
}

interface RomProgram {
  program: Uint8Array;
}

const MAIN_STATE_OFF = 0x390;
const MODE_SELECTOR_OFF = 0x392;
const ATTRACT_TIMER_OFF = 0x75a;
const ATTRACT_MAIN_STATE = 1;
const CREDIT_ROW = 28;
const CREDIT_DIGIT_COL = 34;
const CREDIT_FALLBACK_ATTR = 0x1400;
const ATTRACT_SCREEN_MAX_PLAYFIELD_BYTES = 1_000;

export function readWorkWordBE(state: Pick<CoinStartState, "workRam">, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

export function writeWorkWordBE(state: Pick<CoinStartState, "workRam">, off: number, value: number): void {
  state.workRam[off] = (value >>> 8) & 0xff;
  state.workRam[off + 1] = value & 0xff;
}

export function prepareBrowserCoinStartAttract(state: CoinStartState): void {
  writeWorkWordBE(state, MAIN_STATE_OFF, ATTRACT_MAIN_STATE);
  writeWorkWordBE(state, MODE_SELECTOR_OFF, 2);
  writeWorkWordBE(state, ATTRACT_TIMER_OFF, 0x012c);
  writeWorkWordBE(state, 0x3a8, 0x006f);
  writeWorkWordBE(state, 0x3aa, 0x006f);
  state.workRam[0x3ac] = 0x00;

  state.clock.mainThreadWaitDelay = undefined;
  state.clock.mode0Init11452Stage = undefined;
  state.clock.mode2BottomHudDelay = undefined;
  state.clock.mode2TilemapBlitDelay = undefined;
  state.clock.mode2Init11452Stage = 0;
}

export function isCoinStartAttractReady(state: CoinStartState): boolean {
  const attractMode = readWorkWordBE(state, MODE_SELECTOR_OFF);
  return (
    readWorkWordBE(state, MAIN_STATE_OFF) === ATTRACT_MAIN_STATE &&
    attractMode <= 2 &&
    readWorkWordBE(state, ATTRACT_TIMER_OFF) > 0 &&
    countNonZeroBytes(state.playfieldRam) < ATTRACT_SCREEN_MAX_PLAYFIELD_BYTES &&
    state.clock.mainThreadWaitDelay === undefined &&
    state.clock.mode0Init11452Stage === undefined &&
    state.clock.mode2BottomHudDelay === undefined &&
    state.clock.mode2Init11452Stage === undefined &&
    state.clock.mode2TilemapBlitDelay === undefined
  );
}

function countNonZeroBytes(bytes: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) count++;
  }
  return count;
}

export function writeBrowserCreditDigit(
  state: CoinStartState,
  rom: RomProgram,
  credits: number,
): boolean {
  const digit = Math.max(0, Math.min(9, credits | 0));
  const alphaState = state as Parameters<typeof alphaTilemapNs.getAlphaTileAddr>[0];
  const alphaAddr = alphaTilemapNs.getAlphaTileAddr(alphaState, rom, CREDIT_DIGIT_COL, CREDIT_ROW);
  const off = alphaAddr - 0xa03000;
  if (off < 0 || off + 1 >= state.alphaRam.length) return false;

  const existingWord = ((state.alphaRam[off] ?? 0) << 8) | (state.alphaRam[off + 1] ?? 0);
  const attr = (existingWord & 0xff00) !== 0 ? existingWord & 0xff00 : CREDIT_FALLBACK_ATTR;
  const word = attr | (0x30 + digit);
  state.alphaRam[off] = (word >>> 8) & 0xff;
  state.alphaRam[off + 1] = word & 0xff;
  return true;
}
