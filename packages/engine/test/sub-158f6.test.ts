/**
 * sub-158f6.test.ts — smoke tests per FUN_158F6 replica.
 */
import { describe, it, expect } from "vitest";
import { fun158F6 } from "../src/sub-158f6.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const SLOT_A = 0x004009a4;
const SLOT_OFF_A = 0x09a4;

function rW(workRam: Uint8Array, off: number): number {
  return (((workRam[off] ?? 0) << 8) | (workRam[off + 1] ?? 0)) & 0xffff;
}

describe("fun158F6 (FUN_158F6)", () => {
  it("non solleva eccezioni con state vuoto e slot vuoto", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => fun158F6(s, SLOT_A, rom)).not.toThrow();
  });

  it("(0x18,A2) == 0 → early return, nessuna scrittura", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // s18 default 0 → epilog immediato
    s.workRam[SLOT_OFF_A + 0x6c] = 0x00;
    s.workRam[SLOT_OFF_A + 0x6d] = 0x05; // timer = 5
    fun158F6(s, SLOT_A, rom);
    // Timer non decrementato: epilog senza scendere in BLOCCO 1
    expect(rW(s.workRam, SLOT_OFF_A + 0x6c)).toBe(5);
  });

  it("timer @ +0x6C decrementato quando attivo (s18 != 0, t6c > 0)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[SLOT_OFF_A + 0x18] = 0x01; // attivo, ma s18 != 2 → ELSE branch
    s.workRam[SLOT_OFF_A + 0x6c] = 0x00;
    s.workRam[SLOT_OFF_A + 0x6d] = 0x05; // timer = 5 (BE word)
    s.workRam[SLOT_OFF_A + 0x1a] = 0x10; // state non 0x21/0x22/0x24 → no transition
    // Stub gli ELSE callee per evitare side-effect su workRam globale
    let elseCalled = 0;
    fun158F6(s, SLOT_A, rom, {
      helper253BC: () => { elseCalled++; },
      helper182BA: () => { elseCalled++; },
      helper121B8: () => { elseCalled++; },
    });
    expect(rW(s.workRam, SLOT_OFF_A + 0x6c)).toBe(4);
    expect(elseCalled).toBe(3);
  });

  it("transizione 0x21 → 0x23 quando timer @ +0x6C scade", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[SLOT_OFF_A + 0x18] = 0x01;
    s.workRam[SLOT_OFF_A + 0x6c] = 0x00;
    s.workRam[SLOT_OFF_A + 0x6d] = 0x01; // timer = 1, scadrà
    s.workRam[SLOT_OFF_A + 0x1a] = 0x21; // state che triggera FUN_160D4
    // FUN_160D4 default scrive 0x23 @ +0x1A e 0x70000 @ +0x68
    fun158F6(s, SLOT_A, rom, {
      helper253BC: () => {},
      helper182BA: () => {},
      helper121B8: () => {},
    });
    // Dopo: timer = 0, state = 0x23
    expect(rW(s.workRam, SLOT_OFF_A + 0x6c)).toBe(0);
    expect(s.workRam[SLOT_OFF_A + 0x1a]).toBe(0x23);
    // Long timer @ +0x68 = 0x70000 (BE: 00 07 00 00)
    expect(s.workRam[SLOT_OFF_A + 0x68]).toBe(0x00);
    expect(s.workRam[SLOT_OFF_A + 0x69]).toBe(0x07);
    expect(s.workRam[SLOT_OFF_A + 0x6a]).toBe(0x00);
    expect(s.workRam[SLOT_OFF_A + 0x6b]).toBe(0x00);
  });

  it("state 0x24 con +0x56 != 0 → decrementa, ELSE branch", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[SLOT_OFF_A + 0x18] = 0x01;
    s.workRam[SLOT_OFF_A + 0x1a] = 0x24;
    s.workRam[SLOT_OFF_A + 0x56] = 0x05;
    let elseCalled = 0;
    let entered23 = 0;
    fun158F6(s, SLOT_A, rom, {
      objectEnterState23: () => { entered23++; },
      helper253BC: () => { elseCalled++; },
      helper182BA: () => { elseCalled++; },
      helper121B8: () => { elseCalled++; },
    });
    expect(s.workRam[SLOT_OFF_A + 0x56]).toBe(0x04);
    expect(entered23).toBe(0); // 0x56 ancora != 0, no transizione
    expect(elseCalled).toBe(3); // bra.b → ELSE branch
    // state 0x24 invariato
    expect(s.workRam[SLOT_OFF_A + 0x1a]).toBe(0x24);
  });

  it("state 0x24 con +0x56 == 1 → decrementa a 0, transizione 0x23", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[SLOT_OFF_A + 0x18] = 0x01;
    s.workRam[SLOT_OFF_A + 0x1a] = 0x24;
    s.workRam[SLOT_OFF_A + 0x56] = 0x01;
    fun158F6(s, SLOT_A, rom, {
      helper253BC: () => {},
      helper182BA: () => {},
      helper121B8: () => {},
    });
    expect(s.workRam[SLOT_OFF_A + 0x56]).toBe(0x00);
    expect(s.workRam[SLOT_OFF_A + 0x1a]).toBe(0x23); // transitato
    // ELSE branch comunque eseguito (bra.b 0x1597A unconditional)
    // Verifichiamo via la struttura: helper253BC/182BA/121B8 stubbati no-op → niente da check
  });

  it("s18 == 2 → branch state-2 (jsr 25FC2, 1B9CC, 1281C), no ELSE", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[SLOT_OFF_A + 0x18] = 0x02;
    s.workRam[SLOT_OFF_A + 0x1a] = 0x10; // non 0x21/0x22/0x24

    let h25 = 0, sp1b = 0, oe12 = 0, elseCount = 0;
    fun158F6(s, SLOT_A, rom, {
      helper25FC2: () => { h25++; },
      spriteHelper1B9CC: () => { sp1b++; },
      objectEnter1281C: () => { oe12++; },
      helper253BC: () => { elseCount++; },
      helper182BA: () => { elseCount++; },
      helper121B8: () => { elseCount++; },
    });
    expect(h25).toBe(1);
    expect(sp1b).toBe(1);
    expect(oe12).toBe(1);
    expect(elseCount).toBe(0);
  });

  it("s18 == 1 (default) → ELSE branch, no state-2", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[SLOT_OFF_A + 0x18] = 0x01;
    s.workRam[SLOT_OFF_A + 0x1a] = 0x10;

    let state2Count = 0, elseCount = 0;
    fun158F6(s, SLOT_A, rom, {
      helper25FC2: () => { state2Count++; },
      spriteHelper1B9CC: () => { state2Count++; },
      objectEnter1281C: () => { state2Count++; },
      helper253BC: () => { elseCount++; },
      helper182BA: () => { elseCount++; },
      helper121B8: () => { elseCount++; },
    });
    expect(state2Count).toBe(0);
    expect(elseCount).toBe(3);
  });
});
