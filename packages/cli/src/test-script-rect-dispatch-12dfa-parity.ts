#!/usr/bin/env node
/**
 * test-script-rect-dispatch-12dfa-parity.ts — differential FUN_00012DFA vs
 * `scriptRectDispatch12DFA`.
 *
 * `FUN_00012DFA` (330 byte): rect-list spawn + region-bound despawn.
 *   - For each rect (6 byte: lo.b, hi.b, scriptPtr.l) → testa via FUN_12DAE,
 *     poi D2/D3 vs lo/hi, e o spawn 4 marble (zero-path) o spawn 1 (long-path).
 *     FUN_12F44 mode-1.
 *
 * **Strategia parity**:
 *   - `FUN_12DAE` (read-only) live: replicato in TS (slot-match-12dae.ts).
 *   - `FUN_12D6E` (read-only) live: replicato in TS (slot-search.ts).
 *     normalizzazione `r >= limit`.
 *   - `FUN_18F46` (137 byte, side-effect su 0x4003BC + ROM table @0x1F0E2)
 *     (consistent with stub-RTS).
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random selector + random D2/D3 + slot vuoti (test spawn pure).
 *   - B: random selector + slots pre-populated with FUN_12DAE-match (skip test).
 *        slots pre-populated with random region [0x52,0x54] for despawn tests.
 *
 * **Compare** (snapshot completo):
 *   - 25 slot × {byte+0x18, byte+0x1A, long+0x3A, word+0x52, word+0x54}
 *   - byte @0x40075C, long @0x400974, long @0x400978
 *   - RNG seed @0x4003A6
 *
 * Uso: npx tsx packages/cli/src/test-script-rect-dispatch-12dfa-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  scriptRectDispatch12DFA as fnNs,
  bus as busNs,
  wrap,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_12DFA = 0x00012dfa;
const FUN_18F46 = 0x00018f46;
const RNG_SEED_ADDR = 0x004003a6;

const SELECTOR_ADDR = 0x00400394; // word
const SLOT_TABLE_BASE = 0x00400a9c;
const SLOT_STRIDE = 0x56;
const SLOT_COUNT = 0x19;

const GLOBAL_400974 = 0x00400974;
const GLOBAL_400978 = 0x00400978;
const GLOBAL_40075C = 0x0040075c;

const ROM_RECT_TABLE = 0x0001dec0;

/** Patch JSR-stub: FUN_18F46 → RTS (0x4E75). */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_18F46 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_18F46 + 1, 1, 0x75);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  /** byte+0x18 of each slot. */
  occ: number[];
  /** byte+0x1A. */
  st: number[];
  /** long+0x3A. */
  scriptPtr: number[];
  /** word+0x52. */
  lo: number[];
  /** word+0x54. */
  hi: number[];
  /** byte @0x40075C. */
  counter75c: number;
  /** long @0x400974. */
  active974: number;
  /** long @0x400978. */
  active978: number;
  /** RNG seed u16 @0x4003A6. */
  rngSeed: number;
}

function readU16BE(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const occ: number[] = [];
  const st: number[] = [];
  const scriptPtr: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = SLOT_TABLE_BASE + i * SLOT_STRIDE;
    occ.push(peekMem(cpu, slot + 0x18, 1) & 0xff);
    st.push(peekMem(cpu, slot + 0x1a, 1) & 0xff);
    scriptPtr.push(peekMem(cpu, slot + 0x3a, 4) >>> 0);
    lo.push(peekMem(cpu, slot + 0x52, 2) & 0xffff);
    hi.push(peekMem(cpu, slot + 0x54, 2) & 0xffff);
  }
  return {
    occ,
    st,
    scriptPtr,
    lo,
    hi,
    counter75c: peekMem(cpu, GLOBAL_40075C, 1) & 0xff,
    active974: peekMem(cpu, GLOBAL_400974, 4) >>> 0,
    active978: peekMem(cpu, GLOBAL_400978, 4) >>> 0,
    rngSeed: peekMem(cpu, RNG_SEED_ADDR, 2) & 0xffff,
  };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const occ: number[] = [];
  const st: number[] = [];
  const scriptPtr: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = SLOT_TABLE_BASE + i * SLOT_STRIDE - 0x400000;
    occ.push(state.workRam[slotOff + 0x18] ?? 0);
    st.push(state.workRam[slotOff + 0x1a] ?? 0);
    scriptPtr.push(
      ((((state.workRam[slotOff + 0x3a] ?? 0) << 24) |
        ((state.workRam[slotOff + 0x3b] ?? 0) << 16) |
        ((state.workRam[slotOff + 0x3c] ?? 0) << 8) |
        (state.workRam[slotOff + 0x3d] ?? 0)) >>>
        0),
    );
    lo.push(readU16BE(state.workRam, slotOff + 0x52));
    hi.push(readU16BE(state.workRam, slotOff + 0x54));
  }
  return {
    occ,
    st,
    scriptPtr,
    lo,
    hi,
    counter75c: state.workRam[GLOBAL_40075C - 0x400000] ?? 0,
    active974:
      ((((state.workRam[GLOBAL_400974 - 0x400000] ?? 0) << 24) |
        ((state.workRam[GLOBAL_400974 - 0x400000 + 1] ?? 0) << 16) |
        ((state.workRam[GLOBAL_400974 - 0x400000 + 2] ?? 0) << 8) |
        (state.workRam[GLOBAL_400974 - 0x400000 + 3] ?? 0)) >>>
        0),
    active978:
      ((((state.workRam[GLOBAL_400978 - 0x400000] ?? 0) << 24) |
        ((state.workRam[GLOBAL_400978 - 0x400000 + 1] ?? 0) << 16) |
        ((state.workRam[GLOBAL_400978 - 0x400000 + 2] ?? 0) << 8) |
        (state.workRam[GLOBAL_400978 - 0x400000 + 3] ?? 0)) >>>
        0),
    rngSeed: (state.rng.seed as unknown as number) & 0xffff,
  };
}

interface SlotInit {
  occ: number;
  st: number;
  scriptPtr: number;
  lo: number; // word raw
  hi: number; // word raw
  kind1e: number;
  type1f: number;
}

interface CaseSetup {
  selector: number;
  d2: number;
  d3: number;
  slots: SlotInit[];
  counter75c: number;
  active974: number;
  active978: number;
  rngSeed: number;
}

function applyCaseBinary(cpu: CpuSession, c: CaseSetup): void {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = SLOT_TABLE_BASE + i * SLOT_STRIDE;
    const init = c.slots[i]!;
    pokeMem(cpu, slot + 0x18, 1, init.occ);
    pokeMem(cpu, slot + 0x1a, 1, init.st);
    pokeMem(cpu, slot + 0x1e, 1, init.kind1e);
    pokeMem(cpu, slot + 0x1f, 1, init.type1f);
    pokeMem(cpu, slot + 0x3a, 4, init.scriptPtr >>> 0);
    pokeMem(cpu, slot + 0x52, 2, init.lo & 0xffff);
    pokeMem(cpu, slot + 0x54, 2, init.hi & 0xffff);
  }

  pokeMem(cpu, SELECTOR_ADDR, 2, c.selector & 0xffff);
  pokeMem(cpu, GLOBAL_40075C, 1, c.counter75c & 0xff);
  pokeMem(cpu, GLOBAL_400974, 4, c.active974 >>> 0);
  pokeMem(cpu, GLOBAL_400978, 4, c.active978 >>> 0);
  pokeMem(cpu, RNG_SEED_ADDR, 2, c.rngSeed & 0xffff);

  cpu.system.setRegister("sp", 0x401f00);
}

function applyCaseTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
  c: CaseSetup,
): void {
  // Reset workRam.
  state.workRam.fill(0);

  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = SLOT_TABLE_BASE + i * SLOT_STRIDE - 0x400000;
    const init = c.slots[i]!;
    state.workRam[slotOff + 0x18] = init.occ & 0xff;
    state.workRam[slotOff + 0x1a] = init.st & 0xff;
    state.workRam[slotOff + 0x1e] = init.kind1e & 0xff;
    state.workRam[slotOff + 0x1f] = init.type1f & 0xff;
    state.workRam[slotOff + 0x3a] = (init.scriptPtr >>> 24) & 0xff;
    state.workRam[slotOff + 0x3b] = (init.scriptPtr >>> 16) & 0xff;
    state.workRam[slotOff + 0x3c] = (init.scriptPtr >>> 8) & 0xff;
    state.workRam[slotOff + 0x3d] = init.scriptPtr & 0xff;
    state.workRam[slotOff + 0x52] = (init.lo >>> 8) & 0xff;
    state.workRam[slotOff + 0x53] = init.lo & 0xff;
    state.workRam[slotOff + 0x54] = (init.hi >>> 8) & 0xff;
    state.workRam[slotOff + 0x55] = init.hi & 0xff;
  }

  state.workRam[SELECTOR_ADDR - 0x400000] = (c.selector >>> 8) & 0xff;
  state.workRam[SELECTOR_ADDR - 0x400000 + 1] = c.selector & 0xff;

  state.workRam[GLOBAL_40075C - 0x400000] = c.counter75c & 0xff;

  for (let k = 0; k < 4; k++) {
    state.workRam[GLOBAL_400974 - 0x400000 + k] =
      (c.active974 >>> (24 - k * 8)) & 0xff;
    state.workRam[GLOBAL_400978 - 0x400000 + k] =
      (c.active978 >>> (24 - k * 8)) & 0xff;
  }

  state.rng.seed = wrap.as_u32(c.rngSeed & 0xffff);
  state.rng.callsThisFrame = wrap.as_u32(0);
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  setup: CaseSetup;
}

function compareSnapshots(bin: Snapshot, ts: Snapshot): string | null {
  if (bin.rngSeed !== ts.rngSeed)
    return `rngSeed bin=0x${bin.rngSeed.toString(16)} ts=0x${ts.rngSeed.toString(16)}`;
  if (bin.counter75c !== ts.counter75c)
    return `counter75c bin=0x${bin.counter75c.toString(16)} ts=0x${ts.counter75c.toString(16)}`;
  if (bin.active974 !== ts.active974)
    return `active974 bin=0x${bin.active974.toString(16)} ts=0x${ts.active974.toString(16)}`;
  if (bin.active978 !== ts.active978)
    return `active978 bin=0x${bin.active978.toString(16)} ts=0x${ts.active978.toString(16)}`;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (bin.occ[i] !== ts.occ[i])
      return `slot[${i}].occ bin=0x${bin.occ[i]!.toString(16)} ts=0x${ts.occ[i]!.toString(16)}`;
    if (bin.st[i] !== ts.st[i])
      return `slot[${i}].st bin=0x${bin.st[i]!.toString(16)} ts=0x${ts.st[i]!.toString(16)}`;
    if (bin.scriptPtr[i] !== ts.scriptPtr[i])
      return `slot[${i}].scriptPtr bin=0x${bin.scriptPtr[i]!.toString(16)} ts=0x${ts.scriptPtr[i]!.toString(16)}`;
    if (bin.lo[i] !== ts.lo[i])
      return `slot[${i}].lo bin=0x${bin.lo[i]!.toString(16)} ts=0x${ts.lo[i]!.toString(16)}`;
    if (bin.hi[i] !== ts.hi[i])
      return `slot[${i}].hi bin=0x${bin.hi[i]!.toString(16)} ts=0x${ts.hi[i]!.toString(16)}`;
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
  const romBuf = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });
  patchSubs(cpu);

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  // Selector*4 must index a valid long in 0x1DEC0..0x1DEFC (16 entries).
  const validSelectors: number[] = [];
  for (let s = 0; s < 16; s++) {
    const ptr =
      ((romBuf[ROM_RECT_TABLE + s * 4]! << 24) |
        (romBuf[ROM_RECT_TABLE + s * 4 + 1]! << 16) |
        (romBuf[ROM_RECT_TABLE + s * 4 + 2]! << 8) |
        romBuf[ROM_RECT_TABLE + s * 4 + 3]!) >>>
      0;
    if (ptr !== 0xffffffff && ptr < 0x80000) validSelectors.push(s);
  }

  const rng = makeRng(0x12dfa);
  const ri = (max: number): number => Math.floor(rng() * max);

  function makeSlots(occRate: number, region: () => [number, number]): SlotInit[] {
    const slots: SlotInit[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const occ = rng() < occRate ? 1 : 0;
      const [lo, hi] = region();
      slots.push({
        occ,
        st: occ === 1 ? 3 : 0,
        scriptPtr: occ === 1 ? ri(0x100000000) >>> 0 : 0,
        lo: lo & 0xffff,
        hi: hi & 0xffff,
        kind1e: rng() < 0.5 ? 1 : ri(256), // 50% gate FUN_18F46-skip
        type1f: rng() < 0.2 ? 0x06 : rng() < 0.3 ? 0x0c : ri(256),
      });
    }
    return slots;
  }

  function emptySlots(): SlotInit[] {
    const slots: SlotInit[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      slots.push({
        occ: 0,
        st: 0,
        scriptPtr: 0,
        lo: 0,
        hi: 0,
        kind1e: 1,
        type1f: 0,
      });
    }
    return slots;
  }

  function runOneCase(suite: string, tc: number, c: CaseSetup): boolean {
    applyCaseBinary(cpu, c);
    applyCaseTs(stateInst, c);

    // Run binary (FUN_12DFA takes 2 long arg; D2.b = arg1.b, D3.b = arg2.b).
    callFunction(cpu, FUN_12DFA, [c.d2 >>> 0, c.d3 >>> 0], 5_000_000);
    const binSnap = snapshotBinary(cpu);

    fnNs.scriptRectDispatch12DFA(stateInst, tsRom, c.d2 >>> 0, c.d3 >>> 0);
    const tsSnap = snapshotTs(stateInst);

    const reason = compareSnapshots(binSnap, tsSnap);
    if (reason === null) return true;
    if (failHolder.value === null) {
      failHolder.value = { suite, tc, reason, setup: c };
    }
    return false;
  }

  const failHolder: { value: FailRecord | null } = { value: null };
  let totalOk = 0;

  // ─── Suite A: random selector, slot vuoti, random D2/D3 ───────────────
  console.log(
    `\n=== scriptRectDispatch12DFA (FUN_00012DFA) — Suite A: spawn pure (slot vuoti) — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const c: CaseSetup = {
      selector: validSelectors[ri(validSelectors.length)]!,
      d2: ri(256),
      d3: ri(256),
      slots: emptySlots(),
      counter75c: ri(256),
      active974: 0,
      active978: 0,
      rngSeed: ri(0x10000),
    };
    if (runOneCase("A", i, c)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: slot pre-popolati (test FUN_12DAE skip + post-loop) ─────
  console.log(
    `\n=== Suite B: slot pre-popolati random — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const region = (): [number, number] => {
      const lo = ri(0x100); // small positive byte sext (no sign issues)
      const hi = lo + ri(0x40);
      return [lo & 0xffff, hi & 0xffff];
    };
    const slots = makeSlots(0.4, region);
    const c: CaseSetup = {
      selector: validSelectors[ri(validSelectors.length)]!,
      d2: ri(256),
      d3: ri(256),
      slots,
      counter75c: ri(256),
      active974: rng() < 0.3
        ? SLOT_TABLE_BASE + ri(SLOT_COUNT) * SLOT_STRIDE
        : ri(0x100000000) >>> 0,
      active978: ri(0x100000000) >>> 0,
      rngSeed: ri(0x10000),
    };
    if (runOneCase("B", i, c)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: despawn focus (occupied slots with region matching D2/D3) ──
  console.log(
    `\n=== Suite C: focus despawn (region [lo,hi] matchata da D2/D3) — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const d2 = ri(0x80);
    const d3 = ri(0xff);

    const slots: SlotInit[] = [];
    for (let s = 0; s < SLOT_COUNT; s++) {
      // 50% occupied slot with lo == d2 (trigger lower despawn if d3<d2).
      const r = rng();
      let lo: number, hi: number;
      if (r < 0.4) {
        lo = d2; // sext word (positive byte → small positive word)
        hi = d2 + 1 + ri(0x20);
      } else if (r < 0.7) {
        lo = ri(0x80);
        hi = d2; // trigger upper-bound if d3 > d2
      } else {
        lo = ri(0x80);
        hi = lo + ri(0x40);
      }
      const occ = rng() < 0.6 ? 1 : 0;
      slots.push({
        occ,
        st: occ === 1 ? 3 : 0,
        scriptPtr: ri(0x100000000) >>> 0,
        lo: lo & 0xffff,
        hi: hi & 0xffff,
        kind1e: 1,
        type1f: rng() < 0.3 ? 0x06 : rng() < 0.3 ? 0x0c : ri(256),
      });
    }

    const c: CaseSetup = {
      // selector with failing rect-list (valid selector but D2/D3 do not match).
      selector: validSelectors[ri(validSelectors.length)]!,
      d2,
      d3,
      slots,
      counter75c: 0x40 + ri(0x40),
      active974: rng() < 0.4
        ? SLOT_TABLE_BASE + ri(SLOT_COUNT) * SLOT_STRIDE
        : 0,
      active978: ri(0x100000000) >>> 0,
      rngSeed: ri(0x10000),
    };
    if (runOneCase("C", i, c)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases — ${sizeD} cases ===`,
  );
  let okD = 0;
  const d2Edges = [0, 1, 0x7f, 0x80, 0xfe, 0xff];
  const d3Edges = [0, 1, 0x7f, 0x80, 0xfe, 0xff];
  for (let i = 0; i < sizeD; i++) {
    const slots: SlotInit[] = [];
    const allFull = rng() < 0.3;
    for (let s = 0; s < SLOT_COUNT; s++) {
      const occ = allFull ? 1 : rng() < 0.5 ? 1 : 0;
      const lo = ri(0x80);
      const hi = lo + ri(0x40);
      const type1f =
        rng() < 0.4 ? 0x06 : rng() < 0.5 ? 0x0c : ri(256);
      slots.push({
        occ,
        st: occ === 1 ? 3 : 0,
        scriptPtr: ri(0x100000000) >>> 0,
        lo: lo & 0xffff,
        hi: hi & 0xffff,
        kind1e: 1,
        type1f,
      });
    }
    const c: CaseSetup = {
      selector: validSelectors[ri(validSelectors.length)]!,
      d2: d2Edges[ri(d2Edges.length)]!,
      d3: d3Edges[ri(d3Edges.length)]!,
      slots,
      counter75c: 0x40 + ri(0x40),
      active974: rng() < 0.5 ? SLOT_TABLE_BASE + ri(SLOT_COUNT) * SLOT_STRIDE : 0,
      active978: ri(0x100000000) >>> 0,
      rngSeed: ri(0x10000),
    };
    if (runOneCase("D", i, c)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(`\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value) {
    const f = failHolder.value;
    console.log(`\nFirst fail @ suite ${f.suite} tc ${f.tc}:`);
    console.log(`  reason: ${f.reason}`);
    console.log(
      `  selector=${f.setup.selector} d2=0x${f.setup.d2.toString(16)} d3=0x${f.setup.d3.toString(16)} rngSeed=0x${f.setup.rngSeed.toString(16)}`,
    );
    console.log(
      `  active974=0x${f.setup.active974.toString(16)} counter75c=0x${f.setup.counter75c.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
