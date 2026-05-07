#!/usr/bin/env node
/**
 * test-helper-16e8e-parity.ts — differential FUN_16E8E vs helper16E8E.
 *
 * FUN_16E8E cancella le righe dell'alpha tilemap da `startRow` (low byte
 * dell'arg long) fino a 0x1E (esclusa). Per ogni riga r chiama
 * getAlphaTileAddr(col=3, row=r) → indirizzo, poi azzera 0x24 word.
 *
 * Per ogni caso:
 *   1. Imposta rotation random in workRam + binary memory
 *   2. Riempie alpha RAM con sentinel 0xCC
 *   3. Esegue binario via callFunction(0x16e8e, [startRow])
 *   4. Esegue TS helper16E8E(state, rom, startRow)
 *   5. Confronta alpha RAM byte-by-byte
 *
 * Uso: npx tsx packages/cli/src/test-helper-16e8e-parity.ts [N]
 * (default N=500)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, bus as busNs, helper16E8E as helper16E8ENs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_16E8E = 0x00016e8e;
const ROTATION_ADDR = 0x00401f42;
const SENTINEL_ADDR = 0xcafebabe >>> 0;

/**
 * Chiama una funzione M68k via step-by-step (instruction-by-instruction)
 * per evitare l'interferenza degli IRQ che si verificano con sys.run() burst.
 * FUN_16E8E richiede ~5k istruzioni per 29 iterazioni.
 */
function callFunctionStep(
  session: CpuSession,
  addr: number,
  argsLong: readonly number[],
  maxSteps = 50_000,
): void {
  const sys = session.system;
  let sp = sys.getRegisters().sp;
  for (let i = argsLong.length - 1; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, argsLong[i]! >>> 0);
  }
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_ADDR);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);
  for (let i = 0; i < maxSteps; i++) {
    if (sys.getRegisters().pc === SENTINEL_ADDR) break;
    sys.step();
  }
  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 4 * argsLong.length) >>> 0);
}

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
  const romBuf = readFileSync(findRomBlobPath());

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  const rng = makeRng(0x16e8e);

  let ok = 0;
  type FailInfo = {
    caseNo: number;
    startRow: number;
    rotation: number;
    offset: number;
    bin: number;
    ts: number;
  };
  let firstFail: FailInfo | null = null;

  console.log(`\n=== helper16E8E (FUN_16E8E) — ${n} casi ===`);

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Random rotation (0..7 are valid M68K alpha rotation values)
    const rotation = Math.floor(rng() * 8);
    // startRow in [0, 30) — valid row range for this function
    const startRow = Math.floor(rng() * 30);

    // Sync rotation to both binary memory and TS workRam
    pokeMem(cpu, ROTATION_ADDR, 2, rotation);
    stateInst.workRam[0x1f42] = 0;
    stateInst.workRam[0x1f43] = rotation;

    // Fill alpha RAM with sentinel 0xCC in both binary and TS
    for (let j = 0; j < 0x1000; j++) {
      pokeMem(cpu, 0xa03000 + j, 1, 0xcc);
      stateInst.alphaRam[j] = 0xcc;
    }

    // Run binary oracle via step-by-step to avoid IRQ interference
    callFunctionStep(cpu, FUN_16E8E, [startRow]);

    // Run TS implementation
    helper16E8ENs.helper16E8E(stateInst, tsRom, startRow);

    // Compare alpha RAM byte-by-byte
    let match = true;
    for (let j = 0; j < 0x1000; j++) {
      const bin = peekMem(cpu, 0xa03000 + j, 1);
      const ts = stateInst.alphaRam[j] ?? 0;
      if (bin !== ts) {
        firstFail ??= {
          caseNo: i,
          startRow,
          rotation,
          offset: j,
          bin,
          ts,
        };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail !== null) {
    const { caseNo, startRow, rotation, offset, bin, ts } = firstFail;
    console.log(
      `  First fail: case=${caseNo} startRow=${startRow} rotation=${rotation}`,
    );
    console.log(
      `    alphaRam[0x${offset.toString(16)}]: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
