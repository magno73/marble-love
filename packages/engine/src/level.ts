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
 * Dopo l'header fisso, alla posizione `+0x2E`, inizia una **tabella
 * per-colonna** (long entries indicizzate per `col*4`) seguita dai height
 * records (8 byte ciascuno). Il limite tra column table e records non e'
 * ancora isolato staticamente — vedi `docs/level-header-format.md`
 * "Aperture residue".
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

/**
 * Decoded view del descriptor header. Tutti i field sono read da almeno
 * un consumer engine bit-perfect contro il binario originale (vedi
 * `docs/level-header-format.md` per la mappa file:line).
 *
 * I field "UNKNOWN" del header originale (`+0x08`, `+0x24..0x25`,
 * `+0x1A..0x1F`) sono accessibili solo via `raw`.
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
   */
  entityInitPositions: readonly number[];
  /**
   * `+0x18` (signed word): Max tile bound. Column-index limit per il
   * tile-redraw loop e boundary per `string-dispatch-table-177f8`.
   * **Nota**: byte fisicamente sovrapposto a `entityInitPositions[2]`.
   * I due semantici non collidono in attract/playable perche' entity 2
   * non e' attiva.
   */
  maxTileBound: number;
  /**
   * `+0x20` (long): Sub-pattern pointer table.
   * Pointer a una tabella di long entries indicizzate per
   * `sub_index << 2` (`render-tile-line-1ad54.ts:246`). Ogni entry e' un
   * "data ptr" interpretato byte-by-byte; valore `0x80` resetta il ptr.
   */
  subPatternTablePtr: number;
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
 * **Solo word 0 e' parzialmente decodato** (slope orient/magnitude).
 * Words 1-3 sono UNKNOWN — richiedono MAME play-trace + Ghidra xref
 * sui consumer della fisica del marble per essere chiusi (vedi
 * `docs/level-header-format.md` "Aperture residue").
 *
 * Formula supposta (da `marble-madness-2026`, da verificare):
 *   `z_cell = z_base + (dx*sdx + dy*sdy) * slopeVal`
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

/** Sign-extend di una M68K word (0..0xFFFF) → 32-bit signed. */
function signExtendWord(w: number): number {
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) | 0 : w & 0xffff;
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

  const subPatternTablePtr = readU32BE(raw, 0x20);
  const binsearchBasePtr = readU32BE(raw, 0x26);
  const extByteTablePtr = readU32BE(raw, 0x2a);

  return {
    raw,
    directTerrainPtr,
    tileWordTablePtr,
    rleSourcePtr,
    yScrollBase,
    yScrollRange,
    entityInitPositions,
    maxTileBound,
    subPatternTablePtr,
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

  const header = decodeLevelHeader(
    rom.program.slice(startOffset, startOffset + LEVEL_HEADER_SIZE),
  );

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
