/**
 * physics.ts - marble physics placeholder: gravity, friction, slope, collision.
 *
 * Correct implementation requires the original physics subroutines, backed by
 * Ghidra/MAME evidence. Prior notes identify:
 *  - input physics at ROM $28000 (additive, friction x 352)
 *  - slope at ROM $2815A (waypoint attractor: vel += (target-vel)/8)
 *  - Z_SCALE = 1 (1 z-unit = 1 screen pixel, confirmed near $189A2)
 *  - projection: sx = (wy-wx)*8 + cx; sy = (wx+wy)*4 - wz - scrollY
 *
 * Do not copy prior vanilla JS ports mechanically; parity requires the exact
 * 68010 integer widths and shifts.
 */

import type { GameState } from "./state.js";
import { as_u32, u32_add } from "./wrap.js";

/** Marble physics tick placeholder: currently advances only the frame counter. */
export function physicsTick(state: GameState): void {
  // Future work: mirror $28000 input physics and $2815A slope physics. The ROM
  // loop applies input first, then the slope attractor for the tile below.
  state.clock.frame = u32_add(state.clock.frame, as_u32(1));
}
