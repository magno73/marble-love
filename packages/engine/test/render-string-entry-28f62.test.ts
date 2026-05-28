/**
 * render-string-entry-28f62.test.ts — smoke per FUN_28F62.
 *
 * `cli/src/test-render-string-entry-28f62-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  renderStringEntry28F62,
  ENTRY_OFF,
  COL_BYTE_OFF,
  TICKOFF_BYTE_OFF,
  MARKER_BYTE_OFF,
  RENDER_STRUCT_ADDR,
} from "../src/render-string-entry-28f62.js";
import { emptyGameState } from "../src/state.js";

describe("renderStringEntry28F62 (FUN_28F62)", () => {
  it("scrive col, tickOff, marker=0 nei 3 byte attesi e invoca renderStringChain con (0x40041C, arg3.w)", () => {
    const s = emptyGameState();
    // Pre-fill marker with non-zero sentinel to verify clear.
    s.workRam[ENTRY_OFF + MARKER_BYTE_OFF] = 0xaa;
    // Pre-fill stringPtr (offset +2..+5) to verify it is not touched.
    s.workRam[ENTRY_OFF + 2] = 0xde;
    s.workRam[ENTRY_OFF + 3] = 0xad;
    s.workRam[ENTRY_OFF + 4] = 0xbe;
    s.workRam[ENTRY_OFF + 5] = 0xef;

    let renderArgs: { addr: number; attr: number } | null = null;
    renderStringEntry28F62(s, 0x12345678, 0xaabbcc42, 0x99991234, {
      renderStringChain: (addr, attr) => {
        renderArgs = { addr, attr };
      },
    });

    expect(s.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x78);
    expect(s.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(0x42);
    expect(s.workRam[ENTRY_OFF + MARKER_BYTE_OFF]).toBe(0);
    // stringPtr intatto (offset +2..+5)
    expect(s.workRam[ENTRY_OFF + 2]).toBe(0xde);
    expect(s.workRam[ENTRY_OFF + 3]).toBe(0xad);
    expect(s.workRam[ENTRY_OFF + 4]).toBe(0xbe);
    expect(s.workRam[ENTRY_OFF + 5]).toBe(0xef);

    // renderStringChain invoked with exact structAddr and attr = arg3 & 0xffff.
    expect(renderArgs).not.toBeNull();
    expect(renderArgs!.addr).toBe(RENDER_STRUCT_ADDR);
    expect(renderArgs!.addr).toBe(0x0040041c);
    expect(renderArgs!.attr).toBe(0x1234);
  });

  it("subs undefined → no-op sulla render call, ma byte writes avvengono comunque", () => {
    const s = emptyGameState();
    s.workRam[ENTRY_OFF + MARKER_BYTE_OFF] = 0xff;
    expect(() => {
      renderStringEntry28F62(s, 0x07, 0x05, 0x1000);
    }).not.toThrow();
    expect(s.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x07);
    expect(s.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(0x05);
    expect(s.workRam[ENTRY_OFF + MARKER_BYTE_OFF]).toBe(0);
  });

  it("solo i 3 byte target sono modificati (no spillage in [0x41A..0x428])", () => {
    const s = emptyGameState();
    // Pre-fill the entire span with sentinel.
    for (let i = ENTRY_OFF - 2; i < ENTRY_OFF + 0xc; i++) {
      s.workRam[i] = 0x99;
    }

    renderStringEntry28F62(s, 0xff, 0xff, 0x3400);

    // I 3 byte target.
    expect(s.workRam[ENTRY_OFF + 0]).toBe(0xff);
    expect(s.workRam[ENTRY_OFF + 1]).toBe(0xff);
    expect(s.workRam[ENTRY_OFF + 6]).toBe(0x00);
    // The rest of the span must remain 0x99 (no spillage).
    for (const off of [-2, -1, 2, 3, 4, 5, 7, 8, 9, 10, 11]) {
      expect(s.workRam[ENTRY_OFF + off]).toBe(0x99);
    }
  });

  it("attr arg è dinamico (passato esattamente come `& 0xffff` a renderStringChain)", () => {
    const s = emptyGameState();
    // Three different attrs (same col/tickOff) -> three distinct call sites.
    const observed: number[] = [];
    const sub = {
      renderStringChain: (_addr: number, attr: number) => {
        observed.push(attr);
      },
    };
    // Caller 0x12130 usa attr=0x1000, caller 0x28EA2 usa l'arg3 del proprio
    // caller (variable). Caller at 0x12074 (not for 28F62 but same pattern
    renderStringEntry28F62(s, 0x0d, 0x05, 0x1000, sub);
    renderStringEntry28F62(s, 0x0d, 0x05, 0x3400, sub);
    renderStringEntry28F62(s, 0x0d, 0x05, 0xdead1234, sub); // upper 16b dropped
    expect(observed).toEqual([0x1000, 0x3400, 0x1234]);
  });
});
