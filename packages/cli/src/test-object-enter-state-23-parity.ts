#!/usr/bin/env node
/**
 * test-object-enter-state-23-parity.ts — differential FUN_160D4 vs
 * objectEnterState23.
 *
 * `FUN_000160D4` (34 byte) è il wrapper "enter state 0x23" chiamato da
 * FUN_158F6, FUN_15E24 e FUN_1BC88 con un puntatore oggetto pushato come
 * long sullo stack. La sub:
 *   1. Imposta `obj[0x1A] = 0x23`
 *   2. Chiama FUN_15D10 (helper non modellato qui)
 *   3. Imposta `obj[0x68..0x6B] = 0x00070000` (long big-endian)
 *
 * **Strategia parity**: patchamo FUN_15D10 a `rts` (4E 75) per isolare le
 * scritture dirette di FUN_160D4. Confrontiamo SOLO i byte effettivamente
 * scritti dalla sub stessa: `obj[0x1A]` e `obj[0x68..0x6B]`.
 *
 * Setup per ogni caso random:
 *   - `objPtr` random in {0x401C00, 0x401D00, 0x401D80, 0x401E00, 0x401E80}
 *   - byte di stato pre-chiamata @ +0x1A: random (incluso 0x21, 0x22, 0x24
 *     che sono i tre stati "pre-23" attestati nei caller)
 *   - long timer pre-chiamata @ +0x68: random
 *   - bytes "vicini" (0x19, 0x1B, 0x67, 0x6C) random per verificare che
 *     non vengano sporcati
 *
 * Suite testate:
 *   - A: random everything
 *   - B: stato pre = 0x21 / 0x22 / 0x24 (transizioni note dei caller)
 *   - C: timer pre = 0x00070000 (idempotenza)
 *   - D: byte di stato pre = 0x23 (chiamata su oggetto già in stato target)
 *
 * Uso: npx tsx packages/cli/src/test-object-enter-state-23-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  objectEnterState23 as oes23Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_160D4 = 0x000160d4;
const FUN_15D10 = 0x00015d10;

// Pointer candidates: tutti `>= 0x401000` (in work RAM 8 KB) e tali che
// `ptr + 0x80 <= 0x401E80` per non overlappare con la zona di stack che
// va da SP=0x401F00 verso il basso (push di sentinel + arg + saved A2 +
// arg di FUN_15D10 ≈ 16 byte, ma teniamo margine generoso).
const PTR_CANDIDATES = [
  0x00401000, 0x00401100, 0x00401400, 0x00401800, 0x00401c00,
] as const;

/** Patch FUN_15D10 a `rts` (4E 75) per neutralizzare l'helper interno. */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_15D10 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_15D10 + 1, 1, 0x75);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  suite: string;
  tc: number;
  ptr: number;
  detail: string;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  // 4 suite, dividiamo equamente con resto in suite D.
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

  console.log(`\n=== objectEnterState23 (FUN_160D4) — ${total} casi ===`);
  console.log(`  (FUN_15D10 @ 0x${FUN_15D10.toString(16)} patched → rts)`);

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    ptr: number,
    preStateByte: number,
    preTimerLong: number,
    neighborByte19: number,
    neighborByte1B: number,
    neighborByte67: number,
    neighborByte6C: number,
  ): boolean {
    // Reset SP per ogni caso.
    cpu.system.setRegister("sp", 0x401f00);

    const off = ptr - 0x400000;

    // ─── Setup binary side ───────────────────────────────────────────────
    // Reset zona obj (0x80 byte) per pulizia
    for (let k = 0; k < 0x80; k++) {
      pokeMem(cpu, ptr + k, 1, 0);
      stateInst.workRam[off + k] = 0;
    }
    // Stato byte pre @ +0x1A
    pokeMem(cpu, ptr + 0x1a, 1, preStateByte);
    stateInst.workRam[off + 0x1a] = preStateByte;
    // Timer long pre @ +0x68 (big-endian)
    pokeMem(cpu, ptr + 0x68, 4, preTimerLong);
    stateInst.workRam[off + 0x68] = (preTimerLong >>> 24) & 0xff;
    stateInst.workRam[off + 0x69] = (preTimerLong >>> 16) & 0xff;
    stateInst.workRam[off + 0x6a] = (preTimerLong >>> 8) & 0xff;
    stateInst.workRam[off + 0x6b] = preTimerLong & 0xff;
    // Vicini "non toccati": +0x19, +0x1B, +0x67, +0x6C
    pokeMem(cpu, ptr + 0x19, 1, neighborByte19);
    stateInst.workRam[off + 0x19] = neighborByte19;
    pokeMem(cpu, ptr + 0x1b, 1, neighborByte1B);
    stateInst.workRam[off + 0x1b] = neighborByte1B;
    pokeMem(cpu, ptr + 0x67, 1, neighborByte67);
    stateInst.workRam[off + 0x67] = neighborByte67;
    pokeMem(cpu, ptr + 0x6c, 1, neighborByte6C);
    stateInst.workRam[off + 0x6c] = neighborByte6C;

    // ─── Run binary ──────────────────────────────────────────────────────
    callFunction(cpu, FUN_160D4, [ptr]);
    const binState = peekMem(cpu, ptr + 0x1a, 1) & 0xff;
    const binTimer = peekMem(cpu, ptr + 0x68, 4) >>> 0;
    const binN19 = peekMem(cpu, ptr + 0x19, 1) & 0xff;
    const binN1B = peekMem(cpu, ptr + 0x1b, 1) & 0xff;
    const binN67 = peekMem(cpu, ptr + 0x67, 1) & 0xff;
    const binN6C = peekMem(cpu, ptr + 0x6c, 1) & 0xff;

    // ─── Run TS ──────────────────────────────────────────────────────────
    oes23Ns.objectEnterState23(stateInst, ptr);
    const tsState = stateInst.workRam[off + 0x1a] ?? 0;
    const tsTimer =
      (((stateInst.workRam[off + 0x68] ?? 0) << 24) |
        ((stateInst.workRam[off + 0x69] ?? 0) << 16) |
        ((stateInst.workRam[off + 0x6a] ?? 0) << 8) |
        (stateInst.workRam[off + 0x6b] ?? 0)) >>>
      0;
    const tsN19 = stateInst.workRam[off + 0x19] ?? 0;
    const tsN1B = stateInst.workRam[off + 0x1b] ?? 0;
    const tsN67 = stateInst.workRam[off + 0x67] ?? 0;
    const tsN6C = stateInst.workRam[off + 0x6c] ?? 0;

    const ok =
      binState === tsState &&
      binTimer === tsTimer &&
      binN19 === tsN19 &&
      binN1B === tsN1B &&
      binN67 === tsN67 &&
      binN6C === tsN6C;
    if (ok) return true;

    if (failHolder.value === null) {
      let detail = "";
      if (binState !== tsState)
        detail = `state@1A bin=0x${binState.toString(16)} ts=0x${tsState.toString(16)}`;
      else if (binTimer !== tsTimer)
        detail = `timer@68 bin=0x${binTimer.toString(16)} ts=0x${tsTimer.toString(16)}`;
      else if (binN19 !== tsN19)
        detail = `nb@19 bin=0x${binN19.toString(16)} ts=0x${tsN19.toString(16)}`;
      else if (binN1B !== tsN1B)
        detail = `nb@1B bin=0x${binN1B.toString(16)} ts=0x${tsN1B.toString(16)}`;
      else if (binN67 !== tsN67)
        detail = `nb@67 bin=0x${binN67.toString(16)} ts=0x${tsN67.toString(16)}`;
      else if (binN6C !== tsN6C)
        detail = `nb@6C bin=0x${binN6C.toString(16)} ts=0x${tsN6C.toString(16)}`;
      failHolder.value = { suite, tc, ptr, detail };
    }
    return false;
  }

  const rng = makeRng(0x160d4);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;
  const pickPtr = (): number =>
    PTR_CANDIDATES[Math.floor(rng() * PTR_CANDIDATES.length)]!;

  // ─── Suite A: random everything ──────────────────────────────────────
  console.log(`\n--- Suite A: random ptr/state/timer/neighbors — ${perSuite} casi ---`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const ok = runOneCase("A", i, pickPtr(), rb(), rl(), rb(), rb(), rb(), rb());
    if (ok) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: stato pre ∈ {0x21, 0x22, 0x24} ─────────────────────────
  console.log(`\n--- Suite B: pre-state in {0x21,0x22,0x24} — ${perSuite} casi ---`);
  const preStates = [0x21, 0x22, 0x24] as const;
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const preState = preStates[i % preStates.length]!;
    const ok = runOneCase("B", i, pickPtr(), preState, rl(), rb(), rb(), rb(), rb());
    if (ok) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: timer pre = 0x00070000 (idempotenza valore atteso) ──────
  console.log(`\n--- Suite C: pre-timer = 0x00070000 — ${perSuite} casi ---`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const ok = runOneCase("C", i, pickPtr(), rb(), 0x00070000, rb(), rb(), rb(), rb());
    if (ok) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: stato pre = 0x23 (già in stato target) ─────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n--- Suite D: pre-state = 0x23 (already-in-state) — ${sizeD} casi ---`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const ok = runOneCase("D", i, pickPtr(), 0x23, rl(), rb(), rb(), rb(), rb());
    if (ok) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ─── Sommario ────────────────────────────────────────────────────────
  console.log(`\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value) {
    const f = failHolder.value;
    console.log(
      `  First fail: suite=${f.suite} tc=${f.tc} ptr=0x${f.ptr.toString(16)}`,
    );
    console.log(`              ${f.detail}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
