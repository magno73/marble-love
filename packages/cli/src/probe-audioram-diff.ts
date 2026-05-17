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

import { readFileSync, existsSync } from "node:fs";
import {
  createSoundChip,
  releaseSoundReset,
  loadCmdTape,
  submitCommand,
  tickCycles,
  drainReplyEvents,
} from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { as_u8 } from "../../engine/src/wrap.js";

interface MameDumpEntry {
  frame: number;
  audioRam: string;
}

interface MameDumpFile {
  coinFrame: number;
  startFrame: number;
  dumps: MameDumpEntry[];
}

interface CmdTapeFile {
  cmds: Array<{ frame: number; byte: number }>;
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
  const mameDumpArg = findArg("--mame-dumps", "/tmp/mame_audioram_dump.json");
  const cmdTapeArg = findArg("--cmd-tape", "oracle/scenarios/sound-cmd-tape-attract.json");

  if (!existsSync(mameDumpArg) || !existsSync(cmdTapeArg)) {
    console.error("Usage: probe-audioram-diff [--mame-dumps <json>] [--cmd-tape <json>]");
    console.error("Missing:", { mameDumpArg, cmdTapeArg });
    process.exit(1);
  }

  const mameDumps = JSON.parse(readFileSync(mameDumpArg, "utf8")) as MameDumpFile;
  const tapeJson = JSON.parse(readFileSync(cmdTapeArg, "utf8")) as CmdTapeFile;
  const tape = loadCmdTape(tapeJson);

  const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
  const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
  const chip = createSoundChip({ roms: { rom421, rom422 } });
  // Hardware-faithful ordering: hold reset until first cmd, submit cmd
  // during reset (NMI suppressed), then release. Matches MAME atarisy1.

  // Snapshot frames sorted
  const snapFrames = mameDumps.dumps.map((d) => d.frame).sort((a, b) => a - b);
  const mameByFrame = new Map<number, Uint8Array>();
  for (const d of mameDumps.dumps) {
    mameByFrame.set(d.frame, hexToBytes(d.audioRam));
  }
  const maxFrame = snapFrames[snapFrames.length - 1]!;

  console.log(`MAME dumps: ${snapFrames.length} frames @ ${snapFrames.join(", ")}`);
  console.log(`Cmd tape: ${tape.cmdCount} cmds, totalFrames=${tape.totalFrames}`);
  console.log(`Running TS chip to f${maxFrame}...\n`);

  let released = false;
  const firstCmdFrame = Math.min(...Array.from(tape.byFrame.keys()));
  for (let f = 0; f <= maxFrame; f++) {
    const cmds = tape.byFrame.get(f);
    if (cmds !== undefined) {
      for (const b of cmds) submitCommand(chip, as_u8(b));
    }
    if (!released && f >= firstCmdFrame) {
      releaseSoundReset(chip);
      released = true;
    }
    tickCycles(chip, SOUND_CYCLES_PER_FRAME);
    drainReplyEvents(chip);
    if (mameByFrame.has(f)) {
      const tsRam = chip.mmu.ram;
      const mameRam = mameByFrame.get(f)!;
      const diff = diffBytes(tsRam, mameRam);
      const tsNonZero = Array.from(tsRam).filter((b) => b !== 0).length;
      const mameNonZero = Array.from(mameRam).filter((b) => b !== 0).length;
      console.log(`f${f}: diff=${diff.count}/4096 bytes | TS non-zero=${tsNonZero} | MAME non-zero=${mameNonZero} | range=$${diff.firstDiff.toString(16)}..$${diff.lastDiff.toString(16)}`);
      if (diff.samples.length > 0) {
        console.log(`  first divergent samples:`);
        for (const s of diff.samples) {
          console.log(`    $${s.off.toString(16).padStart(3, "0")}: TS=$${s.ts.toString(16).padStart(2, "0")} MAME=$${s.mame.toString(16).padStart(2, "0")}`);
        }
      }
    }
  }
}

main();
