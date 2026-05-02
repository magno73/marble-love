#!/usr/bin/env node
/**
 * replay_trace.ts — utility per leggere un trace JSONL e stamparlo
 * human-readable. Utile per ispezionare manualmente cosa il dumper ha
 * registrato.
 *
 * Uso: node --experimental-strip-types oracle/replay_trace.ts <path.jsonl> [--from N] [--to N]
 */

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const args = argv.slice(2);
const path = args[0];
if (!path) {
  console.error("usage: replay_trace.ts <path.jsonl> [--from N] [--to N]");
  exit(2);
}

let from = 0;
let to = Infinity;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--from") from = Number(args[++i] ?? "0");
  else if (args[i] === "--to") to = Number(args[++i] ?? "Infinity");
}

const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
if (lines.length === 0) {
  console.error("empty file");
  exit(1);
}

const header = JSON.parse(lines[0]!);
console.log("HEADER:", JSON.stringify(header, null, 2));

let printed = 0;
for (let i = 1; i < lines.length; i++) {
  const f = JSON.parse(lines[i]!);
  if (f.f < from || f.f > to) continue;
  const m = f.marble;
  console.log(
    `f=${String(f.f).padStart(5, " ")} ` +
      `marble=(${m.x},${m.y},${m.z}) v=(${m.vx},${m.vy},${m.vz}) alive=${m.alive} ` +
      `score=${f.stats.score} lives=${f.stats.lives} rng=0x${(f.rng.seed >>> 0).toString(16)}`
  );
  printed++;
}
console.log(`\n${printed} frames printed (of ${lines.length - 1} total).`);
