#!/usr/bin/env node
/**
 * test-object-charcode-broadcast-1bbaa-parity.ts — differential FUN_0001BBAA
 * vs `objectCharcodeBroadcast1BBAA`.
 *
 * FUN_0001BBAA (222 byte): "object charcode broadcast under flag-gated,
 * progress-gated dispatch". Vedi engine/src/object-charcode-broadcast-1bbaa.ts
 * per la spec disasm completa.
 *
 * **Strategia parity**:
 *     da Musashi ha la ROM mappata in `0x000000..0x07FFFF`. Il TS module
 *     + flag byte @ 0x40076C.
 *
 * **Suite (4×125 + remainder = 500)**:
 *        with state=1, filter=0, signedRange in [3,6], charcode in list)
 *   - C: forced no-match (gate=1, but every obj fails one filter)
 *        index variabile)
 *
 * Uso: npx tsx packages/cli/src/test-object-charcode-broadcast-1bbaa-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  objectCharcodeBroadcast1BBAA as broadcastNs,
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

const FUN_1BBAA = 0x0001bbaa;

const LEVEL_IDX_ADDR = 0x00400394;
const GATE_FLAG_ADDR = 0x0040076c;
const PROGRESS_ADDR = 0x00400444;
const OBJ_COUNT_ADDR = 0x00400396;
const OBJ_BASE_ADDR = 0x00400018;
const OBJ_STRIDE = 0xe2;
const ROM_PTR_TABLE_BASE = 0x00024aae;
const ROM_BYTE_TABLE_BASE = 0x00024a94;

/** Range di obj iterati nel test (count ≤ MAX_OBJ_COUNT). */
const MAX_OBJ_COUNT = 8;
const LIST_BASE_ADDR = 0x024b00;
/** Lunghezza max char-list (incl. terminator). */
const LIST_MAX_LEN = 8;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface TestCase {
  levelIdx: number;            // word @ 0x400394 (limited to ≤ 5 per ptr-table)
  gateByte: number;            // byte @ 0x40076C
  progressByte: number;        // byte @ 0x400444
  thresholdByte: number;       // ROM byte @ 0x24a94 + idx
  listBytes: number[];         // char-list (last byte = 0xFF terminator)
  count: number;               // word @ 0x400396
  /** Per ogni slot: state, filterFlag, charcode, signedRange (word), broadcastFlag. */
  objs: Array<{
    state: number;
    filterFlag: number;
    charcode: number;
    signedRange: number;
    broadcastFlag: number;
  }>;
}

function setupCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  rom: Uint8Array,
  tc: TestCase,
): void {
  // ─── Globals ─────────────────────────────────────────────
  // word @ 0x400394
  pokeMem(cpu, LEVEL_IDX_ADDR, 2, tc.levelIdx & 0xffff);
  state.workRam[LEVEL_IDX_ADDR - 0x400000] = (tc.levelIdx >>> 8) & 0xff;
  state.workRam[LEVEL_IDX_ADDR - 0x400000 + 1] = tc.levelIdx & 0xff;
  // byte @ 0x40076C
  pokeMem(cpu, GATE_FLAG_ADDR, 1, tc.gateByte & 0xff);
  state.workRam[GATE_FLAG_ADDR - 0x400000] = tc.gateByte & 0xff;
  // byte @ 0x400444
  pokeMem(cpu, PROGRESS_ADDR, 1, tc.progressByte & 0xff);
  state.workRam[PROGRESS_ADDR - 0x400000] = tc.progressByte & 0xff;
  // word @ 0x400396 (count)
  pokeMem(cpu, OBJ_COUNT_ADDR, 2, tc.count & 0xffff);
  state.workRam[OBJ_COUNT_ADDR - 0x400000] = (tc.count >>> 8) & 0xff;
  state.workRam[OBJ_COUNT_ADDR - 0x400000 + 1] = tc.count & 0xff;

  // ─── ROM tables ──────────────────────────────────────────
  // Byte-table @ 0x24a94 + levelIdx
  const tAddr = ROM_BYTE_TABLE_BASE + tc.levelIdx;
  pokeMem(cpu, tAddr, 1, tc.thresholdByte & 0xff);
  rom[tAddr] = tc.thresholdByte & 0xff;
  // Ptr-table @ 0x24aae + levelIdx*4 (long big-endian → LIST_BASE_ADDR + levelIdx*LIST_MAX_LEN)
  const listAddr = LIST_BASE_ADDR + tc.levelIdx * LIST_MAX_LEN;
  const ptrSlot = ROM_PTR_TABLE_BASE + tc.levelIdx * 4;
  pokeMem(cpu, ptrSlot + 0, 1, (listAddr >>> 24) & 0xff);
  pokeMem(cpu, ptrSlot + 1, 1, (listAddr >>> 16) & 0xff);
  pokeMem(cpu, ptrSlot + 2, 1, (listAddr >>> 8) & 0xff);
  pokeMem(cpu, ptrSlot + 3, 1, listAddr & 0xff);
  rom[ptrSlot + 0] = (listAddr >>> 24) & 0xff;
  rom[ptrSlot + 1] = (listAddr >>> 16) & 0xff;
  rom[ptrSlot + 2] = (listAddr >>> 8) & 0xff;
  rom[ptrSlot + 3] = listAddr & 0xff;
  // Char-list bytes
  for (let i = 0; i < tc.listBytes.length; i++) {
    pokeMem(cpu, listAddr + i, 1, tc.listBytes[i]! & 0xff);
    rom[listAddr + i] = tc.listBytes[i]! & 0xff;
  }

  for (let i = 0; i < tc.objs.length; i++) {
    const base = OBJ_BASE_ADDR + i * OBJ_STRIDE;
    const o = tc.objs[i]!;
    pokeMem(cpu, base + 0x18, 1, o.state & 0xff);
    pokeMem(cpu, base + 0x1a, 1, o.filterFlag & 0xff);
    pokeMem(cpu, base + 0x1b, 1, o.charcode & 0xff);
    pokeMem(cpu, base + 0x6a, 2, o.signedRange & 0xffff);
    pokeMem(cpu, base + 0xcb, 1, o.broadcastFlag & 0xff);
    state.workRam[base - 0x400000 + 0x18] = o.state & 0xff;
    state.workRam[base - 0x400000 + 0x1a] = o.filterFlag & 0xff;
    state.workRam[base - 0x400000 + 0x1b] = o.charcode & 0xff;
    state.workRam[base - 0x400000 + 0x6a] = (o.signedRange >>> 8) & 0xff;
    state.workRam[base - 0x400000 + 0x6a + 1] = o.signedRange & 0xff;
    state.workRam[base - 0x400000 + 0xcb] = o.broadcastFlag & 0xff;
  }
}

interface FailRecord {
  suite: string;
  tc: number;
  offset: number;
  bin: number;
  ts: number;
}

/** Compara byte-by-byte le aree workRam interessate. */
function compareWorkRam(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  count: number,
): { offset: number; bin: number; ts: number } | null {
  // Gate flag
  {
    const b = peekMem(cpu, GATE_FLAG_ADDR, 1);
    const t = state.workRam[GATE_FLAG_ADDR - 0x400000] ?? 0;
    if (b !== t) return { offset: GATE_FLAG_ADDR - 0x400000, bin: b, ts: t };
  }
  for (let i = 0; i < count; i++) {
    const base = OBJ_BASE_ADDR + i * OBJ_STRIDE;
    // Only +0xCB matters for parity; the others are not modified.
    const off = base + 0xcb;
    const b = peekMem(cpu, off, 1);
    const t = state.workRam[off - 0x400000] ?? 0;
    if (b !== t) return { offset: off - 0x400000, bin: b, ts: t };
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
  const romBytes = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state: stateInst });
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBytes.subarray(0, tsRom.program.length));

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tc: number, c: TestCase): boolean {
    // Avoid cross-test leakage.
    cpu.system.setRegister("sp", 0x401f00);
    // Zero workRam for the regions we will modify (gate, progress, count,
    pokeMem(cpu, GATE_FLAG_ADDR, 1, 0);
    pokeMem(cpu, PROGRESS_ADDR, 1, 0);
    pokeMem(cpu, OBJ_COUNT_ADDR, 2, 0);
    pokeMem(cpu, LEVEL_IDX_ADDR, 2, 0);
    stateInst.workRam[GATE_FLAG_ADDR - 0x400000] = 0;
    stateInst.workRam[PROGRESS_ADDR - 0x400000] = 0;
    stateInst.workRam[OBJ_COUNT_ADDR - 0x400000] = 0;
    stateInst.workRam[OBJ_COUNT_ADDR - 0x400000 + 1] = 0;
    stateInst.workRam[LEVEL_IDX_ADDR - 0x400000] = 0;
    stateInst.workRam[LEVEL_IDX_ADDR - 0x400000 + 1] = 0;
    for (let i = 0; i < MAX_OBJ_COUNT; i++) {
      const base = OBJ_BASE_ADDR + i * OBJ_STRIDE;
      for (const off of [0x18, 0x1a, 0x1b, 0x6a, 0x6b, 0xcb]) {
        pokeMem(cpu, base + off, 1, 0);
        stateInst.workRam[base - 0x400000 + off] = 0;
      }
    }

    setupCase(stateInst, cpu, tsRom.program, c);

    callFunction(cpu, FUN_1BBAA, []);
    broadcastNs.objectCharcodeBroadcast1BBAA(stateInst, tsRom);

    const fail = compareWorkRam(stateInst, cpu, c.count);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        offset: fail.offset,
        bin: fail.bin,
        ts: fail.ts,
      };
    }
    return false;
  }

  const rng = makeRng(0x1bbaa);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  function randomCase(opts?: Partial<TestCase>): TestCase {
    const count = Math.floor(rng() * (MAX_OBJ_COUNT + 1)); // 0..MAX
    const objs: TestCase["objs"] = [];
    for (let i = 0; i < MAX_OBJ_COUNT; i++) {
      objs.push({
        state: Math.floor(rng() * 4) & 0xff, // 0..3 (1 = active)
        filterFlag: rng() < 0.5 ? 0 : (rb() | 1) & 0xff,
        charcode: rb(),
        signedRange: Math.floor(rng() * 0xffff) & 0xffff,
        broadcastFlag: rb(),
      });
    }
    // Char-list: 1..(LIST_MAX_LEN-1) bytes + terminator
    const llen = 1 + Math.floor(rng() * (LIST_MAX_LEN - 1));
    const listBytes: number[] = [];
    for (let i = 0; i < llen - 1; i++) {
      let b = rb();
      if (b === 0xff) b = 0xfe; // evita terminator prematuro
      listBytes.push(b);
    }
    listBytes.push(0xff);

    return {
      levelIdx: Math.floor(rng() * 6), // 0..5 (range valido ptr-table)
      gateByte: rng() < 0.7 ? rb() | 0x80 : 0, // bias: spesso non zero
      progressByte: rb(),
      thresholdByte: rb(),
      listBytes,
      count,
      objs,
      ...opts,
    };
  }

  // ─── Suite A: random ──────────────────────────────────────────────────
  console.log(
    `\n=== objectCharcodeBroadcast1BBAA (FUN_0001BBAA) — Suite A: random — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    if (runOneCase("A", i, randomCase())) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: forced match (gate=1, progress<threshold, char in list) ──
  console.log(`\n=== Suite B: forced match — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const c = randomCase({
      gateByte: 1 | (rb() & 0xfe),
      progressByte: 0x10,
      thresholdByte: 0x80,
    });
    c.count = Math.max(2, c.count);
    const cc = c.objs[0]!.charcode & 0xff;
    c.listBytes = [cc, 0xff];
    c.objs[0] = {
      state: 1,
      filterFlag: 0,
      charcode: cc,
      signedRange: 3 + Math.floor(rng() * 4), // 3..6
      broadcastFlag: 0,
    };
    if (runOneCase("B", i, c)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced no-match (gate=1 ma filtri falliscono) ────────────
  console.log(`\n=== Suite C: forced no-match — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const c = randomCase({
      gateByte: 1,
      progressByte: 0x10,
      thresholdByte: 0x80,
    });
    for (let j = 0; j < c.objs.length; j++) {
      c.objs[j]!.state = j % 3 === 0 ? 0 : 2;
    }
    c.listBytes = [0xaa, 0xff];
    if (runOneCase("C", i, c)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ──────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: edge cases — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const sub = i % 6;
    let c: TestCase;
    if (sub === 0) {
      // count = 0
      c = randomCase({ gateByte: 1, count: 0 });
    } else if (sub === 1) {
      // gate = 0
      c = randomCase({ gateByte: 0 });
    } else if (sub === 2) {
      c = randomCase({ gateByte: 1, progressByte: 0x10, thresholdByte: 0x80 });
      c.listBytes = [0xff];
    } else if (sub === 3) {
      // threshold == progress (BLS triggers exit, ≤ unsigned)
      const v = rb();
      c = randomCase({ gateByte: 1, progressByte: v, thresholdByte: v });
    } else if (sub === 4) {
      // signedRange = 7 / 2 (bordi del filtro)
      c = randomCase({ gateByte: 1, progressByte: 0x10, thresholdByte: 0x80 });
      for (let j = 0; j < c.objs.length; j++) {
        c.objs[j]!.signedRange = j % 2 === 0 ? 2 : 7;
        c.objs[j]!.state = 1;
        c.objs[j]!.filterFlag = 0;
      }
    } else {
      // levelIdx variabile + threshold sign-bit edge (0x80)
      c = randomCase({
        levelIdx: Math.floor(rng() * 6),
        gateByte: 1,
        progressByte: 0x7f,
        thresholdByte: 0x80,
      });
    }
    if (runOneCase("D", i, c)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): @ workRam[0x${f.offset.toString(16)}] ` +
        `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
