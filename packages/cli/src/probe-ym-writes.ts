// probe-ym-writes.ts — log ogni write YM2151 di TS sulla cmd-tape attract.
// Output equivalente a oracle/mame_ym2151_write_log.lua per diff diretto.
import { readFileSync, writeFileSync } from "node:fs";
import {
  createSoundChip,
  drainChipWriteEvents,
  loadCmdTape,
  tickFrameWithTape,
  type ChipWriteEvent,
} from "../../engine/src/m6502/sound-chip.js";

interface Args {
  frames: number;
  cmdTape: string;
  out: string;
  resetReleaseDelayCycles: number;
  replyAckDelayCycles: number;
}

function readArg(args: string[], name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1]! : fallback;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  return {
    frames: Number(readArg(args, "--frames", process.env.TARGET_FRAME ?? "2000")),
    cmdTape: readArg(args, "--cmd-tape", "oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json"),
    out: readArg(args, "--out", "/tmp/ts_ym_writes.json"),
    resetReleaseDelayCycles: Number(readArg(args, "--reset-release-delay", "0")),
    replyAckDelayCycles: Number(readArg(args, "--reply-ack-delay", "0")),
  };
}

function hex(value: number, width: number): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

function serializeWrite(w: ChipWriteEvent): {
  reg: string;
  val: string;
  pc: string;
  frame: number | undefined;
  cycle: number;
  cycleInFrame: number | undefined;
} {
  return {
    reg: hex(w.reg, 2),
    val: hex(w.val, 2),
    pc: hex(w.pc, 4),
    frame: w.frame,
    cycle: w.cycle,
    cycleInFrame: w.cycleInFrame,
  };
}

function main(): void {
  const args = parseArgs();
  const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
  const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
  const tape = loadCmdTape(JSON.parse(readFileSync(args.cmdTape, "utf8")));
  const chip = createSoundChip({ roms: { rom421, rom422 }, mainReplyAckDelayCycles: args.replyAckDelayCycles });
  const writes: ChipWriteEvent[] = [];

  for (let f = 0; f < args.frames; f++) {
    tickFrameWithTape(chip, tape, f, {
      autoReleaseReset: true,
      drainReplies: true,
      resetReleaseDelayCycles: args.resetReleaseDelayCycles,
    });
    for (const event of drainChipWriteEvents(chip)) {
      if (event.kind === "ym2151") writes.push(event);
    }
  }

  writeFileSync(args.out, JSON.stringify({
    frames: args.frames,
    cmdTape: args.cmdTape,
    cyclePreciseTape: tape.cyclePrecise,
    resetReleaseDelayCycles: args.resetReleaseDelayCycles,
    replyAckDelayCycles: args.replyAckDelayCycles,
    writes: writes.map(serializeWrite),
  }, null, 2));
  console.log(`[ts_ym_writes] saved ${writes.length} writes -> ${args.out}`);
  console.log(`[ts_ym_writes] tape cyclePrecise=${tape.cyclePrecise} resetFrame=${tape.resetFrame ?? "n/a"}`);
  if (args.resetReleaseDelayCycles !== 0) {
    console.log(`[ts_ym_writes] resetReleaseDelayCycles=${args.resetReleaseDelayCycles}`);
  }
  if (args.replyAckDelayCycles !== 0) {
    console.log(`[ts_ym_writes] replyAckDelayCycles=${args.replyAckDelayCycles}`);
  }
}

main();
