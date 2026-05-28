/**
 * string-step-1725a.ts - `FUN_0001725A` replica (38 bytes).
 *
 * slot:
 *
 *   2. Increment frame counter slot+0x24. If it does not reach threshold
 *      slot+0x25, dispatch only to `computeSpriteCoords_v3` (FUN_1778E) and exit.
 *   3. Reset slot+0x24, normalize slot+0x25 to [0,2].
 *   4. Advance cursor slot+0x3A by 4 bytes. If the new entry points to 0xFFFFFFFF
 *      (terminator), reload from slot+0x3E (loop start) and apply delta vel->pos
 *      (slot+0x0C += slot+0x00, slot+0x10 += slot+0x04).
 *
 *   - Cursor address `slot+0x3A` points to a ROM table (4-byte string animation
 *     records). cmp.l (a0) must read from ROM when a0 < 0x80000.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { entityWaypointStep1D1EC } from "./entity-waypoint-step-1d1ec.js";
import { computeSpriteCoords_v3 } from "./sprite-coords.js";

const WORK_RAM_BASE = 0x400000;

function rb(buf: Uint8Array, o: number): number {
  return (buf[o] ?? 0) & 0xff;
}
function rl(buf: Uint8Array, o: number): number {
  return (
    (((buf[o] ?? 0) << 24) |
      ((buf[o + 1] ?? 0) << 16) |
      ((buf[o + 2] ?? 0) << 8) |
      (buf[o + 3] ?? 0)) >>>
    0
  );
}
function wb(buf: Uint8Array, o: number, v: number): void {
  buf[o] = v & 0xff;
}
function wl(buf: Uint8Array, o: number, v: number): void {
  const u = v >>> 0;
  buf[o] = (u >>> 24) & 0xff;
  buf[o + 1] = (u >>> 16) & 0xff;
  buf[o + 2] = (u >>> 8) & 0xff;
  buf[o + 3] = u & 0xff;
}

/**
 *
 * @param state    GameState (mutates slotPtr bytes in place).
 *                 Valid range: workRam (0x400000..0x401FFF).
 *                 Conservative.
 */
export function stringStep1725A(
  state: GameState,
  slotPtr: number,
  rom?: RomImage,
): void {
  const r = state.workRam;
  const off = (slotPtr - WORK_RAM_BASE) >>> 0;

  // 0x017260: tst.b 0x18(a2); beq → end
  if (rb(r, off + 0x18) === 0) return;

  // 0x017268: addq.b #1, 0x24(a2)
  wb(r, off + 0x24, rb(r, off + 0x24) + 1);

  // 0x01726c..0x017274: move.b 0x25(a2), D0; cmp.b 0x24(a2), D0; bgt → 172b4
  const sx8 = (v: number): number => (v & 0x80 ? v - 0x100 : v);
  const d0_25 = sx8(rb(r, off + 0x25));
  const c24 = sx8(rb(r, off + 0x24));
  if (d0_25 > c24) {
    // 0x172b4: jsr 1778E + return
    computeSpriteCoords_v3(state, slotPtr);
    return;
  }

  // 0x017276: clr.b 0x24(a2)
  wb(r, off + 0x24, 0);

  // 0x01727a..0x017282: cmpi.b #2, 0x25(a2); ble → 17288; else 0x25 = 1
  const c25s = sx8(rb(r, off + 0x25));
  if (c25s > 2) {
    wb(r, off + 0x25, 1);
  }

  // 0x017288: addq.l #4, 0x3a(a2)  — long add (4 byte)
  const new3a = (rl(r, off + 0x3a) + 4) >>> 0;
  wl(r, off + 0x3a, new3a);

  // 0x01728c..0x017294: A0 = *0x3a; cmp.l (A0), 0xFFFFFFFF; bne → 172b4
  let valAtA0: number;
  if (new3a < 0x80000) {
    if (rom !== undefined) {
      valAtA0 = (
        (((rom.program[new3a] ?? 0) << 24) |
          ((rom.program[new3a + 1] ?? 0) << 16) |
          ((rom.program[new3a + 2] ?? 0) << 8) |
          (rom.program[new3a + 3] ?? 0)) >>>
        0
      );
    } else {
      valAtA0 = 0; // bne path (= != 0xFFFFFFFF)
    }
  } else if (new3a >= WORK_RAM_BASE && new3a < WORK_RAM_BASE + 0x2000) {
    valAtA0 = rl(r, new3a - WORK_RAM_BASE);
  } else {
    valAtA0 = 0;
  }

  if (valAtA0 !== 0xffffffff) {
    // 0x172b4: jsr 1778E + return
    computeSpriteCoords_v3(state, slotPtr);
    return;
  }

  // 0x017296: move.l 0x3e(a2), 0x3a(a2)  — reload cursor da loop-start
  wl(r, off + 0x3a, rl(r, off + 0x3e));

  // 0x01729c..0x0172a6: 0x0c += 0x00; 0x10 += 0x04
  const sx = rl(r, off + 0x00);
  wl(r, off + 0x0c, (rl(r, off + 0x0c) + sx) >>> 0);
  const sy = rl(r, off + 0x04);
  wl(r, off + 0x10, (rl(r, off + 0x10) + sy) >>> 0);

  // 0x0172aa: jsr 1D1EC(slotPtr)
  entityWaypointStep1D1EC(state, slotPtr, undefined, rom);

  // 0x0172b4: jsr 1778E(slotPtr)
  computeSpriteCoords_v3(state, slotPtr);
}

export const STRING_STEP_1725A_ADDR = 0x0001725a as const;
