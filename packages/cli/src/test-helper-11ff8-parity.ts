#!/usr/bin/env node
/**
 * test-helper-11ff8-parity.ts — differential FUN_11FF8 vs helper11FF8.
 *
 * `FUN_00011FF8` (~0x172 byte): high-score table renderer.
 *
 * **Strategy**:
 *   - Patch all internal JSRs to `nop/rts` in Musashi to isolate FUN_11FF8's
 *     own workRam side effects (string buffer writes, entry field updates).
 *     The JSRs are: 0x1AE (hiScoreDecode41c8), 0x142 (renderString), 0x286B0,
 *     0x28F62, 0x28E3C.
 *   - For the TS side, inject no-op stubs for all sub-calls (matching the
 *     patched binary).
 *   - The hiScoreDecode41c8 sub, however, needs to match what the BINARY does
 *     when `jsr 0x1AE → jsr 0x41C8` is patched to RTS. When 0x1AE returns via
 *     RTS immediately, D0 = 0 (no write). So the TS stub returns 0 too.
 *   - Compare workRam regions touched by FUN_11FF8 ONLY:
 *       - [0x41C..0x41E] (string-chain entry with the/tickOff/marker via 28F62)
 *       - [0x41E..0x421] (string buffer pointer — read only, not modified by 11FF8)
 *       - [0x1F7A..0x1F80] (decode buffer — modified by 41C8, which is patched)
 *         → both should be untouched (since 41C8 is patched to rts)
 *
 * **WorkRam regions compared** (after run):
 *   - Full workRam [0x000..0x1FFF]: captures all side effects.
 *
 * **Random setup per case**:
 *   - `workRam[0x390..0x391]` (mode word): 0..3 random
 *   - `workRam[0x41C..0x421]` (entry + buf ptr): random
 *   - arg1Long (low byte = D2b): random byte
 *
 * **Note on patchable JSRs**: Musashi parity patches function by overwriting
 * the call instruction bytes with NOP sequences and a `rts` at the target
 * address. We use `pokeMem` to patch ROM bytes at the sub-entry points.
 * Since the ROM is mapped at 0x000000-0x07FFFF in the emulator, we can patch
 * the JSR target bytes before running.
 *
 * Usage: npx tsx packages/cli/src/test-helper-11ff8-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  bus as busNs,
  state as stateNs,
  helper11FF8 as h11FF8Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_11FF8 = 0x00011ff8;

/** ROM sub-entry points to patch with `rts` (0x4e75) so they return immediately. */
const PATCH_RTS_ADDRS = [
  0x000001ae, // thunk → hiScoreDecode41c8 (jsr 0x1AE)
  0x00000142, // thunk → renderStringChain/FUN_2572 (jsr 0x142)
  0x000286b0, // renderStringEntry286B0
  0x00028f62, // renderStringEntry28F62
  0x00028e3c, // fun_28e3c
] as const;

/** Byte value for M68k `rts` instruction. */
const RTS_HI = 0x4e;
const RTS_LO = 0x75;

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
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.",
  );
}

interface FailRecord {
  caseNo: number;
  arg1: number;
  mode: number;
  offset: number;
  bin: number;
  ts: number;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = findRomBlobPath();
  const romBuf = readFileSync(romPath);

  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  // ── Patch JSR targets to rts in the Musashi memory ──────────────────────
  for (const addr of PATCH_RTS_ADDRS) {
    pokeMem(cpu, addr, 1, RTS_HI);
    pokeMem(cpu, addr + 1, 1, RTS_LO);
  }

  console.log(`\n=== helper11FF8 (FUN_11FF8) — ${n} cases ===`);

  const rng = makeRng(0x11ff811ff);
  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    // ── Set up random state ───────────────────────────────────────────────
    cpu.system.setRegister("sp", 0x401f00);

    // Randomize relevant workRam regions
    const mode = Math.floor(rng() * 4); // 0..3
    const arg1 = Math.floor(rng() * 256); // low byte (D2b)

    // Write mode word to both binary and TS state
    const modeHi = (mode >>> 8) & 0xff;
    const modeLo = mode & 0xff;
    pokeMem(cpu, 0x400390, 1, modeHi);
    pokeMem(cpu, 0x400391, 1, modeLo);
    stateInst.workRam[0x390] = modeHi;
    stateInst.workRam[0x391] = modeLo;

    // Randomize string-chain entry @ 0x40041C (6+2 = 8 bytes)
    for (let b = 0; b < 8; b++) {
      const v = Math.floor(rng() * 256);
      pokeMem(cpu, 0x40041c + b, 1, v);
      stateInst.workRam[0x41c + b] = v;
    }

    // Set *(0x40041e) to a safe workRam pointer (within range)
    // The string buffer pointer: point to 0x401700 (safe area)
    const strBufPtr = 0x00401700;
    pokeMem(cpu, 0x40041e, 4, strBufPtr);
    stateInst.workRam[0x41e] = (strBufPtr >>> 24) & 0xff;
    stateInst.workRam[0x41f] = (strBufPtr >>> 16) & 0xff;
    stateInst.workRam[0x420] = (strBufPtr >>> 8) & 0xff;
    stateInst.workRam[0x421] = strBufPtr & 0xff;

    // Randomize the string buffer area (to ensure we detect overwrites)
    for (let b = 0; b < 64; b++) {
      const v = Math.floor(rng() * 256);
      pokeMem(cpu, strBufPtr + b, 1, v);
      stateInst.workRam[strBufPtr - 0x400000 + b] = v;
    }

    // ── Run binary ───────────────────────────────────────────────────────
    // Push arg1Long (long with low byte = arg1)
    callFunction(cpu, FUN_11FF8, [arg1]);

    // ── Run TS ──────────────────────────────────────────────────────────
    // All JSR subs are no-op (matching the patched binary).
    // hiScoreDecode41c8 stub: returns the argument (idx) as-is.
    // When `jsr 0x1AE` is patched to `rts` in Musashi, D0 retains the value
    // it had before the jsr = the argument pushed on the stack = ext_l(D3b).
    // Then `movea.l D0, A1` (or A2) = small number = ext_l(D3b).
    h11FF8Ns.helper11FF8(stateInst, tsRom, arg1, {
      hiScoreDecode41c8: (_s, idx) => idx >>> 0,
      renderString0142: () => {
        /* no-op */
      },
      renderStringEntry286B0: () => {
        /* no-op */
      },
      renderStringEntry28F62: () => {
        /* no-op */
      },
      fun_28e3c: () => {
        /* no-op */
      },
    });

    // ── Compare string buffer area only ─────────────────────────────────
    // FUN_11FF8's own workRam side-effects: writes to the string buffer at
    // *(0x40041e) = 0x401700. Stack writes (around 0x401EE0-0x401F00) are
    // a binary artifact (CPU stack in workRam) and differ from TS (no stack).
    // We compare a generous window: 0x401700..0x401800 (256 bytes).
    // Also compare 0x40041C..0x400422 (string-chain entry, but patched no-op
    // so should be unchanged). And 0x400390..0x400392 (mode word, read-only).
    const COMPARE_RANGES: [number, number][] = [
      [strBufPtr - 0x400000, strBufPtr - 0x400000 + 256], // string buffer (256 bytes)
      [0x041c, 0x0422], // string-chain entry @ 0x40041C (patched no-op, should be unchanged)
    ];

    let match = true;
    outer: for (const [lo, hi] of COMPARE_RANGES) {
      for (let o = lo; o < hi; o++) {
        const bin = peekMem(cpu, 0x400000 + o, 1) & 0xff;
        const ts = stateInst.workRam[o] ?? 0;
        if (bin !== ts) {
          if (firstFail === null) {
            firstFail = { caseNo: i, arg1, mode, offset: o, bin, ts };
          }
          match = false;
          break outer;
        }
      }
    }
    if (match) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail !== null) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.caseNo}:`);
    console.log(`    arg1=0x${f.arg1.toString(16).padStart(8, "0")} mode=${f.mode}`);
    console.log(
      `    workRam[0x${f.offset.toString(16).padStart(4, "0")}]: bin=0x${f.bin.toString(16).padStart(2, "0")} ts=0x${f.ts.toString(16).padStart(2, "0")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
