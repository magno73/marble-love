import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));
const mame = JSON.parse(readFileSync(resolve("packages/web/public/mame_state.json"), "utf-8"));
function hex(s: string): Uint8Array { const o=new Uint8Array(s.length/2); for (let i=0;i<o.length;i++)o[i]=parseInt(s.substr(i*2,2),16); return o; }
const mamePf = hex(mame.playfieldRam);

const s = stateNs.emptyGameState();
bootInit(s, rom, { preloadLevel: 0 });
for (let i = 0; i < 2400; i++) tick(s, { rom, runMainLoopBody: true });

// For each 256 byte chunk, counts how many byte non match
console.log("=== playfieldRam diff per 256-byte regions ===");
for (let r = 0; r < 32; r++) {
  let mismatch = 0;
  for (let i = 0; i < 256; i++) {
    const off = r * 256 + i;
    if (s.playfieldRam[off] !== mamePf[off]) mismatch++;
  }
  if (mismatch > 0) {
    const pct = Math.round((256 - mismatch) * 100 / 256);
    console.log(`  region 0x${(r*256).toString(16).padStart(4,"0")}-0x${(r*256+255).toString(16).padStart(4,"0")}: ${mismatch} mismatch (${pct}% match)`);
  }
}

// Quantthe bytes non zero in MAME but zero in TS (= MAME ha tile, TS non)
let mameOnly = 0, tsOnly = 0, both = 0;
for (let i = 0; i < 8192; i++) {
  const m = mamePf[i] !== 0, t = s.playfieldRam[i] !== 0;
  if (m && !t) mameOnly++;
  else if (!m && t) tsOnly++;
  else if (m && t) both++;
}
console.log(`\n=== Tile content comparison ===`);
console.log(`  byte != 0: MAME=${mameOnly+both} TS=${tsOnly+both}`);
console.log(`  MAME has, TS doesn't: ${mameOnly}`);
console.log(`  TS has, MAME doesn't: ${tsOnly}`);
console.log(`  Both have something: ${both}`);
