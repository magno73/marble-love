/**
 * disable-interrupts-10110.test.ts — smoke + parity of FUN_00010110.
 *
 * `cli/src/test-disable-interrupts-10110-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  disableInterrupts10110,
  SR_IPL7_SUPERVISOR,
} from "../src/disable-interrupts-10110.js";

describe("disableInterrupts10110 (FUN_00010110, 6 byte)", () => {
  it("smoke: returns 0x2700 (SR_IPL7_SUPERVISOR)", () => {
    expect(disableInterrupts10110()).toBe(0x2700);
  });

  it("costante SR_IPL7_SUPERVISOR is 0x2700", () => {
    expect(SR_IPL7_SUPERVISOR).toBe(0x2700);
  });

  it("parity: 500 chiamate consecutive → always 0x2700", () => {
    let ok = 0;
    for (let i = 0; i < 500; i++) {
      if (disableInterrupts10110() === 0x2700) ok++;
    }
    expect(ok).toBe(500);
  });

  it("risultato is idempotente (no side effect)", () => {
    const r1 = disableInterrupts10110();
    const r2 = disableInterrupts10110();
    expect(r1).toBe(r2);
  });

  it("SR_IPL7_SUPERVISOR: bit 13 (supervisor) and bit 10-8 (IPL=7) settati", () => {
    // bit 13 = 0x2000 (supervisor mode)
    expect(SR_IPL7_SUPERVISOR & 0x2000).toBe(0x2000);
    // bit 10-8 = 0x0700 (IPL = 7)
    expect(SR_IPL7_SUPERVISOR & 0x0700).toBe(0x0700);
    expect(SR_IPL7_SUPERVISOR & 0x001f).toBe(0x0000);
  });
});
