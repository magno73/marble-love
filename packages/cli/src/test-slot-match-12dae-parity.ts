#!/usr/bin/env node
/**
 * test-slot-match-12dae-parity.ts — differential FUN_00012DAE vs slotMatch12DAE.
 *
 * if it finds:
 *   - byte slot+0x18 == 1 AND
 *     ( long slot+0x3A == *(arg+2).l OR
 *       ( *(arg+2).l == 0 AND byte slot+0x1F == 0xC ) )
 *
 *   - byte slot+0x18: 50% == 1 (occupied match-eligible), 25% == 0, 25% random.
 *   - long slot+0x3A: 30% == target (match key), 70% random.
 *   - byte slot+0x1F: 30% == 0xC, 70% random.
 *
 *   - D0 (low byte compared as byte → match on the single output bit).
 *
 * Usage: npx tsx packages/cli/src/test-slot-match-12dae-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  slotMatch12DAE as ns,
  bus as busNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_12DAE = 0x00012dae;
const SLOT_BASE = 0x00400a9c;
const SLOT_STRIDE = 0x56;
const SLOT_COUNT = 0x19;
const ARG_PTR = 0x00401d00;

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
  const romBuf = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));
  void tsRom;

  console.log(`\n=== slotMatch12DAE (FUN_00012DAE) — ${n} cases ===`);

  const rng = makeRng(0x12dae);
  let ok = 0;
  let firstFail: {
    i: number;
    target: number;
    binD0: number;
    tsD0: number;
    pattern: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern coverage:
    //  4 : only slot[24] matches (boundary, last slot).
    //  >=5: random mix.
    const pattern = i < 5 ? i : 5;

    // *(arg+2): for patterns 2/3 we force target=0 to activate the alt-path.
    let target: number;
    if (pattern === 2 || pattern === 3) {
      target = 0;
    } else {
      target = rng() < 0.5 ? 0 : Math.floor(rng() * 0x100000000) >>> 0;
    }
    pokeMem(cpu, ARG_PTR + 2, 4, target);
    stateInst.workRam[(ARG_PTR - 0x400000) + 2] = (target >>> 24) & 0xff;
    stateInst.workRam[(ARG_PTR - 0x400000) + 3] = (target >>> 16) & 0xff;
    stateInst.workRam[(ARG_PTR - 0x400000) + 4] = (target >>> 8) & 0xff;
    stateInst.workRam[(ARG_PTR - 0x400000) + 5] = target & 0xff;

    // Setup 25 slots.
    for (let s = 0; s < SLOT_COUNT; s++) {
      const slot = SLOT_BASE + s * SLOT_STRIDE;

      // byte slot+0x18
      let v18: number;
      if (pattern === 0) v18 = 0;
      else if (pattern === 1 || pattern === 2 || pattern === 3) v18 = 1;
      else if (pattern === 4) v18 = s === SLOT_COUNT - 1 ? 1 : 0;
      else {
        const r = rng();
        if (r < 0.5) v18 = 1;
        else if (r < 0.75) v18 = 0;
        else v18 = Math.floor(rng() * 256);
      }
      pokeMem(cpu, slot + 0x18, 1, v18);
      stateInst.workRam[(slot - 0x400000) + 0x18] = v18;

      // long slot+0x3A
      let key3a: number;
      if (pattern === 1) key3a = target;
      else if (pattern === 2) key3a = 0; // == target=0 → match (early)
      else if (pattern === 3) key3a = 0xdeadbeef; // != target=0 → fall-through
      else if (pattern === 4) key3a = s === SLOT_COUNT - 1 ? target : 0xcafef00d;
      else {
        key3a = rng() < 0.3 ? target : Math.floor(rng() * 0x100000000) >>> 0;
      }
      pokeMem(cpu, slot + 0x3a, 4, key3a);
      stateInst.workRam[(slot - 0x400000) + 0x3a] = (key3a >>> 24) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x3b] = (key3a >>> 16) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x3c] = (key3a >>> 8) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x3d] = key3a & 0xff;

      // byte slot+0x1F
      let v1f: number;
      if (pattern === 3) v1f = 0x0c;
      else v1f = rng() < 0.3 ? 0x0c : Math.floor(rng() * 256);
      pokeMem(cpu, slot + 0x1f, 1, v1f);
      stateInst.workRam[(slot - 0x400000) + 0x1f] = v1f;
    }

    // Snapshot work RAM (to detect spurious writes on the oracle side).
    const tsBefore = new Uint8Array(stateInst.workRam);

    // Run binary
    const r = callFunction(cpu, FUN_12DAE, [ARG_PTR]);
    const binD0 = r.d0 & 0xff;

    // Run TS (read-only)
    const tsD0 = ns.slotMatch12DAE(stateInst, ARG_PTR) & 0xff;

    let match = binD0 === tsD0;

    if (match) {
      for (let k = 0; k < tsBefore.length; k++) {
        if ((stateInst.workRam[k] ?? 0) !== (tsBefore[k] ?? 0)) {
          match = false;
          break;
        }
      }
    }

    if (match) ok++;
    else if (firstFail === null) {
      firstFail = { i, target, binD0, tsD0, pattern };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i} (pattern ${firstFail.pattern}):`);
    console.log(
      `    target=0x${firstFail.target.toString(16)} binD0=0x${firstFail.binD0.toString(16)} tsD0=0x${firstFail.tsD0.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
