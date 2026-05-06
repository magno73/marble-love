#!/usr/bin/env node
/**
 * Differential `FUN_117B2` vs `mainLoopInit117B2`.
 *
 * The original entry becomes an infinite loop at 0x118CE. The parity ROM
 * patches that branch to `rts`, then stubs all JSRs with sentinel increments
 * except `FUN_13A98`, which returns a fixed byte consumed by the caller.
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
  patchRts,
  patchStubAddq,
  patchStubAddqReturnD0Byte,
  readRam,
  writeRam,
  type PatchableSub,
} from "./main-loop-init-parity-lib.js";

const FUN_117B2 = 0x000117b2;
const LOOP_BRA = 0x000118ce;
const RNG_RETURN = 0x5a;
const SENT_BASE = 0x00401e00;

const SUBS: PatchableSub[] = [
  { name: "bootHelper1464A", entry: 0x0001464a, sentinel: SENT_BASE + 0 },
  { name: "init11452", entry: 0x00011452, sentinel: SENT_BASE + 1 },
  { name: "init1101E", entry: 0x0001101e, sentinel: SENT_BASE + 2 },
  { name: "soundCmd158AC", entry: 0x000158ac, sentinel: SENT_BASE + 3 },
  { name: "softReset100E0", entry: 0x000100e0, sentinel: SENT_BASE + 4 },
  { name: "lateLogic26F3E", entry: 0x00026f3e, sentinel: SENT_BASE + 5 },
  { name: "vblankAck", entry: 0x00028dea, sentinel: SENT_BASE + 6 },
];

const WATCHED = [
  { name: "sent0", addr: SENT_BASE + 0, size: 1 as const },
  { name: "sent1", addr: SENT_BASE + 1, size: 1 as const },
  { name: "sent2", addr: SENT_BASE + 2, size: 1 as const },
  { name: "sent3", addr: SENT_BASE + 3, size: 1 as const },
  { name: "sent4", addr: SENT_BASE + 4, size: 1 as const },
  { name: "sent5", addr: SENT_BASE + 5, size: 1 as const },
  { name: "sent6", addr: SENT_BASE + 6, size: 1 as const },
  { name: "400014", addr: 0x00400014, size: 1 as const },
  { name: "400016", addr: 0x00400016, size: 1 as const },
  { name: "400390", addr: 0x00400390, size: 2 as const },
  { name: "400392", addr: 0x00400392, size: 2 as const },
  { name: "400394", addr: 0x00400394, size: 2 as const },
  { name: "40039A", addr: 0x0040039a, size: 1 as const },
  { name: "4003B2", addr: 0x004003b2, size: 1 as const },
  { name: "4003B4", addr: 0x004003b4, size: 1 as const },
  { name: "4003B8", addr: 0x004003b8, size: 2 as const },
  { name: "4003E4", addr: 0x004003e4, size: 1 as const },
  { name: "4003F0", addr: 0x004003f0, size: 1 as const },
  { name: "4003F2", addr: 0x004003f2, size: 1 as const },
  { name: "4003F4", addr: 0x004003f4, size: 1 as const },
  { name: "400444", addr: 0x00400444, size: 1 as const },
  { name: "400768", addr: 0x00400768, size: 2 as const },
  { name: "40076A", addr: 0x0040076a, size: 1 as const },
];

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBuf = Buffer.from(readFileSync(findRomBlobPath()));
  for (const sub of SUBS) {
    if (sub.entry === 0x000158ac) patchStubAddqReturnD0Byte(romBuf, sub.entry, sub.sentinel, 0);
    else patchStubAddq(romBuf, sub.entry, sub.sentinel);
  }
  patchReturnD0Byte(romBuf, 0x00013a98, RNG_RETURN);
  patchRts(romBuf, LOOP_BRA);

  const romView = busNs.emptyRomImage();
  romView.program.set(romBuf);
  const rng = makeRng(0x117b2);
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
    pokeMem(cpu, 0x00400010, 2, 0);
    writeRam(state.workRam, 0x00400010, 2, 0);

    callFunction(cpu, FUN_117B2, [], 100_000);

    initNs.mainLoopInit117B2(state, romView, {
      bootHelper1464A: (s) => incSentinel(s.workRam, SENT_BASE + 0),
      init11452: (s) => incSentinel(s.workRam, SENT_BASE + 1),
      init1101E: (s) => incSentinel(s.workRam, SENT_BASE + 2),
      soundCmd158AC: (s) => {
        incSentinel(s.workRam, SENT_BASE + 3);
        return 0;
      },
      softReset100E0: (s) => incSentinel(s.workRam, SENT_BASE + 4),
      randomMod13A98: () => RNG_RETURN,
      lateLogic26F3E: (s) => incSentinel(s.workRam, SENT_BASE + 5),
      vblankAck: (s) => incSentinel(s.workRam, SENT_BASE + 6),
    });

    let caseOk = true;
    for (const f of WATCHED) {
      const b = peekMem(cpu, f.addr, f.size) >>> 0;
      const t = readRam(state.workRam, f.addr, f.size) >>> 0;
      if (b !== t) {
        firstFail ??= `case ${i} ${f.name}: bin=0x${b.toString(16)} ts=0x${t.toString(16)}`;
        caseOk = false;
        break;
      }
    }
    if (caseOk) ok++;
    disposeCpu(cpu);
  }

  console.log(`\n=== mainLoopInit117B2 parity — ${ok}/${n} ===`);
  if (firstFail) console.log(firstFail);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
