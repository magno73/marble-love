import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
const gt = JSON.parse(readFileSync("/tmp/mame_100f.json","utf-8")) as { snapshots: { workRam: string; playfieldRam: string; spriteRam: string; alphaRam: string; colorRam: string }[] };
const hex2bytes = (h: string, l: number) => { const o = new Uint8Array(l); for (let i = 0; i < l; i++) o[i] = parseInt(h.substr(i*2,2),16); return o; };
const f0 = gt.snapshots[0]!;
const warm = { workRam: hex2bytes(f0.workRam, 0x2000), playfieldRam: hex2bytes(f0.playfieldRam, 0x2000), spriteRam: hex2bytes(f0.spriteRam, 0x1000), alphaRam: hex2bytes(f0.alphaRam, 0x1000), colorRam: hex2bytes(f0.colorRam, 0x800), videoScrollX: 0, videoScrollY: 0, slapsticBank: 1 };
const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

const orig = s.workRam;
let curTick = 0;
let logging = false;
const writes: { tick: number; off: number; val: number; stack: string }[] = [];
const proxy = new Proxy(orig, {
  get(t, p) { const v = Reflect.get(t, p, t); return typeof v === "function" ? v.bind(t) : v; },
  set(t, p, value) {
    const idx = typeof p === "string" ? Number(p) : NaN;
    if (logging && (idx === 0x38 || idx === 0x39) && t[idx as number] !== value) {
      const stack = new Error().stack ?? "";
      writes.push({ tick: curTick, off: idx, val: value, stack: stack.split("\n").slice(2, 6).join(" | ") });
    }
    Reflect.set(t, p, value);
    return true;
  },
});
(s as { workRam: Uint8Array }).workRam = proxy;

for (let i = 1; i <= 60; i++) {
  curTick = i;
  logging = i >= 50 && i <= 58;
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
}

console.log(`\nWrites to workRam[0x38..0x39] in ticks 50..58:`);
for (const w of writes) {
  console.log(`  tick ${w.tick} off=0x${w.off.toString(16)} val=0x${w.val.toString(16).padStart(2,"0")} stack=${w.stack.split(" | ")[0]}`);
}
