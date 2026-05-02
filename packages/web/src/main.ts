/**
 * main.ts — entry point del frontend.
 *
 * 1. Mostra splash con file picker.
 * 2. Utente seleziona marble.zip → leggiamo con FileReader (mai upload server).
 * 3. Inizializziamo l'engine, cre`iamo PixiJS app, attacchiamo input handlers.
 * 4. Ticking: requestAnimationFrame → engine.tick() → render adapter → PixiJS.
 *
 * Phase 7: questo file diventa funzionale. Per ora è skeleton.
 */

import { Application } from "pixi.js";
import {
  state as stateNs,
  tick,
} from "@marble-love/engine";
import { initInput } from "./input.js";
import { initRenderer } from "./renderer.js";
import { extractRomZip } from "./rom-loader.js";

const splash = document.getElementById("splash") as HTMLDivElement;
const fileInput = document.getElementById("rom-input") as HTMLInputElement;
const btn = document.getElementById("rom-btn") as HTMLButtonElement;

btn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const rom = await extractRomZip(file);
    splash.remove();
    await startGame(rom);
  } catch (err) {
    console.error(err);
    alert("Errore caricando la ROM: " + (err instanceof Error ? err.message : err));
  }
});

async function startGame(rom: Awaited<ReturnType<typeof extractRomZip>>): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#0a0a0a",
    resizeTo: window,
    antialias: false,
    autoDensity: true,
    resolution: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
  });
  document.body.appendChild(app.canvas);

  const s = stateNs.emptyGameState();
  // TODO Phase 7: inizializzare bus con la ROM caricata, attivare engine.
  void rom;

  const renderer = initRenderer(app);
  const inputState = initInput();

  app.ticker.add(() => {
    s.input.trackballDx = inputState.consumeDx() as typeof s.input.trackballDx;
    s.input.trackballDy = inputState.consumeDy() as typeof s.input.trackballDy;
    s.input.buttons = inputState.buttons as typeof s.input.buttons;
    tick(s);
    renderer.draw(s);
  });
}
