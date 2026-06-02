#!/usr/bin/env node
/**
 * test-render-glyph-loop-1e64-parity.ts — differential FUN_1E64 vs
 * `renderGlyphLoop1E64`.
 *
 * advancing `bufPtr` by 2 (`charCode ∈ [0x26, 0x2D]` signed) or 4
 *
 * **Parity strategy**: the TS replica does NOT modify alphaRam (FUN_32BA
 *
 *     then step instruction-by-instruction. On each visit of PC=0x32BA
 *     read from the stack `(bufPtr, charCode_long, mask_long)` (the 3 longs
 *     `BinaryCall`, then continue the step (FUN_32BA runs normally,
 *
 *   - **TS replica**: call `renderGlyphLoop1E64` with a callback
 *     `(bufPtr, charCode_low_word)` 1:1.
 *
 *
 *
 * Tested suites (4 × 125 = 500):
 *   - A: small count (1..4) random, charCode random low (0x00..0x80)
 *   - B: charCode that crosses the narrow boundary [0x26, 0x2D]
 *   - C: medium count (5..12), charCode wide-only (0x30..0x7F)
 *   - D: edge cases — count=0/1, charCode = exact boundaries
 *         (0x25/0x26/0x2D/0x2E), charCode signed-negative (0xFF80..0xFFFF)
 *
 * Usage: npx tsx packages/cli/src/test-render-glyph-loop-1e64-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  renderGlyphLoop1E64 as mod1E64,
} from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1E64 = 0x00001e64;
const FUN_32BA = 0x000032ba;
const SENTINEL_RET = 0xcafebabe >>> 0;

interface BinaryCall {
  bufPtr: number;
  charCode: number; // word (low 16 bits of the pushed long)
  mask: number;
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  setup: { bufPtr: number; charCode: number; count: number };
  binCalls: BinaryCall[];
  tsCalls: BinaryCall[];
  binEndBufPtr?: number;
  tsEndBufPtr?: number;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/**
 *
 * bufPtr_long (top -> bottom). The FUN_1E64 prologue does
 * `movem.l {D4 D3 D2}, -(SP)` (12 bytes), moving the 3 args to (0x10, 0x14, 0x18).
 *
 * @returns `{ calls, endBufPtr }`. `endBufPtr` = D4 at the RTS
 */
function runBinary(
  cpu: CpuSession,
  bufPtr: number,
  charCode: number,
  count: number,
  maxSteps = 200_000,
): { calls: BinaryCall[]; reachedSentinel: boolean } {
  const sys = cpu.system;

  // of the 1E08 test but similar). We allocate room for many pushes.
  let sp = 0x401e80 >>> 0;

  sp = (sp - 4) >>> 0; sys.write(sp, 4, count >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, charCode >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, bufPtr >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, SENTINEL_RET);

  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_1E64);

  const calls: BinaryCall[] = [];
  let reached = false;

  for (let i = 0; i < maxSteps; i++) {
    const pc = sys.getRegisters().pc >>> 0;
    if (pc === SENTINEL_RET) {
      reached = true;
      break;
    }
    if (pc === FUN_32BA) {
      //   SP+0  = ret addr (0x1e88)
      //   SP+4  = bufPtr long (D4 at the push)
      //   SP+8  = charCode long (sext_l(D3.w))
      //   SP+12 = mask long (clr.l, = 0)
      const spNow = sys.getRegisters().sp >>> 0;
      const callBufPtr = sys.read(spNow + 4, 4) >>> 0;
      const callCharLong = sys.read(spNow + 8, 4) >>> 0;
      const callMaskLong = sys.read(spNow + 12, 4) >>> 0;
      // charCode word = low 16 bits (= D3.w pre sign-extension).
      // sext_l(d3w) preserves the representation: for charCode ∈ [0, 0x7FFF]
      // Extract `& 0xFFFF` to recover the original word.
      calls.push({
        bufPtr: callBufPtr,
        charCode: callCharLong & 0xffff,
        mask: callMaskLong & 0xffff,
      });
    }
    sys.step();
  }

  return { calls, reachedSentinel: reached };
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

  // but createCpu requires it. Use emptyGameState.
  const stateNs = await import("@marble-love/engine");
  const stateInst = stateNs.state.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  const rng = makeRng(0x1e64);
  let firstFail: FailRecord | null = null;

  function runOneCase(
    suite: string,
    tc: number,
    bufPtr: number,
    charCode: number,
    count: number,
  ): boolean {
    // we compare alphaRam but zero it out to avoid confusing repeated runs).
    for (let j = 0; j < 0x1000; j++) {
      pokeMem(cpu, 0xa03000 + j, 1, 0x00);
    }

    const bin = runBinary(cpu, bufPtr, charCode, count);

    // Run TS replica
    const tsCalls: BinaryCall[] = [];
    const tsResult = mod1E64.renderGlyphLoop1E64(bufPtr, charCode, count, {
      renderGlyph: (c) =>
        tsCalls.push({
          bufPtr: c.bufPtr >>> 0,
          charCode: c.charCode & 0xffff,
          mask: c.mask & 0xffff,
        }),
    });

    if (!bin.reachedSentinel) {
      if (firstFail === null) {
        firstFail = {
          suite, tc,
          reason: "binary did not reach sentinel (timeout)",
          setup: { bufPtr, charCode, count },
          binCalls: bin.calls,
          tsCalls,
        };
      }
      return false;
    }

    if (bin.calls.length !== tsCalls.length) {
      if (firstFail === null) {
        firstFail = {
          suite, tc,
          reason: `call count mismatch: bin=${bin.calls.length} ts=${tsCalls.length}`,
          setup: { bufPtr, charCode, count },
          binCalls: bin.calls,
          tsCalls,
        };
      }
      return false;
    }

    for (let i = 0; i < bin.calls.length; i++) {
      const b = bin.calls[i]!;
      const t = tsCalls[i]!;
      if (b.bufPtr !== t.bufPtr || b.charCode !== t.charCode || b.mask !== t.mask) {
        if (firstFail === null) {
          firstFail = {
            suite, tc,
            reason: `call[${i}] mismatch: bin={bp=0x${b.bufPtr.toString(16)},cc=0x${b.charCode.toString(16)},m=0x${b.mask.toString(16)}} ts={bp=0x${t.bufPtr.toString(16)},cc=0x${t.charCode.toString(16)},m=0x${t.mask.toString(16)}}`,
            setup: { bufPtr, charCode, count },
            binCalls: bin.calls,
            tsCalls,
          };
        }
        return false;
      }
    }

    // Sanity: iterations TS == count (clamp signed).
    const expectedIter = ((count << 16) >> 16) > 0 ? ((count << 16) >> 16) : 0;
    if (tsResult.iterations !== expectedIter) {
      if (firstFail === null) {
        firstFail = {
          suite, tc,
          reason: `ts iterations=${tsResult.iterations} expected=${expectedIter}`,
          setup: { bufPtr, charCode, count },
          binCalls: bin.calls,
          tsCalls,
        };
      }
      return false;
    }

    return true;
  }

  let totalOk = 0;

  // ─── Suite A: small count (1..4), charCode random low ──────────────
  console.log(
    `\n=== renderGlyphLoop1E64 (FUN_1E64) — Suite A: count 1..4 random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const bufPtr = (0x00a03000 + (Math.floor(rng() * 0x700) & ~1)) >>> 0;
    const charCode = Math.floor(rng() * 0x80) & 0xffff;
    const count = 1 + Math.floor(rng() * 4);
    if (runOneCase("A", i, bufPtr, charCode, count)) okA++;
  }
  console.log(
    `  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okA;

  // ─── Suite B: charCode crosses the narrow boundary ───────────────────
  console.log(
    `\n=== Suite B: charCode cross narrow boundary [0x26, 0x2D] — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const bufPtr = (0x00a03000 + (Math.floor(rng() * 0x700) & ~1)) >>> 0;
    // charCode start in [0x20, 0x32], count large enough to cross the range.
    const charCode = 0x20 + Math.floor(rng() * 0x13); // 0x20..0x32
    const count = 2 + Math.floor(rng() * 8); // 2..9
    if (runOneCase("B", i, bufPtr, charCode, count)) okB++;
  }
  console.log(
    `  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okB;

  // ─── Suite C: medium count, charCode wide-only ────────────────────────
  console.log(
    `\n=== Suite C: count 5..12, charCode wide-only — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const bufPtr = (0x00a03000 + (Math.floor(rng() * 0x600) & ~1)) >>> 0;
    const charCode = 0x30 + Math.floor(rng() * 0x4f);
    const count = 5 + Math.floor(rng() * 8); // 5..12
    if (runOneCase("C", i, bufPtr, charCode, count)) okC++;
  }
  console.log(
    `  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (count 0/1, boundary, signed-neg) — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const bufPtr = (0x00a03000 + (Math.floor(rng() * 0x700) & ~1)) >>> 0;
    let charCode: number;
    let count: number;
    const sub = i % 5;
    if (sub === 0) {
      // count = 0 → no-op. charCode random.
      charCode = Math.floor(rng() * 0x10000) & 0xffff;
      count = 0;
    } else if (sub === 1) {
      // count = 1, charCode = boundary 0x25 (wide), 0x26 (narrow),
      //                           0x2D (narrow), 0x2E (wide).
      const boundaries = [0x25, 0x26, 0x2d, 0x2e];
      charCode = boundaries[Math.floor(rng() * 4)]!;
      count = 1;
    } else if (sub === 2) {
      // count = 1, charCode signed-negative
      charCode = (0xff80 + Math.floor(rng() * 0x80)) & 0xffff;
      count = 1;
    } else if (sub === 3) {
      charCode = (0xfff0 + Math.floor(rng() * 0x10)) & 0xffff;
      count = 2 + Math.floor(rng() * 4);
    } else {
      // negative count (0x8000..0xFFFF) → no-op signed (D2 ≤ 0)
      charCode = Math.floor(rng() * 0x100) & 0xffff;
      count = (0x8000 + Math.floor(rng() * 0x8000)) & 0xffff;
    }
    if (runOneCase("D", i, bufPtr, charCode, count)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (firstFail !== null) {
    const f = firstFail as FailRecord;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}\n` +
        `    setup: bufPtr=0x${f.setup.bufPtr.toString(16)} ` +
        `charCode=0x${f.setup.charCode.toString(16)} count=${f.setup.count}\n` +
        `    binCalls (${f.binCalls.length}):` +
        f.binCalls
          .slice(0, 6)
          .map(
            (c) =>
              ` (bp=0x${c.bufPtr.toString(16)},cc=0x${c.charCode.toString(16)})`,
          )
          .join("") +
        (f.binCalls.length > 6 ? " ..." : "") +
        `\n    tsCalls  (${f.tsCalls.length}):` +
        f.tsCalls
          .slice(0, 6)
          .map(
            (c) =>
              ` (bp=0x${c.bufPtr.toString(16)},cc=0x${c.charCode.toString(16)})`,
          )
          .join("") +
        (f.tsCalls.length > 6 ? " ..." : ""),
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
