#!/usr/bin/env node
/**
 * test-score-table-update-4790-parity.ts — differential FUN_4790 vs
 * `scoreTableUpdate4790`.
 *
 * `FUN_00004790` (1178 byte): score table updater.
 *
 * **Strategia stub**:
 *   - FUN_43D6 (timerDeltaAccumulate) patched con stub:
 *       `move.l #0x00401F86, D0` ; `rts`
 *     Il valore ritornato (A2) e' 0x401F86, dove abbiamo gia' scritto i due
 *     long accumulatori. La funzione non riscrive nulla, cosi' TS e binario
 *     vedono gli stessi valori.
 *   - FUN_5236 (setFlagBit) patched con: `rts`
 *   - FUN_4442 (sound dispatcher) patched con: `moveq #0, D0` ; `rts`
 *
 * **Confronto**:
 *   - Tutti i byte @ base..base+numRec*20-1 (tabella score, 60 byte)
 *   - Long @ 0x401F92 (score accumulatore)
 *
 * **Setup per ogni caso random**:
 *   - *0x401FFC = PTR_ABS (0x401A00, struct base)
 *   - 60 byte random @ base+0..+59 (score table 3 record × 20 byte)
 *   - Long @ 0x401F86 = delta1 random (timer accumulator 1)
 *   - Long @ 0x401F8A = delta2 random (timer accumulator 2)
 *   - Long @ 0x401F92 = scoreAccum random
 *   - 7 long args sullo stack (arg1..arg7)
 *
 * **Pattern coverage** (5 suite × 100 = 500 casi):
 *   A. delta1=0, delta2=0 → nessuna modifica tabella
 *   B. delta1>0, delta2=0 → solo prima entry
 *   C. delta1=0, delta2>0 → solo seconda entry
 *   D. entrambi >0        → entrambe le entry
 *   E. fully random       → stress generale
 *
 * Uso: npx tsx packages/cli/src/test-score-table-update-4790-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  scoreTableUpdate4790 as stuNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_4790 = 0x00004790;
const FUN_43D6 = 0x000043d6;
const FUN_5236 = 0x00005236;
const FUN_4442 = 0x00004442;

const PTR_FFC  = 0x00401ffc;
const PTR_ABS  = 0x00401a00;
const BASE_ABS = PTR_ABS + 0x50;           // 0x401A50
const BASE_OFF = BASE_ABS - 0x400000;      // 0x1A50
const A2_ABS   = 0x00401f86;               // timerDelta returns ptr here
const A2_OFF   = A2_ABS - 0x400000;        // 0x1F86
const SC_ABS   = 0x00401f92;               // score accum addr
const SC_OFF   = SC_ABS - 0x400000;        // 0x1F92

/** Numero di record (romByte 0xE3 → 0xE3 & 7 = 3). */
const NUM_REC = 3;
const TABLE_LEN = NUM_REC * 20; // 60 byte

/**
 * Stub FUN_43D6:
 *   move.l #0x00401F86, D0  (opcode: 20 7C 00 40 1F 86)
 *   rts                     (opcode: 4E 75)
 */
const STUB_43D6 = [0x20, 0x7c, 0x00, 0x40, 0x1f, 0x86, 0x4e, 0x75] as const;

/** Stub FUN_5236: rts (4E 75). */
const STUB_5236 = [0x4e, 0x75] as const;

/** Stub FUN_4442: moveq #0,D0 (70 00); rts (4E 75). */
const STUB_4442 = [0x70, 0x00, 0x4e, 0x75] as const;

// ─── RNG ─────────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}
function ri(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

// ─── Memory helpers ───────────────────────────────────────────────────────────

function pokeLong4(cpu: CpuSession, abs: number, v: number): void {
  const u = v >>> 0;
  pokeMem(cpu, abs + 0, 1, (u >>> 24) & 0xff);
  pokeMem(cpu, abs + 1, 1, (u >>> 16) & 0xff);
  pokeMem(cpu, abs + 2, 1, (u >>> 8) & 0xff);
  pokeMem(cpu, abs + 3, 1, u & 0xff);
}

function writeLong4(r: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  r[off + 0] = (u >>> 24) & 0xff;
  r[off + 1] = (u >>> 16) & 0xff;
  r[off + 2] = (u >>> 8) & 0xff;
  r[off + 3] = u & 0xff;
}

function readLong4(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>> 0
  );
}

// ─── Setup common state ──────────────────────────────────────────────────────

function setupState(
  cpu: CpuSession,
  wram: Uint8Array,
  tableBytes: readonly number[],
  delta1: number,
  delta2: number,
  scoreAccum0: number,
): void {
  // *0x401FFC = PTR_ABS
  pokeLong4(cpu, PTR_FFC, PTR_ABS);
  writeLong4(wram, PTR_FFC - 0x400000, PTR_ABS);

  // Score table
  for (let i = 0; i < TABLE_LEN; i++) {
    const b = (tableBytes[i] ?? 0) & 0xff;
    pokeMem(cpu, BASE_ABS + i, 1, b);
    wram[BASE_OFF + i] = b;
  }

  // Timer accumulators (A2 area = 0x401F86..0x401F8D)
  pokeLong4(cpu, A2_ABS + 0, delta1);
  writeLong4(wram, A2_OFF + 0, delta1);
  pokeLong4(cpu, A2_ABS + 4, delta2);
  writeLong4(wram, A2_OFF + 4, delta2);

  // Score accum
  pokeLong4(cpu, SC_ABS, scoreAccum0);
  writeLong4(wram, SC_OFF, scoreAccum0);

  // Zero out timer prev @ 0x401F82 (4 byte) so timerDelta stub is consistent
  pokeLong4(cpu, 0x00401f82, 0);
  writeLong4(wram, 0x1f82, 0);
  pokeMem(cpu, 0x00401f81, 1, 0);
  wram[0x1f81] = 0;
}

// ─── Fail record ─────────────────────────────────────────────────────────────

interface FailRecord {
  suite: string;
  tc: number;
  args: readonly number[];
  delta1: number;
  delta2: number;
  scoreAccum0: number;
  binTable: number[];
  tsTable: number[];
  binSc: number;
  tsSc: number;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 5);
  const remainder = total - perSuite * 5;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  // ── Patch stubs ──────────────────────────────────────────────────────────
  for (let i = 0; i < STUB_43D6.length; i++) pokeMem(cpu, FUN_43D6 + i, 1, STUB_43D6[i]!);
  for (let i = 0; i < STUB_5236.length; i++) pokeMem(cpu, FUN_5236 + i, 1, STUB_5236[i]!);
  for (let i = 0; i < STUB_4442.length; i++) pokeMem(cpu, FUN_4442 + i, 1, STUB_4442[i]!);

  // Leggi ROM bytes usati dalla funzione
  const romByte1006F = peekMem(cpu, 0x0001006f, 1) & 0xff;
  const romTable7974: [number, number, number, number] = [
    peekMem(cpu, 0x00007974 + 0, 1) & 0xff,
    peekMem(cpu, 0x00007974 + 1, 1) & 0xff,
    peekMem(cpu, 0x00007974 + 2, 1) & 0xff,
    peekMem(cpu, 0x00007974 + 3, 1) & 0xff,
  ];

  console.log(`\nROM[0x1006F]=0x${romByte1006F.toString(16)}, ROM[0x7974..]=` +
    `[${romTable7974.map((b) => "0x" + b.toString(16)).join(",")}]`);
  console.log(`Stubs: FUN_43D6→move.l #401F86,D0+rts  FUN_5236→rts  FUN_4442→moveq#0+rts`);

  const rng = makeRng(0x4790_1234);
  const failHolder: { value: FailRecord | null } = { value: null };
  let totalOk = 0;

  function runOne(
    suite: string,
    tc: number,
    arg1: number, arg2: number, arg3: number, arg4: number,
    arg5: number, arg6: number, arg7: number,
    delta1: number, delta2: number, scoreAccum0: number,
    tableBytes: readonly number[],
  ): boolean {
    const args = [arg1, arg2, arg3, arg4, arg5, arg6, arg7] as const;

    // Setup entrambi
    setupState(cpu, state.workRam, tableBytes, delta1, delta2, scoreAccum0);

    // ── Binario ──────────────────────────────────────────────────────────
    cpu.system.setRegister("sp", 0x401f00);
    callFunction(cpu, FUN_4790, [...args], 300_000);
    const binTable: number[] = [];
    for (let i = 0; i < TABLE_LEN; i++) binTable.push(peekMem(cpu, BASE_ABS + i, 1) & 0xff);
    const binSc = peekMem(cpu, SC_ABS, 4) >>> 0;

    // ── Ripristina workRam per TS (setup di nuovo con stessi valori) ─────
    setupState(cpu, state.workRam, tableBytes, delta1, delta2, scoreAccum0);
    // (pokeLong4 scrive sia cpu che state.workRam tramite setupState;
    //  ma le scritture del binario su cpu sono gia' avvenute — riscriviamo
    //  solo state.workRam manualmente)
    const r = state.workRam;
    writeLong4(r, PTR_FFC - 0x400000, PTR_ABS);
    for (let i = 0; i < TABLE_LEN; i++) r[BASE_OFF + i] = (tableBytes[i] ?? 0) & 0xff;
    writeLong4(r, A2_OFF + 0, delta1);
    writeLong4(r, A2_OFF + 4, delta2);
    writeLong4(r, SC_OFF, scoreAccum0);

    // ── TS ───────────────────────────────────────────────────────────────
    stuNs.scoreTableUpdate4790(
      state, arg1, arg2, arg3, arg4, arg5, arg6, arg7,
      {
        romByte1006F,
        romTable7974,
        soundDispatch: () => 0,
        fieldFetch40D8: () => 0,
      },
    );
    const tsTable: number[] = [];
    for (let i = 0; i < TABLE_LEN; i++) tsTable.push((r[BASE_OFF + i] ?? 0) & 0xff);
    const tsSc = readLong4(r, SC_OFF);

    // ── Confronta ────────────────────────────────────────────────────────
    const tableMatch = binTable.every((b, i) => b === tsTable[i]);
    const scMatch = binSc === tsSc;
    const match = tableMatch && scMatch;

    if (!match && failHolder.value === null) {
      failHolder.value = { suite, tc, args, delta1, delta2, scoreAccum0,
                           binTable, tsTable, binSc, tsSc };
    }
    return match;
  }

  // ── Suite A: delta1=0, delta2=0 ───────────────────────────────────────
  console.log(`\n=== Suite A: delta1=0, delta2=0 — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const tb = Array.from({ length: TABLE_LEN }, () => ri(rng, 256));
    const [a1, a2, a3, a4] = [ri(rng, 0x10000), ri(rng, NUM_REC),
                               ri(rng, 0x10000), ri(rng, NUM_REC)];
    if (runOne("A", i, a1!, a2!, a3!, a4!, 0, 0, 0, 0, 0, 0, tb)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA/perSuite)*100).toFixed(1)}%`);
  totalOk += okA;

  // ── Suite B: delta1>0, delta2=0 ───────────────────────────────────────
  console.log(`\n=== Suite B: delta1>0, delta2=0 — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const tb = Array.from({ length: TABLE_LEN }, () => ri(rng, 200));
    const [a1, a2, a3, a4] = [ri(rng, 0x10000), ri(rng, NUM_REC),
                               ri(rng, 0x10000), ri(rng, NUM_REC)];
    const d1 = ri(rng, 9999) + 1;
    if (runOne("B", i, a1!, a2!, a3!, a4!, 0, 0, 0, d1, 0, 0, tb)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB/perSuite)*100).toFixed(1)}%`);
  totalOk += okB;

  // ── Suite C: delta1=0, delta2>0 ───────────────────────────────────────
  console.log(`\n=== Suite C: delta1=0, delta2>0 — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const tb = Array.from({ length: TABLE_LEN }, () => ri(rng, 200));
    const [a1, a2, a3, a4] = [ri(rng, 0x10000), ri(rng, NUM_REC),
                               ri(rng, 0x10000), ri(rng, NUM_REC)];
    const d2 = ri(rng, 9999) + 1;
    const sc = ri(rng, 3600);
    if (runOne("C", i, a1!, a2!, a3!, a4!, 0, 0, 0, 0, d2, sc, tb)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC/perSuite)*100).toFixed(1)}%`);
  totalOk += okC;

  // ── Suite D: entrambi >0 ──────────────────────────────────────────────
  console.log(`\n=== Suite D: delta1>0 e delta2>0 — ${perSuite} casi ===`);
  let okD = 0;
  for (let i = 0; i < perSuite; i++) {
    const tb = Array.from({ length: TABLE_LEN }, () => ri(rng, 200));
    const [a1, a2, a3, a4] = [ri(rng, 0x8000), ri(rng, NUM_REC),
                               ri(rng, 0x8000), ri(rng, NUM_REC)];
    const d1 = ri(rng, 5000) + 1;
    const d2 = ri(rng, 5000) + 1;
    const sc = ri(rng, 3600);
    if (runOne("D", i, a1!, a2!, a3!, a4!, 0, 0, 0, d1, d2, sc, tb)) okD++;
  }
  console.log(`  Match: ${okD}/${perSuite} = ${((okD/perSuite)*100).toFixed(1)}%`);
  totalOk += okD;

  // ── Suite E: fully random ─────────────────────────────────────────────
  const sizeE = perSuite + remainder;
  console.log(`\n=== Suite E: fully random — ${sizeE} casi ===`);
  let okE = 0;
  for (let i = 0; i < sizeE; i++) {
    const tb = Array.from({ length: TABLE_LEN }, () => ri(rng, 256));
    const a1 = ((ri(rng, 0x10000) << 16) | ri(rng, 0x10000)) >>> 0;
    const a2 = ri(rng, 8);
    const a3 = ((ri(rng, 0x10000) << 16) | ri(rng, 0x10000)) >>> 0;
    const a4 = ri(rng, 8);
    const a5 = ri(rng, 2) ? ri(rng, 0x1000) : 0;
    const a6 = ri(rng, 2) ? ri(rng, 0x1000) : 0;
    const a7 = ri(rng, 2) ? ri(rng, 0x1000) : 0;
    const d1 = ri(rng, 2) ? ri(rng, 100000) : 0;
    const d2 = ri(rng, 2) ? ri(rng, 100000) : 0;
    const sc = ri(rng, 10000);
    if (runOne("E", i, a1, a2, a3, a4, a5, a6, a7, d1, d2, sc, tb)) okE++;
  }
  console.log(`  Match: ${okE}/${sizeE} = ${((okE/sizeE)*100).toFixed(1)}%`);
  totalOk += okE;

  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk/total)*100).toFixed(1)}% ===`);

  if (failHolder.value) {
    const f = failHolder.value;
    console.log(`\n  First fail (suite ${f.suite} tc=${f.tc}):`);
    console.log(`    args=[${f.args.map((a) => "0x" + (a >>> 0).toString(16)).join(",")}]`);
    console.log(`    delta1=0x${f.delta1.toString(16)} delta2=0x${f.delta2.toString(16)}`);
    console.log(`    scoreAccum0=0x${f.scoreAccum0.toString(16)}`);
    console.log(`    binSc=0x${f.binSc.toString(16)} tsSc=0x${f.tsSc.toString(16)}`);
    console.log("    table diff:");
    for (let row = 0; row < NUM_REC; row++) {
      const binRow = f.binTable.slice(row * 20, row * 20 + 20)
        .map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const tsRow = f.tsTable.slice(row * 20, row * 20 + 20)
        .map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const mark = binRow === tsRow ? "ok" : "!!";
      console.log(`      [${row}] ${mark}  bin=${binRow}`);
      if (binRow !== tsRow) console.log(`             ts =${tsRow}`);
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
