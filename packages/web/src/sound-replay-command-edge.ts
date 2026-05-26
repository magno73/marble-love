import {
  cmdTapeAbsoluteCycle,
  cmdTapeReplaySignedCycleInFrame,
  SOUND_CYCLES_PER_FRAME,
  type CmdTape,
  type CmdTapeCommandTiming,
} from "@marble-love/engine";

export type SoundReplayCommandEdgeEventRelation = "both" | "raw-before" | "raw-crossing" | "raw-after";
export type SoundReplayCommandEdgeEventAnchor = "command" | "first-read" | "current-event";

export interface SoundReplayCommandEdgeWriteRegVal {
  readonly reg: number;
  readonly val: number;
}

export interface SoundReplayCommandEdgeEventRule {
  readonly delayCycles: number;
  readonly anchor: SoundReplayCommandEdgeEventAnchor;
  readonly afterCycles: number;
  readonly beforeCycles: number;
  readonly bytes: readonly number[] | undefined;
  readonly pcs: readonly number[] | undefined;
  readonly commandPcs: readonly number[] | undefined;
  readonly excludedCommandPcs: readonly number[] | undefined;
  readonly writeRegs: readonly number[] | undefined;
  readonly writeVals: readonly number[] | undefined;
  readonly writeRegVals: readonly SoundReplayCommandEdgeWriteRegVal[] | undefined;
  readonly relation: SoundReplayCommandEdgeEventRelation;
  readonly rawDeltaMin: number | undefined;
  readonly rawDeltaMax: number | undefined;
}

export interface SoundReplayCommandReplayEvent {
  readonly sourceIndex: number;
  readonly frame: number;
  readonly byte: number;
  readonly soundPc: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly replayCycle: number;
}

export interface SoundReplayCommandReadEvent {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly cycle: number;
  readonly pc: number;
  readonly val: number;
  readonly readCycleOffset: number;
}

export interface SoundReplayCommandEdgeWriteContext {
  readonly frame: number | undefined;
  readonly pc: number;
  readonly opcode: number | undefined;
  readonly reg: number;
  readonly val: number;
  readonly rawCycle: number;
  readonly rawCycleInFrame: number | undefined;
  readonly rawWriteCycleOffset: number;
  readonly currentEventCycleOffset: number;
}

export interface SoundReplayCommandEventSummary {
  readonly total: number;
  readonly withSoundPc: number;
  readonly withCycleInFrame: number;
}

interface TimingOrigin {
  readonly frame: number;
  readonly secs?: number;
  readonly attos?: string;
  readonly absoluteCycle?: bigint;
  readonly replayCycle?: number;
}

function cmdFrameOriginAbsoluteCycle(cmd: {
  readonly secs?: number;
  readonly attos?: string;
  readonly cycleInFrame?: number;
}): bigint | undefined {
  const absoluteCycle = cmdTapeAbsoluteCycle(cmd);
  if (absoluteCycle === undefined) return undefined;
  if (cmd.cycleInFrame === undefined) return absoluteCycle;
  return absoluteCycle - BigInt(Math.trunc(cmd.cycleInFrame));
}

function cmdFrameOriginAbsoluteCycleForTiming(
  cmd: {
    readonly secs?: number;
    readonly attos?: string;
    readonly cycleInFrame?: number;
  },
  commandTiming: CmdTapeCommandTiming,
): bigint | undefined {
  return commandTiming === "secsAttos" ? cmdTapeAbsoluteCycle(cmd) : cmdFrameOriginAbsoluteCycle(cmd);
}

interface CommandReadContext {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly replayCycle: number;
  readonly pc: number;
  readonly val: number;
  readonly readCycleOffset: number;
  readonly deltaFromCommand: number;
  readonly deltaFromTsWrite: number | undefined;
}

function parseOptionalInteger(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  const value = Number.parseInt(trimmed, trimmed.startsWith("0x") ? 16 : 10);
  if (!Number.isFinite(value)) throw new Error(`invalid selector value ${raw}`);
  return Math.trunc(value);
}

function parseByteList(value: string | undefined, argName: string): number[] | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  return trimmed.split("+").map((raw) => {
    const value = parseOptionalInteger(raw);
    if (value === undefined || value < 0 || value > 0xff) {
      throw new Error(`invalid byte in ${argName}: ${raw}`);
    }
    return value & 0xff;
  });
}

function parsePcList(value: string | undefined, argName: string): number[] | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  return trimmed.split("+").map((raw) => {
    const value = parseOptionalInteger(raw);
    if (value === undefined || value < 0 || value > 0xffff) {
      throw new Error(`invalid PC in ${argName}: ${raw}`);
    }
    return value & 0xffff;
  });
}

function parseCommandPcFilter(
  value: string | undefined,
  argName: string,
): { commandPcs: number[] | undefined; excludedCommandPcs: number[] | undefined } {
  if (value === undefined) return { commandPcs: undefined, excludedCommandPcs: undefined };
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "*") return { commandPcs: undefined, excludedCommandPcs: undefined };
  if (trimmed.startsWith("!")) {
    return { commandPcs: undefined, excludedCommandPcs: parsePcList(trimmed.slice(1), argName) };
  }
  return { commandPcs: parsePcList(trimmed, argName), excludedCommandPcs: undefined };
}

function parseRegValPairs(
  value: string | undefined,
  argName: string,
): SoundReplayCommandEdgeWriteRegVal[] | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  return trimmed.split("+").map((raw) => {
    const [regRaw, valRaw] = raw.split("=");
    if (regRaw === undefined || valRaw === undefined) throw new Error(`invalid reg=value in ${argName}: ${raw}`);
    const reg = parseOptionalInteger(regRaw);
    const val = parseOptionalInteger(valRaw);
    if (reg === undefined || reg < 0 || reg > 0xff || val === undefined || val < 0 || val > 0xff) {
      throw new Error(`invalid reg=value in ${argName}: ${raw}`);
    }
    return { reg: reg & 0xff, val: val & 0xff };
  });
}

function parseRelation(value: string | undefined): SoundReplayCommandEdgeEventRelation {
  if (value === undefined || value.trim() === "" || value === "both") return "both";
  if (value === "raw-before" || value === "raw-crossing" || value === "raw-after") return value;
  throw new Error(`invalid command-edge relation ${value}`);
}

function parseAnchor(value: string | undefined): SoundReplayCommandEdgeEventAnchor {
  if (value === undefined || value.trim() === "" || value === "command") return "command";
  if (value === "first-read" || value === "read") return "first-read";
  if (value === "current-event" || value === "event" || value === "offset" || value === "write") {
    return "current-event";
  }
  throw new Error(`invalid command-edge anchor ${value}`);
}

export function parseSoundReplayCommandEdgeEventRules(
  raw: string | null,
  defaultAfterCycles: number,
  argName: string,
): readonly SoundReplayCommandEdgeEventRule[] {
  if (raw === null || raw.trim() === "") return [];
  return raw.split(/[;,]/).map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length < 4 || parts.length > 13) {
      throw new Error(`invalid ${argName} entry ${rawEntry}`);
    }
    const [
      bytesRaw,
      minRaw,
      maxRaw,
      delayRaw,
      relationRaw,
      afterRaw,
      beforeRaw,
      commandPcsRaw,
      anchorRaw,
      writePcsRaw,
      writeRegsRaw,
      writeValsRaw,
      writeRegValsRaw,
    ] = parts;
    const delayCycles = Number(delayRaw);
    const afterCycles = afterRaw === undefined || afterRaw.trim() === "" ? defaultAfterCycles : Number(afterRaw);
    const beforeCycles = beforeRaw === undefined || beforeRaw.trim() === "" ? 0 : Number(beforeRaw);
    if (!Number.isFinite(delayCycles) || !Number.isFinite(afterCycles) || !Number.isFinite(beforeCycles)) {
      throw new Error(`invalid ${argName} timing in ${rawEntry}`);
    }
    const commandPcFilter = parseCommandPcFilter(commandPcsRaw, argName);
    return {
      delayCycles: Math.trunc(delayCycles),
      anchor: parseAnchor(anchorRaw),
      afterCycles: Math.max(0, Math.trunc(afterCycles)),
      beforeCycles: Math.max(0, Math.trunc(beforeCycles)),
      bytes: parseByteList(bytesRaw ?? "", argName),
      pcs: parsePcList(writePcsRaw, argName),
      commandPcs: commandPcFilter.commandPcs,
      excludedCommandPcs: commandPcFilter.excludedCommandPcs,
      writeRegs: parseByteList(writeRegsRaw ?? "", argName),
      writeVals: parseByteList(writeValsRaw ?? "", argName),
      writeRegVals: parseRegValPairs(writeRegValsRaw, argName),
      relation: parseRelation(relationRaw),
      rawDeltaMin: parseOptionalInteger(minRaw ?? ""),
      rawDeltaMax: parseOptionalInteger(maxRaw ?? ""),
    };
  });
}

export function parseSoundReplayRegisterCycleOffsets(raw: string | null, argName: string): ReadonlyMap<number, number> {
  const offsets = new Map<number, number>();
  if (raw === null || raw.trim() === "") return offsets;
  for (const rawEntry of raw.split(",")) {
    const entry = rawEntry.trim();
    const separator = entry.includes("=") ? "=" : ":";
    const [regRaw, deltaRaw] = entry.split(separator);
    if (regRaw === undefined || deltaRaw === undefined || regRaw.trim() === "" || deltaRaw.trim() === "") {
      throw new Error(`invalid ${argName} entry ${rawEntry}`);
    }
    const reg = parseOptionalInteger(regRaw);
    const delta = Number(deltaRaw.trim());
    if (reg === undefined || reg < 0 || reg > 0xff || !Number.isFinite(delta)) {
      throw new Error(`invalid ${argName} entry ${rawEntry}`);
    }
    offsets.set(reg & 0xff, Math.trunc(delta));
  }
  return offsets;
}

function parseNumberLike(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
}

function timingOriginsFromTape(tape: CmdTape, commandTiming: CmdTapeCommandTiming): {
  origins: Map<number, TimingOrigin>;
  replayOriginCycle: bigint | undefined;
  firstFrame: number;
} {
  const firstFrame = tape.cmds.reduce((min, cmd) => Math.min(min, cmd.frame), Number.POSITIVE_INFINITY);
  const rawOrigins = new Map<number, TimingOrigin>();
  let replayOriginCycle: bigint | undefined;
  for (const cmd of tape.cmds) {
    if (cmd.secs === undefined || cmd.attos === undefined || rawOrigins.has(cmd.frame)) continue;
    const absoluteCycle = cmdFrameOriginAbsoluteCycleForTiming(cmd, commandTiming);
    replayOriginCycle ??= absoluteCycle;
    rawOrigins.set(cmd.frame, {
      frame: cmd.frame,
      secs: cmd.secs,
      attos: cmd.attos,
      ...(absoluteCycle === undefined ? {} : { absoluteCycle }),
    });
  }
  const origins = new Map<number, TimingOrigin>();
  for (const [frame, origin] of rawOrigins) {
    const replayCycle = origin.absoluteCycle === undefined || replayOriginCycle === undefined
      ? undefined
      : Number(origin.absoluteCycle - replayOriginCycle);
    origins.set(frame, { ...origin, ...(replayCycle === undefined ? {} : { replayCycle }) });
  }
  return { origins, replayOriginCycle, firstFrame: Number.isFinite(firstFrame) ? firstFrame : 0 };
}

export function readSoundReplayCommandEventsFromTape(
  tape: CmdTape,
  commandTiming: CmdTapeCommandTiming = "cycleInFrame",
): SoundReplayCommandReplayEvent[] {
  const { origins, replayOriginCycle, firstFrame } = timingOriginsFromTape(tape, commandTiming);
  const events: SoundReplayCommandReplayEvent[] = [];
  for (let sourceIndex = 0; sourceIndex < tape.cmds.length; sourceIndex++) {
    const cmd = tape.cmds[sourceIndex]!;
    const origin = origins.get(cmd.frame);
    const cycleInFrame = cmdTapeReplaySignedCycleInFrame(cmd, origin, commandTiming);
    let replayCycle: number | undefined;
    if (commandTiming === "secsAttos" || cmd.cycleInFrame === undefined) {
      const absoluteCycle = cmdTapeAbsoluteCycle(cmd);
      if (absoluteCycle !== undefined && replayOriginCycle !== undefined) {
        replayCycle = Number(absoluteCycle - replayOriginCycle);
      }
    }
    if (replayCycle === undefined && cmd.cycleInFrame !== undefined && origin?.replayCycle !== undefined) {
      replayCycle = origin.replayCycle + Math.trunc(cmd.cycleInFrame);
    }
    if (replayCycle === undefined && origin?.replayCycle !== undefined && cycleInFrame !== undefined) {
      replayCycle = origin.replayCycle + cycleInFrame;
    }
    if (replayCycle === undefined && cycleInFrame !== undefined) {
      replayCycle = ((cmd.frame - firstFrame) * SOUND_CYCLES_PER_FRAME) + cycleInFrame;
    }
    if (replayCycle === undefined) continue;
    const soundPc = parseNumberLike(cmd.soundPc);
    events.push({
      sourceIndex,
      frame: cmd.frame,
      byte: cmd.byte & 0xff,
      soundPc: soundPc === undefined ? undefined : soundPc & 0xffff,
      cycleInFrame,
      replayCycle,
    });
  }
  events.sort((a, b) => a.replayCycle - b.replayCycle || a.sourceIndex - b.sourceIndex);
  return events;
}

export function summarizeSoundReplayCommandEvents(
  events: readonly SoundReplayCommandReplayEvent[],
): SoundReplayCommandEventSummary {
  let withSoundPc = 0;
  let withCycleInFrame = 0;
  for (const event of events) {
    if (event.soundPc !== undefined) withSoundPc++;
    if (event.cycleInFrame !== undefined) withCycleInFrame++;
  }
  return { total: events.length, withSoundPc, withCycleInFrame };
}

export function soundReplayCommandEdgeRulesRequireCommandPc(
  rules: readonly SoundReplayCommandEdgeEventRule[],
): boolean {
  return rules.some((rule) => rule.commandPcs !== undefined && rule.commandPcs.length > 0);
}

function lowerBoundCommandEvents(events: readonly SoundReplayCommandReplayEvent[], target: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (events[mid]!.replayCycle < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lowerBoundCommandReads(events: readonly SoundReplayCommandReadEvent[], target: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (events[mid]!.cycle < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function firstCommandReadAfter(
  event: SoundReplayCommandReplayEvent,
  rawWriteCycle: number,
  commandReads: readonly SoundReplayCommandReadEvent[],
): CommandReadContext | undefined {
  let idx = lowerBoundCommandReads(commandReads, event.replayCycle);
  while (idx < commandReads.length) {
    const read = commandReads[idx]!;
    idx++;
    if ((read.val & 0xff) !== event.byte) continue;
    return {
      frame: read.frame,
      cycleInFrame: read.cycleInFrame,
      replayCycle: read.cycle,
      pc: read.pc,
      val: read.val & 0xff,
      readCycleOffset: read.readCycleOffset,
      deltaFromCommand: read.cycle - event.replayCycle,
      deltaFromTsWrite: read.cycle - rawWriteCycle,
    };
  }
  return undefined;
}

export function soundReplayCommandEdgeRuntimeOffsetFor(
  ctx: SoundReplayCommandEdgeWriteContext,
  commandEvents: readonly SoundReplayCommandReplayEvent[],
  commandReads: readonly SoundReplayCommandReadEvent[],
  rules: readonly SoundReplayCommandEdgeEventRule[],
): number | undefined {
  if (rules.length === 0 || commandEvents.length === 0) return undefined;
  const rawStepStart = ctx.rawCycle - ctx.rawWriteCycleOffset;
  const maxBeforeCycles = Math.max(...rules.map((rule) => rule.beforeCycles));
  const afterLimit = ctx.rawCycle + Math.max(...rules.map((rule) => rule.afterCycles));
  let idx = lowerBoundCommandEvents(commandEvents, rawStepStart - maxBeforeCycles);
  while (idx < commandEvents.length) {
    const event = commandEvents[idx]!;
    if (event.replayCycle > afterLimit) return undefined;
    idx++;
    const relation: Exclude<SoundReplayCommandEdgeEventRelation, "both"> = event.replayCycle < rawStepStart
      ? "raw-before"
      : event.replayCycle <= ctx.rawCycle
        ? "raw-crossing"
        : "raw-after";
    const rawDeltaFromCommand = ctx.rawCycle - event.replayCycle;
    for (const rule of rules) {
      if (event.replayCycle < rawStepStart - rule.beforeCycles) continue;
      if (event.replayCycle > ctx.rawCycle + rule.afterCycles) continue;
      if (rule.bytes !== undefined && !rule.bytes.includes(event.byte)) continue;
      if (rule.pcs !== undefined && !rule.pcs.includes(ctx.pc & 0xffff)) continue;
      if (rule.writeRegs !== undefined && !rule.writeRegs.includes(ctx.reg & 0xff)) continue;
      if (rule.writeVals !== undefined && !rule.writeVals.includes(ctx.val & 0xff)) continue;
      if (rule.writeRegVals !== undefined &&
        !rule.writeRegVals.some((pair) => pair.reg === (ctx.reg & 0xff) && pair.val === (ctx.val & 0xff))) {
        continue;
      }
      if (rule.commandPcs !== undefined &&
        (event.soundPc === undefined || !rule.commandPcs.includes(event.soundPc & 0xffff))) {
        continue;
      }
      if (rule.excludedCommandPcs !== undefined &&
        event.soundPc !== undefined && rule.excludedCommandPcs.includes(event.soundPc & 0xffff)) {
        continue;
      }
      if (rule.relation === "both" ? relation === "raw-before" : relation !== rule.relation) continue;
      if (rule.rawDeltaMin !== undefined && rawDeltaFromCommand < rule.rawDeltaMin) continue;
      if (rule.rawDeltaMax !== undefined && rawDeltaFromCommand > rule.rawDeltaMax) continue;
      const firstTsCommandRead = firstCommandReadAfter(event, ctx.rawCycle, commandReads);
      if (rule.anchor === "first-read" && firstTsCommandRead === undefined) continue;
      const targetAnchorCycle = rule.anchor === "first-read"
        ? firstTsCommandRead!.replayCycle
        : rule.anchor === "current-event"
          ? ctx.rawCycle + ctx.currentEventCycleOffset
          : event.replayCycle;
      const targetReplayCycle = targetAnchorCycle + rule.delayCycles;
      return targetReplayCycle - ctx.rawCycle - ctx.currentEventCycleOffset;
    }
  }
  return undefined;
}
