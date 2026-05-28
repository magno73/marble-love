/**
 * render.ts - rendering adapter. **Does not use PixiJS directly.**
 *
 * The `engine` package stays platform-neutral: no DOM and no WebGL. It exposes
 * renderer commands that `@marble-love/web` translates into PixiJS draw calls.
 *
 */

import type { GameState } from "./state.js";

export interface FrameSize {
  width: number;
  height: number;
}

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PaletteEntry {
  index: number;
  rgba: RgbaColor;
}

export interface TileCommand {
  /** Index in the ROM tile bank or synthetic fixture. */
  tileIndex: number;
  gfxBank?: number;
  bitsPerPixel?: 4 | 5 | 6;
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** Atari System 1 color/palette code. */
  paletteIndex: number;
  flipX?: boolean;
  flipY?: boolean;
  priority?: number;
}

export interface SpriteCommand {
  /** Index in sprite RAM (motion object) or synthetic fixture. */
  spriteIndex: number;
  gfxBank?: number;
  bitsPerPixel?: 4 | 5 | 6;
  x: number;
  y: number;
  width?: number;
  height?: number;
  paletteIndex: number;
  flipX?: boolean;
  flipY?: boolean;
  priority?: number;
  translucent?: boolean;
}

export interface AlphaCommand {
  /** Index in the alphanumeric/HUD tile bank. */
  tileIndex: number;
  x: number;
  y: number;
  paletteIndex: number;
  opaque?: boolean;
}

export interface PlayfieldWordInfo {
  tileIndexLow: number;
  lookupIndex: number;
  flipX: boolean;
}

export interface PlayfieldLookupInfo {
  offset: number;
  bank: number;
  color: number;
  bpp: 4 | 5 | 6;
}

export interface MotionObjectLookupInfo {
  offset: number;
  bank: number;
  color: number;
  bpp: 4 | 5 | 6;
}

export interface MotionObjectEntryInfo {
  tileIndex: number;
  color: number;
  xRaw: number;
  yRaw: number;
  widthTiles: number;
  heightTiles: number;
  link: number;
  flipX: boolean;
  priority: boolean;
  timer: boolean;
}

export interface VideoControlInfo {
  alphaBank: number;
  playfieldTileBank: number;
  motionObjectBank: number;
}

export interface Frame {
  nativeSize: FrameSize;
  /** Tilemap scroll coordinates; Atari System 1 supports horizontal and vertical scroll. */
  scrollX: number;
  scrollY: number;
  palette: PaletteEntry[];
  playfield: TileCommand[];
  sprites: SpriteCommand[];
  alpha: AlphaCommand[];
  debugLabel?: string;
}

export interface BuildFrameOptions {
  playfieldRam?: Uint8Array;
  playfieldLookups?: PlayfieldLookupInfo[];
  motionObjects?: "none" | "linked-list" | "runtime-counter" | "all-banks";
  motionObjectStartEntry?: number;
  maxMotionObjectEntries?: number;
  motionObjectLookups?: MotionObjectLookupInfo[];
  scrollX?: number;
  scrollY?: number;
  videoControlByte?: number;
}

export const CLASSIC_NATIVE_SIZE: FrameSize = {
  width: 336,
  height: 240,
};

const ALPHA_COLUMNS = 64;
const ALPHA_TILE_SIZE = 8;
const PALETTE_ENTRY_COUNT = 1024;
const MOTION_OBJECT_ENTRY_COUNT = 64;
const MOTION_OBJECT_BANK_COUNT = 8;
const MOTION_OBJECT_BANK_BYTES = 0x200;
const MOTION_OBJECT_WORD_STRIDE_BYTES = 0x80;
const MOTION_OBJECT_ENTRY_WORD_BYTES = 2;
const LEGACY_PACKED_MOTION_OBJECT_ENTRY_BYTES = 8;
const MOTION_OBJECT_PALETTE_BASE = 0x20;
const HIGH_PRIORITY_MO_VISUAL_PALETTE_BASE = 0x40;

export function irgb4444ToRgba(word: number): RgbaColor {
  const intensity = (word >>> 12) & 0x0f;
  const red = (word >>> 8) & 0x0f;
  const green = (word >>> 4) & 0x0f;
  const blue = word & 0x0f;
  const scale = intensity / 15;

  return {
    r: Math.round(((red << 4) | red) * scale),
    g: Math.round(((green << 4) | green) * scale),
    b: Math.round(((blue << 4) | blue) * scale),
    a: 255,
  };
}

export function buildPaletteFromColorRam(colorRam: Uint8Array): PaletteEntry[] {
  const palette: PaletteEntry[] = [];
  const count = Math.min(PALETTE_ENTRY_COUNT, Math.floor(colorRam.length / 2));

  for (let index = 0; index < count; index += 1) {
    const offset = index * 2;
    const word = ((colorRam[offset] ?? 0) << 8) | (colorRam[offset + 1] ?? 0);
    palette.push({ index, rgba: irgb4444ToRgba(word) });
  }

  return palette;
}

export function buildAlphaFromRam(alphaRam: Uint8Array): AlphaCommand[] {
  const alpha: AlphaCommand[] = [];
  const tileCount = Math.floor(alphaRam.length / 2);

  for (let index = 0; index < tileCount; index += 1) {
    const offset = index * 2;
    const word = ((alphaRam[offset] ?? 0) << 8) | (alphaRam[offset + 1] ?? 0);
    if (word === 0) continue;

    alpha.push({
      tileIndex: word & 0x03ff,
      x: (index % ALPHA_COLUMNS) * ALPHA_TILE_SIZE,
      y: Math.floor(index / ALPHA_COLUMNS) * ALPHA_TILE_SIZE,
      paletteIndex: (word >>> 10) & 0x07,
      opaque: (word & 0x2000) !== 0,
    });
  }

  return alpha;
}

export function decodePlayfieldWord(word: number): PlayfieldWordInfo {
  return {
    tileIndexLow: word & 0x00ff,
    lookupIndex: (word >>> 8) & 0x007f,
    flipX: (word & 0x8000) !== 0,
  };
}

export function buildPlayfieldFromRam(
  playfieldRam: Uint8Array,
  lookups: PlayfieldLookupInfo[],
): TileCommand[] {
  const commands: TileCommand[] = [];
  const tileCount = Math.floor(playfieldRam.length / 2);

  for (let index = 0; index < tileCount; index += 1) {
    const offset = index * 2;
    const word = ((playfieldRam[offset] ?? 0) << 8) | (playfieldRam[offset + 1] ?? 0);
    // Skip "blank" tiles (word=0): in Atari System 1 the PROM lookup for
    // lookup_index=0 falls back to bank=1 offset=0 color=0 = tile placeholder.
    // Rendering it fills the background with bank 1 "tile 0" (black console
    // background pattern). This matches MAME (tilemap transparent pen 0
    // fallback). See `atarisy1_v.cpp:get_playfield_tile_info`.
    if (word === 0) continue;
    const fields = decodePlayfieldWord(word);
    const lookup = lookups[fields.lookupIndex];
    if (lookup === undefined) continue;

    // Palette index: MAME `atarisy1_v.cpp:get_playfield_tile_info`:
    //   color = 0x20 + ((lookup >> 12) & 15) << m_bank_color_shift[gfx]
    // m_bank_color_shift = bpp - 3.
    // gfx_element constructor uses `color_base = 256` (= 0x100), so final
    // palette index = 0x100 + color*8 + pen = 0x200 + ((lookup_color<<shift)<<3) + pen.
    // Atari System 1 palette regions:
    //   0x000-0x0FF Alphanumerics, 0x100-0x1FF Motion Object,
    //   0x200-0x2FF Playfield, 0x300-0x3FF Translucency.
    // The playfield therefore uses paletteIndex base 0x40 => 0x40*8 = 0x200.
    const colorShift = lookup.bpp - 3;
    commands.push({
      tileIndex: lookup.offset * 256 + fields.tileIndexLow,
      gfxBank: lookup.bank,
      bitsPerPixel: lookup.bpp,
      x: (index % 64) * 8,
      y: Math.floor(index / 64) * 8,
      width: 8,
      height: 8,
      paletteIndex: 0x40 + (lookup.color << colorShift),
      flipX: fields.flipX,
      priority: fields.lookupIndex,
    });
  }

  return commands;
}

export function decodeMotionObjectWords(
  word0: number,
  word1: number,
  word2: number,
  word3: number,
): MotionObjectEntryInfo {
  return {
    tileIndex: word1 & 0x00ff,
    color: (word1 >>> 8) & 0x00ff,
    xRaw: (word2 & 0x3fe0) >>> 5,
    yRaw: (word0 & 0x3fe0) >>> 5,
    widthTiles: (word2 & 0x000f) + 1,
    heightTiles: (word0 & 0x000f) + 1,
    link: word3 & 0x003f,
    flipX: (word0 & 0x8000) !== 0,
    priority: (word2 & 0x8000) !== 0,
    timer: word1 === 0xffff,
  };
}

function motionObjectPaletteIndex(lookup: MotionObjectLookupInfo, priority: boolean): number {
  // Normal motion objects use Atari System 1's MO palette region:
  // color_base 0x100, granularity 8 => paletteIndex base 0x20.
  // High-priority MOs go through the translucency compositor in the original.
  // The TS renderer keeps the existing visual workaround for those, otherwise
  // the marble loses its blue sphere in warm gameplay frames.
  return priority
    ? HIGH_PRIORITY_MO_VISUAL_PALETTE_BASE + lookup.color
    : MOTION_OBJECT_PALETTE_BASE + (lookup.color << 1);
}

export function buildSpritesFromMotionObjectRam(
  spriteRam: Uint8Array,
  entryIndexes: number[],
  lookups: MotionObjectLookupInfo[] = [],
): SpriteCommand[] {
  const sprites: SpriteCommand[] = [];
  const useLegacyPackedLayout = isLikelyPackedMotionObjectRam(spriteRam);

  for (const rawEntryIndex of entryIndexes) {
    if (useLegacyPackedLayout) {
      const command = buildPackedSpriteCommand(spriteRam, rawEntryIndex, lookups);
      if (command !== undefined) sprites.push(command);
      continue;
    }

    const bankIndex = Math.floor(rawEntryIndex / MOTION_OBJECT_ENTRY_COUNT);
    const entryIndex = rawEntryIndex % MOTION_OBJECT_ENTRY_COUNT;
    if (
      bankIndex < 0 ||
      bankIndex >= MOTION_OBJECT_BANK_COUNT ||
      entryIndex < 0 ||
      entryIndex >= MOTION_OBJECT_ENTRY_COUNT
    ) continue;

    const bankBase = bankIndex * MOTION_OBJECT_BANK_BYTES;
    const word0Off = bankBase + entryIndex * MOTION_OBJECT_ENTRY_WORD_BYTES;
    const word1Off = word0Off + MOTION_OBJECT_WORD_STRIDE_BYTES;
    const word2Off = word1Off + MOTION_OBJECT_WORD_STRIDE_BYTES;
    const word3Off = word2Off + MOTION_OBJECT_WORD_STRIDE_BYTES;
    if (word3Off + 1 >= spriteRam.length) continue;

    const word0 =
      ((spriteRam[word0Off] ?? 0) << 8) | (spriteRam[word0Off + 1] ?? 0);
    const word1 =
      ((spriteRam[word1Off] ?? 0) << 8) | (spriteRam[word1Off + 1] ?? 0);
    const word2 =
      ((spriteRam[word2Off] ?? 0) << 8) | (spriteRam[word2Off + 1] ?? 0);
    const word3 =
      ((spriteRam[word3Off] ?? 0) << 8) | (spriteRam[word3Off + 1] ?? 0);
    const fields = decodeMotionObjectWords(word0, word1, word2, word3);
    if (fields.timer) continue;
    const lookup = lookups[fields.color];

    const command: SpriteCommand = {
      spriteIndex: fields.tileIndex,
      x: fields.xRaw,
      y: fields.yRaw,
      width: fields.widthTiles * 8,
      height: fields.heightTiles * 8,
      paletteIndex: 0x100 + fields.color,
      flipX: fields.flipX,
      priority: fields.priority ? 1 : 0,
      translucent: fields.priority,
    };

    if (lookup !== undefined && lookup.bank > 0) {
      command.spriteIndex = lookup.offset * 256 + fields.tileIndex;
      command.gfxBank = lookup.bank;
      command.bitsPerPixel = lookup.bpp;
      command.paletteIndex = motionObjectPaletteIndex(lookup, fields.priority);
    }

    sprites.push(command);
  }

  return sprites;
}

function isLikelyPackedMotionObjectRam(spriteRam: Uint8Array): boolean {
  if (spriteRam.length <= MOTION_OBJECT_BANK_BYTES) return true;

  const bankedWord1Entry0 =
    ((spriteRam[MOTION_OBJECT_WORD_STRIDE_BYTES] ?? 0) << 8) |
    (spriteRam[MOTION_OBJECT_WORD_STRIDE_BYTES + 1] ?? 0);
  const packedWord1Entry0 =
    ((spriteRam[2] ?? 0) << 8) |
    (spriteRam[3] ?? 0);
  const packedWord2Entry0 =
    ((spriteRam[4] ?? 0) << 8) |
    (spriteRam[5] ?? 0);

  return bankedWord1Entry0 === 0 && (packedWord1Entry0 !== 0 || packedWord2Entry0 !== 0);
}

function buildPackedSpriteCommand(
  spriteRam: Uint8Array,
  entryIndex: number,
  lookups: MotionObjectLookupInfo[],
): SpriteCommand | undefined {
  if (entryIndex < 0 || entryIndex >= MOTION_OBJECT_ENTRY_COUNT) return undefined;

  const byteOffset = entryIndex * LEGACY_PACKED_MOTION_OBJECT_ENTRY_BYTES;
  if (byteOffset + 7 >= spriteRam.length) return undefined;

  const word0 =
    ((spriteRam[byteOffset] ?? 0) << 8) | (spriteRam[byteOffset + 1] ?? 0);
  const word1 =
    ((spriteRam[byteOffset + 2] ?? 0) << 8) | (spriteRam[byteOffset + 3] ?? 0);
  const word2 =
    ((spriteRam[byteOffset + 4] ?? 0) << 8) | (spriteRam[byteOffset + 5] ?? 0);
  const word3 =
    ((spriteRam[byteOffset + 6] ?? 0) << 8) | (spriteRam[byteOffset + 7] ?? 0);
  const fields = decodeMotionObjectWords(word0, word1, word2, word3);
  if (fields.timer) return undefined;

  const command: SpriteCommand = {
    spriteIndex: fields.tileIndex,
    x: fields.xRaw,
    y: fields.yRaw,
    width: fields.widthTiles * 8,
    height: fields.heightTiles * 8,
    paletteIndex: 0x100 + fields.color,
    flipX: fields.flipX,
    priority: fields.priority ? 1 : 0,
    translucent: fields.priority,
  };

  const lookup = lookups[fields.color];
  if (lookup !== undefined && lookup.bank > 0) {
    command.spriteIndex = lookup.offset * 256 + fields.tileIndex;
    command.gfxBank = lookup.bank;
    command.bitsPerPixel = lookup.bpp;
    command.paletteIndex = motionObjectPaletteIndex(lookup, fields.priority);
  }

  return command;
}

export function walkMotionObjectLinkedList(
  spriteRam: Uint8Array,
  startEntry = 0,
  maxEntries = MOTION_OBJECT_ENTRY_COUNT,
): number[] {
  const entryIndexes: number[] = [];
  if (isLikelyPackedMotionObjectRam(spriteRam)) {
    const visited = new Set<number>();
    let entryIndex = startEntry & 0x3f;

    for (let count = 0; count < maxEntries; count += 1) {
      if (visited.has(entryIndex)) break;

      const byteOffset = entryIndex * LEGACY_PACKED_MOTION_OBJECT_ENTRY_BYTES;
      if (byteOffset + 7 >= spriteRam.length) break;

      visited.add(entryIndex);
      entryIndexes.push(entryIndex);

      const word3 =
        ((spriteRam[byteOffset + 6] ?? 0) << 8) | (spriteRam[byteOffset + 7] ?? 0);
      entryIndex = word3 & 0x003f;
    }

    return entryIndexes;
  }

  const visited = new Set<number>();
  const bankIndex = Math.floor(startEntry / MOTION_OBJECT_ENTRY_COUNT);
  const bankBaseEntry = bankIndex * MOTION_OBJECT_ENTRY_COUNT;
  const bankByteBase = bankIndex * MOTION_OBJECT_BANK_BYTES;
  let entryIndex = startEntry & 0x3f;

  for (let count = 0; count < maxEntries; count += 1) {
    if (visited.has(entryIndex)) break;

    const word3Off =
      bankByteBase +
      MOTION_OBJECT_WORD_STRIDE_BYTES * 3 +
      entryIndex * MOTION_OBJECT_ENTRY_WORD_BYTES;
    if (word3Off + 1 >= spriteRam.length) break;

    visited.add(entryIndex);
    entryIndexes.push(bankBaseEntry + entryIndex);

    const word3 =
      ((spriteRam[word3Off] ?? 0) << 8) | (spriteRam[word3Off + 1] ?? 0);
    entryIndex = word3 & 0x003f;
  }

  return entryIndexes;
}

export function buildSpritesFromMotionObjectList(
  spriteRam: Uint8Array,
  startEntry = 0,
  maxEntries = MOTION_OBJECT_ENTRY_COUNT,
  lookups: MotionObjectLookupInfo[] = [],
): SpriteCommand[] {
  return buildSpritesFromMotionObjectRam(
    spriteRam,
    walkMotionObjectLinkedList(spriteRam, startEntry, maxEntries),
    lookups,
  );
}

export function runtimeMotionObjectStartEntry(state: GameState): number {
  if (state.clock.levelEndScoreResumePending !== undefined || (state.workRam[0x39a] ?? 0) !== 0) {
    return motionObjectStartEntryFromAvControl(readWorkWordBE(state, 0x3b0));
  }
  return activeMotionObjectStartEntry(state);
}

export function runtimeMotionObjectCount(state: GameState): number {
  return Math.max(0, Math.min(MOTION_OBJECT_ENTRY_COUNT, readWorkWordBE(state, 0x406)));
}

export function runtimeMotionObjectEntryIndexes(state: GameState): number[] {
  const count = runtimeMotionObjectCount(state);
  if (count <= 0) return [];
  const startEntry = runtimeMotionObjectStartEntry(state);
  return Array.from({ length: count }, (_, index) => startEntry + index);
}

export function buildSpritesFromRuntimeMotionObjects(
  state: GameState,
  lookups: MotionObjectLookupInfo[] = [],
): SpriteCommand[] {
  const entryIndexes = runtimeMotionObjectEntryIndexes(state);
  if (entryIndexes.length === 0) {
    return buildSpritesFromMotionObjectList(
      state.spriteRam,
      visibleMotionObjectStartEntry(state),
      MOTION_OBJECT_ENTRY_COUNT,
      lookups,
    );
  }
  return buildSpritesFromMotionObjectRam(state.spriteRam, entryIndexes, lookups);
}

/**
 * Walk all 8 Atari System 1 MO banks. Each bank is a 0x200-byte slab with
 * 64 entries whose four words live in four 0x80-byte planes.
 */
export function walkMotionObjectAllBanks(
  spriteRam: Uint8Array,
  maxEntries = MOTION_OBJECT_ENTRY_COUNT,
): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (let bank = 0; bank < MOTION_OBJECT_BANK_COUNT; bank++) {
    const start = bank * MOTION_OBJECT_ENTRY_COUNT;
    for (const e of walkMotionObjectLinkedList(spriteRam, start, maxEntries)) {
      if (!seen.has(e)) {
        seen.add(e);
        ordered.push(e);
      }
    }
  }
  return ordered;
}

export function buildSpritesFromAllBanks(
  spriteRam: Uint8Array,
  maxEntries = MOTION_OBJECT_ENTRY_COUNT,
  lookups: MotionObjectLookupInfo[] = [],
): SpriteCommand[] {
  return buildSpritesFromMotionObjectRam(
    spriteRam,
    walkMotionObjectAllBanks(spriteRam, maxEntries),
    lookups,
  );
}

export function decodeVideoControlByte(value: number): VideoControlInfo {
  return {
    alphaBank: value & 0x01,
    playfieldTileBank: (value >>> 2) & 0x01,
    motionObjectBank: (value >>> 3) & 0x07,
  };
}

function readWorkWordBE(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

export function motionObjectStartEntryFromAvControl(value: number): number {
  return ((value >>> 3) & 0x07) * MOTION_OBJECT_ENTRY_COUNT;
}

export function activeMotionObjectStartEntry(state: GameState): number {
  return motionObjectStartEntryFromAvControl(readWorkWordBE(state, 0x3ae));
}

/**
 * Browser rendering happens after `tick()` has completed the main-thread body.
 * During the level-end score hold, FUN_26F3E has already emitted the cleaned
 * score/GOAL display list into *0x4003B0's next MO bank, while *0x4003AE may
 * still point at the previously latched gameplay bank. Prefer the pending bank
 * only for that blocking score-summary window, so stale award/tail objects do
 * not remain visible under the GOAL platform.
 */
export function visibleMotionObjectStartEntry(state: GameState): number {
  if (state.clock.levelEndScoreResumePending !== undefined) {
    return motionObjectStartEntryFromAvControl(readWorkWordBE(state, 0x3b0));
  }
  return activeMotionObjectStartEntry(state);
}

function buildDebugLabel(options: BuildFrameOptions): string | undefined {
  if (options.videoControlByte === undefined) return undefined;

  const video = decodeVideoControlByte(options.videoControlByte);
  return [
    "engine-frame",
    `alpha-bank-${video.alphaBank}`,
    `pf-bank-${video.playfieldTileBank}`,
    `mo-bank-${video.motionObjectBank}`,
  ].join(":");
}

export function buildFrame(state: GameState, options: BuildFrameOptions = {}): Frame {
  // Playfield RAM defaults to the state's live playfield buffer.
  const pfRam = options.playfieldRam ?? state.playfieldRam;
  const playfield =
    options.playfieldLookups !== undefined && pfRam !== undefined
      ? buildPlayfieldFromRam(pfRam, options.playfieldLookups)
      : [];
  // Level intro banners must not show stale attract/game-over motion objects,
  // but do not clear MO RAM: FUN_1CABA legitimately reads that address space
  // for some Beginner/L2 terrain rows.
  const suppressMotionObjects = state.clock.levelIntroBannerResumeTick !== undefined;
  const sprites =
    suppressMotionObjects
      ? []
      : options.motionObjects === "linked-list"
      ? buildSpritesFromMotionObjectList(
          state.spriteRam,
          options.motionObjectStartEntry,
          options.maxMotionObjectEntries,
          options.motionObjectLookups,
        )
      : options.motionObjects === "runtime-counter"
      ? buildSpritesFromRuntimeMotionObjects(
          state,
          options.motionObjectLookups,
        )
      : options.motionObjects === "all-banks"
      ? buildSpritesFromAllBanks(
          state.spriteRam,
          options.maxMotionObjectEntries,
          options.motionObjectLookups,
        )
      : [];

  const frame: Frame = {
    nativeSize: CLASSIC_NATIVE_SIZE,
    scrollX: options.scrollX ?? state.videoScrollX,
    scrollY: options.scrollY ?? state.videoScrollY,
    palette: buildPaletteFromColorRam(state.colorRam),
    playfield,
    sprites,
    alpha: buildAlphaFromRam(state.alphaRam),
  };
  const debugLabel = buildDebugLabel(options);
  if (debugLabel !== undefined) frame.debugLabel = debugLabel;

  return frame;
}
