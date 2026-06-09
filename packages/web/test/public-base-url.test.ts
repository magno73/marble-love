import { describe, expect, it } from "vitest";
import { publicUrl } from "../src/public-base-url.js";

describe("publicUrl", () => {
  it("keeps root-base paths absolute", () => {
    expect(publicUrl("/scenarios/sound/tape.json", "/")).toBe("/scenarios/sound/tape.json");
    expect(publicUrl("scenarios/sound/tape.json", "/")).toBe("/scenarios/sound/tape.json");
  });

  it("resolves against a relative base (GitHub Pages build)", () => {
    expect(publicUrl("/sound-worklet.js", "./")).toBe("./sound-worklet.js");
    expect(publicUrl("roms/marble.zip", "./")).toBe("./roms/marble.zip");
  });

  it("resolves against a subpath base", () => {
    expect(publicUrl("/mame_state.json", "/marble-love/")).toBe("/marble-love/mame_state.json");
    expect(publicUrl("mame_state.json", "/marble-love")).toBe("/marble-love/mame_state.json");
  });

  it("defaults to the Vite base URL", () => {
    // Vitest serves import.meta.env.BASE_URL = "/", so the default matches dev.
    expect(publicUrl("/roms/marble.zip")).toBe("/roms/marble.zip");
  });
});
