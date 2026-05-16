import { describe, expect, it } from "vitest";

import { parseStartLevelParam, playableSeedForStartLevel } from "../src/practice-level.js";

describe("practice level query", () => {
  it("maps only proven playable practice levels to playable seeds", () => {
    expect(playableSeedForStartLevel(parseStartLevelParam("1"))).toBe("candidate_level1_postseed_r_f2800");
    expect(playableSeedForStartLevel(parseStartLevelParam("2"))).toBe("candidate_level2_postseed_dr_f3000");
    expect(playableSeedForStartLevel(parseStartLevelParam("3"))).toBe("candidate_level3_postseed_ur_f3000");
    expect(playableSeedForStartLevel(parseStartLevelParam("4"))).toBe("candidate_level4_postseed_dr_f3000");
    expect(playableSeedForStartLevel(parseStartLevelParam("5"))).toBe("candidate_level5_postseed_dl_f2800");
    expect(playableSeedForStartLevel(parseStartLevelParam("6"))).toBe("candidate_level6_postseed_ul_f3600");
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
