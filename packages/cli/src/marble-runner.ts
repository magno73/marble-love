#!/usr/bin/env node
/**
 * marble-runner — esegue il **reimpl TS** su uno scenario e dumpa trace JSONL.
 *
 * Questo è il "vero" runner del progetto: usa l'engine `@marble-love/engine`
 * (codice TypeScript idiomatic, niente WASM, niente CPU emulator).
 *
 * Uso:
 *   marble-runner --scenario <name> [--ticks N] [--out path.jsonl]
 *
 * Per un trace dell'**oracolo** dalla ROM via Musashi WASM, vedi `binary-runner`.
 * Per un trace dall'oracolo MAME, vedi `oracle/run_oracle.ts`.
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
  console.log(`marble-runner — esegue il reimpl TS su uno scenario

Uso:
  marble-runner --scenario <name> [--ticks N] [--out path]

Opzioni:
  -s, --scenario   nome scenario (file in oracle/scenarios/<name>.json)
  -t, --ticks      numero di frame da eseguire (default: 600 = 10s @ 60fps)
  -o, --out        output JSONL (default: traces/reimpl_<scenario>.jsonl)
  -h, --help       mostra questo testo
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

  // ROM: caricata se disponibile (path standard o $MARBLE_ROM).
  const romPath = process.env["MARBLE_ROM"] ?? resolve("ghidra_project/marble_program.bin");
  const rom: RomImage = busNs.emptyRomImage();
  try {
    const romBuf = readFileSync(romPath);
    rom.program.set(romBuf.subarray(0, rom.program.length));
  } catch {
    // ROM mancante: tick userà ROM vuota; le palette anim leggono 0 → no-op.
    console.warn(`warning: ROM not found at ${romPath} (continuing with empty ROM)`);
  }

  // NB: bootInit NON viene chiamato di default. MAME al frame 0 cattura
  // lo stato PRIMA che il RESET handler completi (workRam ancora 0).
  // Il nostro marble-runner serve a diff vs oracle MAME, quindi vogliamo
  // lo stesso allineamento. Per il frontend (main.ts) bootInit è invece
  // chiamato perché vogliamo lo stato post-boot già al primo frame.
  // Usa `--with-boot-init` per saltare la transitoria di boot in test.
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

  // Allineamento col Lua dumper MAME: dumpiamo PRIMA, poi tick.
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
