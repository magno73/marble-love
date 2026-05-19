/**
 * level.ts — parser dei livelli Marble Madness dalla ROM.
 *
 * **Verificato in Phase 4b** sul blob `ghidra_project/marble_program.bin`:
 *
 * Pointer table @ ROM 0x2BE00 (6 × 32-bit big-endian):
 *   0x2BE00 → 0x0002BEE2  (Level 1: Practice)
 *   0x2BE04 → 0x0002C54C  (Level 2: Beginner)
 *   0x2BE08 → 0x0002CD9E  (Level 3: Intermediate)
 *   0x2BE0C → 0x0002D648  (Level 4: Aerial)
 *   0x2BE10 → 0x0002DE1E  (Level 5: Silly)
 *   0x2BE14 → 0x0002E790  (Level 6: Ultimate)
 *
 * **Header fisso da 0x2E byte** verificato in Phase 1 statica
 * (`docs/level-header-format.md`) leggendo i consumer engine TS gia'
 * verificati bit-perfect contro il binario originale. Il valore precedente
 * `LEVEL_HEADER_SIZE = 36` era preso dal progetto `marble-madness-2026`
 * senza verifica per Marble Love; provabilmente sbagliato perche' `+0x2A`
 * (extByteTablePtr long) finisce a byte `+0x2D`.
 *
 * Dopo l'header fisso, alla posizione `+0x2E`, inizia il corpo post-header:
 * terrain row pointer table, sub-pattern pointer table, tile-line descriptors,
 * row-build script e RLE row offsets. Il vecchio nome "height records" resta
 * solo per compatibilita' del parser legacy; vedi
 * `docs/level-header-format.md` "Corpo post-header decodato".
 */

import type { RomImage } from "./bus.js";

/** Offset assoluto della pointer table dei livelli (verificato Phase 4b). */
export const LEVEL_POINTER_TABLE_OFFSET = 0x2BE00 as const;
export const LEVEL_COUNT = 6 as const;
/** Dimensione header fisso in byte (verificato Phase 1 statica). */
export const LEVEL_HEADER_SIZE = 0x2E as const;
export const HEIGHT_RECORD_SIZE = 8 as const;
/** Offset dell'inizio della column table (= dimensione header fisso). */
export const LEVEL_COLUMN_TABLE_OFFSET = 0x2E as const;
/** ROM table usata da `FUN_1CABA` per convertire terrain-code quad in altezze. */
export const TERRAIN_COEFFICIENT_TABLE_OFFSET = 0x1ED62 as const;
export const TERRAIN_COEFFICIENT_COUNT = 32 as const;

export const TERRAIN_CODE_EMPTY = 0x0000 as const;
export const TERRAIN_CODE_DIRECT_MIN = 0x0001 as const;
export const TERRAIN_CODE_DIRECT_MAX = 0x07ff as const;
export const TERRAIN_CODE_INDIRECT_MIN = 0x0800 as const;
export const TERRAIN_CODE_INDIRECT_MAX = 0x0fff as const;
export const TERRAIN_CODE_QUAD_MIN = 0x1000 as const;
export const TERRAIN_CODE_QUAD_MAX = 0xefff as const;
export const TERRAIN_CODE_FLAT_MIN = 0xf000 as const;

/**
 * Decoded view del descriptor header. Tutti i field sono read da almeno
 * un consumer engine bit-perfect contro il binario originale (vedi
 * `docs/level-header-format.md` per la mappa file:line).
 *
 * I field sovrapposti del header originale restano accessibili anche via
 * `raw`, oltre ai nomi semantici verificati.
 */
export interface LevelHeader {
  /** Bytes raw del header (0x2E byte). */
  raw: Uint8Array;
  /**
   * `+0x00` (long): Direct terrain record base pointer.
   * Pointer a byte-records di terrain consumati dal `PATH_DIRECT` del
   * tile-redraw (`sub-1caba-tile-redraw.ts:464`).
   */
  directTerrainPtr: number;
  /**
   * `+0x04` (long): Tile-word table pointer.
   * Source word stream di `decodeBitstream1A668`
   * (`level-init-16f6c.ts:84`, `refresh-helper-13ee6.ts:245`).
   */
  tileWordTablePtr: number;
  /**
   * `+0x08` (long): Row-build bit-list pointer.
   * Puntatore consumato da `FUN_1A444`: ogni 16 tile-line descriptor legge una
   * word di bit flag da questa lista e la passa a `FUN_1AD54`.
   */
  rowBuildBitListPtr: number;
  /**
   * `+0x0C` (long): RLE-compressed scroll-row source pointer.
   * Espanso da `FUN_18FD0` (`rle-expand.ts:54`) in `0x400478+`.
   */
  rleSourcePtr: number;
  /**
   * `+0x10` (signed word): Y scroll base / boundary anchor.
   * Inizializza `0x40097c` (`OFF_SRTGT`). NON e' un timer (vedi
   * `docs/level-header-format.md` per la nota sul naming
   * `LEVEL_TIMER_OFF`).
   */
  yScrollBase: number;
  /**
   * `+0x12` (signed word): Y scroll range / aerial delta.
   * Aggiunto a `yScrollBase` solo su `levelIndex==4` (Aerial)
   * (`level-dispatcher-16ec6.ts:139`).
   */
  yScrollRange: number;
  /**
   * `+0x14..+0x1F` (6 packed word): Entity initial position array.
   * `[i]` = packed `hi=vx>>8, lo=vy>>8` per entity i (0..5). In
   * attract/playable solo i=0 (P1) e i=1 (P2) sono attivi (`obj+0x18==3`).
   * Gli slot i=2..5 sono sovrapposti a field consumati da altri subsystem.
   */
  entityInitPositions: readonly number[];
  /**
   * `+0x18` (signed word): Max tile bound. Column-index limit per il
   * tile-redraw loop e boundary per `string-dispatch-table-177f8`.
   * **Nota**: byte fisicamente sovrapposto a `entityInitPositions[2]`.
   * I due semantici non collidono nei path naturali perche' entity 2
   * non e' attiva in stato 3.
   */
  maxTileBound: number;
  /**
   * `+0x1A` (signed word): Tile-line descriptor count per chunk.
   * Consumato da `FUN_1A444` come limite del loop che chiama `FUN_1AD54`.
   * Sovrapposto fisicamente a `entityInitPositions[3]`.
   */
  rowBuildEntryCount: number;
  /**
   * `+0x1C` (long): Tile-line descriptor table pointer.
   * Base passata da `FUN_1A444` a `FUN_1AD54` con stride 8 byte.
   * Sovrapposta fisicamente a `entityInitPositions[4..5]`.
   */
  tileLineDescriptorPtr: number;
  /**
   * `+0x20` (long): Sub-pattern pointer table.
   * Pointer a una tabella di long entries indicizzate per
   * `sub_index << 2` (`render-tile-line-1ad54.ts:246`). Ogni entry e' un
   * "data ptr" interpretato byte-by-byte; valore `0x80` resetta il ptr.
   */
  subPatternTablePtr: number;
  /**
   * `+0x24` (signed word): Binsearch end index.
   * `FUN_1A444` calcola `0x40065e = binsearchBasePtr + value*2 - 2`.
   */
  binsearchEndIndex: number;
  /**
   * `+0x26` (long): Binsearch base pointer.
   * Terrain-code lookup table. Stored a `0x40065a` dal `FUN_16EC6`
   * (`level-dispatcher-16ec6.ts:131`), consumed dal tile-redraw
   * (`sub-1caba-tile-redraw.ts:376`).
   */
  binsearchBasePtr: number;
  /**
   * `+0x2A` (long): Extra-byte table pointer.
   * Source byte stream di `decodeBitstream1A668`
   * (`level-init-16f6c.ts:85`, `refresh-helper-13ee6.ts:261`).
   */
  extByteTablePtr: number;
}

/**
 * Height record decoded.
 *
 * **Legacy parser**: il blocco post-header non e' un array uniforme di
 * record geometria 8-byte. I field sotto restano una vista compatibile della
 * vecchia segmentazione, non una proof di fisica/slope. Per il formato
 * verificato usare `LevelData.postHeader` e `decodeTerrainCode`.
 */
export interface HeightRecord {
  /** word a offset 0 (16-bit BE). */
  word0: number;
  /** word a offset 2 — UNKNOWN. */
  word1: number;
  /** word a offset 4 — UNKNOWN. */
  word2: number;
  /** word a offset 6 — UNKNOWN. */
  word3: number;
  /** Estratti da word0 bits 12-15: orientazione slope (0..15). */
  slopeOrient: number;
  /** Estratti da word0 bits 8-11: magnitudine slope (0..15). */
  slopeVal: number;
  /** Bytes raw (8). */
  raw: Uint8Array;
}

export type TerrainCode =
  | { kind: "empty"; raw: number }
  | { kind: "direct"; raw: number; directRecordOffset: number }
  | { kind: "indirect"; raw: number; altTableByteOffset: number; altTableWordIndex: number }
  | {
      kind: "quad";
      raw: number;
      baseHeightDelta: number;
      coefficientIndex: number;
      coefficientTableByteOffset: number;
      sampleMask: number;
    }
  | { kind: "flat"; raw: number; baseHeightDelta: number };

export interface DirectTerrainByteRecord {
  raw: Uint8Array;
  /**
   * Four raw byte samples. At runtime `FUN_1CABA` writes 0 for byte 0;
   * otherwise it writes `byte + (columnBaseWord - 0x80)`.
   */
  sampleBytes: readonly number[];
  emptySampleMask: number;
}

export interface TerrainRowPointerTable {
  /** Absolute ROM address of the first long pointer (`levelPtr + 0x2E`). */
  startPtr: number;
  /** Absolute ROM address just after the `0xFFFF` terminator. */
  endPtr: number;
  entries: readonly number[];
  terminator: number;
}

export interface SubPatternPointerTable {
  startPtr: number;
  endPtr: number;
  entries: readonly number[];
}

export interface TileLineDescriptor {
  raw: Uint8Array;
  xBase: number;
  xCount: number;
  yBase: number;
  yCount: number;
  flagsWord: number;
  extraByte: number;
  subIndex: number;
  lookupByte: number;
  directionIndex: number;
  subMode: boolean;
}

export interface TileLineDescriptorTable {
  startPtr: number;
  decodedCount: number;
  physicalCount: number;
  endPtr: number;
  descriptors: readonly TileLineDescriptor[];
  unusedTailBytes: number;
}

export interface RowBuildPatch {
  rawCell: number;
  row: number;
  col: number;
  value: number;
}

export interface RowBuildChunk {
  bitWords: readonly number[];
  patches: readonly RowBuildPatch[];
  terminator: number;
}

export interface RowBuildScript {
  startPtr: number;
  endPtr: number;
  chunks: readonly RowBuildChunk[];
}

export interface RleRun {
  count: number;
  value: number;
}

export interface RleRunList {
  startPtr: number;
  endPtr: number;
  runs: readonly RleRun[];
  expandedWordCount: number;
}

export interface LevelPostHeaderLayout {
  /**
   * Long pointer table at `levelPtr + 0x2E`, terminated by `0xFFFF`.
   * `FUN_264AA` indexes this table using a runtime signed offset at
   * `0x40045C`, so consumers must not treat it as simple `col 0 == entry 0`
   * in every path.
   */
  terrainRowPointers: TerrainRowPointerTable;
  subPatternPointers: SubPatternPointerTable;
  tileLineDescriptors: TileLineDescriptorTable;
  rowBuildScript: RowBuildScript;
  rleRuns: RleRunList;
}

export interface LevelData {
  /** Indice 0..5 (livello 1..6). */
  index: number;
  /** Offset assoluto del livello in ROM. */
  romOffset: number;
  /** Dimensione totale (header + records, calcolata dalla differenza al livello successivo). */
  byteSize: number;
  header: LevelHeader;
  postHeader: LevelPostHeaderLayout;
  /**
   * Legacy compatibility view. This is NOT a proven geometry/height-record
   * array; use `postHeader` and `decodeTerrainCode` for verified consumers.
   */
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

/** Sign-extend di una M68K word (0..0xFFFF) → 32-bit signed. */
function signExtendWord(w: number): number {
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) | 0 : w & 0xffff;
}

function signExtendByte(b: number): number {
  const v = b & 0xff;
  return (v & 0x80) !== 0 ? v - 0x100 : v;
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
 * Decodifica un descriptor header dai 0x2E byte raw.
 *
 * Tutti i field decoded corrispondono a read osservati nei consumer engine
 * TS gia' bit-perfect contro il binario originale (vedi
 * `docs/level-header-format.md`). I pointer non sono dereferenziati qui —
 * vengono restituiti come long unsigned, da risolvere al caller.
 *
 * @param raw Bytes raw del header. Deve essere lungo almeno `LEVEL_HEADER_SIZE`.
 */
export function decodeLevelHeader(raw: Uint8Array): LevelHeader {
  if (raw.length < LEVEL_HEADER_SIZE) {
    throw new Error(
      `level header raw length ${raw.length} < required ${LEVEL_HEADER_SIZE}`,
    );
  }

  const directTerrainPtr = readU32BE(raw, 0x00);
  const tileWordTablePtr = readU32BE(raw, 0x04);
  const rowBuildBitListPtr = readU32BE(raw, 0x08);
  const rleSourcePtr = readU32BE(raw, 0x0c);
  const yScrollBase = signExtendWord(readU16BE(raw, 0x10));
  const yScrollRange = signExtendWord(readU16BE(raw, 0x12));

  // Entity init positions: 6 packed words @ +0x14, +0x16, ..., +0x1E.
  // In attract/playable solo i=0,1 sono attivi (vedi level-header-format.md).
  const entityInitPositions: number[] = [];
  for (let i = 0; i < 6; i++) {
    entityInitPositions.push(readU16BE(raw, 0x14 + i * 2));
  }

  // Max tile bound: stessa locazione fisica di entityInitPositions[2] (+0x18).
  // Semantica indipendente — non collide in path testati.
  const maxTileBound = signExtendWord(readU16BE(raw, 0x18));
  const rowBuildEntryCount = signExtendWord(readU16BE(raw, 0x1a));
  const tileLineDescriptorPtr = readU32BE(raw, 0x1c);

  const subPatternTablePtr = readU32BE(raw, 0x20);
  const binsearchEndIndex = signExtendWord(readU16BE(raw, 0x24));
  const binsearchBasePtr = readU32BE(raw, 0x26);
  const extByteTablePtr = readU32BE(raw, 0x2a);

  return {
    raw,
    directTerrainPtr,
    tileWordTablePtr,
    rowBuildBitListPtr,
    rleSourcePtr,
    yScrollBase,
    yScrollRange,
    entityInitPositions,
    maxTileBound,
    rowBuildEntryCount,
    tileLineDescriptorPtr,
    subPatternTablePtr,
    binsearchEndIndex,
    binsearchBasePtr,
    extByteTablePtr,
  };
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

export function decodeTerrainCode(rawCode: number): TerrainCode {
  const raw = rawCode & 0xffff;
  if (raw === TERRAIN_CODE_EMPTY) return { kind: "empty", raw };
  if (raw <= TERRAIN_CODE_DIRECT_MAX) {
    return { kind: "direct", raw, directRecordOffset: raw };
  }
  if (raw <= TERRAIN_CODE_INDIRECT_MAX) {
    const altTableByteOffset = raw & 0x07fe;
    return {
      kind: "indirect",
      raw,
      altTableByteOffset,
      altTableWordIndex: altTableByteOffset >>> 1,
    };
  }

  const baseHeightDelta = (raw & 0x7f) - 0x40;
  if (raw >= TERRAIN_CODE_FLAT_MIN) {
    return { kind: "flat", raw, baseHeightDelta };
  }

  const coefficientTableByteOffset = (raw >>> 6) & 0x3e;
  return {
    kind: "quad",
    raw,
    baseHeightDelta,
    coefficientIndex: coefficientTableByteOffset >>> 1,
    coefficientTableByteOffset,
    sampleMask: (raw >>> 12) & 0x0f,
  };
}

export function decodeDirectTerrainByteRecord(raw: Uint8Array): DirectTerrainByteRecord {
  if (raw.length < 4) {
    throw new Error(`direct terrain byte record raw length ${raw.length} < required 4`);
  }
  const sampleBytes = [
    raw[0] ?? 0,
    raw[1] ?? 0,
    raw[2] ?? 0,
    raw[3] ?? 0,
  ];
  let emptySampleMask = 0;
  for (let i = 0; i < sampleBytes.length; i++) {
    if (sampleBytes[i] === 0) emptySampleMask |= 1 << i;
  }
  return {
    raw: raw.slice(0, 4),
    sampleBytes,
    emptySampleMask,
  };
}

export function decodeDirectTerrainRecord(
  rom: RomImage,
  header: LevelHeader,
  codeOrDecoded: number | TerrainCode,
): DirectTerrainByteRecord {
  const decoded = typeof codeOrDecoded === "number"
    ? decodeTerrainCode(codeOrDecoded)
    : codeOrDecoded;
  if (decoded.kind !== "direct") {
    throw new Error(`terrain code 0x${decoded.raw.toString(16)} is ${decoded.kind}, not direct`);
  }
  const ptr = (header.directTerrainPtr + decoded.directRecordOffset) >>> 0;
  return decodeDirectTerrainByteRecord(rom.program.slice(ptr, ptr + 4));
}

export function resolveTerrainCodeHeights(
  decoded: TerrainCode,
  columnBaseWord: number,
  coefficientWord = 0,
): readonly number[] {
  const colBase = columnBaseWord & 0xffff;
  if (decoded.kind === "empty" || decoded.kind === "direct" || decoded.kind === "indirect") {
    throw new Error(`terrain code kind ${decoded.kind} cannot be resolved without runtime dereference`);
  }

  const base = (colBase + decoded.baseHeightDelta) & 0xffff;
  if (decoded.kind === "flat") return [base, base, base, base];

  const coef = coefficientWord & 0xffff;
  const alt = coef === 0x1000 ? 0 : (base - signExtendWord(coef)) & 0xffff;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    out.push(((decoded.sampleMask & (1 << i)) !== 0 ? base : alt) & 0xffff);
  }
  return out;
}

function decodeTerrainRowPointerTable(
  rom: Uint8Array,
  startPtr: number,
  endPtr: number,
): TerrainRowPointerTable {
  if (endPtr < startPtr + 2) {
    throw new Error(`terrain row pointer table end 0x${endPtr.toString(16)} before start 0x${startPtr.toString(16)}`);
  }
  const entryBytes = endPtr - startPtr - 2;
  if ((entryBytes & 3) !== 0) {
    throw new Error(`terrain row pointer table byte length ${entryBytes} is not long-aligned`);
  }
  const entries: number[] = [];
  for (let off = startPtr; off < endPtr - 2; off += 4) {
    entries.push(readU32BE(rom, off));
  }
  return {
    startPtr,
    endPtr,
    entries,
    terminator: readU16BE(rom, endPtr - 2),
  };
}

function decodeSubPatternPointerTable(
  rom: Uint8Array,
  startPtr: number,
  endPtr: number,
): SubPatternPointerTable {
  const entryBytes = endPtr - startPtr;
  if (entryBytes < 0 || (entryBytes & 3) !== 0) {
    throw new Error(`sub-pattern pointer table byte length ${entryBytes} is not long-aligned`);
  }
  const entries: number[] = [];
  for (let off = startPtr; off < endPtr; off += 4) {
    entries.push(readU32BE(rom, off));
  }
  return { startPtr, endPtr, entries };
}

function decodeTileLineDescriptor(raw: Uint8Array): TileLineDescriptor {
  if (raw.length < 8) {
    throw new Error(`tile-line descriptor raw length ${raw.length} < required 8`);
  }
  const extraByte = raw[6] ?? 0;
  const lookupByte = raw[7] ?? 0;
  return {
    raw: raw.slice(0, 8),
    xBase: signExtendByte(raw[0] ?? 0),
    xCount: raw[1] ?? 0,
    yBase: signExtendByte(raw[2] ?? 0),
    yCount: raw[3] ?? 0,
    flagsWord: readU16BE(raw, 4),
    extraByte,
    subIndex: extraByte & 0x1f,
    lookupByte,
    directionIndex: lookupByte & 0x07,
    subMode: (lookupByte & 0x08) !== 0,
  };
}

function decodeTileLineDescriptorTable(
  rom: Uint8Array,
  startPtr: number,
  physicalEndPtr: number,
  decodedCount: number,
): TileLineDescriptorTable {
  const physicalBytes = physicalEndPtr - startPtr;
  if (physicalBytes < 0 || (physicalBytes & 7) !== 0) {
    throw new Error(`tile-line descriptor table byte length ${physicalBytes} is not 8-byte aligned`);
  }
  const physicalCount = physicalBytes >>> 3;
  if (decodedCount < 0 || decodedCount > physicalCount) {
    throw new Error(`tile-line descriptor decoded count ${decodedCount} outside physical count ${physicalCount}`);
  }
  const descriptors: TileLineDescriptor[] = [];
  for (let i = 0; i < decodedCount; i++) {
    const off = startPtr + i * 8;
    descriptors.push(decodeTileLineDescriptor(rom.slice(off, off + 8)));
  }
  return {
    startPtr,
    decodedCount,
    physicalCount,
    endPtr: startPtr + decodedCount * 8,
    descriptors,
    unusedTailBytes: physicalEndPtr - (startPtr + decodedCount * 8),
  };
}

function decodeRowBuildScript(
  rom: Uint8Array,
  startPtr: number,
  entryCount: number,
): RowBuildScript {
  const bitWordCount = Math.ceil(entryCount / 16);
  const chunks: RowBuildChunk[] = [];
  let ptr = startPtr;
  let safety = 256;
  while (safety-- > 0) {
    const bitWords: number[] = [];
    for (let i = 0; i < bitWordCount; i++) {
      bitWords.push(readU16BE(rom, ptr));
      ptr += 2;
    }

    const patches: RowBuildPatch[] = [];
    let terminator = 0;
    while (true) {
      const rawCell = readU16BE(rom, ptr);
      ptr += 2;
      if ((rawCell & 0xfffe) === 0xfffe) {
        terminator = rawCell;
        break;
      }
      const value = readU16BE(rom, ptr);
      ptr += 2;
      patches.push({
        rawCell,
        row: (rawCell >>> 8) & 0xff,
        col: rawCell & 0xff,
        value,
      });
    }

    chunks.push({ bitWords, patches, terminator });
    if (terminator === 0xffff) {
      return { startPtr, endPtr: ptr, chunks };
    }
  }
  throw new Error(`row-build script at 0x${startPtr.toString(16)} did not terminate`);
}

function decodeRleRuns(rom: Uint8Array, startPtr: number): RleRunList {
  const runs: RleRun[] = [];
  let expandedWordCount = 0;
  let ptr = startPtr;
  let safety = 1024;
  while (safety-- > 0) {
    const count = readU16BE(rom, ptr);
    ptr += 2;
    if (count === 0) {
      return { startPtr, endPtr: ptr, runs, expandedWordCount };
    }
    const value = readU16BE(rom, ptr);
    ptr += 2;
    runs.push({ count, value });
    expandedWordCount += count;
  }
  throw new Error(`RLE run list at 0x${startPtr.toString(16)} did not terminate`);
}

function decodeLevelPostHeaderLayout(
  rom: Uint8Array,
  levelPtr: number,
  header: LevelHeader,
): LevelPostHeaderLayout {
  const rowTableStart = (levelPtr + LEVEL_COLUMN_TABLE_OFFSET) >>> 0;
  const terrainRowPointers = decodeTerrainRowPointerTable(
    rom,
    rowTableStart,
    header.subPatternTablePtr,
  );
  const subPatternPointers = decodeSubPatternPointerTable(
    rom,
    header.subPatternTablePtr,
    header.tileLineDescriptorPtr,
  );
  const tileLineDescriptors = decodeTileLineDescriptorTable(
    rom,
    header.tileLineDescriptorPtr,
    header.rowBuildBitListPtr,
    header.rowBuildEntryCount,
  );
  const rowBuildScript = decodeRowBuildScript(
    rom,
    header.rowBuildBitListPtr,
    header.rowBuildEntryCount,
  );
  const rleRuns = decodeRleRuns(rom, header.rleSourcePtr);
  return {
    terrainRowPointers,
    subPatternPointers,
    tileLineDescriptors,
    rowBuildScript,
    rleRuns,
  };
}

/**
 * Carica un livello (0-indexed: 0=L1, 5=L6).
 *
 * Parser base che legge header, post-header verificato e la vista legacy
 * compatibile fino al puntatore del livello successivo.
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

  const header = decodeLevelHeader(
    rom.program.slice(startOffset, startOffset + LEVEL_HEADER_SIZE),
  );
  const postHeader = decodeLevelPostHeaderLayout(rom.program, startOffset, header);

  const records: HeightRecord[] = [];
  const recordsStart = startOffset + LEVEL_HEADER_SIZE;
  const maxRecords = Math.floor((byteSize - LEVEL_HEADER_SIZE) / HEIGHT_RECORD_SIZE);
  for (let i = 0; i < maxRecords; i++) {
    records.push(decodeHeightRecord(rom.program, recordsStart + i * HEIGHT_RECORD_SIZE));
  }

  return { index, romOffset: startOffset, byteSize, header, postHeader, records };
}

/** Carica tutti i 6 livelli. Comodo per smoke test. */
export function loadAllLevels(rom: RomImage): readonly LevelData[] {
  return Array.from({ length: LEVEL_COUNT }, (_, i) => loadLevel(rom, i));
}
