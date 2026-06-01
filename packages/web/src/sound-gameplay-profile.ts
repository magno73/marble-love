export const SOUND_GAMEPLAY_FIRST_MUSIC_FRAME = 1570 as const;

const SPECIAL_ATTRACT_SOUND_COMMANDS = [0x61, 0x65, 0x67] as const;

const SOUND_LEVEL_MUSIC_COMMANDS = [
  0x08, // Practice Race
  0x0a, // Beginner Race
  0x0c, // Intermediate Race
  0x0e, // Aerial Race
  0x14, // Silly Race — was mis-set to 0x10 (which selects a non-advancing
        // chord, heard as a 2-note loop); 0x14 is the real background track.
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

export function isSpecialAttractSoundCommand(command: number): boolean {
  const byte = command & 0xff;
  return SPECIAL_ATTRACT_SOUND_COMMANDS.includes(byte as typeof SPECIAL_ATTRACT_SOUND_COMMANDS[number]);
}

export function shouldDropLiveGameplaySpecialAttractCommand(
  command: number,
  replayAttractCommands: boolean,
): boolean {
  return !replayAttractCommands && isSpecialAttractSoundCommand(command);
}
