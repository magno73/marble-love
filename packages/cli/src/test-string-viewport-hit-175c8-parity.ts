#!/usr/bin/env node
/**
 * test-string-viewport-hit-175c8-parity.ts —
 * differential FUN_175C8 vs `stringViewportHit175C8`.
 *
 * `FUN_000175C8` (266 byte) takes un long arg (objPtr), e:
 *   2. Else: itera 7 string-slot @ 0x401482 (stride 0x42); per slot armata
 *      (slot[+0x18] != 0), risolve un bbox via deref doppio
 *      (slot[+0x3a] → ptrPtr → bboxPtr; sentinel 0xFFFFFFFF → default
 *      (-2,-2,12,12)) and tests overlap with a viewport word
 *      (marble +/- 3 words, marble +/- 3 words) around coords @ 0x400690/692.
 *      Sul **first** overlap:
 *        - obj[+0x58] = slot[+0x19]
 *        - slot[+0x25] = 0x1c
 *
 * **Strategia parity**:
 *   - `FUN_00025BAE` (entity state-transition) **stubbed with RTS** (0x4E75)
 *     to neutralize the side effects on obj. TS uses
 *     `subs.entityStateTransition = noop` per matchare.
 *   - `FUN_000158AC` (sound command sender) stubbed with RTS, TS no-op.
 *
 * **Compare**:
 *   - Return value (D0 long).
 *   - Workram completa (8 KB) pre vs post, eccetto stack scratch zone
 *
 *   - E: random everything (gameMode random, slot/bbox random)
 *
 * Uso: npx tsx packages/cli/src/test-string-viewport-hit-175c8-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stringViewportHit175C8 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_175C8 = 0x000175c8;
const FUN_25BAE = 0x00025bae;
const FUN_158AC = 0x000158ac;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

const GAME_MODE_ADDR = 0x00400394;
const MARBLE_X_ADDR = 0x00400690;
const MARBLE_Y_ADDR = 0x00400692;

const SLOT_BASE = 0x00401482;
const SLOT_STRIDE = 0x42;
const SLOT_COUNT = 7;

// Indirizzi of scratch:
const OBJ_ADDR = 0x00401c00;       // obj base (almeno 0x60 byte)
const PTR_PTR_BASE = 0x00401d00;   // 7 × 4 byte: ptrPtr storage per slot
const BBOX_BASE = 0x00401e00;      // 7 × 8 byte: bbox struct if non sentinel

const BBOX_SENTINEL = 0xffffffff >>> 0;

/**
 * Patch JSR-stubs:
 *   - FUN_25BAE → RTS (0x4E75) per neutralize entity state-transition.
 *     Caller pushes 2 longs (objPtr, 9). NOP-RTS stub pops only PC, leaving
 *     args on the stack; FUN_175C8's caller clears them with
 *     `lea (0xc, SP), SP` (12 byte = 3 long).
 *   - FUN_158AC → RTS (0x4E75).
 */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_25BAE + 0, 1, 0x4e);
  pokeMem(cpu, FUN_25BAE + 1, 1, 0x75);
  pokeMem(cpu, FUN_158AC + 0, 1, 0x4e);
  pokeMem(cpu, FUN_158AC + 1, 1, 0x75);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Capture intero workRam as Uint8Array. */
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

function loadStateWorkRam(
  state: ReturnType<typeof stateNs.emptyGameState>,
  src: Uint8Array,
): void {
  state.workRam.set(src);
}

interface SlotSpec {
  active: boolean;
  scriptId: number;        // byte (slot+0x19)
  newState: number;        // byte (slot+0x25)
  x: number;               // word (slot+0xC)
  y: number;               // word (slot+0x10)
  bboxAddrLong: number;
  bbox: { xMin: number; yMin: number; w: number; h: number };
}

interface CaseInput {
  gameMode: number;        // word @ 0x400394
  marbleX: number;         // word @ 0x400690
  marbleY: number;         // word @ 0x400692
  slots: SlotSpec[];       // 7 slots
  objScriptIdInit: number;
  /**
    */
  initialD2Byte: number;
}

function buildPreState(input: CaseInput, randomTail: () => number): Uint8Array {
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

  // globals
  setWord(GAME_MODE_ADDR, input.gameMode);
  setWord(MARBLE_X_ADDR, input.marbleX);
  setWord(MARBLE_Y_ADDR, input.marbleY);

  // obj+0x58 init
  setByte(OBJ_ADDR + 0x58, input.objScriptIdInit);

  // slots
  for (let i = 0; i < SLOT_COUNT; i++) {
    const sl = input.slots[i]!;
    const slotAddr = SLOT_BASE + i * SLOT_STRIDE;
    setByte(slotAddr + 0x18, sl.active ? 1 : 0);
    setByte(slotAddr + 0x19, sl.scriptId);
    setByte(slotAddr + 0x25, sl.newState);
    setWord(slotAddr + 0x0c, sl.x);
    setWord(slotAddr + 0x10, sl.y);
    // ptrPtr storage @ PTR_PTR_BASE + i*4
    const p1 = PTR_PTR_BASE + i * 4;
    setLong(slotAddr + 0x3a, p1);
    setLong(p1, sl.bboxAddrLong);
    if (sl.bboxAddrLong !== BBOX_SENTINEL) {
      setByte(sl.bboxAddrLong + 4, sl.bbox.xMin);
      setByte(sl.bboxAddrLong + 5, sl.bbox.yMin);
      setByte(sl.bboxAddrLong + 6, sl.bbox.w);
      setByte(sl.bboxAddrLong + 7, sl.bbox.h);
    }
  }

  return wr;
}

/** Compare workRam, escludendo la area stack scratch [0x1E80..0x2000).
 *
 *  identici su both i sides).
 */
function compareWorkRam(
  postBin: Uint8Array,
  postTs: Uint8Array,
): { offset: number; bin: number; ts: number } | null {
  const STACK_SCRATCH_START = 0x1e80;
  for (let j = 0; j < STACK_SCRATCH_START; j++) {
    if (postBin[j] !== postTs[j]) {
      return { offset: j, bin: postBin[j] ?? 0, ts: postTs[j] ?? 0 };
    }
  }
  return null;
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  diff: { offset: number; bin: number; ts: number } | null;
  binRet: number;
  tsRet: number;
  input: CaseInput;
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

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchSubs(cpu);

  console.log(`\n=== stringViewportHit175C8 (FUN_175C8) — ${total} cases ===`);

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tc: number, input: CaseInput): boolean {
    const tailRng = makeRng(0x175c8 ^ tc ^ suite.charCodeAt(0));
    const pre = buildPreState(input, () => Math.floor(tailRng() * 256));

    // BINARY side
    cpu.system.setRegister("sp", 0x401f00);
    cpu.system.setRegister("d2", input.initialD2Byte & 0xff);
    loadWorkRam(cpu, pre);
    const callRes = callFunction(cpu, FUN_175C8, [OBJ_ADDR >>> 0]);
    const postBin = captureWorkRam(cpu);
    const binRet = callRes.d0 >>> 0;

    // TS side
    loadStateWorkRam(stateInst, pre);
    const tsResult = ns.stringViewportHit175C8(
      stateInst,
      OBJ_ADDR,
      {
        entityStateTransition: () => {
          /* matching stub */
        },
        soundCommand: () => {
          /* matching stub */
        },
      },
      input.initialD2Byte & 0xff,
    );
    const postTs = new Uint8Array(stateInst.workRam);
    const tsRet = tsResult.retVal >>> 0;

    let reason = "";
    let diff: { offset: number; bin: number; ts: number } | null = null;
    if (binRet !== tsRet) {
      reason = `retVal mismatch: bin=0x${binRet.toString(16)} ts=0x${tsRet.toString(16)}`;
    } else {
      diff = compareWorkRam(postBin, postTs);
      if (diff !== null) {
        reason =
          `workRam mismatch @ off 0x${diff.offset.toString(16)} ` +
          `(addr 0x${(WORK_RAM_BASE + diff.offset).toString(16)}): ` +
          `bin=0x${diff.bin.toString(16)} ts=0x${diff.ts.toString(16)}`;
      }
    }

    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = { suite, tc, reason, diff, binRet, tsRet, input };
    }
    return false;
  }

  const rng = makeRng(0x175c80a);
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

  /** Random slot spec (active=true). */
  function randSlot(activeProb: number, useBboxProb: number): SlotSpec {
    const useBbox = rng() < useBboxProb;
    return {
      active: rng() < activeProb,
      scriptId: rb(),
      newState: rb(),
      x: rw(),
      y: rw(),
      bboxAddrLong: useBbox ? BBOX_BASE + Math.floor(rng() * 7) * 8 : BBOX_SENTINEL,
      bbox: { xMin: rsb(), yMin: rsb(), w: rsb(), h: rsb() },
    };
  }
  function emptySlot(): SlotSpec {
    return {
      active: false,
      scriptId: 0,
      newState: 0,
      x: 0,
      y: 0,
      bboxAddrLong: BBOX_SENTINEL,
      bbox: { xMin: 0, yMin: 0, w: 0, h: 0 },
    };
  }

  // ─── Suite A: gameMode ∉ {2,5} → early-exit ─────────────────────────
  console.log(`\n  Suite A (gameMode ∉ {2,5} → early-exit) — ${perSuite} casi`);
  let okA = 0;
  const otherModes = [0, 1, 3, 4, 6, 7, 8, 0xa, 0xff, 0x100, 0xffff];
  for (let i = 0; i < perSuite; i++) {
    const slots: SlotSpec[] = [];
    for (let s = 0; s < SLOT_COUNT; s++) slots.push(randSlot(0.6, 0.5));
    const input: CaseInput = {
      gameMode: otherModes[i % otherModes.length]!,
      marbleX: rw(),
      marbleY: rw(),
      slots,
      objScriptIdInit: rb(),
      initialD2Byte: 0,
    };
    if (runOneCase("A", i, input)) okA++;
  }
  console.log(`    Match: ${okA}/${perSuite}`);
  totalOk += okA;

  console.log(`\n  Suite B (gameMode=2 + slot 0 hit) — ${perSuite} casi`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const mx = rsw();
    const my = rsw();
    const slot0: SlotSpec = {
      active: true,
      scriptId: rb(),
      newState: rb(),
      x: mx & 0xffff,
      y: my & 0xffff,
      bboxAddrLong: BBOX_SENTINEL,
      bbox: { xMin: 0, yMin: 0, w: 0, h: 0 },
    };
    const slots: SlotSpec[] = [slot0];
    for (let s = 1; s < SLOT_COUNT; s++) slots.push(emptySlot());
    const input: CaseInput = {
      gameMode: 2,
      marbleX: mx & 0xffff,
      marbleY: my & 0xffff,
      slots,
      objScriptIdInit: rb(),
      initialD2Byte: 0,
    };
    if (runOneCase("B", i, input)) okB++;
  }
  console.log(`    Match: ${okB}/${perSuite}`);
  totalOk += okB;

  // ─── Suite C: gameMode=5, armed slots with bbox boundary edges ───────
  console.log(`\n  Suite C (gameMode=5 + boundary bbox edges) — ${perSuite} casi`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const mx = rsw();
    const my = rsw();
    const slots: SlotSpec[] = [];
    for (let s = 0; s < SLOT_COUNT; s++) {
      // Slot @ marble + offset random ±8
      const dx = Math.floor(rng() * 17) - 8;
      const dy = Math.floor(rng() * 17) - 8;
      const useBbox = (s + i) % 2 === 0;
      const sx = (mx + dx) & 0xffff;
      const sy = (my + dy) & 0xffff;
      slots.push({
        active: true,
        scriptId: rb(),
        newState: rb(),
        x: sx,
        y: sy,
        bboxAddrLong: useBbox ? BBOX_BASE + s * 8 : BBOX_SENTINEL,
        bbox: { xMin: rsb(), yMin: rsb(), w: rsb(), h: rsb() },
      });
    }
    const input: CaseInput = {
      gameMode: 5,
      marbleX: mx & 0xffff,
      marbleY: my & 0xffff,
      slots,
      objScriptIdInit: rb(),
      initialD2Byte: 0,
    };
    if (runOneCase("C", i, input)) okC++;
  }
  console.log(`    Match: ${okC}/${perSuite}`);
  totalOk += okC;

  console.log(`\n  Suite D (gameMode=2 + all inactive) — ${perSuite} casi`);
  let okD = 0;
  for (let i = 0; i < perSuite; i++) {
    const slots: SlotSpec[] = [];
    for (let s = 0; s < SLOT_COUNT; s++) slots.push(emptySlot());
    const input: CaseInput = {
      gameMode: 2,
      marbleX: rw(),
      marbleY: rw(),
      slots,
      objScriptIdInit: rb(),
      // various initialD2Byte per testare sext_long
      initialD2Byte: [0, 1, 0x7f, 0x80, 0xff, 0x42, 0xc0][i % 7]!,
    };
    if (runOneCase("D", i, input)) okD++;
  }
  console.log(`    Match: ${okD}/${perSuite}`);
  totalOk += okD;

  // ─── Suite E: random everything (also gameMode random) ──────────────
  const sizeE = perSuite + remainder;
  console.log(`\n  Suite E (random everything) — ${sizeE} casi`);
  let okE = 0;
  for (let i = 0; i < sizeE; i++) {
    const slots: SlotSpec[] = [];
    for (let s = 0; s < SLOT_COUNT; s++) slots.push(randSlot(0.5, 0.4));
    // gameMode: 50% in {2,5}, 50% other
    const inSet = rng() < 0.5;
    const gm = inSet ? (rng() < 0.5 ? 2 : 5) : Math.floor(rng() * 0x100);
    const input: CaseInput = {
      gameMode: gm,
      marbleX: rw(),
      marbleY: rw(),
      slots,
      objScriptIdInit: rb(),
      initialD2Byte: 0,
    };
    if (runOneCase("E", i, input)) okE++;
  }
  console.log(`    Match: ${okE}/${sizeE}`);
  totalOk += okE;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(
      `    binRet=0x${f.binRet.toString(16)} tsRet=0x${f.tsRet.toString(16)}`,
    );
    console.log(
      `    gameMode=0x${f.input.gameMode.toString(16)} ` +
        `marbleX=0x${f.input.marbleX.toString(16)} ` +
        `marbleY=0x${f.input.marbleY.toString(16)} ` +
        `initD2=0x${f.input.initialD2Byte.toString(16)}`,
    );
    for (let s = 0; s < SLOT_COUNT; s++) {
      const sl = f.input.slots[s]!;
      console.log(
        `    slot[${s}]: active=${sl.active} x=0x${sl.x.toString(16)} y=0x${sl.y.toString(16)} ` +
          `bbox=0x${sl.bboxAddrLong.toString(16)} ` +
          `(xMin=${sl.bbox.xMin} yMin=${sl.bbox.yMin} w=${sl.bbox.w} h=${sl.bbox.h})`,
      );
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
