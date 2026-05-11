// probe-0700-token-trace.ts — esegue una versione INSTRUMENTATA del decoder
// FUN_1A668 con gli stessi args che MAME usa al primo body (f12002), e dumpa:
//   - per ogni iter: token14, path A/B/C/D/E, d4_pre, d6_pre, d6_post,
//     d3, d2_pre, ext bytes consumati, output words emesse
//   - tutti gli stream content read (a3 long, a1 byte)
//
// Args derivati dal MAME tap (mame_decoder_stream_tap.lua):
//   outAbs   = 0x400706
//   ctrlAbs  = 0x080650
//   extAbs   = 0x02BE18
//
// L'engine TS dovrebbe calcolarli IDENTICI a MAME se refreshHelper13EE6
// pre-decoder logic e' bit-perfect. Verifichiamo prima questo.
//
// Output: /tmp/ts_decoder_stream.json (formato congruo con mame_decoder_stream.json)

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit } from "@marble-love/engine";

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

// Args che vogliamo usare (= valori MAME al body#1):
const ARG_OUT  = 0x400706;
const ARG_CTRL = 0x080650;
const ARG_EXT  = 0x02BE18;

// ─── Decoder instrumentato (copia 1:1 di decodeBitstream1A668 con trace) ─────

const WORK_RAM_BASE = 0x400000;
const WORK_RAM_END  = 0x402000;
const ROM_END       = 0x88000;
const OUTPUT_LEN_BYTES = 0x48;
const ROM_TABLE1_OFF = 0x2499a;
const ROM_TABLE2_OFF = 0x249da;
const BIT13_MASK = 0x2000;
const TOKEN14_MASK = 0x3fff;
const PATHGROUP_MASK = 0x1c00;
const PATH_C_VAL = 0x1c00;
const PATH_D_MAX = 0x1000;
const BIT10_MASK = 0x400;
const PATH_E_BASE_HIGH = 0x4d;
const PATH_E_BASE_LOW = 0x4e;

interface IterTrace {
  iter: number;
  d0_long: number;
  d4_pre: number;
  token14: number;
  d2_pre: number;
  d3_pre: number;
  d6_pre: number;
  path: string;
  cache_reloaded: boolean;
  d6_post: number;
  outputs: { addr: number; word: number }[];
  d4_post: number;
  a3_post: number;
  a1_post: number;
}

const reads: { pc: string; addr: number; value: number; mask: number; kind: string }[] = [];
const iters: IterTrace[] = [];

function r8(abs: number): number {
  const a = abs >>> 0;
  if (a < ROM_END) return (rom.program[a] ?? 0) & 0xff;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return (s.workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
  return 0;
}
function r16(abs: number): number {
  return ((r8(abs) << 8) | r8(abs + 1)) & 0xffff;
}
function r32(abs: number): number {
  return ((r8(abs) << 24) | (r8(abs + 1) << 16) | (r8(abs + 2) << 8) | r8(abs + 3)) >>> 0;
}
function w16(abs: number, v: number): void {
  const a = abs >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    s.workRam[a - WORK_RAM_BASE] = (v >>> 8) & 0xff;
    s.workRam[a + 1 - WORK_RAM_BASE] = v & 0xff;
  }
}
function asrL32(v: number, n: number): number {
  return ((v | 0) >> (n & 31)) | 0;
}

function runDecoder(outAbs: number, ctrlAbs: number, extAbs: number): void {
  let a2 = outAbs >>> 0;
  let a3 = ctrlAbs >>> 0;
  let a1 = extAbs >>> 0;
  const a4 = (outAbs + OUTPUT_LEN_BYTES) >>> 0;
  let d2 = 0, d3 = 0, d4 = 0, d5 = 0, d6 = 0;
  let iterIdx = 0;

  const maybeReload = (): boolean => {
    if ((d2 & 0xff) === 0) {
      const v1 = r8(a1);
      reads.push({ pc: "1a6a8/d8/fe/3a/6a", addr: a1, value: v1, mask: 0xff, kind: "ext_count" });
      d2 = v1;
      a1 = (a1 + 1) >>> 0;
      const v2 = r8(a1);
      reads.push({ pc: "1a6aa/da/00/3c/6c", addr: a1, value: v2, mask: 0xff, kind: "ext_value" });
      a1 = (a1 + 1) >>> 0;
      d3 = (v2 << 8) & 0xffff;
      d2 = (d2 - 1) & 0xff;
      return true;
    }
    d2 = (d2 - 1) & 0xff;
    return false;
  };

  let safety = 100;
  while (safety-- > 0) {
    if ((a2 >>> 0) >= a4) break;

    const d4Pre = d4;
    const d2Pre = d2;
    const d3Pre = d3;
    const d6Pre = d6;

    const d0 = r32(a3);
    reads.push({ pc: "0x01a690", addr: a3, value: d0, mask: 0xffffffff, kind: "ctrl_long" });

    const d1Shift = (0x12 - (d4 & 0xff)) & 0xff;
    const shifted = asrL32(d0 | 0, d1Shift) | 0;
    d5 = shifted & 0xffff;
    d5 = d5 & TOKEN14_MASK;
    const token14 = d5;
    const wasBit13 = (d5 & BIT13_MASK) !== 0;
    d5 = d5 & ~BIT13_MASK & 0xffff;

    let path = "";
    const outputs: { addr: number; word: number }[] = [];
    let cacheReloaded = false;

    if (wasBit13) {
      path = "A";
      cacheReloaded = maybeReload();
      const oldD5 = d5;
      const oldLsb = oldD5 & 1;
      d5 = (oldD5 >>> 1) & 0xffff;
      if (oldLsb !== 0) d6 = d5 & 0xffff;
      const out = (d5 + (d3 & 0xffff)) & 0xffff;
      outputs.push({ addr: a2, word: out });
      w16(a2, out);
      a2 = (a2 + 2) >>> 0;
      d4 = (d4 + 0xe) | 0;
    } else {
      const d1 = d5 & PATHGROUP_MASK;
      if (d1 === 0) {
        path = "B";
        let cnt = ((d5 >>> 7) & 0x7) | 0;
        do {
          const rel = maybeReload();
          if (rel) cacheReloaded = true;
          d6 = (d6 + 1) & 0xffff;
          const out = (d6 + (d3 & 0xffff)) & 0xffff;
          outputs.push({ addr: a2, word: out });
          w16(a2, out);
          a2 = (a2 + 2) >>> 0;
          cnt = (cnt - 1) | 0;
        } while (cnt >= 0);
        d4 = (d4 + 0x7) | 0;
      } else if (d1 === PATH_C_VAL) {
        path = "C";
        cacheReloaded = maybeReload();
        const idx = ((d5 >>> 4) & 0x3e) | 0;
        const tw = r16(ROM_TABLE1_OFF + idx);
        reads.push({ pc: "0x01a70c", addr: ROM_TABLE1_OFF + idx, value: tw, mask: 0xffff, kind: "table1" });
        const out = (tw + (d3 & 0xffff)) & 0xffff;
        outputs.push({ addr: a2, word: out });
        w16(a2, out);
        a2 = (a2 + 2) >>> 0;
        d4 = (d4 + 0x9) | 0;
      } else if (d1 <= PATH_D_MAX) {
        path = "D";
        let cnt = ((d5 >>> 7) & 0x7) | 0;
        const idx = ((d5 >>> 9) & 0xe) | 0;
        const tw = r16(ROM_TABLE2_OFF + idx);
        reads.push({ pc: "0x01a732", addr: ROM_TABLE2_OFF + idx, value: tw, mask: 0xffff, kind: "table2" });
        d5 = tw & 0xffff;
        do {
          const rel = maybeReload();
          if (rel) cacheReloaded = true;
          const out = (d5 + (d3 & 0xffff)) & 0xffff;
          outputs.push({ addr: a2, word: out });
          w16(a2, out);
          a2 = (a2 + 2) >>> 0;
          cnt = (cnt - 1) | 0;
        } while (cnt >= 0);
        d4 = (d4 + 0x7) | 0;
      } else {
        path = "E";
        const d1Save = d5 & 0xffff;
        let base = PATH_E_BASE_HIGH;
        if ((d1Save & BIT10_MASK) === 0) base = PATH_E_BASE_LOW;
        d5 = base & 0xffff;
        let cnt = ((d1Save >>> 7) & 0x7) | 0;
        do {
          const rel = maybeReload();
          if (rel) cacheReloaded = true;
          const out = (d5 + (d3 & 0xffff)) & 0xffff;
          outputs.push({ addr: a2, word: out });
          w16(a2, out);
          a2 = (a2 + 2) >>> 0;
          d5 = (d5 ^ 0x3) & 0xffff;
          cnt = (cnt - 1) | 0;
        } while (cnt >= 0);
        d4 = (d4 + 0x7) | 0;
      }
    }

    const wasBit4 = (d4 & 0x10) !== 0;
    d4 = d4 & ~0x10;
    if (wasBit4) a3 = (a3 + 2) >>> 0;

    iters.push({
      iter: iterIdx++,
      d0_long: d0,
      d4_pre: d4Pre,
      token14,
      d2_pre: d2Pre,
      d3_pre: d3Pre,
      d6_pre: d6Pre,
      path,
      cache_reloaded: cacheReloaded,
      d6_post: d6,
      outputs,
      d4_post: d4,
      a3_post: a3,
      a1_post: a1,
    });

    if ((a2 >>> 0) >= a4) break;
  }
}

// ─── Driver: warm state @ f12000, run 5 tick, intercetta primo body decoder ────
// In realta' eseguiamo solo il decoder con args fissi MAME.

runDecoder(ARG_OUT, ARG_CTRL, ARG_EXT);

// ─── Output ───────────────────────────────────────────────────────────────────

console.log(`Iters: ${iters.length}`);
console.log(`Total reads: ${reads.length}`);

// Verify ctrl stream content @ 0x80650 matches MAME (0x5747 8825 938D 0492 ...)
console.log("\n=== ctrl stream content TS reads (first 12 bytes) ===");
let h = "";
for (let i = 0; i < 12; i++) h += r8(ARG_CTRL + i).toString(16).padStart(2, "0");
console.log(`  TS: ${h}`);

// Print iters
console.log("\n=== Iter trace ===");
for (const it of iters) {
  const outs = it.outputs.map(o => `0x${o.word.toString(16).padStart(4, "0")}`).join(",");
  console.log(`  iter=${it.iter.toString().padStart(2)} d4=${it.d4_pre.toString().padStart(2)} d0=0x${it.d0_long.toString(16).padStart(8, "0")} tok=0x${it.token14.toString(16).padStart(4, "0")} path=${it.path} d6=${it.d6_pre.toString(16)}→${it.d6_post.toString(16)} d3=0x${(it.d3_pre & 0xffff).toString(16).padStart(4, "0")} d2pre=${it.d2_pre} ${it.cache_reloaded ? "RELOAD" : ""} out=[${outs}]`);
}

// Build output buffer from final workRam
console.log("\n=== Final output buffer 0x400706..0x40074D (36 words) ===");
const tsOut: number[] = [];
for (let i = 0; i < 36; i++) {
  const w = r16(0x400706 + i * 2);
  tsOut.push(w);
}
for (let i = 0; i < 36; i++) {
  console.log(`  word[${i.toString().padStart(2)}] = 0x${tsOut[i]!.toString(16).padStart(4, "0")}`);
}

// Compare with MAME
const mameOut = [
  0x004d, 0x004e, 0x004d, 0x004e, 0x0478, 0x0479, 0x047a, 0x047b,
  0x004d, 0x004e, 0x004d, 0x004e, 0x004d, 0x038d, 0x047c, 0x047d,
  0x047e, 0x047f, 0x0480, 0x025d, 0x0152, 0x0151, 0x01b0, 0x0481,
  0x01bc, 0x004e, 0x0478, 0x0479, 0x047a, 0x047b, 0x004d, 0x004e,
  0x004d, 0x004e, 0x004d, 0x004e,
];

console.log("\n=== Diff TS vs MAME ===");
let diffs = 0;
for (let i = 0; i < 36; i++) {
  if (tsOut[i] !== mameOut[i]) {
    console.log(`  word[${i.toString().padStart(2)}]: TS=0x${tsOut[i]!.toString(16).padStart(4, "0")} MAME=0x${mameOut[i]!.toString(16).padStart(4, "0")}`);
    diffs++;
  }
}
console.log(`\nTotal diffs: ${diffs}/36`);

writeFileSync(
  "/tmp/ts_decoder_stream.json",
  JSON.stringify({
    args: { outAbs: ARG_OUT, ctrlAbs: ARG_CTRL, extAbs: ARG_EXT },
    iters,
    reads,
    ts_output: tsOut.map(w => "0x" + w.toString(16).padStart(4, "0")),
    mame_output: mameOut.map(w => "0x" + w.toString(16).padStart(4, "0")),
    diffs,
  }, null, 2),
);
console.log("\nOutput: /tmp/ts_decoder_stream.json");
