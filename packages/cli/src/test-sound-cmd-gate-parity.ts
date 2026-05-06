#!/usr/bin/env node
/**
 * test-sound-cmd-gate-parity.ts — differential FUN_4420 vs soundCmdGate.
 *
 * `FUN_00004420` è il sound command gate validator: prende `(cmdIndex, data)`
 * sullo stack, azzera `data` se `cmdIndex < 0x0B` (unsigned), poi delega a
 * `FUN_00004442`.
 *
 * Strategia di parity test:
 *   - Per ogni caso settiamo `cmdIndex` (arg1) e `data` (arg2) sullo stack
 *     prima della jsr, poi confrontiamo i 2 valori che il binario passa allo
 *     stack-frame di `FUN_00004442` quando vi entra.
 *   - Cattura: settiamo PC = 0x4420, eseguiamo finché PC == 0x4442 (entry
 *     point del dispatcher), poi leggiamo i 2 long sullo stack `(0x4,SP)` e
 *     `(0x8,SP)` (stack visto dal callee con ret addr in (0,SP)).
 *   - Confrontiamo (cmdIndexSeen, dataSeen) con il valore TS via stub inner
 *     che cattura gli stessi parametri.
 *
 * Uso: npx tsx packages/cli/src/test-sound-cmd-gate-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { soundCmdGate as gateNs, state as stateNs } from "@marble-love/engine";
import {
  createCpu,
  disposeCpu,
  peekMem,
} from "./binary-oracle-lib.js";

const FUN_4420 = 0x00004420;
const FUN_4442 = 0x00004442;
const SENTINEL_RET = 0xcafebabe >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Captured {
  cmdIdx: number;
  data: number;
}

function captureEnter4442Args(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  cmdIdx: number,
  data: number,
): Captured {
  const sys = cpu.system;

  // Stack iniziale: SP = 0x401F00. Push args RTL: data first (arg2), then
  // cmdIdx (arg1). FUN_4420 vede (0x8,SP)=cmdIdx (perché c'è anche move.l
  // D2,-(SP) prima → +4 e ret_addr +4 = 8 byte di offset).
  const sp0 = 0x401f00;
  let sp = sp0;
  // Push arg2 (data) — sarà a (0xC, SP) dopo prologo (4 push D2 + 4 ret + 4 arg1)
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, data >>> 0);
  // Push arg1 (cmdIdx) — sarà a (0x8, SP) dopo prologo
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, cmdIdx >>> 0);
  // Push sentinel return address
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);

  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_4420);

  // Step instruction-by-instruction finché PC == 0x4442 (entrato nel dispatcher).
  // Limite generoso (la gate è 8 istruzioni → < 30 step richiesti).
  let reached = false;
  for (let i = 0; i < 200; i++) {
    if (sys.getRegisters().pc === FUN_4442) {
      reached = true;
      break;
    }
    if (sys.getRegisters().pc === SENTINEL_RET) break;
    sys.step();
  }

  if (!reached) {
    return { cmdIdx: -1, data: -1 };
  }

  // FUN_4442 entry: stack è [ret_addr_to_4420_post_jsr, arg1, arg2, ...]
  // (4,SP)=arg1, (8,SP)=arg2.
  const spNow = sys.getRegisters().sp;
  const seenCmdIdx = peekMem(cpu, spNow + 4, 4) >>> 0;
  const seenData = peekMem(cpu, spNow + 8, 4) >>> 0;
  return { cmdIdx: seenCmdIdx, data: seenData };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== soundCmdGate (FUN_4420) — ${n} casi ===`);

  const rng = makeRng(0xdeadbeef);
  let ok = 0;
  let firstFail: {
    i: number;
    cmdIdx: number;
    data: number;
    binCmd: number;
    binData: number;
    tsCmd: number;
    tsData: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    // Pattern: cover boundary cases + random
    let cmdIdx: number;
    let data: number;
    if (i === 0) {
      cmdIdx = 0x00; data = 0x12345678;        // clear path
    } else if (i === 1) {
      cmdIdx = 0x0a; data = 0xffffffff;        // boundary clear (max)
    } else if (i === 2) {
      cmdIdx = 0x0b; data = 0xcafebabe;        // boundary no-clear
    } else if (i === 3) {
      cmdIdx = 0x0c; data = 0xdeadbeef;        // typical caller value
    } else if (i === 4) {
      cmdIdx = 0xffffffff >>> 0; data = 0x42;  // huge unsigned, no clear
    } else if (i < 30) {
      // Sweep di cmdIdx ∈ [0, 0x14] (copre il bordo 0x0B con margine)
      cmdIdx = (i - 5) & 0x1f;
      data = Math.floor(rng() * 0x100000000) >>> 0;
    } else {
      // Bias: 30% nel range [0,0x14] per stressare il bordo, 70% full random
      const inBoundary = rng() < 0.3;
      cmdIdx = inBoundary
        ? Math.floor(rng() * 0x15)
        : Math.floor(rng() * 0x100000000) >>> 0;
      data = Math.floor(rng() * 0x100000000) >>> 0;
    }

    // Run binary: cattura args che 4442 riceve
    const bin = captureEnter4442Args(cpu, cmdIdx, data);

    // Run TS: cattura args che l'inner riceve
    let tsCmd = -1;
    let tsData = -1;
    gateNs.soundCmdGate(cmdIdx, data, (cidx: number, d: number) => {
      tsCmd = cidx;
      tsData = d;
      return 0;
    });

    const match =
      bin.cmdIdx === tsCmd &&
      bin.data === tsData &&
      bin.cmdIdx !== -1; // -1 = capture failure
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        cmdIdx,
        data,
        binCmd: bin.cmdIdx,
        binData: bin.data,
        tsCmd,
        tsData,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: cmdIdx=0x${firstFail.cmdIdx.toString(16)} data=0x${firstFail.data.toString(16)}`,
    );
    console.log(
      `    bin: cmdIdx=0x${firstFail.binCmd.toString(16)} data=0x${firstFail.binData.toString(16)}`,
    );
    console.log(
      `    ts : cmdIdx=0x${firstFail.tsCmd.toString(16)} data=0x${firstFail.tsData.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
