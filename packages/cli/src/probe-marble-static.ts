import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));

const mame = JSON.parse(readFileSync(resolve("packages/web/public/mame_state.json"), "utf-8"));
function hex(s: string): Uint8Array { const o=new Uint8Array(s.length/2); for (let i=0;i<o.length;i++)o[i]=parseInt(s.substr(i*2,2),16); return o; }
const warm = {
  workRam: hex(mame.workRam),
  playfieldRam: hex(mame.playfieldRam),
  spriteRam: hex(mame.spriteRam),
  alphaRam: hex(mame.alphaRam),
  colorRam: hex(mame.colorRam),
  // Match browser warmState construction exactly:
  videoScrollX: 0,
  videoScrollY: (((parseInt(mame.workRam.substr(4, 2), 16) << 8) | parseInt(mame.workRam.substr(6, 2), 16)) & 0x1ff),
};
console.log(`videoScrollX=${warm.videoScrollX} videoScrollY=${warm.videoScrollY}`);

const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

function r16(off: number) { return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off+1] ?? 0); }
function r32(off: number) { return (((s.workRam[off] ?? 0) << 24) | ((s.workRam[off+1] ?? 0) << 16) | ((s.workRam[off+2] ?? 0) << 8) | (s.workRam[off+3] ?? 0)) >>> 0; }
function hex8(n: number) { return n.toString(16).padStart(8, "0"); }
function hex4(n: number) { return n.toString(16).padStart(4, "0"); }

function snap(label: string) {
  const obj0_x = r32(0x18 + 0xc);
  const obj0_vx = r32(0x18 + 0x0);
  const r075a = r16(0x75a);
  const r390 = r16(0x390);
  const r392 = r16(0x392);
  const ptr_0446 = r32(0x446);
  const r3ee = s.workRam[0x3ee] ?? 0;
  const r3ea = r16(0x3ea);
  console.log(`[${label.padStart(7)}] r390=${r390} r392=${r392} r075a=${hex4(r075a)} r3ee=${r3ee} r3ea=${hex4(r3ea)} ptr=${hex8(ptr_0446)} obj0[x=${hex8(obj0_x)}, vx=${hex8(obj0_vx)}]`);
}

snap("warm");
let prev075a = r16(0x75a);
let prevPtr = r32(0x446);
let prevR3ea = r16(0x3ea);
for (let i = 1; i <= 200; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  const cur075a = r16(0x75a);
  const curPtr = r32(0x446);
  const curR3ea = r16(0x3ea);
  // Log every transition of r075a or ptr@0x446 or r3ea
  if (cur075a !== prev075a || curPtr !== prevPtr || curR3ea !== prevR3ea || i % 20 === 0 || i <= 3) {
    snap(`t=${i}`);
    prev075a = cur075a;
    prevPtr = curPtr;
    prevR3ea = curR3ea;
  }
}
