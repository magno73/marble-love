import { describe, expect, it } from "vitest";

import {
  AUTO_LOAD_ROM_UNAVAILABLE_MESSAGE,
  AutoLoadRomUnavailableError,
  fetchAutoLoadRomZip,
  fetchAutoLoadRomZips,
} from "../src/auto-load-rom.js";

function response(bytes: Uint8Array, init?: ResponseInit): Response {
  return new Response(bytes, init);
}

function zipBytes(): Uint8Array {
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
}

describe("auto-load ROM ZIP fetch", () => {
  it("wraps a valid same-origin ZIP response as a File", async () => {
    const file = await fetchAutoLoadRomZip("marble.zip", async () =>
      response(zipBytes(), {
        headers: { "content-type": "application/zip" },
        status: 200,
      }),
    );

    expect(file.name).toBe("marble.zip");
    expect(file.type).toBe("application/zip");
    expect(file.size).toBe(6);
  });

  it("treats Vite HTML fallback as unavailable local ROMs", async () => {
    await expect(fetchAutoLoadRomZip("marble.zip", async () =>
      response(new TextEncoder().encode("<!doctype html>"), {
        headers: { "content-type": "text/html" },
        status: 200,
      }),
    )).rejects.toThrow(AutoLoadRomUnavailableError);

    await expect(fetchAutoLoadRomZip("marble.zip", async () =>
      response(new TextEncoder().encode("<!doctype html>"), {
        headers: { "content-type": "text/html" },
        status: 200,
      }),
    )).rejects.toThrow(AUTO_LOAD_ROM_UNAVAILABLE_MESSAGE);
  });

  it("fetches both expected ROM ZIP names", async () => {
    const seen: string[] = [];
    const files = await fetchAutoLoadRomZips(async (input) => {
      seen.push(String(input));
      return response(zipBytes(), { status: 200 });
    });

    expect(seen).toEqual(["/roms/marble.zip", "/roms/atarisy1.zip"]);
    expect(files.map((file) => file.name)).toEqual(["marble.zip", "atarisy1.zip"]);
  });
});

