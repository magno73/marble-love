#!/usr/bin/env node
/**
 * Differential `FUN_10504` vs `mainLoopInit10504`.
 *
 * This parity harness patches downstream JSRs to sentinel thunks so the long
 * presentation body can be validated as direct workRam side effects plus call
 * order/counts, without depending on unrelated subs.
 */

import { readFileSync } from "node:fs";
import { exit } from "node:process";
import { mainLoopInit117B2 as initNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";
import {
  findRomBlobPath,
  makeRng,
  patchReturnD0Byte,
  patchRts,
  readRam,
  writeRam,
  type PatchableSub,
} from "./main-loop-init-parity-lib.js";

const FUN_10504 = 0x00010504;
const RETURN_13A98 = 0;
const RETURN_0236 = 6;
const RETURN_0230 = 0;

const SUBS: PatchableSub[] = [
  { name: "clearPaletteRam", entry: 0x000121a6, sentinel: 0 },
  { name: "hudFrameInit", entry: 0x000283c2, sentinel: 0 },
  { name: "slotArrayBulkInit", entry: 0x00010392, sentinel: 0 },
  { name: "soundMaybe11AC2", entry: 0x00011ac2, sentinel: 0 },
  { name: "scrollRange144E4", entry: 0x000144e4, sentinel: 0 },
  { name: "stateDispatch12FD0", entry: 0x00012fd0, sentinel: 0 },
  { name: "vblankAck", entry: 0x00028dea, sentinel: 0 },
  { name: "helper1344C", entry: 0x0001344c, sentinel: 0 },
  { name: "levelInit16F6C", entry: 0x00016f6c, sentinel: 0 },
  { name: "objectInit259B4", entry: 0x000259b4, sentinel: 0 },
  { name: "lateLogic26F3E", entry: 0x00026f3e, sentinel: 0 },
  { name: "scrollStep26E14", entry: 0x00026e14, sentinel: 0 },
  { name: "render0142", entry: 0x00000142, sentinel: 0 },
  { name: "objectDirtyDispatch", entry: 0x00028624, sentinel: 0 },
  { name: "renderString286EE", entry: 0x000286ee, sentinel: 0 },
  { name: "gameStateBanner26B2A", entry: 0x00026b2a, sentinel: 0 },
  { name: "soundCmd158AC", entry: 0x000158ac, sentinel: 0 },
  { name: "format28EB2", entry: 0x00028eb2, sentinel: 0 },
  { name: "wait28DB8", entry: 0x00028db8, sentinel: 0 },
  { name: "textPrint0118", entry: 0x00000118, sentinel: 0 },
  { name: "helper16E8E", entry: 0x00016e8e, sentinel: 0 },
  { name: "helper01BA", entry: 0x000001ba, sentinel: 0 },
];

const WATCHED = [
  { name: "400000", addr: 0x00400000, size: 2 as const },
  { name: "400002", addr: 0x00400002, size: 2 as const },
  { name: "400006", addr: 0x00400006, size: 1 as const },
  { name: "400008", addr: 0x00400008, size: 1 as const },
  { name: "40000A", addr: 0x0040000a, size: 1 as const },
  { name: "400018", addr: 0x00400018, size: 4 as const },
  { name: "40001C", addr: 0x0040001c, size: 4 as const },
  { name: "400030", addr: 0x00400030, size: 1 as const },
  { name: "400032", addr: 0x00400032, size: 1 as const },
  { name: "400086", addr: 0x00400086, size: 1 as const },
  { name: "40039A", addr: 0x0040039a, size: 1 as const },
  { name: "40039C", addr: 0x0040039c, size: 1 as const },
  { name: "40039E", addr: 0x0040039e, size: 2 as const },
  { name: "4003A0", addr: 0x004003a0, size: 1 as const },
  { name: "4003A2", addr: 0x004003a2, size: 1 as const },
  { name: "4003A4", addr: 0x004003a4, size: 1 as const },
  { name: "4003AC", addr: 0x004003ac, size: 1 as const },
  { name: "4003F0", addr: 0x004003f0, size: 1 as const },
  { name: "400444", addr: 0x00400444, size: 1 as const },
  { name: "40045C", addr: 0x0040045c, size: 2 as const },
  { name: "40045E", addr: 0x0040045e, size: 1 as const },
  { name: "400460", addr: 0x00400460, size: 1 as const },
  { name: "400408", addr: 0x00400408, size: 4 as const },
  { name: "40075C", addr: 0x0040075c, size: 1 as const },
  { name: "40075E", addr: 0x0040075e, size: 1 as const },
  { name: "400760", addr: 0x00400760, size: 1 as const },
  { name: "400762", addr: 0x00400762, size: 1 as const },
  { name: "400768", addr: 0x00400768, size: 2 as const },
  { name: "40076A", addr: 0x0040076a, size: 1 as const },
  { name: "40076C", addr: 0x0040076c, size: 1 as const },
  { name: "400970", addr: 0x00400970, size: 4 as const },
  { name: "400974", addr: 0x00400974, size: 4 as const },
  { name: "400978", addr: 0x00400978, size: 4 as const },
];

function buildSubs(): initNs.MainLoopInit10504Subs {
  return {
    clearPaletteRam: () => undefined,
    hudFrameInit: () => undefined,
    slotArrayBulkInit: () => undefined,
    soundMaybe11AC2: () => undefined,
    scrollRange144E4: () => undefined,
    stateDispatch12FD0: () => undefined,
    vblankAck: () => undefined,
    helper1344C: () => undefined,
    levelInit16F6C: () => undefined,
    objectInit259B4: () => undefined,
    lateLogic26F3E: () => undefined,
    scrollStep26E14: () => undefined,
    render0142: () => undefined,
    objectDirtyDispatch: () => undefined,
    renderString: () => undefined,
    gameStateBanner: () => undefined,
    soundCmd: () => undefined,
    format28EB2: () => undefined,
    wait28DB8: () => undefined,
    textPrint0118: () => undefined,
    helper16E8E: () => undefined,
    helper01BA: () => undefined,
    helper0236: () => RETURN_0236,
    helper0230: () => RETURN_0230,
    randomMod: () => RETURN_13A98,
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBuf = Buffer.from(readFileSync(findRomBlobPath()));
  for (const sub of SUBS) {
    patchRts(romBuf, sub.entry);
  }
  patchReturnD0Byte(romBuf, 0x00000236, RETURN_0236);
  patchReturnD0Byte(romBuf, 0x00000230, RETURN_0230);
  patchReturnD0Byte(romBuf, 0x00013a98, RETURN_13A98);

  const rng = makeRng(0x10504);
  let ok = 0;
  let firstFail: string | null = null;

  for (let i = 0; i < n; i++) {
    const state = stateNs.emptyGameState();
    const cpu = await createCpu({ rom: romBuf, state });
    cpu.system.setRegister("sp", 0x401f00);

    for (const f of WATCHED) {
      const max = f.size === 1 ? 0x100 : f.size === 2 ? 0x10000 : 0x100000000;
      const value = Math.floor(rng() * max) >>> 0;
      pokeMem(cpu, f.addr, f.size, value);
      writeRam(state.workRam, f.addr, f.size, value);
    }

    seedCase(cpu, state, i);

    callFunction(cpu, FUN_10504, [], 350_000);
    initNs.mainLoopInit10504(state, buildSubs(), { runPresentationMiddle: true });

    let caseOk = true;
    for (const f of WATCHED) {
      const b = peekMem(cpu, f.addr, f.size) >>> 0;
      const t = readRam(state.workRam, f.addr, f.size) >>> 0;
      if (b !== t) {
        firstFail ??= `case ${i} mode=${readRam(state.workRam, 0x00400394, 2)} players=${readRam(state.workRam, 0x00400396, 2)} ${f.name}: bin=0x${b.toString(16)} ts=0x${t.toString(16)}`;
        caseOk = false;
        break;
      }
    }
    if (caseOk) ok++;
    disposeCpu(cpu);
  }

  console.log(`\n=== mainLoopInit10504 parity — ${ok}/${n} ===`);
  if (firstFail) console.log(firstFail);
  exit(ok === n ? 0 : 1);
}

function seedCase(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  i: number,
): void {
  const set = (addr: number, size: 1 | 2 | 4, value: number): void => {
    pokeMem(cpu, addr, size, value);
    writeRam(state.workRam, addr, size, value);
  };

  const mode = i % 6;
  const players = (i % 2) + 1;
  set(0x00400390, 2, i % 3 === 0 ? 1 : 0);
  set(0x00400394, 2, mode);
  set(0x00400396, 2, players);
  set(0x00400398, 1, i % 5 === 0 ? 1 : 0);
  set(0x004003a4, 1, i % 4 === 0 ? 1 : 0);
  set(0x004003dc, 2, i % 4 === 0 ? 0x1000 : 0);
  set(0x004003ea, 2, i % 7 === 0 ? 0xffff : 0x000c);
  for (let p = 0; p < 2; p++) {
    const base = 0x00400018 + p * 0xe2;
    set(base + 0x18, 1, p < players ? 1 : 0);
    set(base + 0x19, 1, p);
    set(base + 0x6a, 2, (i + p) & 0x7f);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
