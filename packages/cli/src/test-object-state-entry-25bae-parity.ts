#!/usr/bin/env node
/**
 * test-object-state-entry-25bae-parity.ts — differential FUN_00025BAE vs
 * objectStateEntry25BAE.
 *
 * objPtr + subStateCode (byte) as 2 longs on the stack, performs writes
 * common fields (clear longs @ +0x0/+0x4 + conditional +0x18 when +0x1A==6), then
 * dispatches across three cases (2/9/4). The two external sub-JSRs are:
 *
 *   - FUN_158AC  -> patched with append-byte-to-buffer (capture sound calls)
 *   - FUN_2591A  -> patched with `rts` (isolated no-op)
 *
 * Parity strategy:
 *   1. Patch ROM:
 *      - FUN_158AC: append the low byte of the pushed long to a growing work
 *        RAM buffer (cursor @ 0x401FFC, buffer @ 0x401FF0..0x401FF3).
 *        The test isolates FUN_25BAE.
 *        - objPtr ∈ {0x401000, 0x401100, ..., 0x401C00}
 *        - subStateCode in {2, 9, 4, plus random default-path codes}
 *        - A2[+0x1A] pre = {0x00, 0x06, random}
 *        - A2[+0x57] pre = {0x65, random}, for case 4 branching
 *        - A2[+0xD2] pre = random word, for case 4 counter increment
 *   4. Run TS objectStateEntry25BAE on the workRam mirror (capture sound
 *        - neighboring sentinels
 *
 * Usage: npx tsx packages/cli/src/test-object-state-entry-25bae-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  objectStateEntry25BAE as ose25Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_25BAE = 0x00025bae;
const FUN_158AC = 0x000158ac;
const FUN_2591A = 0x0002591a;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

// Sound-call capture buffer (from test-sound-pair-15884-parity.ts).
const SOUND_BUF_BASE = 0x00401ff0; // 4 byte (max 4 sound calls per case)
const SOUND_CUR_PTR = 0x00401ffc; // long ptr to next slot
const SOUND_BUF_END = 0x00401ff4;

// with the sound capture buffer (0x401FF0+).
const PTR_CANDIDATES = [
  0x00401000, 0x00401100, 0x00401200, 0x00401300,
  0x00401400, 0x00401500, 0x00401600, 0x00401700,
  0x00401800, 0x00401900, 0x00401a00, 0x00401b00,
  0x00401c00,
] as const;

/**
 * Patch ROM @ FUN_158AC: append byte arg to (*0x401FFC)++ buffer.
 *   move.b   (0x7,SP), D0           : 10 2F 00 07
 *   movea.l  ($00401FFC).l, A1      : 22 79 00 40 1F FC
 *   move.b   D0, (A1)+              : 12 C0
 *   move.l   A1, ($00401FFC).l      : 23 C9 00 40 1F FC
 *   rts                             : 4E 75
 */
function patchSoundSink(rom: Buffer): void {
  rom[FUN_158AC + 0x0] = 0x10; rom[FUN_158AC + 0x1] = 0x2f;
  rom[FUN_158AC + 0x2] = 0x00; rom[FUN_158AC + 0x3] = 0x07;
  rom[FUN_158AC + 0x4] = 0x22; rom[FUN_158AC + 0x5] = 0x79;
  rom[FUN_158AC + 0x6] = 0x00; rom[FUN_158AC + 0x7] = 0x40;
  rom[FUN_158AC + 0x8] = 0x1f; rom[FUN_158AC + 0x9] = 0xfc;
  rom[FUN_158AC + 0xa] = 0x12; rom[FUN_158AC + 0xb] = 0xc0;
  rom[FUN_158AC + 0xc] = 0x23; rom[FUN_158AC + 0xd] = 0xc9;
  rom[FUN_158AC + 0xe] = 0x00; rom[FUN_158AC + 0xf] = 0x40;
  rom[FUN_158AC + 0x10] = 0x1f; rom[FUN_158AC + 0x11] = 0xfc;
  rom[FUN_158AC + 0x12] = 0x4e; rom[FUN_158AC + 0x13] = 0x75;
}

/** Patch FUN_2591A a `rts` (4E 75) — neutralizza the init helper. */
function patch2591ARts(rom: Buffer): void {
  rom[FUN_2591A + 0] = 0x4e;
  rom[FUN_2591A + 1] = 0x75;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  i: number;
  ptr: number;
  code: number;
  field: string;
  bin: number | string;
  ts: number | string;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Pre-patch ROM with stubs.
  patchSoundSink(romBuf);
  patch2591ARts(romBuf);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== objectStateEntry25BAE (FUN_00025BAE) — ${n} cases ===`);
  console.log(
    `  (FUN_158AC patched → append-byte-to-buffer; FUN_2591A patched → rts)`,
  );

  const rng = makeRng(0x25bae);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;
  const pickPtr = (): number =>
    PTR_CANDIDATES[Math.floor(rng() * PTR_CANDIDATES.length)]!;
  // Distribuzione subStateCode: 25% case 2, 25% case 9, 25% case 4, 25% default
  const pickCode = (): number => {
    const r = rng();
    if (r < 0.25) return 0x02;
    if (r < 0.5) return 0x09;
    if (r < 0.75) return 0x04;
    return rb(); // qualsiasi byte (potrebbe random-coincidere con 2/9/4 — ok)
  };

  let ok = 0;
  let firstFail: FailRecord | null = null;

  // Field offsets potentially touched by writes, used to scrub the mirror.
  // Scelti da disasm: 0x00..07, 0x18, 0x1A, 0x56, 0x5A..5D, 0x5F, 0x60, 0xD2..D3.
  const SCRATCH_FIELDS = [
    0x00, 0x01, 0x02, 0x03,
    0x04, 0x05, 0x06, 0x07,
    0x18, 0x1a,
    0x56, 0x57,
    0x5a, 0x5b, 0x5c, 0x5d, 0x5f, 0x60,
    0xd2, 0xd3,
  ] as const;
  // Neighbors: untouched offsets (for no-spill check).
  const NEIGHBORS = [
    0x08, 0x09, 0x17, 0x19, 0x1b, 0x1c, 0x55, 0x58, 0x59, 0x5e, 0x61, 0xd1,
    0xd4,
  ] as const;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const ptr = pickPtr();
    const off = ptr - WORK_RAM_BASE;
    const code = pickCode();
    // ──── Pre-state randomization ──────────────────────────────────────
    // Coverage: 33% A2[+0x1A]=6 (triggers +0x18=3), 33% A2[+0x1A]=0,
    // 33% random.
    const r1a = rng();
    let pre1A = 0;
    if (r1a < 0.33) pre1A = 0x06;
    else if (r1a < 0.66) pre1A = 0x00;
    else pre1A = rb();
    // A2[+0x57]: 50% = 0x65 (case 4 match), 50% random
    const pre57 = rng() < 0.5 ? 0x65 : rb();
    // A2[+0xD2..D3] random word
    const preD2hi = rb();
    const preD2lo = rb();
    // A2[+0x18] random sentinel (for the check conditional)
    const pre18 = rb();

    const scratchObj = new Uint8Array(0xe0);
    for (let k = 0; k < 0xe0; k++) scratchObj[k] = rb();
    // Override pre-state controllati
    scratchObj[0x18] = pre18;
    scratchObj[0x1a] = pre1A;
    scratchObj[0x57] = pre57;
    scratchObj[0xd2] = preD2hi;
    scratchObj[0xd3] = preD2lo;
    const neighborSentinels: Record<number, number> = {};
    for (let idx = 0; idx < NEIGHBORS.length; idx++) {
      const nOff = NEIGHBORS[idx]!;
      const v = (0xc0 + idx) & 0xff;
      neighborSentinels[nOff] = v;
      scratchObj[nOff] = v;
    }

    // ── Setup binary side ──────────────────────────────────────────────
    // Sound buffer: init cur=0x401FF0, buffer=0xFF*4
    pokeMem(cpu, SOUND_CUR_PTR, 4, SOUND_BUF_BASE);
    for (let k = 0; k < 4; k++) {
      pokeMem(cpu, SOUND_BUF_BASE + k, 1, 0xff);
    }
    // Object scratch
    for (let k = 0; k < 0xe0; k++) {
      pokeMem(cpu, ptr + k, 1, scratchObj[k]!);
    }

    // ── Mirror su state.workRam ────────────────────────────────────────
    for (let k = 0; k < WORK_RAM_SIZE; k++) stateInst.workRam[k] = 0;
    // Object scratch in the mirror
    for (let k = 0; k < 0xe0; k++) {
      stateInst.workRam[off + k] = scratchObj[k]!;
    }

    // ── Run binary ─────────────────────────────────────────────────────
    // Args: arg1=objPtr (long), arg2=subStateCode (byte LSB of un long).
    // callFunction li pusha both as long RTL → SP+8 = arg1, SP+12..15 = arg2 long
    callFunction(cpu, FUN_25BAE, [ptr, code]);

    const binCurEnd = peekMem(cpu, SOUND_CUR_PTR, 4) >>> 0;
    const binSoundCount = (binCurEnd - SOUND_BUF_BASE) >>> 0;
    const binSounds: number[] = [];
    for (let k = 0; k < binSoundCount && k < 4; k++) {
      binSounds.push(peekMem(cpu, SOUND_BUF_BASE + k, 1) & 0xff);
    }

    // ── Run TS ─────────────────────────────────────────────────────────
    const tsSounds: number[] = [];
    ose25Ns.objectStateEntry25BAE(stateInst, ptr, code, {
      soundCommand: (cmd: number) => tsSounds.push(cmd & 0xff),
      fun_2591A: () => {
        /* no-op */
      },
    });

    let fail: FailRecord | null = null;

    // 1) Sound sequence
    if (binSounds.length !== tsSounds.length) {
      fail = {
        i,
        ptr,
        code,
        field: "soundSeqLen",
        bin: binSounds.length,
        ts: tsSounds.length,
      };
    } else {
      for (let k = 0; k < binSounds.length; k++) {
        if (binSounds[k] !== tsSounds[k]) {
          fail = {
            i,
            ptr,
            code,
            field: `sound[${k}]`,
            bin: `0x${binSounds[k]!.toString(16)}`,
            ts: `0x${tsSounds[k]!.toString(16)}`,
          };
          break;
        }
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    for (const fOff of SCRATCH_FIELDS) {
      const bin = peekMem(cpu, ptr + fOff, 1) & 0xff;
      const ts = stateInst.workRam[off + fOff] ?? 0;
      if (bin !== ts) {
        fail = {
          i,
          ptr,
          code,
          field: `scratch@+0x${fOff.toString(16)}`,
          bin: `0x${bin.toString(16)}`,
          ts: `0x${ts.toString(16)}`,
        };
        break;
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // 3) Neighbor sentinels must not change (bin == ts == original sentinel).
    let neighborFail: FailRecord | null = null;
    for (const nOff of NEIGHBORS) {
      const expected = neighborSentinels[nOff]!;
      const bin = peekMem(cpu, ptr + nOff, 1) & 0xff;
      const ts = stateInst.workRam[off + nOff] ?? 0;
      if (bin !== ts || bin !== expected) {
        neighborFail = {
          i,
          ptr,
          code,
          field: `neighbor@+0x${nOff.toString(16)}`,
          bin: `0x${bin.toString(16)}`,
          ts: `0x${ts.toString(16)}`,
        };
        break;
      }
    }
    if (neighborFail) {
      if (firstFail === null) firstFail = neighborFail;
      continue;
    }

    ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(
      `  First fail @ case ${f.i} ptr=0x${f.ptr.toString(16)} code=0x${f.code.toString(16)}:`,
    );
    console.log(`    ${f.field}: bin=${f.bin} ts=${f.ts}`);
  }
  // Silence unused warnings for helpers we kept for future suite expansion.
  void rw;
  void SOUND_BUF_END;

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
