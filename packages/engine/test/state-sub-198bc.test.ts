/**
 * state-sub-198bc.test.ts — smoke tests per `FUN_000198BC`.
 *
 * Verifica:
 *   1. early_marker: entity[0x26] == 0x10 → no-op (no JSR call).
 *   2. first_invalid: 1° validate ritorna 0 → pos restored, no loop.
 *   3. loop_exhausted_stuck: validate sempre 1 → 9 iter, stuck marker.
 *   4. loop_invalid: validate falla a metà loop → pos restored.
 *   5. state==7 step=1 vs state!=7 step=4: numero di apply differente.
 */

import { describe, it, expect } from "vitest";
import { stateSub198BC } from "../src/state-sub-198bc.js";
import type { StateSub198BCSubs } from "../src/state-sub-198bc.js";
import { emptyGameState } from "../src/state.js";
import type { GameState } from "../src/state.js";

const ENTITY_BASE = 0x401e00;
const ENTITY_OFF = ENTITY_BASE - 0x400000;

function setByte(s: GameState, off: number, v: number): void {
  s.workRam[off] = v & 0xff;
}

function readByte(s: GameState, off: number): number {
  return (s.workRam[off] ?? 0) & 0xff;
}

function readLongBE(s: GameState, off: number): number {
  return (
    ((s.workRam[off] ?? 0) << 24) |
    ((s.workRam[off + 1] ?? 0) << 16) |
    ((s.workRam[off + 2] ?? 0) << 8) |
    (s.workRam[off + 3] ?? 0)
  ) >>> 0;
}

function setLongBE(s: GameState, off: number, v: number): void {
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

describe("stateSub198BC (FUN_000198BC)", () => {
  it("early_marker: entity[0x26] == 0x10 → no-op, nessuna JSR", () => {
    const s = emptyGameState();
    setByte(s, ENTITY_OFF + 0x25, 0x05);
    setByte(s, ENTITY_OFF + 0x26, 0x10);
    setLongBE(s, ENTITY_OFF + 0x0c, 0xdeadbeef);
    setLongBE(s, ENTITY_OFF + 0x10, 0xcafebabe);

    let moveCalled = 0;
    let validateCalled = 0;
    const r = stateSub198BC(s, ENTITY_BASE, {
      fun_19976: () => {
        moveCalled++;
      },
      fun_1937c: () => {
        validateCalled++;
        return 1;
      },
    });

    expect(r.outcome).toBe("early_marker");
    expect(r.moveCalls).toBe(0);
    expect(r.validateCalls).toBe(0);
    expect(moveCalled).toBe(0);
    expect(validateCalled).toBe(0);
    expect(r.finalCounter).toBe(0x10);
    // Posizione invariata.
    expect(readLongBE(s, ENTITY_OFF + 0x0c)).toBe(0xdeadbeef);
    expect(readLongBE(s, ENTITY_OFF + 0x10)).toBe(0xcafebabe);
  });

  it("first_invalid: 1° validate=0 → pos restored, return; entity[0x26] invariato", () => {
    const s = emptyGameState();
    setByte(s, ENTITY_OFF + 0x25, 0x03);
    setByte(s, ENTITY_OFF + 0x26, 0x07);
    setLongBE(s, ENTITY_OFF + 0x0c, 0x11223344);
    setLongBE(s, ENTITY_OFF + 0x10, 0x55667788);

    const subs: StateSub198BCSubs = {
      // Move scrive un valore "movente" sulle posizioni.
      fun_19976: (st, addr) => {
        const o = addr - 0x400000;
        st.workRam[o + 0x0c] = 0xff;
        st.workRam[o + 0x10] = 0xff;
      },
      // Validate ritorna 0 (invalid).
      fun_1937c: () => 0,
    };
    const r = stateSub198BC(s, ENTITY_BASE, subs);

    expect(r.outcome).toBe("first_invalid");
    expect(r.moveCalls).toBe(1);
    expect(r.validateCalls).toBe(1);
    // Posizione ripristinata all'originale.
    expect(readLongBE(s, ENTITY_OFF + 0x0c)).toBe(0x11223344);
    expect(readLongBE(s, ENTITY_OFF + 0x10)).toBe(0x55667788);
    // entity[0x26] invariato (no decremento eseguito).
    expect(readByte(s, ENTITY_OFF + 0x26)).toBe(0x07);
  });

  it("loop_exhausted_stuck (state==7 → step=1): validate sempre 1 → 9 iter, marker 0x10, long0/1=0", () => {
    const s = emptyGameState();
    setByte(s, ENTITY_OFF + 0x25, 0x07); // step = 1
    setByte(s, ENTITY_OFF + 0x26, 0x05); // dir originale
    setLongBE(s, ENTITY_OFF + 0x00, 0xaabbccdd);
    setLongBE(s, ENTITY_OFF + 0x04, 0x11223344);
    setLongBE(s, ENTITY_OFF + 0x0c, 0xdeadbeef);
    setLongBE(s, ENTITY_OFF + 0x10, 0xcafebabe);

    let moveCalled = 0;
    let validateCalled = 0;
    const r = stateSub198BC(s, ENTITY_BASE, {
      fun_19976: () => {
        moveCalled++;
      },
      fun_1937c: () => {
        validateCalled++;
        return 1; // sempre valido
      },
    });

    expect(r.outcome).toBe("loop_exhausted_stuck");
    expect(r.iters).toBe(9);
    expect(r.originalDir).toBe(0x05);
    // entity[0x26] = 0x10.
    expect(readByte(s, ENTITY_OFF + 0x26)).toBe(0x10);
    // long0, long1 azzerati.
    expect(readLongBE(s, ENTITY_OFF + 0x00)).toBe(0);
    expect(readLongBE(s, ENTITY_OFF + 0x04)).toBe(0);
    // Posizione ripristinata.
    expect(readLongBE(s, ENTITY_OFF + 0x0c)).toBe(0xdeadbeef);
    expect(readLongBE(s, ENTITY_OFF + 0x10)).toBe(0xcafebabe);
    // state==7: step=1 → apply ogni iter (9 iter), MA cycle skip quando dir
    // torna a originale. dir originale=5, predec=5-4=1, poi +1 ogni iter:
    // iter 0: 1+1=2 (≠5, apply), iter 1: 2+1=3 (≠5, apply), iter 2: 3+1=4
    // (≠5, apply), iter 3: 4+1=5 (==5 → skip), iter 4: 5+1=6 (≠5, apply),
    // ..., iter 8: 9+1=10&0xF=10 (≠5, apply). Total apply moveCalls = 1
    // (first) + 8 (loop con 1 cycle skip) = 9.
    expect(moveCalled).toBe(9);
    expect(validateCalled).toBe(9);
    expect(r.moveCalls).toBe(9);
    expect(r.validateCalls).toBe(9);
  });

  it("loop_exhausted_stuck (state!=7 → step=4): validate sempre 1 → 9 iter ma solo iter 0,4,8 apply", () => {
    const s = emptyGameState();
    setByte(s, ENTITY_OFF + 0x25, 0x03); // step = 4
    setByte(s, ENTITY_OFF + 0x26, 0x08); // dir originale
    setLongBE(s, ENTITY_OFF + 0x0c, 0x12345678);
    setLongBE(s, ENTITY_OFF + 0x10, 0x9abcdef0);

    let moveCalled = 0;
    const r = stateSub198BC(s, ENTITY_BASE, {
      fun_19976: () => {
        moveCalled++;
      },
      fun_1937c: () => 1,
    });

    expect(r.outcome).toBe("loop_exhausted_stuck");
    expect(r.iters).toBe(9);
    // step=4: predec 8-4=4, poi iter 0: 4+4=8 (==orig 8 → skip), iter 4: 8+4=12
    // (≠8, apply), iter 8: 12+4=16&0xF=0 (≠8, apply). Total apply moveCalls
    // = 1 (first) + 2 (loop iter 4 e 8) = 3.
    expect(moveCalled).toBe(3);
    expect(r.moveCalls).toBe(3);
    // entity[0x26] finale = 0x10 (stuck marker).
    expect(readByte(s, ENTITY_OFF + 0x26)).toBe(0x10);
  });

  it("loop_invalid: 1° validate=1, 2° validate (in loop) = 0 → pos restored, return", () => {
    const s = emptyGameState();
    setByte(s, ENTITY_OFF + 0x25, 0x07); // step=1, apply ogni iter
    setByte(s, ENTITY_OFF + 0x26, 0x09); // dir originale
    setLongBE(s, ENTITY_OFF + 0x0c, 0xaaaaaaaa);
    setLongBE(s, ENTITY_OFF + 0x10, 0xbbbbbbbb);

    let validateCount = 0;
    // Sequenza ritorno: [1, 1, 0, ...] → 1° valido, 2° valido, 3° invalido.
    const validateRet = [1, 1, 0];
    const r = stateSub198BC(s, ENTITY_BASE, {
      fun_19976: (st, addr) => {
        // Simula spostamento (sovrascrive pos).
        const o = addr - 0x400000;
        st.workRam[o + 0x0c] = 0xcc;
        st.workRam[o + 0x10] = 0xdd;
      },
      fun_1937c: () => {
        const v = validateRet[validateCount] ?? 0;
        validateCount++;
        return v;
      },
    });

    expect(r.outcome).toBe("loop_invalid");
    expect(r.validateCalls).toBe(3);
    // Posizione ripristinata.
    expect(readLongBE(s, ENTITY_OFF + 0x0c)).toBe(0xaaaaaaaa);
    expect(readLongBE(s, ENTITY_OFF + 0x10)).toBe(0xbbbbbbbb);
    // originalDir salvato correttamente.
    expect(r.originalDir).toBe(0x09);
  });

  it("subs assenti: default fun_19976 no-op + fun_1937c=0 → first_invalid path (no JSR effects)", () => {
    const s = emptyGameState();
    setByte(s, ENTITY_OFF + 0x25, 0x02);
    setByte(s, ENTITY_OFF + 0x26, 0x06);
    setLongBE(s, ENTITY_OFF + 0x0c, 0xdeadc0de);
    expect(() => stateSub198BC(s, ENTITY_BASE)).not.toThrow();
    const r = stateSub198BC(s, ENTITY_BASE);
    // Default fun_1937c ritorna 0 → first_invalid.
    expect(r.outcome).toBe("first_invalid");
    // Pos invariata (sub default no-op + restore).
    expect(readLongBE(s, ENTITY_OFF + 0x0c)).toBe(0xdeadc0de);
  });
});
