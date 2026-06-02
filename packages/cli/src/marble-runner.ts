#!/usr/bin/env node
/**
 * marble-runner - runs the TS reimplementation on a scenario and dumps JSONL.
 *
 *
 * Usage:
 *   marble-runner --scenario <name> [--ticks N] [--out path.jsonl]
 *
 * For an oracle trace from the ROM through Musashi WASM, see `binary-runner`.
 * For a MAME oracle trace, see `oracle/run_oracle.ts`.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

import {
  state as stateNs,
  trace as traceNs,
  bus as busNs,
  tick,
  bootInit,
} from "@marble-love/engine";
import type { TraceFrame, TraceHeader, RomImage } from "@marble-love/engine";

interface CliArgs {
  scenario: string;
  ticks: number;
  out: string;
  withBootInit: boolean;
}

function parseArgs(): CliArgs {
  const args = argv.slice(2);
  let scenario: string | undefined;
  let ticks = 600;
  let out: string | undefined;
  let withBootInit = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--scenario" || a === "-s") scenario = args[++i];
    else if (a === "--ticks" || a === "-t") ticks = Number(args[++i] ?? "600");
    else if (a === "--out" || a === "-o") out = args[++i];
    else if (a === "--with-boot-init") withBootInit = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      exit(0);
    }
  }

  if (!scenario) {
    console.error("error: --scenario is required");
    printHelp();
    exit(2);
  }

  return {
    scenario,
    ticks,
    out: out ?? `traces/reimpl_${scenario}.jsonl`,
    withBootInit,
  };
}

function printHelp(): void {
  console.log(`marble-runner - runs the TS reimplementation on a scenario

Usage:
  marble-runner --scenario <name> [--ticks N] [--out path]

Options:
  -s, --scenario   scenario name (file in oracle/scenarios/<name>.json)
  -t, --ticks      number of frames to run (default: 600 = 10s @ 60fps)
  -o, --out        output JSONL (default: traces/reimpl_<scenario>.jsonl)
  -h, --help       show this help text
`);
}

interface Scenario {
  name: string;
  inputs: Record<string, { dx?: number; dy?: number; buttons?: number }>;
  ticks?: number;
}

function loadScenario(name: string): Scenario {
  const path = resolve("oracle/scenarios", `${name}.json`);
  const data = JSON.parse(readFileSync(path, "utf8")) as Scenario;
  return data;
}

function main(): void {
  const args = parseArgs();
  const scenario = loadScenario(args.scenario);
  const ticks = args.ticks ?? scenario.ticks ?? 600;

  const state = stateNs.emptyGameState();

  const romPath = process.env["MARBLE_ROM"] ?? resolve("ghidra_project/marble_program.bin");
  const rom: RomImage = busNs.emptyRomImage();
  try {
    const romBuf = readFileSync(romPath);
    rom.program.set(romBuf.subarray(0, rom.program.length));
  } catch {
    console.warn(`warning: ROM not found at ${romPath} (continuing with empty ROM)`);
  }

  // Uses `--with-boot-init` per saltare la transitoria of boot in test.
  if (args.withBootInit) {
    bootInit(state, rom);
  }

  const header: TraceHeader = {
    schemaVersion: traceNs.TRACE_SCHEMA_VERSION,
    source: "reimpl",
    scenario: scenario.name,
    romCrc32: "",
    startedAt: new Date().toISOString(),
  };

  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const lines: string[] = [traceNs.serializeHeader(header)];

  for (let i = 0; i < ticks; i++) {
    // Apply scripted input at this frame
    const input = scenario.inputs[String(i)];
    if (input) {
      if (input.dx !== undefined) {
        state.input.trackballDx = (input.dx & 0xff) as typeof state.input.trackballDx;
      }
      if (input.dy !== undefined) {
        state.input.trackballDy = (input.dy & 0xff) as typeof state.input.trackballDy;
      }
      if (input.buttons !== undefined) {
        state.input.buttons = (input.buttons & 0xff) as typeof state.input.buttons;
      }
    }

    const frame: TraceFrame = traceNs.frameFromState(state);
    lines.push(traceNs.serializeFrame(frame));
    tick(state, { rom });
  }

  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`wrote ${ticks} frames → ${outPath}`);
}

main();
