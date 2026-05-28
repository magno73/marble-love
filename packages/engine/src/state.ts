/**
 * state.ts — root del game state. Layout pensato per **rispecchiare** il game
 * `trace_reimpl.jsonl`.
 *
 * la ESLint rule fallisce. Usa wrap.ts.
 *
 */

import type { u8, u16, u32 } from "./wrap.js";
import { as_u8, as_u16, as_u32 } from "./wrap.js";

// ─── Primitive geometriche ────────────────────────────────────────────────

export interface Vec2_u16 {
  x: u16;
  y: u16;
}

export interface Vec3_i32 {
  x: u32;
  y: u32;
  z: u32;
}

// ─── Marble (la biglia del giocatore) ─────────────────────────────────────

export interface Marble {
  pos: Vec3_i32;
  vel: Vec3_i32;
  spriteIndex: u8;
  alive: boolean;
  deathTimer: u16;
}

// ─── Nemici ───────────────────────────────────────────────────────────────

/** Tipologie da Phase 1 (TBD da MAME source / ROM analysis). */
export type EnemyKind =
  | "marble_eater"
  | "slinky"
  | "acid_pool"
  | "hammer"
  | "steelie"
  | "unknown";

export interface Enemy {
  kind: EnemyKind;
  pos: Vec3_i32;
  vel: Vec3_i32;
  state: u8;
  active: boolean;
}


export interface Level {
  /** Indice 1..6 (Practice, Beginner, Intermediate, Aerobic, Silly, Ultimate). */
  index: u8;
  romOffset: u32;
  /** Tile/heightmap loader: popolato in Phase 4. */
  tilesLoaded: boolean;
}

// ─── RNG ──────────────────────────────────────────────────────────────────

export interface RngState {
  /**
    */
  seed: u32;
  callsThisFrame: u32;
}

// ─── Score / Lives / Timer ────────────────────────────────────────────────

export interface PlayerStats {
  score: u32;
  lives: u8;
  levelTimer: u16;
  /** Bonus accumulato. */
  bonus: u16;
}

// ─── Input snapshot ───────────────────────────────────────────────────────

export interface InputSnapshot {
  trackballDx: u8;
  /** Trackball delta Y. */
  trackballDy: u8;
  /** Bitfield bottoni (start, coin, ...). */
  buttons: u8;
  /** DIP switch (bank 1+2). */
  dipSwitches: u16;
}

// ─── Tick clock ───────────────────────────────────────────────────────────

export interface TickClock {
  /** Frame contati da power-on. */
  frame: u32;
  /** Tick CPU 68010 (a 7.159 MHz, da confermare in Phase 1). */
  cpuTicks: u32;
  /** Sub-frame per IRQ scanline (TBD). */
  scanline: u16;
  /**
   * Counter incremented on each `tick(runMainLoopBody:true)` invocation.
   * `(mainLoopBodyTicks & 1) === 0` (= every 2 ticks). Mirrors MAME FUN_117B2
   * vsync = 30Hz game-tick rate.
   */
  mainLoopBodyTicks: u32;
  /**
   * MAME preserves D6 across subroutines via movem; TS passes it explicitly.
   */
  decoderD6Init: u16;
  /** Decoder invocation counter. Incremented in refresh-helper-13ee6.
    */
  decoderCallCount: u32;
  /**
   * Warm-state resume for FUN_1493C when an oracle snapshot lands between
   * per-slot calls. Undefined during normal boot.
   */
  pendingSlotArray1493C: u8 | undefined;
  /**
   * MAME f12000..f12099 oracle window. Undefined during normal boot.
   */
  slotArrayReplayTick: u16 | undefined;
  /**
   * Warm-state replay cursor for the final async/peripheral bytes that are
   * still outside the deterministic TS model in the MAME f12000..f12099
   * oracle window. Undefined during normal boot.
   */
  warmResidualReplayTick: u16 | undefined;
  /**
   * Async resume cursor for FUN_11452 mode-2 initialization. The original
   * instead of compressing the full scene reset into the caller tick.
   */
  mode2Init11452Stage: u8 | undefined;
  /**
   * Async resume cursor for FUN_11452 mode-0 initialization. The transition
   * from attract sub-mode 2 to 0 enters FUN_11452 and spans visible vblanks
   * before the level/HUD rebuild side effects land.
   */
  mode0Init11452Stage: u16 | undefined;
  /**
   * One-frame delayed HUD refresh after the mode-2 reset path returns. MAME
   * renders the bottom credit/coin strings on the next visible frame, not while
   * FUN_11452 is still in its multi-vblank initialization body.
   */
  mode2BottomHudDelay: u8 | undefined;
  /**
   * One-shot hold for the special particle layer after a staged FUN_18CD2 init.
   * Undefined during normal gameplay.
   */
  particleLayerDelay: u8 | undefined;
  /**
   * One-shot delay for mode-2 tilemap blit side effects that MAME exposes on
   * the next vblank after the reset body has otherwise returned.
   */
  mode2TilemapBlitDelay: u8 | undefined;
  /**
   * One-vblank deferred FUN_26D8A scroll update. The IRQ4 prefix observes the
   * trigger before the visible MO/scroll side effects land in MAME snapshots.
   */
  pendingPfScrollUpdate: u8 | undefined;
  /**
   * Main-thread wait-vblank hold started by blocking presentation helpers such
   * as FUN_16A20. While active, the 117B2 body and gameplay timers stay parked
   * so the just-rendered summary screen remains visible for its ROM delay.
   */
  mainThreadWaitDelay: u16 | undefined;
  /** Alpha row clear that must run after the deferred main-thread wait. */
  mainThreadWaitClearRows: u8 | undefined;
  /**
   * Continuation marker for the level-complete score text in FUN_118D2.
   * Set after rendering the summary and cleared once the post-wait level
   * transition resumes.
   */
  levelEndScoreResumePending: u8 | undefined;
  /**
   * Warm-state resume cursor for level-intro seeds captured inside the
   * FUN_10504 HUD/timer presentation loop. Undefined during normal gameplay.
   */
  levelIntroBannerResumeTick: u16 | undefined;
  /**
   * Timer value observed when the level-intro presentation starts. FUN_10504
   * adds the level-specific bonus to this base; later levels can start from a
   * non-zero carryover timer.
   */
  levelIntroBannerBaseTimer: u16 | undefined;
  /**
   * Main-loop dispatcher state restored after the intro banner clears. True
   * level starts use state 0 so normal gameplay physics resumes after the
   * presentation.
   */
  levelIntroBannerHandoffState: u16 | undefined;
  /**
   * Runtime high-score initials entry. This is an async replacement for the
   * previous score-qualified fallback that saved the current initials
   * immediately.
   */
  highScoreInitialsEntry: HighScoreInitialsEntryState | undefined;
}

export interface HighScoreInitialsEntryState {
  objectAddr: number;
  rank: u8;
  recordAddr: number;
  cursor: u8;
  lastP1X: u8 | undefined;
  lastP1Y: u8 | undefined;
  previousButtons: u8;
  moveCooldown: u8;
  frames: u16;
}

export interface ObjectPairCollisionDebug {
  frame: number;
  selfAddr: number;
  targetAddr: number;
  loopIndex: number;
  savedX: number;
  savedY: number;
  savedZ: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  selfActiveBefore?: number;
  targetActiveBefore?: number;
  selfF36Before?: number;
  targetF36Before?: number;
  selfState: number;
  targetState: number;
  selfKind: number;
  targetKind: number;
  selfX: number;
  selfY: number;
  selfZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  selfVxBefore: number;
  selfVyBefore: number;
  targetVxBefore: number;
  targetVyBefore: number;
  selfVxAfter: number;
  selfVyAfter: number;
  targetVxAfter: number;
  targetVyAfter: number;
  zDepthPath?: string;
  selfActiveAfter?: number;
  targetActiveAfter?: number;
  selfStateAfter?: number;
  targetStateAfter?: number;
  selfKindAfter?: number;
  targetKindAfter?: number;
  selfF36After?: number;
  targetF36After?: number;
}

export interface ScriptSlotCollisionDebug {
  frame: number;
  entityAddr: number;
  slotIndex: number;
  slotAddr: number;
  slotState: number;
  entityState: number;
  slotX: number;
  slotY: number;
  slotZ: number;
  bboxX0: number;
  bboxY0: number;
  bboxX1: number;
  bboxY1: number;
  marbleX0: number;
  marbleY0: number;
  marbleZ0: number;
  marbleX1: number;
  marbleY1: number;
  marbleZ1: number;
}

export interface TerrainSlotCollisionDebug {
  frame: number;
  entityAddr: number;
  slotIndex: number;
  slotAddr: number;
  colorTag: number;
  reason: string;
  d1: number;
  d2: number;
  d6: number;
  a0: number;
  slotX: number;
  slotY: number;
  slotZ: number;
  entityX: number;
  entityY: number;
  entityZ: number;
  entityVxBefore: number;
  entityVyBefore: number;
  flagX: number;
  flagY: number;
}

export interface Helper121B8BoundsBounceDebug {
  frame: number;
  entityAddr: number;
  d1: number;
  d4: number;
  d5: number;
  xBefore: number;
  yBefore: number;
  zBefore: number;
  vxBefore: number;
  vyBefore: number;
  vzBefore: number;
  xAfter: number;
  yAfter: number;
  zAfter: number;
  vxAfter: number;
  vyAfter: number;
  vzAfter: number;
}

export interface TrackballApplyDebug {
  frame: number;
  entityAddr: number;
  rawX: number;
  rawY: number;
  appliedX: number;
  appliedY: number;
  vxBefore: number;
  vyBefore: number;
  vxAfter: number;
  vyAfter: number;
  cx0: number;
  cx1: number;
  cy0: number;
  cz: number;
  fracX: number;
  fracY: number;
  bge: number;
}

export interface TrackballSanitizeDebug {
  frame: number;
  rawX: number;
  rawY: number;
  suppressedX: boolean;
  suppressedY: boolean;
  reasonX: string;
  reasonY: string;
  cx0: number;
  cx1: number;
  cy0: number;
  cz: number;
  fracX: number;
  fracY: number;
  bge: number;
}

export interface ObjectStateEntryDebug {
  frame: number;
  source: string;
  entityAddr: number;
  code: number;
  active: number;
  type: number;
  prevState: number;
  prevKind: number;
  prevF36: number;
  prevF56: number;
  prevF57: number;
  prevF58: number;
  prevF59: number;
  prevF5f: number;
  prevF60: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  prevVx: number;
  prevVy: number;
  prevVz: number;
  prevTargetZ: number;
  detail?: string;
  slotIndex?: number;
  colorTag?: number;
  d1?: number;
  d2?: number;
  d6?: number;
  a0?: number;
  floorNow?: number;
  zDelta?: number;
}

export interface TubeProbeDebug {
  frame: number;
  entityAddr: number;
  slotIndex: number;
  slotAddr: number;
  colorTag: number;
  result: string;
  d1: number;
  d2: number;
  d6: number;
  a0: number;
  slotX: number;
  slotY: number;
  slotZ: number;
  entityX: number;
  entityY: number;
  entityZ: number;
  entityVx: number;
  entityVy: number;
  entityVz: number;
  state36: number;
  state1a: number;
  f58: number;
  f59: number;
}

export interface TerrainScanStopDebug {
  frame: number;
  entityAddr: number;
  reason: string;
  iterCount: number;
  slotIndex: number;
  slotAddr: number;
  active: number;
  slotState: number;
  colorTag: number;
  d1: number;
  d2: number;
  d6: number;
  a0: number;
  f58: number;
  f59: number;
  slotX: number;
  slotY: number;
  slotZ: number;
  entityX: number;
  entityY: number;
  entityZ: number;
}

export interface TerrainGateProbeDebug {
  frame: number;
  entityAddr: number;
  slotIndex: number;
  slotAddr: number;
  colorTag: number;
  result: string;
  slotState: number;
  base46: number;
  d1: number;
  d2: number;
  d6: number;
  a0: number;
  g694: number;
  prevD6: number | undefined;
  prevA0: number | undefined;
  zRestore: number | undefined;
  flagX: number;
  flagY: number;
  slotX: number;
  slotY: number;
  entityX: number;
  entityY: number;
  entityVx: number;
  entityVy: number;
  entityState: number;
  entityS58: number;
}

export interface TerrainWaveCandidateDebug {
  frame: number;
  entityAddr: number;
  slotIndex: number;
  slotAddr: number;
  colorTag: number;
  d1: number;
  d2: number;
  d6: number;
  a0: number;
  denominator: number;
  f58: number;
  flagX: number;
  flagY: number;
  slotX: number;
  slotY: number;
  entityX: number;
  entityY: number;
}

export interface GameDebugState {
  lastObjectPairCollision?: ObjectPairCollisionDebug;
  lastScriptSlotCollision?: ScriptSlotCollisionDebug;
  lastTerrainSlotCollision?: TerrainSlotCollisionDebug;
  lastTerrainWaveCandidate?: TerrainWaveCandidateDebug;
  lastObjectStateEntry?: ObjectStateEntryDebug;
  lastTubeProbe?: TubeProbeDebug;
  lastTerrainScanStop?: TerrainScanStopDebug;
  lastTerrainGateProbe?: TerrainGateProbeDebug;
  lastHelper121B8BoundsBounce?: Helper121B8BoundsBounceDebug;
  lastTrackballApply?: TrackballApplyDebug;
  lastTrackballSanitize?: TrackballSanitizeDebug;
}

// ─── GameState root ───────────────────────────────────────────────────────

export interface GameState {
  clock: TickClock;
  rng: RngState;
  marble: Marble;
  enemies: Enemy[];
  level: Level;
  stats: PlayerStats;
  input: InputSnapshot;
  /**
   *  Dimensione esatta da Phase 1 (atarisys1.cpp). */
  workRam: Uint8Array;
  /** Playfield tilemap RAM (background tilemap, 0xA00000-0xA01FFF, 8 KB).
   *  64×64 tile entries (2 byte each) per Atari System 1 hardware spec.
   *  Popolato da game-side write durante level load + scroll updates. */
  playfieldRam: Uint8Array;
  /** Motion object RAM (sprite, 0xA02000-0xA02FFF, 4 KB). */
  spriteRam: Uint8Array;
  /** Alphanumerics RAM (HUD overlay, 0xA03000-0xA03FFF, 4 KB). */
  alphaRam: Uint8Array;
  /** Color RAM (palette IRGB-4444, 0xB00000-0xB007FF, 2 KB). */
  colorRam: Uint8Array;
  /** Playfield X scroll register (MMIO 0x800000, 9-bit, write-only).
    */
  videoScrollX: number;
  /** Playfield Y scroll register (MMIO 0x820000, 9-bit, write-only). */
  videoScrollY: number;
  /** Runtime-only diagnostics. Not mirrored into emulated RAM. */
  debug?: GameDebugState | undefined;
}


export function emptyGameState(): GameState {
  return {
    clock: { frame: as_u32(0), cpuTicks: as_u32(0), scanline: as_u16(0), mainLoopBodyTicks: as_u32(0), decoderD6Init: as_u16(0), decoderCallCount: as_u32(0), pendingSlotArray1493C: undefined, slotArrayReplayTick: undefined, warmResidualReplayTick: undefined, mode2Init11452Stage: undefined, mode0Init11452Stage: undefined, mode2BottomHudDelay: undefined, particleLayerDelay: undefined, mode2TilemapBlitDelay: undefined, pendingPfScrollUpdate: undefined, mainThreadWaitDelay: undefined, mainThreadWaitClearRows: undefined, levelEndScoreResumePending: undefined, levelIntroBannerResumeTick: undefined, levelIntroBannerBaseTimer: undefined, levelIntroBannerHandoffState: undefined, highScoreInitialsEntry: undefined },
    rng: { seed: as_u32(0), callsThisFrame: as_u32(0) },
    marble: {
      pos: { x: as_u32(0), y: as_u32(0), z: as_u32(0) },
      vel: { x: as_u32(0), y: as_u32(0), z: as_u32(0) },
      spriteIndex: as_u8(0),
      alive: false,
      deathTimer: as_u16(0),
    },
    enemies: [],
    level: { index: as_u8(0), romOffset: as_u32(0), tilesLoaded: false },
    stats: {
      score: as_u32(0),
      lives: as_u8(0),
      levelTimer: as_u16(0),
      bonus: as_u16(0),
    },
    input: {
      trackballDx: as_u8(0),
      trackballDy: as_u8(0),
      buttons: as_u8(0),
      dipSwitches: as_u16(0),
    },
    //   work RAM 8 KB ($400000-$401FFF)
    //   playfield RAM 8 KB ($A00000-$A01FFF, 64x64 tile entries)
    //   motion-object RAM 4 KB ($A02000-$A02FFF, 8 banchi × 64 entry × 4 word)
    //   alpha RAM 4 KB ($A03000-$A03FFF, HUD overlay 64×32 tile)
    //   palette RAM 2 KB ($B00000-$B007FF)
    workRam: new Uint8Array(0x2000),     // 8 KB
    playfieldRam: new Uint8Array(0x2000), // 8 KB
    spriteRam: new Uint8Array(0x1000),   // 4 KB
    alphaRam: new Uint8Array(0x1000),    // 4 KB
    colorRam: new Uint8Array(0x800),     // 2 KB
    videoScrollX: 0,
    videoScrollY: 0,
    debug: {},
  };
}

/**
 *  - compare bit-by-bit with the MAME oracle trace
 */
export function snapshotGameState(s: GameState): GameState {
  return {
    clock: {
      ...s.clock,
      highScoreInitialsEntry: s.clock.highScoreInitialsEntry === undefined
        ? undefined
        : { ...s.clock.highScoreInitialsEntry },
    },
    rng: { ...s.rng },
    marble: {
      ...s.marble,
      pos: { ...s.marble.pos },
      vel: { ...s.marble.vel },
    },
    enemies: s.enemies.map((e) => ({
      ...e,
      pos: { ...e.pos },
      vel: { ...e.vel },
    })),
    level: { ...s.level },
    stats: { ...s.stats },
    input: { ...s.input },
    workRam: new Uint8Array(s.workRam),
    playfieldRam: new Uint8Array(s.playfieldRam),
    spriteRam: new Uint8Array(s.spriteRam),
    alphaRam: new Uint8Array(s.alphaRam),
    colorRam: new Uint8Array(s.colorRam),
    videoScrollX: s.videoScrollX,
    videoScrollY: s.videoScrollY,
    debug: s.debug === undefined ? undefined : { ...s.debug },
  };
}
