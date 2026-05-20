#!/usr/bin/env node
/**
 * TS write tap for motion-object RAM windows during long demo replay.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applySlapsticBank, bootInit, bus as busNs, state as stateNs, tick } from "@marble-love/engine";

const DUMP_PATH = process.env.MULTI_DUMP ?? "/tmp/mame_demo_12000_18000_step10.json";
const FROM_TICK = Number(process.env.FROM_TICK ?? "880");
const TO_TICK = Number(process.env.TO_TICK ?? "960");
const LO = Number(process.env.SPR_LO ?? "0x400");
const HI = Number(process.env.SPR_HI ?? "0x77f");
const MAX_LOGS = Number(process.env.MAX_LOGS ?? "2000");
const LOG_UNCHANGED = process.env.LOG_UNCHANGED === "1";

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

function hex(s: string): Uint8Array {
  const o = new Uint8Array(s.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16);
  return o;
}

function callerSummary(): string {
  const stack = new Error().stack ?? "";
  return stack
    .split("\n")
    .slice(3, 10)
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
let writes = 0;
const byCaller = new Map<string, number>();
const original = s.spriteRam;
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
      if (off >= LO && off <= HI && tickNo >= FROM_TICK && tickNo <= TO_TICK && (LOG_UNCHANGED || prev !== next)) {
        writes++;
        const caller = callerSummary();
        byCaller.set(caller, (byCaller.get(caller) ?? 0) + 1);
        if (writes <= MAX_LOGS) {
          console.log(
            `t=${tickNo.toString().padStart(4)} off=0x${off.toString(16).padStart(3, "0")} ` +
              `0x${prev.toString(16).padStart(2, "0")}->0x${next.toString(16).padStart(2, "0")} ${caller}`,
          );
        }
      }
    }
    return Reflect.set(target, prop, value);
  },
});
s.spriteRam = proxy as Uint8Array;

console.log(`Base frame ${base.frame}, logging TS sprite writes ticks ${FROM_TICK}..${TO_TICK} off 0x${LO.toString(16)}..0x${HI.toString(16)}`);
for (tickNo = 1; tickNo <= TO_TICK; tickNo++) {
  tick(s, { rom, runMainLoopBody: true });
}

console.log(`total writes=${writes}`);
console.log("by caller:");
for (const [caller, count] of [...byCaller.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`${count} ${caller}`);
}
