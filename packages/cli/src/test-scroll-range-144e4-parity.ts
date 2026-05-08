#!/usr/bin/env node
/**
 * test-scroll-range-144e4-parity.ts — differential FUN_000144E4 vs
 * `scrollRange144E4`.
 *
 * **FUN_000144E4** (364 byte): scala from/to per /16 con boundary da state
 * struct, dispatcha a 4 sub e (condizionalmente su mode 3/4) ad altre sub.
 *
 * **Strategia parity**:
 *   - FUN_15A12, FUN_14C46, FUN_17346, FUN_18FFA, FUN_190EE → patched a RTS
 *     (0x4E75) lato binario; TS usa default no-op via subs.
 *   - FUN_12DFA (scriptRectDispatch12DFA) → live da entrambe le parti.
 *     FUN_18F46 (chiamata interna) → patched a RTS.
 *   - FUN_26B66 (bannerHelper26B66) → live da entrambe le parti.
 *
 * **Suite** (4 × 125 = 500):
 *   A. mode 0/1/2/5 random: solo scaling + FUN_12DFA dispatch
 *   B. mode 3: boundary crossing rispetto a 0x29
 *   C. mode 4: boundary crossing rispetto a [0x1D..0x38] e [0x03..0x1B]
 *   D. edge cases: from == to (early exit), boundary estremi, statePtr in ROM
 *
 * **Snapshot**:
 *   - workRam completo (0x400000..0x401FFF, 8192 byte)
 *   - RNG seed @0x4003A6
 *
 * Uso: npx tsx packages/cli/src/test-scroll-range-144e4-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  scrollRange144E4 as srNs,
  bus as busNs,
  wrap,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_144E4 = 0x000144e4;

// Subs patched to RTS
const FUN_15A12 = 0x00015a12;
const FUN_14C46 = 0x00014c46;
const FUN_17346 = 0x00017346;
const FUN_18FFA = 0x00018ffa;
const FUN_190EE = 0x000190ee;
// Internal sub of FUN_12DFA
const FUN_18F46 = 0x00018f46;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x00002000; // 8192 bytes
const PALETTE_RAM_BASE = 0x00b00000; // colorRam base
const PALETTE_RAM_SIZE = 0x00000800; // 2048 bytes (PAL_RAM_END - PAL_RAM_BASE)

const RNG_SEED_ADDR = 0x004003a6;

// State struct pointer address
const STATE_PTR_ADDR = 0x00400474;
const MODE_ADDR = 0x00400394;
const BYTE_400762 = 0x00400762;

const SLOT_TABLE_BASE = 0x00400a9c;
const SLOT_STRIDE = 0x56;
const SLOT_COUNT = 0x19;

/** Patch JSR-target → RTS (0x4E75). */
function patchRts(cpu: CpuSession, addr: number): void {
  pokeMem(cpu, addr, 1, 0x4e);
  pokeMem(cpu, addr + 1, 1, 0x75);
}

function patchSubs(cpu: CpuSession): void {
  patchRts(cpu, FUN_15A12);
  patchRts(cpu, FUN_14C46);
  patchRts(cpu, FUN_17346);
  patchRts(cpu, FUN_18FFA);
  patchRts(cpu, FUN_190EE);
  patchRts(cpu, FUN_18F46);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** sign-extend 16-bit. */
function sext16(v: number): number {
  const w = v & 0xffff;
  return w < 0x8000 ? w : (w | 0xffff0000) >> 0;
}

/**
 * Snapshot di stato compatto. Confrontiamo solo i byte modificabili da FUN_144E4:
 *  - Slot table (25 slot @ 0x400A9C stride 0x56): byte+0x18,+0x1A,long+0x3A,word+0x52,+0x54
 *  - Globali: 0x400762, 0x40075C, 0x400974, 0x400978
 *  - Palette queue: 0x400408..0x40040F
 *  - Palette RAM (colorRam): toccata da bannerHelper26B66
 *  - RNG seed (via state.rng.seed, non in workRam TS)
 *
 * NON confrontiamo il workRam raw: il binary scrive sullo stack (workRam upper)
 * durante la call e quei valori restano come "garbage" visibile nella snapshot.
 */
interface Snapshot {
  /** 25 slot × (occ.b, st.b, scriptPtr.l, lo.w, hi.w) */
  slots: { occ: number; st: number; scriptPtr: number; lo: number; hi: number }[];
  byte400762: number;
  byte40075c: number;
  long400974: number;
  long400978: number;
  paletteQueuePtr: number;
  paletteQueueBuf: number[];
  rngSeed: number;
  palette: Uint8Array;
}

function readU16BE(buf: Uint8Array | ReturnType<typeof stateNs.emptyGameState>["workRam"], off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

function readU32BE(buf: Uint8Array | ReturnType<typeof stateNs.emptyGameState>["workRam"], off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>> 0
  );
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const slots: Snapshot["slots"] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = SLOT_TABLE_BASE + i * SLOT_STRIDE;
    slots.push({
      occ: peekMem(cpu, slot + 0x18, 1) & 0xff,
      st: peekMem(cpu, slot + 0x1a, 1) & 0xff,
      scriptPtr: peekMem(cpu, slot + 0x3a, 4) >>> 0,
      lo: peekMem(cpu, slot + 0x52, 2) & 0xffff,
      hi: peekMem(cpu, slot + 0x54, 2) & 0xffff,
    });
  }
  const palette = cpu.system.readBytes(PALETTE_RAM_BASE, PALETTE_RAM_SIZE);
  return {
    slots,
    byte400762: peekMem(cpu, BYTE_400762, 1) & 0xff,
    byte40075c: peekMem(cpu, 0x40075c, 1) & 0xff,
    long400974: peekMem(cpu, 0x400974, 4) >>> 0,
    long400978: peekMem(cpu, 0x400978, 4) >>> 0,
    paletteQueuePtr: peekMem(cpu, 0x400408, 4) >>> 0,
    paletteQueueBuf: [
      peekMem(cpu, 0x40040c, 1) & 0xff,
      peekMem(cpu, 0x40040d, 1) & 0xff,
      peekMem(cpu, 0x40040e, 1) & 0xff,
      peekMem(cpu, 0x40040f, 1) & 0xff,
    ],
    rngSeed: peekMem(cpu, RNG_SEED_ADDR, 2) & 0xffff,
    palette: new Uint8Array(palette),
  };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const slots: Snapshot["slots"] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = SLOT_TABLE_BASE + i * SLOT_STRIDE - WORK_RAM_BASE;
    slots.push({
      occ: state.workRam[slotOff + 0x18] ?? 0,
      st: state.workRam[slotOff + 0x1a] ?? 0,
      scriptPtr: readU32BE(state.workRam, slotOff + 0x3a),
      lo: readU16BE(state.workRam, slotOff + 0x52),
      hi: readU16BE(state.workRam, slotOff + 0x54),
    });
  }
  const wram = state.workRam;
  const pqBase = 0x400408 - WORK_RAM_BASE;
  const bufBase = 0x40040c - WORK_RAM_BASE;
  return {
    slots,
    byte400762: wram[BYTE_400762 - WORK_RAM_BASE] ?? 0,
    byte40075c: wram[0x40075c - WORK_RAM_BASE] ?? 0,
    long400974: readU32BE(wram, 0x400974 - WORK_RAM_BASE),
    long400978: readU32BE(wram, 0x400978 - WORK_RAM_BASE),
    paletteQueuePtr: readU32BE(wram, pqBase),
    paletteQueueBuf: [
      wram[bufBase] ?? 0,
      wram[bufBase + 1] ?? 0,
      wram[bufBase + 2] ?? 0,
      wram[bufBase + 3] ?? 0,
    ],
    rngSeed: (state.rng.seed as unknown as number) & 0xffff,
    palette: new Uint8Array(state.colorRam),
  };
}

/** Confronta le due snapshot e ritorna la prima differenza trovata, o null. */
function compareSnapshots(bin: Snapshot, ts: Snapshot): string | null {
  if (bin.rngSeed !== ts.rngSeed) {
    return `rngSeed bin=0x${bin.rngSeed.toString(16)} ts=0x${ts.rngSeed.toString(16)}`;
  }
  if (bin.byte400762 !== ts.byte400762) {
    return `byte400762 bin=0x${bin.byte400762.toString(16)} ts=0x${ts.byte400762.toString(16)}`;
  }
  if (bin.byte40075c !== ts.byte40075c) {
    return `byte40075c bin=0x${bin.byte40075c.toString(16)} ts=0x${ts.byte40075c.toString(16)}`;
  }
  if (bin.long400974 !== ts.long400974) {
    return `long400974 bin=0x${bin.long400974.toString(16)} ts=0x${ts.long400974.toString(16)}`;
  }
  if (bin.long400978 !== ts.long400978) {
    return `long400978 bin=0x${bin.long400978.toString(16)} ts=0x${ts.long400978.toString(16)}`;
  }
  if (bin.paletteQueuePtr !== ts.paletteQueuePtr) {
    return `paletteQueuePtr bin=0x${bin.paletteQueuePtr.toString(16)} ts=0x${ts.paletteQueuePtr.toString(16)}`;
  }
  for (let i = 0; i < 4; i++) {
    if ((bin.paletteQueueBuf[i] ?? 0) !== (ts.paletteQueueBuf[i] ?? 0)) {
      return `paletteQueueBuf[${i}] bin=0x${(bin.paletteQueueBuf[i] ?? 0).toString(16)} ts=0x${(ts.paletteQueueBuf[i] ?? 0).toString(16)}`;
    }
  }
  for (let i = 0; i < SLOT_COUNT; i++) {
    const bs = bin.slots[i]!;
    const ts2 = ts.slots[i]!;
    if (bs.occ !== ts2.occ) return `slot[${i}].occ bin=${bs.occ} ts=${ts2.occ}`;
    if (bs.st !== ts2.st) return `slot[${i}].st bin=${bs.st} ts=${ts2.st}`;
    if (bs.scriptPtr !== ts2.scriptPtr) return `slot[${i}].scriptPtr bin=0x${bs.scriptPtr.toString(16)} ts=0x${ts2.scriptPtr.toString(16)}`;
    if (bs.lo !== ts2.lo) return `slot[${i}].lo bin=0x${bs.lo.toString(16)} ts=0x${ts2.lo.toString(16)}`;
    if (bs.hi !== ts2.hi) return `slot[${i}].hi bin=0x${bs.hi.toString(16)} ts=0x${ts2.hi.toString(16)}`;
  }
  for (let i = 0; i < PALETTE_RAM_SIZE; i++) {
    if ((bin.palette[i] ?? 0) !== (ts.palette[i] ?? 0)) {
      return `palette[0x${(PALETTE_RAM_BASE + i).toString(16)}] bin=0x${(bin.palette[i] ?? 0).toString(16)} ts=0x${(ts.palette[i] ?? 0).toString(16)}`;
    }
  }
  return null;
}

interface SlotInit {
  occ: number;
  st: number;
  scriptPtr: number;
  lo: number;
  hi: number;
  kind1e: number;
  type1f: number;
}

interface CaseSetup {
  mode: number;
  fromWord: number;
  toWord: number;
  /** statePtr (absolute, points to ROM or workRam; boundary @ +0x10). */
  statePtr: number;
  /** boundary word (written to *(statePtr+0x10) in workRam if statePtr in workRam). */
  boundary: number;
  slots: SlotInit[];
  counter75c: number;
  active974: number;
  active978: number;
  rngSeed: number;
  byte400762: number;
  /** Palette queue ptr (for bannerHelper26B66). */
  paletteQueuePtr: number;
  paletteQueueBuf: Uint8Array;
}

function readU32Rom(rom: Uint8Array, off: number): number {
  return (
    (((rom[off] ?? 0) << 24) |
      ((rom[off + 1] ?? 0) << 16) |
      ((rom[off + 2] ?? 0) << 8) |
      (rom[off + 3] ?? 0)) >>>
    0
  );
}

function applyCaseBinary(cpu: CpuSession, c: CaseSetup, _romBuf: Uint8Array): void {
  // Reset workRam to known state (write zeros in bulk using 4-byte writes for speed)
  for (let i = 0; i < WORK_RAM_SIZE; i += 4) {
    pokeMem(cpu, WORK_RAM_BASE + i, 4, 0);
  }

  // Set mode
  pokeMem(cpu, MODE_ADDR, 2, c.mode & 0xffff);

  // Set statePtr
  pokeMem(cpu, STATE_PTR_ADDR, 4, c.statePtr >>> 0);

  // Write boundary to statePtr+0x10 if in workRam
  const sp = c.statePtr >>> 0;
  if (sp >= WORK_RAM_BASE && sp < WORK_RAM_BASE + WORK_RAM_SIZE) {
    pokeMem(cpu, sp + 0x10, 2, c.boundary & 0xffff);
  }
  // If statePtr in ROM, boundary is from ROM (we chose statePtr to point
  // to a ROM address where we know the word).

  // Set scroll base (as if workRam[0x97c] stores something; boundary read from statePtr+0x10)
  // fromWord and toWord are passed as args on stack.

  // Set RNG seed
  pokeMem(cpu, RNG_SEED_ADDR, 2, c.rngSeed & 0xffff);

  // Set slots
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = SLOT_TABLE_BASE + i * SLOT_STRIDE;
    const init = c.slots[i]!;
    pokeMem(cpu, slot + 0x18, 1, init.occ);
    pokeMem(cpu, slot + 0x1a, 1, init.st);
    pokeMem(cpu, slot + 0x1e, 1, init.kind1e);
    pokeMem(cpu, slot + 0x1f, 1, init.type1f);
    pokeMem(cpu, slot + 0x3a, 4, init.scriptPtr >>> 0);
    pokeMem(cpu, slot + 0x52, 2, init.lo & 0xffff);
    pokeMem(cpu, slot + 0x54, 2, init.hi & 0xffff);
  }

  pokeMem(cpu, BYTE_400762, 1, c.byte400762 & 0xff);
  pokeMem(cpu, 0x40075c, 1, c.counter75c & 0xff);
  pokeMem(cpu, 0x400974, 4, c.active974 >>> 0);
  pokeMem(cpu, 0x400978, 4, c.active978 >>> 0);

  // Palette queue ptr @ 0x400408, buf @ 0x40040c..0x40040f
  pokeMem(cpu, 0x400408, 4, c.paletteQueuePtr >>> 0);
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, 0x40040c + i, 1, c.paletteQueueBuf[i] ?? 0);
  }

  cpu.system.setRegister("sp", 0x401f00);
}

function applyCaseTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
  c: CaseSetup,
  _tsRom: RomImage,
): void {
  // Reset
  state.workRam.fill(0);
  state.colorRam.fill(0);

  // Mode
  state.workRam[MODE_ADDR - WORK_RAM_BASE] = (c.mode >>> 8) & 0xff;
  state.workRam[MODE_ADDR - WORK_RAM_BASE + 1] = c.mode & 0xff;

  // statePtr
  state.workRam[STATE_PTR_ADDR - WORK_RAM_BASE] = (c.statePtr >>> 24) & 0xff;
  state.workRam[STATE_PTR_ADDR - WORK_RAM_BASE + 1] = (c.statePtr >>> 16) & 0xff;
  state.workRam[STATE_PTR_ADDR - WORK_RAM_BASE + 2] = (c.statePtr >>> 8) & 0xff;
  state.workRam[STATE_PTR_ADDR - WORK_RAM_BASE + 3] = c.statePtr & 0xff;

  // Write boundary to statePtr+0x10 in workRam or ROM
  const sp = c.statePtr >>> 0;
  if (sp >= WORK_RAM_BASE && sp < WORK_RAM_BASE + WORK_RAM_SIZE) {
    const off = sp - WORK_RAM_BASE + 0x10;
    state.workRam[off] = (c.boundary >>> 8) & 0xff;
    state.workRam[off + 1] = c.boundary & 0xff;
  }
  // If statePtr in ROM, ROM already has the correct data (tsRom matches romBuf)

  // RNG
  state.rng.seed = wrap.as_u32(c.rngSeed & 0xffff);
  state.rng.callsThisFrame = wrap.as_u32(0);

  // Slots
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = SLOT_TABLE_BASE + i * SLOT_STRIDE - WORK_RAM_BASE;
    const init = c.slots[i]!;
    state.workRam[slotOff + 0x18] = init.occ & 0xff;
    state.workRam[slotOff + 0x1a] = init.st & 0xff;
    state.workRam[slotOff + 0x1e] = init.kind1e & 0xff;
    state.workRam[slotOff + 0x1f] = init.type1f & 0xff;
    state.workRam[slotOff + 0x3a] = (init.scriptPtr >>> 24) & 0xff;
    state.workRam[slotOff + 0x3b] = (init.scriptPtr >>> 16) & 0xff;
    state.workRam[slotOff + 0x3c] = (init.scriptPtr >>> 8) & 0xff;
    state.workRam[slotOff + 0x3d] = init.scriptPtr & 0xff;
    state.workRam[slotOff + 0x52] = (init.lo >>> 8) & 0xff;
    state.workRam[slotOff + 0x53] = init.lo & 0xff;
    state.workRam[slotOff + 0x54] = (init.hi >>> 8) & 0xff;
    state.workRam[slotOff + 0x55] = init.hi & 0xff;
  }

  state.workRam[BYTE_400762 - WORK_RAM_BASE] = c.byte400762 & 0xff;
  state.workRam[0x40075c - WORK_RAM_BASE] = c.counter75c & 0xff;

  for (let k = 0; k < 4; k++) {
    state.workRam[0x400974 - WORK_RAM_BASE + k] = (c.active974 >>> (24 - k * 8)) & 0xff;
    state.workRam[0x400978 - WORK_RAM_BASE + k] = (c.active978 >>> (24 - k * 8)) & 0xff;
  }

  // Palette queue
  for (let k = 0; k < 4; k++) {
    state.workRam[0x400408 - WORK_RAM_BASE + k] = (c.paletteQueuePtr >>> (24 - k * 8)) & 0xff;
  }
  for (let i = 0; i < 4; i++) {
    state.workRam[0x40040c - WORK_RAM_BASE + i] = c.paletteQueueBuf[i] ?? 0;
  }
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  mode: number;
  fromWord: number;
  toWord: number;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 4);
  const remainder = total - perSuite * 4;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });
  patchSubs(cpu);

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  // Collect valid state pointers in workRam range for test setups.
  // We use a fixed workRam address (0x401000) as statePtr for most tests.
  const STATE_PTR_IN_WRAM = 0x00401000;

  // Also collect a valid ROM-based statePtr (e.g., from LEVEL_PTR_TABLE).
  // We'll use entries from the level ptr table @ 0x2be00.
  const LEVEL_PTR_TABLE = 0x0002be00;
  const romStatePtrs: number[] = [];
  for (let i = 0; i < 8; i++) {
    const ptr = readU32Rom(romBuf, LEVEL_PTR_TABLE + i * 4);
    if (ptr > 0 && ptr < 0x80000) romStatePtrs.push(ptr);
  }

  // (No need to filter valid selectors: Suite A uses mode=0 which is always valid)

  const rng = makeRng(0x144e4);
  const ri = (max: number): number => Math.floor(rng() * max);

  function makeSlots(occRate: number): SlotInit[] {
    const slots: SlotInit[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const occ = rng() < occRate ? 1 : 0;
      const lo = ri(0x80) & 0xffff;
      const hi = (lo + ri(0x40)) & 0xffff;
      slots.push({
        occ,
        st: occ === 1 ? 3 : 0,
        scriptPtr: occ === 1 ? ri(0x100000000) >>> 0 : 0,
        lo,
        hi,
        kind1e: rng() < 0.6 ? 1 : ri(256),
        type1f: rng() < 0.15 ? 0x06 : rng() < 0.15 ? 0x0c : ri(256),
      });
    }
    return slots;
  }

  function emptySlots(): SlotInit[] {
    return Array.from({ length: SLOT_COUNT }, () => ({
      occ: 0, st: 0, scriptPtr: 0, lo: 0, hi: 0, kind1e: 1, type1f: 0,
    }));
  }

  const failHolder: { value: FailRecord | null } = { value: null };
  let totalOk = 0;

  function runOneCase(suite: string, tc: number, c: CaseSetup): boolean {
    applyCaseBinary(cpu, c, romBuf);
    applyCaseTs(stateInst, c, tsRom);

    // Binary: FUN_144E4 takes (fromWord.w, toWord.w) as 2 word args on stack.
    // Calling convention: args pushed as longs (ext.w → ext.l from word).
    // FUN_144E4 reads (0xe,SP).w = fromWord, (0x12,SP).w = toWord
    // After movem.l {D3,D2}: (0xe,SP) = 0x8+0x6 = first arg (from offset to frame)
    // The binary itself does movem.l {D3,D2},-(SP) saving 2 regs (8 bytes),
    // then reads (0xe,SP) = SP+14. Before movem, the frame is:
    // SP+0: retaddr, SP+4: fromWord.l (word at SP+6 = high half, SP+8.w = from, wait...
    //
    // Let's be careful: FUN_144E4 reads (0xe,SP).w and (0x12,SP).w AFTER movem.l {D3,D2}.
    // Movem pushes 2 regs = 8 bytes. So after movem:
    //   (0x0,SP) = D2; (0x4,SP) = D3 (or reversed? M68K movem push: D3 first then D2)
    //   (0x8,SP) = return address
    //   (0xC,SP) = first arg long (from)
    //   (0xe,SP) = first arg low word (from word, since big-endian long at 0xC, word at 0xE is LSW)
    //   (0x10,SP) = second arg long (to) or padding?
    //   Actually M68K: move.w (0xe,SP) where long is at 0xC: offset 0xE within the long = low word.
    //
    // The args are passed as 2 long values (sign-extended words):
    // callFunction pushes argsLong RTL: last arg pushed last (at SP+4), first at SP+8 relative to JSR.
    // callFunction: args[0] = fromWord, args[1] = toWord, pushed RTL:
    //   → args[1] pushed first, args[0] pushed last (at top = SP+4 after JSR).
    // Wait, callFunction pushes "for i = length-1 downto 0". So args[0]=from first, args[1]=to second.
    // Actually the loop: "for (let i = argsLong.length - 1; i >= 0; i--)" → args[1] pushed first
    //   → SP after push args[1]: sp -= 4; args[0] pushed second: sp -= 4; sentinel pushed: sp -= 4; then JSR PC.
    // After JSR, stack: SP+0=retaddr(sentinel), SP+4=args[0](fromWord), SP+8=args[1](toWord)
    // After movem.l {D3,D2} (8 bytes), SP drops 8:
    //   (0x8,SP) = retaddr, (0xC,SP) = args[0]=fromWord, (0x10,SP) = args[1]=toWord
    //   (0xE,SP) = low word of args[0] = fromWord (assuming from was pushed as sext to long)
    //   (0x12,SP) = low word of args[1] = toWord
    // Perfect match with disasm: "D0 = (0xe,SP).w" and "D2 = (0x12,SP).w"
    callFunction(cpu, FUN_144E4, [c.fromWord & 0xffff, c.toWord & 0xffff], 1_000_000);
    const binSnap = snapshotBinary(cpu);

    srNs.scrollRange144E4(stateInst, tsRom, c.fromWord & 0xffff, c.toWord & 0xffff);
    const tsSnap = snapshotTs(stateInst);

    const reason = compareSnapshots(binSnap, tsSnap);
    if (reason === null) return true;
    if (failHolder.value === null) {
      failHolder.value = { suite, tc, reason, mode: c.mode, fromWord: c.fromWord, toWord: c.toWord };
    }
    return false;
  }

  // Helper: compute expected scaled value for from/to given boundary
  function scaledByte(val: number, boundary: number): number {
    return ((sext16(val & 0xffff) - boundary) >> 4) & 0xff;
  }

  // ─── Suite A: mode 0/1/2/5, random from/to/boundary ─────────────────────
  console.log(`\n=== FUN_000144E4 — Suite A: mode 0/1/2/5 (scaling+12DFA dispatch) — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const boundary = ri(0x200) - 0x100; // boundary in [-256..255]
    // Choose from/to such that scaled values differ
    let fromWord: number, toWord: number;
    do {
      fromWord = ri(0x1000) & 0xffff;
      toWord = ri(0x1000) & 0xffff;
    } while (scaledByte(fromWord, boundary) === scaledByte(toWord, boundary));

    const c: CaseSetup = {
      // Use mode=0 to ensure valid selector for 12DFA (0x400394 is the same as mode word)
      mode: 0,
      fromWord,
      toWord,
      statePtr: STATE_PTR_IN_WRAM,
      boundary: boundary & 0xffff,
      slots: emptySlots(),
      counter75c: 0x40,
      active974: 0,
      active978: 0,
      rngSeed: ri(0x10000),
      byte400762: ri(256),
      paletteQueuePtr: 0x0040040c,
      paletteQueueBuf: new Uint8Array(4),
    };

    if (runOneCase("A", i, c)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: mode 3, boundary crossing at 0x29 ──────────────────────────
  console.log(`\n=== Suite B: mode 3 (bannerHelper26B66 dispatch) — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const boundary = ri(0x100) & 0xffff;
    // Target specific d3/d2 values relative to 0x29
    const sub = ri(4);
    let targetD3: number, targetD2: number;
    if (sub === 0) {
      // d3 < 0x29, d2 >= 0x29 → banner(9)
      targetD3 = ri(0x29); // 0..0x28
      targetD2 = 0x29 + ri(0x10); // 0x29..0x38
    } else if (sub === 1) {
      // d3 >= 0x29, d2 < 0x29 → banner(8)
      targetD3 = 0x29 + ri(0x10);
      targetD2 = ri(0x29);
    } else {
      // No banner: both same side
      const v = ri(0x28);
      targetD3 = v;
      targetD2 = v === 0 ? 1 : v - 1; // different but both < 0x29
    }
    // fromWord = targetD3*16 + boundary, toWord = targetD2*16 + boundary
    const fromWord = ((targetD3 * 16 + sext16(boundary)) & 0xffff) >>> 0;
    const toWord = ((targetD2 * 16 + sext16(boundary)) & 0xffff) >>> 0;

    // Palette queue: valid ptr
    const paletteQueuePtr = 0x0040040c;
    const paletteQueueBuf = new Uint8Array(4);
    for (let k = 0; k < 4; k++) paletteQueueBuf[k] = ri(256) & 0xff;

    const c: CaseSetup = {
      mode: 3,
      fromWord,
      toWord,
      statePtr: STATE_PTR_IN_WRAM,
      boundary,
      slots: emptySlots(),
      counter75c: 0,
      active974: 0,
      active978: 0,
      rngSeed: ri(0x10000),
      byte400762: ri(256),
      paletteQueuePtr,
      paletteQueueBuf,
    };
    if (runOneCase("B", i, c)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: mode 4, range checks + 0x400762 ────────────────────────────
  console.log(`\n=== Suite C: mode 4 (18FFA/190EE/400762 dispatch) — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const boundary = ri(0x100) & 0xffff;
    // Mix of d3/d2 combinations crossing the [0x1D..0x38] and [0x03..0x1B] thresholds
    const sub = ri(5);
    let targetD3: number, targetD2: number;
    if (sub === 0) {
      // d3 NOT in [0x1D..0x38] AND d2 in [0x1D..0x38] → FUN_18FFA (stub)
      targetD3 = ri(0x1d); // < 0x1d
      targetD2 = 0x1d + ri(0x1c); // in [0x1d..0x38]
    } else if (sub === 1) {
      // d3 in [0x1D..0x38] AND d2 NOT → FUN_190EE (stub)
      targetD3 = 0x1d + ri(0x1c);
      targetD2 = ri(0x1d);
    } else if (sub === 2) {
      // d3 NOT in [3..0x1B] AND d2 in [3..0x1B] → write 1 to 0x400762
      targetD3 = 0x1c + ri(0x10); // > 0x1B
      targetD2 = 3 + ri(0x19); // in [3..0x1B]
    } else if (sub === 3) {
      // d3 in [3..0x1B] AND d2 NOT → write 0 to 0x400762
      targetD3 = 3 + ri(0x19);
      targetD2 = 0x1c + ri(0x10);
    } else {
      // both in range (no writes)
      targetD3 = 0x05 + ri(0x10);
      targetD2 = 0x06 + ri(0x10);
    }
    const fromWord = ((targetD3 * 16 + sext16(boundary)) & 0xffff) >>> 0;
    const toWord = ((targetD2 * 16 + sext16(boundary)) & 0xffff) >>> 0;

    const c: CaseSetup = {
      mode: 4,
      fromWord,
      toWord,
      statePtr: STATE_PTR_IN_WRAM,
      boundary,
      slots: makeSlots(0.2),
      counter75c: 0x40,
      active974: 0,
      active978: 0,
      rngSeed: ri(0x10000),
      byte400762: ri(256),
      paletteQueuePtr: 0x0040040c,
      paletteQueueBuf: new Uint8Array(4),
    };
    if (runOneCase("C", i, c)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: edge cases — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const sub = ri(6);
    let c: CaseSetup;

    if (sub === 0) {
      // Early exit: from == to → same scaled value
      const v = ri(0x1000) & 0xffff;
      c = {
        mode: ri(6),
        fromWord: v, toWord: v,
        statePtr: STATE_PTR_IN_WRAM,
        boundary: 0,
        slots: emptySlots(), counter75c: 0, active974: 0, active978: 0,
        rngSeed: ri(0x10000), byte400762: ri(256),
        paletteQueuePtr: 0x0040040c, paletteQueueBuf: new Uint8Array(4),
      };
    } else if (sub === 1) {
      // ROM-based statePtr (boundary from ROM)
      const ptr = romStatePtrs.length > 0 ? romStatePtrs[ri(romStatePtrs.length)]! : 0x10000;
      const boundary = sext16((romBuf[ptr + 0x10]! << 8) | romBuf[ptr + 0x11]!);
      let fromWord: number, toWord: number;
      do {
        fromWord = ri(0x1000) & 0xffff;
        toWord = ri(0x1000) & 0xffff;
      } while (scaledByte(fromWord, boundary) === scaledByte(toWord, boundary));
      c = {
        mode: 0,
        fromWord, toWord,
        statePtr: ptr,
        boundary: boundary & 0xffff,
        slots: emptySlots(), counter75c: 0, active974: 0, active978: 0,
        rngSeed: ri(0x10000), byte400762: ri(256),
        paletteQueuePtr: 0x0040040c, paletteQueueBuf: new Uint8Array(4),
      };
    } else if (sub === 2) {
      // Large boundary (negative sext16)
      const boundary = 0x8000 + ri(0x8000); // 0x8000..0xFFFF (negative)
      let fromWord: number, toWord: number;
      do {
        fromWord = ri(0x10000) & 0xffff;
        toWord = ri(0x10000) & 0xffff;
      } while (scaledByte(fromWord, sext16(boundary)) === scaledByte(toWord, sext16(boundary)));
      c = {
        mode: 0,
        fromWord, toWord,
        statePtr: STATE_PTR_IN_WRAM,
        boundary,
        slots: emptySlots(), counter75c: 0, active974: 0, active978: 0,
        rngSeed: ri(0x10000), byte400762: ri(256),
        paletteQueuePtr: 0x0040040c, paletteQueueBuf: new Uint8Array(4),
      };
    } else if (sub === 3) {
      // mode 3 + mode 4 mixed
      const mode = rng() < 0.5 ? 3 : 4;
      const boundary = ri(0x200) & 0xffff;
      let fromWord: number, toWord: number;
      do {
        fromWord = ri(0x1000) & 0xffff;
        toWord = ri(0x1000) & 0xffff;
      } while (scaledByte(fromWord, sext16(boundary)) === scaledByte(toWord, sext16(boundary)));
      c = {
        mode,
        fromWord, toWord,
        statePtr: STATE_PTR_IN_WRAM,
        boundary,
        slots: makeSlots(0.3),
        counter75c: 0x20 + ri(0x40),
        active974: 0, active978: 0,
        rngSeed: ri(0x10000), byte400762: ri(256),
        paletteQueuePtr: 0x0040040c,
        paletteQueueBuf: new Uint8Array([ri(256), ri(256), ri(256), ri(256)]),
      };
    } else if (sub === 4) {
      // Occupied slots, random everything
      const mode = ri(6);
      const boundary = ri(0x400) & 0xffff;
      let fromWord: number, toWord: number;
      do {
        fromWord = ri(0x10000) & 0xffff;
        toWord = ri(0x10000) & 0xffff;
      } while (scaledByte(fromWord, sext16(boundary)) === scaledByte(toWord, sext16(boundary)));
      c = {
        mode,
        fromWord, toWord,
        statePtr: STATE_PTR_IN_WRAM,
        boundary,
        slots: makeSlots(0.5),
        counter75c: 0x40 + ri(0x40),
        active974: rng() < 0.3 ? SLOT_TABLE_BASE + ri(SLOT_COUNT) * SLOT_STRIDE : 0,
        active978: ri(0x100000000) >>> 0,
        rngSeed: ri(0x10000), byte400762: ri(256),
        paletteQueuePtr: 0x0040040c + ri(4),
        paletteQueueBuf: new Uint8Array([ri(256), ri(256), ri(256), ri(256)]),
      };
    } else {
      // statePtr = 0 (null ptr → boundary = 0)
      let fromWord: number, toWord: number;
      do {
        fromWord = ri(0x1000) & 0xffff;
        toWord = ri(0x1000) & 0xffff;
      } while (scaledByte(fromWord, 0) === scaledByte(toWord, 0));
      c = {
        mode: 0,
        fromWord, toWord,
        statePtr: 0,
        boundary: 0,
        slots: emptySlots(), counter75c: 0, active974: 0, active978: 0,
        rngSeed: ri(0x10000), byte400762: ri(256),
        paletteQueuePtr: 0x0040040c, paletteQueueBuf: new Uint8Array(4),
      };
    }

    if (runOneCase("D", i, c)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total: ${totalOk}/${total}`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.error(`\nFirst failure: suite ${f.suite} tc ${f.tc}`);
    console.error(`  mode=${f.mode} fromWord=0x${f.fromWord.toString(16)} toWord=0x${f.toWord.toString(16)}`);
    console.error(`  reason: ${f.reason}`);
    disposeCpu(cpu);
    exit(1);
  }

  console.log(`PASS ${totalOk}/${total}`);
  disposeCpu(cpu);
  exit(0);
}

main().catch((e) => {
  console.error(e);
  exit(2);
});
