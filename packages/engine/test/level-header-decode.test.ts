/**
 * Unit test per `decodeLevelHeader` — verifica che la decode statica dei
 * campi noti corrisponda al layout documentato in
 * `docs/level-header-format.md`.
 *
 * Test sono ROM-free: costruiscono header sintetici byte-per-byte e
 * verificano che ogni campo sia letto al giusto offset, size, signedness.
 *
 * Il test cross-ROM (lettura dei 6 header reali) sta in `level.test.ts`
 * sotto `describeWithRom`.
 */

import { describe, it, expect } from "vitest";
import {
  LEVEL_HEADER_SIZE,
  LEVEL_COLUMN_TABLE_OFFSET,
  decodeLevelHeader,
} from "../src/level.js";

function makeRawHeader(): Uint8Array {
  // Header con byte-pattern distintivo a ogni offset, per verificare
  // mapping offset->field senza ambiguita'.
  const raw = new Uint8Array(LEVEL_HEADER_SIZE);
  // +0x00..0x03 = 0xDE 0xAD 0xBE 0xEF → directTerrainPtr = 0xDEADBEEF
  raw[0x00] = 0xde;
  raw[0x01] = 0xad;
  raw[0x02] = 0xbe;
  raw[0x03] = 0xef;
  // +0x04..0x07 = 0xCA 0xFE 0xBA 0xBE → tileWordTablePtr
  raw[0x04] = 0xca;
  raw[0x05] = 0xfe;
  raw[0x06] = 0xba;
  raw[0x07] = 0xbe;
  // +0x08..0x0B = 0x11 0x22 0x33 0x44 → rowBuildBitListPtr
  raw[0x08] = 0x11;
  raw[0x09] = 0x22;
  raw[0x0a] = 0x33;
  raw[0x0b] = 0x44;
  // +0x0C..0x0F = 0xAA 0xBB 0xCC 0xDD → rleSourcePtr
  raw[0x0c] = 0xaa;
  raw[0x0d] = 0xbb;
  raw[0x0e] = 0xcc;
  raw[0x0f] = 0xdd;
  // +0x10..0x11 = 0x80 0x00 → yScrollBase = signed -0x8000 = -32768
  raw[0x10] = 0x80;
  raw[0x11] = 0x00;
  // +0x12..0x13 = 0x00 0x10 → yScrollRange = 16
  raw[0x12] = 0x00;
  raw[0x13] = 0x10;
  // +0x14..+0x1F = entity init positions (6 words, 12 bytes).
  // Pattern: 0x10 0x01, 0x20 0x02, 0x30 0x03, ..., 0x60 0x06
  // The third word (offset +0x18, i=2) also serves as maxTileBound.
  for (let i = 0; i < 6; i++) {
    raw[0x14 + i * 2] = (i + 1) * 0x10;
    raw[0x15 + i * 2] = i + 1;
  }
  // +0x18 specifically: 0x30 0x03 → signed = +0x3003 = 12291 (also written above)
  // +0x20..0x23 = 0x99 0x88 0x77 0x66 → subPatternTablePtr
  raw[0x20] = 0x99;
  raw[0x21] = 0x88;
  raw[0x22] = 0x77;
  raw[0x23] = 0x66;
  // +0x24..0x25 = 0x55 0x44 → binsearchEndIndex
  raw[0x24] = 0x55;
  raw[0x25] = 0x44;
  // +0x26..0x29 = 0xF0 0xE0 0xD0 0xC0 → binsearchBasePtr
  raw[0x26] = 0xf0;
  raw[0x27] = 0xe0;
  raw[0x28] = 0xd0;
  raw[0x29] = 0xc0;
  // +0x2A..0x2D = 0x01 0x02 0x03 0x04 → extByteTablePtr
  raw[0x2a] = 0x01;
  raw[0x2b] = 0x02;
  raw[0x2c] = 0x03;
  raw[0x2d] = 0x04;
  return raw;
}

describe("decodeLevelHeader (synthetic input)", () => {
  it("LEVEL_HEADER_SIZE = 0x2E", () => {
    expect(LEVEL_HEADER_SIZE).toBe(0x2e);
  });

  it("LEVEL_COLUMN_TABLE_OFFSET = LEVEL_HEADER_SIZE", () => {
    expect(LEVEL_COLUMN_TABLE_OFFSET).toBe(LEVEL_HEADER_SIZE);
  });

  it("rejects raw shorter than LEVEL_HEADER_SIZE", () => {
    expect(() => decodeLevelHeader(new Uint8Array(0x2d))).toThrow();
  });

  it("accepts raw exactly LEVEL_HEADER_SIZE", () => {
    expect(() => decodeLevelHeader(new Uint8Array(0x2e))).not.toThrow();
  });

  it("accepts raw larger than LEVEL_HEADER_SIZE (only first 0x2E used)", () => {
    expect(() => decodeLevelHeader(new Uint8Array(0x100))).not.toThrow();
  });

  it("decodes directTerrainPtr at +0x00 (BE long unsigned)", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.directTerrainPtr).toBe(0xdeadbeef);
  });

  it("decodes tileWordTablePtr at +0x04 (BE long unsigned)", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.tileWordTablePtr).toBe(0xcafebabe);
  });

  it("decodes rowBuildBitListPtr at +0x08 (BE long unsigned)", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.rowBuildBitListPtr).toBe(0x11223344);
  });

  it("decodes rleSourcePtr at +0x0C (BE long unsigned)", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.rleSourcePtr).toBe(0xaabbccdd);
  });

  it("decodes yScrollBase at +0x10 as SIGNED word (sign-extended)", () => {
    const h = decodeLevelHeader(makeRawHeader());
    // raw 0x8000 → signed = -32768
    expect(h.yScrollBase).toBe(-32768);
  });

  it("decodes yScrollRange at +0x12 as SIGNED word", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.yScrollRange).toBe(16);
  });

  it("decodes entityInitPositions as 6 unsigned words at +0x14..+0x1E", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.entityInitPositions).toEqual([
      0x1001, 0x2002, 0x3003, 0x4004, 0x5005, 0x6006,
    ]);
  });

  it("decodes maxTileBound at +0x18 as SIGNED word", () => {
    const h = decodeLevelHeader(makeRawHeader());
    // raw word at +0x18 = 0x3003, signed positive
    expect(h.maxTileBound).toBe(0x3003);
  });

  it("maxTileBound and entityInitPositions[2] share the same bytes", () => {
    const h = decodeLevelHeader(makeRawHeader());
    // Same raw word interpreted differently:
    // - entityInitPositions[2] = unsigned 0x3003 (packed hi/lo)
    // - maxTileBound = signed 0x3003 (bound)
    // They share the byte range +0x18..+0x19. Different semantic, same bytes.
    expect(h.entityInitPositions[2]).toBe(0x3003);
    expect(h.maxTileBound).toBe(0x3003);
  });

  it("decodes rowBuildEntryCount at +0x1A as SIGNED word", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.rowBuildEntryCount).toBe(0x4004);
    expect(h.entityInitPositions[3]).toBe(0x4004);
  });

  it("decodes tileLineDescriptorPtr at +0x1C (BE long unsigned)", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.tileLineDescriptorPtr).toBe(0x50056006);
    expect(h.entityInitPositions[4]).toBe(0x5005);
    expect(h.entityInitPositions[5]).toBe(0x6006);
  });

  it("rowBuildEntryCount treats high bit as sign (negative case)", () => {
    const raw = makeRawHeader();
    raw[0x1a] = 0x80;
    raw[0x1b] = 0x01;
    const h = decodeLevelHeader(raw);
    expect(h.rowBuildEntryCount).toBe(-32767);
    expect(h.entityInitPositions[3]).toBe(0x8001);
  });

  it("maxTileBound treats high bit as sign (negative case)", () => {
    const raw = makeRawHeader();
    raw[0x18] = 0xff;
    raw[0x19] = 0xfe;
    const h = decodeLevelHeader(raw);
    expect(h.maxTileBound).toBe(-2);
    expect(h.entityInitPositions[2]).toBe(0xfffe);
  });

  it("decodes subPatternTablePtr at +0x20 (BE long unsigned)", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.subPatternTablePtr).toBe(0x99887766);
  });

  it("decodes binsearchEndIndex at +0x24 as SIGNED word", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.binsearchEndIndex).toBe(0x5544);
  });

  it("binsearchEndIndex treats high bit as sign (negative case)", () => {
    const raw = makeRawHeader();
    raw[0x24] = 0xff;
    raw[0x25] = 0xfe;
    const h = decodeLevelHeader(raw);
    expect(h.binsearchEndIndex).toBe(-2);
  });

  it("decodes binsearchBasePtr at +0x26 (BE long unsigned)", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.binsearchBasePtr).toBe(0xf0e0d0c0);
  });

  it("decodes extByteTablePtr at +0x2A (BE long unsigned)", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.extByteTablePtr).toBe(0x01020304);
  });

  it("preserves raw bytes for row-builder fields", () => {
    const h = decodeLevelHeader(makeRawHeader());
    // +0x08..0x0B (rowBuildBitListPtr)
    expect(h.raw[0x08]).toBe(0x11);
    expect(h.raw[0x09]).toBe(0x22);
    expect(h.raw[0x0a]).toBe(0x33);
    expect(h.raw[0x0b]).toBe(0x44);
    // +0x24..0x25 (binsearchEndIndex)
    expect(h.raw[0x24]).toBe(0x55);
    expect(h.raw[0x25]).toBe(0x44);
  });

  it("raw length is exactly LEVEL_HEADER_SIZE", () => {
    const h = decodeLevelHeader(makeRawHeader());
    expect(h.raw.length).toBe(LEVEL_HEADER_SIZE);
  });
});

describe("decodeLevelHeader (zero header)", () => {
  it("all-zeros produces all-zero fields", () => {
    const h = decodeLevelHeader(new Uint8Array(LEVEL_HEADER_SIZE));
    expect(h.directTerrainPtr).toBe(0);
    expect(h.tileWordTablePtr).toBe(0);
    expect(h.rowBuildBitListPtr).toBe(0);
    expect(h.rleSourcePtr).toBe(0);
    expect(h.yScrollBase).toBe(0);
    expect(h.yScrollRange).toBe(0);
    expect(h.entityInitPositions).toEqual([0, 0, 0, 0, 0, 0]);
    expect(h.maxTileBound).toBe(0);
    expect(h.rowBuildEntryCount).toBe(0);
    expect(h.tileLineDescriptorPtr).toBe(0);
    expect(h.subPatternTablePtr).toBe(0);
    expect(h.binsearchEndIndex).toBe(0);
    expect(h.binsearchBasePtr).toBe(0);
    expect(h.extByteTablePtr).toBe(0);
  });
});
