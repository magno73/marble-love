/**
 * renderer.ts — adapter PixiJS per frame classici astratti.
 *
 * L'engine produce un `Frame` neutro. Questo adapter disegna solo i comandi
 * ricevuti, senza leggere o modificare la logica di gioco.
 */

import type { Application } from "pixi.js";
import { Container, Graphics } from "pixi.js";
import { render as renderNs } from "@marble-love/engine";
import type { GameState } from "@marble-love/engine";
import type { DecodedAlphaGraphics, RomGraphicsAssets } from "./rom-graphics.js";

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
  chromeGraphics: Graphics;
  playfieldGraphics: Graphics;
  spriteGraphics: Graphics;
  alphaGraphics: Graphics;
}

interface RendererAssets {
  alpha?: DecodedAlphaGraphics;
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

function drawPlayfield(frame: Frame, graphics: Graphics): void {
  graphics.clear();

  for (const tile of frame.playfield) {
    const color = paletteLookup(frame, tile.paletteIndex);
    const width = tile.width ?? DEFAULT_TILE_SIZE;
    const height = tile.height ?? DEFAULT_TILE_SIZE;
    const shade = (tile.tileIndex + (tile.priority ?? 0)) % 3;

    graphics
      .rect(tile.x, tile.y, width, height)
      .fill({ color: rgbaToPixiColor(color), alpha: alphaFromRgba(color) });

    if (shade === 0) {
      graphics.rect(tile.x, tile.y, width, 1).fill({ color: 0xffffff, alpha: 0.14 });
    }
  }
}

function drawSprites(frame: Frame, graphics: Graphics): void {
  graphics.clear();

  const sortedSprites = [...frame.sprites].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
  );

  for (const sprite of sortedSprites) {
    const color = paletteLookup(frame, sprite.paletteIndex);
    const width = sprite.width ?? 16;
    const height = sprite.height ?? 16;
    const alpha = sprite.translucent
      ? alphaFromRgba(color) * 0.65
      : alphaFromRgba(color);
    const x = sprite.flipX ? sprite.x - 1 : sprite.x;
    const y = sprite.flipY ? sprite.y - 1 : sprite.y;

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
  graphics: Graphics,
  command: renderNs.AlphaCommand,
  alpha: DecodedAlphaGraphics,
): boolean {
  const glyph = alpha.glyphs[command.tileIndex];
  if (glyph === undefined) return false;

  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      const pen = glyph.pixels[y * glyph.width + x] ?? 0;
      if (pen === 0 && command.opaque !== true) continue;

      const color = paletteLookup(frame, command.paletteIndex * 4 + pen);
      graphics
        .rect(command.x + x, command.y + y, 1, 1)
        .fill({ color: rgbaToPixiColor(color), alpha: alphaFromRgba(color) });
    }
  }

  return true;
}

function drawAlpha(frame: Frame, graphics: Graphics, assets: RendererAssets): void {
  graphics.clear();

  for (const command of frame.alpha) {
    const backgroundAlpha = command.opaque ? 0.72 : 0.18;

    if (command.opaque) {
      graphics
        .rect(command.x, command.y, DEFAULT_TILE_SIZE, DEFAULT_TILE_SIZE)
        .fill({ color: 0x000000, alpha: backgroundAlpha });
    }

    if (
      assets.alpha === undefined ||
      !drawDecodedAlphaGlyph(frame, graphics, command, assets.alpha)
    ) {
      drawFallbackAlphaGlyph(frame, graphics, command);
    }
  }
}

function drawChrome(frame: Frame, graphics: Graphics): void {
  graphics.clear();
  graphics
    .rect(0, 0, frame.nativeSize.width, frame.nativeSize.height)
    .stroke({ color: 0x101820, alpha: 1, width: 1 });

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
  const alphaLayer = new Container();
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
  spriteLayer.addChild(spriteGraphics);
  alphaLayer.addChild(alphaGraphics);
  chromeLayer.addChild(chromeGraphics);

  app.canvas.style.imageRendering = "pixelated";

  return {
    viewport,
    playfieldLayer,
    spriteLayer,
    alphaLayer,
    chromeLayer,
    chromeGraphics,
    playfieldGraphics,
    spriteGraphics,
    alphaGraphics,
  };
}

function rendererAssetsFromRom(graphics?: RomGraphicsAssets): RendererAssets {
  return graphics?.decodedAlpha.status === "decoded"
    ? { alpha: graphics.decodedAlpha }
    : {};
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
      drawPlayfield(frame, layers.playfieldGraphics);
      drawSprites(frame, layers.spriteGraphics);
      drawAlpha(frame, layers.alphaGraphics, assets);
      drawChrome(frame, layers.chromeGraphics);

      if (frame.palette.length === 0) {
        layers.alphaGraphics.rect(0, 0, 1, 1).fill({ color: FALLBACK_COLOR, alpha: 0 });
      }
    },
  };
}
