/**
 * render-string-entry-28fde.test.ts — smoke per FUN_28FDE.
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-render-string-entry-28fde-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  renderStringEntry28FDE,
  ENTRY_OFF,
  COL_BYTE_OFF,
  TICKOFF_BYTE_OFF,
  MARKER_BYTE_OFF,
  RENDER_STRUCT_ADDR,
  RENDER_ATTR,
} from "../src/render-string-entry-28fde.js";
import { emptyGameState } from "../src/state.js";

describe("renderStringEntry28FDE (FUN_28FDE)", () => {
  it("scrive col, tickOff, marker=0 nei 3 byte attesi e invoca renderStringChain con (0x400434, 0x3400)", () => {
    const s = emptyGameState();
    // Pre-fill marker con sentinel non-zero per verificare clear.
    s.workRam[ENTRY_OFF + MARKER_BYTE_OFF] = 0xaa;
    // Pre-fill stringPtr (offset +2..+5) per verificare che NON venga toccato.
    s.workRam[ENTRY_OFF + 2] = 0xde;
    s.workRam[ENTRY_OFF + 3] = 0xad;
    s.workRam[ENTRY_OFF + 4] = 0xbe;
    s.workRam[ENTRY_OFF + 5] = 0xef;

    let renderArgs: { addr: number; attr: number } | null = null;
    renderStringEntry28FDE(s, 0x12345678, 0xaabbcc42, {
      renderStringChain: (addr, attr) => {
        renderArgs = { addr, attr };
      },
    });

    // Bit basso 0x78 di arg1Long → col
    expect(s.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x78);
    // Bit basso 0x42 di arg2Long → tickOff
    expect(s.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(0x42);
    // Marker azzerato
    expect(s.workRam[ENTRY_OFF + MARKER_BYTE_OFF]).toBe(0);
    // stringPtr intatto (offset +2..+5)
    expect(s.workRam[ENTRY_OFF + 2]).toBe(0xde);
    expect(s.workRam[ENTRY_OFF + 3]).toBe(0xad);
    expect(s.workRam[ENTRY_OFF + 4]).toBe(0xbe);
    expect(s.workRam[ENTRY_OFF + 5]).toBe(0xef);

    // renderStringChain invocato con i constants esatti.
    expect(renderArgs).not.toBeNull();
    expect(renderArgs!.addr).toBe(RENDER_STRUCT_ADDR);
    expect(renderArgs!.addr).toBe(0x00400434);
    expect(renderArgs!.attr).toBe(RENDER_ATTR);
    expect(renderArgs!.attr).toBe(0x3400);
  });

  it("subs undefined → no-op sulla render call, ma byte writes avvengono comunque", () => {
    const s = emptyGameState();
    s.workRam[ENTRY_OFF + MARKER_BYTE_OFF] = 0xff;
    expect(() => {
      renderStringEntry28FDE(s, 0x07, 0x05);
    }).not.toThrow();
    expect(s.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x07);
    expect(s.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(0x05);
    expect(s.workRam[ENTRY_OFF + MARKER_BYTE_OFF]).toBe(0);
  });

  it("solo i 3 byte target sono modificati (no spillage in [0x432..0x440] al di fuori di +0/+1/+6)", () => {
    const s = emptyGameState();
    // Pre-fill l'intera fascia con sentinel.
    for (let i = ENTRY_OFF - 2; i < ENTRY_OFF + 0xc; i++) {
      s.workRam[i] = 0x99;
    }

    renderStringEntry28FDE(s, 0xff, 0xff);

    // I 3 byte target.
    expect(s.workRam[ENTRY_OFF + 0]).toBe(0xff);
    expect(s.workRam[ENTRY_OFF + 1]).toBe(0xff);
    expect(s.workRam[ENTRY_OFF + 6]).toBe(0x00);
    // Il resto della fascia deve restare 0x99 (no spillage).
    for (const off of [-2, -1, 2, 3, 4, 5, 7, 8, 9, 10, 11]) {
      expect(s.workRam[ENTRY_OFF + off]).toBe(0x99);
    }
  });

  it("chiama renderStringChain anche quando i 3 byte sono già nei valori target", () => {
    const s = emptyGameState();
    s.workRam[ENTRY_OFF + 0] = 0x42;
    s.workRam[ENTRY_OFF + 1] = 0x42;
    s.workRam[ENTRY_OFF + 6] = 0;

    let calls = 0;
    renderStringEntry28FDE(s, 0x42, 0x42, {
      renderStringChain: () => {
        calls++;
      },
    });
    expect(calls).toBe(1);
    // E i byte rimangono uguali (idempotenti).
    expect(s.workRam[ENTRY_OFF + 0]).toBe(0x42);
    expect(s.workRam[ENTRY_OFF + 1]).toBe(0x42);
    expect(s.workRam[ENTRY_OFF + 6]).toBe(0x00);
  });
});
