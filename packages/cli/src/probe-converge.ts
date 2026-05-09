import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));

const mame = JSON.parse(readFileSync(resolve("packages/web/public/mame_state.json"), "utf-8"));
function hex(s: string): Uint8Array { const o=new Uint8Array(s.length/2); for (let i=0;i<o.length;i++)o[i]=parseInt(s.substr(i*2,2),16); return o; }
const mameWork = hex(mame.workRam);
const mamePf = hex(mame.playfieldRam);
const mameSpr = hex(mame.spriteRam);
const mameAlpha = hex(mame.alphaRam);
const mameColor = hex(mame.colorRam);

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) {
    c ^= x;
    for (let i = 0; i < 8; i++) c = (c & 1) ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function matchPct(a: Uint8Array, b: Uint8Array): { match: number; total: number; pct: number } {
  let m = 0, t = Math.min(a.length, b.length);
  for (let i = 0; i < t; i++) if (a[i] === b[i]) m++;
  return { match: m, total: t, pct: Math.round(m * 100 / t) };
}

function check(label: string, ticks: number, opts: any = {}) {
  const s = stateNs.emptyGameState();
  bootInit(s, rom, opts.boot ?? {});
  for (let i = 0; i < ticks; i++) tick(s, { rom, ...(opts.tick ?? {}) });
  const w = matchPct(s.workRam, mameWork);
  const p = matchPct(s.playfieldRam, mamePf);
  const sp = matchPct(s.spriteRam, mameSpr);
  const a = matchPct(s.alphaRam, mameAlpha);
  const c = matchPct(s.colorRam, mameColor);
  console.log(`\n=== ${label} (ticks=${ticks}) ===`);
  console.log(`  workRam:     ${w.match}/${w.total} = ${w.pct}%`);
  console.log(`  playfieldRam: ${p.match}/${p.total} = ${p.pct}%`);
  console.log(`  spriteRam:   ${sp.match}/${sp.total} = ${sp.pct}%`);
  console.log(`  alphaRam:    ${a.match}/${a.total} = ${a.pct}%`);
  console.log(`  colorRam:    ${c.match}/${c.total} = ${c.pct}%`);
  // CRC32
  const wcrc = crc32(s.workRam) === crc32(mameWork);
  const ccrc = crc32(s.colorRam) === crc32(mameColor);
  console.log(`  CRC32 match: workRam=${wcrc} colorRam=${ccrc}`);
}

// Test diverse configurazioni
check("BASELINE: bootInit() + tick(0)", 0);
check("bootInit() + tick(2400)", 2400, { tick: { runMainLoopBody: true } });
check("bootInit({preloadLevel:0}) + tick(2400)", 2400, { boot: { preloadLevel: 0 }, tick: { runMainLoopBody: true } });
check("bootInit({preloadLevel:0, fullScreenInit:true}) + tick(2400)", 2400, { boot: { preloadLevel: 0, fullScreenInit: true }, tick: { runMainLoopBody: true } });
