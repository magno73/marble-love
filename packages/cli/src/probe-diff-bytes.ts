/**
 * probe-diff-bytes.ts — diff byte-per-byte between TS evolution and MAME oracle
 * at a specific target frame, to identify exactly the bytes that
 * diverge at the first tick of drift.
 *
 * Usage:
 *   MULTI_DUMP=/tmp/mame_state_multi.json TARGET_FRAME=2401 \
 *     npx tsx packages/cli/src/probe-diff-bytes.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank } from "@marble-love/engine";

const DUMP_PATH = process.env.MULTI_DUMP ?? "/tmp/mame_state_multi.json";
const TARGET_FRAME = Number(process.env.TARGET_FRAME ?? "2401");
const SLAPSTIC_BANK_ENV = process.env.SLAPSTIC_BANK;

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

function hex(s: string): Uint8Array {
  const o = new Uint8Array(s.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16);
  return o;
}

const raw = JSON.parse(readFileSync(DUMP_PATH, "utf-8")) as {
  frames: number[];
  snapshots: Array<Record<string, string | number>>;
};

const base = raw.snapshots[0]!;
const target = raw.snapshots.find((s) => s.frame === TARGET_FRAME);
if (!target) {
  console.error(`Frame ${TARGET_FRAME} not in dump`);
  process.exit(1);
}

const baseFrame = base.frame as number;
const dticks = TARGET_FRAME - baseFrame;
const baseDumpBank = typeof base.slapsticBank === "number" ? base.slapsticBank : undefined;
const envBank = SLAPSTIC_BANK_ENV !== undefined ? Number(SLAPSTIC_BANK_ENV) : undefined;
const slapsticBank = Number.isFinite(envBank)
  ? (envBank as number) & 3
  : Number.isFinite(baseDumpBank)
    ? (baseDumpBank as number) & 3
    : 1;

const s = stateNs.emptyGameState();
bootInit(s, rom, {
  warmState: {
    workRam: hex(base.workRam as string),
    playfieldRam: hex(base.playfieldRam as string),
    spriteRam: hex(base.spriteRam as string),
    alphaRam: hex(base.alphaRam as string),
    colorRam: hex(base.colorRam as string),
    slapsticBank,
  },
});
for (let t = 0; t < dticks; t++) tick(s, { rom, runMainLoopBody: true });

interface DiffEntry {
  region: string;
  off: number;
  ts: number;
  mame: number;
  baseSeed: number;
}

function diff(region: string, ts: Uint8Array, mame: Uint8Array, baseArr: Uint8Array): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (let i = 0; i < ts.length; i++) {
    // workRam[0x1d22..0x1eff] = M68K supervisor stack of MAME (SSP=0x1F00,
    // low-water 0x1d22). TS has no M68K stack: differences here are residual
    // push/pop noise irrelevant to the game state. Skip.
    if (region === "workRam" && i >= 0x1d22 && i <= 0x1eff) continue;
    if (ts[i] !== mame[i]) {
      out.push({ region, off: i, ts: ts[i]!, mame: mame[i]!, baseSeed: baseArr[i]! });
    }
  }
  return out;
}

const all: DiffEntry[] = [
  ...diff("workRam", s.workRam, hex(target.workRam as string), hex(base.workRam as string)),
  ...diff("pfRam", s.playfieldRam, hex(target.playfieldRam as string), hex(base.playfieldRam as string)),
  ...diff("sprRam", s.spriteRam, hex(target.spriteRam as string), hex(base.spriteRam as string)),
  ...diff("alpha", s.alphaRam, hex(target.alphaRam as string), hex(base.alphaRam as string)),
  ...diff("color", s.colorRam, hex(target.colorRam as string), hex(base.colorRam as string)),
];

console.log(`Diff TS_after_${dticks}_ticks vs MAME@${TARGET_FRAME} (base seed @${baseFrame}):`);
console.log(`Warm slapstic bank: ${slapsticBank}`);
console.log(`Total divergent bytes: ${all.length}\n`);

// Group by region
const byRegion = new Map<string, DiffEntry[]>();
for (const d of all) {
  if (!byRegion.has(d.region)) byRegion.set(d.region, []);
  byRegion.get(d.region)!.push(d);
}

for (const [region, entries] of byRegion) {
  console.log(`=== ${region} (${entries.length} bytes) ===`);
  const limit = process.env.SHOW_ALL ? entries.length : 30;
  for (const e of entries.slice(0, limit)) {
    const seedTag = e.baseSeed === e.ts ? " (TS unchanged)" :
                    e.baseSeed === e.mame ? " (MAME unchanged)" : "";
    console.log(
      `  [${e.off.toString(16).padStart(4, "0")}] TS=0x${e.ts.toString(16).padStart(2, "0")} ` +
      `MAME=0x${e.mame.toString(16).padStart(2, "0")} ` +
      `seed=0x${e.baseSeed.toString(16).padStart(2, "0")}${seedTag}`,
    );
  }
  if (entries.length > limit) console.log(`  ... +${entries.length - limit} more`);
}
