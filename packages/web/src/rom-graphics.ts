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

export interface RomGraphicsAssets {
  /** Alphanumerics/HUD tile ROM, `136032.104.f5`. */
  alpha: Uint8Array;
  /** Sparse System 1 tile graphics region, assembled at documented offsets. */
  tiles: Uint8Array;
  /** Motion-object graphics currently share the System 1 tile graphics region. */
  sprites: Uint8Array;
  /** Graphics PROMs: remap + color tables, 0x400 bytes total. */
  proms: Uint8Array;
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
