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
import { state as stateNs, bus as busNs, tick, bootInit } from "@marble-love/engine";
import { initInput } from "./input.js";
import {
  buildClassicDemoFrame,
  buildRomBackedDemoFrame,
} from "./fixtures/classic-demo-frame.js";
import { buildEngineDiagnosticFrame } from "./fixtures/engine-diagnostic-frame.js";
import { initRenderer } from "./renderer.js";
import { extractRomZipFiles } from "./rom-loader.js";

const splash = document.getElementById("splash") as HTMLDivElement;
const fileInput = document.getElementById("rom-input") as HTMLInputElement;
const btn = document.getElementById("rom-btn") as HTMLButtonElement;
const romStatus = document.getElementById("rom-status") as HTMLParagraphElement;
const searchParams = new URLSearchParams(window.location.search);
const forceRomPicker = searchParams.get("rom") === "1";
const forceEngineDiagnosticFrame = searchParams.get("engine") === "1";
const useSyntheticDemoFrame =
  import.meta.env.DEV && !forceRomPicker && !forceEngineDiagnosticFrame;

function setRomStatus(message: string, tone: "idle" | "ok" | "error" = "idle"): void {
  romStatus.textContent = message;
  romStatus.dataset.tone = tone;
}

btn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const files = fileInput.files;
  if (!files || files.length === 0) return;
  try {
    btn.disabled = true;
    setRomStatus("Validazione ROM locale in corso...");
    const rom = await extractRomZipFiles(files);
    const warningText =
      rom.validation.warnings.length > 0
        ? ` (${rom.validation.warnings.length} avvisi di formato)`
        : "";
    setRomStatus(
      `ROM valida: ${rom.validation.fileCount} file verificati CRC32${warningText}.`,
      "ok",
    );
    splash.remove();
    await startGame(rom);
  } catch (err) {
    console.error(err);
    setRomStatus(
      "Errore caricando la ROM: " + (err instanceof Error ? err.message : err),
      "error",
    );
    btn.disabled = false;
  }
});

if (useSyntheticDemoFrame || (import.meta.env.DEV && forceEngineDiagnosticFrame)) {
  splash.remove();
  void startGame();
}

async function startGame(
  rom?: Awaited<ReturnType<typeof extractRomZipFiles>>,
): Promise<void> {
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
  // ROM real (se utente l'ha caricata) → mainTick legge palette tables.
  // Altrimenti ROM vuota: tick gira ma le palette anim sono no-op.
  const tickRom = rom ?? busNs.emptyRomImage();
  // Boot init: pattern color RAM, palette base, state machine globals.
  // preloadLevel=0 (level 1) per pre-caricare la tilemap via Codex chain
  // → state.playfieldRam popolata, renderer mostra subito il livello.
  // Solo se ROM reale è disponibile (i lookup ROM tile servono per dispatcher).
  bootInit(s, tickRom, rom !== undefined ? { preloadLevel: 0 } : {});

  const renderer = initRenderer(app, rom?.graphics);
  const inputState = initInput();
  let demoFrame = 0;
  const useRomBackedDemoFrame = rom !== undefined;

  app.ticker.add(() => {
    const dx = inputState.consumeDx();
    const dy = inputState.consumeDy();
    s.input.trackballDx = dx as typeof s.input.trackballDx;
    s.input.trackballDy = dy as typeof s.input.trackballDy;
    s.input.buttons = inputState.buttons as typeof s.input.buttons;
    // runMainLoopBody=true se ROM reale: avanza state machine 1101E + refresh10FCE
    // ad ogni tick → spriteRam/workRam si popolano, gameplay simulation attiva.
    tick(s, { rom: tickRom, p1X: dx, p1Y: dy, runMainLoopBody: rom !== undefined });
    if (forceEngineDiagnosticFrame) {
      renderer.drawFrame(
        buildEngineDiagnosticFrame(
          demoFrame,
          rom?.graphics.lookupTables.motionObjects,
          rom?.graphics.lookupTables.playfield,
        ),
      );
      demoFrame += 1;
    } else if (useSyntheticDemoFrame || useRomBackedDemoFrame) {
      renderer.drawFrame(
        rom === undefined
          ? buildClassicDemoFrame(demoFrame)
          : buildRomBackedDemoFrame(rom.graphics, demoFrame),
      );
      demoFrame += 1;
    } else {
      renderer.draw(s);
    }
  });
}
