#!/usr/bin/env node
/**
 * test-state-validate-grid-15db6-parity.ts — differential FUN_15DB6 vs
 * `stateValidateGrid15DB6`.
 *
 * `FUN_00015DB6` (110 byte) valida la match-cell of the currentPtr vs
 * field_x/field_y >> 19 of the struct, possibly mutating `kind` 0x23 → 0x20,
 * poi dispatcha a una of:
 *
 * **Strategia stub injection**:
 *
 *      uno slot @ `0x401E00` (4 byte structPtr + 4 byte counter @ 0x401E04).
 *
 *      Layout stub (22 byte):
 *        movea.l #0x00401E00, A0      ; 207C 0040 1E00     (6 byte)
 *        move.l  0x00401E04.l, D0     ; 2039 0040 1E04     (6 byte) (counter)
 *        ; structPtr in ((4,SP)) → A0[counter*4]
 *        move.l  (4,SP), (A0)         ; 20AF 0004          (4 byte)
 *        addq.l  #1, 0x00401E04.l     ; 52B9 0040 1E04     (6 byte)
 *        rts                           ; 4E75               (2 byte)
 *
 *      of the case). Stub minimale (8 byte):
 *
 *        addq.l  #1, 0x00401E00.l     ; 52B9 0040 1E00     (6 byte)
 *        rts                           ; 4E75               (2 byte)
 *
 *      slot @ `0x401E10`:
 *        - `0x401E10` (long): structPtr received as arg1
 *        - `0x401E14` (long): flagLong received as arg2
 *
 *      Stack al momento of the JSR a FUN_15E24 from the caller (FUN_15DB6):
 *        (0,SP)  = ret addr
 *        (4,SP)  = arg1 (structPtr) — long
 *        (8,SP)  = arg2 (flagLong)  — long
 *
 *      Layout stub:
 *        ; save arg1, arg2 in slot
 *        move.l  (4,SP), 0x00401E10.l    ; 23EF 0004 0040 1E10  (8 byte)
 *        move.l  (8,SP), 0x00401E14.l    ; 23EF 0008 0040 1E14  (8 byte)
 *        addq.l  #1, 0x00401E18.l        ; 52B9 0040 1E18       (6 byte)
 *        rts                              ; 4E75                  (2 byte)
 *        TOTAL: 24 byte.
 *
 *      `move.l (offset,SP), abs.L` opcode = 23EF (move.l (d16,An), abs.L
 *      with An=A7=SP). Encoding: 23EF dddd LLLL (16-bit displacement,
 *      32-bit absolute address) — 8 byte.
 *
 * struct kind byte (per verificare la mutazione 0x23→0x20).
 *
 *   - A: setup random byte-by-byte (struct + currentPtr + kind random).
 *        Cattura mismatch generico.
 *   - B: forced match (currentPtr[0..1] = field_x/y >> 19) with random kind.
 *
 * Uso: npx tsx packages/cli/src/test-state-validate-grid-15db6-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateValidateGrid15DB6 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_15DB6 = 0x00015db6;
const FUN_15D10 = 0x00015d10;
const FUN_15E24 = 0x00015e24;

const WORK_RAM_BASE = 0x00400000;

// ─── Logger zones ──────────────────────────────────────────────────────────
const SLOT_15D10_CNT = 0x00401e00;
/** Slot fun_15e24: structPtr (long). */
const SLOT_15E24_PTR = 0x00401e10;
/** Slot fun_15e24: flagLong (long). */
const SLOT_15E24_FLAG = 0x00401e14;
const SLOT_15E24_CNT = 0x00401e18;
const LOGGER_BASE = 0x00401e00;
const LOGGER_SIZE = 0x20;

// ─── Struct under test ─────────────────────────────────────────────────────
const STRUCT_BASE = 0x00400500;
const STRUCT_SIZE = 0x80;
const CURRENT_PTR_BASE = 0x00401000;
const CURRENT_PTR_SIZE = 0x10;

const FIELD_X_OFF = 0x0c;
const FIELD_Y_OFF = 0x10;
const KIND_OFF = 0x1a;
const CURRENT_PTR_OFF = 0x6e;
const ASR_COUNT = 0x13;

/** Patch FUN_15D10 to a thunk logger (8 bytes): increments counter @ 0x401E00. */
function patchFun15D10(cpu: CpuSession): void {
  const bytes = [
    // addq.l #1, 0x00401E00.l        (52B9 0040 1E00)
    0x52, 0xb9, 0x00, 0x40, 0x1e, 0x00,
    // rts                             (4E75)
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_15D10 + i, 1, bytes[i]!);
  }
}

/** Patch FUN_15E24 a thunk-logger (24 byte). */
function patchFun15E24(cpu: CpuSession): void {
  const bytes = [
    // move.l (4,SP), 0x00401E10.l    (23EF 0004 0040 1E10) — 8 byte
    0x23, 0xef, 0x00, 0x04, 0x00, 0x40, 0x1e, 0x10,
    // move.l (8,SP), 0x00401E14.l    (23EF 0008 0040 1E14) — 8 byte
    0x23, 0xef, 0x00, 0x08, 0x00, 0x40, 0x1e, 0x14,
    // addq.l #1, 0x00401E18.l        (52B9 0040 1E18)      — 6 byte
    0x52, 0xb9, 0x00, 0x40, 0x1e, 0x18,
    // rts                             (4E75)                — 2 byte
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_15E24 + i, 1, bytes[i]!);
  }
}

function patchSubs(cpu: CpuSession): void {
  patchFun15D10(cpu);
  patchFun15E24(cpu);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Reset zone osservate (struct + currentPtr area + logger). */
function resetZones(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  for (let i = 0; i < STRUCT_SIZE; i++) {
    pokeMem(cpu, STRUCT_BASE + i, 1, 0);
    state.workRam[STRUCT_BASE + i - WORK_RAM_BASE] = 0;
  }
  for (let i = 0; i < CURRENT_PTR_SIZE; i++) {
    pokeMem(cpu, CURRENT_PTR_BASE + i, 1, 0);
    state.workRam[CURRENT_PTR_BASE + i - WORK_RAM_BASE] = 0;
  }
  for (let i = 0; i < LOGGER_SIZE; i++) {
    pokeMem(cpu, LOGGER_BASE + i, 1, 0);
    state.workRam[LOGGER_BASE + i - WORK_RAM_BASE] = 0;
  }
}

function pokeLongBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  const off = abs - WORK_RAM_BASE;
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

function pokeByteBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  pokeMem(cpu, abs, 1, v & 0xff);
  state.workRam[abs - WORK_RAM_BASE] = v & 0xff;
}

function compareZone(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  base: number,
  size: number,
  label: string,
): { offset: number; bin: number; ts: number; label: string } | null {
  for (let i = 0; i < size; i++) {
    const b = peekMem(cpu, base + i, 1) & 0xff;
    const t = state.workRam[base + i - WORK_RAM_BASE] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t, label };
  }
  return null;
}

interface CaseSetup {
  /** Bytes of the struct (size STRUCT_SIZE). */
  structBytes: number[];
  /** Bytes of the area currentPtr (size CURRENT_PTR_SIZE). */
  currentBytes: number[];
}

/** Setup random + override opzionali. */
function buildCase(
  rng: () => number,
  opts: {
    forceMatch?: boolean;
    forceMismatch?: boolean;
    kindOverride?: number;
  } = {},
): CaseSetup {
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  const structBytes: number[] = new Array(STRUCT_SIZE).fill(0).map(() => rb());
  const currentBytes: number[] = new Array(CURRENT_PTR_SIZE)
    .fill(0)
    .map(() => rb());

  const writeLong = (arr: number[], off: number, v: number): void => {
    const u = v >>> 0;
    arr[off] = (u >>> 24) & 0xff;
    arr[off + 1] = (u >>> 16) & 0xff;
    arr[off + 2] = (u >>> 8) & 0xff;
    arr[off + 3] = u & 0xff;
  };

  // currentPtr (long @ +0x6E) = CURRENT_PTR_BASE
  writeLong(structBytes, CURRENT_PTR_OFF, CURRENT_PTR_BASE);

  // field_x, field_y random
  let fieldX = rl();
  let fieldY = rl();
  writeLong(structBytes, FIELD_X_OFF, fieldX);
  writeLong(structBytes, FIELD_Y_OFF, fieldY);

  if (opts.forceMatch === true) {
    // currentPtr[0..1] = byte signed-ext-equal a (field >> 19)
    // signed byte (-128..127), poi field = target << 19, byte = target & 0xFF.
    const targetX = (Math.floor(rng() * 256) - 128) | 0; // -128..127
    const targetY = (Math.floor(rng() * 256) - 128) | 0;
    fieldX = (targetX << ASR_COUNT) >>> 0;
    fieldY = (targetY << ASR_COUNT) >>> 0;
    writeLong(structBytes, FIELD_X_OFF, fieldX);
    writeLong(structBytes, FIELD_Y_OFF, fieldY);
    currentBytes[0] = targetX & 0xff;
    currentBytes[1] = targetY & 0xff;
  } else if (opts.forceMismatch === true) {
    // Garantisce X mismatch — currentPtr[0] = (asr(fieldX,19) + 1) & 0xFF
    const cellX = (((fieldX | 0) >> ASR_COUNT) | 0) & 0xff;
    currentBytes[0] = (cellX + 1) & 0xff;
  }

  if (opts.kindOverride !== undefined) {
    structBytes[KIND_OFF] = opts.kindOverride & 0xff;
  }

  return { structBytes, currentBytes };
}

function applyCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  c: CaseSetup,
): void {
  for (let i = 0; i < STRUCT_SIZE; i++) {
    pokeByteBoth(state, cpu, STRUCT_BASE + i, c.structBytes[i] ?? 0);
  }
  for (let i = 0; i < CURRENT_PTR_SIZE; i++) {
    pokeByteBoth(state, cpu, CURRENT_PTR_BASE + i, c.currentBytes[i] ?? 0);
  }
  void pokeLongBoth;
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

  const subs: ns.StateValidateGrid15DB6Subs = {
    fun_15d10: (_structPtr) => {
      const r = state.workRam;
      const cntOff = SLOT_15D10_CNT - WORK_RAM_BASE;
      const cur =
        (((r[cntOff] ?? 0) << 24) |
          ((r[cntOff + 1] ?? 0) << 16) |
          ((r[cntOff + 2] ?? 0) << 8) |
          (r[cntOff + 3] ?? 0)) >>>
        0;
      const next = (cur + 1) >>> 0;
      r[cntOff] = (next >>> 24) & 0xff;
      r[cntOff + 1] = (next >>> 16) & 0xff;
      r[cntOff + 2] = (next >>> 8) & 0xff;
      r[cntOff + 3] = next & 0xff;
    },
    fun_15e24: (structPtr, flagLong) => {
      const r = state.workRam;
      const writeLong = (abs: number, v: number): void => {
        const off = abs - WORK_RAM_BASE;
        const u = v >>> 0;
        r[off] = (u >>> 24) & 0xff;
        r[off + 1] = (u >>> 16) & 0xff;
        r[off + 2] = (u >>> 8) & 0xff;
        r[off + 3] = u & 0xff;
      };
      writeLong(SLOT_15E24_PTR, structPtr);
      writeLong(SLOT_15E24_FLAG, flagLong);
      const cntOff = SLOT_15E24_CNT - WORK_RAM_BASE;
      const cur =
        (((r[cntOff] ?? 0) << 24) |
          ((r[cntOff + 1] ?? 0) << 16) |
          ((r[cntOff + 2] ?? 0) << 8) |
          (r[cntOff + 3] ?? 0)) >>>
        0;
      const next = (cur + 1) >>> 0;
      r[cntOff] = (next >>> 24) & 0xff;
      r[cntOff + 1] = (next >>> 16) & 0xff;
      r[cntOff + 2] = (next >>> 8) & 0xff;
      r[cntOff + 3] = next & 0xff;
    },
  };

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    diff: { offset: number; bin: number; ts: number; label: string };
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tc: number, c: CaseSetup): boolean {
    cpu.system.setRegister("sp", 0x401f80);
    resetZones(state, cpu);
    applyCase(state, cpu, c);

    callFunction(cpu, FUN_15DB6, [STRUCT_BASE >>> 0]);
    ns.stateValidateGrid15DB6(state, STRUCT_BASE >>> 0, subs);

    const loggerDiff = compareZone(
      state,
      cpu,
      LOGGER_BASE,
      LOGGER_SIZE,
      "logger",
    );
    if (loggerDiff !== null) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, diff: loggerDiff };
      }
      return false;
    }
    const structDiff = compareZone(
      state,
      cpu,
      STRUCT_BASE,
      STRUCT_SIZE,
      "struct",
    );
    if (structDiff !== null) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, diff: structDiff };
      }
      return false;
    }
    // currentPtr area must remain intact.
    const cpDiff = compareZone(
      state,
      cpu,
      CURRENT_PTR_BASE,
      CURRENT_PTR_SIZE,
      "currentPtr",
    );
    if (cpDiff !== null) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, diff: cpDiff };
      }
      return false;
    }
    return true;
  }

  const rng = makeRng(0x15db6);

  // ─── Suite A: random everything ──────────────────────────────────────
  console.log(
    `\n=== stateValidateGrid15DB6 (FUN_15DB6) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const c = buildCase(rng);
    if (runOneCase("A", i, c)) okA++;
  }
  console.log(
    `  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okA;

  // ─── Suite B: forced match (cell ↔ field) with random kind ─────────────
  console.log(
    `\n=== Suite B: forced match (cell ↔ field>>19) con kind random — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const c = buildCase(rng, { forceMatch: true });
    if (runOneCase("B", i, c)) okB++;
  }
  console.log(
    `  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okB;

  console.log(
    `\n=== Suite C: forced match + kind = 0x23 → mutazione — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const c = buildCase(rng, { forceMatch: true, kindOverride: 0x23 });
    if (runOneCase("C", i, c)) okC++;
  }
  console.log(
    `  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okC;

  // ─── Suite D: forced mismatch + kind = 0x23 (capture fun_15d10) ────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: forced mismatch + kind = 0x23 → fun_15d10 — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const c = buildCase(rng, { forceMismatch: true, kindOverride: 0x23 });
    if (runOneCase("D", i, c)) okD++;
  }
  console.log(
    `  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`,
  );
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): ${f.diff.label}+0x${f.diff.offset.toString(16)} ` +
        `bin=0x${f.diff.bin.toString(16)} ts=0x${f.diff.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
