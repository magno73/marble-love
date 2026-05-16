#!/usr/bin/env node
/**
 * plan-bootstrap-route-sweep.ts — print reproducible MAME commands for the
 * minimal ROM-dispatcher bootstrap level sweep.
 *
 * The planned runs use MARBLE_PLAYABLE_BOOTSTRAP_TARGET_LEVEL so MAME executes
 * FUN_118D2/FUN_16EC6 for the requested descriptor instead of copying RAM by
 * hand. This utility prints commands only; it does not promote startLevel
 * seeds.
 */

import { join, resolve } from "node:path";
import { argv, exit } from "node:process";

interface CliArgs {
  outRoot: string;
  rompath: string;
  levels: number[];
  routes: string[];
  frameList: string;
  neutralRoute: string;
  routeStep: number;
  bootstrapFrame: number;
  trackballStart: number;
  traceFrom: number;
  traceTo: number;
  sampleEvery: number;
  maxEvents: number;
  maxSamples: number;
  auditPlan: string;
  auditMaxDeaths: number;
}

const DEFAULT_OUT_ROOT = "/private/tmp/marble-bootstrap-route-sweep";
const DEFAULT_LEVELS = [4, 6];
const DEFAULT_ROUTES = ["U:900", "N:900", "L:900", "R:900", "UL:900", "DR:900"];
const DEFAULT_FRAME_LIST = "f2800:2800,f3000:3000,f3200:3200,f3400:3400,f3600:3600";
const DEFAULT_AUDIT_PLAN = "R:200,D:200,L:200,U:200,N:200";

function printHelp(): void {
  console.log(`plan-bootstrap-route-sweep — print MAME bootstrap route sweep commands

Usage:
  node --import tsx packages/cli/src/plan-bootstrap-route-sweep.ts [options]

Options:
  --out-root DIR          Output root (default: ${DEFAULT_OUT_ROOT})
  --rompath DIR           MAME ROM path (default: roms)
  --levels CSV            Target levels 1..6 (default: ${DEFAULT_LEVELS.join(",")})
  --routes CSV            Active route specs (default: ${DEFAULT_ROUTES.join(",")})
  --frame-list SPEC       MARBLE_PLAYABLE_FRAME_LIST
                          (default: ${DEFAULT_FRAME_LIST})
  --neutral-route SPEC    Neutral route (default: N:1300)
  --route-step N          MARBLE_PLAYABLE_ROUTE_STEP (default: 4)
  --bootstrap-frame N     MARBLE_PLAYABLE_BOOTSTRAP_FRAME (default: 2300)
  --trackball-start N     MARBLE_PLAYABLE_TRACKBALL_START (default: 2600)
  --trace-from N          Descriptor trace first frame (default: 1700)
  --trace-to N            Descriptor trace last frame (default: 3700)
  --sample-every N        Descriptor sample interval (default: 200)
  --max-events N          Descriptor max events (default: 30000)
  --max-samples N         Descriptor max samples (default: 8000)
  --audit-plan SPEC       audit-playable-seed --plan
                          (default: ${DEFAULT_AUDIT_PLAN})
  --audit-max-deaths N    audit-playable-seed --max-route-deaths (default: 0)
  -h, --help              Show this help

The commands are diagnostic. A non-diagnostic audit result still needs browser
and descriptor review before any startLevel wiring.
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  let outRoot = DEFAULT_OUT_ROOT;
  let rompath = "roms";
  let levels = DEFAULT_LEVELS;
  let routes = DEFAULT_ROUTES;
  let frameList = DEFAULT_FRAME_LIST;
  let neutralRoute = "N:1300";
  let routeStep = 4;
  let bootstrapFrame = 2300;
  let trackballStart = 2600;
  let traceFrom = 1700;
  let traceTo = 3700;
  let sampleEvery = 200;
  let maxEvents = 30_000;
  let maxSamples = 8_000;
  let auditPlan = DEFAULT_AUDIT_PLAN;
  let auditMaxDeaths = 0;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--out-root") {
      outRoot = requireValue(raw[++i], "--out-root");
    } else if (arg === "--rompath") {
      rompath = requireValue(raw[++i], "--rompath");
    } else if (arg === "--levels") {
      levels = parseCsvInts(requireValue(raw[++i], "--levels"), "--levels", 1, 6);
    } else if (arg === "--routes") {
      routes = parseCsvStrings(requireValue(raw[++i], "--routes"), "--routes");
    } else if (arg === "--frame-list") {
      frameList = requireValue(raw[++i], "--frame-list");
    } else if (arg === "--neutral-route") {
      neutralRoute = requireValue(raw[++i], "--neutral-route");
    } else if (arg === "--route-step") {
      routeStep = parsePositiveInt(raw[++i], "--route-step");
    } else if (arg === "--bootstrap-frame") {
      bootstrapFrame = parsePositiveInt(raw[++i], "--bootstrap-frame");
    } else if (arg === "--trackball-start") {
      trackballStart = parsePositiveInt(raw[++i], "--trackball-start");
    } else if (arg === "--trace-from") {
      traceFrom = parsePositiveInt(raw[++i], "--trace-from");
    } else if (arg === "--trace-to") {
      traceTo = parsePositiveInt(raw[++i], "--trace-to");
    } else if (arg === "--sample-every") {
      sampleEvery = parsePositiveInt(raw[++i], "--sample-every");
    } else if (arg === "--max-events") {
      maxEvents = parsePositiveInt(raw[++i], "--max-events");
    } else if (arg === "--max-samples") {
      maxSamples = parsePositiveInt(raw[++i], "--max-samples");
    } else if (arg === "--audit-plan") {
      auditPlan = requireValue(raw[++i], "--audit-plan");
    } else if (arg === "--audit-max-deaths") {
      auditMaxDeaths = parseNonNegativeInt(raw[++i], "--audit-max-deaths");
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  if (traceTo <= traceFrom) throw new Error("--trace-to must be greater than --trace-from");

  return {
    outRoot,
    rompath,
    levels,
    routes,
    frameList,
    neutralRoute,
    routeStep,
    bootstrapFrame,
    trackballStart,
    traceFrom,
    traceTo,
    sampleEvery,
    maxEvents,
    maxSamples,
    auditPlan,
    auditMaxDeaths,
  };
}

function requireValue(raw: string | undefined, label: string): string {
  if (raw === undefined || raw === "") throw new Error(`${label} requires a value`);
  return raw;
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  const value = Number(requireValue(raw, label));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
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
  return values;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "route";
}

function routeName(route: string): string {
  return sanitizeName(route.split(":")[0] ?? route);
}

function printCommand(env: Record<string, string>, args: readonly string[]): void {
  const envText = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const argText = args.map(shellQuote).join(" ");
  console.log(envText === "" ? argText : `${envText} ${argText}`);
}

function printMameRun(args: CliArgs, level: number, routeLabel: string, route: string): void {
  const root = resolve(args.outRoot);
  const outDir = join(root, `l${level}`, routeLabel);
  const cfgDir = join(outDir, "cfg");
  console.log(`# L${level} ${routeLabel} route=${route}`);
  printCommand({}, ["rm", "-rf", outDir]);
  printCommand({}, ["mkdir", "-p", cfgDir]);
  printCommand(
    {
      SDL_VIDEODRIVER: "dummy",
      MARBLE_DESCRIPTOR_TRACE_PLAYABLE_CAPTURE: "1",
      MARBLE_DESCRIPTOR_TRACE_FROM: String(args.traceFrom),
      MARBLE_DESCRIPTOR_TRACE_TO: String(args.traceTo),
      MARBLE_DESCRIPTOR_TRACE_SAMPLE_EVERY: String(args.sampleEvery),
      MARBLE_DESCRIPTOR_TRACE_MAX_EVENTS: String(args.maxEvents),
      MARBLE_DESCRIPTOR_TRACE_MAX_SAMPLES: String(args.maxSamples),
      MARBLE_DESCRIPTOR_TRACE_OUT: join(outDir, "trace.json"),
      MARBLE_PLAYABLE_OUT_DIR: join(outDir, "scenarios"),
      MARBLE_PLAYABLE_INPUT_OUT: join(outDir, "input.json"),
      MARBLE_PLAYABLE_FRAME_LIST: args.frameList,
      MARBLE_PLAYABLE_CAPTURE_FRAMES: "0",
      MARBLE_PLAYABLE_FORCE_MANUAL_ON_DETECTOR_READY: "1",
      MARBLE_PLAYABLE_BOOTSTRAP_TARGET_LEVEL: String(level),
      MARBLE_PLAYABLE_BOOTSTRAP_FRAME: String(args.bootstrapFrame),
      MARBLE_PLAYABLE_TRACKBALL_START: String(args.trackballStart),
      MARBLE_PLAYABLE_ROUTE_STEP: String(args.routeStep),
      MARBLE_PLAYABLE_ROUTE: route,
    },
    [
      "mame",
      "marble",
      "-rompath",
      args.rompath,
      "-cfg_directory",
      cfgDir,
      "-autoboot_script",
      "oracle/mame_level_descriptor_tap.lua",
      "-nothrottle",
      "-video",
      "none",
      "-sound",
      "none",
      "-nonvram_save",
    ],
  );
  console.log("");
}

function printAudit(args: CliArgs, level: number, routeLabel: string): void {
  const root = resolve(args.outRoot);
  const activeDir = join(root, `l${level}`, routeLabel, "scenarios");
  const neutralDir = join(root, `l${level}`, "neutral", "scenarios");
  const prefix = [
    "node",
    "--import",
    "tsx",
    "packages/cli/src/audit-playable-seed.ts",
    "--plan",
    args.auditPlan,
    "--max-route-deaths",
    String(args.auditMaxDeaths),
    "--mame-neutral-dir",
    neutralDir,
    "--distinct-from",
    "packages/web/public/scenarios/playable/manual_level1_start.seed.json",
    "--only-candidates",
  ];
  console.log(`${prefix.map(shellQuote).join(" ")} ${shellQuote(activeDir)}/*.json`);
}

function main(): void {
  const args = parseArgs();
  console.log("# ROM dispatcher bootstrap route sweep");
  console.log(`# outRoot=${resolve(args.outRoot)}`);
  console.log(`# levels=${args.levels.join(",")} routes=${args.routes.join(",")}`);
  console.log("");

  for (const level of args.levels) {
    printMameRun(args, level, "neutral", args.neutralRoute);
    for (const route of args.routes) {
      printMameRun(args, level, routeName(route), route);
    }
  }

  console.log("# Audits");
  for (const level of args.levels) {
    for (const route of args.routes) {
      printAudit(args, level, routeName(route));
    }
  }
}

main();
