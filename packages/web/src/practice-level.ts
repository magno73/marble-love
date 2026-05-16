const SUPPORTED_START_LEVELS = new Set([1, 2, 3, 4, 5, 6]);

const START_LEVEL_PLAYABLE_SEEDS = new Map<number, string>([
  [1, "start_level1_intro_practice_f2479"],
  [2, "start_level2_intro_beginner_f2436"],
  [3, "start_level3_intro_intermediate_f2435"],
  [4, "start_level4_intro_aerial_f2414"],
  [5, "start_level5_intro_silly_f2472"],
  [6, "start_level6_intro_ultimate_f2429"],
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
