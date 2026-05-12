#!/usr/bin/env node
/**
 * probe-1caba-runtime-state.ts — task #186 step 1+2+3.
 *
 * Goal: catturare lo state TS al momento ESATTO della prima chiamata di
 * `sub1CABATileRedraw` durante tick 2 (= body run f12001), poi confrontare
 * bit-by-bit con la fixture warm `sub-1caba-firstcall.json` (= input usato
 * dal test parity 3/3).
 *
 * Strategia:
 *   1. Carica warm state da MAME f12000 (= /tmp/mame_100f.json frame 0).
 *   2. bootInit con warm state.
 *   3. tick 1 (= WAIT, body skip — mainLoopBodyTicks → 1, tickIsBody=false).
 *   4. Registra setSub1CabaObserver per snapshot al call#1 e tick 2 (= BODY).
 *   5. Carica fixture warm `sub-1caba-firstcall.json`.
 *   6. Diff bit-by-bit:
 *      - workRam[0..0x2000]
 *      - playfieldRam[0..0x2000]
 *      - spriteRam[0..0x1000]
 *      - tileX, tileY, lvlPtr, bsearchPtr
 *      - struct_pre @ 0x1c28..0x1c47
 *      - colBase @ 0x478..0x677
 *      - bsearchAlt @ 0x76e..0x96d
 *   7. Report la PRIMA byte divergente (offset, valore TS, fixture).
 *
 * Usage:
 *   npx tsx packages/cli/src/probe-1caba-runtime-state.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";
import { loadRomBlob } from "../../engine/src/m68k/apply-slapstic-bank.js";
import { setSub1CabaObserver } from "../../engine/src/sub-1caba-tile-redraw.js";

interface Fixture {
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  firstCall: {
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
  };
}

interface Snapshot {
  callCount: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  slapsticBank: number;
  tileX: string;
  tileY: string;
  lvlPtr: string;
  bsearchPtr: string;
  structPre: string;
  colBase: string;
  bsearchAlt: string;
}

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len && i * 2 + 1 < hex.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytes2hex(u8: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < u8.length; i++) parts.push((u8[i] ?? 0).toString(16).padStart(2, "0"));
  return parts.join("");
}

function r16(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

function r32(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>> 0
  );
}

function findFirstDiff(
  label: string,
  ts: Uint8Array,
  ref: Uint8Array,
  base: number,
): { offset: number; tsByte: number; refByte: number } | null {
  const len = Math.min(ts.length, ref.length);
  for (let i = 0; i < len; i++) {
    if (ts[i] !== ref[i]) {
      const off = base + i;
      console.log(
        `  [${label}] FIRST DIFF: offset=0x${off.toString(16).padStart(4, "0")} ` +
        `TS=0x${(ts[i] ?? 0).toString(16).padStart(2, "0")} REF=0x${(ref[i] ?? 0).toString(16).padStart(2, "0")}`,
      );
      return { offset: off, tsByte: ts[i] ?? 0, refByte: ref[i] ?? 0 };
    }
  }
  console.log(`  [${label}] match (len=${len})`);
  return null;
}

function compareRegion(
  label: string,
  ts: Uint8Array,
  ref: Uint8Array,
  base: number,
  maxReport = 10,
): { totalDiffs: number; firstOffsets: number[] } {
  const len = Math.min(ts.length, ref.length);
  let totalDiffs = 0;
  const firstOffsets: number[] = [];
  for (let i = 0; i < len; i++) {
    if (ts[i] !== ref[i]) {
      totalDiffs++;
      if (firstOffsets.length < maxReport) firstOffsets.push(base + i);
    }
  }
  if (totalDiffs === 0) {
    console.log(`  [${label}] 0 diffs`);
  } else {
    console.log(
      `  [${label}] ${totalDiffs} diffs (first @ 0x${firstOffsets.map(o => o.toString(16)).join(", 0x")})`,
    );
    for (const off of firstOffsets) {
      const i = off - base;
      console.log(
        `    0x${off.toString(16).padStart(4, "0")}: TS=0x${(ts[i] ?? 0).toString(16).padStart(2, "0")} REF=0x${(ref[i] ?? 0).toString(16).padStart(2, "0")}`,
      );
    }
  }
  return { totalDiffs, firstOffsets };
}

async function main(): Promise<void> {
  // Load fixture
  const fixturePath = "packages/engine/test/fixtures/sub-1caba-firstcall.json";
  if (!existsSync(fixturePath)) {
    console.error(`error: fixture not found at ${fixturePath}`);
    process.exit(2);
  }
  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as Fixture;
  console.log(`Loaded fixture: firstCall.frame=${fixture.firstCall.frame}`);

  // Load ROM
  const rom = busNs.emptyRomImage();
  loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

  // Load warm state from MAME f12000
  const gt = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
    snapshots: Array<{
      workRam: string;
      playfieldRam: string;
      spriteRam: string;
      alphaRam: string;
      colorRam: string;
    }>;
  };
  const f0 = gt.snapshots[0]!;
  const warm = {
    workRam: hex2bytes(f0.workRam, 0x2000),
    playfieldRam: hex2bytes(f0.playfieldRam, 0x2000),
    spriteRam: hex2bytes(f0.spriteRam, 0x1000),
    alphaRam: hex2bytes(f0.alphaRam, 0x1000),
    colorRam: hex2bytes(f0.colorRam, 0x800),
    videoScrollX: 0,
    videoScrollY: 0,
  };

  const stateInst = stateNs.emptyGameState();
  bootInit(stateInst, rom, { warmState: warm });

  // Register observer: snapshot at call#1 pre AND post, then ignore.
  let captured: Snapshot | null = null;
  const out: { structPost: string | null } = { structPost: null };
  setSub1CabaObserver((s, r, callIdx, phase) => {
    if (callIdx !== 1) return;
    if (phase === "pre") {
      captured = {
        callCount: callIdx,
        workRam: bytes2hex(s.workRam),
        playfieldRam: bytes2hex(s.playfieldRam),
        spriteRam: bytes2hex(s.spriteRam),
        slapsticBank: r.slapsticFsm.bank,
        tileX: r16(s.workRam, 0x696).toString(16).padStart(4, "0"),
        tileY: r16(s.workRam, 0x698).toString(16).padStart(4, "0"),
        lvlPtr: r32(s.workRam, 0x474).toString(16).padStart(8, "0"),
        bsearchPtr: r32(s.workRam, 0x65a).toString(16).padStart(8, "0"),
        structPre: bytes2hex(s.workRam.subarray(0x1c28, 0x1c28 + 32)),
        colBase: bytes2hex(s.workRam.subarray(0x478, 0x478 + 0x200)),
        bsearchAlt: bytes2hex(s.workRam.subarray(0x76e, 0x76e + 0x200)),
      };
    } else {
      out.structPost = bytes2hex(s.workRam.subarray(0x1c28, 0x1c28 + 32));
    }
  });

  // tick 1 = WAIT
  tick(stateInst, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });

  // tick 2 = BODY
  tick(stateInst, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });

  // Disable observer
  setSub1CabaObserver(null);

  if (captured === null) {
    console.error(
      `FAIL LOUD: sub1CABATileRedraw was NOT called during tick 1+2 ` +
      `(observer never invoked). Cascade chain hypothesis (= sub-1caba ` +
      `produces struct=0 on runtime tick 2) is broken or wire is missing.`,
    );
    process.exit(3);
  }

  const snap = captured as Snapshot;
  const snapshotPath = "/tmp/ts_1caba_runtime_state.json";
  writeFileSync(snapshotPath, JSON.stringify(snap, null, 2));
  console.log(`TS runtime snapshot: call#${snap.callCount}, bank=${snap.slapsticBank}`);
  console.log(`  TS: tileX=0x${snap.tileX} tileY=0x${snap.tileY} lvlPtr=0x${snap.lvlPtr} bsearchPtr=0x${snap.bsearchPtr}`);
  console.log(`  REF: tileX=${fixture.firstCall.tileX} tileY=${fixture.firstCall.tileY} lvlPtr=${fixture.firstCall.lvlPtr} bsearchPtr=${fixture.firstCall.bsearchPtr}`);

  // Build TS state arrays
  const tsWork = hex2bytes(snap.workRam, 0x2000);
  const tsPlayfield = hex2bytes(snap.playfieldRam, 0x2000);
  const tsSprite = hex2bytes(snap.spriteRam, 0x1000);

  // Build fixture state arrays
  const refWork = hex2bytes(fixture.workRam, 0x2000);
  const refPlayfield = hex2bytes(fixture.playfieldRam, 0x2000);
  const refSprite = hex2bytes(fixture.spriteRam, 0x1000);

  // Read scalars from TS state
  const tsTileX = parseInt(snap.tileX, 16);
  const tsTileY = parseInt(snap.tileY, 16);
  const tsLvlPtr = parseInt(snap.lvlPtr, 16);
  const tsBsearchPtr = parseInt(snap.bsearchPtr, 16);
  const refTileX = parseInt(fixture.firstCall.tileX, 16) & 0xffff;
  const refTileY = parseInt(fixture.firstCall.tileY, 16) & 0xffff;
  const refLvlPtr = parseInt(fixture.firstCall.lvlPtr, 16) >>> 0;
  const refBsearchPtr = parseInt(fixture.firstCall.bsearchPtr, 16) >>> 0;

  console.log(`\n=== SCALAR DIFFS ===`);
  console.log(`tileX:      TS=0x${tsTileX.toString(16)}  REF=0x${refTileX.toString(16)}  ${tsTileX === refTileX ? "OK" : "DIFF"}`);
  console.log(`tileY:      TS=0x${tsTileY.toString(16)}  REF=0x${refTileY.toString(16)}  ${tsTileY === refTileY ? "OK" : "DIFF"}`);
  console.log(`lvlPtr:     TS=0x${tsLvlPtr.toString(16)}  REF=0x${refLvlPtr.toString(16)}  ${tsLvlPtr === refLvlPtr ? "OK" : "DIFF"}`);
  console.log(`bsearchPtr: TS=0x${tsBsearchPtr.toString(16)}  REF=0x${refBsearchPtr.toString(16)}  ${tsBsearchPtr === refBsearchPtr ? "OK" : "DIFF"}`);

  console.log(`\n=== FIRST DIFF PER REGION ===`);
  findFirstDiff("workRam", tsWork, refWork, 0);
  findFirstDiff("playfieldRam", tsPlayfield, refPlayfield, 0);
  findFirstDiff("spriteRam", tsSprite, refSprite, 0);

  console.log(`\n=== TOTAL DIFFS PER REGION ===`);
  const workCmp = compareRegion("workRam (all)", tsWork, refWork, 0, 20);
  void compareRegion("playfieldRam (all)", tsPlayfield, refPlayfield, 0, 10);
  void compareRegion("spriteRam (all)", tsSprite, refSprite, 0, 5);

  // Targeted: regions that sub-1caba ACTUALLY READS
  console.log(`\n=== TARGETED: sub-1caba INPUT REGIONS ===`);
  console.log(`-- workRam[0x474..0x478] (lvlPtr long):`);
  compareRegion("lvlPtr_long", tsWork.subarray(0x474, 0x478), refWork.subarray(0x474, 0x478), 0x474);
  console.log(`-- workRam[0x65a..0x65e] (bsearchPtr long):`);
  compareRegion("bsearchPtr_long", tsWork.subarray(0x65a, 0x65e), refWork.subarray(0x65a, 0x65e), 0x65a);
  console.log(`-- workRam[0x696..0x69a] (tileX, tileY):`);
  compareRegion("tileXY", tsWork.subarray(0x696, 0x69a), refWork.subarray(0x696, 0x69a), 0x696);
  console.log(`-- workRam[0x478..0x678] (colBase 0x200):`);
  compareRegion("colBase", tsWork.subarray(0x478, 0x478 + 0x200), refWork.subarray(0x478, 0x478 + 0x200), 0x478);
  console.log(`-- workRam[0x76e..0x96e] (bsearchAlt 0x200):`);
  compareRegion("bsearchAlt", tsWork.subarray(0x76e, 0x76e + 0x200), refWork.subarray(0x76e, 0x76e + 0x200), 0x76e);
  console.log(`-- workRam[0x1c28..0x1c48] (STRUCT 32B PRE):`);
  compareRegion("structPre", tsWork.subarray(0x1c28, 0x1c48), refWork.subarray(0x1c28, 0x1c48), 0x1c28);

  console.log(`\n=== STRUCT_PRE COMPARISON (vs fixture) ===`);
  console.log(`  TS:  ${snap.structPre}`);
  console.log(`  REF: ${fixture.firstCall.struct_pre}`);
  console.log(`  (fixture is from boot/level-init f173, NOT attract f12001 — input differs)`);

  // Cross-check against MAME attract trace (real attract first call)
  console.log(`\n=== CROSS-CHECK vs /tmp/mame_1caba_attract_count.json ===`);
  if (existsSync("/tmp/mame_1caba_attract_count.json")) {
    const at = JSON.parse(readFileSync("/tmp/mame_1caba_attract_count.json", "utf-8")) as {
      entries_full: Array<{
        frame: number;
        tileX: string; tileY: string;
        lvlPtr: string; bsearchPtr: string;
        struct_pre: string; struct_post: string;
        colBase: string; bsearchAlt: string;
      }>;
    };
    const mameCall = at.entries_full[0]!;
    console.log(`MAME first attract call (f${mameCall.frame}):`);
    console.log(`  tileX:      TS=0x${snap.tileX}    MAME=${mameCall.tileX}        ${snap.tileX === mameCall.tileX.replace(/^0x/, "").padStart(4, "0") ? "OK" : "DIFF"}`);
    console.log(`  tileY:      TS=0x${snap.tileY}    MAME=${mameCall.tileY}        ${snap.tileY === mameCall.tileY.replace(/^0x/, "").padStart(4, "0") ? "OK" : "DIFF"}`);
    console.log(`  lvlPtr:     TS=0x${snap.lvlPtr} MAME=${mameCall.lvlPtr} ${snap.lvlPtr === mameCall.lvlPtr.replace(/^0x/, "").padStart(8, "0") ? "OK" : "DIFF"}`);
    console.log(`  bsearchPtr: TS=0x${snap.bsearchPtr} MAME=${mameCall.bsearchPtr} ${snap.bsearchPtr === mameCall.bsearchPtr.replace(/^0x/, "").padStart(8, "0") ? "OK" : "DIFF"}`);
    console.log(`  structPre   TS=${snap.structPre}`);
    console.log(`  structPre  MAME=${mameCall.struct_pre}                                                       ${snap.structPre === mameCall.struct_pre ? "OK" : "DIFF"}`);
    const mameColBase = mameCall.colBase;
    const tsColBase = snap.colBase;
    const colMatch = tsColBase === mameColBase ? "OK" : "DIFF";
    console.log(`  colBase     ${colMatch} (TS len=${tsColBase.length}, MAME len=${mameColBase.length})`);
    if (colMatch === "DIFF") {
      const tsCol = hex2bytes(tsColBase, 0x200);
      const mameCol = hex2bytes(mameColBase, 0x200);
      let firstDiff = -1;
      for (let i = 0; i < 0x200; i++) {
        if (tsCol[i] !== mameCol[i]) { firstDiff = i; break; }
      }
      if (firstDiff >= 0) {
        console.log(`    first diff byte @ rel=0x${firstDiff.toString(16)}: TS=0x${(tsCol[firstDiff] ?? 0).toString(16).padStart(2, "0")} MAME=0x${(mameCol[firstDiff] ?? 0).toString(16).padStart(2, "0")}`);
        // count total diffs
        let totalDiffs = 0;
        for (let i = 0; i < 0x200; i++) if (tsCol[i] !== mameCol[i]) totalDiffs++;
        console.log(`    total colBase diffs: ${totalDiffs}`);
      }
    }
    const altMatch = snap.bsearchAlt === mameCall.bsearchAlt ? "OK" : "DIFF";
    console.log(`  bsearchAlt  ${altMatch}`);

    // Now: the output struct post
    const sp = out.structPost;
    if (sp !== null) {
      console.log(`\n=== STRUCT_POST (after sub-1caba returns at call#1 in TS runtime) ===`);
      console.log(`  TS POST:   ${sp}`);
      console.log(`  MAME POST: ${mameCall.struct_post}`);
      console.log(`  ${sp === mameCall.struct_post ? "OK ✓" : "DIFF ✗"}`);
      if (sp !== mameCall.struct_post) {
        for (let j = 0; j < 16; j++) {
          const tsW = sp.substr(j * 4, 4);
          const mW = mameCall.struct_post.substr(j * 4, 4);
          const mark = tsW === mW ? "  " : "<<";
          console.log(`    w[${j.toString().padStart(2)}]: ts=${tsW} mame=${mW} ${mark}`);
        }
      }
    }
  } else {
    console.log(`/tmp/mame_1caba_attract_count.json not found — cross-check skipped`);
  }

  console.log(`\nDone. ts_1caba_runtime_state.json written.`);
  console.log(`Total workRam diffs (8KB) vs fixture: ${workCmp.totalDiffs} (expected huge — fixture is boot, not attract)`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
