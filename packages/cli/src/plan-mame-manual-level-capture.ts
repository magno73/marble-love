#!/usr/bin/env node
/**
 * plan-mame-manual-level-capture.ts — print a repeatable manual MAME capture
 * workflow for finding real playable level-start seeds.
 *
 * This planner does not run MAME. It prints the commands needed to:
 *   1. record a native MAME movie while a human plays;
 *   2. replay that movie through oracle/mame_playable_input_capture.lua;
 *   3. summarize/export stable playable snapshot candidates;
 *   4. audit the exported candidates before any startLevel wiring.
 */

import { argv, exit } from "node:process";
import { join, resolve } from "node:path";

interface CliArgs {
  name: string;
  outRoot: string;
  maxFrame: number;
  window: number;
  rompath: string;
}

function printHelp(): void {
  console.log(`plan-mame-manual-level-capture — print manual MAME level capture workflow

Usage:
  npx tsx packages/cli/src/plan-mame-manual-level-capture.ts [options]

Options:
  --name NAME       Capture base name (default: manual_levels)
  --out-root DIR    Output root (default: /private/tmp/marble-manual-level-capture)
  --max-frame N     Playback capture stop frame (default: 24000)
  --window N        Tail snapshot window length (default: 2400)
  --rompath DIR     MAME ROM path (default: roms)
  -h, --help        Show this help

Use this when screenshots or warm snapshots are not enough. Play in real MAME,
then replay the movie through the capture script so TS can cluster stable
playable terrain windows before audit.
`);
}

function parseArgs(): CliArgs {
  const args = argv.slice(2);
  let name = "manual_levels";
  let outRoot = "/private/tmp/marble-manual-level-capture";
  let maxFrame = 24_000;
  let window = 2_400;
  let rompath = "roms";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--name") {
      const next = args[++i];
      if (next === undefined) throw new Error("--name requires a value");
      name = next;
    } else if (arg === "--out-root") {
      const next = args[++i];
      if (next === undefined) throw new Error("--out-root requires a value");
      outRoot = next;
    } else if (arg === "--max-frame") {
      maxFrame = parsePositiveInt(args[++i], "--max-frame");
    } else if (arg === "--window") {
      window = parsePositiveInt(args[++i], "--window");
    } else if (arg === "--rompath") {
      const next = args[++i];
      if (next === undefined) throw new Error("--rompath requires a value");
      rompath = next;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return { name, outRoot, maxFrame, window, rompath };
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  if (raw === undefined) throw new Error(`${label} requires a value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function printCommand(env: Record<string, string>, args: readonly string[]): void {
  const envText = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const argText = args.map(shellQuote).join(" ");
  console.log(envText === "" ? argText : `${envText} ${argText}`);
}

function main(): void {
  const args = parseArgs();
  const root = resolve(args.outRoot);
  const moviePath = join(root, `${args.name}.inp`);
  const outDir = join(root, "scenarios");
  const inputPath = join(root, `${args.name}.input.json`);
  const tailScenario = join(outDir, `${args.name}_tail.json`);
  const candidatesDir = join(root, "candidates");

  console.log(`# Manual MAME capture workflow for ${args.name}`);
  console.log(`# Output root: ${root}`);
  console.log("");
  console.log("# 1) Record native MAME movie. Play normally: coin, start, and reach as many level starts as possible.");
  printCommand({}, ["mkdir", "-p", root]);
  printCommand({}, ["mame", "marble", "-rompath", args.rompath, "-record", moviePath]);
  console.log("");
  console.log("# 2) Replay the movie through the capture script. This records input JSON plus a tail scenario.");
  printCommand(
    {
      MARBLE_PLAYABLE_MANUAL: "1",
      MARBLE_PLAYABLE_NAME: args.name,
      MARBLE_PLAYABLE_OUT_DIR: outDir,
      MARBLE_PLAYABLE_INPUT_OUT: inputPath,
      MARBLE_PLAYABLE_INPUT_TRACE_REF: inputPath,
      MARBLE_PLAYABLE_MAX_FRAME: String(args.maxFrame),
      MARBLE_PLAYABLE_MANUAL_WINDOW: String(args.window),
    },
    [
      "mame",
      "marble",
      "-rompath",
      args.rompath,
      "-playback",
      moviePath,
      "-autoboot_script",
      "oracle/mame_playable_input_capture.lua",
      "-nothrottle",
      "-video",
      "none",
      "-sound",
      "none",
      "-nonvram_save",
    ],
  );
  console.log("");
  console.log("# 3) Summarize and export stable playable representatives from the tail.");
  printCommand(
    {},
    [
      "node",
      "--import",
      "tsx",
      "packages/cli/src/scan-playable-terrain-hashes.ts",
      "--summary-only",
      "--all-snapshots",
      "--cluster-by",
      "segment",
      "--min-cluster-samples",
      "1",
      "--emit-loaded-candidates-dir",
      candidatesDir,
      tailScenario,
    ],
  );
  console.log("");
  console.log("# 4) Audit exported candidates. Non-diagnostic output is still not automatic startLevel wiring.");
  const auditArgs = [
    "node",
    "--import",
    "tsx",
    "packages/cli/src/audit-playable-seed.ts",
    "--only-candidates",
    "--distinct-from",
    "packages/web/public/scenarios/playable/manual_level1_start.seed.json",
  ];
  console.log(`${auditArgs.map(shellQuote).join(" ")} ${shellQuote(candidatesDir)}/*.seed.json`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
