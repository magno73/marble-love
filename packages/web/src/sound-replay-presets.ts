export interface SoundReplayPreset {
  readonly name: string;
  readonly description: string;
  readonly values: Readonly<Record<string, string>>;
}

const YM_COMMAND_EDGE_RULES = [
  "0x1b:20000:24100:30:raw-before:0:25000:*:current-event",
  "0x03:-23:-23:-23:raw-after:64:0:0x8123",
  "0x03:-23:3:144:both:64:0:!0x8b80+0x8bb5",
  "0x07:-31:6:296:both:64:0",
  "0x10:-2:-2:138:both:64:0",
  "0x03:5:6:176:raw-before:0:4",
  "0x07:4:4:296:raw-before:0:4",
  "0x03:300:12000:-40:raw-before:0:12000:0x85f3:current-event",
  "0x03:8000:11200:-26:raw-before:0:12000:0x81bb:current-event",
  "0x03:13100:14000:5:raw-before:0:18000:0x8d5a:current-event",
  "0x03:16600:17500:5:raw-before:0:18000:0x80f5:current-event",
].join(";");

const YM_COMMAND_EDGE_EVENTZERO_RULES = [
  "0x1b:20000:24100:30:raw-before:0:25000:*:current-event",
  "0x03:-23:-23:-23:raw-after:64:0:0x8123",
  "0x03:-23:-21:4:raw-after:64:0:0x8123:command:0x81bb:0x14",
  "0x03:-23:3:144:both:64:0:!0x8b80+0x8bb5",
  "0x07:-31:6:296:both:64:0",
  "0x10:-2:-2:138:both:64:0",
  "0x03:5:6:176:raw-before:0:4",
  "0x07:4:4:296:raw-before:0:4",
  "0x03:300:12000:-40:raw-before:0:12000:0x85f3:current-event",
  "0x03:8000:11200:-26:raw-before:0:12000:0x81bb:current-event",
  "0x03:13100:14000:5:raw-before:0:18000:0x8d5a:current-event",
  "0x03:16600:17500:5:raw-before:0:18000:0x80f5:current-event",
  "0x03:300:14000:-42:raw-before:0:14000:0x83fc:current-event",
  "0x03:300:5000:-41:raw-before:0:5000:0x8403:current-event",
  "0x03:-14000:-10000:-42:raw-after:14000:0:0x8e84:current-event:0x8e9c+0x8eaf",
  "0x10:-5:-5:138:raw-after:64:0:0x8ff5:command",
  "0x03:1157:1157:-35:raw-before:0:1160:0x8120:current-event:0x8e9c:0x27",
  "0x03:2021:2021:-35:raw-before:0:2024:0x8120:current-event:0x8e9c:0x26",
  "0x03:5446:5446:-35:raw-before:0:5449:0x8120:current-event:0x8eaf:0x34",
].join(";");

const POKEY_COMMAND_EDGE_RULES = [
  "0x03:0:31:160:both:64:0",
  "0x03:-14:-2:160:raw-after:64:0:0x900f+0x8202+0xe59a",
  "0x03:29:31:160:raw-before:0:32",
  "0x07:7:19:296:both:64:0",
].join(";");

const POKEY_COMMAND_EDGE_EVENTZERO_RULES = [
  "0x03:-14:-2:0:raw-after:64:0:0xe59a:current-event:0x8e35:0x05:0x00",
  "0x03:0:31:0:both:64:0:0xe596:current-event:0x8e35:0x05:0x00",
  "0x07:0:31:296:both:64:0:0x8120:command:0x8e54+0x8e62",
  "0x07:0:31:296:raw-before:0:32:0x8120:command:0x8e54+0x8e62",
  "0x03:-14:-2:160:raw-after:64:0:0x8692:command:0x8e5b:0x00:0x79",
  "0x03:0:31:160:both:64:0",
  "0x03:-14:-2:160:raw-after:64:0:0x900f+0x8202+0xe59a",
  "0x03:29:31:160:raw-before:0:32",
  "0x07:7:19:296:both:64:0",
].join(";");

const COMMAND_NMI_DELAY_MATCHES = [
  "*:0x15:0:0",
  "*:0x19:0:0",
  "*:0x03:538:0",
  "*:0x03:623:0",
].join(",");

const INJECT001F_1701_COMMANDEDGE: SoundReplayPreset = {
  name: "inject001f-1701-commandedge",
  description: "Diagnostic command-edge timing pack for the current 1701-frame inject001f mixed oracle.",
  values: {
    soundReplayCommandNmiDelay: "1",
    soundReplayCmdTapeCommandTiming: "attos",
    soundReplayCommandNmiSampleCycle: "Infinity",
    soundReplayCommandNmiDelayMatches: COMMAND_NMI_DELAY_MATCHES,
    soundReplayRequireCommandContext: "1",
    soundReplayYmWriteEventCycleOffset: "30",
    soundReplayYmCommandEdgeEventRules: YM_COMMAND_EDGE_RULES,
    soundReplayYmScheduler: "mame-stream",
    soundReplayYmStreamAbsoluteOrigin: "1",
    soundReplayYmResampler: "mame-lofi",
    soundReplayPokeyResampler: "mame-lofi",
    soundReplayPokeyResampleOffset: "23.25",
    soundReplayPokeySampleCycles: "1",
    soundReplayPokeyOutputSampleOffset: "1",
    soundReplayPokeyCommandEdgeEventRules: POKEY_COMMAND_EDGE_RULES,
    soundReplayPokeyCommandEdgeRawCycleOffsetOpcodes: "0x91=23",
  },
};

const INJECT001F_1701_SOUNDCMDREADS_EVENTZERO: SoundReplayPreset = {
  name: "inject001f-1701-soundcmdreads-eventzero",
  description: "Same-run soundCmdReads event checkpoint: YM2151/POKEY write order is green, PCM remains diagnostic.",
  values: {
    ...INJECT001F_1701_COMMANDEDGE.values,
    soundReplayYmCommandEdgeEventRules: YM_COMMAND_EDGE_EVENTZERO_RULES,
    soundReplayPokeyCommandEdgeEventRules: POKEY_COMMAND_EDGE_EVENTZERO_RULES,
  },
};

const PRESETS: Readonly<Record<string, SoundReplayPreset>> = {
  [INJECT001F_1701_COMMANDEDGE.name]: INJECT001F_1701_COMMANDEDGE,
  [INJECT001F_1701_SOUNDCMDREADS_EVENTZERO.name]: INJECT001F_1701_SOUNDCMDREADS_EVENTZERO,
  current: INJECT001F_1701_COMMANDEDGE,
};

export function resolveSoundReplayPreset(params: URLSearchParams): SoundReplayPreset | undefined {
  const raw = params.get("soundReplayPreset");
  if (raw === null || raw.trim() === "") return undefined;
  const preset = PRESETS[raw.trim()];
  if (preset === undefined) {
    const available = Object.keys(PRESETS).sort().join(", ");
    throw new Error(`unknown soundReplayPreset ${raw}; expected one of: ${available}`);
  }
  return preset;
}

export function applySoundReplayPreset(params: URLSearchParams): {
  readonly params: URLSearchParams;
  readonly preset: SoundReplayPreset | undefined;
} {
  const preset = resolveSoundReplayPreset(params);
  if (preset === undefined) return { params, preset };
  const merged = new URLSearchParams(params);
  for (const [key, value] of Object.entries(preset.values)) {
    if (!merged.has(key)) merged.set(key, value);
  }
  return { params: merged, preset };
}
