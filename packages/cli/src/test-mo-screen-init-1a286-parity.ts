#!/usr/bin/env node
/**
 * test-mo-screen-init-1a286-parity.ts — differential FUN_1A286 vs moScreenInit1A286.
 *
 * `FUN_0001A286` (408 byte) è uno screen-init helper che:
 *   - 2 word globali workRam (0x400008, 0x40000A)
 *   - 32 word in MO RAM (sprite RAM banks 0..3, 8 entry each)
 *   - 4 word in PF RAM (0xA00A20/A28/A30/A38)
 *   - 5 sub-jsr (clearAlphaTiles, paletteInitLevel, renderString trampoline ×2)
 *   - 3 spin-wait su MMIO (F60001 / *A2 frame-counter)
 *
 * Strategia parità:
 *
 *   1. Patch ROM con stub `addq.b #1, sentinel.l ; rts` (8 byte) ai 3 entry
 *      reali delle sub:
 *        FUN_28C7E      → sentinel byte 0x4003E0
 *        FUN_1A41E      → sentinel byte 0x4003E1
 *        FUN_2572       → sentinel byte 0x4003E2 (bersaglio della JMP.L 0x142)
 *      `0x142` è una `JMP.L 0x2572` trampoline; patchando FUN_2572 catturiamo
 *      entrambe le 2 chiamate a renderString → sentinel +2.
 *
 *   2. Patch ROM con NOP (0x4E71) sui 2 spin-wait `beq.b $-2` interni (offset
 *      0x1A296 e 0x1A2E0). Lo spin finale a 0x1A408 esce naturalmente quando
 *      `*0xF60001 bit 0 == 0` (default zero region in unified memory).
 *
 *   3. Pre-fill randomico delle 4 sentinel byte, dei 2 globali word, dei 32
 *      MO writes (sprite RAM 0..0x18F) e dei 4 PF writes (PF RAM 0xA20..0xA39).
 *      Il binario deve sovrascrivere completamente.
 *
 *   4. Esegui binario via `callFunction(FUN_1A286)` e leggi:
 *        - 2 word globali workRam
 *        - 32 byte MO RAM (4 banks × 8 entry × 2 byte)
 *        - 8 byte PF RAM (4 word @ A20/A28/A30/A38)
 *        - 3 sentinel byte (clearAlpha, paletteInit, renderString-counter)
 *
 *   5. Esegui `moScreenInit1A286()` con 3 callback che incrementano gli
 *      stessi sentinel slot in `state.workRam`.
 *
 *   6. Confronta: 4 + 32 + 8 + 3 = 47 byte totali per caso.
 *
 * Uso: npx tsx packages/cli/src/test-mo-screen-init-1a286-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  moScreenInit1A286 as msNs,
  bus as busNs,
} from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
  type CpuSession,
} from "./binary-oracle-lib.js";

/**
 * Step-based callFunction: come `callFunction()` ma usa `system.step()`
 * invece di `system.run(burst)`. Garantisce terminazione PRECISA non appena
 * `pc == SENTINEL_RET_ADDR`, evitando che un burst esegua istruzioni extra
 * dopo il RTS finale. La 1A286 esce con uno spin-loop su MMIO che potrebbe
 * far convergere il PC su FUN_2572 in modo subdolo se il PC continua a
 * fetchare istruzioni dall'unmapped 0xCAFEBABE post-rts.
 */
const SENTINEL_RET_ADDR_STEP = 0xcafebabe >>> 0;
function callFunctionStep(
  session: CpuSession,
  addr: number,
  argsLong: readonly number[] = [],
  maxInstr = 50_000,
): void {
  const sys = session.system;
  const spInitial = sys.getRegisters().sp;
  let sp = spInitial;
  for (let i = argsLong.length - 1; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, argsLong[i]! >>> 0);
  }
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET_ADDR_STEP);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);

  for (let i = 0; i < maxInstr; i++) {
    if (sys.getRegisters().pc === SENTINEL_RET_ADDR_STEP) break;
    sys.step();
  }
  // Pop sentinel + args
  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 4 * argsLong.length) >>> 0);
}

const FUN_1A286 = 0x0001a286;

// Sub-function entry points reali (non i trampolini).
const SUB_CLEAR_ALPHA_TILES = 0x00028c7e; // FUN_28C7E
const SUB_PALETTE_INIT_LEVEL = 0x0001a41e; // FUN_1A41E
const SUB_RENDER_STRING = 0x00002572; // bersaglio di JMP.L @ 0x142

// Spin-wait `beq.b $-2` da NOPpare per evitare loop infiniti.
const SPIN_WAIT_1_BEQ = 0x0001a296; // dopo btst su 0xF60001
const SPIN_WAIT_2_BEQ = 0x0001a2e0; // cmp.l (A2),D0 ; beq

// Sentinel slot in work RAM (uno per stub).
const SENTINEL_BASE = 0x004003e0;
const SENT_CLEAR_ALPHA = SENTINEL_BASE + 0;
const SENT_PALETTE_INIT = SENTINEL_BASE + 1;
const SENT_RENDER_STRING = SENTINEL_BASE + 2;

// Globali workRam toccati dal body (2 word).
const GLOB_ISR_DST_A = 0x00400008;
const GLOB_ISR_DST_B = 0x0040000a;

// MO RAM (sprite RAM 0xA02000..0xA0218F): 4 banks × 8 entry × 2 byte = 32 byte.
const MO_RAM_BASE = 0xa02000;
const MO_BANK_OFFSETS = [0x000, 0x080, 0x100, 0x180] as const;
const MO_ENTRY_COUNT = 8;

// PF RAM (4 word @ 0xA00A20/A28/A30/A38).
const PF_RAM_BASE = 0xa00000;
const PF_REG_BASE_OFF = 0x0a20;

const SUBS_LIST = [
  { name: "clearAlphaTiles", entry: SUB_CLEAR_ALPHA_TILES, sentinel: SENT_CLEAR_ALPHA },
  { name: "paletteInitLevel", entry: SUB_PALETTE_INIT_LEVEL, sentinel: SENT_PALETTE_INIT },
  { name: "renderString", entry: SUB_RENDER_STRING, sentinel: SENT_RENDER_STRING },
] as const;

/** Encode `addq.b #1, abs.l ; rts` (8 byte) in `rom` a `entry`. */
function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
  rom[entry + 6] = 0x4e;
  rom[entry + 7] = 0x75;
}

/** Patch 2 byte di `beq.b` con NOP `0x4E71`. */
function patchNop(rom: Buffer, addr: number): void {
  rom[addr + 0] = 0x4e;
  rom[addr + 1] = 0x71;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  i: number;
  field: string;
  bin: number;
  ts: number;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Pre-patch: stub addq+rts ai 3 entry sub.
  for (const sub of SUBS_LIST) {
    patchStubAddq(romBuf, sub.entry, sub.sentinel);
  }
  // Pre-patch: NOP sui 2 spin-wait `beq.b $-2`.
  patchNop(romBuf, SPIN_WAIT_1_BEQ);
  patchNop(romBuf, SPIN_WAIT_2_BEQ);

  // RomImage TS allineata col binario post-patch.
  const romView = busNs.emptyRomImage();
  romView.program.set(romBuf);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== moScreenInit1A286 (FUN_1A286) — ${n} casi ===`);
  const rng = makeRng(0x1a286);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  // Subs TS: incrementano i 3 sentinel (renderString incrementa lo stesso 2 volte).
  const incSent = (s: typeof stateInst, off: number): void => {
    const a = off - 0x400000;
    s.workRam[a] = ((s.workRam[a] ?? 0) + 1) & 0xff;
  };
  const subs: msNs.MoScreenInit1A286Subs = {
    clearAlphaTiles: (s: typeof stateInst): void => incSent(s, SENT_CLEAR_ALPHA),
    paletteInitLevel: (s: typeof stateInst): void => incSent(s, SENT_PALETTE_INIT),
    renderString: (s: typeof stateInst): void => incSent(s, SENT_RENDER_STRING),
  };

  // PF RAM TS buffer (allineato al region zero del binario; offset 0=0xA00000).
  const pfRamTs = new Uint8Array(0x2000);

  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Pre-fill workRam globali (2 word).
    const preIsrA = ((rb() << 8) | rb()) & 0xffff;
    const preIsrB = ((rb() << 8) | rb()) & 0xffff;
    pokeMem(cpu, GLOB_ISR_DST_A, 2, preIsrA);
    pokeMem(cpu, GLOB_ISR_DST_B, 2, preIsrB);
    stateInst.workRam[GLOB_ISR_DST_A - 0x400000] = (preIsrA >>> 8) & 0xff;
    stateInst.workRam[GLOB_ISR_DST_A - 0x400000 + 1] = preIsrA & 0xff;
    stateInst.workRam[GLOB_ISR_DST_B - 0x400000] = (preIsrB >>> 8) & 0xff;
    stateInst.workRam[GLOB_ISR_DST_B - 0x400000 + 1] = preIsrB & 0xff;

    // Pre-fill MO RAM (4 banks × 8 entry × 2 byte = 32 byte) randomico.
    for (const bankOff of MO_BANK_OFFSETS) {
      for (let k = 0; k < MO_ENTRY_COUNT * 2; k++) {
        const v = rb();
        pokeMem(cpu, MO_RAM_BASE + bankOff + k, 1, v);
        stateInst.spriteRam[bankOff + k] = v;
      }
    }

    // Pre-fill PF RAM (4 word @ 0xA20/A28/A30/A38).
    for (let k = 0; k < 4; k++) {
      const word = ((rb() << 8) | rb()) & 0xffff;
      const off = PF_REG_BASE_OFF + k * 8;
      pokeMem(cpu, PF_RAM_BASE + off, 2, word);
      pfRamTs[off] = (word >>> 8) & 0xff;
      pfRamTs[off + 1] = word & 0xff;
    }

    // Pre-fill 3 sentinel byte randomici.
    const scratch = new Uint8Array(3);
    for (let k = 0; k < 3; k++) {
      const v = rb();
      scratch[k] = v;
      pokeMem(cpu, SENTINEL_BASE + k, 1, v);
      stateInst.workRam[SENTINEL_BASE - 0x400000 + k] = v;
    }

    // Esegui binario (step-based per fermarsi PRECISAMENTE al sentinel RTS)
    callFunctionStep(cpu, FUN_1A286, [], 50_000);
    // Esegui TS
    msNs.moScreenInit1A286(stateInst, romView, pfRamTs, subs);

    let fail: FailRecord | null = null;

    // Check 1: 2 globali word workRam (4 byte)
    for (const { name, addr } of [
      { name: "isrDstA", addr: GLOB_ISR_DST_A },
      { name: "isrDstB", addr: GLOB_ISR_DST_B },
    ]) {
      for (let off = 0; off < 2; off++) {
        const b = peekMem(cpu, addr + off, 1) & 0xff;
        const t = stateInst.workRam[addr - 0x400000 + off] ?? 0;
        if (b !== t) {
          fail = { i, field: `${name}+${off}`, bin: b, ts: t };
          break;
        }
      }
      if (fail) break;
    }

    // Check 2: 32 byte MO RAM (4 banks × 16 byte)
    if (fail === null) {
      for (const bankOff of MO_BANK_OFFSETS) {
        for (let k = 0; k < MO_ENTRY_COUNT * 2; k++) {
          const b = peekMem(cpu, MO_RAM_BASE + bankOff + k, 1) & 0xff;
          const t = stateInst.spriteRam[bankOff + k] ?? 0;
          if (b !== t) {
            fail = {
              i,
              field: `mo[0x${(bankOff + k).toString(16)}]`,
              bin: b,
              ts: t,
            };
            break;
          }
        }
        if (fail) break;
      }
    }

    // Check 3: 8 byte PF RAM (4 word @ A20/A28/A30/A38)
    if (fail === null) {
      for (let k = 0; k < 4; k++) {
        const off = PF_REG_BASE_OFF + k * 8;
        for (let bo = 0; bo < 2; bo++) {
          const b = peekMem(cpu, PF_RAM_BASE + off + bo, 1) & 0xff;
          const t = pfRamTs[off + bo] ?? 0;
          if (b !== t) {
            fail = {
              i,
              field: `pf[0x${(off + bo).toString(16)}]`,
              bin: b,
              ts: t,
            };
            break;
          }
        }
        if (fail) break;
      }
    }

    // Check 4: 3 sentinel byte (clearAlpha+1, paletteInit+1, renderString+2)
    if (fail === null) {
      const expectedDelta = [1, 1, 2];
      for (let k = 0; k < 3; k++) {
        const expected = ((scratch[k] ?? 0) + (expectedDelta[k] ?? 0)) & 0xff;
        const b = peekMem(cpu, SENTINEL_BASE + k, 1) & 0xff;
        const t = stateInst.workRam[SENTINEL_BASE - 0x400000 + k] ?? 0;
        if (b !== t || b !== expected) {
          fail = {
            i,
            field: SUBS_LIST[k]?.name ?? `sentinel${k}`,
            bin: b,
            ts: t,
          };
          break;
        }
      }
    }

    if (fail === null) {
      ok++;
    } else if (firstFail === null) {
      firstFail = fail;
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i}`);
    console.log(`    ${f.field}: bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
