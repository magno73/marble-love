/**
 * helper-1924e.ts — replica `FUN_0001924E` (~80 istruzioni).
 *
 * "Collision/proximity dispatcher": chiamato da helper121B8 per gli obj che
 * passano il filtro game-mode. Itera 9 obj @ workRam[0x401890] (stride 0x28),
 * per ognuno calcola la distanza Manhattan vs il marble (*0x400690/0x400692),
 * e se sotto soglia attiva una sequenza di event:
 *   - obj.state = 2
 *   - obj.vx = obj.vy = 0
 *   - jsr objectTypeDispatch194BA(obj)
 *   - dispatch sound (cmd dipende da obj+0x25: 9→0x5C+ROM_PTR, 7→0x5B+PTR, else 0x5A)
 *   - entity.+0x6a += 3
 *   - jsr helper285B0(entity, 0x0E)
 *   - jsr addToObjectAccumAndFlag28608(entity, 0x1F4)
 *
 * **Pre-conditions**:
 *   - Skip se *0x400394 != 4 (game mode)
 *   - Skip se entity+0x1B != 1
 *
 * Verifica: il binario ha 80 istruzioni totali. Replica testata via parity test
 * scenari mirati (cli/src/test-helper-1924e-parity.ts) — TBD.
 */

import type { GameState } from "./state.js";
import { objectTypeDispatch194BA } from "./object-type-dispatch-194ba.js";
import { soundCmdSend158AC } from "./sound-cmd-send-158ac.js";
import { helper285B0 } from "./helper-285b0.js";

const WORK_RAM_BASE = 0x400000;
const OBJ_ITER_BASE = 0x401890;
const OBJ_ITER_STRIDE = 0x28;
const OBJ_ITER_COUNT = 9;
const G_MODE_OFF = 0x394;
const G_X_OFF = 0x690;
const G_Y_OFF = 0x692;

function rb(buf: Uint8Array, o: number): number {
  return (buf[o] ?? 0) & 0xff;
}
function rw(buf: Uint8Array, o: number): number {
  return (((buf[o] ?? 0) << 8) | (buf[o + 1] ?? 0)) & 0xffff;
}
function wb(buf: Uint8Array, o: number, v: number): void {
  buf[o] = v & 0xff;
}
function ww(buf: Uint8Array, o: number, v: number): void {
  buf[o] = (v >>> 8) & 0xff;
  buf[o + 1] = v & 0xff;
}
function wl(buf: Uint8Array, o: number, v: number): void {
  const u = v >>> 0;
  buf[o] = (u >>> 24) & 0xff;
  buf[o + 1] = (u >>> 16) & 0xff;
  buf[o + 2] = (u >>> 8) & 0xff;
  buf[o + 3] = u & 0xff;
}
function sx16(v: number): number {
  return v & 0x8000 ? v - 0x10000 : v;
}

/**
 * `addToObjectAccumAndFlag28608(state, objAddr, value)` — replica FUN_28608.
 *
 * Pseudo:
 *   *(obj+0xBC).l += sign_extend(value.w)
 *   type = obj+0x19
 *   if (type < 32) *0x40039C |= (1 << type)
 *
 * Inlinata in object-helpers.ts:triggerObjectEvent — qui esposta come
 * standalone per uso da helper-1924e.
 */
function addToObjectAccumAndFlag28608(
  state: GameState,
  objAddr: number,
  valueWord: number,
): void {
  const r = state.workRam;
  const objOff = (objAddr - WORK_RAM_BASE) >>> 0;
  const accumOff = objOff + 0xbc;
  const old =
    (((r[accumOff] ?? 0) << 24) |
      ((r[accumOff + 1] ?? 0) << 16) |
      ((r[accumOff + 2] ?? 0) << 8) |
      (r[accumOff + 3] ?? 0)) >>>
    0;
  const newAccum = (old + sx16(valueWord & 0xffff)) >>> 0;
  wl(r, accumOff, newAccum);
  const type = rb(r, objOff + 0x19);
  if (type < 32) {
    const mask = (1 << type) >>> 0;
    r[0x39c] = (rb(r, 0x39c) | (mask & 0xff)) & 0xff;
  }
}

/**
 * Replica bit-perfect di `FUN_0001924E`.
 *
 * @param state    GameState (`workRam` mutato).
 * @param entityAddr  Indirizzo abs M68k della entity (parametro stack arg).
 */
export function helper1924E(
  state: GameState,
  entityAddr: number,
): void {
  const r = state.workRam;
  const a2Off = (entityAddr - WORK_RAM_BASE) >>> 0;

  // 0x019256: cmp.w *0x400394, #4 — game mode check
  if (rw(r, G_MODE_OFF) !== 4) return;

  // 0x019262: cmpi.b #1, +0x1b(a2) — entity check
  if (rb(r, a2Off + 0x1b) !== 1) return;

  // 0x01926c: A3 = 0x401890 (obj iter base), D2 = 0 (counter)
  let a3Off = (OBJ_ITER_BASE - WORK_RAM_BASE) >>> 0;
  let d2 = 0;

  while (d2 < OBJ_ITER_COUNT) {
    // 0x019274: tst.b +0x18(a3); beq → next
    if (rb(r, a3Off + 0x18) === 0) {
      a3Off += OBJ_ITER_STRIDE;
      d2++;
      continue;
    }

    // 0x01927c: cmpi.b #2, +0x1a(a3); beq → next
    if (rb(r, a3Off + 0x1a) === 2) {
      a3Off += OBJ_ITER_STRIDE;
      d2++;
      continue;
    }

    // 0x019286: D1 = 4 (default); if +0x25(a3) == 7 → D1 = 5
    let d1 = 4;
    if (rb(r, a3Off + 0x25) === 7) d1 = 5;

    // 0x019292: D3 = abs(*0x400690 - +0x0c(a3)) — X distance (low word)
    const gx = sx16(rw(r, G_X_OFF));
    const ox = sx16(rw(r, a3Off + 0x0c));
    let dxRaw = (gx - ox) | 0;
    let d4: number;
    if (dxRaw < 0) {
      d4 = (-dxRaw) & 0xffff;
    } else {
      d4 = dxRaw & 0xffff;
    }

    // 0x0192b0: D3 = abs(*0x400692 - +0x10(a3)) — Y distance
    const gy = sx16(rw(r, G_Y_OFF));
    const oy = sx16(rw(r, a3Off + 0x10));
    let dyRaw = (gy - oy) | 0;
    let d3: number;
    if (dyRaw < 0) {
      d3 = (-dyRaw) & 0xffff;
    } else {
      d3 = dyRaw & 0xffff;
    }

    // 0x0192ce: cmp.w D4, D1 (sext); bls (D1<=D4 unsigned) → skip
    // 0x0192dc: cmp.w D3, D1 (sext); bls (D1<=D3 unsigned) → skip
    if (d1 <= d4 || d1 <= d3) {
      a3Off += OBJ_ITER_STRIDE;
      d2++;
      continue;
    }

    // === Collision path ===
    // 0x0192e2: +0x1a(a3) = 2
    wb(r, a3Off + 0x1a, 2);
    // 0x0192ea: +0x4(a3) = 0; (a3) = 0   (= obj.vy = 0, obj.vx = 0)
    wl(r, a3Off + 0x04, 0);
    wl(r, a3Off + 0x00, 0);

    // 0x0192f0: jsr 0x194BA(a3)  — objectTypeDispatch
    objectTypeDispatch194BA(state, (WORK_RAM_BASE + a3Off) >>> 0);

    // 0x0192f8: cmpi.b #9, +0x25(a3); bne → 0x1931a
    const ty = rb(r, a3Off + 0x25);
    if (ty === 9) {
      // 0x019302: +0x1c(a3) = 0x21efe (long ROM ptr)
      wl(r, a3Off + 0x1c, 0x21efe);
      // 0x01930a: pea 0x5c; jsr 0x158ac
      soundCmdSend158AC(state, 0x5c);
    } else if (ty === 7) {
      // 0x019322: +0x1c(a3) = 0x21f7a
      wl(r, a3Off + 0x1c, 0x21f7a);
      // 0x01932a: pea 0x5b; jsr 0x158ac
      soundCmdSend158AC(state, 0x5b);
    } else {
      // 0x01933a: pea 0x5a; jsr 0x158ac
      soundCmdSend158AC(state, 0x5a);
    }

    // 0x019348: addq.w #3, +0x6a(a2)
    ww(r, a2Off + 0x6a, (rw(r, a2Off + 0x6a) + 3) & 0xffff);

    // 0x01934c: pea 0x0e; jsr 0x285b0(a2)
    helper285B0(state, entityAddr, 0x0e);

    // 0x019358: pea 0x1f4; jsr 0x28608(a2)
    addToObjectAccumAndFlag28608(state, entityAddr, 0x1f4);

    // next iter
    a3Off += OBJ_ITER_STRIDE;
    d2++;
  }
}

export const HELPER_1924E_ADDR = 0x0001924e as const;
