import { describe, expect, it } from "vitest";

import { parseStartLevelParam, playableSeedForStartLevel } from "../src/practice-level.js";

describe("practice level query", () => {
  it("maps supported practice levels to the real intro-banner start seeds", () => {
    expect(playableSeedForStartLevel(parseStartLevelParam("1"))).toBe("start_level1_intro_practice_f2479");
    expect(playableSeedForStartLevel(parseStartLevelParam("2"))).toBe("start_level2_intro_beginner_f2436");
    expect(playableSeedForStartLevel(parseStartLevelParam("3"))).toBe("start_level3_intro_intermediate_f2435");
    expect(playableSeedForStartLevel(parseStartLevelParam("4"))).toBe("start_level4_intro_aerial_f2414");
    expect(playableSeedForStartLevel(parseStartLevelParam("5"))).toBe("start_level5_intro_silly_f2472");
    expect(playableSeedForStartLevel(parseStartLevelParam("6"))).toBe("start_level6_intro_ultimate_f2429");
  });

  it("rejects unsupported levels", () => {
    expect(parseStartLevelParam(null)).toBeUndefined();
    expect(parseStartLevelParam("")).toBeUndefined();
    expect(parseStartLevelParam("0")).toBeUndefined();
    expect(parseStartLevelParam("7")).toBeUndefined();
    expect(parseStartLevelParam("2.5")).toBeUndefined();
    expect(parseStartLevelParam("abc")).toBeUndefined();
  });
});
