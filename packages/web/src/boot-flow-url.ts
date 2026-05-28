export const BOOT_FLOW_CONFLICT_MESSAGE =
  "bootFlow=1 cannot be combined with playableSeed, startLevel, scenario, mameDump, or mameLive.";

export interface BootFlowConflictOptions {
  explicitScenarioName: string | null;
  forceBootFlow: boolean;
  playableSeedName: string | null;
  startLevelPractice: number | undefined;
  useMameDump: boolean;
  useMameLive: boolean;
}

export function bootFlowConflictMessage(options: BootFlowConflictOptions): string | undefined {
  if (!options.forceBootFlow) return undefined;
  if (
    options.playableSeedName !== null ||
    options.startLevelPractice !== undefined ||
    options.explicitScenarioName !== null ||
    options.useMameDump ||
    options.useMameLive
  ) {
    return BOOT_FLOW_CONFLICT_MESSAGE;
  }
  return undefined;
}

export interface CoinStartFlowOptions {
  forceBootFlow: boolean;
  forceCoinStart: boolean;
  forcePlay: boolean;
  hasRom: boolean;
  playableSeedName: string | null;
  scenarioName: string | null;
  useMameDump: boolean;
  useMameLive: boolean;
  useStartLevelPractice: boolean;
  warmStateReady: boolean;
}

export interface BootFlowRouteOptions {
  explicitScenarioName: string | null;
  forceAutoLoad: boolean;
  forceBootFlow: boolean;
  forceCoinStart: boolean;
  forcePlay: boolean;
  playableSeedName: string | null;
  useMameDump: boolean;
  useMameLive: boolean;
  useStartLevelPractice: boolean;
}

export function shouldUseBootFlow(options: BootFlowRouteOptions): boolean {
  if (options.forceBootFlow) return true;
  return (
    !options.forceCoinStart &&
    options.forceAutoLoad &&
    !options.forcePlay &&
    options.playableSeedName === null &&
    !options.useStartLevelPractice &&
    options.explicitScenarioName === null &&
    !options.useMameDump &&
    !options.useMameLive
  );
}

export function shouldUseCoinStartFlow(options: CoinStartFlowOptions): boolean {
  return (
    !options.warmStateReady &&
    options.hasRom &&
    options.scenarioName === null &&
    !options.useStartLevelPractice &&
    !options.forceBootFlow &&
    (
      options.forceCoinStart ||
      (
        options.forcePlay &&
        options.playableSeedName === null &&
        !options.useMameDump &&
        !options.useMameLive
      )
    )
  );
}
