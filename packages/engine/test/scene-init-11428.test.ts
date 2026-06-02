/**
 * Test sceneInit11428 (FUN_00011428) — smoke tests on the orchestrator.
 *
 * is preserved and default no-ops do not throw.
 *
 * `cli/src/test-scene-init-11428-parity.ts` (500/500 cases).
 */

import { describe, it, expect } from "vitest";
import {
  sceneInit11428,
  SCENE_INIT_11428_ADDR,
  SCENE_INIT_11428_SUB_ADDRS,
  type SceneInit11428Subs,
} from "../src/scene-init-11428.js";
import { emptyGameState } from "../src/state.js";

function makeTrackedSubs(): { calls: string[]; subs: SceneInit11428Subs } {
  const calls: string[] = [];
  return {
    calls,
    subs: {
      vblankAck: () => calls.push("vblankAck"),
      clearPaletteRam: () => calls.push("clearPaletteRam"),
      clearMoAlphaRam: () => calls.push("clearMoAlphaRam"),
      initFnPointers: () => calls.push("initFnPointers"),
      fillLoop: () => calls.push("fillLoop"),
      sceneObjInit: () => calls.push("sceneObjInit"),
    },
  };
}

describe("sceneInit11428 (FUN_00011428)", () => {
  it("calls all and 6 le subs in the ordine binary", () => {
    const s = emptyGameState();
    const { calls, subs } = makeTrackedSubs();

    sceneInit11428(s, subs);

    expect(calls).toEqual([
      "vblankAck",
      "clearPaletteRam",
      "clearMoAlphaRam",
      "initFnPointers",
      "fillLoop",
      "sceneObjInit",
    ]);
  });

  it("default no-op: non solleva su subs={}", () => {
    const s = emptyGameState();
    expect(() => sceneInit11428(s)).not.toThrow();
    expect(() => sceneInit11428(s, {})).not.toThrow();
  });

  it("subs parziali: invoca solo quelle definite, skips the undefined", () => {
    const s = emptyGameState();
    const calls: string[] = [];
    sceneInit11428(s, {
      vblankAck: () => calls.push("vblankAck"),
      // clearPaletteRam undefined → skip
      clearMoAlphaRam: () => calls.push("clearMoAlphaRam"),
      // initFnPointers undefined → skip
      fillLoop: () => calls.push("fillLoop"),
      // sceneObjInit undefined → skip
    });
    expect(calls).toEqual(["vblankAck", "clearMoAlphaRam", "fillLoop"]);
  });

  it("non muta state se all le subs are no-op", () => {
    const s = emptyGameState();
    const workRamBefore = new Uint8Array(s.workRam);
    const colorRamBefore = new Uint8Array(s.colorRam);
    const spriteRamBefore = new Uint8Array(s.spriteRam);

    sceneInit11428(s);

    expect(s.workRam).toEqual(workRamBefore);
    expect(s.colorRam).toEqual(colorRamBefore);
    expect(s.spriteRam).toEqual(spriteRamBefore);
  });

  it("propaga il GameState alle callback (per side-effect bit-perfect)", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0x42;
    let seen: number | undefined;
    sceneInit11428(s, {
      vblankAck: (st) => {
        seen = st.workRam[0x100];
      },
    });
    expect(seen).toBe(0x42);
  });

  it("costanti exposed: indirizzi binary corretti", () => {
    expect(SCENE_INIT_11428_ADDR).toBe(0x11428);
    expect(SCENE_INIT_11428_SUB_ADDRS).toEqual([
      0x28dea, 0x121a6, 0x12174, 0x28580, 0x28c7e, 0x28ca6,
    ]);
    expect(SCENE_INIT_11428_SUB_ADDRS).toHaveLength(6);
  });
});
