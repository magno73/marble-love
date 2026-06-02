#!/usr/bin/env node
/**
 * test-object-step-17f66-parity.ts —
 * differential FUN_17F66 vs `objectStep17F66`.
 *
 * **Strategy**: `FUN_00017F66` (344 bytes) is an "object step" subroutine that
 * decides between 4 paths (skip / special-dispatch / movement / stuck) and calls
 * fino a 1 sub interna per path:
 *   - special: `FUN_1815A(A2)`
 *   - movement (ramo `*0x400396 == 1`): `FUN_180BE()`
 *   - movement / stuck (epilogue): `FUN_26196(A2)`
 *
 * Per testare in isolamento la *sola* logica di dispatch / aritmetica
 * (whitelist, scaling, addi.l, clamp, ...), **patch the 3 callees with a
 * pure `rts` stub** in ROM. Thus the binary only performs the side effect of
 * dispatcher (writes at 0x4006A8/AA, 0xC6/C7, and add.l at +0/+4/+8), so
 * post-call workRam depends only on our logic.
 *
 * **Stubs** iniettati (2 byte ciascuno = `4E 75` rts):
 *   - `0x0001815A`: `rts`
 *   - `0x000180BE`: `rts`
 *   - `0x00026196`: `rts`
 *
 * For each case:
 *   1. Pre-fill workRam with a deterministic pattern.
 *   2. Pick A2 (random workRam offset, 4-byte aligned, with struct bytes
 *      determinati dal pattern).
 *   3. **Side binary**: copy pre-fill into CPU memory, push A2 on the stack,
 *      call FUN_17F66, snapshot workRam.
 *   4. **TS side**: copies the pre-fill into `state.workRam`, calls
 *      `objectStep17F66(state, A2_addr, no-op-callees)`.
 *   5. Compara workRam byte-per-byte (escludendo zona stack scratch).
 *
 * Patterns coperti:
 *   - skip path (state18 ∈ {2, 3})
 *   - special-dispatch (global390 word == 1)
 *   - movement: cmd in whitelist + global396 word != 1 (store branch)
 *   - movement: cmd in whitelist + global396 word == 1 (180BE branch)
 *   - movement: scaling mode 1 / 5 / clamp
 *   - stuck: state36 == 2 (bypass whitelist)
 *   - stuck: state36 != 2 e cmd fuori whitelist
 *   - stuck: state36 == 0 (no addi)
 *   - stuck: cmd bit7 set (clamp -0x50000)
 *
 * Uso: npx tsx packages/cli/src/test-object-step-17f66-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  objectStep17F66 as ostNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_OBJECT_STEP = 0x00017f66;
const FUN_1815A = 0x0001815a;
const FUN_180BE = 0x000180be;
const FUN_26196 = 0x00026196;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
/** "Stack scratch" area excluded from compare: callFunction leaves tombstone
 *  residue (pushed args/sentinel) that is not part of the
 *  sub. Coverage abbondante: SP=0x401F00 scende al massimo a ~0x401EE0. */
const STACK_SCRATCH_START = 0x1e80;

/** RTS: opcode 68k 0x4E75 (2 byte big-endian). */
const RTS_BYTES = [0x4e, 0x75] as const;

/** Whitelist byte come nel modulo. */
const WHITELIST = [0x00, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x38, 0x39, 0x3a, 0x3b];

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

type CpuSync = Awaited<ReturnType<typeof createCpu>>;

/** Cattura workRam dal CPU in un Uint8Array. */
function captureWorkRam(cpu: CpuSync): Uint8Array {
  const out = new Uint8Array(WORK_RAM_SIZE);
  for (let i = 0; i < WORK_RAM_SIZE; i++) {
    out[i] = peekMem(cpu, WORK_RAM_BASE + i, 1) & 0xff;
  }
  return out;
}

/** Carica un buffer in workRam dal CPU. */
function loadWorkRam(cpu: CpuSync, src: Uint8Array): void {
  for (let i = 0; i < WORK_RAM_SIZE; i++) {
    pokeMem(cpu, WORK_RAM_BASE + i, 1, src[i] ?? 0);
  }
}

/** Patch the 3 internal subs with `rts`. */
function patchStubs(cpu: CpuSync): void {
  for (const addr of [FUN_1815A, FUN_180BE, FUN_26196]) {
    pokeMem(cpu, addr, 1, RTS_BYTES[0]);
    pokeMem(cpu, addr + 1, 1, RTS_BYTES[1]);
  }
}

interface CaseSetup {
  pattern: string;
  a2Addr: number;
  pre: Uint8Array;
}

/** Genera 1 case deterministico secondo `i` e rng. */
function genCase(i: number, rng: () => number): CaseSetup {
  const pre = new Uint8Array(WORK_RAM_SIZE);

  // Base fill: pattern deterministico per i piccoli, random successivamente.
  if (i === 0) pre.fill(0x00);
  else if (i === 1) pre.fill(0xff);
  else if (i === 2) pre.fill(0x55);
  else if (i === 3) pre.fill(0xaa);
  else {
    for (let j = 0; j < WORK_RAM_SIZE; j++) {
      pre[j] = Math.floor(rng() * 256) & 0xff;
    }
  }

  // A2 must point to a workRam region with at least 0xC8 bytes of slack.
  // (struct uses up to +0xC7) and does not overlap globals.
  // (0x390..0x6AB) ne' allo stack (>= 0x1E80).
  // Pick: offset multiplo di 4 in [0x800 .. 0x1C00 - 0xC8) ≈ [0x800, 0x1B38].
  const a2Slot = 0x800 + (Math.floor(rng() * ((0x1b38 - 0x800) / 4)) * 4);
  const a2Off = a2Slot >>> 0;
  const a2Addr = (WORK_RAM_BASE + a2Off) >>> 0;

  // Sovrascrivi i byte struct chiave secondo il pattern.
  // Pattern bucket selection (10% ognuno).
  const pick = rng();
  let pattern: string;

  // Default: byte struct random
  let state18 = Math.floor(rng() * 256);
  let state36 = Math.floor(rng() * 256);
  let mode = Math.floor(rng() * 256);
  let cmd = Math.floor(rng() * 256);
  let depth = Math.floor(rng() * 256);
  const cmdX = Math.floor(rng() * 256);
  const cmdY = Math.floor(rng() * 256);
  let g390W = Math.floor(rng() * 0x10000);
  let g396W = Math.floor(rng() * 0x10000);

  if (pick < 0.1) {
    pattern = "skip_18_2";
    state18 = 2;
  } else if (pick < 0.2) {
    pattern = "skip_18_3";
    state18 = 3;
  } else if (pick < 0.3) {
    pattern = "special";
    state18 = 0;
    g390W = 1;
  } else if (pick < 0.4) {
    pattern = "movement_180be";
    state18 = 0;
    g390W = (g390W & 0xffff) === 1 ? 2 : g390W;
    g396W = 1;
    cmd = WHITELIST[Math.floor(rng() * WHITELIST.length)] ?? 0;
    state36 = state36 === 2 ? 0 : state36;
  } else if (pick < 0.55) {
    pattern = "movement_store";
    state18 = 0;
    g390W = (g390W & 0xffff) === 1 ? 2 : g390W;
    g396W = (g396W & 0xffff) === 1 ? 2 : g396W;
    cmd = WHITELIST[Math.floor(rng() * WHITELIST.length)] ?? 0;
    state36 = state36 === 2 ? 0 : state36;
    mode = [0, 1, 2, 3, 4, 5, 6][Math.floor(rng() * 7)] ?? 0;
  } else if (pick < 0.7) {
    pattern = "movement_scaling";
    state18 = 0;
    g390W = (g390W & 0xffff) === 1 ? 2 : g390W;
    g396W = (g396W & 0xffff) === 1 ? 2 : g396W;
    cmd = WHITELIST[Math.floor(rng() * WHITELIST.length)] ?? 0;
    state36 = state36 === 2 ? 0 : state36;
    mode = rng() < 0.5 ? 1 : 5;
    depth = Math.floor(rng() * 256);
  } else if (pick < 0.8) {
    pattern = "stuck_36_2";
    state18 = 0;
    g390W = (g390W & 0xffff) === 1 ? 2 : g390W;
    state36 = 2;
  } else if (pick < 0.9) {
    pattern = "stuck_unwhitelisted";
    state18 = 0;
    g390W = (g390W & 0xffff) === 1 ? 2 : g390W;
    state36 = state36 === 2 || state36 === 0 ? 1 : state36;
    // Pick cmd NON in whitelist.
    do {
      cmd = Math.floor(rng() * 256);
    } while (WHITELIST.includes(cmd));
  } else if (pick < 0.95) {
    pattern = "stuck_no_addi";
    state18 = 0;
    g390W = (g390W & 0xffff) === 1 ? 2 : g390W;
    state36 = 0; // gate stuck mods
    do {
      cmd = Math.floor(rng() * 256);
    } while (WHITELIST.includes(cmd));
  } else {
    pattern = "stuck_clamp_bit7";
    state18 = 0;
    g390W = (g390W & 0xffff) === 1 ? 2 : g390W;
    state36 = state36 === 2 || state36 === 0 ? 1 : state36;
    cmd = 0x80 | Math.floor(rng() * 0x80); // bit7 set, almost always not in whitelist
    while (WHITELIST.includes(cmd)) {
      cmd = 0x80 | Math.floor(rng() * 0x80);
    }
  }

  // Scrivi i byte struct.
  pre[a2Off + 0x18] = state18 & 0xff;
  pre[a2Off + 0x1a] = mode & 0xff;
  pre[a2Off + 0x36] = state36 & 0xff;
  pre[a2Off + 0x56] = depth & 0xff;
  pre[a2Off + 0x58] = cmd & 0xff;
  pre[a2Off + 0xc6] = cmdX & 0xff;
  pre[a2Off + 0xc7] = cmdY & 0xff;

  // Long pos.x / pos.y / stuck-z: random, but on safe 4-byte-multiple offsets.
  for (const fOff of [0x00, 0x04, 0x08]) {
    const v = Math.floor(rng() * 0x100000000) >>> 0;
    pre[a2Off + fOff] = (v >>> 24) & 0xff;
    pre[a2Off + fOff + 1] = (v >>> 16) & 0xff;
    pre[a2Off + fOff + 2] = (v >>> 8) & 0xff;
    pre[a2Off + fOff + 3] = v & 0xff;
  }

  // Globals @ 0x390 / 0x396 (16-bit BE).
  pre[0x0390] = (g390W >>> 8) & 0xff;
  pre[0x0391] = g390W & 0xff;
  pre[0x0396] = (g396W >>> 8) & 0xff;
  pre[0x0397] = g396W & 0xff;

  // Bytes @ 0x6A8 / 0x6AA (initial, may be overwritten by movement_store).
  pre[0x06a8] = Math.floor(rng() * 256);
  pre[0x06aa] = Math.floor(rng() * 256);

  return { pattern, a2Addr, pre };
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

  // Patch iniziale.
  patchStubs(cpu);

  console.log(`\n=== objectStep17F66 (FUN_17F66) — ${n} casi ===`);
  console.log(
    `  (FUN_1815A / FUN_180BE / FUN_26196 patchate con stub 'rts')`,
  );

  const rng = makeRng(0x17f66ace);
  let ok = 0;
  let firstFail: {
    i: number;
    pattern: string;
    a2Addr: number;
    offset: number;
    bin: number;
    ts: number;
  } | null = null;
  const patternCounts: Record<string, number> = {};

  for (let i = 0; i < n; i++) {
    if (i % 100 === 0) patchStubs(cpu);

    const c = genCase(i, rng);
    patternCounts[c.pattern] = (patternCounts[c.pattern] ?? 0) + 1;

    // ── Side binary ─────────────────────────────────────────────────────
    cpu.system.setRegister("sp", 0x401f00);
    loadWorkRam(cpu, c.pre);
    callFunction(cpu, FUN_OBJECT_STEP, [c.a2Addr]);
    const postBin = captureWorkRam(cpu);

    // ── Side TS ─────────────────────────────────────────────────────────
    // Reset TS workRam from the same pre-state.
    state.workRam.set(c.pre);
    ostNs.objectStep17F66(state, c.a2Addr, {
      fun1815A: () => {},
      fun180BE: () => {},
      fun26196: () => {},
    });
    const postTs = state.workRam;

    // ── Compare ─────────────────────────────────────────────────────────
    let match = true;
    for (let j = 0; j < STACK_SCRATCH_START; j++) {
      if (postBin[j] !== postTs[j]) {
        match = false;
        if (firstFail === null) {
          firstFail = {
            i,
            pattern: c.pattern,
            a2Addr: c.a2Addr,
            offset: j,
            bin: postBin[j] ?? 0,
            ts: postTs[j] ?? 0,
          };
        }
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  console.log(`  Pattern coverage:`);
  for (const [p, c] of Object.entries(patternCounts).sort()) {
    console.log(`    ${p.padEnd(24)} ${c}`);
  }
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} (pattern=${f.pattern}):`);
    console.log(
      `    a2=0x${f.a2Addr.toString(16)} diff @ WR off 0x${f.offset.toString(16)} (addr 0x${(WORK_RAM_BASE + f.offset).toString(16)}): bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
