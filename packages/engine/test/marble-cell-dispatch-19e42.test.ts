/**
 * marble-cell-dispatch-19e42.test.ts — smoke tests per `FUN_00019E42`.
 *
 * Verifica:
 *   1. Pre-jsr side effects: copia POS_X/POS_Y dall'entity e scrive packed
 *      long a `entity[0x20]`. Sempre, indipendentemente dal ramo.
 *   2. Branch HIT (cellX ∈ {0x29, 0x31, 0x39} AND cellY signed >= 0x34):
 *      chiama `inner264AA(entity, 3)` esattamente 1 volta, NIENTE clear.
 *   3. Branch MISS (cellX non in set OR cellY < 0x34): azzera 3 word a
 *      `entity[0x26], [0x2C], [0x32]`, NESSUNA chiamata a inner.
 *   4. Boundary cellY = 0x34 → HIT (blt è strict less-than).
 *   5. Boundary cellY = 0x33 (signed) → MISS.
 *   6. Subs assente → no crash, ramo HIT non chiama nulla.
 */

import { describe, it, expect } from "vitest";
import {
  marbleCellDispatch19E42,
  POS_X_WORD_OFF,
  POS_Y_WORD_OFF,
  HUD_OFFSET_WORD_OFF,
  ENTITY_PACKED_OFF,
  ENTITY_CLEAR_BASE_OFF,
  CLEAR_STRIDE,
  CLEAR_COUNT,
  INNER_MODE,
  HIT_CELLX_SET,
  HIT_CELLY_THRESHOLD,
} from "../src/marble-cell-dispatch-19e42.js";
import { emptyGameState } from "../src/state.js";

const ENTITY_BASE = 0x401400;
const ENTITY_OFF = ENTITY_BASE - 0x400000;

type State = ReturnType<typeof emptyGameState>;

function setWordBE(s: State, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}
function readWordBE(s: State, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}
function readLongBE(s: State, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

/**
 * Setup minimo: hud=0, entity x/y/w4 forniti, resto del workRam vergine.
 * Entity.x = `cellX << 3` per ottenere il cellX desiderato dopo `asr.w #3`.
 * Entity.y = `cellY << 3` analogamente.
 */
function setupEntity(
  s: State,
  cellXTarget: number,
  cellYTarget: number,
  hud = 0,
  w4 = 0,
): void {
  const x = (cellXTarget << 3) & 0xffff;
  const y = (cellYTarget << 3) & 0xffff;
  setWordBE(s, ENTITY_OFF + 0x0c, x);
  setWordBE(s, ENTITY_OFF + 0x10, y);
  setWordBE(s, ENTITY_OFF + 0x14, w4 & 0xffff);
  setWordBE(s, HUD_OFFSET_WORD_OFF, hud & 0xffff);
}

describe("marbleCellDispatch19E42 (FUN_00019E42)", () => {
  it("pre-jsr side effects: copia POS_X/POS_Y e scrive packed @ entity[0x20]", () => {
    const s = emptyGameState();
    // entity.x = 0x100, entity.y = 0x80, w4 = 0x10, hud = 0x40.
    // cellX = 0x20 (non in set) → MISS branch (clear loop).
    setWordBE(s, ENTITY_OFF + 0x0c, 0x0100);
    setWordBE(s, ENTITY_OFF + 0x10, 0x0080);
    setWordBE(s, ENTITY_OFF + 0x14, 0x0010);
    setWordBE(s, HUD_OFFSET_WORD_OFF, 0x0040);
    // Non-zero placeholder a 0x26, 0x2C, 0x32 per verificare che vengano azzerati.
    setWordBE(s, ENTITY_OFF + 0x26, 0xdead);
    setWordBE(s, ENTITY_OFF + 0x2c, 0xbeef);
    setWordBE(s, ENTITY_OFF + 0x32, 0xface);

    const r = marbleCellDispatch19E42(s, ENTITY_BASE);

    // Globals POS_X/POS_Y copiati dall'entity.
    expect(readWordBE(s, POS_X_WORD_OFF)).toBe(0x0100);
    expect(readWordBE(s, POS_Y_WORD_OFF)).toBe(0x0080);

    // packed long calculation:
    //   posY=0x80, posX=0x100 → yMinusX = (0x80 - 0x100 + 0x88) & 0xffff
    //                          = (-0x80 + 0x88) & 0xffff = 0x8 & 0xffff = 0x0008
    //   hud=0x40, w4=0x10 → d2w_pre = 0x40 + 0x10 + 0x54 = 0xA4
    //   yS=0x80, xS=0x100 → avg = (0x80 + 0x100) >> 1 = 0xC0
    //   d2w = (0xA4 - 0xC0) & 0xffff = 0xFFE4
    //   packed = (0x0008 << 16) | 0xFFE4 = 0x0008FFE4
    expect(readLongBE(s, ENTITY_OFF + ENTITY_PACKED_OFF)).toBe(0x0008ffe4);

    // MISS branch confermato.
    expect(r.branch).toBe("miss");
    expect(r.innerCalls).toBe(0);
    expect(r.cellX).toBe(0x20);

    // I 3 word del clear loop sono stati azzerati.
    for (let i = 0; i < CLEAR_COUNT; i++) {
      expect(readWordBE(s, ENTITY_OFF + ENTITY_CLEAR_BASE_OFF + i * CLEAR_STRIDE)).toBe(
        0,
      );
    }
  });

  it("HIT: cellX=0x29 + cellY=0x40 → inner264AA chiamato con (entity, 3), niente clear", () => {
    const s = emptyGameState();
    setupEntity(s, 0x29, 0x40);
    // Placeholder non azzerati pre-call.
    setWordBE(s, ENTITY_OFF + 0x26, 0xa5a5);
    setWordBE(s, ENTITY_OFF + 0x2c, 0x5a5a);
    setWordBE(s, ENTITY_OFF + 0x32, 0xc3c3);

    const innerArgs: { p: number; m: number }[] = [];
    const r = marbleCellDispatch19E42(s, ENTITY_BASE, {
      inner264AA: (p, m) => {
        innerArgs.push({ p, m });
        return 0xdeadbeef;
      },
    });

    expect(r.branch).toBe("hit");
    expect(r.cellX).toBe(0x29);
    expect(r.cellY).toBe(0x40);
    expect(r.innerCalls).toBe(1);
    expect(r.innerReturn).toBe(0xdeadbeef);
    expect(innerArgs).toEqual([{ p: ENTITY_BASE, m: INNER_MODE }]);

    // I 3 word NON devono essere azzerati nel ramo HIT.
    expect(readWordBE(s, ENTITY_OFF + 0x26)).toBe(0xa5a5);
    expect(readWordBE(s, ENTITY_OFF + 0x2c)).toBe(0x5a5a);
    expect(readWordBE(s, ENTITY_OFF + 0x32)).toBe(0xc3c3);
  });

  it("HIT: tutti i cellX ammessi (0x29, 0x31, 0x39) con cellY ok → branch hit", () => {
    for (const cx of HIT_CELLX_SET) {
      const s = emptyGameState();
      setupEntity(s, cx, 0x50);
      let calls = 0;
      const r = marbleCellDispatch19E42(s, ENTITY_BASE, {
        inner264AA: () => {
          calls++;
          return 0;
        },
      });
      expect(r.branch).toBe("hit");
      expect(r.cellX).toBe(cx);
      expect(calls).toBe(1);
    }
  });

  it("MISS: cellX non in set (0x28) → clear loop, niente inner", () => {
    const s = emptyGameState();
    setupEntity(s, 0x28, 0x50);
    let calls = 0;
    const r = marbleCellDispatch19E42(s, ENTITY_BASE, {
      inner264AA: () => {
        calls++;
        return 0;
      },
    });
    expect(r.branch).toBe("miss");
    expect(calls).toBe(0);
    // entity[0x26], [0x2C], [0x32] = 0
    for (let i = 0; i < CLEAR_COUNT; i++) {
      expect(readWordBE(s, ENTITY_OFF + ENTITY_CLEAR_BASE_OFF + i * CLEAR_STRIDE)).toBe(
        0,
      );
    }
  });

  it("boundary cellY = HIT_CELLY_THRESHOLD (0x34) → HIT (blt è strict)", () => {
    const s = emptyGameState();
    setupEntity(s, 0x31, HIT_CELLY_THRESHOLD);
    let calls = 0;
    const r = marbleCellDispatch19E42(s, ENTITY_BASE, {
      inner264AA: () => {
        calls++;
        return 0;
      },
    });
    expect(r.branch).toBe("hit");
    expect(r.cellY).toBe(HIT_CELLY_THRESHOLD);
    expect(calls).toBe(1);
  });

  it("boundary cellY = 0x33 → MISS (signed less-than threshold)", () => {
    const s = emptyGameState();
    setupEntity(s, 0x31, 0x33);
    const r = marbleCellDispatch19E42(s, ENTITY_BASE);
    expect(r.branch).toBe("miss");
    expect(r.cellY).toBe(0x33);
  });

  it("MISS: cellY signed-negativo (es. 0xC0 = -64) anche con cellX ok", () => {
    const s = emptyGameState();
    // entity.y = -1 word (0xFFFF). asr.w #3 di 0xFFFF = 0xFFFF (signed -1).
    // low byte = 0xFF (signed -1) < 0x34 → MISS.
    setWordBE(s, ENTITY_OFF + 0x0c, 0x29 << 3);
    setWordBE(s, ENTITY_OFF + 0x10, 0xffff);
    setWordBE(s, ENTITY_OFF + 0x14, 0);
    const r = marbleCellDispatch19E42(s, ENTITY_BASE);
    expect(r.branch).toBe("miss");
    expect(r.cellY).toBe(0xff);
  });

  it("subs assente → no crash, ramo HIT non chiama nulla (innerCalls=0)", () => {
    const s = emptyGameState();
    setupEntity(s, 0x39, 0x40);
    expect(() => marbleCellDispatch19E42(s, ENTITY_BASE)).not.toThrow();
    const s2 = emptyGameState();
    setupEntity(s2, 0x39, 0x40);
    const r = marbleCellDispatch19E42(s2, ENTITY_BASE);
    expect(r.branch).toBe("hit");
    expect(r.innerCalls).toBe(0);
    expect(r.innerReturn).toBe(0);
  });

  it("MISS: cellX = 0x29 ma cellY = 0x33 → blt → MISS (clear loop)", () => {
    const s = emptyGameState();
    setupEntity(s, 0x29, 0x33);
    setWordBE(s, ENTITY_OFF + 0x26, 0x1111);
    setWordBE(s, ENTITY_OFF + 0x2c, 0x2222);
    setWordBE(s, ENTITY_OFF + 0x32, 0x3333);
    const r = marbleCellDispatch19E42(s, ENTITY_BASE);
    expect(r.branch).toBe("miss");
    expect(readWordBE(s, ENTITY_OFF + 0x26)).toBe(0);
    expect(readWordBE(s, ENTITY_OFF + 0x2c)).toBe(0);
    expect(readWordBE(s, ENTITY_OFF + 0x32)).toBe(0);
  });
});
