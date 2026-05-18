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
import { isCoinStartAttractReady, prepareBrowserCoinStartAttract, writeBrowserCreditDigit } from "./coin-start-flow.js";
import { applyLevelTimeOverride, parseLevelTimeOverrideParam } from "./level-time-override.js";
import { parseStartLevelParam, playableSeedForStartLevel } from "./practice-level.js";
import { initRenderer } from "./renderer.js";
import { extractRomZipFiles } from "./rom-loader.js";
import {
  createSoundChip, tickCycles as tickSoundCycles, releaseSoundReset, SOUND_CYCLES_PER_FRAME, submitCommand as submitSoundCommand, setSoundCmdHook, setGlobalSoundCmdHook, drainYm2151Samples, drainPokeySamples, YM2151_NATIVE_SAMPLE_RATE, POKEY_NATIVE_SAMPLE_RATE,
} from "@marble-love/engine";
import { createSoundRenderer, type SoundRenderer } from "./sound-renderer.js";
import { runSoundReplay } from "./sound-replay.js";

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
const enableSound = searchParams.get("sound") !== "0";
// SoundChip tick default-ON (sessione 4l 2026-05-18): post-fix Timer A
// edge-trigger + $1820 pull-up + auto-drain, il chip produce audio reale
// (maxAbs 0.137 + 1098 write YM bit-perfect vs MAME). `?soundChip=0` opt-out.
const runSoundChip = searchParams.get("soundChip") !== "0";
// `?soundReplay=<path>` — bypass A0 cmd-flow blocker: invece di startGame
// completo, esegui solo SoundChip + cmd-tape replay (audio chip-perfect).
// Path relativo a /public es. `scenarios/sound/cmd-tape-attract.json`.
const soundReplayUrl = searchParams.get("soundReplay");
const levelTimeOverride = parseLevelTimeOverrideParam(searchParams.get("levelTime"));
const showObjectDebugOverlay =
  searchParams.get("debugObjects") === "1" || searchParams.get("debugState") === "1";
const freezeOnBug = showObjectDebugOverlay && searchParams.get("freezeOnBug") === "1";
const freezeOnAir = freezeOnBug && searchParams.get("freezeOnAir") === "1";
const freezeOnState4 = freezeOnBug && searchParams.get("freezeOnState4") === "1";
const freezeOnImpulse = freezeOnBug && searchParams.get("freezeOnImpulse") !== "0";
const freezeImpulseMinDvRaw = Number(searchParams.get("freezeImpulseMinDv") ?? "8");
const freezeImpulseMinDv = Number.isFinite(freezeImpulseMinDvRaw) ? freezeImpulseMinDvRaw : 8;
const forceCoinStart = searchParams.get("coinStart") === "1";
const preservePlayableDispatcher = searchParams.get("preserveDispatcher") === "1";
const playableSeedName = searchParams.get("playableSeed");
const livePlaySeedName = playableSeedForStartLevel(1) ?? "manual_level1_start";
const replayPlayableSeedName = "coin_start_to_level1";
const startLevelPractice = parseStartLevelParam(searchParams.get("startLevel"));
const startLevelPlayableSeedName = playableSeedForStartLevel(startLevelPractice);
const debugForcedPlayer = parseDebugPlayerParam(searchParams.get("debugPlayer"));
const debugForcedScrollX = parseOptionalNumberParam(searchParams.get("debugScrollX"));
const debugForcedScrollY = parseOptionalNumberParam(searchParams.get("debugScrollY"));
const debugZeroForcedVelocity = debugForcedPlayer !== undefined && searchParams.get("debugZeroVelocity") !== "0";
const debugForceBeforeTick = searchParams.get("debugForceBeforeTick") === "1";
const debugForceOnce = searchParams.get("debugForceOnce") === "1";
const debugForcedPlayerBytes = new Map<number, number>();
for (const [param, off] of [
  ["debugPlayerState", 0x1a],
  ["debugPlayerKind", 0x1b],
  ["debugPlayerBounce", 0x36],
  ["debugPlayerF57", 0x57],
  ["debugPlayerF58", 0x58],
  ["debugPlayerF59", 0x59],
  ["debugPlayerF5f", 0x5f],
  ["debugPlayerF60", 0x60],
] as const) {
  const value = parseOptionalNumberParam(searchParams.get(param));
  if (value !== undefined) debugForcedPlayerBytes.set(off, value & 0xff);
}
// ?scenario=NAME — gameplay warm-seed (oracle/scenarios/gameplay/NAME.json).
// Carica snapshots[0] come warmState. Loop reset a 100 frame (oracle window).
// Cherry-pick da feature/render-fix-bg (15 scenari MAME 101 snapshot ciascuno).
const KNOWN_SCENARIOS = new Set([
  "level1_spawn", "level1_early", "level1_midmap", "level1_obstacle",
  "level1_end", "level2_spawn", "level2_early", "intro_overlay",
  "level3_spawn", "level3_early", "level3_end",
  "level4_spawn", "level4_early",
  "level5_spawn", "level5_early",
]);
const explicitScenarioName = searchParams.get("scenario");
const scenarioNameRaw = explicitScenarioName;
const scenarioName =
  scenarioNameRaw !== null && KNOWN_SCENARIOS.has(scenarioNameRaw) ? scenarioNameRaw : null;
const useStartLevelPractice =
  explicitScenarioName === null && playableSeedName === null && startLevelPractice !== undefined;
const startLevelPracticeUnavailable =
  useStartLevelPractice && startLevelPlayableSeedName === undefined;
const DEFAULT_WARM_PLAY_LOOP_RESET = 180;
const SCENARIO_LOOP_RESET = 100;
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

function readWorkWordBE(state: ReturnType<typeof stateNs.emptyGameState>, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function readWorkLongBE(state: ReturnType<typeof stateNs.emptyGameState>, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function writeWorkWordBE(state: ReturnType<typeof stateNs.emptyGameState>, off: number, value: number): void {
  const word = value & 0xffff;
  state.workRam[off] = (word >>> 8) & 0xff;
  state.workRam[off + 1] = word & 0xff;
}

function writeWorkLongBE(state: ReturnType<typeof stateNs.emptyGameState>, off: number, value: number): void {
  const long = value >>> 0;
  state.workRam[off] = (long >>> 24) & 0xff;
  state.workRam[off + 1] = (long >>> 16) & 0xff;
  state.workRam[off + 2] = (long >>> 8) & 0xff;
  state.workRam[off + 3] = long & 0xff;
}

function parseOptionalNumberParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseDebugPlayerParam(raw: string | null): { x: number; y: number; z: number } | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return { x: parts[0]!, y: parts[1]!, z: parts[2]! };
}

function fixedLongFromFloat(value: number): number {
  return Math.round(value * 0x10000) >>> 0;
}

function applyDebugForcedState(state: ReturnType<typeof stateNs.emptyGameState>): void {
  if (debugForcedScrollX !== undefined) {
    const scrollX = ((Math.round(debugForcedScrollX) % 512) + 512) % 512;
    state.videoScrollX = scrollX;
  }
  if (debugForcedScrollY !== undefined) {
    const scrollY = ((Math.round(debugForcedScrollY) % 512) + 512) % 512;
    writeWorkWordBE(state, 0x000, scrollY);
    writeWorkWordBE(state, 0x002, scrollY);
    state.videoScrollY = scrollY;
  }
  if (debugForcedPlayer !== undefined) {
    const objOff = 0x18;
    writeWorkLongBE(state, objOff + 0x0c, fixedLongFromFloat(debugForcedPlayer.x));
    writeWorkLongBE(state, objOff + 0x10, fixedLongFromFloat(debugForcedPlayer.y));
    writeWorkLongBE(state, objOff + 0x14, fixedLongFromFloat(debugForcedPlayer.z));
    if (debugZeroForcedVelocity) {
      writeWorkLongBE(state, objOff + 0x00, 0);
      writeWorkLongBE(state, objOff + 0x04, 0);
      writeWorkLongBE(state, objOff + 0x08, 0);
    }
    for (const [off, value] of debugForcedPlayerBytes) state.workRam[objOff + off] = value;
  }
}

let debugForcedStateApplied = false;

function maybeApplyDebugForcedState(state: ReturnType<typeof stateNs.emptyGameState>): void {
  if (debugForceOnce && debugForcedStateApplied) return;
  applyDebugForcedState(state);
  debugForcedStateApplied = true;
}

function signed32(value: number): number {
  return value | 0;
}

function signed16(value: number): number {
  const word = value & 0xffff;
  return word >= 0x8000 ? word - 0x10000 : word;
}

function fixedToFloat(value: number): number {
  return signed32(value) / 0x10000;
}

function fixedRawToFloat(value: number): number {
  return (value | 0) / 0x10000;
}

function projectedFloorDebug(state: ReturnType<typeof stateNs.emptyGameState>): {
  value: number;
  cx0: number;
  cx1: number;
  cy0: number;
  cz: number;
  fracX: number;
  fracY: number;
  bge: number;
} {
  const structOff = 0x1c28;
  const cx0 = signed16(readWorkWordBE(state, structOff + 0x04));
  const cx1 = signed16(readWorkWordBE(state, structOff + 0x0e));
  const cy0 = signed16(readWorkWordBE(state, structOff + 0x10));
  const cz = signed16(readWorkWordBE(state, structOff + 0x1a));
  const fracX = signed16(readWorkWordBE(state, 0x69e));
  const fracY = signed16(readWorkWordBE(state, 0x6a0));
  const bge = signed16(readWorkWordBE(state, 0x6a2));
  const dx = bge !== 0 ? cx1 - cx0 : cy0 - cz;
  const dy = bge !== 0 ? cx0 - cz : cx1 - cy0;
  const value = (((cz << 16) + (((dy * fracY + dx * fracX) << 13) | 0)) | 0) / 0x10000;
  return { value, cx0, cx1, cy0, cz, fracX, fracY, bge };
}

function objectDebugLine(
  state: ReturnType<typeof stateNs.emptyGameState>,
  index: number,
  playerX: number,
  playerY: number,
  playerZ: number,
): string {
  const off = 0x18 + index * 0xe2;
  const x = fixedToFloat(readWorkLongBE(state, off + 0x0c));
  const y = fixedToFloat(readWorkLongBE(state, off + 0x10));
  const z = fixedToFloat(readWorkLongBE(state, off + 0x14));
  const active = state.workRam[off + 0x18] ?? 0;
  const type = state.workRam[off + 0x19] ?? 0;
  const objectState = state.workRam[off + 0x1a] ?? 0;
  const kind = state.workRam[off + 0x1b] ?? 0;
  const shape = readWorkWordBE(state, off + 0x38);
  return `#${index} a=${active} type=${type} st=${objectState} k=${kind} shape=${shape.toString(16).padStart(4, "0")} ` +
    `x=${x.toFixed(1)} y=${y.toFixed(1)} z=${z.toFixed(1)} ` +
    `d=(${(x - playerX).toFixed(1)},${(y - playerY).toFixed(1)},${(z - playerZ).toFixed(1)})`;
}

function playerPhysicsDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const objOff = 0x18;
  const vx = fixedToFloat(readWorkLongBE(state, objOff + 0x00));
  const vy = fixedToFloat(readWorkLongBE(state, objOff + 0x04));
  const vz = fixedToFloat(readWorkLongBE(state, objOff + 0x08));
  const z = fixedToFloat(readWorkLongBE(state, objOff + 0x14));
  const zTarget = fixedToFloat(readWorkLongBE(state, objOff + 0x2a));
  const floor = projectedFloorDebug(state);
  const field20 = signed16(readWorkWordBE(state, objOff + 0x20));
  const tileX = signed16(readWorkWordBE(state, objOff + 0x2e));
  const tileY = signed16(readWorkWordBE(state, objOff + 0x30));
  return `player phys v=(${vx.toFixed(2)},${vy.toFixed(2)},${vz.toFixed(2)}) ` +
    `floorNow=${floor.value.toFixed(1)} dzFloor=${(floor.value - z).toFixed(1)} zTarget=${zTarget.toFixed(1)} ` +
    `proj=(cx0:${floor.cx0} cx1:${floor.cx1} cy0:${floor.cy0} cz:${floor.cz} fx:${floor.fracX} fy:${floor.fracY} bge:${floor.bge}) ` +
    `w20=${field20} tile=(${tileX},${tileY}) ` +
    `f36=${(state.workRam[objOff + 0x36] ?? 0).toString(16).padStart(2, "0")} ` +
    `f56=${(state.workRam[objOff + 0x56] ?? 0).toString(16).padStart(2, "0")} ` +
    `f57=${(state.workRam[objOff + 0x57] ?? 0).toString(16).padStart(2, "0")} ` +
    `f58=${(state.workRam[objOff + 0x58] ?? 0).toString(16).padStart(2, "0")} ` +
    `f59=${(state.workRam[objOff + 0x59] ?? 0).toString(16).padStart(2, "0")} ` +
    `f5f=${(state.workRam[objOff + 0x5f] ?? 0).toString(16).padStart(2, "0")} ` +
    `f60=${(state.workRam[objOff + 0x60] ?? 0).toString(16).padStart(2, "0")} ` +
    `d2=${readWorkWordBE(state, objOff + 0xd2)}`;
}

function scriptSlotDebugLine(
  state: ReturnType<typeof stateNs.emptyGameState>,
  index: number,
  playerX: number,
  playerY: number,
  playerZ: number,
): string {
  const off = 0x1302 + index * 0x60;
  const x = signed16(readWorkWordBE(state, off + 0x0c));
  const y = signed16(readWorkWordBE(state, off + 0x10));
  const z = signed16(readWorkWordBE(state, off + 0x14));
  const active = state.workRam[off + 0x18] ?? 0;
  const type = state.workRam[off + 0x19] ?? 0;
  const slotState = state.workRam[off + 0x1a] ?? 0;
  const bboxPtr = readWorkLongBE(state, off + 0x58);
  const animPtr = readWorkLongBE(state, off + 0x5c);
  return `slot${index} a=${active} type=${type} st=${slotState} ` +
    `x=${x} y=${y} z=${z} bbox=${bboxPtr.toString(16).padStart(6, "0")} anim=${animPtr.toString(16).padStart(6, "0")} ` +
    `d=(${(x - playerX).toFixed(1)},${(y - playerY).toFixed(1)},${(z - playerZ).toFixed(1)})`;
}

function terrainSlotDebugLine(
  state: ReturnType<typeof stateNs.emptyGameState>,
  index: number,
  playerX: number,
  playerY: number,
  playerZ: number,
): string {
  const off = 0x0a9c + index * 0x56;
  const x = signed16(readWorkWordBE(state, off + 0x0c));
  const y = signed16(readWorkWordBE(state, off + 0x10));
  const z = signed16(readWorkWordBE(state, off + 0x14));
  const active = state.workRam[off + 0x18] ?? 0;
  const slotState = state.workRam[off + 0x1a] ?? 0;
  const tag = state.workRam[off + 0x1f] ?? 0;
  const g690 = signed16(readWorkWordBE(state, 0x690));
  const g692 = signed16(readWorkWordBE(state, 0x692));
  const g696 = signed16(readWorkWordBE(state, 0x696));
  const g698 = signed16(readWorkWordBE(state, 0x698));
  const d6 = signed16((x - g690) & 0xffff);
  const a0 = signed16((y - g692) & 0xffff);
  const d1 = signed16(((x >> 3) - g696) & 0xffff);
  const d2 = signed16(((y >> 3) - g698) & 0xffff);
  return `terrain${index} a=${active} st=${slotState} tag=${tag.toString(16).padStart(2, "0")} ` +
    `x=${x} y=${y} z=${z} d1/d2=(${d1},${d2}) d6/a0=(${d6},${a0}) ` +
    `d=(${(x - playerX).toFixed(1)},${(y - playerY).toFixed(1)},${(z - playerZ).toFixed(1)})`;
}

function collisionGateDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const bytes = [0x666, 0x668, 0x66a, 0x66c, 0x66e, 0x670, 0x672]
    .map((off) => `${off.toString(16)}=${(state.workRam[off] ?? 0).toString(16).padStart(2, "0")}`)
    .join(" ");
  const gates = [0x674, 0x676, 0x678, 0x67a, 0x67c, 0x67e, 0x680, 0x682]
    .map((off) => `${off.toString(16)}=${signed16(readWorkWordBE(state, off))}`)
    .join(" ");
  const track = `base=(${signed16(readWorkWordBE(state, 0x696))},${signed16(readWorkWordBE(state, 0x698))}) ` +
    `cur=(${signed16(readWorkWordBE(state, 0x69a))},${signed16(readWorkWordBE(state, 0x69c))}) ` +
    `d2=${signed16(readWorkWordBE(state, 0x69e))} a0=${signed16(readWorkWordBE(state, 0x6a0))}`;
  return `collision ${bytes}\ncollision gates ${gates}\ncollision ${track}`;
}

function objectAddrDebugLabel(addr: number): string {
  if (addr >= 0x00400018 && addr < 0x00400018 + 0xe2 * 32) {
    const index = Math.floor((addr - 0x00400018) / 0xe2);
    const exact = 0x00400018 + index * 0xe2;
    if (exact === addr) return `#${index}@${addr.toString(16)}`;
  }
  return `@${addr.toString(16)}`;
}

function lastObjectPairCollisionDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const hit = state.debug?.lastObjectPairCollision;
  if (hit === undefined) return "last obj-pair collision: -";
  return `last obj-pair collision f=${hit.frame} loop=${hit.loopIndex} ` +
    `self=${objectAddrDebugLabel(hit.selfAddr)} st/k=${hit.selfState}/${hit.selfKind} ` +
    `target=${objectAddrDebugLabel(hit.targetAddr)} st/k=${hit.targetState}/${hit.targetKind} ` +
    `delta=(${hit.deltaX},${hit.deltaY},${hit.deltaZ}) saved=(${hit.savedX},${hit.savedY},${hit.savedZ})\n` +
    `  self p=(${fixedRawToFloat(hit.selfX).toFixed(1)},${fixedRawToFloat(hit.selfY).toFixed(1)},${fixedRawToFloat(hit.selfZ).toFixed(1)}) ` +
    `v ${fixedRawToFloat(hit.selfVxBefore).toFixed(2)},${fixedRawToFloat(hit.selfVyBefore).toFixed(2)} -> ` +
    `${fixedRawToFloat(hit.selfVxAfter).toFixed(2)},${fixedRawToFloat(hit.selfVyAfter).toFixed(2)}\n` +
    `  target p=(${fixedRawToFloat(hit.targetX).toFixed(1)},${fixedRawToFloat(hit.targetY).toFixed(1)},${fixedRawToFloat(hit.targetZ).toFixed(1)}) ` +
    `v ${fixedRawToFloat(hit.targetVxBefore).toFixed(2)},${fixedRawToFloat(hit.targetVyBefore).toFixed(2)} -> ` +
    `${fixedRawToFloat(hit.targetVxAfter).toFixed(2)},${fixedRawToFloat(hit.targetVyAfter).toFixed(2)}`;
}

function lastScriptSlotCollisionDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const hit = state.debug?.lastScriptSlotCollision;
  if (hit === undefined) return "last script-slot collision: -";
  return `last script-slot collision f=${hit.frame} entity=${objectAddrDebugLabel(hit.entityAddr)} ` +
    `slot=${hit.slotIndex}@${hit.slotAddr.toString(16)} st=${hit.slotState} entitySt=${hit.entityState} ` +
    `slot=(${hit.slotX},${hit.slotY},${hit.slotZ}) ` +
    `bbox=(${hit.bboxX0},${hit.bboxY0})..(${hit.bboxX1},${hit.bboxY1}) ` +
    `marble=(${hit.marbleX0},${hit.marbleY0},${hit.marbleZ0})..(${hit.marbleX1},${hit.marbleY1},${hit.marbleZ1})`;
}

function lastTerrainSlotCollisionDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const hit = state.debug?.lastTerrainSlotCollision;
  if (hit === undefined) return "last terrain-slot collision: -";
  return `last terrain-slot collision f=${hit.frame} entity=${objectAddrDebugLabel(hit.entityAddr)} ` +
    `slot=${hit.slotIndex}@${hit.slotAddr.toString(16)} tag=${hit.colorTag.toString(16).padStart(2, "0")} ` +
    `reason=${hit.reason} d1/d2=(${hit.d1},${hit.d2}) d6/a0=(${hit.d6},${hit.a0}) flags=(${hit.flagX},${hit.flagY})\n` +
    `  slot=(${hit.slotX},${hit.slotY},${hit.slotZ}) entity=(` +
    `${fixedRawToFloat(hit.entityX).toFixed(1)},${fixedRawToFloat(hit.entityY).toFixed(1)},${fixedRawToFloat(hit.entityZ).toFixed(1)}) ` +
    `vBefore=(${fixedRawToFloat(hit.entityVxBefore).toFixed(2)},${fixedRawToFloat(hit.entityVyBefore).toFixed(2)})`;
}

function lastTubeProbeDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const hit = state.debug?.lastTubeProbe;
  if (hit === undefined) return "last tube probe: -";
  return `last tube probe f=${hit.frame} entity=${objectAddrDebugLabel(hit.entityAddr)} ` +
    `slot=${hit.slotIndex}@${hit.slotAddr.toString(16)} tag=${hit.colorTag.toString(16).padStart(2, "0")} ` +
    `result=${hit.result} d1/d2=(${hit.d1},${hit.d2}) d6/a0=(${hit.d6},${hit.a0}) ` +
    `st/f36/f58/f59=${hit.state1a}/${hit.state36.toString(16).padStart(2, "0")}/` +
    `${hit.f58.toString(16).padStart(2, "0")}/${hit.f59.toString(16).padStart(2, "0")}\n` +
    `  slot=(${hit.slotX},${hit.slotY},${hit.slotZ}) entity=(` +
    `${fixedRawToFloat(hit.entityX).toFixed(1)},${fixedRawToFloat(hit.entityY).toFixed(1)},${fixedRawToFloat(hit.entityZ).toFixed(1)}) ` +
    `v=(${fixedRawToFloat(hit.entityVx).toFixed(2)},${fixedRawToFloat(hit.entityVy).toFixed(2)},${fixedRawToFloat(hit.entityVz).toFixed(2)})`;
}

function lastTerrainScanStopDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const hit = state.debug?.lastTerrainScanStop;
  if (hit === undefined) return "last terrain scan stop: -";
  return `last terrain scan stop f=${hit.frame} entity=${objectAddrDebugLabel(hit.entityAddr)} ` +
    `reason=${hit.reason} iter=${hit.iterCount} slot=${hit.slotIndex}@${hit.slotAddr.toString(16)} ` +
    `a=${hit.active} st=${hit.slotState} tag=${hit.colorTag.toString(16).padStart(2, "0")} ` +
    `d1/d2=(${hit.d1},${hit.d2}) d6/a0=(${hit.d6},${hit.a0}) ` +
    `f58/f59=${hit.f58.toString(16).padStart(2, "0")}/${hit.f59.toString(16).padStart(2, "0")}\n` +
    `  slot=(${hit.slotX},${hit.slotY},${hit.slotZ}) entity=(` +
    `${fixedRawToFloat(hit.entityX).toFixed(1)},${fixedRawToFloat(hit.entityY).toFixed(1)},${fixedRawToFloat(hit.entityZ).toFixed(1)})`;
}

function lastObjectStateEntryDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const hit = state.debug?.lastObjectStateEntry;
  if (hit === undefined) return "last object-state entry: -";
  const tag =
    hit.colorTag === undefined
      ? ""
      : ` tag=${hit.colorTag.toString(16).padStart(2, "0")}`;
  const slot = hit.slotIndex === undefined ? "" : ` slot=${hit.slotIndex}`;
  const d =
    hit.d1 === undefined
      ? ""
      : ` d1/d2=(${hit.d1},${hit.d2}) d6/a0=(${hit.d6},${hit.a0})`;
  const floor =
    hit.floorNow === undefined
      ? ""
      : ` floor=${fixedRawToFloat(hit.floorNow).toFixed(1)}`;
  const zDelta =
    hit.zDelta === undefined
      ? ""
      : ` zDelta=${fixedRawToFloat(hit.zDelta).toFixed(1)}`;
  const detail = hit.detail === undefined ? "" : ` ${hit.detail}`;
  return `last object-state entry f=${hit.frame} source=${hit.source} ` +
    `entity=${objectAddrDebugLabel(hit.entityAddr)} code=${hit.code}${slot}${tag}${d}${floor}${zDelta}${detail}\n` +
    `  prev a/type/st/k=${hit.active}/${hit.type}/${hit.prevState}/${hit.prevKind} ` +
    `f36=${hit.prevF36.toString(16).padStart(2, "0")} f56=${hit.prevF56.toString(16).padStart(2, "0")} ` +
    `f57=${hit.prevF57.toString(16).padStart(2, "0")} f58=${hit.prevF58.toString(16).padStart(2, "0")} ` +
    `f59=${hit.prevF59.toString(16).padStart(2, "0")} f5f=${hit.prevF5f.toString(16).padStart(2, "0")} ` +
    `f60=${hit.prevF60.toString(16).padStart(2, "0")}\n` +
    `  p=(${fixedRawToFloat(hit.prevX).toFixed(1)},${fixedRawToFloat(hit.prevY).toFixed(1)},${fixedRawToFloat(hit.prevZ).toFixed(1)}) ` +
    `targetZ=${fixedRawToFloat(hit.prevTargetZ).toFixed(1)} ` +
    `v=(${fixedRawToFloat(hit.prevVx).toFixed(2)},${fixedRawToFloat(hit.prevVy).toFixed(2)},${fixedRawToFloat(hit.prevVz).toFixed(2)})`;
}

function lastBoundsBounceDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const hit = state.debug?.lastHelper121B8BoundsBounce;
  if (hit === undefined) return "last bounds bounce: -";
  return `last bounds bounce f=${hit.frame} entity=${objectAddrDebugLabel(hit.entityAddr)} ` +
    `d1=${hit.d1} d4/d5=(${fixedRawToFloat(hit.d4).toFixed(2)},${fixedRawToFloat(hit.d5).toFixed(2)})\n` +
    `  p=(${fixedRawToFloat(hit.xBefore).toFixed(1)},${fixedRawToFloat(hit.yBefore).toFixed(1)},${fixedRawToFloat(hit.zBefore).toFixed(1)}) -> ` +
    `(${fixedRawToFloat(hit.xAfter).toFixed(1)},${fixedRawToFloat(hit.yAfter).toFixed(1)},${fixedRawToFloat(hit.zAfter).toFixed(1)}) ` +
    `v=(${fixedRawToFloat(hit.vxBefore).toFixed(2)},${fixedRawToFloat(hit.vyBefore).toFixed(2)},${fixedRawToFloat(hit.vzBefore).toFixed(2)}) -> ` +
    `(${fixedRawToFloat(hit.vxAfter).toFixed(2)},${fixedRawToFloat(hit.vyAfter).toFixed(2)},${fixedRawToFloat(hit.vzAfter).toFixed(2)})`;
}

function lastTrackballApplyDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const hit = state.debug?.lastTrackballApply;
  if (hit === undefined) return "last FUN_25DF6 apply: -";
  return `last FUN_25DF6 apply f=${hit.frame} entity=${objectAddrDebugLabel(hit.entityAddr)} ` +
    `raw=(${hit.rawX},${hit.rawY}) applied=(${hit.appliedX},${hit.appliedY}) ` +
    `v=(${fixedRawToFloat(hit.vxBefore).toFixed(2)},${fixedRawToFloat(hit.vyBefore).toFixed(2)}) -> ` +
    `(${fixedRawToFloat(hit.vxAfter).toFixed(2)},${fixedRawToFloat(hit.vyAfter).toFixed(2)}) ` +
    `proj=(cx0:${hit.cx0} cx1:${hit.cx1} cy0:${hit.cy0} cz:${hit.cz} ` +
    `fx:${hit.fracX} fy:${hit.fracY} bge:${hit.bge})`;
}

function lastTrackballSanitizeDebugLine(state: ReturnType<typeof stateNs.emptyGameState>): string {
  const hit = state.debug?.lastTrackballSanitize;
  if (hit === undefined) return "last terrain delta guard: -";
  return `last terrain delta guard f=${hit.frame} raw=(${hit.rawX},${hit.rawY}) ` +
    `suppress=(${hit.suppressedX ? hit.reasonX : "-"},${hit.suppressedY ? hit.reasonY : "-"}) ` +
    `proj=(cx0:${hit.cx0} cx1:${hit.cx1} cy0:${hit.cy0} cz:${hit.cz} ` +
    `fx:${hit.fracX} fy:${hit.fracY} bge:${hit.bge})`;
}

function debugForcedStateLine(): string {
  const parts: string[] = [];
  if (debugForcedPlayer !== undefined) {
    parts.push(`player=(${debugForcedPlayer.x},${debugForcedPlayer.y},${debugForcedPlayer.z})`);
  }
  if (debugForcedScrollX !== undefined) parts.push(`scrollX=${debugForcedScrollX}`);
  if (debugForcedScrollY !== undefined) parts.push(`scrollY=${debugForcedScrollY}`);
  if (debugForceBeforeTick) parts.push("beforeTick=1");
  if (debugForceOnce) parts.push("once=1");
  if (parts.length === 0) return "debug forced state: -";
  return `debug forced state: ${parts.join(" ")}`;
}

interface PlayerImpulseSample {
  frame: number;
  level: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  state: number;
  kind: number;
  w20: number;
  f36: number;
  f56: number;
  f57: number;
  f58: number;
  f59: number;
  f5f: number;
  f60: number;
  chgX: number;
  chgY: number;
  tileX: number;
  tileY: number;
  d2Counter: number;
}

let lastPlayerImpulseSample: PlayerImpulseSample | undefined;
let playerImpulseHistory: string[] = [];
let lastPlayerImpulseLine = "last impulse history: -";
let airStartLine = "air start: -";
let debugFreezeActive = false;

function debugFreezeArmedLine(): string {
  if (!freezeOnBug) return "debug freeze: off";
  const modes = [
    freezeOnImpulse ? `impulse>=${freezeImpulseMinDv.toFixed(1)}` : "",
    freezeOnAir ? "air" : "",
    freezeOnState4 ? "state4" : "",
  ].filter(Boolean).join(",");
  return `debug freeze: armed ${modes || "none"}`;
}

let debugFreezeLine = debugFreezeArmedLine();

function samplePlayerImpulse(
  state: ReturnType<typeof stateNs.emptyGameState>,
  frameCount: number,
): PlayerImpulseSample {
  const objOff = 0x18;
  return {
    frame: frameCount,
    level: readWorkWordBE(state, 0x394),
    x: fixedToFloat(readWorkLongBE(state, objOff + 0x0c)),
    y: fixedToFloat(readWorkLongBE(state, objOff + 0x10)),
    z: fixedToFloat(readWorkLongBE(state, objOff + 0x14)),
    vx: fixedToFloat(readWorkLongBE(state, objOff + 0x00)),
    vy: fixedToFloat(readWorkLongBE(state, objOff + 0x04)),
    vz: fixedToFloat(readWorkLongBE(state, objOff + 0x08)),
    state: state.workRam[objOff + 0x1a] ?? 0,
    kind: state.workRam[objOff + 0x1b] ?? 0,
    w20: signed16(readWorkWordBE(state, objOff + 0x20)),
    f36: state.workRam[objOff + 0x36] ?? 0,
    f56: state.workRam[objOff + 0x56] ?? 0,
    f57: state.workRam[objOff + 0x57] ?? 0,
    f58: state.workRam[objOff + 0x58] ?? 0,
    f59: state.workRam[objOff + 0x59] ?? 0,
    f5f: state.workRam[objOff + 0x5f] ?? 0,
    f60: state.workRam[objOff + 0x60] ?? 0,
    chgX: state.workRam[0x666] ?? 0,
    chgY: state.workRam[0x668] ?? 0,
    tileX: signed16(readWorkWordBE(state, objOff + 0x2e)),
    tileY: signed16(readWorkWordBE(state, objOff + 0x30)),
    d2Counter: readWorkWordBE(state, objOff + 0xd2),
  };
}

function speed2d(sample: PlayerImpulseSample): number {
  return Math.hypot(sample.vx, sample.vy);
}

function formatPlayerImpulseSample(sample: PlayerImpulseSample): string {
  return `f=${sample.frame} p=(${sample.x.toFixed(1)},${sample.y.toFixed(1)},${sample.z.toFixed(1)}) ` +
    `v=(${sample.vx.toFixed(2)},${sample.vy.toFixed(2)},${sample.vz.toFixed(2)}) ` +
    `st=${sample.state} k=${sample.kind} w20=${sample.w20} tile=(${sample.tileX},${sample.tileY}) ` +
    `f36=${sample.f36.toString(16).padStart(2, "0")} f56=${sample.f56.toString(16).padStart(2, "0")} ` +
    `f57=${sample.f57.toString(16).padStart(2, "0")} f58=${sample.f58.toString(16).padStart(2, "0")} ` +
    `f59=${sample.f59.toString(16).padStart(2, "0")} ` +
    `f5f=${sample.f5f.toString(16).padStart(2, "0")} f60=${sample.f60.toString(16).padStart(2, "0")} ` +
    `d2=${sample.d2Counter} chg=(${sample.chgX},${sample.chgY})`;
}

function pushPlayerImpulseHistory(reason: string, previous: PlayerImpulseSample, current: PlayerImpulseSample): void {
  playerImpulseHistory.unshift(
    `${reason}\n  prev ${formatPlayerImpulseSample(previous)}\n  now  ${formatPlayerImpulseSample(current)}`,
  );
  playerImpulseHistory = playerImpulseHistory.slice(0, 5);
  lastPlayerImpulseLine = ["last impulse history:", ...playerImpulseHistory].join("\n");
}

function recordAirStart(previous: PlayerImpulseSample, current: PlayerImpulseSample): void {
  if (previous.f36 === 0x02 || current.f36 !== 0x02) return;
  airStartLine =
    `air start\n  prev ${formatPlayerImpulseSample(previous)}\n  now  ${formatPlayerImpulseSample(current)}`;
  if (freezeOnAir) armDebugFreeze("air start", current);
}

function armDebugFreeze(reason: string, current: PlayerImpulseSample): void {
  if (!freezeOnBug || debugFreezeActive) return;
  debugFreezeActive = true;
  debugFreezeLine =
    `debug freeze: ${reason} @ f=${current.frame} p=(${current.x.toFixed(1)},${current.y.toFixed(1)},${current.z.toFixed(1)})`;
}

function recordPlayerImpulseDebug(
  state: ReturnType<typeof stateNs.emptyGameState>,
  frameCount: number,
): void {
  const current = samplePlayerImpulse(state, frameCount);
  const previous = lastPlayerImpulseSample;
  if (previous === undefined || current.frame <= previous.frame || current.level !== previous.level) {
    lastPlayerImpulseSample = current;
    if (previous !== undefined && current.level !== previous.level) {
      playerImpulseHistory = [];
      lastPlayerImpulseLine = "last impulse history: -";
      airStartLine = "air start: -";
      debugFreezeActive = false;
      debugFreezeLine = debugFreezeArmedLine();
    }
    return;
  }

  if (freezeOnAir && current.f36 === 0x02) armDebugFreeze("air", current);
  if (freezeOnState4 && current.state === 0x04) armDebugFreeze("state 4", current);

  const dv = Math.hypot(current.vx - previous.vx, current.vy - previous.vy, current.vz - previous.vz);
  const prevSpeed = speed2d(previous);
  const currentSpeed = speed2d(current);
  const dot = previous.vx * current.vx + previous.vy * current.vy;
  const posStep = Math.hypot(current.x - previous.x, current.y - previous.y, (current.z - previous.z) / 8);
  const suddenStop = prevSpeed > 0.35 && currentSpeed < prevSpeed * 0.4;
  const reverse = prevSpeed > 0.35 && currentSpeed > 0.05 && dot < 0;
  const stateFlip =
    current.state !== previous.state ||
    current.kind !== previous.kind ||
    current.f36 !== previous.f36 ||
    current.f56 !== previous.f56 ||
    current.f58 !== previous.f58 ||
    current.f59 !== previous.f59 ||
    current.f5f !== previous.f5f ||
    current.f60 !== previous.f60;
  const f57Countdown = current.f57 === ((previous.f57 - 1) & 0xff);
  const f57Jump = current.f57 !== previous.f57 && !f57Countdown;
  const state4Entry = previous.state !== 0x04 && current.state === 0x04;
  const tileJump =
    (current.tileX !== previous.tileX || current.tileY !== previous.tileY) &&
    (posStep < 1 || current.state !== 0 || previous.state !== 0);
  const collisionFlag = current.chgX !== 0 || current.chgY !== 0;
  recordAirStart(previous, current);
  if (freezeOnState4 && state4Entry) armDebugFreeze("state 4 entry", current);
  if (freezeOnImpulse && dv > freezeImpulseMinDv) armDebugFreeze(`large impulse dv=${dv.toFixed(2)}`, current);
  if (dv > 0.35 || suddenStop || reverse || stateFlip || f57Jump || tileJump || collisionFlag) {
    const reasons = [
      dv > 0.35 ? `dv=${dv.toFixed(2)}` : "",
      suddenStop ? "stop" : "",
      reverse ? "reverse" : "",
      stateFlip ? "state/flag" : "",
      f57Jump ? "f57" : "",
      tileJump ? "tile" : "",
      collisionFlag ? "chg" : "",
    ].filter(Boolean).join(",");
    pushPlayerImpulseHistory(reasons, previous, current);
  }
  lastPlayerImpulseSample = current;
}

function createObjectDebugOverlay(): HTMLPreElement {
  const el = document.createElement("pre");
  el.style.cssText =
    "position:fixed;left:10px;top:10px;z-index:9998;margin:0;padding:8px 10px;" +
    "max-width:min(1080px,calc(100vw - 20px));max-height:44vh;overflow:auto;background:rgba(0,0,0,.72);" +
    "color:#b8f7ff;border:1px solid rgba(184,247,255,.45);font:12px/1.35 monospace;" +
    "pointer-events:none;white-space:pre-wrap;";
  document.body.appendChild(el);
  return el;
}

function createObjectDebugToggleButton(
  initialEnabled: boolean,
  onToggle: (enabled: boolean) => void,
): HTMLButtonElement {
  let enabled = initialEnabled;
  const b = document.createElement("button");
  b.type = "button";
  b.style.cssText =
    "position:fixed;left:20px;bottom:20px;z-index:10000;padding:9px 12px;" +
    "min-width:104px;background:#141414;color:#fff;border:1px solid #666;" +
    "border-radius:6px;cursor:pointer;font:700 13px/1 system-ui,-apple-system,sans-serif;" +
    "touch-action:manipulation;user-select:none;-webkit-user-select:none;";
  const render = (): void => {
    b.textContent = enabled ? "DEBUG ON" : "DEBUG OFF";
    b.setAttribute("aria-pressed", enabled ? "true" : "false");
    b.style.background = enabled ? "#213d44" : "#141414";
    b.style.borderColor = enabled ? "#7fcde0" : "#666";
  };
  b.addEventListener("click", (event) => {
    event.preventDefault();
    enabled = !enabled;
    if (!enabled) {
      debugFreezeActive = false;
      debugFreezeLine = debugFreezeArmedLine();
    }
    onToggle(enabled);
    render();
  });
  render();
  document.body.appendChild(b);
  return b;
}

function createStartLevelUnavailableOverlay(level: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;left:50%;top:50%;z-index:9999;transform:translate(-50%,-50%);" +
    "width:min(520px,calc(100vw - 48px));box-sizing:border-box;padding:18px 20px;" +
    "background:rgba(0,0,0,.86);border:1px solid rgba(184,247,255,.55);" +
    "color:#d9f7ff;font:14px/1.45 system-ui,-apple-system,sans-serif;text-align:left;";
  el.textContent =
    `startLevel=${level} non ha ancora un seed giocabile verificato. ` +
    "Il mapping practice resta bloccato finche' il candidato non passa il gate " +
    "descriptor, MAME active-vs-neutral e smoke browser.";
  document.body.appendChild(el);
  return el;
}

function updateObjectDebugOverlay(
  el: HTMLPreElement,
  state: ReturnType<typeof stateNs.emptyGameState>,
  frameCount: number,
): void {
  const playerX = fixedToFloat(readWorkLongBE(state, 0x18 + 0x0c));
  const playerY = fixedToFloat(readWorkLongBE(state, 0x18 + 0x10));
  const playerZ = fixedToFloat(readWorkLongBE(state, 0x18 + 0x14));
  const objectCount = Math.min(32, readWorkWordBE(state, 0x396) || 32);
  const candidates: Array<{ index: number; rank: number }> = [];
  for (let index = 1; index < objectCount; index++) {
    const off = 0x18 + index * 0xe2;
    const active = state.workRam[off + 0x18] ?? 0;
    const type = state.workRam[off + 0x19] ?? 0;
    const objectState = state.workRam[off + 0x1a] ?? 0;
    const shape = readWorkWordBE(state, off + 0x38);
    if (active === 0 && type === 0 && objectState === 0 && shape === 0) continue;
    const x = fixedToFloat(readWorkLongBE(state, off + 0x0c));
    const y = fixedToFloat(readWorkLongBE(state, off + 0x10));
    const z = fixedToFloat(readWorkLongBE(state, off + 0x14));
    const rank = Math.abs(x - playerX) + Math.abs(y - playerY) + Math.abs((z - playerZ) / 8);
    candidates.push({ index, rank });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  const terrainSlots: Array<{ index: number; rank: number }> = [];
  for (let index = 0; index < 25; index++) {
    const off = 0x0a9c + index * 0x56;
    const active = state.workRam[off + 0x18] ?? 0;
    const slotState = state.workRam[off + 0x1a] ?? 0;
    const tag = state.workRam[off + 0x1f] ?? 0;
    if (active === 0 && slotState === 0 && tag === 0) continue;
    const x = signed16(readWorkWordBE(state, off + 0x0c));
    const y = signed16(readWorkWordBE(state, off + 0x10));
    const z = signed16(readWorkWordBE(state, off + 0x14));
    const rank = Math.abs(x - playerX) + Math.abs(y - playerY) + Math.abs((z - playerZ) / 8);
    terrainSlots.push({ index, rank });
  }
  terrainSlots.sort((a, b) => a.rank - b.rank);
  const scriptSlots: Array<{ index: number; rank: number }> = [];
  for (let index = 0; index < 4; index++) {
    const off = 0x1302 + index * 0x60;
    const active = state.workRam[off + 0x18] ?? 0;
    const slotState = state.workRam[off + 0x1a] ?? 0;
    if (active === 0 && slotState === 0) continue;
    const x = signed16(readWorkWordBE(state, off + 0x0c));
    const y = signed16(readWorkWordBE(state, off + 0x10));
    const z = signed16(readWorkWordBE(state, off + 0x14));
    const rank = Math.abs(x - playerX) + Math.abs(y - playerY) + Math.abs((z - playerZ) / 8);
    scriptSlots.push({ index, rank });
  }
  scriptSlots.sort((a, b) => a.rank - b.rank);
  const lines = [
    `f=${frameCount} main=${readWorkWordBE(state, 0x390)} mode=${readWorkWordBE(state, 0x392)} level=${readWorkWordBE(state, 0x394)} ` +
      `scroll=(${state.videoScrollX},${state.videoScrollY})`,
    `player ${objectDebugLine(state, 0, playerX, playerY, playerZ)} timer=${readWorkWordBE(state, 0x18 + 0x6a)}`,
    playerPhysicsDebugLine(state),
    collisionGateDebugLine(state),
    lastObjectPairCollisionDebugLine(state),
    lastScriptSlotCollisionDebugLine(state),
    lastTerrainSlotCollisionDebugLine(state),
    lastTubeProbeDebugLine(state),
    lastTerrainScanStopDebugLine(state),
    lastObjectStateEntryDebugLine(state),
    "terrain prefix slots:",
    ...Array.from({ length: 8 }, (_, index) => terrainSlotDebugLine(state, index, playerX, playerY, playerZ)),
    "nearest terrain slots:",
    ...terrainSlots.slice(0, 4).map(({ index }) => terrainSlotDebugLine(state, index, playerX, playerY, playerZ)),
    lastBoundsBounceDebugLine(state),
    lastTrackballApplyDebugLine(state),
    lastTrackballSanitizeDebugLine(state),
    debugForcedStateLine(),
    "nearest objects:",
    ...candidates.slice(0, 8).map(({ index }) => objectDebugLine(state, index, playerX, playerY, playerZ)),
    debugFreezeLine,
    airStartLine,
    lastPlayerImpulseLine,
    "nearest script slots:",
    ...scriptSlots.slice(0, 4).map(({ index }) => scriptSlotDebugLine(state, index, playerX, playerY, playerZ)),
  ];
  el.textContent = lines.join("\n");
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
    if (soundReplayUrl !== null) {
      await runSoundReplay(rom, soundReplayUrl);
      return;
    }
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
  interface LoadedPlayableSeed {
    warmState: WarmState;
    mainLoopBodyTicks: number | undefined;
  }
  const loadPlayableSeedWarmState = async (seedName: string): Promise<LoadedPlayableSeed | undefined> => {
    const safeSeedName = seedName.replace(/[^a-z0-9_-]/gi, "");
    const r = await fetch(`/scenarios/playable/${safeSeedName}.seed.json`);
    if (!r.ok) throw new Error(`fetch fail: ${r.status}`);
    const seed = await r.json() as {
      frame: number;
      slapsticBank?: number;
      mainLoopBodyTicks?: number;
      workRam: string;
      playfieldRam: string;
      spriteRam: string;
      alphaRam: string;
      colorRam: string;
    };
    const workRam = hex2bytes(seed.workRam, 0x2000);
    return {
      warmState: {
        workRam,
        playfieldRam: hex2bytes(seed.playfieldRam, 0x2000),
        spriteRam: hex2bytes(seed.spriteRam, 0x1000),
        alphaRam: hex2bytes(seed.alphaRam, 0x1000),
        colorRam: hex2bytes(seed.colorRam, 0x800),
        videoScrollY: (((workRam[0x02] ?? 0) << 8) | (workRam[0x03] ?? 0)) & 0x1ff,
        videoScrollX: 0,
        slapsticBank: typeof seed.slapsticBank === "number" ? seed.slapsticBank & 3 : 1,
      },
      mainLoopBodyTicks: typeof seed.mainLoopBodyTicks === "number" ? seed.mainLoopBodyTicks : undefined,
    };
  };
  let warmState: WarmState | undefined;
  let warmStateMainLoopBodyTicks: number | undefined;
  let warmStateIsPlayableSeed = false;
  const useMameDump = searchParams.get("mameDump") === "1";
  const useMameLive = searchParams.get("mameLive") === "1";
  const useCoinStartFlow =
    warmState === undefined &&
    rom !== undefined &&
    scenarioName === null &&
    !useStartLevelPractice &&
    (forceCoinStart || (forcePlay && playableSeedName === null && !useMameDump && !useMameLive));
  let coinStartWarmState: WarmState | undefined;
  let coinStartMainLoopBodyTicks: number | undefined;
  if (playableSeedName !== null) {
    try {
      const loaded = await loadPlayableSeedWarmState(playableSeedName);
      warmState = loaded?.warmState;
      warmStateMainLoopBodyTicks = loaded?.mainLoopBodyTicks;
      warmStateIsPlayableSeed = true;
      console.log(`[warmState] loaded playable seed ${playableSeedName}`);
    } catch (e) {
      console.warn("[warmState] playable seed fetch failed:", e);
    }
  } else if (useStartLevelPractice && startLevelPlayableSeedName !== undefined) {
    try {
      const loaded = await loadPlayableSeedWarmState(startLevelPlayableSeedName);
      warmState = loaded?.warmState;
      warmStateMainLoopBodyTicks = loaded?.mainLoopBodyTicks;
      warmStateIsPlayableSeed = true;
      console.log(`[marble-love] loaded startLevel=${startLevelPractice} seed ${startLevelPlayableSeedName}`);
    } catch (e) {
      console.warn(`[marble-love] startLevel=${startLevelPractice} seed fetch failed:`, e);
    }
  } else if (useCoinStartFlow) {
    try {
      const loaded = await loadPlayableSeedWarmState(livePlaySeedName);
      coinStartWarmState = loaded?.warmState;
      coinStartMainLoopBodyTicks = loaded?.mainLoopBodyTicks;
      console.log(`[marble-love] prepared live gameplay seed ${livePlaySeedName}`);
    } catch (e) {
      console.warn(`[marble-love] live gameplay seed ${livePlaySeedName} fetch failed:`, e);
      try {
        const loaded = await loadPlayableSeedWarmState(replayPlayableSeedName);
        coinStartWarmState = loaded?.warmState;
        coinStartMainLoopBodyTicks = loaded?.mainLoopBodyTicks;
        console.warn(`[marble-love] falling back to replay seed ${replayPlayableSeedName}`);
      } catch (fallbackError) {
        console.warn("[marble-love] live gameplay fallback seed fetch failed:", fallbackError);
      }
    }
  } else if (scenarioName !== null) {
    // ?scenario=NAME: load gameplay warm-seed (snapshots[0] da 101-snapshot JSON).
    try {
      const r = await fetch(`/scenarios/gameplay/${scenarioName}.json`);
      if (r.ok) {
        const rawJson = await r.json() as { snapshots: Array<{
          frame: number; slapsticBank?: number; workRam: string;
          playfieldRam: string; spriteRam: string; alphaRam: string; colorRam: string;
        }> };
        const dump = rawJson.snapshots[0]!;
        const dumpSlapsticBank = typeof dump.slapsticBank === "number" ? dump.slapsticBank : Number.NaN;
        const warmSlapsticBank = Number.isFinite(dumpSlapsticBank) && dumpSlapsticBank >= 0
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
        console.log(
          `[warmState] loaded gameplay scenario ${scenarioName} (frame ${dump.frame}` +
          ")",
        );
      }
    } catch (e) {
      console.warn(`[warmState] scenario ${scenarioName} fetch failed:`, e);
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
        ? useCoinStartFlow || startLevelPracticeUnavailable
          ? {}
          : { preloadLevel: 0, fullScreenInit: useFullScreenInit }
        : {},
  );
  const startLevelPracticeActive = useStartLevelPractice && warmState !== undefined;
  if (warmStateIsPlayableSeed) {
    // Playable warm seeds are MAME frame_done snapshots. Most reviewed windows
    // use phase 1; descriptor L1 post-seed starts on phase 0, carried by seed
    // metadata so browser replay can match the MAME capture.
    s.clock.mainLoopBodyTicks = wrap.as_u32(warmStateMainLoopBodyTicks ?? 1);
  }
  if (startLevelPracticeActive) {
    // Practice warm seeds are entry snapshots for testing a specific level.
    // Re-arm the manual gameplay dispatcher so active input can move the
    // marble; raw `?scenario=...` keeps the MAME dispatcher for oracle drill.
    if (!preservePlayableDispatcher) {
      s.workRam[0x390] = 0x00;
      s.workRam[0x391] = 0x00;
    }
    s.clock.mainLoopBodyTicks = wrap.as_u32(warmStateMainLoopBodyTicks ?? 1);
    console.log(`[marble-love] startLevel=${startLevelPractice} practice ready (${startLevelPlayableSeedName})`);
  } else if (startLevelPracticeUnavailable && startLevelPractice !== undefined) {
    createStartLevelUnavailableOverlay(startLevelPractice);
    console.warn(`[marble-love] startLevel=${startLevelPractice} is not available yet: no proven playable seed`);
  }
  if (useCoinStartFlow) {
    // Start from the same staged attract/start gate reached after game over,
    // instead of leaving only the bottom credit alpha over a blank playfield.
    // The full 6502 coin-credit path is not emulated yet, so browser coin
    // pulses feed the gateCheck callback below.
    prepareBrowserCoinStartAttract(s);
    console.log("[marble-love] coin/start flow enabled: press 5 (coin), then Enter/Space (START1)");
  }

  // Default ON: indirect renderer = MAME bit-perfect bitmap_ind16 path.
  // Disable con ?indirect=0 per fallback al renderer Pixi diretto (debug).
  const useIndirect = searchParams.get("indirect") !== "0";
  const renderer = initRenderer(app, rom?.graphics, { indirect: useIndirect });
  if (useIndirect) {
    console.log("[marble-love] indirect renderer enabled (MAME bit-perfect bitmap_ind16 path)");
  }
  let objectDebugEnabled = showObjectDebugOverlay && !startLevelPracticeUnavailable;
  let objectDebugOverlay = objectDebugEnabled ? createObjectDebugOverlay() : undefined;
  if (!startLevelPracticeUnavailable && showObjectDebugOverlay) {
    createObjectDebugToggleButton(objectDebugEnabled, (enabled) => {
      objectDebugEnabled = enabled;
      if (enabled && objectDebugOverlay === undefined) {
        objectDebugOverlay = createObjectDebugOverlay();
      }
      if (objectDebugOverlay !== undefined) {
        objectDebugOverlay.style.display = enabled ? "block" : "none";
      }
    });
  }
  const inputState = initInput();
  if (warmStateIsPlayableSeed) {
    inputState.setP1Absolute(s.workRam[0x18 + 0xc9] ?? 0xff, s.workRam[0x18 + 0xc8] ?? 0xff);
  }
  let browserCoinCredits = 0;
  let previousInputButtons = 0;
  let manualPlayStarted = false;
  let lastLevelTimeOverrideLevel: number | undefined;
  let demoFrame = 0;

  // ─── Mobile/touch UI: pulsanti COIN + START on-screen ───────────────────
  // Da mobile non ci sono tasti "5" / Enter. Chiamo DIRECT le helper di
  // inputState (più affidabile su iOS Safari che synthetic KeyboardEvent).
  const makeMobileButton = (
    label: string,
    action: () => void,
    right: number,
    bg: string,
  ): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      `position:fixed;bottom:20px;right:${right}px;z-index:9999;` +
      `padding:14px 20px;font-size:18px;` +
      `background:${bg};color:#fff;border:2px solid #888;border-radius:8px;` +
      `cursor:pointer;font-family:system-ui,sans-serif;font-weight:bold;` +
      `touch-action:manipulation;user-select:none;-webkit-user-select:none;`;
    const trigger = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      action();
      // Feedback visivo
      b.style.opacity = "0.5";
      setTimeout(() => { b.style.opacity = "1"; }, 100);
    };
    b.addEventListener("click", trigger);
    b.addEventListener("touchstart", trigger, { passive: false });
    document.body.appendChild(b);
    return b;
  };
  makeMobileButton("🪙 COIN", () => {
    inputState.triggerCoinPulse();
    console.log("[mobile] COIN pulse triggered");
  }, 160, "#2a4a2a");
  makeMobileButton("▶ START", () => {
    inputState.triggerStartPulse();
    console.log("[mobile] START pulse triggered");
  }, 20, "#4a2a2a");

  function maybeApplyLevelTimeOverride(reason: string): void {
    if (levelTimeOverride === undefined) return;
    if ((s.workRam[0x18 + 0x18] ?? 0) === 0) return;
    if (readWorkWordBE(s, 0x390) !== 0) return;
    const levelIndex = readWorkWordBE(s, 0x394);
    if (lastLevelTimeOverrideLevel === levelIndex) return;
    applyLevelTimeOverride(s, levelTimeOverride);
    lastLevelTimeOverrideLevel = levelIndex;
    console.log(`[marble-love] levelTime=${levelTimeOverride}s applied for level index ${levelIndex} (${reason})`);
  }

  // ─── Sound chip + Web Audio renderer (?sound != 0) ───────────────────────
  // V1 MVP audio: SoundChip 6502+YM2151+POKEY in tick parallelo, renderer polla
  // register shadow → AudioWorklet sintetizza tones (sine + square + noise).
  // Cherry-pick da feature/sound-chip. AudioContext richiede user gesture →
  // pulsante UI "Enable Audio".
  let soundChip: ReturnType<typeof createSoundChip> | undefined;
  let soundRenderer: SoundRenderer | undefined;
  if (enableSound && rom !== undefined) {
    const soundRomFull = rom.sound;
    if (soundRomFull !== undefined && soundRomFull.length >= 0x10000) {
      const rom421 = soundRomFull.slice(0x8000, 0xc000);
      const rom422 = soundRomFull.slice(0xc000, 0x10000);
      soundChip = createSoundChip({ roms: { rom421, rom422 } });
      console.log("[sound] SoundChip ready, click 'Enable Audio' to start");

      // 🔔 BEEP TEST — sanity check audio path basic (OscillatorNode standalone,
      // no AudioWorklet, no SoundChip): se NON senti questo, c'e' un problema
      // a livello system/browser (volume muted, output device, autoplay
      // policy). Se senti questo ma non l'audio del game, e' bug nel
      // worklet/cue path.
      const btnBeep = document.createElement("button");
      btnBeep.textContent = "🔔 BEEP TEST 440Hz";
      btnBeep.style.cssText =
        "position:fixed;top:10px;right:160px;z-index:9999;padding:8px 12px;" +
        "background:#2a2a4e;color:#fff;border:1px solid #666;cursor:pointer;";
      btnBeep.addEventListener("click", async () => {
        try {
          const beepCtx = new AudioContext();
          if (beepCtx.state === "suspended") await beepCtx.resume();
          const osc = beepCtx.createOscillator();
          const gain = beepCtx.createGain();
          osc.frequency.value = 440;
          gain.gain.value = 0.15;
          osc.connect(gain).connect(beepCtx.destination);
          osc.start();
          setTimeout(() => { osc.stop(); beepCtx.close(); }, 800);
          btnBeep.textContent = "🔔 BEEP! (440Hz 0.8s)";
          console.log("[beep] AudioContext state:", beepCtx.state, "sampleRate:", beepCtx.sampleRate);
        } catch (e) {
          console.warn("[beep] failed:", e);
          btnBeep.textContent = "🔔 BEEP FAILED";
        }
      });
      document.body.appendChild(btnBeep);

      const btnAudio = document.createElement("button");
      btnAudio.textContent = "🔊 Enable Audio";
      btnAudio.style.cssText =
        "position:fixed;top:10px;right:10px;z-index:9999;padding:8px 12px;" +
        "background:#1a1a1a;color:#fff;border:1px solid #444;cursor:pointer;";
      let soundStarted = false;
      btnAudio.addEventListener("click", async () => {
        try {
          if (soundStarted) {
            // Click successivo = no-op (era chime di re-test, ora rumoroso)
            return;
          }
          soundRenderer = await createSoundRenderer();
          await soundRenderer.start();
          // Chime di "audio enabled" RIMOSSO (era beep stand-in).
          // Reset worklet già chiamato dentro start().
          // Release SoundChip dal HOLD reset hardware (main 68K $860001 bit 7=1).
          // Senza release il 6502 non gira mai → no YM/POKEY write → no audio.
          // Wire main↔sound mailbox e' debt separato (Codex engine main side);
          // qui release manuale all'enable per fare partire il sound code.
          if (soundChip !== undefined) {
            releaseSoundReset(soundChip);
            console.log("[sound] SoundChip released from hold reset");
            // Wire engine soundCmdSend158AC → SoundChip submitCommand: ogni
            // cmd emit dal main 68K TS verrà inoltrato al sound 6502 TS.
            let cmdCount = 0;
            const onCmd = (cmd: number) => {
              submitSoundCommand(soundChip!, (cmd & 0xff) as never);
              // playCommandCue stand-in beep RIMOSSO: chip ora produce audio
              // reale (sessione 4l 2026-05-18). I beep erano placeholder per
              // quando il chip non ticchettava. `?soundCue=1` per riabilitare.
              if (searchParams.get("soundCue") === "1") {
                soundRenderer?.playCommandCue(cmd);
              }
              cmdCount++;
              if (cmdCount <= 30) console.log(`[sound] cmd #${cmdCount} → $${cmd.toString(16)}`);
            };
            setSoundCmdHook(onCmd);
            setGlobalSoundCmdHook(onCmd);
            console.log("[sound] engine→SoundChip cmd hook wired (158AC + global)");
            // ?soundTest=1 — invia cmd test artificiali ogni 2s per validare
            // che il chain audio produce suono anche senza gameplay cmd reali
            // (workaround per attract loop che non chiama soundCmdSend158AC).
            if (searchParams.get("soundTest") === "1") {
              // Cmd test: ciclo su tutti i byte 0x00-0xFF per identificare quali
              // attivano write YM/POKEY (= cmd "validi" del sound driver Marble).
              let testIdx = 0;
              setInterval(() => {
                const cmd = testIdx & 0xff;
                submitSoundCommand(soundChip!, cmd as never);
                soundRenderer?.playCommandCue(cmd, { force: true });
                if (testIdx % 16 === 0) console.log(`[soundTest] cmd $${cmd.toString(16)}`);
                testIdx++;
              }, 500);  // 1 cmd ogni 500ms = 128s per ciclare tutti
            }
          }
          // Chime delay RIMOSSO (era beep).
          btnAudio.textContent = "🔊 Audio ON";
          soundStarted = true;
          console.log("[sound] Web Audio started");
        } catch (e) {
          console.warn("[sound] start failed:", e);
          btnAudio.textContent = "🔊 Audio failed";
        }
      });
      document.body.appendChild(btnAudio);
    } else {
      console.warn("[sound] rom.sound non disponibile, audio disabilitato");
    }
  }

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
  const scrollOverrideEnabled =
    searchParams.get("scrollOverride") === "1" ||
    (!forcePlay && !useCoinStartFlow && !warmStateIsPlayableSeed && warmState === undefined);
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
    const startPulses = inputState.consumeStartPulses();
    const startPressedThisFrame =
      startPulses > 0 ||
      ((inputButtons & 0x01) !== 0 && (previousInputButtons & 0x01) === 0);
    previousInputButtons = inputButtons;
    if (
      useCoinStartFlow &&
      manualPlayStarted &&
      !preservePlayableDispatcher &&
      isCoinStartAttractReady(s)
    ) {
      manualPlayStarted = false;
      lastLevelTimeOverrideLevel = undefined;
      console.log("[marble-love] coin/start flow rearmed after attract return");
    }
    if (
      useCoinStartFlow &&
      !manualPlayStarted &&
      startPressedThisFrame &&
      browserCoinCredits > 0 &&
      coinStartWarmState !== undefined
    ) {
      browserCoinCredits -= 1;
      bootInit(s, tickRom, { warmState: coinStartWarmState });
      // Human live play should leave the attract/tutorial dispatcher after
      // START. The replay/oracle seed intentionally preserves MAME's state=1
      // micro-cadence, but in the browser that makes manual play look like the
      // attract demo. Keep preservation opt-in for diagnostics.
      if (!preservePlayableDispatcher) {
        s.workRam[0x390] = 0x00;
        s.workRam[0x391] = 0x00;
      }
      s.clock.mainLoopBodyTicks = wrap.as_u32(coinStartMainLoopBodyTicks ?? 1);
      inputState.setP1Absolute(s.workRam[0x18 + 0xc9] ?? 0xff, s.workRam[0x18 + 0xc8] ?? 0xff);
      manualPlayStarted = true;
      lastLevelTimeOverrideLevel = undefined;
      maybeApplyLevelTimeOverride("START1");
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
    if (!mameDumpFrozen && !debugFreezeActive) {
      // ?play=1 → forza runMainLoopBody=true ANCHE con warmState (= gameplay
      //          dal warm bootstrap MAME). Default: solo se non c'è warmState.
      // ?loopReset=N → replay loop: ogni N tick ricarica warmState (= evita
      //   drift catastrofico cumulativo che spinge marble fuori viewport).
      //   Per la demo warm live, defaultiamo a 180 frame: il modello runtime
      //   è validato bit-perfect sui primi 100 frame e resta visivamente sano
      //   nel segmento iniziale. `loopReset=0` disabilita il guardrail.
      const loopResetParam = searchParams.get("loopReset");
      const defaultLoopResetN =
        startLevelPracticeActive
          ? 0
          : scenarioName !== null && warmState !== undefined
          ? SCENARIO_LOOP_RESET
          : forcePlay && warmState !== undefined && playableSeedName === null
            ? DEFAULT_WARM_PLAY_LOOP_RESET
            : 0;
      const parsedLoopResetN = parseInt(loopResetParam ?? String(defaultLoopResetN), 10);
      const loopResetN = Number.isFinite(parsedLoopResetN) ? parsedLoopResetN : 0;
      const mainLoopBody =
        !startLevelPracticeUnavailable &&
        (forcePlay || startLevelPracticeActive || (rom !== undefined && warmState === undefined));
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
      if (debugForceBeforeTick) maybeApplyDebugForcedState(s);
      tick(s, tickOptions);
      if (!debugForceBeforeTick || !debugForceOnce) maybeApplyDebugForcedState(s);
      maybeApplyLevelTimeOverride("level change");
      // Sound chip tick: the current 6502/YM/POKEY path is diagnostic-heavy
      // and does not yet produce full background music. Keep it opt-in so the
      // playable browser loop cannot slow down just because audio cues are on.
      if (runSoundChip && soundChip !== undefined) {
        tickSoundCycles(soundChip, SOUND_CYCLES_PER_FRAME);
        if (soundRenderer !== undefined && soundRenderer.isRunning()) {
          // NOTA (2026-05-18): soundRenderer.update() era una RE-SINTESI
          // heuristica (sine/square tones da YM regs) — produceva i beep
          // che l'utente sentiva. Con PCM stream reale dal chip, e' RUMORE.
          // `?soundSynthCue=1` per riabilitare debug.
          if (searchParams.get("soundSynthCue") === "1") {
            soundRenderer.update(soundChip);
          }
          // V3 chip-perfect: drain YM2151 + POKEY sample streams e push al worklet.
          const ymSamples = drainYm2151Samples(soundChip);
          if (ymSamples.length > 0) {
            soundRenderer.pushYm2151Samples(ymSamples, YM2151_NATIVE_SAMPLE_RATE);
          }
          const pkSamples = drainPokeySamples(soundChip);
          if (pkSamples.length > 0) {
            soundRenderer.pushPokeySamples(pkSamples, POKEY_NATIVE_SAMPLE_RATE);
          }
        }
      }
    }
    if (useCoinStartFlow && !manualPlayStarted && rom !== undefined) {
      writeBrowserCreditDigit(s, rom, browserCoinCredits);
    }
    frameCount += 1;
    // DEBUG: expose state to window globals every frame for headless inspection
    (window as unknown as { __mlState?: typeof s; __mlFrame?: number }).__mlState = s;
    (window as unknown as { __mlFrame?: number }).__mlFrame = frameCount;
    (window as unknown as { __soundChip?: typeof soundChip }).__soundChip = soundChip;
    if (objectDebugEnabled) {
      recordPlayerImpulseDebug(s, frameCount);
    }
    if (objectDebugEnabled && objectDebugOverlay !== undefined && frameCount % 5 === 0) {
      updateObjectDebugOverlay(objectDebugOverlay, s, frameCount);
    }

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
