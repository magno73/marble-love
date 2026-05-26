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
  cmdTapeAbsoluteCycle,
  cmdTapeCycleInFrame,
  createSoundChip,
  drainYm2151Samples,
  drainPokeySamples,
  getPokeySampleRate,
  loadCmdTape,
  resetSoundChip,
  setPokeySampleCycles,
  tickFrameWithTape,
  SOUND_CMD_TAPE_CPU_HZ,
  SOUND_CYCLES_PER_FRAME,
  DEFAULT_COMMAND_NMI_SAMPLE_CYCLE,
  type SoundChipConfig,
  YM2151_NATIVE_SAMPLE_RATE,
  type CmdTape,
  type CmdTapeCommandTiming,
  type MainReplyWriteEvent,
} from "@marble-love/engine";
import type { extractRomZipFiles } from "./rom-loader.js";
import { createSoundRenderer, type PcmResampler, type SoundRenderer } from "./sound-renderer.js";
import {
  parseSoundReplayCommandEdgeEventRules,
  parseSoundReplayRegisterCycleOffsets,
  readSoundReplayCommandEventsFromTape,
  soundReplayCommandEdgeRulesRequireCommandPc,
  soundReplayCommandEdgeRuntimeOffsetFor,
  summarizeSoundReplayCommandEvents,
  type SoundReplayCommandEdgeEventRule,
  type SoundReplayCommandReadEvent,
} from "./sound-replay-command-edge.js";
import { applySoundReplayPreset } from "./sound-replay-presets.js";

type Rom = Awaited<ReturnType<typeof extractRomZipFiles>>;

const FRAME_INTERVAL_MS = 1000 / 60;

type SoundReplayTape = CmdTape & {
  readonly mainReplyReads?: ReadonlyArray<Record<string, unknown>>;
  readonly replyAcks?: ReadonlyArray<Record<string, unknown>>;
  readonly events?: ReadonlyArray<Record<string, unknown>>;
};
type ReplyAckSource = Pick<SoundReplayTape, "mainReplyReads" | "replyAcks" | "events">;
type SoundReplayYmScheduler = "cycle" | "mame-stream";
type YmWriteEventCycleOffsetMatch = NonNullable<SoundChipConfig["ymWriteEventCycleOffsetMatches"]>[number];
type YmWriteEventSampleOffsetMatch = NonNullable<SoundChipConfig["ymWriteEventSampleOffsetMatches"]>[number];

interface CommandNmiDelayMatch {
  readonly frame?: number;
  readonly byte?: number;
  readonly cycleInFrame?: number;
  readonly delayInstructions: number;
}

interface ReplyAckReplay {
  readonly ackCount: number;
  readonly schedule: (event: MainReplyWriteEvent) => number | undefined;
  readonly reset: () => void;
}

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

function finiteQueryNumber(params: URLSearchParams, name: string, fallback = 0): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function finiteQueryInteger(params: URLSearchParams, name: string, fallback = 0): number {
  return Math.trunc(finiteQueryNumber(params, name, fallback));
}

export function soundReplayPcmResamplerFromQuery(params: URLSearchParams, name: string): PcmResampler {
  return params.get(name) === "mame-lofi" ? "mame-lofi" : "linear";
}

export function soundReplayYmSchedulerFromQuery(params: URLSearchParams): SoundReplayYmScheduler {
  return params.get("soundReplayYmScheduler") === "mame-stream" ? "mame-stream" : "cycle";
}

export function soundReplayCmdTapeCommandTimingFromQuery(params: URLSearchParams): CmdTapeCommandTiming {
  const raw = params.get("soundReplayCmdTapeCommandTiming");
  if (raw === null || raw === "attos" || raw === "secs-attos" || raw === "secsAttos") return "secsAttos";
  if (raw === "cycle" || raw === "cycle-in-frame" || raw === "cycleInFrame") return "cycleInFrame";
  throw new Error(`invalid soundReplayCmdTapeCommandTiming=${raw}; expected attos or cycle`);
}

export function soundReplayYmNativeSampleRateFromQuery(
  params: URLSearchParams,
  scheduler: SoundReplayYmScheduler,
): number {
  if (scheduler !== "mame-stream") return YM2151_NATIVE_SAMPLE_RATE;
  const fallback = Math.trunc(YM2151_NATIVE_SAMPLE_RATE);
  return Math.max(1, Math.trunc(finiteQueryNumber(params, "soundReplayYmNativeSampleRate", fallback)));
}

export function soundReplayPokeyWriteApplyDelayFromQuery(params: URLSearchParams): number {
  return Math.max(0, finiteQueryInteger(params, "soundReplayPokeyWriteApplyDelay"));
}

export function soundReplayPokeySampleCyclesFromQuery(params: URLSearchParams): number {
  return Math.max(1, finiteQueryInteger(params, "soundReplayPokeySampleCycles", 28));
}

export function soundReplayResetReleaseDelayFromQuery(params: URLSearchParams): number {
  return Math.max(0, finiteQueryInteger(params, "soundReplayResetReleaseDelay"));
}

export function soundReplayCommandNmiDelayFromQuery(params: URLSearchParams): number {
  return Math.max(0, finiteQueryInteger(params, "soundReplayCommandNmiDelay", 1));
}

export function soundReplayCommandNmiSampleCycleFromQuery(params: URLSearchParams): number {
  const raw = params.get("soundReplayCommandNmiSampleCycle");
  if (raw === null || raw.trim() === "") return DEFAULT_COMMAND_NMI_SAMPLE_CYCLE;
  if (raw.trim() === "Infinity") return Infinity;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : DEFAULT_COMMAND_NMI_SAMPLE_CYCLE;
}

export function soundReplayYmStreamAbsoluteOriginFromQuery(params: URLSearchParams): boolean {
  return params.get("soundReplayYmStreamAbsoluteOrigin") === "1";
}

export function soundReplayRequireCommandContextFromQuery(params: URLSearchParams): boolean {
  return params.get("soundReplayRequireCommandContext") === "1";
}

function parseOptionalIntegerSelector(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  const value = Number.parseInt(trimmed, trimmed.startsWith("0x") ? 16 : 10);
  if (!Number.isFinite(value)) throw new Error(`invalid selector value ${raw}`);
  return Math.trunc(value);
}

export function soundReplayYmWriteEventCycleOffsetRegsFromQuery(params: URLSearchParams): ReadonlyMap<number, number> {
  const raw = params.get("soundReplayYmWriteEventCycleOffsetRegs");
  const offsets = new Map<number, number>();
  if (raw === null || raw.trim() === "") return offsets;
  for (const rawEntry of raw.split(",")) {
    const entry = rawEntry.trim();
    const separator = entry.includes("=") ? "=" : ":";
    const [regRaw, deltaRaw] = entry.split(separator);
    if (regRaw === undefined || deltaRaw === undefined || regRaw.trim() === "" || deltaRaw.trim() === "") {
      throw new Error(`invalid soundReplayYmWriteEventCycleOffsetRegs entry ${rawEntry}`);
    }
    const reg = Number.parseInt(regRaw.trim(), regRaw.trim().startsWith("0x") ? 16 : 10);
    const delta = Number(deltaRaw.trim());
    if (!Number.isFinite(reg) || reg < 0 || reg > 0xff || !Number.isFinite(delta)) {
      throw new Error(`invalid soundReplayYmWriteEventCycleOffsetRegs entry ${rawEntry}`);
    }
    offsets.set(reg & 0xff, Math.trunc(delta));
  }
  return offsets;
}

function parseYmWriteEventCycleOffsetMatches(raw: string | null): readonly YmWriteEventCycleOffsetMatch[] {
  if (raw === null || raw.trim() === "") return [];
  return raw.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 5 && parts.length !== 7) {
      throw new Error(
        `invalid soundReplayYmWriteEventCycleOffsetMatches entry ${rawEntry}; ` +
        "expected frame:pc:reg:val:delta[:cycleMin:cycleMax]",
      );
    }
    const [frameRaw, pcRaw, regRaw, valRaw, deltaRaw, cycleMinRaw, cycleMaxRaw] = parts;
    const deltaCycles = Number(deltaRaw);
    if (!Number.isFinite(deltaCycles)) throw new Error(`invalid cycle delta in ${rawEntry}`);
    const frame = parseOptionalIntegerSelector(frameRaw ?? "");
    const pc = parseOptionalIntegerSelector(pcRaw ?? "");
    const reg = parseOptionalIntegerSelector(regRaw ?? "");
    const val = parseOptionalIntegerSelector(valRaw ?? "");
    const cycleInFrameMin = parseOptionalIntegerSelector(cycleMinRaw ?? "");
    const cycleInFrameMax = parseOptionalIntegerSelector(cycleMaxRaw ?? "");
    if (frame !== undefined && frame < 0) throw new Error(`invalid frame in ${rawEntry}`);
    if (pc !== undefined && (pc < 0 || pc > 0xffff)) throw new Error(`invalid pc in ${rawEntry}`);
    if (reg !== undefined && (reg < 0 || reg > 0xff)) throw new Error(`invalid reg in ${rawEntry}`);
    if (val !== undefined && (val < 0 || val > 0xff)) throw new Error(`invalid val in ${rawEntry}`);
    if (cycleInFrameMin !== undefined && cycleInFrameMin < 0) throw new Error(`invalid cycleMin in ${rawEntry}`);
    if (cycleInFrameMax !== undefined && cycleInFrameMax < 0) throw new Error(`invalid cycleMax in ${rawEntry}`);
    return {
      ...(frame === undefined ? {} : { frame }),
      ...(pc === undefined ? {} : { pc }),
      ...(reg === undefined ? {} : { reg }),
      ...(val === undefined ? {} : { val }),
      ...(cycleInFrameMin === undefined ? {} : { cycleInFrameMin }),
      ...(cycleInFrameMax === undefined ? {} : { cycleInFrameMax }),
      deltaCycles: Math.trunc(deltaCycles),
    };
  });
}

function parseYmWriteEventSampleOffsetMatches(raw: string | null): readonly YmWriteEventSampleOffsetMatch[] {
  if (raw === null || raw.trim() === "") return [];
  return raw.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 5) {
      throw new Error(`invalid soundReplayYmWriteEventSampleOffsetMatches entry ${rawEntry}`);
    }
    const [frameRaw, pcRaw, regRaw, valRaw, deltaRaw] = parts;
    const deltaSamples = Number(deltaRaw);
    if (!Number.isFinite(deltaSamples)) throw new Error(`invalid sample delta in ${rawEntry}`);
    const frame = parseOptionalIntegerSelector(frameRaw ?? "");
    const pc = parseOptionalIntegerSelector(pcRaw ?? "");
    const reg = parseOptionalIntegerSelector(regRaw ?? "");
    const val = parseOptionalIntegerSelector(valRaw ?? "");
    if (frame !== undefined && frame < 0) throw new Error(`invalid frame in ${rawEntry}`);
    if (pc !== undefined && (pc < 0 || pc > 0xffff)) throw new Error(`invalid pc in ${rawEntry}`);
    if (reg !== undefined && (reg < 0 || reg > 0xff)) throw new Error(`invalid reg in ${rawEntry}`);
    if (val !== undefined && (val < 0 || val > 0xff)) throw new Error(`invalid val in ${rawEntry}`);
    return {
      ...(frame === undefined ? {} : { frame }),
      ...(pc === undefined ? {} : { pc }),
      ...(reg === undefined ? {} : { reg }),
      ...(val === undefined ? {} : { val }),
      deltaSamples: Math.trunc(deltaSamples),
    };
  });
}

export function soundReplayYmWriteEventCycleOffsetMatchesFromQuery(
  params: URLSearchParams,
): readonly YmWriteEventCycleOffsetMatch[] {
  return parseYmWriteEventCycleOffsetMatches(params.get("soundReplayYmWriteEventCycleOffsetMatches"));
}

export function soundReplayYmWriteEventSampleOffsetMatchesFromQuery(
  params: URLSearchParams,
): readonly YmWriteEventSampleOffsetMatch[] {
  return parseYmWriteEventSampleOffsetMatches(params.get("soundReplayYmWriteEventSampleOffsetMatches"));
}

function fmtRegisterOffsets(offsets: ReadonlyMap<number, number>): string {
  return Array.from(offsets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([reg, delta]) => `0x${reg.toString(16).padStart(2, "0")}=${delta}`)
    .join(",");
}

function fmtCommandEdgeRuleSummary(rules: readonly SoundReplayCommandEdgeEventRule[]): string {
  return `${rules.length} rule${rules.length === 1 ? "" : "s"}`;
}

function fmtYmWriteEventCycleOffsetMatches(matches: readonly YmWriteEventCycleOffsetMatch[]): string {
  return matches.map((match) =>
    `${match.frame ?? "*"}:` +
    `${match.pc === undefined ? "*" : `0x${match.pc.toString(16).padStart(4, "0")}`}:` +
    `${match.reg === undefined ? "*" : `0x${match.reg.toString(16).padStart(2, "0")}`}:` +
    `${match.val === undefined ? "*" : `0x${match.val.toString(16).padStart(2, "0")}`}:` +
    `${match.deltaCycles}` +
    (match.cycleInFrameMin === undefined && match.cycleInFrameMax === undefined
      ? ""
      : `:${match.cycleInFrameMin ?? "*"}:${match.cycleInFrameMax ?? "*"}`)).join(",");
}

function parseCommandNmiDelayMatches(raw: string | null): readonly CommandNmiDelayMatch[] {
  if (raw === null || raw.trim() === "") return [];
  return raw.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 4) {
      throw new Error(`invalid soundReplayCommandNmiDelayMatches entry ${rawEntry}`);
    }
    const [frameRaw, byteRaw, cycleRaw, delayRaw] = parts;
    const frame = parseOptionalIntegerSelector(frameRaw ?? "");
    const byte = parseOptionalIntegerSelector(byteRaw ?? "");
    const cycleInFrame = parseOptionalIntegerSelector(cycleRaw ?? "");
    const delayInstructions = Number(delayRaw);
    if (frame !== undefined && frame < 0) throw new Error(`invalid frame in ${rawEntry}`);
    if (byte !== undefined && (byte < 0 || byte > 0xff)) throw new Error(`invalid byte in ${rawEntry}`);
    if (cycleInFrame !== undefined && cycleInFrame < 0) throw new Error(`invalid cycleInFrame in ${rawEntry}`);
    if (!Number.isFinite(delayInstructions) || delayInstructions < 0) {
      throw new Error(`invalid delay in ${rawEntry}`);
    }
    return {
      ...(frame === undefined ? {} : { frame }),
      ...(byte === undefined ? {} : { byte: byte & 0xff }),
      ...(cycleInFrame === undefined ? {} : { cycleInFrame }),
      delayInstructions: Math.trunc(delayInstructions),
    };
  });
}

export function soundReplayCommandNmiDelayMatchesFromQuery(
  params: URLSearchParams,
): readonly CommandNmiDelayMatch[] {
  return parseCommandNmiDelayMatches(params.get("soundReplayCommandNmiDelayMatches"));
}

function commandNmiDelayOverrideForMatch(
  matches: readonly CommandNmiDelayMatch[],
  frame: number,
  byte: number,
  cycleInFrame: number,
): number | undefined {
  let delay: number | undefined;
  for (const match of matches) {
    if (match.frame !== undefined && match.frame !== frame) continue;
    if (match.byte !== undefined && match.byte !== (byte & 0xff)) continue;
    if (match.cycleInFrame !== undefined && match.cycleInFrame !== cycleInFrame) continue;
    delay = match.delayInstructions;
  }
  return delay;
}

function fmtCommandNmiDelayMatches(matches: readonly CommandNmiDelayMatch[]): string {
  return matches.map((match) =>
    `${match.frame ?? "*"}:` +
    `${match.byte === undefined ? "*" : `0x${match.byte.toString(16).padStart(2, "0")}`}:` +
    `${match.cycleInFrame ?? "*"}:` +
    `${match.delayInstructions}`).join(",");
}

function fmtYmWriteEventSampleOffsetMatches(matches: readonly YmWriteEventSampleOffsetMatch[]): string {
  return matches.map((match) =>
    `${match.frame ?? "*"}:` +
    `${match.pc === undefined ? "*" : `0x${match.pc.toString(16).padStart(4, "0")}`}:` +
    `${match.reg === undefined ? "*" : `0x${match.reg.toString(16).padStart(2, "0")}`}:` +
    `${match.val === undefined ? "*" : `0x${match.val.toString(16).padStart(2, "0")}`}:` +
    `${match.deltaSamples}`).join(",");
}

function parseHexOrNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
}

function rawMainReplyReads(source: ReplyAckSource): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(source.mainReplyReads)) return source.mainReplyReads;
  if (Array.isArray(source.replyAcks)) return source.replyAcks;
  if (Array.isArray(source.events)) return source.events.filter((event) => event.kind === "mainReplyRead");
  return [];
}

function replyAckCycle(raw: Record<string, unknown>, originCycle: bigint | undefined): number | undefined {
  const relative = parseHexOrNumber(raw.relativeCycle ?? raw.cycle);
  if (relative !== undefined) return relative;
  const secs = parseHexOrNumber(raw.secs);
  const attos = typeof raw.attos === "string" ? raw.attos : undefined;
  if (secs === undefined || attos === undefined || originCycle === undefined) return undefined;
  const absolute = cmdTapeAbsoluteCycle({ secs, attos });
  if (absolute === undefined) return undefined;
  return Number(absolute - originCycle);
}

function createReplyAckReplay(tape: SoundReplayTape, source: ReplyAckSource = tape): ReplyAckReplay | undefined {
  let originCycle: bigint | undefined;
  for (const cmd of tape.cmds) {
    originCycle = cmdTapeAbsoluteCycle(cmd);
    if (originCycle !== undefined) break;
  }
  const cycles = rawMainReplyReads(source)
    .map((raw) => replyAckCycle(raw, originCycle))
    .filter((cycle): cycle is number => cycle !== undefined && Number.isFinite(cycle) && cycle >= 0)
    .map((cycle) => Math.trunc(cycle))
    .sort((a, b) => a - b);
  if (cycles.length === 0) return undefined;

  let next = 0;
  return {
    ackCount: cycles.length,
    schedule: (event) => {
      while (next < cycles.length && cycles[next]! < event.cycle) next++;
      const ackCycle = cycles[next];
      if (ackCycle === undefined) return undefined;
      next++;
      return ackCycle;
    },
    reset: () => {
      next = 0;
    },
  };
}

function firstResetFrameCommand(
  cmds: SoundReplayTape["cmds"],
  resetFrame: number | undefined,
): SoundReplayTape["cmds"][number] | undefined {
  if (resetFrame === undefined) return undefined;
  return cmds.find((cmd) => cmd.frame === resetFrame);
}

function soundCyclesToSamples(cycles: bigint, sampleRate: number): number {
  const cycleNumber = Number(cycles);
  if (!Number.isSafeInteger(cycleNumber)) {
    throw new Error(`sound cycle count too large: ${cycles.toString()}`);
  }
  return Math.round(cycleNumber * Math.max(1, sampleRate) / SOUND_CMD_TAPE_CPU_HZ);
}

function attosecondsToSampleIndex(secs: number, attos: string, sampleRate: number): bigint {
  const seconds = Math.trunc(secs) + Number(BigInt(attos)) / 1_000_000_000_000_000_000;
  const sample = Math.floor(seconds * Math.max(1, sampleRate));
  if (!Number.isSafeInteger(sample)) throw new Error(`sample index too large for ${secs}:${attos}`);
  return BigInt(sample);
}

function cmdTapeYmStreamSampleOffset(
  cmd: { frame: number; secs?: number; attos?: string; cycleInFrame?: number },
  sampleRate: number,
): number {
  const offset = cmd.secs !== undefined && cmd.attos !== undefined
    ? attosecondsToSampleIndex(cmd.secs, cmd.attos, sampleRate)
    : BigInt(soundCyclesToSamples(
        (BigInt(Math.max(0, Math.trunc(cmd.frame))) * BigInt(SOUND_CYCLES_PER_FRAME)) +
          BigInt(cmdTapeCycleInFrame(cmd) ?? 0),
        sampleRate,
      ));
  const asNumber = Number(offset);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`YM stream sample offset too large: ${offset.toString()}`);
  }
  return asNumber;
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
  const tapeJson = (await resp.json()) as SoundReplayTape;
  let presetName: string | undefined;
  let searchParams: URLSearchParams;
  try {
    const preset = applySoundReplayPreset(new URLSearchParams(window.location.search));
    searchParams = preset.params;
    presetName = preset.preset?.name;
  } catch (e) {
    setStatus(`[soundReplay] FAIL: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const replyAckUrl = searchParams.get("soundReplayReplyAck");
  const ymScheduler = soundReplayYmSchedulerFromQuery(searchParams);
  const ymNativeSampleRate = soundReplayYmNativeSampleRateFromQuery(searchParams, ymScheduler);
  const ymResampleOffset = finiteQueryNumber(searchParams, "soundReplayYmResampleOffset");
  const pokeyResampleOffset = finiteQueryNumber(searchParams, "soundReplayPokeyResampleOffset");
  const ymResampler = soundReplayPcmResamplerFromQuery(searchParams, "soundReplayYmResampler");
  const pokeyResampler = soundReplayPcmResamplerFromQuery(searchParams, "soundReplayPokeyResampler");
  const ymOutputSampleOffset = finiteQueryInteger(searchParams, "soundReplayYmOutputSampleOffset");
  const pokeyOutputSampleOffset = finiteQueryInteger(searchParams, "soundReplayPokeyOutputSampleOffset");
  const pokeyWriteApplyDelayCycles = soundReplayPokeyWriteApplyDelayFromQuery(searchParams);
  const pokeySampleCycles = soundReplayPokeySampleCyclesFromQuery(searchParams);
  const resetReleaseDelayCycles = soundReplayResetReleaseDelayFromQuery(searchParams);
  const commandNmiDelayInstructions = soundReplayCommandNmiDelayFromQuery(searchParams);
  const commandNmiSampleCycle = soundReplayCommandNmiSampleCycleFromQuery(searchParams);
  let commandNmiDelayMatches: readonly CommandNmiDelayMatch[] = [];
  let ymCommandEdgeEventRules: readonly SoundReplayCommandEdgeEventRule[] = [];
  let pokeyCommandEdgeEventRules: readonly SoundReplayCommandEdgeEventRule[] = [];
  let pokeyCommandEdgeRawCycleOffsetOpcodes: ReadonlyMap<number, number> = new Map();
  let ymWriteEventCycleOffsetCycles = 0;
  let ymWriteEventCycleOffsetRegs: ReadonlyMap<number, number> = new Map();
  let ymWriteEventCycleOffsetMatches: readonly YmWriteEventCycleOffsetMatch[] = [];
  let ymWriteEventSampleOffsetMatches: readonly YmWriteEventSampleOffsetMatch[] = [];
  let cmdTapeCommandTiming: CmdTapeCommandTiming = "secsAttos";
  try {
    cmdTapeCommandTiming = soundReplayCmdTapeCommandTimingFromQuery(searchParams);
    commandNmiDelayMatches = soundReplayCommandNmiDelayMatchesFromQuery(searchParams);
    ymCommandEdgeEventRules = parseSoundReplayCommandEdgeEventRules(
      searchParams.get("soundReplayYmCommandEdgeEventRules"),
      finiteQueryInteger(searchParams, "soundReplayYmCommandEdgeEventAfter", 64),
      "soundReplayYmCommandEdgeEventRules",
    );
    pokeyCommandEdgeEventRules = parseSoundReplayCommandEdgeEventRules(
      searchParams.get("soundReplayPokeyCommandEdgeEventRules"),
      finiteQueryInteger(searchParams, "soundReplayPokeyCommandEdgeEventAfter", 0),
      "soundReplayPokeyCommandEdgeEventRules",
    );
    pokeyCommandEdgeRawCycleOffsetOpcodes = parseSoundReplayRegisterCycleOffsets(
      searchParams.get("soundReplayPokeyCommandEdgeRawCycleOffsetOpcodes"),
      "soundReplayPokeyCommandEdgeRawCycleOffsetOpcodes",
    );
    ymWriteEventCycleOffsetCycles = finiteQueryInteger(searchParams, "soundReplayYmWriteEventCycleOffset");
    ymWriteEventCycleOffsetRegs = soundReplayYmWriteEventCycleOffsetRegsFromQuery(searchParams);
    ymWriteEventCycleOffsetMatches = soundReplayYmWriteEventCycleOffsetMatchesFromQuery(searchParams);
    ymWriteEventSampleOffsetMatches = soundReplayYmWriteEventSampleOffsetMatchesFromQuery(searchParams);
  } catch (e) {
    setStatus(`[soundReplay] FAIL: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const tape = loadCmdTape(tapeJson, { commandTiming: cmdTapeCommandTiming });
  const ymStreamAbsoluteOrigin = soundReplayYmStreamAbsoluteOriginFromQuery(searchParams);
  if (ymStreamAbsoluteOrigin && ymScheduler !== "mame-stream") {
    setStatus("[soundReplay] FAIL: soundReplayYmStreamAbsoluteOrigin requires soundReplayYmScheduler=mame-stream");
    return;
  }
  const resetFrameCommand = firstResetFrameCommand(tapeJson.cmds, tape.resetFrame);
  if (ymStreamAbsoluteOrigin && resetFrameCommand === undefined) {
    setStatus("[soundReplay] FAIL: soundReplayYmStreamAbsoluteOrigin requires a reset-frame command");
    return;
  }
  const ymStreamSampleOffset = ymStreamAbsoluteOrigin && resetFrameCommand !== undefined
    ? cmdTapeYmStreamSampleOffset(resetFrameCommand, ymNativeSampleRate)
    : 0;
  const ymStreamCycleOffsetCycles = ymStreamAbsoluteOrigin && resetFrameCommand !== undefined
    ? cmdTapeAbsoluteCycle(resetFrameCommand)
    : undefined;
  const ymSchedulerStatus = ymScheduler === "cycle"
    ? ""
    : `ymScheduler=${ymScheduler} ymRate=${ymNativeSampleRate}` +
      (ymStreamAbsoluteOrigin
        ? ` ymStreamAbsoluteOrigin=true ymStreamSampleOffset=${ymStreamSampleOffset}`
        : "") +
      "\n";
  const resampleStatus = ymResampleOffset === 0 && pokeyResampleOffset === 0
    ? `resampler ym=${ymResampler} pokey=${pokeyResampler}\n`
    : `resampler ym=${ymResampler} pokey=${pokeyResampler} ` +
      `resampleOffset ym=${ymResampleOffset} pokey=${pokeyResampleOffset}\n`;
  const outputOffsetStatus = ymOutputSampleOffset === 0 && pokeyOutputSampleOffset === 0
    ? ""
    : `outputSampleOffset ym=${ymOutputSampleOffset} pokey=${pokeyOutputSampleOffset}\n`;
  const pokeyApplyDelayStatus = pokeyWriteApplyDelayCycles === 0
    ? ""
    : `pokeyWriteApplyDelay=${pokeyWriteApplyDelayCycles} cycles\n`;
  const pokeySampleCyclesStatus = pokeySampleCycles === 28
    ? ""
    : `pokeySampleCycles=${pokeySampleCycles}\n`;
  const resetReleaseDelayStatus = resetReleaseDelayCycles === 0
    ? ""
    : `resetReleaseDelay=${resetReleaseDelayCycles} cycles\n`;
  const commandNmiDelayStatus = commandNmiDelayInstructions === 0
    ? ""
    : `commandNmiDelay=${commandNmiDelayInstructions} instruction(s)\n`;
  const commandNmiSampleStatus = commandNmiSampleCycle === DEFAULT_COMMAND_NMI_SAMPLE_CYCLE &&
    commandNmiDelayMatches.length === 0
    ? ""
    : `commandNmiSampleCycle=${Number.isFinite(commandNmiSampleCycle) ? commandNmiSampleCycle : "Infinity"}` +
      (commandNmiDelayMatches.length === 0
        ? "\n"
        : ` matches=${fmtCommandNmiDelayMatches(commandNmiDelayMatches)}\n`);
  const ymWriteEventStatus =
    (ymWriteEventCycleOffsetCycles === 0 ? "" : `ymWriteEventCycleOffset=${ymWriteEventCycleOffsetCycles}\n`) +
    (ymWriteEventCycleOffsetRegs.size === 0
      ? ""
      : `ymWriteEventCycleOffsetRegs=${fmtRegisterOffsets(ymWriteEventCycleOffsetRegs)}\n`) +
    (ymWriteEventCycleOffsetMatches.length === 0
      ? ""
      : `ymWriteEventCycleOffsetMatches=${fmtYmWriteEventCycleOffsetMatches(ymWriteEventCycleOffsetMatches)}\n`) +
    (ymWriteEventSampleOffsetMatches.length === 0
      ? ""
      : `ymWriteEventSampleOffsetMatches=${fmtYmWriteEventSampleOffsetMatches(ymWriteEventSampleOffsetMatches)}\n`);
  const commandEdgeStatus =
    (ymCommandEdgeEventRules.length === 0
      ? ""
      : `ymCommandEdge=${fmtCommandEdgeRuleSummary(ymCommandEdgeEventRules)}\n`) +
    (pokeyCommandEdgeEventRules.length === 0
      ? ""
      : `pokeyCommandEdge=${fmtCommandEdgeRuleSummary(pokeyCommandEdgeEventRules)}\n`) +
    (pokeyCommandEdgeRawCycleOffsetOpcodes.size === 0
      ? ""
      : `pokeyCommandEdgeRawCycleOffsetOpcodes=${fmtRegisterOffsets(pokeyCommandEdgeRawCycleOffsetOpcodes)}\n`);
  let replyAckSource: ReplyAckSource | undefined;
  if (replyAckUrl !== null && replyAckUrl !== "") {
    const ackResp = await fetch(replyAckUrl);
    if (!ackResp.ok) {
      setStatus(`[soundReplay] FAIL: fetch ${replyAckUrl} -> ${ackResp.status}`);
      return;
    }
    replyAckSource = (await ackResp.json()) as ReplyAckSource;
  }
  const replyAckReplay = createReplyAckReplay(tapeJson, replyAckSource);
  const commandEdgeReplayEvents = ymCommandEdgeEventRules.length === 0 && pokeyCommandEdgeEventRules.length === 0
    ? []
    : readSoundReplayCommandEventsFromTape(tapeJson, cmdTapeCommandTiming);
  const commandEdgeContext = summarizeSoundReplayCommandEvents(commandEdgeReplayEvents);
  const commandRulesRequireSoundPc =
    soundReplayCommandEdgeRulesRequireCommandPc(ymCommandEdgeEventRules) ||
    soundReplayCommandEdgeRulesRequireCommandPc(pokeyCommandEdgeEventRules);
  const requireCommandContext = soundReplayRequireCommandContextFromQuery(searchParams);
  if (requireCommandContext && (commandEdgeContext.total === 0 ||
    commandEdgeContext.withCycleInFrame !== commandEdgeContext.total ||
    commandEdgeContext.withSoundPc !== commandEdgeContext.total)) {
    setStatus(
      "[soundReplay] FAIL: soundReplayRequireCommandContext=1 needs every replay command to carry " +
      `cycle timing and soundPc context; commandEvents=${commandEdgeContext.total} ` +
      `cycleInFrame=${commandEdgeContext.withCycleInFrame} soundPc=${commandEdgeContext.withSoundPc}`,
    );
    return;
  }
  const commandEdgeContextStatus = commandEdgeReplayEvents.length === 0
    ? ""
    : `commandEvents=${commandEdgeContext.total} ` +
      `cycleInFrame=${commandEdgeContext.withCycleInFrame} soundPc=${commandEdgeContext.withSoundPc}` +
      (commandRulesRequireSoundPc && commandEdgeContext.withSoundPc !== commandEdgeContext.total
        ? " WARNING missing soundPc for command-PC rules"
        : "") +
      "\n";
  setStatus(
    `[soundReplay] tape: ${tape.cmdCount} cmds, ${tape.totalFrames} frames, ` +
    `cyclePrecise=${tape.cyclePrecise} commandTiming=${cmdTapeCommandTiming}\n` +
    (presetName === undefined ? "" : `preset=${presetName}\n`) +
    ymSchedulerStatus +
    resampleStatus +
    outputOffsetStatus +
    pokeyApplyDelayStatus +
    pokeySampleCyclesStatus +
    resetReleaseDelayStatus +
    commandNmiDelayStatus +
    commandNmiSampleStatus +
    ymWriteEventStatus +
    commandEdgeStatus +
    commandEdgeContextStatus +
    (replyAckReplay === undefined ? "" : `replyAckReplay=${replyAckReplay.ackCount} acks\n`) +
    `Click "Start Replay" per avviare AudioContext + loop @60fps.`,
  );

  let chipForCommandEdge: { readonly commandReadEvents: readonly SoundReplayCommandReadEvent[] } | undefined;
  const chip = createSoundChip({
    roms: { rom421, rom422 },
    commandNmiDelayInstructions,
    ...(ymScheduler === "mame-stream"
      ? {
          ymAudioScheduler: "mame-stream" as const,
          ymStreamSampleRate: ymNativeSampleRate,
          ...(ymStreamSampleOffset === 0 ? {} : { ymStreamSampleOffset }),
          ...(ymStreamCycleOffsetCycles === undefined ? {} : { ymStreamCycleOffsetCycles }),
        }
      : {}),
    ...(ymWriteEventCycleOffsetCycles === 0 ? {} : { ymWriteEventCycleOffsetCycles }),
    ...(ymWriteEventCycleOffsetRegs.size === 0 ? {} : { ymWriteEventCycleOffsetByReg: ymWriteEventCycleOffsetRegs }),
    ...(ymWriteEventCycleOffsetMatches.length === 0 ? {} : { ymWriteEventCycleOffsetMatches }),
    ...(ymCommandEdgeEventRules.length === 0
      ? {}
      : {
          ymWriteEventCycleOffsetProvider: (ctx) => soundReplayCommandEdgeRuntimeOffsetFor(
            ctx,
            commandEdgeReplayEvents,
            chipForCommandEdge?.commandReadEvents ?? [],
            ymCommandEdgeEventRules,
          ),
        }),
    ...(ymWriteEventSampleOffsetMatches.length === 0 ? {} : { ymWriteEventSampleOffsetMatches }),
    ...(pokeyWriteApplyDelayCycles > 0 ? { pokeyWriteApplyDelayCycles } : {}),
    ...(pokeyCommandEdgeEventRules.length === 0
      ? {}
      : {
          pokeyWriteApplyDelayProvider: (ctx) => {
            const rawCycleOffset = ctx.opcode === undefined
              ? 0
              : (pokeyCommandEdgeRawCycleOffsetOpcodes.get(ctx.opcode & 0xff) ?? 0);
            return soundReplayCommandEdgeRuntimeOffsetFor(
              {
                frame: ctx.frame,
                pc: ctx.pc,
                opcode: ctx.opcode,
                reg: ctx.reg,
                val: ctx.val,
                rawCycle: ctx.rawCycle + rawCycleOffset,
                rawCycleInFrame: ctx.rawCycleInFrame,
                rawWriteCycleOffset: ctx.rawWriteCycleOffset + rawCycleOffset,
                currentEventCycleOffset: ctx.currentApplyDelayCycles - rawCycleOffset,
              },
              commandEdgeReplayEvents,
              chipForCommandEdge?.commandReadEvents ?? [],
              pokeyCommandEdgeEventRules,
            );
          },
        }),
    ...(replyAckReplay === undefined ? {} : { mainReplyAckCycle: replyAckReplay.schedule }),
  });
  chipForCommandEdge = chip;
  setPokeySampleCycles(chip, pokeySampleCycles);
  const commandNmiDelayOverride = commandNmiDelayMatches.length === 0
    ? undefined
    : (event: { readonly frame: number; readonly byte: number; readonly cycleInFrame: number }) =>
        commandNmiDelayOverrideForMatch(commandNmiDelayMatches, event.frame, event.byte, event.cycleInFrame);

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

  // `?soundReplayFastForward=N` — pre-ticka N frame del chip al click "Start",
  // saltando il boot silente. Default: 11900 (= ~198s, finestra audibile dell'
  // attract music inizia subito invece di aspettare 200s real-time).
  // ?soundReplayFastForward=0 per replay completo da frame 0.
  const ffParam = searchParams.get("soundReplayFastForward");
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
        tickFrameWithTape(chip, tape, f, {
          autoReleaseReset: true,
          drainReplies: true,
          resetReleaseDelayCycles,
          commandNmiSampleCycle,
          ...(commandNmiDelayOverride === undefined ? {} : { commandNmiDelayOverride }),
        });
        // Drain samples ma scarta (silent boot phase)
        drainYm2151Samples(chip);
        drainPokeySamples(chip);
      }
      frame = ff;
      if (frame >= tape.totalFrames) {
        frame = 0;
        resetSoundChip(chip);
        setPokeySampleCycles(chip, pokeySampleCycles);
        renderer.resetPcmStreams();
        replyAckReplay?.reset();
      }
      btn.textContent = "⏵ Replaying...";
    }

    setInterval(() => {
      tickFrameWithTape(chip, tape, frame, {
        autoReleaseReset: true,
        drainReplies: true,
        resetReleaseDelayCycles,
        commandNmiSampleCycle,
        ...(commandNmiDelayOverride === undefined ? {} : { commandNmiDelayOverride }),
      });
      const ym = drainYm2151Samples(chip);
      const pk = drainPokeySamples(chip);
      if (ym.length > 0) {
        renderer!.pushYm2151Samples(ym, ymNativeSampleRate, {
          resampler: ymResampler,
          resampleOffset: ymResampleOffset,
          outputSampleOffset: ymOutputSampleOffset,
        });
      }
      if (pk.length > 0) {
        renderer!.pushPokeySamples(pk, getPokeySampleRate(chip), {
          resampler: pokeyResampler,
          resampleOffset: pokeyResampleOffset,
          outputSampleOffset: pokeyOutputSampleOffset,
        });
      }
      frame++;
      if (frame >= tape.totalFrames) {
        frame = 0;
        loops++;
        // Reset chip for next loop iteration so cycle skew doesn't accumulate
        resetSoundChip(chip);
        setPokeySampleCycles(chip, pokeySampleCycles);
        renderer!.resetPcmStreams();
        replyAckReplay?.reset();
      }
      if (frame % 60 === 0) {
        setStatus(
          `[soundReplay] tape ${tape.cmdCount} cmds × ${tape.totalFrames} frames\n` +
          (presetName === undefined ? "" : `preset=${presetName}\n`) +
          ymSchedulerStatus +
          resampleStatus +
          outputOffsetStatus +
          pokeyApplyDelayStatus +
          pokeySampleCyclesStatus +
          resetReleaseDelayStatus +
          commandNmiDelayStatus +
          commandNmiSampleStatus +
          ymWriteEventStatus +
          commandEdgeStatus +
          commandEdgeContextStatus +
          `frame=${frame} loops=${loops} cyclePrecise=${tape.cyclePrecise} commandTiming=${cmdTapeCommandTiming}` +
          (replyAckReplay === undefined ? "" : ` replyAck=${replyAckReplay.ackCount}`),
        );
      }
    }, FRAME_INTERVAL_MS);

    setStatus(`[soundReplay] replay started @60fps`);
  });
}
