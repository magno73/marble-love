#!/usr/bin/env node
/**
 * search-l4-gate-contact.ts - diagnostic route search for Aerial/L4 gates.
 *
 * This is evidence tooling only. It searches TS input routes for frames where
 * the original FUN_29CCE gate branches are both eligible and in contact range.
 * Any candidate still needs MAME active-vs-neutral proof before promotion.
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
  routePrefix: string | undefined;
  targetContactKind: string | undefined;
  directions: string[];
}

interface GateHit {
  score: number;
  routeFrame: number;
  timer: number;
  playerState: number;
  playerX: number;
  playerY: number;
  slot: number;
  type19: number;
  tag: number;
  base46: number;
  d6: number;
  a0: number;
  g694: number;
  inContact: boolean;
  contactKind: string;
  eligible: boolean;
  distance: number;
  source: string;
}

interface SearchNode {
  state: GameState;
  p1X: number;
  p1Y: number;
  frame: number;
  routeFrames: string[];
  bestHit: GateHit | undefined;
  deathEvents: number;
  recoveries: number;
  inDeath: boolean;
  score: number;
}

interface RuntimeGateProbe {
  frame: number;
  slotIndex: number;
  colorTag: number;
  result: string;
  base46: number;
  d6: number;
  a0: number;
  g694: number;
}

const DEFAULT_SEED = "packages/web/public/scenarios/playable/start_level4_intro_aerial_f2414.seed.json";
const DEFAULT_ROM = "ghidra_project/marble_program.bin";
const DEFAULT_OUT_DIR = "/tmp/marble-sprite-goal/current-run/l4-gate-contact-search";
const PLAYER_OFF = 0x18;
const SLOT_TABLE = 0xa9c;
const SLOT_STRIDE = 0x56;
const DEFAULT_DIRECTIONS = ["D", "R", "L", "DR", "DL", "UR", "UL", "U", "N"];
const SCREEN_DELTA_UNITS: Record<string, readonly [number, number]> = {
  D: [0, 1],
  U: [0, -1],
  R: [1, 0],
  L: [-1, 0],
  DR: [1, 1],
  DL: [-1, 1],
  UR: [1, -1],
  UL: [-1, -1],
  N: [0, 0],
};

function printHelp(): void {
  console.log(`search-l4-gate-contact - TS diagnostic route search

Usage:
  npx tsx packages/cli/src/search-l4-gate-contact.ts [options]

Options:
  --seed PATH            Seed JSON (default: ${DEFAULT_SEED})
  --rom PATH             Program ROM blob (default: ${DEFAULT_ROM})
  --out-dir DIR          Output dir (default: ${DEFAULT_OUT_DIR})
  --frames N             Search horizon in route frames (default: 2400)
  --chunk N              Frames per beam expansion (default: 30)
  --step-pixels N        Trackball screen-space delta per frame (default: 32)
  --beam-width N         Nodes retained per expansion (default: 128)
  --max-candidates N     Routes/seeds written to manifest (default: 8)
  --max-deaths N         Hard cap on death events
  --directions LIST      Comma-separated directions
  --route-prefix SPEC    Fixed prefix, e.g. D:120,DL:30
  --target-contact KIND  Require a runtime contact kind substring, e.g. inner-hit-state
  -h, --help             Show this help
`);
}

function parseArgs(): Args {
  const raw = argv.slice(2);
  let seedPath = DEFAULT_SEED;
  let romPath = DEFAULT_ROM;
  let outDir = DEFAULT_OUT_DIR;
  let frames = 2400;
  let chunk = 30;
  let stepPixels = 32;
  let beamWidth = 128;
  let maxCandidates = 8;
  let maxDeaths: number | undefined;
  let routePrefix: string | undefined;
  let targetContactKind: string | undefined;
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
    else if (arg === "--route-prefix") routePrefix = requireValue(raw[++i], arg);
    else if (arg === "--target-contact") targetContactKind = requireValue(raw[++i], arg);
    else if (arg === "--directions") directions = parseDirections(requireValue(raw[++i], arg));
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
    routePrefix,
    targetContactKind,
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
    if (SCREEN_DELTA_UNITS[direction] === undefined) {
      throw new Error(`unknown direction ${direction}`);
    }
  }
  return out;
}

function hexToBytes(hex: string, expected: number, label: string): Uint8Array {
  if (hex.length < expected * 2) throw new Error(`${label} is shorter than ${expected} bytes`);
  const out = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
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

function signed32(value: number): number {
  return value | 0;
}

function fixed16(value: number): number {
  return signed32(value) / 65536;
}

function hx(value: number, width = 4): string {
  return `0x${(value >>> 0).toString(16).padStart(width, "0")}`;
}

function loadSeed(path: string): SeedJson {
  return JSON.parse(readFileSync(resolve(path), "utf-8")) as SeedJson;
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
  for (const part of spec.split(",")) {
    const [direction, countRaw] = part.trim().split(":");
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
  const dx = Math.round(ux * stepPixels);
  const dy = Math.round(uy * stepPixels);
  return [(p1X - dx) & 0xff, (p1Y - dy) & 0xff];
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

function distanceToRange(value: number, minInclusive: number, maxExclusive: number): number {
  if (value < minInclusive) return minInclusive - value;
  if (value >= maxExclusive) return value - (maxExclusive - 1);
  return 0;
}

function distanceToBox(d6: number, a0: number, minD6: number, maxD6: number, minA0: number, maxA0: number): number {
  return distanceToRange(d6, minD6, maxD6) + distanceToRange(a0, minA0, maxA0);
}

function classifyGateContact(tag: number, base46: number, d6: number, a0: number, g694: number): {
  eligible: boolean;
  inContact: boolean;
  contactKind: string;
  distance: number;
} {
  if (tag === 0x0b) {
    const eligible = base46 === 0x00022016;
    const impulseDist = distanceToBox(d6, a0, -0x0c, 0x1c, -0x20, -0x08);
    const innerDist = distanceToBox(d6, a0, 0, 0x10, -0x0f, -0x09);
    const outerDist = g694 < 0x3fc4 ? distanceToBox(d6, a0, -0x0c, 0x1c, -0x08, 0x10) : 999;
    const distance = Math.min(impulseDist, innerDist, outerDist);
    if (!eligible) return { eligible, inContact: false, contactKind: "tag0b-not-eligible", distance };
    if (innerDist === 0) return { eligible, inContact: true, contactKind: "tag0b-inner-state10", distance: 0 };
    if (impulseDist === 0) return { eligible, inContact: true, contactKind: "tag0b-impulse", distance: 0 };
    if (outerDist === 0) return { eligible, inContact: true, contactKind: "tag0b-outer-block", distance: 0 };
    return { eligible, inContact: false, contactKind: "tag0b-eligible-near", distance };
  }

  if (tag === 0x0d) {
    const eligible = base46 === 0x000220a6;
    const impulseDist = distanceToBox(d6, a0, -0x20, -0x08, -0x0c, 0x1c);
    const innerDist = distanceToBox(d6, a0, -0x0f, -0x09, 0, 0x10);
    const outerDist = g694 < 0x3fc4 ? distanceToBox(d6, a0, -0x0c, 0x1c, -0x08, 0x10) : 999;
    const distance = Math.min(impulseDist, innerDist, outerDist);
    if (!eligible) return { eligible, inContact: false, contactKind: "tag0d-not-eligible", distance };
    if (innerDist === 0) return { eligible, inContact: true, contactKind: "tag0d-inner-state10", distance: 0 };
    if (impulseDist === 0) return { eligible, inContact: true, contactKind: "tag0d-impulse", distance: 0 };
    if (outerDist === 0) return { eligible, inContact: true, contactKind: "tag0d-outer-block", distance: 0 };
    return { eligible, inContact: false, contactKind: "tag0d-eligible-near", distance };
  }

  return { eligible: false, inContact: false, contactKind: "not-gate", distance: 999 };
}

function isRuntimeGateContact(result: string): boolean {
  return (
    result === "inner-hit-state" ||
    result === "inner-impulse" ||
    result === "outer-block-flags" ||
    result === "outer-death-state4"
  );
}

function bestGateHit(state: GameState, routeFrame: number, args: Args): GateHit | undefined {
  const timer = readU16(state.workRam, PLAYER_OFF + 0x6a);
  const playerState = state.workRam[PLAYER_OFF + 0x1a] ?? 0;
  const playerX = fixed16(readU32(state.workRam, PLAYER_OFF + 0x0c));
  const playerY = fixed16(readU32(state.workRam, PLAYER_OFF + 0x10));
  const probe = (state.debug as { lastTerrainGateProbe?: RuntimeGateProbe } | undefined)?.lastTerrainGateProbe;
  if (probe === undefined || probe.frame !== Number(state.clock.frame)) return undefined;
  const tag = probe.colorTag;
  if (tag !== 0x0b && tag !== 0x0d) return undefined;

  const classified = classifyGateContact(tag, probe.base46, probe.d6, probe.a0, probe.g694);
  const isContact = isRuntimeGateContact(probe.result);
  const contactKind = isContact ? `runtime-${probe.result}` : probe.result;
  const targetMatched = args.targetContactKind === undefined || contactKind.includes(args.targetContactKind);
  const isTargetContact = isContact && targetMatched;
  const distance = isTargetContact ? 0 : classified.distance;
  const score =
    (classified.eligible ? 1_000_000 : 0) +
    (isTargetContact ? 4_500_000 : 0) -
    (isContact && !targetMatched ? 500_000 : 0) -
    distance * 8_000 -
    (playerState === 4 || playerState === 5 ? 30_000 : 0) +
    Math.max(0, 90 - Math.abs(timer - 48)) * 100;

  return {
    score,
    routeFrame,
    timer,
    playerState,
    playerX,
    playerY,
    slot: probe.slotIndex,
    type19: state.workRam[SLOT_TABLE + probe.slotIndex * SLOT_STRIDE + 0x19] ?? 0,
    tag,
    base46: probe.base46,
    d6: probe.d6,
    a0: probe.a0,
    g694: probe.g694,
    eligible: classified.eligible,
    inContact: isTargetContact,
    contactKind,
    distance,
    source: "runtime-gate-probe",
  };
}

function nodeScore(node: SearchNode): number {
  const hitScore = node.bestHit?.score ?? -2_000_000;
  const deathPenalty = node.deathEvents * 90_000;
  const recoveryBonus = node.recoveries * 5_000;
  const currentPlayerState = node.state.workRam[PLAYER_OFF + 0x1a] ?? 0;
  const liveBonus = currentPlayerState === 0 ? 40_000 : 0;
  return hitScore - deathPenalty + recoveryBonus + liveBonus;
}

function tickNode(rom: RomImage, node: SearchNode, direction: string, frames: number, args: Args): SearchNode {
  const state = stateNs.snapshotGameState(node.state);
  let p1X = node.p1X;
  let p1Y = node.p1Y;
  let routeFrame = node.frame;
  let bestHit = node.bestHit;
  let deathEvents = node.deathEvents;
  let recoveries = node.recoveries;
  let inDeath = node.inDeath;
  const routeFrames = node.routeFrames.slice();

  for (let i = 0; i < frames; i++) {
    routeFrame++;
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

    const hit = bestGateHit(state, routeFrame, args);
    if (hit !== undefined && (bestHit === undefined || hit.score > bestHit.score)) {
      bestHit = hit;
    }
  }

  const out: SearchNode = {
    state,
    p1X,
    p1Y,
    frame: routeFrame,
    routeFrames,
    bestHit,
    deathEvents,
    recoveries,
    inDeath,
    score: 0,
  };
  out.score = nodeScore(out);
  return out;
}

function filterByHardLimits(nodes: SearchNode[], args: Args): SearchNode[] {
  if (args.maxDeaths === undefined) return nodes;
  return nodes.filter((node) => node.deathEvents <= args.maxDeaths!);
}

function stateBucket(node: SearchNode): string {
  const x = Math.round(fixed16(readU32(node.state.workRam, PLAYER_OFF + 0x0c)) / 8);
  const y = Math.round(fixed16(readU32(node.state.workRam, PLAYER_OFF + 0x10)) / 8);
  const timer = readU16(node.state.workRam, PLAYER_OFF + 0x6a);
  const hit = node.bestHit;
  return [
    x,
    y,
    Math.floor(timer / 2),
    node.state.workRam[PLAYER_OFF + 0x1a] ?? 0,
    hit?.slot ?? -1,
    hit?.eligible ? 1 : 0,
    hit?.distance ?? 999,
  ].join(":");
}

function selectBeam(nodes: SearchNode[], args: Args): SearchNode[] {
  nodes.sort((a, b) => b.score - a.score);
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

function hitForJson(hit: GateHit | undefined): Record<string, unknown> | undefined {
  if (hit === undefined) return undefined;
  return {
    score: hit.score,
    routeFrame: hit.routeFrame,
    timer: hit.timer,
    playerState: hit.playerState,
    playerX: Number(hit.playerX.toFixed(2)),
    playerY: Number(hit.playerY.toFixed(2)),
    slot: hit.slot,
    type19: hit.type19,
    tag: hx(hit.tag, 2),
    base46: hx(hit.base46, 6),
    d6: hit.d6,
    a0: hit.a0,
    g694: hx(hit.g694),
    eligible: hit.eligible,
    inContact: hit.inContact,
    contactKind: hit.contactKind,
    distance: hit.distance,
    source: hit.source,
  };
}

function seedForNode(node: SearchNode, seed: SeedJson, index: number): SeedJson {
  return {
    name: `l4_gate_contact_candidate_${String(index + 1).padStart(2, "0")}`,
    frame: seed.frame === undefined ? node.frame : seed.frame + node.frame,
    slapsticBank: seed.slapsticBank ?? 1,
    mainLoopBodyTicks: Number(node.state.clock.mainLoopBodyTicks),
    workRam: bytesToHex(node.state.workRam),
    playfieldRam: bytesToHex(node.state.playfieldRam),
    spriteRam: bytesToHex(node.state.spriteRam),
    alphaRam: bytesToHex(node.state.alphaRam),
    colorRam: bytesToHex(node.state.colorRam),
  };
}

function printNode(index: number, node: SearchNode): void {
  const hit = node.bestHit;
  const timer = readU16(node.state.workRam, PLAYER_OFF + 0x6a);
  const state1a = node.state.workRam[PLAYER_OFF + 0x1a] ?? 0;
  const x = fixed16(readU32(node.state.workRam, PLAYER_OFF + 0x0c));
  const y = fixed16(readU32(node.state.workRam, PLAYER_OFF + 0x10));
  console.log(
    `${String(index + 1).padStart(2, "0")} score=${node.score.toFixed(0)} frame=${node.frame} timer=${timer} ` +
      `state=${state1a} x=${x.toFixed(1)} y=${y.toFixed(1)} deaths=${node.deathEvents} ` +
      `hit=${hit?.contactKind ?? "-"} hitFrame=${hit?.routeFrame ?? "-"} dist=${hit?.distance ?? "-"} ` +
      `slot=${hit?.slot ?? "-"} tag=${hit === undefined ? "-" : hx(hit.tag, 2)} base46=${hit === undefined ? "-" : hx(hit.base46, 6)} ` +
      `d6=${hit?.d6 ?? "-"} a0=${hit?.a0 ?? "-"}`,
  );
  console.log(`   ${compressRoute(node.routeFrames)}`);
}

function main(): void {
  const args = parseArgs();
  const seed = loadSeed(args.seedPath);
  const rom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(rom, readFileSync(resolve(args.romPath)));
  const initialState = loadState(rom, seed);
  const prefixFrames = expandRouteSpec(args.routePrefix);

  let initial: SearchNode = {
    state: initialState,
    p1X: initialState.workRam[PLAYER_OFF + 0xc9] ?? 0xff,
    p1Y: initialState.workRam[PLAYER_OFF + 0xc8] ?? 0xff,
    frame: 0,
    routeFrames: [],
    bestHit: bestGateHit(initialState, 0, args),
    deathEvents: 0,
    recoveries: 0,
    inDeath: false,
    score: 0,
  };
  initial.score = nodeScore(initial);
  for (const direction of prefixFrames) initial = tickNode(rom, initial, direction, 1, args);

  let beam = [initial];
  const iterations = Math.ceil(Math.max(0, args.frames - initial.frame) / args.chunk);
  console.log(
    `search seed=${resolve(args.seedPath)} frames=${args.frames} chunk=${args.chunk} ` +
      `stepPixels=${args.stepPixels} beam=${args.beamWidth} directions=${args.directions.join("/")} ` +
      `maxDeaths=${args.maxDeaths ?? "-"} targetContact=${args.targetContactKind ?? "-"} ` +
      `prefixFrames=${prefixFrames.length}`,
  );

  for (let iteration = 1; iteration <= iterations; iteration++) {
    const remainingFrames = args.frames - (beam[0]?.frame ?? 0);
    const framesThisChunk = Math.min(args.chunk, Math.max(0, remainingFrames));
    if (framesThisChunk <= 0) break;
    const next: SearchNode[] = [];
    for (const node of beam) {
      for (const direction of args.directions) {
        next.push(tickNode(rom, node, direction, framesThisChunk, args));
      }
    }
    const limited = filterByHardLimits(next, args);
    if (limited.length === 0) {
      console.log(`[search] stopping at frame ${beam[0]?.frame ?? 0}; all expansions violate hard limits`);
      break;
    }
    beam = selectBeam(limited, args);
    const best = beam[0]!;
    if (iteration % 10 === 0 || best.bestHit?.inContact === true) printNode(0, best);
    if (best.bestHit?.inContact === true && args.maxDeaths !== undefined && best.deathEvents <= args.maxDeaths) {
      // Keep one more chunk's worth of alternatives from this frame, then stop.
      if (iteration > 1) break;
    }
  }

  const candidates = beam
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, args.maxCandidates);

  mkdirSync(resolve(args.outDir), { recursive: true });
  const manifestCandidates = candidates.map((node, index) => {
    const file = `${String(index + 1).padStart(2, "0")}_l4_gate_contact_f${node.frame}.seed.json`;
    writeFileSync(join(resolve(args.outDir), file), `${JSON.stringify(seedForNode(node, seed, index))}\n`);
    return {
      file,
      routeSpec: compressRoute(node.routeFrames),
      routeFrames: node.frame,
      stepPixels: args.stepPixels,
      timer: readU16(node.state.workRam, PLAYER_OFF + 0x6a),
      playerState: node.state.workRam[PLAYER_OFF + 0x1a] ?? 0,
      playerX: Number(fixed16(readU32(node.state.workRam, PLAYER_OFF + 0x0c)).toFixed(2)),
      playerY: Number(fixed16(readU32(node.state.workRam, PLAYER_OFF + 0x10)).toFixed(2)),
      deathEvents: node.deathEvents,
      recoveries: node.recoveries,
      score: node.score,
      bestHit: hitForJson(node.bestHit),
    };
  });
  const manifest = {
    generatedAt: new Date().toISOString(),
    interpretation:
      "TS diagnostic gate-contact candidates only. Replay active-vs-neutral in MAME before treating as proof.",
    seedPath: resolve(args.seedPath),
    romPath: resolve(args.romPath),
    search: args,
    candidates: manifestCandidates,
  };
  writeFileSync(join(resolve(args.outDir), "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\nTop ${candidates.length} candidate(s):`);
  candidates.forEach((node, index) => printNode(index, node));
  console.log(`\nWrote manifest: ${join(resolve(args.outDir), "manifest.json")}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
