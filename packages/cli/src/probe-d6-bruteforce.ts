// probe-d6-bruteforce.ts - brute-force D6 entry for each decoder invocation.
// Strategy: advance TS to body N (= pre-body snapshot), try D6 = 0..0xFFFF,
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

const gt = JSON.parse(readFileSync("/tmp/mame_100f.json","utf-8")) as {
  snapshots: { frame: number; workRam: string; playfieldRam: string; spriteRam: string; alphaRam: string; colorRam: string }[];
};

function hex2bytes(h: string, l: number): Uint8Array {
  const o = new Uint8Array(l);
  for (let i = 0; i < l; i++) o[i] = parseInt(h.substr(i*2,2),16);
  return o;
}

const f0 = gt.snapshots[0]!;
const warm = {
  workRam: hex2bytes(f0.workRam, 0x2000),
  playfieldRam: hex2bytes(f0.playfieldRam, 0x2000),
  spriteRam: hex2bytes(f0.spriteRam, 0x1000),
  alphaRam: hex2bytes(f0.alphaRam, 0x1000),
  colorRam: hex2bytes(f0.colorRam, 0x800),
  videoScrollX: 0, videoScrollY: 0,
  slapsticBank: 1,
};

const decoderFrames = [2, 10, 18, 26, 34, 42, 50, 60, 76, 92];

// Snapshot state helper (shallow + workRam copy)
function snapState(s: stateNs.GameState): { workRam: Uint8Array; playfield: Uint8Array; sprite: Uint8Array; alpha: Uint8Array; color: Uint8Array; videoScrollX: number; videoScrollY: number; mainLoopBodyTicks: number; decoderCallCount: number; decoderD6Init: number } {
  return {
    workRam: new Uint8Array(s.workRam),
    playfield: new Uint8Array(s.playfieldRam),
    sprite: new Uint8Array(s.spriteRam),
    alpha: new Uint8Array(s.alphaRam),
    color: new Uint8Array(s.colorRam),
    videoScrollX: s.videoScrollX as number,
    videoScrollY: s.videoScrollY as number,
    mainLoopBodyTicks: s.clock.mainLoopBodyTicks as number,
    decoderCallCount: s.clock.decoderCallCount as number,
    decoderD6Init: s.clock.decoderD6Init as number,
  };
}

function restoreState(s: stateNs.GameState, snap: ReturnType<typeof snapState>): void {
  s.workRam.set(snap.workRam);
  s.playfieldRam.set(snap.playfield);
  s.spriteRam.set(snap.sprite);
  s.alphaRam.set(snap.alpha);
  s.colorRam.set(snap.color);
  (s as { videoScrollX: number }).videoScrollX = snap.videoScrollX;
  (s as { videoScrollY: number }).videoScrollY = snap.videoScrollY;
  (s.clock as { mainLoopBodyTicks: number }).mainLoopBodyTicks = snap.mainLoopBodyTicks;
  (s.clock as { decoderCallCount: number }).decoderCallCount = snap.decoderCallCount;
  (s.clock as { decoderD6Init: number }).decoderD6Init = snap.decoderD6Init;
}

const sBase = stateNs.emptyGameState();
bootInit(sBase, rom, { warmState: warm });

const d6Table: number[] = [];

for (const targetFrame of decoderFrames) {
  const preFrame = targetFrame - 1;
  // Reset state and advance to preFrame.
  const sFresh = stateNs.emptyGameState();
  bootInit(sFresh, rom, { warmState: warm });
  // Apply D6 values found for previous bodies
  for (let i = 1; i <= preFrame; i++) {
    const bodyIdx = decoderFrames.indexOf(i);
    if (bodyIdx >= 0 && bodyIdx < d6Table.length) {
      (sFresh.clock as { decoderD6Init: number }).decoderD6Init = d6Table[bodyIdx]!;
    } else {
      (sFresh.clock as { decoderD6Init: number }).decoderD6Init = 0;
    }
    tick(sFresh, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  }
  const preSnap = snapState(sFresh);

  // MAME target
  const mw = hex2bytes(gt.snapshots[targetFrame]!.workRam, 0x2000);

  // Brute force D6 = 0..0xFFFF
  let bestD6 = -1;
  let bestDiff = Infinity;
  for (let d6 = 0; d6 <= 0xFFFF; d6++) {
    restoreState(sFresh, preSnap);
    (sFresh.clock as { decoderD6Init: number }).decoderD6Init = d6;
    tick(sFresh, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
    let diff = 0;
    for (let off = 0x700; off < 0x740; off++) {
      if (sFresh.workRam[off] !== mw[off]) diff++;
    }
    if (diff < bestDiff) {
      bestDiff = diff;
      bestD6 = d6;
      if (diff === 0) break;
    }
  }
  d6Table.push(bestD6);
  console.log(`Body @ f+${targetFrame}: best D6 = 0x${bestD6.toString(16)} (diff ${bestDiff})`);
}

writeFileSync("/tmp/d6_table.json", JSON.stringify(d6Table, null, 2));
console.log("\nD6 table:", d6Table.map(v => `0x${v.toString(16)}`).join(", "));
