#!/usr/bin/env node
/**
 * probe-demo-fields.ts — compact state field comparison for long demo windows.
 *
 * Uses a MAME multi-dump as warm-state seed, advances TS to each sampled frame,
 * and prints the state-machine/timer/scroll fields that explain visual stalls.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applySlapsticBank, bootInit, bus as busNs, state as stateNs, tick } from "@marble-love/engine";

const DUMP_PATH = process.env.MULTI_DUMP ?? "/tmp/mame_demo_12000_18000_step10.json";
const MAX_ROWS = Number(process.env.MAX_ROWS ?? "9999");

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

interface SnapshotJson {
  frame: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

function hex(s: string): Uint8Array {
  const o = new Uint8Array(s.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16);
  return o;
}

function rw(w: Uint8Array, off: number): number {
  return (((w[off] ?? 0) << 8) | (w[off + 1] ?? 0)) & 0xffff;
}

function rb(w: Uint8Array, off: number): number {
  return w[off] ?? 0;
}

function nz(a: Uint8Array): number {
  let n = 0;
  for (const v of a) if (v !== 0) n++;
  return n;
}

function fmtWord(v: number): string {
  return v.toString(16).padStart(4, "0");
}

function fmtByte(v: number): string {
  return v.toString(16).padStart(2, "0");
}

function shortFields(w: Uint8Array): string {
  return [
    `390=${fmtWord(rw(w, 0x390))}`,
    `392=${fmtWord(rw(w, 0x392))}`,
    `394=${fmtWord(rw(w, 0x394))}`,
    `396=${fmtWord(rw(w, 0x396))}`,
    `75a=${fmtWord(rw(w, 0x75a))}`,
    `3e2=${fmtByte(rb(w, 0x3e2))}`,
    `3e4=${fmtByte(rb(w, 0x3e4))}`,
    `3f0=${fmtByte(rb(w, 0x3f0))}`,
    `014=${fmtByte(rb(w, 0x14))}`,
    `016=${fmtByte(rb(w, 0x16))}`,
    `39a=${fmtByte(rb(w, 0x39a))}`,
    `000=${fmtWord(rw(w, 0x000))}`,
    `002=${fmtWord(rw(w, 0x002))}`,
    `008=${fmtByte(rb(w, 0x008))}`,
    `00a=${fmtByte(rb(w, 0x00a))}`,
    `3ae=${fmtWord(rw(w, 0x3ae))}`,
    `3b0=${fmtWord(rw(w, 0x3b0))}`,
  ].join(" ");
}

const raw = JSON.parse(readFileSync(DUMP_PATH, "utf-8")) as { snapshots: SnapshotJson[] };
const snapshots = raw.snapshots.map((s) => ({
  frame: s.frame,
  workRam: hex(s.workRam),
  playfieldRam: hex(s.playfieldRam),
  spriteRam: hex(s.spriteRam),
  alphaRam: hex(s.alphaRam),
  colorRam: hex(s.colorRam),
}));

const base = snapshots[0];
if (base === undefined) throw new Error("empty dump");

console.log(`Base frame ${base.frame} from ${DUMP_PATH}`);
console.log("frame dt   pfNZ(TS/MAME)  TS fields");
console.log("                         MAME fields");
console.log("-".repeat(132));

for (let i = 0; i < Math.min(snapshots.length, MAX_ROWS); i++) {
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
      slapsticBank: 1,
    },
  });
  for (let t = 0; t < dticks; t++) tick(s, { rom, runMainLoopBody: true });

  console.log(
    `${target.frame.toString().padStart(5)} ${dticks.toString().padStart(4)} ` +
      `${nz(s.playfieldRam).toString().padStart(5)}/${nz(target.playfieldRam).toString().padEnd(5)} ` +
      `TS   st0=${String(s.clock.mode0Init11452Stage ?? "--").padStart(3)} ` +
      `st2=${String(s.clock.mode2Init11452Stage ?? "--").padStart(3)} ${shortFields(s.workRam)}`,
  );
  console.log(`           ${"".padEnd(11)}MAME ${shortFields(target.workRam)}`);
}
