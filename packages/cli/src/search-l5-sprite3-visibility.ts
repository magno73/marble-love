#!/usr/bin/env node
/**
 * search-l5-sprite3-visibility.ts - diagnostic route search for the Silly/L5
 * colored object family seen in sprite3.png.
 *
 * This writes TS candidates only. Any candidate still needs MAME/reference
 * route attachment before sprite3 can be marked final green.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, exit } from "node:process";

import {
  applySlapsticBank,
  bootInit,
  bus as busNs,
  state as stateNs,
  tick,
} from "@marble-love/engine";
import type { GameState, RomImage } from "@marble-love/engine";

interface SeedJson {
  name?: string;
  frame?: number;
  slapsticBank?: number;
  mainLoopBodyTicks?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

interface Args {
  seedPath: string;
  romPath: string;
  outDir: string;
  frames: number;
  chunk: number;
  stepPixels: number;
  beamWidth: number;
  maxCandidates: number;
  maxDeaths: number | undefined;
  targetTimer: number;
  routePrefix: string | undefined;
  directions: string[];
}

interface Type79Row {
  ent: number;
  type: number;
  sub: number;
  ptr: number;
  struct: number;
  d5: number;
  d4: number;
  visibleBinary: boolean;
  visibleOldTs: boolean;
  spritePtr: number;
}

interface Surface {
  descriptor: number;
  main: number;
  mode: number;
  segment: number;
  timer: number;
  playerState: number;
  playerX: number;
  playerY: number;
  visibleRows: Type79Row[];
  oldDroppedRows: Type79Row[];
  allRows: Type79Row[];
}

interface SearchNode {
  state: GameState;
  p1X: number;
  p1Y: number;
  frame: number;
  routeFrames: string[];
  currentScore: number;
  bestScore: number;
  bestFrame: number;
  bestState: GameState;
  bestRouteFrames: string[];
  bestSurface: Surface;
  deathEvents: number;
  recoveries: number;
  inDeath: boolean;
}

const DEFAULT_SEED = "packages/web/public/scenarios/playable/start_level5_intro_silly_f2472.seed.json";
const DEFAULT_ROM = "ghidra_project/marble_program.bin";
const DEFAULT_OUT_DIR = "/tmp/marble-sprite-goal/current-run/l5-sprite3-visibility-search";
const WRAM = 0x00400000;
const ENTITY_LIST = 0x3bc;
const ENTITY_END = 0x3dc;
const ROM_ENTITY_LOOKUP = 0x1f0e2;
const TYPE79_STRUCT_LOOKUP = 0x1f096;
const L5_DESCRIPTOR = 0x0002de1e;
const PLAYER_OFF = 0x18;
const DEFAULT_DIRECTIONS = ["U", "D", "L", "R", "UL", "UR", "DL", "DR", "N"];
const SCREEN_DELTA_UNITS: Record<string, readonly [number, number]> = {
  U: [0, -1],
  D: [0, 1],
  L: [-1, 0],
  R: [1, 0],
  UL: [-1, -1],
  UR: [1, -1],
  DL: [-1, 1],
  DR: [1, 1],
  N: [0, 0],
};

function printHelp(): void {
  console.log(`search-l5-sprite3-visibility - TS diagnostic search for L5 colored sprites

Usage:
  npx tsx packages/cli/src/search-l5-sprite3-visibility.ts [options]

Options:
  --seed PATH            Seed JSON (default: ${DEFAULT_SEED})
  --rom PATH             Program ROM blob (default: ${DEFAULT_ROM})
  --out-dir DIR          Output dir (default: ${DEFAULT_OUT_DIR})
  --frames N             Search horizon in route frames (default: 3300)
  --chunk N              Frames per beam expansion (default: 30)
  --step-pixels N        Trackball screen-space delta per frame (default: 32)
  --beam-width N         Nodes retained per expansion (default: 96)
  --max-candidates N     Routes/seeds written to manifest (default: 8)
  --max-deaths N         Hard cap on death events
  --target-timer N       Prefer this timer value (default: 17)
  --directions LIST      Comma-separated directions
  --route-prefix SPEC    Fixed prefix, e.g. U:120,L:60
  -h, --help             Show this help
`);
}

function parseArgs(): Args {
  const raw = argv.slice(2);
  let seedPath = DEFAULT_SEED;
  let romPath = DEFAULT_ROM;
  let outDir = DEFAULT_OUT_DIR;
  let frames = 3300;
  let chunk = 30;
  let stepPixels = 32;
  let beamWidth = 96;
  let maxCandidates = 8;
  let maxDeaths: number | undefined = 0;
  let targetTimer = 17;
  let routePrefix: string | undefined;
  let directions = DEFAULT_DIRECTIONS;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--seed") seedPath = requireValue(raw[++i], arg);
    else if (arg === "--rom") romPath = requireValue(raw[++i], arg);
    else if (arg === "--out-dir") outDir = requireValue(raw[++i], arg);
    else if (arg === "--frames") frames = parsePositiveInt(raw[++i], arg);
    else if (arg === "--chunk") chunk = parsePositiveInt(raw[++i], arg);
    else if (arg === "--step-pixels") stepPixels = parsePositiveInt(raw[++i], arg);
    else if (arg === "--beam-width") beamWidth = parsePositiveInt(raw[++i], arg);
    else if (arg === "--max-candidates") maxCandidates = parsePositiveInt(raw[++i], arg);
    else if (arg === "--max-deaths") maxDeaths = parseNonNegativeInt(raw[++i], arg);
    else if (arg === "--target-timer") targetTimer = parseNonNegativeInt(raw[++i], arg);
    else if (arg === "--directions") directions = parseDirections(requireValue(raw[++i], arg));
    else if (arg === "--route-prefix") routePrefix = requireValue(raw[++i], arg);
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }

  return {
    seedPath,
    romPath,
    outDir,
    frames,
    chunk,
    stepPixels,
    beamWidth,
    maxCandidates,
    maxDeaths,
    targetTimer,
    routePrefix,
    directions,
  };
}

function requireValue(raw: string | undefined, label: string): string {
  if (raw === undefined || raw === "") throw new Error(`${label} requires a value`);
  return raw;
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  const value = Number.parseInt(requireValue(raw, label), 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

function parseNonNegativeInt(raw: string | undefined, label: string): number {
  const value = Number.parseInt(requireValue(raw, label), 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}

function parseDirections(raw: string): string[] {
  const out = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (out.length === 0) throw new Error("--directions cannot be empty");
  for (const direction of out) {
    if (SCREEN_DELTA_UNITS[direction] === undefined) throw new Error(`unknown direction ${direction}`);
  }
  return out;
}

function hexToBytes(hex: string, expected: number, label: string): Uint8Array {
  if (hex.length < expected * 2) throw new Error(`${label} is shorter than ${expected} bytes`);
  const out = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readU16(buf: Uint8Array, off: number): number {
  return ((((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff) >>> 0;
}

function readU32(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

function romU32(rom: RomImage, off: number): number {
  return (
    (((rom.program[off] ?? 0) << 24) |
      ((rom.program[off + 1] ?? 0) << 16) |
      ((rom.program[off + 2] ?? 0) << 8) |
      (rom.program[off + 3] ?? 0)) >>>
    0
  );
}

function rbAbs(state: GameState, rom: RomImage, addr: number): number {
  if (addr >= WRAM && addr < WRAM + state.workRam.length) return state.workRam[addr - WRAM] ?? 0;
  if (addr >= 0 && addr < rom.program.length) return rom.program[addr] ?? 0;
  return 0;
}

function rwAbs(state: GameState, rom: RomImage, addr: number): number {
  return ((rbAbs(state, rom, addr) << 8) | rbAbs(state, rom, addr + 1)) & 0xffff;
}

function rlAbs(state: GameState, rom: RomImage, addr: number): number {
  return (((rwAbs(state, rom, addr) << 16) | rwAbs(state, rom, addr + 2)) >>> 0);
}

function s8(value: number): number {
  const v = value & 0xff;
  return v >= 0x80 ? v - 0x100 : v;
}

function s16(value: number): number {
  const v = value & 0xffff;
  return v >= 0x8000 ? v - 0x10000 : v;
}

function signedLong(value: number): number {
  return value | 0;
}

function fixed16(value: number): number {
  return signedLong(value) / 65536;
}

function hx(value: number, width = 4): string {
  return `0x${(value >>> 0).toString(16).padStart(width, "0")}`;
}

function loadSeed(path: string): SeedJson {
  return JSON.parse(readFileSync(resolve(path), "utf-8")) as SeedJson;
}

function loadRom(path: string): RomImage {
  const rom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(rom, readFileSync(resolve(path)));
  return rom;
}

function loadState(rom: RomImage, seed: SeedJson): GameState {
  const workRam = hexToBytes(seed.workRam, 0x2000, "workRam");
  const state = stateNs.emptyGameState();
  bootInit(state, rom, {
    warmState: {
      workRam,
      playfieldRam: hexToBytes(seed.playfieldRam, 0x2000, "playfieldRam"),
      spriteRam: hexToBytes(seed.spriteRam, 0x1000, "spriteRam"),
      alphaRam: hexToBytes(seed.alphaRam, 0x1000, "alphaRam"),
      colorRam: hexToBytes(seed.colorRam, 0x800, "colorRam"),
      slapsticBank: seed.slapsticBank ?? 1,
      videoScrollY: readU16(workRam, 2) & 0x1ff,
      videoScrollX: 0,
    },
  });
  state.workRam[0x390] = 0;
  state.workRam[0x391] = 0;
  state.clock.mainLoopBodyTicks = (seed.mainLoopBodyTicks ?? 1) as typeof state.clock.mainLoopBodyTicks;
  return state;
}

function expandRouteSpec(spec: string | undefined): string[] {
  if (spec === undefined || spec.trim() === "") return [];
  const out: string[] = [];
  for (const rawPart of spec.split(",")) {
    const part = rawPart.trim();
    if (part === "") continue;
    const [direction, countRaw] = part.split(":");
    if (direction === undefined || countRaw === undefined || SCREEN_DELTA_UNITS[direction] === undefined) {
      throw new Error(`invalid route part ${part}`);
    }
    const count = Number.parseInt(countRaw, 10);
    if (!Number.isInteger(count) || count < 0) throw new Error(`bad count in route part ${part}`);
    for (let i = 0; i < count; i++) out.push(direction);
  }
  return out;
}

function compressRoute(frames: readonly string[]): string {
  const out: string[] = [];
  let last: string | undefined;
  let count = 0;
  for (const frame of frames) {
    if (frame === last) {
      count++;
      continue;
    }
    if (last !== undefined) out.push(`${last}:${count}`);
    last = frame;
    count = 1;
  }
  if (last !== undefined) out.push(`${last}:${count}`);
  return out.join(",");
}

function advanceTrackball(p1X: number, p1Y: number, direction: string, stepPixels: number): readonly [number, number] {
  const [ux, uy] = SCREEN_DELTA_UNITS[direction] ?? [0, 0];
  return [(p1X - Math.round(ux * stepPixels)) & 0xff, (p1Y - Math.round(uy * stepPixels)) & 0xff];
}

function runOneFrame(rom: RomImage, state: GameState, p1X: number, p1Y: number): void {
  tick(state, {
    rom,
    runMainLoopBody: true,
    p1X,
    p1Y,
    p2X: 0xff,
    p2Y: 0xff,
    inputMmio: 0x6f,
  });
}

function type79Rows(state: GameState, rom: RomImage): Type79Row[] {
  const out: Type79Row[] = [];
  for (let off = ENTITY_LIST; off < ENTITY_END; off++) {
    const ent = state.workRam[off] ?? 0xff;
    if (ent === 0xff) break;
    const ptr = romU32(rom, ROM_ENTITY_LOOKUP + (s8(ent) << 2));
    const type = s8(rbAbs(state, rom, ptr));
    if (type !== 7 && type !== 8 && type !== 9) continue;
    const sub = rbAbs(state, rom, ptr + 1);
    const struct = romU32(rom, TYPE79_STRUCT_LOOKUP + (s8(sub) << 2));
    const d5 = s16((rwAbs(state, rom, struct + 0x20) + 0x18) & 0xffff);
    const d4 = s16((rwAbs(state, rom, struct + 0x22) + 0x10) & 0xffff);
    out.push({
      ent,
      type,
      sub,
      ptr,
      struct,
      d5,
      d4,
      visibleBinary: d4 > -0x10 && d4 < 0x100,
      visibleOldTs: d4 >= 0xf0 && d4 < 0x100,
      spritePtr: rlAbs(state, rom, rlAbs(state, rom, struct + 0x1c)),
    });
  }
  return out;
}

function surface(state: GameState, rom: RomImage): Surface {
  const allRows = type79Rows(state, rom);
  const visibleRows = allRows.filter((row) => row.visibleBinary);
  return {
    descriptor: readU32(state.workRam, 0x474),
    main: readU16(state.workRam, 0x390),
    mode: readU16(state.workRam, 0x392),
    segment: state.workRam[0x3e4] ?? 0,
    timer: readU16(state.workRam, PLAYER_OFF + 0x6a),
    playerState: state.workRam[PLAYER_OFF + 0x1a] ?? 0,
    playerX: fixed16(readU32(state.workRam, PLAYER_OFF + 0x0c)),
    playerY: fixed16(readU32(state.workRam, PLAYER_OFF + 0x10)),
    visibleRows,
    oldDroppedRows: visibleRows.filter((row) => !row.visibleOldTs),
    allRows,
  };
}

function scoreSurface(s: Surface, deathEvents: number, args: Args): number {
  const descriptorBonus = s.descriptor === L5_DESCRIPTOR ? 900_000 : -900_000;
  const playableBonus = s.main === 0 && s.mode === 0 && s.playerState === 0 ? 400_000 : -400_000;
  const timerPenalty = Math.abs(s.timer - args.targetTimer) * 150_000;
  const visibleBonus = s.visibleRows.length * 280_000 + s.oldDroppedRows.length * 120_000;
  const screenBonus = s.visibleRows.reduce((total, row) => {
    const d4Band = row.d4 >= 0 && row.d4 <= 230 ? 35_000 : 0;
    const d5Band = row.d5 >= 32 && row.d5 <= 280 ? 20_000 : 0;
    return total + d4Band + d5Band;
  }, 0);
  const deathPenalty = deathEvents * 2_000_000;
  return descriptorBonus + playableBonus + visibleBonus + screenBonus - timerPenalty - deathPenalty;
}

function cloneNodeWithBest(node: SearchNode, currentSurface: Surface, currentScore: number): SearchNode {
  if (currentScore <= node.bestScore) return node;
  return {
    ...node,
    bestScore: currentScore,
    bestFrame: node.frame,
    bestState: stateNs.snapshotGameState(node.state),
    bestRouteFrames: node.routeFrames.slice(),
    bestSurface: currentSurface,
  };
}

function tickNode(rom: RomImage, node: SearchNode, direction: string, frames: number, args: Args): SearchNode {
  let state = stateNs.snapshotGameState(node.state);
  let p1X = node.p1X;
  let p1Y = node.p1Y;
  let frame = node.frame;
  let routeFrames = node.routeFrames.slice();
  let deathEvents = node.deathEvents;
  let recoveries = node.recoveries;
  let inDeath = node.inDeath;
  let out: SearchNode = {
    ...node,
    state,
    routeFrames,
    currentScore: node.currentScore,
    deathEvents,
    recoveries,
    inDeath,
  };

  for (let i = 0; i < frames; i++) {
    frame++;
    routeFrames.push(direction);
    [p1X, p1Y] = advanceTrackball(p1X, p1Y, direction, args.stepPixels);
    runOneFrame(rom, state, p1X, p1Y);

    const playerState = state.workRam[PLAYER_OFF + 0x1a] ?? 0;
    const isDeath = playerState === 4 || playerState === 5;
    if (isDeath && !inDeath) {
      deathEvents++;
      inDeath = true;
    } else if (inDeath && playerState === 0) {
      recoveries++;
      inDeath = false;
    }

    const currentSurface = surface(state, rom);
    const currentScore = scoreSurface(currentSurface, deathEvents, args);
    out = {
      ...out,
      state,
      p1X,
      p1Y,
      frame,
      routeFrames,
      currentScore,
      deathEvents,
      recoveries,
      inDeath,
    };
    out = cloneNodeWithBest(out, currentSurface, currentScore);
  }

  return out;
}

function runPrefix(rom: RomImage, node: SearchNode, prefix: string[], args: Args): SearchNode {
  let out = node;
  for (const direction of prefix) out = tickNode(rom, out, direction, 1, args);
  return out;
}

function filterByHardLimits(nodes: SearchNode[], args: Args): SearchNode[] {
  if (args.maxDeaths === undefined) return nodes;
  return nodes.filter((node) => node.deathEvents <= args.maxDeaths!);
}

function stateBucket(node: SearchNode): string {
  const playerX = fixed16(readU32(node.state.workRam, PLAYER_OFF + 0x0c));
  const playerY = fixed16(readU32(node.state.workRam, PLAYER_OFF + 0x10));
  const timer = readU16(node.state.workRam, PLAYER_OFF + 0x6a);
  const playerState = node.state.workRam[PLAYER_OFF + 0x1a] ?? 0;
  return [
    Math.round(playerX / 16),
    Math.round(playerY / 16),
    timer,
    playerState,
    Math.min(9, node.bestSurface.visibleRows.length),
    Math.min(9, node.bestSurface.oldDroppedRows.length),
  ].join(":");
}

function selectBeam(nodes: SearchNode[], args: Args): SearchNode[] {
  nodes.sort((a, b) => b.bestScore - a.bestScore || b.currentScore - a.currentScore);
  const selected: SearchNode[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const bucket = stateBucket(node);
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    selected.push(node);
    if (selected.length >= args.beamWidth) return selected;
  }
  for (const node of nodes) {
    if (selected.includes(node)) continue;
    selected.push(node);
    if (selected.length >= args.beamWidth) return selected;
  }
  return selected;
}

function rowForJson(row: Type79Row): Record<string, unknown> {
  return {
    ent: row.ent,
    type: row.type,
    sub: row.sub,
    ptr: hx(row.ptr, 6),
    struct: hx(row.struct, 6),
    d5: row.d5,
    d4: row.d4,
    visibleBinary: row.visibleBinary,
    visibleOldTs: row.visibleOldTs,
    spritePtr: hx(row.spritePtr, 6),
  };
}

function seedForNode(node: SearchNode, seed: SeedJson, index: number, args: Args): SeedJson & Record<string, unknown> {
  return {
    name: `l5_sprite3_visibility_candidate_${String(index + 1).padStart(2, "0")}`,
    source: "TS diagnostic route from search-l5-sprite3-visibility; requires MAME/reference proof before promotion",
    frame: seed.frame === undefined ? node.bestFrame : seed.frame + node.bestFrame,
    routeFrames: node.bestFrame,
    routeSpec: compressRoute(node.bestRouteFrames),
    stepPixels: args.stepPixels,
    slapsticBank: seed.slapsticBank ?? 1,
    mainLoopBodyTicks: Number(node.bestState.clock.mainLoopBodyTicks),
    workRam: bytesToHex(node.bestState.workRam),
    playfieldRam: bytesToHex(node.bestState.playfieldRam),
    spriteRam: bytesToHex(node.bestState.spriteRam),
    alphaRam: bytesToHex(node.bestState.alphaRam),
    colorRam: bytesToHex(node.bestState.colorRam),
  };
}

function candidateForJson(node: SearchNode, index: number, seed: SeedJson): Record<string, unknown> {
  const s = node.bestSurface;
  const file = `${String(index + 1).padStart(2, "0")}_l5_sprite3_f${node.bestFrame}_timer${s.timer}.seed.json`;
  return {
    file,
    routeSpec: compressRoute(node.bestRouteFrames),
    routeFrames: node.bestFrame,
    absoluteFrame: seed.frame === undefined ? undefined : seed.frame + node.bestFrame,
    stepPixels: undefined,
    score: Math.round(node.bestScore),
    deaths: node.deathEvents,
    recoveries: node.recoveries,
    descriptor: hx(s.descriptor, 6),
    main: s.main,
    mode: s.mode,
    segment: s.segment,
    timer: s.timer,
    playerState: s.playerState,
    playerX: Number(s.playerX.toFixed(2)),
    playerY: Number(s.playerY.toFixed(2)),
    visibleCount: s.visibleRows.length,
    oldDroppedCount: s.oldDroppedRows.length,
    visibleRows: s.visibleRows.map(rowForJson),
  };
}

function printNode(index: number, node: SearchNode): void {
  const s = node.bestSurface;
  console.log(
    `${String(index + 1).padStart(2, "0")} score=${Math.round(node.bestScore)} ` +
      `bestFrame=${node.bestFrame} timer=${s.timer} state=${s.playerState} desc=${hx(s.descriptor, 6)} ` +
      `visible=${s.visibleRows.length} oldDropped=${s.oldDroppedRows.length} ` +
      `x=${s.playerX.toFixed(1)} y=${s.playerY.toFixed(1)} deaths=${node.deathEvents}`,
  );
  console.log(`   ${compressRoute(node.bestRouteFrames)}`);
}

function main(): void {
  const args = parseArgs();
  const rom = loadRom(args.romPath);
  const seed = loadSeed(args.seedPath);
  const seedState = loadState(rom, seed);
  const seedSurface = surface(seedState, rom);
  const seedScore = scoreSurface(seedSurface, 0, args);
  const prefix = expandRouteSpec(args.routePrefix);
  let initialNode: SearchNode = {
    state: seedState,
    p1X: seedState.workRam[PLAYER_OFF + 0xc9] ?? 0xff,
    p1Y: seedState.workRam[PLAYER_OFF + 0xc8] ?? 0xff,
    frame: 0,
    routeFrames: [],
    currentScore: seedScore,
    bestScore: seedScore,
    bestFrame: 0,
    bestState: stateNs.snapshotGameState(seedState),
    bestRouteFrames: [],
    bestSurface: seedSurface,
    deathEvents: 0,
    recoveries: 0,
    inDeath: false,
  };
  initialNode = runPrefix(rom, initialNode, prefix, args);

  let beam = [initialNode];
  const iterations = Math.ceil(Math.max(0, args.frames - initialNode.frame) / args.chunk);
  console.log(
    `search L5 sprite3 seed=${resolve(args.seedPath)} frames=${args.frames} chunk=${args.chunk} ` +
      `step=${args.stepPixels} beam=${args.beamWidth} targetTimer=${args.targetTimer} maxDeaths=${args.maxDeaths ?? "-"}`,
  );
  console.log(
    `initial timer=${seedSurface.timer} desc=${hx(seedSurface.descriptor, 6)} ` +
      `visible=${seedSurface.visibleRows.length} oldDropped=${seedSurface.oldDroppedRows.length}`,
  );

  for (let iteration = 1; iteration <= iterations; iteration++) {
    const remaining = args.frames - (beam[0]?.frame ?? 0);
    const framesThisChunk = Math.min(args.chunk, Math.max(0, remaining));
    if (framesThisChunk === 0) break;
    const next: SearchNode[] = [];
    for (const node of beam) {
      for (const direction of args.directions) next.push(tickNode(rom, node, direction, framesThisChunk, args));
    }
    const limited = filterByHardLimits(next, args);
    if (limited.length === 0) {
      console.log(`[search] stopping at frame ${beam[0]?.frame ?? 0}; all expansions violate hard limits`);
      break;
    }
    beam = selectBeam(limited, args);
    if (iteration % 10 === 0) printNode(0, beam[0]!);
  }

  const unique = new Map<string, SearchNode>();
  for (const node of beam.sort((a, b) => b.bestScore - a.bestScore)) {
    const route = compressRoute(node.bestRouteFrames);
    if (!unique.has(route)) unique.set(route, node);
    if (unique.size >= args.maxCandidates) break;
  }
  const candidates = Array.from(unique.values());
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const manifestCandidates = candidates.map((candidate, index) => {
    const entry = candidateForJson(candidate, index, seed);
    writeFileSync(join(outDir, String(entry.file)), `${JSON.stringify(seedForNode(candidate, seed, index, args), null, 2)}\n`);
    return { ...entry, stepPixels: args.stepPixels };
  });
  writeFileSync(
    join(outDir, "manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        interpretation:
          "TS diagnostic sprite3 visibility candidates only. Attach MAME/reference route before marking D4 green.",
        seedPath: resolve(args.seedPath),
        romPath: resolve(args.romPath),
        search: args,
        candidates: manifestCandidates,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\nTop ${candidates.length} candidate(s):`);
  candidates.forEach((candidate, index) => printNode(index, candidate));
  console.log(`\nWrote manifest: ${join(outDir, "manifest.json")}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
