#!/usr/bin/env node
/**
 * test-boot-helper-1464a-parity.ts — differential FUN_1464A vs bootHelper1464A.
 *
 *
 * **Strategia stub**:
 *     `addq.b #1,(sentinel_slot).l ; rts`  (8 byte: 52 39 00 40 03 EX 4E 75)
 *   In TS: le stesse subs incrementano il corrispondente sentinel byte.
 *
 * **Subs patchate**:
 *   - FUN_10392 (0x10392): slotArrayBulkInit → sentinel 0x4003C0
 *   - FUN_26B2A (0x26b2a): gameStateBanner → sentinel 0x4003C1
 *   - FUN_28580 (0x28580): initFnPointers → sentinel 0x4003C2
 *   - FUN_28DEA (0x28dea): vblankAck → sentinel 0x4003C3
 *   - FUN_121A6 (0x121a6): clearPaletteRam → sentinel 0x4003C4
 *   - FUN_100E0 (0x100e0): softReset → sentinel 0x4003C5
 *   - FUN_100   (0x100):   textRender → sentinel 0x4003C6
 *   - FUN_118   (0x118):   textPrint → sentinel 0x4003C7
 *   - FUN_28DB8 (0x28db8): wait → sentinel 0x4003C8
 *   - FUN_1A8   (0x1a8):   readSwitches → sentinel 0x4003C9, returns D0=0
 *   - FUN_1C0   (0x1c0):   coinRead → sentinel 0x4003CA
 *   - FUN_1B4   (0x1b4):   coinWrite → sentinel 0x4003CB
 *   - FUN_1AE   (0x1ae):   gameDispatch → sentinel 0x4003CC, returns D0=0
 *   - FUN_11AD8 (0x11ad8): dispatchTable → sentinel 0x4003CD
 *   - FUN_158AC (0x158ac): soundCmd → sentinel 0x4003CE
 *   - FUN_14E   (0x14e):   (called by initFnPointers, but patched above)
 *
 *   - 0x400000..0x40001F: random
 *   - 0x40000E = 0 (normal mode, bit7=0)
 *   - 0x4003AC = 1 (so vblank loop exits immediately: D0 & 3 = 1 != 0)
 *   - 0x4003B8 = 0 (skip countdown block)
 *   - 0x40039E = random (< 0xFFFF, so the cmp.w #-1 path varies)
 *   - 0x4003F0 = random initial value
 *
 *
 * Uso: npx tsx packages/cli/src/test-boot-helper-1464a-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bootHelper1464A as bh1464aNs,
  bus as busNs,
  type GameState,
} from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

/**
 * Call a function in musashi using a clean sentinel mechanism.
 *
 * Unlike the standard `callFunction`, this version writes a `bra.b *` (branch
 * to self = busy loop, `0x60FE`) at a mapped workRam address and uses THAT
 * as the return address. When the function does `rts`, musashi executes the
 * `bra.b *` and loops in place. The poll loop detects when PC == LOOP_ADDR
 * and exits cleanly.
 *
 * This avoids the callFunction artifact where musashi keeps executing garbage
 * after returning to the unmapped 0xCAFEBABE sentinel address, which can
 * trigger spurious stub calls.
 */
function callFunctionClean(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  addr: number,
  maxCycles = 200_000,
): void {
  // Use a workRam address in the "skipped" comparison zone (>= 0x1DC0).
  // This ensures the 0x60FE bytes we write here don't affect comparison.
  // FUN_1464A uses SP=0x401F00 with ~40 bytes frame → frame at ~0x401EDC..0x401F00.
  // We use 0x401DC0 which is in the skipped zone but above typical frame.
  const LOOP_ADDR = 0x00401dc0;
  // bra.b * = 0x60FE (branch to self, 2-byte instruction)
  pokeMem(cpu, LOOP_ADDR, 2, 0x60fe);

  const sys = cpu.system;
  let sp = 0x401f00;
  // Push our custom return address (= the busy loop address)
  sp -= 4;
  sys.write(sp, 4, LOOP_ADDR);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);

  // Run until PC reaches LOOP_ADDR (function returned) or maxCycles
  let totalCycles = 0;
  const burst = 200;
  while (totalCycles < maxCycles) {
    sys.run(burst);
    totalCycles += burst;
    if (sys.getRegisters().pc === LOOP_ADDR) break;
  }

  // Restore SP past the return address we pushed
  sys.setRegister("sp", (sys.getRegisters().sp + 4) >>> 0);
}

const FUN_1464A = 0x0001464a;

// Sub entry points to patch
const FUN_1010A = 0x0001010a;
const FUN_10392 = 0x00010392;
const FUN_26B2A = 0x00026b2a;
const FUN_28580 = 0x00028580;
const FUN_28DEA = 0x00028dea;
const FUN_121A6 = 0x000121a6;
const FUN_100E0 = 0x000100e0;
const FUN_100   = 0x00000100;
const FUN_118   = 0x00000118;
const FUN_28DB8 = 0x00028db8;
const FUN_1A8   = 0x000001a8;
const FUN_1C0   = 0x000001c0;
const FUN_1B4   = 0x000001b4;
const FUN_1AE   = 0x000001ae;
const FUN_11AD8 = 0x00011ad8;
const FUN_158AC = 0x000158ac;
// Called by FUN_28580 (patched) — but we also patch it directly in case
// something else calls it during our function
const FUN_14E   = 0x0000014e;

// Sentinel slots (workRam addresses)
const SENTINEL_BASE = 0x004003c0;
const SENT_SLOT_ARRAY  = SENTINEL_BASE + 0x0; // FUN_10392
const SENT_BANNER      = SENTINEL_BASE + 0x1; // FUN_26B2A
const SENT_INIT_FN     = SENTINEL_BASE + 0x2; // FUN_28580
const SENT_VBLANK      = SENTINEL_BASE + 0x3; // FUN_28DEA
const SENT_CLEAR_PAL   = SENTINEL_BASE + 0x4; // FUN_121A6
const SENT_SOFT_RST    = SENTINEL_BASE + 0x5; // FUN_100E0
const SENT_TEXT_RENDER = SENTINEL_BASE + 0x6; // FUN_100
const SENT_TEXT_PRINT  = SENTINEL_BASE + 0x7; // FUN_118
const SENT_WAIT        = SENTINEL_BASE + 0x8; // FUN_28DB8
const SENT_SWITCHES    = SENTINEL_BASE + 0x9; // FUN_1A8
const SENT_COIN_RD     = SENTINEL_BASE + 0xa; // FUN_1C0
const SENT_COIN_WR     = SENTINEL_BASE + 0xb; // FUN_1B4
const SENT_DISPATCH    = SENTINEL_BASE + 0xc; // FUN_1AE
const SENT_DISP_TBL    = SENTINEL_BASE + 0xd; // FUN_11AD8
const SENT_SOUND       = SENTINEL_BASE + 0xe; // FUN_158AC
const SENTINEL_COUNT   = 0xf;

const WRAM_BASE = busNs.WORK_RAM_BASE;
const WRAM_SIZE = busNs.WORK_RAM_END - busNs.WORK_RAM_BASE;

/**
 * Stub area in ROM at a safe offset (near end of ROM space, well above all code).
 * Each stub gets 12 bytes of space.
 *
 * Using stubs instead of inline patches for ALL entries, to avoid
 * overflowing 6-byte jump-table entries (0x1a8..0x1c6 area).
 */
const STUB_AREA_BASE = 0x7ff00;
let stubAreaCursor = STUB_AREA_BASE;

function allocStub(size: number): number {
  const addr = stubAreaCursor;
  stubAreaCursor += size;
  return addr;
}

/**
 * Patch `entry` with `jmp.l stubAddr` (6 bytes, fits jump-table entries exactly).
 */
function patchJmpL(rom: Buffer, entry: number, target: number): void {
  rom[entry + 0] = 0x4e;
  rom[entry + 1] = 0xf9;
  rom[entry + 2] = (target >>> 24) & 0xff;
  rom[entry + 3] = (target >>> 16) & 0xff;
  rom[entry + 4] = (target >>> 8) & 0xff;
  rom[entry + 5] = target & 0xff;
}

/**
 * Patch entry with just `rts` (2 bytes) — no sentinel, no jmp.
 * Only use for entries that have >= 2 bytes and are not adjacent to others.
 */
function patchRts(rom: Buffer, entry: number): void {
  rom[entry + 0] = 0x4e;
  rom[entry + 1] = 0x75;
}

/**
 * Patch entry point via jmp.l redirect to a stub that does:
 *   `addq.b #1, (sentinelAddr).l ; rts`
 *
 * Uses a 12-byte stub in STUB_AREA_BASE. The entry is patched with a 6-byte
 * `jmp.l stubAddr` to avoid overflowing into adjacent entries (important for
 * the 6-byte jump table entries at 0x1a8..0x1c6).
 */
function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  const stubAddr = allocStub(12);
  // Patch entry: jmp.l stubAddr (6 bytes)
  patchJmpL(rom, entry, stubAddr);
  // Stub: addq.b #1, abs.l + rts
  rom[stubAddr + 0] = 0x52;
  rom[stubAddr + 1] = 0x39;
  rom[stubAddr + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[stubAddr + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[stubAddr + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[stubAddr + 5] = sentinelAddr & 0xff;
  rom[stubAddr + 6] = 0x4e;  // rts
  rom[stubAddr + 7] = 0x75;
}

/**
 * Patch entry with `addq.b #1,(sentinel).l ; clr.l D0 ; rts` via jmp.l redirect.
 * Returns D0=0 to callers.
 */
function patchClearD0Rts(rom: Buffer, entry: number, sentinel: number): void {
  const stubAddr = allocStub(12);
  // Patch entry: jmp.l stubAddr (6 bytes, safe for 6-byte jump table slots)
  patchJmpL(rom, entry, stubAddr);
  // Stub at stubAddr: addq.b + clr.l D0 + rts (10 bytes)
  rom[stubAddr + 0] = 0x52;  // addq.b #1, abs.l
  rom[stubAddr + 1] = 0x39;
  rom[stubAddr + 2] = (sentinel >>> 24) & 0xff;
  rom[stubAddr + 3] = (sentinel >>> 16) & 0xff;
  rom[stubAddr + 4] = (sentinel >>> 8) & 0xff;
  rom[stubAddr + 5] = sentinel & 0xff;
  rom[stubAddr + 6] = 0x42;  // clr.l D0
  rom[stubAddr + 7] = 0x80;
  rom[stubAddr + 8] = 0x4e;  // rts
  rom[stubAddr + 9] = 0x75;
}

/**
 * Patch vblankAck via jmp.l redirect to a stub that:
 *   - increments sentinelAddr
 *   - sets 0x4003AC |= 1 (to break the boot vblank loop at 0x147C6)
 *   - rts
 *
 * The boot loop checks `(0x4003AC) & 3 != 0` to exit. Without this,
 * the loop spins forever in musashi (real ISR sets it, but musashi doesn't).
 */
function patchVblankAck(rom: Buffer, entry: number, sentinelAddr: number): void {
  const stubAddr = allocStub(20);
  const AC_ADDR = 0x004003ac;
  // Patch entry: jmp.l stubAddr
  patchJmpL(rom, entry, stubAddr);
  // Stub: addq.b #1,(sentinel) + ori.b #1,(0x4003AC) + rts
  rom[stubAddr + 0] = 0x52;  // addq.b #1, abs.l
  rom[stubAddr + 1] = 0x39;
  rom[stubAddr + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[stubAddr + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[stubAddr + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[stubAddr + 5] = sentinelAddr & 0xff;
  // ori.b #1, abs.l → 0x0039 imm16(=0x0001) abs.l(4 bytes) = 8 bytes
  rom[stubAddr + 6] = 0x00;
  rom[stubAddr + 7] = 0x39;
  rom[stubAddr + 8] = 0x00;
  rom[stubAddr + 9] = 0x01;
  rom[stubAddr + 10] = (AC_ADDR >>> 24) & 0xff;
  rom[stubAddr + 11] = (AC_ADDR >>> 16) & 0xff;
  rom[stubAddr + 12] = (AC_ADDR >>> 8) & 0xff;
  rom[stubAddr + 13] = AC_ADDR & 0xff;
  // rts
  rom[stubAddr + 14] = 0x4e;
  rom[stubAddr + 15] = 0x75;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

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
    "ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.",
  );
}

interface FailRecord {
  caseNo: number;
  offset: number;
  bin: number;
  ts: number;
  desc: string;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romPath = findRomBlobPath();
  const romBuf = Buffer.from(readFileSync(romPath));

  // Pre-patch all subs
  patchRts(romBuf, FUN_1010A);
  patchStubAddq(romBuf, FUN_10392, SENT_SLOT_ARRAY);
  patchStubAddq(romBuf, FUN_26B2A, SENT_BANNER);
  patchStubAddq(romBuf, FUN_28580, SENT_INIT_FN);
  // FUN_28DEA: vblankAck — patch to also set 0x4003AC bit 0 so the boot loop exits
  patchVblankAck(romBuf, FUN_28DEA, SENT_VBLANK);
  patchStubAddq(romBuf, FUN_121A6, SENT_CLEAR_PAL);
  patchStubAddq(romBuf, FUN_100E0, SENT_SOFT_RST);
  patchStubAddq(romBuf, FUN_100,   SENT_TEXT_RENDER);
  patchStubAddq(romBuf, FUN_118,   SENT_TEXT_PRINT);
  patchStubAddq(romBuf, FUN_28DB8, SENT_WAIT);
  // FUN_1A8: needs to return D0=0 (for safe branch on switch value)
  patchClearD0Rts(romBuf, FUN_1A8, SENT_SWITCHES);
  patchStubAddq(romBuf, FUN_1C0, SENT_COIN_RD);
  patchStubAddq(romBuf, FUN_1B4, SENT_COIN_WR);
  // FUN_1AE: needs to return D0=0 (null ptr → dispatchTable path 0)
  patchClearD0Rts(romBuf, FUN_1AE, SENT_DISPATCH);
  patchStubAddq(romBuf, FUN_11AD8, SENT_DISP_TBL);
  patchStubAddq(romBuf, FUN_158AC, SENT_SOUND);
  // Also patch 0x14E (called by initFnPointers which is already patched; belt+suspenders)
  patchRts(romBuf, FUN_14E);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });
  const rng = makeRng(0x1464a);

  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  let ok = 0;
  let firstFail: FailRecord | null = null;

  // Build TS subs that mirror the stub behavior (increment sentinels)
  function incSent(s: GameState, sentAddr: number): void {
    const o = sentAddr - WRAM_BASE;
    s.workRam[o] = ((s.workRam[o] ?? 0) + 1) & 0xff;
  }

  const subs: bh1464aNs.BootHelper1464ASubs = {
    enableIrq1010A: (_s: GameState) => {/* no RAM effect */},
    slotArrayBulkInit10392: (s: GameState) => incSent(s, SENT_SLOT_ARRAY),
    gameStateBanner26B2A: (s: GameState) => incSent(s, SENT_BANNER),
    initFnPointers28580: (s: GameState) => incSent(s, SENT_INIT_FN),
    vblankAck28DEA: (s: GameState) => {
      incSent(s, SENT_VBLANK);
      // Mirror ROM stub: also set 0x4003AC bit 0 to break the boot loop
      const o = 0x4003ac - WRAM_BASE;
      s.workRam[o] = ((s.workRam[o] ?? 0) | 1) & 0xff;
    },
    clearPaletteRam121A6: (s: GameState) => incSent(s, SENT_CLEAR_PAL),
    softReset100E0: (s: GameState) => incSent(s, SENT_SOFT_RST),
    textRender100: (s: GameState) => incSent(s, SENT_TEXT_RENDER),
    textPrint0118: (s: GameState) => incSent(s, SENT_TEXT_PRINT),
    wait28DB8: (s: GameState) => incSent(s, SENT_WAIT),
    readSwitches1A8: (s: GameState) => { incSent(s, SENT_SWITCHES); return 0; },
    coinRead1C0: (s: GameState) => incSent(s, SENT_COIN_RD),
    coinWrite1B4: (s: GameState) => incSent(s, SENT_COIN_WR),
    // Returns non-zero to simulate "object already initialized" (*(ptr) != 0 in binary)
    gameDispatch1AE: (s: GameState) => { incSent(s, SENT_DISPATCH); return 1; },
    dispatchTable11AD8: (s: GameState) => incSent(s, SENT_DISP_TBL),
    soundCmd158AC: (s: GameState) => incSent(s, SENT_SOUND),
  };

  console.log(`\n=== bootHelper1464A (FUN_1464A) — ${n} cases ===`);

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // --- Set up pre-state ---
    // Randomize some workRam to make tests interesting
    const f0init = Math.floor(rng() * 0x100);
    const ac3b8init = 0; // 0x4003B8 = 0 → skip countdown block
    const ac3acInit = 1; // 0x4003AC & 3 = 1 != 0 → vblank loop exits immediately
    const ac3eeInit = Math.floor(rng() * 0x100);

    // Poke both musashi and TS state
    pokeMem(cpu, 0x004003f0, 1, f0init);
    stateInst.workRam[0x3f0] = f0init;

    pokeMem(cpu, 0x004003b8, 2, ac3b8init);
    stateInst.workRam[0x3b8] = 0;
    stateInst.workRam[0x3b9] = 0;

    pokeMem(cpu, 0x004003ac, 1, ac3acInit);
    stateInst.workRam[0x3ac] = ac3acInit;

    pokeMem(cpu, 0x004003ee, 1, ac3eeInit);
    stateInst.workRam[0x3ee] = ac3eeInit;

    // 0x40000E = 0 → normal mode (not service)
    pokeMem(cpu, 0x0040000e, 1, 0);
    stateInst.workRam[0xe] = 0;

    // Reset sentinel bytes
    for (let k = 0; k < SENTINEL_COUNT; k++) {
      pokeMem(cpu, SENTINEL_BASE + k, 1, 0);
      stateInst.workRam[SENTINEL_BASE - WRAM_BASE + k] = 0;
    }

    // --- Execute binary (musashi) ---
    // Use callFunctionClean to avoid garbage execution after function returns.
    // Standard callFunction() uses unmapped 0xCAFEBABE as sentinel, causing
    // musashi to execute garbage instructions post-return and spuriously
    // incrementing stub sentinels. callFunctionClean() writes STOP #0x2700
    // at a mapped workRam address for clean halting.
    callFunctionClean(cpu, FUN_1464A, 200_000);

    // --- Execute TS ---
    bh1464aNs.bootHelper1464A(stateInst, subs);

    // --- Compare workRam ---
    // We compare the entire workRam region except areas that:
    //   - change non-deterministically (none in this setup)
    // But we skip the slapstic/EEPROM area and compare only 0x400000..0x401FFF.

    let match = true;
    let fail: FailRecord | null = null;

    for (let o = 0; o < WRAM_SIZE; o++) {
      // Skip the stack area. callFunctionClean uses SP=0x401F00. FUN_1464A's
      // link + movem prologue uses ~36 bytes of stack → frame at ~0x401EDC..0x401F04.
      // We conservatively skip everything from 0x1DC0 onwards to exclude stack and
      // the STOP instruction bytes written at STOP_ADDR (0x401E00).
      if (o >= 0x1dc0) continue;

      const binVal = peekMem(cpu, WRAM_BASE + o, 1) & 0xff;
      const tsVal  = stateInst.workRam[o] ?? 0;

      if (binVal !== tsVal) {
        fail = {
          caseNo: i,
          offset: o,
          bin: binVal,
          ts: tsVal,
          desc: `workRam[0x${o.toString(16)}] (abs 0x${(WRAM_BASE + o).toString(16)})`,
        };
        match = false;
        break;
      }
    }

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = fail;
    }

    // Sync TS workRam from musashi for next iteration's pre-state
    const ram = cpu.system.readBytes(WRAM_BASE, WRAM_SIZE);
    stateInst.workRam.set(ram);
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail: case ${f.caseNo}, ${f.desc}`);
    console.log(`    bin=0x${f.bin.toString(16).padStart(2, "0")} ts=0x${f.ts.toString(16).padStart(2, "0")}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
