import { describe, expect, it } from "vitest";
import {
  resampleInterleavedStereo,
  resampleLinear,
  resampleMameLofi,
  resampleMonoToStereo,
  StreamingLinearResampler,
  StreamingMameLofiResampler,
} from "../src/audio/resample.js";

describe("audio resampling", () => {
  it("preserves samples when source and destination rates match", () => {
    expect(Array.from(resampleLinear([0, 0.25, -0.5, 1], 48000, 48000))).toEqual([0, 0.25, -0.5, 1]);
  });

  it("supports fractional native-sample offsets", () => {
    expect(Array.from(resampleLinear([0, 10, 20], 48000, 48000, 0.5))).toEqual([5, 15, 20]);
  });

  it("resamples interleaved stereo channels independently", () => {
    const { left, right } = resampleInterleavedStereo([0, 10, 2, 12, 4, 14], 48000, 48000, 0.5);
    expect(Array.from(left)).toEqual([1, 3, 4]);
    expect(Array.from(right)).toEqual([11, 13, 14]);
  });

  it("duplicates mono resampling to stereo", () => {
    const { left, right } = resampleMonoToStereo([0.1, 0.2], 48000, 48000);
    expect(left[0]).toBeCloseTo(0.1, 6);
    expect(left[1]).toBeCloseTo(0.2, 6);
    expect(right[0]).toBeCloseTo(0.1, 6);
    expect(right[1]).toBeCloseTo(0.2, 6);
  });

  it("matches MAME LoFi resampler steady-state gain", () => {
    const out = resampleMameLofi(new Float32Array(64).fill(0.25), 55930, 48000, 32);
    expect(out.length).toBe(32);
    for (const sample of out.slice(8, 24)) expect(sample).toBeCloseTo(0.25, 6);
  });

  it("streams linear chunks to the same samples as whole-stream resampling", () => {
    const input = Array.from({ length: 97 }, (_, i) => Math.sin(i / 7) * 0.25);
    const expected = resampleLinear(input, 55930.375, 48000, 0.2);
    const streaming = new StreamingLinearResampler(55930.375, 48000, 0.2);
    const chunks = [
      streaming.push(input.slice(0, 11)),
      streaming.push(input.slice(11, 31)),
      streaming.push(input.slice(31, 64)),
      streaming.push(input.slice(64)),
      streaming.finish(),
    ];
    const actual = concatFloat32(chunks);

    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i]).toBeCloseTo(expected[i]!, 6);
    }
  });

  it("streams MAME LoFi chunks to the same samples as whole-stream resampling", () => {
    const input = Array.from({ length: 257 }, (_, i) => Math.cos(i / 13) * 0.5);
    const expected = resampleMameLofi(input, 55930, 48000);
    const streaming = new StreamingMameLofiResampler(55930, 48000);
    const chunks = [
      streaming.push(input.slice(0, 13)),
      streaming.push(input.slice(13, 57)),
      streaming.push(input.slice(57, 128)),
      streaming.push(input.slice(128)),
      streaming.finish(),
    ];
    const actual = concatFloat32(chunks);

    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i]).toBeCloseTo(expected[i]!, 6);
    }
  });

  it("streams MAME LoFi chunks with native-sample offsets", () => {
    const input = Array.from({ length: 257 }, (_, i) => Math.sin(i / 11) * 0.5);
    const expected = resampleMameLofi(input, 55930, 48000, undefined, 1.25);
    const streaming = new StreamingMameLofiResampler(55930, 48000, 1.25);
    const chunks = [
      streaming.push(input.slice(0, 19)),
      streaming.push(input.slice(19, 73)),
      streaming.push(input.slice(73, 151)),
      streaming.push(input.slice(151)),
      streaming.finish(),
    ];
    const actual = concatFloat32(chunks);

    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i]).toBeCloseTo(expected[i]!, 6);
    }
  });
});

function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
