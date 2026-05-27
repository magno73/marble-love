import { describe, expect, it } from "vitest";
import {
  SOUND_GAMEPLAY_FIRST_MUSIC_FRAME,
  shouldHandoffSoundChipForLevelChange,
  soundGameplayPrewarmFrameBeforeLevelMusic,
  soundLevelMusicCommandForLevelIndex,
} from "../src/sound-gameplay-profile.js";

describe("sound gameplay profile", () => {
  it("uses the verified sound-CPU music selectors for each race", () => {
    expect(soundLevelMusicCommandForLevelIndex(0)).toBe(0x08);
    expect(soundLevelMusicCommandForLevelIndex(1)).toBe(0x0a);
    expect(soundLevelMusicCommandForLevelIndex(2)).toBe(0x0c);
    expect(soundLevelMusicCommandForLevelIndex(3)).toBe(0x0e);
    expect(soundLevelMusicCommandForLevelIndex(4)).toBe(0x10);
    expect(soundLevelMusicCommandForLevelIndex(5)).toBe(0x18);
  });

  it("does not invent a fallback for unsupported levels", () => {
    expect(soundLevelMusicCommandForLevelIndex(-1)).toBeUndefined();
    expect(soundLevelMusicCommandForLevelIndex(6)).toBeUndefined();
  });

  it("hands off chip state only for real later-level transitions", () => {
    expect(shouldHandoffSoundChipForLevelChange(undefined, 1, true)).toBe(false);
    expect(shouldHandoffSoundChipForLevelChange(0, 0, true)).toBe(false);
    expect(shouldHandoffSoundChipForLevelChange(0, 1, true)).toBe(true);
    expect(shouldHandoffSoundChipForLevelChange(1, 2, false)).toBe(false);
  });

  it("caps default gameplay prewarm before the captured level-1 music command", () => {
    expect(soundGameplayPrewarmFrameBeforeLevelMusic(1571, false)).toBe(SOUND_GAMEPLAY_FIRST_MUSIC_FRAME);
    expect(soundGameplayPrewarmFrameBeforeLevelMusic(1200, false)).toBe(1200);
    expect(soundGameplayPrewarmFrameBeforeLevelMusic(2000, true)).toBe(2000);
  });
});
