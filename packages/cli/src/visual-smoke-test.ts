#!/usr/bin/env node
/**
 * meaningful on screen.
 *
 * Pipeline:
 *   2. emptyGameState + bootInit
 *   3. tick(state, {rom}) for N frames
 *   4. buildFrame(state) → Frame
 *
 *
 * Usage: npx tsx packages/cli/src/visual-smoke-test.ts [N=300]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  bootInit,
  tick,
  render as renderNs,
} from "@marble-love/engine";

async function main(): Promise<void> {
  const ticks = Number(process.argv[2] ?? "300");
  const levelArg = process.argv[3];
  const levelIndex = levelArg !== undefined ? Number(levelArg) : undefined;
  const romPath = resolve("ghidra_project/marble_program.bin");
  const romBuf = readFileSync(romPath);
  const rom = busNs.emptyRomImage();
  rom.program.set(romBuf.subarray(0, rom.program.length));

  const state = stateNs.emptyGameState();

  console.log(`\n=== bootInit ${levelIndex !== undefined ? `(preloadLevel=${levelIndex})` : ""} ===`);
  bootInit(state, rom, levelIndex !== undefined ? { preloadLevel: levelIndex } : {});
  if (levelIndex !== undefined) {
    const pfNonZero = state.playfieldRam.filter((b) => b !== 0).length;
    console.log(`  playfieldRam non-zero: ${pfNonZero}/${state.playfieldRam.length}`);
  }
  let f = renderNs.buildFrame(state);
  console.log(`  scroll: (${f.scrollX}, ${f.scrollY})`);
  console.log(`  palette: ${f.palette.length} entries`);
  console.log(`  playfield: ${f.playfield.length} tiles`);
  console.log(`  sprites: ${f.sprites.length}`);
  console.log(`  alpha (HUD): ${f.alpha.length} chars`);

  // Sample non-zero palette entries (rgba is {r,g,b,a} object)
  const nonZeroPalette = f.palette.filter(
    (p) => p.rgba.r !== 0 || p.rgba.g !== 0 || p.rgba.b !== 0,
  );
  console.log(`  palette non-zero: ${nonZeroPalette.length}/${f.palette.length}`);
  if (nonZeroPalette.length > 0) {
    const sample = nonZeroPalette.slice(0, 5);
    for (const p of sample) {
      console.log(
        `    [${p.index}] rgb(${p.rgba.r},${p.rgba.g},${p.rgba.b})`,
      );
    }
  }

  console.log(`\n=== tick × ${ticks} ===`);
  let tickCount = 0;
  let lastReport = -1;
  for (let i = 0; i < ticks; i++) {
    tick(state, { rom });
    tickCount++;
    // Report at key milestones
    if (i === 0 || i === 9 || i === 59 || i === 119 || i === 299) {
      f = renderNs.buildFrame(state);
      const nzP = f.palette.filter(
        (p) => p.rgba.r !== 0 || p.rgba.g !== 0 || p.rgba.b !== 0,
      );
      console.log(
        `  tick ${i + 1}: pal=${nzP.length}/${f.palette.length}, ` +
        `pf=${f.playfield.length}, sprites=${f.sprites.length}, ` +
        `hud=${f.alpha.length}, scroll=(${f.scrollX},${f.scrollY})`,
      );
      lastReport = i;
    }
  }
  void tickCount;
  void lastReport;

  // Final dump
  f = renderNs.buildFrame(state);
  console.log(`\n=== Final state (after ${ticks} ticks) ===`);
  console.log(`  workRam[0x14] (frame counter low):  ${state.workRam[0x14]?.toString(16)}`);
  console.log(`  workRam[0x16] (frame counter high): ${state.workRam[0x16]?.toString(16)}`);
  console.log(`  workRam[0x3AE] (AV control word):   ${(((state.workRam[0x3ae] ?? 0) << 8) | (state.workRam[0x3af] ?? 0)).toString(16)}`);
  console.log(`  workRam[0x3B6] (counter):           ${(((state.workRam[0x3b6] ?? 0) << 8) | (state.workRam[0x3b7] ?? 0)).toString(16)}`);
  console.log(`  workRam[0x3B8] (countdown):         ${(((state.workRam[0x3b8] ?? 0) << 8) | (state.workRam[0x3b9] ?? 0)).toString(16)}`);

  // Alpha RAM non-zero count
  let alphaSet = 0;
  for (let i = 0; i < state.alphaRam.length; i++) {
    if (state.alphaRam[i] !== 0) alphaSet++;
  }
  console.log(`  alphaRam non-zero bytes: ${alphaSet}/${state.alphaRam.length}`);

  // Color RAM non-zero count
  let colorSet = 0;
  for (let i = 0; i < state.colorRam.length; i++) {
    if (state.colorRam[i] !== 0) colorSet++;
  }
  console.log(`  colorRam non-zero bytes: ${colorSet}/${state.colorRam.length}`);

  // Sprite RAM non-zero count
  let spriteSet = 0;
  for (let i = 0; i < state.spriteRam.length; i++) {
    if (state.spriteRam[i] !== 0) spriteSet++;
  }
  console.log(`  spriteRam non-zero bytes: ${spriteSet}/${state.spriteRam.length}`);

  // Playfield RAM non-zero count (key check for tilemap chain)
  let pfSet = 0;
  for (let i = 0; i < state.playfieldRam.length; i++) {
    if (state.playfieldRam[i] !== 0) pfSet++;
  }
  console.log(`  playfieldRam non-zero bytes: ${pfSet}/${state.playfieldRam.length}`);
  if (pfSet > 0) {
    // First/last non-zero offsets to confirm chain ran
    let first = -1;
    let last = -1;
    for (let i = 0; i < state.playfieldRam.length; i++) {
      if (state.playfieldRam[i] !== 0) {
        if (first === -1) first = i;
        last = i;
      }
    }
    console.log(`    first non-zero @ 0x${first.toString(16)}, last @ 0x${last.toString(16)}`);
  }

  // workRam non-zero count
  let workSet = 0;
  for (let i = 0; i < state.workRam.length; i++) {
    if (state.workRam[i] !== 0) workSet++;
  }
  console.log(`  workRam non-zero bytes: ${workSet}/${state.workRam.length}`);

  exit(0);
}

main().catch(e => { console.error(e); exit(1); });
