const START_LEVEL_SCENARIOS = new Map<number, string>([
  [1, "level1_spawn"],
  [2, "level2_spawn"],
  [3, "level3_spawn"],
  [4, "level4_spawn"],
  [5, "level5_spawn"],
]);

export function parseStartLevelParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) return undefined;
  return START_LEVEL_SCENARIOS.has(value) ? value : undefined;
}

export function scenarioForStartLevel(level: number | undefined): string | undefined {
  return level === undefined ? undefined : START_LEVEL_SCENARIOS.get(level);
}
