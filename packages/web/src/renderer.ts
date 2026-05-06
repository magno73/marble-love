/**
 * renderer.ts — adapter PixiJS per frame classici astratti.
 *
 * L'engine produce un `Frame` neutro. Questo adapter disegna solo i comandi
 * ricevuti, senza leggere o modificare la logica di gioco.
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

function textureFromObjectTile(
  frame: Frame,
  tile: DecodedObjectTile,
  paletteBase: number,
): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = tile.width;
  canvas.height = tile.height;
  const context = canvas.getContext("2d");
  if (context === null) return Texture.EMPTY;

  const imageData = context.createImageData(tile.width, tile.height);
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const pen = tile.pixels[y * tile.width + x] ?? 0;
      const color =
        exactPaletteLookup(frame, paletteBase + pen) ??
        frame.palette[(paletteBase + pen) % frame.palette.length]?.rgba ??
        paletteLookup(frame, paletteBase);
      const offset = (y * tile.width + x) * 4;
      imageData.data[offset] = color.r;
      imageData.data[offset + 1] = color.g;
      imageData.data[offset + 2] = color.b;
      imageData.data[offset + 3] = pen === 0 ? 0 : color.a;
    }
  }

  context.putImageData(imageData, 0, 0);
  return Texture.from(canvas, true);
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
  const textureCache =
    "tileIndex" in command ? assets.playfieldTextureCache : assets.motionTextureCache;
  const cacheKey = [
    "tileIndex" in command ? "pf" : "mo",
    command.gfxBank,
    command.bitsPerPixel,
    tileIndex,
    command.paletteIndex,
  ].join(":");
  const cached = textureCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const tile = decodeObjectTile(
    assets.romGraphics.tiles,
    command.gfxBank,
    tileIndex,
    command.bitsPerPixel,
  );
  const texture = textureFromObjectTile(frame, tile, command.paletteIndex);
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
    const texture = objectTileTextureForCommand(frame, tile, assets);
    if (texture !== undefined && texture !== Texture.EMPTY) {
      const sprite = acquirePlayfieldSprite(layers, assets);
      sprite.texture = texture;
      sprite.x = tile.x;
      sprite.y = tile.y;
      sprite.scale.x = (tile.width ?? DEFAULT_TILE_SIZE) / DEFAULT_TILE_SIZE;
      sprite.scale.y = (tile.height ?? DEFAULT_TILE_SIZE) / DEFAULT_TILE_SIZE;
      sprite.alpha = 1;
      continue;
    }

    const color = paletteLookup(frame, tile.paletteIndex);
    const width = tile.width ?? DEFAULT_TILE_SIZE;
    const height = tile.height ?? DEFAULT_TILE_SIZE;
    const shade = (tile.tileIndex + (tile.priority ?? 0)) % 3;

    graphics
      .rect(tile.x, tile.y, width, height)
      .fill({ color: rgbaToPixiColor(color), alpha: alphaFromRgba(color) });

    if (shade === 0 && tile.paletteIndex !== 0 && tile.paletteIndex !== 9) {
      graphics.rect(tile.x, tile.y, width, 1).fill({ color: 0xffffff, alpha: 0.14 });
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
      pixiSprite.x = sprite.x;
      pixiSprite.y = sprite.y;
      pixiSprite.scale.x = (sprite.width ?? 16) / DEFAULT_TILE_SIZE;
      pixiSprite.scale.y = (sprite.height ?? 16) / DEFAULT_TILE_SIZE;
      pixiSprite.alpha = sprite.translucent === true ? 0.65 : 1;
      continue;
    }

    const color = paletteLookup(frame, sprite.paletteIndex);
    const width = sprite.width ?? 16;
    const height = sprite.height ?? 16;
    const alpha = sprite.translucent
      ? alphaFromRgba(color) * 0.65
      : alphaFromRgba(color);
    const x = sprite.flipX ? sprite.x - 1 : sprite.x;
    const y = sprite.flipY ? sprite.y - 1 : sprite.y;

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

function drawDecodedAlphaGlyph(
  frame: Frame,
  command: renderNs.AlphaCommand,
  alpha: DecodedAlphaGraphics,
  assets: RendererAssets,
): Texture | undefined {
  const glyph = alpha.glyphs[command.tileIndex];
  if (glyph === undefined) return undefined;

  return alphaTextureForGlyph(frame, command, glyph, assets);
}

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
  const texture = Texture.from(canvas, true);
  assets.alphaTextureCache.set(key, texture);
  return texture;
}

function acquireAlphaSprite(layers: ClassicLayers, assets: RendererAssets): Sprite {
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

function hideAlphaSprites(assets: RendererAssets): void {
  for (const sprite of assets.alphaSpritePool) {
    sprite.visible = false;
  }
}

function drawAlpha(
  frame: Frame,
  graphics: Graphics,
  layers: ClassicLayers,
  assets: RendererAssets,
): void {
  graphics.clear();
  hideAlphaSprites(assets);

  for (const command of frame.alpha) {
    const backgroundAlpha = command.opaque ? 0.72 : 0.18;

    if (command.opaque) {
      graphics
        .rect(command.x, command.y, DEFAULT_TILE_SIZE, DEFAULT_TILE_SIZE)
        .fill({ color: 0x000000, alpha: backgroundAlpha });
    }

    const texture =
      assets.alpha === undefined
        ? undefined
        : drawDecodedAlphaGlyph(frame, command, assets.alpha, assets);
    if (texture !== undefined) {
      const sprite = acquireAlphaSprite(layers, assets);
      sprite.texture = texture;
      sprite.x = command.x;
      sprite.y = command.y;
    } else {
      drawFallbackAlphaGlyph(frame, graphics, command);
    }
  }
}

function drawChrome(frame: Frame, graphics: Graphics): void {
  graphics.clear();
  graphics
    .rect(0, 0, frame.nativeSize.width, frame.nativeSize.height)
    .stroke({ color: 0x101820, alpha: 1, width: 1 });

  const palettePreview = frame.palette.slice(0, 16);
  for (let i = 0; i < palettePreview.length; i += 1) {
    const color = palettePreview[i]?.rgba;
    if (color === undefined) continue;
    graphics
      .rect(frame.nativeSize.width - 72 + i * 4, 4, 3, 3)
      .fill({ color: rgbaToPixiColor(color), alpha: alphaFromRgba(color) });
  }

  if (frame.debugLabel === undefined) return;

  const blockCount = Math.min(16, frame.debugLabel.length);
  for (let i = 0; i < blockCount; i += 1) {
    const code = frame.debugLabel.charCodeAt(i);
    const color = code % 2 === 0 ? 0x8ee6ad : 0xffd37a;
    graphics
      .rect(frame.nativeSize.width - 6 - i * 5, frame.nativeSize.height - 6, 3, 3)
      .fill({ color, alpha: 0.9 });
  }
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

export function initRenderer(app: Application, graphics?: RomGraphicsAssets): Renderer {
  const layers = initLayers(app);
  const assets = rendererAssetsFromRom(graphics);

  return {
    draw(state: GameState): void {
      this.drawFrame(renderNs.buildFrame(state));
    },

    drawFrame(frame: Frame): void {
      applyViewportScale(app, layers.viewport, frame);
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
