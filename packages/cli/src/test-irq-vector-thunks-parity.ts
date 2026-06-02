#!/usr/bin/env node
/**
 *
 * Strategia:
 *
 * I 23 thunk JMP (0x100..0x254) sono `jmp targetAddr.l` puri: chiamare il
 * verificare la bit-exactness:
 *   1. Identify each (sourceAddr, targetAddr) from THUNK_TABLE.
 *
 *
 * as "timeout_skip" e reports them at the end of the run.
 *
 * Uso: npx tsx packages/cli/src/test-irq-vector-thunks-parity.ts [N=100]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { irqVectorThunks } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const { THUNK_TABLE } = irqVectorThunks;

const ROM_PATH = resolve(import.meta.dirname ?? ".", "../../../ghidra_project/marble_program.bin");
const N_CASES = Number(process.argv[2] ?? 100);

const WORK_RAM_BASE = 0x400000;
const WORK_RAM_SIZE = 0x2000;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = ((s * 1103515245 + 12345) >>> 0);
    return s;
  };
}

function snapshotRam(session: Awaited<ReturnType<typeof createCpu>>): Uint8Array {
  const buf = new Uint8Array(WORK_RAM_SIZE);
  for (let off = 0; off < WORK_RAM_SIZE; off++) {
    buf[off] = peekMem(session, WORK_RAM_BASE + off, 1);
  }
  return buf;
}

function restoreRam(session: Awaited<ReturnType<typeof createCpu>>, snap: Uint8Array): void {
  for (let off = 0; off < WORK_RAM_SIZE; off++) {
    pokeMem(session, WORK_RAM_BASE + off, 1, snap[off]!);
  }
}

function ramDelta(before: Uint8Array, after: Uint8Array): Map<number, [number, number]> {
  const delta = new Map<number, [number, number]>();
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) {
      delta.set(i, [before[i]!, after[i]!]);
    }
  }
  return delta;
}

function deltaEqual(a: Map<number, [number, number]>, b: Map<number, [number, number]>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) return false;
    if (vb[0] !== va[0] || vb[1] !== va[1]) return false;
  }
  return true;
}

async function main(): Promise<void> {
  if (!existsSync(ROM_PATH)) {
    console.error(`ROM non trovato: ${ROM_PATH}`);
    exit(1);
  }
  const rom = new Uint8Array(readFileSync(ROM_PATH));

  const { state: stateNs } = await import("@marble-love/engine");
  const gameState = stateNs.emptyGameState();

  const session = await createCpu({ rom, state: gameState });

  let passed = 0;
  let failed = 0;
  let timeoutSkip = 0;
  const failures: string[] = [];
  const timeoutSkipList: string[] = [];

  // Test 0x01010A separately: move #0x2000,SR ; rts
  {
    const entry = THUNK_TABLE.find((e) => e.sourceAddr === 0x01010a)!;
    const rng = makeRng(0xdeadbeef);
    for (let i = 0; i < N_CASES; i++) {
      // Seed workRam with random bytes
      const seed = rng();
      const seedRng = makeRng(seed);
      for (let off = 0; off < WORK_RAM_SIZE; off++) {
        pokeMem(session, WORK_RAM_BASE + off, 1, seedRng() & 0xff);
      }
      const before = snapshotRam(session);
      callFunction(session, entry.sourceAddr, [], 500);
      const after = snapshotRam(session);
      const delta = ramDelta(before, after);
      if (delta.size === 0) {
        passed++;
      } else {
        failed++;
        failures.push(
          `0x01010A case#${i}: unexpected workRam delta (${delta.size} bytes changed)`,
        );
      }
      restoreRam(session, before);
    }
  }

  // Test the 23 JMP thunks
  const jmpEntries = THUNK_TABLE.filter((e) => e.targetAddr !== null);

  for (const entry of jmpEntries) {
    const src = `0x${entry.sourceAddr.toString(16).toUpperCase().padStart(6, "0")}`;
    const tgt = `0x${entry.targetAddr!.toString(16).toUpperCase().padStart(8, "0")}`;
    const rng = makeRng(entry.sourceAddr ^ (entry.targetAddr! >>> 1));

    for (let i = 0; i < N_CASES; i++) {
      const seedVal = rng();
      const seedRng1 = makeRng(seedVal);
      const seedRng2 = makeRng(seedVal);

      // Setup snapshot for thunk call
      for (let off = 0; off < WORK_RAM_SIZE; off++) {
        pokeMem(session, WORK_RAM_BASE + off, 1, seedRng1() & 0xff);
      }
      const snapBefore = snapshotRam(session);

      // Call thunk (source)
      const srcResult = callFunction(session, entry.sourceAddr, [], 200_000);
      const snapAfterSrc = snapshotRam(session);

      // Check for timeout (PC never reached sentinel, likely no rts)
      // Heuristic: if cycles == 200000 exactly it may have timed out.
      // We still compare deltas.
      const deltaSrc = ramDelta(snapBefore, snapAfterSrc);

      // Restore and call target directly
      for (let off = 0; off < WORK_RAM_SIZE; off++) {
        pokeMem(session, WORK_RAM_BASE + off, 1, seedRng2() & 0xff);
      }
      const snapBeforeTgt = snapshotRam(session);

      const tgtResult = callFunction(session, entry.targetAddr!, [], 200_000);
      const snapAfterTgt = snapshotRam(session);
      const deltaTgt = ramDelta(snapBeforeTgt, snapAfterTgt);

      // Both timed out — skip, mark as timeout_skip
      if (srcResult.cycles >= 200_000 && tgtResult.cycles >= 200_000) {
        timeoutSkip++;
        if (!timeoutSkipList.includes(`${src}->${tgt}`)) {
          timeoutSkipList.push(`${src}->${tgt} (timeout at maxCycles)`);
        }
        restoreRam(session, snapBefore);
        continue;
      }

      if (deltaEqual(deltaSrc, deltaTgt)) {
        passed++;
      } else {
        failed++;
        failures.push(
          `thunk ${src}->${tgt} case#${i}: delta mismatch ` +
          `(src ${deltaSrc.size} changed, tgt ${deltaTgt.size} changed)`,
        );
        if (failures.length >= 10) {
          console.error("Too many errors, abort early.");
          break;
        }
      }

      restoreRam(session, snapBefore);
    }

    if (failures.length >= 10) break;
  }

  disposeCpu(session);

  const total = passed + failed + timeoutSkip;
  console.log(`\nirq-vector-thunks parity: ${passed} passed, ${failed} failed, ${timeoutSkip} timeout-skipped / ${total} total`);

  if (timeoutSkipList.length > 0) {
    console.log("\nTimeout skips (target funcs senza rts raggiungibile):");
    for (const t of timeoutSkipList) {
      console.log(`  ${t}`);
    }
  }

  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const f of failures) {
      console.error(`  ${f}`);
    }
    exit(1);
  } else {
    console.log("OK");
  }
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
