/**
 * renderer.ts — adapter PixiJS per il renderer dell'engine.
 *
 * L'engine produce `Frame { tiles, sprites, scrollX, scrollY }` (neutro).
 * Qui traduciamo in PIXI.Container con sprite/tile.
 *
 * Phase 7: implementazione completa con texture atlas estratti dalla ROM
 * (decoded da `tools/rom_prep.py` o on-the-fly da `bus.rom.tiles`).
 */

import type { Application } from "pixi.js";
import { Container, Graphics } from "pixi.js";
import { render as renderNs } from "@marble-love/engine";
import type { GameState } from "@marble-love/engine";

export interface Renderer {
  draw(state: GameState): void;
}

export function initRenderer(app: Application): Renderer {
  const root = new Container();
  app.stage.addChild(root);

  // Placeholder visuale: rettangolo che ruota leggermente, per dimostrare
  // che il loop tickea. Phase 7: sostituire con tile/sprite veri.
  const ph = new Graphics();
  ph.rect(-32, -32, 64, 64).fill({ color: 0xff5f5f });
  ph.x = app.canvas.width / 2;
  ph.y = app.canvas.height / 2;
  root.addChild(ph);

  return {
    draw(state: GameState): void {
      const frame = renderNs.buildFrame(state);
      ph.rotation = (frame.scrollX || (state.clock.frame as unknown as number)) * 0.01;
      // TODO Phase 7: pool di sprite/tile, diff frame-by-frame.
    },
  };
}
