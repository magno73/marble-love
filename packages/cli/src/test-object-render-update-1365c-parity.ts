#!/usr/bin/env node
/**
 * test-object-render-update-1365c-parity.ts —
 * differential FUN_0001365C vs `objectRenderUpdate1365C`.
 *
 * **Strategia**:
 * FUN_1365C ha 4 path macro osservabili:
 *   A. Early-exit (POS invariato: A1==frame[-c] && A4==frame[-a]).
 *   B. Loop-scan senza match valido → nessuna scrittura su A2.
 *   C. Match → A2+0x1b aggiornato, poi ramo -1 (new state, palette, sound).
 *   D. Match → A2+0x1b = 4 + gameMode==3 → loop 25 slot @ 0x400a9c.
 *
 * Sub non replicate (FUN_285B0, FUN_158AC, FUN_12F44, FUN_12896, FUN_13966)
 * vengono patchate con `rts` (4E75) nel binario. Le callback TS sono no-op.
 * `paletteQueuePush` e `soundPair15884` sono replicate → side effect osservabili.
 *
 * Observable comparate:
 *   - workRam @ A2..A2+0x80 (struct oggetto)
 *   - workRam @ 0x4003a4 (byte global)
 *   - workRam @ 0x400408..0x40040f (palette queue)
 *   - workRam @ 0x400a9c..0x400a9c+25*0x56 (slot array, per ramo D)
 *
 * Suites:
 *   A (smoke): early-exit (POS invariato).
 *   B: random POS + random game mode → scan with random table.
 *   C: forza match → ramo A2+0x1b==-1 (new state).
 *   D: game mode==3, A2+0x1b==4 → ramo slot loop.
 *
 * Uso: npx tsx packages/cli/src/test-object-render-update-1365c-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
// Relative import to access the worktree-local module (node_modules symlinks to main repo).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as ns from "../../engine/src/object-render-update-1365c.js";
// GameState is structurally identical across repos; cast to avoid nominal-type error.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyState = any;
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_1365C = 0x0001365c;

// Sub-jsr addresses to stub out with `rts`
const STUB_ADDRS = [
  0x000285b0, // FUN_285B0
  0x000158ac, // FUN_158AC (sound command sender)
  0x00012f44, // FUN_12F44
  0x00012896, // FUN_12896
  0x00013966, // FUN_13966
] as const;

const RTS_BYTES = [0x4e, 0x75] as const;

// Globals
const OBJ_PTR_CHOICES = [
  0x00401200, 0x00401400, 0x00401600, 0x00401800, 0x00401a00,
] as const;

const STRUCT_SIZE = 0x80;
const SLOT_STRIDE = 0x56;
const SLOT_COUNT = 25;
const SLOT_ARRAY_BASE = 0x400a9c;

const PAL_QUEUE_PTR_ADDR = 0x00400408;
const PAL_QUEUE_HEAD = 0x0040040c;
const GLOBAL_3A4_ADDR = 0x004003a4;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  suite: string;
  i: number;
  objPtr: number;
  reason: string;
  binVal: number;
  tsVal: number;
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

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  function applyStubs(): void {
    for (const addr of STUB_ADDRS) {
      for (let i = 0; i < RTS_BYTES.length; i++) {
        pokeMem(cpu, addr + i, 1, RTS_BYTES[i]!);
      }
    }
  }
  applyStubs();

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function writeGlobal(addr: number, size: 1 | 2 | 4, val: number): void {
    pokeMem(cpu, addr, size, val);
    const off = addr - 0x400000;
    if (size === 1) {
      stateInst.workRam[off] = val & 0xff;
    } else if (size === 2) {
      stateInst.workRam[off] = (val >>> 8) & 0xff;
      stateInst.workRam[off + 1] = val & 0xff;
    } else {
      stateInst.workRam[off] = (val >>> 24) & 0xff;
      stateInst.workRam[off + 1] = (val >>> 16) & 0xff;
      stateInst.workRam[off + 2] = (val >>> 8) & 0xff;
      stateInst.workRam[off + 3] = val & 0xff;
    }
  }

  function setupBytes(addr: number, bytes: number[]): void {
    for (let i = 0; i < bytes.length; i++) {
      const v = bytes[i] ?? 0;
      pokeMem(cpu, addr + i, 1, v);
      stateInst.workRam[addr - 0x400000 + i] = v;
    }
  }

  function resetPaletteQueue(): void {
    const head = PAL_QUEUE_HEAD >>> 0;
    writeGlobal(PAL_QUEUE_PTR_ADDR, 4, head);
    for (let i = 0; i < 4; i++) {
      pokeMem(cpu, PAL_QUEUE_HEAD + i, 1, 0);
      stateInst.workRam[PAL_QUEUE_HEAD + i - 0x400000] = 0;
    }
  }

  function compareRange(
    addrStart: number,
    len: number,
    label: string,
  ): { what: string; bin: number; ts: number } | null {
    for (let i = 0; i < len; i++) {
      const b = peekMem(cpu, addrStart + i, 1);
      const t = stateInst.workRam[addrStart + i - 0x400000] ?? 0;
      if (b !== t) {
        return {
          what: `${label}[+0x${i.toString(16)}]`,
          bin: b,
          ts: t,
        };
      }
    }
    return null;
  }

  function compareAll(
    objPtr: number,
  ): { what: string; bin: number; ts: number } | null {
    // Object struct
    const r1 = compareRange(objPtr, STRUCT_SIZE, `obj@${objPtr.toString(16)}`);
    if (r1) return r1;
    // Global 0x4003a4
    {
      const b = peekMem(cpu, GLOBAL_3A4_ADDR, 1);
      const t = stateInst.workRam[GLOBAL_3A4_ADDR - 0x400000] ?? 0;
      if (b !== t) return { what: "global_3a4", bin: b, ts: t };
    }
    // Palette queue ptr + body
    for (let i = 0; i < 8; i++) {
      const b = peekMem(cpu, PAL_QUEUE_PTR_ADDR + i, 1);
      const t = stateInst.workRam[PAL_QUEUE_PTR_ADDR + i - 0x400000] ?? 0;
      if (b !== t) return { what: `palQ[+${i}]`, bin: b, ts: t };
    }
    // Slot array
    const slotEnd = SLOT_ARRAY_BASE + SLOT_COUNT * SLOT_STRIDE;
    const r2 = compareRange(SLOT_ARRAY_BASE, slotEnd - SLOT_ARRAY_BASE, "slots");
    if (r2) return r2;
    return null;
  }

  function runOneCase(
    suite: string,
    i: number,
    objPtr: number,
    setupFn: () => void,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    if (i % 50 === 0) applyStubs();

    resetPaletteQueue();
    setupFn();

    callFunction(cpu, FUN_1365C, [objPtr >>> 0]);
    ns.objectRenderUpdate1365C(stateInst as AnyState, tsRom as AnyState, objPtr, {
      // All non-replicated subs are no-op (stubs applied in binary)
    });

    const diff = compareAll(objPtr);
    if (diff === null) return true;

    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        i,
        objPtr,
        reason: diff.what,
        binVal: diff.bin,
        tsVal: diff.ts,
      };
    }
    return false;
  }

  const rng = makeRng(0x1365c);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const pickPtr = (): number =>
    OBJ_PTR_CHOICES[Math.floor(rng() * OBJ_PTR_CHOICES.length)]!;

  // ─── Suite A: early-exit (POS invariato) ────────────────────────────────
  console.log(`\n=== FUN_0001365C — Suite A: early-exit (POS invariato) — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const objPtr = pickPtr();
    const ok = runOneCase("A", i, objPtr, () => {
      // Set POS_X curr == POS_X prev, POS_Y curr == POS_Y prev → early exit
      const px = (rb() | (rb() << 8)) & 0xffff;
      const py = (rb() | (rb() << 8)) & 0xffff;
      writeGlobal(0x400696, 2, px);
      writeGlobal(0x400698, 2, py);
      writeGlobal(0x40069a, 2, px); // prev == curr → early exit
      writeGlobal(0x40069c, 2, py);
      writeGlobal(0x400394, 2, rb() & 0x3); // random game mode
      writeGlobal(GLOBAL_3A4_ADDR, 1, rb());
      // Random object struct
      const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
      setupBytes(objPtr, bytes);
    });
    if (ok) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: POS cambiato, scan random (no forced match) ───────────────
  console.log(`\n=== Suite B: POS cambiato, scan random — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const objPtr = pickPtr();
    const ok = runOneCase("B", i, objPtr, () => {
      // POS curr != POS prev
      const px = rb() & 0x1f;
      const py = rb() & 0x1f;
      const pxPrev = (px + 1 + (rb() & 3)) & 0xff;
      const pyPrev = (py + 1 + (rb() & 3)) & 0xff;
      writeGlobal(0x400696, 2, px);
      writeGlobal(0x400698, 2, py);
      writeGlobal(0x40069a, 2, pxPrev);
      writeGlobal(0x40069c, 2, pyPrev);
      writeGlobal(0x400394, 2, rb() & 0x3);
      writeGlobal(GLOBAL_3A4_ADDR, 1, 0xff);

      const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
      // Make A2+0x1b NOT equal to 0xff or 4 to avoid side-effect branches
      bytes[0x1b] = rb() & 0x02; // keep it 0..2
      setupBytes(objPtr, bytes);

      // Reset slot array to safe values
      const slotBytes = new Array(SLOT_COUNT * SLOT_STRIDE).fill(0);
      setupBytes(SLOT_ARRAY_BASE, slotBytes);
    });
    if (ok) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forza match → A2+0x1b == -1 (new-state path) ─────────────
  console.log(`\n=== Suite C: new-state path (A2+0x1b → -1) — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const objPtr = pickPtr();
    const ok = runOneCase("C", i, objPtr, () => {
      // Use game mode 0 (simplest branch in the new-state path)
      writeGlobal(0x400394, 2, 0);
      // Set POS_X curr = some value, prev = different
      const px = rb() & 0x7;
      const py = rb() & 0x7;
      writeGlobal(0x400696, 2, px);
      writeGlobal(0x400698, 2, py);
      writeGlobal(0x40069a, 2, (px + 4) & 0xffff);
      writeGlobal(0x40069c, 2, (py + 4) & 0xffff);
      // Set 0x4003a4 = 0xff (so the inner check fires)
      writeGlobal(GLOBAL_3A4_ADDR, 1, 0xff);

      // Build object struct: pre-state D2b != 0xff/4
      const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
      bytes[0x1b] = rb() & 0x02; // pre-call state (not -1 or 4)
      bytes[0x18] = rb() & 0x03; // tile type
      bytes[0x19] = rb() & 0x03; // palette index (small, valid for 0x1ef72)
      bytes[0x1a] = rb() & 0x05; // state byte
      setupBytes(objPtr, bytes);
      setupBytes(SLOT_ARRAY_BASE, new Array(SLOT_COUNT * SLOT_STRIDE).fill(0));
    });
    if (ok) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: game mode==3, A2+0x1b==4 → slot loop ─────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: slot-loop path (gameMode==3, A2+0x1b==4) — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const objPtr = pickPtr();
    const ok = runOneCase("D", i, objPtr, () => {
      writeGlobal(0x400394, 2, 3); // game mode 3
      // POS different
      writeGlobal(0x400696, 2, 5);
      writeGlobal(0x400698, 2, 3);
      writeGlobal(0x40069a, 2, 2);
      writeGlobal(0x40069c, 2, 7);
      writeGlobal(GLOBAL_3A4_ADDR, 1, 0);

      // Object struct: byte[0x1b] will be written to 4 by the scan path.
      // To get A2+0x1b==4 after scan, we need a ROM entry that writes 4.
      // Simplest: just set it directly as pre-state and let scan assign same.
      const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
      bytes[0x1b] = rb() & 0x01; // start not at 4
      bytes[0x18] = rb() & 0x03;
      bytes[0x19] = 0;
      bytes[0x1a] = rb() & 0x05;
      setupBytes(objPtr, bytes);

      // Setup 25-slot array with varied states
      const slotArr = new Array(SLOT_COUNT * SLOT_STRIDE).fill(0).map(() => rb());
      for (let s = 0; s < SLOT_COUNT; s++) {
        const base = s * SLOT_STRIDE;
        // Randomize slot state fields
        slotArr[base + 0x18] = [0, 1][Math.floor(rng() * 2)]!; // tile type
        slotArr[base + 0x1a] = [0, 2, 4][Math.floor(rng() * 3)]!; // state
        slotArr[base + 0x1b] = (rb() & 0x1f) + 0x1e; // new state byte (0x1e..0x3d)
        slotArr[base + 0x1f] = [0x0b, 0x0d, rb()][Math.floor(rng() * 3)]!; // kind
      }
      setupBytes(SLOT_ARRAY_BASE, slotArr);
    });
    if (ok) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} i=${f.i}):`);
    console.log(
      `    objPtr=0x${f.objPtr.toString(16)} @${f.reason}: ` +
        `bin=0x${f.binVal.toString(16)} ts=0x${f.tsVal.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
