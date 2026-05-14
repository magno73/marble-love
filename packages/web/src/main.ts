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
  wrap,
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
const forceAutoLoad = searchParams.get("autoLoad") === "1";
const forcePlay = searchParams.get("play") === "1";
const forceCoinStart = searchParams.get("coinStart") === "1";
const playableSeedName = searchParams.get("playableSeed");
const DEFAULT_WARM_PLAY_LOOP_RESET = 180;
// Synthetic demo solo in DEV se non forziamo nient'altro AND non c'è ROM picker
// E NON c'è autoLoad (autoLoad fa partire startGame con ROM dopo fetch async).
const useSyntheticDemoFrame =
  import.meta.env.DEV &&
  !forceRomPicker &&
  !forceEngineDiagnosticFrame &&
  !forceDemoFrame &&
  !forceRealRendering &&
  !forceAutoLoad;

function activeMotionObjectStartEntry(state: ReturnType<typeof stateNs.emptyGameState>): number {
  const avControl = (((state.workRam[0x3ae] ?? 0) << 8) | (state.workRam[0x3af] ?? 0)) & 0xffff;
  return ((avControl >>> 3) & 0x07) * 64;
}

function setRomStatus(message: string, tone: "idle" | "ok" | "error" = "idle"): void {
  romStatus.textContent = message;
  romStatus.dataset.tone = tone;
}

btn.addEventListener("click", () => fileInput.click());

// ?autoLoad=1 — DEV ONLY: fetcha /roms/marble.zip + /roms/atarisy1.zip
// (symlinkati in public/roms) e li carica come File-like → extractRomZipFiles.
// Per screenshot automatici / E2E test senza file picker.
if (searchParams.get("autoLoad") === "1") {
  void (async () => {
    try {
      setRomStatus("Auto-loading ROMs from /roms/...");
      btn.disabled = true;
      const [r1, r2] = await Promise.all([
        fetch("/roms/marble.zip"),
        fetch("/roms/atarisy1.zip"),
      ]);
      if (!r1.ok || !r2.ok) throw new Error(`fetch fail: ${r1.status}/${r2.status}`);
      const [b1, b2] = await Promise.all([r1.blob(), r2.blob()]);
      const f1 = new File([b1], "marble.zip");
      const f2 = new File([b2], "atarisy1.zip");
      const dt = new DataTransfer();
      dt.items.add(f1);
      dt.items.add(f2);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {
      setRomStatus("autoLoad failed: " + (e instanceof Error ? e.message : e), "error");
      btn.disabled = false;
    }
  })();
}

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
  // fullScreenInit popola lo spriteRam (visibili 2 sprite a 160,160) ma cancella
  // l'HUD "SCORE" — opt-in via ?fullScreenInit=1.
  const useFullScreenInit = searchParams.get("fullScreenInit") === "1";

  // ─── MAME warm state (snapshot-hybrid mode) ───────────────────────────────
  // ?mameDump=1 → fetch /mame_state.json e usa come bootInit({warmState}).
  // L'engine TS parte da quel state e può continuare via tick(N).
  // ?mameLive=1 → come mameDump ma NON freeza il tick (lascia evolvere).
  let mameDumpFrozen = false;
  type WarmState = NonNullable<NonNullable<Parameters<typeof bootInit>[2]>["warmState"]>;
  const hex2bytes = (hex: string, len: number): Uint8Array => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len && i * 2 + 1 < hex.length; i++) {
      out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
  };
  const loadPlayableSeedWarmState = async (seedName: string): Promise<WarmState | undefined> => {
    const safeSeedName = seedName.replace(/[^a-z0-9_-]/gi, "");
    const r = await fetch(`/scenarios/playable/${safeSeedName}.seed.json`);
    if (!r.ok) throw new Error(`fetch fail: ${r.status}`);
    const seed = await r.json() as {
      frame: number;
      slapsticBank?: number;
      workRam: string;
      playfieldRam: string;
      spriteRam: string;
      alphaRam: string;
      colorRam: string;
    };
    const workRam = hex2bytes(seed.workRam, 0x2000);
    return {
      workRam,
      playfieldRam: hex2bytes(seed.playfieldRam, 0x2000),
      spriteRam: hex2bytes(seed.spriteRam, 0x1000),
      alphaRam: hex2bytes(seed.alphaRam, 0x1000),
      colorRam: hex2bytes(seed.colorRam, 0x800),
      videoScrollY: (((workRam[0x02] ?? 0) << 8) | (workRam[0x03] ?? 0)) & 0x1ff,
      videoScrollX: 0,
      slapsticBank: typeof seed.slapsticBank === "number" ? seed.slapsticBank & 3 : 1,
    };
  };
  let warmState: WarmState | undefined;
  let warmStateIsPlayableSeed = false;
  const useMameDump = searchParams.get("mameDump") === "1";
  const useMameLive = searchParams.get("mameLive") === "1";
  const useCoinStartFlow =
    warmState === undefined &&
    rom !== undefined &&
    (forceCoinStart || (forcePlay && playableSeedName === null && !useMameDump && !useMameLive));
  let coinStartWarmState: WarmState | undefined;
  if (playableSeedName !== null) {
    try {
      warmState = await loadPlayableSeedWarmState(playableSeedName);
      warmStateIsPlayableSeed = true;
      console.log(`[warmState] loaded playable seed ${playableSeedName}`);
    } catch (e) {
      console.warn("[warmState] playable seed fetch failed:", e);
    }
  } else if (useCoinStartFlow) {
    try {
      coinStartWarmState = await loadPlayableSeedWarmState("coin_start_to_level1");
      console.log("[marble-love] prepared live gameplay seed coin_start_to_level1");
    } catch (e) {
      console.warn("[marble-love] live gameplay seed fetch failed:", e);
    }
  } else if (useMameDump || useMameLive) {
    try {
      const r = await fetch("/mame_state.json");
      if (r.ok) {
        const dump = await r.json() as {
          frame: number;
          slapsticBank?: number;
          workRam: string;
          playfieldRam: string;
          spriteRam: string;
          alphaRam: string;
          colorRam: string;
        };
        const querySlapsticBank = searchParams.has("slapsticBank")
          ? Number(searchParams.get("slapsticBank"))
          : Number.NaN;
        const dumpSlapsticBank = typeof dump.slapsticBank === "number" ? dump.slapsticBank : Number.NaN;
        const warmSlapsticBank = Number.isFinite(querySlapsticBank)
          ? querySlapsticBank & 3
          : Number.isFinite(dumpSlapsticBank) && dumpSlapsticBank >= 0
            ? dumpSlapsticBank & 3
            : 1;
        warmState = {
          workRam: hex2bytes(dump.workRam, 0x2000),
          playfieldRam: hex2bytes(dump.playfieldRam, 0x2000),
          spriteRam: hex2bytes(dump.spriteRam, 0x1000),
          alphaRam: hex2bytes(dump.alphaRam, 0x1000),
          colorRam: hex2bytes(dump.colorRam, 0x800),
          videoScrollY: (((parseInt(dump.workRam.substr(4, 2), 16) << 8) |
                          parseInt(dump.workRam.substr(6, 2), 16)) & 0x1ff),
          videoScrollX: 0,
          slapsticBank: warmSlapsticBank,
        };
        if (useMameDump) mameDumpFrozen = true;
        console.log(`[warmState] loaded MAME frame ${dump.frame} (frozen=${mameDumpFrozen})`);
      }
    } catch (e) {
      console.warn("[warmState] fetch failed:", e);
    }
  }

  bootInit(
    s,
    tickRom,
    warmState !== undefined
      ? { warmState }
      : rom !== undefined
        ? useCoinStartFlow
          ? {}
          : { preloadLevel: 0, fullScreenInit: useFullScreenInit }
        : {},
  );
  if (warmStateIsPlayableSeed) {
    // Playable warm seeds are MAME frame_done snapshots. The validated replay
    // probes auto-select phase 1 for these windows; phase 0 advances the
    // scroll/body interleave one vblank early and can expose stale PF rows.
    s.clock.mainLoopBodyTicks = wrap.as_u32(1);
  }
  if (useCoinStartFlow) {
    // Start from the attract/start gate instead of showing a preloaded level.
    // The full 6502 coin-credit path is not emulated yet, so browser coin
    // pulses feed the gateCheck callback below.
    s.workRam[0x390] = 0x00;
    s.workRam[0x391] = 0x01;
    s.workRam[0x3a8] = 0x6f;
    s.workRam[0x3aa] = 0x6f;
    s.workRam[0x3ac] = 0x00;
    console.log("[marble-love] coin/start flow enabled: press 5 (coin), then Enter/Space (START1)");
  }

  // Default ON: indirect renderer = MAME bit-perfect bitmap_ind16 path.
  // Disable con ?indirect=0 per fallback al renderer Pixi diretto (debug).
  const useIndirect = searchParams.get("indirect") !== "0";
  const renderer = initRenderer(app, rom?.graphics, { indirect: useIndirect });
  if (useIndirect) {
    console.log("[marble-love] indirect renderer enabled (MAME bit-perfect bitmap_ind16 path)");
  }
  const inputState = initInput();
  let browserCoinCredits = 0;
  let previousInputButtons = 0;
  let manualPlayStarted = false;
  let demoFrame = 0;

  // ─── Manual scroll override (debug aid) ───────────────────────────────────
  // Until the in-game state machine wires the PF scroll MMIO writes
  // autonomously, expose keyboard scroll for level exploration:
  //   ArrowUp/Down/Left/Right → scroll viewport across the 64×64 tilemap
  //   Hold Shift → 8× faster
  // Initial values from URL (?scrollX=N&scrollY=N) for deep-link sharing.
  const hasScrollOverride = searchParams.has("scrollX") || searchParams.has("scrollY");
  if (hasScrollOverride || warmState === undefined) {
    // Override solo se l'utente ha esplicitato scrollX/scrollY o se non c'è
    // warmState. In modalità mameDump/mameLive lo scroll è già impostato
    // dal warmState (workRam[0x00..0x03]) — non vogliamo zerare.
    const initScrollX = Number(searchParams.get("scrollX") ?? "0") | 0;
    const initScrollY = Number(searchParams.get("scrollY") ?? "0") | 0;
    s.videoScrollX = ((initScrollX % 512) + 512) % 512;
    s.videoScrollY = ((initScrollY % 512) + 512) % 512;
  }
  const scrollOverrideEnabled = !forcePlay;
  const heldKeys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    if (scrollOverrideEnabled && (
      e.key === "ArrowUp" || e.key === "ArrowDown" ||
      e.key === "ArrowLeft" || e.key === "ArrowRight" ||
      e.key === "Shift"
    )) {
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
    // Trackball MMIO absolute values (0..255 wrap-around). processAxis
    // engine-side calcola delta = cur - prev (mod 256). Mantenere il valore
    // assoluto integrato evita spurious delta a key-up.
    const p1XAbs = inputState.consumeP1X();
    const p1YAbs = inputState.consumeP1Y();
    const p2XAbs = inputState.consumeP2X();
    const p2YAbs = inputState.consumeP2Y();
    const inputButtons = inputState.buttons;
    s.input.buttons = inputButtons as typeof s.input.buttons;
    const coinPulses = inputState.consumeCoinPulses();
    if (useCoinStartFlow && coinPulses > 0) {
      browserCoinCredits = Math.min(9, browserCoinCredits + coinPulses);
      console.log(`[marble-love] coin accepted, credits=${browserCoinCredits}`);
    }
    const startPressedThisFrame =
      (inputButtons & 0x01) !== 0 && (previousInputButtons & 0x01) === 0;
    previousInputButtons = inputButtons;
    if (
      useCoinStartFlow &&
      !manualPlayStarted &&
      startPressedThisFrame &&
      browserCoinCredits > 0 &&
      coinStartWarmState !== undefined
    ) {
      browserCoinCredits -= 1;
      bootInit(s, tickRom, { warmState: coinStartWarmState });
      // Preserve the MAME dispatcher state in the warm playable seed. The
      // validated coin/start windows stay in 0x400390=1 and still read live
      // trackball MMIO; forcing state 0 made arbitrary play paths diverge
      // from MAME scroll/respawn cadence.
      s.clock.mainLoopBodyTicks = wrap.as_u32(1);
      inputState.setP1Absolute(s.workRam[0x18 + 0xc9] ?? 0xff, s.workRam[0x18 + 0xc8] ?? 0xff);
      manualPlayStarted = true;
      console.log(`[marble-love] START1 accepted, live gameplay seed loaded, credits=${browserCoinCredits}`);
    }

    // Keyboard scroll override (until in-game scroll-write wires autonomously).
    if (scrollOverrideEnabled) {
      const scrollStep = heldKeys.has("Shift") ? 8 : 1;
      if (heldKeys.has("ArrowLeft"))  s.videoScrollX = (s.videoScrollX - scrollStep + 512) % 512;
      if (heldKeys.has("ArrowRight")) s.videoScrollX = (s.videoScrollX + scrollStep) % 512;
      if (heldKeys.has("ArrowUp"))    s.videoScrollY = (s.videoScrollY - scrollStep + 512) % 512;
      if (heldKeys.has("ArrowDown"))  s.videoScrollY = (s.videoScrollY + scrollStep) % 512;
    }

    // Se mameDump attivo, lo state è frozen → no tick (preserve dump bit-perfect).
    // Se mameLive (warmState ma non frozen): tick con runMainLoopBody=false
    // (= preserve warm state al 100% — runMainLoopBody=true introduce drift
    // via refreshHelper13EE6). Vedi commit B2: zero[0x006] block ha portato
    // pf 93%→100%. Stesso effetto di disabilitare runMainLoopBody.
    if (!mameDumpFrozen) {
      // ?play=1 → forza runMainLoopBody=true ANCHE con warmState (= gameplay
      //          dal warm bootstrap MAME). Default: solo se non c'è warmState.
      // ?loopReset=N → replay loop: ogni N tick ricarica warmState (= evita
      //   drift catastrofico cumulativo che spinge marble fuori viewport).
      //   Per la demo warm live, defaultiamo a 180 frame: il modello runtime
      //   è validato bit-perfect sui primi 100 frame e resta visivamente sano
      //   nel segmento iniziale. `loopReset=0` disabilita il guardrail.
      const loopResetParam = searchParams.get("loopReset");
      const defaultLoopResetN =
        forcePlay && warmState !== undefined && playableSeedName === null
          ? DEFAULT_WARM_PLAY_LOOP_RESET
          : 0;
      const parsedLoopResetN = parseInt(loopResetParam ?? String(defaultLoopResetN), 10);
      const loopResetN = Number.isFinite(parsedLoopResetN) ? parsedLoopResetN : 0;
      const mainLoopBody =
        forcePlay || (rom !== undefined && warmState === undefined);
      if (loopResetN > 0 && warmState !== undefined && (frameCount % loopResetN) === 0 && frameCount > 0) {
        bootInit(s, tickRom, { warmState });
      }
      const tickOptions: Parameters<typeof tick>[1] = {
        rom: tickRom,
        p1X: p1XAbs, p1Y: p1YAbs,
        p2X: p2XAbs, p2Y: p2YAbs,
        inputMmio: inputState.inputMmio,
        runMainLoopBody: mainLoopBody,
      };
      tick(s, tickOptions);
    }
    frameCount += 1;
    // DEBUG: expose state to window globals every frame for headless inspection
    (window as unknown as { __mlState?: typeof s; __mlFrame?: number }).__mlState = s;
    (window as unknown as { __mlFrame?: number }).__mlFrame = frameCount;

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
          opts.motionObjectStartEntry = activeMotionObjectStartEntry(s);
          opts.maxMotionObjectEntries = 64;
          opts.motionObjectLookups = rom.graphics.lookupTables.motionObjects;
        }
        const f = renderNs.buildFrame(s, opts);
        frameStats =
          ` frame.tiles=${f.playfield.length} frame.sprites=${f.sprites.length} frame.alpha=${f.alpha.length}`;
        // DEBUG: expose frame info for headless inspection
        (window as unknown as { __lastFrame?: typeof f; __romTiles?: Uint8Array; __mlState?: typeof s }).__lastFrame = f;
        (window as unknown as { __mlState?: typeof s }).__mlState = s;
        if (rom?.graphics.tiles) {
          (window as unknown as { __romTiles?: Uint8Array }).__romTiles = rom.graphics.tiles;
        }
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
