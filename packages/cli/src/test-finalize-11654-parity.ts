#!/usr/bin/env node
/**
 * test-finalize-11654-parity.ts — differential FUN_11654 vs finalize11654.
 *
 * FUN_11654 is the attract-sequence string renderer / finalizer. It has 3 JSR
 * targets:
 *   0x00000142 — renderString0142 (FUN_2572 via trampoline)
 *   0x00000100 — textRender100 (FUN_2A24 → FUN_2572 via trampoline)
 *   0x00028DB8 — waitVblankStateGated
 *
 * All three are patched to sentinel stubs (addq.b #1,@sentinel; rts).
 *
 * NOTE: FUN_11654 is a short function (~75 instructions). The burst-based
 * `callFunction` helper would overshoot the sentinel return address and execute
 * garbage, corrupting sentinels. We use `runUntil` (step-by-step) instead.
 *
 * Watched regions:
 *   - sentinel call-count bytes for the 3 sub addresses
 *   - workRam[0x4003EE] (path A writes 2, path B writes 1)
 *
 * 500 random cases covering all branches:
 *   - mode ∈ {0,1,2,3}
 *   - counter cycles through {0xFFFF, 0, 5, 11, 12, 17, 23, 24, 30, 100}
 */

import { readFileSync } from "node:fs";
import { exit } from "node:process";
import { finalize11654 as f11654Ns, state as stateNs } from "@marble-love/engine";
import type { GameState } from "@marble-love/engine";
import { createCpu, disposeCpu, peekMem, pokeMem, runUntil } from "./binary-oracle-lib.js";
import {
  findRomBlobPath,
  makeRng,
  patchStubAddq,
  readRam,
  writeRam,
  incSentinel,
  type PatchableSub,
} from "./main-loop-init-parity-lib.js";

const { finalize11654 } = f11654Ns;

const FUN_11654 = 0x00011654;
const SENT_BASE = 0x00401d00;

const SUBS: PatchableSub[] = [
  { name: "renderString0142",   entry: 0x00000142, sentinel: SENT_BASE + 0 },
  { name: "textRender100",      entry: 0x00000100, sentinel: SENT_BASE + 1 },
  { name: "waitVblankStateGated", entry: 0x00028db8, sentinel: SENT_BASE + 2 },
];

const WATCHED_ADDRS = [
  { name: "sent_r0142", addr: SENT_BASE + 0, size: 1 as const },
  { name: "sent_tr100", addr: SENT_BASE + 1, size: 1 as const },
  { name: "sent_wait",  addr: SENT_BASE + 2, size: 1 as const },
  { name: "4003EE",     addr: 0x004003ee,    size: 1 as const },
];

/** Execute FUN_11654 step-by-step and stop exactly at RTS sentinel. */
function runFun11654(cpu: Awaited<ReturnType<typeof createCpu>>): void {
  const SENTINEL_RET_ADDR = 0xcafebabe >>> 0;
  const sys = cpu.system;
  const sp = sys.getRegisters().sp;
  const newSp = (sp - 4) >>> 0;
  sys.write(newSp, 4, SENTINEL_RET_ADDR);
  sys.setRegister("sp", newSp);

  runUntil(cpu, FUN_11654, SENTINEL_RET_ADDR, 5_000);

  // Restore SP (pop the sentinel return address slot)
  sys.setRegister("sp", (sys.getRegisters().sp + 4) >>> 0);
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBuf = Buffer.from(readFileSync(findRomBlobPath()));

  for (const sub of SUBS) patchStubAddq(romBuf, sub.entry, sub.sentinel);

  const rng = makeRng(0x11654);
  let ok = 0;
  let firstFail: string | null = null;

  const counterChoices = [0xffff, 0, 5, 11, 12, 17, 23, 24, 30, 100];

  for (let i = 0; i < n; i++) {
    const mode = i % 4;
    const counter = counterChoices[i % counterChoices.length] ?? Math.floor(rng() * 256);

    const s = stateNs.emptyGameState();
    const cpu = await createCpu({ rom: romBuf, state: s });
    cpu.system.setRegister("sp", 0x401f00);

    // Set mode and counter
    writeRam(s.workRam, 0x00400392, 2, mode);
    pokeMem(cpu, 0x00400392, 2, mode);
    writeRam(s.workRam, 0x004003ea, 2, counter);
    pokeMem(cpu, 0x004003ea, 2, counter);

    // Randomize watched regions in both
    for (const f of WATCHED_ADDRS) {
      const val = Math.floor(rng() * 0x100) & 0xff;
      writeRam(s.workRam, f.addr, 1, val);
      pokeMem(cpu, f.addr, 1, val);
    }
    // Reset sentinels to 0 for clean counting
    for (const sub of SUBS) {
      writeRam(s.workRam, sub.sentinel, 1, 0);
      pokeMem(cpu, sub.sentinel, 1, 0);
    }

    // Run binary oracle via step-by-step (avoids burst overshoot)
    runFun11654(cpu);

    // Run TS implementation
    finalize11654(s, undefined, {
      renderString0142: (st: GameState) => incSentinel(st.workRam, SUBS[0]!.sentinel),
      textRender100:    (st: GameState) => incSentinel(st.workRam, SUBS[1]!.sentinel),
      waitVblankStateGated: (st: GameState) => incSentinel(st.workRam, SUBS[2]!.sentinel),
    });

    // Compare all watched locations
    let caseOk = true;
    for (const f of WATCHED_ADDRS) {
      const b = peekMem(cpu, f.addr, f.size) >>> 0;
      const t = readRam(s.workRam, f.addr, f.size) >>> 0;
      if (b !== t) {
        firstFail ??= `case ${i} mode=${mode} counter=0x${counter.toString(16)} ${f.name}: bin=0x${b.toString(16)} ts=0x${t.toString(16)}`;
        caseOk = false;
        break;
      }
    }
    if (caseOk) ok++;
    disposeCpu(cpu);
  }

  console.log(`\n=== finalize11654 (FUN_11654) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${firstFail}`);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
