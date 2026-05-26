import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMainReplyAckReplay, loadMainReplyAckCycles } from "../src/sound-reply-ack-replay.js";

function writeAt(cycle: number) {
  return {
    cycle,
    frame: undefined,
    cycleInFrame: undefined,
    pc: 0xe59d,
    val: 0x01,
  };
}

describe("sound reply ack replay", () => {
  it("treats main reply reads as absolute external events by default", () => {
    const replay = createMainReplyAckReplay("test", [200, 300]);

    expect(replay.schedule(writeAt(100))).toBe(200);
    expect(replay.schedule(writeAt(150))).toBe(200);
    expect(replay.stats.mode).toBe("absolute");
    expect(replay.stats.reusedAckCount).toBe(1);
    expect(replay.stats.firstReusedAck).toEqual({ writeCycle: 150, ackCycle: 200 });
  });

  it("can still run the older sequential pairing model for comparison", () => {
    const replay = createMainReplyAckReplay("test", [200, 300], "sequential");

    expect(replay.schedule(writeAt(100))).toBe(200);
    expect(replay.schedule(writeAt(150))).toBe(300);
    expect(replay.stats.mode).toBe("sequential");
    expect(replay.stats.reusedAckCount).toBe(0);
  });

  it("records skipped source reads without letting them drift future matches", () => {
    const replay = createMainReplyAckReplay("test", [100, 200, 300]);

    expect(replay.schedule(writeAt(250))).toBe(300);
    expect(replay.stats.skippedAckCount).toBe(2);
    expect(replay.stats.firstSkippedAck).toEqual({ cycle: 100, writeCycle: 250 });
  });

  it("does not mark an already scheduled absolute ack as skipped later", () => {
    const replay = createMainReplyAckReplay("test", [200, 300]);

    expect(replay.schedule(writeAt(100))).toBe(200);
    expect(replay.schedule(writeAt(250))).toBe(300);
    expect(replay.stats.skippedAckCount).toBe(0);
    expect(replay.stats.reusedAckCount).toBe(0);
  });

  it("uses the command frame origin for timestamped ack sources with cycleInFrame", () => {
    const dir = mkdtempSync(join(tmpdir(), "marble-love-reply-ack-"));
    try {
      const cmdTape = join(dir, "cmd-tape.json");
      const source = join(dir, "reply-acks.json");
      writeFileSync(cmdTape, JSON.stringify({
        cmds: [{ frame: 1, byte: 0x15, secs: 8, attos: "0", cycleInFrame: 50 }],
      }));
      writeFileSync(source, JSON.stringify({
        replyAcks: [{ secs: 8, attos: "0", val: "0x01" }],
      }));

      expect(loadMainReplyAckCycles(source, cmdTape)).toEqual([50]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
