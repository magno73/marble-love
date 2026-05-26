/**
 * probe-audioram-diff.ts — TS vs MAME audioRam diff frame-by-frame.
 *
 * Confronta lo stato della RAM del sound 6502 (4KB $0000-$0FFF) fra TS
 * SoundChip e MAME oracle a frame snapshot multipli. Identifica il PRIMO
 * frame con divergenza e i byte coinvolti, per drill A1 cycle-exact.
 *
 * Input:
 *   --mame-dumps <json>   /tmp/mame_audioram_dump.json (output mame_sound_audioram_dump.lua)
 *   --cmd-tape <json>     oracle/scenarios/sound-cmd-tape-attract.json
 *
 * Output: per ogni frame snapshot, num byte diff + range offset + sample dei
 * primi 16 byte divergenti.
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import {
  createSoundChip,
  loadCmdTape,
  tickFrameWithTape,
} from "../../engine/src/m6502/sound-chip.js";
import {
  installSoundStatusFrameReplay,
  installSoundStatusReplay,
  loadSoundStatusReads,
  statusReplayReport,
  type SoundStatusReplayStats,
} from "./sound-status-replay.js";

interface MameDumpEntry {
  frame: number;
  audioRam: string;
}

interface MameDumpFile {
  coinFrame: number;
  startFrame: number;
  dumps: MameDumpEntry[];
}

type StatusTapeMode = "readIndex" | "frame";

interface Args {
  readonly mameDumps: string;
  readonly cmdTape: string;
  readonly statusTape: string | undefined;
  readonly statusTapeMode: StatusTapeMode;
  readonly out: string | undefined;
}

interface SnapshotDiff {
  readonly frame: number;
  readonly diff: ReturnType<typeof diffBytes>;
  readonly tsNonZero: number;
  readonly mameNonZero: number;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function diffBytes(a: Uint8Array, b: Uint8Array): { count: number; firstDiff: number; lastDiff: number; samples: Array<{ off: number; ts: number; mame: number }> } {
  const len = Math.min(a.length, b.length);
  let count = 0;
  let firstDiff = -1;
  let lastDiff = -1;
  const samples: Array<{ off: number; ts: number; mame: number }> = [];
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      count++;
      if (firstDiff === -1) firstDiff = i;
      lastDiff = i;
      if (samples.length < 16) samples.push({ off: i, ts: a[i]!, mame: b[i]! });
    }
  }
  return { count, firstDiff, lastDiff, samples };
}

function main(): void {
  const args = process.argv.slice(2);
  const findArg = (name: string, fallback: string): string => {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1]! : fallback;
  };
  const findOptionalArg = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  const statusTapeModeArg = findArg("--status-tape-mode", "readIndex");
  if (statusTapeModeArg !== "readIndex" && statusTapeModeArg !== "frame") {
    throw new Error(`Unsupported --status-tape-mode: ${statusTapeModeArg}`);
  }
  const parsedArgs: Args = {
    mameDumps: findArg("--mame-dumps", "/tmp/mame_audioram_dump.json"),
    cmdTape: findArg("--cmd-tape", "oracle/scenarios/sound-cmd-tape-attract.json"),
    statusTape: findOptionalArg("--status-tape"),
    statusTapeMode: statusTapeModeArg,
    out: findOptionalArg("--out"),
  };

  if (!existsSync(parsedArgs.mameDumps) || !existsSync(parsedArgs.cmdTape)) {
    console.error("Usage: probe-audioram-diff [--mame-dumps <json>] [--cmd-tape <json>] [--status-tape <json>] [--status-tape-mode readIndex|frame] [--out <json>]");
    console.error("Missing:", { mameDumps: parsedArgs.mameDumps, cmdTape: parsedArgs.cmdTape });
    process.exit(1);
  }
  if (parsedArgs.statusTape !== undefined && !existsSync(parsedArgs.statusTape)) {
    console.error("Status tape not found:", parsedArgs.statusTape);
    process.exit(1);
  }

  const mameDumps = JSON.parse(readFileSync(parsedArgs.mameDumps, "utf8")) as MameDumpFile;
  const tapeJson = JSON.parse(readFileSync(parsedArgs.cmdTape, "utf8"));
  const tape = loadCmdTape(tapeJson);

  const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
  const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
  const chip = createSoundChip({ roms: { rom421, rom422 } });
  let currentFrame = -1;
  let statusReplay: SoundStatusReplayStats | undefined;
  if (parsedArgs.statusTape !== undefined) {
    const statusReads = loadSoundStatusReads(parsedArgs.statusTape);
    statusReplay = parsedArgs.statusTapeMode === "frame"
      ? installSoundStatusFrameReplay(chip, parsedArgs.statusTape, statusReads, () =>
        currentFrame < 0 ? undefined : currentFrame)
      : installSoundStatusReplay(chip, parsedArgs.statusTape, statusReads);
  }

  // Snapshot frames sorted
  const snapFrames = mameDumps.dumps.map((d) => d.frame).sort((a, b) => a - b);
  const mameByFrame = new Map<number, Uint8Array>();
  for (const d of mameDumps.dumps) {
    mameByFrame.set(d.frame, hexToBytes(d.audioRam));
  }
  const maxFrame = snapFrames[snapFrames.length - 1]!;

  console.log(`MAME dumps: ${snapFrames.length} frames @ ${snapFrames.join(", ")}`);
  console.log(`Cmd tape: ${tape.cmdCount} cmds, totalFrames=${tape.totalFrames}, cyclePrecise=${tape.cyclePrecise}, resetFrame=${tape.resetFrame ?? "?"}`);
  if (statusReplay !== undefined) {
    console.log(`Status tape: ${parsedArgs.statusTape} mode=${parsedArgs.statusTapeMode}`);
  }
  console.log(`Running TS chip to f${maxFrame}...\n`);

  const diffs: SnapshotDiff[] = [];
  for (let f = 0; f <= maxFrame; f++) {
    currentFrame = f;
    tickFrameWithTape(chip, tape, f, { autoReleaseReset: true, drainReplies: true });
    if (mameByFrame.has(f)) {
      const tsRam = chip.mmu.ram;
      const mameRam = mameByFrame.get(f)!;
      const diff = diffBytes(tsRam, mameRam);
      const tsNonZero = Array.from(tsRam).filter((b) => b !== 0).length;
      const mameNonZero = Array.from(mameRam).filter((b) => b !== 0).length;
      diffs.push({ frame: f, diff, tsNonZero, mameNonZero });
      console.log(`f${f}: diff=${diff.count}/4096 bytes | TS non-zero=${tsNonZero} | MAME non-zero=${mameNonZero} | range=$${diff.firstDiff.toString(16)}..$${diff.lastDiff.toString(16)}`);
      if (diff.samples.length > 0) {
        console.log(`  first divergent samples:`);
        for (const s of diff.samples) {
          console.log(`    $${s.off.toString(16).padStart(3, "0")}: TS=$${s.ts.toString(16).padStart(2, "0")} MAME=$${s.mame.toString(16).padStart(2, "0")}`);
        }
      }
    }
  }
  if (statusReplay !== undefined) {
    console.log(
      `\nstatusReplay: applied=${statusReplay.appliedReadCount}/${statusReplay.mameReadCount} ` +
      `tsReads=${statusReplay.tsReadCount} exhausted=${statusReplay.exhaustedReadCount} ` +
      `baseMismatches=${statusReplay.baseMismatchCount}`,
    );
  }
  if (parsedArgs.out !== undefined) {
    writeFileSync(parsedArgs.out, JSON.stringify({
      mameDumps: parsedArgs.mameDumps,
      cmdTape: parsedArgs.cmdTape,
      cyclePreciseTape: tape.cyclePrecise,
      resetFrame: tape.resetFrame,
      ...(parsedArgs.statusTape === undefined ? {} : {
        statusTape: parsedArgs.statusTape,
        statusTapeMode: parsedArgs.statusTapeMode,
        statusReplay: statusReplayReport(statusReplay),
      }),
      diffs,
    }, null, 2));
  }
}

main();
