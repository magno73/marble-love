#!/usr/bin/env node
/**
 * Emits a JSONL trace in the same format as `oracle/mame_dumper.lua`.
 *
 *
 *   binary-runner output ≡ oracle/mame_dumper.lua output
 *
 * Usage:
 *   binary-runner --scenario <name> [--ticks N] [--out path] [--rom-blob path]
 *
 * Prerequisite: ROM blob at `ghidra_project/marble_program.bin` (generated with
 * `python3 tools/rom_prep.py`).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

import { state as stateNs, trace as traceNs } from "@marble-love/engine";
import type { TraceFrame, TraceHeader } from "@marble-love/engine";

import { createCpu, runFrame, disposeCpu } from "./binary-oracle-lib.js";

interface CliArgs {
  scenario: string;
  ticks: number;
  out: string;
  romBlob: string;
}

function parseArgs(): CliArgs {
  const args = argv.slice(2);
  let scenario: string | undefined;
  let ticks = 600;
  let out: string | undefined;
  let romBlob: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--scenario" || a === "-s") scenario = args[++i];
    else if (a === "--ticks" || a === "-t") ticks = Number(args[++i] ?? "600");
    else if (a === "--out" || a === "-o") out = args[++i];
    else if (a === "--rom-blob") romBlob = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`binary-runner - Musashi WASM oracle, MAME-compatible trace format

Usage:
  binary-runner --scenario <name> [--ticks N] [--out path] [--rom-blob path]
`);
      exit(0);
    }
  }

  if (!scenario) {
    console.error("error: --scenario is required");
    exit(2);
  }

  return {
    scenario,
    ticks,
    out: out ?? `traces/binary_${scenario}.jsonl`,
    romBlob: romBlob ?? resolve("ghidra_project/marble_program.bin"),
  };
}

interface Scenario {
  name: string;
  inputs: Record<string, { dx?: number; dy?: number; buttons?: number }>;
}

function loadScenario(name: string): Scenario {
  const path = resolve("oracle/scenarios", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Scenario;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const scenario = loadScenario(args.scenario);

  if (!existsSync(args.romBlob)) {
    console.error(`error: ROM blob not found at ${args.romBlob}`);
    console.error(`Run: python3 tools/rom_prep.py --rom-zip roms/marble.zip --out ghidra_project/marble_program.bin`);
    exit(3);
  }

  const rom = readFileSync(args.romBlob);
  console.log(`[binary-runner] ROM size: ${rom.length} bytes`);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });
  console.log(`[binary-runner] Musashi 68010 initialized, running ${args.ticks} frames`);

  const header: TraceHeader = {
    schemaVersion: traceNs.TRACE_SCHEMA_VERSION,
    source: "mame", // Intentional: this stays drop-in compatible with the MAME oracle.
    scenario: scenario.name,
    romCrc32: "",
    startedAt: new Date().toISOString(),
  };

  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const lines: string[] = [traceNs.serializeHeader(header)];

  const startTime = Date.now();
  for (let i = 0; i < args.ticks; i++) {
    // Apply scripted input
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

    runFrame(cpu);

    if (i % 60 === 0 && i > 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`[binary-runner] frame ${i}/${args.ticks} (${(i / elapsed).toFixed(0)} fps)`);
    }
  }

  disposeCpu(cpu);

  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`wrote ${args.ticks} frames → ${outPath} (${elapsed.toFixed(1)}s)`);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
