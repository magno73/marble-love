/**
 * slot-array-tick.test.ts — smoke + corner case di FUN_1493C.
 *
 * Bit-perfect parity verificata vs binary in `test-slot-array-tick-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  slotArrayTick,
  SLOT_ARRAY_BASE,
  SLOT_ARRAY_STRIDE,
  SLOT_ARRAY_COUNT,
} from "../src/slot-array-tick.js";
import { emptyGameState } from "../src/state.js";

describe("slotArrayTick (FUN_1493C)", () => {
  it("chiama il sub 4 volte coi pointer slot deterministici", () => {
    const s = emptyGameState();
    const calls: number[] = [];
    slotArrayTick(s, {
      fun_14966: (ptr) => {
        calls.push(ptr);
      },
    });
    expect(calls).toEqual([
      0x00401302, // slot 0
      0x00401362, // slot 1
      0x004013c2, // slot 2
      0x00401422, // slot 3
    ]);
    // Sanity: derivati dalle costanti
    expect(SLOT_ARRAY_COUNT).toBe(4);
    expect(SLOT_ARRAY_STRIDE).toBe(0x60);
    expect(SLOT_ARRAY_BASE).toBe(0x00401302);
    for (let i = 0; i < SLOT_ARRAY_COUNT; i++) {
      expect(calls[i]).toBe(SLOT_ARRAY_BASE + i * SLOT_ARRAY_STRIDE);
    }
  });

  it("senza subs è no-op (workRam invariata, nessuna eccezione)", () => {
    const s = emptyGameState();
    s.workRam[0x1302 + 0x18] = 0xaa;
    s.workRam[0x1422 + 0x05] = 0x55;
    const before = new Uint8Array(s.workRam);
    expect(() => slotArrayTick(s)).not.toThrow();
    expect(() => slotArrayTick(s, {})).not.toThrow();
    expect(() => slotArrayTick(s, { fun_14966: undefined })).not.toThrow();
    expect(s.workRam).toEqual(before);
  });

  it("forwarda la state instance al callback (stessa reference)", () => {
    const s = emptyGameState();
    let seen: ReturnType<typeof emptyGameState> | null = null;
    let count = 0;
    slotArrayTick(s, {
      fun_14966: (_ptr, state) => {
        seen = state;
        count++;
      },
    });
    expect(count).toBe(4);
    expect(seen).toBe(s);
  });

  it("le mutazioni della callback ai workRam degli slot persistono fra chiamate", () => {
    // Verifica il pattern d'uso reale: la callback può modificare workRam
    // tramite il puntatore dello slot, e la chiamata successiva vede il nuovo
    // stato. (Non ci sono read da parte di FUN_1493C stessa sui campi slot,
    // quindi la replica non dovrebbe interferire con l'ordine delle write.)
    const s = emptyGameState();
    slotArrayTick(s, {
      fun_14966: (ptr, state) => {
        const off = (ptr - 0x400000) >>> 0;
        // Marker = byte 0x18 dello slot
        state.workRam[off + 0x18] = 0xab;
      },
    });
    expect(s.workRam[0x1302 + 0x18]).toBe(0xab);
    expect(s.workRam[0x1362 + 0x18]).toBe(0xab);
    expect(s.workRam[0x13c2 + 0x18]).toBe(0xab);
    expect(s.workRam[0x1422 + 0x18]).toBe(0xab);
    // Ma byte di altri offset non toccati
    expect(s.workRam[0x1302 + 0x00]).toBe(0);
    expect(s.workRam[0x1422 + 0x5f]).toBe(0);
  });

  it("ordine di chiamata strettamente sequenziale (slot 0 → 3, no shuffle)", () => {
    const s = emptyGameState();
    const order: number[] = [];
    slotArrayTick(s, {
      fun_14966: (ptr) => {
        order.push((ptr - SLOT_ARRAY_BASE) / SLOT_ARRAY_STRIDE);
      },
    });
    expect(order).toEqual([0, 1, 2, 3]);
  });
});
