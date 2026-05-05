#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, nearestNeighbor } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x00015d10;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xdada);

  console.log(`\n=== findNearestNeighbor (FUN_15D10) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const OBJ = 0x00401D00;
    const LIST = 0x00401D80;
    // Random obj+0xC, +0x10 longs (very small upper bits → refX/Y near entry coords)
    const x = (Math.floor(r() * 200) << 19) >>> 0;
    const y = (Math.floor(r() * 200) << 19) >>> 0;
    pokeMem(cpu, OBJ + 0xC, 4, x >>> 0);
    pokeMem(cpu, OBJ + 0x10, 4, y >>> 0);
    stateInst.workRam[(OBJ - 0x400000) + 0xC] = (x >>> 24) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0xD] = (x >>> 16) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0xE] = (x >>> 8) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0xF] = x & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x10] = (y >>> 24) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x11] = (y >>> 16) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x12] = (y >>> 8) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x13] = y & 0xff;
    // obj+0x72 = LIST ptr
    pokeMem(cpu, OBJ + 0x72, 4, LIST);
    stateInst.workRam[(OBJ - 0x400000) + 0x72] = (LIST >>> 24) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x73] = (LIST >>> 16) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x74] = (LIST >>> 8) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x75] = LIST & 0xff;
    // obj+0x6E init
    pokeMem(cpu, OBJ + 0x6E, 4, 0xDEADBEEF);
    stateInst.workRam[(OBJ - 0x400000) + 0x6E] = 0xDE;
    stateInst.workRam[(OBJ - 0x400000) + 0x6F] = 0xAD;
    stateInst.workRam[(OBJ - 0x400000) + 0x70] = 0xBE;
    stateInst.workRam[(OBJ - 0x400000) + 0x71] = 0xEF;
    // Setup list of 3-8 entries (6 byte each), then -1 terminator
    const numEntries = 3 + Math.floor(r() * 6);
    let off = 0;
    for (let s = 0; s < numEntries; s++) {
      // Byte 0 and 1 should not be -1 (= 0xFF); use small range
      const b0 = Math.floor(r() * 200);
      const b1 = Math.floor(r() * 200);
      pokeMem(cpu, LIST + off, 1, b0);
      pokeMem(cpu, LIST + off + 1, 1, b1);
      stateInst.workRam[(LIST - 0x400000) + off] = b0;
      stateInst.workRam[(LIST - 0x400000) + off + 1] = b1;
      // Other 4 bytes random
      for (let bb = 2; bb < 6; bb++) {
        const v = Math.floor(r() * 256);
        pokeMem(cpu, LIST + off + bb, 1, v);
        stateInst.workRam[(LIST - 0x400000) + off + bb] = v;
      }
      off += 6;
    }
    // Terminator: byte 0 = 0xFF
    pokeMem(cpu, LIST + off, 1, 0xFF);
    stateInst.workRam[(LIST - 0x400000) + off] = 0xFF;
    // Init D6 to deterministic value — function leaves D6 alone if no entry update
    cpu.system.setRegister("d6", 0xFFFFFFFF);
    callFunction(cpu, FUN, [OBJ]);
    nearestNeighbor.findNearestNeighbor(stateInst, OBJ);
    let m = true;
    for (let j = 0x6E; j <= 0x71; j++) {
      if (peekMem(cpu, OBJ + j, 1) !== (stateInst.workRam[(OBJ - 0x400000) + j] ?? 0)) { m = false; break; }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
