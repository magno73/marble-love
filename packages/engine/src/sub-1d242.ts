/**
 *
 * Called by `entityWaypointStep1D1EC` (`FUN_0001D1EC`) as the final JSR in
 * its body. Receives `entityPtr` (long) on the stack.
 *
 * **Semantics**:
 *
 *   3. Sets `(D2, D3)` (delta Y direction byte / delta X direction byte):
 *      - if `entity[0..3].l != 0` (Y-first path):
 *          if `cellY > targetY`:   D2 = -8
 *          elif `cellY < targetY`: D2 =  8
 *          else (cellY == targetY): checks X:
 *               cellX > targetX → D3 = -8
 *               cellX < targetX → D3 =  8
 *               cellX == targetX → both 0
 *      - else (X-first path):
 *          if `cellX > targetX`:   D3 = -8
 *          elif `cellX < targetX`: D3 =  8
 *          else (cellX == targetX): checks Y:
 *               cellY > targetY → D2 = -8
 *               cellY < targetY → D2 =  8
 *               cellY == targetY → both 0
 *   4. Chooses the animation pointer for `entity[0x3E..0x41]` (long):
 *      - D2 > 0 (south)  → 0x00020EC4
 *      - D2 < 0 (north)  → 0x00020EE4
 *      - D2 == 0:
 *          D3 > 0 (east) → 0x00020EA4
 *          D3 <= 0       → 0x00020F24  (also for (0,0)!)
 *                       `entity[4..7].l = sext_l(D2) << 16`.
 *      Set `entity[0x25] = 2`.
 *   7. Scan loop @ `0x400018` with 0xE2 (226)-byte stride:
 *      For `i = 0..(*0x400396.w - 1)`:
 *          A1 = 0x400018 + i*0xE2
 *          if A1[0x18] == 1 AND entity[0x1B] == A1[0x1B] AND A1[0x1B] == 6:
 *              entity[0x25] = 1; break (early exit)
 *
 * **Disasm 0x1D242..0x1D35E** (cfr. file scan @ 0x1D242, 0x1D2B6, 0x1D320):
 *
 *   movem.l {D6 D5 D4 D3 D2},-(SP)           ; saved 5*4=20=0x14 byte
 *   movea.l (0x18,SP),A0                     ; A0 = entityPtr (4 ret + 0x14 saved)
 *   clr.b   D3b
 *   clr.b   D2b
 *   move.l  (0xc,A0),D1; moveq #0x13,D0; asr.l D0,D1; move.w D1w,D5w  ; cellX
 *   move.l  (0x10,A0),D1; ...                                         ; cellY
 *   movea.l (0x2c,A0),A1
 *   move.b  (A1),D1b; ext.w  D1w                                       ; targetX
 *   movea.l (0x2c,A0),A1
 *   move.b  (0x1,A1),D0b; ext.w D0w                                    ; targetY
 *   tst.l   (A0); bne.b → Y-first path; else → X-first path
 *   ; ... direction-decide ...
 *   ; ... anim-set + velocity write + state-byte init ...
 *   ; ... scan-loop @ 0x400018 stride 0xE2, limit *0x400396 ...
 *   movem.l (SP)+,{D2 D3 D4 D5 D6}
 *   rts
 *
 * **Identified callers** (xref via grep):
 *   - `entity-waypoint-step-1d1ec.ts` (1 callsite, `subs?.fun_1d242?.(a0)`).
 *
 * **Side effects** in `state.workRam`:
 *   - `entity[0..3]`     = vx (long, signed_byte * 0x10000)
 *   - `entity[4..7]`     = vy (long)
 *   - `entity[0x24]`     = 0  (counter reset)
 *   - `entity[0x25]`     = 2 default, 1 if scan match
 *   - `entity[0x3E..0x41]` = chosen animation pointer
 *
 *
 * **D6 scan quirk**: in the disassembly `move.l A1,D6 ; addi.l #0xe2,D6 ;
 *
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Absolute ROM address of FUN_0001D242. */
export const SUB_1D242_ADDR = 0x0001d242 as const;

const WRAM = 0x00400000 as const;

/** Loop limit word (entity table size) @ 0x400396. */
const LOOP_LIMIT_ADDR = 0x00400396 as const;

/** Entity table base for scan loop. */
const SCAN_BASE = 0x00400018 as const;

/** Stride per scan entry. */
const SCAN_STRIDE = 0xe2 as const;

/** Anim ptr — D2 > 0 (south) */
const ANIM_SOUTH = 0x00020ec4 as const;
/** Anim ptr — D2 < 0 (north) */
const ANIM_NORTH = 0x00020ee4 as const;
/** Anim ptr — D2 == 0, D3 > 0 (east) */
const ANIM_EAST  = 0x00020ea4 as const;
/** Anim ptr — D2 == 0, D3 <= 0 (west / idle) */
const ANIM_WEST  = 0x00020f24 as const;

// ─── Field offsets (entity struct) ──────────────────────────────────────────

const OFF_VX        = 0x00; // long — vel X
const OFF_VY        = 0x04; // long — vel Y
const OFF_POS_X     = 0x0c; // long — pos X (fixed-point)
const OFF_POS_Y     = 0x10; // long — pos Y
const OFF_SCAN_KEY  = 0x1b; // byte — scan match key (must equal A1[0x1B] == 6)
const OFF_COUNTER24 = 0x24; // byte — counter reset
const OFF_STATE25   = 0x25; // byte — state byte (default 2, 1 if scan match)
const OFF_CURSOR    = 0x2c; // long — cursor ptr
const OFF_ANIM_PREV = 0x3a; // long — previous anim ptr (copy of 0x3E)
const OFF_ANIM_NEXT = 0x3e; // long — chosen anim ptr

const OFF_OTHER_ACTIVE = 0x18; // byte @ A1+0x18 — must be 1 to consider match

// ─── Low-level helpers ──────────────────────────────────────────────────────

function rb(state: GameState, addr: number): number {
  return (state.workRam[(addr - WRAM) >>> 0] ?? 0) & 0xff;
}

function rbAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  const a = addr >>> 0;
  if (a >= WRAM && a < WRAM + state.workRam.length) return rb(state, a);
  if (rom !== undefined && a < rom.program.length) return rom.program[a] ?? 0;
  return 0;
}

function rwBE(state: GameState, addr: number): number {
  const o = (addr - WRAM) >>> 0;
  return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
}

function rlBE(state: GameState, addr: number): number {
  const o = (addr - WRAM) >>> 0;
  return (
    (((state.workRam[o] ?? 0) << 24) |
      ((state.workRam[o + 1] ?? 0) << 16) |
      ((state.workRam[o + 2] ?? 0) << 8) |
      (state.workRam[o + 3] ?? 0)) >>>
    0
  );
}

function wb(state: GameState, addr: number, v: number): void {
  state.workRam[(addr - WRAM) >>> 0] = v & 0xff;
}

function wlBE(state: GameState, addr: number, v: number): void {
  const o = (addr - WRAM) >>> 0;
  const u = v >>> 0;
  state.workRam[o]     = (u >>> 24) & 0xff;
  state.workRam[o + 1] = (u >>> 16) & 0xff;
  state.workRam[o + 2] = (u >>> 8)  & 0xff;
  state.workRam[o + 3] =  u         & 0xff;
}

/** Sign-extend byte to signed 32-bit JS number. */
function sextB(v: number): number {
  const b = v & 0xff;
  return b & 0x80 ? b - 0x100 : b;
}

/** Sign-extend low 16 bits to signed JS number. */
function sextW(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Arithmetic shift right (signed) on a 32-bit value. */
function asrL(v: number, count: number): number {
  return ((v | 0) >> (count & 0x3f)) | 0;
}

// ─── Replica ────────────────────────────────────────────────────────────────

/**
 *
 * @param state      GameState - workRam mutated (entity struct + scan tab).
 * @param entityPtr  Absolute pointer (m68k addr) of the entity struct.
 *
 * **Preconditions**: `entityPtr` must be in workRam (`0x400000..0x402000`).
 *                    `entity[0x2C]` (cursor ptr) must be readable.
 *                    `0x400018 + i*0xE2` must be readable for `i < limit`.
 */
export function sub1D242(state: GameState, entityPtr: number, rom?: RomImage): void {
  const a0 = entityPtr >>> 0;

  // ── Compute cellX/cellY via asr.l 19 ──────────────────────────────────────
  const posX = rlBE(state, a0 + OFF_POS_X);
  const cellX = asrL(posX, 0x13) & 0xffff;       // D5w
  const cellXs = sextW(cellX);                    // signed for cmp.w
  const posY = rlBE(state, a0 + OFF_POS_Y);
  const cellY = asrL(posY, 0x13) & 0xffff;       // D4w
  const cellYs = sextW(cellY);

  // ── Read cursor[0], cursor[1] (sign-extended bytes) ───────────────────────
  const cursor = rlBE(state, a0 + OFF_CURSOR);
  const targetXs = sextB(rbAbs(state, rom, cursor + 0)); // D1w sext (signed word == signed byte)
  const targetYs = sextB(rbAbs(state, rom, cursor + 1)); // D0w sext

  // ── Decide deltas D2 (Y dir) and D3 (X dir) ───────────────────────────────
  // M68k: D3b and D2b initialized to 0 via clr.b D3b/D2b.
  // Note: clr.b clears only low byte; we model as int 0 here, but the moveq
  // -8 / 8 then sign-extends to 32-bit, OVERWRITING the whole register.
  // Since later code uses move.b Dxb,D0b → ext.w → ext.l (sign-extend low
  // byte), only the LOW BYTE of D2/D3 matters. We track as signed 8-bit.
  let d3: number = 0;
  let d2: number = 0;

  // tst.l (A0); bne → Y-first path
  const velLong = rlBE(state, a0 + OFF_VX); // tst.l (A0) reads vx
  if (velLong !== 0) {
    // ── Y-first path ───────────────────────────────────────────────────────
    // cmp.w D0w,D4w; ble → 0x1D2A0 (cellY <= targetY signed)
    if (cellYs > targetYs) {
      d2 = -8;
    } else if (cellYs < targetYs) {
      d2 = 8;
    } else {
      // cellY == targetY → check X
      if (cellXs > targetXs) {
        d3 = -8;
      } else if (cellXs < targetXs) {
        d3 = 8;
      }
      // else: both 0
    }
  } else {
    // ── X-first path ───────────────────────────────────────────────────────
    if (cellXs > targetXs) {
      d3 = -8;
    } else if (cellXs < targetXs) {
      d3 = 8;
    } else {
      // cellX == targetX → check Y
      if (cellYs > targetYs) {
        d2 = -8;
      } else if (cellYs < targetYs) {
        d2 = 8;
      }
      // else: both 0
    }
  }

  // ── Choose anim ptr based on D2/D3 (signed byte tests) ────────────────────
  // tst.b D2b; ble → 0x1D2C4 (D2 <= 0 signed byte)
  // tst.b D2b; bge → 0x1D2D2 (D2 >= 0)
  // tst.b D3b; ble → 0x1D2E0 (D3 <= 0)
  // else fall-through → 0x20F24
  let animPtr: number;
  if (d2 > 0) {
    animPtr = ANIM_SOUTH;
  } else if (d2 < 0) {
    animPtr = ANIM_NORTH;
  } else {
    // d2 == 0
    if (d3 > 0) {
      animPtr = ANIM_EAST;
    } else {
      animPtr = ANIM_WEST; // d3 <= 0 (including d3 == 0)
    }
  }

  // ── Write velocities: vx = sext_l(D3) << 16; vy = sext_l(D2) << 16 ────────
  // m68k: move.b Dxb,D0b ; ext.w D0w ; ext.l D0 ; move.l D0,D1 ; moveq 0x10,D0 ; asl.l D0,D1.
  // asl.l count=16 of signed value (-8..8) → safe in JS number (<<= 16 OK).
  const vx = ((d3 & 0xff) << 24) >> 8; // sign-extend low byte then asl<<16 = byte * 0x10000
  // Equivalent: sextB(d3 & 0xff) << 16. Both correct.
  const vy = ((d2 & 0xff) << 24) >> 8;
  wlBE(state, a0 + OFF_VX, vx >>> 0);
  wlBE(state, a0 + OFF_VY, vy >>> 0);

  // ── Set anim ptrs + reset counters ────────────────────────────────────────
  // move.l #anim,(0x3e,A0)
  wlBE(state, a0 + OFF_ANIM_NEXT, animPtr);
  wlBE(state, a0 + OFF_ANIM_PREV, animPtr);
  // clr.b (0x24,A0)
  wb(state, a0 + OFF_COUNTER24, 0);
  // move.b #2,(0x25,A0)
  wb(state, a0 + OFF_STATE25, 2);

  // ── Scan loop @ 0x1D31C-0x1D358 ───────────────────────────────────────────
  // clr.b D1b; bra 0x1D34E (loop check)
  // 0x1D34E: move.b D1b,D0b; ext.w D0w; cmp.w (0x400396),D0w; bne → 0x1D320
  // 0x1D320: cmpi.b #1,(0x18,A1); bne → next; ...; addi.l #0xE2,A1; D1++; loop
  //
  // Semantica: for (d1 = 0; d1 < limit; d1++) { if (match) { state25=1; break; } a1 += 0xE2; }
  // Edge case: if limit == 0 at first check (D1=0, mem=0): cmp.w 0,0 -> eq -> SKIP loop entry -> fall through to 0x1D35A (rts).
  const loopLimit = rwBE(state, LOOP_LIMIT_ADDR);
  const limitSigned = sextW(loopLimit);
  let a1 = SCAN_BASE;
  // m68k loop uses cmp.w (mem),D0w, which computes D0w - mem (signed).
  for (let d1 = 0; ; d1++) {
    // Loop check: D0w = sext_w(D1b); cmp.w (0x400396), D0w; bne → enter loop body
    const d1AsByte = d1 & 0xff;
    const d0AsWord = sextB(d1AsByte) & 0xffff; // ext.w of byte D1b
    if (d0AsWord === loopLimit) break;
    // wrappa a 256. If limit > 256 il loop diventa effettivamente infinito
    if (d1 > 4096) break;
    void limitSigned;

    // ── Loop body @ 0x1D320 ─────────────────────────────────────────────────
    // cmpi.b #1,(0x18,A1); bne → next
    if (rb(state, a1 + OFF_OTHER_ACTIVE) === 1) {
      // move.b (0x1B,A0),D0b; cmp.b (0x1B,A1),D0b; bne → next
      const selfKey = rb(state, a0 + OFF_SCAN_KEY);
      const otherKey = rb(state, a1 + OFF_SCAN_KEY);
      if (selfKey === otherKey) {
        // cmpi.b #6,(0x1B,A1); bne → next
        if (otherKey === 6) {
          // match! move.b #1,(0x25,A0); bra 0x1D35A (rts)
          wb(state, a0 + OFF_STATE25, 1);
          return;
        }
      }
    }

    // next: A1 += 0xE2
    a1 = (a1 + SCAN_STRIDE) >>> 0;
  }
}
