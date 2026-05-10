/**
 * string-step-1725a.ts — replica `FUN_0001725A` (38 byte).
 *
 * "String animation step": chiamato da `dispatchStrings17230` per ognuno dei
 * 7 slot stringa @ workRam[0x401482..]. Avanza l'animazione di un singolo
 * slot:
 *
 *   1. Skip se slot+0x18 == 0 (slot vuoto).
 *   2. Incrementa frame counter slot+0x24. Se non raggiunge soglia slot+0x25,
 *      dispatcha solo a `computeSpriteCoords_v3` (FUN_1778E) ed esce.
 *   3. Reset slot+0x24, normalizza slot+0x25 a [0,2].
 *   4. Avanza il cursor slot+0x3A di 4 byte. Se la nuova entry punta a 0xFFFFFFFF
 *      (terminator), reload da slot+0x3E (loop start) e applica delta vel→pos
 *      (slot+0x0C += slot+0x00, slot+0x10 += slot+0x04).
 *   5. Se il loop è scattato → chiama `entityWaypointStep1D1EC` (FUN_1D1EC).
 *   6. Sempre: chiama `computeSpriteCoords_v3` (FUN_1778E) come step finale.
 *
 * **Note bit-perfect**:
 *   - L'address del cursor `slot+0x3A` punta a una table ROM (string animation
 *     records 4-byte). La cmp.l (a0) deve leggere da ROM se a0 < 0x80000.
 *   - Il valore `D0=0xFFFFFFFF` (moveq #-1) è il marker terminator.
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
 * Replica bit-perfect di `FUN_0001725A`.
 *
 * @param state    GameState (mutato in-place sui byte del slotPtr).
 * @param slotPtr  Indirizzo assoluto M68k del slot (es. 0x401482).
 *                 Range valido: workRam (0x400000..0x401FFF).
 * @param rom      Optional RomImage per leggere il valore @ cursor (slot+0x3A
 *                 può puntare a ROM table). Se omesso e cursor punta a ROM,
 *                 la cmp produce sempre `bne` (= != 0xFFFFFFFF) — comportamento
 *                 conservativo.
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
  // bgt signed: salta se D0 > slot+0x24 (signed byte).
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
  // *A0 può puntare a ROM (string animation records).
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
  entityWaypointStep1D1EC(state, slotPtr);

  // 0x0172b4: jsr 1778E(slotPtr)
  computeSpriteCoords_v3(state, slotPtr);
}

export const STRING_STEP_1725A_ADDR = 0x0001725a as const;
