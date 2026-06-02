#!/usr/bin/env node
/**
 * test-sub-1caba-parity.ts — differential FUN_0001CABA (sub1CABATileRedraw)
 * vs MAME ground truth.
 *
 * **CURRENT STATUS (post-task #182): 41/54 = 76% match**. The previous
 * 54/54 result was an artifact of the OLD replica's `tc=0 → no writes` and
 * `abortBody → no writes` behavior. Disasm shows tc=0 and abortBody BOTH
 * jump to 0x1cc42 = `clr.l (A5)+; clr.l (A5)+` (= write 8 zero bytes).
 * After fixing the replica to match disasm (write 8 zeros on those paths),
 * 13 boot fixture calls now produce zeros where MAME shows `4000*16`. Root
 * cause: this test fixture only captures per-call colBase + bsearchAlt for
 * the FIRST call. Subsequent calls use the GLOBAL workRam @ snap_frame=172,
 * where bsearchAlt is all zeros (= no PATH_INDIRECT redispatch table yet).
 * With stale bsearchAlt → tc=0 → clear-8-bytes path triggers, producing 0s
 * that mismatch MAME's `4000*16`. The replica IS correct per disasm; the
 * boot fixture is incomplete (= would need per-call bsearchAlt for all
 * calls). The attract fixture (`test-sub-1caba-attract-parity.ts`) provides
 * complete per-call state and verifies 3/3 = 100% with the corrected replica
 * when slapstic bank is forced to 1 (= the bank TS naturally reaches via
 * `applySlapsticBank` during attract execution).
 *
 * **Background**: FUN_1CABA is called 66 times in MAME boot/level-init
 * (window f173..f240), but **ZERO times** in the attract window f12000..12099
 * that is used for differential testing. The STRUCT @ 0x401C28 stays constant
 * at `3fdc*16` throughout attract because no caller invokes 1CABA in that
 * window. The TS replica preserves the warm-state value identically (proven
 * via `probe-struct-1c28.ts`).
 *
 * **Previous false-negative claim**: docs (pre-session-2026-05-12) stated
 * "0/100 match" in isolation. This was based on a synthetic test that injected
 * the warm-state @ f12000 + ran sub1CABA, which produced different output
 * than the cached `3fdc*16` value (because the f12000 state's `colBase` /
 * `bsearchAlt` had been overwritten with other data, while MAME had stable
 * values from the init-time call sequence). That test was **misleading**: it
 * compared "TS computes fresh output" vs "MAME shows old cached output", not
 * "TS vs MAME on the same input".
 *
 * Strategy:
 *   1. Load MAME-captured trace from /tmp/mame_1caba_capture.json (created via
 *      `oracle/mame_1caba_capture.lua`). Trace contains:
 *        - workRam, playfieldRam, spriteRam @ fc=SNAP_FRAME (=172).
 *        - For each call: entry state (D/A regs, tileX/tileY, lvlPtr,
 *          bsearchPtr, struct_pre) + struct_post (= MAME ground truth).
 *        - For the FIRST call only: per-call colBase + bsearchAlt (because
 *          the caller populates these regions just before invoking
 *          FUN_1CABA, so the snap_frame value is stale).
 *   2. For each call:
 *        - Set state.workRam/playfieldRam/spriteRam = snapshot @ fc=SNAP_FRAME
 *        - Override tileX/tileY/lvlPtr/bsearchPtr/struct_pre in workRam from
 *          cto the s entry data.
 *        - For first call: also override colBase + bsearchAlt with per-call
 *          values.
 *        - Run sub1CABATileRedraw(state, rom)
 *        - Compare state.workRam[0x1c28..0x1c47] vs call.struct_post
 *   3. Report match count.
 *
 * Usage:
 *   # 1. Generate fresh trace (takes ~5s)
 *   rm -f /tmp/mame_1caba_capture.json && \
 *     MARBLE_MAX=70 MARBLE_STOP=260 MARBLE_SNAP=172 \
 *     mame marble -window -nothrottle -skip_gameinfo -seconds_to_run 30 \
 *       -rompath roms -autoboot_script oracle/mame_1caba_capture.lua \
 *       -autoboot_delay 0
 *   # 2. Run TS parity check
 *   npx tsx packages/cli/src/test-sub-1caba-parity.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, bus as busNs } from "@marble-love/engine";
// sub1CABATileRedraw is not exported from engine root; import directly.
import { sub1CABATileRedraw } from "../../engine/src/sub-1caba-tile-redraw.js";

interface CallTrace {
  frame: number;
  d: string[]; // 8 hex strings "0x..."
  a: string[];
  tileX: string;
  tileY: string;
  lvlPtr: string;
  bsearchPtr: string;
  struct_pre: string;
  struct_post: string;
  colBase?: string; // optional: only present for first call
  bsearchAlt?: string;
}

interface Trace {
  stop_frame: number;
  snap_frame: number;
  total_entries: number;
  total_exits: number;
  total_calls: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  calls: CallTrace[];
}

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len && i * 2 + 1 < hex.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function tracePath(): string {
  return process.env.TRACE_PATH ?? "/tmp/mame_1caba_capture.json";
}

function loadTrace(): Trace {
  const p = tracePath();
  if (!existsSync(p)) {
    console.error(`error: trace not found at ${p}; run:`);
    console.error(`  rm -f /tmp/mame_1caba_capture.json && MARBLE_MAX=70 MARBLE_STOP=260 MARBLE_SNAP=170 mame marble \\`);
    console.error(`    -window -nothrottle -skip_gameinfo -seconds_to_run 30 \\`);
    console.error(`    -rompath roms -autoboot_script oracle/mame_1caba_capture.lua \\`);
    console.error(`    -autoboot_delay 0`);
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
  const trace = loadTrace();
  console.log(`Loaded trace: ${trace.total_calls} calls (window f${trace.calls[0]?.frame}..f${trace.calls.at(-1)?.frame})`);
  console.log(`  Snapshot frame: ${trace.snap_frame}`);

  // Load ROM image
  const romBlob = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const rom = busNs.emptyRomImage();
  rom.program.set(romBlob.subarray(0, rom.program.length));

  // Decode MAME snapshots
  const baseWorkRam = hex2bytes(trace.workRam, 0x2000);
  const basePlayfield = hex2bytes(trace.playfieldRam, 0x2000);
  const baseSpriteRam = hex2bytes(trace.spriteRam, 0x1000);

  // Build initial state container
  const stateInst = stateNs.emptyGameState();

  let okCount = 0;
  let firstFail: { idx: number; tsStruct: string; mameStruct: string; firstDiff: number } | null = null;

  for (let i = 0; i < trace.calls.length; i++) {
    const c = trace.calls[i]!;
    // Reset state to MAME snapshot
    stateInst.workRam.set(baseWorkRam);
    stateInst.playfieldRam.set(basePlayfield);
    stateInst.spriteRam.set(baseSpriteRam);

    // Override globals from per-call entry data:
    // tileX @ 0x696, tileY @ 0x698, lvlPtr @ 0x474, bsearchPtr @ 0x65A, struct_pre @ 0x1C28
    const tileX = parseInt(c.tileX, 16) & 0xffff;
    const tileY = parseInt(c.tileY, 16) & 0xffff;
    const lvlPtr = parseInt(c.lvlPtr, 16) >>> 0;
    const bsearchPtr = parseInt(c.bsearchPtr, 16) >>> 0;

    w16(stateInst.workRam, 0x696, tileX);
    w16(stateInst.workRam, 0x698, tileY);
    w32(stateInst.workRam, 0x474, lvlPtr);
    w32(stateInst.workRam, 0x65a, bsearchPtr);

    // struct_pre into workRam[0x1c28..0x1c47]
    const structPreBytes = hex2bytes(c.struct_pre, 32);
    stateInst.workRam.set(structPreBytes, 0x1c28);

    // For first call (and any call that has per-call colBase/bsearchAlt),
    // override these from the entry snapshot — the global snapshot at fc=170
    // is stale (workRam[0x76e..] is populated BY the caller of FUN_1CABA
    // *just before* the call, NOT during snap_frame).
    if (c.colBase && c.colBase.length > 0) {
      const colBytes = hex2bytes(c.colBase, 0x200);
      stateInst.workRam.set(colBytes, 0x478);
    }
    if (c.bsearchAlt && c.bsearchAlt.length > 0) {
      const baBytes = hex2bytes(c.bsearchAlt, 0x200);
      stateInst.workRam.set(baBytes, 0x76e);
    }

    // Run the replica
    sub1CABATileRedraw(stateInst, rom);

    // Extract post-state struct
    const tsStructBytes = stateInst.workRam.subarray(0x1c28, 0x1c28 + 32);
    const tsStructHex = Array.from(tsStructBytes).map(b => b.toString(16).padStart(2, "0")).join("");

    if (tsStructHex === c.struct_post) {
      okCount++;
    } else {
      if (firstFail === null) {
        // Find first differing byte
        let diffByte = -1;
        for (let j = 0; j < 32; j++) {
          const tsB = tsStructBytes[j]!;
          const mameB = parseInt(c.struct_post.substr(j * 2, 2), 16);
          if (tsB !== mameB) { diffByte = j; break; }
        }
        firstFail = { idx: i, tsStruct: tsStructHex, mameStruct: c.struct_post, firstDiff: diffByte };
      }
    }
  }

  const total = trace.calls.length;
  console.log(`\nMatch: ${okCount}/${total} = ${((okCount / total) * 100).toFixed(1)}%`);
  if (firstFail !== null) {
    const c = trace.calls[firstFail.idx]!;
    console.log(`\nFirst FAIL @ call idx=${firstFail.idx} (frame ${c.frame}):`);
    console.log(`  tileX=${c.tileX} tileY=${c.tileY} lvlPtr=${c.lvlPtr} bsearchPtr=${c.bsearchPtr}`);
    console.log(`  struct_pre  = ${c.struct_pre}`);
    console.log(`  MAME post   = ${firstFail.mameStruct}`);
    console.log(`  TS   post   = ${firstFail.tsStruct}`);
    console.log(`  First diff at byte ${firstFail.firstDiff}`);
    // Print word-by-word diff
    console.log(`\n  Word-by-word diff:`);
    for (let j = 0; j < 16; j++) {
      const tsW = (parseInt(firstFail.tsStruct.substr(j * 4, 4), 16) >>> 0).toString(16).padStart(4, "0");
      const mameW = (parseInt(firstFail.mameStruct.substr(j * 4, 4), 16) >>> 0).toString(16).padStart(4, "0");
      const mark = tsW === mameW ? "  " : "<<";
      console.log(`    w[${j.toString().padStart(2)}]: ts=${tsW} mame=${mameW} ${mark}`);
    }
  }

  exit(okCount === total ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
