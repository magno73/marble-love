#!/usr/bin/env node
/**
 * test-state-sub-15670-parity.ts — differential FUN_15670 vs `stateSub15670`.
 *
 * @ 0x400396, stride 0xE2), filters active candidates, and checks each one
 * collision with marble-slot @ 0x401302 (4 x 0x60), and if at least one candidate
 *
 * **Strategia stub injection**:
 *
 *      controllato. Il TS reimpl usa `compareObjDepth` di default ma noi
 *
 *      Layout stub (8 byte):
 *        move.l 0x00401E40.l, D0    ; 2039 0040 1E40   (6 byte)
 *        rts                         ; 4E75            (2 byte)
 *
 *
 *      Layout stub (26 byte):
 *        movea.l #0x00401E00, A0       ; 207C 0040 1E00   (6 byte)
 *        move.l  0x00401E48.l, D1      ; 2239 0040 1E48   (6 byte)
 *        adda.l  D1, A0                ; D1C1             (2 byte)
 *        move.l  (4,SP), (A0)+         ; 20EF 0004        (4 byte)
 *        addq.l  #4, 0x00401E48.l      ; 58B9 0040 1E48   (6 byte)
 *                                       ; (addq.l #4: ddd=4 → opcode 58B9
 *                                       ;  vs addq.l #8: ddd=0 → opcode 50B9)
 *        rts                           ; 4E75             (2 byte)
 *
 *
 *   - B: count = 1 with a candidate that TRIGGERS (random distance in
 *   - C: count = 1 with a candidate BLOCKED by at least 1 marble-slot collision
 *   - D: count = 2 with both candidates valid -> triggers FUN_15FE6
 *
 *   ring buffer FUN_15460, counter, e fun_15fe6_ret slot.
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-15670-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub15670 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_15670 = 0x00015670;
const FUN_15FE6 = 0x00015fe6;
const FUN_15460 = 0x00015460;

/** Ring buffer per fun_15460 args. */
const RING_BASE = 0x00401e00;
const RING_COUNTER = 0x00401e48;
/** Slot per la return value di FUN_15FE6. */
const FUN15FE6_RET = 0x00401e40;

const RING_SIZE_BYTES = 64;
const RING_BASE_OFF = RING_BASE - 0x400000;
const RING_COUNTER_OFF = RING_COUNTER - 0x400000;
const FUN15FE6_RET_OFF = FUN15FE6_RET - 0x400000;

const ARG_BASE = 0x00401a00;

/** Patch FUN_15FE6 col thunk-loader (8 byte). */
function patchFun15FE6(cpu: CpuSession): void {
  const bytes = [
    0x20, 0x39, 0x00, 0x40, 0x1e, 0x40, // move.l 0x00401E40.l, D0
    0x4e, 0x75,                          // rts
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_15FE6 + i, 1, bytes[i]!);
  }
}

/** Patch FUN_15460 col thunk-logger (22 byte). */
function patchFun15460(cpu: CpuSession): void {
  const bytes = [
    0x20, 0x7c, 0x00, 0x40, 0x1e, 0x00,  // movea.l #0x00401E00, A0
    0x22, 0x39, 0x00, 0x40, 0x1e, 0x48,  // move.l 0x00401E48.l, D1
    0xd1, 0xc1,                            // adda.l D1, A0
    0x20, 0xef, 0x00, 0x04,                // move.l (4,SP), (A0)+
    0x58, 0xb9, 0x00, 0x40, 0x1e, 0x48,  // addq.l #4, 0x00401E48.l
    0x4e, 0x75,                            // rts
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_15460 + i, 1, bytes[i]!);
  }
}

function patchSubs(cpu: CpuSession): void {
  patchFun15FE6(cpu);
  patchFun15460(cpu);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

const OBJ_ARRAY_BASE = 0x00400018;
const OBJ_STRIDE = 0xe2;
const OBJ_COUNT_ADDR = 0x00400396;
const SLOT_ARRAY_BASE = 0x00401302;
const SLOT_STRIDE = 0x60;

function pokeBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  size: 1 | 2 | 4,
  v: number,
): void {
  const off = abs - 0x400000;
  const u = v >>> 0;
  if (size === 1) {
    pokeMem(cpu, abs, 1, u & 0xff);
    state.workRam[off] = u & 0xff;
  } else if (size === 2) {
    pokeMem(cpu, abs, 2, u & 0xffff);
    state.workRam[off] = (u >>> 8) & 0xff;
    state.workRam[off + 1] = u & 0xff;
  } else {
    pokeMem(cpu, abs, 4, u);
    state.workRam[off] = (u >>> 24) & 0xff;
    state.workRam[off + 1] = (u >>> 16) & 0xff;
    state.workRam[off + 2] = (u >>> 8) & 0xff;
    state.workRam[off + 3] = u & 0xff;
  }
}

/** Reset zone osservate + zero workRam range [0x000..0x1FFF]. */
function resetAll(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  // Wipe workRam intero (TS)
  state.workRam.fill(0);
  // Wipe Musashi memory in workRam range. NB: poke long a 4 byte allineati.
  for (let i = 0; i < 0x2000; i += 4) {
    pokeMem(cpu, 0x400000 + i, 4, 0);
  }
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

  const subs: ns.StateSub15670Subs = {
    fun_15fe6: (_p0, _p1) => {
      const r = state.workRam;
      return (
        (((r[FUN15FE6_RET_OFF] ?? 0) << 24) |
          ((r[FUN15FE6_RET_OFF + 1] ?? 0) << 16) |
          ((r[FUN15FE6_RET_OFF + 2] ?? 0) << 8) |
          (r[FUN15FE6_RET_OFF + 3] ?? 0)) |
        0
      );
    },
    fun_15460: (structPtr) => {
      // poi counter += 4.
      const r = state.workRam;
      const counter =
        (((r[RING_COUNTER_OFF] ?? 0) << 24) |
          ((r[RING_COUNTER_OFF + 1] ?? 0) << 16) |
          ((r[RING_COUNTER_OFF + 2] ?? 0) << 8) |
          (r[RING_COUNTER_OFF + 3] ?? 0)) >>>
        0;
      const off = (RING_BASE_OFF + counter) >>> 0;
      const u = structPtr >>> 0;
      r[off] = (u >>> 24) & 0xff;
      r[off + 1] = (u >>> 16) & 0xff;
      r[off + 2] = (u >>> 8) & 0xff;
      r[off + 3] = u & 0xff;
      const next = (counter + 4) >>> 0;
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
    diff: { offset: number; bin: number; ts: number; label: string };
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    setup: (
      state: ReturnType<typeof stateNs.emptyGameState>,
      cpu: CpuSession,
    ) => void,
    fun15fe6Ret: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    resetAll(state, cpu);
    setup(state, cpu);

    // Patch fun_15fe6 ret slot
    pokeBoth(state, cpu, FUN15FE6_RET, 4, fun15fe6Ret);

    // Run binary
    callFunction(cpu, FUN_15670, [ARG_BASE >>> 0]);

    // Run TS
    ns.stateSub15670(state, ARG_BASE >>> 0, subs);

    // Compare zones in priority order
    const z1 = compareZone(state, cpu, RING_BASE, RING_SIZE_BYTES, "ring");
    if (z1) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, diff: z1 };
      }
      return false;
    }
    const z2 = compareZone(state, cpu, RING_COUNTER, 4, "ring_counter");
    if (z2) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, diff: z2 };
      }
      return false;
    }
    // arg+0x56 (word, written sometimes) and arg+0x1A (byte, written on trigger)
    const z3 = compareZone(state, cpu, ARG_BASE + 0x56, 2, "arg.0x56");
    if (z3) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, diff: z3 };
      }
      return false;
    }
    const z4 = compareZone(state, cpu, ARG_BASE + 0x1a, 1, "arg.0x1A");
    if (z4) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, diff: z4 };
      }
      return false;
    }
    return true;
  }

  const rng = makeRng(0x15670);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  // Helper: setup obj fully populated (passes filters).
  function setupObj(
    state: ReturnType<typeof stateNs.emptyGameState>,
    cpu: CpuSession,
    objAbs: number,
    opts: {
      state: number;       // byte 0x18
      flag19: number;       // byte 0x19
      kind: number;         // byte 0x1A
      zorder: number;       // byte 0x1B
      field36: number;      // byte 0x36
      x: number;            // long 0x00 (signed)
      y: number;            // long 0x04 (signed)
      fx: number;           // long 0x0C (signed)
      fy: number;           // long 0x10 (signed)
    },
  ): void {
    pokeBoth(state, cpu, objAbs + 0x00, 4, opts.x);
    pokeBoth(state, cpu, objAbs + 0x04, 4, opts.y);
    pokeBoth(state, cpu, objAbs + 0x0c, 4, opts.fx);
    pokeBoth(state, cpu, objAbs + 0x10, 4, opts.fy);
    pokeBoth(state, cpu, objAbs + 0x18, 1, opts.state);
    pokeBoth(state, cpu, objAbs + 0x19, 1, opts.flag19);
    pokeBoth(state, cpu, objAbs + 0x1a, 1, opts.kind);
    pokeBoth(state, cpu, objAbs + 0x1b, 1, opts.zorder);
    pokeBoth(state, cpu, objAbs + 0x36, 1, opts.field36);
  }

  function setupArg(
    state: ReturnType<typeof stateNs.emptyGameState>,
    cpu: CpuSession,
    opts: { zorder: number; fx: number; fy: number; preKind?: number; preF56?: number },
  ): void {
    pokeBoth(state, cpu, ARG_BASE + 0x0c, 4, opts.fx);
    pokeBoth(state, cpu, ARG_BASE + 0x10, 4, opts.fy);
    pokeBoth(state, cpu, ARG_BASE + 0x1a, 1, opts.preKind ?? 0x99);
    pokeBoth(state, cpu, ARG_BASE + 0x1b, 1, opts.zorder);
    pokeBoth(state, cpu, ARG_BASE + 0x56, 2, opts.preF56 ?? 0xdead);
  }

  // ── Suite A: count = 0 ────────────────────────────────────────────────
  console.log(
    `\n=== stateSub15670 (FUN_15670) — Suite A: count == 0 — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const ret = rl();
    if (
      runOneCase(
        "A",
        i,
        (st, cp) => {
          pokeBoth(st, cp, OBJ_COUNT_ADDR, 2, 0);
          setupArg(st, cp, {
            zorder: rb(),
            fx: rl() | 0,
            fy: rl() | 0,
            preKind: rb(),
            preF56: rl() & 0xffff,
          });
        },
        ret,
      )
    )
      okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ── Suite B: count == 1, candidato in range trigger ───────────────────
  console.log(
    `\n=== Suite B: count==1, candidato → trigger (0x180<dist<0x280) — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const zorder = rb();
    // Distanza target: dx random in [0x181..0x27F], dy = 0
    const distTarget = 0x181 + (Math.floor(rng() * (0x280 - 0x181)) | 0);
    const argFx = 0;
    const argFy = 0;
    const sign = rng() < 0.5 ? -1 : 1;
    const objFx = (sign * (distTarget << 12)) | 0;
    const objFy = 0;
    if (
      runOneCase(
        "B",
        i,
        (st, cp) => {
          pokeBoth(st, cp, OBJ_COUNT_ADDR, 2, 1);
          setupObj(st, cp, OBJ_ARRAY_BASE, {
            state: 1,
            flag19: rb(),
            kind: [0, 1, 5][Math.floor(rng() * 3)]!,
            zorder,
            field36: 0,
            // |x|+|y| > 0xC000: use 0x10000 + 0x10000 = 0x20000.
            x: 0x10000,
            y: 0x10000,
            fx: objFx,
            fy: objFy,
          });
          setupArg(st, cp, {
            zorder,
            fx: argFx,
            fy: argFy,
          });
        },
        rl(),
      )
    )
      okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ── Suite C: count == 1, BLOCCATO da collision ────────────────────────
  console.log(
    `\n=== Suite C: count==1, collision marble-slot → no decrement — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const zorder = rb();
    const flag19 = rb();
    if (
      runOneCase(
        "C",
        i,
        (st, cp) => {
          pokeBoth(st, cp, OBJ_COUNT_ADDR, 2, 1);
          setupObj(st, cp, OBJ_ARRAY_BASE, {
            state: 1,
            flag19,
            kind: [0, 1, 5][Math.floor(rng() * 3)]!,
            zorder,
            field36: 0,
            x: 0x10000,
            y: 0x10000,
            fx: rl() | 0,
            fy: rl() | 0,
          });
          // At least 1 marble-slot with state=1, kind=1, field56=signExt(flag19).
          const slotIdx = Math.floor(rng() * 4);
          const slotAbs = SLOT_ARRAY_BASE + slotIdx * SLOT_STRIDE;
          pokeBoth(st, cp, slotAbs + 0x18, 1, 1);
          pokeBoth(st, cp, slotAbs + 0x1a, 1, 1);
          // signExt(byte) su 16 bit:
          const f19SignExt = ((flag19 & 0xff) << 24) >> 24;
          pokeBoth(st, cp, slotAbs + 0x56, 2, f19SignExt & 0xffff);
          setupArg(st, cp, {
            zorder,
            fx: rl() | 0,
            fy: rl() | 0,
          });
        },
        rl(),
      )
    )
      okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ── Suite D: count == 2, entrambi candidati validi → fun_15fe6 ────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: count==2, entrambi candidati → fun_15fe6 — ${sizeD} casi ===`,
  );
  const pathologicalRets = [
    0x00000000, 0xffffffff, 0x80000000, 0x7fffffff, 0x00000001, 0xdeadbeef,
  ];
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const zorder = rb();
    const ret =
      i < pathologicalRets.length ? pathologicalRets[i]! >>> 0 : rl();
    if (
      runOneCase(
        "D",
        i,
        (st, cp) => {
          pokeBoth(st, cp, OBJ_COUNT_ADDR, 2, 2);
          for (let k = 0; k < 2; k++) {
            setupObj(st, cp, OBJ_ARRAY_BASE + k * OBJ_STRIDE, {
              state: 1,
              flag19: rb(),
              kind: [0, 1, 5][Math.floor(rng() * 3)]!,
              zorder,
              field36: 0,
              x: 0x10000,
              y: 0x10000,
              fx: rl() | 0,
              fy: rl() | 0,
            });
          }
          setupArg(st, cp, {
            zorder,
            fx: rl() | 0,
            fy: rl() | 0,
          });
        },
        ret,
      )
    )
      okD++;
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
