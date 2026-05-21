import { describe, expect, it } from "vitest";

import {
  BOOT_FLOW_CONFLICT_MESSAGE,
  bootFlowConflictMessage,
  shouldUseBootFlow,
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

const bootFlowBase = {
  explicitScenarioName: null,
  forceBootFlow: false,
  forcePlay: true,
  playableSeedName: null,
  useMameDump: false,
  useMameLive: false,
  useStartLevelPractice: false,
} as const;

describe("boot-flow URL routing", () => {
  it("routes the default play URL to the cold boot flow instead of seed-backed coin/start", () => {
    const useBootFlow = shouldUseBootFlow(bootFlowBase);

    expect(useBootFlow).toBe(true);
    expect(shouldUseCoinStartFlow({ ...coinStartBase, forceBootFlow: useBootFlow })).toBe(false);
  });

  it("does not prepare the seed-backed coin/start flow while bootFlow is active", () => {
    expect(shouldUseCoinStartFlow({ ...coinStartBase, forceBootFlow: true })).toBe(false);
  });

  it("keeps explicit seed diagnostics out of the default boot flow", () => {
    expect(shouldUseBootFlow({
      ...bootFlowBase,
      playableSeedName: "start_level1_intro_practice_f2479",
    })).toBe(false);

    expect(shouldUseBootFlow({
      ...bootFlowBase,
      useStartLevelPractice: true,
    })).toBe(false);

    expect(shouldUseBootFlow({
      ...bootFlowBase,
      useMameDump: true,
    })).toBe(false);

    expect(shouldUseBootFlow({
      ...bootFlowBase,
      useMameLive: true,
    })).toBe(false);

    expect(shouldUseBootFlow({
      ...bootFlowBase,
      explicitScenarioName: "level1_spawn",
    })).toBe(false);
  });

  it("keeps explicit coinStart on the seed-backed coin/start flow", () => {
    expect(shouldUseBootFlow({ ...bootFlowBase, forcePlay: false })).toBe(false);
    expect(shouldUseCoinStartFlow({
      ...coinStartBase,
      forceCoinStart: true,
      forcePlay: false,
    })).toBe(true);
  });

  it("keeps explicit diagnostic seed URLs out of the coin/start seed preparation", () => {
    expect(shouldUseCoinStartFlow({
      ...coinStartBase,
      playableSeedName: "start_level1_intro_practice_f2479",
    })).toBe(false);

    expect(shouldUseCoinStartFlow({
      ...coinStartBase,
      useStartLevelPractice: true,
    })).toBe(false);

    expect(shouldUseCoinStartFlow({
      ...coinStartBase,
      warmStateReady: true,
    })).toBe(false);
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

    expect(bootFlowConflictMessage({
      explicitScenarioName: null,
      forceBootFlow: true,
      playableSeedName: null,
      startLevelPractice: undefined,
      useMameDump: true,
      useMameLive: false,
    })).toBe(BOOT_FLOW_CONFLICT_MESSAGE);

    expect(bootFlowConflictMessage({
      explicitScenarioName: null,
      forceBootFlow: true,
      playableSeedName: null,
      startLevelPractice: undefined,
      useMameDump: false,
      useMameLive: true,
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
