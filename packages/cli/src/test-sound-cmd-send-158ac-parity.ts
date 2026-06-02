#!/usr/bin/env node
/**
 * test-sound-cmd-send-158ac-parity.ts — differential FUN_158AC vs soundCmdSend158AC.
 *
 * comandi al sound CPU (6502 via mailbox MMIO 0xFE0000). 98 callsite in the ROM.
 *
 * Logica:
 *   2. If != 0 → skip, D0=0.
 *
 * Setup invariante per convergenza deterministica:
 *   - MMIO 0xF60001 = 0x00 (bit 7 clear = chip ready) → FUN_4C6E riesce al
 *
 *   case 0: skipFlag=0, byteArg random → bin D0=1, ts D0=1
 *   case 1: skipFlag!=0, byteArg random → bin D0=0, ts D0=0
 *   case 2: skipFlag=0, byteArg=0x80 (sign-ext negativo) → D0=1
 *   case 3: skipFlag=0x0001 (low byte only) -> D0=0
 *   case >=4: full random (50/50 skip vs send)
 *
 * Uso: npx tsx packages/cli/src/test-sound-cmd-send-158ac-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  soundCmdSend158AC as csNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_158AC = 0x000158ac;
const SKIP_FLAG_ADDR = 0x004003b8;
const CHIP_STATUS_ADDR = 0xf60001;
const MAILBOX_ADDR = 0x00fe0000;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
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

  console.log(`\n=== soundCmdSend158AC (FUN_158AC) — ${n} cases ===`);

  const rng = makeRng(0x158ac);
  let ok = 0;
  let firstFail: {
    i: number;
    byteArg: number;
    skipFlag: number;
    binD0: number;
    tsD0: number;
  } | null = null;

  pokeMem(cpu, CHIP_STATUS_ADDR, 1, 0x00);

  for (let i = 0; i < n; i++) {
    // Reset SP (callFunction uses the stack for the sentinel return + arg).
    cpu.system.setRegister("sp", 0x401f00);

    const pattern = i < 4 ? i : Math.floor(rng() * 4) + 4;
    let skipFlag: number;
    let byteArg: number;

    switch (pattern) {
      case 0:
        skipFlag = 0;
        byteArg = Math.floor(rng() * 256);
        break;
      case 1:
        skipFlag = (Math.floor(rng() * 0xfffe) + 1) & 0xffff;
        byteArg = Math.floor(rng() * 256);
        break;
      case 2:
        skipFlag = 0;
        byteArg = 0x80; // sign-extend negativo
        break;
      case 3:
        skipFlag = 0x0001; // solo low byte
        byteArg = Math.floor(rng() * 256);
        break;
      default:
        // Full random: 50/50 skip vs send
        skipFlag = rng() < 0.5 ? 0 : Math.floor(rng() * 0x10000);
        byteArg = Math.floor(rng() * 256);
        break;
    }

    // Setup workRam skip flag (big-endian word) in Musashi e in state TS.
    pokeMem(cpu, SKIP_FLAG_ADDR, 2, skipFlag);
    state.workRam[0x3b8] = (skipFlag >>> 8) & 0xff;
    state.workRam[0x3b9] = skipFlag & 0xff;

    pokeMem(cpu, CHIP_STATUS_ADDR, 1, 0x00);

    pokeMem(cpu, MAILBOX_ADDR, 2, 0x0000);

    const r = callFunction(cpu, FUN_158AC, [byteArg & 0xff]);
    const binD0 = r.d0 & 0xff; // 0 o 1

    // Esegui TS replica.
    const tsD0 = csNs.soundCmdSend158AC(state, byteArg);

    const match = binD0 === tsD0;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, byteArg, skipFlag, binD0, tsD0 };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: byteArg=0x${firstFail.byteArg.toString(16).padStart(2, "0")} ` +
        `skipFlag=0x${firstFail.skipFlag.toString(16).padStart(4, "0")}`,
    );
    console.log(`    bin D0=${firstFail.binD0}  ts D0=${firstFail.tsD0}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
