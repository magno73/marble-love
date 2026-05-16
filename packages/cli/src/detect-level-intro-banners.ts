#!/usr/bin/env node
/**
 * detect-level-intro-banners.ts - find real Marble Madness level intro banners.
 *
 * The original game draws a race intro overlay in alpha RAM at true level
 * starts, e.g. "TIME TO FINISH PRACTICE RACE" or
 * "EXTRA TIME FOR AERIAL RACE". This tool scans seed/scenario JSON snapshots
 * and reports frames whose alpha tilemap contains those strings.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, exit } from "node:process";

interface SeedJson {
  frame?: number;
  alphaRam: string;
  workRam?: string;
}

interface ScenarioJson {
  snapshots?: SeedJson[];
}

interface CliArgs {
  paths: string[];
  json: boolean;
  includeLines: boolean;
  noRecursive: boolean;
}

interface BannerSpec {
  id: string;
  level: number;
  phrases: string[];
}

interface MatchReport {
  path: string;
  snapshotIndex: number;
  frame: number | undefined;
  banners: string[];
  levels: number[];
  lines: string[];
}

const ALPHA_COLS = 64;
const ALPHA_ROWS = 32;
const ALPHA_BYTES = ALPHA_COLS * ALPHA_ROWS * 2;

const BANNERS: BannerSpec[] = [
  { id: "practice", level: 1, phrases: ["TIME TO FINISH", "PRACTICE RACE"] },
  { id: "beginner", level: 2, phrases: ["TIME TO FINISH", "BEGINNER RACE"] },
  { id: "intermediate", level: 3, phrases: ["EXTRA TIME FOR", "INTERMEDIATE RACE"] },
  { id: "aerial", level: 4, phrases: ["EXTRA TIME FOR", "AERIAL RACE"] },
  { id: "silly", level: 5, phrases: ["EXTRA TIME FOR", "SILLY RACE"] },
  { id: "ultimate", level: 6, phrases: ["EXTRA TIME FOR", "ULTIMATE RACE"] },
  { id: "silly-subtitle", level: 5, phrases: ["EVERYTHING YOU KNOW IS WRONG"] },
];

function printHelp(): void {
  console.log(`detect-level-intro-banners - scan alpha RAM for true level intro banners

Usage:
  node --import tsx packages/cli/src/detect-level-intro-banners.ts [options] file-or-dir...

Options:
  --json          Emit machine-readable JSON
  --lines         Print decoded non-empty alpha lines for every hit
  --no-recursive  Do not recurse into directories
  -h, --help      Show this help

This command only reads snapshots. It does not promote or wire startLevel seeds.
`);
}

function parseArgs(): CliArgs {
  const paths: string[] = [];
  let json = false;
  let includeLines = false;
  let noRecursive = false;

  for (let i = 0; i < argv.length - 2; i++) {
    const arg = argv[i + 2]!;
    if (arg === "--json") {
      json = true;
    } else if (arg === "--lines") {
      includeLines = true;
    } else if (arg === "--no-recursive") {
      noRecursive = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) throw new Error("expected at least one file or directory");
  return { paths, json, includeLines, noRecursive };
}

function collectJsonFiles(path: string, recursive: boolean): string[] {
  const abs = resolve(path);
  const st = statSync(abs);
  if (st.isFile()) return abs.endsWith(".json") ? [abs] : [];
  if (!st.isDirectory()) return [];

  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const child = join(abs, entry);
    const childStat = statSync(child);
    if (childStat.isDirectory()) {
      if (recursive) out.push(...collectJsonFiles(child, recursive));
    } else if (child.endsWith(".json")) {
      out.push(child);
    }
  }
  return out.sort();
}

function hexToBytes(hex: string, expectedBytes: number, label: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`${label} is not hex`);
  if (hex.length !== expectedBytes * 2) {
    throw new Error(`${label} has ${hex.length / 2} bytes, expected ${expectedBytes}`);
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function printableChar(tileIndex: number): string {
  if (tileIndex >= 0x20 && tileIndex <= 0x7e) return String.fromCharCode(tileIndex);
  return " ";
}

function decodeAlphaLines(alphaRam: string): string[] {
  const bytes = hexToBytes(alphaRam, ALPHA_BYTES, "alphaRam");
  const lines: string[] = [];
  for (let row = 0; row < ALPHA_ROWS; row++) {
    let line = "";
    for (let col = 0; col < ALPHA_COLS; col++) {
      const off = (row * ALPHA_COLS + col) * 2;
      const tileIndex = bytes[off + 1] ?? 0;
      line += printableChar(tileIndex);
    }
    lines.push(line.replace(/\s+$/g, ""));
  }
  return lines;
}

function normalizedText(lines: string[]): string {
  return lines.join(" ").replace(/\s+/g, " ").trim().toUpperCase();
}

function nonEmptyLines(lines: string[]): string[] {
  return lines
    .map((line, index) => ({ index, line: line.trimEnd() }))
    .filter((entry) => entry.line.trim() !== "")
    .map((entry) => `y=${entry.index.toString().padStart(2, "0")}: ${entry.line}`);
}

function matchingBanners(text: string): BannerSpec[] {
  return BANNERS.filter((banner) => banner.phrases.every((phrase) => text.includes(phrase)));
}

function loadSnapshots(path: string): SeedJson[] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as ScenarioJson | SeedJson;
  if ("snapshots" in raw && Array.isArray(raw.snapshots)) return raw.snapshots;
  if (typeof (raw as SeedJson).alphaRam === "string") return [raw as SeedJson];
  return [];
}

function scanFile(path: string): MatchReport[] {
  let snapshots: SeedJson[];
  try {
    snapshots = loadSnapshots(path);
  } catch {
    return [];
  }

  const reports: MatchReport[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i]!;
    if (typeof snapshot.alphaRam !== "string") continue;
    let lines: string[];
    try {
      lines = decodeAlphaLines(snapshot.alphaRam);
    } catch {
      continue;
    }
    const hits = matchingBanners(normalizedText(lines));
    if (hits.length === 0) continue;
    reports.push({
      path,
      snapshotIndex: i,
      frame: snapshot.frame,
      banners: hits.map((hit) => hit.id),
      levels: [...new Set(hits.map((hit) => hit.level))].sort((a, b) => a - b),
      lines: nonEmptyLines(lines),
    });
  }
  return reports;
}

function main(): void {
  try {
    const args = parseArgs();
    const files = args.paths.flatMap((path) => collectJsonFiles(path, !args.noRecursive));
    const reports = files.flatMap(scanFile);

    if (args.json) {
      console.log(JSON.stringify({ scannedFiles: files.length, matches: reports }, null, 2));
      return;
    }

    console.log(`scanned ${files.length} JSON file(s); matches=${reports.length}`);
    for (const report of reports) {
      const frame = report.frame === undefined ? "?" : String(report.frame);
      console.log(
        `${report.path}#${report.snapshotIndex} frame=${frame} ` +
          `level=${report.levels.join(",")} banner=${report.banners.join(",")}`,
      );
      if (args.includeLines) {
        for (const line of report.lines) console.log(`  ${line}`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    exit(1);
  }
}

main();
