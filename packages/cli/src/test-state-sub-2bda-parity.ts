#!/usr/bin/env node
/**
 * test-state-sub-2bda-parity.ts — differential FUN_2BDA vs stateSub2BDA.
 *
 * FUN_2BDA (134 byte) è la sub "register-in-first-empty-slot" del
 * state-machine scheduler. Args: 3 long sullo stack (arg1, arg2, arg3),
 * dove arg2/arg3 sono usati solo come low-word.
 *
 * Logica:
 *   - Trova primo i in [0..3] con STATE[i] == 0
 *   - Se trovato:
 *       DATA_PTR[i] = arg1 (long)
 *       STATE[i] = 3 (byte)
 *       THRESHOLD[i] = arg3.w (word)
 *       WORD16[i] = arg2.w (word)
 *       COUNTER[i] = 0 (word)
 *       FLAG34[i] = 0 (byte)
 *       return D0 = 1
 *   - Altrimenti: return D0 = 0
 *
 * Strategia:
 *   - FUN_2BDA non chiama JSR → nessun stub injection necessario
 *   - Patch difensivo all'inizio della funzione: NON serve. Pattern di
 *     simmetria: comunque non c'è nulla da patchare (no JSR nel range).
 *   - Confronto: workRam @ 0x401F00..0x401F3F + return value D0 (byte)
 *
 * Suite testate:
 *   - A: tabella random + state random + args random (mix di slot
 *        liberi/occupati)
 *   - B: tutti slot liberi (state==0) → match slot 0 ogni volta
 *   - C: tutti slot occupati → return 0
 *   - D: solo uno slot libero a posizione random
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-2bda-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stateSub2BDA as sub2bdaNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_2BDA = 0x00002bda;

/**
 * Patch JSR-stubs. FUN_2BDA NON chiama JSR; questo helper è kept come
 * placeholder per il pattern (consistency con altre parity test).
 */
function patchSubs(_cpu: CpuSession): void {
  // No JSR in FUN_2BDA → niente da patchare.
}

const STRUCT_BASE = 0x00401f00;
const STRUCT_SIZE = 0x40; // 0x401F00..0x401F3F

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Setup struct in entrambi binario e TS state. */
function setupStruct(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  for (let i = 0; i < STRUCT_SIZE; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, STRUCT_BASE + i, 1, v);
    state.workRam[(STRUCT_BASE - 0x400000) + i] = v;
  }
}

/** Compare struct after run. Returns first diff or null. */
function compareStruct(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < STRUCT_SIZE; i++) {
    const b = peekMem(cpu, STRUCT_BASE + i, 1);
    const t = state.workRam[(STRUCT_BASE - 0x400000) + i] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t };
  }
  return null;
}

const STATE_BASE = 0x1c; // offset rispetto a STRUCT_BASE

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
  patchSubs(cpu);

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    offset: number;
    bin: number;
    ts: number;
    args: [number, number, number];
    d0Bin: number;
    d0Ts: number;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    bytesSetup: () => number[],
    args: [number, number, number],
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    const bytes = bytesSetup();
    setupStruct(stateInst, cpu, bytes);
    const r = callFunction(cpu, FUN_2BDA, [args[0], args[1], args[2]]);
    const tsRet = sub2bdaNs.stateSub2BDA(stateInst, args[0], args[1], args[2]);
    const fail = compareStruct(stateInst, cpu);
    const d0Bin = r.d0 & 0xff;
    const d0Ok = d0Bin === (tsRet & 0xff);
    if (fail === null && d0Ok) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        offset: fail !== null ? fail.offset : -1,
        bin: fail !== null ? fail.bin : d0Bin,
        ts: fail !== null ? fail.ts : tsRet & 0xff,
        args,
        d0Bin,
        d0Ts: tsRet & 0xff,
      };
    }
    return false;
  }

  const rng = makeRng(0x2bda);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  // ─── Suite A: random everything ──────────────────────────────────────
  console.log(
    `\n=== stateSub2BDA (FUN_2BDA) — Suite A: random struct & args — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const args: [number, number, number] = [rl(), rl(), rl()];
    if (runOneCase("A", i, () => bytes, args)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: tutti slot liberi (state==0 in 0x1C..0x1F) ─────────────
  console.log(`\n=== Suite B: all slots free → register slot 0 — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    bytes[STATE_BASE + 0] = 0;
    bytes[STATE_BASE + 1] = 0;
    bytes[STATE_BASE + 2] = 0;
    bytes[STATE_BASE + 3] = 0;
    const args: [number, number, number] = [rl(), rl(), rl()];
    if (runOneCase("B", i, () => bytes, args)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: tutti slot occupati (state != 0) ───────────────────────
  console.log(`\n=== Suite C: all slots busy → return 0 — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    // Force STATE[0..3] != 0
    for (let j = 0; j < 4; j++) {
      let v = rb();
      if (v === 0) v = 1;
      bytes[STATE_BASE + j] = v;
    }
    const args: [number, number, number] = [rl(), rl(), rl()];
    if (runOneCase("C", i, () => bytes, args)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: only one free slot at random position ──────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: only one free slot at random position — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const freeSlot = Math.floor(rng() * 4);
    for (let j = 0; j < 4; j++) {
      if (j === freeSlot) {
        bytes[STATE_BASE + j] = 0;
      } else {
        let v = rb();
        if (v === 0) v = 1;
        bytes[STATE_BASE + j] = v;
      }
    }
    const args: [number, number, number] = [rl(), rl(), rl()];
    if (runOneCase("D", i, () => bytes, args)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    if (f.offset === -1) {
      console.log(
        `  First fail (suite ${f.suite} tc=${f.tc}): D0 mismatch ` +
        `args=[0x${f.args[0].toString(16)}, 0x${f.args[1].toString(16)}, 0x${f.args[2].toString(16)}] ` +
        `bin=${f.d0Bin} ts=${f.d0Ts}`,
      );
    } else {
      console.log(
        `  First fail (suite ${f.suite} tc=${f.tc}): @ struct+0x${f.offset.toString(16)} ` +
        `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)} ` +
        `args=[0x${f.args[0].toString(16)}, 0x${f.args[1].toString(16)}, 0x${f.args[2].toString(16)}]`,
      );
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
