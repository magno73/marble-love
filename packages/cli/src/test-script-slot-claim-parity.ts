#!/usr/bin/env node
/**
 * test-script-slot-claim-parity.ts — differential FUN_12D46 vs claimScriptSlot.
 *
 * `FUN_00012D46` cerca uno slot libero nella tabella ROM @ 0x1F016 (delegando
 * a `FUN_12D6E`) e, se trovato, popola tre campi del record (long @ +0x3A,
 * byte @ +0x1A, byte @ +0x18) inlinando il path mode-0 di `FUN_12F44`.
 *
 * Setup random per ogni caso:
 *   - 25 slot @0x400A9C stride 0x56 → byte +0x18 random (70% occupato, 30% libero)
 *   - argPtr long random
 *   - SP fresco e workRam azzerata sui campi rilevanti
 *
 * Confronto:
 *   - D0 (long, 0 o 0xFFFFFFFF)
 *   - byte slot+0x18 di TUTTI gli slot (per catturare scritture spurie)
 *   - byte slot+0x1A di TUTTI gli slot
 *   - long slot+0x3A di TUTTI gli slot
 *
 * Uso: npx tsx packages/cli/src/test-script-slot-claim-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  scriptSlotClaim as ssNs,
  bus as busNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_12D46 = 0x00012d46;
const ROM_TABLE = 0x0001f016;
const SLOT_COUNT = 0x19;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function readU32BE(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
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

  // Mirror ROM nella RomImage TS.
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  // Decodifica i 25 ptrs della tabella @0x1F016 una sola volta.
  const slotPtrs: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    slotPtrs.push(readU32BE(romBuf, ROM_TABLE + i * 4));
  }

  console.log(`\n=== claimScriptSlot (FUN_00012D46) — ${n} casi ===`);

  const rng = makeRng(0xb1ade);
  let ok = 0;
  let firstFail: {
    i: number;
    argPtr: number;
    binD0: number;
    tsD0: number;
    diffSlot: number | undefined;
    diffField: string | undefined;
    binVal: number | undefined;
    tsVal: number | undefined;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern coverage:
    //   0 : tutti liberi → success su slot 0
    //   1 : tutti occupati → fail (NOT_FOUND)
    //   2 : solo slot[24] libero → success su ultimo
    //   3 : random mix
    //   default >=4: random mix
    const pattern = i < 4 ? i : 3;

    // Setup byte+0x18 di ogni slot.
    for (let s = 0; s < SLOT_COUNT; s++) {
      const slot = slotPtrs[s]!;
      let v: number;
      if (pattern === 0) v = 0;
      else if (pattern === 1) v = Math.floor(rng() * 255) + 1; // sempre !=0
      else if (pattern === 2) v = s === SLOT_COUNT - 1 ? 0 : 1;
      else v = rng() < 0.7 ? Math.floor(rng() * 255) + 1 : 0;

      pokeMem(cpu, slot + 0x18, 1, v);
      stateInst.workRam[(slot - 0x400000) + 0x18] = v;

      // Pre-azzera i campi che FUN_12F44 mode-0 scrive, per detect spurious writes.
      pokeMem(cpu, slot + 0x1a, 1, 0);
      stateInst.workRam[(slot - 0x400000) + 0x1a] = 0;
      for (let k = 0; k < 4; k++) {
        pokeMem(cpu, slot + 0x3a + k, 1, 0);
        stateInst.workRam[(slot - 0x400000) + 0x3a + k] = 0;
      }
    }

    // argPtr long random.
    const argPtr = Math.floor(rng() * 0x100000000) >>> 0;

    // Run binary
    const r = callFunction(cpu, FUN_12D46, [argPtr]);
    const binD0 = r.d0 >>> 0;

    // Run TS
    const tsD0 = ssNs.claimScriptSlot(stateInst, tsRom, argPtr) >>> 0;

    // Compare D0 + tutti i field per ogni slot.
    let match = binD0 === tsD0;
    let diffSlot: number | undefined;
    let diffField: string | undefined;
    let binVal: number | undefined;
    let tsVal: number | undefined;

    if (match) {
      for (let s = 0; s < SLOT_COUNT && match; s++) {
        const slot = slotPtrs[s]!;
        const slotOff = slot - 0x400000;

        const bin18 = peekMem(cpu, slot + 0x18, 1) & 0xff;
        const ts18 = stateInst.workRam[slotOff + 0x18] ?? 0;
        if (bin18 !== ts18) {
          match = false;
          diffSlot = s;
          diffField = "+0x18";
          binVal = bin18;
          tsVal = ts18;
          break;
        }
        const bin1a = peekMem(cpu, slot + 0x1a, 1) & 0xff;
        const ts1a = stateInst.workRam[slotOff + 0x1a] ?? 0;
        if (bin1a !== ts1a) {
          match = false;
          diffSlot = s;
          diffField = "+0x1A";
          binVal = bin1a;
          tsVal = ts1a;
          break;
        }
        const bin3a = peekMem(cpu, slot + 0x3a, 4) >>> 0;
        const ts3a =
          (((stateInst.workRam[slotOff + 0x3a] ?? 0) << 24) |
            ((stateInst.workRam[slotOff + 0x3b] ?? 0) << 16) |
            ((stateInst.workRam[slotOff + 0x3c] ?? 0) << 8) |
            (stateInst.workRam[slotOff + 0x3d] ?? 0)) >>>
          0;
        if (bin3a !== ts3a) {
          match = false;
          diffSlot = s;
          diffField = "+0x3A";
          binVal = bin3a;
          tsVal = ts3a;
          break;
        }
      }
    }

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, argPtr, binD0, tsD0, diffSlot, diffField, binVal, tsVal };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    argPtr=0x${firstFail.argPtr.toString(16)} binD0=0x${firstFail.binD0.toString(16)} tsD0=0x${firstFail.tsD0.toString(16)}`,
    );
    if (firstFail.diffField !== undefined) {
      console.log(
        `    diff slot[${firstFail.diffSlot}] ${firstFail.diffField}: bin=0x${(firstFail.binVal ?? 0).toString(16)} ts=0x${(firstFail.tsVal ?? 0).toString(16)}`,
      );
    }
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
