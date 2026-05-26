export interface StereoResampleResult {
  readonly left: Float32Array;
  readonly right: Float32Array;
}

export function resampleLinear(
  src: readonly number[] | Float32Array,
  srcRate: number,
  dstRate: number,
  offsetSamples = 0,
): Float32Array {
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(src.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio + offsetSamples;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = src[idx] ?? 0;
    const s1 = src[idx + 1] ?? s0;
    out[i] = s0 * (1 - frac) + s1 * frac;
  }
  return out;
}

let mameLofiTable: { f0: Float32Array; f1: Float32Array } | undefined;

function mameLofiInterpolationTable(): { f0: Float32Array; f1: Float32Array } {
  if (mameLofiTable !== undefined) return mameLofiTable;
  const f0 = new Float32Array(0x1001);
  const f1 = new Float32Array(0x1001);
  for (let i = 1; i !== 4096; i++) {
    const p = i / 4096.0;
    f0[i] = (p - (p * p * p)) / 6;
  }
  for (let i = 1; i !== 2049; i++) {
    const p = i / 4096.0;
    f1[i] = p + ((p * p) - (p * p * p)) / 2;
  }
  for (let i = 2049; i !== 4096; i++) {
    f1[i] = 1.0 + (f0[i] ?? 0) + (f0[4096 - i] ?? 0) - (f1[4096 - i] ?? 0);
  }
  f0[0] = 0;
  f0[0x1000] = 0;
  f1[0] = 0;
  f1[0x1000] = 1;
  mameLofiTable = { f0, f1 };
  return mameLofiTable;
}

/** MAME's default LoFi audio_resampler, used by `-wavwrite` unless HQ is selected. */
export function resampleMameLofi(
  src: readonly number[] | Float32Array,
  srcRate: number,
  dstRate: number,
  outSamples?: number,
  offsetSamples = 0,
): Float32Array {
  const fs = Math.max(1, Math.trunc(srcRate));
  const ft = Math.max(1, Math.trunc(dstRate));
  const sourceDivide = fs <= ft ? 1 : 1 + Math.floor(fs / ft);
  const step = Math.floor((fs * 0x1000000) / ft / sourceDivide);
  const outLen = outSamples ?? Math.floor((src.length * ft) / fs);
  const out = new Float32Array(outLen);
  const { f0, f1 } = mameLofiInterpolationTable();

  let ssamp = Math.trunc(offsetSamples * 4096);
  let ssample = ssamp >> 12;
  let phase = ssamp & 0xfff;
  if (sourceDivide > 1) {
    const delta = ssample % sourceDivide;
    phase = Math.floor((phase | (delta << 12)) / sourceDivide);
    ssample -= delta;
  }

  ssample -= 4 * sourceDivide;
  let ptr = ssample;
  const read = (): number => {
    if (sourceDivide === 1) return src[ptr++] ?? 0;
    let sum = 0;
    for (let i = 0; i < sourceDivide; i++) sum += src[ptr++] ?? 0;
    return sum / sourceDivide;
  };

  phase <<= 12;
  let s0 = read();
  let s1 = read();
  let s2 = read();
  let s3 = read();
  for (let sample = 0; sample < out.length; sample++) {
    const cphase = phase >> 12;
    out[sample] = (-s0 * (f0[0x1000 - cphase] ?? 0)) +
      (s1 * (f1[0x1000 - cphase] ?? 0)) +
      (s2 * (f1[cphase] ?? 0)) -
      (s3 * (f0[cphase] ?? 0));

    phase += step;
    if ((phase & 0x1000000) !== 0) {
      phase &= 0xffffff;
      s0 = s1;
      s1 = s2;
      s2 = s3;
      s3 = read();
    }
  }
  return out;
}

export function resampleInterleavedStereo(
  samples: readonly number[] | Float32Array,
  srcRate: number,
  dstRate: number,
  offsetSamples = 0,
): StereoResampleResult {
  const ratio = srcRate / dstRate;
  const outSamples = Math.floor((samples.length / 2) / ratio);
  const left = new Float32Array(outSamples);
  const right = new Float32Array(outSamples);
  for (let i = 0; i < outSamples; i++) {
    const srcPos = i * ratio + offsetSamples;
    const srcFrame = Math.floor(srcPos);
    const frac = srcPos - srcFrame;
    const srcIdx = srcFrame * 2;
    const l0 = samples[srcIdx] ?? 0;
    const r0 = samples[srcIdx + 1] ?? 0;
    const l1 = samples[srcIdx + 2] ?? l0;
    const r1 = samples[srcIdx + 3] ?? r0;
    left[i] = l0 * (1 - frac) + l1 * frac;
    right[i] = r0 * (1 - frac) + r1 * frac;
  }
  return { left, right };
}

export function resampleMonoToStereo(
  samples: readonly number[] | Float32Array,
  srcRate: number,
  dstRate: number,
  offsetSamples = 0,
): StereoResampleResult {
  const left = resampleLinear(samples, srcRate, dstRate, offsetSamples);
  return { left, right: new Float32Array(left) };
}

export class StreamingLinearResampler {
  private readonly ratio: number;
  private readonly buffer: number[] = [];
  private baseIndex = 0;
  private totalReceived = 0;
  private outputCount = 0;

  constructor(
    srcRate: number,
    dstRate: number,
    private readonly offsetSamples = 0,
  ) {
    this.ratio = srcRate / dstRate;
  }

  push(samples: readonly number[] | Float32Array): Float32Array {
    for (const sample of samples) this.buffer.push(sample);
    this.totalReceived += samples.length;
    return this.drain(false);
  }

  finish(): Float32Array {
    return this.drain(true);
  }

  private drain(final: boolean): Float32Array {
    const targetOutputCount = Math.floor(this.totalReceived / this.ratio);
    const out: number[] = [];
    while (this.outputCount < targetOutputCount) {
      const srcPos = this.outputCount * this.ratio + this.offsetSamples;
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      if (!final && frac !== 0 && idx + 1 >= this.totalReceived) break;
      const s0 = this.sampleAt(idx, final);
      const s1 = this.sampleAt(idx + 1, final) ?? s0;
      if (s0 === undefined || s1 === undefined) break;
      out.push(s0 * (1 - frac) + s1 * frac);
      this.outputCount++;
    }
    this.dropConsumed();
    return Float32Array.from(out);
  }

  private sampleAt(index: number, final: boolean): number | undefined {
    if (index < 0) return 0;
    if (index >= this.totalReceived) return final ? 0 : undefined;
    return this.buffer[index - this.baseIndex];
  }

  private dropConsumed(): void {
    const nextSourcePosition = this.outputCount * this.ratio + this.offsetSamples;
    const keepFrom = Math.max(0, Math.floor(nextSourcePosition));
    const drop = Math.min(this.buffer.length, Math.max(0, keepFrom - this.baseIndex));
    if (drop <= 0) return;
    this.buffer.splice(0, drop);
    this.baseIndex += drop;
  }
}

export class StreamingMameLofiResampler {
  private readonly sourceDivide: number;
  private readonly step: number;
  private readonly buffer: number[] = [];
  private readonly targetRate: number;
  private baseIndex = 0;
  private totalReceived = 0;
  private outputCount = 0;
  private phase = 0;
  private ptr = 0;
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private initialized = false;
  private pendingRead = false;

  constructor(
    private readonly srcRate: number,
    dstRate: number,
    offsetSamples = 0,
  ) {
    const fs = Math.max(1, Math.trunc(srcRate));
    const ft = Math.max(1, Math.trunc(dstRate));
    this.targetRate = ft;
    this.sourceDivide = fs <= ft ? 1 : 1 + Math.floor(fs / ft);
    this.step = Math.floor((fs * 0x1000000) / ft / this.sourceDivide);
    let ssamp = Math.trunc(offsetSamples * 4096);
    let ssample = ssamp >> 12;
    let phase = ssamp & 0xfff;
    if (this.sourceDivide > 1) {
      const delta = ssample % this.sourceDivide;
      phase = Math.floor((phase | (delta << 12)) / this.sourceDivide);
      ssample -= delta;
    }
    ssample -= 4 * this.sourceDivide;
    this.ptr = ssample;
    this.phase = phase << 12;
  }

  push(samples: readonly number[] | Float32Array): Float32Array {
    for (const sample of samples) this.buffer.push(sample);
    this.totalReceived += samples.length;
    return this.drain(false);
  }

  finish(): Float32Array {
    return this.drain(true);
  }

  private drain(final: boolean): Float32Array {
    this.ensureInitialized(final);
    const targetOutputCount = Math.floor((this.totalReceived * this.targetRate) / Math.max(1, Math.trunc(this.srcRate)));
    const out: number[] = [];
    const { f0, f1 } = mameLofiInterpolationTable();
    while (this.initialized && this.outputCount < targetOutputCount) {
      if (this.pendingRead) {
        const next = this.readBlock(final);
        if (next === undefined) break;
        this.s3 = next;
        this.pendingRead = false;
      }
      const cphase = this.phase >> 12;
      out.push(
        (-this.s0 * (f0[0x1000 - cphase] ?? 0)) +
        (this.s1 * (f1[0x1000 - cphase] ?? 0)) +
        (this.s2 * (f1[cphase] ?? 0)) -
        (this.s3 * (f0[cphase] ?? 0)),
      );
      this.outputCount++;
      this.phase += this.step;
      if ((this.phase & 0x1000000) === 0) continue;
      this.phase &= 0xffffff;
      this.s0 = this.s1;
      this.s1 = this.s2;
      this.s2 = this.s3;
      const next = this.readBlock(final);
      if (next === undefined) {
        this.pendingRead = true;
        break;
      }
      this.s3 = next;
    }
    this.dropConsumed();
    return Float32Array.from(out);
  }

  private ensureInitialized(final: boolean): void {
    if (this.initialized) return;
    const s0 = this.readBlock(final);
    const s1 = this.readBlock(final);
    const s2 = this.readBlock(final);
    const s3 = this.readBlock(final);
    if (s0 === undefined || s1 === undefined || s2 === undefined || s3 === undefined) return;
    this.s0 = s0;
    this.s1 = s1;
    this.s2 = s2;
    this.s3 = s3;
    this.initialized = true;
  }

  private readBlock(final: boolean): number | undefined {
    let sum = 0;
    for (let i = 0; i < this.sourceDivide; i++) {
      const index = this.ptr++;
      const sample = this.sampleAt(index, final);
      if (sample === undefined) {
        this.ptr -= i + 1;
        return undefined;
      }
      sum += sample;
    }
    return sum / this.sourceDivide;
  }

  private sampleAt(index: number, final: boolean): number | undefined {
    if (index < 0) return 0;
    if (index >= this.totalReceived) return final ? 0 : undefined;
    return this.buffer[index - this.baseIndex];
  }

  private dropConsumed(): void {
    const keepFrom = Math.max(0, this.ptr - this.sourceDivide * 4);
    const drop = Math.min(this.buffer.length, Math.max(0, keepFrom - this.baseIndex));
    if (drop <= 0) return;
    this.buffer.splice(0, drop);
    this.baseIndex += drop;
  }
}
