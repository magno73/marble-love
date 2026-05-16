const SUPPORTED_START_LEVELS = new Set([1, 2, 3, 4, 5, 6]);

const START_LEVEL_PLAYABLE_SEEDS = new Map<number, string>([
  [1, "manual_level1_start"],
]);

export function parseStartLevelParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) return undefined;
  return SUPPORTED_START_LEVELS.has(value) ? value : undefined;
}

export function playableSeedForStartLevel(level: number | undefined): string | undefined {
  return level === undefined ? undefined : START_LEVEL_PLAYABLE_SEEDS.get(level);
}
