export interface AudioBitperfectPreset {
  readonly name: string;
  readonly description: string;
  readonly values: Readonly<Record<string, string | boolean>>;
}

const YM_COMMAND_EDGE_RULE_LIST = [
  "0x1b:20000:24100:30:raw-before:0:25000:*:current-event",
  "0x03:-23:-23:-23:raw-after:64:0:0x8123",
  "0x03:-23:-21:4:raw-after:64:0:0x8123:command:0x81bb:0x14:0x11",
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
  "0x10:-5:-5:138:raw-after:64:0:0x8ff5:command:0x8e9c:0x20:0xfc",
  "0x03:1157:1157:-35:raw-before:0:1160:0x8120:current-event:0x8e9c:0x27:0xfa",
  "0x03:2021:2021:-35:raw-before:0:2024:0x8120:current-event:0x8e9c:0x26:0x9c",
  "0x03:5446:5446:-35:raw-before:0:5449:0x8120:current-event:0x8eaf:0x34:0x00",
  "0x03:407:407:-41:raw-before:0:410:0x8403:current-event:0x81bb:0x14:0x11",
  "0x03:3030:3030:-41:raw-before:0:3033:0x8403:current-event:0x8e9c:0x24:0xfe",
  "0x03:3637:3637:-41:raw-before:0:3640:0x8403:current-event:0x8eaf:0x33:0x00",
  "0x03:4186:4186:-41:raw-before:0:4189:0x8403:current-event:0x8eaf:0x32:0x00",
  "0x03:-13831:-13831:-42:raw-after:14000:0:0x8e84:current-event:0x8eaf:0x36:0x00",
  "0x03:-11656:-11656:-42:raw-after:14000:0:0x8e84:current-event:0x8e9c:0x22:0xe0",
  "0x03:-10539:-10539:-42:raw-after:14000:0:0x8e84:current-event:0x8e9c:0x20:0xfa",
] as const;

const YM_COMMAND_EDGE_EVENTZERO_RULE_LIST = [
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
] as const;

const YM_COMMAND_EDGE_RULES = YM_COMMAND_EDGE_RULE_LIST.join(";");
const YM_COMMAND_EDGE_EVENTZERO_RULES = YM_COMMAND_EDGE_EVENTZERO_RULE_LIST.join(";");

const YM_IRQ_INSTRUCTION_DELAY_RULES = [
  "0x03:-14:-14:3:raw-after:64:0:0x8688+0x8885:command:0x8e9c:0x22+0x23",
  "0x03:-23:-23:4:raw-after:64:0:0x8e8c:command:0x8eaf:0x34:0x00",
  "0x03:-19:-19:4:raw-after:64:0:0x8123:command:0x81bb:0x14:0x11",
  "0x07:-23:-23:-4:raw-after:64:0:0x8138:command:0x8ec2:0x08:0x03",
  ...YM_COMMAND_EDGE_RULE_LIST,
].join(";");

const POKEY_COMMAND_EDGE_RULES = [
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

const POKEY_IRQ_INSTRUCTION_DELAY_RULES = [
  "0x07:21:21:296:both:64:0:0x8120:command:0x8e5b:0x00:0x79",
  "0x03:-1:-1:154:raw-after:64:0:0x961a:command:0x8e54:0x08:0x78",
  POKEY_COMMAND_EDGE_RULES,
].join(";");

const COMMAND_NMI_DELAY_MATCHES = [
  "*:0x15:0:0",
  "*:0x19:0:0",
  "*:0x03:538:0",
  "*:0x03:623:0",
].join(",");

const COMMAND_NMI_DELAY_MATCHES_FRAME1500 = [
  COMMAND_NMI_DELAY_MATCHES,
  "1500:0x03:624:0",
].join(",");

const INJECT001F_1701_COMMANDEDGE: AudioBitperfectPreset = {
  name: "inject001f-1701-commandedge",
  description: "Diagnostic command-edge timing pack for the current 1701-frame inject001f mixed oracle.",
  values: {
    "--frames": "1701",
    "--frame-tolerance": "1",
    "--cycle-tolerance": "999999",
    "--sample-rate": "55930",
    "--sample-tolerance": "1",
    "--source": "mix",
    "--window-source": "mame",
    "--cmd-tape-command-timing": "attos",
    "--window-size": "8192",
    "--window-hop": "4096",
    "--max-windows": "300",
    "--max-lag": "0",
    "--max-abs-lag": "0",
    "--audible-threshold": "0.001",
    "--min-correlation": "0.995",
    "--max-rms": "0.006",
    "--max-abs": "0.045",
    "--lag-tie-correlation-epsilon": "0.00003",
    "--require-command-context": true,
    "--require-raw-bus-write-parity": true,
    "--raw-bus-write-parity-mode": "offset",
    "--raw-bus-write-tolerance": "0",
    "--raw-bus-write-max-mismatches": "0",
    "--command-nmi-delay-instructions": "1",
    "--command-nmi-sample-cycle": "Infinity",
    "--command-nmi-delay-matches": COMMAND_NMI_DELAY_MATCHES,
    "--ym-write-event-cycle-offset": "30",
    "--ym-command-edge-event-rules": YM_COMMAND_EDGE_RULES,
    "--ym-scheduler": "mame-stream",
    "--ym-stream-absolute-origin": true,
    "--ym-resampler": "mame-lofi",
    "--pokey-resampler": "mame-lofi",
    "--pokey-resample-offset": "23.25",
    "--pokey-sample-cycles": "1",
    "--pokey-output-sample-offset": "1",
    "--pokey-command-edge-event-rules": POKEY_COMMAND_EDGE_RULES,
    "--pokey-command-edge-raw-cycle-offset-opcodes": "0x91=23",
    "--ts-event-cycle-adjust-opcodes": "0x91=23",
  },
};

const INJECT001F_1701_YMIRQ_INSTRUCTION_DELAY: AudioBitperfectPreset = {
  name: "inject001f-1701-yminstr1-commandedge",
  description:
    "Diagnostic YM IRQ assertion sampling candidate that aligns the frame 1500 IRQ boundary while preserving the 1701-frame +-1 write gate.",
  values: {
    ...INJECT001F_1701_COMMANDEDGE.values,
    "--command-nmi-delay-matches": COMMAND_NMI_DELAY_MATCHES_FRAME1500,
    "--ym-irq-new-assertion-instruction-delay": "1",
    "--ym-command-edge-event-rules": YM_IRQ_INSTRUCTION_DELAY_RULES,
    "--pokey-command-edge-event-rules": POKEY_IRQ_INSTRUCTION_DELAY_RULES,
  },
};

const INJECT001F_1701_DIRECT_MAMECHIP_POKEYTAP: AudioBitperfectPreset = {
  name: "inject001f-1701-direct-mamechip-pokeytap",
  description: "Direct MAME-chip render gate for the 1701-frame inject001f mixed oracle with the measured POKEY tap offset.",
  values: {
    "--frames": "1701",
    "--source": "mix",
    "--window-source": "mame",
    "--window-size": "8192",
    "--window-hop": "4096",
    "--max-windows": "300",
    "--max-lag": "2",
    "--max-abs-lag": "2",
    "--audible-threshold": "0.001",
    "--min-correlation": "0.999",
    "--max-rms": "0.0045",
    "--max-abs": "0.031",
    "--ym-scheduler": "mame-stream",
    "--ym-resampler": "mame-lofi",
    "--pokey-resampler": "mame-lofi",
    "--pokey-resample-offset": "22.50",
    "--pokey-sample-cycles": "1",
    "--pokey-output-sample-offset": "1",
    "--pokey-write-cycle-offset": "-16",
  },
};

const INJECT001F_1701_SOUNDCMDREADS_EVENTZERO: AudioBitperfectPreset = {
  name: "inject001f-1701-soundcmdreads-eventzero",
  description: "Same-run soundCmdReads event checkpoint: YM2151/POKEY write order is green, PCM remains diagnostic.",
  values: {
    ...INJECT001F_1701_COMMANDEDGE.values,
    "--ym-command-edge-event-rules": YM_COMMAND_EDGE_EVENTZERO_RULES,
  },
};

const INJECT001F_1701_REPLAY_VS_DIRECT_MAMECHIP: AudioBitperfectPreset = {
  name: "inject001f-1701-replay-vs-direct-mamechip",
  description: "SoundChip replay vs calibrated direct MAME-chip render checkpoint for the current same-run oracle.",
  values: {
    ...INJECT001F_1701_COMMANDEDGE.values,
    "--source": "mix",
    "--window-source": "mame",
    "--min-correlation": "0.995",
    "--max-rms": "0.0055",
    "--max-abs": "0.050",
    "--reference-pokey-resample-offset": "22.50",
    "--reference-pokey-write-cycle-offset": "-16",
  },
};

const INJECT001F_1701_REPLAY_VS_DIRECT_MAMECHIP_YM: AudioBitperfectPreset = {
  name: "inject001f-1701-replay-vs-direct-mamechip-ym",
  description: "YM-only SoundChip replay vs direct MAME-chip render checkpoint for the current same-run oracle.",
  values: {
    ...INJECT001F_1701_COMMANDEDGE.values,
    "--source": "ym",
    "--window-source": "ym",
    "--min-correlation": "0.995",
    "--max-rms": "0.0045",
    "--max-abs": "0.040",
  },
};

const INJECT001F_1701_REPLAY_VS_DIRECT_MAMECHIP_POKEY: AudioBitperfectPreset = {
  name: "inject001f-1701-replay-vs-direct-mamechip-pokey",
  description: "POKEY-only SoundChip replay vs calibrated direct MAME-chip render checkpoint for the current same-run oracle.",
  values: {
    ...INJECT001F_1701_COMMANDEDGE.values,
    "--source": "pokey",
    "--window-source": "pokey",
    "--min-correlation": "0.995",
    "--max-rms": "0.0055",
    "--max-abs": "0.050",
    "--reference-pokey-resample-offset": "22.50",
    "--reference-pokey-write-cycle-offset": "-16",
  },
};

const YM_STRICT_TOP_PC_DELTA_PCS = [
  "0x8eaf",
  "0x8e9c",
  "0x81bb",
  "0x81c3",
  "0x8fac",
  "0x93c6",
].join(",");

const INJECT001F_1701_YM_STRICT_TOP_PC_DELTA: AudioBitperfectPreset = {
  name: "inject001f-1701-ym-strict-top-pc-delta",
  description:
    "Strict native-sample YM2151 top-PC timing diagnostic for the current same-run oracle; reports instead of gating.",
  values: {
    ...INJECT001F_1701_COMMANDEDGE.values,
    "--kinds": "ym2151",
    "--sample-tolerance": "0",
    "--max-mismatches": "999999",
    "--pc-delta-report-pcs": YM_STRICT_TOP_PC_DELTA_PCS,
    "--pc-delta-report-samples": "0",
    "--pc-delta-offset-sweep": "-16:16:1",
  },
};

const POKEY_STRICT_TOP_PC_DELTA_PCS = [
  "0x8e54",
  "0x8e2f",
  "0x8e68",
  "0x8e3c",
  "0x8e62",
  "0x8e35",
  "0x8e28",
  "0x8e6f",
  "0x8e5b",
].join(",");

const INJECT001F_1701_POKEY_STRICT_TOP_PC_DELTA: AudioBitperfectPreset = {
  name: "inject001f-1701-pokey-strict-top-pc-delta",
  description: "Strict native-sample POKEY top-PC timing diagnostic for the current same-run oracle; reports instead of gating.",
  values: {
    ...INJECT001F_1701_COMMANDEDGE.values,
    "--kinds": "pokey",
    "--sample-tolerance": "0",
    "--max-mismatches": "999999",
    "--pc-delta-report-pcs": POKEY_STRICT_TOP_PC_DELTA_PCS,
    "--pc-delta-report-samples": "0",
  },
};

const INJECT001F_1701_POKEY_STRICT_EFFECTIVE_APPLY_BOUNDARY7: AudioBitperfectPreset = {
  name: "inject001f-1701-pokey-strict-effective-apply-boundary7",
  description: "Diagnostic-only POKEY effective-apply timing report with boundary delay 7; not a promoted PCM fix.",
  values: {
    ...INJECT001F_1701_POKEY_STRICT_TOP_PC_DELTA.values,
    "--pokey-effective-apply-timing": true,
    "--pokey-write-apply-boundary-delay-cycles": "7",
  },
};

const INJECT001F_1701_POKEY_BOUNDARY_GUARD_SWEEP: AudioBitperfectPreset = {
  name: "inject001f-1701-pokey-boundary-guard-sweep",
  description:
    "Post-diff POKEY boundary guard sweep for separating blind near-sample delay from directional scheduler timing.",
  values: {
    ...INJECT001F_1701_POKEY_STRICT_TOP_PC_DELTA.values,
    "--pc-delta-report-samples": "0",
    "--pokey-boundary-guard-sweep-cycles": "1:32:1",
    "--pokey-boundary-candidate-report-cycles": "29",
    "--pokey-stream-cursor-report": true,
    "--pokey-lofi-cursor-report": true,
  },
};

const PRESETS: Record<string, AudioBitperfectPreset> = {
  [INJECT001F_1701_COMMANDEDGE.name]: INJECT001F_1701_COMMANDEDGE,
  [INJECT001F_1701_YMIRQ_INSTRUCTION_DELAY.name]: INJECT001F_1701_YMIRQ_INSTRUCTION_DELAY,
  [INJECT001F_1701_DIRECT_MAMECHIP_POKEYTAP.name]: INJECT001F_1701_DIRECT_MAMECHIP_POKEYTAP,
  [INJECT001F_1701_SOUNDCMDREADS_EVENTZERO.name]: INJECT001F_1701_SOUNDCMDREADS_EVENTZERO,
  [INJECT001F_1701_REPLAY_VS_DIRECT_MAMECHIP.name]: INJECT001F_1701_REPLAY_VS_DIRECT_MAMECHIP,
  [INJECT001F_1701_REPLAY_VS_DIRECT_MAMECHIP_YM.name]: INJECT001F_1701_REPLAY_VS_DIRECT_MAMECHIP_YM,
  [INJECT001F_1701_REPLAY_VS_DIRECT_MAMECHIP_POKEY.name]: INJECT001F_1701_REPLAY_VS_DIRECT_MAMECHIP_POKEY,
  [INJECT001F_1701_YM_STRICT_TOP_PC_DELTA.name]: INJECT001F_1701_YM_STRICT_TOP_PC_DELTA,
  [INJECT001F_1701_POKEY_STRICT_TOP_PC_DELTA.name]: INJECT001F_1701_POKEY_STRICT_TOP_PC_DELTA,
  [INJECT001F_1701_POKEY_STRICT_EFFECTIVE_APPLY_BOUNDARY7.name]:
    INJECT001F_1701_POKEY_STRICT_EFFECTIVE_APPLY_BOUNDARY7,
  [INJECT001F_1701_POKEY_BOUNDARY_GUARD_SWEEP.name]: INJECT001F_1701_POKEY_BOUNDARY_GUARD_SWEEP,
  current: INJECT001F_1701_COMMANDEDGE,
};

function cliArgValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

export function resolveAudioBitperfectPreset(args: readonly string[]): AudioBitperfectPreset | undefined {
  const raw = cliArgValue(args, "--audio-bitperfect-preset");
  if (raw === undefined || raw.trim() === "") return undefined;
  const preset = PRESETS[raw.trim()];
  if (preset === undefined) {
    const available = Object.keys(PRESETS).sort().join(", ");
    throw new Error(`unknown --audio-bitperfect-preset ${raw}; expected one of: ${available}`);
  }
  return preset;
}

export function readArgWithAudioBitperfectPreset(
  args: readonly string[],
  preset: AudioBitperfectPreset | undefined,
  name: string,
): string | undefined {
  const explicit = cliArgValue(args, name);
  if (explicit !== undefined) return explicit;
  const value = preset?.values[name];
  return typeof value === "string" ? value : undefined;
}

export function hasFlagWithAudioBitperfectPreset(
  args: readonly string[],
  preset: AudioBitperfectPreset | undefined,
  name: string,
): boolean {
  if (args.includes(name)) return true;
  return preset?.values[name] === true;
}
