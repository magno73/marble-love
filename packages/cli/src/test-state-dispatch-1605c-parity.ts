#!/usr/bin/env node
/**
 * test-state-dispatch-1605c-parity.ts — differential FUN_1605C vs
 * `stateDispatch1605C`.
 *
 * `FUN_0001605C` (82 byte) è un mini-dispatcher a 3 vie sul byte
 * @ A2+0x1A (kind):
 *   - 0x20         → fun_160ae(A2, 0)
 *   - 0x21         → no-op
 *   - 0x22         → fun_160ae(A2, fun_15c46(A2))
 *   - 0..0x1F      → no-op (blt signed)
 *   - 0x23..0x7F   → no-op (cmpa fall-through)
 *   - 0x80..0xFF   → no-op (blt signed; signExt(byte) negativo)
 *
 * **Strategia stub injection**:
 *
 *   1. **FUN_15C46** patchata a thunk-loader che ritorna in D0 il long
 *      letto da `0x401E40` (slot "fun_15c46_ret"). Il test pre-popola
 *      questo slot con un long random per ogni caso.
 *
 *      Layout stub (8 byte):
 *        move.l 0x00401E40.l, D0    ; 2039 0040 1E40   (6 byte)
 *        rts                         ; 4E75            (2 byte)
 *
 *   2. **FUN_160AE** patchata a thunk-logger che scrive
 *      `(structPtrLong, byteIdxLong)` in un ring-buffer @ `0x401E00`,
 *      avanzando un counter @ `0x401E48` di +8 ad ogni chiamata.
 *      Il dispatcher chiama fun_160ae al massimo 1 volta per invocazione,
 *      ma usiamo un ring per coerenza col pattern di altre parity-test.
 *
 *      Layout stub (30 byte):
 *        movea.l #0x00401E00, A0       ; 207C 0040 1E00   (6 byte)
 *        move.l  0x00401E48.l, D1      ; 2239 0040 1E48   (6 byte)
 *        adda.l  D1, A0                ; D1C1             (2 byte)
 *        move.l  (4,SP), (A0)+         ; 20EF 0004        (4 byte)
 *        move.l  (8,SP), (A0)          ; 20AF 0008        (4 byte)
 *        addq.l  #8, 0x00401E48.l      ; 50B9 0040 1E48   (6 byte)
 *        rts                           ; 4E75             (2 byte)
 *
 *   FUN_160AE (38 byte: 0x160AE..0x160D3) e FUN_15C46 (~250 byte) sono
 *   abbondantemente più grandi degli stub.
 *
 * **Suite testate (4 × 125 = 500 casi)**:
 *   - A: kind random in {0x20, 0x21, 0x22} (i 3 valori di branch attivi)
 *   - B: kind random in [0x00..0x1F] ∪ [0x23..0x7F] (no-op signed≥0)
 *   - C: kind random in [0x80..0xFF] (no-op signed<0 via blt)
 *   - D: kind = 0x22 con valori f15c46_ret pathologici (0, 0xFFFFFFFF,
 *        0x80000000, 0x7FFFFFFF, valori random)
 *
 * **Confronto**: workRam @ ring buffer + counter + struct kind byte.
 * Ring + counter sono i "log" identici tra binario e TS (TS callback scrive
 * negli stessi offset).
 *
 * Uso: npx tsx packages/cli/src/test-state-dispatch-1605c-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateDispatch1605C as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1605C = 0x0001605c;
const FUN_15C46 = 0x00015c46;
const FUN_160AE = 0x000160ae;

/** Ring buffer per fun_160ae args (max 16 chiamate × 8 byte = 128 byte). */
const RING_BASE = 0x00401e00;
const RING_COUNTER = 0x00401e48;
/** Slot per la "return value" di fun_15c46 (long BE). */
const FUN15C46_RET = 0x00401e40;

/** Patch FUN_15C46 col thunk-loader (8 byte). */
function patchFun15C46(cpu: CpuSession): void {
  const bytes = [
    // move.l 0x00401E40.l, D0     (2039 0040 1E40)
    0x20, 0x39, 0x00, 0x40, 0x1e, 0x40,
    // rts                          (4E75)
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_15C46 + i, 1, bytes[i]!);
  }
}

/** Patch FUN_160AE col thunk-logger (30 byte). */
function patchFun160AE(cpu: CpuSession): void {
  const bytes = [
    // movea.l #0x00401E00, A0           (207C 0040 1E00)
    0x20, 0x7c, 0x00, 0x40, 0x1e, 0x00,
    // move.l  0x00401E48.l, D1          (2239 0040 1E48)
    0x22, 0x39, 0x00, 0x40, 0x1e, 0x48,
    // adda.l  D1, A0                    (D1C1)
    0xd1, 0xc1,
    // move.l  (4,SP), (A0)+             (20EF 0004)
    0x20, 0xef, 0x00, 0x04,
    // move.l  (8,SP), (A0)              (20AF 0008)
    0x20, 0xaf, 0x00, 0x08,
    // addq.l  #8, 0x00401E48.l          (50B9 0040 1E48)
    0x50, 0xb9, 0x00, 0x40, 0x1e, 0x48,
    // rts                               (4E75)
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_160AE + i, 1, bytes[i]!);
  }
}

function patchSubs(cpu: CpuSession): void {
  patchFun15C46(cpu);
  patchFun160AE(cpu);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

const STRUCT_BASE = 0x00400500; // ptr struct in workRam (lontano dal ring)
const STRUCT_KIND_OFF = 0x1a;

const RING_SIZE_BYTES = 128;
const RING_BASE_OFF = RING_BASE - 0x400000;
const RING_COUNTER_OFF = RING_COUNTER - 0x400000;
const FUN15C46_RET_OFF = FUN15C46_RET - 0x400000;
const STRUCT_BASE_OFF = STRUCT_BASE - 0x400000;

/** Reset zone osservate (ring + counter + retVal slot + kind byte). */
function resetZones(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  // Ring (128 byte) + counter (4 byte)
  for (let i = 0; i < RING_SIZE_BYTES; i++) {
    pokeMem(cpu, RING_BASE + i, 1, 0);
    state.workRam[RING_BASE_OFF + i] = 0;
  }
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, RING_COUNTER + i, 1, 0);
    state.workRam[RING_COUNTER_OFF + i] = 0;
  }
  // Struct kind byte (e qualche byte attorno per safety)
  for (let i = 0; i < 0x40; i++) {
    pokeMem(cpu, STRUCT_BASE + i, 1, 0);
    state.workRam[STRUCT_BASE_OFF + i] = 0;
  }
}

/** Scrive long-BE in workRam binario+TS. */
function pokeLongBoth(
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

/** Scrive byte in workRam binario+TS. */
function pokeByteBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  pokeMem(cpu, abs, 1, v & 0xff);
  state.workRam[abs - 0x400000] = v & 0xff;
}

/** Confronta byte-by-byte la zona [base..base+size) tra binario e TS. */
function compareZone(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  base: number,
  size: number,
  label: string,
): { offset: number; bin: number; ts: number; label: string } | null {
  for (let i = 0; i < size; i++) {
    const b = peekMem(cpu, base + i, 1) & 0xff;
    const t = state.workRam[(base - 0x400000) + i] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t, label };
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

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });
  patchSubs(cpu);

  // TS subs: replicano il side-effect dello stub binario sul workRam.
  // Nota: lavoriamo direttamente su `state.workRam` (gli stub binari
  // scrivono in memoria assoluta che corrisponde ad offset workRam).
  const subs: ns.StateDispatch1605CSubs = {
    fun_15c46: (_structPtr) => {
      // Legge long-BE @ 0x401E40 dal state.workRam.
      const r = state.workRam;
      const v =
        (((r[FUN15C46_RET_OFF] ?? 0) << 24) |
          ((r[FUN15C46_RET_OFF + 1] ?? 0) << 16) |
          ((r[FUN15C46_RET_OFF + 2] ?? 0) << 8) |
          (r[FUN15C46_RET_OFF + 3] ?? 0)) >>>
        0;
      return v;
    },
    fun_160ae: (structPtr, byteIdx) => {
      // Replica esatta dello stub binario: scrive (structPtr, byteIdx) nel
      // ring @ counter, poi counter += 8.
      const r = state.workRam;
      const counter =
        (((r[RING_COUNTER_OFF] ?? 0) << 24) |
          ((r[RING_COUNTER_OFF + 1] ?? 0) << 16) |
          ((r[RING_COUNTER_OFF + 2] ?? 0) << 8) |
          (r[RING_COUNTER_OFF + 3] ?? 0)) >>>
        0;
      const off = (RING_BASE_OFF + counter) >>> 0;
      const writeLong = (base: number, val: number): void => {
        const u = val >>> 0;
        r[base] = (u >>> 24) & 0xff;
        r[base + 1] = (u >>> 16) & 0xff;
        r[base + 2] = (u >>> 8) & 0xff;
        r[base + 3] = u & 0xff;
      };
      writeLong(off, structPtr);
      writeLong(off + 4, byteIdx);
      const next = (counter + 8) >>> 0;
      r[RING_COUNTER_OFF] = (next >>> 24) & 0xff;
      r[RING_COUNTER_OFF + 1] = (next >>> 16) & 0xff;
      r[RING_COUNTER_OFF + 2] = (next >>> 8) & 0xff;
      r[RING_COUNTER_OFF + 3] = next & 0xff;
    },
  };

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    kind: number;
    fun15c46Ret: number;
    diff: { offset: number; bin: number; ts: number; label: string };
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    kindByte: number,
    fun15c46Ret: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    resetZones(state, cpu);
    // Setup struct: kind byte @ STRUCT_BASE+0x1A.
    pokeByteBoth(state, cpu, STRUCT_BASE + STRUCT_KIND_OFF, kindByte);
    // Setup fun_15c46 ret-val slot.
    pokeLongBoth(state, cpu, FUN15C46_RET, fun15c46Ret);

    callFunction(cpu, FUN_1605C, [STRUCT_BASE >>> 0]);
    ns.stateDispatch1605C(state, STRUCT_BASE >>> 0, subs);

    // Confronta ring + counter.
    const ringDiff = compareZone(state, cpu, RING_BASE, RING_SIZE_BYTES, "ring");
    if (ringDiff !== null) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          kind: kindByte,
          fun15c46Ret,
          diff: ringDiff,
        };
      }
      return false;
    }
    const ctrDiff = compareZone(state, cpu, RING_COUNTER, 4, "counter");
    if (ctrDiff !== null) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          kind: kindByte,
          fun15c46Ret,
          diff: ctrDiff,
        };
      }
      return false;
    }
    // Confronta anche kind byte (deve essere intatto).
    const kbDiff = compareZone(state, cpu, STRUCT_BASE, 0x40, "struct");
    if (kbDiff !== null) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          kind: kindByte,
          fun15c46Ret,
          diff: kbDiff,
        };
      }
      return false;
    }
    return true;
  }

  const rng = makeRng(0x1605c);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  // ── Suite A: kind ∈ {0x20, 0x21, 0x22} ────────────────────────────────
  console.log(
    `\n=== stateDispatch1605C (FUN_1605C) — Suite A: kind ∈ {0x20,0x21,0x22} — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const kind = [0x20, 0x21, 0x22][Math.floor(rng() * 3)]!;
    const ret = rl();
    if (runOneCase("A", i, kind, ret)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ── Suite B: kind ∈ [0x00..0x1F] ∪ [0x23..0x7F] (no-op signed≥0) ─────
  console.log(
    `\n=== Suite B: kind no-op signed≥0 ([0..0x1F]∪[0x23..0x7F]) — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    let kind: number;
    do {
      kind = rb() & 0x7f;
    } while (kind >= 0x20 && kind <= 0x22);
    const ret = rl();
    if (runOneCase("B", i, kind, ret)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ── Suite C: kind ∈ [0x80..0xFF] (no-op signed<0) ────────────────────
  console.log(
    `\n=== Suite C: kind ∈ [0x80..0xFF] (signed<0 → blt no-op) — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const kind = 0x80 | (rb() & 0x7f);
    const ret = rl();
    if (runOneCase("C", i, kind, ret)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ── Suite D: kind = 0x22 con valori f15c46_ret pathologici ───────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: kind=0x22 + retVal pathologici — ${sizeD} casi ===`,
  );
  const pathologicalRets = [
    0x00000000, 0xffffffff, 0x80000000, 0x7fffffff, 0x00000001, 0x00010000,
    0x0000ffff, 0xffff0000, 0xdeadbeef, 0xcafebabe,
  ];
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const ret =
      i < pathologicalRets.length ? pathologicalRets[i]! >>> 0 : rl();
    if (runOneCase("D", i, 0x22, ret)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): ${f.diff.label}+0x${f.diff.offset.toString(16)} ` +
      `bin=0x${f.diff.bin.toString(16)} ts=0x${f.diff.ts.toString(16)} ` +
      `kind=0x${f.kind.toString(16)} fun15c46Ret=0x${f.fun15c46Ret.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
