/**
 * audio.ts - lightweight gameplay audio event facade.
 *
 * The current chip-level path lives under `audio/` and `m6502/sound-chip.ts`.
 * This module remains as a small abstract-event facade for older callers.
 */

import type { GameState } from "./state.js";

export type AudioEventKind =
  | "marble_roll"
  | "marble_jump"
  | "marble_death"
  | "enemy_hit"
  | "level_complete"
  | "menu_blip"
  | "unknown";

export interface AudioEvent {
  kind: AudioEventKind;
  /** Frame where the event was emitted, for deterministic replay. */
  frame: number;
  /** Optional parameter, such as roll speed mapped to pitch. */
  param: number;
}

/** Drains abstract events accumulated for the frame. */
export function drainAudioEvents(_state: GameState): AudioEvent[] {
  return [];
}
