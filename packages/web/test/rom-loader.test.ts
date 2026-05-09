import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { extractRomZipArchives, extractRomZipBytes } from "../src/rom-loader.js";

const requiredNames = [
  "136032.205.l13",
  "136032.206.l12",
  "136033.623",
  "136033.624",
  "136033.625",
  "136033.626",
  "136033.627",
  "136033.628",
  "136033.229",
  "136033.630",
  "136033.107",
  "136033.108",
  "136033.421",
  "136033.422",
  "136032.104.f5",
  "136033.137",
  "136033.138",
  "136033.139",
  "136033.140",
  "136033.141",
  "136033.142",
  "136033.143",
  "136033.144",
  "136033.145",
  "136033.146",
  "136033.149",
  "136033.151",
  "136033.153",
  "136033.118",
  "136033.119",
  "136032.101.e3",
  "136032.102.e5",
  "136032.103.f7",
];

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function syntheticZip(overrides: Record<string, Uint8Array> = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {};

  for (const name of requiredNames) {
    entries[name] = bytes(0);
  }

  return zipSync({ ...entries, ...overrides });
}

describe("extractRomZipBytes", () => {
  it("reports missing required files clearly", () => {
    const zip = zipSync({
      "136032.205.l13": bytes(1),
    });

    expect(() => extractRomZipBytes(zip)).toThrow(
      /Missing required ROM files: .*136032\.206\.l12/,
    );
  });

  it("assembles raw regions from a synthetic zip", () => {
    const zip = syntheticZip({
      "136032.205.l13": bytes(0xaa, 0xbb),
      "136032.206.l12": bytes(0x11, 0x22),
      "136033.421": bytes(0x77),
      "136033.137": bytes(0x33),
      "136033.118": bytes(0x44),
      "136032.104.f5": bytes(0x55),
    });

    const rom = extractRomZipBytes(zip, { validateCrc32: false });

    expect(rom.program[0x00000]).toBe(0xaa);
    expect(rom.program[0x00002]).toBe(0xbb);
    expect(rom.program[0x00001]).toBe(0x11);
    expect(rom.program[0x00003]).toBe(0x22);
    expect(rom.sound[0x8000]).toBe(0x77);
    expect(rom.tiles[0x00000]).toBe(0xcc); // 0x33 ^ 0xff (ROMREGION_INVERT)
    expect(rom.sprites).toBe(rom.tiles);
    expect(rom.proms[0x000]).toBe(0x44);
    expect(rom.graphics.alpha[0]).toBe(0x55);
    expect(rom.graphics.decodedPalette.status).toBe("not-decoded");
    expect(rom.entries).toHaveLength(requiredNames.length);
    expect(rom.validation).toEqual({
      checkedCrc32: false,
      fileCount: requiredNames.length,
      warnings: expect.any(Array),
    });
  });

  it("can merge a split MAME set with parent BIOS entries", () => {
    const childEntries: Record<string, Uint8Array> = {};
    const parentEntries: Record<string, Uint8Array> = {};

    for (const name of requiredNames) {
      if (name.startsWith("136032.")) {
        parentEntries[name] = bytes(0);
      } else {
        childEntries[name] = bytes(0);
      }
    }

    parentEntries["136032.104.f5"] = bytes(0x5a);
    childEntries["136033.623"] = bytes(0xa5);

    const rom = extractRomZipArchives([zipSync(childEntries), zipSync(parentEntries)], {
      validateCrc32: false,
    });

    expect(rom.graphics.alpha[0]).toBe(0x5a);
    expect(rom.program[0x10000]).toBe(0xa5);
  });

  it("rejects CRC mismatches when validation is enabled", () => {
    const zip = syntheticZip();

    expect(() => extractRomZipBytes(zip)).toThrow(
      /ROM file 136032\.205\.l13 CRC32 mismatch/,
    );
  });

  it("hints at the parent BIOS archive for split MAME sets", () => {
    const childEntries: Record<string, Uint8Array> = {};

    for (const name of requiredNames) {
      if (!name.startsWith("136032.")) {
        childEntries[name] = bytes(0);
      }
    }

    expect(() =>
      extractRomZipArchives([zipSync(childEntries)], { validateCrc32: false }),
    ).toThrow(/atarisy1\.zip/);
  });
});
