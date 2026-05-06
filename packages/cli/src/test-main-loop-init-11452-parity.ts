#!/usr/bin/env node
/**
 * Differential `FUN_11452` vs `mainLoopInit11452`.
 *
 * Covers the dispatcher states 0..3 with all downstream JSRs patched to
 * sentinel stubs. `FUN_13A98` returns a fixed value so the random sound branch
 * is deterministic.
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
  readRam,
  writeRam,
  type PatchableSub,
} from "./main-loop-init-parity-lib.js";

const FUN_11452 = 0x00011452;
const SENT_BASE = 0x00401e20;
const RNG_RETURN = 1;

const SUBS: PatchableSub[] = [
  { name: "memClear019C", entry: 0x0000019c, sentinel: SENT_BASE + 0 },
  { name: "soundCmd", entry: 0x000158ac, sentinel: SENT_BASE + 1 },
  { name: "sceneInit11428", entry: 0x00011428, sentinel: SENT_BASE + 2 },
  { name: "gameModePrep10456", entry: 0x00010456, sentinel: SENT_BASE + 3 },
  { name: "helper16EC6", entry: 0x00016ec6, sentinel: SENT_BASE + 4 },
  { name: "init10504", entry: 0x00010504, sentinel: SENT_BASE + 5 },
  { name: "gameStateBanner26B2A", entry: 0x00026b2a, sentinel: SENT_BASE + 6 },
  { name: "helper26B66", entry: 0x00026b66, sentinel: SENT_BASE + 7 },
  { name: "vblankAck", entry: 0x00028dea, sentinel: SENT_BASE + 8 },
  { name: "helper18CD2", entry: 0x00018cd2, sentinel: SENT_BASE + 9 },
  { name: "helper11FF8", entry: 0x00011ff8, sentinel: SENT_BASE + 10 },
  { name: "tilemapBlit17044", entry: 0x00017044, sentinel: SENT_BASE + 11 },
  { name: "renderString0142", entry: 0x00000142, sentinel: SENT_BASE + 12 },
  { name: "finalize11654", entry: 0x00011654, sentinel: SENT_BASE + 13 },
];

const WATCHED = [
  ...SUBS.map((sub) => ({ name: sub.name, addr: sub.sentinel, size: 1 as const })),
  { name: "400000", addr: 0x00400000, size: 2 as const },
  { name: "400002", addr: 0x00400002, size: 2 as const },
  { name: "400006", addr: 0x00400006, size: 1 as const },
  { name: "400008", addr: 0x00400008, size: 1 as const },
  { name: "40000A", addr: 0x0040000a, size: 1 as const },
  { name: "4003E2", addr: 0x004003e2, size: 1 as const },
  { name: "4003E4", addr: 0x004003e4, size: 1 as const },
  { name: "4003E6", addr: 0x004003e6, size: 1 as const },
  { name: "400392", addr: 0x00400392, size: 2 as const },
  { name: "400394", addr: 0x00400394, size: 2 as const },
  { name: "400396", addr: 0x00400396, size: 2 as const },
  { name: "400446", addr: 0x00400446, size: 4 as const },
  { name: "400460", addr: 0x00400460, size: 1 as const },
  { name: "40075A", addr: 0x0040075a, size: 2 as const },
];

function buildSubs(): initNs.MainLoopInit11452Subs {
  return {
    memClear019C: (s) => incSentinel(s.workRam, SENT_BASE + 0),
    soundCmd: (s) => incSentinel(s.workRam, SENT_BASE + 1),
    sceneInit11428: (s) => incSentinel(s.workRam, SENT_BASE + 2),
    gameModePrep10456: (s) => incSentinel(s.workRam, SENT_BASE + 3),
    helper16EC6: (s) => incSentinel(s.workRam, SENT_BASE + 4),
    init10504: (s) => incSentinel(s.workRam, SENT_BASE + 5),
    gameStateBanner26B2A: (s) => incSentinel(s.workRam, SENT_BASE + 6),
    helper26B66: (s) => incSentinel(s.workRam, SENT_BASE + 7),
    vblankAck: (s) => incSentinel(s.workRam, SENT_BASE + 8),
    helper18CD2: (s) => incSentinel(s.workRam, SENT_BASE + 9),
    helper11FF8: (s) => incSentinel(s.workRam, SENT_BASE + 10),
    tilemapBlit17044: (s) => incSentinel(s.workRam, SENT_BASE + 11),
    randomMod13A98: () => RNG_RETURN,
    renderString0142: (s) => incSentinel(s.workRam, SENT_BASE + 12),
    finalize11654: (s) => incSentinel(s.workRam, SENT_BASE + 13),
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBuf = Buffer.from(readFileSync(findRomBlobPath()));
  for (const sub of SUBS) patchStubAddq(romBuf, sub.entry, sub.sentinel);
  patchReturnD0Byte(romBuf, 0x00013a98, RNG_RETURN);

  const romView = busNs.emptyRomImage();
  romView.program.set(romBuf);
  const rng = makeRng(0x11452);
  let ok = 0;
  let firstFail: string | null = null;

  for (let i = 0; i < n; i++) {
    const state = stateNs.emptyGameState();
    const cpu = await createCpu({ rom: romBuf, state });
    cpu.system.setRegister("sp", 0x401f00);
    const mode = i % 4;

    for (const f of WATCHED) {
      const max = f.size === 1 ? 0x100 : f.size === 2 ? 0x10000 : 0x100000000;
      const value = Math.floor(rng() * max) >>> 0;
      pokeMem(cpu, f.addr, f.size, value);
      writeRam(state.workRam, f.addr, f.size, value);
    }

    writeRam(state.workRam, 0x00400392, 2, mode);
    pokeMem(cpu, 0x00400392, 2, mode);
    writeRam(state.workRam, 0x00400390, 2, 1);
    pokeMem(cpu, 0x00400390, 2, 1);
    writeRam(state.workRam, 0x00400394, 2, i & 1);
    pokeMem(cpu, 0x00400394, 2, i & 1);
    writeRam(state.workRam, 0x004003e4, 1, mode === 0 ? i & 7 : 0);
    pokeMem(cpu, 0x004003e4, 1, mode === 0 ? i & 7 : 0);
    writeRam(state.workRam, 0x004003e6, 1, mode === 2 ? 1 : 0);
    pokeMem(cpu, 0x004003e6, 1, mode === 2 ? 1 : 0);
    writeRam(state.workRam, 0x004003dc, 2, mode === 3 ? 0x4000 : 0);
    pokeMem(cpu, 0x004003dc, 2, mode === 3 ? 0x4000 : 0);

    callFunction(cpu, FUN_11452, [], 100_000);
    initNs.mainLoopInit11452(state, romView, buildSubs());

    let caseOk = true;
    for (const f of WATCHED) {
      const b = peekMem(cpu, f.addr, f.size) >>> 0;
      const t = readRam(state.workRam, f.addr, f.size) >>> 0;
      if (b !== t) {
        firstFail ??= `case ${i} mode=${mode} ${f.name}: bin=0x${b.toString(16)} ts=0x${t.toString(16)}`;
        caseOk = false;
        break;
      }
    }
    if (caseOk) ok++;
    disposeCpu(cpu);
  }

  console.log(`\n=== mainLoopInit11452 parity — ${ok}/${n} ===`);
  if (firstFail) console.log(firstFail);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
