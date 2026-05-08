/**
 * render.ts — adapter di rendering. **NON usa PixiJS direttamente.**
 *
 * Il pacchetto `engine` deve restare puro (no DOM, no WebGL). Qui esponiamo
 * tipi neutri (`SpriteCommand`, `TileCommand`, `Frame`) che il pacchetto
 * `@marble-love/web` (Vite + PixiJS) traduce in draw call.
 *
 * Questa indirezione serve a:
 *  - Eseguire l'engine in CLI/test senza PixiJS in dipendenza (Phase 5 — diff).
 *  - Permettere swap del backend grafico (Canvas2D, WebGPU) senza toccare l'engine.
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
  /** Indice nel tile bank della ROM o fixture sintetica. */
  tileIndex: number;
  gfxBank?: number;
  bitsPerPixel?: 4 | 5 | 6;
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** Codice color/palette del System 1. */
  paletteIndex: number;
  flipX?: boolean;
  flipY?: boolean;
  priority?: number;
}

export interface SpriteCommand {
  /** Indice nello sprite RAM (motion object) o fixture sintetica. */
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
  /** Indice nel tile alphanumerics/HUD. */
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
  /** Coord di scroll della tilemap (System 1 supporta scroll H/V). */
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
  motionObjects?: "none" | "linked-list";
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
const MOTION_OBJECT_ENTRY_BYTES = 8;

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
    const fields = decodePlayfieldWord(word);
    const lookup = lookups[fields.lookupIndex];
    if (lookup === undefined) continue;

    commands.push({
      tileIndex: lookup.offset * 256 + fields.tileIndexLow,
      gfxBank: lookup.bank,
      bitsPerPixel: lookup.bpp,
      x: (index % 64) * 8,
      y: Math.floor(index / 64) * 8,
      width: 8,
      height: 8,
      paletteIndex: 0x20 + lookup.color * 8,
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

export function buildSpritesFromMotionObjectRam(
  spriteRam: Uint8Array,
  entryIndexes: number[],
  lookups: MotionObjectLookupInfo[] = [],
): SpriteCommand[] {
  const sprites: SpriteCommand[] = [];

  for (const entryIndex of entryIndexes) {
    if (entryIndex < 0 || entryIndex >= 64) continue;

    const byteOffset = entryIndex * 8;
    if (byteOffset + 7 >= spriteRam.length) continue;

    const word0 =
      ((spriteRam[byteOffset] ?? 0) << 8) | (spriteRam[byteOffset + 1] ?? 0);
    const word1 =
      ((spriteRam[byteOffset + 2] ?? 0) << 8) | (spriteRam[byteOffset + 3] ?? 0);
    const word2 =
      ((spriteRam[byteOffset + 4] ?? 0) << 8) | (spriteRam[byteOffset + 5] ?? 0);
    const word3 =
      ((spriteRam[byteOffset + 6] ?? 0) << 8) | (spriteRam[byteOffset + 7] ?? 0);
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
      command.paletteIndex = 0x10 + lookup.color * 8;
    }

    sprites.push(command);
  }

  return sprites;
}

export function walkMotionObjectLinkedList(
  spriteRam: Uint8Array,
  startEntry = 0,
  maxEntries = MOTION_OBJECT_ENTRY_COUNT,
): number[] {
  const entryIndexes: number[] = [];
  const visited = new Set<number>();
  let entryIndex = startEntry & 0x3f;

  for (let count = 0; count < maxEntries; count += 1) {
    if (visited.has(entryIndex)) break;

    const byteOffset = entryIndex * MOTION_OBJECT_ENTRY_BYTES;
    if (byteOffset + 7 >= spriteRam.length) break;

    visited.add(entryIndex);
    entryIndexes.push(entryIndex);

    const word3 =
      ((spriteRam[byteOffset + 6] ?? 0) << 8) | (spriteRam[byteOffset + 7] ?? 0);
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

export function decodeVideoControlByte(value: number): VideoControlInfo {
  return {
    alphaBank: value & 0x01,
    playfieldTileBank: (value >>> 2) & 0x01,
    motionObjectBank: (value >>> 3) & 0x07,
  };
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

/** Genera la lista draw del frame corrente.
 *  Default conservativo: palette/alpha soltanto. Gli sprite da motion-object RAM
 *  sono opt-in finché bank/register video e priority merge non sono persistenti. */
export function buildFrame(state: GameState, options: BuildFrameOptions = {}): Frame {
  // Playfield RAM: usa state.playfieldRam come default; options.playfieldRam
  // override (es. demo fixtures). Lookups sempre da options (richiede ROM).
  const pfRam = options.playfieldRam ?? state.playfieldRam;
  const playfield =
    options.playfieldLookups !== undefined && pfRam !== undefined
      ? buildPlayfieldFromRam(pfRam, options.playfieldLookups)
      : [];
  const sprites =
    options.motionObjects === "linked-list"
      ? buildSpritesFromMotionObjectList(
          state.spriteRam,
          options.motionObjectStartEntry,
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
