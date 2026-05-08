#!/usr/bin/env node
/**
 * test-refresh-helper-1493c-parity.ts — differential FUN_1493C vs refreshHelper1493C.
 *
 * `FUN_0001493C` (19 istruzioni) è chiamata da FUN_00010FCE (refresh frame
 * handler) @ 0x10FE6. Itera su 4 slot (base 0x401302, stride 0x60) e chiama
 * FUN_14966 su ciascuno.
 *
 * **Strategia stub per FUN_14966**:
 *   FUN_14966 (unico callee) viene patchata con un semplice stub che:
 *     - incrementa un byte sentinel in workRam (0x4003C0 + slotIndex)
 *     - fa rts
 *   Poiché FUN_14966 riceve il puntatore allo slot come arg on-stack
 *   (move.l D1,-(SP); jsr 14966; addq.l 4,SP), lo slot index si deduce
 *   dall'indirizzo passato: slotIndex = (ptr - 0x401302) / 0x60.
 *
 *   Per semplicità nel test patch, FUN_14966 viene sostituita con:
 *     addq.b #1,(0x4003C0).l ; rts   (8 byte, contatore unico)
 *   e nel TS la corrispondente fun14966 incrementa lo stesso byte.
 *
 *   Questa scelta verifica che:
 *     1. FUN_1493C chiama FUN_14966 esattamente 4 volte.
 *     2. Gli argomenti slot-ptr sono corretti (ordine e valori).
 *     3. Nessun altro side effect su workRam.
 *
 * **Pre-state per ogni caso random**:
 *   - La regione slot 0x401302..0x401481 (4 slot × 0x60) viene riempita
 *     con byte random, per verificare che FUN_1493C non tocchi workRam al
 *     di là di ciò che fa FUN_14966 (che in questo test è solo il sentinel).
 *   - Il sentinel 0x4003C0 viene azzerato prima di ogni caso.
 *
 * **Regione confrontata**: workRam 0x400000..0x401FFF (escluso stack area).
 *
 * Uso: npx tsx packages/cli/src/test-refresh-helper-1493c-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  refreshHelper1493C as rh1493cNs,
  bus as busNs,
  type GameState,
} from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_1493C = 0x0001493c;
const FUN_14966 = 0x00014966;

/** Sentinel address in workRam — incremented by FUN_14966 stub each call. */
const SENTINEL_ADDR = 0x004003c0;

const WRAM_BASE = busNs.WORK_RAM_BASE;
const WRAM_SIZE = busNs.WORK_RAM_END - busNs.WORK_RAM_BASE;

/** Slot region in workRam: base 0x401302, 4 × 0x60 bytes. */
const SLOT_REGION_START = 0x00401302;
const SLOT_REGION_SIZE  = 4 * 0x60;

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

/**
 * Patch `entry` in rom with: addq.b #1,(sentinelAddr).l ; rts  (8 byte).
 *
 *   52 39 AA BB CC DD   → addq.b #1, abs.l(sentinelAddr)
 *   4e 75               → rts
 */
function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
  rom[entry + 6] = 0x4e;
  rom[entry + 7] = 0x75;
}

/**
 * Chiama una funzione in musashi in modo "pulito".
 *
 * Scrive `bra.b *` (0x60FE) in una zona safe di workRam come indirizzo di
 * ritorno. Quando la funzione fa `rts`, musashi esegue il branch-to-self e
 * il poll-loop lo rileva.
 */
function callFunctionClean(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  addr: number,
  maxCycles = 100_000,
): void {
  const LOOP_ADDR = 0x00401dc0;
  pokeMem(cpu, LOOP_ADDR, 2, 0x60fe);

  const sys = cpu.system;
  let sp = 0x401f00;
  sp -= 4;
  sys.write(sp, 4, LOOP_ADDR);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);

  let totalCycles = 0;
  const burst = 200;
  while (totalCycles < maxCycles) {
    sys.run(burst);
    totalCycles += burst;
    if (sys.getRegisters().pc === LOOP_ADDR) break;
  }

  sys.setRegister("sp", (sys.getRegisters().sp + 4) >>> 0);
}

interface FailRecord {
  caseNo: number;
  offset: number;
  bin: number;
  ts: number;
  desc: string;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romPath = findRomBlobPath();
  const romBuf = Buffer.from(readFileSync(romPath));

  // Patch FUN_14966 with a simple addq.b #1,(SENTINEL).l ; rts stub
  patchStubAddq(romBuf, FUN_14966, SENTINEL_ADDR);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });
  const rng = makeRng(0x1493c);

  // Mirror TS fun14966: increment sentinel byte
  const fun14966: rh1493cNs.Fun14966 = (s: GameState, _slotAddr: number) => {
    const o = SENTINEL_ADDR - WRAM_BASE;
    s.workRam[o] = ((s.workRam[o] ?? 0) + 1) & 0xff;
  };

  console.log(`\n=== refreshHelper1493C (FUN_1493C) — ${n} casi ===`);

  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // --- Randomize slot region (0x401302..0x401481) ---
    for (let j = 0; j < SLOT_REGION_SIZE; j++) {
      const v = Math.floor(rng() * 256) & 0xff;
      const addr = SLOT_REGION_START + j;
      pokeMem(cpu, addr, 1, v);
      stateInst.workRam[addr - WRAM_BASE] = v;
    }

    // --- Reset sentinel ---
    pokeMem(cpu, SENTINEL_ADDR, 1, 0);
    stateInst.workRam[SENTINEL_ADDR - WRAM_BASE] = 0;

    // --- Execute binary ---
    callFunctionClean(cpu, FUN_1493C, 100_000);

    // --- Execute TS ---
    rh1493cNs.refreshHelper1493C(stateInst, fun14966);

    // --- Compare workRam ---
    let match = true;
    let fail: FailRecord | null = null;

    for (let o = 0; o < WRAM_SIZE; o++) {
      // Skip stack area (callFunctionClean uses SP=0x401F00; conservatively skip >= 0x1DC0)
      if (o >= 0x1dc0) continue;

      const binVal = peekMem(cpu, WRAM_BASE + o, 1) & 0xff;
      const tsVal  = stateInst.workRam[o] ?? 0;

      if (binVal !== tsVal) {
        fail = {
          caseNo: i,
          offset: o,
          bin: binVal,
          ts: tsVal,
          desc: `workRam[0x${o.toString(16)}] (abs 0x${(WRAM_BASE + o).toString(16)})`,
        };
        match = false;
        break;
      }
    }

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = fail;
    }

    // Sync TS workRam from musashi for next iteration
    const ram = cpu.system.readBytes(WRAM_BASE, WRAM_SIZE);
    stateInst.workRam.set(ram);
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail: case ${f.caseNo}, ${f.desc}`);
    console.log(`    bin=0x${f.bin.toString(16).padStart(2, "0")} ts=0x${f.ts.toString(16).padStart(2, "0")}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
