/**
 * render-string-entry-28fa0.test.ts — smoke per FUN_28FA0.
 *
 * `cli/src/test-render-string-entry-28fa0-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  renderStringEntry28FA0,
  ENTRY_OFF,
  COL_BYTE_OFF,
  TICKOFF_BYTE_OFF,
  MARKER_BYTE_OFF,
  RENDER_STRUCT_ADDR,
} from "../src/render-string-entry-28fa0.js";
import { emptyGameState } from "../src/state.js";

describe("renderStringEntry28FA0 (FUN_28FA0)", () => {
  it("writes col, tickOff, marker=0 in the 3 byte attesi and invoca renderStringChain2 con (0x40041C, ext.l(arg3.w))", () => {
    const s = emptyGameState();
    // Pre-fill marker with non-zero sentinel to verify clear.
    s.workRam[ENTRY_OFF + MARKER_BYTE_OFF] = 0xaa;
    // Pre-fill stringPtr (offset +2..+5) to verify it is not touched.
    s.workRam[ENTRY_OFF + 2] = 0xde;
    s.workRam[ENTRY_OFF + 3] = 0xad;
    s.workRam[ENTRY_OFF + 4] = 0xbe;
    s.workRam[ENTRY_OFF + 5] = 0xef;

    let renderArgs: { addr: number; arg3: number } | null = null;
    // arg3 low word 0x1234 (positive, bit15=0) → ext.l = 0x00001234
    renderStringEntry28FA0(s, 0x12345678, 0xaabbcc42, 0xdeadbe1234 % 0x100000000, {
      renderStringChain2: (addr, arg3) => {
        renderArgs = { addr, arg3 };
      },
    });

    expect(s.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x78);
    expect(s.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(0x42);
    expect(s.workRam[ENTRY_OFF + MARKER_BYTE_OFF]).toBe(0);
    // stringPtr intact (offset +2..+5)
    expect(s.workRam[ENTRY_OFF + 2]).toBe(0xde);
    expect(s.workRam[ENTRY_OFF + 3]).toBe(0xad);
    expect(s.workRam[ENTRY_OFF + 4]).toBe(0xbe);
    expect(s.workRam[ENTRY_OFF + 5]).toBe(0xef);

    // renderStringChain2 invoked with cabled structAddr.
    expect(renderArgs).not.toBeNull();
    expect(renderArgs!.addr).toBe(RENDER_STRUCT_ADDR);
    expect(renderArgs!.addr).toBe(0x0040041c);
  });

  it("subs undefined → no-op on the render call, but byte writes avvengono comunque", () => {
    const s = emptyGameState();
    s.workRam[ENTRY_OFF + MARKER_BYTE_OFF] = 0xff;
    expect(() => {
      renderStringEntry28FA0(s, 0x07, 0x05, 0x09);
    }).not.toThrow();
    expect(s.workRam[ENTRY_OFF + COL_BYTE_OFF]).toBe(0x07);
    expect(s.workRam[ENTRY_OFF + TICKOFF_BYTE_OFF]).toBe(0x05);
    expect(s.workRam[ENTRY_OFF + MARKER_BYTE_OFF]).toBe(0);
  });

  it("solo the 3 bytes target are modificati (no spillage in [0x41A..0x428] al of outside of +0/+1/+6)", () => {
    const s = emptyGameState();
    // Pre-fill the entire span with sentinel.
    for (let i = ENTRY_OFF - 2; i < ENTRY_OFF + 0xc; i++) {
      s.workRam[i] = 0x99;
    }

    renderStringEntry28FA0(s, 0xff, 0xff, 0x00);

    // I 3 byte target.
    expect(s.workRam[ENTRY_OFF + 0]).toBe(0xff);
    expect(s.workRam[ENTRY_OFF + 1]).toBe(0xff);
    expect(s.workRam[ENTRY_OFF + 6]).toBe(0x00);
    // The rest of the span must remain 0x99 (no spillage).
    for (const off of [-2, -1, 2, 3, 4, 5, 7, 8, 9, 10, 11]) {
      expect(s.workRam[ENTRY_OFF + off]).toBe(0x99);
    }
  });

  it("propaga arg3 sign-extended as second arg of renderStringChain2", () => {
    const s = emptyGameState();
    let receivedArg3: number | null = null;
    const subs = {
      renderStringChain2: (_addr: number, arg3: number) => {
        receivedArg3 = arg3;
      },
    };

    // arg3 low word = 0x8000 → ext.l = 0xFFFF8000 (bit15 sign-extended)
    renderStringEntry28FA0(s, 0, 0, 0xdead8000, subs);
    expect(receivedArg3).toBe(0xffff8000);

    // arg3 low word = 0x7FFF → ext.l = 0x00007FFF (positivo)
    renderStringEntry28FA0(s, 0, 0, 0xbeef7fff, subs);
    expect(receivedArg3).toBe(0x00007fff);

    // arg3 low word = 0x0000 → ext.l = 0
    renderStringEntry28FA0(s, 0, 0, 0xcafe0000, subs);
    expect(receivedArg3).toBe(0);

    // arg3 low word = 0xFFFF → ext.l = 0xFFFFFFFF (bit15 = 1, sign-extended)
    renderStringEntry28FA0(s, 0, 0, 0x1234ffff, subs);
    expect(receivedArg3).toBe(0xffffffff);
  });

  it("calls renderStringChain2 also when the 3 bytes are already in the values target", () => {
    const s = emptyGameState();
    s.workRam[ENTRY_OFF + 0] = 0x42;
    s.workRam[ENTRY_OFF + 1] = 0x42;
    s.workRam[ENTRY_OFF + 6] = 0;

    let calls = 0;
    renderStringEntry28FA0(s, 0x42, 0x42, 0x00, {
      renderStringChain2: () => {
        calls++;
      },
    });
    expect(calls).toBe(1);
    expect(s.workRam[ENTRY_OFF + 0]).toBe(0x42);
    expect(s.workRam[ENTRY_OFF + 1]).toBe(0x42);
    expect(s.workRam[ENTRY_OFF + 6]).toBe(0x00);
  });
});
