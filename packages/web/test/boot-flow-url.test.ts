import { describe, expect, it } from "vitest";

import {
  BOOT_FLOW_CONFLICT_MESSAGE,
  bootFlowConflictMessage,
  shouldUseCoinStartFlow,
} from "../src/boot-flow-url.js";

const coinStartBase = {
  forceBootFlow: false,
  forceCoinStart: false,
  forcePlay: true,
  hasRom: true,
  playableSeedName: null,
  scenarioName: null,
  useMameDump: false,
  useMameLive: false,
  useStartLevelPractice: false,
  warmStateReady: false,
} as const;

describe("boot-flow URL routing", () => {
  it("keeps the existing play URL on the seed-backed coin/start flow", () => {
    expect(shouldUseCoinStartFlow(coinStartBase)).toBe(true);
  });

  it("does not prepare the seed-backed coin/start flow while bootFlow is active", () => {
    expect(shouldUseCoinStartFlow({ ...coinStartBase, forceBootFlow: true })).toBe(false);
  });

  it("keeps explicit seed and scenario modes out of bootFlow", () => {
    expect(bootFlowConflictMessage({
      explicitScenarioName: null,
      forceBootFlow: true,
      playableSeedName: "start_level1_intro_practice_f2479",
      startLevelPractice: undefined,
      useMameDump: false,
      useMameLive: false,
    })).toBe(BOOT_FLOW_CONFLICT_MESSAGE);

    expect(bootFlowConflictMessage({
      explicitScenarioName: null,
      forceBootFlow: true,
      playableSeedName: null,
      startLevelPractice: 1,
      useMameDump: false,
      useMameLive: false,
    })).toBe(BOOT_FLOW_CONFLICT_MESSAGE);

    expect(bootFlowConflictMessage({
      explicitScenarioName: "level1_spawn",
      forceBootFlow: true,
      playableSeedName: null,
      startLevelPractice: undefined,
      useMameDump: false,
      useMameLive: false,
    })).toBe(BOOT_FLOW_CONFLICT_MESSAGE);
  });

  it("allows pure bootFlow without seed or warm-state parameters", () => {
    expect(bootFlowConflictMessage({
      explicitScenarioName: null,
      forceBootFlow: true,
      playableSeedName: null,
      startLevelPractice: undefined,
      useMameDump: false,
      useMameLive: false,
    })).toBeUndefined();
  });
});
