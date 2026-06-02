#!/usr/bin/env node
/**
 * test-render-string-286ee-parity.ts — differential FUN_000286EE vs
 * `renderString286EE` TS replica.
 *
 *
 * **Strategia** — sentinel per le 2 sub esterne:
 *   Patch FUN_3874 and FUN_3520 a `addq.b #1, sentinel.l ; rts` (8 byte).
 *     - FUN_3874 → workRam[0x3D0]  (sentinelFmt)
 *     - FUN_3520 → workRam[0x3D1]  (sentinelRender)
 *
 *
 *   the output (3 byte writes in struct @ 0x434/0x435/0x43A).
 *
 *   3. workRam[0x430..0x43F] (16 bytes around struct @ 0x434):
 *      - [0x434] = with the da ROM table @ 0x23D3C[ordinal_sext]
 *      - [0x435] = tickOff (0 if ordinal==3, else 1)
 *      - [0x43A] = 0 (marker clear)
 *
 * The compared region [0x430..0x43F] does not include buffer bytes
 *
 *   - A: score random (0..255), ordinal random 0..7
 *   - B: score = 0 and 99 alternati (boundary)
 *   - C: score > 99 (100..200, clamp path)
 *
 * Uso: npx tsx packages/cli/src/test-render-string-286ee-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  renderString286EE as rs286Ns,
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
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_286EE = 0x000286ee;
const FUN_3874 = 0x00003874;
const FUN_3520 = 0x00003520;

// Sentinel byte slot in workRam (counter for the 2 subs).
const SENTINEL_FMT = 0x004003d0;
const SENTINEL_RENDER = 0x004003d1;

// Compared workRam range (struct @ 0x400434, 16 bytes around it).
const COMPARE_BASE = 0x00400430;
const COMPARE_SIZE = 0x10; // 0x430..0x43F

// Fixed slotAddr: object 0, field +0x6A = 0x400018 + 0*0xE2 + 0x6A = 0x400082
const SLOT_ADDR_ABS = 0x00400082;
const SLOT_ADDR_OFF = SLOT_ADDR_ABS - 0x400000; // 0x82

/**
 * Encode `addq.b #1, (abs).l ; rts` (8 byte) in `rom` a `entry`.
 *   addq.b #1, (abs).l → 0x52 0x39 + abs long (6 byte)
 *   rts                → 0x4E 0x75              (2 byte)
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

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface CaseSetup {
  score: number;       // word (0..0xFFFF) written at SLOT_ADDR
  ordinal: number;     // arg2 long (byte field used: & 0xFF)
  region: number[];    // 16 byte @ 0x430..0x43F (pre-fill)
  sentInitFmt: number;
  sentInitRender: number;
}

interface FailRecord {
  i: number;
  suite: string;
  field: string;
  bin: number;
  ts: number;
  setup: CaseSetup;
}

function setupCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  setup: CaseSetup,
): void {
  // Score word @ SLOT_ADDR_ABS (big-endian).
  const scoreHi = (setup.score >>> 8) & 0xff;
  const scoreLo = setup.score & 0xff;
  pokeMem(cpu, SLOT_ADDR_ABS, 1, scoreHi);
  pokeMem(cpu, SLOT_ADDR_ABS + 1, 1, scoreLo);
  state.workRam[SLOT_ADDR_OFF] = scoreHi;
  state.workRam[SLOT_ADDR_OFF + 1] = scoreLo;

  // Struct region @ 0x430..0x43F.
  const baseOff = COMPARE_BASE - 0x400000;
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const v = setup.region[i] ?? 0;
    pokeMem(cpu, COMPARE_BASE + i, 1, v);
    state.workRam[baseOff + i] = v;
  }

  // Sentinels.
  pokeMem(cpu, SENTINEL_FMT, 1, setup.sentInitFmt);
  state.workRam[SENTINEL_FMT - 0x400000] = setup.sentInitFmt;
  pokeMem(cpu, SENTINEL_RENDER, 1, setup.sentInitRender);
  state.workRam[SENTINEL_RENDER - 0x400000] = setup.sentInitRender;
}

/** Compare sentinels + struct region. Returns first diff or null. */
function compareCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { field: string; bin: number; ts: number } | null {
  const fBin = peekMem(cpu, SENTINEL_FMT, 1) & 0xff;
  const fTs = state.workRam[SENTINEL_FMT - 0x400000] ?? 0;
  if (fBin !== fTs) return { field: "sentinelFmt", bin: fBin, ts: fTs };

  const rBin = peekMem(cpu, SENTINEL_RENDER, 1) & 0xff;
  const rTs = state.workRam[SENTINEL_RENDER - 0x400000] ?? 0;
  if (rBin !== rTs) return { field: "sentinelRender", bin: rBin, ts: rTs };

  // Struct region [0x430..0x43F]
  const baseOff = COMPARE_BASE - 0x400000;
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const b = peekMem(cpu, COMPARE_BASE + i, 1) & 0xff;
    const t = state.workRam[baseOff + i] ?? 0;
    if (b !== t) {
      return { field: `region+0x${i.toString(16).padStart(2, "0")}`, bin: b, ts: t };
    }
  }
  return null;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 4);
  const remainder = total - perSuite * 4;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Patch le 2 sub a stub addq sentinel+rts.
  patchStubAddq(romBuf, FUN_3874, SENTINEL_FMT);
  patchStubAddq(romBuf, FUN_3520, SENTINEL_RENDER);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  // TS subs increment sentinels in workRam, mirroring binary addq stubs.
  const subs: rs286Ns.RenderString286EESubs = {
    numberFormatter: (s: ReturnType<typeof stateNs.emptyGameState>) => {
      const off = SENTINEL_FMT - 0x400000;
      s.workRam[off] = ((s.workRam[off] ?? 0) + 1) & 0xff;
    },
    renderStringChain2: () => {
      const off = SENTINEL_RENDER - 0x400000;
      stateInst.workRam[off] = ((stateInst.workRam[off] ?? 0) + 1) & 0xff;
    },
  };

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    i: number,
    setup: CaseSetup,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupCase(stateInst, cpu, setup);

    // Binary call: FUN_286EE(slotAddr, ordinal).
    callFunction(cpu, FUN_286EE, [SLOT_ADDR_ABS >>> 0, setup.ordinal >>> 0]);

    // TS call: renderString286EE(state, rom, slotAddr, ordinal, subs).
    rs286Ns.renderString286EE(stateInst, tsRom, SLOT_ADDR_ABS >>> 0, setup.ordinal >>> 0, subs);

    const fail = compareCase(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = { i, suite, field: fail.field, bin: fail.bin, ts: fail.ts, setup };
    }
    return false;
  }

  const rng = makeRng(0x286ee);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  function makeRegion(): number[] {
    return new Array(COMPARE_SIZE).fill(0).map(() => rb());
  }

  // ─── Suite A: score random 0..255, ordinal random 0..7 ───────────────
  console.log(`\n=== renderString286EE (FUN_286EE) — Suite A: random score & ordinal 0..7 — ${perSuite} cases ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const score = Math.floor(rng() * 256);
    const ordinal = Math.floor(rng() * 8);
    const setup: CaseSetup = {
      score,
      ordinal,
      region: makeRegion(),
      sentInitFmt: rb(),
      sentInitRender: rb(),
    };
    if (runOneCase("A", i, setup)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: score boundary 0 / 99 alternati ─────────────────────────
  console.log(`\n=== Suite B: score=0 and score=99 alternati — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const score = (i % 2 === 0) ? 0 : 99;
    const ordinal = Math.floor(rng() * 4);
    const setup: CaseSetup = {
      score,
      ordinal,
      region: makeRegion(),
      sentInitFmt: rb(),
      sentInitRender: rb(),
    };
    if (runOneCase("B", i, setup)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: score > 99 (clamp path, 100..200) ───────────────────────
  console.log(`\n=== Suite C: score 100..200 (clamp a 99) — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const score = 100 + Math.floor(rng() * 101);
    const ordinal = Math.floor(rng() * 8);
    const setup: CaseSetup = {
      score,
      ordinal,
      region: makeRegion(),
      sentInitFmt: rb(),
      sentInitRender: rb(),
    };
    if (runOneCase("C", i, setup)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: ordinal 0..3 ciclato, score random 0..199 ──────────────
  console.log(`\n=== Suite D: ordinal 0..3 ciclato — ${perSuite + remainder} cases ===`);
  let okD = 0;
  const dCount = perSuite + remainder;
  for (let i = 0; i < dCount; i++) {
    const score = Math.floor(rng() * 200);
    const ordinal = i % 4;
    const setup: CaseSetup = {
      score,
      ordinal,
      region: makeRegion(),
      sentInitFmt: rb(),
      sentInitRender: rb(),
    };
    if (runOneCase("D", i, setup)) okD++;
  }
  console.log(`  Match: ${okD}/${dCount} = ${((okD / dCount) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log(`\n=== TOTALE: ${totalOk}/${total} ===`);

  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.error(`\nFIRST FAIL [suite=${f.suite} tc=${f.i}]:`);
    console.error(`  field:   ${f.field}`);
    console.error(`  bin:     0x${f.bin.toString(16).padStart(2, "0")}`);
    console.error(`  ts:      0x${f.ts.toString(16).padStart(2, "0")}`);
    console.error(`  score:   0x${f.setup.score.toString(16).padStart(4, "0")} (${f.setup.score})`);
    console.error(`  ordinal: ${f.setup.ordinal}`);
    exit(1);
  }

  if (totalOk < total) {
    console.error(`\nPARITY FAILED: ${total - totalOk} mismatch(es)`);
    exit(1);
  }

  console.log("PARITY OK");
  disposeCpu(cpu);
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  exit(2);
});
