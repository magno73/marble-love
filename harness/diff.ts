#!/usr/bin/env node
/**
 * diff.ts - compares two JSONL traces field-by-field and identifies the first
 * divergent frame and field set.
 *
 * Usage:
 *   node --experimental-strip-types harness/diff.ts \
 *       --truth traces/oracle_<scen>.jsonl \
 *       --reimpl traces/reimpl_<scen>.jsonl \
 *       --out traces/divergence_<scen>.json [--context 5]
 *
 * Output `divergence_<scen>.json` schema:
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
 * Subsystem heuristic: `rng.seed` suggests RNG drift, marble velocity/position
 * suggests physics, `enemies.*` suggests AI, and `input.*` suggests input/I/O.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

interface Args {
  truth: string;
  reimpl: string;
  out: string;
  context: number;
  fromFrame: number;
  truthOffset: number;
}

function parseArgs(): Args {
  const a = argv.slice(2);
  let truth: string | undefined;
  let reimpl: string | undefined;
  let out: string | undefined;
  let context = 5;
  let fromFrame = 0;
  let truthOffset = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--truth") truth = a[++i];
    else if (a[i] === "--reimpl") reimpl = a[++i];
    else if (a[i] === "--out") out = a[++i];
    else if (a[i] === "--context") context = Number(a[++i] ?? "5");
    else if (a[i] === "--from-frame") fromFrame = Number(a[++i] ?? "0");
    else if (a[i] === "--truth-offset") truthOffset = Number(a[++i] ?? "0");
  }
  if (!truth || !reimpl || !out) {
    console.error("usage: diff.ts --truth A.jsonl --reimpl B.jsonl --out C.json [--context N] [--from-frame N] [--truth-offset N]");
    exit(2);
  }
  return { truth, reimpl, out, context, fromFrame, truthOffset };
}

function readJsonl(path: string): { header: any; frames: any[] } {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) throw new Error(`empty trace: ${path}`);
  const header = JSON.parse(lines[0]!);
  const frames = lines.slice(1).map((l) => JSON.parse(l));
  return { header, frames };
}

/** Fields excluded from diffing because they are metadata, not game state.
 *  - cpuTicks: 68010 PC/tick metadata; emulator dependent.
 *  - f: trace frame counter; alignment is handled by --truth-offset.
 *  - workRamHash: redundant when regional workRamHashes are present. */
const EXCLUDED_FIELDS = new Set<string>(["cpuTicks", "f"]);

/** Compares two values and appends divergent paths such as "marble.vx". */
function deepDiff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (a === b) return;
  if (EXCLUDED_FIELDS.has(path)) return;
  // Schema mismatch v1/v2: if one side lacks a field, skip it. The other side
  // simply did not dump that value.
  if (a === undefined || b === undefined) return;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    out.push(path);
    return;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  // Schema v2: if both sides have regional workRamHashes, skip the global
  // workRamHash. Keeping both is noise.
  const bothHaveRegional =
    Array.isArray(ao["workRamHashes"]) && Array.isArray(bo["workRamHashes"]);
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    const subpath = path === "" ? k : `${path}.${k}`;
    if (EXCLUDED_FIELDS.has(subpath) || EXCLUDED_FIELDS.has(k)) continue;
    if (bothHaveRegional && k === "workRamHash") continue;
    deepDiff(ao[k], bo[k], subpath, out);
  }
}

/** Formats "workRamHashes.5" as "workRam[0x500..0x5FF]" for readability. */
function annotateField(field: string): string {
  const m = field.match(/^workRamHashes\.(\d+)$/);
  if (!m) return field;
  const idx = Number(m[1]);
  const start = idx * 0x100;
  const end = start + 0xff;
  return `workRam[0x${start.toString(16).padStart(3, "0")}..0x${end.toString(16).padStart(3, "0")}]`;
}

function suspectedSubsystem(fields: string[]): string {
  for (const f of fields) {
    if (f.startsWith("rng.")) return "rng";
    if (f.startsWith("marble.v") || f.startsWith("marble.x") || f.startsWith("marble.y") || f.startsWith("marble.z")) return "physics";
    if (f.startsWith("marble.alive")) return "physics";
    if (f.startsWith("enemies.") || f.startsWith("ai.")) return "ai";
    if (f.startsWith("input.")) return "input/io";
    if (f.startsWith("stats.")) return "game-logic";
    const m = f.match(/^workRamHashes\.(\d+)$/);
    if (m) return `workRam[0x${(Number(m[1]) * 0x100).toString(16).padStart(3, "0")}..]`;
    if (f.startsWith("workRamHash")) return "ram-mismatch";
  }
  return "unknown";
}

function main(): void {
  const args = parseArgs();
  const t = readJsonl(args.truth);
  const r = readJsonl(args.reimpl);

  if (t.header.schemaVersion !== r.header.schemaVersion) {
    // v2 adds regional workRamHashes. A v1/v2 mismatch is acceptable because
    // missing fields are skipped in deepDiff, but warn anyway.
    console.warn(
      `warning: schema mismatch truth=${t.header.schemaVersion} reimpl=${r.header.schemaVersion} ` +
      `(continuing; v2-only fields such as workRamHashes will be skipped)`
    );
  }

  // Alignment: reimpl[i] maps to truth[i + truthOffset]. This is common when
  // MAME has a boot transient before the first tick while the TS path applies
  // bootInit immediately.
  const n = Math.min(r.frames.length, t.frames.length - args.truthOffset);
  let firstDivIdx = -1;
  let firstDivFields: string[] = [];

  for (let i = args.fromFrame; i < n; i++) {
    const fields: string[] = [];
    deepDiff(t.frames[i + args.truthOffset], r.frames[i], "", fields);
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
    fromFrame: args.fromFrame,
  };

  const compared = n - args.fromFrame;

  if (firstDivIdx === -1) {
    result.parity = compared === Math.max(t.frames.length, r.frames.length) - args.fromFrame ? 1 : compared / (Math.max(t.frames.length, r.frames.length) - args.fromFrame);
    result.firstDivergence = null;
    result.suspectedSubsystem = "none";
    console.log(`parity reached across ${compared} frames from ${args.fromFrame}.`);
  } else {
    result.parity = (firstDivIdx - args.fromFrame) / compared;
    const truthIdx = firstDivIdx + args.truthOffset;
    result.firstDivergence = {
      frame: r.frames[firstDivIdx]?.f ?? firstDivIdx,
      fields: firstDivFields,
      annotated: firstDivFields.map(annotateField),
      truth: t.frames[truthIdx],
      reimpl: r.frames[firstDivIdx],
    };
    result.contextFramesBefore = t.frames.slice(
      Math.max(0, truthIdx - args.context),
      truthIdx
    );
    result.suspectedSubsystem = suspectedSubsystem(firstDivFields);
    console.log(
      `divergence at frame ${firstDivIdx} (${firstDivFields.length} fields). Suspected subsystem: ${result.suspectedSubsystem}`
    );
    console.log("   fields:", firstDivFields.slice(0, 8).map(annotateField).join(", "));
  }

  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`report: ${outPath}`);
}

main();
