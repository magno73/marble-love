/**
 * sub-29cce.test.ts — smoke tests per FUN_29CCE replica MINIMAL CHUNK.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { fun29CCE } from "../src/sub-29cce.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const SLOT = 0x004009a4;
const SLOT_OFF = 0x09a4;
const PLAYER = 0x00400018;
const PLAYER_OFF = 0x18;
const SLOT_TABLE_OFF = 0x0a9c;
const CATAPULT_SCRIPT = 0x1db80;

function rL(workRam: Uint8Array, off: number): number {
  return (
    (((workRam[off]     ?? 0) << 24) |
     ((workRam[off + 1] ?? 0) << 16) |
     ((workRam[off + 2] ?? 0) <<  8) |
      (workRam[off + 3] ?? 0)) >>> 0
  );
}

function wL(workRam: Uint8Array, off: number, v: number): void {
  workRam[off]     = (v >>> 24) & 0xff;
  workRam[off + 1] = (v >>> 16) & 0xff;
  workRam[off + 2] = (v >>>  8) & 0xff;
  workRam[off + 3] =  v         & 0xff;
}

function wW(workRam: Uint8Array, off: number, v: number): void {
  workRam[off] = (v >>> 8) & 0xff;
  workRam[off + 1] = v & 0xff;
}

function wRomW(program: Uint8Array, off: number, v: number): void {
  program[off] = (v >>> 8) & 0xff;
  program[off + 1] = v & 0xff;
}

function hexToBytes(hex: string, expected: number): Uint8Array {
  expect(hex.length).toBeGreaterThanOrEqual(expected * 2);
  const out = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function loadLevel4EarlyWorkRam(): Uint8Array {
  const path = new URL("../../../oracle/scenarios/gameplay/level4_early.json", import.meta.url);
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    snapshots: Array<{ workRam: string }>;
  };
  return hexToBytes(raw.snapshots[0]!.workRam, 0x2000);
}

function signed32(v: number): number {
  return v | 0;
}

function negLong(v: number): number {
  return ((-(v | 0)) | 0) >>> 0;
}

function setupCatapultSlot(s: ReturnType<typeof emptyGameState>): void {
  s.workRam[SLOT_TABLE_OFF + 0x18] = 1;
  wL(s.workRam, SLOT_TABLE_OFF + 0x0c, 0x01000000);
  wL(s.workRam, SLOT_TABLE_OFF + 0x10, 0x02000000);
  s.workRam[SLOT_TABLE_OFF + 0x1f] = 0x0a;
  wL(s.workRam, SLOT_TABLE_OFF + 0x3e, 0x00020c14);
  wL(s.workRam, SLOT_TABLE_OFF + 0x46, 0x00020c14);
  wW(s.workRam, 0x690, 0x0100);
  wW(s.workRam, 0x692, 0x0200);
}

function setupDynamicWallSlot(
  s: ReturnType<typeof emptyGameState>,
  colorTag: number,
  d6: number,
  a0: number,
): void {
  const baseX = 0x0100;
  const baseY = 0x0200;
  s.workRam[SLOT_TABLE_OFF + 0x18] = 1;
  wW(s.workRam, 0x690, baseX);
  wW(s.workRam, 0x692, baseY);
  wW(s.workRam, SLOT_TABLE_OFF + 0x0c, (baseX + d6) & 0xffff);
  wW(s.workRam, SLOT_TABLE_OFF + 0x10, (baseY + a0) & 0xffff);
  s.workRam[SLOT_TABLE_OFF + 0x1f] = colorTag & 0xff;
}

function setupProximity05Slot(
  s: ReturnType<typeof emptyGameState>,
  d6: number,
  a0: number,
): void {
  const baseX = 0x0200;
  const baseY = 0x0300;
  s.workRam[SLOT_TABLE_OFF + 0x18] = 1;
  s.workRam[SLOT_TABLE_OFF + 0x1f] = 0x05;
  wW(s.workRam, 0x690, baseX);
  wW(s.workRam, 0x692, baseY);
  wW(s.workRam, SLOT_TABLE_OFF + 0x0c, (baseX + d6) & 0xffff);
  wW(s.workRam, SLOT_TABLE_OFF + 0x10, (baseY + a0) & 0xffff);
}

function setupGateSlot(
  s: ReturnType<typeof emptyGameState>,
  colorTag: 0x0b | 0x0d,
  d6: number,
  a0: number,
): void {
  const baseX = 0x0200;
  const baseY = 0x0300;
  s.workRam[SLOT_TABLE_OFF + 0x18] = 1;
  s.workRam[SLOT_TABLE_OFF + 0x19] = 0x07;
  s.workRam[SLOT_TABLE_OFF + 0x1a] = 4;
  s.workRam[SLOT_TABLE_OFF + 0x1f] = colorTag;
  wW(s.workRam, 0x690, baseX);
  wW(s.workRam, 0x692, baseY);
  wW(s.workRam, SLOT_TABLE_OFF + 0x0c, (baseX + d6) & 0xffff);
  wW(s.workRam, SLOT_TABLE_OFF + 0x10, (baseY + a0) & 0xffff);
  wL(s.workRam, SLOT_TABLE_OFF + 0x46, colorTag === 0x0b ? 0x00022016 : 0x000220a6);
}

function setupBounce0CSlot(
  s: ReturnType<typeof emptyGameState>,
  d6: number,
  a0: number,
  previousInside: boolean,
): void {
  const baseX = 0x0200;
  const baseY = 0x0300;
  const slotX = (baseX + d6) & 0xffff;
  const slotY = (baseY + a0) & 0xffff;

  s.workRam[SLOT_TABLE_OFF + 0x18] = 1;
  s.workRam[SLOT_TABLE_OFF + 0x1a] = 1;
  s.workRam[SLOT_TABLE_OFF + 0x1f] = 0x0c;
  wW(s.workRam, 0x690, baseX);
  wW(s.workRam, 0x692, baseY);
  wW(s.workRam, SLOT_TABLE_OFF + 0x0c, slotX);
  wW(s.workRam, SLOT_TABLE_OFF + 0x10, slotY);

  // FUN_29CCE tag 0x0c does A5=(slot+0x3e), A1=(A5), then reads bbox
  // signed bytes A1+4..+7. This record describes [-8,-8] with 16x16 extent,
  // expanded by the ROM branch to current-delta range [-11, 11).
  wL(s.workRam, SLOT_TABLE_OFF + 0x3e, 0x00401800);
  wL(s.workRam, 0x1800, 0x00401810);
  s.workRam[0x1814] = 0xf8; // -8
  s.workRam[0x1815] = 0xf8; // -8
  s.workRam[0x1816] = 0x10; // +16
  s.workRam[0x1817] = 0x10; // +16

  const prevBaseX = previousInside ? baseX : (slotX + 0x40) & 0xffff;
  const prevBaseY = previousInside ? baseY : (slotY + 0x40) & 0xffff;
  wL(s.workRam, 0x684, (prevBaseX << 16) >>> 0);
  wL(s.workRam, 0x688, (prevBaseY << 16) >>> 0);
}

describe("fun29CCE (FUN_29CCE minimal chunk)", () => {
  it("non solleva eccezioni con state vuoto e slot vuoto", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => fun29CCE(s, SLOT, rom)).not.toThrow();
  });

  it("PROLOGUE clr.b *(0x58,A2): byte +0x58 azzerato dopo chiamata", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[SLOT_OFF + 0x58] = 0x42;
    fun29CCE(s, SLOT, rom);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0x00);
  });

  it("EPILOGUE flag *(0x666)==0 e *(0x668)==0 → nessun neg.l su vx/vy", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // vx = 0x12345678
    wL(s.workRam, SLOT_OFF + 0x00, 0x12345678);
    // vy = 0xDEADBEEF
    wL(s.workRam, SLOT_OFF + 0x04, 0xdeadbeef);
    // flag globals 0x666/0x668 = 0
    s.workRam[0x666] = 0;
    s.workRam[0x668] = 0;
    fun29CCE(s, SLOT, rom);
    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0x12345678);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0xdeadbeef);
  });

  it("EPILOGUE flag *(0x666) != 0 → x = *(0x684), vx = -vx", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    wL(s.workRam, SLOT_OFF + 0x00, 0x00010000); // vx = 0x10000
    wL(s.workRam, SLOT_OFF + 0x0c, 0x99999999); // x dummy
    wL(s.workRam, 0x684, 0xaabbccdd);            // *(0x400684) = restore
    s.workRam[0x666] = 0x01;
    fun29CCE(s, SLOT, rom);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0xaabbccdd);
    // vx = -0x10000 = 0xFFFF0000 (32-bit two's complement)
    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0xffff0000);
  });

  it("EPILOGUE flag *(0x668) != 0 → y = *(0x688), vy = -vy", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    wL(s.workRam, SLOT_OFF + 0x04, 0x00020000); // vy = 0x20000
    wL(s.workRam, SLOT_OFF + 0x10, 0x77777777); // y dummy
    wL(s.workRam, 0x688, 0x11223344);            // *(0x400688)
    s.workRam[0x668] = 0x80;
    fun29CCE(s, SLOT, rom);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0x11223344);
    // vy = -0x20000 = 0xFFFE0000
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0xfffe0000);
  });

  it("sound dispatch: D3=0x10 (initial +0x58 in arm) e D0=0 (clr) → soundCmdSend(0x44)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[SLOT_OFF + 0x58] = 0x10;
    let soundArg: number | undefined;
    fun29CCE(s, SLOT, rom, {
      soundCmdSend158AC: (_st, b) => { soundArg = b; return 1; },
    });
    // d0 (rilettura post-clr) = 0 → !isMatch(d0); d3=0x10 → isMatch → 0x44
    expect(soundArg).toBe(0x44);
  });

  // ── LOOP outer + jump table dispatch tests ───────────────────────────

  it("LOOP: slot table vuota (s18=0 alla prima iter) → scansiona tutti gli slot senza scrivere", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Slot table (0x400a9c offset 0xa9c) tutta zero → ogni s18=0 salta a 0x2b0f6.
    expect(s.workRam[0xa9c + 0x18]).toBe(0);
    fun29CCE(s, SLOT, rom);
    // (0x58,A2) deve essere 0 (cleared in prologue); e nessun tag scritto.
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0);
    expect(s.workRam[SLOT_OFF + 0x59]).toBe(0);
  });

  it("LOOP: uno slot inattivo prima del tubo non ferma la scansione ROM", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const slot4 = SLOT_TABLE_OFF + 4 * 0x56;

    // slot0..3 restano inattivi. Il ROM salta ciascun buco via 0x2b0f6 e deve
    // comunque raggiungere lo slot4, che rappresenta la bocca tubo Beginner.
    s.workRam[slot4 + 0x18] = 1;
    s.workRam[slot4 + 0x1f] = 0x14;
    wW(s.workRam, slot4 + 0x0c, 0x0108);
    wW(s.workRam, slot4 + 0x10, 0x0200);
    wW(s.workRam, slot4 + 0x14, 0x3f30);
    wW(s.workRam, 0x690, 0x0100);
    wW(s.workRam, 0x692, 0x0200);
    wW(s.workRam, 0x696, 0x0020); // d1 = (0x0108 >> 3) - 0x20 = 1
    wW(s.workRam, 0x698, 0x0040); // d2 = (0x0200 >> 3) - 0x40 = 0
    wL(s.workRam, SLOT_OFF + 0x14, 0x003f3000);

    fun29CCE(s, SLOT, rom);

    expect(s.debug?.lastTubeProbe?.slotIndex).toBe(4);
    expect(s.debug?.lastTubeProbe?.result).toBe("teleport");
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0x14);
    expect(s.workRam[SLOT_OFF + 0x59]).toBe(0x12);
  });

  it("LOOP color 0x10: D1∈[0..0x10) AND D2∈[0..0xe) → tag-write", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Setup slot 0 attivo con color=0x10.
    // D1 = (slotX_w >> 3) - g696, D2 = (slotY_w >> 3) - g698.
    // Con g696=0 g698=0, slotX_w >> 3 = 0..0xf, slotY_w >> 3 = 0..0xd.
    // slotX_w = 8 → asr 3 = 1 → D1=1 (in [0,0x10)).
    // slotY_w = 8 → asr 3 = 1 → D2=1 (in [0,0xe)).
    s.workRam[0xa9c + 0x18] = 1;          // active
    s.workRam[0xa9c + 0x0c] = 0;
    s.workRam[0xa9c + 0x0d] = 8;          // slotX_w = 8
    s.workRam[0xa9c + 0x10] = 0;
    s.workRam[0xa9c + 0x11] = 8;          // slotY_w = 8
    s.workRam[0xa9c + 0x1f] = 0x10;       // color tag
    fun29CCE(s, SLOT, rom);
    // Tag scritto: (0x58,A2)=0x10, (0x59,A2)=-1
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0x10);
    expect(s.workRam[SLOT_OFF + 0x59]).toBe(0xff);
  });

  it("LOOP color 0x10 fuori range D2: tag NON scritto", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0xa9c + 0x18] = 1;
    s.workRam[0xa9c + 0x0c] = 0;
    s.workRam[0xa9c + 0x0d] = 8;
    s.workRam[0xa9c + 0x10] = 0;
    s.workRam[0xa9c + 0x11] = 0x80;       // slotY_w = 0x80 → asr 3 = 0x10 → D2=0x10 (>= 0xe)
    s.workRam[0xa9c + 0x1f] = 0x10;
    fun29CCE(s, SLOT, rom);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0);
    expect(s.workRam[SLOT_OFF + 0x59]).toBe(0);
  });

  it("LOOP color out-of-range (0x4): nessun dispatch (skip jump table)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0xa9c + 0x18] = 1;
    s.workRam[0xa9c + 0x1f] = 0x04;       // out of range (< 5)
    fun29CCE(s, SLOT, rom);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0);
  });

  it("LOOP color 0x32: D1∈[0..4) AND D2∈[0..2) → tag-write", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0xa9c + 0x18] = 1;
    s.workRam[0xa9c + 0x0c] = 0;
    s.workRam[0xa9c + 0x0d] = 0x10;       // slotX_w=0x10 → asr3=2 → D1=2
    s.workRam[0xa9c + 0x10] = 0;
    s.workRam[0xa9c + 0x11] = 8;          // slotY_w=8 → asr3=1 → D2=1
    s.workRam[0xa9c + 0x1f] = 0x32;
    fun29CCE(s, SLOT, rom);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0x32);
    expect(s.workRam[SLOT_OFF + 0x59]).toBe(0xff);
  });

  it("LOOP color 0x0a: catapult launches grounded marble and starts arm script", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const sounds: number[] = [];

    // Keep helper12896 from consuming an all-zero fake script in this unit test.
    // The real ROM has the catapult animation bytecode at 0x1DB80.
    wRomW(rom.program, CATAPULT_SCRIPT, 0xffff);
    setupCatapultSlot(s);
    wL(s.workRam, SLOT_OFF + 0x14, 0x003fc000);

    fun29CCE(s, SLOT, rom, {
      soundCmdSend158AC: (_st, b) => { sounds.push(b); return 1; },
    });

    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0x01000000);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0x02000000);
    expect(rL(s.workRam, SLOT_OFF + 0x14)).toBe(0x003cc000);
    expect(rL(s.workRam, SLOT_OFF + 0x08)).toBe(0x000a0000);
    expect(signed32(rL(s.workRam, SLOT_OFF + 0x00))).toBeGreaterThanOrEqual(-0x1000);
    expect(signed32(rL(s.workRam, SLOT_OFF + 0x00))).toBeLessThanOrEqual(0x0fff);
    expect(signed32(rL(s.workRam, SLOT_OFF + 0x04))).toBeGreaterThanOrEqual(-0x2efff);
    expect(signed32(rL(s.workRam, SLOT_OFF + 0x04))).toBeLessThanOrEqual(-0x25000);
    expect(s.workRam[SLOT_OFF + 0x36]).toBe(0x02);
    expect(s.workRam[SLOT_OFF + 0x1a]).toBe(0x03);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0x0a);
    expect(s.workRam[SLOT_OFF + 0x59]).toBe(0x0f);
    expect(rL(s.workRam, SLOT_TABLE_OFF + 0x36)).toBe(CATAPULT_SCRIPT + 2);
    expect(sounds.slice(0, 2)).toEqual([0x3a, 0x3b]);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x0a);
  });

  it("LOOP color 0x0a: fuori dal tight hitbox non lancia", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    setupCatapultSlot(s);
    wL(s.workRam, SLOT_TABLE_OFF + 0x0c, 0x01080000); // d6 = +8 → skip
    wL(s.workRam, SLOT_OFF + 0x14, 0x003fc000);

    fun29CCE(s, SLOT, rom);

    expect(rL(s.workRam, SLOT_OFF + 0x14)).toBe(0x003fc000);
    expect(rL(s.workRam, SLOT_OFF + 0x08)).toBe(0);
    expect(s.workRam[SLOT_OFF + 0x1a]).toBe(0);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0);
  });

  it("LOOP color 0x0a: catapult busy restores saved XY without relaunching", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    setupCatapultSlot(s);
    wL(s.workRam, SLOT_TABLE_OFF + 0x3e, 0x00020c18);
    wL(s.workRam, 0x684, 0x0badcafe);
    wL(s.workRam, 0x688, 0x0ddf00d0);
    wL(s.workRam, SLOT_OFF + 0x0c, 0x11111111);
    wL(s.workRam, SLOT_OFF + 0x10, 0x22222222);
    wL(s.workRam, SLOT_OFF + 0x14, 0x003fc000);

    fun29CCE(s, SLOT, rom);

    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0x0badcafe);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0x0ddf00d0);
    expect(rL(s.workRam, SLOT_OFF + 0x14)).toBe(0x003fc000);
    expect(rL(s.workRam, SLOT_OFF + 0x08)).toBe(0);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0);
  });

  it("LOOP color 0x05: proximity bumper restores XY, reflects velocity, and plays sound 0x42", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const sounds: number[] = [];

    setupProximity05Slot(s, 1, -1);
    wL(s.workRam, SLOT_OFF + 0x00, 0x00030000);
    wL(s.workRam, SLOT_OFF + 0x04, 0xfffd0000);
    wL(s.workRam, SLOT_OFF + 0x0c, 0x11111111);
    wL(s.workRam, SLOT_OFF + 0x10, 0x22222222);
    wL(s.workRam, 0x684, 0x01020304);
    wL(s.workRam, 0x688, 0x05060708);

    fun29CCE(s, SLOT, rom, {
      soundCmdSend158AC: (_st, b) => { sounds.push(b); return 1; },
    });

    expect(s.workRam[0x666]).toBe(1);
    expect(s.workRam[0x668]).toBe(1);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0x01020304);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0x05060708);
    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0xfffd0000);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0x00030000);
    expect(sounds).toEqual([0x42]);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x05);
    expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("flag");
  });

  it("LOOP color 0x05: outside ROM proximity radius is a no-op", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const sounds: number[] = [];

    setupProximity05Slot(s, 4, 0);
    wL(s.workRam, SLOT_OFF + 0x00, 0x00030000);
    wL(s.workRam, SLOT_OFF + 0x04, 0xfffd0000);
    wL(s.workRam, SLOT_OFF + 0x0c, 0x11111111);
    wL(s.workRam, SLOT_OFF + 0x10, 0x22222222);
    wL(s.workRam, 0x684, 0x01020304);
    wL(s.workRam, 0x688, 0x05060708);

    fun29CCE(s, SLOT, rom, {
      soundCmdSend158AC: (_st, b) => { sounds.push(b); return 1; },
    });

    expect(s.workRam[0x666]).toBe(0);
    expect(s.workRam[0x668]).toBe(0);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0x11111111);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0x22222222);
    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0x00030000);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0xfffd0000);
    expect(sounds).toEqual([]);
    expect(s.debug?.lastTerrainSlotCollision).toBeUndefined();
  });

  it("LOOP color 0x06: ROM jump-table maps to iter-epilog no-op, not proximity bumper", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const sounds: number[] = [];

    setupDynamicWallSlot(s, 0x06, 1, -1);
    wL(s.workRam, SLOT_OFF + 0x00, 0x00030000);
    wL(s.workRam, SLOT_OFF + 0x04, 0xfffd0000);
    wL(s.workRam, SLOT_OFF + 0x0c, 0x11111111);
    wL(s.workRam, SLOT_OFF + 0x10, 0x22222222);
    wL(s.workRam, 0x684, 0x01020304);
    wL(s.workRam, 0x688, 0x05060708);

    fun29CCE(s, SLOT, rom, {
      soundCmdSend158AC: (_st, b) => { sounds.push(b); return 1; },
    });

    expect(s.workRam[0x666]).toBe(0);
    expect(s.workRam[0x668]).toBe(0);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0x11111111);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0x22222222);
    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0x00030000);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0xfffd0000);
    expect(sounds).toEqual([]);
    expect(s.debug?.lastTerrainSlotCollision).toBeUndefined();
  });

  it("LOOP color 0x05: tracked level4_early type5 slot applies proximity bumper physics", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const sounds: number[] = [];
    s.workRam.set(loadLevel4EarlyWorkRam());

    const beforeX = rL(s.workRam, PLAYER_OFF + 0x0c);
    const beforeY = rL(s.workRam, PLAYER_OFF + 0x10);
    const beforeVx = rL(s.workRam, PLAYER_OFF + 0x00);
    const beforeVy = rL(s.workRam, PLAYER_OFF + 0x04);

    fun29CCE(s, PLAYER, rom, {
      soundCmdSend158AC: (_st, b) => { sounds.push(b); return 1; },
    });

    expect(s.debug?.lastTerrainSlotCollision).toMatchObject({
      slotIndex: 12,
      colorTag: 0x05,
      reason: "flag",
      d6: 0,
      a0: 0,
    });
    expect(s.workRam[0x666]).toBe(1);
    expect(s.workRam[0x668]).toBe(1);
    expect(rL(s.workRam, PLAYER_OFF + 0x0c)).toBe(rL(s.workRam, 0x684));
    expect(rL(s.workRam, PLAYER_OFF + 0x10)).toBe(rL(s.workRam, 0x688));
    expect(rL(s.workRam, PLAYER_OFF + 0x00)).toBe(negLong(beforeVx));
    expect(rL(s.workRam, PLAYER_OFF + 0x04)).toBe(negLong(beforeVy));
    expect(rL(s.workRam, PLAYER_OFF + 0x0c)).not.toBe(beforeX);
    expect(rL(s.workRam, PLAYER_OFF + 0x10)).not.toBe(beforeY);
    expect(sounds).toEqual([0x42]);
  });

  it("LOOP color 0x0b: Aerial gate hit puts the marble into the ROM hit state", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    setupGateSlot(s, 0x0b, 8, -12);

    fun29CCE(s, SLOT, rom);

    expect(s.workRam[SLOT_OFF + 0x1a]).toBe(0x0a);
    expect(s.workRam[SLOT_OFF + 0x57]).toBe(0x20);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0x07);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x0b);
    expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("tag");
  });

  it("LOOP color 0x0d: Aerial gate side applies the signed impulse", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    setupGateSlot(s, 0x0d, -16, 8);

    fun29CCE(s, SLOT, rom);

    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0xffffc000);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0);
    expect(s.workRam[SLOT_OFF + 0x1a]).toBe(0);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x0d);
    expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("motion");
  });

  it("LOOP color 0x0b: Aerial gate outer block restores XY and reflects velocity", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    setupGateSlot(s, 0x0b, 0, 0);
    wL(s.workRam, SLOT_OFF + 0x00, 0x00010000);
    wL(s.workRam, SLOT_OFF + 0x04, 0x00020000);
    wL(s.workRam, SLOT_OFF + 0x0c, 0x11111111);
    wL(s.workRam, SLOT_OFF + 0x10, 0x22222222);
    wL(s.workRam, 0x684, 0x0a000000);
    wL(s.workRam, 0x688, 0x0b000000);
    wW(s.workRam, 0x694, 0x3f80);
    wL(s.workRam, 0x68c, 0x3f900000);

    fun29CCE(s, SLOT, rom);

    expect(s.workRam[0x666]).toBe(1);
    expect(s.workRam[0x668]).toBe(1);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0x0a000000);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0x0b000000);
    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0xffff0000);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0xfffe0000);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x0b);
    expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("flag");
  });

  it("LOOP color 0x0c: dynamic obstacle bounce writes ROM vector state", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const sounds: number[] = [];

    setupBounce0CSlot(s, -4, -4, true);

    fun29CCE(s, PLAYER, rom, {
      soundCmdSend158AC: (_st, b) => { sounds.push(b); return 1; },
    });

    expect(rL(s.workRam, PLAYER_OFF + 0x00)).toBe(0x00040000);
    expect(rL(s.workRam, PLAYER_OFF + 0x04)).toBe(0);
    expect(s.workRam[PLAYER_OFF + 0x1a]).toBe(1);
    expect(s.workRam[PLAYER_OFF + 0x56]).toBe(0);
    expect(s.workRam[PLAYER_OFF + 0x57]).toBe(0x3c);
    expect(rL(s.workRam, PLAYER_OFF + 0x5a)).toBe(0x00020faa);
    expect(s.workRam[PLAYER_OFF + 0x5f]).toBe(0);
    expect(s.workRam[PLAYER_OFF + 0x60]).toBe(2);
    expect(sounds).toEqual([0x39]);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x0c);
    expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("motion");
  });

  it("LOOP color 0x0c: entering from outside sets both restore flags", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    setupBounce0CSlot(s, -4, -4, false);
    wL(s.workRam, PLAYER_OFF + 0x00, 0x00010000);
    wL(s.workRam, PLAYER_OFF + 0x04, 0x00020000);
    wL(s.workRam, PLAYER_OFF + 0x0c, 0x11111111);
    wL(s.workRam, PLAYER_OFF + 0x10, 0x22222222);

    fun29CCE(s, PLAYER, rom);

    expect(s.workRam[0x666]).toBe(1);
    expect(s.workRam[0x668]).toBe(1);
    expect(rL(s.workRam, PLAYER_OFF + 0x0c)).toBe(rL(s.workRam, 0x684));
    expect(rL(s.workRam, PLAYER_OFF + 0x10)).toBe(rL(s.workRam, 0x688));
    expect(rL(s.workRam, PLAYER_OFF + 0x00)).toBe(0xffff0000);
    expect(rL(s.workRam, PLAYER_OFF + 0x04)).toBe(0xfffe0000);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x0c);
    expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("flag");
  });

  const wallCases = [
    { tag: 0x1a, d6: -6, a0: -4, vx: 0x00020000, vy: 0xffff0000, flagX: 1, flagY: 1 },
    { tag: 0x1b, d6: -4, a0: -6, vx: 0xffff0000, vy: 0x00020000, flagX: 1, flagY: 1 },
    { tag: 0x1c, d6: -4, a0: -4, vx: 0xffff0000, vy: 0x00020000, flagX: 1, flagY: 1 },
    { tag: 0x1d, d6: -4, a0: -4, vx: 0x00020000, vy: 0xffff0000, flagX: 1, flagY: 1 },
    { tag: 0x1e, d6: 20, a0: -6, vx: 0x00010000, vy: 0x00020000, flagX: 0, flagY: 1 },
  ];

  for (const c of wallCases) {
    it(`LOOP color 0x${c.tag.toString(16)}: dynamic pipe/wall hit sets ROM X/Y flags`, () => {
      const s = emptyGameState();
      const rom = emptyRomImage();
      const sounds: number[] = [];

      setupDynamicWallSlot(s, c.tag, c.d6, c.a0);
      wL(s.workRam, SLOT_OFF + 0x00, c.vx);
      wL(s.workRam, SLOT_OFF + 0x04, c.vy);
      wL(s.workRam, SLOT_OFF + 0x0c, 0x11111111);
      wL(s.workRam, SLOT_OFF + 0x10, 0x22222222);
      wL(s.workRam, 0x684, 0x01020304);
      wL(s.workRam, 0x688, 0x05060708);

      fun29CCE(s, SLOT, rom, {
        soundCmdSend158AC: (_st, b) => { sounds.push(b); return 1; },
      });

      expect(s.workRam[0x666]).toBe(c.flagX);
      expect(s.workRam[0x668]).toBe(c.flagY);
      expect(sounds).toEqual([0x42]);
      expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(c.flagX ? 0x01020304 : 0x11111111);
      expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(c.flagY ? 0x05060708 : 0x22222222);
      expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(c.flagX ? negLong(c.vx) : c.vx);
      expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(c.flagY ? negLong(c.vy) : c.vy);
      expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(c.tag);
      expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("flag");
    });
  }

  it("LOOP color 0x1a: outside dynamic wall hitbox leaves flags and sound untouched", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const sounds: number[] = [];

    setupDynamicWallSlot(s, 0x1a, -0x0c, -4);

    fun29CCE(s, SLOT, rom, {
      soundCmdSend158AC: (_st, b) => { sounds.push(b); return 1; },
    });

    expect(s.workRam[0x666]).toBe(0);
    expect(s.workRam[0x668]).toBe(0);
    expect(sounds).toEqual([]);
    expect(s.debug?.lastTerrainSlotCollision).toBeUndefined();
  });

  it("LOOP color 0x22: Beginner tube segment supports the marble instead of letting it fall", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    s.workRam[SLOT_TABLE_OFF + 0x18] = 1;
    wW(s.workRam, SLOT_TABLE_OFF + 0x0c, 0x0010); // asr3=2
    wW(s.workRam, SLOT_TABLE_OFF + 0x10, 0x0010); // asr3=2
    s.workRam[SLOT_TABLE_OFF + 0x1f] = 0x22;
    wW(s.workRam, 0x696, 0x0001); // d1 = 1
    wW(s.workRam, 0x698, 0x0001); // d2 = 1
    wW(s.workRam, 0x694, 0x3f30); // below teleport threshold: support impulse path
    wL(s.workRam, SLOT_OFF + 0x00, 0x00012000);
    wL(s.workRam, SLOT_OFF + 0x04, 0x00024000);
    wL(s.workRam, SLOT_OFF + 0x08, 0xffffa000);

    fun29CCE(s, SLOT, rom);

    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0);
    expect(rL(s.workRam, SLOT_OFF + 0x08)).toBe(0x00003000);
    expect(s.workRam[SLOT_OFF + 0x36]).toBe(0x02);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0x00);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x22);
    expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("motion");
  });

  it("LOOP color 0x13: Beginner tube exit snaps the marble into the pipe route", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const sounds: number[] = [];

    setupDynamicWallSlot(s, 0x13, 0, 0);
    wW(s.workRam, 0x696, 0x001f); // d1 = (0x100 >> 3) - 0x1f = 1
    wW(s.workRam, 0x698, 0x0040); // d2 = (0x200 >> 3) - 0x40 = 0
    wL(s.workRam, SLOT_OFF + 0x14, 0x003f3000);

    fun29CCE(s, SLOT, rom, {
      soundCmdSend158AC: (_st, b) => { sounds.push(b); return 1; },
    });

    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0x00040000);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0x029c0000);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0x02e40000);
    expect(s.workRam[SLOT_OFF + 0x1a]).toBe(0x03);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0x13);
    expect(s.workRam[SLOT_OFF + 0x59]).toBe(0x12);
    expect(sounds.slice(0, 3)).toEqual([0x3a, 0x3b, 0x35]);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x13);
    expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("tag");
  });

  it("LOOP color 0x14: Beginner tube mouth keeps the ROM-exact D2==0 trigger", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    setupDynamicWallSlot(s, 0x14, 1, -22);
    wW(s.workRam, 0x696, 0x001f); // d1 = ((0x100 + 1) >> 3) - 0x1f = 1
    wW(s.workRam, 0x698, 0x003f); // d2 = ((0x200 - 22) >> 3) - 0x3f = -2
    wL(s.workRam, SLOT_OFF + 0x14, 0x003f3000);

    fun29CCE(s, SLOT, rom);

    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0);
    expect(s.workRam[SLOT_OFF + 0x59]).toBe(0);
    expect(s.debug?.lastTerrainSlotCollision).toBeUndefined();
  });

  it("LOOP color 0x16: visible Beginner tube body runs the ROM shape collision", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    setupDynamicWallSlot(s, 0x16, 0, 0);
    wW(s.workRam, SLOT_TABLE_OFF + 0x14, 0x3f30);
    wW(s.workRam, 0x694, 0x3f30);
    wL(s.workRam, 0x684, 0x01080000); // helper set-2 x lands at 0
    wL(s.workRam, 0x688, 0x02080000); // helper set-2 y lands at 0
    wL(s.workRam, 0x68c, 0x3f300000); // helper set-2 z lands at 0
    wL(s.workRam, SLOT_OFF + 0x00, 0x00010000);
    wL(s.workRam, SLOT_OFF + 0x04, 0x00020000);
    wL(s.workRam, SLOT_OFF + 0x08, 0x00030000);

    fun29CCE(s, SLOT, rom);

    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0xffff0000);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0xfffe0000);
    expect(rL(s.workRam, SLOT_OFF + 0x08)).toBe(0xfffd0000);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0x01080000);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0x02080000);
    expect(rL(s.workRam, SLOT_OFF + 0x14)).toBe(0x3f300000);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x16);
    expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("motion");
  });

  it("LOOP color 0x25: Beginner tube teleport branch is wired", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const sounds: number[] = [];

    setupDynamicWallSlot(s, 0x25, 0, 0);
    wW(s.workRam, 0x696, 0x0020); // d1 = 0
    wW(s.workRam, 0x698, 0x0040); // d2 = 0
    wW(s.workRam, 0x694, 0x3f30);
    wL(s.workRam, SLOT_OFF + 0x14, 0x003f3000);

    fun29CCE(s, SLOT, rom, {
      soundCmdSend158AC: (_st, b) => { sounds.push(b); return 1; },
    });

    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0x00040000);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0x00f00000);
    expect([0x01000000, 0x01400000]).toContain(rL(s.workRam, SLOT_OFF + 0x10));
    expect(s.workRam[SLOT_OFF + 0x1a]).toBe(0x03);
    expect(s.workRam[SLOT_OFF + 0x36]).toBe(0x00);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0x25);
    expect(s.workRam[SLOT_OFF + 0x59]).toBe(0x12);
    expect(sounds.slice(0, 4)).toEqual([0x46, 0x3a, 0x3b, 0x35]);
    expect(s.debug?.lastTerrainSlotCollision?.colorTag).toBe(0x25);
    expect(s.debug?.lastTerrainSlotCollision?.reason).toBe("tag");
  });

  it("LOOP color 0x1f: side-wall hit sets X flag, sends sound 0x42, and epilogue restores X/negates vx", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    let soundArg: number | undefined;

    wL(s.workRam, SLOT_OFF + 0x00, 0x0000fea3);
    wL(s.workRam, SLOT_OFF + 0x04, 0x00013cdc);
    wL(s.workRam, SLOT_OFF + 0x0c, 0x01a12070);
    wL(s.workRam, 0x684, 0x01a021cd);
    wW(s.workRam, 0x690, 0x01a1);
    wW(s.workRam, 0x692, 0x0171);

    s.workRam[0xa9c + 0x18] = 1;
    wW(s.workRam, 0xa9c + 0x0c, 0x01a0); // d6 = -1 vs g690
    wW(s.workRam, 0xa9c + 0x10, 0x0178); // a0 = 7 vs g692
    s.workRam[0xa9c + 0x1f] = 0x1f;

    fun29CCE(s, SLOT, rom, {
      soundCmdSend158AC: (_st, b) => { soundArg = b; return 1; },
    });

    expect(s.workRam[0x666]).toBe(1);
    expect(s.workRam[0x668]).toBe(0);
    expect(soundArg).toBe(0x42);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0x01a021cd);
    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0xffff015d);
  });
});
