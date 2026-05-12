import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs } from "@marble-love/engine";
import { sub1CABATileRedraw } from "../../engine/src/sub-1caba-tile-redraw.js";

interface CallTrace {
  frame: number;
  tileX: string;
  tileY: string;
  lvlPtr: string;
  bsearchPtr: string;
  struct_pre: string;
  struct_post: string;
  colBase?: string;
  bsearchAlt?: string;
}

interface Trace {
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  calls: CallTrace[];
}

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len && i * 2 + 1 < hex.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

const trace = JSON.parse(readFileSync("/tmp/mame_1caba_capture.json", "utf-8")) as Trace;
const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));

const baseWorkRam = hex2bytes(trace.workRam, 0x2000);
const basePlayfield = hex2bytes(trace.playfieldRam, 0x2000);
const baseSpriteRam = hex2bytes(trace.spriteRam, 0x1000);

// Iterate over a few "interesting" calls (with struct changes)
const interestingCallIdx = [0, 14, 17, 20, 26, 30, 45, 47, 51];
for (const idx of interestingCallIdx) {
  const c = trace.calls[idx];
  if (!c) continue;
  const s = stateNs.emptyGameState();
  s.workRam.set(baseWorkRam);
  s.playfieldRam.set(basePlayfield);
  s.spriteRam.set(baseSpriteRam);

  function w16(buf: Uint8Array, off: number, v: number): void {
    buf[off] = (v >>> 8) & 0xff;
    buf[off + 1] = v & 0xff;
  }
  function w32(buf: Uint8Array, off: number, v: number): void {
    buf[off] = (v >>> 24) & 0xff;
    buf[off + 1] = (v >>> 16) & 0xff;
    buf[off + 2] = (v >>> 8) & 0xff;
    buf[off + 3] = v & 0xff;
  }

  w16(s.workRam, 0x696, parseInt(c.tileX, 16));
  w16(s.workRam, 0x698, parseInt(c.tileY, 16));
  w32(s.workRam, 0x474, parseInt(c.lvlPtr, 16));
  w32(s.workRam, 0x65a, parseInt(c.bsearchPtr, 16));
  s.workRam.set(hex2bytes(c.struct_pre, 32), 0x1c28);
  if (c.colBase) s.workRam.set(hex2bytes(c.colBase, 0x200), 0x478);
  if (c.bsearchAlt) s.workRam.set(hex2bytes(c.bsearchAlt, 0x200), 0x76e);

  sub1CABATileRedraw(s, rom);
  const tsHex = Array.from(s.workRam.subarray(0x1c28, 0x1c48))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  const match = tsHex === c.struct_post;
  console.log(`call ${idx} (f=${c.frame}): pre=${c.struct_pre.slice(0, 16)} post[MAME]=${c.struct_post.slice(0, 16)} post[TS]=${tsHex.slice(0, 16)} ${match ? "MATCH" : "MISMATCH"} ${c.colBase ? "(with colBase/bsearchAlt)" : "(STALE workRam)"}`);
}
