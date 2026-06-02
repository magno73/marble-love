#!/usr/bin/env node
/**
 * test-state-sub-5584-parity.ts — differential FUN_5584 vs stateSub5584.
 *
 * `FUN_00005584` (132 byte): scan-and-match wrapper:
 *   1. FUN_540A(arg0_long, arg2_word) → D5 (walked ptr).
 *   2. FUN_53EA(D5) → if 0 → return 0 early.
 *   3. for D4 in {3, 6, 9, 12, 15}:
 *        D2 = FUN_5468(curPtr, arg1_word, D4, arg3_word, arg4_word)
 *        if FUN_53EA(D2) == 0: D2 = arg0_long (D6 restore)
 *        if D2 == D5: exit
 *
 * Strategia parity test:
 *   - Patch RTS suthe 3 callee binari (FUN_540A, FUN_53EA, FUN_5468) per
 *     impedire the esecuzione of the their corpo.
 *   - Capture args on the stack when pc == callee entry. Capture D0
 *     lo INIETTIAMO).
 *     TS that uses callback playback with the same return values.
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-5584-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub5584 as subNs,
} from "@marble-love/engine";
import {
  createCpu,
  disposeCpu,
  pokeMem,
  peekMem,
  type CpuSession,
} from "./binary-oracle-lib.js";

const FUN_5584 = 0x00005584;
const FUN_540A = 0x0000540a;
const FUN_53EA = 0x000053ea;
const FUN_5468 = 0x00005468;
const SENTINEL_RET = 0xcafebabe >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Patch RTS (0x4E75) at the entry of the three callees. */
function patchCallees(cpu: CpuSession): void {
  // FUN_540A: orig word `movem.l {A2 D3 D2},-(SP)` (0x48E7). Patch a 0x4E75 (rts).
  pokeMem(cpu, FUN_540A + 0, 1, 0x4e);
  pokeMem(cpu, FUN_540A + 1, 1, 0x75);
  // FUN_53EA: orig word `move.l D2,-(SP)` (0x2F02). Patch a 0x4E75 (rts).
  pokeMem(cpu, FUN_53EA + 0, 1, 0x4e);
  pokeMem(cpu, FUN_53EA + 1, 1, 0x75);
  // FUN_5468: orig word `link.w A6,-0xc` (0x4E56). Patch a 0x4E75 (rts).
  pokeMem(cpu, FUN_5468 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_5468 + 1, 1, 0x75);
}

interface Call540A {
  a2: number;
  d3w: number;
  ret: number;
}
interface Call53EA {
  ptr: number;
  ret: number;
}
interface Call5468 {
  a2: number;
  d3w: number;
  d2w: number;
  arg3w: number;
  arg4w: number;
  ret: number;
}

interface CapturedSeq {
  /** Order of callee entries by id. */
  order: ("540A" | "53EA" | "5468")[];
  calls540A: Call540A[];
  calls53EA: Call53EA[];
  calls5468: Call5468[];
  finalD0: number;
  reachedRts: boolean;
}

/**
 * Esegue FUN_5584 step-by-step.
 * of the RTS sintetico.
 *
 * @param cpu          CPU session.
 * @param args         5 args (arg0..arg4) as long unsigned.
 * @param ret540A      Return da FUN_540A.
 */
function runAndCapture(
  cpu: CpuSession,
  args: readonly [number, number, number, number, number],
  ret540A: number,
  ret53EA: readonly number[],
  ret5468: readonly number[],
): CapturedSeq {
  const sys = cpu.system;

  const sp0 = 0x401f00;
  let sp = sp0;
  // Push args RTL (arg4 first, arg0 last on stack top before ret).
  for (let i = 4; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, args[i]! >>> 0);
  }
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_5584);

  const order: ("540A" | "53EA" | "5468")[] = [];
  const calls540A: Call540A[] = [];
  const calls53EA: Call53EA[] = [];
  const calls5468: Call5468[] = [];

  let idx53EA = 0;
  let idx5468 = 0;
  let safety = 600;
  let reachedRts = false;
  let lastD0 = 0;

  while (safety-- > 0) {
    const pc = sys.getRegisters().pc >>> 0;
    if (pc === SENTINEL_RET) {
      reachedRts = true;
      lastD0 = sys.getRegisters().d0 >>> 0;
      break;
    }
    if (pc === FUN_540A) {
      // Args at stack: (4,SP)=arg0_long, (8,SP)=arg2_long_zext.
      const spNow = sys.getRegisters().sp >>> 0;
      const a2v = peekMem(cpu, (spNow + 4) >>> 0, 4) >>> 0;
      const d3v = peekMem(cpu, (spNow + 8) >>> 0, 4) >>> 0;
      // d3w = low word of d3v (arg2 word zero-ext to long).
      calls540A.push({ a2: a2v, d3w: d3v & 0xffff, ret: ret540A >>> 0 });
      order.push("540A");
      // Inject return D0 = ret540A. The next step is the patched RTS.
      sys.setRegister("d0", ret540A >>> 0);
    } else if (pc === FUN_53EA) {
      // (4,SP)=ptr.
      const spNow = sys.getRegisters().sp >>> 0;
      const ptr = peekMem(cpu, (spNow + 4) >>> 0, 4) >>> 0;
      const r = (ret53EA[idx53EA++] ?? 0) >>> 0;
      calls53EA.push({ ptr, ret: r });
      order.push("53EA");
      sys.setRegister("d0", r);
    } else if (pc === FUN_5468) {
      // FUN_5468: 5 args (long, word, word, byte/word, word). All pushed long.
      // Stack: (4,SP)=arg0_long, (8)=arg1_long, (12)=arg2_long, (16)=arg3_long,
      // (20)=arg4_long. Words read by callee from low half of long.
      const spNow = sys.getRegisters().sp >>> 0;
      const a0 = peekMem(cpu, (spNow + 4) >>> 0, 4) >>> 0;
      const a1 = peekMem(cpu, (spNow + 8) >>> 0, 4) >>> 0;
      const a2 = peekMem(cpu, (spNow + 12) >>> 0, 4) >>> 0;
      const a3 = peekMem(cpu, (spNow + 16) >>> 0, 4) >>> 0;
      const a4 = peekMem(cpu, (spNow + 20) >>> 0, 4) >>> 0;
      const r = (ret5468[idx5468++] ?? 0) >>> 0;
      calls5468.push({
        a2: a0,
        d3w: a1 & 0xffff,
        d2w: a2 & 0xffff,
        arg3w: a3 & 0xffff,
        arg4w: a4 & 0xffff,
        ret: r,
      });
      order.push("5468");
      sys.setRegister("d0", r);
    }
    sys.step();
  }

  return {
    order,
    calls540A,
    calls53EA,
    calls5468,
    finalD0: lastD0,
    reachedRts,
  };
}

interface TsCapture {
  order: ("540A" | "53EA" | "5468")[];
  calls540A: Call540A[];
  calls53EA: Call53EA[];
  calls5468: Call5468[];
  finalD0: number;
}

function runTsAndCapture(
  state: stateNs.GameState,
  args: readonly [number, number, number, number, number],
  ret540A: number,
  ret53EA: readonly number[],
  ret5468: readonly number[],
): TsCapture {
  const order: ("540A" | "53EA" | "5468")[] = [];
  const calls540A: Call540A[] = [];
  const calls53EA: Call53EA[] = [];
  const calls5468: Call5468[] = [];

  let idx53EA = 0;
  let idx5468 = 0;

  const finalD0 = subNs.stateSub5584(
    state,
    args[0],
    args[1],
    args[2],
    args[3],
    args[4],
    (_st, a2, d3w) => {
      calls540A.push({ a2, d3w, ret: ret540A >>> 0 });
      order.push("540A");
      return ret540A >>> 0;
    },
    (_st, ptr) => {
      const r = (ret53EA[idx53EA++] ?? 0) >>> 0;
      calls53EA.push({ ptr, ret: r });
      order.push("53EA");
      return r;
    },
    (_st, a2, d3w, d2w, arg3w, arg4w) => {
      const r = (ret5468[idx5468++] ?? 0) >>> 0;
      calls5468.push({ a2, d3w, d2w, arg3w, arg4w, ret: r });
      order.push("5468");
      return r;
    },
  );

  return { order, calls540A, calls53EA, calls5468, finalD0: finalD0 >>> 0 };
}

function eqCall540A(a: Call540A, b: Call540A): boolean {
  return a.a2 === b.a2 && a.d3w === b.d3w && a.ret === b.ret;
}
function eqCall53EA(a: Call53EA, b: Call53EA): boolean {
  return a.ptr === b.ptr && a.ret === b.ret;
}
function eqCall5468(a: Call5468, b: Call5468): boolean {
  return (
    a.a2 === b.a2 &&
    a.d3w === b.d3w &&
    a.d2w === b.d2w &&
    a.arg3w === b.arg3w &&
    a.arg4w === b.arg4w &&
    a.ret === b.ret
  );
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  // Patch RTS sui callee (una sola time — la patch persiste).
  patchCallees(cpu);

  console.log(`\n=== stateSub5584 (FUN_5584) — ${n} cases ===`);

  const rng = makeRng(0x55845584);
  let ok = 0;
  let firstFail: {
    i: number;
    args: readonly [number, number, number, number, number];
    binFinal: number;
    tsFinal: number;
    binOrder: string[];
    tsOrder: string[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Generate args + return values.
    let args: [number, number, number, number, number];
    let ret540A: number;
    let ret53EA: number[];
    let ret5468: number[];

    if (i === 0) {
      // Early-exit: 540A → ptr; 53EA → 0.
      args = [0x00401000, 0x0001, 0x0008, 0x0001, 0x0050];
      ret540A = 0x00401500;
      ret53EA = [0]; // first 53EA = 0 → early exit
      ret5468 = [];
    } else if (i === 1) {
      args = [0x00401000, 0x0042, 0x000a, 0x0001, 0x0010];
      ret540A = 0x00402000;
      ret53EA = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]; // 6 invocations
      ret5468 = [0x401001, 0x401002, 0x401003, 0x401004, 0x401005];
    } else if (i === 2) {
      args = [0x00400100, 0x00aa, 0x0005, 0x0001, 0x0010];
      ret540A = 0x00402000;
      ret53EA = [0x42, 0x88]; // post-540A, post-5468-iter1
      ret5468 = [0x00402000];
    } else if (i === 3) {
      // Restore D2 = D6: 5468 → ptr; 53EA → 0; D6 == D5 → cmp-eq.
      args = [0x00402222, 0x0001, 0x0001, 0x0001, 0x0001];
      ret540A = 0x00402222; // == arg0
      ret53EA = [0x99, 0]; // post-540A != 0; post-5468 = 0 → restore
      ret5468 = [0x00405555];
    } else if (i === 4) {
      args = [0x00401000, 0x0001, 0x0001, 0x0001, 0x0001];
      ret540A = 0;
      ret53EA = [0]; // simulate pair=0 → early exit
      ret5468 = [];
    } else if (i < 30) {
      // Sweep deterministico su pattern of return.
      const seed = i - 5;
      const earlyExit = (seed & 1) === 0;
      args = [
        0x00400000 + (seed * 0x100),
        seed & 0xffff,
        (seed * 7) & 0xffff,
        seed & 0xffff,
        (seed * 11) & 0xffff,
      ];
      ret540A = 0x00400500 + seed;
      if (earlyExit) {
        ret53EA = [0];
        ret5468 = [];
      } else {
        ret53EA = [0xff, 0, 0xff, 0, 0xff, 0]; // alternating
        ret5468 = [0x401100, 0x401200, 0x401300, 0x401400, 0x401500];
      }
    } else {
      // Random.
      const arg0 = Math.floor(rng() * 0x10000) + 0x400000; // workram-ish
      const arg1w = Math.floor(rng() * 0x10000) & 0xffff;
      const arg2w = Math.floor(rng() * 0x10000) & 0xffff;
      const arg3w = Math.floor(rng() * 0x10000) & 0xffff;
      const arg4w = Math.floor(rng() * 0x10000) & 0xffff;
      args = [arg0 >>> 0, arg1w, arg2w, arg3w, arg4w];

      // Decide 540A return: 50% sentinel, 50% random ptr.
      ret540A = rng() < 0.5 ? 0 : (Math.floor(rng() * 0x10000) + 0x400000) >>> 0;

      // Decide 53EA pattern: random 0 / non-zero.
      ret53EA = [];
      for (let k = 0; k < 6; k++) {
        ret53EA.push(rng() < 0.3 ? 0 : Math.floor(rng() * 0xff) + 1);
      }
      // 5468 returns: 50% chance to match D5 (= ret540A) on some iter.
      ret5468 = [];
      for (let k = 0; k < 5; k++) {
        if (rng() < 0.2) {
          ret5468.push(ret540A); // possible match
        } else {
          ret5468.push((Math.floor(rng() * 0x10000) + 0x400000) >>> 0);
        }
      }
    }

    const bin = runAndCapture(cpu, args, ret540A, ret53EA, ret5468);

    // Esegue TS.
    const ts = runTsAndCapture(state, args, ret540A, ret53EA, ret5468);

    const sameOrder =
      bin.order.length === ts.order.length &&
      bin.order.every((v, k) => v === ts.order[k]);
    const same540A =
      bin.calls540A.length === ts.calls540A.length &&
      bin.calls540A.every((c, k) => eqCall540A(c, ts.calls540A[k]!));
    const same53EA =
      bin.calls53EA.length === ts.calls53EA.length &&
      bin.calls53EA.every((c, k) => eqCall53EA(c, ts.calls53EA[k]!));
    const same5468 =
      bin.calls5468.length === ts.calls5468.length &&
      bin.calls5468.every((c, k) => eqCall5468(c, ts.calls5468[k]!));
    const sameFinal = bin.finalD0 === ts.finalD0;
    const match =
      bin.reachedRts &&
      sameOrder &&
      same540A &&
      same53EA &&
      same5468 &&
      sameFinal;

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        args,
        binFinal: bin.finalD0,
        tsFinal: ts.finalD0,
        binOrder: bin.order,
        tsOrder: ts.order,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    args: arg0=0x${firstFail.args[0].toString(16)} arg1=0x${firstFail.args[1].toString(16)} arg2=0x${firstFail.args[2].toString(16)} arg3=0x${firstFail.args[3].toString(16)} arg4=0x${firstFail.args[4].toString(16)}`,
    );
    console.log(`    bin order: ${firstFail.binOrder.join(",")}`);
    console.log(`    ts  order: ${firstFail.tsOrder.join(",")}`);
    console.log(
      `    bin final D0: 0x${firstFail.binFinal.toString(16)}`,
    );
    console.log(
      `    ts  final D0: 0x${firstFail.tsFinal.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
