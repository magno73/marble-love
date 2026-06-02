#!/usr/bin/env node
/**
 * test-string-target-step-176d2-parity.ts —
 * differential FUN_176D2 vs `stringTargetStep176D2`.
 *
 * a `obj+0x58`, dereferences twice la chain `slot[+0x3a]` per ottenere
 *      -2,-2,12,12 if bboxPtr == 0xFFFFFFFF),
 *      targetY analogous with +0x10,
 *   3. makes a one-unit step of curX (= obj[+0xC].w) toward targetX (sign(diff)),
 *      idem per Y,
 *      obj[+0x10..+0x13] analogo.
 *
 *
 *   - obj      @ 0x401C00 (almeno 0x60 byte, up to 0x401C5F)
 *   - p1Addr   @ 0x401D00 (4 byte, contains bboxAddr o sentinel)
 *   - bboxAddr @ 0x401E00 (8 byte, +4..+7 are the 4 signed byte)
 *
 * (obj+0xC..+0xF and obj+0x10..+0x13). We compare the intero workRam tranne
 * la area stack scratch [0x401E80..0x401F00).
 *
 *   - A: path default (bboxPtr == 0xFFFFFFFF), idx random, slotCx/Cy random,
 *        curX/Y random
 *   - B: path read-bbox, bbox bytes random (xMin,yMin,width,height ∈ [-128,127]),
 *        cur, slotC, idx random
 *   - C: edge case sign step (curX == targetX, curY == targetY) → step = 0
 *   - D: edge case overflow word (curX, slotCx, width molto grandi → wrap a 16 bit)
 *   - E: random everything with alternating sentinel pattern at bbox addr
 *
 * Uso: npx tsx packages/cli/src/test-string-target-step-176d2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stringTargetStep176D2 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_176D2 = 0x000176d2;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

// Indirizzi per la chain:
const OBJ_ADDR = 0x00401c00;
const P1_ADDR = 0x00401d00;  // long pointer-to-pointer storage
const BBOX_ADDR = 0x00401e00; // bbox struct (8 byte)
const SLOT_BASE = 0x00401482;
const SLOT_STRIDE = 0x42;

const BBOX_SENTINEL = 0xffffffff >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Cattura workRam from the CPU in un Uint8Array. */
function captureWorkRam(cpu: CpuSession): Uint8Array {
  const out = new Uint8Array(WORK_RAM_SIZE);
  for (let i = 0; i < WORK_RAM_SIZE; i++) {
    out[i] = peekMem(cpu, WORK_RAM_BASE + i, 1) & 0xff;
  }
  return out;
}

function loadWorkRam(cpu: CpuSession, src: Uint8Array): void {
  for (let i = 0; i < WORK_RAM_SIZE; i++) {
    pokeMem(cpu, WORK_RAM_BASE + i, 1, src[i] ?? 0);
  }
}

/** Sync workRam from a Uint8Array into TS state. */
function loadStateWorkRam(
  state: ReturnType<typeof stateNs.emptyGameState>,
  src: Uint8Array,
): void {
  state.workRam.set(src);
}

interface CaseSetup {
  idx: number;          // byte 0..255 (= obj+0x58)
  bboxAddrLong: number;
  slotCxWord: number;
  slotCyWord: number;
  curXWord: number;
  curYWord: number;
  bboxBytes: { xMin: number; yMin: number; width: number; height: number };
}

function buildPreState(setup: CaseSetup, randomTail: () => number): Uint8Array {
  const wr = new Uint8Array(WORK_RAM_SIZE);
  for (let i = 0; i < WORK_RAM_SIZE; i++) wr[i] = randomTail() & 0xff;

  const setByte = (abs: number, v: number): void => {
    wr[abs - WORK_RAM_BASE] = v & 0xff;
  };
  const setWord = (abs: number, v: number): void => {
    setByte(abs, (v >>> 8) & 0xff);
    setByte(abs + 1, v & 0xff);
  };
  const setLong = (abs: number, v: number): void => {
    const u = v >>> 0;
    setByte(abs, (u >>> 24) & 0xff);
    setByte(abs + 1, (u >>> 16) & 0xff);
    setByte(abs + 2, (u >>> 8) & 0xff);
    setByte(abs + 3, u & 0xff);
  };

  const idxSigned = (setup.idx & 0x80) ? setup.idx - 0x100 : setup.idx;
  const slotAddr = (SLOT_BASE + idxSigned * SLOT_STRIDE) >>> 0;

  // obj+0x58 = idx (byte)
  setByte(OBJ_ADDR + 0x58, setup.idx);
  // obj+0xC..+0xF: word at +0xC = curXWord, byte +0xE/+0xF irrelevant but li
  setWord(OBJ_ADDR + 0x0c, setup.curXWord);
  setByte(OBJ_ADDR + 0x0e, 0);
  setByte(OBJ_ADDR + 0x0f, 0);
  // obj+0x10..+0x13
  setWord(OBJ_ADDR + 0x10, setup.curYWord);
  setByte(OBJ_ADDR + 0x12, 0);
  setByte(OBJ_ADDR + 0x13, 0);

  // slot+0x3a = P1_ADDR (long)
  setLong(slotAddr + 0x3a, P1_ADDR);
  // slot+0xC and slot+0x10 word
  setWord(slotAddr + 0x0c, setup.slotCxWord);
  setWord(slotAddr + 0x10, setup.slotCyWord);

  // *P1_ADDR = bboxAddrLong (long)
  setLong(P1_ADDR, setup.bboxAddrLong);

  // bbox bytes (only meaningful if bboxAddrLong points to BBOX_ADDR)
  if (setup.bboxAddrLong === BBOX_ADDR) {
    setByte(BBOX_ADDR + 4, setup.bboxBytes.xMin);
    setByte(BBOX_ADDR + 5, setup.bboxBytes.yMin);
    setByte(BBOX_ADDR + 6, setup.bboxBytes.width);
    setByte(BBOX_ADDR + 7, setup.bboxBytes.height);
  }

  return wr;
}

function compareWorkRam(
  postBin: Uint8Array,
  postTs: Uint8Array,
): { offset: number; bin: number; ts: number } | null {
  // Stack scratch [0x401E80..0x402000) — i registri salvati da movem,
  const STACK_SCRATCH_START = 0x1e80;
  for (let j = 0; j < STACK_SCRATCH_START; j++) {
    if (postBin[j] !== postTs[j]) {
      return { offset: j, bin: postBin[j] ?? 0, ts: postTs[j] ?? 0 };
    }
  }
  return null;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 5);
  const remainder = total - perSuite * 5;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== stringTargetStep176D2 (FUN_176D2) — ${total} cases ===`);

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    setup: CaseSetup;
    diff: { offset: number; bin: number; ts: number };
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tc: number, setup: CaseSetup): boolean {
    // Build pre-fill (different random tail every call for diversity)
    const tailRng = makeRng(0x176d2 ^ tc ^ suite.charCodeAt(0));
    const pre = buildPreState(setup, () => Math.floor(tailRng() * 256));

    // Side binary
    cpu.system.setRegister("sp", 0x401f00);
    loadWorkRam(cpu, pre);
    callFunction(cpu, FUN_176D2, [OBJ_ADDR >>> 0]);
    const postBin = captureWorkRam(cpu);

    // Side TS
    loadStateWorkRam(state, pre);
    ns.stringTargetStep176D2(state, OBJ_ADDR);
    const postTs = new Uint8Array(state.workRam);

    const diff = compareWorkRam(postBin, postTs);
    if (diff !== null) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, setup, diff };
      }
      return false;
    }
    return true;
  }

  const rng = makeRng(0x176d2c0a);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rsb = (): number => {
    const v = rb();
    return v & 0x80 ? v - 0x100 : v;
  };
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;
  const rsw = (): number => {
    const v = rw();
    return v & 0x8000 ? v - 0x10000 : v;
  };
  /** idx byte (signed) constrained: idx ∈ [-32, 32] → slot completamente in
   *  workRam (slot+0x42 ≤ 0x402000, slot ≥ 0x400000). Converte in byte 0..255.
   */
  const ridx = (): number => {
    const s = Math.floor(rng() * 65) - 32; // [-32..32]
    return (s < 0 ? s + 0x100 : s) & 0xff;
  };

  // ── Suite A: path default (bboxPtr == 0xFFFFFFFF) ─────────────────────
  console.log(`\n  Suite A (default path, sentinel) — ${perSuite} casi`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const setup: CaseSetup = {
      idx: ridx(),
      bboxAddrLong: BBOX_SENTINEL,
      slotCxWord: rsw(),
      slotCyWord: rsw(),
      curXWord: rsw(),
      curYWord: rsw(),
      bboxBytes: { xMin: 0, yMin: 0, width: 0, height: 0 }, // unused
    };
    if (runOneCase("A", i, setup)) okA++;
  }
  console.log(`    Match: ${okA}/${perSuite}`);
  totalOk += okA;

  // ── Suite B: path read-bbox ───────────────────────────────────────────
  console.log(`\n  Suite B (read-bbox path) — ${perSuite} casi`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const setup: CaseSetup = {
      idx: ridx(),
      bboxAddrLong: BBOX_ADDR,
      slotCxWord: rsw(),
      slotCyWord: rsw(),
      curXWord: rsw(),
      curYWord: rsw(),
      bboxBytes: {
        xMin: rsb(),
        yMin: rsb(),
        width: rsb(),
        height: rsb(),
      },
    };
    if (runOneCase("B", i, setup)) okB++;
  }
  console.log(`    Match: ${okB}/${perSuite}`);
  totalOk += okB;

  // ── Suite C: cur == target → step = 0 ────────────────────────────────
  console.log(`\n  Suite C (cur al target → step=0) — ${perSuite} casi`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    // targetX = (width>>1)+xMin+slotCx (word). Then set curX = targetX.
    const xMin = rsb();
    const yMin = rsb();
    const width = rsb();
    const height = rsb();
    const slotCx = rsw();
    const slotCy = rsw();
    const wAsr = (width >> 1) & 0xffff;
    const hAsr = (height >> 1) & 0xffff;
    const wAsrS = wAsr & 0x8000 ? wAsr - 0x10000 : wAsr;
    const hAsrS = hAsr & 0x8000 ? hAsr - 0x10000 : hAsr;
    const tX = (wAsrS + xMin + slotCx) & 0xffff;
    const tY = (hAsrS + yMin + slotCy) & 0xffff;
    const tXs = tX & 0x8000 ? tX - 0x10000 : tX;
    const tYs = tY & 0x8000 ? tY - 0x10000 : tY;
    const setup: CaseSetup = {
      idx: ridx(),
      bboxAddrLong: BBOX_ADDR,
      slotCxWord: slotCx,
      slotCyWord: slotCy,
      curXWord: tXs,
      curYWord: tYs,
      bboxBytes: { xMin, yMin, width, height },
    };
    if (runOneCase("C", i, setup)) okC++;
  }
  console.log(`    Match: ${okC}/${perSuite}`);
  totalOk += okC;

  // ── Suite D: word overflow / wrap edge cases ──────────────────────────
  console.log(`\n  Suite D (word wrap edge) — ${perSuite} casi`);
  let okD = 0;
  for (let i = 0; i < perSuite; i++) {
    const choices = [-32768, -32767, -1, 0, 1, 32766, 32767];
    const pick = (): number => choices[Math.floor(rng() * choices.length)]!;
    const setup: CaseSetup = {
      idx: ridx(),
      bboxAddrLong: i % 2 === 0 ? BBOX_ADDR : BBOX_SENTINEL,
      slotCxWord: pick(),
      slotCyWord: pick(),
      curXWord: pick(),
      curYWord: pick(),
      bboxBytes: {
        xMin: [-128, -127, -1, 0, 1, 126, 127][Math.floor(rng() * 7)]!,
        yMin: [-128, -127, -1, 0, 1, 126, 127][Math.floor(rng() * 7)]!,
        width: [-128, -127, -1, 0, 1, 126, 127][Math.floor(rng() * 7)]!,
        height: [-128, -127, -1, 0, 1, 126, 127][Math.floor(rng() * 7)]!,
      },
    };
    if (runOneCase("D", i, setup)) okD++;
  }
  console.log(`    Match: ${okD}/${perSuite}`);
  totalOk += okD;

  // ── Suite E: random everything (sentinel alternato) ───────────────────
  const sizeE = perSuite + remainder;
  console.log(`\n  Suite E (random everything) — ${sizeE} casi`);
  let okE = 0;
  for (let i = 0; i < sizeE; i++) {
    // 50% sentinel, 50% read-bbox
    const useDefault = i % 2 === 0;
    const setup: CaseSetup = {
      idx: ridx(),
      bboxAddrLong: useDefault ? BBOX_SENTINEL : BBOX_ADDR,
      slotCxWord: rsw(),
      slotCyWord: rsw(),
      curXWord: rsw(),
      curYWord: rsw(),
      bboxBytes: {
        xMin: rsb(),
        yMin: rsb(),
        width: rsb(),
        height: rsb(),
      },
    };
    if (runOneCase("E", i, setup)) okE++;
  }
  console.log(`    Match: ${okE}/${sizeE}`);
  totalOk += okE;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): @ WR offset 0x${f.diff.offset.toString(16)} ` +
        `(addr 0x${(WORK_RAM_BASE + f.diff.offset).toString(16)}): bin=0x${f.diff.bin.toString(16)} ts=0x${f.diff.ts.toString(16)}`,
    );
    console.log(
      `    setup: idx=${f.setup.idx} bboxAddr=0x${f.setup.bboxAddrLong.toString(16)} ` +
        `slotCx=${f.setup.slotCxWord} slotCy=${f.setup.slotCyWord} ` +
        `curX=${f.setup.curXWord} curY=${f.setup.curYWord} ` +
        `bbox={xMin:${f.setup.bboxBytes.xMin},yMin:${f.setup.bboxBytes.yMin},w:${f.setup.bboxBytes.width},h:${f.setup.bboxBytes.height}}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
