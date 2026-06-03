import { describe, expect, it } from "vitest";

import {
  normalizePublicFetchPath,
  optionalPublicFetchPath,
} from "../src/public-fetch-url.js";

const soundOptions = {
  allowedPrefixes: ["scenarios/sound/"],
  paramName: "soundReplay",
} as const;

describe("public fetch URL validation", () => {
  it("normalizes allowed same-origin public paths", () => {
    expect(normalizePublicFetchPath("scenarios/sound/cmd-tape-attract.json", soundOptions))
      .toBe("/scenarios/sound/cmd-tape-attract.json");
    expect(normalizePublicFetchPath("/scenarios/sound/cmd-tape-attract.json", soundOptions))
      .toBe("/scenarios/sound/cmd-tape-attract.json");
  });

  it("uses the fallback when an optional query parameter is absent", () => {
    expect(optionalPublicFetchPath(
      null,
      "scenarios/sound/cmd-tape-attract.json",
      soundOptions,
    )).toBe("/scenarios/sound/cmd-tape-attract.json");
  });

  it("rejects remote URLs and protocol-relative URLs", () => {
    expect(() => normalizePublicFetchPath("https://example.com/tape.json", soundOptions))
      .toThrow(/same-origin public path/);
    expect(() => normalizePublicFetchPath("//example.com/tape.json", soundOptions))
      .toThrow(/same-origin public path/);
    expect(() => normalizePublicFetchPath("javascript:alert(1)", soundOptions))
      .toThrow(/same-origin public path/);
  });

  it("rejects traversal and paths outside the allowlist", () => {
    expect(() => normalizePublicFetchPath("scenarios/sound/../private.json", soundOptions))
      .toThrow(/traversal/);
    expect(() => normalizePublicFetchPath("scenarios/sound/%2e%2e/private.json", soundOptions))
      .toThrow(/same-origin public path/);
    expect(() => normalizePublicFetchPath("scenarios/sound/tape.json?next=private", soundOptions))
      .toThrow(/same-origin public path/);
    expect(() => normalizePublicFetchPath("mame_state.json", soundOptions))
      .toThrow(/under one of/);
  });
});
