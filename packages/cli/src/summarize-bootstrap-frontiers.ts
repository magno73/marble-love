#!/usr/bin/env node
/**
 * summarize-bootstrap-frontiers.ts - rank ROM-dispatcher bootstrap captures.
 *
 * This is a MAME-first triage tool for startLevel discovery. It scans a
 * plan-bootstrap-route-sweep output tree, runs the existing descriptor-aware
 * audit on every active-vs-neutral scenario pair, and classifies each captured
 * frame as a candidate, parity/control gap, death-prone route, or plain
 * diagnostic. It does not write or promote playable seed files.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { argv, execArgv, execPath, exit } from "node:process";
import { spawnSync } from "node:child_process";

interface CliArgs {
  root: string;
  levels: number[] | undefined;
  routes: string[] | undefined;
  plan: string;
  maxRouteDeaths: number;
  topPerLevel: number;
  showAll: boolean;
  json: boolean;
}

interface AuditJson {
  plan: string;
  frames: number;
  maxRouteDeaths: number;
  summaries: AuditSummary[];
}

interface AuditSummary {
  path: string;
  sourcePath: string;
  initial: {
    frame?: number;
    main: number;
    mode: number;
    next: number;
    descriptorPointer: number;
    descriptorLevel?: number;
    pfCount: number;
    playerState: number;
    timer: number;
    segment: number;
  };
  mamePair?: {
    responsive: boolean;
    diffX: number;
    diffY: number;
    workRamDiffs: number;
    playfieldDiffs: number;
    spriteDiffs: number;
    alphaDiffs: number;
    colorDiffs: number;
  };
  preserved: ComparisonSummary;
  manualRearm: ComparisonSummary;
  verdict: "practice-seed" | "candidate-needs-route-proof" | "diagnostic-only";
  reasons: string[];
}

interface ComparisonSummary {
  active: RouteSummary;
  neutral: RouteSummary;
  diffX: number;
  diffY: number;
  responsive: boolean;
  stable: boolean;
}

interface RouteSummary {
  playerState: number;
  timer: number;
  pfCount: number;
  maxEmptyRun: number;
  maxScrollY: number;
  maxState1Run: number;
  maxState2Run: number;
  maxState6Run: number;
  deathEvents: number;
  recoveries: number;
}

interface FrontierRow {
  level: number;
  route: string;
  file: string;
  sourcePath: string;
  frame: number | undefined;
  descriptorLevel: number | undefined;
  descriptorPointer: number;
  verdict: AuditSummary["verdict"];
  className: FrontierClass;
  score: number;
  initial: AuditSummary["initial"];
  mamePair: AuditSummary["mamePair"];
  manualRearm: ComparisonSummary;
  preserved: ComparisonSummary;
  reasons: string[];
}

type FrontierClass =
  | "candidate"
  | "descriptor-mismatch"
  | "not-responsive"
  | "not-playable-state"
  | "death-prone"
  | "ts-control-gap"
  | "ts-stability-gap"
  | "diagnostic";

const DEFAULT_ROOT = "/private/tmp/marble-bootstrap-route-sweep";
const DEFAULT_PLAN = "R:200,D:200,L:200,U:200,N:200";
const DEFAULT_TOP_PER_LEVEL = 12;

function printHelp(): void {
  console.log(`summarize-bootstrap-frontiers - rank MAME bootstrap seed frontiers

Usage:
  node --import tsx packages/cli/src/summarize-bootstrap-frontiers.ts [options]

Options:
  --root DIR             Sweep root from plan-bootstrap-route-sweep
                         (default: ${DEFAULT_ROOT})
  --levels CSV           Limit levels, e.g. 4,5,6 (default: auto-detect l2..l6)
  --routes CSV           Limit active route dirs, e.g. U,DR,UL (default: auto)
  --plan SPEC            audit-playable-seed route plan
                         (default: ${DEFAULT_PLAN})
  --max-route-deaths N   audit-playable-seed --max-route-deaths (default: 0)
  --top-per-level N      Rows printed per level unless --all (default: ${DEFAULT_TOP_PER_LEVEL})
  --all                  Print every audited row
  --json                 Emit machine-readable JSON
  -h, --help             Show this help

The tool wraps audit-playable-seed and only reports evidence. It never maps
candidate captures into startLevel.
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  let root = DEFAULT_ROOT;
  let levels: number[] | undefined;
  let routes: string[] | undefined;
  let plan = DEFAULT_PLAN;
  let maxRouteDeaths = 0;
  let topPerLevel = DEFAULT_TOP_PER_LEVEL;
  let showAll = false;
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--root") {
      root = requireValue(raw[++i], "--root");
    } else if (arg === "--levels") {
      levels = parseCsvInts(requireValue(raw[++i], "--levels"), "--levels", 2, 6);
    } else if (arg === "--routes") {
      routes = parseCsvStrings(requireValue(raw[++i], "--routes"), "--routes");
    } else if (arg === "--plan") {
      plan = requireValue(raw[++i], "--plan");
    } else if (arg === "--max-route-deaths") {
      maxRouteDeaths = parseNonNegativeInt(raw[++i], "--max-route-deaths");
    } else if (arg === "--top-per-level") {
      topPerLevel = parseNonNegativeInt(raw[++i], "--top-per-level");
    } else if (arg === "--all") {
      showAll = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return { root, levels, routes, plan, maxRouteDeaths, topPerLevel, showAll, json };
}

function requireValue(raw: string | undefined, label: string): string {
  if (raw === undefined || raw === "") throw new Error(`${label} requires a value`);
  return raw;
}

function parseNonNegativeInt(raw: string | undefined, label: string): number {
  const value = Number(requireValue(raw, label));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function parseCsvInts(raw: string, label: string, min: number, max: number): number[] {
  const values = raw
    .split(",")
    .map((token) => Number(token.trim()))
    .filter((value) => !Number.isNaN(value));
  if (
    values.length === 0 ||
    values.some((value) => !Number.isInteger(value) || value < min || value > max)
  ) {
    throw new Error(`${label} must be a comma-separated list of integers ${min}..${max}`);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function parseCsvStrings(raw: string, label: string): string[] {
  const values = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "");
  if (values.length === 0) throw new Error(`${label} must not be empty`);
  return [...new Set(values)];
}

function listDirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((entry) => {
      const full = join(path, entry);
      return statSync(full).isDirectory();
    })
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function listScenarioFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((entry) => entry.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((entry) => join(path, entry));
}

function discoverLevels(root: string): number[] {
  return listDirs(root)
    .map((entry) => /^l([2-6])$/.exec(entry)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => Number(value))
    .sort((a, b) => a - b);
}

function discoverRoutes(levelDir: string): string[] {
  return listDirs(levelDir).filter((entry) => entry !== "neutral" && existsSync(join(levelDir, entry, "scenarios")));
}

function runAudit(args: CliArgs, neutralDir: string, scenarioFiles: string[]): AuditSummary[] {
  if (scenarioFiles.length === 0) return [];
  const auditArgs = [
    ...execArgv,
    "packages/cli/src/audit-playable-seed.ts",
    "--json",
    "--plan",
    args.plan,
    "--max-route-deaths",
    String(args.maxRouteDeaths),
    "--mame-neutral-dir",
    neutralDir,
    "--distinct-from",
    "packages/web/public/scenarios/playable/manual_level1_start.seed.json",
    ...scenarioFiles,
  ];
  const result = spawnSync(execPath, auditArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `audit-playable-seed failed with status ${result.status}\n${result.stderr || result.stdout}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as AuditJson;
  return parsed.summaries;
}

function classify(summary: AuditSummary, targetLevel: number): FrontierClass {
  if (summary.verdict !== "diagnostic-only") return "candidate";
  if (summary.initial.descriptorLevel !== targetLevel) return "descriptor-mismatch";
  if (summary.initial.playerState !== 0 || summary.initial.timer <= 0) return "not-playable-state";
  if (summary.mamePair === undefined || !summary.mamePair.responsive) return "not-responsive";
  if (
    summary.manualRearm.active.deathEvents > 0 ||
    summary.manualRearm.neutral.deathEvents > 0 ||
    summary.manualRearm.active.recoveries > 0 ||
    summary.manualRearm.neutral.recoveries > 0
  ) {
    return "death-prone";
  }
  if (!summary.manualRearm.responsive) return "ts-control-gap";
  if (!summary.manualRearm.stable) return "ts-stability-gap";
  return "diagnostic";
}

function scoreRow(row: Omit<FrontierRow, "score">): number {
  let score = 0;
  if (row.initial.descriptorLevel === row.level) score += 100;
  if (row.verdict !== "diagnostic-only") score += 1_000;
  if (row.mamePair?.responsive) score += 300;
  if (row.manualRearm.responsive) score += 250;
  if (row.manualRearm.stable) score += 250;
  if (row.initial.playerState === 0) score += 100;
  if (row.initial.timer > 0) score += 50;
  score += Math.min(100, Math.floor(row.initial.pfCount / 50));
  score -= 120 * (row.manualRearm.active.deathEvents + row.manualRearm.neutral.deathEvents);
  score -= 2 * row.manualRearm.active.maxState1Run;
  score -= Math.max(0, row.manualRearm.active.maxState2Run - 60);
  score -= Math.max(0, row.manualRearm.active.maxState6Run - 180);
  return score;
}

function buildRows(args: CliArgs): FrontierRow[] {
  const root = resolve(args.root);
  const levels = args.levels ?? discoverLevels(root);
  if (levels.length === 0) throw new Error(`no l2..l6 level directories found in ${root}`);

  const rows: FrontierRow[] = [];
  for (const level of levels) {
    const levelDir = join(root, `l${level}`);
    const neutralDir = join(levelDir, "neutral", "scenarios");
    if (!existsSync(neutralDir)) throw new Error(`missing neutral scenarios dir for L${level}: ${neutralDir}`);
    const routes = args.routes ?? discoverRoutes(levelDir);
    for (const route of routes) {
      const scenariosDir = join(levelDir, route, "scenarios");
      const scenarioFiles = listScenarioFiles(scenariosDir);
      const summaries = runAudit(args, neutralDir, scenarioFiles);
      for (const summary of summaries) {
        const rowBase = {
          level,
          route,
          file: basename(summary.sourcePath),
          sourcePath: summary.sourcePath,
          frame: summary.initial.frame,
          descriptorLevel: summary.initial.descriptorLevel,
          descriptorPointer: summary.initial.descriptorPointer,
          verdict: summary.verdict,
          className: classify(summary, level),
          initial: summary.initial,
          mamePair: summary.mamePair,
          manualRearm: summary.manualRearm,
          preserved: summary.preserved,
          reasons: summary.reasons,
        };
        rows.push({ ...rowBase, score: scoreRow(rowBase) });
      }
    }
  }
  return rows.sort((a, b) => b.score - a.score || a.level - b.level || a.route.localeCompare(b.route));
}

function classStats(rows: readonly FrontierRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.className] = (out[row.className] ?? 0) + 1;
  return out;
}

function groupByLevel(rows: readonly FrontierRow[]): Map<number, FrontierRow[]> {
  const out = new Map<number, FrontierRow[]>();
  for (const row of rows) {
    const list = out.get(row.level) ?? [];
    list.push(row);
    out.set(row.level, list);
  }
  return out;
}

function compactReason(row: FrontierRow): string {
  if (row.verdict !== "diagnostic-only") return row.reasons[0] ?? "candidate";
  if (row.className === "death-prone") {
    return `deaths ${row.manualRearm.active.deathEvents}/${row.manualRearm.neutral.deathEvents}`;
  }
  if (row.className === "ts-stability-gap") {
    return `stateRuns s1=${row.manualRearm.active.maxState1Run} s2=${row.manualRearm.active.maxState2Run} s6=${row.manualRearm.active.maxState6Run}`;
  }
  if (row.className === "ts-control-gap") return "MAME moves, TS route does not diverge";
  if (row.className === "not-responsive") return "paired MAME active/neutral does not diverge";
  if (row.className === "descriptor-mismatch") return `descriptor L${row.descriptorLevel ?? "?"} while target is L${row.level}`;
  return row.reasons[0] ?? row.className;
}

function fmtPair(x: number | undefined, y: number | undefined): string {
  if (x === undefined || y === undefined) return "-";
  return `${x}/${y}`;
}

function printRows(args: CliArgs, rows: readonly FrontierRow[]): void {
  const stats = classStats(rows);
  console.log(
    `Bootstrap frontier summary root=${resolve(args.root)} plan=${args.plan} maxDeaths=${args.maxRouteDeaths}`,
  );
  console.log(
    `Audited ${rows.length} row(s); classes=${Object.entries(stats)
      .map(([key, value]) => `${key}:${value}`)
      .join(" ")}`,
  );

  const byLevel = groupByLevel(rows);
  for (const [level, levelRows] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    const visible = args.showAll ? levelRows : levelRows.slice(0, args.topPerLevel);
    console.log(`\nL${level} top ${visible.length}/${levelRows.length}`);
    console.log("score class             route frame desc main state timer pf   mameXY        tsXY          deaths reason");
    for (const row of visible) {
      const init = row.initial;
      const mameXY = fmtPair(row.mamePair?.diffX, row.mamePair?.diffY).padEnd(13);
      const tsXY = fmtPair(row.manualRearm.diffX, row.manualRearm.diffY).padEnd(13);
      const deaths = `${row.manualRearm.active.deathEvents}/${row.manualRearm.neutral.deathEvents}`.padEnd(6);
      console.log(
        `${String(row.score).padStart(5)} ` +
          `${row.className.padEnd(17)} ` +
          `${row.route.padEnd(5)} ` +
          `${String(row.frame ?? "?").padStart(5)} ` +
          `L${String(row.descriptorLevel ?? "?").padEnd(1)} ` +
          `${`${init.main}/${init.mode}`.padEnd(4)} ` +
          `${String(init.playerState).padStart(5)} ` +
          `${String(init.timer).padStart(5)} ` +
          `${String(init.pfCount).padStart(4)} ` +
          `${mameXY} ` +
          `${tsXY} ` +
          `${deaths} ` +
          compactReason(row),
      );
    }
  }
}

function main(): void {
  try {
    const args = parseArgs();
    const rows = buildRows(args);
    if (args.json) {
      console.log(JSON.stringify({ root: resolve(args.root), plan: args.plan, rows, stats: classStats(rows) }, null, 2));
    } else {
      printRows(args, rows);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    exit(1);
  }
}

main();
