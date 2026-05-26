import { describe, expect, it } from "vitest";
import {
  SOUND_CYCLES_PER_FRAME,
  cmdTapeAbsoluteCycle,
  cmdTapeCommandCycleInFrame,
  cmdTapeCycleInFrame,
  cmdTapeFrameCycles,
  cmdTapeReplaySignedCycleInFrame,
  cmdTapeTimestampVideoCycleInFrame,
  cmdTapeSoundStatusBaseForFrame,
  createSoundChip,
  drainChipWriteEvents,
  drainPokeyDiagnosticChannelSamples,
  drainPokeyDiagnosticRawTransitions,
  drainPokeySamples,
  drainReplyEvents,
  drainYm2151Samples,
  getPokeySampleRate,
  loadCmdTape,
  releaseSoundReset,
  servicePendingCommandNmi,
  setPokeyDiagnosticChannelSamples,
  setPokeyDiagnosticRawTransitions,
  setPokeySampleAfterClock,
  setPokeySampleCycles,
  setSoundFrameContext,
  SOUND_CMD_TAPE_CPU_HZ,
  SOUND_CMD_TAPE_CPU_HZ_DENOMINATOR,
  SOUND_CMD_TAPE_CPU_HZ_NUMERATOR,
  submitCommand,
  tickCycles,
  tickFrameWithTape,
  YM2151_MAME_STREAM_SAMPLE_RATE,
  YM2151_NATIVE_SAMPLE_RATE,
} from "../src/index.js";
import { as_u8, as_u16 } from "../src/wrap.js";

function fakeRoms() {
  return {
    rom421: new Uint8Array(0x4000),
    rom422: new Uint8Array(0x4000),
  };
}

function romsWithResetTo8000() {
  const roms = fakeRoms();
  roms.rom421.fill(0xea); // NOP sled
  roms.rom422[0x3ffa] = 0x00; // NMI vector
  roms.rom422[0x3ffb] = 0x80;
  roms.rom422[0x3ffc] = 0x00; // reset vector
  roms.rom422[0x3ffd] = 0x80;
  roms.rom422[0x3ffe] = 0x00; // IRQ vector
  roms.rom422[0x3fff] = 0x80;
  return roms;
}

describe("sound chip diagnostics", () => {
  it("uses the exact MAME System 1 sound CPU clock for timestamped cmd tapes", () => {
    expect(SOUND_CMD_TAPE_CPU_HZ_NUMERATOR).toBe(14_318_181);
    expect(SOUND_CMD_TAPE_CPU_HZ_DENOMINATOR).toBe(8);
    expect(SOUND_CMD_TAPE_CPU_HZ).toBe(14_318_181 / 8);
    expect(cmdTapeAbsoluteCycle({ secs: 1, attos: "000000000000000000" })).toBe(1_789_772n);
    expect(cmdTapeAbsoluteCycle({ secs: 8, attos: "000000000000000000" })).toBe(14_318_181n);
  });

  it("keeps the MAME YM stream cadence separate from the DSP table rate", () => {
    expect(YM2151_NATIVE_SAMPLE_RATE).toBe(55_930.375);
    expect(YM2151_MAME_STREAM_SAMPLE_RATE).toBe(55_930);

    const chip = createSoundChip({
      roms: fakeRoms(),
      ymAudioScheduler: "mame-stream",
    });
    chip.cpu.cycles = Math.ceil(SOUND_CMD_TAPE_CPU_HZ / YM2151_MAME_STREAM_SAMPLE_RATE);

    const targetSample = Math.floor(chip.cpu.cycles * YM2151_MAME_STREAM_SAMPLE_RATE / SOUND_CMD_TAPE_CPU_HZ);
    expect(drainYm2151Samples(chip)).toHaveLength((targetSample + 1) * 2);
  });

  it("uses the absolute YM stream origin for drain catch-up as well as writes", () => {
    const chip = createSoundChip({
      roms: fakeRoms(),
      ymAudioScheduler: "mame-stream",
      ymStreamSampleRate: YM2151_MAME_STREAM_SAMPLE_RATE,
      ymStreamSampleOffset: 0,
      ymStreamCycleOffsetCycles: 1,
    });

    chip.cpu.cycles = 32;

    expect(drainYm2151Samples(chip)).toHaveLength(4);
  });

  it("loads cmd tapes with explicit and timestamp-derived cycle offsets", () => {
    expect(cmdTapeCycleInFrame({ frame: 0, secs: 0, attos: "1000000000000000" })).toBe(1789);

    const tape = loadCmdTape({
      cmds: [
        { frame: 244, byte: 0x00, cycleInFrame: 120 },
        {
          frame: 244,
          byte: 0x03,
          cycleInFrame: 20,
          soundPc: "0x8126",
          soundA: "0x10",
          soundX: "0x04",
          soundY: "0x00",
          soundP: "0x33",
          soundSp: "0x1ff",
        },
        { frame: 245, byte: 0x04 },
      ],
    });

    expect(tape.cmdCount).toBe(3);
    expect(tape.totalFrames).toBe(246);
    expect(tape.firstCommandFrame).toBe(244);
    expect(tape.resetFrame).toBe(244);
    expect(tape.cyclePrecise).toBe(true);
    expect(tape.byFrame.get(244)).toEqual([0x00, 0x03]);
    expect(tape.byFrameCycle.get(244)?.map((c) => [c.byte, c.cycleInFrame])).toEqual([
      [0x03, 20],
      [0x00, 120],
    ]);
    expect(tape.byFrameCycle.get(244)?.[0]).toMatchObject({
      soundPc: 0x8126,
      soundA: 0x10,
      soundX: 0x04,
      soundY: 0x00,
      soundP: 0x33,
      soundSp: 0xff,
    });
    expect(tape.byFrameCycle.get(245)?.[0]?.cycleInFrame).toBeUndefined();
  });

  it("exposes cmd-tape diagnostic CPU state on command submit events", () => {
    const tape = loadCmdTape({
      cmds: [{
        frame: 0,
        byte: 0x12,
        cycleInFrame: 0,
        soundPc: 0x8126,
        soundA: 0x10,
        soundX: 0x04,
        soundY: 0x00,
        soundP: 0x33,
        soundSp: 0x1ff,
      }],
    });
    const chip = createSoundChip({ roms: romsWithResetTo8000() });
    const events: unknown[] = [];

    tickFrameWithTape(chip, tape, 0, {
      autoReleaseReset: true,
      onCommandSubmit: (event) => events.push(event),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceIndex: 0,
      frame: 0,
      byte: 0x12,
      cycleInFrame: 0,
      expectedSoundPc: 0x8126,
      expectedSoundA: 0x10,
      expectedSoundX: 0x04,
      expectedSoundY: 0x00,
      expectedSoundP: 0x33,
      expectedSoundSp: 0xff,
    });
  });

  it("replays cmd-tape Coin 1 input in the sound status base", () => {
    const tape = loadCmdTape({
      coinFrame: 1_200,
      cmds: [{ frame: 244, byte: 0x00, cycleInFrame: 0 }],
    });

    expect(tape.coinFrame).toBe(1_200);
    expect(tape.coinPulseFrames).toBe(15);
    expect(cmdTapeSoundStatusBaseForFrame(tape, 1_198)).toBe(0x87);
    expect(cmdTapeSoundStatusBaseForFrame(tape, 1_199)).toBe(0x86);
    expect(cmdTapeSoundStatusBaseForFrame(tape, 1_213)).toBe(0x86);
    expect(cmdTapeSoundStatusBaseForFrame(tape, 1_214)).toBe(0x87);

    const chip = createSoundChip({ roms: fakeRoms() });
    tickFrameWithTape(chip, tape, 1_199);
    expect(chip.statusBaseOverride).toBe(0x86);
    tickFrameWithTape(chip, tape, 1_214);
    expect(chip.statusBaseOverride).toBe(0x87);
  });

  it("keeps timestamp offsets relative inside the same frame", () => {
    const tape = loadCmdTape({
      cmds: [
        { frame: 10, byte: 0x03, secs: 1, attos: "000000000000000000" },
        { frame: 10, byte: 0x08, secs: 1, attos: "002000000000000000" },
      ],
    });

    expect(tape.byFrameCycle.get(10)?.map((c) => [c.byte, c.cycleInFrame])).toEqual([
      [0x03, 0],
      [0x08, 3580],
    ]);
  });

  it("calculates video-frame cycles for realistic MAME timestamp-only cmd tapes", () => {
    expect(SOUND_CYCLES_PER_FRAME).toBe(29_868);
    expect(cmdTapeTimestampVideoCycleInFrame({
      frame: 1615,
      secs: 26,
      attos: "951677657354486120",
    })).toBe(554);
    expect(cmdTapeTimestampVideoCycleInFrame({
      frame: 1306,
      secs: 21,
      attos: "798536964892444960",
    })).toBe(6816);

    const tape = loadCmdTape({
      cmds: [
        { frame: 1305, byte: 0x03, secs: 21, attos: "778997330665190840" },
        { frame: 1306, byte: 0x03, secs: 21, attos: "795078704135840600" },
        { frame: 1306, byte: 0x07, secs: 21, attos: "798536964892444960" },
        { frame: 1615, byte: 0x03, secs: 26, attos: "951677657354486120" },
        { frame: 1616, byte: 0x03, secs: 26, attos: "968365532489453520" },
      ],
    });

    expect(tape.byFrameCycle.get(1305)?.map((c) => [c.byte, c.cycleInFrame])).toEqual([
      [0x03, 0],
    ]);
    expect(tape.byFrameCycle.get(1306)?.map((c) => [c.byte, c.cycleInFrame])).toEqual([
      [0x03, 0],
      [0x07, 6189],
    ]);
    expect(tape.byFrameCycle.get(1615)?.map((c) => [c.byte, c.cycleInFrame])).toEqual([
      [0x03, 0],
    ]);
    expect(tape.byFrameCycle.get(1616)?.map((c) => [c.byte, c.cycleInFrame])).toEqual([
      [0x03, 0],
    ]);
    expect(cmdTapeFrameCycles(tape, 1305)).toBe(28_782);
    expect(cmdTapeFrameCycles(tape, 1615)).toBe(SOUND_CYCLES_PER_FRAME);
  });

  it("prefers explicit video-frame cmd cycle offsets when timestamps are present", () => {
    expect(cmdTapeCycleInFrame({
      frame: 0,
      secs: 0,
      attos: "1000000000000000",
      cycleInFrame: 7,
    })).toBe(7);

    const origin = {
      frame: 1130,
      secs: 18,
      attos: "857614585092931200",
      cycleInFrame: 0,
    };
    const command = {
      frame: 1130,
      secs: 18,
      attos: "857915461321613880",
      cycleInFrame: 539,
    };

    expect(cmdTapeReplaySignedCycleInFrame(command, origin)).toBe(539);

    const tape = loadCmdTape({ cmds: [
      { ...origin, byte: 0x15 },
      { ...command, byte: 0x03 },
    ] });
    expect(tape.byFrameCycle.get(1130)?.map((c) => [c.byte, c.cycleInFrame])).toEqual([
      [0x15, 0],
      [0x03, 539],
    ]);
  });

  it("can replay commands from secs/attos instead of explicit diagnostic cycle offsets", () => {
    const tape = loadCmdTape({
      cmds: [
        { frame: 10, byte: 0x03, secs: 1, attos: "000000000000000000", cycleInFrame: 500 },
        { frame: 10, byte: 0x08, secs: 1, attos: "002000000000000000", cycleInFrame: 700 },
        { frame: 11, byte: 0x15, secs: 1, attos: "004000000000000000", cycleInFrame: 900 },
      ],
    }, { commandTiming: "secsAttos" });

    expect(tape.byFrameCycle.get(10)?.map((c) => [c.byte, c.cycleInFrame])).toEqual([
      [0x03, 0],
      [0x08, 3580],
    ]);
    expect(tape.byFrameCycle.get(11)?.map((c) => [c.byte, c.cycleInFrame])).toEqual([
      [0x15, 0],
    ]);
    expect(cmdTapeFrameCycles(tape, 10)).toBe(7159);
  });

  it("derives frame cycle budgets from timestamped frame origins", () => {
    const tape = loadCmdTape({
      cmds: [
        { frame: 10, byte: 0x03, secs: 1, attos: "000000000000000000" },
        { frame: 11, byte: 0x03, secs: 1, attos: "002000000000000000" },
        { frame: 12, byte: 0x03, secs: 1, attos: "005000000000000000" },
      ],
    });

    expect(cmdTapeFrameCycles(tape, 10)).toBe(3580);
    expect(cmdTapeFrameCycles(tape, 11)).toBe(5369);
    expect(cmdTapeFrameCycles(tape, 12)).toBe(SOUND_CYCLES_PER_FRAME);
  });

  it("derives timestamped frame budgets from explicit video-frame origins", () => {
    const tape = loadCmdTape({
      cmds: [
        { frame: 10, byte: 0x03, secs: 1, attos: "000000000000000000", cycleInFrame: 500 },
        { frame: 11, byte: 0x03, secs: 1, attos: "002000000000000000", cycleInFrame: 700 },
      ],
    });

    expect(tape.byFrameCycle.get(10)?.[0]?.cycleInFrame).toBe(500);
    expect(tape.byFrameCycle.get(11)?.[0]?.cycleInFrame).toBe(700);
    expect(cmdTapeFrameCycles(tape, 10)).toBe(3380);
  });

  it("drains YM2151 and POKEY write events with frame/cycle context", () => {
    const chip = createSoundChip({ roms: fakeRoms() });
    chip.cpu.cycles = 1_234;
    chip.cpu.rf.pc = as_u16(0x8123);
    setSoundFrameContext(chip, 12, 1_000);

    chip.mmu.write8(0x1800 as never, as_u8(0x2a));
    chip.mmu.write8(0x1801 as never, as_u8(0x55));
    chip.mmu.write8(0x1873 as never, as_u8(0xaa));

    expect(drainChipWriteEvents(chip)).toEqual([
      {
        kind: "ym2151",
        frame: 12,
        cycle: 1_234,
        cycleInFrame: 234,
        pc: 0x8123,
        writeCycleOffset: 0,
        reg: 0x2a,
        val: 0x55,
      },
      {
        kind: "pokey",
        frame: 12,
        cycle: 1_234,
        cycleInFrame: 234,
        pc: 0x8123,
        writeCycleOffset: 0,
        pokeyApplyCycle: 1_234,
        pokeyApplyDelayCycles: 0,
        reg: 0x03,
        val: 0xaa,
      },
    ]);
    expect(drainChipWriteEvents(chip)).toEqual([]);
  });

  it("timestamps chip write events at the estimated bus write cycle", () => {
    const ymRoms = fakeRoms();
    ymRoms.rom421[0x01bb] = 0x8e; // STX $1801
    const ym = createSoundChip({ roms: ymRoms });
    ym.cpu.cycles = 1_234;
    ym.cpu.lastOpcodePc = 0x81bb;
    setSoundFrameContext(ym, 12, 1_000);

    ym.mmu.write8(0x1800 as never, as_u8(0x2a));
    ym.mmu.write8(0x1801 as never, as_u8(0x55));

    expect(drainChipWriteEvents(ym)).toEqual([
      {
        kind: "ym2151",
        frame: 12,
        cycle: 1_237,
        cycleInFrame: 237,
        pc: 0x81bb,
        writeCycleOffset: 3,
        reg: 0x2a,
        val: 0x55,
      },
    ]);

    const pokeyRoms = fakeRoms();
    pokeyRoms.rom421[0x0e28] = 0x91; // STA ($10),Y
    const pokey = createSoundChip({ roms: pokeyRoms });
    pokey.cpu.cycles = 2_000;
    pokey.cpu.lastOpcodePc = 0x8e28;
    setSoundFrameContext(pokey, 20, 1_900);

    pokey.mmu.write8(0x1873 as never, as_u8(0xaa));

    expect(drainChipWriteEvents(pokey)).toEqual([
      {
        kind: "pokey",
        frame: 20,
        cycle: 2_005,
        cycleInFrame: 105,
        pc: 0x8e28,
        writeCycleOffset: 5,
        pokeyApplyCycle: 2_005,
        pokeyApplyDelayCycles: 0,
        reg: 0x03,
        val: 0xaa,
      },
    ]);
  });

  it("can offset YM key-on event timestamps without moving other YM writes", () => {
    const roms = fakeRoms();
    roms.rom421[0x029e] = 0x8c; // STY $1801
    const chip = createSoundChip({ roms, ymKeyOnWriteEventCycleOffsetCycles: 5 });
    chip.cpu.cycles = 1_000;
    chip.cpu.lastOpcodePc = 0x829e;
    setSoundFrameContext(chip, 7, 900);

    chip.mmu.write8(0x1800 as never, as_u8(0x08));
    chip.mmu.write8(0x1801 as never, as_u8(0x07));
    chip.mmu.write8(0x1800 as never, as_u8(0x20));
    chip.mmu.write8(0x1801 as never, as_u8(0xc0));

    expect(drainChipWriteEvents(chip).map((event) => ({
      cycle: event.cycle,
      cycleInFrame: event.cycleInFrame,
      writeCycleOffset: event.writeCycleOffset,
      reg: event.reg,
      val: event.val,
    }))).toEqual([
      { cycle: 1_008, cycleInFrame: 108, writeCycleOffset: 8, reg: 0x08, val: 0x07 },
      { cycle: 1_003, cycleInFrame: 103, writeCycleOffset: 3, reg: 0x20, val: 0xc0 },
    ]);
  });

  it("can dynamically offset YM event timestamps without moving POKEY writes", () => {
    const roms = fakeRoms();
    roms.rom421[0x01bb] = 0x8e; // STX $1801
    const providerCalls: unknown[] = [];
    const chip = createSoundChip({
      roms,
      ymWriteEventCycleOffsetCycles: 2,
      ymWriteEventCycleOffsetByReg: new Map([[0x20, 4]]),
      ymWriteEventCycleOffsetProvider: (ctx) => {
        providerCalls.push(ctx);
        return ctx.currentEventCycleOffset === 6 ? 5 : undefined;
      },
    });
    chip.cpu.cycles = 1_000;
    chip.cpu.lastOpcodePc = 0x81bb;
    setSoundFrameContext(chip, 7, 900);

    chip.mmu.write8(0x1800 as never, as_u8(0x20));
    chip.mmu.write8(0x1801 as never, as_u8(0xc0));
    chip.mmu.write8(0x1873 as never, as_u8(0xaa));

    expect(providerCalls).toEqual([{
      frame: 7,
      pc: 0x81bb,
      opcode: 0x8e,
      reg: 0x20,
      val: 0xc0,
      rawCycle: 1_003,
      rawCycleInFrame: 103,
      rawWriteCycleOffset: 3,
      currentEventCycleOffset: 6,
    }]);
    expect(drainChipWriteEvents(chip).map((event) => ({
      kind: event.kind,
      cycle: event.cycle,
      cycleInFrame: event.cycleInFrame,
      writeCycleOffset: event.writeCycleOffset,
      reg: event.reg,
      val: event.val,
      rawCycle: event.rawCycle,
      rawCycleInFrame: event.rawCycleInFrame,
      eventCycleOffset: event.eventCycleOffset,
    }))).toEqual([
      {
        kind: "ym2151",
        cycle: 1_014,
        cycleInFrame: 114,
        writeCycleOffset: 14,
        reg: 0x20,
        val: 0xc0,
        rawCycle: 1_003,
        rawCycleInFrame: 103,
        eventCycleOffset: 11,
      },
      {
        kind: "pokey",
        cycle: 1_003,
        cycleInFrame: 103,
        writeCycleOffset: 3,
        reg: 0x03,
        val: 0xaa,
        rawCycle: undefined,
        rawCycleInFrame: undefined,
        eventCycleOffset: undefined,
      },
    ]);
  });

  it("reports which YM event offset selectors matched a diagnostic write", () => {
    const roms = fakeRoms();
    roms.rom421[0x029e] = 0x8c; // STY $1801
    const chip = createSoundChip({
      roms,
      ymWriteEventCycleOffsetCycles: 2,
      ymWriteEventCycleOffsetMatches: [
        { frame: 7, pc: 0x829e, reg: 0x20, val: 0xc0, cycleInFrameMin: 100, cycleInFrameMax: 110, deltaCycles: 5 },
        { frame: 8, pc: 0x829e, reg: 0x20, val: 0xc0, deltaCycles: 11 },
      ],
    });
    chip.cpu.cycles = 1_000;
    chip.cpu.lastOpcodePc = 0x829e;
    setSoundFrameContext(chip, 7, 900);

    chip.mmu.write8(0x1800 as never, as_u8(0x20));
    chip.mmu.write8(0x1801 as never, as_u8(0xc0));

    expect(drainChipWriteEvents(chip).map((event) => ({
      cycle: event.cycle,
      cycleInFrame: event.cycleInFrame,
      rawCycle: event.rawCycle,
      rawCycleInFrame: event.rawCycleInFrame,
      writeCycleOffset: event.writeCycleOffset,
      eventCycleOffset: event.eventCycleOffset,
      matchIndices: event.ymWriteEventCycleOffsetMatchIndices,
      reg: event.reg,
      val: event.val,
    }))).toEqual([{
      cycle: 1_010,
      cycleInFrame: 110,
      rawCycle: 1_003,
      rawCycleInFrame: 103,
      writeCycleOffset: 10,
      eventCycleOffset: 7,
      matchIndices: [0],
      reg: 0x20,
      val: 0xc0,
    }]);
  });

  it("can offset selected YM stream writes in sample units without moving diagnostic events", () => {
    const roms = fakeRoms();
    roms.rom421[0x029e] = 0x8c; // STY $1801
    const makeChip = (sampleOffset = 0) => createSoundChip({
      roms,
      ymAudioScheduler: "mame-stream",
      ymStreamSampleRate: SOUND_CMD_TAPE_CPU_HZ,
      ...(sampleOffset === 0
        ? {}
        : {
          ymWriteEventSampleOffsetMatches: [{
            frame: 7,
            pc: 0x829e,
            reg: 0x08,
            val: 0x78,
            deltaSamples: sampleOffset,
          }],
        }),
    });
    const writeMatchedKeyOn = (chip: ReturnType<typeof makeChip>) => {
      chip.cpu.cycles = 10;
      chip.cpu.lastOpcodePc = 0x829e;
      setSoundFrameContext(chip, 7, 0);
      chip.mmu.write8(0x1800 as never, as_u8(0x08));
      chip.mmu.write8(0x1801 as never, as_u8(0x78));
      return {
        events: drainChipWriteEvents(chip),
        sampleCount: drainYm2151Samples(chip).length,
      };
    };

    const baseline = writeMatchedKeyOn(makeChip());
    const shifted = writeMatchedKeyOn(makeChip(2));
    const coreEvents = (events: ReturnType<typeof drainChipWriteEvents>) => events.map((event) => ({
      kind: event.kind,
      frame: event.frame,
      cycle: event.cycle,
      cycleInFrame: event.cycleInFrame,
      pc: event.pc,
      writeCycleOffset: event.writeCycleOffset,
      reg: event.reg,
      val: event.val,
    }));

    expect(coreEvents(baseline.events)).toEqual(coreEvents(shifted.events));
    expect(coreEvents(shifted.events)).toEqual([{
      kind: "ym2151",
      frame: 7,
      cycle: 13,
      cycleInFrame: 13,
      pc: 0x829e,
      writeCycleOffset: 3,
      reg: 0x08,
      val: 0x78,
    }]);
    expect(shifted.events[0]!.ymStreamTargetSample! - baseline.events[0]!.ymStreamTargetSample!).toBe(2);
    expect(shifted.sampleCount - baseline.sampleCount).toBe(4);
  });

  it("can disable LS259 YM reset as a diagnostics-only control", () => {
    const defaultChip = createSoundChip({ roms: fakeRoms() });
    defaultChip.mmu.write8(0x1800 as never, as_u8(0x20));
    defaultChip.mmu.write8(0x1801 as never, as_u8(0x7f));
    defaultChip.mmu.write8(0x1820 as never, as_u8(0x01));
    expect(defaultChip.ym2151.regs[0x20]).toBe(0x00);

    const diagnosticChip = createSoundChip({ roms: fakeRoms(), disableYmReset: true });
    diagnosticChip.mmu.write8(0x1800 as never, as_u8(0x20));
    diagnosticChip.mmu.write8(0x1801 as never, as_u8(0x7f));
    diagnosticChip.mmu.write8(0x1820 as never, as_u8(0x01));
    expect(diagnosticChip.ym2151.regs[0x20]).toBe(0x7f);
  });

  it("can delay POKEY write application without moving diagnostic write events", () => {
    const chip = createSoundChip({
      roms: romsWithResetTo8000(),
      pokeyWriteApplyDelayCycles: 5,
    });
    releaseSoundReset(chip);
    setSoundFrameContext(chip, 0, 0);

    chip.mmu.write8(0x1873 as never, as_u8(0xaa));

    expect(chip.pokey.writeRegs[3]).toBe(0x00);
    expect(drainChipWriteEvents(chip)).toEqual([
      {
        kind: "pokey",
        frame: 0,
        cycle: 0,
        cycleInFrame: 0,
        pc: 0x8000,
        writeCycleOffset: 0,
        pokeyApplyCycle: 5,
        pokeyApplyDelayCycles: 5,
        reg: 0x03,
        val: 0xaa,
      },
    ]);

    tickCycles(chip, 4);
    expect(chip.pokey.writeRegs[3]).toBe(0x00);

    tickCycles(chip, 1);
    expect(chip.pokey.writeRegs[3]).toBe(0xaa);
  });

  it("exposes diagnostics-only POKEY channel samples through the facade", () => {
    const chip = createSoundChip({ roms: fakeRoms() });
    setPokeyDiagnosticChannelSamples(chip, true);
    chip.mmu.write8(0x187f as never, as_u8(0x03));
    chip.mmu.write8(0x1871 as never, as_u8(0x1f));

    tickCycles(chip, 28 * 3);

    const mix = drainPokeySamples(chip);
    const channels = drainPokeyDiagnosticChannelSamples(chip);
    expect(channels?.[0]).toHaveLength(mix.length);
    for (let i = 0; i < mix.length; i++) {
      expect(channels?.[0]?.[i]).toBeCloseTo(mix[i] ?? 0, 7);
    }
  });

  it("exposes diagnostics-only POKEY sample cadence through the facade", () => {
    const chip = createSoundChip({ roms: romsWithResetTo8000() });
    setPokeySampleCycles(chip, 1);
    releaseSoundReset(chip);
    chip.mmu.write8(0x187f as never, as_u8(0x03));
    chip.mmu.write8(0x1871 as never, as_u8(0x1f));

    tickCycles(chip, 5);

    expect(getPokeySampleRate(chip)).toBeCloseTo(1_789_772, 5);
    expect(drainPokeySamples(chip).length).toBeGreaterThanOrEqual(5);
  });

  it("exposes diagnostics-only POKEY post-clock sample timing through the facade", () => {
    const chip = createSoundChip({ roms: romsWithResetTo8000() });
    setPokeySampleCycles(chip, 1);
    setPokeySampleAfterClock(chip, true);
    releaseSoundReset(chip);
    chip.mmu.write8(0x187f as never, as_u8(0x03));
    chip.mmu.write8(0x1871 as never, as_u8(0x1f));

    tickCycles(chip, 1);

    expect(drainPokeySamples(chip)[0]).toBeGreaterThan(0);
  });

  it("exposes diagnostics-only POKEY raw transitions through the facade", () => {
    const chip = createSoundChip({ roms: romsWithResetTo8000() });
    setPokeySampleCycles(chip, 1);
    setPokeyDiagnosticRawTransitions(chip, true);
    releaseSoundReset(chip);
    chip.mmu.write8(0x187f as never, as_u8(0x03));
    chip.mmu.write8(0x1871 as never, as_u8(0x1f));

    tickCycles(chip, 2);

    const transitions = drainPokeyDiagnosticRawTransitions(chip);
    expect(transitions).toHaveLength(1);
    expect(transitions?.[0]).toMatchObject({
      cycle: 1,
      nativeSample: 1,
      cycleInNativeSample: 0,
      prevRaw: 0,
      raw: 0x000f,
    });
    expect(drainPokeyDiagnosticRawTransitions(chip)).toEqual([]);
  });

  it("can drain YM samples from the diagnostics-only MAME stream scheduler", () => {
    const chip = createSoundChip({
      roms: fakeRoms(),
      ymAudioScheduler: "mame-stream",
      ymStreamSampleRate: SOUND_CMD_TAPE_CPU_HZ,
    });

    chip.cpu.cycles = 5;

    expect(drainYm2151Samples(chip)).toHaveLength(12);
    expect(drainYm2151Samples(chip)).toEqual([]);
  });

  it("clamps explicit cmd cycle offsets to the sound frame", () => {
    expect(cmdTapeCycleInFrame({ frame: 1, cycleInFrame: -5 })).toBe(0);
    expect(cmdTapeCycleInFrame({ frame: 1, cycleInFrame: SOUND_CYCLES_PER_FRAME + 99 })).toBe(SOUND_CYCLES_PER_FRAME);
  });

  it("derives replay command targets from explicit offsets or legacy spreading", () => {
    expect(cmdTapeCommandCycleInFrame({ cycleInFrame: -5 }, 0, 1, 100)).toBe(0);
    expect(cmdTapeCommandCycleInFrame({ cycleInFrame: 125 }, 0, 1, 100)).toBe(100);
    expect(cmdTapeCommandCycleInFrame({ cycleInFrame: undefined }, 0, 1, 100)).toBe(0);
    expect(cmdTapeCommandCycleInFrame({ cycleInFrame: undefined }, 2, 4, 100)).toBe(50);
  });

  it("preserves signed replay offsets for diagnostic MAME timing", () => {
    const origin = { frame: 10, secs: 1, attos: "002000000000000000" };

    expect(cmdTapeReplaySignedCycleInFrame(
      { frame: 10, secs: 1, attos: "001000000000000000" },
      origin,
    )).toBe(-1790);
    expect(cmdTapeReplaySignedCycleInFrame(
      { frame: 10, secs: 1, attos: "004000000000000000" },
      origin,
    )).toBe(3579);
    expect(cmdTapeReplaySignedCycleInFrame(
      { frame: 10, cycleInFrame: -5 },
      origin,
    )).toBe(-5);
  });

  it("keeps replay command timing on the external tape clock across CPU overshoot", () => {
    const chip = createSoundChip({ roms: fakeRoms() });
    const tape = loadCmdTape({
      cmds: [
        { frame: 0, byte: 0x01, cycleInFrame: 0 },
        { frame: 1, byte: 0x02, cycleInFrame: 3 },
      ],
    });
    tape.frameCycleBudgets.set(0, 5);
    tape.frameCycleBudgets.set(1, 5);

    const submits: Array<{
      frame: number;
      byte: number;
      cycle: number;
      cycleInFrame: number;
      actualCycle: number;
      actualCycleInFrame: number;
    }> = [];
    tickFrameWithTape(chip, tape, 0, { autoReleaseReset: true, onCommandSubmit: (e) => submits.push(e) });
    expect(chip.cpu.cycles).toBeGreaterThan(5);

    tickFrameWithTape(chip, tape, 1, { autoReleaseReset: true, onCommandSubmit: (e) => submits.push(e) });

    expect(submits.map(({ frame, byte, cycle, cycleInFrame }) => ({ frame, byte, cycle, cycleInFrame }))).toEqual([
      { frame: 0, byte: 0x01, cycle: 0, cycleInFrame: 0 },
      { frame: 1, byte: 0x02, cycle: 8, cycleInFrame: 3 },
    ]);
    expect(submits[0]!.actualCycle).toBeGreaterThanOrEqual(0);
    expect(submits[0]!.actualCycleInFrame).toBe(submits[0]!.actualCycle);
    expect(submits[1]!.actualCycle).toBeGreaterThanOrEqual(8);
    expect(submits[1]!.actualCycleInFrame).toBe(submits[1]!.actualCycle - 5);
    expect(chip.cpu.cycles).toBeGreaterThan(8);
  });

  it("reports replay frame scheduler drift without changing command timing", () => {
    const chip = createSoundChip({ roms: fakeRoms() });
    const tape = loadCmdTape({
      cmds: [
        { frame: 0, byte: 0x01, cycleInFrame: 0 },
        { frame: 1, byte: 0x02, cycleInFrame: 3 },
      ],
    });
    tape.frameCycleBudgets.set(0, 5);
    tape.frameCycleBudgets.set(1, 5);

    const frames: Array<{
      frame: number;
      frameStart: number;
      frameEnd: number;
      cpuStart: number;
      cpuEnd: number;
      cpuStartDelta: number;
      cpuEndDelta: number;
      commandCount: number;
    }> = [];
    const submits: Array<{
      frame: number;
      byte: number;
      cycle: number;
      cycleInFrame: number;
    }> = [];
    const opts = {
      autoReleaseReset: true,
      onFrameAdvance: (e: {
        frame: number;
        frameStart: number;
        frameEnd: number;
        cpuStart: number;
        cpuEnd: number;
        cpuStartDelta: number;
        cpuEndDelta: number;
        commandCount: number;
      }) => frames.push(e),
      onCommandSubmit: (e: {
        frame: number;
        byte: number;
        cycle: number;
        cycleInFrame: number;
      }) => submits.push(e),
    };

    tickFrameWithTape(chip, tape, 0, opts);
    tickFrameWithTape(chip, tape, 1, opts);

    expect(submits.map(({ frame, byte, cycle, cycleInFrame }) => ({ frame, byte, cycle, cycleInFrame }))).toEqual([
      { frame: 0, byte: 0x01, cycle: 0, cycleInFrame: 0 },
      { frame: 1, byte: 0x02, cycle: 8, cycleInFrame: 3 },
    ]);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.frameStart).toBe(0);
    expect(frames[0]!.frameEnd).toBe(5);
    expect(frames[0]!.cpuStartDelta).toBe(0);
    expect(frames[0]!.cpuEndDelta).toBe(chip.inReset ? 0 : frames[0]!.cpuEnd - 5);
    expect(frames[1]!.frameStart).toBe(5);
    expect(frames[1]!.frameEnd).toBe(10);
    expect(frames[1]!.cpuStartDelta).toBe(frames[1]!.cpuStart - 5);
    expect(frames[1]!.cpuEndDelta).toBe(frames[1]!.cpuEnd - 10);
    expect(frames[1]!.cpuStartDelta).toBeGreaterThanOrEqual(0);
  });

  it("can offset replay command timing for diagnostics without changing tape data", () => {
    const chip = createSoundChip({ roms: fakeRoms() });
    const tape = loadCmdTape({
      cmds: [
        { frame: 0, byte: 0x01, cycleInFrame: 1 },
        { frame: 0, byte: 0x02, cycleInFrame: 4 },
      ],
    });
    tape.frameCycleBudgets.set(0, 5);

    const submits: Array<{
      frame: number;
      byte: number;
      cycle: number;
      cycleInFrame: number;
    }> = [];
    tickFrameWithTape(chip, tape, 0, {
      autoReleaseReset: true,
      commandCycleOffsetCycles: 2,
      onCommandSubmit: (e) => submits.push(e),
    });

    expect(tape.byFrameCycle.get(0)?.map((c) => [c.byte, c.cycleInFrame])).toEqual([
      [0x01, 1],
      [0x02, 4],
    ]);
    expect(submits.map(({ frame, byte, cycle, cycleInFrame }) => ({ frame, byte, cycle, cycleInFrame }))).toEqual([
      { frame: 0, byte: 0x01, cycle: 3, cycleInFrame: 3 },
      { frame: 0, byte: 0x02, cycle: 5, cycleInFrame: 5 },
    ]);
  });

  it("can delay CPU start after reset release without moving the scheduled reset command", () => {
    const chip = createSoundChip({ roms: fakeRoms() });
    setPokeySampleCycles(chip, 1);
    const tape = loadCmdTape({ cmds: [{ frame: 0, byte: 0x01, cycleInFrame: 0 }] });
    tape.frameCycleBudgets.set(0, 5);

    const submits: Array<{
      frame: number;
      byte: number;
      cycle: number;
      cycleInFrame: number;
      actualCycle: number;
      actualCycleInFrame: number;
    }> = [];
    const elapsed = tickFrameWithTape(chip, tape, 0, {
      autoReleaseReset: true,
      resetReleaseDelayCycles: 30,
      onCommandSubmit: (e) => submits.push(e),
    });

    expect(submits.map(({ frame, byte, cycle, cycleInFrame }) => ({ frame, byte, cycle, cycleInFrame }))).toEqual([
      { frame: 0, byte: 0x01, cycle: 0, cycleInFrame: 0 },
    ]);
    expect(submits[0]!.actualCycle).toBeGreaterThanOrEqual(0);
    expect(submits[0]!.actualCycleInFrame).toBe(submits[0]!.actualCycle);
    expect(chip.inReset).toBe(false);
    expect(chip.cpu.cycles).toBe(30);
    expect(elapsed).toBe(30);
    expect(drainPokeySamples(chip)).toHaveLength(30);
  });

  it("delays a scheduled command NMI when the target misses the sample point", () => {
    const roms = romsWithResetTo8000();
    roms.rom421[0] = 0xad; // LDA $0000, 4 cycles
    roms.rom421[1] = 0x00;
    roms.rom421[2] = 0x00;
    const chip = createSoundChip({ roms });
    const tape = loadCmdTape({ cmds: [{ frame: 0, byte: 0x01, cycleInFrame: 2 }] });
    tape.frameCycleBudgets.set(0, 5);

    const submits: Array<{
      sourceIndex: number;
      frame: number;
      byte: number;
      cycle: number;
      commandNmiDelayInstructions: number;
    }> = [];
    tickFrameWithTape(chip, tape, 0, {
      autoReleaseReset: true,
      onCommandSubmit: (e) => submits.push(e),
    });

    expect(submits.map(({ sourceIndex, frame, byte, cycle, commandNmiDelayInstructions }) => ({
      sourceIndex,
      frame,
      byte,
      cycle,
      commandNmiDelayInstructions,
    }))).toEqual([
      { sourceIndex: 0, frame: 0, byte: 0x01, cycle: 2, commandNmiDelayInstructions: 1 },
    ]);
  });

  it("can override scheduled command NMI delay for selected diagnostics", () => {
    const roms = romsWithResetTo8000();
    roms.rom421[0] = 0xad; // LDA $0000, 4 cycles
    roms.rom421[1] = 0x00;
    roms.rom421[2] = 0x00;
    const chip = createSoundChip({ roms, commandNmiDelayInstructions: 1 });
    const tape = loadCmdTape({ cmds: [{ frame: 0, byte: 0x15, cycleInFrame: 2 }] });
    tape.frameCycleBudgets.set(0, 5);

    const submits: Array<{
      sourceIndex: number;
      frame: number;
      byte: number;
      cycle: number;
      commandNmiDelayInstructions: number;
    }> = [];
    tickFrameWithTape(chip, tape, 0, {
      autoReleaseReset: true,
      commandNmiSampleCycle: Infinity,
      commandNmiDelayOverride: ({ sourceIndex, byte }) => sourceIndex === 0 && byte === 0x15 ? 0 : undefined,
      onCommandSubmit: (e) => submits.push(e),
    });

    expect(submits.map(({ sourceIndex, frame, byte, cycle, commandNmiDelayInstructions }) => ({
      sourceIndex,
      frame,
      byte,
      cycle,
      commandNmiDelayInstructions,
    }))).toEqual([
      { sourceIndex: 0, frame: 0, byte: 0x15, cycle: 2, commandNmiDelayInstructions: 0 },
    ]);
  });

  it("can preempt an imminent chip write before a scheduled command for diagnostics", () => {
    const roms = romsWithResetTo8000();
    roms.rom421[0] = 0x8e; // STX $1801, writes at cycle offset 3
    roms.rom421[1] = 0x01;
    roms.rom421[2] = 0x18;
    const chip = createSoundChip({ roms });
    const tape = loadCmdTape({ cmds: [{ frame: 0, byte: 0x03, cycleInFrame: 4 }] });
    tape.frameCycleBudgets.set(0, 4);

    const submits: Array<NonNullable<Parameters<typeof tickFrameWithTape>[3]> extends { onCommandSubmit?: (e: infer E) => void } ? E : never> = [];
    tickFrameWithTape(chip, tape, 0, {
      autoReleaseReset: true,
      commandPreemptChipWriteLookaheadCycles: 2,
      onCommandSubmit: (e) => submits.push(e),
    });

    expect(submits).toHaveLength(1);
    expect(submits[0]!.sourceIndex).toBe(0);
    expect(submits[0]!.cycle).toBe(4);
    expect(submits[0]!.actualCycle).toBe(4);
    expect(submits[0]!.preemptedChipWrite).toEqual({
      pc: 0x8000,
      opcode: 0x8e,
      address: 0x1801,
      stepStart: 0,
      stepEnd: 4,
      writeCycle: 3,
      targetDeltaFromWrite: 1,
    });
    expect(drainChipWriteEvents(chip)).toEqual([]);
  });

  it("does not preempt chip writes when lookahead is explicitly zero", () => {
    const roms = romsWithResetTo8000();
    roms.rom421[0] = 0x8e; // STX $1801, writes at cycle offset 3
    roms.rom421[1] = 0x01;
    roms.rom421[2] = 0x18;
    const chip = createSoundChip({ roms });
    const tape = loadCmdTape({ cmds: [{ frame: 0, byte: 0x03, cycleInFrame: 3 }] });
    tape.frameCycleBudgets.set(0, 3);

    const submits: Array<NonNullable<Parameters<typeof tickFrameWithTape>[3]> extends { onCommandSubmit?: (e: infer E) => void } ? E : never> = [];
    tickFrameWithTape(chip, tape, 0, {
      autoReleaseReset: true,
      commandPreemptChipWriteLookaheadCycles: 0,
      onCommandSubmit: (e) => submits.push(e),
    });

    expect(submits[0]!.preemptedChipWrite).toBeUndefined();
    expect(drainChipWriteEvents(chip).map((event) => ({
      pc: event.pc,
      cycle: event.cycle,
      reg: event.reg,
    }))).toEqual([{ pc: 0x8000, cycle: 3, reg: 0x00 }]);
  });

  it("can limit command preemption to targets before the chip write cycle", () => {
    const afterWriteRoms = romsWithResetTo8000();
    afterWriteRoms.rom421[0] = 0x8e; // STX $1801, write at cycle offset 3
    afterWriteRoms.rom421[1] = 0x01;
    afterWriteRoms.rom421[2] = 0x18;
    const afterWrite = createSoundChip({ roms: afterWriteRoms });
    const afterWriteTape = loadCmdTape({ cmds: [{ frame: 0, byte: 0x03, cycleInFrame: 4 }] });
    afterWriteTape.frameCycleBudgets.set(0, 4);
    const afterWriteSubmits: Array<NonNullable<Parameters<typeof tickFrameWithTape>[3]> extends { onCommandSubmit?: (e: infer E) => void } ? E : never> = [];

    tickFrameWithTape(afterWrite, afterWriteTape, 0, {
      autoReleaseReset: true,
      commandPreemptChipWriteBeforeOnly: true,
      onCommandSubmit: (e) => afterWriteSubmits.push(e),
    });

    expect(afterWriteSubmits[0]!.preemptedChipWrite).toBeUndefined();
    expect(drainChipWriteEvents(afterWrite).map((event) => ({
      pc: event.pc,
      cycle: event.cycle,
      reg: event.reg,
    }))).toEqual([{ pc: 0x8000, cycle: 3, reg: 0x00 }]);

    const beforeWriteRoms = romsWithResetTo8000();
    beforeWriteRoms.rom421[0] = 0x8e; // STX $1801, write at cycle offset 3
    beforeWriteRoms.rom421[1] = 0x01;
    beforeWriteRoms.rom421[2] = 0x18;
    const beforeWrite = createSoundChip({ roms: beforeWriteRoms });
    const beforeWriteTape = loadCmdTape({ cmds: [{ frame: 0, byte: 0x03, cycleInFrame: 2 }] });
    beforeWriteTape.frameCycleBudgets.set(0, 2);
    const beforeWriteSubmits: Array<NonNullable<Parameters<typeof tickFrameWithTape>[3]> extends { onCommandSubmit?: (e: infer E) => void } ? E : never> = [];

    tickFrameWithTape(beforeWrite, beforeWriteTape, 0, {
      autoReleaseReset: true,
      commandPreemptChipWriteBeforeOnly: true,
      onCommandSubmit: (e) => beforeWriteSubmits.push(e),
    });

    expect(beforeWriteSubmits[0]!.preemptedChipWrite?.targetDeltaFromWrite).toBe(-1);
    expect(drainChipWriteEvents(beforeWrite)).toEqual([]);
  });

  it("can expose sound-to-main pending status for a diagnostic ack delay", () => {
    const immediate = createSoundChip({ roms: fakeRoms() });
    immediate.cpu.cycles = 100;
    immediate.mmu.write8(0x1810 as never, as_u8(0x55));
    expect(immediate.mmu.read8(0x1820 as never) as number).toBe(0x87);

    const delayed = createSoundChip({ roms: fakeRoms(), mainReplyAckDelayCycles: 10 });
    delayed.cpu.cycles = 100;
    delayed.mmu.write8(0x1810 as never, as_u8(0x55));
    expect(delayed.pendingMainReplyAckCycle).toBe(110);

    delayed.cpu.cycles = 109;
    expect(delayed.mmu.read8(0x1820 as never) as number).toBe(0x97);
    expect(delayed.soundToMain.pending).toBe(true);

    delayed.cpu.cycles = 110;
    expect(delayed.mmu.read8(0x1820 as never) as number).toBe(0x87);
    expect(delayed.soundToMain.pending).toBe(false);
    expect(delayed.pendingMainReplyAckCycle).toBeUndefined();
  });

  it("can schedule sound-to-main ack from a diagnostic absolute cycle callback", () => {
    const scheduled = createSoundChip({
      roms: fakeRoms(),
      mainReplyAckCycle: (event) => event.cycle + 12,
    });
    scheduled.cpu.cycles = 100;
    scheduled.mmu.write8(0x1810 as never, as_u8(0xaa));
    expect(scheduled.pendingMainReplyAckCycle).toBe(112);

    scheduled.cpu.cycles = 111;
    expect(scheduled.mmu.read8(0x1820 as never) as number).toBe(0x97);
    expect(drainReplyEvents(scheduled)).toEqual([0xaa]);
    expect(scheduled.soundToMain.pending).toBe(true);

    scheduled.cpu.cycles = 112;
    expect(scheduled.mmu.read8(0x1820 as never) as number).toBe(0x87);
    expect(scheduled.soundToMain.pending).toBe(false);
  });

  it("can delay main-to-sound NMI assertion by instruction boundaries for diagnostics", () => {
    const delayed = createSoundChip({ roms: fakeRoms(), commandNmiDelayInstructions: 1 });
    delayed.inReset = false;

    submitCommand(delayed, as_u8(0x55));
    expect(delayed.mainToSound.pending).toBe(true);
    expect(delayed.pendingCommandNmiDelayInstructions).toBe(1);
    expect(delayed.cpu.nmi).toBe(false);

    servicePendingCommandNmi(delayed);
    expect(delayed.pendingCommandNmiDelayInstructions).toBe(0);
    expect(delayed.cpu.nmi).toBe(false);

    servicePendingCommandNmi(delayed);
    expect(delayed.pendingCommandNmiDelayInstructions).toBeUndefined();
    expect(delayed.cpu.nmi).toBe(true);
  });

  it("can delay command NMI service by sound cycles for diagnostics", () => {
    const delayed = createSoundChip({ roms: fakeRoms(), commandNmiServiceDelayCycles: 3 });
    delayed.inReset = false;
    delayed.cpu.cycles = 100;

    submitCommand(delayed, as_u8(0x55));
    expect(delayed.cpu.nmi).toBe(true);
    expect(delayed.pendingCommandNmiServiceDelayCycles).toBe(3);

    tickCycles(delayed, 1);
    expect(delayed.cpu.cycles).toBeGreaterThanOrEqual(110);
    expect(delayed.pendingCommandNmiServiceDelayCycles).toBeUndefined();
  });
});
