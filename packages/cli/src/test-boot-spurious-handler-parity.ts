#!/usr/bin/env node
/**
 * test-boot-spurious-handler-parity.ts — differential FUN_100D8 vs
 * bootSpuriousHandler.
 *
 * `*0x40000E` and then branches to 0x100B0 (boot main path), which ends with
 * `jmp 0x117B2` (NO `rts`).
 *
 * To test via `callFunction` (which uses sentinel return + rts), patch
 * il `jmp 0x117B2.l` @ 0x100D2 (`4E F9 00 01 17 B2`) sostituendo i primi 2
 * eseguiti.
 *
 *   - 0x000E         (sentinel byte)
 *   - 0x0440..0443   (SP save long)
 *   - 0x03AE..03AF   (AV control init word = 0x0080)
 *   - 0x03B2         (frame flag = 0)
 *   - 0x03B6..03B7   (frame ctr = 0xFFFF + 1 = 0x0000)
 *   - 0x03B8..03B9   (countdown = 0x012C)
 *   - 0x1F44..1F45   (audio mailbox base)
 *   - 0x1F5A..1F5D   (audio ack ptr long)
 *
 * Writes to MMIO 0x840000, 0x860000, and 0xFE0000 are ignored by Musashi
 * (regions not mapped in the test layout) and by TS (which does not touch
 *
 * Uso: npx tsx packages/cli/src/test-boot-spurious-handler-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bootSpuriousHandler as bshNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_100D8 = 0x000100d8;
/** Offset ROM of the `jmp 0x117B2.l` @ 0x100D2 (6 byte: 4EF9 0001 17B2). */
const JMP_PATCH_OFF = 0x100d2;

/** Offset workRam confrontati (relative a 0x400000). */
interface WatchedField {
  off: number;
  size: 1 | 2 | 4;
  name: string;
}

const WATCHED: WatchedField[] = [
  { off: 0x000e, size: 1, name: "sentinel(0x40000E)" },
  { off: 0x0440, size: 4, name: "spSave(0x400440)" },
  { off: 0x03ae, size: 2, name: "avControl(0x4003AE)" },
  { off: 0x03b2, size: 1, name: "frameFlag(0x4003B2)" },
  { off: 0x03b6, size: 2, name: "frameCtr(0x4003B6)" },
  { off: 0x03b8, size: 2, name: "countdown(0x4003B8)" },
  { off: 0x1f44, size: 1, name: "audioBase(0x401F44)" },
  { off: 0x1f45, size: 1, name: "audioFlag(0x401F45)" },
  { off: 0x1f5a, size: 4, name: "audioAck(0x401F5A)" },
];

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function readField(buf: Uint8Array, off: number, size: 1 | 2 | 4): number {
  if (size === 1) return (buf[off] ?? 0) & 0xff;
  if (size === 2) {
    return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
  }
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

function writeField(
  buf: Uint8Array,
  off: number,
  size: 1 | 2 | 4,
  v: number,
): void {
  if (size === 1) {
    buf[off] = v & 0xff;
    return;
  }
  if (size === 2) {
    buf[off] = (v >>> 8) & 0xff;
    buf[off + 1] = v & 0xff;
    return;
  }
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

interface FailRecord {
  i: number;
  field: string;
  bin: number;
  ts: number;
  d0: number;
  preCtr: number;
  preAck: number;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = Buffer.from(readFileSync(romPath));

  // Patch `jmp 0x117B2` @ 0x100D2 → `rts` (4E 75) + 4 byte garbage.
  // (sanity check: avoids patching the wrong ROM).
  const orig = [
    rom[JMP_PATCH_OFF],
    rom[JMP_PATCH_OFF + 1],
    rom[JMP_PATCH_OFF + 2],
    rom[JMP_PATCH_OFF + 3],
    rom[JMP_PATCH_OFF + 4],
    rom[JMP_PATCH_OFF + 5],
  ];
  const expected = [0x4e, 0xf9, 0x00, 0x01, 0x17, 0xb2];
  for (let k = 0; k < 6; k++) {
    if (orig[k] !== expected[k]) {
      console.error(
        `error: ROM mismatch @ 0x${(JMP_PATCH_OFF + k).toString(16)}: ` +
          `expected 0x${expected[k]!.toString(16)}, got 0x${(orig[k] ?? 0).toString(16)}`,
      );
      exit(4);
    }
  }
  rom[JMP_PATCH_OFF] = 0x4e;
  rom[JMP_PATCH_OFF + 1] = 0x75; // rts

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  console.log(`\n=== bootSpuriousHandler (FUN_100D8) — ${n} cases ===`);

  const rng = makeRng(0x100d8);
  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    // Reset SP — la jsr 0x100E0 e la patched rts hanno bisogno of stack room.
    const spInitial = 0x00401efc;
    cpu.system.setRegister("sp", spInitial);

    // Generate random input for each watched field plus d0In.
    const d0In = Math.floor(rng() * 256) & 0xff;
    // callFunction wrapper). Specifically, callFunction pushes the sentinel (-4).
    const spAtMoveL = (spInitial - 4) >>> 0;

    for (const f of WATCHED) {
      const max = f.size === 1 ? 256 : f.size === 2 ? 0x10000 : 0x100000000;
      const v = Math.floor(rng() * max);
      pokeMem(cpu, 0x00400000 + f.off, f.size, v);
      writeField(stateInst.workRam, f.off, f.size, v);
    }

    // Pre-run debug snapshot.
    const preCtr = readField(stateInst.workRam, 0x03b6, 2);
    const preAck = readField(stateInst.workRam, 0x1f5a, 4);

    cpu.system.setRegister("d0", d0In >>> 0);

    // ── Run binary ──────────────────────────────────────────────────────
    callFunction(cpu, FUN_100D8, []);

    // ── Run TS replica ──────────────────────────────────────────────────
    bshNs.bootSpuriousHandler(stateInst, d0In, spAtMoveL);

    // ── Diff workRam su WATCHED fields ──────────────────────────────────
    let match = true;
    for (const f of WATCHED) {
      const bin = peekMem(cpu, 0x00400000 + f.off, f.size);
      const ts = readField(stateInst.workRam, f.off, f.size);
      if ((bin >>> 0) !== (ts >>> 0)) {
        match = false;
        if (firstFail === null) {
          firstFail = {
            i,
            field: f.name,
            bin: bin >>> 0,
            ts: ts >>> 0,
            d0: d0In,
            preCtr,
            preAck,
          };
        }
        break;
      }
    }

    if (match) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} (field=${f.field}):`);
    console.log(
      `    inputs: d0=0x${f.d0.toString(16).padStart(2, "0")} preCtr=0x${f.preCtr.toString(16)} preAck=0x${f.preAck.toString(16)}`,
    );
    console.log(
      `    bin=0x${f.bin.toString(16)}  ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
