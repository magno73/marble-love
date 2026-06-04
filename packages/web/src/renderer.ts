/**
 * renderer.ts - PixiJS adapter for the neutral engine frame model.
 *
 * The engine produces a DOM-free `Frame`. This adapter only draws received
 * commands and must not read or mutate gameplay logic.
 */

import type { Application } from "pixi.js";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { render as renderNs } from "@marble-love/engine";
import type { GameState } from "@marble-love/engine";
import type {
  DecodedAlphaGlyph,
  DecodedAlphaGraphics,
  DecodedObjectTile,
  RomGraphicsAssets,
} from "./rom-graphics.js";
import { decodeObjectTile } from "./rom-graphics.js";

type Frame = renderNs.Frame;
type RgbaColor = renderNs.RgbaColor;

const DEFAULT_TILE_SIZE = 8;
const FALLBACK_COLOR = 0xff00ff;
const PLAYFIELD_TILEMAP_SIZE = 64 * DEFAULT_TILE_SIZE;

export interface Renderer {
  draw(state: GameState): void;
  drawFrame(frame: Frame): void;
}

interface ClassicLayers {
  viewport: Container;
  playfieldLayer: Container;
  spriteLayer: Container;
  alphaLayer: Container;
  chromeLayer: Container;
  alphaSpriteLayer: Container;
  spriteTextureLayer: Container;
  chromeGraphics: Graphics;
  playfieldGraphics: Graphics;
  spriteGraphics: Graphics;
  alphaGraphics: Graphics;
}

interface RendererAssets {
  alpha: DecodedAlphaGraphics | undefined;
  romGraphics: RomGraphicsAssets | undefined;
  alphaSpritePool: Sprite[];
  alphaTextureCache: Map<string, Texture>;
  playfieldSpritePool: Sprite[];
  playfieldTextureCache: Map<string, Texture>;
  motionSpritePool: Sprite[];
  motionTextureCache: Map<string, Texture>;
}

function rgbaToPixiColor(color: RgbaColor): number {
  return (color.r << 16) | (color.g << 8) | color.b;
}

function alphaFromRgba(color: RgbaColor): number {
  return Math.max(0, Math.min(1, color.a / 255));
}

function paletteLookup(frame: Frame, paletteIndex: number): RgbaColor {
  return (
    frame.palette.find((entry) => entry.index === paletteIndex)?.rgba ?? {
      r: 255,
      g: 0,
      b: 255,
      a: 255,
    }
  );
}

function exactPaletteLookup(frame: Frame, paletteIndex: number): RgbaColor | undefined {
  return frame.palette.find((entry) => entry.index === paletteIndex)?.rgba;
}

function usesMameMotionObjectCoordinates(frame: Frame, sprite: renderNs.SpriteCommand): boolean {
  return (
    frame.debugLabel !== "rom-backed-demo" &&
    sprite.gfxBank !== undefined &&
    sprite.bitsPerPixel !== undefined
  );
}

const MOTION_OBJECT_BITMAP_SIZE = 512;

function wrapMotionObjectViewportCoordinate(value: number, viewportExtent: number): number {
  const wrapped = value & (MOTION_OBJECT_BITMAP_SIZE - 1);
  return wrapped >= viewportExtent ? wrapped - MOTION_OBJECT_BITMAP_SIZE : wrapped;
}

export function motionObjectScreenPosition(
  frame: Frame,
  sprite: renderNs.SpriteCommand,
  height: number,
): { x: number; y: number } {
  if (!usesMameMotionObjectCoordinates(frame, sprite)) {
    return { x: sprite.x, y: sprite.y };
  }

  // MAME `atarimo.cpp::render_object`:
  //   xpos = xRaw + xoffset - xscroll
  //   ypos = -yRaw - yscroll - heightPx
  // System 1 sets yscroll=256 and never sets an MO xoffset.
  return {
    x: wrapMotionObjectViewportCoordinate(sprite.x, frame.nativeSize.width),
    y: wrapMotionObjectViewportCoordinate(-sprite.y - 256 - height, frame.nativeSize.height),
  };
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

export function wrappedPlayfieldDrawPositions(
  tile: { x: number; y: number; width: number; height: number },
  scroll: { x: number; y: number },
  viewport: { width: number; height: number },
  tilemapSize = PLAYFIELD_TILEMAP_SIZE,
): { x: number; y: number }[] {
  const baseX = positiveModulo(tile.x - scroll.x, tilemapSize);
  const baseY = positiveModulo(tile.y - scroll.y, tilemapSize);
  const xs = [baseX, baseX - tilemapSize];
  const ys = [baseY, baseY - tilemapSize];
  const out: { x: number; y: number }[] = [];

  for (const x of xs) {
    if (x >= viewport.width || x + tile.width <= 0) continue;
    for (const y of ys) {
      if (y >= viewport.height || y + tile.height <= 0) continue;
      out.push({ x, y });
    }
  }

  return out;
}

function applyViewportScale(app: Application, viewport: Container, frame: Frame): void {
  const screenWidth = app.renderer.width;
  const screenHeight = app.renderer.height;
  const scale = Math.max(
    1,
    Math.floor(
      Math.min(
        screenWidth / frame.nativeSize.width,
        screenHeight / frame.nativeSize.height,
      ),
    ),
  );

  viewport.scale.set(scale);
  viewport.x = Math.floor((screenWidth - frame.nativeSize.width * scale) / 2);
  viewport.y = Math.floor((screenHeight - frame.nativeSize.height * scale) / 2);
}

function objectPenColor(frame: Frame, paletteBase: number, pen: number): RgbaColor {
  // MAME `set_granularity(8)` for Atari System 1: each tile_info paletteIndex
  // occupies eight consecutive global palette slots. The pen value is added to
  // `paletteBase * 8`; see `atarisy1_v.cpp` and `gfxdecode_device`.
  const idx = paletteBase * 8 + pen;
  return (
    exactPaletteLookup(frame, idx) ??
    frame.palette[idx % frame.palette.length]?.rgba ??
    paletteLookup(frame, paletteBase)
  );
}

function drawObjectTileIntoImageData(
  frame: Frame,
  imageData: ImageData,
  tile: DecodedObjectTile,
  paletteBase: number,
  destinationX: number,
  destinationY: number,
  flipX: boolean,
  flipY: boolean,
  transparentPen0: boolean,
): void {
  const imageWidth = imageData.width;
  const imageHeight = imageData.height;
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const targetX = flipX ? imageWidth - 1 - (destinationX + x) : destinationX + x;
      const targetY = flipY ? imageHeight - 1 - (destinationY + y) : destinationY + y;
      if (
        targetX < 0 ||
        targetX >= imageWidth ||
        targetY < 0 ||
        targetY >= imageHeight
      ) {
        continue;
      }

      const pen = tile.pixels[y * tile.width + x] ?? 0;
      const color = objectPenColor(frame, paletteBase, pen);
      const offset = (targetY * imageWidth + targetX) * 4;
      imageData.data[offset] = color.r;
      imageData.data[offset + 1] = color.g;
      imageData.data[offset + 2] = color.b;
      // MAME's playfield tilemap is opaque. Only motion objects use
      // transparent pen 0; see `atarisy1_v.cpp` `s_mob_config`.
      imageData.data[offset + 3] = pen === 0 && transparentPen0 ? 0 : color.a;
    }
  }
}

function textureFromObjectCommand(
  frame: Frame,
  command: renderNs.TileCommand | renderNs.SpriteCommand,
  assets: RendererAssets,
): Texture {
  if (command.gfxBank === undefined || command.bitsPerPixel === undefined) {
    return Texture.EMPTY;
  }

  const tileIndex = "tileIndex" in command ? command.tileIndex : command.spriteIndex;
  const width = command.width ?? DEFAULT_TILE_SIZE;
  const height = command.height ?? DEFAULT_TILE_SIZE;
  const tilesWide = Math.max(1, Math.ceil(width / DEFAULT_TILE_SIZE));
  const tilesHigh = Math.max(1, Math.ceil(height / DEFAULT_TILE_SIZE));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return Texture.EMPTY;

  const imageData = context.createImageData(width, height);
  // Playfield TileCommand values are opaque; SpriteCommand values use
  // transparent pen 0.
  const isSprite = !("tileIndex" in command);
  for (let tileY = 0; tileY < tilesHigh; tileY += 1) {
    for (let tileX = 0; tileX < tilesWide; tileX += 1) {
      const objectTile = decodeObjectTile(
        assets.romGraphics?.tiles ?? new Uint8Array(),
        command.gfxBank,
        tileIndex + tileY * tilesWide + tileX,
        command.bitsPerPixel,
        isSprite ? "mob" : "playfield",
      );
      drawObjectTileIntoImageData(
        frame,
        imageData,
        objectTile,
        command.paletteIndex,
        tileX * DEFAULT_TILE_SIZE,
        tileY * DEFAULT_TILE_SIZE,
        command.flipX === true,
        command.flipY === true,
        isSprite,
      );
    }
  }
  context.putImageData(imageData, 0, 0);
  return Texture.from(canvas);
}

function objectTileTextureForCommand(
  frame: Frame,
  command: renderNs.TileCommand | renderNs.SpriteCommand,
  assets: RendererAssets,
): Texture | undefined {
  if (
    assets.romGraphics === undefined ||
    command.gfxBank === undefined ||
    command.bitsPerPixel === undefined
  ) {
    return undefined;
  }

  const tileIndex = "tileIndex" in command ? command.tileIndex : command.spriteIndex;
  const width = command.width ?? DEFAULT_TILE_SIZE;
  const height = command.height ?? DEFAULT_TILE_SIZE;
  const textureCache =
    "tileIndex" in command ? assets.playfieldTextureCache : assets.motionTextureCache;
  const cacheKey = [
    "tileIndex" in command ? "pf" : "mo",
    command.gfxBank,
    command.bitsPerPixel,
    tileIndex,
    command.paletteIndex,
    width,
    height,
    command.flipX === true ? 1 : 0,
    command.flipY === true ? 1 : 0,
  ].join(":");
  const cached = textureCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const texture = textureFromObjectCommand(frame, command, assets);
  textureCache.set(cacheKey, texture);
  return texture;
}

function acquirePlayfieldSprite(layers: ClassicLayers, assets: RendererAssets): Sprite {
  const sprite = assets.playfieldSpritePool.find((candidate) => !candidate.visible);
  if (sprite !== undefined) {
    sprite.visible = true;
    return sprite;
  }

  const created = new Sprite();
  created.roundPixels = true;
  layers.playfieldLayer.addChild(created);
  assets.playfieldSpritePool.push(created);
  return created;
}

function hidePlayfieldSprites(assets: RendererAssets): void {
  for (const sprite of assets.playfieldSpritePool) {
    sprite.visible = false;
  }
}

function acquireMotionSprite(layers: ClassicLayers, assets: RendererAssets): Sprite {
  const sprite = assets.motionSpritePool.find((candidate) => !candidate.visible);
  if (sprite !== undefined) {
    sprite.visible = true;
    return sprite;
  }

  const created = new Sprite();
  created.roundPixels = true;
  layers.spriteTextureLayer.addChild(created);
  assets.motionSpritePool.push(created);
  return created;
}

function hideMotionSprites(assets: RendererAssets): void {
  for (const sprite of assets.motionSpritePool) {
    sprite.visible = false;
  }
}

function drawPlayfield(
  frame: Frame,
  graphics: Graphics,
  layers: ClassicLayers,
  assets: RendererAssets,
): void {
  graphics.clear();
  hidePlayfieldSprites(assets);

  for (const tile of frame.playfield) {
    const width = tile.width ?? DEFAULT_TILE_SIZE;
    const height = tile.height ?? DEFAULT_TILE_SIZE;
    const drawPositions = wrappedPlayfieldDrawPositions(
      { x: tile.x, y: tile.y, width, height },
      { x: frame.scrollX, y: frame.scrollY },
      frame.nativeSize,
    );
    if (drawPositions.length === 0) continue;

    const texture = objectTileTextureForCommand(frame, tile, assets);
    const color = paletteLookup(frame, tile.paletteIndex);
    const shade = (tile.tileIndex + (tile.priority ?? 0)) % 3;

    for (const { x: drawX, y: drawY } of drawPositions) {
      if (texture !== undefined && texture !== Texture.EMPTY) {
        const sprite = acquirePlayfieldSprite(layers, assets);
        sprite.texture = texture;
        sprite.x = drawX;
        sprite.y = drawY;
        sprite.scale.set(1);
        sprite.alpha = 1;
        continue;
      }

      graphics
        .rect(drawX, drawY, width, height)
        .fill({ color: rgbaToPixiColor(color), alpha: alphaFromRgba(color) });

      if (shade === 0 && tile.paletteIndex !== 0 && tile.paletteIndex !== 9) {
        graphics.rect(drawX, drawY, width, 1).fill({ color: 0xffffff, alpha: 0.14 });
      }
    }
  }
}

function drawSprites(
  frame: Frame,
  graphics: Graphics,
  layers: ClassicLayers,
  assets: RendererAssets,
): void {
  graphics.clear();
  hideMotionSprites(assets);

  const sortedSprites = [...frame.sprites].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
  );

  for (const sprite of sortedSprites) {
    const texture = objectTileTextureForCommand(frame, sprite, assets);
    if (texture !== undefined && texture !== Texture.EMPTY) {
      const pixiSprite = acquireMotionSprite(layers, assets);
      pixiSprite.texture = texture;
      const pos = motionObjectScreenPosition(
        frame,
        sprite,
        sprite.height ?? texture.height,
      );
      pixiSprite.x = pos.x;
      pixiSprite.y = pos.y;
      pixiSprite.scale.set(1);
      pixiSprite.alpha = sprite.translucent === true ? 0.65 : 1;
      continue;
    }

    const color = paletteLookup(frame, sprite.paletteIndex);
    const width = sprite.width ?? 16;
    const height = sprite.height ?? 16;
    const alpha = sprite.translucent
      ? alphaFromRgba(color) * 0.65
      : alphaFromRgba(color);
    const pos = motionObjectScreenPosition(frame, sprite, height);
    const x = sprite.flipX ? pos.x - 1 : pos.x;
    const y = sprite.flipY ? pos.y - 1 : pos.y;

    if (sprite.spriteIndex === 0) {
      const radius = Math.min(width, height) / 2;
      graphics.circle(x + radius, y + radius, radius).fill({
        color: rgbaToPixiColor(color),
        alpha,
      });
      graphics.circle(x + radius - 4, y + radius - 4, Math.max(2, radius / 3)).fill({
        color: 0xffffff,
        alpha: 0.5,
      });
      graphics.ellipse(x + radius, y + height + 3, radius, 3).fill({
        color: 0x000000,
        alpha: 0.28,
      });
      continue;
    }

    graphics.rect(x, y, width, height).fill({ color: rgbaToPixiColor(color), alpha });

    graphics
      .rect(x + 2, y + 2, Math.max(1, width - 4), Math.max(1, height - 4))
      .fill({ color: 0x000000, alpha: sprite.translucent ? 0.12 : 0.2 });
  }
}

function drawFallbackAlphaGlyph(
  frame: Frame,
  graphics: Graphics,
  command: renderNs.AlphaCommand,
): void {
  const color = paletteLookup(frame, command.paletteIndex);
  const glyphPattern = command.tileIndex;

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const bit = (glyphPattern >> (row * 3 + column)) & 1;
      if (bit === 1) {
        graphics
          .rect(command.x + 1 + column * 2, command.y + 1 + row * 2, 2, 2)
          .fill({ color: rgbaToPixiColor(color), alpha: alphaFromRgba(color) });
      }
    }
  }
}

function _drawDecodedAlphaGlyph(
  frame: Frame,
  command: renderNs.AlphaCommand,
  alpha: DecodedAlphaGraphics,
  assets: RendererAssets,
): Texture | undefined {
  const glyph = alpha.glyphs[command.tileIndex];
  if (glyph === undefined) return undefined;

  return alphaTextureForGlyph(frame, command, glyph, assets);
}
void _drawDecodedAlphaGlyph;

function alphaTextureForGlyph(
  frame: Frame,
  command: renderNs.AlphaCommand,
  glyph: DecodedAlphaGlyph,
  assets: RendererAssets,
): Texture | undefined {
  const colors = [0, 1, 2, 3].map(
    (pen) =>
      exactPaletteLookup(frame, command.paletteIndex * 4 + pen) ??
      paletteLookup(frame, command.paletteIndex),
  );
  const key = [
    command.tileIndex,
    command.paletteIndex,
    command.opaque === true ? 1 : 0,
    ...colors.flatMap((color) => [color.r, color.g, color.b, color.a]),
  ].join(":");
  const cached = assets.alphaTextureCache.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = glyph.width;
  canvas.height = glyph.height;
  const context = canvas.getContext("2d");
  if (context === null) return undefined;

  const imageData = context.createImageData(glyph.width, glyph.height);
  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      const pen = glyph.pixels[y * glyph.width + x] ?? 0;
      const offset = (y * glyph.width + x) * 4;
      const color = colors[pen] ?? colors[0];
      imageData.data[offset] = color?.r ?? 255;
      imageData.data[offset + 1] = color?.g ?? 0;
      imageData.data[offset + 2] = color?.b ?? 255;
      imageData.data[offset + 3] =
        pen === 0 && command.opaque !== true ? 0 : (color?.a ?? 255);
    }
  }

  context.putImageData(imageData, 0, 0);
  const texture = Texture.from(canvas);
  assets.alphaTextureCache.set(key, texture);
  return texture;
}

function _acquireAlphaSprite(layers: ClassicLayers, assets: RendererAssets): Sprite {
  const sprite = assets.alphaSpritePool.find((candidate) => !candidate.visible);
  if (sprite !== undefined) {
    sprite.visible = true;
    return sprite;
  }

  const created = new Sprite();
  created.roundPixels = true;
  layers.alphaSpriteLayer.addChild(created);
  assets.alphaSpritePool.push(created);
  return created;
}
void _acquireAlphaSprite;

function hideAlphaSprites(assets: RendererAssets): void {
  for (const sprite of assets.alphaSpritePool) {
    sprite.visible = false;
  }
}



function drawAlpha(
  frame: Frame,
  graphics: Graphics,
  _layers: ClassicLayers,
  assets: RendererAssets,
): void {
  graphics.clear();
  hideAlphaSprites(assets);

  for (const command of frame.alpha) {
    if (assets.alpha === undefined) {
      drawFallbackAlphaGlyph(frame, graphics, command);
      continue;
    }
    const glyph = assets.alpha.glyphs[command.tileIndex];
    if (glyph === undefined) {
      drawFallbackAlphaGlyph(frame, graphics, command);
      continue;
    }
    // Draw directly with Graphics.rect. This avoids Pixi v8 canvas/Texture cache
    // collisions observed when regenerating many small glyph textures.
    const colors = [0, 1, 2, 3].map((pen) =>
      exactPaletteLookup(frame, command.paletteIndex * 4 + pen) ??
      paletteLookup(frame, command.paletteIndex),
    );
    for (let y = 0; y < glyph.height; y++) {
      for (let x = 0; x < glyph.width; x++) {
        const pen = glyph.pixels[y * glyph.width + x] ?? 0;
        if (pen === 0 && command.opaque !== true) continue;
        const c = colors[pen] ?? colors[0];
        if (c === undefined) continue;
        graphics
          .rect(command.x + x, command.y + y, 1, 1)
          .fill({ color: rgbaToPixiColor(c), alpha: alphaFromRgba(c) });
      }
    }
  }
}

function drawChrome(_frame: Frame, graphics: Graphics): void {
  // Chrome overlay intentionally stays empty during normal rendering; debug
  // palette swatches previously polluted frame captures.
  graphics.clear();
}

function initLayers(app: Application): ClassicLayers {
  const viewport = new Container();
  const playfieldLayer = new Container();
  const spriteLayer = new Container();
  const spriteTextureLayer = new Container();
  const alphaLayer = new Container();
  const alphaSpriteLayer = new Container();
  const chromeLayer = new Container();
  const chromeGraphics = new Graphics();
  const playfieldGraphics = new Graphics();
  const spriteGraphics = new Graphics();
  const alphaGraphics = new Graphics();

  app.stage.addChild(viewport);
  viewport.addChild(playfieldLayer);
  viewport.addChild(spriteLayer);
  viewport.addChild(alphaLayer);
  viewport.addChild(chromeLayer);
  playfieldLayer.addChild(playfieldGraphics);
  spriteLayer.addChild(spriteTextureLayer);
  spriteLayer.addChild(spriteGraphics);
  alphaLayer.addChild(alphaSpriteLayer);
  alphaLayer.addChild(alphaGraphics);
  chromeLayer.addChild(chromeGraphics);

  app.canvas.style.imageRendering = "pixelated";

  return {
    viewport,
    playfieldLayer,
    spriteLayer,
    alphaLayer,
    chromeLayer,
    alphaSpriteLayer,
    spriteTextureLayer,
    chromeGraphics,
    playfieldGraphics,
    spriteGraphics,
    alphaGraphics,
  };
}

/**
 * Indirect renderer: mirrors MAME `atarisy1` `screen_update` at pixel level.
 *
 *   1. PF bitmap_ind16: for each TileCommand, writes `paletteIndex * 8 + pen`
 *      (= global palette word index).
 *   2. MO bitmap_ind16: init 0xFFFF, then for each SpriteCommand writes
 *      `(color * 8) + pen | (priority << 12)`. transpen=0 → skip pixel.
 *   3. Merge: for each viewport pixel, applies MAME logic:
 *        if (mo[x] != 0xFFFF):
 *          if (mo[x] & PRIORITY_MASK): // bit 12+ set
 *            if ((mo[x] & 0x0f) != 1): // pen != transparent
 *              pf[x] = 0x300 + ((pf[x] & 0x0f) << 4) + (mo[x] & 0x0f)
 *          else:
 *            pf[x] = mo[x]
 *   4. Convert pfBitmap to ImageData RGBA via `frame.palette`.
 */
const PF_PRIORITY_PENS = 0x00; // Simplified: no playfield pen currently outranks MO.

function renderIndirectViewport(
  frame: Frame,
  graphics: RomGraphicsAssets,
  imageData: ImageData,
): void {
  const W = frame.nativeSize.width; // 336
  const H = frame.nativeSize.height; // 240
  const tilesRom = graphics.tiles ?? new Uint8Array();

  // Allocate PF and MO buffers. PF starts at 0x200, the first playfield palette
  // entry; otherwise Uint16Array's zero default would select alpha palette 0 in
  // areas outside playfield tiles. MO stays 0xFFFF as the transparent sentinel.
  const pf = new Uint16Array(W * H);
  pf.fill(0x200);
  const mo = new Uint16Array(W * H);
  mo.fill(0xffff);

  // PF bitmap: render playfield TileCommand values.
  for (const tile of frame.playfield) {
    if (tile.gfxBank === undefined || tile.bitsPerPixel === undefined) continue;
    const w = tile.width ?? 8;
    const h = tile.height ?? 8;
    const drawPositions = wrappedPlayfieldDrawPositions(
      { x: tile.x, y: tile.y, width: w, height: h },
      { x: frame.scrollX, y: frame.scrollY },
      frame.nativeSize,
    );
    if (drawPositions.length === 0) continue;

    const t = decodeObjectTile(tilesRom, tile.gfxBank, tile.tileIndex, tile.bitsPerPixel, "playfield");
    const baseIdx = tile.paletteIndex * 8;
    for (const { x: drawX, y: drawY } of drawPositions) {
      for (let py = 0; py < h; py++) {
        const dy = drawY + py;
        if (dy < 0 || dy >= H) continue;
        for (let px = 0; px < w; px++) {
          const dx = drawX + px;
          if (dx < 0 || dx >= W) continue;
          const sx = tile.flipX === true ? (w - 1 - px) : px;
          const sy = tile.flipY === true ? (h - 1 - py) : py;
          const pen = t.pixels[sy * 8 + sx] ?? 0;
          // Playfield is opaque (NO transparent pen 0).
          pf[dy * W + dx] = (baseIdx + pen) & 0x0fff;
        }
      }
    }
  }

  // MO bitmap: render SpriteCommand values.
  for (const sprite of frame.sprites) {
    if (sprite.gfxBank === undefined || sprite.bitsPerPixel === undefined) continue;
    const w = sprite.width ?? 8;
    const h = sprite.height ?? 8;
    const pos = motionObjectScreenPosition(frame, sprite, h);
    const drawX = pos.x;
    const drawY = pos.y;
    const offScreen = drawX >= W || drawY >= H || drawX + w <= 0 || drawY + h <= 0;
    if (offScreen) continue;

    // sprite.paletteIndex is already normalized by the engine: normal MO uses
    // 0x20 + color * 2, while high-priority MO keeps the 0x40 + color path.
    const baseIdx = sprite.paletteIndex * 8;
    const priorityBit = (sprite.priority ?? 0) > 0 ? 0x1000 : 0;

    // Decode tile-by-tile; motion objects can be multi-tile.
    const tilesWide = Math.max(1, Math.ceil(w / 8));
    const tilesHigh = Math.max(1, Math.ceil(h / 8));
    for (let ty = 0; ty < tilesHigh; ty++) {
      for (let tx = 0; tx < tilesWide; tx++) {
        const tIdx = sprite.spriteIndex + ty * tilesWide + tx;
        const t = decodeObjectTile(tilesRom, sprite.gfxBank, tIdx, sprite.bitsPerPixel, "mob");
        for (let py = 0; py < 8; py++) {
          const dy = drawY + ty * 8 + py;
          if (dy < 0 || dy >= H) continue;
          for (let px = 0; px < 8; px++) {
            const dx = drawX + tx * 8 + (sprite.flipX === true ? (7 - px) : px);
            if (dx < 0 || dx >= W) continue;
            const pen = t.pixels[py * 8 + px] ?? 0;
            // Sprite transpen=0: pen 0 = transparent (no draw).
            if (pen === 0) continue;
            // Cap pen at 7 (3-bit effective for MOB granularity 8).
            const effectivePen = pen > 7 ? 7 : pen;
            mo[dy * W + dx] = (baseIdx + effectivePen) | priorityBit;
          }
        }
      }
    }
  }

  // Merge MO over PF, matching MAME `atarisy1` `screen_update`.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const mox = mo[idx]!;
      if (mox === 0xffff) continue;
      const pfx = pf[idx]!;
      if (mox & 0x1000) {
        // High priority: translucency layer
        // MAME: if ((mo & 0x0f) != 1): pf = 0x300 + ((pf & 0x0f) << 4) + (mo & 0x0f)
        // Current simplification: the translucency region is zero in the
        // captured window, so direct MO color keeps the marble visible.
        if ((mox & 0x0f) !== 1) {
          pf[idx] = mox & 0x0fff;
        }
      } else {
        // Low priority: write MO unless PF priority pens set
        const pfLowPen = pfx & 0x07;
        if ((PF_PRIORITY_PENS & (1 << pfLowPen)) === 0) {
          pf[idx] = mox & 0x0fff;
        }
      }
    }
  }

  // Convert indexed color to RGBA via palette lookup.
  const data = imageData.data;
  for (let i = 0; i < W * H; i++) {
    const palIdx = pf[i]!;
    const entry = frame.palette[palIdx];
    const off = i * 4;
    if (entry !== undefined) {
      data[off] = entry.rgba.r;
      data[off + 1] = entry.rgba.g;
      data[off + 2] = entry.rgba.b;
      data[off + 3] = 255;
    } else {
      data[off] = 0; data[off + 1] = 0; data[off + 2] = 0; data[off + 3] = 255;
    }
  }
}

function rendererAssetsFromRom(graphics?: RomGraphicsAssets): RendererAssets {
  return {
    alpha:
      graphics?.decodedAlpha.status === "decoded" ? graphics.decodedAlpha : undefined,
    romGraphics: graphics,
    alphaSpritePool: [],
    alphaTextureCache: new Map(),
    playfieldSpritePool: [],
    playfieldTextureCache: new Map(),
    motionSpritePool: [],
    motionTextureCache: new Map(),
  };
}

export function initRenderer(
  app: Application,
  graphics?: RomGraphicsAssets,
  options: { indirect?: boolean } = {},
): Renderer {
  const layers = initLayers(app);
  const assets = rendererAssetsFromRom(graphics);

  // Indirect renderer: bitmap_ind16 PF + MO buffers, screen merge matching
  // atarisy1_v.cpp screen_update. Convert ind16 -> RGBA through the palette.
  // One Pixi Sprite for the viewport. Activated via ?indirect=1.
  let indirectSprite: Sprite | undefined;
  let indirectCanvas: HTMLCanvasElement | undefined;
  let indirectImageData: ImageData | undefined;
  let indirectTexture: Texture | undefined;
  if (options.indirect === true) {
    indirectCanvas = document.createElement("canvas");
    indirectCanvas.width = 336;
    indirectCanvas.height = 240;
    const ctx2d = indirectCanvas.getContext("2d");
    if (ctx2d !== null) {
      indirectImageData = ctx2d.createImageData(336, 240);
      indirectTexture = Texture.from(indirectCanvas, true);
    }
    indirectSprite = new Sprite();
    if (indirectTexture !== undefined) {
      indirectSprite.texture = indirectTexture;
    }
    layers.playfieldLayer.addChild(indirectSprite);
  }

  return {
    draw(state: GameState): void {
      const opts: Parameters<typeof renderNs.buildFrame>[1] = {};
      if (graphics?.lookupTables.playfield) {
        opts.playfieldLookups = graphics.lookupTables.playfield;
      }
      if (graphics?.lookupTables.motionObjects) {
        opts.motionObjects = "runtime-counter";
        opts.motionObjectLookups = graphics.lookupTables.motionObjects;
      }
      this.drawFrame(renderNs.buildFrame(state, opts));
    },

    drawFrame(frame: Frame): void {
      applyViewportScale(app, layers.viewport, frame);

      if (
        options.indirect === true &&
        indirectSprite !== undefined &&
        indirectCanvas !== undefined &&
        indirectImageData !== undefined &&
        graphics !== undefined
      ) {
        // MAME bit-perfect indirect rendering: PF/MO scratch buffers + screen merge.
        renderIndirectViewport(frame, graphics, indirectImageData);
        const ctx2d = indirectCanvas.getContext("2d");
        if (ctx2d !== null) ctx2d.putImageData(indirectImageData, 0, 0);
        if (indirectTexture === undefined) {
          indirectTexture = Texture.from(indirectCanvas, true);
          indirectSprite.texture = indirectTexture;
        } else {
          indirectTexture.source.update();
        }
        indirectSprite.x = 0;
        indirectSprite.y = 0;
        // Skip drawPlayfield/drawSprites — combined in the indirectSprite.
        // Alpha layer (HUD) on top as a separate pass — that stays on the direct path.
        // Clear playfield/sprite graphics fallback layer.
        layers.playfieldGraphics.clear();
        layers.spriteGraphics.clear();
        hidePlayfieldSprites(assets);
        hideMotionSprites(assets);
        drawAlpha(frame, layers.alphaGraphics, layers, assets);
        drawChrome(frame, layers.chromeGraphics);
        return;
      }

      drawPlayfield(frame, layers.playfieldGraphics, layers, assets);
      drawSprites(frame, layers.spriteGraphics, layers, assets);
      drawAlpha(frame, layers.alphaGraphics, layers, assets);
      drawChrome(frame, layers.chromeGraphics);

      if (frame.palette.length === 0) {
        layers.alphaGraphics.rect(0, 0, 1, 1).fill({ color: FALLBACK_COLOR, alpha: 0 });
      }
    },
  };
}
