/**
 * render-string-entry-286b0.test.ts — smoke per FUN_286B0.
 *
 * `cli/src/test-render-string-entry-286b0-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  renderStringEntry286B0,
  STRUCT_OFF,
  COL_BYTE_OFF,
  TICKOFF_BYTE_OFF,
  DEST_PTR_LONG_OFF,
  MARKER_BYTE_OFF,
  RENDER_STRUCT_ADDR,
} from "../src/render-string-entry-286b0.js";
import { emptyGameState } from "../src/state.js";

/** Places the dest pointer (long-BE) in workRam @ 0x412 = `dstAbs`. */
function setDestPtr(s: ReturnType<typeof emptyGameState>, dstAbs: number): void {
  const off = STRUCT_OFF + DEST_PTR_LONG_OFF;
  s.workRam[off] = (dstAbs >>> 24) & 0xff;
  s.workRam[off + 1] = (dstAbs >>> 16) & 0xff;
  s.workRam[off + 2] = (dstAbs >>> 8) & 0xff;
  s.workRam[off + 3] = dstAbs & 0xff;
}

function putString(
  s: ReturnType<typeof emptyGameState>,
  off: number,
  text: string,
): void {
  for (let i = 0; i < text.length; i++) {
    s.workRam[off + i] = text.charCodeAt(i) & 0xff;
  }
  s.workRam[off + text.length] = 0;
}

/**
 * `renderStringEntry286B0(state, arg1Off + WORK_RAM_BASE, ...)`.
 */
function setArg1PtrToPtr(
  s: ReturnType<typeof emptyGameState>,
  arg1Off: number,
  srcPtrAbs: number,
): void {
  s.workRam[arg1Off] = (srcPtrAbs >>> 24) & 0xff;
  s.workRam[arg1Off + 1] = (srcPtrAbs >>> 16) & 0xff;
  s.workRam[arg1Off + 2] = (srcPtrAbs >>> 8) & 0xff;
  s.workRam[arg1Off + 3] = srcPtrAbs & 0xff;
}

const WORK_RAM_BASE = 0x00400000;

describe("renderStringEntry286B0 (FUN_286B0)", () => {
  it("copies stringa null-terminated, writes col/tickOff/marker, invoca renderStringChain con (0x400410, attrWord)", () => {
    const s = emptyGameState();

    // Setup: source string @ workRam 0x100 = "HELLO"
    const SRC_OFF = 0x100;
    putString(s, SRC_OFF, "HELLO");
    // Pointer-to-source @ workRam 0x200 (long-BE = 0x400100)
    const ARG1_OFF = 0x200;
    setArg1PtrToPtr(s, ARG1_OFF, WORK_RAM_BASE + SRC_OFF);
    // Destination buffer pointer in struct @ 0x412 → workRam 0x300
    const DST_OFF = 0x300;
    setDestPtr(s, WORK_RAM_BASE + DST_OFF);

    // Pre-fill marker / col / tickOff with non-zero sentinel.
    s.workRam[STRUCT_OFF + COL_BYTE_OFF] = 0x99;
    s.workRam[STRUCT_OFF + TICKOFF_BYTE_OFF] = 0x88;
    s.workRam[STRUCT_OFF + MARKER_BYTE_OFF] = 0xaa;

    let renderArgs: { addr: number; attr: number } | null = null;
    renderStringEntry286B0(
      s,
      WORK_RAM_BASE + ARG1_OFF, // arg1Long → ptr-to-ptr
      0x12345642, // arg2Long → col = 0x42
      0xaabbcc11, // arg3Long → tickOff = 0x11
      0xdead3400, // arg4Long → attr = 0x3400
      {
        renderStringChain: (addr, attr) => {
          renderArgs = { addr, attr };
        },
      },
    );

    // String copy: "HELLO\0" → workRam 0x300..0x305
    expect(s.workRam[DST_OFF + 0]).toBe(0x48); // 'H'
    expect(s.workRam[DST_OFF + 1]).toBe(0x45); // 'E'
    expect(s.workRam[DST_OFF + 2]).toBe(0x4c); // 'L'
    expect(s.workRam[DST_OFF + 3]).toBe(0x4c); // 'L'
    expect(s.workRam[DST_OFF + 4]).toBe(0x4f); // 'O'
    expect(s.workRam[DST_OFF + 5]).toBe(0x00);

    // Struct byte writes
    expect(s.workRam[STRUCT_OFF + COL_BYTE_OFF]).toBe(0x42);
    expect(s.workRam[STRUCT_OFF + TICKOFF_BYTE_OFF]).toBe(0x11);
    expect(s.workRam[STRUCT_OFF + MARKER_BYTE_OFF]).toBe(0);

    const destPtrPost =
      ((s.workRam[STRUCT_OFF + DEST_PTR_LONG_OFF] ?? 0) << 24) |
      ((s.workRam[STRUCT_OFF + DEST_PTR_LONG_OFF + 1] ?? 0) << 16) |
      ((s.workRam[STRUCT_OFF + DEST_PTR_LONG_OFF + 2] ?? 0) << 8) |
      (s.workRam[STRUCT_OFF + DEST_PTR_LONG_OFF + 3] ?? 0);
    expect(destPtrPost >>> 0).toBe((WORK_RAM_BASE + DST_OFF) >>> 0);

    // renderStringChain invoked with (0x400410, 0x3400).
    expect(renderArgs).not.toBeNull();
    expect(renderArgs!.addr).toBe(RENDER_STRUCT_ADDR);
    expect(renderArgs!.addr).toBe(0x00400410);
    expect(renderArgs!.attr).toBe(0x3400);
  });

  it("stringa vuota ('\\0') → copies 1 byte (terminator), struct popolato comunque", () => {
    const s = emptyGameState();
    const SRC_OFF = 0x100;
    s.workRam[SRC_OFF] = 0; // first byte = 0 → immediate terminator
    const ARG1_OFF = 0x200;
    setArg1PtrToPtr(s, ARG1_OFF, WORK_RAM_BASE + SRC_OFF);
    const DST_OFF = 0x300;
    setDestPtr(s, WORK_RAM_BASE + DST_OFF);
    s.workRam[DST_OFF] = 0x99;
    s.workRam[DST_OFF + 1] = 0x99;

    renderStringEntry286B0(
      s,
      WORK_RAM_BASE + ARG1_OFF,
      0x55,
      0x33,
      0x3400,
    );

    // 1 byte (terminator) written -> dst[0] = 0, dst[1] unchanged.
    expect(s.workRam[DST_OFF]).toBe(0);
    expect(s.workRam[DST_OFF + 1]).toBe(0x99);
    // Struct popolato.
    expect(s.workRam[STRUCT_OFF + COL_BYTE_OFF]).toBe(0x55);
    expect(s.workRam[STRUCT_OFF + TICKOFF_BYTE_OFF]).toBe(0x33);
    expect(s.workRam[STRUCT_OFF + MARKER_BYTE_OFF]).toBe(0);
  });

  it("solo low byte of arg2/arg3 and low word of arg4 are used (matching move.b/move.w)", () => {
    const s = emptyGameState();
    const SRC_OFF = 0x100;
    putString(s, SRC_OFF, "X");
    const ARG1_OFF = 0x200;
    setArg1PtrToPtr(s, ARG1_OFF, WORK_RAM_BASE + SRC_OFF);
    const DST_OFF = 0x300;
    setDestPtr(s, WORK_RAM_BASE + DST_OFF);

    let attrSeen = -1;
    renderStringEntry286B0(
      s,
      WORK_RAM_BASE + ARG1_OFF,
      0xfffffff7, // LSB = 0xF7 → col
      0xdeadbe83, // LSB = 0x83 → tickOff
      0x12345678, // LOW WORD = 0x5678 → attr
      {
        renderStringChain: (_a, attr) => {
          attrSeen = attr;
        },
      },
    );
    expect(s.workRam[STRUCT_OFF + COL_BYTE_OFF]).toBe(0xf7);
    expect(s.workRam[STRUCT_OFF + TICKOFF_BYTE_OFF]).toBe(0x83);
    expect(attrSeen).toBe(0x5678);
  });

  it("copies stringa lunga: mantiene l'ordine byte (no spillage first of the inizio)", () => {
    const s = emptyGameState();
    const SRC_OFF = 0x100;
    putString(s, SRC_OFF, "ABCDE0123456789");
    const ARG1_OFF = 0x200;
    setArg1PtrToPtr(s, ARG1_OFF, WORK_RAM_BASE + SRC_OFF);
    const DST_OFF = 0x300;
    setDestPtr(s, WORK_RAM_BASE + DST_OFF);
    s.workRam[DST_OFF - 1] = 0xee;

    renderStringEntry286B0(s, WORK_RAM_BASE + ARG1_OFF, 1, 2, 0x3400);

    expect(s.workRam[DST_OFF - 1]).toBe(0xee); // pre-byte invariato
    for (let i = 0; i < 15; i++) {
      const expected = "ABCDE0123456789".charCodeAt(i);
      expect(s.workRam[DST_OFF + i]).toBe(expected);
    }
    expect(s.workRam[DST_OFF + 15]).toBe(0); // terminator copied
  });

  it("subs undefined → no throw; string copy + byte writes avvengono comunque", () => {
    const s = emptyGameState();
    const SRC_OFF = 0x100;
    putString(s, SRC_OFF, "OK");
    const ARG1_OFF = 0x200;
    setArg1PtrToPtr(s, ARG1_OFF, WORK_RAM_BASE + SRC_OFF);
    const DST_OFF = 0x300;
    setDestPtr(s, WORK_RAM_BASE + DST_OFF);

    expect(() => {
      renderStringEntry286B0(s, WORK_RAM_BASE + ARG1_OFF, 0x07, 0x05, 0x3400);
    }).not.toThrow();

    expect(s.workRam[DST_OFF + 0]).toBe(0x4f); // 'O'
    expect(s.workRam[DST_OFF + 1]).toBe(0x4b); // 'K'
    expect(s.workRam[DST_OFF + 2]).toBe(0x00);
    expect(s.workRam[STRUCT_OFF + COL_BYTE_OFF]).toBe(0x07);
    expect(s.workRam[STRUCT_OFF + TICKOFF_BYTE_OFF]).toBe(0x05);
    expect(s.workRam[STRUCT_OFF + MARKER_BYTE_OFF]).toBe(0);
  });
});
