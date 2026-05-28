import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import {
  HELPER_1CD00_ADDR,
  helper1CD00,
} from "../src/helper-1cd00.js";

describe("helper1CD00 (FUN_1CD00)", () => {
  it("expone l'address del binario", () => {
    expect(HELPER_1CD00_ADDR).toBe(0x1cd00);
  });

  it("indexByte == 0xFF → exit early, ritorna 0", () => {
    const s = emptyGameState();
    // entityPtr e shapeBasePtr in workRam
    const result = helper1CD00(s, 0x00400018, 0x00400500, 0xff);
    expect(result).toBe(0);
  });

  it("indexLong sign-extended via low byte (0x1FF & 0xFF = 0xFF) → exit", () => {
    const s = emptyGameState();
    const result = helper1CD00(s, 0x00400018, 0x00400500, 0x1ff);
    expect(result).toBe(0);
  });

  it("non altera entityPtr velocity quando indexByte == 0xFF", () => {
    const s = emptyGameState();
    // Set up velocity in the entity struct @ 0x400018.
    for (let i = 0; i < 12; i++) {
      s.workRam[0x18 + i] = 0xab;
    }
    helper1CD00(s, 0x00400018, 0x00400500, 0xff);
    for (let i = 0; i < 12; i++) {
      expect(s.workRam[0x18 + i]).toBe(0xab);
    }
  });

  it("ritorna number (= D0 al ritorno del binario)", () => {
    const s = emptyGameState();
    const result = helper1CD00(s, 0x00400018, 0x00400500, 0xff);
    expect(typeof result).toBe("number");
  });
});
