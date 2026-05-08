#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, slotSearch, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_FIND = 0x00014bce;
const FUN_MATCH = 0x00014c0c;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  const r = rng(0xface);

  console.log(`\n=== findFreeSlotInTable (FUN_14BCE) — ${n} casi ===`);
  let ok1 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    for (const slot of [0x401302, 0x401362, 0x4013C2, 0x401422]) {
      const v = (r() < 0.5) ? 0 : Math.floor(r() * 256);
      pokeMem(cpu, slot + 0x18, 1, v);
      stateInst.workRam[(slot - 0x400000) + 0x18] = v;
    }
    const binR = callFunction(cpu, FUN_FIND, []);
    const tsR = slotSearch.findFreeSlotInTable(stateInst, tsRom);
    if ((binR.d0 >>> 0) === (tsR >>> 0)) ok1++;
  }
  console.log(`  Match: ${ok1}/${n} = ${((ok1/n)*100).toFixed(1)}%`);

  console.log(`\n=== slotMatchesPtr (FUN_14C0C) — ${n} casi ===`);
  let ok2 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const ARG = 0x00401D00;
    const target = Math.floor(r() * 0x10000);
    pokeMem(cpu, ARG + 2, 4, target);
    stateInst.workRam[(ARG - 0x400000) + 2] = (target >>> 24) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 3] = (target >>> 16) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 4] = (target >>> 8) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 5] = target & 0xff;
    // Setup 4 slots
    for (let s = 0; s < 4; s++) {
      const slot = 0x401302 + s * 0x60;
      const v = (r() < 0.3) ? 0 : Math.floor(r() * 256);
      pokeMem(cpu, slot + 0x18, 1, v);
      stateInst.workRam[(slot - 0x400000) + 0x18] = v;
      // Set slot+0x4E: 30% chance == target, else random
      const fld = (r() < 0.3) ? target : Math.floor(r() * 0x10000);
      pokeMem(cpu, slot + 0x4E, 4, fld);
      stateInst.workRam[(slot - 0x400000) + 0x4E] = (fld >>> 24) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x4F] = (fld >>> 16) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x50] = (fld >>> 8) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x51] = fld & 0xff;
    }
    const binR = callFunction(cpu, FUN_MATCH, [ARG]);
    const tsR = slotSearch.slotMatchesPtr(stateInst, ARG);
    if ((binR.d0 & 0xff) === tsR) ok2++;
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2/n)*100).toFixed(1)}%`);

  // Variants
  console.log(`\n=== slotMatchesPtr_4009A4 (FUN_159D8) — ${n} casi ===`);
  let ok3 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const ARG = 0x00401D00;
    const target = Math.floor(r() * 0x10000);
    pokeMem(cpu, ARG + 2, 4, target);
    stateInst.workRam[(ARG - 0x400000) + 2] = (target >>> 24) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 3] = (target >>> 16) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 4] = (target >>> 8) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 5] = target & 0xff;
    for (let s = 0; s < 2; s++) {
      const slot = 0x4009A4 + s * 0x7C;
      const v = (r() < 0.3) ? 0 : Math.floor(r() * 256);
      pokeMem(cpu, slot + 0x18, 1, v);
      stateInst.workRam[(slot - 0x400000) + 0x18] = v;
      const fld = (r() < 0.3) ? target : Math.floor(r() * 0x10000);
      pokeMem(cpu, slot + 0x72, 4, fld);
      stateInst.workRam[(slot - 0x400000) + 0x72] = (fld >>> 24) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x73] = (fld >>> 16) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x74] = (fld >>> 8) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x75] = fld & 0xff;
    }
    const binR = callFunction(cpu, 0x159d8, [ARG]);
    const tsR = slotSearch.slotMatchesPtr_4009A4(stateInst, ARG);
    if ((binR.d0 & 0xff) === tsR) ok3++;
  }
  console.log(`  Match: ${ok3}/${n} = ${((ok3/n)*100).toFixed(1)}%`);

  console.log(`\n=== findFreeSlotInTable_1EFFE (FUN_1599A) — ${n} casi ===`);
  let ok4 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Read rom table to know which workRam pointers
    const ptr0 = (rom[0x1effe]! << 24) | (rom[0x1efff]! << 16) | (rom[0x1f000]! << 8) | rom[0x1f001]!;
    const ptr1 = (rom[0x1f002]! << 24) | (rom[0x1f003]! << 16) | (rom[0x1f004]! << 8) | rom[0x1f005]!;
    for (const p of [ptr0, ptr1]) {
      const v = (r() < 0.5) ? 0 : Math.floor(r() * 256);
      pokeMem(cpu, p + 0x18, 1, v);
      stateInst.workRam[(p - 0x400000) + 0x18] = v;
    }
    const binR = callFunction(cpu, 0x1599a, []);
    const tsR = slotSearch.findFreeSlotInTable_1EFFE(stateInst, tsRom);
    if ((binR.d0 >>> 0) === (tsR >>> 0)) ok4++;
  }
  console.log(`  Match: ${ok4}/${n} = ${((ok4/n)*100).toFixed(1)}%`);

  console.log(`\n=== slotMatchesPtr_401482 (FUN_1730C) — ${n} casi ===`);
  let ok5 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const ARG = 0x00401D00;
    const target = Math.floor(r() * 0x10000);
    pokeMem(cpu, ARG + 2, 4, target);
    stateInst.workRam[(ARG - 0x400000) + 2] = (target >>> 24) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 3] = (target >>> 16) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 4] = (target >>> 8) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 5] = target & 0xff;
    for (let s = 0; s < 7; s++) {
      const slot = 0x401482 + s * 0x42;
      const v = (r() < 0.4) ? 0 : Math.floor(r() * 256);
      pokeMem(cpu, slot + 0x18, 1, v);
      stateInst.workRam[(slot - 0x400000) + 0x18] = v;
      const fld = (r() < 0.3) ? target : Math.floor(r() * 0x10000);
      pokeMem(cpu, slot + 0x30, 4, fld);
      stateInst.workRam[(slot - 0x400000) + 0x30] = (fld >>> 24) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x31] = (fld >>> 16) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x32] = (fld >>> 8) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x33] = fld & 0xff;
    }
    const binR = callFunction(cpu, 0x1730c, [ARG]);
    const tsR = slotSearch.slotMatchesPtr_401482(stateInst, ARG);
    if ((binR.d0 & 0xff) === tsR) ok5++;
  }
  console.log(`  Match: ${ok5}/${n} = ${((ok5/n)*100).toFixed(1)}%`);

  console.log(`\n=== slotMatchesPtr_400A9C (FUN_12DAE) — ${n} casi ===`);
  let okM = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const ARG = 0x00401D00;
    // Half the cases: target = 0 (to test the alt match path)
    const target = (r() < 0.5) ? 0 : Math.floor(r() * 0x10000);
    pokeMem(cpu, ARG + 2, 4, target);
    stateInst.workRam[(ARG - 0x400000) + 2] = (target >>> 24) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 3] = (target >>> 16) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 4] = (target >>> 8) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 5] = target & 0xff;
    for (let s = 0; s < 0x19; s++) {
      const slot = 0x400A9C + s * 0x56;
      const v = (r() < 0.5) ? 1 : (r() < 0.5 ? 0 : Math.floor(r() * 256));
      pokeMem(cpu, slot + 0x18, 1, v);
      stateInst.workRam[(slot - 0x400000) + 0x18] = v;
      const fld = (r() < 0.3) ? target : Math.floor(r() * 0x10000);
      pokeMem(cpu, slot + 0x3A, 4, fld);
      stateInst.workRam[(slot - 0x400000) + 0x3A] = (fld >>> 24) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x3B] = (fld >>> 16) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x3C] = (fld >>> 8) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x3D] = fld & 0xff;
      const v1f = (r() < 0.3) ? 0xC : Math.floor(r() * 256);
      pokeMem(cpu, slot + 0x1F, 1, v1f);
      stateInst.workRam[(slot - 0x400000) + 0x1F] = v1f;
    }
    const binR = callFunction(cpu, 0x12dae, [ARG]);
    const tsR = slotSearch.slotMatchesPtr_400A9C(stateInst, ARG);
    if ((binR.d0 & 0xff) === tsR) okM++;
  }
  console.log(`  Match: ${okM}/${n} = ${((okM/n)*100).toFixed(1)}%`);

  console.log(`\n=== findFirstFreeSlot_1F016 (FUN_12D6E) — ${n} casi ===`);
  let ok6 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Read 25 ROM ptrs and set their byte+0x18 random
    for (let s = 0; s < 0x19; s++) {
      const addr = 0x1f016 + s * 4;
      const p = (rom[addr]! << 24) | (rom[addr+1]! << 16) | (rom[addr+2]! << 8) | rom[addr+3]!;
      const v = (r() < 0.7) ? Math.floor(r() * 255) + 1 : 0;
      pokeMem(cpu, p + 0x18, 1, v);
      stateInst.workRam[(p - 0x400000) + 0x18] = v;
    }
    const binR = callFunction(cpu, 0x12d6e, []);
    const tsR = slotSearch.findFirstFreeSlot_1F016(stateInst, tsRom);
    if ((binR.d0 >>> 0) === (tsR >>> 0)) ok6++;
  }
  console.log(`  Match: ${ok6}/${n} = ${((ok6/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit((ok1 === n && ok2 === n && ok3 === n && ok4 === n && ok5 === n && ok6 === n && okM === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
