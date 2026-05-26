import { describe, expect, it } from "vitest";
import {
  hasFlagWithAudioBitperfectPreset,
  readArgWithAudioBitperfectPreset,
  resolveAudioBitperfectPreset,
} from "../src/audio-bitperfect-presets.js";

describe("audio bit-perfect CLI presets", () => {
  it("keeps current mapped to the runtime command-edge replay preset", () => {
    const preset = resolveAudioBitperfectPreset(["--audio-bitperfect-preset", "current"]);

    expect(preset?.name).toBe("inject001f-1701-commandedge");
    expect(readArgWithAudioBitperfectPreset([], preset, "--pokey-resample-offset")).toBe("23.25");
    expect(readArgWithAudioBitperfectPreset([], preset, "--pokey-write-cycle-offset")).toBeUndefined();
    expect(readArgWithAudioBitperfectPreset([], preset, "--max-lag")).toBe("0");
    expect(readArgWithAudioBitperfectPreset([], preset, "--max-abs-lag")).toBe("0");
    expect(readArgWithAudioBitperfectPreset([], preset, "--max-abs")).toBe("0.045");
    expect(readArgWithAudioBitperfectPreset([], preset, "--cmd-tape-command-timing")).toBe("attos");
    expect(readArgWithAudioBitperfectPreset([], preset, "--command-nmi-sample-cycle")).toBe("Infinity");
    expect(readArgWithAudioBitperfectPreset([], preset, "--command-nmi-delay-matches")).toBe(
      "*:0x15:0:0,*:0x19:0:0,*:0x03:538:0,*:0x03:623:0",
    );
    expect(readArgWithAudioBitperfectPreset([], preset, "--pokey-command-edge-raw-cycle-offset-opcodes")).toBe(
      "0x91=23",
    );
    expect(hasFlagWithAudioBitperfectPreset([], preset, "--ym-stream-absolute-origin")).toBe(true);
    expect(hasFlagWithAudioBitperfectPreset([], preset, "--require-command-context")).toBe(true);
    expect(hasFlagWithAudioBitperfectPreset([], preset, "--require-raw-bus-write-parity")).toBe(true);
    expect(readArgWithAudioBitperfectPreset([], preset, "--raw-bus-write-parity-mode")).toBe("offset");
    expect(readArgWithAudioBitperfectPreset([], preset, "--raw-bus-write-tolerance")).toBe("0");
    expect(readArgWithAudioBitperfectPreset([], preset, "--raw-bus-write-max-mismatches")).toBe("0");
    expect(hasFlagWithAudioBitperfectPreset([], preset, "--command-preempt-chip-write-complete-before-target")).toBe(
      false,
    );

    const ymRules = readArgWithAudioBitperfectPreset([], preset, "--ym-command-edge-event-rules") ?? "";
    const pokeyRules = readArgWithAudioBitperfectPreset([], preset, "--pokey-command-edge-event-rules") ?? "";
    expect(ymRules).toContain("0x1b:20000:24100:30:raw-before:0:25000:*:current-event");
    expect(ymRules).toContain("0x03:8000:11200:-26:raw-before:0:12000:0x81bb:current-event");
    expect(ymRules).toContain("0x03:-23:-21:4:raw-after:64:0:0x8123:command:0x81bb:0x14:0x11");
    expect(ymRules).toContain("0x03:407:407:-41:raw-before:0:410:0x8403:current-event:0x81bb:0x14:0x11");
    expect(ymRules).toContain("0x03:-13831:-13831:-42:raw-after:14000:0:0x8e84:current-event:0x8eaf:0x36:0x00");
    expect(pokeyRules).toContain("0x03:0:31:160:both:64:0");
  });

  it("resolves the direct MAME-chip POKEY tap gate separately from runtime replay", () => {
    const preset = resolveAudioBitperfectPreset([
      "--audio-bitperfect-preset",
      "inject001f-1701-direct-mamechip-pokeytap",
    ]);

    expect(preset?.name).toBe("inject001f-1701-direct-mamechip-pokeytap");
    expect(readArgWithAudioBitperfectPreset([], preset, "--pokey-write-cycle-offset")).toBe("-16");
    expect(readArgWithAudioBitperfectPreset([], preset, "--pokey-resample-offset")).toBe("22.50");
    expect(readArgWithAudioBitperfectPreset([], preset, "--min-correlation")).toBe("0.999");
    expect(readArgWithAudioBitperfectPreset([], preset, "--max-abs")).toBe("0.031");
    expect(hasFlagWithAudioBitperfectPreset([], preset, "--ym-stream-absolute-origin")).toBe(false);
    expect(hasFlagWithAudioBitperfectPreset([], preset, "--require-command-context")).toBe(false);
  });

  it("keeps the YM IRQ instruction-delay candidate separate from current", () => {
    const current = resolveAudioBitperfectPreset(["--audio-bitperfect-preset", "current"]);
    const candidate = resolveAudioBitperfectPreset([
      "--audio-bitperfect-preset",
      "inject001f-1701-yminstr1-commandedge",
    ]);

    expect(current?.name).toBe("inject001f-1701-commandedge");
    expect(candidate?.name).toBe("inject001f-1701-yminstr1-commandedge");
    expect(readArgWithAudioBitperfectPreset([], current, "--ym-irq-new-assertion-instruction-delay")).toBeUndefined();
    expect(readArgWithAudioBitperfectPreset([], candidate, "--ym-irq-new-assertion-instruction-delay")).toBe("1");
    expect(readArgWithAudioBitperfectPreset([], candidate, "--command-nmi-delay-matches")).toContain(
      "1500:0x03:624:0",
    );
    expect(hasFlagWithAudioBitperfectPreset([], candidate, "--require-raw-bus-write-parity")).toBe(true);

    const ymRules = readArgWithAudioBitperfectPreset([], candidate, "--ym-command-edge-event-rules") ?? "";
    const pokeyRules = readArgWithAudioBitperfectPreset([], candidate, "--pokey-command-edge-event-rules") ?? "";
    expect(ymRules).toContain("0x03:-14:-14:3:raw-after:64:0:0x8688+0x8885:command:0x8e9c:0x22+0x23");
    expect(ymRules).toContain("0x07:-23:-23:-4:raw-after:64:0:0x8138:command:0x8ec2:0x08:0x03");
    expect(ymRules).toContain("0x1b:20000:24100:30:raw-before:0:25000:*:current-event");
    expect(pokeyRules).toContain("0x07:21:21:296:both:64:0:0x8120:command:0x8e5b:0x00:0x79");
    expect(pokeyRules).toContain("0x03:-1:-1:154:raw-after:64:0:0x961a:command:0x8e54:0x08:0x78");
  });

  it("keeps the soundCmdReads event-zero checkpoint separate from current", () => {
    const current = resolveAudioBitperfectPreset(["--audio-bitperfect-preset", "current"]);
    const eventZero = resolveAudioBitperfectPreset([
      "--audio-bitperfect-preset",
      "inject001f-1701-soundcmdreads-eventzero",
    ]);

    expect(current?.name).toBe("inject001f-1701-commandedge");
    expect(eventZero?.name).toBe("inject001f-1701-soundcmdreads-eventzero");
    expect(readArgWithAudioBitperfectPreset([], eventZero, "--max-abs")).toBe("0.045");
    expect(hasFlagWithAudioBitperfectPreset([], eventZero, "--require-command-context")).toBe(true);

    const currentYmRules = readArgWithAudioBitperfectPreset([], current, "--ym-command-edge-event-rules") ?? "";
    const eventZeroYmRules = readArgWithAudioBitperfectPreset([], eventZero, "--ym-command-edge-event-rules") ?? "";
    expect(currentYmRules).toContain("0x03:-23:-21:4:raw-after:64:0:0x8123:command:0x81bb:0x14");
    expect(currentYmRules).not.toContain("0x03:300:5000:-41:raw-before:0:5000:0x8403:current-event");
    expect(eventZeroYmRules).toContain("0x03:-23:-21:4:raw-after:64:0:0x8123:command:0x81bb:0x14");
    expect(eventZeroYmRules).toContain("0x03:300:5000:-41:raw-before:0:5000:0x8403:current-event");
    expect(eventZeroYmRules).toContain("0x10:-5:-5:138:raw-after:64:0:0x8ff5:command");
    expect(eventZeroYmRules).toContain("0x03:5446:5446:-35:raw-before:0:5449:0x8120:current-event");
  });

  it("resolves replay-vs-direct MAME-chip comparison presets with calibrated reference timing", () => {
    const mix = resolveAudioBitperfectPreset([
      "--audio-bitperfect-preset",
      "inject001f-1701-replay-vs-direct-mamechip",
    ]);
    const ym = resolveAudioBitperfectPreset([
      "--audio-bitperfect-preset",
      "inject001f-1701-replay-vs-direct-mamechip-ym",
    ]);
    const pokey = resolveAudioBitperfectPreset([
      "--audio-bitperfect-preset",
      "inject001f-1701-replay-vs-direct-mamechip-pokey",
    ]);

    expect(readArgWithAudioBitperfectPreset([], mix, "--source")).toBe("mix");
    expect(readArgWithAudioBitperfectPreset([], mix, "--window-source")).toBe("mame");
    expect(readArgWithAudioBitperfectPreset([], mix, "--max-abs")).toBe("0.050");
    expect(readArgWithAudioBitperfectPreset([], mix, "--reference-pokey-resample-offset")).toBe("22.50");
    expect(readArgWithAudioBitperfectPreset([], mix, "--reference-pokey-write-cycle-offset")).toBe("-16");

    expect(readArgWithAudioBitperfectPreset([], ym, "--source")).toBe("ym");
    expect(readArgWithAudioBitperfectPreset([], ym, "--window-source")).toBe("ym");
    expect(readArgWithAudioBitperfectPreset([], ym, "--max-rms")).toBe("0.0045");
    expect(readArgWithAudioBitperfectPreset([], ym, "--reference-pokey-resample-offset")).toBeUndefined();

    expect(readArgWithAudioBitperfectPreset([], pokey, "--source")).toBe("pokey");
    expect(readArgWithAudioBitperfectPreset([], pokey, "--window-source")).toBe("pokey");
    expect(readArgWithAudioBitperfectPreset([], pokey, "--max-rms")).toBe("0.0055");
    expect(readArgWithAudioBitperfectPreset([], pokey, "--reference-pokey-resample-offset")).toBe("22.50");
    expect(readArgWithAudioBitperfectPreset([], pokey, "--reference-pokey-write-cycle-offset")).toBe("-16");
  });

  it("resolves the strict POKEY top-PC delta diagnostic preset", () => {
    const preset = resolveAudioBitperfectPreset([
      "--audio-bitperfect-preset",
      "inject001f-1701-pokey-strict-top-pc-delta",
    ]);

    expect(preset?.name).toBe("inject001f-1701-pokey-strict-top-pc-delta");
    expect(readArgWithAudioBitperfectPreset([], preset, "--kinds")).toBe("pokey");
    expect(readArgWithAudioBitperfectPreset([], preset, "--sample-tolerance")).toBe("0");
    expect(readArgWithAudioBitperfectPreset([], preset, "--max-mismatches")).toBe("999999");
    expect(readArgWithAudioBitperfectPreset([], preset, "--pc-delta-report-samples")).toBe("0");
    expect(hasFlagWithAudioBitperfectPreset([], preset, "--require-raw-bus-write-parity")).toBe(true);

    const pcs = readArgWithAudioBitperfectPreset([], preset, "--pc-delta-report-pcs") ?? "";
    expect(pcs).toContain("0x8e54");
    expect(pcs).toContain("0x8e2f");
    expect(pcs).toContain("0x8e5b");
  });

  it("resolves the strict YM2151 top-PC delta diagnostic preset", () => {
    const preset = resolveAudioBitperfectPreset([
      "--audio-bitperfect-preset",
      "inject001f-1701-ym-strict-top-pc-delta",
    ]);

    expect(preset?.name).toBe("inject001f-1701-ym-strict-top-pc-delta");
    expect(readArgWithAudioBitperfectPreset([], preset, "--kinds")).toBe("ym2151");
    expect(readArgWithAudioBitperfectPreset([], preset, "--sample-tolerance")).toBe("0");
    expect(readArgWithAudioBitperfectPreset([], preset, "--max-mismatches")).toBe("999999");
    expect(readArgWithAudioBitperfectPreset([], preset, "--pc-delta-report-samples")).toBe("0");
    expect(readArgWithAudioBitperfectPreset([], preset, "--pc-delta-offset-sweep")).toBe("-16:16:1");
    expect(hasFlagWithAudioBitperfectPreset([], preset, "--require-raw-bus-write-parity")).toBe(true);

    const pcs = readArgWithAudioBitperfectPreset([], preset, "--pc-delta-report-pcs") ?? "";
    expect(pcs).toContain("0x8eaf");
    expect(pcs).toContain("0x8e9c");
    expect(pcs).toContain("0x81bb");
  });

  it("resolves the diagnostic POKEY effective-apply boundary preset", () => {
    const preset = resolveAudioBitperfectPreset([
      "--audio-bitperfect-preset",
      "inject001f-1701-pokey-strict-effective-apply-boundary7",
    ]);

    expect(preset?.name).toBe("inject001f-1701-pokey-strict-effective-apply-boundary7");
    expect(readArgWithAudioBitperfectPreset([], preset, "--kinds")).toBe("pokey");
    expect(readArgWithAudioBitperfectPreset([], preset, "--sample-tolerance")).toBe("0");
    expect(readArgWithAudioBitperfectPreset([], preset, "--max-mismatches")).toBe("999999");
    expect(readArgWithAudioBitperfectPreset([], preset, "--pokey-write-apply-boundary-delay-cycles")).toBe("7");
    expect(hasFlagWithAudioBitperfectPreset([], preset, "--pokey-effective-apply-timing")).toBe(true);
    expect(hasFlagWithAudioBitperfectPreset([], preset, "--require-raw-bus-write-parity")).toBe(true);
  });

  it("lets explicit args override preset values", () => {
    const preset = resolveAudioBitperfectPreset([
      "--audio-bitperfect-preset",
      "inject001f-1701-direct-mamechip-pokeytap",
    ]);

    expect(readArgWithAudioBitperfectPreset(
      ["--pokey-resample-offset", "23.25"],
      preset,
      "--pokey-resample-offset",
    )).toBe("23.25");
    expect(hasFlagWithAudioBitperfectPreset(["--require-command-context"], preset, "--require-command-context")).toBe(
      true,
    );
  });

  it("rejects unknown preset names with available alternatives", () => {
    expect(() => resolveAudioBitperfectPreset(["--audio-bitperfect-preset", "missing"])).toThrow(
      /expected one of: .*current.*inject001f-1701-commandedge.*inject001f-1701-direct-mamechip-pokeytap.*inject001f-1701-pokey-strict-effective-apply-boundary7.*inject001f-1701-pokey-strict-top-pc-delta.*inject001f-1701-replay-vs-direct-mamechip.*inject001f-1701-replay-vs-direct-mamechip-pokey.*inject001f-1701-replay-vs-direct-mamechip-ym.*inject001f-1701-soundcmdreads-eventzero.*inject001f-1701-ym-strict-top-pc-delta.*inject001f-1701-yminstr1-commandedge/,
    );
  });
});
