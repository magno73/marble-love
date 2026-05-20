#!/usr/bin/env node
/**
 * probe-demo-mode-writes.ts — TS write tap for attract/demo mode transition globals.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applySlapsticBank, bootInit, bus as busNs, state as stateNs, tick } from "@marble-love/engine";

const DUMP_PATH = process.env.MULTI_DUMP ?? "/tmp/mame_demo_12000_18000_step10.json";
const FROM_TICK = Number(process.env.FROM_TICK ?? "880");
const TO_TICK = Number(process.env.TO_TICK ?? "1040");

const watch = new Set([
  0x000, 0x001, 0x002, 0x003, 0x008, 0x00a,
  0x390, 0x391, 0x392, 0x393, 0x394, 0x395, 0x396, 0x397,
  0x3e2, 0x3e4,
  0x75a, 0x75b,
]);

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

function hex(s: string): Uint8Array {
  const o = new Uint8Array(s.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16);
  return o;
}

function rw(w: Uint8Array, off: number): number {
  return (((w[off] ?? 0) << 8) | (w[off + 1] ?? 0)) & 0xffff;
}

function callerSummary(): string {
  const stack = new Error().stack ?? "";
  return stack
    .split("\n")
    .slice(3, 9)
    .map((line) => line.trim().replace(/^at /, ""))
    .join(" <- ");
}

const raw = JSON.parse(readFileSync(DUMP_PATH, "utf-8")) as {
  snapshots: Array<{ frame: number; workRam: string; playfieldRam: string; spriteRam: string; alphaRam: string; colorRam: string }>;
};
const base = raw.snapshots[0];
if (base === undefined) throw new Error("empty dump");

const s = stateNs.emptyGameState();
bootInit(s, rom, {
  warmState: {
    workRam: hex(base.workRam),
    playfieldRam: hex(base.playfieldRam),
    spriteRam: hex(base.spriteRam),
    alphaRam: hex(base.alphaRam),
    colorRam: hex(base.colorRam),
    slapsticBank: 1,
  },
});

let tickNo = 0;
const original = s.workRam;
const proxy = new Proxy(original, {
  get(target, prop, receiver): unknown {
    if (prop === "length") return target.length;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
  set(target, prop, value): boolean {
    if (typeof prop === "string" && /^\d+$/.test(prop)) {
      const off = Number(prop);
      const prev = target[off] ?? 0;
      const next = Number(value) & 0xff;
      if (watch.has(off) && tickNo >= FROM_TICK && tickNo <= TO_TICK && prev !== next) {
        console.log(
          `t=${tickNo.toString().padStart(4)} off=0x${off.toString(16).padStart(3, "0")} ` +
            `0x${prev.toString(16).padStart(2, "0")}->0x${next.toString(16).padStart(2, "0")} ` +
            `392=${rw(target, 0x392).toString(16).padStart(4, "0")} ` +
            `394=${rw(target, 0x394).toString(16).padStart(4, "0")} ` +
            `75a=${rw(target, 0x75a).toString(16).padStart(4, "0")} ` +
            callerSummary(),
        );
      }
    }
    return Reflect.set(target, prop, value);
  },
});
s.workRam = proxy as Uint8Array;

console.log(`Base frame ${base.frame}, logging TS ticks ${FROM_TICK}..${TO_TICK}`);
for (tickNo = 1; tickNo <= TO_TICK; tickNo++) {
  tick(s, { rom, runMainLoopBody: true });
}
