// Probe: log frame, mailbox, cpuTicks, mainLoopBodyTicks, didBody per ogni tick
// in TS warm-state f12000. Confronta col pattern atteso MAME (body @ f12001,
// 12003, 12005, 12007, 12008, 12009, 12011, ...). Diagnosi cadenza 30/60Hz.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, wrap } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));

const groundTruth = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
  frames: number[];
  snapshots: { frame: number; workRam: string; spriteRam: string; playfieldRam: string; alphaRam: string; colorRam: string }[];
};

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const frame0 = groundTruth.snapshots[0]!;
const warm = {
  workRam: hex2bytes(frame0.workRam, 0x2000),
  playfieldRam: hex2bytes(frame0.playfieldRam, 0x2000),
  spriteRam: hex2bytes(frame0.spriteRam, 0x1000),
  alphaRam: hex2bytes(frame0.alphaRam, 0x1000),
  colorRam: hex2bytes(frame0.colorRam, 0x800),
  videoScrollX: 0,
  videoScrollY: 0,
};

const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

const baseFrame = groundTruth.frames[0]!;

console.log("tick frame    mailbox cpuTicks  bodyTicks didBody");
let didBodyCount = 0;
const bodyFrames: number[] = [];
const lastIdx = Math.min(99, groundTruth.snapshots.length - 1);
let prevBodyTicks = wrap.raw(s.clock.mainLoopBodyTicks);
for (let i = 1; i <= lastIdx; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  const newBodyTicks = wrap.raw(s.clock.mainLoopBodyTicks);
  const cpuT = wrap.raw(s.clock.cpuTicks);
  const mb = s.workRam[0x16] ?? 0;
  // didBody: il body ha girato se mainLoopBodyTicks è andato EVEN (post-inc),
  // o ha mantenuto valore EVEN dopo rollback (mailbox set).
  // Equivalente: newBodyTicks era pari quando abbiamo deciso il path.
  // Caso semplice: newBodyTicks PARI → body è stato eseguito (regular o extra).
  //                newBodyTicks DISPARI → era wait.
  const didBody = (newBodyTicks & 1) === 0;
  if (didBody) {
    didBodyCount++;
    bodyFrames.push(baseFrame + i);
  }
  console.log(
    `${i.toString().padStart(3)} f${baseFrame + i}  ${mb}      ${cpuT.toString().padStart(7)}  ${newBodyTicks.toString().padStart(4)}     ${didBody ? "Y" : " "}`,
  );
  prevBodyTicks = newBodyTicks;
}
void prevBodyTicks;

console.log(`\nTotal body runs in ${lastIdx} ticks: ${didBodyCount}`);
console.log(`Body frames: ${bodyFrames.join(", ")}`);
console.log(`Expected MAME pattern (first body @ f12001, then alternating, plus extras at slow frames)`);
