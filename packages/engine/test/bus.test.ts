/**
 * Test bus.ts - verifies memory map dispatch.
 */

import { describe, it, expect } from "vitest";
import {
  createBus,
  emptyRomImage,
  read8,
  read16,
  read32,
  write8,
  write16,
  write32,
  WORK_RAM_BASE,
  CART_RAM_BASE,
  PAL_RAM_BASE,
  MMIO_TRAKBALL_BASE,
  MMIO_SWITCHES,
} from "../src/bus.js";
import { emptyGameState } from "../src/state.js";
import { as_u8, as_u16, as_u32 } from "../src/wrap.js";

describe("Bus memory map", () => {
  it("ROM read returns program byte", () => {
    const rom = emptyRomImage();
    rom.program[0x100] = 0xAB;
    rom.program[0x101] = 0xCD;
    const bus = createBus(rom, emptyGameState());
    expect(read8(bus, 0x100) as unknown as number).toBe(0xAB);
    expect(read16(bus, 0x100) as unknown as number).toBe(0xABCD);
  });

  it("Work RAM read/write round-trip", () => {
    const bus = createBus(emptyRomImage(), emptyGameState());
    write8(bus, WORK_RAM_BASE + 0x14, as_u8(0x42));
    expect(read8(bus, WORK_RAM_BASE + 0x14) as unknown as number).toBe(0x42);

    write16(bus, WORK_RAM_BASE + 0x100, as_u16(0xDEAD));
    expect(read16(bus, WORK_RAM_BASE + 0x100) as unknown as number).toBe(0xDEAD);

    write32(bus, WORK_RAM_BASE + 0x200, as_u32(0xCAFEBABE));
    expect(read32(bus, WORK_RAM_BASE + 0x200) as unknown as number).toBe(0xCAFEBABE);
  });

  it("Cartridge RAM 1MB read/write round-trip (lazy alloc)", () => {
    const bus = createBus(emptyRomImage(), emptyGameState());
    write32(bus, CART_RAM_BASE + 0x12345, as_u32(0x12345678));
    expect(read32(bus, CART_RAM_BASE + 0x12345) as unknown as number).toBe(0x12345678);
  });

  it("Palette RAM read/write", () => {
    const bus = createBus(emptyRomImage(), emptyGameState());
    write16(bus, PAL_RAM_BASE + 0x10, as_u16(0xF00F));
    expect(read16(bus, PAL_RAM_BASE + 0x10) as unknown as number).toBe(0xF00F);
  });

  it("ROM is read-only (write ignored)", () => {
    const rom = emptyRomImage();
    rom.program[0x500] = 0x11;
    const bus = createBus(rom, emptyGameState());
    write8(bus, 0x500, as_u8(0x99));
    expect(read8(bus, 0x500) as unknown as number).toBe(0x11); // unchanged
  });

  it("MMIO writes are no-op (don't crash)", () => {
    const bus = createBus(emptyRomImage(), emptyGameState());
    expect(() => {
      write16(bus, 0x800000, as_u16(0x1234)); // X scroll
      write16(bus, 0x820000, as_u16(0x100));  // Y scroll
      write16(bus, 0x840000, as_u16(0xAA));   // priority
      write8(bus, 0x860001, as_u8(0x80));     // AV control
      write16(bus, 0x880000, as_u16(0));      // watchdog
      write16(bus, 0x8A0000, as_u16(0));      // VBLANK ack
    }).not.toThrow();
  });

  it("trackball read with rotation 45° (Marble specific)", () => {
    const state = emptyGameState();
    // signed -10, +20
    state.input.trackballDx = as_u8(0xF6); // -10
    state.input.trackballDy = as_u8(0x14); // +20
    const bus = createBus(emptyRomImage(), state);

    // F20000 (P1, port 0, byte 0): posx + posy = -10 + 20 = +10 = 0x0A
    expect(read8(bus, MMIO_TRAKBALL_BASE) as unknown as number).toBe(0x0A);
    // F20002 (P1, port 0, byte 1=odd... wait let me check)
    // Actually a-base = 2, player = 1, which = 0, port = 1
    // We return posx-posy = -10-20 = -30 = 0xE2
    // Hmm actually our implementation returns posx-posy when which=0,
    // posx+posy when which=0... let me verify.
    // a=2: a&1=0 (which), (a>>1)&1=1 (player), (a>>2)&1=0 (port)
    // player=1 → returns 0 (Marble has only P1)
    expect(read8(bus, MMIO_TRAKBALL_BASE + 2) as unknown as number).toBe(0);
  });

  it("switches port: START1 button pressed", () => {
    const state = emptyGameState();
    state.input.buttons = as_u8(0x01); // START1
    const bus = createBus(emptyRomImage(), state);
    // F60001 low byte: bit 0 = START1, active-low (0 when pressed)
    const v = read8(bus, MMIO_SWITCHES + 1) as unknown as number;
    expect(v & 0x01).toBe(0); // pressed
  });

  it("unmapped access bumps counter", () => {
    const bus = createBus(emptyRomImage(), emptyGameState());
    const before = bus.unmappedAccesses;
    read8(bus, 0xCAFE00); // unmapped
    expect(bus.unmappedAccesses).toBeGreaterThan(before);
  });
});
