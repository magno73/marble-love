#!/usr/bin/env node
/**
 * test-render-string-entry-286b0-parity.ts — differential FUN_286B0.
 *
 * FUN_286B0 (62 byte): copy-string + struct-init + render. Variante più
 * ricca di FUN_28FDE: copia attivamente una stringa null-terminated da
 * `**arg1` al buffer destinazione `*(0x400412)`, scrive col/tickOff/marker
 * @ 0x400410+0/+1/+6, poi chiama renderStringChain @ FUN_2572 con
 * `(0x400410, attr_word)` (attr da arg4).
 *
 * Strategia stub injection:
 *   - FUN_2572 (renderStringChain) → patched a `rts` (4E 75) → no-op.
 *     Il binario tra il loop di copia e la jsr esegue tutte le scritture
 *     osservabili che vogliamo verificare; quel che fa FUN_2572 è
 *     "downstream" e non rilevante per la parity di 286B0.
 *
 *   - L'arg1 deve puntare a un long-BE che a sua volta punta a una stringa
 *     null-terminated valida. La sorgente è in workRam (per controllo
 *     totale del byte stream); la dest è in workRam (così il diff è
 *     osservabile via peekMem/state.workRam).
 *
 * Suite testate (4 × 125 = 500 casi):
 *   - A: stringhe random, lunghezza random in [0..63]
 *   - B: stringa di 1 byte (solo terminator) — verifica scrittura singola
 *   - C: stringa lunga (60..120 byte) — stress copy loop
 *   - D: byte LSB di arg2/arg3 in {0x00, 0xff} ciclato — verifica byte writes
 *
 * Confronto: workRam @ 0x400400..0x4007FF (1 KB; struct + dest buffer).
 *
 * Uso: npx tsx packages/cli/src/test-render-string-entry-286b0-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  renderStringEntry286B0 as fdeNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_286B0 = 0x000286b0;
const FUN_2572 = 0x00002572;

/** Patch FUN_2572 (renderStringChain) a `rts` (0x4E75) per stub no-op. */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_2572 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_2572 + 1, 1, 0x75);
}

/** Range workRam confrontato (struct @ 0x400410, dest buffer @ 0x400500..). */
const COMPARE_BASE = 0x00400400;
const COMPARE_SIZE = 0x400; // 0x400400..0x4007FF (1 KB)
const COMPARE_BASE_OFF = COMPARE_BASE - 0x00400000; // 0x400

const ARG1_PTR_ABS = 0x00400600 as const; // long ptr-to-ptr (4 byte)
const SRC_BUFFER_ABS = 0x00400700 as const; // 256 byte buffer per source string
const DEST_BUFFER_ABS = 0x00400500 as const; // 256 byte buffer per dest string

/** Inizializza la struct @ 0x400410 con dest pointer = `DEST_BUFFER_ABS`. */
function setupStructDestPtr(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  // workRam offset 0x412 (struct base 0x410 + 2)
  const off = 0x412;
  const v = DEST_BUFFER_ABS >>> 0;
  const bytes = [
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  ];
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, 0x400000 + off + i, 1, bytes[i]!);
    state.workRam[off + i] = bytes[i]!;
  }
}

/** Scrive il long-BE `srcAbs` @ ARG1_PTR_ABS (4 byte), in entrambi binario+TS. */
function setupArg1PtrToPtr(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  srcAbs: number,
): void {
  const off = ARG1_PTR_ABS - 0x400000;
  const v = srcAbs >>> 0;
  const bytes = [
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  ];
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, ARG1_PTR_ABS + i, 1, bytes[i]!);
    state.workRam[off + i] = bytes[i]!;
  }
}

/** Scrive una stringa null-terminated @ SRC_BUFFER_ABS in entrambi binario+TS. */
function setupSourceString(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  const off = SRC_BUFFER_ABS - 0x400000;
  // Garantisco terminator: l'ultimo byte è 0 (anche se il chiamante non lo
  // include) per evitare loop infinito nel binario.
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, SRC_BUFFER_ABS + i, 1, bytes[i]! & 0xff);
    state.workRam[off + i] = bytes[i]! & 0xff;
  }
}

/** Pre-fill (stesso valore) della region confrontata. */
function setupCompareRegion(
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

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
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
  const subs: fdeNs.RenderStringEntry286B0Subs = {
    renderStringChain: (_addr: number, _attr: number): void => {},
  };

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    offset: number;
    bin: number;
    ts: number;
    arg2: number;
    arg3: number;
    arg4: number;
    strBytes: string;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    regionPrefill: number[],
    srcBytes: number[],
    arg2: number,
    arg3: number,
    arg4: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);

    // Reset compare region in entrambi
    setupCompareRegion(stateInst, cpu, regionPrefill);
    // Setup struct dest pointer @ 0x412
    setupStructDestPtr(stateInst, cpu);
    // Setup arg1 ptr-to-ptr @ ARG1_PTR_ABS
    setupArg1PtrToPtr(stateInst, cpu, SRC_BUFFER_ABS);
    // Setup source string @ SRC_BUFFER_ABS
    setupSourceString(stateInst, cpu, srcBytes);

    callFunction(cpu, FUN_286B0, [
      ARG1_PTR_ABS >>> 0,
      arg2 >>> 0,
      arg3 >>> 0,
      arg4 >>> 0,
    ]);
    fdeNs.renderStringEntry286B0(
      stateInst,
      ARG1_PTR_ABS >>> 0,
      arg2 >>> 0,
      arg3 >>> 0,
      arg4 >>> 0,
      subs,
    );

    const fail = compareRegion(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        offset: fail.offset,
        bin: fail.bin,
        ts: fail.ts,
        arg2,
        arg3,
        arg4,
        strBytes: srcBytes.map(b => b.toString(16).padStart(2, "0")).join(""),
      };
    }
    return false;
  }

  const rng = makeRng(0x286b0);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  /** Genera string null-terminated di lunghezza N (byte 0 incluso). */
  function rndString(maxNonZeroLen: number): number[] {
    const len = Math.max(0, Math.floor(rng() * (maxNonZeroLen + 1)));
    const out: number[] = [];
    for (let i = 0; i < len; i++) {
      // garantisco non-zero (1..255)
      let b = rb();
      if (b === 0) b = 1;
      out.push(b);
    }
    out.push(0); // terminator
    return out;
  }

  // ─── Suite A: stringhe random len [0..63] ────────────────────────────
  console.log(
    `\n=== renderStringEntry286B0 (FUN_286B0) — Suite A: random strings & args — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const region = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    const str = rndString(63);
    const arg2 = rl();
    const arg3 = rl();
    const arg4 = rl();
    if (runOneCase("A", i, region, str, arg2, arg3, arg4)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: stringa solo terminator (1 byte = 0) ────────────────────
  console.log(
    `\n=== Suite B: stringa vuota (terminator only) — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const region = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    const str = [0];
    const arg2 = rl();
    const arg3 = rl();
    const arg4 = rl();
    if (runOneCase("B", i, region, str, arg2, arg3, arg4)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: stringhe lunghe (60..120 byte) ──────────────────────────
  console.log(
    `\n=== Suite C: stringhe lunghe (60..120 byte) — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const region = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    const len = 60 + Math.floor(rng() * 61);
    const out: number[] = [];
    for (let k = 0; k < len; k++) {
      let b = rb();
      if (b === 0) b = 1;
      out.push(b);
    }
    out.push(0);
    const arg2 = rl();
    const arg3 = rl();
    const arg4 = rl();
    if (runOneCase("C", i, region, out, arg2, arg3, arg4)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: arg LSB ciclati 0x00 / 0xff ────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: arg2/arg3 LSB in {0x00, 0xff} — ${sizeD} casi ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const region = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    const str = rndString(31);
    // alternanza 0x00 / 0xff sui due byte LSB
    const a2lsb = (i & 1) === 0 ? 0x00 : 0xff;
    const a3lsb = (i & 2) === 0 ? 0x00 : 0xff;
    const arg2 = ((rl() & 0xffffff00) | a2lsb) >>> 0;
    const arg3 = ((rl() & 0xffffff00) | a3lsb) >>> 0;
    const arg4 = rl();
    if (runOneCase("D", i, region, str, arg2, arg3, arg4)) okD++;
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
        `args=[arg2=0x${f.arg2.toString(16)}, arg3=0x${f.arg3.toString(16)}, arg4=0x${f.arg4.toString(16)}] ` +
        `srcBytes=${f.strBytes.slice(0, 64)}${f.strBytes.length > 64 ? "..." : ""}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
