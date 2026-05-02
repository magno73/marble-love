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
});
