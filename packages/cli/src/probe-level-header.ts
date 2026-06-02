/**
 * probe-level-header.ts - dumps the six real level descriptor headers with
 * decoded fields.
 *
 * Scope: level header decoding evidence for `docs/level-header-format.md`.
 * "probe CLI". It can be run in two modes:
 *
 *   - With ROM blob at the canonical path:
 *       `npx tsx packages/cli/src/probe-level-header.ts`
 *   - With ROM blob via env var:
 *       `MARBLE_LOVE_ROM_BLOB=path/to/marble_program.bin npx tsx ...`
 *
 * If the ROM is unavailable, exits with code 2 and a clear message.
 *
 * Output:
 *   - One table per level with all decoded fields from
 *     `docs/level-header-format.md`.
 *   - Heuristics for records (count, slope distribution).
 *   - Hex dump of the fixed header (0x2E bytes) for visual audit.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bus as busNs, level as levelNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";

type LevelData = ReturnType<typeof levelNs.loadLevel>;

const LEVEL_NAMES = [
  "Practice",
  "Beginner",
  "Intermediate",
  "Aerial",
  "Silly",
  "Ultimate",
] as const;

function findRomBlob(): string | null {
  const candidates = [
    process.env["MARBLE_LOVE_ROM_BLOB"],
    resolve(process.cwd(), "ghidra_project/marble_program.bin"),
    resolve(process.cwd(), "../../ghidra_project/marble_program.bin"),
  ].filter((x): x is string => typeof x === "string");
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadRomFromBlob(path: string): RomImage {
  const program = readFileSync(path);
  const rom = busNs.emptyRomImage();
  rom.program.set(program.subarray(0, rom.program.length));
  return rom;
}

function hex(value: number, width: number): string {
  return "0x" + value.toString(16).padStart(width, "0").toUpperCase();
}

function dumpHexLine(bytes: Uint8Array, offset: number, length: number): string {
  const parts: string[] = [];
  for (let i = 0; i < length; i++) {
    parts.push((bytes[offset + i] ?? 0).toString(16).padStart(2, "0").toUpperCase());
  }
  return parts.join(" ");
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)) & 0xffff;
}

function terrainCodeSummary(rom: RomImage, level: LevelData): string {
  const counts = new Map<string, number>();
  const total = Math.max(0, level.header.binsearchEndIndex);
  for (let i = 0; i < total; i++) {
    const code = readU16BE(rom.program, level.header.binsearchBasePtr + i * 2);
    const kind = levelNs.decodeTerrainCode(code).kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return ["empty", "direct", "indirect", "quad", "flat"]
    .map((kind) => `${kind}=${counts.get(kind) ?? 0}`)
    .join(" ");
}

function printLevel(level: LevelData, rom: RomImage): void {
  const name = LEVEL_NAMES[level.index] ?? `Level${level.index}`;
  const p = level.postHeader;
  console.log("");
  console.log("====================================================");
  console.log(`Level ${level.index} — ${name}`);
  console.log("====================================================");
  console.log(`  ROM offset:        ${hex(level.romOffset, 6)}`);
  console.log(`  Block size:        ${level.byteSize} bytes`);
  console.log(`  Legacy chunks /8:  ${level.records.length}`);
  console.log("");
  console.log("  Decoded header (0x00..0x2D):");
  console.log(`    +0x00  directTerrainPtr:   ${hex(level.header.directTerrainPtr, 8)}`);
  console.log(`    +0x04  tileWordTablePtr:   ${hex(level.header.tileWordTablePtr, 8)}`);
  console.log(`    +0x08  rowBuildBitListPtr: ${hex(level.header.rowBuildBitListPtr, 8)}`);
  console.log(`    +0x0C  rleSourcePtr:       ${hex(level.header.rleSourcePtr, 8)}`);
  console.log(`    +0x10  yScrollBase:        ${level.header.yScrollBase} (${hex(level.header.yScrollBase & 0xffff, 4)})`);
  console.log(`    +0x12  yScrollRange:       ${level.header.yScrollRange} (${hex(level.header.yScrollRange & 0xffff, 4)})`);
  console.log(`    +0x14  entityInitPos[0]:   ${hex(level.header.entityInitPositions[0] ?? 0, 4)}`);
  console.log(`    +0x16  entityInitPos[1]:   ${hex(level.header.entityInitPositions[1] ?? 0, 4)}`);
  console.log(`    +0x18  maxTileBound:       ${level.header.maxTileBound} (= entityInitPos[2] = ${hex(level.header.entityInitPositions[2] ?? 0, 4)})`);
  console.log(`    +0x1A  rowBuildEntryCount: ${level.header.rowBuildEntryCount} (= entityInitPos[3] overlap ${hex(level.header.entityInitPositions[3] ?? 0, 4)})`);
  console.log(`    +0x1C  tileLineDescPtr:    ${hex(level.header.tileLineDescriptorPtr, 8)} (= entityInitPos[4..5] overlap)`);
  console.log(`    +0x20  subPatternTablePtr: ${hex(level.header.subPatternTablePtr, 8)}`);
  console.log(`    +0x24  binsearchEndIndex:  ${level.header.binsearchEndIndex} (${hex(level.header.binsearchEndIndex & 0xffff, 4)})`);
  console.log(`    +0x26  binsearchBasePtr:   ${hex(level.header.binsearchBasePtr, 8)}`);
  console.log(`    +0x2A  extByteTablePtr:    ${hex(level.header.extByteTablePtr, 8)}`);
  console.log("");
  console.log("  Decoded post-header/body:");
  console.log(`    row pointer table:   ${hex(p.terrainRowPointers.startPtr, 6)}..${hex(p.terrainRowPointers.endPtr, 6)} entries=${p.terrainRowPointers.entries.length} term=${hex(p.terrainRowPointers.terminator, 4)}`);
  console.log(`    sub-pattern table:   ${hex(p.subPatternPointers.startPtr, 6)}..${hex(p.subPatternPointers.endPtr, 6)} entries=${p.subPatternPointers.entries.length}`);
  console.log(`    tile descriptors:    ${hex(p.tileLineDescriptors.startPtr, 6)} decoded=${p.tileLineDescriptors.decodedCount} physical=${p.tileLineDescriptors.physicalCount} unusedTailBytes=${p.tileLineDescriptors.unusedTailBytes}`);
  console.log(`    row-build script:    ${hex(p.rowBuildScript.startPtr, 6)}..${hex(p.rowBuildScript.endPtr, 6)} chunks=${p.rowBuildScript.chunks.length} patches=${p.rowBuildScript.chunks.reduce((sum, c) => sum + c.patches.length, 0)}`);
  console.log(`    RLE row offsets:     ${hex(p.rleRuns.startPtr, 6)}..${hex(p.rleRuns.endPtr, 6)} runs=${p.rleRuns.runs.length} expandedWords=${p.rleRuns.expandedWordCount}`);
  console.log(`    terrain code table:  ${terrainCodeSummary(rom, level)}`);
  console.log("");
  console.log("  Raw hex dump (0x2E byte fixed header):");
  for (let row = 0; row < levelNs.LEVEL_HEADER_SIZE; row += 16) {
    const length = Math.min(16, levelNs.LEVEL_HEADER_SIZE - row);
    console.log(`    +${hex(row, 2).slice(2)}  ${dumpHexLine(level.header.raw, row, length)}`);
  }

  // Heuristics on records
  if (level.records.length > 0) {
    const slopeOrientCounts = new Map<number, number>();
    let nonZeroRecords = 0;
    for (const r of level.records) {
      slopeOrientCounts.set(
        r.slopeOrient,
        (slopeOrientCounts.get(r.slopeOrient) ?? 0) + 1,
      );
      if (r.word0 + r.word1 + r.word2 + r.word3 > 0) nonZeroRecords++;
    }
    console.log("");
    console.log("  Legacy /8 chunk heuristics (not geometry proof):");
    console.log(`    Total chunks:      ${level.records.length}`);
    console.log(`    Non-zero chunks:   ${nonZeroRecords}`);
    console.log(`    slopeOrient distribution:`);
    const sortedOrients = Array.from(slopeOrientCounts.keys()).sort((a, b) => a - b);
    for (const orient of sortedOrients) {
      console.log(`      ${hex(orient, 1)}: ${slopeOrientCounts.get(orient)}`);
    }
  }
}

function main(): number {
  const romPath = findRomBlob();
  if (romPath === null) {
    console.error("[probe-level-header] ROM blob not found.");
    console.error("  Tried:");
    console.error("    - env MARBLE_LOVE_ROM_BLOB");
    console.error("    - ./ghidra_project/marble_program.bin");
    console.error("    - ../../ghidra_project/marble_program.bin");
    console.error("");
    console.error("Generate the blob with `tools/rom_prep.py` from your own MAME ROM dump");
    console.error("(roms/marble.zip + roms/atarisy1.zip).");
    return 2;
  }

  console.log(`[probe-level-header] Loaded ROM blob from: ${romPath}`);
  const rom = loadRomFromBlob(romPath);

  console.log("");
  console.log(`Level header size: ${levelNs.LEVEL_HEADER_SIZE} (0x${levelNs.LEVEL_HEADER_SIZE.toString(16).toUpperCase()})`);
  console.log(`Legacy /8 chunk stride: ${levelNs.HEIGHT_RECORD_SIZE}`);
  console.log(`Levels: ${levelNs.LEVEL_COUNT}`);

  const levels = levelNs.loadAllLevels(rom);
  for (const lvl of levels) {
    printLevel(lvl, rom);
  }

  console.log("");
  console.log("====================================================");
  console.log("Done. See `docs/level-header-format.md` for field semantics.");
  console.log("====================================================");

  return 0;
}

process.exit(main());
