#!/usr/bin/env node
/**
 * visual-smoke-real.ts — diagnostic CLI che simula il path browser real-mode.
 *
 * Pipeline (mirror del web frontend con ROM caricata):
 *   1. Load program ROM (ghidra_project/marble_program.bin)
 *   2. Load PROMs (concat 136033.118 + 136033.119 = 1024 byte)
 *   3. decodeGraphicsLookups(proms) → playfield + motionObject lookups
 *   4. bootInit(state, rom, { preloadLevel: 0 })
 *   5. Per N tick: tick(state, { rom, runMainLoopBody: true })
 *   6. buildFrame(state, { playfieldLookups, motionObjectLookups, motionObjects })
 *   7. Dump diagnostico dettagliato
 *
 * Uso: npx tsx packages/cli/src/visual-smoke-real.ts [N=300]
 *
 * Diagnosi: identifica se il bottleneck è in playfieldRam, lookup tables,
 * scroll, palette, ecc. — utile prima di lanciare il browser.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  applySlapsticBank,
  state as stateNs,
  bus as busNs,
  bootInit,
  tick,
  render as renderNs,
} from "@marble-love/engine";

// ─── Inline copy of decodeGraphicsLookups (da packages/web/src/rom-graphics.ts) ─

interface GraphicsLookupEntry {
  offset: number;
  bank: number;
  color: number;
  bpp: 4 | 5 | 6;
}

const PROM1_OFFSET_MASK = 0x07;
const PROM1_BANK_1 = 0x10;
const PROM1_BANK_2 = 0x20;
const PROM1_BANK_3 = 0x40;
const PROM1_BANK_4 = 0x80;
const PROM2_PLANE_4_ENABLE = 0x40;
const PROM2_PLANE_5_ENABLE = 0x80;
const PROM2_BANK_5 = 0x20;
const PROM2_BANK_6_OR_7 = 0x10;
const PROM2_PF_COLOR_MASK = 0x0f;
const PROM2_BANK_7 = 0x08;
const PROM2_MO_COLOR_MASK = 0x07;

function bppForProm2(prom2: number): 4 | 5 | 6 {
  if ((prom2 & PROM2_PLANE_4_ENABLE) === 0) return 4;
  return (prom2 & PROM2_PLANE_5_ENABLE) !== 0 ? 6 : 5;
}

function bankForProms(prom1: number, prom2: number): number {
  if ((prom1 & PROM1_BANK_1) === 0) return 1;
  if ((prom1 & PROM1_BANK_2) === 0) return 2;
  if ((prom1 & PROM1_BANK_3) === 0) return 3;
  if ((prom1 & PROM1_BANK_4) === 0) return 4;
  if ((prom2 & PROM2_BANK_5) === 0) return 5;
  if ((prom2 & PROM2_BANK_6_OR_7) === 0) {
    return (prom2 & PROM2_BANK_7) === 0 ? 7 : 6;
  }
  return 0;
}

function decodeGraphicsLookups(proms: Uint8Array): {
  playfield: GraphicsLookupEntry[];
  motionObjects: GraphicsLookupEntry[];
} {
  const remap = proms.slice(0x000, 0x200);
  const color = proms.slice(0x200, 0x400);
  const playfield: GraphicsLookupEntry[] = [];
  const motionObjects: GraphicsLookupEntry[] = [];

  for (let table = 0; table < 2; table += 1) {
    for (let i = 0; i < 256; i += 1) {
      const promIndex = table * 256 + i;
      const prom1 = remap[promIndex] ?? 0xff;
      const prom2 = color[promIndex] ?? 0xff;
      const bpp = bppForProm2(prom2);
      let bank = bankForProms(prom1, prom2);
      let offset = prom1 & PROM1_OFFSET_MASK;
      let entryColor: number;

      if (table === 0) {
        entryColor = (~prom2 & PROM2_PF_COLOR_MASK) >>> (bpp - 4);
        if (bank === 0) {
          bank = 1;
          offset = 0;
          entryColor = 0;
        }
        playfield.push({ offset, bank, color: entryColor, bpp });
      } else {
        entryColor = (~prom2 & PROM2_MO_COLOR_MASK) >>> (bpp - 4);
        motionObjects.push({ offset, bank, color: entryColor, bpp });
      }
    }
  }

  return { playfield, motionObjects };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

interface CliArgs {
  ticks: number;
  ppmPath: string | undefined;
  seedPath: string | undefined;
  preserveDispatcher: boolean;
}

interface SeedJson {
  frame?: number;
  slapsticBank?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

interface ScenarioJson {
  snapshots?: SeedJson[];
}

function countNonZero(buf: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) count += 1;
  return count;
}

function parseArgs(): CliArgs {
  const raw = process.argv.slice(2);
  let ticks = 300;
  let ppmPath: string | undefined;
  let seedPath: string | undefined;
  let preserveDispatcher = false;
  const positional: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--seed") {
      seedPath = requireValue(raw[++i], "--seed");
    } else if (arg === "--ticks") {
      ticks = parseNonNegativeInt(raw[++i], "--ticks");
    } else if (arg === "--out" || arg === "--ppm") {
      ppmPath = requireValue(raw[++i], arg);
    } else if (arg === "--preserve-dispatcher") {
      preserveDispatcher = true;
    } else if (arg === "-h" || arg === "--help") {
      console.log(`visual-smoke-real - render a ROM-backed diagnostic frame

Usage:
  node --import tsx packages/cli/src/visual-smoke-real.ts [ticks] [out.ppm]
  node --import tsx packages/cli/src/visual-smoke-real.ts --seed seed.json --ticks 0 --out out.ppm

Options:
  --seed PATH              Load a flat seed JSON or scenario snapshot instead
                           of booting/preloading level 1
  --ticks N                Ticks to run after boot/warm load (default: 300)
  --out, --ppm PATH        Optional PPM dump path
  --preserve-dispatcher    Do not clear workRam[0x390] for --seed review
  -h, --help               Show this help
`);
      exit(0);
    } else {
      positional.push(arg);
    }
  }

  if (positional[0] !== undefined) ticks = parseNonNegativeInt(positional[0], "ticks");
  if (positional[1] !== undefined) ppmPath = positional[1];
  return { ticks, ppmPath, seedPath, preserveDispatcher };
}

function requireValue(raw: string | undefined, label: string): string {
  if (raw === undefined || raw === "") throw new Error(`${label} requires a value`);
  return raw;
}

function parseNonNegativeInt(raw: string | undefined, label: string): number {
  const value = Number(requireValue(raw, label));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function hexToBytes(hex: string, expectedLength: number, label: string): Uint8Array {
  if (hex.length !== expectedLength * 2) {
    throw new Error(`${label} has ${hex.length / 2} bytes, expected ${expectedLength}`);
  }
  const out = new Uint8Array(expectedLength);
  for (let i = 0; i < expectedLength; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function readWordBE(bytes: Uint8Array, off: number): number {
  return (((bytes[off] ?? 0) << 8) | (bytes[off + 1] ?? 0)) & 0xffff;
}

function readLongBE(bytes: Uint8Array, off: number): number {
  return (
    (((bytes[off] ?? 0) << 24) |
      ((bytes[off + 1] ?? 0) << 16) |
      ((bytes[off + 2] ?? 0) << 8) |
      (bytes[off + 3] ?? 0)) >>>
    0
  );
}

function signedLong(value: number): number {
  return value | 0;
}

function fixed16(bytes: Uint8Array, off: number): number {
  return signedLong(readLongBE(bytes, off)) / 65536;
}

function loadProms(): Uint8Array | null {
  const candidates: Array<[string, string]> = [
    ["/tmp/prom118.bin", "/tmp/prom119.bin"],
    ["roms/extracted/136033.118", "roms/extracted/136033.119"],
  ];
  for (const [a, b] of candidates) {
    if (existsSync(a) && existsSync(b)) {
      const proms = new Uint8Array(0x400);
      const p118 = readFileSync(a);
      const p119 = readFileSync(b);
      proms.set(p118.subarray(0, 0x200), 0);
      proms.set(p119.subarray(0, 0x200), 0x200);
      return proms;
    }
  }
  if (existsSync("roms/marble.zip")) {
    const proms = new Uint8Array(0x400);
    const p118 = execFileSync("unzip", ["-p", "roms/marble.zip", "136033.118"]);
    const p119 = execFileSync("unzip", ["-p", "roms/marble.zip", "136033.119"]);
    proms.set(p118.subarray(0, 0x200), 0);
    proms.set(p119.subarray(0, 0x200), 0x200);
    return proms;
  }
  return null;
}

function loadSeed(path: string): SeedJson {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8")) as ScenarioJson | SeedJson;
  if ("snapshots" in raw && Array.isArray(raw.snapshots)) {
    const seed = raw.snapshots[0];
    if (seed === undefined) throw new Error(`${path} has no snapshots`);
    return seed;
  }
  return raw as SeedJson;
}

function warmStateFromSeed(seed: SeedJson): NonNullable<NonNullable<Parameters<typeof bootInit>[2]>["warmState"]> {
  const workRam = hexToBytes(seed.workRam, 0x2000, "workRam");
  return {
    workRam,
    playfieldRam: hexToBytes(seed.playfieldRam, 0x2000, "playfieldRam"),
    spriteRam: hexToBytes(seed.spriteRam, 0x1000, "spriteRam"),
    alphaRam: hexToBytes(seed.alphaRam, 0x1000, "alphaRam"),
    colorRam: hexToBytes(seed.colorRam, 0x800, "colorRam"),
    videoScrollY: readWordBE(workRam, 0x02) & 0x1ff,
    videoScrollX: 0,
    slapsticBank: seed.slapsticBank ?? 1,
  };
}

function printPlayableState(prefix: string, workRam: Uint8Array, pfCount: number): void {
  const desc = readLongBE(workRam, 0x474);
  console.log(
    `${prefix} main/mode=${readWordBE(workRam, 0x390)}/${readWordBE(workRam, 0x392)}` +
      ` next=${readWordBE(workRam, 0x394)} desc=0x${desc.toString(16)}` +
      ` state=${workRam[0x18 + 0x1a] ?? 0} timer=${readWordBE(workRam, 0x18 + 0x6a)}` +
      ` xy=${fixed16(workRam, 0x18 + 0x0c).toFixed(2)},${fixed16(workRam, 0x18 + 0x10).toFixed(2)}` +
      ` z=${fixed16(workRam, 0x18 + 0x14).toFixed(2)} pf=${pfCount}`,
  );
}

// ─── PPM dumper ──────────────────────────────────────────────────────────
// Produces a 512×512 P6 PPM showing the full 64×64 playfield tile-map with
// sprites + alpha overlay. Colors are picked from the live palette via the
// tile's paletteIndex × 16 + 1 slot — this is *not* the true rendered tile
// (would require decoding the tile graphics ROM), but gives a per-tile color
// signature that's enough to eyeball the level layout and sprite positions.

function dumpFramePpm(
  frame: ReturnType<typeof renderNs.buildFrame>,
  outPath: string,
): void {
  const W = 512;
  const H = 512;
  const buf = new Uint8Array(W * H * 3);
  // Background: dark grey
  for (let i = 0; i < buf.length; i += 3) {
    buf[i] = 0x10; buf[i + 1] = 0x10; buf[i + 2] = 0x10;
  }

  function pickColor(palIdx: number): [number, number, number] {
    // 16 colors per palette in 4bpp; entry +1 skips transparent slot
    const base = palIdx * 16;
    for (let off = 1; off < 16; off++) {
      const e = frame.palette[base + off];
      if (e !== undefined && (e.rgba.r !== 0 || e.rgba.g !== 0 || e.rgba.b !== 0)) {
        return [e.rgba.r, e.rgba.g, e.rgba.b];
      }
    }
    return [0x40, 0x40, 0x40];
  }

  function fillBlock(px: number, py: number, sz: number, rgb: [number, number, number]): void {
    for (let dy = 0; dy < sz; dy++) {
      const y = py + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = 0; dx < sz; dx++) {
        const x = px + dx;
        if (x < 0 || x >= W) continue;
        const i = (y * W + x) * 3;
        buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
      }
    }
  }

  // 1. Playfield (background): 8×8 px per tile
  for (const t of frame.playfield) {
    if (t.tileIndex === 0) continue;
    const c = pickColor(t.paletteIndex);
    fillBlock(t.x, t.y, 8, c);
  }

  // 2. Alpha (HUD): 8×8 px, color = palette[paletteIdx*16+1] but typically pal=0..7
  // Alpha in System 1 uses dedicated palette base (0x000); we render it on top.
  for (const a of frame.alpha) {
    const c = pickColor(a.paletteIndex);
    // Outline + fill to make HUD pop visually
    fillBlock(a.x, a.y, 8, c);
  }

  // 3. Sprites (motion objects): bright red marker, 6×6 px centered
  for (const sp of frame.sprites) {
    fillBlock(sp.x + 1, sp.y + 1, 6, [0xff, 0x40, 0x40]);
  }

  // 4. Write PPM P6 header + raw RGB
  const header = `P6\n${W} ${H}\n255\n`;
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(headerBytes.length + buf.length);
  out.set(headerBytes, 0);
  out.set(buf, headerBytes.length);
  writeFileSync(outPath, out);
}

// ─── Main ────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();

  // 1. Load program ROM
  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob non trovata @ ${romPath}`);
    exit(1);
  }
  const romBuf = readFileSync(romPath);
  const rom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(rom, romBuf);

  // 2. Load PROMs
  const proms = loadProms();
  if (proms === null) {
    console.error(
      "error: PROMs non trovati. Estrai prima o aggiungi roms/marble.zip:\n" +
        "  unzip -p roms/marble.zip 136033.118 > /tmp/prom118.bin\n" +
        "  unzip -p roms/marble.zip 136033.119 > /tmp/prom119.bin",
    );
    exit(1);
  }

  // 3. decodeGraphicsLookups
  const { playfield: playfieldLookups, motionObjects: motionObjectLookups } =
    decodeGraphicsLookups(proms);

  console.log("=== ROM + PROMs caricati ===");
  console.log(`  program ROM: ${rom.program.length} byte`);
  console.log(`  proms: ${proms.length} byte`);
  console.log(`  playfield lookups: ${playfieldLookups.length} entries`);
  console.log(`  motionObject lookups: ${motionObjectLookups.length} entries`);

  // 4. Engine init
  const s = stateNs.emptyGameState();
  let seedNeutralP1X: number | undefined;
  let seedNeutralP1Y: number | undefined;
  if (args.seedPath !== undefined) {
    const seed = loadSeed(args.seedPath);
    bootInit(s, rom, { warmState: warmStateFromSeed(seed) });
    if (!args.preserveDispatcher) {
      s.workRam[0x390] = 0;
      s.workRam[0x391] = 0;
    }
    s.clock.mainLoopBodyTicks = 1 as typeof s.clock.mainLoopBodyTicks;
    seedNeutralP1X = s.workRam[0x18 + 0xc9] ?? 0xff;
    seedNeutralP1Y = s.workRam[0x18 + 0xc8] ?? 0xff;
    console.log(`\n=== warm seed loaded ===`);
    console.log(`  seed: ${resolve(args.seedPath)} frame=${seed.frame ?? "?"}`);
    printPlayableState("  seed state:", s.workRam, countNonZero(s.playfieldRam));
  } else {
    bootInit(s, rom, { preloadLevel: 0, fullScreenInit: true });
  }

  // 5. Run ticks
  console.log(`\n=== run ${args.ticks} tick (runMainLoopBody=true) ===`);
  for (let i = 0; i < args.ticks; i++) {
    if (seedNeutralP1X !== undefined && seedNeutralP1Y !== undefined) {
      tick(s, {
        rom,
        runMainLoopBody: true,
        p1X: seedNeutralP1X,
        p1Y: seedNeutralP1Y,
        p2X: 0xff,
        p2Y: 0xff,
        inputMmio: 0x6f,
      });
    } else {
      tick(s, { rom, runMainLoopBody: true });
    }
  }

  // 6. State diagnostics
  const pfNz = countNonZero(s.playfieldRam);
  const sprNz = countNonZero(s.spriteRam);
  const alpNz = countNonZero(s.alphaRam);
  const colNz = countNonZero(s.colorRam);
  const wkNz = countNonZero(s.workRam);
  console.log(`\n=== State RAM occupancy ===`);
  console.log(`  playfieldRam: ${pfNz}/${s.playfieldRam.length} non-zero`);
  console.log(`  spriteRam:    ${sprNz}/${s.spriteRam.length}`);
  console.log(`  alphaRam:     ${alpNz}/${s.alphaRam.length}`);
  console.log(`  colorRam:     ${colNz}/${s.colorRam.length}`);
  console.log(`  workRam:      ${wkNz}/${s.workRam.length}`);
  printPlayableState("  final state:", s.workRam, pfNz);

  // 7. buildFrame con tutti i lookup
  const opts: Parameters<typeof renderNs.buildFrame>[1] = {
    playfieldLookups,
    motionObjects: "linked-list",
    motionObjectLookups,
  };
  const frame = renderNs.buildFrame(s, opts);

  console.log(`\n=== Frame produced ===`);
  console.log(`  scroll: (${frame.scrollX}, ${frame.scrollY})`);
  console.log(`  palette entries: ${frame.palette.length}`);
  const nzPalette = frame.palette.filter(
    (p) => p.rgba.r !== 0 || p.rgba.g !== 0 || p.rgba.b !== 0,
  );
  console.log(`  palette non-zero: ${nzPalette.length}`);
  console.log(`  playfield tiles: ${frame.playfield.length}`);
  console.log(`  sprites: ${frame.sprites.length}`);
  console.log(`  alpha chars: ${frame.alpha.length}`);

  // 8. Sample tile/sprite/alpha
  if (frame.playfield.length > 0) {
    console.log(`\n  --- first 5 tiles ---`);
    for (const t of frame.playfield.slice(0, 5)) {
      console.log(
        `    tileIndex=${t.tileIndex.toString(16)} gfxBank=${t.gfxBank} bpp=${t.bitsPerPixel}` +
          ` x=${t.x} y=${t.y} pal=${t.paletteIndex} flipX=${t.flipX}`,
      );
    }
  } else {
    console.log(`\n  ⚠️  Frame.playfield vuoto (lookup miss?). Dump pf words:`);
    for (let i = 0; i < 16; i++) {
      const w = ((s.playfieldRam[i * 2] ?? 0) << 8) | (s.playfieldRam[i * 2 + 1] ?? 0);
      const lookupIdx = (w >>> 8) & 0x7f;
      const lookup = playfieldLookups[lookupIdx];
      console.log(
        `    pfRam[${i}].word=0x${w.toString(16).padStart(4, "0")}` +
          ` → lookup[${lookupIdx}]=` +
          (lookup ? `${JSON.stringify(lookup)}` : "undefined"),
      );
    }
  }

  if (frame.sprites.length > 0) {
    console.log(`\n  --- first 5 sprites ---`);
    for (const sp of frame.sprites.slice(0, 5)) {
      console.log(
        `    spriteIndex=${sp.spriteIndex} x=${sp.x} y=${sp.y}` +
          ` gfxBank=${sp.gfxBank ?? "?"} bpp=${sp.bitsPerPixel ?? "?"} pal=${sp.paletteIndex}`,
      );
    }
  }

  if (frame.alpha.length > 0) {
    console.log(`\n  --- first 10 alpha chars ---`);
    for (const a of frame.alpha.slice(0, 10)) {
      console.log(
        `    tileIndex=0x${a.tileIndex.toString(16)} x=${a.x} y=${a.y} pal=${a.paletteIndex}`,
      );
    }
  }

  // Tile non-zero analysis
  const nonZeroTiles = frame.playfield.filter((t) => t.tileIndex !== 0);
  console.log(`\n  --- tile content analysis ---`);
  console.log(`    total tiles: ${frame.playfield.length}`);
  console.log(`    tiles with tileIndex != 0: ${nonZeroTiles.length}`);
  if (nonZeroTiles.length > 0) {
    console.log(`    first 5 non-zero tiles:`);
    for (const t of nonZeroTiles.slice(0, 5)) {
      console.log(
        `      tileIndex=0x${t.tileIndex.toString(16)} bank=${t.gfxBank} x=${t.x} y=${t.y} pal=${t.paletteIndex}`,
      );
    }
  }

  // ASCII art map del playfield (40 col × 30 row = 320×240 viewport / 8x8 tile)
  console.log(`\n  --- ASCII map (60×30, '#'=tile != 0, '.'=tile 0, '@'=sprite) ---`);
  // Costruisci indice per posizione (X/8, Y/8)
  const tileMap = new Map<string, "#" | "@">();
  for (const t of frame.playfield) {
    if (t.tileIndex !== 0) {
      const cx = Math.floor(t.x / 8);
      const cy = Math.floor(t.y / 8);
      tileMap.set(`${cx},${cy}`, "#");
    }
  }
  for (const sp of frame.sprites) {
    const cx = Math.floor(sp.x / 8);
    const cy = Math.floor(sp.y / 8);
    tileMap.set(`${cx},${cy}`, "@");
  }
  const COLS = 60;
  const ROWS = 30;
  for (let y = 0; y < ROWS; y++) {
    let row = "    ";
    for (let x = 0; x < COLS; x++) {
      const cell = tileMap.get(`${x},${y}`);
      row += cell ?? ".";
    }
    console.log(row);
  }

  // HUD as decoded string
  if (frame.alpha.length > 0) {
    console.log(`\n  --- HUD as decoded string (sorted by y, x) ---`);
    const sorted = [...frame.alpha].sort((a, b) => a.y - b.y || a.x - b.x);
    let curY = -1;
    let line = "    ";
    for (const a of sorted) {
      if (a.y !== curY) {
        if (line.length > 4) console.log(line);
        line = `    y=${a.y.toString().padStart(3, " ")}: `;
        curY = a.y;
      }
      // Decoded: alpha tile index 0x20-0x7E = ASCII printable
      const ch = a.tileIndex >= 0x20 && a.tileIndex <= 0x7e
        ? String.fromCharCode(a.tileIndex)
        : `[${a.tileIndex.toString(16)}]`;
      line += ch;
    }
    if (line.length > 4) console.log(line);
  }

  // Diagnosi finale
  console.log(`\n=== Diagnosis ===`);
  if (frame.playfield.length === 0 && pfNz > 0) {
    console.log(`  ⚠️  playfieldRam popolata (${pfNz} byte) ma Frame.playfield=0.`);
    console.log(`      → Lookup miss: i word in pfRam decodano lookupIndex non in tabella.`);
  } else if (frame.playfield.length > 0) {
    console.log(`  ✅ Frame.playfield popolato: ${frame.playfield.length} tile.`);
  } else {
    console.log(`  ❌ playfieldRam vuota AND Frame.playfield=0.`);
  }

  if (frame.sprites.length === 0 && sprNz > 0) {
    console.log(`  ⚠️  spriteRam popolata (${sprNz} byte) ma Frame.sprites=0.`);
  } else if (frame.sprites.length > 0) {
    console.log(`  ✅ Frame.sprites popolato: ${frame.sprites.length}.`);
  }

  if (frame.alpha.length === 0 && alpNz > 0) {
    console.log(`  ⚠️  alphaRam popolata (${alpNz} byte) ma Frame.alpha=0.`);
  } else if (frame.alpha.length > 0) {
    console.log(`  ✅ Frame.alpha popolato: ${frame.alpha.length}.`);
  }

  // Optional PPM dump
  if (args.ppmPath !== undefined) {
    const out = resolve(args.ppmPath);
    dumpFramePpm(frame, out);
    console.log(`\n  PPM dump -> ${out} (512x512, P6 binary)`);
  }
}

main();
