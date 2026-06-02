#!/usr/bin/env node
/**
 * test-boot-screen-init-parity.ts — differential FUN_222E vs bootScreenInit.
 *
 *   1. clearScreen (FUN_1C88)
 *   2. 6 register init writes a $B00000-$B0000A
 *   3. introSetup (FUN_22A4)
 *   4. if *0x400016 == 0 (cold boot):
 *        4a. coldBootInit (FUN_3A9C)
 *        4b. dispatch slot1 (ROM[0x10048].w == 0x4EF9 ? hook : FUN_5E00)
 *        4c. dispatch slot2 (ROM[0x1004E].w == 0x4EF9 ? hook : FUN_5DEC)
 *
 * Stub strategy:
 *   - Patch ROM (pre-CPU): each sub-jsr destination becomes
 *       `addq.b #1, (sentinel_slot).l ; rts`  (8 byte: 52 39 00 40 03 EX 4E 75)
 *   - In TS: each callback does `state.workRam[off] = (state.workRam[off]+1) & 0xff`.
 *
 *   - frame counter (0x400016/0x400017): zero (cold) vs random (warm)
 *   - slot1 magic @ ROM[0x10048].w: 0x4EF9 (hook) vs 0x0000 (fallback)
 *   - slot2 magic @ ROM[0x1004E].w: 0x4EF9 (hook) vs 0x0000 (fallback)
 *
 * "vector slot magic on" patches a `JMP.L target_stub.l` in ROM where
 *
 * Usage: npx tsx packages/cli/src/test-boot-screen-init-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bootScreenInit as bsiNs,
  bus as busNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_222E = 0x0000222e;

// Sub-function entry points patched to stubs.
const FUN_1C88 = 0x00001c88;
const FUN_22A4 = 0x000022a4;
const FUN_3A9C = 0x00003a9c;
const FUN_5E00 = 0x00005e00;
const FUN_5DEC = 0x00005dec;

// Vector slot dispatch targets, populated with JMP.L stubs for the "magic on" path.
const SLOT1_HOOK_STUB = 0x0001a798;
const SLOT2_HOOK_STUB = 0x0001a7a0; // free, reserved by the test

// ROM offsets of the two vector slots (magic + jump target).
const VECTOR_SLOT_1 = 0x00010048;
const VECTOR_SLOT_2 = 0x0001004e;

// Sentinel slot in work RAM (one per stub).
const SENTINEL_BASE = 0x004003e0;
const SENT_CLEAR_SCREEN = SENTINEL_BASE + 0; // FUN_1C88
const SENT_INTRO_SETUP = SENTINEL_BASE + 1; // FUN_22A4
const SENT_COLD_INIT = SENTINEL_BASE + 2; // FUN_3A9C
const SENT_SLOT1_FB = SENTINEL_BASE + 3; // FUN_5E00 fallback
const SENT_SLOT2_FB = SENTINEL_BASE + 4; // FUN_5DEC fallback
const SENT_SLOT1_HOOK = SENTINEL_BASE + 5; // 0x1A798 jmp target
const SENT_SLOT2_HOOK = SENTINEL_BASE + 6; // 0x1A7A0 jmp target

const PALETTE_RAM_BASE = busNs.PAL_RAM_BASE;

/**
 * Encode `addq.b #1, (sentinelAddr).l ; rts` (8 byte) in `rom` at `entry`.
 */
function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  // addq.b #1, abs.l → 0x52 0x39
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
  // rts
  rom[entry + 6] = 0x4e;
  rom[entry + 7] = 0x75;
}

/** Encode `JMP.L target.l` (6 byte) in `rom` at `addr`. */
function patchJmpL(rom: Buffer, addr: number, target: number): void {
  rom[addr + 0] = 0x4e;
  rom[addr + 1] = 0xf9;
  rom[addr + 2] = (target >>> 24) & 0xff;
  rom[addr + 3] = (target >>> 16) & 0xff;
  rom[addr + 4] = (target >>> 8) & 0xff;
  rom[addr + 5] = target & 0xff;
}

/**
 *  patched in the ROM buffer with the target stub (see `prepatchRom`). */
function setSlotMagic(cpu: ReturnType<typeof createCpu> extends Promise<infer T> ? T : never, slotAddr: number, magic: number): void {
  pokeMem(cpu, slotAddr, 2, magic & 0xffff);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  i: number;
  pattern: number;
  fc: number;
  s1: number;
  s2: number;
  field: string;
  bin: number;
  ts: number;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Stub addq+rts at each of the 7 entry points.
  patchStubAddq(romBuf, FUN_1C88, SENT_CLEAR_SCREEN);
  patchStubAddq(romBuf, FUN_22A4, SENT_INTRO_SETUP);
  patchStubAddq(romBuf, FUN_3A9C, SENT_COLD_INIT);
  patchStubAddq(romBuf, FUN_5E00, SENT_SLOT1_FB);
  patchStubAddq(romBuf, FUN_5DEC, SENT_SLOT2_FB);
  patchStubAddq(romBuf, SLOT1_HOOK_STUB, SENT_SLOT1_HOOK);
  patchStubAddq(romBuf, SLOT2_HOOK_STUB, SENT_SLOT2_HOOK);

  // Original ROM @ 0x1004E: `00 00 00 00 00 00`. For the "magic on" path the
  // magic is set later via pokeMem per case (ROM byte 0..1) — the 4 byte target stays fixed.
  patchJmpL(romBuf, VECTOR_SLOT_2, SLOT2_HOOK_STUB);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== bootScreenInit (FUN_222E) — ${n} cases ===`);
  const rng = makeRng(0x222e);

  // TS subs that increment sentinel slots in workRam.
  const incSent = (s: typeof stateInst, off: number): void => {
    const a = off - 0x400000;
    s.workRam[a] = ((s.workRam[a] ?? 0) + 1) & 0xff;
  };
  const subs: bsiNs.BootScreenInitSubs = {
    clearScreen: (s) => incSent(s, SENT_CLEAR_SCREEN),
    introSetup: (s) => incSent(s, SENT_INTRO_SETUP),
    coldBootInit: (s) => incSent(s, SENT_COLD_INIT),
    dispatchSlot1Hook: (s) => incSent(s, SENT_SLOT1_HOOK),
    slot1Fallback: (s) => incSent(s, SENT_SLOT1_FB),
    dispatchSlot2Hook: (s) => incSent(s, SENT_SLOT2_HOOK),
    slot2Fallback: (s) => incSent(s, SENT_SLOT2_FB),
  };

  let ok = 0;
  let firstFail: FailRecord | null = null;

  // Pattern to cover the branches:
  //   0..7 = enumeration (fc∈{0,nz}, s1∈{magic,fb}, s2∈{magic,fb})
  //   >=8  = mixed random
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    let pattern: number;
    if (i < 8) {
      pattern = i;
    } else {
      pattern = Math.floor(rng() * 8);
    }
    const fcZero = (pattern & 0x4) === 0;
    const s1Magic = (pattern & 0x2) === 0;
    const s2Magic = (pattern & 0x1) === 0;

    // Frame counter: word at 0x400016. Cold boot if both bytes == 0.
    const fcWord = fcZero ? 0 : 1 + Math.floor(rng() * 0xffff);
    pokeMem(cpu, 0x00400016, 2, fcWord);
    stateInst.workRam[0x16] = (fcWord >>> 8) & 0xff;
    stateInst.workRam[0x17] = fcWord & 0xff;

    // Magic word at the two vector slots.
    const s1MagicVal = s1Magic ? 0x4ef9 : Math.floor(rng() * 0x4ef0); // guaranteed != 0x4EF9
    const s2MagicVal = s2Magic ? 0x4ef9 : Math.floor(rng() * 0x4ef0);
    setSlotMagic(cpu, VECTOR_SLOT_1, s1MagicVal);
    setSlotMagic(cpu, VECTOR_SLOT_2, s2MagicVal);

    // Sync ROM image seen by TS: bus.ts has a static emptyRomImage, so we must
    const romView = busNs.emptyRomImage();
    romView.program.set(romBuf);
    // Apply the current magic values
    romView.program[VECTOR_SLOT_1] = (s1MagicVal >>> 8) & 0xff;
    romView.program[VECTOR_SLOT_1 + 1] = s1MagicVal & 0xff;
    romView.program[VECTOR_SLOT_2] = (s2MagicVal >>> 8) & 0xff;
    romView.program[VECTOR_SLOT_2 + 1] = s2MagicVal & 0xff;

    // Reset palette RAM target (12 bytes) + sentinel slot, both in CPU mem and state.
    for (let off = 0; off < 12; off++) {
      pokeMem(cpu, PALETTE_RAM_BASE + off, 1, 0);
      stateInst.colorRam[off] = 0;
    }
    for (let k = 0; k < 7; k++) {
      pokeMem(cpu, SENTINEL_BASE + k, 1, 0);
      stateInst.workRam[(SENTINEL_BASE - 0x400000) + k] = 0;
    }

    callFunction(cpu, FUN_222E, []);
    // Run TS
    bsiNs.bootScreenInit(stateInst, romView, subs);

    let fail: FailRecord | null = null;
    for (let off = 0; off < 12; off++) {
      const b = peekMem(cpu, PALETTE_RAM_BASE + off, 1) & 0xff;
      const t = stateInst.colorRam[off] ?? 0;
      if (b !== t) {
        fail = {
          i, pattern, fc: fcWord, s1: s1MagicVal, s2: s2MagicVal,
          field: `palette+${off.toString(16)}`, bin: b, ts: t,
        };
        break;
      }
    }
    if (fail === null) {
      const sentNames = [
        "clearScreen", "introSetup", "coldBootInit",
        "slot1Fallback", "slot2Fallback",
        "slot1Hook", "slot2Hook",
      ];
      for (let k = 0; k < 7; k++) {
        const b = peekMem(cpu, SENTINEL_BASE + k, 1) & 0xff;
        const t = stateInst.workRam[(SENTINEL_BASE - 0x400000) + k] ?? 0;
        if (b !== t) {
          fail = {
            i, pattern, fc: fcWord, s1: s1MagicVal, s2: s2MagicVal,
            field: sentNames[k] ?? `sentinel${k}`, bin: b, ts: t,
          };
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
    console.log(
      `  First fail @ case ${f.i} (pattern=${f.pattern} fc=0x${f.fc.toString(16)} ` +
      `s1=0x${f.s1.toString(16)} s2=0x${f.s2.toString(16)})`,
    );
    console.log(
      `    ${f.field}: bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
