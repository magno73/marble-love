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
  decodedAlpha: DecodedGraphicsPlaceholder;
  decodedTiles: DecodedGraphicsPlaceholder;
  decodedSprites: DecodedGraphicsPlaceholder;
}
