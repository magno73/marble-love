/**
 * audio.ts — sistema audio.
 *
 * **Status: STUB silenzioso.** PRD §10: POKEY/YM2151 chip-perfect rimandato a V2.
 *
 * V1: il 6502 sound CPU emula i comandi del 68010 via mailbox (vedi
 * `docs/sound-system.md`). Qui dentro tracciamo solo la mailbox per il diff
 * (ground-truth vs reimpl), e produciamo eventi astratti (`AudioEvent`) che
 * il pacchetto `web` può rendere via Web Audio API con sample synthesis basic.
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
  /** Frame in cui è stato emesso (per replay deterministico). */
  frame: number;
  /** Parametro opzionale (es. velocità roll → pitch). */
  param: number;
}

/** Drena gli eventi accumulati nel frame e li ritorna. STUB. */
export function drainAudioEvents(_state: GameState): AudioEvent[] {
  return [];
}
