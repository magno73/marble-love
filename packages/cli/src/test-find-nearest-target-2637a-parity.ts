#!/usr/bin/env node
/**
 * test-find-nearest-target-2637a-parity.ts — differential FUN_0002637A vs
 * findNearestTarget2637A.
 *
 * (terminata da 0xFF), filtra per byte (≡ A2[+0x1D] sign-ext), valida via
 * `*0x400472.b`) for the miglior candidato visibile.
 *
 * Strategia parity:
 *
 * 1. Patcha in ROM:
 *      `0x1EF1A + (*0x400394.w * 4)`): we write *0x400394 = K e
 *      place at `(0x1EF1A + K*4)` a long that points to our buffer
 *      of candidates (also in ROM, in area free).
 *
 *    CPU. We use area ROM free (e.g. `0x3F000`) and we inject a set
 *
 *    - Generate obj with A2[+0x1D]=filter, A2[+0x32].w=objX, A2[+0x34].w=objY.
 *    - Pre-fill globals 0x400462/466/472 with sentinels.
 *
 *
 * 4. Run TS findNearestTarget2637A on workRam mirror, with
 *    `tableReader = (a) => romBuf[a]` and `lineOfSight17CB8 = () => 0`.
 *
 *
 * Uso: npx tsx packages/cli/src/test-find-nearest-target-2637a-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  findNearestTarget2637A as fntNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_2637A = 0x0002637a;
const FUN_17CB8 = 0x00017cb8;
const DISPATCH_TABLE_1EF1A = 0x0001ef1a;
const GLOBAL_400394 = 0x00400394;
const GLOBAL_400462 = 0x00400462;
const GLOBAL_400466 = 0x00400466;
const GLOBAL_400472 = 0x00400472;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

// ha size ≈ 0x80000 (quad ROM 128KB x 4).
const SCRATCH_TABLE_ROM = 0x0007ff00;
// Slot dispatch table: scegliamo K=0x40 (= 0x100 byte offset). Verifichiamo
// so that 0x1EF1A + 0x100 is in ROM and does not conflict.
const DISPATCH_K = 0x40;
const DISPATCH_SLOT_ADDR = DISPATCH_TABLE_1EF1A + DISPATCH_K * 4; // = 0x1F01A

// Pointer candidates (well within workRam, lascia margin per stack a 0x401F00).
const PTR_CANDIDATES = [
  0x00401000, 0x00401100, 0x00401200, 0x00401300,
  0x00401400, 0x00401500, 0x00401600, 0x00401700,
  0x00401800, 0x00401900, 0x00401a00, 0x00401b00,
  0x00401c00,
] as const;

/** Patch ROM bytes. */
function patchRomBytes(
  rom: Buffer,
  entry: number,
  bytes: readonly number[],
): void {
  for (let i = 0; i < bytes.length; i++) {
    rom[entry + i] = bytes[i]! & 0xff;
  }
}

/** Patcha FUN_17CB8 a `moveq #0,D0; rts` (4 byte). */
function patchSubsRom(rom: Buffer): void {
  patchRomBytes(rom, FUN_17CB8, [0x70, 0x00, 0x4e, 0x75]);
  // Patcha dispatch slot @ 0x1F01A: long pointer = SCRATCH_TABLE_ROM.
  // Big-endian.
  rom[DISPATCH_SLOT_ADDR + 0] = (SCRATCH_TABLE_ROM >>> 24) & 0xff;
  rom[DISPATCH_SLOT_ADDR + 1] = (SCRATCH_TABLE_ROM >>> 16) & 0xff;
  rom[DISPATCH_SLOT_ADDR + 2] = (SCRATCH_TABLE_ROM >>> 8) & 0xff;
  rom[DISPATCH_SLOT_ADDR + 3] = SCRATCH_TABLE_ROM & 0xff;
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
  field: string;
  bin: number;
  ts: number;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Pre-patch ROM (FUN_17CB8 + dispatch slot @ 0x1F01A).
  patchSubsRom(romBuf);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== findNearestTarget2637A (FUN_0002637A) — ${n} cases ===`);
  console.log(
    `  (FUN_17CB8 patched → moveq #0,D0;rts; candidates table @ 0x${SCRATCH_TABLE_ROM.toString(16)})`,
  );

  const rng = makeRng(0x2637a);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const pickPtr = (): number =>
    PTR_CANDIDATES[Math.floor(rng() * PTR_CANDIDATES.length)]!;

  const tableReader = (addr: number): number => romBuf[addr] ?? 0xff;

  let ok = 0;
  let firstFail: FailRecord | null = null;

  // Vicini athe 3 globals (per no-spill check).
  const NEIGHBOR_GLOBALS = [
    0x460, 0x461, 0x46a, 0x46b, 0x46c, 0x46d, 0x46e, 0x46f, 0x470, 0x471,
    0x473, 0x474, 0x475, 0x476,
  ] as const;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const ptr = pickPtr();
    const off = ptr - WORK_RAM_BASE;

    const filterByte = (rb() & 0x7f) | 0x01;

    // metric range: max diff up to 0xFE). Picks 0..0xFF.
    const objX = rb() & 0xff;
    const objY = rb() & 0xff;

    const numRecs = 1 + Math.floor(rng() * 12);
    const tableBytes: number[] = [];
    for (let r = 0; r < numRecs; r++) {
      // X grid: choose from [0, 0xFE] to avoid collision with sentinel.
      const x = rb() & 0xfe;
      const y = rb() & 0xfe;
      // Filter: 50% match, 50% mismatch random.
      const recFilter =
        rng() < 0.5 ? filterByte : (filterByte ^ ((rb() & 0x7f) | 1)) & 0x7f;
      // Pad byte: random.
      tableBytes.push(x & 0xff, y & 0xff, recFilter & 0xff, rb());
    }
    // Sentinel terminator.
    tableBytes.push(0xff, 0x00, 0x00, 0x00);

    // ── Setup binary side ──────────────────────────────────────────────
    for (let k = 0; k < tableBytes.length; k++) {
      romBuf[SCRATCH_TABLE_ROM + k] = tableBytes[k]! & 0xff;
    }
    // Verify: if the CPU snapshots ROM, we must recreate it.
    for (let k = 0; k < tableBytes.length; k++) {
      pokeMem(cpu, SCRATCH_TABLE_ROM + k, 1, tableBytes[k]!);
    }
    pokeMem(cpu, DISPATCH_SLOT_ADDR, 4, SCRATCH_TABLE_ROM);
    // And patch FUN_17CB8 (for safety)
    pokeMem(cpu, FUN_17CB8, 4, 0x70004e75);

    // *0x400394 = DISPATCH_K (.w)
    pokeMem(cpu, GLOBAL_400394, 2, DISPATCH_K & 0xffff);

    // Random pre-existing globals (sentinel distintivi)
    const g462Pre = ((rb() << 24) | (rb() << 16) | (rb() << 8) | rb()) >>> 0;
    const g466Pre = ((rb() << 24) | (rb() << 16) | (rb() << 8) | rb()) >>> 0;
    const g472Pre = rb();
    pokeMem(cpu, GLOBAL_400462, 4, g462Pre);
    pokeMem(cpu, GLOBAL_400466, 4, g466Pre);
    pokeMem(cpu, GLOBAL_400472, 1, g472Pre);

    // Random near globals (sentinel)
    const neighborSentinels: Record<number, number> = {};
    for (let idx = 0; idx < NEIGHBOR_GLOBALS.length; idx++) {
      const nOff = NEIGHBOR_GLOBALS[idx]!;
      const v = (0xc0 + idx) & 0xff;
      neighborSentinels[nOff] = v;
      pokeMem(cpu, WORK_RAM_BASE + nOff, 1, v);
    }

    // Object: filter byte, objX, objY in grid-space.
    pokeMem(cpu, ptr + 0x1d, 1, filterByte);
    pokeMem(cpu, ptr + 0x32, 2, objX & 0xffff);
    pokeMem(cpu, ptr + 0x34, 2, objY & 0xffff);
    for (let k = 0; k < 0x40; k++) {
      if (k !== 0x1d && k !== 0x32 && k !== 0x33 && k !== 0x34 && k !== 0x35) {
        pokeMem(cpu, ptr + k, 1, rb());
      }
    }

    // ── Mirror su state.workRam ────────────────────────────────────────
    for (let k = 0; k < WORK_RAM_SIZE; k++) stateInst.workRam[k] = 0;
    // *0x400394
    stateInst.workRam[0x394] = (DISPATCH_K >>> 8) & 0xff;
    stateInst.workRam[0x395] = DISPATCH_K & 0xff;
    // Globals pre-existing (mirror)
    stateInst.workRam[0x462] = (g462Pre >>> 24) & 0xff;
    stateInst.workRam[0x463] = (g462Pre >>> 16) & 0xff;
    stateInst.workRam[0x464] = (g462Pre >>> 8) & 0xff;
    stateInst.workRam[0x465] = g462Pre & 0xff;
    stateInst.workRam[0x466] = (g466Pre >>> 24) & 0xff;
    stateInst.workRam[0x467] = (g466Pre >>> 16) & 0xff;
    stateInst.workRam[0x468] = (g466Pre >>> 8) & 0xff;
    stateInst.workRam[0x469] = g466Pre & 0xff;
    stateInst.workRam[0x472] = g472Pre;
    // Vicini
    for (const [nOff, v] of Object.entries(neighborSentinels)) {
      stateInst.workRam[Number(nOff)] = v;
    }
    // Object fields
    stateInst.workRam[off + 0x1d] = filterByte;
    stateInst.workRam[off + 0x32] = (objX >>> 8) & 0xff;
    stateInst.workRam[off + 0x33] = objX & 0xff;
    stateInst.workRam[off + 0x34] = (objY >>> 8) & 0xff;
    stateInst.workRam[off + 0x35] = objY & 0xff;

    // ── Run binary ─────────────────────────────────────────────────────
    callFunction(cpu, FUN_2637A, [ptr]);

    // ── Run TS ─────────────────────────────────────────────────────────
    fntNs.findNearestTarget2637A(
      stateInst,
      ptr,
      SCRATCH_TABLE_ROM,
      tableReader,
      {
        lineOfSight17CB8: () => 0,
      },
    );

    let fail: FailRecord | null = null;

    // *0x400462 (long)
    {
      const bin = peekMem(cpu, GLOBAL_400462, 4) >>> 0;
      const ts =
        (((stateInst.workRam[0x462] ?? 0) << 24) |
          ((stateInst.workRam[0x463] ?? 0) << 16) |
          ((stateInst.workRam[0x464] ?? 0) << 8) |
          (stateInst.workRam[0x465] ?? 0)) >>>
        0;
      if (bin !== ts) {
        fail = { i, ptr, field: "global@0x400462", bin, ts };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // *0x400466 (long)
    {
      const bin = peekMem(cpu, GLOBAL_400466, 4) >>> 0;
      const ts =
        (((stateInst.workRam[0x466] ?? 0) << 24) |
          ((stateInst.workRam[0x467] ?? 0) << 16) |
          ((stateInst.workRam[0x468] ?? 0) << 8) |
          (stateInst.workRam[0x469] ?? 0)) >>>
        0;
      if (bin !== ts) {
        fail = { i, ptr, field: "global@0x400466", bin, ts };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // *0x400472 (byte)
    {
      const bin = peekMem(cpu, GLOBAL_400472, 1) & 0xff;
      const ts = stateInst.workRam[0x472] ?? 0;
      if (bin !== ts) {
        fail = { i, ptr, field: "global@0x400472", bin, ts };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // Neighbor globals must not change.
    let neighborFail: FailRecord | null = null;
    for (const nOff of NEIGHBOR_GLOBALS) {
      const expected = neighborSentinels[nOff]!;
      const bin = peekMem(cpu, WORK_RAM_BASE + nOff, 1) & 0xff;
      const ts = stateInst.workRam[nOff] ?? 0;
      if (bin !== ts || bin !== expected) {
        neighborFail = {
          i,
          ptr,
          field: `neighbor@0x${nOff.toString(16)}`,
          bin,
          ts,
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
    console.log(`  First fail @ case ${f.i} ptr=0x${f.ptr.toString(16)}:`);
    console.log(
      `    ${f.field}: bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
