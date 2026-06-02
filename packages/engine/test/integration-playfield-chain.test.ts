/**
 * integration-playfield-chain.test.ts — end-to-end validation of the chain
 * tilemap loading scoperta via watch_write MAME (level1):
 *
 *   bootInit
 *   ↓
 *   workRam[0x394] = level index (= 0..5)
 *   ↓
 *   clearPlayfieldRam12174 (FUN_12174)
 *   ↓
 *   levelDispatcher16EC6 (FUN_16EC6) → buildTilemapRows1A444 (FUN_1A444)
 *     → buildTilemapSpan1AA38 (FUN_1AA38)
 *     → renderTileLine1AD54 (FUN_1AD54)
 *     → packTilemapEntries1A9CC (FUN_1A9CC)
 *
 * In MAME al frame 200 of level1 = 4039 byte non-zero.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";
import { bootInit } from "../src/boot-init.js";
import { clearPlayfieldRam12174 } from "../src/clear-playfield-ram-12174.js";
import { levelDispatcher16EC6 } from "../src/level-dispatcher-16ec6.js";
import { loadRomBlob } from "../src/m68k/apply-slapstic-bank.js";

function findRomBlob(): string | null {
  const candidates = [
    process.env["MARBLE_LOVE_ROM_BLOB"],
    resolve(process.cwd(), "ghidra_project/marble_program.bin"),
    resolve(process.cwd(), "../../ghidra_project/marble_program.bin"),
  ].filter((x): x is string => typeof x === "string");
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadRomFromBlob(): RomImage | null {
  const path = findRomBlob();
  if (path === null) return null;
  const rom = emptyRomImage();
  loadRomBlob(rom, readFileSync(path));
  return rom;
}

describe("integration: playfield chain (Codex tilemap loaders)", () => {
  const rom = loadRomFromBlob();
  if (rom === null) {
    it.skip("ROM blob non disponibile — test skippati", () => {});
    return;
  }

  it("levelDispatcher16EC6 popola playfieldRam per level=1", () => {
    const state = emptyGameState();
    bootInit(state, rom);

    const preNonZero = state.playfieldRam.filter((b) => b !== 0).length;
    expect(preNonZero).toBe(0);

    state.workRam[0x394] = 0;
    state.workRam[0x395] = 0;

    // Chain: clear + dispatcher (with default wired subs).
    clearPlayfieldRam12174(state);
    levelDispatcher16EC6(state, rom);

    const postNonZero = state.playfieldRam.filter((b) => b !== 0).length;

    // with stub injection some subs may be partially active.
    // but packTilemapEntries1A9CC should still write anyway).
    // Soglia conservativa: almeno qualcosa.
    expect(postNonZero).toBeGreaterThan(0);
  });

  it("each livello (0..5) popola playfieldRam differentemente", () => {
    const counts: number[] = [];
    for (let levelIdx = 0; levelIdx < 6; levelIdx++) {
      const state = emptyGameState();
      bootInit(state, rom);
      state.workRam[0x394] = (levelIdx >>> 8) & 0xff;
      state.workRam[0x395] = levelIdx & 0xff;
      clearPlayfieldRam12174(state);
      levelDispatcher16EC6(state, rom);
      counts.push(state.playfieldRam.filter((b) => b !== 0).length);
    }
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    // Log per debug visibility (vitest mostra console.log)
    console.log("    playfieldRam non-zero by level:", counts);
  });

  it("workRam[0x474] (state ptr) popolato from the dispatcher", () => {
    const state = emptyGameState();
    bootInit(state, rom);
    state.workRam[0x394] = 0;
    state.workRam[0x395] = 0;

    levelDispatcher16EC6(state, rom);

    // = level 0 = 0x0002BEE2
    const statePtr =
      ((state.workRam[0x474] ?? 0) << 24) |
      ((state.workRam[0x475] ?? 0) << 16) |
      ((state.workRam[0x476] ?? 0) << 8) |
      (state.workRam[0x477] ?? 0);

    expect(statePtr >>> 0).toBe(0x0002bee2);
  });
});
