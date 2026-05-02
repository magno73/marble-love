import { describe, it, expect } from "vitest";
import {
  TRACE_SCHEMA_VERSION,
  frameFromState,
  serializeFrame,
  serializeHeader,
} from "../src/trace.js";
import type { TraceHeader } from "../src/trace.js";
import { emptyGameState } from "../src/state.js";
import { as_u32 } from "../src/wrap.js";

describe("trace serialization", () => {
  it("header schema version stable", () => {
    expect(TRACE_SCHEMA_VERSION).toBe(1);
    const h: TraceHeader = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      source: "reimpl",
      scenario: "x",
      romCrc32: "",
      startedAt: "2026-05-02T00:00:00Z",
    };
    const json = serializeHeader(h);
    expect(JSON.parse(json)).toEqual(h);
  });

  it("frameFromState produces canonical fields", () => {
    const s = emptyGameState();
    s.clock.frame = as_u32(42);
    s.marble.pos.x = as_u32(100);
    const f = frameFromState(s);
    expect(f.f).toBe(42);
    expect(f.marble.x).toBe(100);
    expect(f.marble.alive).toBe(0);
  });

  it("frame is single-line JSON", () => {
    const s = emptyGameState();
    const line = serializeFrame(frameFromState(s));
    expect(line.includes("\n")).toBe(false);
  });

  it("workRamHash is deterministic for empty state", () => {
    const a = frameFromState(emptyGameState());
    const b = frameFromState(emptyGameState());
    expect(a.workRamHash).toBe(b.workRamHash);
    expect(typeof a.workRamHash).toBe("number");
  });

  it("workRamHash changes when work RAM changes", () => {
    const sa = emptyGameState();
    const sb = emptyGameState();
    sb.workRam[0x100] = 0xAB; // any address outside the excluded 0x440-0x447 range
    const a = frameFromState(sa);
    const b = frameFromState(sb);
    expect(a.workRamHash).not.toBe(b.workRamHash);
  });

  it("workRamHash ignores stack low water (0x440-0x447)", () => {
    const sa = emptyGameState();
    const sb = emptyGameState();
    sb.workRam[0x440] = 0xFF;
    sb.workRam[0x441] = 0xFF;
    sb.workRam[0x447] = 0xFF;
    expect(frameFromState(sa).workRamHash).toBe(frameFromState(sb).workRamHash);
  });
});
