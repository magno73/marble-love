#!/usr/bin/env node
/**
 * report.ts - produce a human/LLM-friendly report from
 * `traces/divergence_<scen>.json`.
 *
 * Output: markdown on stdout. Intended to be read both by Marco and by
 * Claude Code in the hill-climbing loop (Phase 6).
 *
 * Usage: node --experimental-strip-types harness/report.ts <divergence.json>
 */

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const path = argv[2];
if (!path) {
  console.error("usage: report.ts <divergence.json>");
  exit(2);
}

const r = JSON.parse(readFileSync(path, "utf8"));

console.log(`# Divergence report — ${r.scenario}`);
console.log("");
console.log(`- **Parity:** ${(r.parity * 100).toFixed(2)}%`);
console.log(`- **Frame compared:** ${r.framesCompared}`);
console.log(`- **Truth frames total:** ${r.truthFrames}`);
console.log(`- **Reimpl frames total:** ${r.reimplFrames}`);
console.log("");

if (!r.firstDivergence) {
  console.log("✅ **No divergence found.**");
  console.log("");
  console.log("Move the scenario to `done/` in the curriculum and proceed to the next one.");
  exit(0);
}

console.log(`## Prima divergenza @ frame ${r.firstDivergence.frame}`);
console.log("");
console.log(`**Sottosistema sospetto:** \`${r.suspectedSubsystem}\``);
console.log("");
console.log("**Campi divergenti:**");
for (const f of r.firstDivergence.fields) console.log(`- \`${f}\``);
console.log("");

console.log("## Truth (MAME)");
console.log("```json");
console.log(JSON.stringify(r.firstDivergence.truth, null, 2));
console.log("```");
console.log("");

console.log("## Reimpl (TS)");
console.log("```json");
console.log(JSON.stringify(r.firstDivergence.reimpl, null, 2));
console.log("```");
console.log("");

console.log(`## Contesto: ${r.contextFramesBefore?.length ?? 0} frame precedenti`);
console.log("```json");
console.log(JSON.stringify(r.contextFramesBefore ?? [], null, 2));
console.log("```");
