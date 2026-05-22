#!/usr/bin/env node
/**
 * probe-fun29cce-wave-rom.ts - focused ROM proof for L3 green wave tags.
 *
 * This is a diagnostic probe only. It executes the original FUN_29CCE from the
 * Marble Madness program ROM through the local Musashi binary oracle and
 * prints the observable side effects for tag 0x05 and tag 0x06 terrain slots.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs } from "@marble-love/engine";

import {
  createCpu,
  disposeCpu,
  peekMem,
  pokeMem,
} from "./binary-oracle-lib.js";

const FUN_29CCE = 0x00029cce;
const WR = 0x00400000;
const PLAYER = 0x00400018;
const SLOT = 0x00400a9c;
const SENTINEL = 0x00900000;

interface ProbeCase {
  label: string;
  tag: number;
  d6: number;
  a0: number;
  vx?: number;
  vy?: number;
}

function hx(value: number, width = 8): string {
  return `0x${(value >>> 0).toString(16).padStart(width, "0")}`;
}

function w8(cpu: Awaited<ReturnType<typeof createCpu>>, addr: number, value: number): void {
  pokeMem(cpu, addr, 1, value);
}

function w16(cpu: Awaited<ReturnType<typeof createCpu>>, addr: number, value: number): void {
  pokeMem(cpu, addr, 2, value);
}

function w32(cpu: Awaited<ReturnType<typeof createCpu>>, addr: number, value: number): void {
  pokeMem(cpu, addr, 4, value);
}

function r8(cpu: Awaited<ReturnType<typeof createCpu>>, addr: number): number {
  return peekMem(cpu, addr, 1) & 0xff;
}

function r32(cpu: Awaited<ReturnType<typeof createCpu>>, addr: number): number {
  return peekMem(cpu, addr, 4) >>> 0;
}

function callFunctionStep(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  addr: number,
  args: readonly number[],
  maxInstructions = 10_000,
): { reached: boolean; instructions: number; cycles: number } {
  let sp = cpu.system.getRegisters().sp;
  for (let i = args.length - 1; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    cpu.system.write(sp, 4, args[i]! >>> 0);
  }
  sp = (sp - 4) >>> 0;
  cpu.system.write(sp, 4, SENTINEL);

  cpu.system.setRegister("sp", sp);
  cpu.system.setRegister("pc", addr);

  let cycles = 0;
  for (let i = 0; i < maxInstructions; i++) {
    if (cpu.system.getRegisters().pc === SENTINEL) {
      return { reached: true, instructions: i, cycles };
    }
    const result = cpu.system.step();
    cycles += result.cycles;
  }
  return { reached: false, instructions: maxInstructions, cycles };
}

async function runCase(rom: Uint8Array, tc: ProbeCase): Promise<void> {
  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });
  cpu.system.setRegister("sp", 0x00401f00);

  const baseX = 0x0200;
  const baseY = 0x0300;
  const vx = tc.vx ?? 0x00030000;
  const vy = tc.vy ?? 0xfffd0000;

  w16(cpu, WR + 0x690, baseX);
  w16(cpu, WR + 0x692, baseY);
  w32(cpu, WR + 0x684, 0x01020304);
  w32(cpu, WR + 0x688, 0x05060708);

  w32(cpu, PLAYER + 0x00, vx);
  w32(cpu, PLAYER + 0x04, vy);
  w32(cpu, PLAYER + 0x0c, 0x11111111);
  w32(cpu, PLAYER + 0x10, 0x22222222);

  w8(cpu, SLOT + 0x18, 1);
  w8(cpu, SLOT + 0x1f, tc.tag);
  w16(cpu, SLOT + 0x0c, (baseX + tc.d6) & 0xffff);
  w16(cpu, SLOT + 0x10, (baseY + tc.a0) & 0xffff);

  const before = {
    x: r32(cpu, PLAYER + 0x0c),
    y: r32(cpu, PLAYER + 0x10),
    vx: r32(cpu, PLAYER + 0x00),
    vy: r32(cpu, PLAYER + 0x04),
  };

  const result = callFunctionStep(cpu, FUN_29CCE, [PLAYER]);

  const after = {
    x: r32(cpu, PLAYER + 0x0c),
    y: r32(cpu, PLAYER + 0x10),
    vx: r32(cpu, PLAYER + 0x00),
    vy: r32(cpu, PLAYER + 0x04),
    s58: r8(cpu, PLAYER + 0x58),
    s59: r8(cpu, PLAYER + 0x59),
    flagX: r8(cpu, WR + 0x666),
    flagY: r8(cpu, WR + 0x668),
    sounds: cpu.soundCommandLog.slice(),
    cycles: result.cycles,
  };

  console.log(JSON.stringify({
    label: tc.label,
    tag: hx(tc.tag, 2),
    d6: tc.d6,
    a0: tc.a0,
    before: {
      x: hx(before.x),
      y: hx(before.y),
      vx: hx(before.vx),
      vy: hx(before.vy),
    },
    after: {
      x: hx(after.x),
      y: hx(after.y),
      vx: hx(after.vx),
      vy: hx(after.vy),
      s58: hx(after.s58, 2),
      s59: hx(after.s59, 2),
      flagX: after.flagX,
      flagY: after.flagY,
      sounds: after.sounds.map((value) => hx(value, 2)),
      reachedReturn: result.reached,
      instructions: result.instructions,
      cycles: after.cycles,
    },
  }));

  disposeCpu(cpu);
}

async function main(): Promise<void> {
  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }

  const rom = readFileSync(romPath);
  const cases: ProbeCase[] = [
    { label: "tag05_center_original_bumper", tag: 0x05, d6: 0, a0: 0 },
    { label: "tag05_visible_body_offset_original_nohit", tag: 0x05, d6: -11, a0: 4 },
    { label: "tag06_center_original_noop", tag: 0x06, d6: 0, a0: 0 },
    { label: "tag06_visible_body_offset_original_noop", tag: 0x06, d6: -11, a0: 4 },
  ];

  for (const tc of cases) {
    await runCase(rom, tc);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  exit(1);
});
