#!/usr/bin/env node
/**
 * test-refresh-helper-13ee6-parity.ts — differential FUN_00013EE6 vs
 * `refreshHelper13EE6`.
 *
 * decodeBitstream1A668 (replicato), FUN_144E4 (stub).
 *
 * Strategia parity:
 *     e FUN_144E4 (intercettati via patch al volo nel test).
 *   - Confrontiamo workRam[0..0x1000) e playfieldRam byte-per-byte.
 *
 * so the Musashi CPU treats them as no-ops. TS uses the default stub
 * from these two functions.
 *
 * to the tail section, which depends only on workRam flags and ROM constants.
 *
 * Uso: npx tsx packages/cli/src/test-refresh-helper-13ee6-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  refreshHelper13EE6 as rh13Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_13EE6  = 0x00013ee6;

// FUN_1344C @ 0x1344c, FUN_144E4 @ 0x144e4
// Patching: write NOP (0x4E71) + RTS (0x4E75) at start of each stub.
// Actually, since JSR pushes return addr, we need just to make the target
// return immediately: patch first 2 bytes with RTS (0x4E75 word).
const FUN_1344C = 0x0001344c;
const FUN_144E4 = 0x000144e4;

const WORK_RAM_BASE  = 0x00400000;
const PF_RAM_BASE    = 0x00a00000;
const WORK_RAM_SIZE  = 0x2000;
const PF_RAM_COMPARE = 0x2000;

// The binary uses the stack in the high area of workRam (0x1E00-0x1FFF).
// We must NOT compare that region since the TS impl has no stack.
// Safe comparison: only the low workRam area up to 0x1C00 (well below min stack usage).
const WORK_RAM_COMPARE_END = 0x1c00;

function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin.",
  );
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function setU16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}
function setU32(buf: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  buf[off] = (u >>> 24) & 0xff;
  buf[off + 1] = (u >>> 16) & 0xff;
  buf[off + 2] = (u >>> 8) & 0xff;
  buf[off + 3] = u & 0xff;
}

function pokeW(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  stateInst: ReturnType<typeof stateNs.emptyGameState>,
  absAddr: number,
  value: number,
): void {
  pokeMem(cpu, absAddr, 1, value & 0xff);
  if (absAddr >= WORK_RAM_BASE && absAddr < WORK_RAM_BASE + WORK_RAM_SIZE) {
    stateInst.workRam[absAddr - WORK_RAM_BASE] = value & 0xff;
  }
}

function pokeW16(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  stateInst: ReturnType<typeof stateNs.emptyGameState>,
  absAddr: number,
  value: number,
): void {
  pokeMem(cpu, absAddr, 2, value & 0xffff);
  if (absAddr >= WORK_RAM_BASE && absAddr < WORK_RAM_BASE + WORK_RAM_SIZE) {
    setU16(stateInst.workRam, absAddr - WORK_RAM_BASE, value & 0xffff);
  }
}

function pokeW32(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  stateInst: ReturnType<typeof stateNs.emptyGameState>,
  absAddr: number,
  value: number,
): void {
  pokeMem(cpu, absAddr, 4, value >>> 0);
  if (absAddr >= WORK_RAM_BASE && absAddr < WORK_RAM_BASE + WORK_RAM_SIZE) {
    setU32(stateInst.workRam, absAddr - WORK_RAM_BASE, value >>> 0);
  }
}

interface FailCase {
  caseNo: number;
  region: "workRam" | "playfieldRam";
  offset: number;
  bin: number;
  ts: number;
  scenario: string;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = findRomBlobPath();
  const romBuf  = Buffer.from(readFileSync(romPath));

  const romView = busNs.emptyRomImage();
  romView.program.set(romBuf.subarray(0, Math.min(romView.program.length, romBuf.length)));

  const stateInst = stateNs.emptyGameState();
  const cpu       = await createCpu({ rom: romBuf, state: stateInst });

  // === Patch FUN_1344C and FUN_144E4 as RTS in ROM ===
  // We write RTS (0x4E75) to the first word of each function so the CPU
  // immediately returns when JSR'd to them.
  //
  // WARNING: We must NOT use pokeMem to patch ROM — the memory layout has ROM
  // as read-only from file. Instead we use pokeMem which bypasses write-protect.
  // Actually pokeMem writes to the system memory regardless of R/W — we verify:
  const RTS_WORD = 0x4e75;
  pokeMem(cpu, FUN_1344C, 2, RTS_WORD);
  pokeMem(cpu, FUN_144E4, 2, RTS_WORD);

  const rng = makeRng(0x13ee6);
  let ok = 0;
  let firstFail: FailCase | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // ── Generate random scenario ──
    // We test 3 main scenarios rotating:
    //   0: scroll-active == 0 → tail only
    //   1: scroll-active == 1, decodeNext == 0 → pf-blit + tail
    //   2: scroll-active == 1, decodeNext != 0 → full path
    const scenario = i % 3;

    // Reset all relevant workRam zones in both
    const RESET_SIZE = 0x0a00;
    for (let k = 0; k < RESET_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, 0);
      stateInst.workRam[k] = 0;
    }
    // Reset playfieldRam in TS
    for (let k = 0; k < stateInst.playfieldRam.length; k++) {
      stateInst.playfieldRam[k] = 0;
    }

    // Set up common fields
    const scrollTarget = Math.floor(rng() * 0x200) | 0;
    const xscroll      = Math.floor(rng() * 0x200);
    const hudOff       = Math.floor(rng() * 0x200);
    const slotMode     = (rng() > 0.5) ? 4 : 0;
    const slotTotal    = Math.floor(rng() * 4); // 0..3 slots
    const evFlags      = Math.floor(rng() * 8); // bits 0..2
    const scrollRun    = (rng() > 0.5) ? 1 : 0;
    const dir          = [0, 1, 0xff][Math.floor(rng() * 3)]!;
    const speed        = Math.floor(rng() * 5);

    // *0x400000 PF X scroll
    pokeW16(cpu, stateInst, WORK_RAM_BASE + 0x0000, xscroll);
    // *0x400004 dir
    pokeW(cpu, stateInst, WORK_RAM_BASE + 0x0004, dir);
    // *0x400006 scroll-active
    pokeW(cpu, stateInst, WORK_RAM_BASE + 0x0006, scenario === 0 ? 0 : 1);
    // *0x400008 scroll-run
    pokeW(cpu, stateInst, WORK_RAM_BASE + 0x0008, scrollRun);
    // *0x40000a speed
    pokeW(cpu, stateInst, WORK_RAM_BASE + 0x000a, speed);
    // *0x40000c accum
    pokeW16(cpu, stateInst, WORK_RAM_BASE + 0x000c, 0);
    // *0x400010 evFlags
    pokeW32(cpu, stateInst, WORK_RAM_BASE + 0x0010, evFlags);
    // *0x400394 slot mode
    pokeW16(cpu, stateInst, WORK_RAM_BASE + 0x0394, slotMode);
    // *0x400396 slot total
    pokeW16(cpu, stateInst, WORK_RAM_BASE + 0x0396, slotTotal);
    // *0x400474 lvlPtr (point to ROM area with safe data)
    // Use a fixed ROM area we know is valid (0x1f1c0 area with scroll constants)
    const lvlPtr = 0x0001f180; // safe ROM address; xbase at +0x10 = 0x1f190
    pokeW32(cpu, stateInst, WORK_RAM_BASE + 0x0474, lvlPtr);
    // *0x400662 slapstic idx
    pokeW16(cpu, stateInst, WORK_RAM_BASE + 0x0662, 0);
    // *0x400664 level counter
    pokeW16(cpu, stateInst, WORK_RAM_BASE + 0x0664, 0);
    // *0x40097c scroll target
    pokeW32(cpu, stateInst, WORK_RAM_BASE + 0x097c, scrollTarget);
    // *0x40097e HUD offset
    pokeW16(cpu, stateInst, WORK_RAM_BASE + 0x097e, hudOff);
    // *0x400974 slot ptr (point into workRam 0x400100)
    const slotPtrAbs = WORK_RAM_BASE + 0x0100;
    pokeW32(cpu, stateInst, WORK_RAM_BASE + 0x0974, slotPtrAbs);
    // *0x400978 decode-next ptr
    if (scenario >= 2) {
      const decNextAbs = WORK_RAM_BASE + 0x0200;
      pokeW32(cpu, stateInst, WORK_RAM_BASE + 0x0978, decNextAbs);
      // Set tileDataPtr at decNextAbs: point to safe ROM data
      pokeW32(cpu, stateInst, decNextAbs, 0x00020000);
      // type at (slotPtrAbs + 0x1f): not 0x19 (use 0x00 = normal)
      pokeW(cpu, stateInst, slotPtrAbs + 0x1f, 0x00);
      // Set (slotPtr+0x26) = 0 (tile buf offset)
      pokeW16(cpu, stateInst, slotPtrAbs + 0x26, 0);
      // Set (slotPtr+0x28) = 0
      pokeW16(cpu, stateInst, slotPtrAbs + 0x28, 0);
    } else {
      pokeW32(cpu, stateInst, WORK_RAM_BASE + 0x0978, 0);
    }

    // Populate a few slot structs (for the slot scan loop)
    for (let s = 0; s < slotTotal && s < 4; s++) {
      const base = 0x0018 + s * 0xe2;
      const d4   = Math.floor(rng() * 0x200);
      const d2   = [0, 1, 3, 4, 5][Math.floor(rng() * 5)]!;
      pokeW16(cpu, stateInst, WORK_RAM_BASE + base + 0x20, d4);
      pokeW(cpu, stateInst, WORK_RAM_BASE + base + 0x18, 1); // flag18 = 1
      pokeW(cpu, stateInst, WORK_RAM_BASE + base + 0x1a, d2);
    }

    // Il binary modifica stateInst.workRam via callback MMIO durante l'esecuzione.
    const initWorkRam = Uint8Array.from(stateInst.workRam);
    const initPfRam   = Uint8Array.from(stateInst.playfieldRam);

    callFunction(cpu, FUN_13EE6, [], 200_000);

    const binWorkRam = new Uint8Array(WORK_RAM_COMPARE_END);
    for (let k = 0; k < WORK_RAM_COMPARE_END; k++) {
      binWorkRam[k] = peekMem(cpu, WORK_RAM_BASE + k, 1) & 0xff;
    }
    const binPfRam = new Uint8Array(PF_RAM_COMPARE);
    for (let k = 0; k < PF_RAM_COMPARE; k++) {
      binPfRam[k] = peekMem(cpu, PF_RAM_BASE + k, 1) & 0xff;
    }

    stateInst.workRam.set(initWorkRam);
    stateInst.playfieldRam.set(initPfRam);

    // ── Run TS ──
    rh13Ns.refreshHelper13EE6(stateInst, romView);

    // ── Compare ──
    // Note: binary uses the stack in high workRam (0x1E00-0x1FFF), which the TS
    // impl does not touch. We compare only workRam[0..WORK_RAM_COMPARE_END).
    let match = true;
    outer: for (const [region, binBuf, tsBuf, size] of [
      ["workRam", binWorkRam, stateInst.workRam, WORK_RAM_COMPARE_END],
      ["playfieldRam", binPfRam, stateInst.playfieldRam, PF_RAM_COMPARE],
    ] as const) {
      for (let k = 0; k < size; k++) {
        const bv = (binBuf as Uint8Array)[k] ?? 0;
        const tv = (tsBuf as Uint8Array)[k] ?? 0;
        if (bv !== tv) {
          if (!firstFail) {
            firstFail = {
              caseNo: i,
              region: region as "workRam" | "playfieldRam",
              offset: k,
              bin: bv,
              ts: tv,
              scenario: ["active=0", "active=1,next=0", "active=1,next!=0"][scenario]!,
            };
          }
          match = false;
          break outer;
        }
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== refreshHelper13EE6 (FUN_00013EE6) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
