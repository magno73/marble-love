import { describe, expect, it } from "vitest";
import {
  soundReplayPcmResamplerFromQuery,
  soundReplayCommandNmiDelayMatchesFromQuery,
  soundReplayCommandNmiDelayFromQuery,
  soundReplayCommandNmiSampleCycleFromQuery,
  soundReplayCmdTapeCommandTimingFromQuery,
  soundReplayPokeySampleCyclesFromQuery,
  soundReplayPokeyWriteApplyDelayFromQuery,
  soundReplayRequireCommandContextFromQuery,
  soundReplayResetReleaseDelayFromQuery,
  soundReplayYmStreamAbsoluteOriginFromQuery,
  soundReplayYmWriteEventCycleOffsetMatchesFromQuery,
  soundReplayYmWriteEventCycleOffsetRegsFromQuery,
  soundReplayYmWriteEventSampleOffsetMatchesFromQuery,
  soundReplayYmNativeSampleRateFromQuery,
  soundReplayYmSchedulerFromQuery,
} from "../src/sound-replay.js";
import {
  parseSoundReplayCommandEdgeEventRules,
  parseSoundReplayRegisterCycleOffsets,
  readSoundReplayCommandEventsFromTape,
  soundReplayCommandEdgeRulesRequireCommandPc,
  soundReplayCommandEdgeRuntimeOffsetFor,
  summarizeSoundReplayCommandEvents,
} from "../src/sound-replay-command-edge.js";
import {
  applySoundReplayPreset,
  resolveSoundReplayPreset,
} from "../src/sound-replay-presets.js";

describe("sound replay query options", () => {
  it("keeps cycle YM scheduling as the default", () => {
    const params = new URLSearchParams("");

    expect(soundReplayYmSchedulerFromQuery(params)).toBe("cycle");
    expect(soundReplayYmNativeSampleRateFromQuery(params, "cycle")).toBe(55_930.375);
  });

  it("enables explicit MAME stream YM scheduling with integer sample rate", () => {
    const params = new URLSearchParams("soundReplayYmScheduler=mame-stream&soundReplayYmNativeSampleRate=55931.8");

    expect(soundReplayYmSchedulerFromQuery(params)).toBe("mame-stream");
    expect(soundReplayYmNativeSampleRateFromQuery(params, "mame-stream")).toBe(55_931);
  });

  it("defaults MAME stream YM scheduling to MAME's integer stream rate", () => {
    const params = new URLSearchParams("soundReplayYmScheduler=mame-stream");

    expect(soundReplayYmNativeSampleRateFromQuery(params, "mame-stream")).toBe(55_930);
  });

  it("keeps PCM resampling linear unless MAME LoFi is explicit", () => {
    expect(soundReplayPcmResamplerFromQuery(new URLSearchParams(""), "soundReplayYmResampler")).toBe("linear");
    expect(soundReplayPcmResamplerFromQuery(
      new URLSearchParams("soundReplayYmResampler=mame-lofi"),
      "soundReplayYmResampler",
    )).toBe("mame-lofi");
    expect(soundReplayPcmResamplerFromQuery(
      new URLSearchParams("soundReplayYmResampler=other"),
      "soundReplayYmResampler",
    )).toBe("linear");
  });

  it("defaults soundReplay cmd-tape replay to secs/attos timing", () => {
    expect(soundReplayCmdTapeCommandTimingFromQuery(new URLSearchParams(""))).toBe("secsAttos");
    expect(soundReplayCmdTapeCommandTimingFromQuery(
      new URLSearchParams("soundReplayCmdTapeCommandTiming=cycle"),
    )).toBe("cycleInFrame");
    expect(soundReplayCmdTapeCommandTimingFromQuery(
      new URLSearchParams("soundReplayCmdTapeCommandTiming=attos"),
    )).toBe("secsAttos");
  });

  it("parses the diagnostics-only POKEY write apply delay", () => {
    expect(soundReplayPokeyWriteApplyDelayFromQuery(new URLSearchParams(""))).toBe(0);
    expect(soundReplayPokeyWriteApplyDelayFromQuery(
      new URLSearchParams("soundReplayPokeyWriteApplyDelay=112.9"),
    )).toBe(112);
    expect(soundReplayPokeyWriteApplyDelayFromQuery(
      new URLSearchParams("soundReplayPokeyWriteApplyDelay=-10"),
    )).toBe(0);
  });

  it("parses diagnostics-only POKEY sample cadence", () => {
    expect(soundReplayPokeySampleCyclesFromQuery(new URLSearchParams(""))).toBe(28);
    expect(soundReplayPokeySampleCyclesFromQuery(
      new URLSearchParams("soundReplayPokeySampleCycles=1.9"),
    )).toBe(1);
    expect(soundReplayPokeySampleCyclesFromQuery(
      new URLSearchParams("soundReplayPokeySampleCycles=-10"),
    )).toBe(1);
  });

  it("parses the diagnostics-only reset release delay", () => {
    expect(soundReplayResetReleaseDelayFromQuery(new URLSearchParams(""))).toBe(0);
    expect(soundReplayResetReleaseDelayFromQuery(
      new URLSearchParams("soundReplayResetReleaseDelay=19.7"),
    )).toBe(19);
    expect(soundReplayResetReleaseDelayFromQuery(
      new URLSearchParams("soundReplayResetReleaseDelay=-1"),
    )).toBe(0);
  });

  it("defaults soundReplay command NMI latency to the MAME-aligned replay preset", () => {
    expect(soundReplayCommandNmiDelayFromQuery(new URLSearchParams(""))).toBe(1);
    expect(soundReplayCommandNmiDelayFromQuery(
      new URLSearchParams("soundReplayCommandNmiDelay=0"),
    )).toBe(0);
    expect(soundReplayCommandNmiDelayFromQuery(
      new URLSearchParams("soundReplayCommandNmiDelay=2.9"),
    )).toBe(2);
    expect(soundReplayCommandNmiDelayFromQuery(
      new URLSearchParams("soundReplayCommandNmiDelay=-1"),
    )).toBe(0);
  });

  it("parses soundReplay command NMI sample and override controls", () => {
    expect(soundReplayCommandNmiSampleCycleFromQuery(new URLSearchParams(""))).toBe(2);
    expect(soundReplayCommandNmiSampleCycleFromQuery(
      new URLSearchParams("soundReplayCommandNmiSampleCycle=Infinity"),
    )).toBe(Infinity);
    expect(soundReplayCommandNmiSampleCycleFromQuery(
      new URLSearchParams("soundReplayCommandNmiSampleCycle=3.9"),
    )).toBe(3);
    expect(soundReplayCommandNmiDelayMatchesFromQuery(
      new URLSearchParams("soundReplayCommandNmiDelayMatches=1130:0x15:0:0,*:0x03:*:1"),
    )).toEqual([
      { frame: 1130, byte: 0x15, cycleInFrame: 0, delayInstructions: 0 },
      { byte: 0x03, delayInstructions: 1 },
    ]);
  });

  it("parses diagnostics-only YM replay write timing controls", () => {
    const params = new URLSearchParams(
      "soundReplayYmStreamAbsoluteOrigin=1" +
      "&soundReplayYmWriteEventCycleOffsetRegs=0x18:1" +
      "&soundReplayYmWriteEventCycleOffsetMatches=*:0x8fcc:0x08:0x78:48,5737:0x8fcc:0x08:0x78:12,860:*:0x5a:0x01:-40:0:12000" +
      "&soundReplayYmWriteEventSampleOffsetMatches=*:0x8fcc:0x08:0x78:1",
    );

    expect(soundReplayYmStreamAbsoluteOriginFromQuery(params)).toBe(true);
    expect(Array.from(soundReplayYmWriteEventCycleOffsetRegsFromQuery(params).entries())).toEqual([
      [0x18, 1],
    ]);
    expect(soundReplayYmWriteEventCycleOffsetMatchesFromQuery(params)).toEqual([
      { pc: 0x8fcc, reg: 0x08, val: 0x78, deltaCycles: 48 },
      { frame: 5737, pc: 0x8fcc, reg: 0x08, val: 0x78, deltaCycles: 12 },
      { frame: 860, reg: 0x5a, val: 0x01, cycleInFrameMin: 0, cycleInFrameMax: 12000, deltaCycles: -40 },
    ]);
    expect(soundReplayYmWriteEventSampleOffsetMatchesFromQuery(params)).toEqual([
      { pc: 0x8fcc, reg: 0x08, val: 0x78, deltaSamples: 1 },
    ]);
  });

  it("parses and applies soundReplay command-edge event rules", () => {
    const rules = parseSoundReplayCommandEdgeEventRules(
      "0x03:20:20:144:both:64:0:*:command:*:*:*:*;" +
        "0x1b:20:20:30:both:64:0:*:current-event:*:*:*:*",
      64,
      "soundReplayYmCommandEdgeEventRules",
    );
    const commandEvents = readSoundReplayCommandEventsFromTape({
      cmds: [
        { frame: 244, byte: 0x03, cycleInFrame: 100, soundPc: "0x8123" } as never,
        { frame: 244, byte: 0x1b, cycleInFrame: 100, soundPc: "0x8126" } as never,
      ],
    });

    expect(commandEvents).toEqual([
      { sourceIndex: 0, frame: 244, byte: 0x03, soundPc: 0x8123, cycleInFrame: 100, replayCycle: 100 },
      { sourceIndex: 1, frame: 244, byte: 0x1b, soundPc: 0x8126, cycleInFrame: 100, replayCycle: 100 },
    ]);
    expect(soundReplayCommandEdgeRuntimeOffsetFor(
      {
        frame: 244,
        pc: 0x8e9c,
        opcode: 0x21,
        reg: 0x20,
        val: 0x00,
        rawCycle: 120,
        rawCycleInFrame: 120,
        rawWriteCycleOffset: 25,
        currentEventCycleOffset: 0,
      },
      commandEvents,
      [],
      rules.slice(0, 1),
    )).toBe(124);
    expect(soundReplayCommandEdgeRuntimeOffsetFor(
      {
        frame: 244,
        pc: 0x8e9c,
        opcode: 0x21,
        reg: 0x20,
        val: 0x00,
        rawCycle: 120,
        rawCycleInFrame: 120,
        rawWriteCycleOffset: 25,
        currentEventCycleOffset: 30,
      },
      commandEvents,
      [],
      rules.slice(1),
    )).toBe(30);
    expect(Array.from(parseSoundReplayRegisterCycleOffsets("0x91=23", "test").entries())).toEqual([
      [0x91, 23],
    ]);
  });

  it("summarizes command context required by current-event command-PC rules", () => {
    const rules = parseSoundReplayCommandEdgeEventRules(
      "0x03:13100:14000:5:raw-before:0:18000:0x8d5a:current-event:0x8fac+0x8fcc",
      64,
      "soundReplayYmCommandEdgeEventRules",
    );
    const events = readSoundReplayCommandEventsFromTape({
      cmds: [
        { frame: 244, byte: 0x03, secs: 4, attos: "82097585028051680", soundPc: "0x8d5a" },
        { frame: 244, byte: 0x07, cycleInFrame: 120 },
      ],
    });

    expect(soundReplayCommandEdgeRulesRequireCommandPc(rules)).toBe(true);
    expect(events.map((event) => ({
      sourceIndex: event.sourceIndex,
      frame: event.frame,
      byte: event.byte,
      soundPc: event.soundPc,
      cycleInFrame: event.cycleInFrame,
      replayCycle: event.replayCycle,
    }))).toEqual([
      { sourceIndex: 0, frame: 244, byte: 0x03, soundPc: 0x8d5a, cycleInFrame: 0, replayCycle: 0 },
      { sourceIndex: 1, frame: 244, byte: 0x07, soundPc: undefined, cycleInFrame: 120, replayCycle: 120 },
    ]);
    expect(summarizeSoundReplayCommandEvents(events)).toEqual({
      total: 2,
      withCycleInFrame: 2,
      withSoundPc: 1,
    });
  });

  it("derives command-edge replay cycles from explicit video-frame MAME tape cycles", () => {
    const events = readSoundReplayCommandEventsFromTape({
      cmds: [
        {
          frame: 1615,
          byte: 0x03,
          secs: 26,
          attos: "951677657354486120",
          cycleInFrame: 554,
          soundPc: "0x8126",
        },
        {
          frame: 1616,
          byte: 0x03,
          secs: 26,
          attos: "968365532489453520",
          cycleInFrame: 554,
          soundPc: "0x81ea",
        },
      ],
    });

    expect(events.map((event) => ({
      frame: event.frame,
      byte: event.byte,
      soundPc: event.soundPc,
      cycleInFrame: event.cycleInFrame,
      replayCycle: event.replayCycle,
    }))).toEqual([
      { frame: 1615, byte: 0x03, soundPc: 0x8126, cycleInFrame: 554, replayCycle: 554 },
      { frame: 1616, byte: 0x03, soundPc: 0x81ea, cycleInFrame: 554, replayCycle: 30422 },
    ]);
  });

  it("applies the current command-edge preset without overriding explicit query values", () => {
    const applied = applySoundReplayPreset(new URLSearchParams(
      "soundReplayPreset=inject001f-1701-commandedge&soundReplayPokeySampleCycles=7",
    ));

    expect(applied.preset?.name).toBe("inject001f-1701-commandedge");
    expect(soundReplayRequireCommandContextFromQuery(applied.params)).toBe(true);
    expect(applied.params.get("soundReplayCmdTapeCommandTiming")).toBe("attos");
    expect(applied.params.get("soundReplayCommandNmiSampleCycle")).toBe("Infinity");
    expect(applied.params.get("soundReplayCommandNmiDelayMatches")).toBe(
      "*:0x15:0:0,*:0x19:0:0,*:0x03:538:0,*:0x03:623:0",
    );
    expect(applied.params.get("soundReplayYmScheduler")).toBe("mame-stream");
    expect(applied.params.get("soundReplayYmStreamAbsoluteOrigin")).toBe("1");
    const ymRules = applied.params.get("soundReplayYmCommandEdgeEventRules");
    expect(ymRules).toContain("0x1b:20000:24100");
    expect(ymRules).toContain("0x85f3:current-event");
    expect(ymRules).toContain("0x81bb:current-event");
    expect(ymRules).toContain("0x8d5a:current-event");
    expect(ymRules).toContain("0x80f5:current-event");
    expect(ymRules).not.toContain("0x8126:current-event");
    expect(ymRules).not.toContain("0x85f3:current-event::::0x5a=0x01");
    expect(ymRules).not.toContain("0x8d5a:current-event::::0x7a=0x0d");
    expect(ymRules).not.toContain("0x80f5:current-event::::0x7a=0x0d");
    expect(ymRules).not.toContain(
      "0x8126:current-event:0x93a4+0x93c6+0x8e9c+0x8eaf+0x8eeb+0x8fac+0x8fcc",
    );
    expect(ymRules).not.toContain("0x8d5a:current-event:0x8fac+0x8fcc");
    expect(ymRules).not.toContain("0x80f5:current-event:0x8fac+0x8fcc");
    expect(applied.params.get("soundReplayYmWriteEventCycleOffsetMatches")).toBeNull();
    expect(applied.params.get("soundReplayPokeyCommandEdgeEventRules")).toContain("0x03:0:31:160");
    expect(applied.params.get("soundReplayPokeyCommandEdgeRawCycleOffsetOpcodes")).toBe("0x91=23");
    expect(applied.params.get("soundReplayPokeyResampleOffset")).toBe("23.25");
    expect(applied.params.get("soundReplayPokeySampleCycles")).toBe("7");
    expect(resolveSoundReplayPreset(new URLSearchParams("soundReplayPreset=current"))?.name).toBe(
      "inject001f-1701-commandedge",
    );
  });

  it("applies the soundCmdReads event-zero checkpoint without changing current", () => {
    const current = applySoundReplayPreset(new URLSearchParams("soundReplayPreset=current"));
    const applied = applySoundReplayPreset(new URLSearchParams(
      "soundReplayPreset=inject001f-1701-soundcmdreads-eventzero",
    ));

    expect(current.preset?.name).toBe("inject001f-1701-commandedge");
    expect(applied.preset?.name).toBe("inject001f-1701-soundcmdreads-eventzero");

    const currentYmRules = current.params.get("soundReplayYmCommandEdgeEventRules") ?? "";
    const eventZeroYmRules = applied.params.get("soundReplayYmCommandEdgeEventRules") ?? "";
    const eventZeroPokeyRules = applied.params.get("soundReplayPokeyCommandEdgeEventRules") ?? "";
    expect(currentYmRules).not.toContain("0x03:-23:-21:4:raw-after:64:0:0x8123:command:0x81bb:0x14");
    expect(eventZeroYmRules).toContain("0x03:-23:-21:4:raw-after:64:0:0x8123:command:0x81bb:0x14");
    expect(eventZeroYmRules).toContain("0x03:300:5000:-41:raw-before:0:5000:0x8403:current-event");
    expect(eventZeroYmRules).toContain("0x10:-5:-5:138:raw-after:64:0:0x8ff5:command");
    expect(eventZeroYmRules).toContain("0x03:5446:5446:-35:raw-before:0:5449:0x8120:current-event");
    expect(eventZeroPokeyRules).toContain("0x03:-14:-2:0:raw-after:64:0:0xe59a:current-event");
  });
});
