#!/usr/bin/env node
/**
 * test-state-sub-14c46-parity.ts — differential FUN_00014C46 vs
 * `stateSub14C46`.
 *
 * FUN_00014C46 (422 byte): "range-boundary slot spawn/despawn dispatcher".
 * Iterates entry list `ROM[0x2257A + mode*4]` to spawn-init the 4 slots
 * @ 0x401302 (stride 0x60), poi tail walk per teardown su boundary cross.
 *
 * **Strategia parity**:
 *   - `FUN_14BCE` (findFreeSlotInTable), `FUN_14C0C` (slotMatchesPtr) e
 *     `FUN_1BB08` (deriveSpriteFromArg_v1) **lasciati live**: replicati
 *     bit-perfect in `slot-search.ts` / `sprite-derive.ts`.
 *   - `FUN_1CC62` stubbed with `moveq #0, D0; rts` (D0 = 0).
 *   - `FUN_150D0` stubbed with RTS (no return value).
 *   - `FUN_18E6C` stubbed with RTS.
 *   - `FUN_18F46` stubbed with RTS.
 *   - Compare:
 *       * `workRam[0x1302..0x14C2]` (4 slot × 0x60 = 384 byte)
 *       * `workRam[0x690..0x6A7]` (sprite-derive globals written by FUN_1BB08)
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random everything (mode/D2/D3/slot-prefill/RNG)
 *   - B: forced init (mode with entry list, D3 == entry boundary, D2 out of range)
 *   - C: forced teardown (slot in use, D2 == slot[0x52]/[0x54], D3 cross)
 *   - D: edge cases (direct sentinel, all slots in use, mode out of range)
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-14c46-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  stateSub14C46 as sub14C46Ns,
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

const FUN_14C46 = 0x00014c46;
const FUN_1CC62 = 0x0001cc62;
const FUN_150D0 = 0x000150d0;
const FUN_18E6C = 0x00018e6c;
const FUN_18F46 = 0x00018f46;

const WORK_RAM_BASE = 0x00400000;
const MODE_ADDR = 0x00400394;
const SLOT_ARRAY_ADDR = 0x00401302;
const SLOT_STRIDE = 0x60;
const SLOT_COUNT = 4;
const SLOT_AREA_BYTES = SLOT_COUNT * SLOT_STRIDE; // 384

// Sprite globals written by FUN_1BB08 + deriveSpriteFields.
const SPRITE_GLOBALS_OFF = 0x690;
const SPRITE_GLOBALS_LEN = 0x18; // 0x690..0x6A7

/**
 * Patch JSR-stub:
 *   - FUN_1CC62 → `moveq #0, D0; rts` (D0=0 deterministico).
 *   - FUN_150D0 / FUN_18E6C / FUN_18F46 → RTS.
 *   FUN_14BCE / FUN_14C0C / FUN_1BB08 lasciati live.
 */
function patchSubs(cpu: CpuSession): void {
  // FUN_1CC62: moveq #0, D0 (0x7000) ; rts (0x4E75)
  pokeMem(cpu, FUN_1CC62 + 0, 1, 0x70);
  pokeMem(cpu, FUN_1CC62 + 1, 1, 0x00);
  pokeMem(cpu, FUN_1CC62 + 2, 1, 0x4e);
  pokeMem(cpu, FUN_1CC62 + 3, 1, 0x75);
  // FUN_150D0: rts
  pokeMem(cpu, FUN_150D0 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_150D0 + 1, 1, 0x75);
  // FUN_18E6C: rts
  pokeMem(cpu, FUN_18E6C + 0, 1, 0x4e);
  pokeMem(cpu, FUN_18E6C + 1, 1, 0x75);
  // FUN_18F46: rts
  pokeMem(cpu, FUN_18F46 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_18F46 + 1, 1, 0x75);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  /** Slot-area bytes (4 slot × 0x60). */
  slotArea: number[];
  /** Sprite globals (0x690..0x6A7). */
  spriteGlobals: number[];
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const slotArea: number[] = [];
  for (let i = 0; i < SLOT_AREA_BYTES; i++) {
    slotArea.push(peekMem(cpu, SLOT_ARRAY_ADDR + i, 1) & 0xff);
  }
  const spriteGlobals: number[] = [];
  for (let i = 0; i < SPRITE_GLOBALS_LEN; i++) {
    spriteGlobals.push(peekMem(cpu, WORK_RAM_BASE + SPRITE_GLOBALS_OFF + i, 1) & 0xff);
  }
  return { slotArea, spriteGlobals };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const wr = state.workRam;
  const slotArea: number[] = [];
  const slotOff = SLOT_ARRAY_ADDR - WORK_RAM_BASE;
  for (let i = 0; i < SLOT_AREA_BYTES; i++) {
    slotArea.push(wr[slotOff + i] ?? 0);
  }
  const spriteGlobals: number[] = [];
  for (let i = 0; i < SPRITE_GLOBALS_LEN; i++) {
    spriteGlobals.push(wr[SPRITE_GLOBALS_OFF + i] ?? 0);
  }
  return { slotArea, spriteGlobals };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binSnap: Snapshot;
  tsSnap: Snapshot;
  inputMode: number;
  inputD2: number;
  inputD3: number;
}

interface CaseInput {
  mode: number; // u16 written to 0x400394
  d2: number; // arg1 LSB
  d3: number; // arg2 LSB
  /** Pre-fill slot-area (384 byte). */
  slotAreaPre: number[];
  /** Optional: write entry list at workRam offset (else use ROM via mode). */
  entryListOverride?: {
    /** Address (m68k abs) where entry list will live. Pointer ROM[0x2257A+mode*4] is patched to this. */
    listAddr: number;
    /** Bytes of the entry list (terminator 0xFF MUST be present). */
    listBytes: number[];
  };
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
  const romBytes = readFileSync(romPath);

  // Build TS-side rom image (binary mirror).
  const romImage: RomImage = busNs.emptyRomImage();
  romImage.program.set(romBytes.subarray(0, romImage.program.length));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state: stateInst });
  patchSubs(cpu);

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(input: CaseInput): void {
    // ── BINARY setup ──────────────────────────────────────────────────
    // 1. Mode word @ 0x400394
    pokeMem(cpu, MODE_ADDR, 2, input.mode & 0xffff);
    // 2. Slot area pre-fill
    for (let i = 0; i < SLOT_AREA_BYTES; i++) {
      pokeMem(cpu, SLOT_ARRAY_ADDR + i, 1, input.slotAreaPre[i] ?? 0);
    }
    // 3. Sprite globals pre-zero (per non avere garbage da test precedenti)
    for (let i = 0; i < SPRITE_GLOBALS_LEN; i++) {
      pokeMem(cpu, WORK_RAM_BASE + SPRITE_GLOBALS_OFF + i, 1, 0);
    }
    // 4. Entry list override (if present).
    // WARNING: pokeMem in ROM area writes to the CPU unified memory.
    // (the `binary-oracle-lib` library uses a unified RAM array).
    if (input.entryListOverride) {
      const { listAddr, listBytes } = input.entryListOverride;
      // Patch ROM[0x2257A + mode*4] = listAddr
      const tableEntry = (0x0002257a + ((input.mode & 0xffff) << 2)) >>> 0;
      pokeMem(cpu, tableEntry, 4, listAddr >>> 0);
      // Write list bytes
      for (let i = 0; i < listBytes.length; i++) {
        pokeMem(cpu, listAddr + i, 1, listBytes[i]! & 0xff);
      }
    }

    // SP setup
    cpu.system.setRegister("sp", 0x401f00);

    // ── TS setup (mirror) ─────────────────────────────────────────────
    const wr = stateInst.workRam;
    // 1. Mode word
    wr[MODE_ADDR - WORK_RAM_BASE] = (input.mode >>> 8) & 0xff;
    wr[MODE_ADDR - WORK_RAM_BASE + 1] = input.mode & 0xff;
    // 2. Slot area
    const slotOff = SLOT_ARRAY_ADDR - WORK_RAM_BASE;
    for (let i = 0; i < SLOT_AREA_BYTES; i++) {
      wr[slotOff + i] = (input.slotAreaPre[i] ?? 0) & 0xff;
    }
    // 3. Sprite globals
    for (let i = 0; i < SPRITE_GLOBALS_LEN; i++) {
      wr[SPRITE_GLOBALS_OFF + i] = 0;
    }
    // 4. Entry list (mirror: ROM image + workRam if listAddr in workRam range)
    if (input.entryListOverride) {
      const { listAddr, listBytes } = input.entryListOverride;
      const tableEntry = (0x0002257a + ((input.mode & 0xffff) << 2)) >>> 0;
      // Patch romImage
      romImage.program[tableEntry] = (listAddr >>> 24) & 0xff;
      romImage.program[tableEntry + 1] = (listAddr >>> 16) & 0xff;
      romImage.program[tableEntry + 2] = (listAddr >>> 8) & 0xff;
      romImage.program[tableEntry + 3] = listAddr & 0xff;
      // Write list bytes (workRam if in range, else ROM)
      const a = listAddr >>> 0;
      if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + wr.length) {
        const off = a - WORK_RAM_BASE;
        for (let i = 0; i < listBytes.length; i++) {
          wr[off + i] = listBytes[i]! & 0xff;
        }
      } else {
        for (let i = 0; i < listBytes.length; i++) {
          romImage.program[a + i] = listBytes[i]! & 0xff;
        }
      }
    }
  }

  function runOneCase(suite: string, tc: number, input: CaseInput): boolean {
    setupCase(input);

    // Push args RTL: arg2 then arg1, but callFunction takes [arg1, arg2]
    // and pushes RTL internally — so arg1 is at SP+4, arg2 at SP+8 post-call.
    // Actually after `jsr` we add ret addr, so: SP+0=ret, SP+4=arg1, SP+8=arg2.
    // Then movem.l 5 long = -0x14, so SP+0x14=ret, SP+0x18=arg1, SP+0x1C=arg2.
    // SP+0x1B = byte 3 of arg1 = LSB of arg1 (BE).
    // SP+0x1F = byte 3 of arg2 = LSB of arg2 (BE).
    // → callFunction([arg1Long, arg2Long]) with LSB = d2/d3.
    const arg1Long = input.d2 & 0xff; // LSB only matters
    const arg2Long = input.d3 & 0xff;
    callFunction(cpu, FUN_14C46, [arg1Long, arg2Long]);
    const binSnap = snapshotBinary(cpu);

    sub14C46Ns.stateSub14C46(stateInst, romImage, arg1Long, arg2Long, {
      fun_1cc62: () => 0,
      fun_150d0: () => {},
      fun_18e6c: () => {},
      fun_18f46: () => {},
    });
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    for (let i = 0; i < SLOT_AREA_BYTES; i++) {
      if (binSnap.slotArea[i] !== tsSnap.slotArea[i]) {
        const slotIdx = Math.floor(i / SLOT_STRIDE);
        const fieldOff = i % SLOT_STRIDE;
        reason =
          `slot[${slotIdx}].byte[0x${fieldOff.toString(16)}] ` +
          `bin=0x${binSnap.slotArea[i]!.toString(16)} ` +
          `ts=0x${tsSnap.slotArea[i]!.toString(16)}`;
        break;
      }
    }
    if (reason === "") {
      for (let i = 0; i < SPRITE_GLOBALS_LEN; i++) {
        if (binSnap.spriteGlobals[i] !== tsSnap.spriteGlobals[i]) {
          reason =
            `spriteGlobals[0x${i.toString(16)}] ` +
            `bin=0x${binSnap.spriteGlobals[i]!.toString(16)} ` +
            `ts=0x${tsSnap.spriteGlobals[i]!.toString(16)}`;
          break;
        }
      }
    }
    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        reason,
        binSnap,
        tsSnap,
        inputMode: input.mode,
        inputD2: input.d2,
        inputD3: input.d3,
      };
    }
    return false;
  }

  const rng = makeRng(0x14c46);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  function makeRandomSlotPrefill(): number[] {
    return new Array(SLOT_AREA_BYTES).fill(0).map(() => rb());
  }

  function makeRandomInput(): CaseInput {
    return {
      mode: Math.floor(rng() * 8) & 0xffff,
      d2: rb(),
      d3: rb(),
      slotAreaPre: makeRandomSlotPrefill(),
    };
  }

  // ─── Suite A: random ─────────────────────────────────────────────────
  console.log(
    `\n=== stateSub14C46 (FUN_00014C46) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const input = makeRandomInput();
    if (runOneCase("A", i, input)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: forced init path ───────────────────────────────────────
  // Override entry list: D3 == entry[0] AND D2 < entry[0] → init.
  console.log(
    `\n=== Suite B: forced init path (D3 boundary + D2 outside) — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    // Random e0/e1 in range [10..200]
    const e0 = 10 + Math.floor(rng() * 50); // 10..59
    const e1 = 100 + Math.floor(rng() * 100); // 100..199
    // dataPtr long pointing to ROM region with predictable bytes
    const dataPtr = 0x00010100 + Math.floor(rng() * 0x100);
    const input: CaseInput = {
      mode: 0,
      d2: e0 - 1, // < entry[0] → outside range
      d3: e0, // == entry[0] → boundary match
      slotAreaPre: new Array(SLOT_AREA_BYTES).fill(0), // all slot free
      entryListOverride: {
        listAddr: 0x00400500, // workRam (entryPtr used also da slotMatchesPtr that fa argOff = ptr - 0x400000)
        listBytes: [
          e0,
          e1,
          (dataPtr >>> 24) & 0xff,
          (dataPtr >>> 16) & 0xff,
          (dataPtr >>> 8) & 0xff,
          dataPtr & 0xff,
          rb(), // entry[6]
          0, // entry[7] padding
          0xff, // sentinel
        ],
      },
    };
    if (runOneCase("B", i, input)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced teardown path ───────────────────────────────────
  console.log(
    `\n=== Suite C: forced teardown (slot in use, D boundary cross) — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotAreaPre = new Array(SLOT_AREA_BYTES).fill(0);
    // Pick a slot to teardown
    const slotIdx = i % SLOT_COUNT;
    const slotOff = slotIdx * SLOT_STRIDE;
    slotAreaPre[slotOff + 0x18] = 1; // in use
    slotAreaPre[slotOff + 0x19] = rb();
    // slot[0x52] = 50 (BE word: hi,lo)
    const lo = 50;
    const hi = 100;
    slotAreaPre[slotOff + 0x52] = 0;
    slotAreaPre[slotOff + 0x53] = lo;
    slotAreaPre[slotOff + 0x54] = 0;
    slotAreaPre[slotOff + 0x55] = hi;
    // Empty entry list (sentinel direct).
    const input: CaseInput = {
      mode: 0,
      d2: i % 2 === 0 ? lo : hi, // == lower or upper boundary
      d3: i % 2 === 0 ? lo - 1 : hi + 1, // < lower or > upper
      slotAreaPre,
      entryListOverride: {
        listAddr: 0x00400500,
        listBytes: [0xff],
      },
    };
    if (runOneCase("C", i, input)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const variant = i % 5;
    let input: CaseInput;
    if (variant === 0) {
      // Direct sentinel (empty entry list), random slot prefill.
      input = {
        mode: 0,
        d2: rb(),
        d3: rb(),
        slotAreaPre: makeRandomSlotPrefill(),
        entryListOverride: { listAddr: 0x00400500, listBytes: [0xff] },
      };
    } else if (variant === 1) {
      // All slots in use (slot[0x18] != 0) -> FUN_14BCE returns -1.
      const slotAreaPre = new Array(SLOT_AREA_BYTES).fill(0);
      for (let s = 0; s < SLOT_COUNT; s++) {
        slotAreaPre[s * SLOT_STRIDE + 0x18] = 1;
      }
      input = {
        mode: 0,
        d2: rb(),
        d3: rb(),
        slotAreaPre,
        entryListOverride: {
          listAddr: 0x00400500,
          listBytes: [10, 20, 0, 1, 0, 0, 0, 0, 0xff],
        },
      };
    } else if (variant === 2) {
      // D2/D3 boundary edge values
      input = {
        mode: 0,
        d2: 0,
        d3: 0,
        slotAreaPre: makeRandomSlotPrefill(),
        entryListOverride: {
          listAddr: 0x00400500,
          listBytes: [0, 1, 0, 0, 0, 0, 0, 0, 0xff],
        },
      };
    } else if (variant === 3) {
      // Negative byte values (signed boundary)
      input = {
        mode: 0,
        d2: 0xff, // -1 signed
        d3: 0x80, // -128 signed
        slotAreaPre: makeRandomSlotPrefill(),
        entryListOverride: {
          listAddr: 0x00400500,
          listBytes: [0x80, 0x7f, 0, 0, 0, 0, 0, 0, 0xff],
        },
      };
    } else {
      // 2 entries (test entry advance)
      input = {
        mode: 0,
        d2: 5,
        d3: 10,
        slotAreaPre: new Array(SLOT_AREA_BYTES).fill(0),
        entryListOverride: {
          listAddr: 0x00400500,
          listBytes: [
            10, 20, 0, 1, 0, 0, 0, 0,
            30, 40, 0, 2, 0, 0, 0, 0,
            0xff,
          ],
        },
      };
    }
    if (runOneCase("D", i, input)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(
      `    inputMode=0x${f.inputMode.toString(16)} d2=0x${f.inputD2.toString(16)} d3=0x${f.inputD3.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
