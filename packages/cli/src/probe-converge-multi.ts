/**
 * probe-converge-multi.ts — valida l'evoluzione TS frame-per-frame contro
 * MAME oracle multi-frame.
 *
 * Input: JSON multi-snapshot prodotto da `oracle/mame_state_multidump.lua`,
 *   schema { frames: [N0, N1, ...], snapshots: [{frame, workRam, playfieldRam,
 *   spriteRam, alphaRam, colorRam}, ...] }
 *
 * Strategy:
 *   - Scegli baseFrame = primo snapshot (= warmState seed)
 *   - Per ogni snapshot N successivo:
 *     - bootInit({warmState: snapshots[0]})
 *     - tick(N - baseFrame, {runMainLoopBody:true})
 *     - confronta state TS vs snapshots[N] per ogni regione
 *   - Stampa tabella delta% per regione/frame
 *
 * Uso:
 *   MULTI_DUMP=/tmp/mame_state_multi.json npx tsx packages/cli/src/probe-converge-multi.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const DUMP_PATH = process.env.MULTI_DUMP ?? "/tmp/mame_state_multi.json";

const rom = busNs.emptyRomImage();
rom.program.set(
  readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length),
);

interface Snapshot {
  frame: number;
  workRam: Uint8Array;
  playfieldRam: Uint8Array;
  spriteRam: Uint8Array;
  alphaRam: Uint8Array;
  colorRam: Uint8Array;
}

function hex(s: string): Uint8Array {
  const o = new Uint8Array(s.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16);
  return o;
}

function pct(a: Uint8Array, b: Uint8Array, skipStack = false): number {
  const t = Math.min(a.length, b.length);
  let m = 0, counted = 0;
  for (let i = 0; i < t; i++) {
    // workRam[0x1d22..0x1eff] = M68K supervisor stack residue (SSP=0x1F00).
    // TS non ha M68K stack — skip dal confronto.
    if (skipStack && i >= 0x1d22 && i <= 0x1eff) continue;
    counted++;
    if (a[i] === b[i]) m++;
  }
  return Math.round((m * 1000) / counted) / 10;
}

const raw = JSON.parse(readFileSync(DUMP_PATH, "utf-8")) as {
  frames: number[];
  snapshots: Array<{
    frame: number;
    workRam: string;
    playfieldRam: string;
    spriteRam: string;
    alphaRam: string;
    colorRam: string;
  }>;
};

const snapshots: Snapshot[] = raw.snapshots.map((s) => ({
  frame: s.frame,
  workRam: hex(s.workRam),
  playfieldRam: hex(s.playfieldRam),
  spriteRam: hex(s.spriteRam),
  alphaRam: hex(s.alphaRam),
  colorRam: hex(s.colorRam),
}));

if (snapshots.length < 2) {
  console.error("Need at least 2 snapshots in multidump");
  process.exit(1);
}

const base = snapshots[0]!;
console.log(`Base frame (warmState seed): ${base.frame}`);
console.log(`Comparing TS evolution vs MAME oracle:\n`);

const header = "frame   Δticks  workRam%  pfRam%   sprRam%  alphaRam% colorRam%";
console.log(header);
console.log("-".repeat(header.length));

// Frame base = identità (sanity check)
console.log(
  `${base.frame.toString().padStart(5)}   ${"0".padStart(6)}  ` +
    `${"100.0".padStart(7)}%  ${"100.0".padStart(6)}%  ${"100.0".padStart(6)}%  ` +
    `${"100.0".padStart(7)}%  ${"100.0".padStart(7)}%  (warmState seed)`,
);

for (let i = 1; i < snapshots.length; i++) {
  const target = snapshots[i]!;
  const dticks = target.frame - base.frame;

  const s = stateNs.emptyGameState();
  bootInit(s, rom, {
    warmState: {
      workRam: base.workRam,
      playfieldRam: base.playfieldRam,
      spriteRam: base.spriteRam,
      alphaRam: base.alphaRam,
      colorRam: base.colorRam,
    },
  });
  for (let t = 0; t < dticks; t++) {
    tick(s, { rom, runMainLoopBody: true });
  }

  const wp = pct(s.workRam, target.workRam, true);
  const pp = pct(s.playfieldRam, target.playfieldRam);
  const sp = pct(s.spriteRam, target.spriteRam);
  const ap = pct(s.alphaRam, target.alphaRam);
  const cp = pct(s.colorRam, target.colorRam);

  const fmt = (n: number) => n.toFixed(1).padStart(6);
  console.log(
    `${target.frame.toString().padStart(5)}   ${dticks.toString().padStart(6)}  ` +
      `${fmt(wp)}%  ${fmt(pp)}%  ${fmt(sp)}%  ${fmt(ap)}%  ${fmt(cp)}%`,
  );
}
