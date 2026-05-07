import { describe, expect, it } from "vitest";

import {
  packTilemapEntries1A9CC,
  TILEMAP_ENTRY_PACK_1A9CC_ADDR,
  TILEMAP_ENTRY_PACK_OBSERVED_WRITE_BYTES,
  TILEMAP_ENTRY_PACK_WINDOW_BYTES,
} from "../src/tilemap-entry-pack-1a9cc.js";
import { emptyGameState } from "../src/state.js";

describe("packTilemapEntries1A9CC (FUN_1A9CC)", () => {
  it("exposes constants for the binary entry and observed write window", () => {
    expect(TILEMAP_ENTRY_PACK_1A9CC_ADDR).toBe(0x1a9cc);
    expect(TILEMAP_ENTRY_PACK_OBSERVED_WRITE_BYTES).toBe(54);
    expect(TILEMAP_ENTRY_PACK_WINDOW_BYTES).toBe(60);
  });

  it("writes into playfieldRam using a relative destination offset", () => {
    const s = emptyGameState();
    s.playfieldRam.fill(0xcc);
    const src = 0x00401000;
    for (let i = 0; i < 0x180; i++) s.workRam[0x1000 + i] = (i * 17 + 3) & 0xff;

    packTilemapEntries1A9CC(s, 0x20, src);

    expect(s.playfieldRam.slice(0x20, 0x20 + TILEMAP_ENTRY_PACK_OBSERVED_WRITE_BYTES)).not.toEqual(
      new Uint8Array(TILEMAP_ENTRY_PACK_OBSERVED_WRITE_BYTES).fill(0xcc),
    );
    expect(Array.from(s.playfieldRam.slice(0x20 + 54, 0x20 + 60))).toEqual([0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc]);
  });
});
