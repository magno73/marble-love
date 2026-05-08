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
  bus as busNs,
  tick,
  bootInit,
  render as renderNs,
} from "@marble-love/engine";
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
const forceDemoFrame = searchParams.get("demo") === "1";
const forceRealRendering = searchParams.get("real") === "1";
// Synthetic demo solo in DEV se non forziamo nient'altro AND non c'è ROM picker
const useSyntheticDemoFrame =
  import.meta.env.DEV &&
  !forceRomPicker &&
  !forceEngineDiagnosticFrame &&
  !forceDemoFrame &&
  !forceRealRendering;

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

  // ─── Manual scroll override (debug aid) ───────────────────────────────────
  // Until the in-game state machine wires the PF scroll MMIO writes
  // autonomously, expose keyboard scroll for level exploration:
  //   ArrowUp/Down/Left/Right → scroll viewport across the 64×64 tilemap
  //   Hold Shift → 8× faster
  // Initial values from URL (?scrollX=N&scrollY=N) for deep-link sharing.
  const initScrollX = Number(searchParams.get("scrollX") ?? "0") | 0;
  const initScrollY = Number(searchParams.get("scrollY") ?? "0") | 0;
  s.videoScrollX = ((initScrollX % 512) + 512) % 512;
  s.videoScrollY = ((initScrollY % 512) + 512) % 512;
  const heldKeys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    if (
      e.key === "ArrowUp" || e.key === "ArrowDown" ||
      e.key === "ArrowLeft" || e.key === "ArrowRight" ||
      e.key === "Shift"
    ) {
      heldKeys.add(e.key);
      if (e.key.startsWith("Arrow")) e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => { heldKeys.delete(e.key); });

  // Render mode resolution priority:
  //   ?engine=1  → diagnostic frame
  //   ?demo=1    → demo (synthetic o ROM-backed)
  //   ?real=1    → forza real anche senza ROM (frame quasi vuoto)
  //   ROM caricata → REAL (default cambiato 2026-05-08)
  //   no ROM in DEV → synthetic demo
  //   altrimenti → real (frame potenzialmente vuoto)
  type RenderMode = "diagnostic" | "demo" | "real";
  const renderMode: RenderMode = forceEngineDiagnosticFrame
    ? "diagnostic"
    : forceDemoFrame
      ? "demo"
      : forceRealRendering
        ? "real"
        : rom !== undefined
          ? "real"
          : useSyntheticDemoFrame
            ? "demo"
            : "real";

  console.log(
    `[marble-love] renderMode=${renderMode} (rom=${rom !== undefined ? "real" : "none"}, ` +
    `dev=${import.meta.env.DEV}, query={engine=${forceEngineDiagnosticFrame},demo=${forceDemoFrame},real=${forceRealRendering}})`,
  );

  let frameCount = 0;
  app.ticker.add(() => {
    const dx = inputState.consumeDx();
    const dy = inputState.consumeDy();
    s.input.trackballDx = dx as typeof s.input.trackballDx;
    s.input.trackballDy = dy as typeof s.input.trackballDy;
    s.input.buttons = inputState.buttons as typeof s.input.buttons;

    // Keyboard scroll override (until in-game scroll-write wires autonomously).
    const scrollStep = heldKeys.has("Shift") ? 8 : 1;
    if (heldKeys.has("ArrowLeft"))  s.videoScrollX = (s.videoScrollX - scrollStep + 512) % 512;
    if (heldKeys.has("ArrowRight")) s.videoScrollX = (s.videoScrollX + scrollStep) % 512;
    if (heldKeys.has("ArrowUp"))    s.videoScrollY = (s.videoScrollY - scrollStep + 512) % 512;
    if (heldKeys.has("ArrowDown"))  s.videoScrollY = (s.videoScrollY + scrollStep) % 512;

    // runMainLoopBody=true se ROM reale: avanza state machine 1101E + refresh10FCE
    // ad ogni tick → spriteRam/workRam si popolano, gameplay simulation attiva.
    tick(s, { rom: tickRom, p1X: dx, p1Y: dy, runMainLoopBody: rom !== undefined });
    frameCount += 1;

    if (renderMode === "diagnostic") {
      renderer.drawFrame(
        buildEngineDiagnosticFrame(
          demoFrame,
          rom?.graphics.lookupTables.motionObjects,
          rom?.graphics.lookupTables.playfield,
        ),
      );
      demoFrame += 1;
    } else if (renderMode === "demo") {
      renderer.drawFrame(
        rom === undefined
          ? buildClassicDemoFrame(demoFrame)
          : buildRomBackedDemoFrame(rom.graphics, demoFrame),
      );
      demoFrame += 1;
    } else {
      // renderMode === "real"
      renderer.draw(s);
    }

    // Debug log ogni 60 frame: state RAM occupancy + Frame stats.
    if (frameCount % 60 === 0) {
      const pfNz = countNonZero(s.playfieldRam);
      const sprNz = countNonZero(s.spriteRam);
      const alpNz = countNonZero(s.alphaRam);
      const colNz = countNonZero(s.colorRam);
      // Frame stats: re-render-only se in real mode (altrimenti i campi
      // del frame demo non riflettono lo state).
      let frameStats = "";
      if (renderMode === "real") {
        const opts: Parameters<typeof renderNs.buildFrame>[1] = {};
        if (rom?.graphics.lookupTables.playfield) {
          opts.playfieldLookups = rom.graphics.lookupTables.playfield;
        }
        if (rom?.graphics.lookupTables.motionObjects) {
          opts.motionObjects = "linked-list";
          opts.motionObjectLookups = rom.graphics.lookupTables.motionObjects;
        }
        const f = renderNs.buildFrame(s, opts);
        frameStats =
          ` frame.tiles=${f.playfield.length} frame.sprites=${f.sprites.length} frame.alpha=${f.alpha.length}`;
      }
      console.log(
        `[marble-love f=${frameCount}] mode=${renderMode}` +
        ` scroll=(${s.videoScrollX},${s.videoScrollY})` +
        ` | pfRam=${pfNz}/${s.playfieldRam.length} sprRam=${sprNz}/${s.spriteRam.length}` +
        ` alpRam=${alpNz}/${s.alphaRam.length} colRam=${colNz}/${s.colorRam.length}` +
        frameStats,
      );
    }
  });
}

function countNonZero(buf: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) count += 1;
  }
  return count;
}
