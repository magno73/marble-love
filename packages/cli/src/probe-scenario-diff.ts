import { basename, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank, wrap } from "@marble-love/engine";

interface ScenarioSnapshot {
  index: number;
  frame: number;
  slapsticBank?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

interface ScenarioFile {
  name?: string;
  seedFrame?: number;
  oracleFrames?: number;
  snapshots: ScenarioSnapshot[];
}

interface FrameDiff {
  frameIndex: number;
  absoluteFrame: number;
  playfield: number;
  sprite: number;
  hud: number;
  alpha: number;
  color: number;
  work: number;
}

interface RangeSummary {
  from: number;
  to: number;
  max: Omit<FrameDiff, "frameIndex" | "absoluteFrame">;
  sum: Omit<FrameDiff, "frameIndex" | "absoluteFrame">;
}

interface DiffEntry {
  region: string;
  off: number;
  ts: number;
  mame: number;
  seed: number;
}

const scenarioPath = process.argv[2];
if (scenarioPath === undefined) {
  console.error("Usage: npx tsx packages/cli/src/probe-scenario-diff.ts oracle/scenarios/gameplay/level1_spawn.json");
  process.exit(2);
}

const phaseArg = process.env.MAIN_LOOP_PHASE;
const phaseCandidates =
  phaseArg === undefined || phaseArg === "auto"
    ? [0, 1]
    : [Number(phaseArg) & 1];

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

function hexToBytes(hex: string, expectedLength: number, label: string): Uint8Array {
  if (hex.length !== expectedLength * 2) {
    throw new Error(`${label}: expected ${expectedLength * 2} hex chars, got ${hex.length}`);
  }
  const out = new Uint8Array(expectedLength);
  for (let i = 0; i < expectedLength; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function byteDiff(a: Uint8Array, b: Uint8Array, start = 0, length = Math.min(a.length, b.length) - start): number {
  let total = 0;
  const end = start + length;
  for (let i = start; i < end; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) total++;
  }
  return total;
}

function isStackResidue(off: number): boolean {
  return (
    (off >= 0x440 && off < 0x448) ||
    (off >= 0x1d40 && off < 0x1e80) ||
    (off >= 0x1ee0 && off < 0x1f00)
  );
}

function workDiffNoStack(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (!isStackResidue(i) && (a[i] ?? 0) !== (b[i] ?? 0)) total++;
  }
  return total;
}

function snapshotBytes(s: ScenarioSnapshot): {
  workRam: Uint8Array;
  playfieldRam: Uint8Array;
  spriteRam: Uint8Array;
  alphaRam: Uint8Array;
  colorRam: Uint8Array;
} {
  return {
    workRam: hexToBytes(s.workRam, 0x2000, `snapshot ${s.index} workRam`),
    playfieldRam: hexToBytes(s.playfieldRam, 0x2000, `snapshot ${s.index} playfieldRam`),
    spriteRam: hexToBytes(s.spriteRam, 0x1000, `snapshot ${s.index} spriteRam`),
    alphaRam: hexToBytes(s.alphaRam, 0x1000, `snapshot ${s.index} alphaRam`),
    colorRam: hexToBytes(s.colorRam, 0x800, `snapshot ${s.index} colorRam`),
  };
}

function runScenario(scenario: ScenarioFile, phase: number): FrameDiff[] {
  const seed = scenario.snapshots[0];
  if (seed === undefined) throw new Error("scenario has no seed snapshot");
  const seedBytes = snapshotBytes(seed);
  const bank = Number.isFinite(seed.slapsticBank) ? (seed.slapsticBank as number) & 3 : 1;

  const s = stateNs.emptyGameState();
  bootInit(s, rom, {
    warmState: {
      workRam: seedBytes.workRam,
      playfieldRam: seedBytes.playfieldRam,
      spriteRam: seedBytes.spriteRam,
      alphaRam: seedBytes.alphaRam,
      colorRam: seedBytes.colorRam,
      slapsticBank: bank,
    },
  });
  s.clock.mainLoopBodyTicks = wrap.as_u32(phase);

  const diffs: FrameDiff[] = [];
  for (let i = 1; i < scenario.snapshots.length; i++) {
    tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
    const target = scenario.snapshots[i];
    if (target === undefined) throw new Error(`missing snapshot ${i}`);
    const mame = snapshotBytes(target);
    diffs.push({
      frameIndex: i,
      absoluteFrame: target.frame,
      playfield: byteDiff(s.playfieldRam, mame.playfieldRam),
      sprite: byteDiff(s.spriteRam, mame.spriteRam),
      hud: byteDiff(s.workRam, mame.workRam, 0x500, 0x200),
      alpha: byteDiff(s.alphaRam, mame.alphaRam),
      color: byteDiff(s.colorRam, mame.colorRam),
      work: workDiffNoStack(s.workRam, mame.workRam),
    });
  }
  return diffs;
}

function diffEntries(region: string, ts: Uint8Array, mame: Uint8Array, seed: Uint8Array, start = 0, length = Math.min(ts.length, mame.length) - start): DiffEntry[] {
  const out: DiffEntry[] = [];
  const end = start + length;
  for (let i = start; i < end; i++) {
    const tsValue = ts[i] ?? 0;
    const mameValue = mame[i] ?? 0;
    if (tsValue !== mameValue) {
      out.push({ region, off: i, ts: tsValue, mame: mameValue, seed: seed[i] ?? 0 });
    }
  }
  return out;
}

function collectDiffEntries(scenario: ScenarioFile, phase: number, frameIndex: number): DiffEntry[] {
  const seed = scenario.snapshots[0];
  if (seed === undefined) throw new Error("scenario has no seed snapshot");
  const seedBytes = snapshotBytes(seed);
  const bank = Number.isFinite(seed.slapsticBank) ? (seed.slapsticBank as number) & 3 : 1;
  const s = stateNs.emptyGameState();
  bootInit(s, rom, {
    warmState: {
      workRam: seedBytes.workRam,
      playfieldRam: seedBytes.playfieldRam,
      spriteRam: seedBytes.spriteRam,
      alphaRam: seedBytes.alphaRam,
      colorRam: seedBytes.colorRam,
      slapsticBank: bank,
    },
  });
  s.clock.mainLoopBodyTicks = wrap.as_u32(phase);
  for (let i = 1; i <= frameIndex; i++) {
    tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  }
  const target = scenario.snapshots[frameIndex];
  if (target === undefined) throw new Error(`missing snapshot ${frameIndex}`);
  const mame = snapshotBytes(target);
  return [
    ...diffEntries("playfield", s.playfieldRam, mame.playfieldRam, seedBytes.playfieldRam),
    ...diffEntries("sprite", s.spriteRam, mame.spriteRam, seedBytes.spriteRam),
    ...diffEntries("hud", s.workRam, mame.workRam, seedBytes.workRam, 0x500, 0x200),
    ...diffEntries("alpha", s.alphaRam, mame.alphaRam, seedBytes.alphaRam),
    ...diffEntries("color", s.colorRam, mame.colorRam, seedBytes.colorRam),
    ...diffEntries("work", s.workRam, mame.workRam, seedBytes.workRam),
  ];
}

function frameWithinThreshold(d: FrameDiff): boolean {
  return d.playfield === 0 && d.sprite <= 50 && d.hud <= 30;
}

function phaseScore(diffs: FrameDiff[]): number {
  return diffs.slice(0, 10).reduce((acc, d) => acc + d.playfield * 100 + d.sprite * 4 + d.hud * 4 + d.alpha + d.color + d.work, 0);
}

function emptyTotals(): Omit<FrameDiff, "frameIndex" | "absoluteFrame"> {
  return { playfield: 0, sprite: 0, hud: 0, alpha: 0, color: 0, work: 0 };
}

function summarizeRange(diffs: FrameDiff[], from: number, to: number): RangeSummary {
  const max = emptyTotals();
  const sum = emptyTotals();
  for (const d of diffs) {
    if (d.frameIndex < from || d.frameIndex > to) continue;
    max.playfield = Math.max(max.playfield, d.playfield);
    max.sprite = Math.max(max.sprite, d.sprite);
    max.hud = Math.max(max.hud, d.hud);
    max.alpha = Math.max(max.alpha, d.alpha);
    max.color = Math.max(max.color, d.color);
    max.work = Math.max(max.work, d.work);
    sum.playfield += d.playfield;
    sum.sprite += d.sprite;
    sum.hud += d.hud;
    sum.alpha += d.alpha;
    sum.color += d.color;
    sum.work += d.work;
  }
  return { from, to, max, sum };
}

function rangeStatus(summary: RangeSummary): string {
  const m = summary.max;
  if (m.playfield === 0 && m.sprite === 0 && m.hud === 0 && m.alpha === 0 && m.color === 0) {
    return "BIT-PERFECT";
  }
  if (m.playfield === 0 && m.sprite <= 50 && m.hud <= 30) {
    return "PASS (under threshold)";
  }
  if (m.playfield === 0 && m.sprite <= 120 && m.hud <= 80) {
    return "minor visible drift";
  }
  return "FAIL";
}

function longestPassingStreak(diffs: FrameDiff[]): number {
  let best = 0;
  let current = 0;
  for (const d of diffs) {
    if (frameWithinThreshold(d)) {
      current++;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function firstFailFrame(diffs: FrameDiff[]): FrameDiff | undefined {
  return diffs.find((d) => !frameWithinThreshold(d));
}

const scenario = JSON.parse(readFileSync(resolve(scenarioPath), "utf-8")) as ScenarioFile;
if (scenario.snapshots.length < 2) {
  throw new Error(`${scenarioPath}: expected seed + oracle snapshots`);
}

const runs = phaseCandidates.map((phase) => ({ phase, diffs: runScenario(scenario, phase) }));
runs.sort((a, b) => phaseScore(a.diffs) - phaseScore(b.diffs));
const best = runs[0];
if (best === undefined) throw new Error("no phase candidates");

const scenarioName = scenario.name ?? basename(scenarioPath, ".json");
const seedFrame = scenario.seedFrame ?? scenario.snapshots[0]?.frame ?? -1;
const oracleFrames = best.diffs.length;
const firstFail = firstFailFrame(best.diffs);
const first60 = best.diffs.slice(0, 60);
const first60Pass = first60.length >= 60 && first60.every(frameWithinThreshold);
const bestStreak = longestPassingStreak(best.diffs);
const scenarioPass = bestStreak >= 60;

console.log(`Scenario ${scenarioName}: ${oracleFrames} frame oracle (seed MAME f${seedFrame})`);
console.log(`  Main-loop phase: ${best.phase}${phaseCandidates.length > 1 ? " (auto-selected)" : ""}`);

for (const [from, to] of [[1, 10], [11, 30], [31, 60], [61, 100]] as const) {
  if (from > oracleFrames) continue;
  const cappedTo = Math.min(to, oracleFrames);
  const summary = summarizeRange(best.diffs, from, cappedTo);
  const m = summary.max;
  const s = summary.sum;
  console.log(
    `  Frame ${from.toString().padStart(2)}..${cappedTo.toString().padStart(3)}: ` +
    `max PF=${m.playfield} Sprite=${m.sprite} HUD=${m.hud} ALPHA=${m.alpha} COLOR=${m.color} WORK=${m.work} | ` +
    `sum PF=${s.playfield} Sprite=${s.sprite} HUD=${s.hud} | Status: ${rangeStatus(summary)}`,
  );
}

if (firstFail !== undefined) {
  console.log(
    `  First fail frame: +${firstFail.frameIndex} (MAME f${firstFail.absoluteFrame}) ` +
    `PF=${firstFail.playfield} Sprite=${firstFail.sprite} HUD=${firstFail.hud} ` +
    `ALPHA=${firstFail.alpha} COLOR=${firstFail.color} WORK=${firstFail.work}`,
  );
} else {
  console.log("  First fail frame: none");
}
console.log(`  Longest threshold streak: ${bestStreak} frame`);
console.log(`  Initial 60 status: ${first60Pass ? "PASS" : "FAIL"}`);
console.log(`  Scenario status: ${scenarioPass ? `PASS @ ${bestStreak} consecutive frame` : "FAIL"}`);

if (process.env.SHOW_DIFFS !== undefined) {
  const focus = Number(process.env.FOCUS_FRAME ?? firstFail?.frameIndex ?? 60);
  const entries = collectDiffEntries(scenario, best.phase, focus);
  const limit = Number(process.env.DIFF_LIMIT ?? 40);
  console.log(`  Byte diff drill @ +${focus}: ${entries.length} bytes`);
  for (const region of ["playfield", "sprite", "hud", "alpha", "color", "work"]) {
    const regionEntries = entries.filter((e) => e.region === region);
    if (regionEntries.length === 0) continue;
    console.log(`    ${region} (${regionEntries.length})`);
    for (const e of regionEntries.slice(0, limit)) {
      const seedTag = e.seed === e.ts ? "TS unchanged" : e.seed === e.mame ? "MAME unchanged" : "both moved";
      console.log(
        `      [${e.off.toString(16).padStart(4, "0")}] ` +
        `TS=0x${e.ts.toString(16).padStart(2, "0")} ` +
        `MAME=0x${e.mame.toString(16).padStart(2, "0")} ` +
        `seed=0x${e.seed.toString(16).padStart(2, "0")} ${seedTag}`,
      );
    }
    if (regionEntries.length > limit) console.log(`      ... +${regionEntries.length - limit} more`);
  }
}

if (!scenarioPass) {
  process.exitCode = 1;
}
