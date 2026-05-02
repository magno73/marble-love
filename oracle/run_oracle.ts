#!/usr/bin/env node
/**
 * run_oracle.ts — wrapper Bun/Node che lancia MAME con il Lua dumper attivo
 * e produce traces/oracle_<scenario>.jsonl.
 *
 * Uso:
 *   node --experimental-strip-types oracle/run_oracle.ts \
 *       --scenario level1_no_input [--frames 600] [--rom-path ./roms]
 *
 * Il determinismo MAME è non-negoziabile (PRD §3 Phase 3 acceptance):
 *  - `-throttle 0` per velocità massima
 *  - `-nothrottle` (legacy alias)
 *  - `-seconds_to_run` per chiudere senza UI
 *  - random seed pinned via env (TBD in Phase 3)
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, env, exit } from "node:process";

interface Args {
  scenario: string;
  frames: number;
  romPath: string;
  out: string;
  mameBin: string;
}

function parseArgs(): Args {
  const a = argv.slice(2);
  let scenario: string | undefined;
  let frames = 600;
  let romPath = "./roms";
  let out: string | undefined;
  let mameBin = env.MAME_BIN ?? "mame";

  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === "--scenario" || k === "-s") scenario = a[++i];
    else if (k === "--frames" || k === "-f") frames = Number(a[++i] ?? "600");
    else if (k === "--rom-path") romPath = a[++i] ?? "./roms";
    else if (k === "--out" || k === "-o") out = a[++i];
    else if (k === "--mame") mameBin = a[++i] ?? "mame";
  }
  if (!scenario) {
    console.error("error: --scenario is required");
    exit(2);
  }
  return {
    scenario,
    frames,
    romPath,
    mameBin,
    out: out ?? `traces/oracle_${scenario}.jsonl`,
  };
}

function main(): void {
  const args = parseArgs();
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });

  const luaPath = resolve("oracle/mame_dumper.lua");
  const seconds = Math.ceil(args.frames / 60) + 2; // +2s margine init

  const childEnv = {
    ...env,
    MARBLE_LOVE_TRACE_PATH: outPath,
    MARBLE_LOVE_SCENARIO: args.scenario,
    MARBLE_LOVE_MAX_FRAMES: String(args.frames),
  };

  const mameArgs = [
    "marble",
    "-rompath", args.romPath,
    "-window",
    "-nothrottle",
    "-skip_gameinfo",
    "-seconds_to_run", String(seconds),
    "-autoboot_script", luaPath,
    "-autoboot_delay", "1",
  ];

  console.log(`[oracle] ${args.mameBin} ${mameArgs.join(" ")}`);
  const r = spawnSync(args.mameBin, mameArgs, {
    stdio: ["ignore", "inherit", "inherit"],
    env: childEnv,
  });
  if (r.error) {
    console.error("[oracle] failed to start MAME:", r.error.message);
    exit(1);
  }
  if (r.status !== 0) {
    console.error(`[oracle] MAME exited with status ${r.status}`);
    exit(r.status ?? 1);
  }
  console.log(`[oracle] trace → ${outPath}`);
}

main();
