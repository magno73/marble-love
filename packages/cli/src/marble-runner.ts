#!/usr/bin/env node
/**
 * marble-runner — CLI entry point del reimpl.
 *
 * Uso:
 *   marble-runner --scenario <name> [--ticks N] [--out path.jsonl] [--rom path.zip]
 *
 * Carica lo scenario di input da `oracle/scenarios/<name>.json`, esegue N tick
 * dell'engine, dumpa il trace JSONL nello **stesso formato** dell'oracolo MAME.
 *
 * Phase 4: produce output anche se il diff vs oracle fallirà (serve per
 * stabilire la pipeline). Phase 5+: il diff inizia a chiudersi.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

import {
  state as stateNs,
  trace as traceNs,
  tick,
} from "@marble-love/engine";
import type { TraceFrame, TraceHeader } from "@marble-love/engine";

// ─── CLI parsing (flag minimale, niente deps) ─────────────────────────────

interface CliArgs {
  scenario: string;
  ticks: number;
  out: string;
  rom?: string;
}

function parseArgs(): CliArgs {
  const args = argv.slice(2);
  let scenario: string | undefined;
  let ticks = 600; // 10s @ 60fps default
  let out: string | undefined;
  let rom: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--scenario" || a === "-s") scenario = args[++i];
    else if (a === "--ticks" || a === "-t") ticks = Number(args[++i] ?? "600");
    else if (a === "--out" || a === "-o") out = args[++i];
    else if (a === "--rom") rom = args[++i];
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
    ...(rom !== undefined ? { rom } : {}),
  };
}

function printHelp(): void {
  console.log(`marble-runner — esegue il reimpl su uno scenario e dumpa trace.jsonl

Uso:
  marble-runner --scenario <name> [--ticks N] [--out path] [--rom path.zip]

Opzioni:
  -s, --scenario   nome scenario (file in oracle/scenarios/<name>.json)
  -t, --ticks      numero di tick da eseguire (default: 600 = 10s @ 60fps)
  -o, --out        output JSONL (default: traces/reimpl_<scenario>.jsonl)
      --rom        path al file ROM marble.zip (richiesto da Phase 4 in poi)
  -h, --help       mostra questo testo
`);
}

// ─── Scenario loader ──────────────────────────────────────────────────────

interface Scenario {
  name: string;
  /** Frame su cui iniettare input (frame → InputDelta). */
  inputs: Record<string, { dx?: number; dy?: number; buttons?: number }>;
  /** Numero di tick da simulare (può essere overriddo da CLI). */
  ticks?: number;
}

function loadScenario(name: string): Scenario {
  const path = resolve("oracle/scenarios", `${name}.json`);
  const data = JSON.parse(readFileSync(path, "utf8")) as Scenario;
  return data;
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();
  const scenario = loadScenario(args.scenario);
  const ticks = args.ticks ?? scenario.ticks ?? 600;

  // Init game state. **STUB**: da Phase 4 in poi qui si carica la ROM,
  // si esegue reset vector del 68010 e si tickea fino a power-on completato.
  const s = stateNs.emptyGameState();

  const header: TraceHeader = {
    schemaVersion: traceNs.TRACE_SCHEMA_VERSION,
    source: "reimpl",
    scenario: scenario.name,
    romCrc32: "",
    startedAt: new Date().toISOString(),
  };

  // Output stream (line-buffered).
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const lines: string[] = [traceNs.serializeHeader(header)];

  for (let i = 0; i < ticks; i++) {
    // TODO: applicare scenario.inputs[i] al state.input
    tick(s);
    const frame: TraceFrame = traceNs.frameFromState(s);
    lines.push(traceNs.serializeFrame(frame));
  }

  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`wrote ${ticks} frames → ${outPath}`);
}

main();
