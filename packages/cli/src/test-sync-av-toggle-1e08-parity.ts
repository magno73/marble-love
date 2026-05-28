#!/usr/bin/env node
/**
 * test-sync-av-toggle-1e08-parity.ts — differential FUN_1E08 vs syncAvToggle1E08.
 *
 * 2 "1" bits from the event queue (*0x400006), writing 0x0000 and 0x0080 to MMIO
 *
 * **Strategia parity**:
 *     `bit0(*0x400000) == 1` e `bit0(*0x40017C) == 0`. Bit 1..15 random.
 *     to guarantee that both inner loops terminate.
 *       * 0x400000..0x400001 (input port) — unchanged (read-only)
 *       * 0x40017C..0x40017D (edge detector prev → low2 di port)
 *
 * MMIO writes to 0x860000 are ignored by Musashi because the region is unmapped
 * workRam coincide perfettamente.
 *
 * Suite testate (4 × 125 = 500):
 *   - A: queue with 2 scattered 1 bits (random positioning)
 *   - B: queue with bit 0 and bit 1 set (minimum pops: 2 total)
 *   - C: queue full (0xFFFF, pop minimi: 2 totali)
 *   - D: queue with exactly 2 bits set in high positions (high pops)
 *
 * Uso: npx tsx packages/cli/src/test-sync-av-toggle-1e08-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  syncAvToggle1E08 as sub1E08Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_1E08 = 0x00001e08;

const PORT_ABS = 0x00400000; // input port (read by FUN_F6A)
const FLAGS_ABS = 0x00400006; // event flag queue (read/shift by FUN_2548)
const PREV_ABS = 0x0040017c; // edge detector prev state

interface FailRecord {
  suite: string;
  tc: number;
  field: string;
  bin: number;
  ts: number;
  setup: { port: number; prev: number; flags: number };
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function readWord(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

function writeWordToBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: Awaited<ReturnType<typeof createCpu>>,
  absAddr: number,
  value: number,
): void {
  pokeMem(cpu, absAddr, 2, value & 0xffff);
  const off = absAddr - 0x400000;
  state.workRam[off] = (value >>> 8) & 0xff;
  state.workRam[off + 1] = value & 0xff;
}

/** Generate a word with at least `minOnes` bits set. */
function genWordWithMinOnes(rng: () => number, minOnes: number): number {
  let w = Math.floor(rng() * 0x10000) & 0xffff;
  // Conta i bit set.
  let count = 0;
  let tmp = w;
  while (tmp !== 0) {
    if ((tmp & 1) !== 0) count++;
    tmp >>>= 1;
  }
  while (count < minOnes) {
    const pos = Math.floor(rng() * 16);
    const mask = 1 << pos;
    if ((w & mask) === 0) {
      w |= mask;
      count++;
    }
  }
  return w & 0xffff;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 4);
  const remainder = total - perSuite * 4;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  const rng = makeRng(0x1e08);
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    portWord: number,
    prevWord: number,
    flagsWord: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401efc);

    // Setup state in entrambi
    writeWordToBoth(stateInst, cpu, PORT_ABS, portWord);
    writeWordToBoth(stateInst, cpu, PREV_ABS, prevWord);
    writeWordToBoth(stateInst, cpu, FLAGS_ABS, flagsWord);

    callFunction(cpu, FUN_1E08, [], 200_000);

    // Run TS replica
    sub1E08Ns.syncAvToggle1E08(stateInst, {
      maxIterations: 256,
      maxFlagPops: 100_000,
    });

    // Compare workRam delta su 3 word (port, prev, flags).
    const binPort = peekMem(cpu, PORT_ABS, 2);
    const tsPort = readWord(stateInst.workRam, 0x00);
    if (binPort !== tsPort) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          field: "port(0x400000)",
          bin: binPort,
          ts: tsPort,
          setup: { port: portWord, prev: prevWord, flags: flagsWord },
        };
      }
      return false;
    }

    const binPrev = peekMem(cpu, PREV_ABS, 2);
    const tsPrev = readWord(stateInst.workRam, 0x17c);
    if (binPrev !== tsPrev) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          field: "prev(0x40017C)",
          bin: binPrev,
          ts: tsPrev,
          setup: { port: portWord, prev: prevWord, flags: flagsWord },
        };
      }
      return false;
    }

    const binFlags = peekMem(cpu, FLAGS_ABS, 2);
    const tsFlags = readWord(stateInst.workRam, 0x06);
    if (binFlags !== tsFlags) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          field: "flags(0x400006)",
          bin: binFlags,
          ts: tsFlags,
          setup: { port: portWord, prev: prevWord, flags: flagsWord },
        };
      }
      return false;
    }

    return true;
  }

  /**
   * Generate port with bit 0 = 1 (low byte LSB), prev with bit 0 = 0,
   * other random bits.
   */
  function genTermiantingPair(rngFn: () => number): {
    port: number;
    prev: number;
  } {
    // big-endian = workRam[1] & 1) must be 1.
    const port = (Math.floor(rngFn() * 0x10000) & 0xfffe) | 0x0001;
    // dell'XOR (vedi event-flags.ts).
    const prev = Math.floor(rngFn() * 0x10000) & 0xfffe;
    return { port, prev };
  }

  let totalOk = 0;

  // ─── Suite A: random everything (queue ≥ 2 ones) ──────────────────────
  console.log(
    `\n=== syncAvToggle1E08 (FUN_1E08) — Suite A: random — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const { port, prev } = genTermiantingPair(rng);
    const flags = genWordWithMinOnes(rng, 2);
    if (runOneCase("A", i, port, prev, flags)) okA++;
  }
  console.log(
    `  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okA;

  console.log(
    `\n=== Suite B: queue = bit0+bit1 (2 pop) — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const { port, prev } = genTermiantingPair(rng);
    if (runOneCase("B", i, port, prev, 0b11)) okB++;
  }
  console.log(
    `  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okB;

  // ─── Suite C: queue full 0xFFFF ──────────────────────────────────────
  console.log(`\n=== Suite C: queue = 0xFFFF — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const { port, prev } = genTermiantingPair(rng);
    if (runOneCase("C", i, port, prev, 0xffff)) okC++;
  }
  console.log(
    `  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okC;

  // ─── Suite D: 2 bit set in posizioni alte (pop massimi) ──────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: 2 bit set in posizioni alte — ${sizeD} casi ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const { port, prev } = genTermiantingPair(rng);
    // 2 bits set in positions 8..15; requires 9+ total pops to reach them.
    const a = 8 + Math.floor(rng() * 8);
    let b = 8 + Math.floor(rng() * 8);
    while (b === a) b = 8 + Math.floor(rng() * 8);
    const flags = ((1 << a) | (1 << b)) & 0xffff;
    if (runOneCase("D", i, port, prev, flags)) okD++;
  }
  console.log(
    `  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`,
  );
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): ${f.field} ` +
        `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)} ` +
        `setup port=0x${f.setup.port.toString(16)} ` +
        `prev=0x${f.setup.prev.toString(16)} ` +
        `flags=0x${f.setup.flags.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
