const PLAYER_OBJECT_OFF = 0x18;
const PLAYER_TIMER_OFF = PLAYER_OBJECT_OFF + 0x6a;
const MIN_LEVEL_TIME_SECONDS = 1;
const MAX_LEVEL_TIME_SECONDS = 999;

export function parseLevelTimeOverrideParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) return undefined;
  if (value < MIN_LEVEL_TIME_SECONDS || value > MAX_LEVEL_TIME_SECONDS) return undefined;
  return value;
}

export function applyLevelTimeOverride(
  state: { workRam: Uint8Array },
  seconds: number,
): void {
  const value = Math.max(MIN_LEVEL_TIME_SECONDS, Math.min(MAX_LEVEL_TIME_SECONDS, seconds)) & 0xffff;
  writeWordBE(state.workRam, PLAYER_TIMER_OFF, value);
}

function writeWordBE(bytes: Uint8Array, off: number, value: number): void {
  const v = value & 0xffff;
  bytes[off] = (v >>> 8) & 0xff;
  bytes[off + 1] = v & 0xff;
}
