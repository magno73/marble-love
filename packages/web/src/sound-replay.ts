/**
 * sound-replay.ts — Cmd-tape replay path (bypass A0).
 *
 * Quando il main TS engine non emette ancora sound cmd al chip 6502 in
 * runtime browser (blocker A0 nel dominio Codex: gameplay sub non popolano
 * la byte queue $401F44), questo ramo ISOLATO carica una cmd-tape registrata
 * da MAME via `oracle/mame_sound_cmd_capture.lua` e la replica al chip TS al
 * frame esatto. L'audio bit-perfect emerge senza dipendere da gameplay
 * events Codex.
 *
 * Attivato da `?soundReplay=<url>` (path relativo, es. `scenarios/sound/cmd-tape-attract.json`).
 * Non monta engine/render/input: solo audio chip + AudioWorklet.
 *
 * Loop @60fps via setInterval. Loop infinito (riavvolge a frame 0 quando la
 * tape finisce) cosi' l'audio non si interrompe.
 */

import {
  createSoundChip,
  releaseSoundReset,
  submitCommand,
  tickCycles,
  drainYm2151Samples,
  drainPokeySamples,
  drainReplyEvents,
  loadCmdTape,
  SOUND_CYCLES_PER_FRAME,
  YM2151_NATIVE_SAMPLE_RATE,
  POKEY_NATIVE_SAMPLE_RATE,
  type CmdTape,
} from "@marble-love/engine";
import { wrap } from "@marble-love/engine";
import type { extractRomZipFiles } from "./rom-loader.js";
import { createSoundRenderer, type SoundRenderer } from "./sound-renderer.js";

type Rom = Awaited<ReturnType<typeof extractRomZipFiles>>;

const FRAME_INTERVAL_MS = 1000 / 60;

function statusEl(): HTMLElement {
  let el = document.getElementById("sound-replay-status");
  if (el === null) {
    el = document.createElement("div");
    el.id = "sound-replay-status";
    el.style.cssText =
      "position:fixed;top:10px;left:10px;padding:10px 14px;background:#1a1a1a;" +
      "color:#fff;border:1px solid #444;font-family:monospace;font-size:13px;" +
      "z-index:9999;max-width:480px;white-space:pre-wrap;";
    document.body.appendChild(el);
  }
  return el;
}

function setStatus(text: string): void {
  statusEl().textContent = text;
}

export async function runSoundReplay(rom: Rom, tapeUrl: string): Promise<void> {
  setStatus(`[soundReplay] loading tape ${tapeUrl}...`);

  const soundRomFull = rom.sound;
  if (soundRomFull === undefined || soundRomFull.length < 0x10000) {
    setStatus("[soundReplay] FAIL: rom.sound non disponibile");
    return;
  }
  const rom421 = soundRomFull.slice(0x8000, 0xc000);
  const rom422 = soundRomFull.slice(0xc000, 0x10000);

  const resp = await fetch(tapeUrl);
  if (!resp.ok) {
    setStatus(`[soundReplay] FAIL: fetch ${tapeUrl} → ${resp.status}`);
    return;
  }
  const tapeJson = (await resp.json()) as CmdTape;
  const tape = loadCmdTape(tapeJson);
  setStatus(
    `[soundReplay] tape: ${tape.cmdCount} cmds, ${tape.totalFrames} frames\n` +
    `Click "Start Replay" per avviare AudioContext + loop @60fps.`,
  );

  const chip = createSoundChip({ roms: { rom421, rom422 } });
  // NOTE: hardware-faithful ordering — il release del reset avviene al
  // primo cmd frame, DOPO che il cmd e' stato submitted (NMI suppressed
  // durante reset). Vedi `loop` sotto.
  const firstCmdFrame = Math.min(...Array.from(tape.byFrame.keys()));

  const btn = document.createElement("button");
  btn.textContent = "▶ Start Replay";
  btn.style.cssText =
    "position:fixed;top:10px;right:10px;z-index:9999;padding:12px 18px;" +
    "background:#2a4e2a;color:#fff;border:1px solid #4a8a4a;cursor:pointer;" +
    "font-family:monospace;font-size:14px;";
  document.body.appendChild(btn);

  let renderer: SoundRenderer | undefined;
  let frame = 0;
  let loops = 0;
  let started = false;
  let resetReleased = false;

  // `?soundReplayFastForward=N` — pre-ticka N frame del chip al click "Start",
  // saltando il boot silente. Default: 11900 (= ~198s, finestra audibile dell'
  // attract music inizia subito invece di aspettare 200s real-time).
  // ?soundReplayFastForward=0 per replay completo da frame 0.
  const ffParam = new URLSearchParams(window.location.search).get("soundReplayFastForward");
  const fastForward = ffParam === null ? 11900 : Math.max(0, Number.parseInt(ffParam, 10) || 0);

  btn.addEventListener("click", async () => {
    if (started) return;
    started = true;
    btn.disabled = true;
    btn.textContent = "⏵ Replaying...";

    try {
      renderer = await createSoundRenderer();
      await renderer.start();
    } catch (e) {
      setStatus(`[soundReplay] AudioContext FAIL: ${e instanceof Error ? e.message : String(e)}`);
      btn.textContent = "❌ Audio failed";
      btn.disabled = false;
      started = false;
      return;
    }

    // Fast-forward: tick il chip senza output audio per skippare boot silente.
    if (fastForward > 0) {
      btn.textContent = `⏩ Fast-forward ${fastForward} frames...`;
      setStatus(`[soundReplay] fast-forwarding ${fastForward} frames (boot silent)`);
      const ff = Math.min(fastForward, tape.totalFrames);
      for (let f = 0; f < ff; f++) {
        const cmds = tape.byFrame.get(f);
        if (cmds !== undefined) for (const b of cmds) submitCommand(chip, wrap.as_u8(b & 0xff));
        if (!resetReleased && f >= firstCmdFrame) {
          releaseSoundReset(chip);
          resetReleased = true;
        }
        tickCycles(chip, SOUND_CYCLES_PER_FRAME);
        drainReplyEvents(chip);
        // Drain samples ma scarta (silent boot phase)
        drainYm2151Samples(chip);
        drainPokeySamples(chip);
      }
      frame = ff;
      btn.textContent = "⏵ Replaying...";
    }

    setInterval(() => {
      // Hardware-faithful ordering (matching MAME atarisy1 a f244):
      // 1. submit cmd (NMI suppressed se chip ancora in reset)
      // 2. release reset al primo cmd frame (NMI line si attiva su pending)
      // 3. tick cycles del frame
      // 4. drain reply queue (simula main 68K che legge $FC0001)
      const cmds = tape.byFrame.get(frame);
      if (cmds !== undefined) {
        for (const b of cmds) submitCommand(chip, wrap.as_u8(b & 0xff));
      }
      if (!resetReleased && frame >= firstCmdFrame) {
        releaseSoundReset(chip);
        resetReleased = true;
      }
      tickCycles(chip, SOUND_CYCLES_PER_FRAME);
      drainReplyEvents(chip);
      const ym = drainYm2151Samples(chip);
      const pk = drainPokeySamples(chip);
      if (ym.length > 0) renderer!.pushYm2151Samples(ym, YM2151_NATIVE_SAMPLE_RATE);
      if (pk.length > 0) renderer!.pushPokeySamples(pk, POKEY_NATIVE_SAMPLE_RATE);
      frame++;
      if (frame >= tape.totalFrames) {
        frame = 0;
        loops++;
        // Reset chip for next loop iteration so cycle skew doesn't accumulate
        resetReleased = false;
      }
      if (frame % 60 === 0) {
        setStatus(
          `[soundReplay] tape ${tape.cmdCount} cmds × ${tape.totalFrames} frames\n` +
          `frame=${frame} loops=${loops}`,
        );
      }
    }, FRAME_INTERVAL_MS);

    setStatus(`[soundReplay] replay started @60fps`);
  });
}
