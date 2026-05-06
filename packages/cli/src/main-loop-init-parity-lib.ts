import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const WORK_RAM_BASE = 0x00400000 as const;

export interface PatchableSub {
  name: string;
  entry: number;
  sentinel: number;
}

export function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    "ROM blob not found. Set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.",
  );
}

export function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
  rom[entry + 6] = 0x4e;
  rom[entry + 7] = 0x75;
}

export function patchReturnD0Byte(rom: Buffer, entry: number, value: number): void {
  rom[entry + 0] = 0x70;
  rom[entry + 1] = value & 0xff;
  rom[entry + 2] = 0x4e;
  rom[entry + 3] = 0x75;
}

export function patchStubAddqReturnD0Byte(
  rom: Buffer,
  entry: number,
  sentinelAddr: number,
  value: number,
): void {
  patchStubAddq(rom, entry, sentinelAddr);
  rom[entry + 6] = 0x70;
  rom[entry + 7] = value & 0xff;
  rom[entry + 8] = 0x4e;
  rom[entry + 9] = 0x75;
}

export function patchRts(rom: Buffer, entry: number): void {
  rom[entry + 0] = 0x4e;
  rom[entry + 1] = 0x75;
}

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

export function readRam(buf: Uint8Array, addr: number, size: 1 | 2 | 4): number {
  const off = addr - WORK_RAM_BASE;
  if (size === 1) return (buf[off] ?? 0) & 0xff;
  if (size === 2) return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

export function writeRam(buf: Uint8Array, addr: number, size: 1 | 2 | 4, value: number): void {
  const off = addr - WORK_RAM_BASE;
  if (size === 1) {
    buf[off] = value & 0xff;
    return;
  }
  if (size === 2) {
    buf[off] = (value >>> 8) & 0xff;
    buf[off + 1] = value & 0xff;
    return;
  }
  buf[off] = (value >>> 24) & 0xff;
  buf[off + 1] = (value >>> 16) & 0xff;
  buf[off + 2] = (value >>> 8) & 0xff;
  buf[off + 3] = value & 0xff;
}

export function incSentinel(buf: Uint8Array, sentinelAddr: number): void {
  const off = sentinelAddr - WORK_RAM_BASE;
  buf[off] = ((buf[off] ?? 0) + 1) & 0xff;
}
