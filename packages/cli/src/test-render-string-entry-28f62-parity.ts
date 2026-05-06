#!/usr/bin/env node
/**
 * test-render-string-entry-28f62-parity.ts — differential FUN_28F62.
 *
 * FUN_28F62 (62 byte): variante a 3 args di FUN_28FDE. Aggiorna i byte testa
 * di una string-chain entry fissa @ 0x40041C (col, tickOff, marker=0), poi
 * chiama renderStringChain @ FUN_2572 con (0x40041C, attr) — attr letto da
 * arg3 del caller (vs 0x3400 cabled in FUN_28FDE).
 *
 * Strategia stub injection (identica a 28FDE):
 *   - FUN_2572 (renderStringChain) viene patchata a `rts` (4E 75) → no-op.
 *     Confronta solo i 3 byte di entry scritti da FUN_255A (inline-replicato
 *     in TS).
 *   - FUN_255A NON va patchata: è il "core" di FUN_28F62.
 *   - La regione workRam[0x418..0x428] viene confrontata byte per byte; con
 *     renderStringChain patchata a rts, l'unica diff possibile è nei 3 byte
 *     target (entry+0/+1/+6) → quello che vogliamo testare.
 *
 * Suite testate (4 × 125 = 500 casi):
 *   - A: arg1/arg2/arg3 random long, entry pre-fill random
 *   - B: arg1/arg2 byte forzato a 0 (verifica clear su +0/+1)
 *   - C: arg1/arg2 byte = 0xFF (verifica saturazione su +0/+1)
 *   - D: marker pre-set a tutti i 256 valori ciclati (stress clear @ +6)
 *
 * Confronto: workRam @ 0x400418..0x400427 (16 byte attorno all'entry).
 *
 * Uso: npx tsx packages/cli/src/test-render-string-entry-28f62-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  renderStringEntry28F62 as f62Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_28F62 = 0x00028f62;
const FUN_2572 = 0x00002572;

/** Patch FUN_2572 (renderStringChain) a `rts` (0x4E75) per stub no-op. */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_2572 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_2572 + 1, 1, 0x75);
}

/** Range workRam confrontato (entry @ 0x40041C, 16 byte attorno per safety). */
const COMPARE_BASE = 0x00400418;
const COMPARE_SIZE = 0x10; // 0x400418..0x400427
const COMPARE_BASE_OFF = COMPARE_BASE - 0x00400000; // 0x418

/** Offset dell'entry rispetto a COMPARE_BASE. */
const ENTRY_OFF_IN_REGION = 0x40041c - COMPARE_BASE; // 0x4

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Setup entry region in entrambi binario e TS state. */
function setupRegion(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, COMPARE_BASE + i, 1, v);
    state.workRam[COMPARE_BASE_OFF + i] = v;
  }
}

/** Compare region after run. Returns first diff or null. */
function compareRegion(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const b = peekMem(cpu, COMPARE_BASE + i, 1);
    const t = state.workRam[COMPARE_BASE_OFF + i] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t };
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
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchSubs(cpu);

  // Stub TS: no-op (la sub-call non viene confrontata).
  const subs: f62Ns.RenderStringEntry28F62Subs = {
    renderStringChain: (_addr: number, _attr: number): void => {},
  };

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    offset: number;
    bin: number;
    ts: number;
    arg1: number;
    arg2: number;
    arg3: number;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    bytesSetup: () => number[],
    arg1: number,
    arg2: number,
    arg3: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    const bytes = bytesSetup();
    setupRegion(stateInst, cpu, bytes);

    callFunction(cpu, FUN_28F62, [arg1 >>> 0, arg2 >>> 0, arg3 >>> 0]);
    f62Ns.renderStringEntry28F62(stateInst, arg1 >>> 0, arg2 >>> 0, arg3 >>> 0, subs);

    const fail = compareRegion(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        offset: fail.offset,
        bin: fail.bin,
        ts: fail.ts,
        arg1,
        arg2,
        arg3,
      };
    }
    return false;
  }

  const rng = makeRng(0x28f62);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  // ─── Suite A: random everything ──────────────────────────────────────
  console.log(
    `\n=== renderStringEntry28F62 (FUN_28F62) — Suite A: random region & args — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    const arg1 = rl();
    const arg2 = rl();
    const arg3 = rl();
    if (runOneCase("A", i, () => bytes, arg1, arg2, arg3)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: arg1/arg2 LSB = 0 (verifica scrittura zero) ────────────
  console.log(
    `\n=== Suite B: arg1/arg2 LSB = 0x00 — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    // Pre-fill entry+0/+1 con sentinel non-zero per detect overwrite.
    bytes[ENTRY_OFF_IN_REGION + 0] = 0xaa;
    bytes[ENTRY_OFF_IN_REGION + 1] = 0xbb;
    // arg long con LSB = 0 ma upper bytes random
    const arg1 = (rl() & 0xffffff00) >>> 0;
    const arg2 = (rl() & 0xffffff00) >>> 0;
    const arg3 = rl();
    if (runOneCase("B", i, () => bytes, arg1, arg2, arg3)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: arg1/arg2 LSB = 0xFF (saturazione) ─────────────────────
  console.log(
    `\n=== Suite C: arg1/arg2 LSB = 0xFF — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    // arg long con LSB = 0xFF, upper bytes random
    const arg1 = ((rl() & 0xffffff00) | 0xff) >>> 0;
    const arg2 = ((rl() & 0xffffff00) | 0xff) >>> 0;
    const arg3 = rl();
    if (runOneCase("C", i, () => bytes, arg1, arg2, arg3)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: marker pre-set ciclato 0..255 ──────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: marker @ +6 ciclato 0..255 — ${sizeD} casi ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const bytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    // Forza marker @ entry+6 (ENTRY_OFF_IN_REGION + 6)
    bytes[ENTRY_OFF_IN_REGION + 6] = i & 0xff;
    const arg1 = rl();
    const arg2 = rl();
    const arg3 = rl();
    if (runOneCase("D", i, () => bytes, arg1, arg2, arg3)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): @ region+0x${f.offset.toString(16)} ` +
      `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)} ` +
      `args=[0x${f.arg1.toString(16)}, 0x${f.arg2.toString(16)}, 0x${f.arg3.toString(16)}]`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
