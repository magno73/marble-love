#!/usr/bin/env node
/**
 * Differential `FUN_1101E` vs `mainLoopInit1101E`.
 *
 * Covers dispatcher states 0..6 with downstream JSRs patched to sentinel
 * stubs. Return-bearing helpers use deterministic D0 thunks so branch
 * decisions are reproducible on both sides.
 */

import { readFileSync } from "node:fs";
import { exit } from "node:process";
import { bus as busNs, mainLoopInit117B2 as initNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";
import {
  findRomBlobPath,
  incSentinel,
  makeRng,
  patchReturnD0Byte,
  patchStubAddq,
  patchStubAddqReturnD0Byte,
  readRam,
  writeRam,
  type PatchableSub,
} from "./main-loop-init-parity-lib.js";

const FUN_1101E = 0x0001101e;
const SENT_BASE = 0x00401e40;
const RETURN_001C6 = 0;
const RETURN_11B18 = 1;
const RETURN_0160 = 0x2a;

const SUBS: PatchableSub[] = [
  { name: "soundCmd158AC", entry: 0x000158ac, sentinel: SENT_BASE + 0 },
  { name: "textPrint0118", entry: 0x00000118, sentinel: SENT_BASE + 1 },
  { name: "sceneInit11428", entry: 0x00011428, sentinel: SENT_BASE + 2 },
  { name: "init10504", entry: 0x00010504, sentinel: SENT_BASE + 3 },
  { name: "refresh10FCE", entry: 0x00010fce, sentinel: SENT_BASE + 4 },
  { name: "gameModePrep10456", entry: 0x00010456, sentinel: SENT_BASE + 5 },
  { name: "helper16EC6", entry: 0x00016ec6, sentinel: SENT_BASE + 6 },
  { name: "init11452", entry: 0x00011452, sentinel: SENT_BASE + 7 },
  { name: "vblankAck", entry: 0x00028dea, sentinel: SENT_BASE + 8 },
  { name: "helper16A20", entry: 0x00016a20, sentinel: SENT_BASE + 9 },
  { name: "helper28232", entry: 0x00028232, sentinel: SENT_BASE + 10 },
  { name: "helper11654", entry: 0x00011654, sentinel: SENT_BASE + 11 },
  { name: "helper019C", entry: 0x0000019c, sentinel: SENT_BASE + 12 },
  { name: "gameStateBanner26B2A", entry: 0x00026b2a, sentinel: SENT_BASE + 13 },
  { name: "helper001C6", entry: 0x000001c6, sentinel: SENT_BASE + 14 },
  { name: "helper11B18", entry: 0x00011b18, sentinel: SENT_BASE + 15 },
  { name: "helper288F8", entry: 0x000288f8, sentinel: SENT_BASE + 16 },
  { name: "soundPair15884", entry: 0x00015884, sentinel: SENT_BASE + 17 },
  { name: "helper118D2", entry: 0x000118d2, sentinel: SENT_BASE + 18 },
  { name: "clearPaletteRam", entry: 0x000121a6, sentinel: SENT_BASE + 19 },
  { name: "clearMoAlphaRam", entry: 0x00012174, sentinel: SENT_BASE + 20 },
  { name: "clearOther12186", entry: 0x00012186, sentinel: SENT_BASE + 21 },
  { name: "initFnPointers28580", entry: 0x00028580, sentinel: SENT_BASE + 22 },
  { name: "clearAlphaTiles28C7E", entry: 0x00028c7e, sentinel: SENT_BASE + 23 },
  { name: "sceneObjInit28CA6", entry: 0x00028ca6, sentinel: SENT_BASE + 24 },
  { name: "helper18A88", entry: 0x00018a88, sentinel: SENT_BASE + 25 },
  { name: "wait28DB8", entry: 0x00028db8, sentinel: SENT_BASE + 26 },
];

const WATCHED = [
  ...SUBS.map((sub) => ({ name: sub.name, addr: sub.sentinel, size: 1 as const })),
  { name: "400006", addr: 0x00400006, size: 1 as const },
  { name: "400008", addr: 0x00400008, size: 1 as const },
  { name: "40000A", addr: 0x0040000a, size: 1 as const },
  { name: "400086", addr: 0x00400086, size: 1 as const },
  { name: "4000D4", addr: 0x004000d4, size: 4 as const },
  { name: "4001B6", addr: 0x004001b6, size: 4 as const },
  { name: "400390", addr: 0x00400390, size: 2 as const },
  { name: "400392", addr: 0x00400392, size: 2 as const },
  { name: "400394", addr: 0x00400394, size: 2 as const },
  { name: "400396", addr: 0x00400396, size: 2 as const },
  { name: "40039A", addr: 0x0040039a, size: 1 as const },
  { name: "4003AC", addr: 0x004003ac, size: 1 as const },
  { name: "4003E2", addr: 0x004003e2, size: 1 as const },
  { name: "4003E4", addr: 0x004003e4, size: 1 as const },
  { name: "4003E8", addr: 0x004003e8, size: 1 as const },
  { name: "4003EA", addr: 0x004003ea, size: 2 as const },
  { name: "4003EE", addr: 0x004003ee, size: 1 as const },
  { name: "4003F0", addr: 0x004003f0, size: 1 as const },
  { name: "400460", addr: 0x00400460, size: 1 as const },
  { name: "40075A", addr: 0x0040075a, size: 2 as const },
  { name: "400768", addr: 0x00400768, size: 2 as const },
];

function buildSubs(): initNs.MainLoopInit1101ESubs {
  return {
    soundCmd: (s) => incSentinel(s.workRam, SENT_BASE + 0),
    textPrint0118: (s) => incSentinel(s.workRam, SENT_BASE + 1),
    sceneInit11428: (s) => incSentinel(s.workRam, SENT_BASE + 2),
    init10504: (s) => incSentinel(s.workRam, SENT_BASE + 3),
    refresh10FCE: (s) => incSentinel(s.workRam, SENT_BASE + 4),
    gameModePrep10456: (s) => incSentinel(s.workRam, SENT_BASE + 5),
    helper16EC6: (s) => incSentinel(s.workRam, SENT_BASE + 6),
    init11452: (s) => incSentinel(s.workRam, SENT_BASE + 7),
    vblankAck: (s) => incSentinel(s.workRam, SENT_BASE + 8),
    helper16A20: (s) => incSentinel(s.workRam, SENT_BASE + 9),
    helper28232: (s) => incSentinel(s.workRam, SENT_BASE + 10),
    helper11654: (s) => incSentinel(s.workRam, SENT_BASE + 11),
    helper019C: (s) => incSentinel(s.workRam, SENT_BASE + 12),
    gameStateBanner26B2A: (s) => incSentinel(s.workRam, SENT_BASE + 13),
    helper001C6: (s) => {
      incSentinel(s.workRam, SENT_BASE + 14);
      return RETURN_001C6;
    },
    helper11B18: (s) => {
      incSentinel(s.workRam, SENT_BASE + 15);
      return RETURN_11B18;
    },
    helper0160: () => RETURN_0160,
    helper288F8: (s) => incSentinel(s.workRam, SENT_BASE + 16),
    soundPair15884: (s) => incSentinel(s.workRam, SENT_BASE + 17),
    helper118D2: (s) => incSentinel(s.workRam, SENT_BASE + 18),
    clearPaletteRam: (s) => incSentinel(s.workRam, SENT_BASE + 19),
    clearMoAlphaRam: (s) => incSentinel(s.workRam, SENT_BASE + 20),
    clearOther12186: (s) => incSentinel(s.workRam, SENT_BASE + 21),
    initFnPointers28580: (s) => incSentinel(s.workRam, SENT_BASE + 22),
    clearAlphaTiles28C7E: (s) => incSentinel(s.workRam, SENT_BASE + 23),
    sceneObjInit28CA6: (s) => incSentinel(s.workRam, SENT_BASE + 24),
    helper18A88: (s) => incSentinel(s.workRam, SENT_BASE + 25),
    wait28DB8: (s) => incSentinel(s.workRam, SENT_BASE + 26),
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBuf = Buffer.from(readFileSync(findRomBlobPath()));
  for (const sub of SUBS) {
    if (sub.entry === 0x000001c6) {
      patchStubAddqReturnD0Byte(romBuf, sub.entry, sub.sentinel, RETURN_001C6);
    } else if (sub.entry === 0x00011b18) {
      patchStubAddqReturnD0Byte(romBuf, sub.entry, sub.sentinel, RETURN_11B18);
    } else {
      patchStubAddq(romBuf, sub.entry, sub.sentinel);
    }
  }
  patchReturnD0Byte(romBuf, 0x00000160, RETURN_0160);

  const romView = busNs.emptyRomImage();
  romView.program.set(romBuf);
  const rng = makeRng(0x1101e);
  let ok = 0;
  let firstFail: string | null = null;

  for (let i = 0; i < n; i++) {
    const state = stateNs.emptyGameState();
    const cpu = await createCpu({ rom: romBuf, state });
    cpu.system.setRegister("sp", 0x401f00);
    const dispatcherState = i % 7;

    for (const f of WATCHED) {
      const max = f.size === 1 ? 0x100 : f.size === 2 ? 0x10000 : 0x100000000;
      const value = Math.floor(rng() * max) >>> 0;
      pokeMem(cpu, f.addr, f.size, value);
      writeRam(state.workRam, f.addr, f.size, value);
    }

    seedCase(cpu, state, dispatcherState, i);

    callFunction(cpu, FUN_1101E, [], 200_000);
    initNs.mainLoopInit1101E(state, romView, buildSubs());

    let caseOk = true;
    for (const f of WATCHED) {
      const b = peekMem(cpu, f.addr, f.size) >>> 0;
      const t = readRam(state.workRam, f.addr, f.size) >>> 0;
      if (b !== t) {
        firstFail ??= `case ${i} state=${dispatcherState} ${f.name}: bin=0x${b.toString(16)} ts=0x${t.toString(16)}`;
        caseOk = false;
        break;
      }
    }
    if (caseOk) ok++;
    disposeCpu(cpu);
  }

  console.log(`\n=== mainLoopInit1101E parity — ${ok}/${n} ===`);
  if (firstFail) console.log(firstFail);
  exit(ok === n ? 0 : 1);
}

function seedCase(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  dispatcherState: number,
  i: number,
): void {
  const set = (addr: number, size: 1 | 2 | 4, value: number): void => {
    pokeMem(cpu, addr, size, value);
    writeRam(state.workRam, addr, size, value);
  };

  set(0x00400390, 2, dispatcherState);
  set(0x00400392, 2, i % 3);
  set(0x00400394, 2, i % 6);
  set(0x00400396, 2, (i % 2) + 1);
  set(0x004003a4, 1, i & 1);
  set(0x004003ea, 2, dispatcherState === 1 ? (i & 1 ? 0x18 : 0x08) : 0x0010);
  set(0x004003ee, 1, dispatcherState === 1 ? i & 1 : 0);
  set(0x0040075a, 2, dispatcherState === 1 ? (i % 3 === 0 ? 0x00ff : i % 3 === 1 ? 0x0001 : 0x0000) : 0);
  set(0x00400008, 1, 0x44);
  set(0x004000d4, 4, 0x00000010);
  set(0x004001b6, 4, i & 1 ? 0x00000020 : 0x00000008);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
