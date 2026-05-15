import { describe, expect, it } from "vitest";

import { parseStartLevelParam, scenarioForStartLevel } from "../src/practice-level.js";

describe("practice level query", () => {
  it("maps supported levels to gameplay scenarios", () => {
    expect(scenarioForStartLevel(parseStartLevelParam("1"))).toBe("level1_spawn");
    expect(scenarioForStartLevel(parseStartLevelParam("2"))).toBe("level2_spawn");
    expect(scenarioForStartLevel(parseStartLevelParam("3"))).toBe("level3_spawn");
    expect(scenarioForStartLevel(parseStartLevelParam("4"))).toBe("level4_spawn");
    expect(scenarioForStartLevel(parseStartLevelParam("5"))).toBe("level5_spawn");
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
