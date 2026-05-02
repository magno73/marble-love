#!/usr/bin/env node
/**
 * diff.ts — confronta due trace JSONL field-by-field e identifica il **primo
 * frame** e il **primo campo** che divergono.
 *
 * Uso:
 *   node --experimental-strip-types harness/diff.ts \
 *       --truth traces/oracle_<scen>.jsonl \
 *       --reimpl traces/reimpl_<scen>.jsonl \
 *       --out traces/divergence_<scen>.json [--context 5]
 *
 * Output `divergence_<scen>.json` ha schema:
 *   {
 *     "scenario": "level1_no_input",
 *     "parity": 0.973,
 *     "framesCompared": 600,
 *     "firstDivergence": {
 *       "frame": 47,
 *       "fields": ["marble.vx", "marble.x"],
 *       "truth": { ... },
 *       "reimpl": { ... }
 *     },
 *     "contextFramesBefore": [...],
 *     "suspectedSubsystem": "physics" | "ai" | "rng" | "input" | "io" | "unknown"
 *   }
 *
 * Heuristica di sospetto: se prima divergenza è in `rng.seed` → "rng".
 * Se in `marble.vx/vy/vz` o `pos` → "physics". Se in `enemies.*` → "ai".
 * Se in `input.*` → "input/io".
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

interface Args {
  truth: string;
  reimpl: string;
  out: string;
  context: number;
}

function parseArgs(): Args {
  const a = argv.slice(2);
  let truth: string | undefined;
  let reimpl: string | undefined;
  let out: string | undefined;
  let context = 5;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--truth") truth = a[++i];
    else if (a[i] === "--reimpl") reimpl = a[++i];
    else if (a[i] === "--out") out = a[++i];
    else if (a[i] === "--context") context = Number(a[++i] ?? "5");
  }
  if (!truth || !reimpl || !out) {
    console.error("usage: diff.ts --truth A.jsonl --reimpl B.jsonl --out C.json [--context N]");
    exit(2);
  }
  return { truth, reimpl, out, context };
}

function readJsonl(path: string): { header: any; frames: any[] } {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) throw new Error(`empty trace: ${path}`);
  const header = JSON.parse(lines[0]!);
  const frames = lines.slice(1).map((l) => JSON.parse(l));
  return { header, frames };
}

/** Campi escludidi dal diff: metadata, non parte del game state.
 *  - cpuTicks: PC del 68010 / tick CPU; dipende dall'emulator, non dal game state */
const EXCLUDED_FIELDS = new Set<string>(["cpuTicks"]);

/** Confronta due valori e ritorna il path puntato (es. "marble.vx") se diversi. */
function deepDiff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (a === b) return;
  if (EXCLUDED_FIELDS.has(path)) return;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    out.push(path);
    return;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    const subpath = path === "" ? k : `${path}.${k}`;
    if (EXCLUDED_FIELDS.has(subpath) || EXCLUDED_FIELDS.has(k)) continue;
    deepDiff(ao[k], bo[k], subpath, out);
  }
}

function suspectedSubsystem(fields: string[]): string {
  for (const f of fields) {
    if (f.startsWith("rng.")) return "rng";
    if (f.startsWith("marble.v") || f.startsWith("marble.x") || f.startsWith("marble.y") || f.startsWith("marble.z")) return "physics";
    if (f.startsWith("marble.alive")) return "physics";
    if (f.startsWith("enemies.") || f.startsWith("ai.")) return "ai";
    if (f.startsWith("input.")) return "input/io";
    if (f.startsWith("stats.")) return "game-logic";
    if (f.startsWith("workRamHash")) return "ram-mismatch";
  }
  return "unknown";
}

function main(): void {
  const args = parseArgs();
  const t = readJsonl(args.truth);
  const r = readJsonl(args.reimpl);

  if (t.header.schemaVersion !== r.header.schemaVersion) {
    console.error(
      `schema mismatch: truth=${t.header.schemaVersion} reimpl=${r.header.schemaVersion} — fix oracle/mame_dumper.lua o engine/src/trace.ts`
    );
    exit(3);
  }

  const n = Math.min(t.frames.length, r.frames.length);
  let firstDivIdx = -1;
  let firstDivFields: string[] = [];

  for (let i = 0; i < n; i++) {
    const fields: string[] = [];
    deepDiff(t.frames[i], r.frames[i], "", fields);
    if (fields.length > 0) {
      firstDivIdx = i;
      firstDivFields = fields;
      break;
    }
  }

  const result: any = {
    scenario: t.header.scenario ?? "unknown",
    truthFrames: t.frames.length,
    reimplFrames: r.frames.length,
    framesCompared: n,
  };

  if (firstDivIdx === -1) {
    result.parity = n === Math.max(t.frames.length, r.frames.length) ? 1 : n / Math.max(t.frames.length, r.frames.length);
    result.firstDivergence = null;
    result.suspectedSubsystem = "none";
    console.log(`✅ parità raggiunta su ${n} frame.`);
  } else {
    result.parity = firstDivIdx / n;
    result.firstDivergence = {
      frame: t.frames[firstDivIdx]?.f ?? firstDivIdx,
      fields: firstDivFields,
      truth: t.frames[firstDivIdx],
      reimpl: r.frames[firstDivIdx],
    };
    result.contextFramesBefore = t.frames.slice(
      Math.max(0, firstDivIdx - args.context),
      firstDivIdx
    );
    result.suspectedSubsystem = suspectedSubsystem(firstDivFields);
    console.log(
      `❌ divergenza al frame ${firstDivIdx} (${firstDivFields.length} campi). Sospettato: ${result.suspectedSubsystem}`
    );
    console.log("   campi:", firstDivFields.slice(0, 8).join(", "));
  }

  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`report → ${outPath}`);
}

main();
