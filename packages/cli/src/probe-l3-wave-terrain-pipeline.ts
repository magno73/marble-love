#!/usr/bin/env node
/**
 * probe-l3-wave-terrain-pipeline.ts - compact TS trace for L3 wave terrain.
 *
 * Diagnostic only. It replays a seed/route and prints active script/terrain
 * slots plus the dynamic terrain table inputs that can feed FUN_1CABA and
 * FUN_25DF6. It does not write seeds or change runtime state.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit } from "node:process";

import {
  applySlapsticBank,
  bootInit,
  bus as busNs,
  soundMaybe11AC2 as soundMaybeNs,
  state as stateNs,
  tick,
} from "@marble-love/engine";
import type { GameState, RomImage } from "@marble-love/engine";

interface SeedJson {
  frame?: number;
  slapsticBank?: number;
  mainLoopBodyTicks?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

interface CliArgs {
  seed: string;
  plan: string;
  frames: Set<number>;
  dispatcher: "manual" | "preserved";
  resetAltAfterTick: boolean;
}

const DEFAULT_SEED = "packages/web/public/scenarios/playable/start_level3_intro_intermediate_f2435.seed.json";
const DEFAULT_PLAN =
  "DR:30,DL:30,D:30,L:30,UL:30,L:30,UL:30,DL:120,DR:60,L:30,DL:660,D:60,DL:420,L:30,DL:180,L:30,DL:90,L:30,DL:180,L:30,DL:180,D:30,DL:60,L:30,DL:360,L:60,DL:210,L:30,DL:60,D:90,DL:210,D:30,DL:120";
const DEFAULT_FRAMES = "0,600,1200,1800,2400,3000,3400,3600";
const WR = 0x00400000;
const PLAYER = 0x18;
const SLOT_BASE = 0x0a9c;
const SLOT_STRIDE = 0x56;
const SLOT_COUNT = 25;
const SCREEN_DELTAS: Record<string, readonly [number, number]> = {
  D: [0, 8],
  U: [0, -8],
  R: [8, 0],
  L: [-8, 0],
  DR: [8, 8],
  DL: [-8, 8],
  UR: [8, -8],
  UL: [-8, -8],
  N: [0, 0],
};

function help(): void {
  console.log(`probe-l3-wave-terrain-pipeline

Usage:
  node --import tsx packages/cli/src/probe-l3-wave-terrain-pipeline.ts [options]

Options:
  --seed PATH           Seed JSON (default: ${DEFAULT_SEED})
  --plan SPEC           Route spec (default: L3 wave route)
  --frames LIST         Comma-separated route frames to dump
                         (default: ${DEFAULT_FRAMES})
  --dispatcher MODE     manual or preserved (default: manual)
  --reset-alt-after-tick
                         Experimental: call FUN_11AC2 after each tick to
                         approximate a canonical alt-table reset before the
                         next player projection.
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  let seed = DEFAULT_SEED;
  let plan = DEFAULT_PLAN;
  let framesRaw = DEFAULT_FRAMES;
  let dispatcher: CliArgs["dispatcher"] = "manual";
  let resetAltAfterTick = false;
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--help" || arg === "-h") {
      help();
      exit(0);
    } else if (arg === "--seed") {
      seed = value(raw[++i], "--seed");
    } else if (arg === "--plan") {
      plan = value(raw[++i], "--plan");
    } else if (arg === "--frames") {
      framesRaw = value(raw[++i], "--frames");
    } else if (arg === "--dispatcher") {
      const v = value(raw[++i], "--dispatcher");
      if (v !== "manual" && v !== "preserved") throw new Error("--dispatcher must be manual or preserved");
      dispatcher = v;
    } else if (arg === "--reset-alt-after-tick") {
      resetAltAfterTick = true;
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  const frames = new Set(
    framesRaw.split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => {
        const n = Number(part);
        if (!Number.isInteger(n) || n < 0) throw new Error(`invalid frame "${part}"`);
        return n;
      }),
  );
  return { seed, plan, frames, dispatcher, resetAltAfterTick };
}

function value(raw: string | undefined, label: string): string {
  if (raw === undefined || raw === "") throw new Error(`${label} requires a value`);
  return raw;
}

function hexToBytes(hex: string, length: number, label: string): Uint8Array {
  if (hex.length !== length * 2) throw new Error(`${label}: expected ${length} bytes`);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function readSeed(path: string): SeedJson {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as SeedJson;
}

function loadState(rom: RomImage, seed: SeedJson, dispatcher: CliArgs["dispatcher"]): GameState {
  const state = stateNs.emptyGameState();
  bootInit(state, rom, {
    warmState: {
      workRam: hexToBytes(seed.workRam, 0x2000, "workRam"),
      playfieldRam: hexToBytes(seed.playfieldRam, 0x2000, "playfieldRam"),
      spriteRam: hexToBytes(seed.spriteRam, 0x1000, "spriteRam"),
      alphaRam: hexToBytes(seed.alphaRam, 0x1000, "alphaRam"),
      colorRam: hexToBytes(seed.colorRam, 0x800, "colorRam"),
      slapsticBank: seed.slapsticBank ?? 1,
    },
  });
  if (dispatcher === "manual") {
    state.workRam[0x390] = 0;
    state.workRam[0x391] = 0;
  }
  state.clock.mainLoopBodyTicks = (seed.mainLoopBodyTicks ?? 1) as typeof state.clock.mainLoopBodyTicks;
  return state;
}

function expandPlan(spec: string): string[] {
  const out: string[] = [];
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const [step, countRaw] = trimmed.split(":");
    if (step === undefined || countRaw === undefined || SCREEN_DELTAS[step] === undefined) {
      throw new Error(`invalid plan part "${part}"`);
    }
    const count = Number(countRaw);
    if (!Number.isInteger(count) || count < 0) throw new Error(`invalid count in "${part}"`);
    for (let i = 0; i < count; i++) out.push(step);
  }
  return out;
}

function advanceTrackball(p1X: number, p1Y: number, step: string): readonly [number, number] {
  const [screenDx, screenDy] = SCREEN_DELTAS[step] ?? [0, 0];
  return [(p1X + (screenDx !== 0 ? -screenDx : 0)) & 0xff, (p1Y + (screenDy !== 0 ? -screenDy : 0)) & 0xff];
}

function rb(s: GameState, off: number): number {
  return (s.workRam[off] ?? 0) & 0xff;
}

function rw(s: GameState, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}

function rl(s: GameState, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>> 0
  );
}

function readAbsU8(s: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a >= WR && a < WR + s.workRam.length) return rb(s, a - WR);
  if (a < rom.program.length) return (rom.program[a] ?? 0) & 0xff;
  return 0;
}

function readAbsU16(s: GameState, rom: RomImage, abs: number): number {
  return ((readAbsU8(s, rom, abs) << 8) | readAbsU8(s, rom, abs + 1)) & 0xffff;
}

function readAbsU32(s: GameState, rom: RomImage, abs: number): number {
  return (
    ((readAbsU8(s, rom, abs) << 24) |
      (readAbsU8(s, rom, abs + 1) << 16) |
      (readAbsU8(s, rom, abs + 2) << 8) |
      readAbsU8(s, rom, abs + 3)) >>> 0
  );
}

function s16(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

function fixed(v: number): string {
  return ((v | 0) / 65536).toFixed(2);
}

function hx(v: number, w = 4): string {
  return `0x${(v >>> 0).toString(16).padStart(w, "0")}`;
}

function patchSummary(s: GameState, rom: RomImage, recordPtr: number): string {
  if (recordPtr === 0) return "-";
  const patchPtr = readAbsU32(s, rom, recordPtr + 4);
  if (patchPtr === 0) return "patch=-";
  const start = s16(readAbsU16(s, rom, patchPtr));
  const count = readAbsU16(s, rom, patchPtr + 2);
  const values: string[] = [];
  for (let i = 0; i < Math.min(count, 6); i++) {
    values.push(hx(readAbsU16(s, rom, patchPtr + 4 + i * 2), 4));
  }
  return `patch=${hx(patchPtr, 6)} start=${start} count=${count} vals=${values.join("/")}`;
}

function altTableHash(s: GameState): string {
  let hash = 2166136261 >>> 0;
  for (let off = 0x76e; off < 0x76e + 132; off++) {
    hash ^= rb(s, off);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hx(hash, 8);
}

function dumpFrame(s: GameState, rom: RomImage, seedFrame: number | undefined, routeFrame: number): void {
  const absolute = seedFrame === undefined ? "?" : String(seedFrame + routeFrame);
  const px = rl(s, PLAYER + 0x0c);
  const py = rl(s, PLAYER + 0x10);
  console.log(`\nframe route=${routeFrame} abs=${absolute} clock=${s.clock.frame} main=${rw(s, 0x390)}/${rw(s, 0x392)} next=${rw(s, 0x394)} seg=${rb(s, 0x3e4)}`);
  console.log(
    `  player xy=${fixed(px)},${fixed(py)} st=${rb(s, PLAYER + 0x1a)} active=${rb(s, PLAYER + 0x18)} ` +
      `vel=${(rl(s, PLAYER + 0x00) | 0)},${(rl(s, PLAYER + 0x04) | 0)} ` +
      `raw6a4/6a6=${s16(rw(s, 0x6a4))},${s16(rw(s, 0x6a6))} ` +
      `surf=${s16(rw(s, 0x1c2c))}/${s16(rw(s, 0x1c36))}/${s16(rw(s, 0x1c38))}/${s16(rw(s, 0x1c42))}`,
  );
  console.log(
    `  globals 75c=${rb(s, 0x75c)} 75e=${rb(s, 0x75e)} pending=${hx(rl(s, 0x970), 8)} ` +
      `slot=${hx(rl(s, 0x974), 8)} activeRec=${hx(rl(s, 0x978), 8)} altHash=${altTableHash(s)}`,
  );
  for (let i = 0; i < SLOT_COUNT; i++) {
    const off = SLOT_BASE + i * SLOT_STRIDE;
    const active = rb(s, off + 0x18);
    const kind = rb(s, off + 0x1f);
    if (active === 0 || (kind !== 0x05 && kind !== 0x06 && kind !== 0x19 && kind !== 0x03)) continue;
    const rec = rl(s, off + 0x3e);
    const base = rl(s, off + 0x46);
    const final = rl(s, off + 0x42);
    console.log(
      `  slot${String(i).padStart(2, "0")} active=${active} state=${rb(s, off + 0x1a)} mode=${rb(s, off + 0x1e)} kind=${hx(kind, 2)} ` +
        `xy=${s16(rw(s, off + 0x0c))},${s16(rw(s, off + 0x10))} ` +
        `ctr=${rb(s, off + 0x20)}/${rb(s, off + 0x21)}:${rb(s, off + 0x22)}/${rb(s, off + 0x23)} pal=${rb(s, off + 0x25)} ` +
        `pc=${hx(rl(s, off + 0x36), 6)} rec=${hx(rec, 6)} final=${hx(final, 6)} base=${hx(base, 6)} ` +
        `${patchSummary(s, rom, rec)}`,
    );
  }
}

function main(): void {
  try {
    const args = parseArgs();
    const seed = readSeed(args.seed);
    const rom = busNs.emptyRomImage();
    applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const s = loadState(rom, seed, args.dispatcher);
    const plan = expandPlan(args.plan);
    let p1X = rb(s, PLAYER + 0xc9) || 0xff;
    let p1Y = rb(s, PLAYER + 0xc8) || 0xff;
    if (args.frames.has(0)) dumpFrame(s, rom, seed.frame, 0);
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i]!;
      [p1X, p1Y] = advanceTrackball(p1X, p1Y, step);
      tick(s, { rom, runMainLoopBody: true, p1X, p1Y, p2X: 0xff, p2Y: 0xff, inputMmio: 0x6f });
      if (args.resetAltAfterTick) soundMaybeNs.soundMaybe11AC2(s, rom);
      const routeFrame = i + 1;
      if (args.frames.has(routeFrame)) dumpFrame(s, rom, seed.frame, routeFrame);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    exit(1);
  }
}

main();
