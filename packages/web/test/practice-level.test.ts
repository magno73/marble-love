import { describe, expect, it } from "vitest";

import { parseStartLevelParam, playableSeedForStartLevel } from "../src/practice-level.js";

describe("practice level query", () => {
  it("maps only proven playable practice levels to playable seeds", () => {
    expect(playableSeedForStartLevel(parseStartLevelParam("1"))).toBe("manual_level1_start");
    expect(playableSeedForStartLevel(parseStartLevelParam("2"))).toBe("manual_level2_start");
    expect(playableSeedForStartLevel(parseStartLevelParam("3"))).toBeUndefined();
    expect(playableSeedForStartLevel(parseStartLevelParam("4"))).toBeUndefined();
    expect(playableSeedForStartLevel(parseStartLevelParam("5"))).toBeUndefined();
  });

  it("rejects unsupported levels", () => {
    expect(parseStartLevelParam(null)).toBeUndefined();
    expect(parseStartLevelParam("")).toBeUndefined();
    expect(parseStartLevelParam("0")).toBeUndefined();
    expect(parseStartLevelParam("6")).toBeUndefined();
    expect(parseStartLevelParam("2.5")).toBeUndefined();
    expect(parseStartLevelParam("abc")).toBeUndefined();
  });
});
