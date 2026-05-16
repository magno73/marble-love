const SUPPORTED_START_LEVELS = new Set([1, 2, 3, 4, 5, 6]);

const START_LEVEL_PLAYABLE_SEEDS = new Map<number, string>([
  [1, "candidate_level1_postseed_r_f3020"],
  [2, "candidate_level2_postseed_dr_f3000"],
  [3, "candidate_level3_postseed_ur_f3000"],
  [4, "candidate_level4_postseed_dr_f3200"],
  [5, "candidate_level5_postseed_dl_f3520"],
  [6, "candidate_level6_postseed_ul_f3600"],
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
