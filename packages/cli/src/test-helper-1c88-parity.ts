#!/usr/bin/env node
/**
 * test-helper-1c88-parity.ts — differential FUN_1C88 vs helper1C88.
 *
 *
 *   2. Fill Playfield RAM (0xA00000-0xA01FFE, 4096 words = 8192 bytes) with:
 *        fillWord = (workRam16[0x16] != 0) ? 0 : s16(ROM16[0x10060])
 *
 * **Parity strategy**:
 *
 *     1. Generate random data for: alphaRam (4KB), playfieldRam (8KB),
 *        spriteRam[0..1] and spriteRam[0x180..0x181], colorRam[0x400..0x401],
 *        workRam[0x16..0x17] (vblankFlag word).
 *     3. Run TS helper1C88(state, rom).
 *          - alphaRam[0x000..0xFFF]  (4096 byte)
 *          - playfieldRam[0x000..0x1FFF]  (8192 byte)
 *          - spriteRam[0x000..0x001]  (2 byte)
 *          - spriteRam[0x180..0x181]  (2 byte)
 *          - colorRam[0x400..0x401]   (2 byte)
 *
 *   callFunctionStep (step-by-step) instead of callFunction (cycle-burst)
 *   to guarantee precise termination.
 *
 *
 *
 * Usage: npx tsx packages/cli/src/test-helper-1c88-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  helper1C88 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
  type CpuSession,
} from "./binary-oracle-lib.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const FUN_1C88         = 0x00001c88;

const WORK_RAM_BASE    = 0x400000;
const PF_RAM_BASE      = 0xa00000;
const SPRITE_RAM_BASE  = 0xa02000;
const ALPHA_RAM_BASE   = 0xa03000;
const PAL_RAM_BASE     = 0xb00000;

const ALPHA_RAM_SIZE   = 0x1000;   // 4 KB
const PF_RAM_SIZE      = 0x2000;   // 8 KB

/** Offset in workRam for the vblankFlag word (0x400016 - 0x400000 = 0x16). */
const VBLANK_FLAG_OFF  = 0x16;

const MAX_INSTR        = 90_000;

const SENTINEL_RET_ADDR = 0xcafebabe >>> 0;

// ─── Step-based call ─────────────────────────────────────────────────────────

/**
 * instructions (>57K), which exceed the `callFunction` cycle budget.
 */
function callFunctionStep(
  session: CpuSession,
  addr: number,
  maxInstr = MAX_INSTR,
): void {
  const sys = session.system;
  let sp = sys.getRegisters().sp;
  // Push sentinel return address
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET_ADDR);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);

  for (let i = 0; i < maxInstr; i++) {
    if (sys.getRegisters().pc === SENTINEL_RET_ADDR) break;
    sys.step();
  }
  // Pop sentinel
  sys.setRegister("sp", (sys.getRegisters().sp + 4) >>> 0);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

const rng = makeRng(0x1c8800);
const rb  = (): number => Math.floor(rng() * 256) & 0xff;
const rw  = (): number => ((rb() << 8) | rb()) & 0xffff;

interface FailRecord {
  i: number;
  region: string;
  offset: number;
  bin: number;
  ts: number;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // RomImage TS
  const romImg = busNs.emptyRomImage();
  romImg.program.set(romBuf);

  // GameState TS
  const stateInst = stateNs.emptyGameState();

  // CPU musashi
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== helper1C88 (FUN_1C88) — ${n} cases ===`);

  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    let vblankFlag: number;
    if      (i === 0) vblankFlag = 0x0000;
    else if (i === 1) vblankFlag = 0x0001;
    else if (i === 2) vblankFlag = 0x0000;
    else if (i === 3) vblankFlag = 0x0002;
    else              vblankFlag = (rng() < 0.5) ? 0 : rw();


    // 1. alphaRam (4 KB @ 0xA03000)
    const alphaBytes = new Uint8Array(ALPHA_RAM_SIZE);
    if      (i === 0) alphaBytes.fill(0xff);
    else if (i === 1) alphaBytes.fill(0xff);
    else if (i === 2) alphaBytes.fill(0x55);
    else {
      for (let j = 0; j < ALPHA_RAM_SIZE; j++) alphaBytes[j] = rb();
    }
    for (let j = 0; j < ALPHA_RAM_SIZE; j++) {
      pokeMem(cpu, ALPHA_RAM_BASE + j, 1, alphaBytes[j] ?? 0);
      stateInst.alphaRam[j] = alphaBytes[j] ?? 0;
    }

    // 2. playfieldRam (8 KB @ 0xA00000)
    const pfBytes = new Uint8Array(PF_RAM_SIZE);
    if      (i === 0) pfBytes.fill(0xff);
    else if (i === 1) pfBytes.fill(0xff);
    else if (i === 2) pfBytes.fill(0x55);
    else {
      for (let j = 0; j < PF_RAM_SIZE; j++) pfBytes[j] = rb();
    }
    for (let j = 0; j < PF_RAM_SIZE; j++) {
      pokeMem(cpu, PF_RAM_BASE + j, 1, pfBytes[j] ?? 0);
      stateInst.playfieldRam[j] = pfBytes[j] ?? 0;
    }

    // 3. spriteRam[0..1] (word @ 0xA02000)
    const sp0 = rw();
    pokeMem(cpu, SPRITE_RAM_BASE + 0, 2, sp0);
    stateInst.spriteRam[0] = (sp0 >>> 8) & 0xff;
    stateInst.spriteRam[1] = sp0 & 0xff;

    // 4. spriteRam[0x180..0x181] (word @ 0xA02180)
    const sp180 = rw();
    pokeMem(cpu, SPRITE_RAM_BASE + 0x180, 2, sp180);
    stateInst.spriteRam[0x180] = (sp180 >>> 8) & 0xff;
    stateInst.spriteRam[0x181] = sp180 & 0xff;

    // 5. colorRam[0x400..0x401] (word @ 0xB00400)
    const col400 = rw();
    pokeMem(cpu, PAL_RAM_BASE + 0x400, 2, col400);
    stateInst.colorRam[0x400] = (col400 >>> 8) & 0xff;
    stateInst.colorRam[0x401] = col400 & 0xff;

    // 6. workRam[0x16..0x17] = vblankFlag
    pokeMem(cpu, WORK_RAM_BASE + VBLANK_FLAG_OFF, 2, vblankFlag);
    stateInst.workRam[VBLANK_FLAG_OFF]     = (vblankFlag >>> 8) & 0xff;
    stateInst.workRam[VBLANK_FLAG_OFF + 1] = vblankFlag & 0xff;

    callFunctionStep(cpu, FUN_1C88, MAX_INSTR);

    // ── Esegui TS ─────────────────────────────────────────────────────────
    ns.helper1C88(stateInst, romImg, {
      onAvControl: () => {},
    });

    let fail: FailRecord | null = null;

    // a) alphaRam[0..ALPHA_RAM_SIZE-1]
    if (fail === null) {
      for (let j = 0; j < ALPHA_RAM_SIZE; j++) {
        const bin = peekMem(cpu, ALPHA_RAM_BASE + j, 1) & 0xff;
        const ts  = stateInst.alphaRam[j] ?? 0;
        if (bin !== ts) {
          fail = { i, region: "alphaRam", offset: j, bin, ts };
          break;
        }
      }
    }

    // b) playfieldRam[0..PF_RAM_SIZE-1]
    if (fail === null) {
      for (let j = 0; j < PF_RAM_SIZE; j++) {
        const bin = peekMem(cpu, PF_RAM_BASE + j, 1) & 0xff;
        const ts  = stateInst.playfieldRam[j] ?? 0;
        if (bin !== ts) {
          fail = { i, region: "playfieldRam", offset: j, bin, ts };
          break;
        }
      }
    }

    // c) spriteRam[0..1]
    if (fail === null) {
      for (let j = 0; j < 2; j++) {
        const bin = peekMem(cpu, SPRITE_RAM_BASE + j, 1) & 0xff;
        const ts  = stateInst.spriteRam[j] ?? 0;
        if (bin !== ts) {
          fail = { i, region: "spriteRam[0]", offset: j, bin, ts };
          break;
        }
      }
    }

    // d) spriteRam[0x180..0x181]
    if (fail === null) {
      for (let j = 0; j < 2; j++) {
        const bin = peekMem(cpu, SPRITE_RAM_BASE + 0x180 + j, 1) & 0xff;
        const ts  = stateInst.spriteRam[0x180 + j] ?? 0;
        if (bin !== ts) {
          fail = { i, region: "spriteRam[0x180]", offset: 0x180 + j, bin, ts };
          break;
        }
      }
    }

    // e) colorRam[0x400..0x401]
    if (fail === null) {
      for (let j = 0; j < 2; j++) {
        const bin = peekMem(cpu, PAL_RAM_BASE + 0x400 + j, 1) & 0xff;
        const ts  = stateInst.colorRam[0x400 + j] ?? 0;
        if (bin !== ts) {
          fail = { i, region: "colorRam[0x400]", offset: 0x400 + j, bin, ts };
          break;
        }
      }
    }

    if (fail === null) {
      ok++;
    } else if (firstFail === null) {
      firstFail = fail;
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i}:`);
    console.log(
      `    ${f.region}[0x${f.offset.toString(16)}]: bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
