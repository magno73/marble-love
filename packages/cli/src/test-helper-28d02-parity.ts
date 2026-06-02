#!/usr/bin/env node
/**
 * test-helper-28d02-parity.ts — differential parity for `FUN_00028D02`
 * vs `helper28D02`.
 *
 * `FUN_00028D02` is the "PF-RAM scroll-buffer swap" helper.
 * It reads `*(0x400000).w` (xscroll) to compute a PF RAM base address,
 * then for 16 consecutive rows either:
 *   - SAVE (flag=1): copies 4 words from the primary bank to the secondary
 *     bank, replacing them in the primary bank with 0x0000/0x0010/0x0020/0x0030.
 *   - RESTORE (flag=0): copies 4 words from the secondary bank back to the
 *     primary bank.
 *
 * For each case:
 *   1. Random xscroll (masked & 0xfff8) written to workRam[0] and MMIO 0x400000.
 *   2. PF RAM filled with random data (both binary side and TS side).
 *   3. Random flag (0 or 1) passed to both binary and TS.
 *   4. Compare entire PF RAM (0xA00000–0xA01FFF, 0x2000 bytes) after the call.
 *
 * Usage: npx tsx packages/cli/src/test-helper-28d02-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { helper28D02 as h28D02Ns, state as stateNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_28D02 = 0x00028d02;
const PF_RAM_BASE = 0xa00000;
const PF_RAM_SIZE = 0x2000;
const WORK_RAM_BASE = 0x00400000;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.",
  );
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const rom = readFileSync(findRomBlobPath());
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });

  console.log(`\n=== helper28D02 (FUN_28D02) — ${n} cases ===`);

  const rng = makeRng(0x28d02);
  let ok = 0;
  let firstFail: {
    caseNo: number;
    flag: number;
    xscroll: number;
    offset: number;
    bin: number;
    ts: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);

    // ─── Generate deterministic inputs ──────────────────────────────────

    // xscroll: the function computes A0 = (xscroll & 0xfff8) * 16 + 0xa00440.
    // For A0 to stay within PF RAM [0xa00000..0xa01fff], (xscroll & 0xfff8) * 16
    // must be in [0..0x1bbf] → valid xscroll range ≈ [0..0x1b8].
    // Use small realistic values with alignment to 8 (& 0xfff8 rounds down to multiple of 8).
    // Range: 0..0x1b0 (step 8) → 55 distinct values. Random within that range.
    const xscrollRaw = (Math.floor(rng() * 0x1b8) & 0xfff8) >>> 0;
    // flag: alternate 0/1 first few, then random
    let flag: number;
    if (i < 4) {
      flag = i % 2; // 0, 1, 0, 1
    } else if (i < 8) {
      flag = i % 2 === 0 ? 0 : 1;
    } else {
      flag = rng() < 0.5 ? 0 : 1;
    }

    // Generate random PF RAM content
    const pfData = new Uint8Array(PF_RAM_SIZE);
    for (let j = 0; j < PF_RAM_SIZE; j++) {
      pfData[j] = Math.floor(rng() * 256) & 0xff;
    }

    // ─── Setup binary side ───────────────────────────────────────────────
    // Write xscroll word to workRam @ 0x400000
    pokeMem(cpu, WORK_RAM_BASE, 2, xscrollRaw);
    // Write PF RAM
    for (let j = 0; j < PF_RAM_SIZE; j++) {
      pokeMem(cpu, PF_RAM_BASE + j, 1, pfData[j] ?? 0);
    }
    // Sync xscroll into binState.workRam
    binState.workRam[0] = (xscrollRaw >>> 8) & 0xff;
    binState.workRam[1] = xscrollRaw & 0xff;

    // ─── Run binary ──────────────────────────────────────────────────────
    callFunction(cpu, FUN_28D02, [flag], 500_000);

    // ─── Setup TS side ───────────────────────────────────────────────────
    tsState.workRam[0] = (xscrollRaw >>> 8) & 0xff;
    tsState.workRam[1] = xscrollRaw & 0xff;
    tsState.playfieldRam.set(pfData);

    // ─── Run TS ──────────────────────────────────────────────────────────
    h28D02Ns.helper28D02(tsState, flag);

    // ─── Compare PF RAM ──────────────────────────────────────────────────
    let match = true;
    for (let j = 0; j < PF_RAM_SIZE; j++) {
      const binByte = peekMem(cpu, PF_RAM_BASE + j, 1) & 0xff;
      const tsByte = tsState.playfieldRam[j] ?? 0;
      if (binByte !== tsByte) {
        match = false;
        if (firstFail === null) {
          firstFail = {
            caseNo: i,
            flag,
            xscroll: xscrollRaw,
            offset: j,
            bin: binByte,
            ts: tsByte,
          };
        }
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.caseNo} (flag=${f.flag}, xscroll=0x${f.xscroll.toString(16)}):`);
    console.log(
      `    diff at PF offset 0x${f.offset.toString(16)} (addr 0x${(PF_RAM_BASE + f.offset).toString(16)}): bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
