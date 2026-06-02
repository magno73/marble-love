#!/usr/bin/env node
/**
 * test-bsearch-table-1abd4-parity.ts — differential FUN_0001ABD4 vs
 * `bsearchTable1ABD4`.
 *
 * FUN_0001ABD4 (68 byte) e' un binary-search per word: cerca il low-word
 * of `arg1Long` dentro la table puntata da `*(0x40065A)..*(0x40065E)`,
 * with initial 0x400-byte step, halved on every iter. It terminates only
 * to the equality. Ritorna in D0 il word-index `(matchPtr - basePtr) / 2`.
 *
 * Strategia stub injection:
 *   - FUN_0001ABD4 calls no JSR -> nothing to patch.
 *   - The only requirement is that the target is present in the table,
 *     otherwise the binary would enter an infinite loop. Tests
 *     costruiscono table garantite "complete".
 *
 * Setup table: use identity `table[i] = i` for i in [0..0x200)
 * (512 word, 1 KB), stoccata @ workRam off 0x1000. Pointer base = 0x401000,
 * pointer end = 0x4011FE. Convergence is proven for every target in
 * [0..0x1FF]: bisection reaches step=2 in <=10 iterations and finds a match.
 *
 * Tested suites (4 x 125 = 500 cases):
 *   - A: identity table 512 word, target random in [0..0x1FF]
 *   - B: identity table, target random + bit alti random in the long
 *        (checks mask 0xFFFF)
 *   - C: identity table 256 word (table piu' piccola), target in [0..0xFF]
 *        - checks top-side clamp
 *   - D: identity table displaced @ off 0x800 (different base), random target
 *        - checks independence from base addr
 *
 * Confronto: D0.w (return = word index).
 *
 * Uso: npx tsx packages/cli/src/test-bsearch-table-1abd4-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bsearchTable1ABD4 as bsNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1ABD4 = 0x0001abd4;
const PTR_BASE_SLOT = 0x0040065a;
const PTR_END_SLOT = 0x0040065e;

/** Patch JSR-stubs. FUN_1ABD4 non ha JSR → no-op. */
function patchSubs(_cpu: CpuSession): void {
  // Nessuna JSR in the range.
}

/** Write a long-BE in both binary+TS. */
function pokeLong(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  const off = abs - 0x400000;
  const u = v >>> 0;
  const bytes = [
    (u >>> 24) & 0xff,
    (u >>> 16) & 0xff,
    (u >>> 8) & 0xff,
    u & 0xff,
  ];
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, abs + i, 1, bytes[i]!);
    state.workRam[off + i] = bytes[i]!;
  }
}

/** Write a word-BE in both binary+TS. */
function pokeWord(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  const off = abs - 0x400000;
  const u = v & 0xffff;
  pokeMem(cpu, abs, 1, (u >>> 8) & 0xff);
  pokeMem(cpu, abs + 1, 1, u & 0xff);
  state.workRam[off] = (u >>> 8) & 0xff;
  state.workRam[off + 1] = u & 0xff;
}

/**
 * Setup identity table @ workRam off `tableOff`, lunghezza `nWords` word.
 * Configura *(0x40065A) e *(0x40065E) puntando a base/end.
 */
function setupIdentityTable(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  tableOff: number,
  nWords: number,
): void {
  const baseAbs = 0x400000 + tableOff;
  for (let i = 0; i < nWords; i++) {
    pokeWord(state, cpu, baseAbs + i * 2, i & 0xffff);
  }
  const endAbs = baseAbs + (nWords - 1) * 2;
  pokeLong(state, cpu, PTR_BASE_SLOT, baseAbs);
  pokeLong(state, cpu, PTR_END_SLOT, endAbs);
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

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    target: number;
    binD0: number;
    tsD0: number;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    targetLong: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    const r = callFunction(cpu, FUN_1ABD4, [targetLong >>> 0]);
    const tsD0 = bsNs.bsearchTable1ABD4(stateInst, targetLong >>> 0);
    const binD0 = r.d0 >>> 0;
    if (binD0 === (tsD0 >>> 0)) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        target: targetLong >>> 0,
        binD0,
        tsD0: tsD0 >>> 0,
      };
    }
    return false;
  }

  const rng = makeRng(0x1abd4);
  const ri = (max: number): number => Math.floor(rng() * max);
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  // ─── Suite A: identity 512-word, target in [0..0x1FF] ────────────────
  console.log(
    `\n=== bsearchTable1ABD4 (FUN_0001ABD4) — Suite A: identity 512w, target in [0..0x1FF] — ${perSuite} cases ===`,
  );
  setupIdentityTable(stateInst, cpu, 0x1000, 0x200);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const target = ri(0x200);
    if (runOneCase("A", i, target)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: identity 512-word, low-word in range, high-bit garbage ─
  console.log(
    `\n=== Suite B: identity 512w, target = (rand_high<<16) | low_word — ${perSuite} cases ===`,
  );
  // Table already set by Suite A.
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const lo = ri(0x200);
    const hi = ri(0x10000);
    const target = ((hi << 16) | lo) >>> 0;
    if (runOneCase("B", i, target)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: identity 256-word, target in [0..0xFF] ─────────────────
  console.log(
    `\n=== Suite C: identity 256w, target in [0..0xFF] — ${perSuite} cases ===`,
  );
  setupIdentityTable(stateInst, cpu, 0x1000, 0x100);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const target = ri(0x100);
    if (runOneCase("C", i, target)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // Suite D: identity 512-word @ off 0x800 (different base).
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: identity 512w @ off 0x800, target in [0..0x1FF] — ${sizeD} cases ===`,
  );
  setupIdentityTable(stateInst, cpu, 0x800, 0x200);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    // Mix of valid target only plus ext_l style with a valid low word.
    const lo = ri(0x200);
    const useExt = rng() < 0.5;
    let target: number;
    if (useExt) {
      // ext.l style: high word = sign-ext of lo bit 15, always 0 in [0..0x1FF].
      target = lo >>> 0;
    } else {
      target = (((rl() & 0xffff0000) >>> 0) | lo) >>> 0;
    }
    if (runOneCase("D", i, target)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): target=0x${f.target.toString(16)} ` +
        `binD0=0x${f.binD0.toString(16)} tsD0=0x${f.tsD0.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
