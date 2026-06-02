/**
 * object-render-update-13334.test.ts — smoke tests of `objectRenderUpdate13334`
 * (FUN_00013334).
 *
 * Bit-perfect parity validata vs binary in
 * `packages/cli/src/test-object-render-update-13334-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  objectRenderUpdate13334,
  PALETTE_INDEX_TABLE_ROM,
  BASE_PTR_MAGIC,
} from "../src/object-render-update-13334.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;
const STRUCT_PTR = 0x401000;
const STRUCT_OFF = STRUCT_PTR - WORK_RAM_BASE;

function noopInner1D06A(): void {
  /* stub */
}

describe("objectRenderUpdate13334 (FUN_00013334)", () => {
  it("path mode==0 (default): compute coords + final copy, NO globals stored", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    // mode = 0 (struct[0x1e]) → skip gating, vai dritto al compute.
    s.workRam[STRUCT_OFF + 0x1e] = 0;
    // struct[0x1f] = 0 → no dispatch interno.
    s.workRam[STRUCT_OFF + 0x1f] = 0;
    // w0 = 100, w2 = 200, w4 = 0.
    s.workRam[STRUCT_OFF + 0x0c] = 0;
    s.workRam[STRUCT_OFF + 0x0d] = 100;
    s.workRam[STRUCT_OFF + 0x10] = 0;
    s.workRam[STRUCT_OFF + 0x11] = 200;
    s.workRam[STRUCT_OFF + 0x14] = 0;
    s.workRam[STRUCT_OFF + 0x15] = 0;
    // struct[0x3e] = 0xCAFEBABE (record ptr).
    s.workRam[STRUCT_OFF + 0x3e] = 0xca;
    s.workRam[STRUCT_OFF + 0x3f] = 0xfe;
    s.workRam[STRUCT_OFF + 0x40] = 0xba;
    s.workRam[STRUCT_OFF + 0x41] = 0xbe;
    // HUD_OFFSET = 0.

    const r = objectRenderUpdate13334(s, rom, STRUCT_PTR, {
      inner1D06A: noopInner1D06A,
    });
    expect(r).toBe(0);

    // POS_X/POS_Y aggiornati.
    expect(s.workRam[0x690]).toBe(0);
    expect(s.workRam[0x691]).toBe(100);
    expect(s.workRam[0x692]).toBe(0);
    expect(s.workRam[0x693]).toBe(200);

    // Globals NOT aggiornati (mode != 1, != 2).
    expect(s.workRam[0x970]).toBe(0);
    expect(s.workRam[0x971]).toBe(0);
    expect(s.workRam[0x972]).toBe(0);
    expect(s.workRam[0x973]).toBe(0);
    expect(s.workRam[0x974]).toBe(0);
    expect(s.workRam[0x975]).toBe(0);

    // Final copy: struct[0x42..0x45] = struct[0x3e..0x41] = 0xCAFEBABE.
    expect(s.workRam[STRUCT_OFF + 0x42]).toBe(0xca);
    expect(s.workRam[STRUCT_OFF + 0x43]).toBe(0xfe);
    expect(s.workRam[STRUCT_OFF + 0x44]).toBe(0xba);
    expect(s.workRam[STRUCT_OFF + 0x45]).toBe(0xbe);

    // Packed @ 0x4E:
    //   yMinusX = (200-100+0x88) = 0xEC ; word
    //   avg = (100+200)>>1 = 150
    //   d2w = (0 + 0 + 0x54 - 150) & 0xFFFF = (84 - 150) = -66 = 0xFFBE
    //   packed_long = (0xEC << 16) | 0xFFBE = 0x00ECFFBE
    expect(s.workRam[STRUCT_OFF + 0x4e]).toBe(0x00);
    expect(s.workRam[STRUCT_OFF + 0x4f]).toBe(0xec);
    expect(s.workRam[STRUCT_OFF + 0x50]).toBe(0xff);
    expect(s.workRam[STRUCT_OFF + 0x51]).toBe(0xbe);
  });

  it("path mode==1, *struct[0x3e] == -1 → epilogue diretto, niente side effect", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    // Mode = 1, record ptr points to a workRam position with tombstone.
    const recordPtr = 0x401800;
    s.workRam[STRUCT_OFF + 0x1e] = 1;
    s.workRam[STRUCT_OFF + 0x3e] = (recordPtr >>> 24) & 0xff;
    s.workRam[STRUCT_OFF + 0x3f] = (recordPtr >>> 16) & 0xff;
    s.workRam[STRUCT_OFF + 0x40] = (recordPtr >>> 8) & 0xff;
    s.workRam[STRUCT_OFF + 0x41] = recordPtr & 0xff;
    // *recordPtr = 0xFFFFFFFF (tombstone).
    const recOff = recordPtr - WORK_RAM_BASE;
    s.workRam[recOff + 0] = 0xff;
    s.workRam[recOff + 1] = 0xff;
    s.workRam[recOff + 2] = 0xff;
    s.workRam[recOff + 3] = 0xff;
    // Dirty marker for detecting spurious writes.
    s.workRam[STRUCT_OFF + 0x4e] = 0x55;
    s.workRam[STRUCT_OFF + 0x42] = 0x55;

    const before = new Uint8Array(s.workRam);
    const r = objectRenderUpdate13334(s, rom, STRUCT_PTR, {
      inner1D06A: noopInner1D06A,
    });
    expect(r).toBe(0);

    // No side effects: workRam unchanged.
    expect(s.workRam).toEqual(before);
  });

  it("path mode==1, record valido → store globals → epilogue (no compute)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    const recordPtr = 0x401800;
    s.workRam[STRUCT_OFF + 0x1e] = 1;
    s.workRam[STRUCT_OFF + 0x3e] = (recordPtr >>> 24) & 0xff;
    s.workRam[STRUCT_OFF + 0x3f] = (recordPtr >>> 16) & 0xff;
    s.workRam[STRUCT_OFF + 0x40] = (recordPtr >>> 8) & 0xff;
    s.workRam[STRUCT_OFF + 0x41] = recordPtr & 0xff;
    // *recordPtr = qualcosa != -1.
    const recOff = recordPtr - WORK_RAM_BASE;
    s.workRam[recOff + 0] = 0x12;
    s.workRam[recOff + 1] = 0x34;
    s.workRam[recOff + 2] = 0x56;
    s.workRam[recOff + 3] = 0x78;
    // Sentinel marker per detectare compute.
    s.workRam[STRUCT_OFF + 0x4e] = 0x55;
    s.workRam[STRUCT_OFF + 0x42] = 0x55;

    const r = objectRenderUpdate13334(s, rom, STRUCT_PTR, {
      inner1D06A: noopInner1D06A,
    });
    expect(r).toBe(0);

    // Globals popolati.
    expect(s.workRam[0x970]).toBe((recordPtr >>> 24) & 0xff);
    expect(s.workRam[0x971]).toBe((recordPtr >>> 16) & 0xff);
    expect(s.workRam[0x972]).toBe((recordPtr >>> 8) & 0xff);
    expect(s.workRam[0x973]).toBe(recordPtr & 0xff);
    expect(s.workRam[0x974]).toBe((STRUCT_PTR >>> 24) & 0xff);
    expect(s.workRam[0x975]).toBe((STRUCT_PTR >>> 16) & 0xff);
    expect(s.workRam[0x976]).toBe((STRUCT_PTR >>> 8) & 0xff);
    expect(s.workRam[0x977]).toBe(STRUCT_PTR & 0xff);

    // Compute NOT executed (sentinel byte ancora 0x55).
    expect(s.workRam[STRUCT_OFF + 0x4e]).toBe(0x55);
    expect(s.workRam[STRUCT_OFF + 0x42]).toBe(0x55);
  });

  it("path mode==2, mode_hi=2, record valido → store globals + compute + final copy", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    const recordPtr = 0x401800;
    s.workRam[STRUCT_OFF + 0x1e] = 2;
    s.workRam[STRUCT_OFF + 0x1a] = 2;
    s.workRam[STRUCT_OFF + 0x3e] = (recordPtr >>> 24) & 0xff;
    s.workRam[STRUCT_OFF + 0x3f] = (recordPtr >>> 16) & 0xff;
    s.workRam[STRUCT_OFF + 0x40] = (recordPtr >>> 8) & 0xff;
    s.workRam[STRUCT_OFF + 0x41] = recordPtr & 0xff;
    const recOff = recordPtr - WORK_RAM_BASE;
    s.workRam[recOff + 0] = 0x00;
    s.workRam[recOff + 1] = 0x00;
    s.workRam[recOff + 2] = 0x00;
    s.workRam[recOff + 3] = 0x01; // != -1
    // w0=10, w2=20.
    s.workRam[STRUCT_OFF + 0x0d] = 10;
    s.workRam[STRUCT_OFF + 0x11] = 20;

    const r = objectRenderUpdate13334(s, rom, STRUCT_PTR, {
      inner1D06A: noopInner1D06A,
    });
    expect(r).toBe(0);

    // Globals popolati. recordPtr=0x00401800 (BE: 00 40 18 00).
    expect(s.workRam[0x970]).toBe(0x00);
    expect(s.workRam[0x971]).toBe(0x40);
    expect(s.workRam[0x972]).toBe(0x18);
    expect(s.workRam[0x973]).toBe(0x00);
    expect(s.workRam[0x977]).toBe(STRUCT_PTR & 0xff);

    // POS_X/Y aggiornati (compute executed).
    expect(s.workRam[0x691]).toBe(10);
    expect(s.workRam[0x693]).toBe(20);

    // Final copy: struct[0x42..0x45] = recordPtr.
    expect(s.workRam[STRUCT_OFF + 0x42]).toBe((recordPtr >>> 24) & 0xff);
    expect(s.workRam[STRUCT_OFF + 0x45]).toBe(recordPtr & 0xff);
  });

  it("path mode==2, mode_hi=0, record valido → compute SENZA store globals", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    const recordPtr = 0x401800;
    s.workRam[STRUCT_OFF + 0x1e] = 2;
    s.workRam[STRUCT_OFF + 0x1a] = 0; // NOT 1 and NOT 2.
    s.workRam[STRUCT_OFF + 0x3e] = (recordPtr >>> 24) & 0xff;
    s.workRam[STRUCT_OFF + 0x3f] = (recordPtr >>> 16) & 0xff;
    s.workRam[STRUCT_OFF + 0x40] = (recordPtr >>> 8) & 0xff;
    s.workRam[STRUCT_OFF + 0x41] = recordPtr & 0xff;
    const recOff = recordPtr - WORK_RAM_BASE;
    s.workRam[recOff + 3] = 0x01; // != -1
    s.workRam[STRUCT_OFF + 0x0d] = 50;
    s.workRam[STRUCT_OFF + 0x11] = 60;

    const r = objectRenderUpdate13334(s, rom, STRUCT_PTR, {
      inner1D06A: noopInner1D06A,
    });
    expect(r).toBe(0);

    // POS_X/Y aggiornati.
    expect(s.workRam[0x691]).toBe(50);
    expect(s.workRam[0x693]).toBe(60);

    // Globals NOT popolati.
    expect(s.workRam[0x970]).toBe(0);
    expect(s.workRam[0x974]).toBe(0);

    // Final copy fatta.
    expect(s.workRam[STRUCT_OFF + 0x42]).toBe((recordPtr >>> 24) & 0xff);
  });

  it("path kind==6 → invoca callback inner1D06A con sext_l(struct[0x25])", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    s.workRam[STRUCT_OFF + 0x1e] = 0; // skip gating
    s.workRam[STRUCT_OFF + 0x1f] = 6;
    s.workRam[STRUCT_OFF + 0x25] = 0xff; // sext_l(0xff) = -1

    let invoked: number | null = null;
    const r = objectRenderUpdate13334(s, rom, STRUCT_PTR, {
      inner1D06A: (b: number): void => {
        invoked = b;
      },
    });
    expect(r).toBe(0);
    expect(invoked).toBe(-1);
  });

  it("path kind==3 → indicizza ROM table + paletteQueuePush; +7 se base==0x21192", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    // Setup: write a known byte at `0x1DF18 + 5` in ROM.
    rom.program[PALETTE_INDEX_TABLE_ROM + 5] = 0x42;
    rom.program[PALETTE_INDEX_TABLE_ROM + 12] = 0x99; // 5+7=12 (path magic).

    // Caso 1: base != 0x21192 → indice = 5 (no +7).
    {
      const s1 = emptyGameState();
      s1.workRam[STRUCT_OFF + 0x1e] = 0;
      s1.workRam[STRUCT_OFF + 0x1f] = 3;
      // recordPtr - basePtr = 5 << 3 = 40, basePtr arbitrary != magic.
      const basePtr = 0x10000;
      const recordPtr = basePtr + 40; // (recPtr - basePtr) >> 3 = 5
      s1.workRam[STRUCT_OFF + 0x3e] = (recordPtr >>> 24) & 0xff;
      s1.workRam[STRUCT_OFF + 0x3f] = (recordPtr >>> 16) & 0xff;
      s1.workRam[STRUCT_OFF + 0x40] = (recordPtr >>> 8) & 0xff;
      s1.workRam[STRUCT_OFF + 0x41] = recordPtr & 0xff;
      s1.workRam[STRUCT_OFF + 0x46] = (basePtr >>> 24) & 0xff;
      s1.workRam[STRUCT_OFF + 0x47] = (basePtr >>> 16) & 0xff;
      s1.workRam[STRUCT_OFF + 0x48] = (basePtr >>> 8) & 0xff;
      s1.workRam[STRUCT_OFF + 0x49] = basePtr & 0xff;

      // pre: queue ptr a 0x40040C (head, queue vuota).
      s1.workRam[0x408] = 0x00;
      s1.workRam[0x409] = 0x40;
      s1.workRam[0x40a] = 0x04;
      s1.workRam[0x40b] = 0x0c;

      const r = objectRenderUpdate13334(s1, rom, STRUCT_PTR, {
        inner1D06A: noopInner1D06A,
      });
      expect(r).toBe(0);
      // Byte appena pushato in queue head = 0x42.
      expect(s1.workRam[0x40c]).toBe(0x42);
    }

    // Caso 2: base == 0x21192 → indice = 5 + 7 = 12 → byte 0x99.
    {
      const s2 = emptyGameState();
      s2.workRam[STRUCT_OFF + 0x1e] = 0;
      s2.workRam[STRUCT_OFF + 0x1f] = 3;
      const basePtr = BASE_PTR_MAGIC;
      const recordPtr = basePtr + 40;
      s2.workRam[STRUCT_OFF + 0x3e] = (recordPtr >>> 24) & 0xff;
      s2.workRam[STRUCT_OFF + 0x3f] = (recordPtr >>> 16) & 0xff;
      s2.workRam[STRUCT_OFF + 0x40] = (recordPtr >>> 8) & 0xff;
      s2.workRam[STRUCT_OFF + 0x41] = recordPtr & 0xff;
      s2.workRam[STRUCT_OFF + 0x46] = (basePtr >>> 24) & 0xff;
      s2.workRam[STRUCT_OFF + 0x47] = (basePtr >>> 16) & 0xff;
      s2.workRam[STRUCT_OFF + 0x48] = (basePtr >>> 8) & 0xff;
      s2.workRam[STRUCT_OFF + 0x49] = basePtr & 0xff;

      s2.workRam[0x408] = 0x00;
      s2.workRam[0x409] = 0x40;
      s2.workRam[0x40a] = 0x04;
      s2.workRam[0x40b] = 0x0c;

      const r = objectRenderUpdate13334(s2, rom, STRUCT_PTR, {
        inner1D06A: noopInner1D06A,
      });
      expect(r).toBe(0);
      // sext_l(0x99) low byte = 0x99 (paletteQueuePush masks with 0xff).
      expect(s2.workRam[0x40c]).toBe(0x99);
    }
  });
});
