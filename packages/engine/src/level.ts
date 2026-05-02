/**
 * level.ts — parser dei livelli Marble Madness dalla ROM.
 *
 * **Verificato in Phase 4b** sul blob `ghidra_project/marble_program.bin`:
 *
 * Pointer table @ ROM 0x2BE00 (6 × 32-bit big-endian):
 *   0x2BE00 → 0x0002BEE2  (Level 1: Practice / "Beginner")
 *   0x2BE04 → 0x0002C54C  (Level 2: Aerobic / "Intermediate")
 *   0x2BE08 → 0x0002CD9E  (Level 3: Intermediate)
 *   0x2BE0C → 0x0002D648  (Level 4: Aerobic)
 *   0x2BE10 → 0x0002DE1E  (Level 5: Silly)
 *   0x2BE14 → 0x0002E790  (Level 6: Ultimate)
 *
 * Format header (36 byte) e height records (8 byte ciascuno) sono noti dal
 * progetto precedente `marble-madness-2026` ma vanno **riconfermati per
 * Marble Love** sul binario specifico (potrebbe essere stata una versione
 * diversa del set ROM).
 *
 * **Status**: parser di base che legge la pointer table e ritorna byte raw.
 * La decode dei field interni (heightmap, slopes) è TBD Phase 4c quando avremo
 * il rendering pipeline pronto e potremo verificare visivamente.
 */

import type { RomImage } from "./bus.js";

/** Offset assoluto della pointer table dei livelli (verificato Phase 4b). */
export const LEVEL_POINTER_TABLE_OFFSET = 0x2BE00 as const;
export const LEVEL_COUNT = 6 as const;
export const LEVEL_HEADER_SIZE = 36 as const;
export const HEIGHT_RECORD_SIZE = 8 as const;

export interface LevelHeader {
  /** Bytes raw del header (per ora, decode TBD Phase 4c). */
  raw: Uint8Array;
}

/**
 * Height record decoded.
 * Da `marble-madness-2026` (verificare per Marble Love):
 *   bits 12-15: slopeOrient (0..15)
 *   bits 8-11:  slopeVal (0..15)
 *   z_cell = z_base + (dx*sdx + dy*sdy) * slopeVal
 */
export interface HeightRecord {
  /** word a offset 0 (16-bit BE). */
  word0: number;
  /** word a offset 2. */
  word1: number;
  /** word a offset 4. */
  word2: number;
  /** word a offset 6. */
  word3: number;
  /** Estratti: orientazione slope (0..15). */
  slopeOrient: number;
  /** Magnitudine slope (0..15). */
  slopeVal: number;
  /** Bytes raw (8). */
  raw: Uint8Array;
}

export interface LevelData {
  /** Indice 0..5 (livello 1..6). */
  index: number;
  /** Offset assoluto del livello in ROM. */
  romOffset: number;
  /** Dimensione totale (header + records, calcolata dalla differenza al livello successivo). */
  byteSize: number;
  header: LevelHeader;
  records: HeightRecord[];
}

/** Legge un long-word big-endian dalla ROM. */
function readU32BE(rom: Uint8Array, offset: number): number {
  return (
    ((rom[offset] ?? 0) << 24) |
    ((rom[offset + 1] ?? 0) << 16) |
    ((rom[offset + 2] ?? 0) << 8) |
    (rom[offset + 3] ?? 0)
  ) >>> 0;
}

/** Legge un word big-endian dalla ROM. */
function readU16BE(rom: Uint8Array, offset: number): number {
  return (((rom[offset] ?? 0) << 8) | (rom[offset + 1] ?? 0)) & 0xffff;
}

/**
 * Legge la pointer table dei livelli. Ritorna 6 offset assoluti.
 */
export function readLevelPointerTable(rom: RomImage): readonly number[] {
  const ptrs: number[] = [];
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const offset = LEVEL_POINTER_TABLE_OFFSET + i * 4;
    ptrs.push(readU32BE(rom.program, offset));
  }
  return ptrs;
}

/**
 * Decodifica un height record da 8 byte.
 *
 * Layout (best-guess da marble-madness-2026, da riverificare):
 *   word 0: bits 12-15 = slopeOrient, bits 8-11 = slopeVal, bits 0-7 = ?
 *   word 1: ?
 *   word 2: ?
 *   word 3: ?
 */
function decodeHeightRecord(rom: Uint8Array, offset: number): HeightRecord {
  const w0 = readU16BE(rom, offset + 0);
  const w1 = readU16BE(rom, offset + 2);
  const w2 = readU16BE(rom, offset + 4);
  const w3 = readU16BE(rom, offset + 6);
  const raw = rom.slice(offset, offset + HEIGHT_RECORD_SIZE);
  return {
    word0: w0,
    word1: w1,
    word2: w2,
    word3: w3,
    slopeOrient: (w0 >> 12) & 0xf,
    slopeVal: (w0 >> 8) & 0xf,
    raw,
  };
}

/**
 * Carica un livello (0-indexed: 0=L1, 5=L6).
 *
 * Phase 4b: parser base che legge header + tutti i record fino al puntatore
 * del livello successivo. La decodifica geometric (heightmap rendering) è
 * Phase 4c / Phase 7.
 */
export function loadLevel(rom: RomImage, index: number): LevelData {
  if (index < 0 || index >= LEVEL_COUNT) {
    throw new Error(`level index ${index} out of range (0..${LEVEL_COUNT - 1})`);
  }
  const ptrs = readLevelPointerTable(rom);
  const startOffset = ptrs[index]!;
  // Per dimensione, usiamo il next pointer; per L6 (ultimo) usiamo + 0xA00 di
  // safety margin (tipico size).
  const endOffset = (index < LEVEL_COUNT - 1) ? ptrs[index + 1]! : startOffset + 0xA00;
  const byteSize = endOffset - startOffset;

  if (byteSize < LEVEL_HEADER_SIZE) {
    throw new Error(`level ${index} size ${byteSize} < header ${LEVEL_HEADER_SIZE}`);
  }

  const header: LevelHeader = {
    raw: rom.program.slice(startOffset, startOffset + LEVEL_HEADER_SIZE),
  };

  const records: HeightRecord[] = [];
  const recordsStart = startOffset + LEVEL_HEADER_SIZE;
  const maxRecords = Math.floor((byteSize - LEVEL_HEADER_SIZE) / HEIGHT_RECORD_SIZE);
  for (let i = 0; i < maxRecords; i++) {
    records.push(decodeHeightRecord(rom.program, recordsStart + i * HEIGHT_RECORD_SIZE));
  }

  return { index, romOffset: startOffset, byteSize, header, records };
}

/** Carica tutti i 6 livelli. Comodo per smoke test. */
export function loadAllLevels(rom: RomImage): readonly LevelData[] {
  return Array.from({ length: LEVEL_COUNT }, (_, i) => loadLevel(rom, i));
}
