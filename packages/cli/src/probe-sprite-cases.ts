#!/usr/bin/env node
/**
 * probe-sprite-cases.ts — focused evidence probe for the four sprite PRD cases.
 *
 * Loads a gameplay scenario or playable seed, optionally replays a short
 * trackball route, then prints the layers relevant to sprite visibility and
 * sprite collision:
 *   - entity draw list at 0x4003BC via ROM lookup table 0x1F0E2;
 *   - type 7/8/9 and type 0x2C coordinate/visibility calculations;
 *   - active FUN_29CCE terrain/collision slot table entries;
 *   - linked-list and all-bank motion-object frame counts.
 *
 * This is diagnostic only. It does not write seeds or change startLevel wiring.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit } from "node:process";

import {
  applySlapsticBank,
  bootInit,
  bus as busNs,
  render as renderNs,
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

interface ScenarioJson {
  snapshots?: SeedJson[];
}

interface Args {
  paths: string[];
  snapshotIndex: number;
  ticks: number;
  stepPixels: number;
  plan: string | undefined;
  dispatcher: "preserved" | "manual";
  timelineEvery: number;
  json: boolean;
}

const DEFAULT_STEP_PIXELS = 8;
const WRAM = 0x00400000;
const ENTITY_LIST = 0x3bc;
const ENTITY_END = 0x3dc;
const ROM_ENTITY_LOOKUP = 0x1f0e2;
const ROM_TYPE4_LOOKUP = 0x1f006;
const SLOT_TABLE = 0xa9c;
const SLOT_STRIDE = 0x56;
const SLOT_COUNT = 0x19;

const SCREEN_DELTAS: Record<string, readonly [number, number]> = {
  N: [0, 0],
  U: [0, -8],
  D: [0, 8],
  L: [-8, 0],
  R: [8, 0],
  UL: [-8, -8],
  UR: [8, -8],
  DL: [-8, 8],
  DR: [8, 8],
  BL: [-4, 6],
  BR: [4, -6],
};

function parseArgs(): Args {
  const paths: string[] = [];
  let snapshotIndex = 0;
  let ticks = 0;
  let stepPixels = DEFAULT_STEP_PIXELS;
  let plan: string | undefined;
  let dispatcher: Args["dispatcher"] = "preserved";
  let timelineEvery = 0;
  let json = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--snapshot-index") {
      snapshotIndex = parseInt(requireValue(argv[++i], arg), 10);
    } else if (arg === "--ticks") {
      ticks = parseInt(requireValue(argv[++i], arg), 10);
    } else if (arg === "--step-pixels") {
      stepPixels = parseInt(requireValue(argv[++i], arg), 10);
    } else if (arg === "--plan") {
      plan = requireValue(argv[++i], arg);
    } else if (arg === "--dispatcher") {
      const value = requireValue(argv[++i], arg);
      if (value !== "preserved" && value !== "manual") {
        throw new Error("--dispatcher must be preserved or manual");
      }
      dispatcher = value;
    } else if (arg === "--timeline-every") {
      timelineEvery = parseInt(requireValue(argv[++i], arg), 10);
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      paths.push(arg);
    }
  }

  if (!Number.isInteger(snapshotIndex) || snapshotIndex < 0) {
    throw new Error("--snapshot-index must be a non-negative integer");
  }
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error("--ticks must be a non-negative integer");
  }
  if (!Number.isInteger(stepPixels) || stepPixels < 1) {
    throw new Error("--step-pixels must be a positive integer");
  }
  if (!Number.isInteger(timelineEvery) || timelineEvery < 0) {
    throw new Error("--timeline-every must be a non-negative integer");
  }
  if (paths.length === 0) throw new Error("at least one seed/scenario path is required");
  return { paths, snapshotIndex, ticks, stepPixels, plan, dispatcher, timelineEvery, json };
}

function printHelp(): void {
  console.log(`Usage:
  npx tsx packages/cli/src/probe-sprite-cases.ts [options] seed-or-scenario.json [...]

Options:
  --snapshot-index N   Scenario snapshot index, default 0
  --ticks N            Neutral ticks to replay after load, default 0
  --step-pixels N      Trackball screen-space delta per route frame, default ${DEFAULT_STEP_PIXELS}
  --plan SPEC          Route spec, e.g. L:120,D:40,N:10
  --dispatcher MODE    preserved or manual, default preserved
  --timeline-every N   Include compact timeline samples every N route frames
  --json               Emit JSON instead of text
`);
}

function requireValue(raw: string | undefined, label: string): string {
  if (raw === undefined || raw === "") throw new Error(`${label} requires a value`);
  return raw;
}

function hexToBytes(hex: string, expected: number, label: string): Uint8Array {
  if (hex.length < expected * 2) throw new Error(`${label} is shorter than ${expected} bytes`);
  const out = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
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

function loadSeed(path: string, snapshotIndex: number): SeedJson {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8")) as ScenarioJson | SeedJson;
  if ("snapshots" in raw && Array.isArray(raw.snapshots)) {
    const seed = raw.snapshots[snapshotIndex];
    if (seed === undefined) throw new Error(`${path} has no snapshot index ${snapshotIndex}`);
    return seed;
  }
  if (snapshotIndex !== 0) throw new Error(`${path} is a seed JSON; use --snapshot-index 0`);
  return raw as SeedJson;
}

function loadState(rom: RomImage, seed: SeedJson, dispatcher: Args["dispatcher"]): GameState {
  const state = stateNs.emptyGameState();
  bootInit(state, rom, {
    warmState: {
      workRam: hexToBytes(seed.workRam, 0x2000, "workRam"),
      playfieldRam: hexToBytes(seed.playfieldRam, 0x2000, "playfieldRam"),
      spriteRam: hexToBytes(seed.spriteRam, 0x1000, "spriteRam"),
      alphaRam: hexToBytes(seed.alphaRam, 0x1000, "alphaRam"),
      colorRam: hexToBytes(seed.colorRam, 0x800, "colorRam"),
      slapsticBank: seed.slapsticBank ?? 1,
      videoScrollY: readU16(hexToBytes(seed.workRam, 0x2000, "workRam"), 2) & 0x1ff,
      videoScrollX: 0,
    },
  });
  if (dispatcher === "manual") {
    state.workRam[0x390] = 0;
    state.workRam[0x391] = 0;
  }
  state.clock.mainLoopBodyTicks = (seed.mainLoopBodyTicks ?? 1) as typeof state.clock.mainLoopBodyTicks;
  return state;
}

function expandRoute(spec: string | undefined, ticks: number): string[] {
  if (spec === undefined) return Array.from({ length: ticks }, () => "N");
  const out: string[] = [];
  for (const part of spec.split(",")) {
    const [label, countRaw] = part.trim().split(":");
    if (label === undefined || countRaw === undefined || SCREEN_DELTAS[label] === undefined) {
      throw new Error(`invalid route part ${part}`);
    }
    const count = parseInt(countRaw, 10);
    if (!Number.isInteger(count) || count < 0) throw new Error(`bad count in route part ${part}`);
    for (let i = 0; i < count; i++) out.push(label);
  }
  return out;
}

function advanceInput(
  p1X: number,
  p1Y: number,
  step: string,
  stepPixels: number,
): readonly [number, number] {
  const [dx, dy] = SCREEN_DELTAS[step] ?? [0, 0];
  const unitX = dx / DEFAULT_STEP_PIXELS;
  const unitY = dy / DEFAULT_STEP_PIXELS;
  const scaledDx = Math.round(unitX * stepPixels);
  const scaledDy = Math.round(unitY * stepPixels);
  return [
    (p1X + (scaledDx === 0 ? 0 : -scaledDx)) & 0xff,
    (p1Y + (scaledDy === 0 ? 0 : -scaledDy)) & 0xff,
  ];
}

function replayRoute(
  state: GameState,
  rom: RomImage,
  plan: readonly string[],
  stepPixels: number,
  timelineEvery: number,
): Record<string, unknown>[] {
  let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
  let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
  const timeline: Record<string, unknown>[] = [];
  for (let frame = 1; frame <= plan.length; frame++) {
    const step = plan[frame - 1]!;
    [p1X, p1Y] = advanceInput(p1X, p1Y, step, stepPixels);
    tick(state, {
      rom,
      runMainLoopBody: true,
      p1X,
      p1Y,
      p2X: 0xff,
      p2Y: 0xff,
      inputMmio: 0x6f,
    });
    if (timelineEvery > 0 && frame % timelineEvery === 0) {
      timeline.push(timelineSample(state, rom, frame));
    }
  }
  if (timelineEvery > 0 && plan.length > 0 && plan.length % timelineEvery !== 0) {
    timeline.push(timelineSample(state, rom, plan.length));
  }
  return timeline;
}

function entityList(state: GameState, rom: RomImage): unknown[] {
  const out: unknown[] = [];
  for (let off = ENTITY_LIST; off < ENTITY_END; off++) {
    const ent = state.workRam[off] ?? 0xff;
    if (ent === 0xff) break;
    const ptr = romU32(rom, ROM_ENTITY_LOOKUP + (s8(ent) << 2));
    const type = s8(rbAbs(state, rom, ptr));
    const sub = rbAbs(state, rom, ptr + 1);
    const row: Record<string, unknown> = { listOff: hx(WRAM + off, 6), ent, ptr: hx(ptr, 6), type, sub };
    if (type === 7 || type === 8 || type === 9) {
      const sp = romU32(rom, 0x1f096 + (s8(sub) << 2));
      const d5 = (rwAbs(state, rom, sp + 0x20) + 0x18) & 0xffff;
      const d4 = (rwAbs(state, rom, sp + 0x22) + 0x10) & 0xffff;
      row.struct = hx(sp, 6);
      row.d5 = s16(d5);
      row.d4 = s16(d4);
      row.visibleBinary = s16(d4) > -0x10 && s16(d4) < 0x100;
      row.visibleOldTs = s16(d4) >= 0xf0 && s16(d4) < 0x100;
      row.spritePtr = hx(rlAbs(state, rom, rlAbs(state, rom, sp + 0x1c)), 6);
    } else if (type === 0x2c) {
      const base = 0x400a9c + s8(sub) * 10;
      const d5 = s16(rwAbs(state, rom, base)) >> 4;
      const d4 = (s16(rwAbs(state, rom, base + 2)) >> 4) + 0x10;
      const local = rwAbs(state, rom, base + 8);
      row.base = hx(base, 6);
      row.d5 = d5;
      row.d4 = d4;
      row.local = hx(local);
      row.spriteCodes = [hx((s16(local) | 0x10001) & 0xffff), hx((s16(local) | 0x10003) & 0xffff)];
    } else if (type === 4) {
      const structPtr = romU32(rom, ROM_TYPE4_LOOKUP + (s8(sub) << 2));
      const d5 = (rwAbs(state, rom, structPtr + 0x28) + 0x18) & 0xffff;
      const d4 = (rwAbs(state, rom, structPtr + 0x2a) + 0x10) & 0xffff;
      const celListPtr = rlAbs(state, rom, structPtr + 0x58);
      const activeCelPtr = rlAbs(state, rom, celListPtr);
      row.struct = hx(structPtr, 6);
      row.d5 = s16(d5);
      row.d4 = s16(d4);
      row.visibleBinary = s16(d4) > -0x20 && s16(d4) < 0x100;
      row.celListPtr = hx(celListPtr, 6);
      row.activeCelPtr = hx(activeCelPtr, 6);
      row.moBlock = motionBlockHeader(state, rom, activeCelPtr);
      row.innerRecords = type4InnerRecords(state, rom, structPtr);
    } else if (type === 2) {
      Object.assign(row, romType2Diagnostic(state, rom, sub));
    } else if (type === 5) {
      Object.assign(row, romType5Diagnostic(state, rom, sub));
    } else if (type === 10) {
      Object.assign(row, romType10Diagnostic(state, rom, sub));
    } else if (type === 11 || type === 13) {
      Object.assign(row, romType11_13Diagnostic(state, rom, sub));
    }
    out.push(row);
  }
  return out;
}

function collisionSlotForSub(state: GameState, sub: number): Record<string, unknown> | undefined {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const base = SLOT_TABLE + i * SLOT_STRIDE;
    if ((state.workRam[base + 0x18] ?? 0) === 0) continue;
    if ((state.workRam[base + 0x19] ?? 0) !== (sub & 0xff)) continue;
    const tag = state.workRam[base + 0x1f] ?? 0;
    const base46 = readU32(state.workRam, base + 0x46);
    return {
      slot: i,
      addr: hx(WRAM + base, 6),
      tag1f: hx(tag, 2),
      scriptState1a: state.workRam[base + 0x1a] ?? 0,
      scriptKind1b: state.workRam[base + 0x1b] ?? 0,
      base46: hx(base46, 6),
      fun29cceBranch: classifyCollisionBranch(tag, base46),
    };
  }
  return undefined;
}

function romType2Diagnostic(state: GameState, rom: RomImage, sub: number): Record<string, unknown> {
  const structPtr = romU32(rom, 0x1effe + (s8(sub) << 2));
  const d5 = (rwAbs(state, rom, structPtr + 0x1e) + 0x18) & 0xffff;
  const d4 = (rwAbs(state, rom, structPtr + 0x20) + 0x10) & 0xffff;
  const byte18 = rbAbs(state, rom, structPtr + 0x18);
  const active1c = rbAbs(state, rom, structPtr + 0x1c);
  const celListPtr = byte18 === 2 ? rlAbs(state, rom, structPtr + 0x5a) : 0x00021f36;
  const activeCelPtr = byte18 === 2 ? rlAbs(state, rom, celListPtr) : celListPtr;
  const tailListPtr = rlAbs(state, rom, structPtr + 0x62);
  const tailCelPtr = rlAbs(state, rom, tailListPtr);
  return {
    struct: hx(structPtr, 6),
    active1c,
    mode18: hx(byte18, 2),
    d5: s16(d5),
    d4: s16(d4),
    visibleBinary: active1c !== 0,
    celListPtr: hx(celListPtr, 6),
    activeCelPtr: hx(activeCelPtr, 6),
    moBlock: motionBlockHeader(state, rom, activeCelPtr),
    innerRecords: type2InnerRecords(state, rom, structPtr),
    tailActive67: rbAbs(state, rom, structPtr + 0x67),
    tailCelListPtr: hx(tailListPtr, 6),
    tailActiveCelPtr: hx(tailCelPtr, 6),
  };
}

function romType5Diagnostic(state: GameState, rom: RomImage, sub: number): Record<string, unknown> {
  const structPtr = romU32(rom, 0x1f016 + (s8(sub) << 2));
  const d5 = (rwAbs(state, rom, structPtr + 0x4e) + 0x17) & 0xffff;
  const d4 = (rwAbs(state, rom, structPtr + 0x50) + 0x10) & 0xffff;
  const celListPtr = rlAbs(state, rom, structPtr + 0x42);
  const activeCelPtr = rlAbs(state, rom, celListPtr);
  return {
    struct: hx(structPtr, 6),
    marker1f: hx(rbAbs(state, rom, structPtr + 0x1f), 2),
    d5: s16(d5),
    d4: s16(d4),
    visibleBinary: s16(d4) > -0x40 && s16(d4) < 0x100,
    celListPtr: hx(celListPtr, 6),
    activeCelPtr: hx(activeCelPtr, 6),
    moBlock: motionBlockHeader(state, rom, activeCelPtr),
    collisionSlot: collisionSlotForSub(state, sub),
  };
}

function romType10Diagnostic(state: GameState, rom: RomImage, sub: number): Record<string, unknown> {
  const structPtr = romU32(rom, 0x1f016 + (s8(sub) << 2));
  const d5 = (rwAbs(state, rom, structPtr + 0x4e) + 0x18) & 0xffff;
  const d4 = (rwAbs(state, rom, structPtr + 0x50) + 0x10) & 0xffff;
  const marker = rbAbs(state, rom, structPtr + 0x1f);
  const celListPtr = rlAbs(state, rom, structPtr + 0x42);
  const activeCelPtr = rlAbs(state, rom, celListPtr);
  const lower = marker === 0x0a ? -0x40 : 0xc0;
  return {
    struct: hx(structPtr, 6),
    marker1f: hx(marker, 2),
    d5: s16(d5),
    d4: s16(d4),
    visibleBinary: s16(d4) >= lower && s16(d4) < 0x120,
    lowerCull: lower,
    celListPtr: hx(celListPtr, 6),
    activeCelPtr: hx(activeCelPtr, 6),
    moBlock: motionBlockHeader(state, rom, activeCelPtr),
    collisionSlot: collisionSlotForSub(state, sub),
  };
}

function romType11_13Diagnostic(state: GameState, rom: RomImage, sub: number): Record<string, unknown> {
  const structPtr = romU32(rom, 0x1f016 + (s8(sub) << 2));
  const d5 = (rwAbs(state, rom, structPtr + 0x4e) + 0x18) & 0xffff;
  const d4 = (rwAbs(state, rom, structPtr + 0x50) + 0x10) & 0xffff;
  const marker = rbAbs(state, rom, structPtr + 0x1f);
  const celListPtr = rlAbs(state, rom, structPtr + 0x42);
  const activeCelPtr = rlAbs(state, rom, celListPtr);
  return {
    struct: hx(structPtr, 6),
    marker1f: hx(marker, 2),
    d5: s16(d5),
    d4: s16(d4),
    visibleBinary: s16(d4) > -0x20 && s16(d4) < 0x100,
    celListPtr: hx(celListPtr, 6),
    activeCelPtr: hx(activeCelPtr, 6),
    moBlock: motionBlockHeader(state, rom, activeCelPtr),
    directOverlay: type11_13DirectOverlay(d5, d4, marker),
    collisionSlot: collisionSlotForSub(state, sub),
  };
}

function type11_13DirectOverlay(d5base: number, d4base: number, marker: number): Record<string, unknown>[] {
  let d5 = (d5base - 8) & 0xffff;
  let d4 = (d4base + 0xffc0) & 0xffff;
  if ((marker & 0xff) === 0x0d) d4 = (d4 + 4) & 0xffff;

  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < 2; i++) {
    out.push({
      index: i,
      code: "0x0500",
      d5: s16(d5),
      d4: s16(d4),
      yFlags: (marker & 0xff) === 0x0d ? "0x8006" : "0x0006",
    });
    if ((marker & 0xff) === 0x0d) d4 = (d4 - 4) & 0xffff;
    else d4 = (d4 + 4) & 0xffff;
    d5 = (d5 + 8) & 0xffff;
  }
  return out;
}

function motionBlockHeader(state: GameState, rom: RomImage, headerPtr: number): Record<string, unknown> {
  if (headerPtr === 0xffffffff) return { sentinel: true };
  const bodyRaw = rlAbs(state, rom, headerPtr + 8);
  const bodyPtr = bodyRaw & 0xfffffffe;
  const first = rbAbs(state, rom, bodyPtr);
  const isShortBranch = first === 0xff;
  return {
    headerPtr: hx(headerPtr, 6),
    xBiasByte: s8(rbAbs(state, rom, headerPtr)),
    yBiasByte: s8(rbAbs(state, rom, headerPtr + 1)),
    bodyRaw: hx(bodyRaw, 6),
    bodyPtr: hx(bodyPtr, 6),
    reverseStep: (bodyRaw & 1) !== 0,
    bodyMode: isShortBranch ? "short" : "long",
    count: isShortBranch ? rbAbs(state, rom, bodyPtr + 2) : first,
  };
}

function type4InnerRecords(state: GameState, rom: RomImage, structPtr: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let ptr = (structPtr + 0x2c) >>> 0;
  for (let i = 0; i < 5; i++) {
    const word0 = rwAbs(state, rom, ptr);
    if (word0 === 0) break;
    const xRaw = rwAbs(state, rom, ptr + 2);
    const yRaw = rwAbs(state, rom, ptr + 4);
    rows.push({
      index: i,
      ptr: hx(ptr, 6),
      word0: hx(word0),
      code: hx(word0 & 0x07ff),
      yFlags: hx((word0 & 0x8000) | ((word0 >> 11) & 7)),
      xLocal: s16(xRaw),
      yLocal: s16(yRaw),
      d5: s16((xRaw + 0x18) & 0xffff),
      d4: s16((yRaw + 0x10) & 0xffff),
    });
    ptr = (ptr + 6) >>> 0;
  }
  return rows;
}

function type2InnerRecords(state: GameState, rom: RomImage, structPtr: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let ptr = (structPtr + 0x38) >>> 0;
  for (let i = 0; i < 5; i++) {
    const word0 = rwAbs(state, rom, ptr);
    if (word0 === 0) break;
    const xRaw = rwAbs(state, rom, ptr + 2);
    const yRaw = rwAbs(state, rom, ptr + 4);
    rows.push({
      index: i,
      ptr: hx(ptr, 6),
      word0: hx(word0),
      code: hx(word0 & 0x07ff),
      yFlags: hx((word0 & 0x8000) | ((word0 >> 11) & 7)),
      xLocal: s16(xRaw),
      yLocal: s16(yRaw),
      d5: s16((xRaw + 0x18) & 0xffff),
      d4: s16((yRaw + 0x10) & 0xffff),
    });
    ptr = (ptr + 6) >>> 0;
  }
  return rows;
}

function collisionSlots(state: GameState): unknown[] {
  const out: unknown[] = [];
  const obj = 0x18;
  const g690 = readU16(state.workRam, 0x690);
  const g692 = readU16(state.workRam, 0x692);
  const g696 = readU16(state.workRam, 0x696);
  const g698 = readU16(state.workRam, 0x698);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const base = SLOT_TABLE + i * SLOT_STRIDE;
    if ((state.workRam[base + 0x18] ?? 0) === 0) continue;
    const xw = readU16(state.workRam, base + 0x0c);
    const yw = readU16(state.workRam, base + 0x10);
    const tag = state.workRam[base + 0x1f] ?? 0;
    const base46 = readU32(state.workRam, base + 0x46);
    out.push({
      slot: i,
      addr: hx(WRAM + base, 6),
      state18: state.workRam[base + 0x18] ?? 0,
      type19: state.workRam[base + 0x19] ?? 0,
      scriptState1a: state.workRam[base + 0x1a] ?? 0,
      scriptKind1b: state.workRam[base + 0x1b] ?? 0,
      mode1e: state.workRam[base + 0x1e] ?? 0,
      tag1f: hx(tag, 2),
      xw: hx(xw),
      yw: hx(yw),
      d6: s16((xw - g690) & 0xffff),
      a0: s16((yw - g692) & 0xffff),
      d1: s16((((s16(xw) >> 3) & 0xffff) - g696) & 0xffff),
      d2: s16((((s16(yw) >> 3) & 0xffff) - g698) & 0xffff),
      timer1c: state.workRam[base + 0x1c] ?? 0,
      pc36: hx(readU32(state.workRam, base + 0x36), 8),
      rec3e: hx(readU32(state.workRam, base + 0x3e), 6),
      base46: hx(base46, 6),
      fun29cceBranch: classifyCollisionBranch(tag, base46),
      playerX: fixed16(readU32(state.workRam, obj + 0x0c)).toFixed(2),
      playerY: fixed16(readU32(state.workRam, obj + 0x10)).toFixed(2),
      playerZ: fixed16(readU32(state.workRam, obj + 0x14)).toFixed(2),
      playerVz: signedLong(readU32(state.workRam, obj + 0x08)),
    });
  }
  return out;
}

function objectPairSlots(state: GameState): unknown[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < 2; i++) {
    const base = 0x9a4 + i * 0x7c;
    out.push({
      slot: i,
      addr: hx(WRAM + base, 6),
      active18: state.workRam[base + 0x18] ?? 0,
      type19: state.workRam[base + 0x19] ?? 0,
      state1a: hx(state.workRam[base + 0x1a] ?? 0, 2),
      kind1b: hx(state.workRam[base + 0x1b] ?? 0, 2),
      x: fixed16(readU32(state.workRam, base + 0x0c)).toFixed(2),
      y: fixed16(readU32(state.workRam, base + 0x10)).toFixed(2),
      z: fixed16(readU32(state.workRam, base + 0x14)).toFixed(2),
      vx: signedLong(readU32(state.workRam, base + 0x00)),
      vy: signedLong(readU32(state.workRam, base + 0x04)),
      vz: signedLong(readU32(state.workRam, base + 0x08)),
      f1c: hx(readU32(state.workRam, base + 0x1c), 6),
      f36: hx(state.workRam[base + 0x36] ?? 0, 2),
      f56: state.workRam[base + 0x56] ?? 0,
      f57: state.workRam[base + 0x57] ?? 0,
      f58: hx(state.workRam[base + 0x58] ?? 0, 2),
      f5a: hx(readU32(state.workRam, base + 0x5a), 6),
      f67: state.workRam[base + 0x67] ?? 0,
      f68: hx(readU32(state.workRam, base + 0x68), 8),
      f6c: readU16(state.workRam, base + 0x6c),
      f6e: hx(readU32(state.workRam, base + 0x6e), 6),
      f72: hx(readU32(state.workRam, base + 0x72), 6),
      f76: readU16(state.workRam, base + 0x76),
      f78: readU16(state.workRam, base + 0x78),
      f7a: readU16(state.workRam, base + 0x7a),
    });
  }
  return out;
}

function classifyCollisionBranch(tag: number, base46: number): string {
  switch (tag & 0xff) {
    case 0x05:
      return "tag05-proximity-bumper";
    case 0x0a:
      return "tag0a-catapult-arm";
    case 0x0b:
      return base46 === 0x00022016
        ? "tag0b-gate-eligible"
        : "tag0b-guard-miss-original-noop";
    case 0x0c:
      return "tag0c-dynamic-bbox";
    case 0x0d:
      return base46 === 0x000220a6
        ? "tag0d-gate-eligible"
        : "tag0d-guard-miss-original-noop";
    case 0x17:
      return "tag17-range-tag-only";
    case 0x18:
      return "tag18-range-tag-only";
    case 0x1a:
    case 0x1b:
    case 0x1c:
    case 0x1d:
    case 0x1e:
    case 0x1f:
      return "tube-wall-collision";
    case 0x20:
    case 0x21:
    case 0x22:
    case 0x23:
    case 0x24:
    case 0x25:
    case 0x26:
    case 0x27:
      return "tube-shape-collision";
    default:
      return "unclassified";
  }
}

function frameSummary(state: GameState): Record<string, unknown> {
  const activeStart = ((((state.workRam[0x3ae] ?? 0) << 8) | (state.workRam[0x3af] ?? 0)) >>> 3) & 7;
  const startEntry = activeStart * 64;
  const linkedIndexes = renderNs.walkMotionObjectLinkedList(state.spriteRam, startEntry, 64);
  const allIndexes = renderNs.walkMotionObjectAllBanks(state.spriteRam, 64);
  const linkedFrame = renderNs.buildFrame(state, {
    motionObjects: "linked-list",
    motionObjectStartEntry: startEntry,
    maxMotionObjectEntries: 64,
  });
  const allFrame = renderNs.buildFrame(state, {
    motionObjects: "all-banks",
    maxMotionObjectEntries: 64,
  });
  return {
    avControl: hx(readU16(state.workRam, 0x3ae)),
    startEntry,
    linkedIndexes: linkedIndexes.slice(0, 20),
    linkedSprites: linkedFrame.sprites.length,
    allBankIndexes: allIndexes.slice(0, 32),
    allBankSprites: allFrame.sprites.length,
    linkedSpriteSample: linkedFrame.sprites.slice(0, 12),
  };
}

function timelineSample(state: GameState, rom: RomImage, routeFrame: number): Record<string, unknown> {
  const entities = entityList(state, rom) as Record<string, unknown>[];
  const slots = collisionSlots(state) as Record<string, unknown>[];
  const debug = state.debug as Record<string, unknown> | undefined;
  return {
    routeFrame,
    timer: readU16(state.workRam, 0x18 + 0x6a),
    descriptor: hx(readU32(state.workRam, 0x474), 6),
    playerState: state.workRam[0x18 + 0x1a] ?? 0,
    playerNewState: state.workRam[0x18 + 0x1b] ?? 0,
    playerX: fixed16(readU32(state.workRam, 0x18 + 0x0c)).toFixed(2),
    playerY: fixed16(readU32(state.workRam, 0x18 + 0x10)).toFixed(2),
    playerZ: fixed16(readU32(state.workRam, 0x18 + 0x14)).toFixed(2),
    vx: signedLong(readU32(state.workRam, 0x18 + 0x00)),
    vy: signedLong(readU32(state.workRam, 0x18 + 0x04)),
    state36: hx(state.workRam[0x18 + 0x36] ?? 0, 2),
    collision58: hx(state.workRam[0x18 + 0x58] ?? 0, 2),
    sound57: hx(state.workRam[0x18 + 0x57] ?? 0, 2),
    flags: {
      x: state.workRam[0x666] ?? 0,
      y: state.workRam[0x668] ?? 0,
      xRestore: hx(readU32(state.workRam, 0x684), 8),
      yRestore: hx(readU32(state.workRam, 0x688), 8),
    },
    lastTerrainSlotCollision: debug?.lastTerrainSlotCollision,
    lastTerrainScanStop: debug?.lastTerrainScanStop,
    lastTerrainGateProbe: debug?.lastTerrainGateProbe,
    lastHelper121B8BoundsBounce: debug?.lastHelper121B8BoundsBounce,
    lastObjectPairCollision: debug?.lastObjectPairCollision,
    visibleEntities: entities
      .filter((row) => row.visibleBinary === true || row.type === 2 || row.type === 10)
      .map((row) => ({
        type: row.type,
        sub: row.sub,
        d5: row.d5,
        d4: row.d4,
        marker1f: row.marker1f,
        collisionSlot: row.collisionSlot,
      })),
    objectPairSlots: objectPairSlots(state),
    collisionSlots: slots.map((row) => ({
      slot: row.slot,
      type19: row.type19,
      scriptState1a: row.scriptState1a,
      scriptKind1b: row.scriptKind1b,
      tag1f: row.tag1f,
      timer1c: row.timer1c,
      pc36: row.pc36,
      rec3e: row.rec3e,
      base46: row.base46,
      d6: row.d6,
      a0: row.a0,
      fun29cceBranch: row.fun29cceBranch,
    })),
  };
}

function topSummary(
  path: string,
  seed: SeedJson,
  state: GameState,
  planLength: number,
  stepPixels: number,
): Record<string, unknown> {
  return {
    path,
    seedFrame: seed.frame,
    routeFrames: planLength,
    stepPixels,
    slapsticBank: seed.slapsticBank ?? 1,
    descriptor: hx(readU32(state.workRam, 0x474), 6),
    main: hx(readU16(state.workRam, 0x390)),
    mode: hx(readU16(state.workRam, 0x392)),
    next: hx(readU16(state.workRam, 0x394)),
    segment: state.workRam[0x3e4] ?? 0,
    timer: readU16(state.workRam, 0x18 + 0x6a),
    player: {
      state1a: state.workRam[0x18 + 0x1a] ?? 0,
      x: fixed16(readU32(state.workRam, 0x18 + 0x0c)).toFixed(2),
      y: fixed16(readU32(state.workRam, 0x18 + 0x10)).toFixed(2),
      z: fixed16(readU32(state.workRam, 0x18 + 0x14)).toFixed(2),
      vx: signedLong(readU32(state.workRam, 0x18 + 0x00)),
      vy: signedLong(readU32(state.workRam, 0x18 + 0x04)),
      collision58: hx(state.workRam[0x18 + 0x58] ?? 0, 2),
      sound57: hx(state.workRam[0x18 + 0x57] ?? 0, 2),
    },
  };
}

function printText(report: Record<string, unknown>): void {
  console.log(`\n=== ${report.path} ===`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log("\n-- entity draw list --");
  console.table(report.entities as unknown[]);
  console.log("\n-- collision slots --");
  console.table(report.collisionSlots as unknown[]);
  console.log("\n-- object-pair slots --");
  console.table(report.objectPairSlots as unknown[]);
  console.log("\n-- motion object frame --");
  console.log(JSON.stringify(report.frame, null, 2));
}

function main(): void {
  const args = parseArgs();
  const rom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
  const plan = expandRoute(args.plan, args.ticks);
  const reports: Record<string, unknown>[] = [];

  for (const path of args.paths) {
    const seed = loadSeed(path, args.snapshotIndex);
    const state = loadState(rom, seed, args.dispatcher);
    const timeline = replayRoute(state, rom, plan, args.stepPixels, args.timelineEvery);
    const report = {
      path,
      summary: topSummary(path, seed, state, plan.length, args.stepPixels),
      entities: entityList(state, rom),
      collisionSlots: collisionSlots(state),
      objectPairSlots: objectPairSlots(state),
      frame: frameSummary(state),
      ...(timeline.length > 0 ? { timeline } : {}),
    };
    reports.push(report);
    if (!args.json) printText(report);
  }
  if (args.json) console.log(JSON.stringify(reports, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
}
