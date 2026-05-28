#!/usr/bin/env node
/**
 * test-helper-12896-parity.ts — differential parity test:
 * `FUN_00012896` (M68k via musashi-wasm) vs `helper12896` (TS replica).
 *
 * ## Strategy
 *
 *   - `FUN_00013334` (opcode 0 with slot[0x1e]==1): mirrored by
 *     `objectRenderUpdate13334`. Subroutine `FUN_1D06A` (palette) is patched
 *     with `rts`.
 *   - `FUN_00018E6C` (opcode 0 with slot[0x1e]!=1): mirrored by
 *     `slotInsertSorted18E6C`. Subroutine `FUN_1B12A` is patched with `rts`.
 *   - `FUN_00012F44` (opcode 15): mirrored by `helper12F44`.
 *     Subroutine `FUN_00018F46` (helper18F46) is patched with `rts`.
 *
 *
 *   - Slot 0x56 byte a `slotPtr`
 *     - [0x40044a] ptr44a (opcode 0 kind==3)
 *     - [0x40044e] ptr44e
 *     - [0x400452] ptr452
 *     - [0x400456] timer456
 *     - [0x400458] timer458
 *     - [0x40045a] timer45a
 *     - [0x40075c] byte counter (opcode 0 kind==6)
 *     - [0x40075e] byte flag (opcode 0 kind==6)
 *     - [0x400690..0x400693] posX/Y (from FUN_13334)
 *     - [0x400970..0x400977] active-record globals (from FUN_13334)
 *     - [0x400408..0x40040f] palette queue
 *     - [0x4001dc..0x4001e9] rect-slot area (from FUN_18E6C)
 *
 *   A: opcode  0 — opcode 0 with slot[0x1e]==1 (render path)
 *   B: opcode  0 — opcode 0 with slot[0x1e]!=1 (insert-sorted path)
 *   C: opcodes 1..7 — script control flow ops
 *   D: opcodes 8..16 — position / object-list ops
 *   E: opcodes 17..18 — mode-4 dispatch + complex object search
 *
 * Usage: npx tsx packages/cli/src/test-helper-12896-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  helper12896 as ns,
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

const FUN_12896 = 0x00012896;
const FUN_158AC = 0x000158ac;
const FUN_1D06A = 0x0001d06a;
const FUN_1B12A = 0x0001b12a;
const FUN_18F46 = 0x00018f46;

const WRAM = 0x00400000;
const SLOT_STRIDE = 0x56;

// ─── Stubs ────────────────────────────────────────────────────────────────────

function applyRts(cpu: CpuSession, addr: number): void {
  pokeMem(cpu, addr, 1, 0x4e);
  pokeMem(cpu, addr + 1, 1, 0x75);
}

function applyAllStubs(cpu: CpuSession): void {
  applyRts(cpu, FUN_158AC);
  applyRts(cpu, FUN_1D06A);
  applyRts(cpu, FUN_1B12A);
  applyRts(cpu, FUN_18F46);
}

// ─── RNG ──────────────────────────────────────────────────────────────────────

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

// ─── Observable regions ───────────────────────────────────────────────────────

interface Diff {
  what: string;
  bin: number;
  ts: number;
}

function compareRegion(
  state: State,
  cpu: CpuSession,
  baseAddr: number,
  len: number,
  label: string,
): Diff | null {
  for (let i = 0; i < len; i++) {
    const { bin, ts } = peekByte(state, cpu, baseAddr + i);
    if (bin !== ts) return { what: `${label}+0x${i.toString(16)}`, bin, ts };
  }
  return null;
}

function compareObservables(
  state: State,
  cpu: CpuSession,
  slotPtr: number,
): Diff | null {
  // Slot bytes (0x56 = 86 bytes)
  const slotDiff = compareRegion(state, cpu, slotPtr, SLOT_STRIDE, "slot");
  if (slotDiff !== null) return slotDiff;

  // Script/timer globals
  const globals: Array<[string, number]> = [
    ["ptr44a_0", 0x40044a],
    ["ptr44a_1", 0x40044b],
    ["ptr44a_2", 0x40044c],
    ["ptr44a_3", 0x40044d],
    ["ptr44e_0", 0x40044e],
    ["ptr44e_1", 0x40044f],
    ["ptr44e_2", 0x400450],
    ["ptr44e_3", 0x400451],
    ["ptr452_0", 0x400452],
    ["ptr452_1", 0x400453],
    ["ptr452_2", 0x400454],
    ["ptr452_3", 0x400455],
    ["timer456", 0x400456],
    ["timer458", 0x400458],
    ["timer45a", 0x40045a],
    ["cnt75c",   0x40075c],
    ["flag75e",  0x40075e],
    // FUN_13334 outputs
    ["posX_0", 0x400690], ["posX_1", 0x400691],
    ["posY_0", 0x400692], ["posY_1", 0x400693],
    ["aRec_0", 0x400970], ["aRec_1", 0x400971],
    ["aRec_2", 0x400972], ["aRec_3", 0x400973],
    ["aSlot_0", 0x400974], ["aSlot_1", 0x400975],
    ["aSlot_2", 0x400976], ["aSlot_3", 0x400977],
    // palette queue
    ["palQ_0", 0x400408], ["palQ_1", 0x400409],
    ["palQ_2", 0x40040a], ["palQ_3", 0x40040b],
    ["palB_0", 0x40040c], ["palB_1", 0x40040d],
    ["palB_2", 0x40040e], ["palB_3", 0x40040f],
  ];

  for (const [label, addr] of globals) {
    const { bin, ts } = peekByte(state, cpu, addr);
    if (bin !== ts) return { what: label, bin, ts };
  }

  const sortedDiff = compareRegion(state, cpu, 0x4003bc, 0x20, "sortedArr");
  if (sortedDiff !== null) return sortedDiff;

  // FUN_18E6C rect-slot area (0x0e bytes @ 0x4001dc)
  const rectDiff = compareRegion(state, cpu, 0x4001dc, 0x0e, "rectSlot");
  if (rectDiff !== null) return rectDiff;

  return null;
}

// ─── Script-stream helpers ────────────────────────────────────────────────────

/** Valid work-RAM addresses for script streams (far from slots and globals). */
const STREAM_ADDRS = [
  0x00401800,
  0x00401860,
  0x00401900,
  0x00401960,
  0x00401a00,
  0x00401a60,
  0x00401b00,
  0x00401b60,
] as const;

/** Valid slot pointers. */
const SLOT_PTRS = [
  0x00401000,
  0x00401080,
  0x00401100,
  0x00401180,
  0x00401200,
  0x00401280,
] as const;

/**
 * Write a word to a work-RAM stream address (both binary and TS).
 * Uses WRAM range only (ROM bytes are not writable in binary).
 */
function streamWord(state: State, cpu: CpuSession, addr: number, v: number): void {
  pokeWord(state, cpu, addr, v & 0xffff);
}

function streamLong(state: State, cpu: CpuSession, addr: number, v: number): void {
  pokeLong(state, cpu, addr, v >>> 0);
}

function resetGlobals(state: State, cpu: CpuSession): void {
  // FUN_13334 output areas
  for (let i = 0; i < 8; i++) pokeByte(state, cpu, 0x400690 + i, 0);
  for (let i = 0; i < 8; i++) pokeByte(state, cpu, 0x400970 + i, 0);
  // Palette queue
  pokeLong(state, cpu, 0x400408, 0x0040040c);
  for (let i = 0; i < 4; i++) pokeByte(state, cpu, 0x40040c + i, 0);
  // FUN_18E6C areas (default: all-0xff sentinel = empty)
  for (let i = 0; i < 0x20; i++) pokeByte(state, cpu, 0x4003bc + i, 0xff);
  for (let i = 0; i < 0x0e; i++) pokeByte(state, cpu, 0x4001dc + i, 0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface FailRecord {
  suite: string;
  i: number;
  slotPtr: number;
  opcode: number;
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

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  applyAllStubs(cpu);

  const rng = makeRng(0x12896);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const pickSlot = (): number => SLOT_PTRS[Math.floor(rng() * SLOT_PTRS.length)]!;
  const pickStream = (): number => STREAM_ADDRS[Math.floor(rng() * STREAM_ADDRS.length)]!;

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOne(
    suite: string,
    i: number,
    slotPtr: number,
    opcode: number,
    setupFn: () => void,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    if (i % 50 === 0) applyAllStubs(cpu);

    resetGlobals(stateInst, cpu);
    setupFn();

    // Run binary: jsr FUN_12896; arg = slotPtr on stack
    callFunction(cpu, FUN_12896, [slotPtr >>> 0]);

    // Run TS
    ns.helper12896(stateInst, tsRom, slotPtr);

    const diff = compareObservables(stateInst, cpu, slotPtr);
    if (diff === null) return true;

    if (failHolder.value === null) {
      failHolder.value = { suite, i, slotPtr, opcode, diff };
    }
    return false;
  }

  // ─── Suite A: opcode 0 — slot[0x1e]==1 (render path) ──────────────────────
  //
  // Produces: slot[0x0c], slot[0x10], slot[0x14], slot[0x1e], slot[0x1f],
  //           slot[0x42], slot[0x26], slot[0x28], slot[0x3e], slot[0x46],
  //           slot[0x36] updated; FUN_13334 side-effects.
  console.log(`\n=== helper12896 (FUN_12896) — Suite A: opcode 0 render path — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotPtr = pickSlot();
    const streamBase = pickStream();
    let opcode = 0;

    okA += runOne("A", i, slotPtr, opcode, () => {
      // Build stream: opcode=0 word + 3 signed words + 2 word-pairs (byte[1] used)
      //   + 1 long (anim sequence base ptr) + then opcode 0xFFFF (exit = out of range)
      const streamPC = streamBase;
      let off = 0;

      // opcode word = 0 (stream)
      streamWord(stateInst, cpu, streamPC + off, 0x0000); off += 2;
      // word1 (posX component)
      const w1 = (rb() - 128) & 0xffff;
      streamWord(stateInst, cpu, streamPC + off, w1); off += 2;
      // word2 (posY component)
      const w2 = (rb() - 128) & 0xffff;
      streamWord(stateInst, cpu, streamPC + off, w2); off += 2;
      // word3 (posZ component)
      const w3 = (rb() & 0x7f) & 0xffff;
      streamWord(stateInst, cpu, streamPC + off, w3); off += 2;
      // byte pair for slot[0x1e] = 1 (low byte of word = byte[1] of word-aligned pair)
      streamWord(stateInst, cpu, streamPC + off, 0x0001); off += 2; // slot[0x1e]=1
      // byte pair for slot[0x1f]
      streamWord(stateInst, cpu, streamPC + off, 0x0000 | (rb() & 0xff)); off += 2;
      // word for slot[0x26]
      const w26 = (rb() | (rb() << 8)) & 0xffff;
      streamWord(stateInst, cpu, streamPC + off, w26); off += 2;
      // word for slot[0x28]
      const w28 = (rb() | (rb() << 8)) & 0xffff;
      streamWord(stateInst, cpu, streamPC + off, w28); off += 2;
      // long: anim base ptr (must be work-RAM address for binary to read it back)
      // Point to a known non-zero long in work RAM
      const animBase = 0x00401c00 + (rb() & 0x0f) * 4;
      // Write a valid-looking anim ptr
      const animVal = 0x00401c40;
      pokeLong(stateInst, cpu, animBase, animVal);
      streamLong(stateInst, cpu, streamPC + off, animBase); off += 4;
      // Terminator: opcode out of range
      streamWord(stateInst, cpu, streamPC + off, 0xffff); off += 2;

      // Initialize slot[0x36] = streamPC
      pokeLong(stateInst, cpu, slotPtr + 0x36, streamPC);

      // Initialize FUN_13334 inputs: slot[0x42] will be set by opcode 0 itself;
      // We just need to zero out so FUN_13334 has deterministic input.
      pokeByte(stateInst, cpu, slotPtr + 0x18, rb() & 0x03); // active
      pokeByte(stateInst, cpu, slotPtr + 0x19, rb());
    }) ? 1 : 0;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: opcode 0 — slot[0x1e]!=1 (insert-sorted path) ──────────────
  console.log(`\n=== Suite B: opcode 0 insert-sorted path — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotPtr = pickSlot();
    const streamBase = pickStream();
    const opcode = 0;

    okB += runOne("B", i, slotPtr, opcode, () => {
      const streamPC = streamBase;
      let off = 0;

      streamWord(stateInst, cpu, streamPC + off, 0x0000); off += 2;
      // 3 words
      streamWord(stateInst, cpu, streamPC + off, (rb() & 0x7f) & 0xffff); off += 2;
      streamWord(stateInst, cpu, streamPC + off, (rb() & 0x7f) & 0xffff); off += 2;
      streamWord(stateInst, cpu, streamPC + off, (rb() & 0x3f) & 0xffff); off += 2;
      // byte pair: slot[0x1e] != 1 (use 0 or 2)
      streamWord(stateInst, cpu, streamPC + off, 0x0000); off += 2;
      // slot[0x1f]: use a small value (0..4) to avoid FUN_18E6C internal issues
      const kind19 = rb() & 0x07;
      streamWord(stateInst, cpu, streamPC + off, kind19 & 0xff); off += 2;
      // Terminator
      streamWord(stateInst, cpu, streamPC + off, 0xffff); off += 2;

      pokeLong(stateInst, cpu, slotPtr + 0x36, streamPC);
      pokeByte(stateInst, cpu, slotPtr + 0x19, rb());
    }) ? 1 : 0;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: opcodes 1..7 — script control flow ──────────────────────────
  //
  // Tests: timer load (1,2,3), loop-A (4,5), loop-B (6,7)
  // These are pure slot-manipulation ops.
  console.log(`\n=== Suite C: opcodes 1..7 script control — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotPtr = pickSlot();
    const streamBase = pickStream();
    const opcodeBase = (rb() % 7) + 1; // 1..7

    okC += runOne("C", i, slotPtr, opcodeBase, () => {
      const streamPC = streamBase;
      let off = 0;

      // Write the target opcode + necessary immediate data
      streamWord(stateInst, cpu, streamPC + off, opcodeBase & 0xffff); off += 2;

      switch (opcodeBase) {
        case 1: {
          // timer word + limit byte
          streamWord(stateInst, cpu, streamPC + off, rb() | (rb() << 8)); off += 2;
          streamWord(stateInst, cpu, streamPC + off, rb()); off += 2;
          // Set slot[0x4a] to a valid work-RAM anim ptr
          pokeLong(stateInst, cpu, slotPtr + 0x4a, 0x00401c80);
          break;
        }
        case 2: {
          // kind19 != 0x0a to skip FUN_158ac call
          streamWord(stateInst, cpu, streamPC + off, rb() | (rb() << 8)); off += 2;
          streamWord(stateInst, cpu, streamPC + off, rb()); off += 2;
          pokeLong(stateInst, cpu, slotPtr + 0x46, 0x00401c80);
          pokeByte(stateInst, cpu, slotPtr + 0x1f, rb() & 0x07); // not 0x0a
          break;
        }
        case 3: {
          // just a timer word
          streamWord(stateInst, cpu, streamPC + off, rb() | (rb() << 8)); off += 2;
          break;
        }
        case 4: {
          // byte countdown (low byte of word)
          const count = (rb() & 0x1f) + 1;
          streamWord(stateInst, cpu, streamPC + off, count & 0xff); off += 2;
          break;
        }
        case 5: {
          // slot[0x24] = countdown, slot[0x2a] = jump target
          const count = rb() & 0x0f;
          pokeByte(stateInst, cpu, slotPtr + 0x24, count);
          pokeLong(stateInst, cpu, slotPtr + 0x2a, streamPC + 4);
          break;
        }
        case 6: {
          const count = (rb() & 0x1f) + 1;
          streamWord(stateInst, cpu, streamPC + off, count & 0xff); off += 2;
          break;
        }
        case 7: {
          const count = rb() & 0x0f;
          pokeByte(stateInst, cpu, slotPtr + 0x25, count);
          pokeLong(stateInst, cpu, slotPtr + 0x2e, streamPC + 4);
          break;
        }
      }

      // Terminator (out-of-range opcode; may not be reached if D1=0)
      streamWord(stateInst, cpu, streamPC + off, 0xffff);

      pokeLong(stateInst, cpu, slotPtr + 0x36, streamPC);
    }) ? 1 : 0;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: opcodes 9..16 — pointer / position ops ──────────────────────
  console.log(`\n=== Suite D: opcodes 9..16 pointer/position — ${perSuite} casi ===`);
  let okD = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotPtr = pickSlot();
    const streamBase = pickStream();
    // Pick a subset that avoids FUN_158ac call (opcode 8 complexity) and
    // opcode 18 (complex). Opcodes 9..14,16.
    const opChoices = [9, 10, 11, 12, 13, 14, 16];
    const opcode = opChoices[Math.floor(rng() * opChoices.length)]!;

    okD += runOne("D", i, slotPtr, opcode, () => {
      const streamPC = streamBase;
      let off = 0;

      streamWord(stateInst, cpu, streamPC + off, opcode & 0xffff); off += 2;

      switch (opcode) {
        case 9: {
          // indirect jump: *slot[0x36] = target
          const target = streamPC + 8; // jump forward in stream
          streamLong(stateInst, cpu, streamPC + off, target); off += 4;
          // at target, write a terminator opcode
          streamWord(stateInst, cpu, target, 0xffff);
          break;
        }
        case 10: {
          // call: *slot[0x36]++ → target; slot[0x32] = A0 (return)
          const target = streamPC + 8;
          streamLong(stateInst, cpu, streamPC + off, target); off += 4;
          streamWord(stateInst, cpu, target, 0xffff);
          break;
        }
        case 11: {
          // return from call: slot[0x36] = slot[0x32]
          const savedPC = streamPC + 6;
          pokeLong(stateInst, cpu, slotPtr + 0x32, savedPC);
          streamWord(stateInst, cpu, savedPC, 0xffff); // terminator at saved PC
          break;
        }
        case 12: {
          // load base ptr: *stream++
          const animPtr = 0x00401c00;
          pokeLong(stateInst, cpu, streamPC + off, animPtr); off += 4;
          // Write something at animPtr so reads don't fault
          pokeLong(stateInst, cpu, animPtr, 0x00401c10);
          streamWord(stateInst, cpu, streamPC + off, 0xffff);
          break;
        }
        case 13: {
          // load alt ptr: *stream++
          const animPtr = 0x00401c20;
          pokeLong(stateInst, cpu, streamPC + off, animPtr); off += 4;
          pokeLong(stateInst, cpu, animPtr, 0x00401c30);
          streamWord(stateInst, cpu, streamPC + off, 0xffff);
          break;
        }
        case 14: {
          // load 2 velocity words (<<8 signed)
          streamWord(stateInst, cpu, streamPC + off, (rb() | (rb() << 8)) & 0xffff); off += 2;
          streamWord(stateInst, cpu, streamPC + off, (rb() | (rb() << 8)) & 0xffff); off += 2;
          streamWord(stateInst, cpu, streamPC + off, 0xffff);
          break;
        }
        case 16: {
          // position step: slot[0x0c] += slot[0x00], slot[0x10] += slot[0x04]
          // Set random velocities
          pokeLong(stateInst, cpu, slotPtr + 0x00, (rb() | (rb() << 8) | (rb() << 16) | (rb() << 24)) >>> 0);
          pokeLong(stateInst, cpu, slotPtr + 0x04, (rb() | (rb() << 8) | (rb() << 16) | (rb() << 24)) >>> 0);
          pokeLong(stateInst, cpu, slotPtr + 0x0c, (rb() | (rb() << 8) | (rb() << 16) | (rb() << 24)) >>> 0);
          pokeLong(stateInst, cpu, slotPtr + 0x10, (rb() | (rb() << 8) | (rb() << 16) | (rb() << 24)) >>> 0);
          streamWord(stateInst, cpu, streamPC + off, 0xffff);
          break;
        }
      }

      pokeLong(stateInst, cpu, slotPtr + 0x36, streamPC);
    }) ? 1 : 0;
  }
  console.log(`  Match: ${okD}/${perSuite} = ${((okD / perSuite) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ─── Suite E: opcodes 15,17 + edge cases ─────────────────────────────────
  console.log(`\n=== Suite E: opcodes 15/17 + edge cases — ${extraE} casi ===`);
  let okE = 0;
  for (let i = 0; i < extraE; i++) {
    const slotPtr = pickSlot();
    const streamBase = pickStream();
    const opChoices15_17 = [15, 17];
    const opcode = opChoices15_17[Math.floor(rng() * opChoices15_17.length)]!;

    okE += runOne("E", i, slotPtr, opcode, () => {
      const streamPC = streamBase;
      let off = 0;

      streamWord(stateInst, cpu, streamPC + off, opcode & 0xffff); off += 2;

      switch (opcode) {
        case 15: {
          // jsr FUN_12F44(slotPtr, 1, 0) → free slot
          // Set slot as active so FUN_12F44 can run
          pokeByte(stateInst, cpu, slotPtr + 0x18, 1);
          pokeByte(stateInst, cpu, slotPtr + 0x1a, 0);
          // Set slot[0x1f] to small value (avoid FUN_18F46 branching issues)
          pokeByte(stateInst, cpu, slotPtr + 0x1f, rb() & 0x07);
          pokeByte(stateInst, cpu, slotPtr + 0x1e, rb() & 0x03);
          streamWord(stateInst, cpu, streamPC + off, 0xffff);
          break;
        }
        case 17: {
          // save mode: slot[0x32] = PC-2, slot[0x1a] = 4, slot[0x1b] = next byte
          streamWord(stateInst, cpu, streamPC + off, rb() & 0x1f); off += 2;
          streamWord(stateInst, cpu, streamPC + off, 0xffff);
          break;
        }
      }

      pokeLong(stateInst, cpu, slotPtr + 0x36, streamPC);
    }) ? 1 : 0;
  }
  console.log(`  Match: ${okE}/${extraE} = ${((okE / extraE) * 100).toFixed(1)}%`);
  totalOk += okE;

  // ─── Summary ─────────────────────────────────────────────────────────────────
  const grand = total;
  console.log(`\n=== TOTALE: ${totalOk}/${grand} = ${((totalOk / grand) * 100).toFixed(2)}% ===`);

  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.error(
      `\nPRIMO FAIL: suite=${f.suite} caso=${f.i} slotPtr=0x${f.slotPtr.toString(16)} opcode=${f.opcode}`,
    );
    console.error(`  diff: ${f.diff.what} bin=0x${f.diff.bin.toString(16)} ts=0x${f.diff.ts.toString(16)}`);
  }

  disposeCpu(cpu);

  if (totalOk < grand) {
    console.error(`\nPARITY FAIL: ${grand - totalOk} casi falliti su ${grand}`);
    exit(1);
  }

  console.log("\nAll parity checks passed.");
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
