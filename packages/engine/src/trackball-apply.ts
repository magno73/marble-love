/**
 * trackball-apply.ts — `FUN_00025DF6` (134 byte): apply trackball delta to position.
 *
 * Reads delta @ 0x4006A4 (D1 word) and 0x4006A6 (D2 word). If |delta| > 0xC,
 * scale delta *= 4. Then sub or add (delta << 11) to arg+0 and arg+4 longs:
 *   - if *0x400394 == 4: ADD (compensate)
 *   - else: SUBTRACT (apply movement)
 */

import type { GameState } from "./state.js";

const STRUCT_OFF = 0x1c28;
const OUT_X_OFF = 0x6a4;
const OUT_Y_OFF = 0x6a6;
const BGE_FLAG_OFF = 0x6a2;
const FRAC_X_OFF = 0x69e;
const FRAC_Y_OFF = 0x6a0;

function readW(s: GameState, off: number): number {
  return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
}
function readWS(s: GameState, off: number): number {
  const w = readW(s, off);
  return w & 0x8000 ? w - 0x10000 : w;
}
function writeW(s: GameState, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}
function readU32(s: GameState, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>> 0
  );
}
function writeU32(s: GameState, off: number, v: number): void {
  const x = v >>> 0;
  s.workRam[off] = (x >>> 24) & 0xff;
  s.workRam[off + 1] = (x >>> 16) & 0xff;
  s.workRam[off + 2] = (x >>> 8) & 0xff;
  s.workRam[off + 3] = x & 0xff;
}

function oneTerrainEndpointIsMissing(a: number, b: number): boolean {
  return (a === 0 && b !== 0) || (a !== 0 && b === 0);
}

function terrainEndpointPairForDelta(
  state: GameState,
  deltaOff: number,
): [number, number] | undefined {
  const cx0 = readWS(state, STRUCT_OFF + 0x04);
  const cx1 = readWS(state, STRUCT_OFF + 0x0e);
  const cy0 = readWS(state, STRUCT_OFF + 0x10);
  const cz = readWS(state, STRUCT_OFF + 0x1a);
  const bge = readWS(state, BGE_FLAG_OFF);

  if (deltaOff === OUT_X_OFF) {
    return bge !== 0 ? [cx1, cx0] : [cy0, cz];
  }
  if (deltaOff === OUT_Y_OFF) {
    return bge !== 0 ? [cx0, cz] : [cx1, cy0];
  }
  return undefined;
}

export interface ProjectedSurfaceSnapshot {
  cx0: number;
  cx1: number;
  cy0: number;
  cz: number;
  fracX: number;
  fracY: number;
  bge: number;
}

export function projectedSurfaceSnapshot(state: GameState): ProjectedSurfaceSnapshot {
  return {
    cx0: readWS(state, STRUCT_OFF + 0x04),
    cx1: readWS(state, STRUCT_OFF + 0x0e),
    cy0: readWS(state, STRUCT_OFF + 0x10),
    cz: readWS(state, STRUCT_OFF + 0x1a),
    fracX: readWS(state, FRAC_X_OFF),
    fracY: readWS(state, FRAC_Y_OFF),
    bge: readWS(state, BGE_FLAG_OFF),
  };
}

export function projectedFloorMissingEndpointReason(state: GameState): string {
  const surface = projectedSurfaceSnapshot(state);
  const reasons: string[] = [];

  const xPair: [number, number] = surface.bge !== 0
    ? [surface.cx1, surface.cx0]
    : [surface.cy0, surface.cz];
  const yPair: [number, number] = surface.bge !== 0
    ? [surface.cx0, surface.cz]
    : [surface.cx1, surface.cy0];

  if (surface.fracX !== 0 && oneTerrainEndpointIsMissing(xPair[0], xPair[1])) {
    reasons.push("x-missing-endpoint");
  }
  if (surface.fracY !== 0 && oneTerrainEndpointIsMissing(yPair[0], yPair[1])) {
    reasons.push("y-missing-endpoint");
  }

  return reasons.join("+");
}

function projectedDeltaSuppressionReason(state: GameState, off: number): string {
  const raw = readWS(state, off);
  if (raw === 0) return "";
  const endpoints = terrainEndpointPairForDelta(state, off);
  const frac = off === OUT_X_OFF ? readWS(state, FRAC_X_OFF) : readWS(state, FRAC_Y_OFF);
  const reasons: string[] = [];
  if (Math.abs(raw) > 0x40) reasons.push("large-discontinuity");
  if (
    frac === 0 &&
    endpoints !== undefined &&
    oneTerrainEndpointIsMissing(endpoints[0], endpoints[1])
  ) {
    reasons.push("missing-endpoint");
  }
  return reasons.join("+");
}

export function sanitizeProjectedTerrainDeltas(state: GameState): void {
  // FUN_25DF6 intentionally boosts terrain deltas by x4. In MAME route traces
  // valid player projections stay tiny; TS-only terrain holes/wall edges can
  // leak values like -16320 or 208 here and become invisible shove impulses.
  const rawX = readWS(state, OUT_X_OFF);
  const rawY = readWS(state, OUT_Y_OFF);
  const surface = projectedSurfaceSnapshot(state);
  const reasonX = projectedDeltaSuppressionReason(state, OUT_X_OFF);
  const reasonY = projectedDeltaSuppressionReason(state, OUT_Y_OFF);

  if (reasonX !== "") writeW(state, OUT_X_OFF, 0);
  if (reasonY !== "") writeW(state, OUT_Y_OFF, 0);

  if (reasonX !== "" || reasonY !== "") {
    state.debug ??= {};
    state.debug.lastTrackballSanitize = {
      frame: Number(state.clock.frame),
      rawX,
      rawY,
      suppressedX: reasonX !== "",
      suppressedY: reasonY !== "",
      reasonX,
      reasonY,
      ...surface,
    };
  }
}

export function trackballApplyDelta(state: GameState, posAddr: number): void {
  const posOff = posAddr - 0x400000;
  const rawX = readWS(state, OUT_X_OFF);
  const rawY = readWS(state, OUT_Y_OFF);
  const surface = projectedSurfaceSnapshot(state);
  const vxBefore = readU32(state, posOff);
  const vyBefore = readU32(state, posOff + 4);

  // Boost x-delta if |x| > 0xC unsigned
  const xDelta = readWS(state, OUT_X_OFF);
  const xAbs = xDelta < 0 ? -xDelta : xDelta;
  // bhi if 0xC > |X| (skip boost). Boost when |X| >= 0xC.
  if (xAbs >= 0xC) {
    writeW(state, OUT_X_OFF, ((xDelta << 2) & 0xffff));
  }
  const yDelta = readWS(state, OUT_Y_OFF);
  const yAbs = yDelta < 0 ? -yDelta : yDelta;
  if (yAbs >= 0xC) {
    writeW(state, OUT_Y_OFF, ((yDelta << 2) & 0xffff));
  }

  // Re-read after potential boost
  const xFinal = readWS(state, OUT_X_OFF);
  const yFinal = readWS(state, OUT_Y_OFF);
  const xLong = (xFinal << 11) | 0;
  const yLong = (yFinal << 11) | 0;

  const gameState = readW(state, 0x394);
  if (gameState === 4) {
    // Add path
    writeU32(state, posOff, ((readU32(state, posOff) + xLong) >>> 0));
    writeU32(state, posOff + 4, ((readU32(state, posOff + 4) + yLong) >>> 0));
  } else {
    // Sub path (default)
    writeU32(state, posOff, ((readU32(state, posOff) - xLong) >>> 0));
    writeU32(state, posOff + 4, ((readU32(state, posOff + 4) - yLong) >>> 0));
  }

  state.debug ??= {};
  state.debug.lastTrackballApply = {
    frame: Number(state.clock.frame),
    entityAddr: posAddr,
    rawX,
    rawY,
    appliedX: xFinal,
    appliedY: yFinal,
    vxBefore: vxBefore | 0,
    vyBefore: vyBefore | 0,
    vxAfter: readU32(state, posOff) | 0,
    vyAfter: readU32(state, posOff + 4) | 0,
    ...surface,
  };
}
