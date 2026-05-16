#!/usr/bin/env node
/**
 * export-playable-seed.ts - extract one scenario snapshot as a web seed.
 *
 * This is an explicit promotion-review helper: it copies a MAME/TS scenario
 * snapshot into the flat *.seed.json shape consumed by ?playableSeed=NAME. It
 * does not edit practice-level.ts and therefore does not wire startLevel.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

interface SeedJson {
  name?: string;
  source?: string;
  frame?: number;
  slapsticBank?: number;
  mainLoopBodyTicks?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

interface ScenarioJson {
  name?: string;
  snapshots?: SeedJson[];
}

interface CliArgs {
  inputPath: string;
  outputPath: string;
  snapshotIndex: number;
  name: string | undefined;
  source: string | undefined;
  mainLoopBodyTicks: number | undefined;
  force: boolean;
}

function printHelp(): void {
  console.log(`export-playable-seed - extract one scenario snapshot as a web seed

Usage:
  node --import tsx packages/cli/src/export-playable-seed.ts [options] scenario-or-seed.json

Options:
  --out PATH           Output *.seed.json path (required)
  --snapshot-index N   Scenario snapshot index (default: 0)
  --name NAME          Seed name written into JSON metadata
  --source TEXT        Seed source metadata. Defaults to input path + index.
  --main-loop-body-ticks N
                       Optional replay phase metadata for browser/CLI seed review
  --force             Overwrite an existing output file
  -h, --help           Show this help

The output is suitable for ?playableSeed=NAME review. This tool deliberately
does not update START_LEVEL_PLAYABLE_SEEDS or any startLevel wiring.
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  const paths: string[] = [];
  let outputPath: string | undefined;
  let snapshotIndex = 0;
  let name: string | undefined;
  let source: string | undefined;
  let mainLoopBodyTicks: number | undefined;
  let force = false;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--out") {
      outputPath = requireValue(raw[++i], "--out");
    } else if (arg === "--snapshot-index") {
      snapshotIndex = parseNonNegativeInt(raw[++i], "--snapshot-index");
    } else if (arg === "--name") {
      name = requireValue(raw[++i], "--name");
    } else if (arg === "--source") {
      source = requireValue(raw[++i], "--source");
    } else if (arg === "--main-loop-body-ticks") {
      mainLoopBodyTicks = parseNonNegativeInt(raw[++i], "--main-loop-body-ticks");
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      paths.push(arg);
    }
  }

  if (paths.length !== 1) throw new Error("expected exactly one input path");
  if (outputPath === undefined) throw new Error("--out is required");
  return { inputPath: paths[0]!, outputPath, snapshotIndex, name, source, mainLoopBodyTicks, force };
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

function loadSeed(path: string, snapshotIndex: number): SeedJson {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8")) as ScenarioJson | SeedJson;
  if ("snapshots" in raw && Array.isArray(raw.snapshots)) {
    const seed = raw.snapshots[snapshotIndex];
    if (seed === undefined) throw new Error(`${path} has no snapshot index ${snapshotIndex}`);
    return seed;
  }
  if (snapshotIndex !== 0) throw new Error(`${path} is a seed JSON, so --snapshot-index must be 0`);
  return raw as SeedJson;
}

function assertHexLength(seed: SeedJson, key: keyof Pick<SeedJson, "workRam" | "playfieldRam" | "spriteRam" | "alphaRam" | "colorRam">, bytes: number): void {
  const value = seed[key];
  if (!/^[0-9a-fA-F]*$/.test(value)) throw new Error(`${key} is not hex`);
  if (value.length !== bytes * 2) {
    throw new Error(`${key} has ${value.length / 2} bytes, expected ${bytes}`);
  }
}

function validateSeed(seed: SeedJson): void {
  assertHexLength(seed, "workRam", 0x2000);
  assertHexLength(seed, "playfieldRam", 0x2000);
  assertHexLength(seed, "spriteRam", 0x1000);
  assertHexLength(seed, "alphaRam", 0x1000);
  assertHexLength(seed, "colorRam", 0x800);
}

function main(): void {
  try {
    const args = parseArgs();
    const seed = loadSeed(args.inputPath, args.snapshotIndex);
    validateSeed(seed);
    const outputPath = resolve(args.outputPath);
    if (existsSync(outputPath) && !args.force) {
      throw new Error(`${outputPath} already exists; pass --force to overwrite`);
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    const exportedName = args.name ?? seed.name;
    const exported: SeedJson = {
      ...(exportedName === undefined ? {} : { name: exportedName }),
      source: args.source ?? `${args.inputPath}#snapshot${args.snapshotIndex}`,
      ...(seed.frame === undefined ? {} : { frame: seed.frame }),
      ...(seed.slapsticBank === undefined ? {} : { slapsticBank: seed.slapsticBank }),
      ...(args.mainLoopBodyTicks === undefined && seed.mainLoopBodyTicks === undefined
        ? {}
        : { mainLoopBodyTicks: args.mainLoopBodyTicks ?? seed.mainLoopBodyTicks }),
      workRam: seed.workRam,
      playfieldRam: seed.playfieldRam,
      spriteRam: seed.spriteRam,
      alphaRam: seed.alphaRam,
      colorRam: seed.colorRam,
    };
    writeFileSync(outputPath, `${JSON.stringify(exported)}\n`);
    console.log(`wrote ${outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    exit(1);
  }
}

main();
