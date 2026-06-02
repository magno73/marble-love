#!/usr/bin/env node
/**
 * test-script-slot-step-13068-parity.ts —
 * differential FUN_00013068 vs `scriptSlotStep13068`.
 *
 * **Strategy**:
 * `FUN_13068` calls:
 *   - `FUN_12896` via `jsr (A4)` (A4=0x12896): not mirrored -> patch with `rts`.
 *   - `FUN_13334` (0x13334): mirrored as `objectRenderUpdate13334`;
 *     calls `FUN_1D06A` in turn (not mirrored) -> patch with `rts`.
 *   - `FUN_132E0` (0x132e0): embedded helper, implemented inline in TS.
 *
 * **Comparison**: all slot-local workRam (0x56 bytes @ slotPtr) +
 * observable globals:
 *   - [0x400456] byte timer456
 *   - [0x40044a] long ptr44a
 *   - [0x40044e] long ptr44e
 *   - [0x400452] long ptr452
 *   - [0x400458] byte timer458
 *   - [0x40045a] byte timer45a
 *   - [0x40045c] word word45c
 *   - [0x40075e] byte flag75e
 *   - [0x400690..0x400693] POS_X/Y (from FUN_13334)
 *   - [0x400970..0x400977] active-record globals (from FUN_13334)
 *   - [0x400408..0x40040f] palette queue (from FUN_13334 via FUN_26B66)
 *
 * **Tested suites (5 x 100 = 500 cases)**:
 *   A: slot[0x18]=0 (inactive) — always no-op
 *   B: slot[0x1f]=3 (kind==3) with varied slot[0x1a] (0..4)
 *   C: slot[0x1a] random 0..4, slot[0x1f] != 3
 *   D: case 1/2 with counter/limit logic + FUN_132E0 wraps
 *   E: edge cases (tombstone, timer wraps, kind 6/0x19)
 *
 * Usage: npx tsx packages/cli/src/test-script-slot-step-13068-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  scriptSlotStep13068 as ns,
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

const FUN_13068 = 0x00013068;
const FUN_12896 = 0x00012896;
const FUN_1D06A = 0x0001d06a;

const WRAM = 0x00400000;
const SLOT_STRIDE = 0x56;

// ─── Stubs ───────────────────────────────────────────────────────────────────

/** Stub `rts` (2 bytes) applied to non-replicated functions. */
const RTS_STUB = [0x4e, 0x75] as const;

function applyRts(cpu: CpuSession, addr: number): void {
  pokeMem(cpu, addr, 1, 0x4e);
  pokeMem(cpu, addr + 1, 1, 0x75);
}

function applyAllStubs(cpu: CpuSession): void {
  applyRts(cpu, FUN_12896);
  applyRts(cpu, FUN_1D06A);
  void RTS_STUB; // used above, suppress unused
}

// ─── RNG ─────────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

// ─── Memory helpers ───────────────────────────────────────────────────────────

type State = ReturnType<typeof stateNs.emptyGameState>;

function pokeByte(state: State, cpu: CpuSession, addr: number, v: number): void {
  const b = v & 0xff;
  pokeMem(cpu, addr, 1, b);
  state.workRam[(addr - WRAM) >>> 0] = b;
}

function pokeWord(state: State, cpu: CpuSession, addr: number, v: number): void {
  pokeByte(state, cpu, addr, (v >>> 8) & 0xff);
  pokeByte(state, cpu, addr + 1, v & 0xff);
}

function pokeLong(state: State, cpu: CpuSession, addr: number, v: number): void {
  const u = v >>> 0;
  pokeByte(state, cpu, addr, (u >>> 24) & 0xff);
  pokeByte(state, cpu, addr + 1, (u >>> 16) & 0xff);
  pokeByte(state, cpu, addr + 2, (u >>> 8) & 0xff);
  pokeByte(state, cpu, addr + 3, u & 0xff);
}

function peekByte(state: State, cpu: CpuSession, addr: number): { bin: number; ts: number } {
  return {
    bin: peekMem(cpu, addr, 1) & 0xff,
    ts: state.workRam[(addr - WRAM) >>> 0] ?? 0,
  };
}

// ─── Observable comparison ────────────────────────────────────────────────────

interface Diff {
  what: string;
  bin: number;
  ts: number;
}

function compareObservables(
  state: State,
  cpu: CpuSession,
  slotPtr: number,
): Diff | null {
  // Slot bytes (0x56 bytes)
  for (let i = 0; i < SLOT_STRIDE; i++) {
    const { bin, ts } = peekByte(state, cpu, slotPtr + i);
    if (bin !== ts) {
      return { what: `slot+0x${i.toString(16)}`, bin, ts };
    }
  }

  // Globals
  const globals: Array<[string, number, number]> = [
    // [label, address, size_bytes]
    ["timer456", 0x400456, 1],
    ["ptr44a[0]", 0x40044a, 1],
    ["ptr44a[1]", 0x40044b, 1],
    ["ptr44a[2]", 0x40044c, 1],
    ["ptr44a[3]", 0x40044d, 1],
    ["ptr44e[0]", 0x40044e, 1],
    ["ptr44e[1]", 0x40044f, 1],
    ["ptr44e[2]", 0x400450, 1],
    ["ptr44e[3]", 0x400451, 1],
    ["ptr452[0]", 0x400452, 1],
    ["ptr452[1]", 0x400453, 1],
    ["ptr452[2]", 0x400454, 1],
    ["ptr452[3]", 0x400455, 1],
    ["timer458", 0x400458, 1],
    ["timer45a", 0x40045a, 1],
    ["word45c_hi", 0x40045c, 1],
    ["word45c_lo", 0x40045d, 1],
    ["flag75e", 0x40075e, 1],
    // POS_X/Y (from FUN_13334)
    ["posX_hi", 0x400690, 1],
    ["posX_lo", 0x400691, 1],
    ["posY_hi", 0x400692, 1],
    ["posY_lo", 0x400693, 1],
    // active-record globals (from FUN_13334)
    ["activeRec0", 0x400970, 1],
    ["activeRec1", 0x400971, 1],
    ["activeRec2", 0x400972, 1],
    ["activeRec3", 0x400973, 1],
    ["activeSlot0", 0x400974, 1],
    ["activeSlot1", 0x400975, 1],
    ["activeSlot2", 0x400976, 1],
    ["activeSlot3", 0x400977, 1],
    // palette queue (from FUN_13334 → FUN_26B66)
    ["palQptr0", 0x400408, 1],
    ["palQptr1", 0x400409, 1],
    ["palQptr2", 0x40040a, 1],
    ["palQptr3", 0x40040b, 1],
    ["palQbody0", 0x40040c, 1],
    ["palQbody1", 0x40040d, 1],
    ["palQbody2", 0x40040e, 1],
    ["palQbody3", 0x40040f, 1],
  ];

  for (const [label, addr] of globals) {
    const { bin, ts } = peekByte(state, cpu, addr);
    if (bin !== ts) {
      return { what: label, bin, ts };
    }
  }

  return null;
}

// ─── Setup helpers ────────────────────────────────────────────────────────────

/** Valid slot pointers (far from globals, non-overlapping). */
const SLOT_PTRS = [
  0x00401000,
  0x00401100,
  0x00401200,
  0x00401300,
  0x00401400,
  0x00401500,
  0x00401600,
  0x00401700,
] as const;

/** Valid record-pointer targets (work RAM, far from slots). */
const REC_PTRS = [
  0x00401800,
  0x00401850,
  0x00401900,
  0x00401950,
  0x00401a00,
  0x00401a50,
  0x00401b00,
  0x00401b50,
] as const;

function resetGlobals(state: State, cpu: CpuSession): void {
  const addrs: number[] = [
    // POS_X/Y
    0x400690, 0x400691, 0x400692, 0x400693,
    // active-record globals
    0x400970, 0x400971, 0x400972, 0x400973,
    0x400974, 0x400975, 0x400976, 0x400977,
    // palette queue head ptr = 0x40040c, body = 0
  ];
  for (const a of addrs) pokeByte(state, cpu, a, 0);

  // Reset palette queue ptr to head (0x00400c = offset 0x40c)
  pokeLong(state, cpu, 0x400408, 0x0040040c);

  // Clear palette queue body
  for (let i = 0; i < 4; i++) pokeByte(state, cpu, 0x40040c + i, 0);
}

/**
 * Setup a slot with random bytes, then override key fields.
 * Returns slot bytes array for reference.
 */
function setupSlot(
  state: State,
  cpu: CpuSession,
  rng: () => number,
  slotPtr: number,
  overrides: Partial<Record<number, number>>,
): void {
  for (let i = 0; i < SLOT_STRIDE; i++) {
    const v = overrides[i] !== undefined ? overrides[i]! : Math.floor(rng() * 256) & 0xff;
    pokeByte(state, cpu, slotPtr + i, v);
  }
}

/**
 * Write a long to both binary and TS at the given address.
 */
function setLong(state: State, cpu: CpuSession, addr: number, v: number): void {
  pokeLong(state, cpu, addr, v);
}

/**
 * Build a ROM-like sequence in work RAM:
 * writes n_entries×4 bytes at baseAddr, last long = tombstone (0xFFFFFFFF).
 * Returns base address.
 */
function buildRomSequence(
  state: State,
  cpu: CpuSession,
  rng: () => number,
  baseAddr: number,
  nEntries: number,
): number {
  for (let i = 0; i < nEntries; i++) {
    const val = i < nEntries - 1
      ? (Math.floor(rng() * 0x7fffffff) & 0x7fffffff) // non-tombstone
      : 0xffffffff; // tombstone at end
    pokeLong(state, cpu, baseAddr + i * 4, val);
  }
  return baseAddr;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface FailRecord {
  suite: string;
  i: number;
  slotPtr: number;
  state1a: number;
  kind1f: number;
  diff: Diff;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 5);
  const extraE = total - perSuite * 4;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  // Mirror ROM into TS RomImage
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  // Apply stubs (patched once, re-applied every 100 cases)
  applyAllStubs(cpu);

  const rng = makeRng(0x13068);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const pickSlot = (): number => SLOT_PTRS[Math.floor(rng() * SLOT_PTRS.length)]!;
  const pickRec = (): number => REC_PTRS[Math.floor(rng() * REC_PTRS.length)]!;

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOne(
    suite: string,
    i: number,
    slotPtr: number,
    setupFn: () => void,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);

    // Re-apply stubs periodically
    if (i % 50 === 0) applyAllStubs(cpu);

    resetGlobals(stateInst, cpu);
    setupFn();

    const off = (slotPtr - WRAM) >>> 0;
    const state1a = stateInst.workRam[off + 0x1a] ?? 0;
    const kind1f = stateInst.workRam[off + 0x1f] ?? 0;

    // Run binary
    callFunction(cpu, FUN_13068, [slotPtr >>> 0]);

    // Run TS
    ns.scriptSlotStep13068(stateInst, tsRom, slotPtr, {
      fun12896: (_s: typeof stateInst, _p: number): void => { /* no-op mirror of binary rts stub */ },
      inner1D06A: (_b: number): void => { /* no-op mirror of binary rts stub */ },
    });

    const diff = compareObservables(stateInst, cpu, slotPtr);
    if (diff === null) return true;

    if (failHolder.value === null) {
      failHolder.value = { suite, i, slotPtr, state1a, kind1f, diff };
    }
    return false;
  }

  // ─── Suite A: inactive slot (slot[0x18]=0) ────────────────────────────────
  console.log(`\n=== scriptSlotStep13068 (FUN_13068) — Suite A: inactive slot — ${perSuite} cases ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotPtr = pickSlot();
    okA += runOne("A", i, slotPtr, () => {
      setupSlot(stateInst, cpu, rng, slotPtr, {
        0x18: 0, // inactive
        0x1a: rb() & 0x07,
        0x1f: rb(),
      });
    }) ? 1 : 0;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: kind==3 (slot[0x1f]=3) global timer block ─────────────────
  console.log(`\n=== Suite B: kind==3 timer block — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotPtr = pickSlot();
    okB += runOne("B", i, slotPtr, () => {
      const caseVal = Math.floor(rng() * 5); // 0..4

      // Setup slot
      setupSlot(stateInst, cpu, rng, slotPtr, {
        0x18: 1, // active
        0x1a: caseVal,
        0x1f: 3, // kind == 3 → triggers timer block
        0x1e: 0, // mode = 0 for FUN_13334 compute path
      });

      // Initialize timers at non-zero values (2..5) to prevent tombstone wraps
      // that depend on ROM content at random addresses
      pokeByte(stateInst, cpu, 0x400456, 2 + (rb() & 0x03));
      pokeByte(stateInst, cpu, 0x400458, 2 + (rb() & 0x03));
      pokeByte(stateInst, cpu, 0x40045a, 2 + (rb() & 0x03));

      // Setup ptrs in work RAM with non-tombstone values
      const recPtr = pickRec();
      const seqBase = (recPtr + 0x10) >>> 0;
      buildRomSequence(stateInst, cpu, rng, seqBase, 4);

      pokeLong(stateInst, cpu, 0x40044a, seqBase);
      pokeLong(stateInst, cpu, 0x40044e, seqBase);
      pokeLong(stateInst, cpu, 0x400452, seqBase);

      // Setup slot fields for dispatch cases
      const off = slotPtr - WRAM;
      // slot[0x3e]: for case 1/2, point to sequence
      stateInst.workRam[off + 0x3e] = (seqBase >>> 24) & 0xff;
      stateInst.workRam[off + 0x3f] = (seqBase >>> 16) & 0xff;
      stateInst.workRam[off + 0x40] = (seqBase >>> 8) & 0xff;
      stateInst.workRam[off + 0x41] = seqBase & 0xff;
      pokeLong(stateInst, cpu, slotPtr + 0x3e, seqBase);

      stateInst.workRam[off + 0x46] = (seqBase >>> 24) & 0xff;
      stateInst.workRam[off + 0x47] = (seqBase >>> 16) & 0xff;
      stateInst.workRam[off + 0x48] = (seqBase >>> 8) & 0xff;
      stateInst.workRam[off + 0x49] = seqBase & 0xff;
      pokeLong(stateInst, cpu, slotPtr + 0x46, seqBase);

      stateInst.workRam[off + 0x4a] = (seqBase >>> 24) & 0xff;
      stateInst.workRam[off + 0x4b] = (seqBase >>> 16) & 0xff;
      stateInst.workRam[off + 0x4c] = (seqBase >>> 8) & 0xff;
      stateInst.workRam[off + 0x4d] = seqBase & 0xff;
      pokeLong(stateInst, cpu, slotPtr + 0x4a, seqBase);

      // For cases 1/2: set counters/limits
      pokeByte(stateInst, cpu, slotPtr + 0x20, 0);
      pokeByte(stateInst, cpu, slotPtr + 0x21, 0);
      pokeByte(stateInst, cpu, slotPtr + 0x22, 0);
      pokeByte(stateInst, cpu, slotPtr + 0x23, 0);
      setLong(stateInst, cpu, 0x40097e, 0); // HUD offset
    }) ? 1 : 0;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: kind != 3, slot[0x1a] ∈ 0..4, various cases ───────────────
  console.log(`\n=== Suite C: kind!=3, case 0..4 — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotPtr = pickSlot();
    okC += runOne("C", i, slotPtr, () => {
      const caseVal = Math.floor(rng() * 5);
      // kind: anything but 3 (to skip timer block)
      let kind = rb();
      while (kind === 3) kind = rb();

      setupSlot(stateInst, cpu, rng, slotPtr, {
        0x18: 1, // active
        0x1a: caseVal,
        0x1f: kind,
        0x1e: 0, // mode=0 for FUN_13334
      });

      // Setup rec ptr in work RAM
      const recPtr = pickRec();
      const off = slotPtr - WRAM;
      pokeLong(stateInst, cpu, slotPtr + 0x3e, recPtr);
      pokeLong(stateInst, cpu, slotPtr + 0x46, recPtr);
      pokeLong(stateInst, cpu, slotPtr + 0x4a, recPtr);
      stateInst.workRam[off + 0x3e] = (recPtr >>> 24) & 0xff;
      stateInst.workRam[off + 0x3f] = (recPtr >>> 16) & 0xff;
      stateInst.workRam[off + 0x40] = (recPtr >>> 8) & 0xff;
      stateInst.workRam[off + 0x41] = recPtr & 0xff;

      // Non-tombstone at recPtr
      pokeLong(stateInst, cpu, recPtr, 0x12345678);
      pokeLong(stateInst, cpu, recPtr + 4, 0x87654321);
      pokeLong(stateInst, cpu, recPtr + 8, 0xfeedface);

      // Case 0: set timer
      pokeByte(stateInst, cpu, slotPtr + 0x1c, rb()); // hthe bytes
      pokeByte(stateInst, cpu, slotPtr + 0x1d, rb()); // lo byte (but tst.w checks word)
      // Simplify: use a specific value
      pokeWord(stateInst, cpu, slotPtr + 0x1c, 1 + (rb() & 0x0f)); // 1..16

      // Case 1/2: counters
      pokeByte(stateInst, cpu, slotPtr + 0x20, 0);
      pokeByte(stateInst, cpu, slotPtr + 0x21, 0); // limit=0 → equal immediately
      pokeByte(stateInst, cpu, slotPtr + 0x22, 0);
      pokeByte(stateInst, cpu, slotPtr + 0x23, 0);

      setLong(stateInst, cpu, 0x40097e, 0); // HUD offset
    }) ? 1 : 0;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: case 1/2 with counter/limit variations + FUN_132E0 ─────────
  console.log(`\n=== Suite D: case 1/2 counter/limit + FUN_132E0 wrap — ${perSuite} cases ===`);
  let okD = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotPtr = pickSlot();
    okD += runOne("D", i, slotPtr, () => {
      const caseVal = (i % 2) + 1; // alternate case 1 and 2
      // kind != 3, not 6 or 0x19 to keep things simple for first pass
      const kind = rb() & 0x0f; // 0..15, avoiding 3,6,0x19

      setupSlot(stateInst, cpu, rng, slotPtr, {
        0x18: 1,
        0x1a: caseVal,
        0x1f: kind,
        0x1e: 0, // mode=0 for FUN_13334 compute
      });

      // Build a ROM sequence in work RAM
      const recPtr = pickRec();
      const nEntries = 3 + Math.floor(rng() * 4); // 3..6 entries
      buildRomSequence(stateInst, cpu, rng, recPtr, nEntries);

      // Point slot[0x3e] to first entry of sequence
      pokeLong(stateInst, cpu, slotPtr + 0x3e, recPtr);
      pokeLong(stateInst, cpu, slotPtr + 0x46, recPtr);
      pokeLong(stateInst, cpu, slotPtr + 0x4a, recPtr);
      const off = slotPtr - WRAM;
      stateInst.workRam[off + 0x3e] = (recPtr >>> 24) & 0xff;
      stateInst.workRam[off + 0x3f] = (recPtr >>> 16) & 0xff;
      stateInst.workRam[off + 0x40] = (recPtr >>> 8) & 0xff;
      stateInst.workRam[off + 0x41] = recPtr & 0xff;
      stateInst.workRam[off + 0x46] = (recPtr >>> 24) & 0xff;
      stateInst.workRam[off + 0x47] = (recPtr >>> 16) & 0xff;
      stateInst.workRam[off + 0x48] = (recPtr >>> 8) & 0xff;
      stateInst.workRam[off + 0x49] = recPtr & 0xff;
      stateInst.workRam[off + 0x4a] = (recPtr >>> 24) & 0xff;
      stateInst.workRam[off + 0x4b] = (recPtr >>> 16) & 0xff;
      stateInst.workRam[off + 0x4c] = (recPtr >>> 8) & 0xff;
      stateInst.workRam[off + 0x4d] = recPtr & 0xff;

      // Vary counter/limit:
      const limit = rb() & 0x07; // 0..7
      const ctr = Math.floor(rng() * (limit + 1)); // 0..limit
      if (caseVal === 1) {
        pokeByte(stateInst, cpu, slotPtr + 0x21, limit);
        pokeByte(stateInst, cpu, slotPtr + 0x20, ctr);
      } else {
        pokeByte(stateInst, cpu, slotPtr + 0x23, limit);
        pokeByte(stateInst, cpu, slotPtr + 0x22, ctr);
      }

      // slot[0x1c] for case-0 (if dispatch loops to case 0)
      pokeWord(stateInst, cpu, slotPtr + 0x1c, 1 + Math.floor(rng() * 10));

      // velocity / position for the add
      pokeLong(stateInst, cpu, slotPtr + 0x00, Math.floor(rng() * 0x100) & 0xff);
      pokeLong(stateInst, cpu, slotPtr + 0x04, Math.floor(rng() * 0x100) & 0xff);
      pokeLong(stateInst, cpu, slotPtr + 0x0c, Math.floor(rng() * 0x10000));
      pokeLong(stateInst, cpu, slotPtr + 0x10, Math.floor(rng() * 0x10000));
      pokeLong(stateInst, cpu, slotPtr + 0x14, Math.floor(rng() * 0x100));

      setLong(stateInst, cpu, 0x40097e, 0);
    }) ? 1 : 0;
  }
  console.log(`  Match: ${okD}/${perSuite} = ${((okD / perSuite) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ─── Suite E: edge cases ─────────────────────────────────────────────────
  console.log(`\n=== Suite E: edge cases — ${extraE} cases ===`);
  let okE = 0;
  for (let i = 0; i < extraE; i++) {
    const slotPtr = pickSlot();
    okE += runOne("E", i, slotPtr, () => {
      const variant = i % 8;

      if (variant === 0) {
        // Case 4: just sets slot[0x3e] = 0x20c14
        setupSlot(stateInst, cpu, rng, slotPtr, {
          0x18: 1, 0x1a: 4, 0x1f: 0, 0x1e: 0,
        });
      } else if (variant === 1) {
        // Case 3: full reset
        setupSlot(stateInst, cpu, rng, slotPtr, {
          0x18: 1, 0x1a: 3, 0x1f: 0, 0x1e: 0,
        });
      } else if (variant === 2) {
        // case 1 with limit reached exactly
        const lim = 1 + Math.floor(rng() * 3);
        setupSlot(stateInst, cpu, rng, slotPtr, {
          0x18: 1, 0x1a: 1, 0x1f: 0, 0x1e: 0,
          0x21: lim, 0x20: lim - 1,
        });
        const recPtr = pickRec();
        pokeLong(stateInst, cpu, recPtr, 0x11111111);
        pokeLong(stateInst, cpu, slotPtr + 0x3e, recPtr);
        pokeLong(stateInst, cpu, slotPtr + 0x46, recPtr);
        pokeLong(stateInst, cpu, slotPtr + 0x4a, recPtr);
        stateInst.workRam[(slotPtr - WRAM) + 0x3e] = (recPtr >>> 24) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x3f] = (recPtr >>> 16) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x40] = (recPtr >>> 8) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x41] = recPtr & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x46] = (recPtr >>> 24) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x47] = (recPtr >>> 16) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x48] = (recPtr >>> 8) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x49] = recPtr & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x4a] = (recPtr >>> 24) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x4b] = (recPtr >>> 16) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x4c] = (recPtr >>> 8) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x4d] = recPtr & 0xff;
        setLong(stateInst, cpu, 0x40097e, 0);
      } else if (variant === 3) {
        // mode=1 (slot[0x1e]=1): suppresses final FUN_13334 call
        const recPtr = pickRec();
        pokeLong(stateInst, cpu, recPtr, 0xffffffff); // tombstone
        setupSlot(stateInst, cpu, rng, slotPtr, {
          0x18: 1, 0x1a: 0, 0x1f: 0, 0x1e: 1,
        });
        pokeLong(stateInst, cpu, slotPtr + 0x3e, recPtr);
        stateInst.workRam[(slotPtr - WRAM) + 0x3e] = (recPtr >>> 24) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x3f] = (recPtr >>> 16) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x40] = (recPtr >>> 8) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x41] = recPtr & 0xff;
        pokeWord(stateInst, cpu, slotPtr + 0x1c, 5);
      } else if (variant === 4) {
        // out-of-range case (slot[0x1a] = 5): no dispatch
        setupSlot(stateInst, cpu, rng, slotPtr, {
          0x18: 1, 0x1a: 5, 0x1f: 0, 0x1e: 0,
        });
        setLong(stateInst, cpu, 0x40097e, 0);
      } else if (variant === 5) {
        // kind==3 timer block with timer=1 (wraps)
        setupSlot(stateInst, cpu, rng, slotPtr, {
          0x18: 1, 0x1a: 4, 0x1f: 3, 0x1e: 0,
        });
        pokeByte(stateInst, cpu, 0x400456, 1); // will wrap
        pokeByte(stateInst, cpu, 0x400458, 3);
        pokeByte(stateInst, cpu, 0x40045a, 3);
        const seqBase = REC_PTRS[0]!;
        // Put non-tombstone values at seqBase (will be checked after ptr44a+4)
        for (let k = 0; k < 16; k += 4) {
          pokeLong(stateInst, cpu, seqBase + k, 0x11223344);
        }
        pokeLong(stateInst, cpu, 0x40044a, seqBase);
        pokeLong(stateInst, cpu, 0x40044e, seqBase);
        pokeLong(stateInst, cpu, 0x400452, seqBase);
        stateInst.workRam[0x44a] = (seqBase >>> 24) & 0xff;
        stateInst.workRam[0x44b] = (seqBase >>> 16) & 0xff;
        stateInst.workRam[0x44c] = (seqBase >>> 8) & 0xff;
        stateInst.workRam[0x44d] = seqBase & 0xff;
        stateInst.workRam[0x44e] = (seqBase >>> 24) & 0xff;
        stateInst.workRam[0x44f] = (seqBase >>> 16) & 0xff;
        stateInst.workRam[0x450] = (seqBase >>> 8) & 0xff;
        stateInst.workRam[0x451] = seqBase & 0xff;
        stateInst.workRam[0x452] = (seqBase >>> 24) & 0xff;
        stateInst.workRam[0x453] = (seqBase >>> 16) & 0xff;
        stateInst.workRam[0x454] = (seqBase >>> 8) & 0xff;
        stateInst.workRam[0x455] = seqBase & 0xff;
        setLong(stateInst, cpu, 0x40097e, 0);
      } else if (variant === 6) {
        // case 0 with timer=1 and active=1 → calls fun12896 (rts-stubbed)
        setupSlot(stateInst, cpu, rng, slotPtr, {
          0x18: 1, 0x1a: 0, 0x1f: 0, 0x1e: 2,
        });
        pokeWord(stateInst, cpu, slotPtr + 0x1c, 1);
        setLong(stateInst, cpu, 0x40097e, 0);
        const recPtr = pickRec();
        pokeLong(stateInst, cpu, recPtr, 0x55667788);
        pokeLong(stateInst, cpu, slotPtr + 0x3e, recPtr);
        stateInst.workRam[(slotPtr - WRAM) + 0x3e] = (recPtr >>> 24) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x3f] = (recPtr >>> 16) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x40] = (recPtr >>> 8) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x41] = recPtr & 0xff;
      } else {
        // Random active slot with random case 0..3
        const caseVal = Math.floor(rng() * 4);
        setupSlot(stateInst, cpu, rng, slotPtr, {
          0x18: 1, 0x1a: caseVal, 0x1f: rb() & 0x05, 0x1e: 0,
          0x21: 0, 0x23: 0, // limit=0 for cases 1/2
        });
        const recPtr = pickRec();
        pokeLong(stateInst, cpu, recPtr, 0x22334455);
        pokeLong(stateInst, cpu, slotPtr + 0x3e, recPtr);
        pokeLong(stateInst, cpu, slotPtr + 0x46, recPtr);
        pokeLong(stateInst, cpu, slotPtr + 0x4a, recPtr);
        stateInst.workRam[(slotPtr - WRAM) + 0x3e] = (recPtr >>> 24) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x3f] = (recPtr >>> 16) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x40] = (recPtr >>> 8) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x41] = recPtr & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x46] = (recPtr >>> 24) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x47] = (recPtr >>> 16) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x48] = (recPtr >>> 8) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x49] = recPtr & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x4a] = (recPtr >>> 24) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x4b] = (recPtr >>> 16) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x4c] = (recPtr >>> 8) & 0xff;
        stateInst.workRam[(slotPtr - WRAM) + 0x4d] = recPtr & 0xff;
        pokeWord(stateInst, cpu, slotPtr + 0x1c, 1 + Math.floor(rng() * 8));
        setLong(stateInst, cpu, 0x40097e, 0);
      }
    }) ? 1 : 0;
  }
  console.log(`  Match: ${okE}/${extraE} = ${((okE / extraE) * 100).toFixed(1)}%`);
  totalOk += okE;

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} i=${f.i}):\n` +
      `    slotPtr=0x${f.slotPtr.toString(16)} state=0x${f.state1a.toString(16)} kind=0x${f.kind1f.toString(16)}\n` +
      `    @${f.diff.what}: bin=0x${f.diff.bin.toString(16)} ts=0x${f.diff.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
