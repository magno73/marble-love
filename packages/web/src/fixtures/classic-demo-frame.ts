import type { render as renderNs } from "@marble-love/engine";
import type { GraphicsLookupEntry, RomGraphicsAssets } from "../rom-graphics.js";

type Frame = renderNs.Frame;
type PaletteEntry = renderNs.PaletteEntry;
type TileCommand = renderNs.TileCommand;
type SpriteCommand = renderNs.SpriteCommand;
type AlphaCommand = renderNs.AlphaCommand;

const TILE_SIZE = 8;
const NATIVE_WIDTH = 336;
const NATIVE_HEIGHT = 240;

const palette: PaletteEntry[] = [
  { index: 0, rgba: { r: 8, g: 10, b: 18, a: 255 } },
  { index: 1, rgba: { r: 36, g: 74, b: 91, a: 255 } },
  { index: 2, rgba: { r: 48, g: 112, b: 98, a: 255 } },
  { index: 3, rgba: { r: 92, g: 141, b: 83, a: 255 } },
  { index: 4, rgba: { r: 172, g: 174, b: 109, a: 255 } },
  { index: 5, rgba: { r: 218, g: 182, b: 106, a: 255 } },
  { index: 6, rgba: { r: 202, g: 91, b: 87, a: 255 } },
  { index: 7, rgba: { r: 231, g: 232, b: 214, a: 255 } },
  { index: 8, rgba: { r: 58, g: 48, b: 82, a: 210 } },
  { index: 9, rgba: { r: 38, g: 32, b: 48, a: 170 } },
];

function isInsidePlatform(
  x: number,
  y: number,
  left: number,
  top: number,
  width: number,
  height: number,
): boolean {
  return x >= left && x < left + width && y >= top && y < top + height;
}

function isInsideRamp(x: number, y: number): boolean {
  const centerY = 176 - (x - 36) * 0.42;
  const taper = x < 82 || x > 262 ? 22 : 34;
  return x >= 34 && x <= 292 && Math.abs(y - centerY) <= taper;
}

function paletteForSurface(x: number, y: number): number | undefined {
  const onLowerPlatform = isInsidePlatform(x, y, 34, 150, 104, 54);
  const onUpperPlatform = isInsidePlatform(x, y, 202, 66, 104, 56);
  const onRamp = isInsideRamp(x, y);

  if (!onLowerPlatform && !onUpperPlatform && !onRamp) {
    const belowRamp = isInsideRamp(x, y - 14);
    return belowRamp ? 9 : 0;
  }

  const edge =
    y % 24 >= 16 ||
    (onLowerPlatform && (x < 42 || y > 190)) ||
    (onUpperPlatform && (x > 290 || y < 76));
  if (edge) return 5;

  const groove = Math.floor((x + y * 2) / 32) % 5 === 0;
  if (groove) return 2;

  return onRamp ? 4 : 3;
}

function buildPlayfield(frameNumber: number): TileCommand[] {
  const playfield: TileCommand[] = [];
  const columns = Math.ceil(NATIVE_WIDTH / TILE_SIZE);
  const rows = Math.ceil(NATIVE_HEIGHT / TILE_SIZE);
  const pulse = Math.floor(frameNumber / 18) % 4;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * TILE_SIZE;
      const y = row * TILE_SIZE;
      const paletteIndex = paletteForSurface(x + TILE_SIZE / 2, y + TILE_SIZE / 2);
      if (paletteIndex === undefined) continue;

      const ridge = Math.abs(row - column + pulse) % 7;
      playfield.push({
        tileIndex: (row * 11 + column * 3 + ridge) % 64,
        x,
        y,
        width: TILE_SIZE,
        height: TILE_SIZE,
        paletteIndex,
        priority: ridge,
      });
    }
  }

  return playfield;
}

function buildSprites(frameNumber: number): SpriteCommand[] {
  const bob = Math.round(Math.sin(frameNumber / 18) * 6);
  const drift = frameNumber % 96;

  return [
    {
      spriteIndex: 0,
      x: 140 + drift / 4,
      y: 122 + bob,
      width: 18,
      height: 18,
      paletteIndex: 7,
      priority: 2,
    },
    {
      spriteIndex: 1,
      x: 92,
      y: 150 - bob,
      width: 32,
      height: 12,
      paletteIndex: 6,
      flipX: frameNumber % 80 >= 40,
      priority: 1,
    },
    {
      spriteIndex: 2,
      x: 214,
      y: 90 + Math.round(Math.cos(frameNumber / 24) * 5),
      width: 40,
      height: 16,
      paletteIndex: 8,
      priority: 3,
      translucent: true,
    },
  ];
}

function buildAlpha(): AlphaCommand[] {
  const alpha: AlphaCommand[] = [];
  const topText = "1UP   000000   TIME 60";
  const bottomText = "CLASSIC FRAME DEMO";

  for (let i = 0; i < topText.length; i += 1) {
    if (topText[i] !== " ") {
      alpha.push({
        tileIndex: topText.charCodeAt(i),
        x: 8 + i * TILE_SIZE,
        y: 8,
        paletteIndex: 7,
        opaque: false,
      });
    }
  }

  for (let i = 0; i < bottomText.length; i += 1) {
    if (bottomText[i] !== " ") {
      alpha.push({
        tileIndex: bottomText.charCodeAt(i),
        x: 8 + i * TILE_SIZE,
        y: NATIVE_HEIGHT - 18,
        paletteIndex: 5,
        opaque: false,
      });
    }
  }

  return alpha;
}

export function buildClassicDemoFrame(frameNumber: number): Frame {
  return {
    nativeSize: { width: NATIVE_WIDTH, height: NATIVE_HEIGHT },
    scrollX: 0,
    scrollY: 0,
    palette,
    playfield: buildPlayfield(frameNumber),
    sprites: buildSprites(frameNumber),
    alpha: buildAlpha(),
    debugLabel: "synthetic-classic-demo",
  };
}

function firstDrawablePlayfieldLookup(
  graphics: RomGraphicsAssets,
  startIndex: number,
): { lookup: GraphicsLookupEntry; lookupIndex: number } {
  for (let i = 0; i < graphics.lookupTables.playfield.length; i += 1) {
    const lookupIndex = (startIndex + i) % graphics.lookupTables.playfield.length;
    const lookup = graphics.lookupTables.playfield[lookupIndex];
    if (lookup !== undefined && lookup.bank > 0) {
      return { lookup, lookupIndex };
    }
  }

  return {
    lookup: { offset: 0, bank: 1, color: 0, bpp: 4 },
    lookupIndex: 0,
  };
}

function firstDrawableSpriteLookup(
  graphics: RomGraphicsAssets,
  startIndex: number,
): { lookup: GraphicsLookupEntry; lookupIndex: number } {
  for (let i = 0; i < graphics.lookupTables.motionObjects.length; i += 1) {
    const lookupIndex = (startIndex + i) % graphics.lookupTables.motionObjects.length;
    const lookup = graphics.lookupTables.motionObjects[lookupIndex];
    if (lookup !== undefined && lookup.bank > 0) {
      return { lookup, lookupIndex };
    }
  }

  return {
    lookup: { offset: 0, bank: 1, color: 0, bpp: 4 },
    lookupIndex: 0,
  };
}

export function buildRomBackedDemoFrame(
  graphics: RomGraphicsAssets,
  frameNumber: number,
): Frame {
  const frame = buildClassicDemoFrame(frameNumber);
  const sampleStartX = 232;
  const sampleStartY = 154;

  frame.playfield = frame.playfield.map((tile, index) => {
    const inSampleStrip =
      tile.x >= sampleStartX &&
      tile.x < sampleStartX + 64 &&
      tile.y >= sampleStartY &&
      tile.y < sampleStartY + 24;
    if (!inSampleStrip) return tile;

    const { lookup, lookupIndex } = firstDrawablePlayfieldLookup(
      graphics,
      tile.tileIndex + index,
    );

    return {
      ...tile,
      tileIndex: lookup.offset * 256 + (tile.tileIndex & 0xff),
      gfxBank: lookup.bank,
      bitsPerPixel: lookup.bpp,
      paletteIndex: 0x20 + lookup.color * 8,
      priority: lookupIndex,
    };
  });

  frame.sprites = frame.sprites.map((sprite, index) => {
    const { lookup, lookupIndex } = firstDrawableSpriteLookup(
      graphics,
      sprite.spriteIndex + index,
    );

    return {
      ...sprite,
      spriteIndex: lookup.offset * 256 + (sprite.spriteIndex & 0xff),
      gfxBank: lookup.bank,
      bitsPerPixel: lookup.bpp,
      paletteIndex: 0x10 + lookup.color * 8,
      priority: lookupIndex,
    };
  });

  frame.debugLabel = "rom-backed-demo";
  return frame;
}
