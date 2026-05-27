export const SOUND_GAMEPLAY_FIRST_MUSIC_FRAME = 1570 as const;

const SOUND_LEVEL_MUSIC_COMMANDS = [
  0x08, // Practice Race
  0x0a, // Beginner Race
  0x0c, // Intermediate Race
  0x0e, // Aerial Race
  0x10, // Silly Race
  0x18, // Ultimate Race
] as const;

/**
 * Playable seeds expose zero-based level indexes in work RAM. These command
 * bytes are the sound-CPU music selectors verified against the MAME/VGM first
 * YM2151 write sequences for the six race tracks. The 68010 table at `$1EF92`
 * is not the background playlist; it emits transition/goal cues.
 */
export function soundLevelMusicCommandForLevelIndex(
  levelIndex: number,
): number | undefined {
  const idx = Math.trunc(levelIndex);
  if (idx < 0) return undefined;
  return SOUND_LEVEL_MUSIC_COMMANDS[idx];
}

export function soundGameplayPrewarmFrameBeforeLevelMusic(
  requestedFrame: number,
  hasExplicitOverride: boolean,
): number {
  if (hasExplicitOverride) return requestedFrame;
  return Math.min(requestedFrame, SOUND_GAMEPLAY_FIRST_MUSIC_FRAME);
}

export function shouldHandoffSoundChipForLevelChange(
  previousLevelIndex: number | undefined,
  nextLevelIndex: number,
  handoffEnabled: boolean,
): boolean {
  if (!handoffEnabled) return false;
  if (previousLevelIndex === undefined) return false;
  return nextLevelIndex > 0 && nextLevelIndex !== previousLevelIndex;
}
