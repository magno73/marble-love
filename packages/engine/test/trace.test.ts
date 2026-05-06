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
    expect(TRACE_SCHEMA_VERSION).toBe(2);
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

  it("workRamHashes ha 32 entry e cambia solo nella regione modificata", () => {
    const sa = emptyGameState();
    const sb = emptyGameState();
    sb.workRam[0x350] = 0xAB; // region 3 (0x300-0x3FF)
    const a = frameFromState(sa);
    const b = frameFromState(sb);
    expect(a.workRamHashes.length).toBe(32);
    expect(b.workRamHashes.length).toBe(32);
    for (let i = 0; i < 32; i++) {
      if (i === 3) {
        expect(a.workRamHashes[i]).not.toBe(b.workRamHashes[i]);
      } else {
        expect(a.workRamHashes[i]).toBe(b.workRamHashes[i]);
      }
    }
  });

  it("workRamHashes regione 30 ignora stack residue (0x1EE0-0x1EFF)", () => {
    const sa = emptyGameState();
    const sb = emptyGameState();
    sb.workRam[0x1EE0] = 0xFF;
    sb.workRam[0x1EE8] = 0xAB;
    sb.workRam[0x1EFF] = 0xCD;
    const a = frameFromState(sa);
    const b = frameFromState(sb);
    expect(a.workRamHashes[30]).toBe(b.workRamHashes[30]);
  });

  it("workRamHashes regione 30 cattura modifiche fuori dalla zona stack", () => {
    const sa = emptyGameState();
    const sb = emptyGameState();
    sb.workRam[0x1E00] = 0x01; // primo byte regione 30
    sb.workRam[0x1EDF] = 0x02; // ultimo byte non-stack
    const a = frameFromState(sa);
    const b = frameFromState(sb);
    expect(a.workRamHashes[30]).not.toBe(b.workRamHashes[30]);
  });

  it("workRamHashes regione 4 ignora stack low water (0x440-0x447)", () => {
    const sa = emptyGameState();
    const sb = emptyGameState();
    sb.workRam[0x440] = 0xFF;
    sb.workRam[0x447] = 0xFF;
    const a = frameFromState(sa);
    const b = frameFromState(sb);
    expect(a.workRamHashes[4]).toBe(b.workRamHashes[4]);
  });

  it("workRamHashes localizza correttamente bordi tra regioni", () => {
    const sa = emptyGameState();
    const sb = emptyGameState();
    sb.workRam[0xFF] = 0x01; // ultimo byte regione 0
    sb.workRam[0x100] = 0x01; // primo byte regione 1
    const a = frameFromState(sa);
    const b = frameFromState(sb);
    expect(a.workRamHashes[0]).not.toBe(b.workRamHashes[0]);
    expect(a.workRamHashes[1]).not.toBe(b.workRamHashes[1]);
    expect(a.workRamHashes[2]).toBe(b.workRamHashes[2]);
  });
});
