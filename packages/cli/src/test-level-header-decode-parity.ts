#!/usr/bin/env node
/**
 * Aggregated parity gate for the level descriptor header decode.
 *
 * This runner keeps all D4 logic in this new file. The existing per-consumer
 * parity scripts are left untouched; `FUN_16EC6` in particular must patch
 * `FUN_1A444` and inject the TS callback, otherwise the historical script runs
 * the real row builder on a synthetic state and can spin for a long time.
 *
 * Usage:
 *   npx tsx packages/cli/src/test-level-header-decode-parity.ts [N]
 *
 * It writes:
 *   runs/level-header-parity-{16ec6,16f6c,259b4}.txt
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  bus as busNs,
  level as levelNs,
  levelDispatcher16EC6 as dispatcherNs,
  levelInit16F6C as initNs,
  objectInit259B4 as objectNs,
  state as stateNs,
} from "@marble-love/engine";
import type { CpuSession } from "./binary-oracle-lib.js";
import {
  callFunction,
  createCpu,
  disposeCpu,
  peekMem,
  pokeMem,
} from "./binary-oracle-lib.js";

const WORK_BASE = 0x00400000;
const WORK_SIZE = 0x2000;
const ZERO_WORK = new Uint8Array(WORK_SIZE);

const FUN_16EC6 = 0x00016ec6;
const FUN_16F6C = 0x00016f6c;
const FUN_259B4 = 0x000259b4;

const FUN_2FFB8 = 0x0002ffb8;
const FUN_2FF28 = 0x0002ff28;
const FUN_2FF40 = 0x0002ff40;
const FUN_18FD0 = 0x00018fd0;
const FUN_1A444 = 0x0001a444;
const FUN_1A668 = 0x0001a668;

const FUN_1BAB2 = 0x0001bab2;
const FUN_1CC62 = 0x0001cc62;
const FUN_25B40 = 0x00025b40;
const FUN_1B9CC = 0x0001b9cc;
const FUN_1C014 = 0x0001c014;
const FUN_1281C = 0x0001281c;
const FUN_18E6C = 0x00018e6c;

const SENT_BASE = 0x004003e0;
const OBJ_BASE = 0x00400018;
const OBJ_STRIDE = 0x00e2;
const RETURN_1CC62 = 0x13572468;

type GameState = ReturnType<typeof stateNs.emptyGameState>;
type RomView = ReturnType<typeof busNs.emptyRomImage>;

interface HeaderFixture {
  index: number;
  ptr: number;
  header: ReturnType<typeof levelNs.decodeLevelHeader>;
}

interface ConsumerResult {
  id: "16ec6" | "16f6c" | "259b4";
  title: string;
  total: number;
  matches: number;
  firstFail: string | null;
  lines: string[];
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function randByte(rng: () => number): number {
  return Math.floor(rng() * 256) & 0xff;
}

function randWord(rng: () => number): number {
  return Math.floor(rng() * 0x10000) & 0xffff;
}

function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error("ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.");
}

function makeRomView(rom: Uint8Array): RomView {
  const view = busNs.emptyRomImage();
  view.program.set(rom.subarray(0, view.program.length));
  return view;
}

function loadHeaderFixtures(rom: RomView): HeaderFixture[] {
  return levelNs.readLevelPointerTable(rom).map((ptr, index) => ({
    index,
    ptr,
    header: levelNs.decodeLevelHeader(
      rom.program.slice(ptr, ptr + levelNs.LEVEL_HEADER_SIZE),
    ),
  }));
}

function patchRts(rom: Buffer, addr: number): void {
  rom[addr] = 0x4e;
  rom[addr + 1] = 0x75;
}

function patchReturnD0(rom: Buffer, addr: number, value: number): void {
  rom[addr + 0] = 0x20;
  rom[addr + 1] = 0x3c;
  rom[addr + 2] = (value >>> 24) & 0xff;
  rom[addr + 3] = (value >>> 16) & 0xff;
  rom[addr + 4] = (value >>> 8) & 0xff;
  rom[addr + 5] = value & 0xff;
  rom[addr + 6] = 0x4e;
  rom[addr + 7] = 0x75;
}

function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
  rom[entry + 6] = 0x4e;
  rom[entry + 7] = 0x75;
}

function resetWork(cpu: CpuSession, state: GameState): void {
  cpu.system.writeBytes(WORK_BASE, ZERO_WORK);
  state.workRam.fill(0);
}

function writeStateU8(state: GameState, abs: number, value: number): void {
  state.workRam[abs - WORK_BASE] = value & 0xff;
}

function writeBothU8(cpu: CpuSession, state: GameState, abs: number, value: number): void {
  const v = value & 0xff;
  pokeMem(cpu, abs, 1, v);
  writeStateU8(state, abs, v);
}

function writeBothU16(cpu: CpuSession, state: GameState, abs: number, value: number): void {
  const v = value & 0xffff;
  pokeMem(cpu, abs, 2, v);
  writeStateU8(state, abs, v >>> 8);
  writeStateU8(state, abs + 1, v);
}

function writeBothU32(cpu: CpuSession, state: GameState, abs: number, value: number): void {
  const v = value >>> 0;
  pokeMem(cpu, abs, 4, v);
  writeStateU8(state, abs, v >>> 24);
  writeStateU8(state, abs + 1, v >>> 16);
  writeStateU8(state, abs + 2, v >>> 8);
  writeStateU8(state, abs + 3, v);
}

function readStateU32(state: GameState, abs: number): number {
  const off = abs - WORK_BASE;
  return (
    ((state.workRam[off] ?? 0) << 24) |
    ((state.workRam[off + 1] ?? 0) << 16) |
    ((state.workRam[off + 2] ?? 0) << 8) |
    (state.workRam[off + 3] ?? 0)
  ) >>> 0;
}

function readProgramU8(rom: RomView, abs: number): number {
  return rom.program[abs >>> 0] ?? 0;
}

function readProgramU16(rom: RomView, abs: number): number {
  return ((readProgramU8(rom, abs) << 8) | readProgramU8(rom, abs + 1)) & 0xffff;
}

function signExtendWord(value: number): number {
  const v = value & 0xffff;
  return (v & 0x8000) !== 0 ? v - 0x10000 : v;
}

function incSent(state: GameState, abs: number): void {
  const off = abs - WORK_BASE;
  state.workRam[off] = ((state.workRam[off] ?? 0) + 1) & 0xff;
}

function compareOffsets(cpu: CpuSession, state: GameState, offsets: readonly number[]): string | null {
  for (const off of offsets) {
    const bin = peekMem(cpu, WORK_BASE + off, 1) & 0xff;
    const ts = state.workRam[off] ?? 0;
    if (bin !== ts) {
      return `work@0x${off.toString(16)} bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`;
    }
  }
  return null;
}

function resultLines(result: ConsumerResult): string[] {
  return [
    `=== ${result.title} - ${result.total} cases ===`,
    `Match: ${result.matches}/${result.total} = ${((result.matches / result.total) * 100).toFixed(1)}%`,
    result.firstFail === null ? "First fail: none" : `First fail: ${result.firstFail}`,
    "",
    ...result.lines,
  ];
}

async function run16EC6(total: number, originalRom: Uint8Array): Promise<ConsumerResult> {
  const rom = Buffer.from(originalRom);
  for (const addr of [FUN_2FFB8, FUN_2FF28, FUN_18FD0, FUN_1A444]) patchRts(rom, addr);
  const romView = makeRomView(rom);
  const headers = loadHeaderFixtures(romView);
  const cpu = await createCpu({ rom, state: stateNs.emptyGameState() });
  const tsState = stateNs.emptyGameState();
  const rng = makeRng(0x16ec6);

  const compare = [
    0x0474, 0x0475, 0x0476, 0x0477,
    0x065a, 0x065b, 0x065c, 0x065d,
    0x0662, 0x0663, 0x0664, 0x0665,
    0x097c, 0x097d, 0x097e, 0x097f,
  ] as const;

  let matches = 0;
  let firstFail: string | null = null;

  for (let i = 0; i < total; i++) {
    resetWork(cpu, tsState);
    cpu.system.setRegister("sp", 0x00401f00);

    const fixture = headers[Math.floor(rng() * headers.length)]!;
    writeBothU16(cpu, tsState, 0x00400394, fixture.index);
    writeBothU16(cpu, tsState, 0x00400664, randWord(rng));

    callFunction(cpu, FUN_16EC6, [], 500_000);
    dispatcherNs.levelDispatcher16EC6(tsState, romView, {
      fun_2ffb8: () => undefined,
      fun_2ff28: () => undefined,
      fun_18fd0: () => undefined,
      fun_1a444: () => undefined,
    });

    let fail = compareOffsets(cpu, tsState, compare);
    if (fail === null) {
      const actualPtr = (peekMem(cpu, 0x00400474, 4) >>> 0);
      const actualBinsearch = (peekMem(cpu, 0x0040065a, 4) >>> 0);
      const actualScroll = (peekMem(cpu, 0x0040097c, 4) >>> 0);
      const expectedScroll = (
        fixture.header.yScrollBase +
        (fixture.index === 4 ? fixture.header.yScrollRange : 0)
      ) >>> 0;
      if (actualPtr !== fixture.ptr) {
        fail = `case ${i}: decoded level ptr expected=0x${fixture.ptr.toString(16)} got=0x${actualPtr.toString(16)}`;
      } else if (actualBinsearch !== fixture.header.binsearchBasePtr) {
        fail = `case ${i}: decoded binsearchBasePtr expected=0x${fixture.header.binsearchBasePtr.toString(16)} got=0x${actualBinsearch.toString(16)}`;
      } else if (actualScroll !== expectedScroll) {
        fail = `case ${i}: decoded yScroll expected=0x${expectedScroll.toString(16)} got=0x${actualScroll.toString(16)}`;
      }
    }

    if (fail === null) matches++;
    else firstFail ??= fail;
  }

  disposeCpu(cpu);
  return {
    id: "16ec6",
    title: "levelDispatcher16EC6 (FUN_16EC6)",
    total,
    matches,
    firstFail,
    lines: [
      "Patched JSRs: FUN_2FFB8, FUN_2FF28, FUN_18FD0, FUN_1A444 -> RTS.",
      "Compared observable workRam writes and checked decoded binsearch/y-scroll fields.",
    ],
  };
}

function expectedFirst1A668Args(
  rom: RomView,
  fixture: HeaderFixture,
  mode: number,
): { outAbs: number; ctrlAbs: number; extAbs: number; rowCount: number } {
  let ctrlListAbs = fixture.header.tileWordTablePtr;
  let extListAbs = fixture.header.extByteTablePtr;
  let outAbs = 0x00a00006;
  let rowCount = 0x20;

  if (mode === 4) {
    const d1 = (fixture.header.yScrollRange >> 3) - 1;
    ctrlListAbs = (ctrlListAbs + d1 * 2) >>> 0;
    extListAbs = (extListAbs + d1) >>> 0;
    rowCount = 0x21;
    outAbs = (outAbs - 0x80) >>> 0;
    if (outAbs < 0x00a00000) outAbs = (outAbs + 0x2000) >>> 0;
  }

  const extAbs = (0x0002be18 + readProgramU8(rom, extListAbs)) >>> 0;
  const ctrlWord = signExtendWord(readProgramU16(rom, ctrlListAbs));
  const ctrlAbs = (0x000800e4 + ctrlWord) >>> 0;
  return { outAbs, ctrlAbs, extAbs, rowCount };
}

async function run16F6C(total: number, originalRom: Uint8Array): Promise<ConsumerResult> {
  const rom = Buffer.from(originalRom);
  patchStubAddq(rom, FUN_2FFB8, SENT_BASE + 0);
  patchStubAddq(rom, FUN_2FF40, SENT_BASE + 1);
  patchStubAddq(rom, FUN_1A668, SENT_BASE + 2);
  const romView = makeRomView(rom);
  const headers = loadHeaderFixtures(romView);
  const cpu = await createCpu({ rom, state: stateNs.emptyGameState() });
  const tsState = stateNs.emptyGameState();
  const rng = makeRng(0x16f6c);

  let matches = 0;
  let firstFail: string | null = null;

  for (let i = 0; i < total; i++) {
    resetWork(cpu, tsState);
    cpu.system.setRegister("sp", 0x00401f00);

    const fixture = headers[Math.floor(rng() * headers.length)]!;
    const mode = rng() < 0.35 ? 4 : Math.floor(rng() * 4);
    writeBothU16(cpu, tsState, 0x00400394, mode);
    writeBothU16(cpu, tsState, 0x00400662, randWord(rng) & 7);
    writeBothU16(cpu, tsState, 0x00400664, randWord(rng) & 7);
    writeBothU32(cpu, tsState, 0x00400474, fixture.ptr);

    const firstArgs: { value?: { outAbs: number; ctrlAbs: number; extAbs: number } } = {};
    let a668Count = 0;

    callFunction(cpu, FUN_16F6C, [], 1_000_000);
    initNs.levelInit16F6C(tsState, romView, {
      fun_2ffb8: () => incSent(tsState, SENT_BASE + 0),
      fun_2ff40: () => incSent(tsState, SENT_BASE + 1),
      fun_1a668: (outAbs, ctrlAbs, extAbs) => {
        incSent(tsState, SENT_BASE + 2);
        firstArgs.value ??= { outAbs, ctrlAbs, extAbs };
        a668Count++;
      },
    });

    let fail = compareOffsets(cpu, tsState, [0x03e0, 0x03e1, 0x03e2]);
    if (fail === null) {
      const expected = expectedFirst1A668Args(romView, fixture, mode);
      if (a668Count !== expected.rowCount) {
        fail = `case ${i}: FUN_1A668 count expected=${expected.rowCount} got=${a668Count}`;
      } else if (
        firstArgs.value === undefined ||
        firstArgs.value.outAbs !== expected.outAbs ||
        firstArgs.value.ctrlAbs !== expected.ctrlAbs ||
        firstArgs.value.extAbs !== expected.extAbs
      ) {
        fail = `case ${i}: first FUN_1A668 args expected=${JSON.stringify(expected)} got=${JSON.stringify(firstArgs.value)}`;
      }
    }

    if (fail === null) matches++;
    else firstFail ??= fail;
  }

  disposeCpu(cpu);
  return {
    id: "16f6c",
    title: "levelInit16F6C (FUN_16F6C)",
    total,
    matches,
    firstFail,
    lines: [
      "Patched JSRs: FUN_2FFB8, FUN_2FF40, FUN_1A668 -> sentinel addq + RTS.",
      "Compared sentinel side effects and checked decoded ctrl/ext/y-range first row arguments.",
    ],
  };
}

async function run259B4(total: number, originalRom: Uint8Array): Promise<ConsumerResult> {
  const rom = Buffer.from(originalRom);
  for (const addr of [FUN_1BAB2, FUN_25B40, FUN_1B9CC, FUN_1C014, FUN_1281C, FUN_18E6C]) patchRts(rom, addr);
  patchReturnD0(rom, FUN_1CC62, RETURN_1CC62);
  const romView = makeRomView(rom);
  const headers = loadHeaderFixtures(romView);
  const cpu = await createCpu({ rom, state: stateNs.emptyGameState() });
  const tsState = stateNs.emptyGameState();
  const rng = makeRng(0x259b4);

  let matches = 0;
  let firstFail: string | null = null;

  for (let i = 0; i < total; i++) {
    resetWork(cpu, tsState);
    cpu.system.setRegister("sp", 0x00401f00);

    const fixture = headers[Math.floor(rng() * headers.length)]!;
    const count = Math.floor(rng() * 3);
    const mode = Math.floor(rng() * 5);
    const activeSlots: boolean[] = [];
    writeBothU16(cpu, tsState, 0x00400396, count);
    writeBothU16(cpu, tsState, 0x00400394, mode);
    writeBothU32(cpu, tsState, 0x00400474, fixture.ptr);

    for (let off = 0x0690; off < 0x069a; off++) {
      writeBothU8(cpu, tsState, WORK_BASE + off, randByte(rng));
    }

    for (let slot = 0; slot < 3; slot++) {
      const base = OBJ_BASE + slot * OBJ_STRIDE;
      for (let off = 0; off < OBJ_STRIDE; off++) {
        writeBothU8(cpu, tsState, base + off, randByte(rng));
      }
      const active = slot < count && rng() < 0.7;
      activeSlots[slot] = active;
      let stateByte = active ? 3 : randByte(rng);
      if (!active && stateByte === 3) stateByte = 4;
      writeBothU8(cpu, tsState, base + 0x18, stateByte);
    }

    callFunction(cpu, FUN_259B4, [], 1_000_000);
    objectNs.objectInit259B4(tsState, romView, {
      fun_1bab2: () => undefined,
      fun_1cc62: () => RETURN_1CC62,
      fun_25b40: () => undefined,
      fun_1b9cc: () => undefined,
      fun_1c014: () => undefined,
      fun_1281c: () => undefined,
      fun_18e6c: () => undefined,
    });

    const compareOffsetsList: number[] = [];
    const compareSlots = Math.max(1, count);
    for (let abs = OBJ_BASE; abs < OBJ_BASE + compareSlots * OBJ_STRIDE; abs++) {
      compareOffsetsList.push(abs - WORK_BASE);
    }
    for (let off = 0x0690; off < 0x069a; off++) compareOffsetsList.push(off);

    let fail = compareOffsets(cpu, tsState, compareOffsetsList);
    if (fail === null) {
      for (let slot = 0; slot < count; slot++) {
        if (!activeSlots[slot]) continue;
        const packed = fixture.header.entityInitPositions[slot] ?? 0;
        const hi = (packed >>> 8) & 0xff;
        const lo = packed & 0xff;
        const obj = OBJ_BASE + slot * OBJ_STRIDE;
        const expectedVx = (0x00040000 + hi * 0x00080000) >>> 0;
        const expectedVy = (0x00040000 + lo * 0x00080000) >>> 0;
        const actualVx = readStateU32(tsState, obj + 0x0c);
        const actualVy = readStateU32(tsState, obj + 0x10);
        if (actualVx !== expectedVx || actualVy !== expectedVy) {
          fail = `case ${i}: entity slot ${slot} decoded init expected vx/vy 0x${expectedVx.toString(16)}/0x${expectedVy.toString(16)} got 0x${actualVx.toString(16)}/0x${actualVy.toString(16)}`;
          break;
        }
      }
    }

    if (fail === null) matches++;
    else firstFail ??= fail;
  }

  disposeCpu(cpu);
  return {
    id: "259b4",
    title: "objectInit259B4 (FUN_259B4)",
    total,
    matches,
    firstFail,
    lines: [
      "Patched heavy JSRs to RTS and FUN_1CC62 to deterministic D0.",
      "Compared object/global direct effects and checked decoded entity packed positions.",
    ],
  };
}

async function main(): Promise<number> {
  const total = Number(process.argv[2] ?? "500");
  if (!Number.isInteger(total) || total <= 0) {
    console.error("usage: test-level-header-decode-parity.ts [positive case count]");
    return 2;
  }

  mkdirSync("runs", { recursive: true });
  const originalRom = readFileSync(findRomBlobPath());
  const results = [
    await run16EC6(total, originalRom),
    await run16F6C(total, originalRom),
    await run259B4(total, originalRom),
  ];

  let failed = false;
  for (const result of results) {
    const outPath = `runs/level-header-parity-${result.id}.txt`;
    writeFileSync(outPath, `${resultLines(result).join("\n")}\n`);
    const ok = result.matches === result.total;
    console.log(`${result.id}: ${ok ? "PASS" : "FAIL"} -> ${outPath}`);
    if (!ok) failed = true;
  }

  return failed ? 1 : 0;
}

main().then((code) => exit(code)).catch((err: unknown) => {
  console.error(err);
  exit(1);
});
