/**
 * Typed containers for user-supplied Marble Madness graphics bytes.
 *
 * These are raw local ROM bytes only. This file intentionally does not decode
 * planar tile/sprite graphics or derive any copyrighted assets.
 */

export interface RawRomEntry {
  name: string;
  bytes: Uint8Array;
}

export interface DecodedPalettePlaceholder {
  status: "not-decoded";
  source: "proms";
}

export interface GraphicsPromTables {
  remap: Uint8Array;
  color: Uint8Array;
}

export interface GraphicsLookupEntry {
  offset: number;
  bank: number;
  color: number;
  bpp: 4 | 5 | 6;
}

export interface GraphicsLookupTables {
  playfield: GraphicsLookupEntry[];
  motionObjects: GraphicsLookupEntry[];
}

export interface DecodedGraphicsPlaceholder {
  status: "not-decoded";
  source: "alpha" | "tiles" | "sprites";
}

export interface DecodedAlphaGlyph {
  tileIndex: number;
  width: 8;
  height: 8;
  /** 8x8 row-major pixel values, each 0..3. */
  pixels: Uint8Array;
}

export interface DecodedAlphaGraphics {
  status: "decoded";
  source: "alpha";
  tileWidth: 8;
  tileHeight: 8;
  glyphs: DecodedAlphaGlyph[];
}

export interface DecodedObjectTile {
  tileIndex: number;
  bankIndex: number;
  bpp: 4 | 5 | 6;
  width: 8;
  height: 8;
  /** 8x8 row-major pen values. */
  pixels: Uint8Array;
}

export interface RomGraphicsAssets {
  /** Alphanumerics/HUD tile ROM, `136032.104.f5`. */
  alpha: Uint8Array;
  /** Sparse System 1 tile graphics region, assembled at documented offsets. */
  tiles: Uint8Array;
  /** Motion-object graphics currently share the System 1 tile graphics region. */
  sprites: Uint8Array;
  /** Graphics PROMs: remap + color tables, 0x400 bytes total. */
  proms: Uint8Array;
  promTables: GraphicsPromTables;
  lookupTables: GraphicsLookupTables;
  /** Motherboard PROM bytes kept raw for future validation/use. */
  motherboardProms: RawRomEntry[];
  decodedPalette: DecodedPalettePlaceholder;
  decodedAlpha: DecodedAlphaGraphics;
  decodedTiles: DecodedGraphicsPlaceholder;
  decodedSprites: DecodedGraphicsPlaceholder;
}

const ALPHA_TILE_WIDTH = 8;
const ALPHA_TILE_HEIGHT = 8;
const ALPHA_TILE_BYTES = 16;
const ALPHA_PLANE_OFFSETS = [0, 4] as const;
const ALPHA_X_OFFSETS = [0, 1, 2, 3, 8, 9, 10, 11] as const;
const OBJECT_TILE_WIDTH = 8;
const OBJECT_TILE_HEIGHT = 8;
const OBJECT_TILE_BYTES = 8;
const OBJECT_PLANE_STRIDE = 0x10000;
const OBJECT_BANK_STRIDE = 0x80000;

const PROM1_BANK_4 = 0x80;
const PROM1_BANK_3 = 0x40;
const PROM1_BANK_2 = 0x20;
const PROM1_BANK_1 = 0x10;
const PROM1_OFFSET_MASK = 0x0f;
const PROM2_BANK_6_OR_7 = 0x80;
const PROM2_BANK_5 = 0x40;
const PROM2_PLANE_5_ENABLE = 0x20;
const PROM2_PLANE_4_ENABLE = 0x10;
const PROM2_PF_COLOR_MASK = 0x0f;
const PROM2_BANK_7 = 0x08;
const PROM2_MO_COLOR_MASK = 0x07;

export function splitGraphicsProms(proms: Uint8Array): GraphicsPromTables {
  return {
    remap: proms.slice(0x000, 0x200),
    color: proms.slice(0x200, 0x400),
  };
}

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

export function decodeGraphicsLookups(proms: Uint8Array): GraphicsLookupTables {
  const { remap, color } = splitGraphicsProms(proms);
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

function _readLsbFirstBit(bytes: Uint8Array, bitOffset: number): number {
  const byte = bytes[bitOffset >>> 3] ?? 0;
  return (byte >>> (bitOffset & 7)) & 1;
}
void _readLsbFirstBit;

/**
 * Layout selection per decodeObjectTile.
 * - "playfield": MAME atarisy1 gfx_tile_layout, plane stride 0x10000
 * - "mob": MAME atarisy1 gfx_mob_layout, plane stride 0x40000 (RGN_FRAC(1,4)
 *   di TILE_REGION_SIZE 0x100000)
 */
export type GfxLayoutKind = "playfield" | "mob";

export function decodeObjectTile(
  tiles: Uint8Array,
  bankIndex: number,
  tileIndex: number,
  bpp: 4 | 5 | 6,
  layout: GfxLayoutKind = "playfield",
): DecodedObjectTile {
  const pixels = new Uint8Array(OBJECT_TILE_WIDTH * OBJECT_TILE_HEIGHT);
  const planeStride = layout === "mob" ? 0x40000 : OBJECT_PLANE_STRIDE;
  const bankBase = layout === "mob" ? 0 : OBJECT_BANK_STRIDE * (bankIndex - 1);
  // MAME atarisy1 gfx_mob_layout planes: { 0, RGN_FRAC(1,4), RGN_FRAC(2,4),
  // RGN_FRAC(3,4) } con plane[0] = LSB del pen, plane[bpp-1] = MSB.
  // Per playfield (TS legacy): plane[0] = MSB (mantenuto per parity esistente).
  const planeOffsets = Array.from(
    { length: bpp },
    (_, plane) => (layout === "mob" ? plane : (bpp - 1 - plane)) * planeStride,
  );

  for (let y = 0; y < OBJECT_TILE_HEIGHT; y += 1) {
    for (let x = 0; x < OBJECT_TILE_WIDTH; x += 1) {
      let pen = 0;
      for (let plane = 0; plane < bpp; plane += 1) {
        const byteOffset =
          bankBase + (planeOffsets[plane] ?? 0) + tileIndex * OBJECT_TILE_BYTES + y;
        const shift = layout === "mob" ? plane : (bpp - 1 - plane);
        pen |= readMsbFirstBit(tiles, byteOffset * 8 + x) << shift;
      }
      pixels[y * OBJECT_TILE_WIDTH + x] = pen;
    }
  }

  return {
    tileIndex,
    bankIndex,
    bpp,
    width: OBJECT_TILE_WIDTH,
    height: OBJECT_TILE_HEIGHT,
    pixels,
  };
}

function readMsbFirstBit(bytes: Uint8Array, bitOffset: number): number {
  const byte = bytes[bitOffset >>> 3] ?? 0;
  return (byte >>> (7 - (bitOffset & 7))) & 1;
}

export function decodeAlphaRom(alpha: Uint8Array): DecodedAlphaGraphics {
  const glyphs: DecodedAlphaGlyph[] = [];
  const tileCount = Math.floor(alpha.length / ALPHA_TILE_BYTES);

  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    const tileBaseBit = tileIndex * ALPHA_TILE_BYTES * 8;
    const pixels = new Uint8Array(ALPHA_TILE_WIDTH * ALPHA_TILE_HEIGHT);

    for (let y = 0; y < ALPHA_TILE_HEIGHT; y += 1) {
      const rowBaseBit = tileBaseBit + y * 16;
      for (let x = 0; x < ALPHA_TILE_WIDTH; x += 1) {
        const pixelBit = ALPHA_X_OFFSETS[x] ?? 0;
        let pen = 0;
        for (let plane = 0; plane < ALPHA_PLANE_OFFSETS.length; plane += 1) {
          const planeBit = ALPHA_PLANE_OFFSETS[plane] ?? 0;
          pen |= readMsbFirstBit(alpha, rowBaseBit + pixelBit + planeBit) << plane;
        }
        pixels[y * ALPHA_TILE_WIDTH + x] = pen;
      }
    }

    glyphs.push({
      tileIndex,
      width: ALPHA_TILE_WIDTH,
      height: ALPHA_TILE_HEIGHT,
      pixels,
    });
  }

  return {
    status: "decoded",
    source: "alpha",
    tileWidth: ALPHA_TILE_WIDTH,
    tileHeight: ALPHA_TILE_HEIGHT,
    glyphs,
  };
}
