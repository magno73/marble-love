/**
 * rom-loader.ts — legge un file ZIP MAME-style lato client e produce RomImage.
 *
 * **Status: STUB.** Phase 7: implementare unzip in-browser (es. fflate). Per
 * ora ritorniamo un placeholder vuoto. La ROM **non** viene mai uploadata.
 */

import type { RomImage } from "@marble-love/engine";

export async function extractRomZip(file: File): Promise<RomImage> {
  // TODO Phase 7: usare fflate per unzip in-browser.
  // Identificare i file (mb-1100.6f, mb-1101.6h, ...) per program/sound/tiles/sprites.
  console.log("rom file", file.name, file.size, "bytes");
  return {
    program: new Uint8Array(0),
    sound: new Uint8Array(0),
    tiles: new Uint8Array(0),
    sprites: new Uint8Array(0),
    proms: new Uint8Array(0),
  };
}
