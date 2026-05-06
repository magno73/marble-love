#!/usr/bin/env node
/**
 * test-render-glyph-loop-1e64-parity.ts — differential FUN_1E64 vs
 * `renderGlyphLoop1E64`.
 *
 * `FUN_00001E64` (70 byte) è un loop di rendering glifi: itera `count`
 * volte chiamando `FUN_32BA(bufPtr, charCode, 0)` per ogni iterazione e
 * avanzando `bufPtr` di 2 (`charCode ∈ [0x26, 0x2D]` signed) o 4
 * altrimenti. `charCode` viene incrementato di 1 ad ogni iterazione.
 *
 * **Strategia parity**: la replica TS NON modifica alphaRam (FUN_32BA
 * non è ancora replicata). Confronto invece la **sequenza di chiamate**
 * a FUN_32BA tra binario e TS:
 *
 *   - **Binario**: setto PC=0x1E64 con args sullo stack (cdecl-RTL),
 *     poi step instruction-by-instruction. Ad ogni visita di PC=0x32BA
 *     leggo dallo stack `(bufPtr, charCode_long, mask_long)` (i 3 long
 *     pushati da FUN_1E64 immediatamente prima del JSR), salvo come
 *     `BinaryCall`, poi continuo lo step (FUN_32BA esegue normalmente,
 *     RTS torna a FUN_1E64 next instr). Stop quando PC=SENTINEL_RET.
 *
 *   - **Replica TS**: chiamo `renderGlyphLoop1E64` con un callback
 *     `renderGlyph` che append a un array. Confronto le due sequenze
 *     `(bufPtr, charCode_low_word)` 1:1.
 *
 * **Setup state**: alphaRam (`0xA03000..0xA03FFF`) viene scritta da
 * FUN_32BA. Pre-init a sentinel pattern; il binario la modifica ma noi
 * non confrontiamo alphaRam (è un side-effect di FUN_32BA, fuori scope).
 *
 * **Cap iterazioni**: `count ≤ 16` per garantire run veloce (ogni
 * FUN_32BA è ~30 step). 500 casi totali, ~25k step max → veloce.
 *
 * Suite testate (4 × 125 = 500):
 *   - A: count piccolo (1..4) random, charCode random low (0x00..0x80)
 *   - B: charCode che attraversa il boundary narrow [0x26, 0x2D]
 *   - C: count medio (5..12), charCode wide-only (0x30..0x7F)
 *   - D: edge cases — count=0/1, charCode = boundary esatti
 *         (0x25/0x26/0x2D/0x2E), charCode signed-negative (0xFF80..0xFFFF)
 *
 * Uso: npx tsx packages/cli/src/test-render-glyph-loop-1e64-parity.ts [N=500]
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
  charCode: number; // word (low 16 bits del long pushato)
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
 * Esegue `FUN_1E64(bufPtr, charCode, count)` nel binario, capturando
 * la sequenza di chiamate a FUN_32BA via step-and-hook su PC=0x32BA.
 *
 * Stack layout iniziale: SENTINEL_RET, count_long, charCode_long,
 * bufPtr_long (top → bottom). Il prologo di FUN_1E64 fa
 * `movem.l {D4 D3 D2}, -(SP)` (12 byte), portando i 3 args a (0x10, 0x14, 0x18).
 * Il word read di charCode/count è da (0x16) e (0x1A) (low word del long).
 *
 * @returns `{ calls, endBufPtr }`. `endBufPtr` = D4 al momento dell'RTS
 *          finale (catturato all'ultima visita di PC = next-after-rts).
 *          Strategia: catturiamo D4 prima di ogni JSR (ultimo D4 prima
 *          dell'exit = endBufPtr) — ma qui ci interessa il valore POST-loop,
 *          che è bufPtr_iniziale + Σ stride. Lo derivo dalle calls + width.
 */
function runBinary(
  cpu: CpuSession,
  bufPtr: number,
  charCode: number,
  count: number,
  maxSteps = 200_000,
): { calls: BinaryCall[]; reachedSentinel: boolean } {
  const sys = cpu.system;

  // Reset SP a una zona sicura in workRam (non vicino a 0x401F00 sentinel
  // del 1E08 test ma simile). Allochiamo room per molti push.
  let sp = 0x401e80 >>> 0;

  // Push args RTL: count, charCode, bufPtr. Tutti come long.
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
      // Stack a questo punto: il JSR ha pushato il PC di ritorno
      // (0x1e88) a -(SP). Sopra ci sono i 3 long pushati da FUN_1E64
      // immediatamente prima:
      //   SP+0  = ret addr (0x1e88)
      //   SP+4  = bufPtr long (D4 al momento del push)
      //   SP+8  = charCode long (sext_l(D3.w))
      //   SP+12 = mask long (clr.l, = 0)
      const spNow = sys.getRegisters().sp >>> 0;
      const callBufPtr = sys.read(spNow + 4, 4) >>> 0;
      const callCharLong = sys.read(spNow + 8, 4) >>> 0;
      const callMaskLong = sys.read(spNow + 12, 4) >>> 0;
      // charCode word = low 16 bits (= D3.w pre sign-extension).
      // sext_l(d3w) preserva la rappresentazione: per charCode ∈ [0, 0x7FFF]
      // è uguale; per charCode ∈ [0x8000, 0xFFFF] callCharLong = 0xFFFFxxxx.
      // Estraggo `& 0xFFFF` per ottenere la word originale.
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

  // Stato GameState non strettamente usato (FUN_1E64 non tocca workRam),
  // ma createCpu lo richiede. Usiamo emptyGameState.
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
    // Pre-init alpha RAM con sentinel (FUN_32BA scriverà sopra; non
    // confrontiamo alphaRam ma azzeriamo per non confondere repeated-runs).
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

  // ─── Suite A: count piccolo (1..4), charCode random low ──────────────
  console.log(
    `\n=== renderGlyphLoop1E64 (FUN_1E64) — Suite A: count 1..4 random — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    // bufPtr in alpha tilemap, allineato a 2 (ma il binario non richiede
    // allineamento — D4 è solo additionato, mai dereferenced qui).
    const bufPtr = (0x00a03000 + (Math.floor(rng() * 0x700) & ~1)) >>> 0;
    const charCode = Math.floor(rng() * 0x80) & 0xffff;
    const count = 1 + Math.floor(rng() * 4);
    if (runOneCase("A", i, bufPtr, charCode, count)) okA++;
  }
  console.log(
    `  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okA;

  // ─── Suite B: charCode che cross-a il narrow boundary ────────────────
  console.log(
    `\n=== Suite B: charCode cross narrow boundary [0x26, 0x2D] — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const bufPtr = (0x00a03000 + (Math.floor(rng() * 0x700) & ~1)) >>> 0;
    // charCode start in [0x20, 0x32], count tale da cross-are il range.
    const charCode = 0x20 + Math.floor(rng() * 0x13); // 0x20..0x32
    const count = 2 + Math.floor(rng() * 8); // 2..9
    if (runOneCase("B", i, bufPtr, charCode, count)) okB++;
  }
  console.log(
    `  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okB;

  // ─── Suite C: count medio, charCode wide-only ────────────────────────
  console.log(
    `\n=== Suite C: count 5..12, charCode wide-only — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const bufPtr = (0x00a03000 + (Math.floor(rng() * 0x600) & ~1)) >>> 0;
    // charCode in 0x30..0x7E (sicuramente wide, fuori da [0x26, 0x2D])
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
    `\n=== Suite D: edge cases (count 0/1, boundary, signed-neg) — ${sizeD} casi ===`,
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
      // charCode che wrap a 16-bit (start vicino a 0xFFFF)
      charCode = (0xfff0 + Math.floor(rng() * 0x10)) & 0xffff;
      count = 2 + Math.floor(rng() * 4);
    } else {
      // count negativo (0x8000..0xFFFF) → no-op signed (D2 ≤ 0)
      charCode = Math.floor(rng() * 0x100) & 0xffff;
      count = (0x8000 + Math.floor(rng() * 0x8000)) & 0xffff;
    }
    if (runOneCase("D", i, bufPtr, charCode, count)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
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
