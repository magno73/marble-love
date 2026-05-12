#!/usr/bin/env node
/**
 * test-sub-1caba-attract-parity.ts — differential FUN_0001CABA vs MAME
 * on ATTRACT inputs (vs boot inputs in test-sub-1caba-parity.ts).
 *
 * Uses /tmp/mame_1caba_attract_count.json captured by
 * oracle/mame_1caba_attract_count.lua with full per-call state for first N
 * entries (D regs, tileX/Y, lvlPtr, bsearchPtr, struct_pre, colBase,
 * bsearchAlt, struct_post).
 *
 * Strategy:
 *   - Snapshot warm state from f12000 of mame_100f.json (workRam, playfield,
 *     sprite). This serves as "rest-of-workRam" baseline.
 *   - For each captured call:
 *     * reset state to f12000 warm
 *     * override workRam[0x478..0x677] from call.colBase
 *     * override workRam[0x76e..0x96d] from call.bsearchAlt
 *     * override 0x474.l = call.lvlPtr
 *     * override 0x65a.l = call.bsearchPtr
 *     * override 0x696.w = call.tileX, 0x698.w = call.tileY
 *     * override 0x1c28..0x1c47 = call.struct_pre
 *   - Run sub1CABATileRedraw(state, rom)
 *   - Compare workRam[0x1c28..0x1c47] vs call.struct_post
 *
 * Usage:
 *   npx tsx packages/cli/src/test-sub-1caba-attract-parity.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, bus as busNs } from "@marble-love/engine";
import { sub1CABATileRedraw } from "../../engine/src/sub-1caba-tile-redraw.js";
import { applySlapsticBank, loadRomBlob } from "../../engine/src/m68k/apply-slapstic-bank.js";

interface CallTrace {
  frame: number;
  d: string[];
  a: string[];
  tileX: string;
  tileY: string;
  lvlPtr: string;
  bsearchPtr: string;
  struct_pre: string;
  struct_post: string;
  colBase: string;
  bsearchAlt: string;
}

interface Trace {
  from_frame: number;
  to_frame: number;
  entry_count: number;
  exit_count: number;
  struct_writes: number;
  entries_full: CallTrace[];
}

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len && i * 2 + 1 < hex.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function loadAttractTrace(): Trace {
  const p = "/tmp/mame_1caba_attract_count.json";
  if (!existsSync(p)) {
    console.error(`error: trace not found at ${p}`);
    console.error(`run: MARBLE_TRACE_FROM=11998 MARBLE_TRACE_TO=12100 \\`);
    console.error(`  mame marble -window -nothrottle -skip_gameinfo -seconds_to_run 220 \\`);
    console.error(`  -rompath roms -autoboot_script oracle/mame_1caba_attract_count.lua -autoboot_delay 0`);
    exit(3);
  }
  return JSON.parse(readFileSync(p, "utf-8")) as Trace;
}

function w32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}
function w16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

async function main(): Promise<void> {
  const trace = loadAttractTrace();
  console.log(`Attract trace: ${trace.entries_full.length} full-state calls (entries=${trace.entry_count} exits=${trace.exit_count} struct_writes=${trace.struct_writes})`);

  // Load ROM using loadRomBlob which properly populates slapsticBanks AND
  // mirrors the active bank into rom.program[0x80000..0x88000].
  const romBlob = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const rom = busNs.emptyRomImage();
  loadRomBlob(rom, romBlob);

  // Force bank for testing: per env var SLAPSTIC_BANK (default = leave fsm default)
  const bankOverride = process.env.SLAPSTIC_BANK !== undefined ? parseInt(process.env.SLAPSTIC_BANK, 10) : null;
  if (bankOverride !== null) {
    applySlapsticBank(rom, bankOverride);
    console.log(`Forced slapstic bank = ${bankOverride}`);
  }

  // Load warm-state f12000 baseline
  const gt = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
    snapshots: { workRam: string; spriteRam: string; playfieldRam: string }[];
  };
  const frame0 = gt.snapshots[0]!;
  const baseWorkRam = hex2bytes(frame0.workRam, 0x2000);
  const basePlayfield = hex2bytes(frame0.playfieldRam, 0x2000);
  const baseSpriteRam = hex2bytes(frame0.spriteRam, 0x1000);

  const stateInst = stateNs.emptyGameState();
  let okCount = 0;
  const fails: { idx: number; ts: string; mame: string }[] = [];

  for (let i = 0; i < trace.entries_full.length; i++) {
    const c = trace.entries_full[i]!;
    stateInst.workRam.set(baseWorkRam);
    stateInst.playfieldRam.set(basePlayfield);
    stateInst.spriteRam.set(baseSpriteRam);

    // Override entry state
    w16(stateInst.workRam, 0x696, parseInt(c.tileX, 16) & 0xffff);
    w16(stateInst.workRam, 0x698, parseInt(c.tileY, 16) & 0xffff);
    w32(stateInst.workRam, 0x474, parseInt(c.lvlPtr, 16) >>> 0);
    w32(stateInst.workRam, 0x65a, parseInt(c.bsearchPtr, 16) >>> 0);

    // struct_pre into 0x1c28..0x1c47 (16 words = 32 bytes, hex = 64 chars)
    stateInst.workRam.set(hex2bytes(c.struct_pre, 32), 0x1c28);

    // colBase (0x200 bytes) and bsearchAlt (0x200 bytes)
    stateInst.workRam.set(hex2bytes(c.colBase, 0x200), 0x478);
    stateInst.workRam.set(hex2bytes(c.bsearchAlt, 0x200), 0x76e);

    sub1CABATileRedraw(stateInst, rom);

    const tsStruct = stateInst.workRam.subarray(0x1c28, 0x1c28 + 32);
    const tsHex = Array.from(tsStruct).map(b => b.toString(16).padStart(2, "0")).join("");

    if (tsHex === c.struct_post) {
      okCount++;
    } else {
      fails.push({ idx: i, ts: tsHex, mame: c.struct_post });
    }
  }

  const total = trace.entries_full.length;
  console.log(`\nMatch: ${okCount}/${total} = ${((okCount / total) * 100).toFixed(1)}%`);

  if (fails.length > 0) {
    console.log(`\nFAILS:`);
    for (const f of fails.slice(0, 5)) {
      const c = trace.entries_full[f.idx]!;
      console.log(`\n  call idx=${f.idx} (frame ${c.frame}):`);
      console.log(`    tileX=${c.tileX} tileY=${c.tileY} lvlPtr=${c.lvlPtr} bsearchPtr=${c.bsearchPtr}`);
      console.log(`    struct_pre  = ${c.struct_pre}`);
      console.log(`    MAME post   = ${f.mame}`);
      console.log(`    TS   post   = ${f.ts}`);
      // word-by-word diff
      for (let j = 0; j < 16; j++) {
        const tsW = f.ts.substr(j * 4, 4);
        const mW = f.mame.substr(j * 4, 4);
        const mark = tsW === mW ? "  " : "<<";
        console.log(`      w[${j.toString().padStart(2)}]: ts=${tsW} mame=${mW} ${mark}`);
      }
    }
  }

  exit(okCount === total ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
