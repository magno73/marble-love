import type { MainTickInputs } from "./main-tick.js";
import { as_u8, type u8 } from "./wrap.js";

export const INPUT_MMIO_TRACKBALL_X = 0xf20001 as const;
export const INPUT_MMIO_TRACKBALL_Y = 0xf20003 as const;
export const INPUT_MMIO_TRACKBALL2_X = 0xf20005 as const;
export const INPUT_MMIO_TRACKBALL2_Y = 0xf20007 as const;
export const INPUT_MMIO_SWITCHES = 0xf60001 as const;
export const INPUT_MMIO_ADC_BASE = 0xf40000 as const;
export const INPUT_MMIO_ADC_END = 0xf40020 as const;

export interface DemoInputFrame {
  frame: number;
  trackballX: number;
  trackballY: number;
  trackball2X: number;
  trackball2Y: number;
  switches: number;
  buttons: number;
  readCounts?: Record<string, number>;
}

export interface DemoInputTrace {
  schemaVersion: number;
  source: string;
  name: string;
  startFrame: number;
  endFrame: number;
  frameCount: number;
  frames: DemoInputFrame[];
}

export interface InputReplay {
  readonly trace: DemoInputTrace;
  frame(absoluteFrame: number): DemoInputFrame;
  read8(addr: number, absoluteFrame: number): u8;
  mainTickInputs(absoluteFrame: number): MainTickInputs;
}

function byte(v: number | undefined, fallback: number): u8 {
  return as_u8((v ?? fallback) & 0xff);
}

function normalizeAddress(addr: number): number {
  return addr >>> 0;
}

export function parseInputReplayTrace(jsonText: string): DemoInputTrace {
  const trace = JSON.parse(jsonText) as DemoInputTrace;
  if (trace.schemaVersion !== 1) {
    throw new Error(`unsupported input trace schema ${String(trace.schemaVersion)}`);
  }
  if (!Array.isArray(trace.frames) || trace.frames.length === 0) {
    throw new Error("input trace has no frames");
  }
  return trace;
}

export function createInputReplay(trace: DemoInputTrace): InputReplay {
  const byFrame = new Map<number, DemoInputFrame>();
  for (const f of trace.frames) byFrame.set(f.frame, f);

  const frame = (absoluteFrame: number): DemoInputFrame => {
    const hit = byFrame.get(absoluteFrame);
    if (hit === undefined) {
      throw new Error(
        `input trace ${trace.name} missing frame ${absoluteFrame} ` +
        `(range ${trace.startFrame}..${trace.endFrame})`,
      );
    }
    return hit;
  };

  const read8 = (addr: number, absoluteFrame: number): u8 => {
    const f = frame(absoluteFrame);
    switch (normalizeAddress(addr)) {
      case INPUT_MMIO_TRACKBALL_X:
        return byte(f.trackballX, 0xff);
      case INPUT_MMIO_TRACKBALL_Y:
        return byte(f.trackballY, 0xff);
      case INPUT_MMIO_TRACKBALL2_X:
        return byte(f.trackball2X, 0xff);
      case INPUT_MMIO_TRACKBALL2_Y:
        return byte(f.trackball2Y, 0xff);
      case INPUT_MMIO_SWITCHES:
        return byte(f.switches, 0x6f);
      case 0xf60000:
      case 0xf60002:
      case 0xf60003:
        return as_u8(0xff);
      default:
        if (addr >= INPUT_MMIO_ADC_BASE && addr < INPUT_MMIO_ADC_END) {
          return as_u8(0xff);
        }
        if (addr >= 0xf20000 && addr < 0xf20008) {
          return as_u8(0xff);
        }
        throw new Error(`input replay read outside captured MMIO: 0x${addr.toString(16)}`);
    }
  };

  return {
    trace,
    frame,
    read8,
    mainTickInputs(absoluteFrame: number): MainTickInputs {
      const f = frame(absoluteFrame);
      return {
        p1X: byte(f.trackballX, 0xff),
        p1Y: byte(f.trackballY, 0xff),
        p2X: byte(f.trackball2X, 0xff),
        p2Y: byte(f.trackball2Y, 0xff),
        inputMmio: byte(f.switches, 0x6f),
      };
    },
  };
}
