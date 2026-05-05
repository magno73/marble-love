/**
 * rom-loader.ts — reads a user-supplied MAME-style `marble.zip` locally.
 *
 * The ROM never leaves the browser. This loader only unzips, validates expected
 * file names, and assembles raw byte regions documented in `docs/rom-layout.md`.
 * It does not decode graphics or persist derived assets.
 */

import { unzipSync } from "fflate";
import type { RomImage } from "@marble-love/engine";
import {
  decodeAlphaRom,
  type RawRomEntry,
  type RomGraphicsAssets,
} from "./rom-graphics.js";

export interface ExtractedRomImage extends RomImage {
  graphics: RomGraphicsAssets;
  entries: RawRomEntry[];
  validation: RomValidationSummary;
}

export interface RomValidationSummary {
  checkedCrc32: boolean;
  fileCount: number;
  warnings: string[];
}

export interface RomLoadOptions {
  validateCrc32?: boolean;
}

interface RegionFile {
  name: string;
  offset: number;
  length: number;
  crc32: number;
}

const PROGRAM_REGION_SIZE = 0x88000;
const SOUND_REGION_SIZE = 0x10000;
const TILE_REGION_SIZE = 0x100000;
const PROM_REGION_SIZE = 0x400;

const programFiles: RegionFile[] = [
  { name: "136032.205.l13", offset: 0x00000, length: 0x4000, crc32: 0x88d0be26 },
  { name: "136032.206.l12", offset: 0x00001, length: 0x4000, crc32: 0x3c79ef05 },
  { name: "136033.623", offset: 0x10000, length: 0x4000, crc32: 0x284ed2e9 },
  { name: "136033.624", offset: 0x10001, length: 0x4000, crc32: 0xd541b021 },
  { name: "136033.625", offset: 0x18000, length: 0x4000, crc32: 0x563755c7 },
  { name: "136033.626", offset: 0x18001, length: 0x4000, crc32: 0x860feeb3 },
  { name: "136033.627", offset: 0x20000, length: 0x4000, crc32: 0xd1dbd439 },
  { name: "136033.628", offset: 0x20001, length: 0x4000, crc32: 0x957d6801 },
  { name: "136033.229", offset: 0x28000, length: 0x4000, crc32: 0xc81d5c14 },
  { name: "136033.630", offset: 0x28001, length: 0x4000, crc32: 0x687a09f7 },
  { name: "136033.107", offset: 0x80000, length: 0x4000, crc32: 0xf3b8745b },
  { name: "136033.108", offset: 0x80001, length: 0x4000, crc32: 0xe51eecaa },
];

const soundFiles: RegionFile[] = [
  { name: "136033.421", offset: 0x8000, length: 0x4000, crc32: 0x78153dc3 },
  { name: "136033.422", offset: 0xc000, length: 0x4000, crc32: 0x2e66300e },
];

const tileFiles: RegionFile[] = [
  { name: "136033.137", offset: 0x00000, length: 0x4000, crc32: 0x7a45f5c1 },
  { name: "136033.138", offset: 0x04000, length: 0x4000, crc32: 0x7e954a88 },
  { name: "136033.139", offset: 0x10000, length: 0x4000, crc32: 0x1eb1bb5f },
  { name: "136033.140", offset: 0x14000, length: 0x4000, crc32: 0x8a82467b },
  { name: "136033.141", offset: 0x20000, length: 0x4000, crc32: 0x52448965 },
  { name: "136033.142", offset: 0x24000, length: 0x4000, crc32: 0xb4a70e4f },
  { name: "136033.143", offset: 0x30000, length: 0x4000, crc32: 0x7156e449 },
  { name: "136033.144", offset: 0x34000, length: 0x4000, crc32: 0x4c3e4c79 },
  { name: "136033.145", offset: 0x40000, length: 0x4000, crc32: 0x9062be7f },
  { name: "136033.146", offset: 0x44000, length: 0x4000, crc32: 0x14566dca },
  { name: "136033.149", offset: 0x84000, length: 0x4000, crc32: 0x0b6658f06 },
  { name: "136033.151", offset: 0x94000, length: 0x4000, crc32: 0x84ee1c80 },
  { name: "136033.153", offset: 0xa4000, length: 0x4000, crc32: 0xdaa02926 },
];

const alphaFile: RegionFile = {
  name: "136032.104.f5",
  offset: 0x0000,
  length: 0x2000,
  crc32: 0x7a29dc07,
};

const promFiles: RegionFile[] = [
  { name: "136033.118", offset: 0x000, length: 0x200, crc32: 0x2101b0ed },
  { name: "136033.119", offset: 0x200, length: 0x200, crc32: 0x19f6e767 },
];

const motherboardPromFiles: RegionFile[] = [
  { name: "136032.101.e3", offset: 0, length: 0x100, crc32: 0x7e84972a },
  { name: "136032.102.e5", offset: 0, length: 0x100, crc32: 0xebf1e0ae },
  { name: "136032.103.f7", offset: 0, length: 0xeb, crc32: 0x92d6a0b4 },
];

const requiredFiles = [
  ...programFiles,
  ...soundFiles,
  alphaFile,
  ...tileFiles,
  ...promFiles,
  ...motherboardPromFiles,
];

const parentSetFileNames = new Set([
  "136032.101.e3",
  "136032.102.e5",
  "136032.103.f7",
  "136032.104.f5",
  "136032.205.l13",
  "136032.206.l12",
]);

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hex32(value: number): string {
  return value.toString(16).padStart(8, "0");
}

function basename(path: string): string {
  return path.split("/").at(-1)?.toLowerCase() ?? path.toLowerCase();
}

function mergeZipEntries(zipBytesList: Uint8Array[]): Map<string, Uint8Array> {
  const normalized = new Map<string, Uint8Array>();

  for (const zipBytes of zipBytesList) {
    const entries = unzipSync(zipBytes);
    for (const [path, bytes] of Object.entries(entries)) {
      if (bytes.length > 0) {
        normalized.set(basename(path), bytes);
      }
    }
  }

  return normalized;
}

function requireEntry(entries: Map<string, Uint8Array>, name: string): Uint8Array {
  const bytes = entries.get(name.toLowerCase());
  if (bytes === undefined) {
    throw new Error(`Missing required ROM file: ${name}`);
  }
  return bytes;
}

function validateRequiredEntries(entries: Map<string, Uint8Array>): void {
  const missing = requiredFiles
    .map((file) => file.name)
    .filter((name) => !entries.has(name.toLowerCase()));

  if (missing.length > 0) {
    const missingParentFiles = missing.filter((name) => parentSetFileNames.has(name));
    const parentHint =
      missingParentFiles.length > 0
        ? " The standard split MAME set also needs atarisy1.zip selected alongside marble.zip."
        : "";
    throw new Error(`Missing required ROM files: ${missing.join(", ")}.${parentHint}`);
  }
}

function validateEntry(
  file: RegionFile,
  bytes: Uint8Array,
  options: Required<RomLoadOptions>,
): string[] {
  const warnings: string[] = [];
  const actualLength = bytes.length;

  if (actualLength !== file.length) {
    warnings.push(
      `ROM file ${file.name} has ${actualLength} bytes; expected ${file.length}`,
    );
  }

  if (options.validateCrc32) {
    const actualCrc = crc32(bytes);
    if (actualCrc !== file.crc32) {
      throw new Error(
        `ROM file ${file.name} CRC32 mismatch: expected ${hex32(file.crc32)}, got ${hex32(actualCrc)}`,
      );
    }
  }

  return warnings;
}

function copyLinear(region: Uint8Array, file: RegionFile, bytes: Uint8Array): void {
  region.set(bytes.subarray(0, file.length), file.offset);
}

function copyInterleaved(
  region: Uint8Array,
  file: RegionFile,
  bytes: Uint8Array,
): void {
  for (let i = 0; i < Math.min(bytes.length, file.length); i += 1) {
    const offset = file.offset + i * 2;
    if (offset < region.length) {
      region[offset] = bytes[i] ?? 0;
    }
  }
}

function assembleInterleavedRegion(
  entries: Map<string, Uint8Array>,
  files: RegionFile[],
  size: number,
): Uint8Array {
  const region = new Uint8Array(size);

  for (const file of files) {
    copyInterleaved(region, file, requireEntry(entries, file.name));
  }

  return region;
}

function assembleLinearRegion(
  entries: Map<string, Uint8Array>,
  files: RegionFile[],
  size: number,
): Uint8Array {
  const region = new Uint8Array(size);

  for (const file of files) {
    copyLinear(region, file, requireEntry(entries, file.name));
  }

  return region;
}

function rawEntry(entries: Map<string, Uint8Array>, file: RegionFile): RawRomEntry {
  const bytes = requireEntry(entries, file.name);
  return { name: file.name, bytes };
}

function buildGraphicsAssets(
  entries: Map<string, Uint8Array>,
  tiles: Uint8Array,
  proms: Uint8Array,
): RomGraphicsAssets {
  const alpha = requireEntry(entries, alphaFile.name);

  return {
    alpha,
    tiles,
    sprites: tiles,
    proms,
    motherboardProms: motherboardPromFiles.map((file) => rawEntry(entries, file)),
    decodedPalette: { status: "not-decoded", source: "proms" },
    decodedAlpha: decodeAlphaRom(alpha),
    decodedTiles: { status: "not-decoded", source: "tiles" },
    decodedSprites: { status: "not-decoded", source: "sprites" },
  };
}

function validateEntries(
  entries: Map<string, Uint8Array>,
  options: Required<RomLoadOptions>,
): RomValidationSummary {
  const warnings = requiredFiles.flatMap((file) =>
    validateEntry(file, requireEntry(entries, file.name), options),
  );

  return {
    checkedCrc32: options.validateCrc32,
    fileCount: requiredFiles.length,
    warnings,
  };
}

export function extractRomZipArchives(
  zipBytesList: Uint8Array[],
  options: RomLoadOptions = {},
): ExtractedRomImage {
  const resolvedOptions = {
    validateCrc32: options.validateCrc32 ?? true,
  };
  const entries = mergeZipEntries(zipBytesList);
  validateRequiredEntries(entries);
  const validation = validateEntries(entries, resolvedOptions);

  const program = assembleInterleavedRegion(entries, programFiles, PROGRAM_REGION_SIZE);
  const sound = assembleLinearRegion(entries, soundFiles, SOUND_REGION_SIZE);
  const tiles = assembleLinearRegion(entries, tileFiles, TILE_REGION_SIZE);
  const proms = assembleLinearRegion(entries, promFiles, PROM_REGION_SIZE);

  return {
    program,
    sound,
    tiles,
    sprites: tiles,
    proms,
    graphics: buildGraphicsAssets(entries, tiles, proms),
    entries: requiredFiles.map((file) => rawEntry(entries, file)),
    validation,
  };
}

export function extractRomZipBytes(
  zipBytes: Uint8Array,
  options?: RomLoadOptions,
): ExtractedRomImage {
  return extractRomZipArchives([zipBytes], options);
}

export async function extractRomZip(file: File): Promise<ExtractedRomImage> {
  console.log("rom file", file.name, file.size, "bytes");
  return extractRomZipBytes(new Uint8Array(await file.arrayBuffer()));
}

export async function extractRomZipFiles(
  files: Iterable<File>,
  options?: RomLoadOptions,
): Promise<ExtractedRomImage> {
  const zipBytesList: Uint8Array[] = [];

  for (const file of files) {
    console.log("rom file", file.name, file.size, "bytes");
    zipBytesList.push(new Uint8Array(await file.arrayBuffer()));
  }

  if (zipBytesList.length === 0) {
    throw new Error("No ROM ZIP files selected");
  }

  return extractRomZipArchives(zipBytesList, options);
}
