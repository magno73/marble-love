#!/usr/bin/env node
/**
 * test-render-string-chain-3662-parity.ts — differential FUN_3662 vs
 * `renderStringChain3662`.
 *
 * `FUN_00003662` (290 byte): cammina una linked list of entry-struct
 * (with the@+0, tickOff@+1, stringPtr@+2, marker@+6, nextPtr@+8), and for each
 * `(alphaPtr, 0x3c, 0)`. Advances the chain only if `marker + valF00 > 1`.
 *
 * **Strategia parity**:
 *   - Patch FUN_32BA and FUN_33F4 with stub-probes that record:
 *       byte 0 = which (0x32 per FUN_32BA, 0x33 per FUN_33F4)
 *       byte 1..4 = arg1 long (alphaPtr) big-endian
 *
 * **Stub layout** (15 byte each, gestendo both the alias):
 *
 *     20 79 00 40 10 00     movea.l (0x401000).l, A0     ; A0 = current ptr
 *     10 BC 00 XX           move.b  #0x32 (or 0x33), (A0)+ ; tag byte
 *     20 EF 00 04           move.l  (4,SP), (A0)+        ; arg1 → probe
 *     23 C8 00 40 10 00     move.l  A0, (0x401000).l     ; update ptr
 *     4E 75                 rts
 *
 *  Tag byte: 0x32 per FUN_32BA, 0x33 per FUN_33F4. Permette of distinguere
 *
 * TS side exposes subs.fun_32ba/fun_33f4: the callback performs the same write
 * (tag + alphaPtr) into the same buffer (state.workRam @ probe area).
 * PROBE_PTR_ADDR per detect call extra/mancanti).
 *
 * chain a max ~6 entry → max ~240 byte of probe per test. PROBE_DATA_END -
 * PROBE_DATA_BASE = ~3 KB, ampiamente sufficiente.
 *
 * **Suite testate**:
 *   - A: rotation = 0, single entry, string 0..30 char
 *   - B: rotation in [1..3], single entry, string varia
 *   - C: chain of 2..4 entry (marker/valF00 forzati per advance)
 *
 * Uso: npx tsx packages/cli/src/test-render-string-chain-3662-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  renderStringChain3662 as ssNs,
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

const FUN_3662 = 0x00003662;
const FUN_32BA = 0x000032ba;
const FUN_33F4 = 0x000033f4;

const WORK_RAM_BASE = 0x00400000;

// Probe area: SP=0x401F00 ⇒ stack scende up to ~0x401EE0. Probe in area
// bassa of workRam.
const PROBE_PTR_ADDR = 0x00401000;
const PROBE_DATA_BASE = 0x00401010; // dati probe
const PROBE_DATA_END = 0x00401C00; // exclusive (~3 KB → ~600 call max)

// Globals (vedi render-string-chain-3662 / string-render):
const VAL_F00_ADDR = 0x00401f00;
const TICK_ADDR = 0x00401f3a;
const ROTATION_ADDR = 0x00401f42;

const STRING_AREA_BASE = 0x00401d00;
const STRUCT_AREA_BASE = 0x00401e00; // entry structs

/** Stub bytes (22 byte) per una sub: records `tag + arg1Long` in probe area. */
function makeStubBytes(tag: number): readonly number[] {
  return [
    0x20, 0x79, 0x00, 0x40, 0x10, 0x00, // movea.l (0x401000).l, A0
    0x10, 0xfc, 0x00, tag & 0xff,       // move.b #tag, (A0)+   (size byte, immediate)
    0x20, 0xef, 0x00, 0x04,             // move.l (4,SP), (A0)+
    0x23, 0xc8, 0x00, 0x40, 0x10, 0x00, // move.l A0, (0x401000).l
    0x4e, 0x75,                          // rts
  ];
}

const STUB_32BA_BYTES = makeStubBytes(0x32);
const STUB_33F4_BYTES = makeStubBytes(0x33);

function patchStubs(cpu: CpuSession): void {
  for (let i = 0; i < STUB_32BA_BYTES.length; i++) {
    pokeMem(cpu, FUN_32BA + i, 1, STUB_32BA_BYTES[i]!);
  }
  for (let i = 0; i < STUB_33F4_BYTES.length; i++) {
    pokeMem(cpu, FUN_33F4 + i, 1, STUB_33F4_BYTES[i]!);
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

// ─── Probe helpers ───────────────────────────────────────────────────────

function resetProbe(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  // PROBE_PTR_ADDR = PROBE_DATA_BASE (long, big-endian)
  pokeMem(cpu, PROBE_PTR_ADDR, 4, PROBE_DATA_BASE);
  state.workRam[PROBE_PTR_ADDR - WORK_RAM_BASE + 0] =
    (PROBE_DATA_BASE >>> 24) & 0xff;
  state.workRam[PROBE_PTR_ADDR - WORK_RAM_BASE + 1] =
    (PROBE_DATA_BASE >>> 16) & 0xff;
  state.workRam[PROBE_PTR_ADDR - WORK_RAM_BASE + 2] =
    (PROBE_DATA_BASE >>> 8) & 0xff;
  state.workRam[PROBE_PTR_ADDR - WORK_RAM_BASE + 3] = PROBE_DATA_BASE & 0xff;

  // Clear data area (both)
  for (let a = PROBE_DATA_BASE; a < PROBE_DATA_END; a++) {
    pokeMem(cpu, a, 1, 0);
    state.workRam[a - WORK_RAM_BASE] = 0;
  }
}

function compareProbe(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < 4; i++) {
    const off = PROBE_PTR_ADDR - WORK_RAM_BASE + i;
    const b = peekMem(cpu, PROBE_PTR_ADDR + i, 1);
    const t = state.workRam[off] ?? 0;
    if (b !== t) return { offset: PROBE_PTR_ADDR + i, bin: b, ts: t };
  }
  // Then the contents.
  for (let a = PROBE_DATA_BASE; a < PROBE_DATA_END; a++) {
    const b = peekMem(cpu, a, 1);
    const t = state.workRam[a - WORK_RAM_BASE] ?? 0;
    if (b !== t) return { offset: a, bin: b, ts: t };
  }
  return null;
}

function makeTsSubs(
  state: ReturnType<typeof stateNs.emptyGameState>,
): ssNs.RenderStringChain3662Subs {
  function record(tag: number, alphaPtr: number): void {
    const wOff = PROBE_PTR_ADDR - WORK_RAM_BASE;
    const cur =
      (((state.workRam[wOff] ?? 0) << 24) |
        ((state.workRam[wOff + 1] ?? 0) << 16) |
        ((state.workRam[wOff + 2] ?? 0) << 8) |
        (state.workRam[wOff + 3] ?? 0)) >>>
      0;
    const dst = cur - WORK_RAM_BASE;
    if (dst < 0 || dst >= state.workRam.length - 5) return;
    state.workRam[dst + 0] = tag & 0xff;
    state.workRam[dst + 1] = (alphaPtr >>> 24) & 0xff;
    state.workRam[dst + 2] = (alphaPtr >>> 16) & 0xff;
    state.workRam[dst + 3] = (alphaPtr >>> 8) & 0xff;
    state.workRam[dst + 4] = alphaPtr & 0xff;
    const next = (cur + 5) >>> 0;
    state.workRam[wOff + 0] = (next >>> 24) & 0xff;
    state.workRam[wOff + 1] = (next >>> 16) & 0xff;
    state.workRam[wOff + 2] = (next >>> 8) & 0xff;
    state.workRam[wOff + 3] = next & 0xff;
  }
  return {
    fun_32ba: ({ alphaPtr }) => record(0x32, alphaPtr),
    fun_33f4: ({ alphaPtr }) => record(0x33, alphaPtr),
  };
}

// ─── Test case primitives ────────────────────────────────────────────────

interface ChainEntry {
  col: number; // byte
  tickOff: number; // byte
  stringBytes: number[]; // ASCII bytes including 0 terminator
  marker: number; // byte (signed)
  // nextPtr derived from entryIdx+1 (last entry: marker that stops the loop).
}

interface TestCase {
  rotation: number;
  tick: number; // word @ 0x401F3A
  valF00: number; // word @ 0x401F00 (signed)
  entries: ChainEntry[]; // chain (>= 1)
}

function setupCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  tc: TestCase,
): number /* structAddr of entry[0] */ {
  // Reset workRam area "globals" and area structs/string
  for (let a = 0x1f00; a < 0x1f80; a++) {
    pokeMem(cpu, WORK_RAM_BASE + a, 1, 0);
    state.workRam[a] = 0;
  }
  for (let a = STRING_AREA_BASE; a < STRING_AREA_BASE + 0x100; a++) {
    pokeMem(cpu, a, 1, 0);
    state.workRam[a - WORK_RAM_BASE] = 0;
  }
  for (let a = STRUCT_AREA_BASE; a < STRUCT_AREA_BASE + 0x100; a++) {
    pokeMem(cpu, a, 1, 0);
    state.workRam[a - WORK_RAM_BASE] = 0;
  }

  // Globals
  pokeMem(cpu, VAL_F00_ADDR, 2, tc.valF00 & 0xffff);
  state.workRam[0x1f00] = (tc.valF00 >>> 8) & 0xff;
  state.workRam[0x1f01] = tc.valF00 & 0xff;
  pokeMem(cpu, TICK_ADDR, 2, tc.tick & 0xffff);
  state.workRam[0x1f3a] = (tc.tick >>> 8) & 0xff;
  state.workRam[0x1f3b] = tc.tick & 0xff;
  pokeMem(cpu, ROTATION_ADDR, 2, tc.rotation & 0xffff);
  state.workRam[0x1f42] = (tc.rotation >>> 8) & 0xff;
  state.workRam[0x1f43] = tc.rotation & 0xff;

  // Place entries: each struct is 12 byte (with the@+0, tickOff@+1, stringPtr@+2,
  // marker@+6, [pad@+7], nextPtr@+8). Sequential @ STRUCT_AREA_BASE.
  // Place strings: sequential @ STRING_AREA_BASE.
  let stringCur = STRING_AREA_BASE;
  let structCur = STRUCT_AREA_BASE;
  const structAddrs: number[] = [];
  for (let i = 0; i < tc.entries.length; i++) {
    structAddrs.push(structCur);
    structCur += 12;
  }

  for (let i = 0; i < tc.entries.length; i++) {
    const e = tc.entries[i]!;
    const stringPtr = stringCur;
    // Write string
    for (let j = 0; j < e.stringBytes.length; j++) {
      pokeMem(cpu, stringPtr + j, 1, e.stringBytes[j]!);
      state.workRam[stringPtr + j - WORK_RAM_BASE] = e.stringBytes[j]!;
    }
    stringCur += e.stringBytes.length;

    // Write struct
    const sAddr = structAddrs[i]!;
    pokeMem(cpu, sAddr + 0, 1, e.col & 0xff);
    pokeMem(cpu, sAddr + 1, 1, e.tickOff & 0xff);
    pokeMem(cpu, sAddr + 2, 4, stringPtr);
    pokeMem(cpu, sAddr + 6, 1, e.marker & 0xff);
    pokeMem(cpu, sAddr + 7, 1, 0);
    const nextPtr =
      i + 1 < tc.entries.length ? structAddrs[i + 1]! : 0;
    pokeMem(cpu, sAddr + 8, 4, nextPtr);

    state.workRam[sAddr - WORK_RAM_BASE + 0] = e.col & 0xff;
    state.workRam[sAddr - WORK_RAM_BASE + 1] = e.tickOff & 0xff;
    state.workRam[sAddr - WORK_RAM_BASE + 2] = (stringPtr >>> 24) & 0xff;
    state.workRam[sAddr - WORK_RAM_BASE + 3] = (stringPtr >>> 16) & 0xff;
    state.workRam[sAddr - WORK_RAM_BASE + 4] = (stringPtr >>> 8) & 0xff;
    state.workRam[sAddr - WORK_RAM_BASE + 5] = stringPtr & 0xff;
    state.workRam[sAddr - WORK_RAM_BASE + 6] = e.marker & 0xff;
    state.workRam[sAddr - WORK_RAM_BASE + 7] = 0;
    state.workRam[sAddr - WORK_RAM_BASE + 8] = (nextPtr >>> 24) & 0xff;
    state.workRam[sAddr - WORK_RAM_BASE + 9] = (nextPtr >>> 16) & 0xff;
    state.workRam[sAddr - WORK_RAM_BASE + 10] = (nextPtr >>> 8) & 0xff;
    state.workRam[sAddr - WORK_RAM_BASE + 11] = nextPtr & 0xff;
  }

  return structAddrs[0]!;
}

// ─── Test case generators ────────────────────────────────────────────────

function makeRandomString(rng: () => number, len: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < len; i++) {
    // ASCII printable, escludendo 0 (terminator)
    arr.push(0x20 + Math.floor(rng() * 0x40));
  }
  arr.push(0);
  return arr;
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
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchStubs(cpu);

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  const tsSubs = makeTsSubs(stateInst);

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    detail: string;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tcIdx: number, tc: TestCase): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    const structAddr = setupCase(stateInst, cpu, tc);
    resetProbe(stateInst, cpu);

    // Run binary
    const binResult = callFunction(cpu, FUN_3662, [structAddr, 0]);

    // record subs.
    const tsRet = ssNs.renderStringChain3662(
      stateInst,
      tsRom,
      structAddr,
      0,
      tsSubs,
    );

    if ((binResult.d0 & 0xffffffff) !== (tsRet & 0xffffffff)) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc: tcIdx,
          detail: `D0 mismatch: bin=0x${(binResult.d0 >>> 0).toString(16)} ts=0x${(tsRet >>> 0).toString(16)}`,
        };
      }
      return false;
    }

    const diff = compareProbe(stateInst, cpu);
    if (diff !== null) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc: tcIdx,
          detail: `probe@0x${diff.offset.toString(16)} bin=0x${diff.bin.toString(16)} ts=0x${diff.ts.toString(16)} (rot=${tc.rotation} tick=${tc.tick} valF00=${tc.valF00} entries=${tc.entries.length})`,
        };
      }
      return false;
    }
    return true;
  }

  const rng = makeRng(0x36620000);

  // ─── Suite A: rotation = 0, single entry ─────────────────────────────
  console.log(
    `\n=== renderStringChain3662 (FUN_3662) — Suite A: rot=0 single entry — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const strLen = Math.floor(rng() * 30); // 0..29 char
    const tc: TestCase = {
      rotation: 0,
      tick: 0,
      valF00: 0,
      entries: [
        {
          col: Math.floor(rng() * 8), // small with the (0..7) per evitare overflow shift
          tickOff: 0, // diff = 0 ≤ lookup → render
          stringBytes: makeRandomString(rng, strLen),
          marker: 0,
        },
      ],
    };
    if (runOneCase("A", i, tc)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: rotation in [1..3], single entry ──────────────────────
  console.log(
    `\n=== Suite B: rotation in [1..3], single entry — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const rot = 1 + Math.floor(rng() * 3); // 1..3
    const strLen = Math.floor(rng() * 25);
    const tc: TestCase = {
      rotation: rot,
      tick: 0,
      valF00: 0,
      entries: [
        {
          col: Math.floor(rng() * 4),
          tickOff: 0, // diff = 0 ≤ lookup[rot]
          stringBytes: makeRandomString(rng, strLen),
          marker: 0,
        },
      ],
    };
    if (runOneCase("B", i, tc)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: chain of 2..4 entry (advance via marker+valF00) ────────
  console.log(
    `\n=== Suite C: chain 2..4 entry, marker advance — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const numEntries = 2 + Math.floor(rng() * 3); // 2..4
    const valF00 = 5; // signed positivo, abbastanza grande per "marker=0+valF00=5>1"
    const entries: ChainEntry[] = [];
    for (let j = 0; j < numEntries; j++) {
      // Tutte le entry tranne the ultima hanno marker=0 → sum=valF00=5 > 1 → advance.
      // L'ultima ha marker negativo grande → sum ≤ 1 → exit.
      const isLast = j === numEntries - 1;
      entries.push({
        col: Math.floor(rng() * 4),
        tickOff: 0,
        stringBytes: makeRandomString(rng, Math.floor(rng() * 10)),
        marker: isLast ? 0x80 : 0, // -128 signed per ultima
      });
    }
    const tc: TestCase = {
      rotation: Math.floor(rng() * 2), // 0 o 1
      tick: 0,
      valF00,
      entries,
    };
    if (runOneCase("C", i, tc)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: tickOff > lookup → skip render path; chain prosegue ───
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: tickOff > lookup (skip render) + chain advance — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    // sext'd > -1, i.e. per qualsiasi tickOff != 0xFF.
    // Mix high and low tickOff values to cover render and skip paths.
    const rot = 2; // skip-friendly
    const numEntries = 2 + Math.floor(rng() * 2); // 2..3
    const entries: ChainEntry[] = [];
    for (let j = 0; j < numEntries; j++) {
      const isLast = j === numEntries - 1;
      entries.push({
        col: Math.floor(rng() * 4),
        // tickOff random: signed [-128..127]. If >= 0 → diff > -1 → skip render.
        tickOff: Math.floor(rng() * 256),
        stringBytes: makeRandomString(rng, Math.floor(rng() * 8)),
        marker: isLast ? 0x80 : 0,
      });
    }
    const tc: TestCase = {
      rotation: rot,
      tick: 0,
      valF00: 5,
      entries,
    };
    if (runOneCase("D", i, tc)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    console.log(
      `  First fail (suite ${failHolder.value.suite} tc=${failHolder.value.tc}): ${failHolder.value.detail}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
