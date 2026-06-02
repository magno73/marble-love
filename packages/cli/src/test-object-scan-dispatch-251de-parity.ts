#!/usr/bin/env node
/**
 * test-object-scan-dispatch-251de-parity.ts — differential FUN_000251DE vs
 * objectScanDispatch251DE.
 *
 * (stride 0xE2, count = `*0x400396`) that:
 *   - for each obj: skip if +0x18==0 (D2++), gate +0x6A.w > 400 -> FUN_2822E,
 *     `FUN_253EC(obj)` (object-step), then groups state==2/3 (counters);
 *   - if count==2 and filters pass (X-coord, +0x36, +0x1A): "respawn block"
 *     (12 writes to obj + 5 jsr + sound 0x3C + FUN_285B0(obj, 0xF));
 *   - post-loop: if D3==count or D2==count-1 (+ D3!=0) -> set
 *     `*0x400390.w = 3` (when != 1).
 *
 *
 *   - FUN_1BBAA  -> `rts`                    (no-op, isolates local writes)
 *   - FUN_2822E  → `rts`                    (no-op)
 *   - FUN_253EC  → `rts`                    (no-op, NOT modifies obj+0x18)
 *   - FUN_17934  → `rts`                    (no-op)
 *   - FUN_1BAB2  → `rts`                    (no-op)
 *   - FUN_1CC62  → `moveq #0,D0; rts`       (return 0)
 *   - FUN_1B9CC  → `rts`                    (no-op)
 *   - FUN_158AC  -> append-byte-to-buffer    (capture sound calls)
 *   - FUN_285B0  → `rts`                    (no-op)
 *
 * Parity strategy:
 *        - count in {0..6} (30% bias toward 2 for respawn coverage)
 *        - level in {0,1,2,4,7,random} with 30% bias toward 4
 *        - for each obj in range [0..count): random bytes across span 0..0xE2
 *        - globals @ 0x400390/0x400394/0x400396/0x400462/0x400466/0x400472
 *        - for coverage: occasionally force state=2/3 and respawn-eligible
 *   3. Run TS objectScanDispatch251DE on the workRam mirror (capture sound
 *      calls; all the other subs no-op).
 *        - byte-by-byte over [0x400018, 0x400018 + count*0xE2)
 *        - globals @ 0x400390 (word), 0x400696 / 0x400698 (word)
 *
 * Usage: npx tsx packages/cli/src/test-object-scan-dispatch-251de-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  objectScanDispatch251DE as scanNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_251DE = 0x000251de;
const FUN_1BBAA = 0x0001bbaa;
const FUN_2822E = 0x0002822e;
const FUN_253EC = 0x000253ec;
const FUN_17934 = 0x00017934;
const FUN_1BAB2 = 0x0001bab2;
const FUN_1CC62 = 0x0001cc62;
const FUN_1B9CC = 0x0001b9cc;
const FUN_158AC = 0x000158ac;
const FUN_285B0 = 0x000285b0;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
const OBJ_BASE = 0x00400018;
const OBJ_STRIDE = 0xe2;
// Max count = 3 → obj region [0x400018, 0x400018 + 3*0xE2) =
// (count=4 obj[3] occupies 0x4002BE..0x4003A0, invading 0x400390 (level/count).
//  Avoid it so we do not self-modify the state machine during the loop.)
const MAX_OBJS = 3;

const SOUND_BUF_BASE = 0x00401ff0; // 16 byte of buffer
const SOUND_CUR_PTR = 0x00401fec; // long ptr to next slot

/**
 * Patch a single ROM entry point with the specified byte pattern.
 */
function patchRomBytes(
  rom: Buffer,
  entry: number,
  bytes: readonly number[],
): void {
  for (let i = 0; i < bytes.length; i++) {
    rom[entry + i] = bytes[i]! & 0xff;
  }
}

/**
 * Patch FUN_158AC: append byte arg LSB to (*SOUND_CUR_PTR)++.
 *   move.b   (0x7,SP), D0           : 10 2F 00 07
 *   movea.l  (SOUND_CUR_PTR).l, A1  : 22 79 [SOUND_CUR_PTR BE 4 byte]
 *   move.b   D0, (A1)+              : 12 C0
 *   move.l   A1, (SOUND_CUR_PTR).l  : 23 C9 [SOUND_CUR_PTR BE 4 byte]
 *   rts                             : 4E 75
 * Total 20 byte.
 */
function patchSoundSink(rom: Buffer): void {
  const ptr = SOUND_CUR_PTR;
  patchRomBytes(rom, FUN_158AC, [
    0x10, 0x2f, 0x00, 0x07,
    0x22, 0x79,
    (ptr >>> 24) & 0xff,
    (ptr >>> 16) & 0xff,
    (ptr >>> 8) & 0xff,
    ptr & 0xff,
    0x12, 0xc0,
    0x23, 0xc9,
    (ptr >>> 24) & 0xff,
    (ptr >>> 16) & 0xff,
    (ptr >>> 8) & 0xff,
    ptr & 0xff,
    0x4e, 0x75,
  ]);
}

/** Patch all 7 subs to `rts` (no-op) + FUN_1CC62 to `moveq #0,D0; rts`. */
function patchAllSubs(rom: Buffer): void {
  const rtsOnly = [0x4e, 0x75];
  patchRomBytes(rom, FUN_1BBAA, rtsOnly);
  patchRomBytes(rom, FUN_2822E, rtsOnly);
  patchRomBytes(rom, FUN_253EC, rtsOnly);
  patchRomBytes(rom, FUN_17934, rtsOnly);
  patchRomBytes(rom, FUN_1BAB2, rtsOnly);
  patchRomBytes(rom, FUN_1B9CC, rtsOnly);
  patchRomBytes(rom, FUN_285B0, rtsOnly);
  // FUN_1CC62: moveq #0, D0; rts → 70 00 4E 75
  patchRomBytes(rom, FUN_1CC62, [0x70, 0x00, 0x4e, 0x75]);
  // FUN_158AC: sound sink
  patchSoundSink(rom);
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
  count: number;
  level: number;
  field: string;
  bin: number | string;
  ts: number | string;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  patchAllSubs(romBuf);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== objectScanDispatch251DE (FUN_000251DE) — ${n} cases ===`);
  console.log(
    `  (sub-jsrs patched: 1BBAA/2822E/253EC/17934/1BAB2/1B9CC/285B0 → rts;`,
  );
  console.log(
    `   1CC62 → moveq #0,D0;rts; 158AC → append-byte-to-buffer)`,
  );

  const rng = makeRng(0x251de);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  let ok = 0;
  let firstFail: FailRecord | null = null;

  const stubRom = busNs.emptyRomImage();

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401e00);

    // Pattern coverage:
    //   - 50% count = 2 (to coverage respawn block, count==2 gate)
    //   - 50% count random in 0..MAX_OBJS
    let count: number;
    const r0 = rng();
    if (r0 < 0.5) count = 2;
    else count = Math.floor(rng() * (MAX_OBJS + 1));

    const level = rng() < 0.3 ? 4 : Math.floor(rng() * 8);

    const pre390 = rng() < 0.3 ? 1 : Math.floor(rng() * 0x10000);

    // Globals used by the respawn block.
    const g462 = rl();
    const g466 = rl();
    const g472 = rb();

    // Pre-existing 0x400696/0x400698 long random.
    const g696 = rl();
    const g698 = rl();

    // ── Setup binary side ──────────────────────────────────────────────
    const objRegionEnd = OBJ_BASE + MAX_OBJS * OBJ_STRIDE;
    for (let a = OBJ_BASE; a < objRegionEnd; a++) {
      pokeMem(cpu, a, 1, 0);
    }

    // count, level, *0x400390
    pokeMem(cpu, 0x00400396, 2, count & 0xffff);
    pokeMem(cpu, 0x00400394, 2, level & 0xffff);
    pokeMem(cpu, 0x00400390, 2, pre390 & 0xffff);

    // Globals 0x400462 long, 0x400466 long, 0x400472 byte.
    pokeMem(cpu, 0x00400462, 4, g462);
    pokeMem(cpu, 0x00400466, 4, g466);
    pokeMem(cpu, 0x00400472, 1, g472);

    // Globals 0x400696/0x400698 long (random pre).
    pokeMem(cpu, 0x00400696, 4, g696);
    pokeMem(cpu, 0x00400698, 4, g698);

    // For coverage of the filter: occasionally force state=2/3 and
    const objBytes: Uint8Array[] = [];
    for (let k = 0; k < count; k++) {
      const buf = new Uint8Array(OBJ_STRIDE);
      for (let j = 0; j < OBJ_STRIDE; j++) buf[j] = rb();

      // Coverage of +0x18 (state):
      //   25% → 2 (state-2)
      //   25% → 3 (state-3)
      //   20% → random (including 1, etc. → potentially respawn)
      const rState = rng();
      if (rState < 0.30) buf[0x18] = 0;
      else if (rState < 0.55) buf[0x18] = 2;
      else if (rState < 0.80) buf[0x18] = 3;
      else buf[0x18] = rb();

      // Coverage X (+0x20): 25% > 0xEC, 25% < -8 (signed), 50% in the range.
      const rX = rng();
      let xWord: number;
      if (rX < 0.25) xWord = (0xed + Math.floor(rng() * 0x100)) & 0xffff; // > 0xEC
      else if (rX < 0.5) xWord = (0xff80 - Math.floor(rng() * 0x100)) & 0xffff; // < -8
      else xWord = ((Math.floor(rng() * 0xf5) - 8) & 0xffff); // -8..0xEC (mostly)
      buf[0x20] = (xWord >>> 8) & 0xff;
      buf[0x21] = xWord & 0xff;

      // Coverage +0x36: 25% = 2, 75% random.
      buf[0x36] = rng() < 0.25 ? 2 : rb();

      // Coverage +0x1A: 30% in {0,1,5}, 70% random.
      const r1A = rng();
      if (r1A < 0.10) buf[0x1a] = 0;
      else if (r1A < 0.20) buf[0x1a] = 1;
      else if (r1A < 0.30) buf[0x1a] = 5;
      else buf[0x1a] = rb();

      // Coverage +0x6A (word): 30% > 0x190 (gate FUN_2822E), 70% ≤ 0x190.
      let w6a: number;
      if (rng() < 0.3) w6a = (0x191 + Math.floor(rng() * 0x100)) & 0xffff;
      else w6a = Math.floor(rng() * 0x191) & 0xffff;
      buf[0x6a] = (w6a >>> 8) & 0xff;
      buf[0x6b] = w6a & 0xff;

      objBytes.push(buf);
      const objAddr = OBJ_BASE + k * OBJ_STRIDE;
      for (let j = 0; j < OBJ_STRIDE; j++) {
        pokeMem(cpu, objAddr + j, 1, buf[j]!);
      }
    }

    // Sound buffer init: cur=SOUND_BUF_BASE, buffer=0xFF*16
    pokeMem(cpu, SOUND_CUR_PTR, 4, SOUND_BUF_BASE);
    for (let kk = 0; kk < 16; kk++) {
      pokeMem(cpu, SOUND_BUF_BASE + kk, 1, 0xff);
    }

    // ── Mirror into state.workRam ──────────────────────────────────────
    for (let kk = 0; kk < WORK_RAM_SIZE; kk++) stateInst.workRam[kk] = 0;
    // count, level, 390
    stateInst.workRam[0x396] = (count >>> 8) & 0xff;
    stateInst.workRam[0x397] = count & 0xff;
    stateInst.workRam[0x394] = (level >>> 8) & 0xff;
    stateInst.workRam[0x395] = level & 0xff;
    stateInst.workRam[0x390] = (pre390 >>> 8) & 0xff;
    stateInst.workRam[0x391] = pre390 & 0xff;
    // 462 long, 466 long, 472 byte
    stateInst.workRam[0x462] = (g462 >>> 24) & 0xff;
    stateInst.workRam[0x463] = (g462 >>> 16) & 0xff;
    stateInst.workRam[0x464] = (g462 >>> 8) & 0xff;
    stateInst.workRam[0x465] = g462 & 0xff;
    stateInst.workRam[0x466] = (g466 >>> 24) & 0xff;
    stateInst.workRam[0x467] = (g466 >>> 16) & 0xff;
    stateInst.workRam[0x468] = (g466 >>> 8) & 0xff;
    stateInst.workRam[0x469] = g466 & 0xff;
    stateInst.workRam[0x472] = g472;
    // 696/698 long
    stateInst.workRam[0x696] = (g696 >>> 24) & 0xff;
    stateInst.workRam[0x697] = (g696 >>> 16) & 0xff;
    stateInst.workRam[0x698] = (g698 >>> 24) & 0xff;
    stateInst.workRam[0x699] = (g698 >>> 16) & 0xff;
    stateInst.workRam[0x69a] = (g698 >>> 8) & 0xff;
    stateInst.workRam[0x69b] = g698 & 0xff;
    // 0x698 and 0x69A separately to handle full long correctly:
    // wait, *0x400696 long covers offsets 0x696..0x699.
    // *0x400698 long covers 0x698..0x69B → overlap with 696. Replicate exact:
    stateInst.workRam[0x696] = (g696 >>> 24) & 0xff;
    stateInst.workRam[0x697] = (g696 >>> 16) & 0xff;
    stateInst.workRam[0x698] = (g696 >>> 8) & 0xff;
    stateInst.workRam[0x699] = g696 & 0xff;
    stateInst.workRam[0x698] = (g698 >>> 24) & 0xff;
    stateInst.workRam[0x699] = (g698 >>> 16) & 0xff;
    stateInst.workRam[0x69a] = (g698 >>> 8) & 0xff;
    stateInst.workRam[0x69b] = g698 & 0xff;
    for (let kk = 0; kk < 6; kk++) {
      stateInst.workRam[0x696 + kk] =
        peekMem(cpu, 0x00400696 + kk, 1) & 0xff;
    }

    // Object bytes in the mirror.
    for (let k = 0; k < count; k++) {
      const off = (OBJ_BASE - WORK_RAM_BASE) + k * OBJ_STRIDE;
      const buf = objBytes[k]!;
      for (let j = 0; j < OBJ_STRIDE; j++) {
        stateInst.workRam[off + j] = buf[j]!;
      }
    }

    // ── Run binary ─────────────────────────────────────────────────────
    callFunction(cpu, FUN_251DE, []);

    const binCurEnd = peekMem(cpu, SOUND_CUR_PTR, 4) >>> 0;
    const binSoundCount = (binCurEnd - SOUND_BUF_BASE) >>> 0;
    const binSounds: number[] = [];
    for (let kk = 0; kk < binSoundCount && kk < 16; kk++) {
      binSounds.push(peekMem(cpu, SOUND_BUF_BASE + kk, 1) & 0xff);
    }

    // ── Run TS ─────────────────────────────────────────────────────────
    const tsSounds: number[] = [];
    scanNs.objectScanDispatch251DE(stateInst, stubRom, {
      // All no-op, except soundCommand (capture) and fun_1CC62 (return 0).
      fun_1BBAA: () => {
        /* no-op */
      },
      fun_2822E: () => {
        /* no-op */
      },
      fun_253EC: () => {
        /* no-op */
      },
      fun_17934: () => {
        /* no-op */
      },
      fun_1BAB2: () => {
        /* no-op */
      },
      fun_1CC62: () => 0,
      fun_1B9CC: () => {
        /* no-op */
      },
      soundCommand: (_st, cmd) => tsSounds.push(cmd & 0xff),
      fun_285B0: () => {
        /* no-op */
      },
    });

    let fail: FailRecord | null = null;

    if (binSounds.length !== tsSounds.length) {
      fail = {
        i,
        count,
        level,
        field: "soundSeqLen",
        bin: binSounds.length,
        ts: tsSounds.length,
      };
    } else {
      for (let k = 0; k < binSounds.length; k++) {
        if (binSounds[k] !== tsSounds[k]) {
          fail = {
            i,
            count,
            level,
            field: `sound[${k}]`,
            bin: `0x${binSounds[k]!.toString(16)}`,
            ts: `0x${tsSounds[k]!.toString(16)}`,
          };
          break;
        }
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // 2) byte-by-byte over obj region [OBJ_BASE, OBJ_BASE + count*OBJ_STRIDE)
    for (let k = 0; k < count && !fail; k++) {
      const objAddr = OBJ_BASE + k * OBJ_STRIDE;
      const off = (OBJ_BASE - WORK_RAM_BASE) + k * OBJ_STRIDE;
      for (let j = 0; j < OBJ_STRIDE; j++) {
        const bin = peekMem(cpu, objAddr + j, 1) & 0xff;
        const ts = stateInst.workRam[off + j] ?? 0;
        if (bin !== ts) {
          fail = {
            i,
            count,
            level,
            field: `obj[${k}]+0x${j.toString(16)}`,
            bin: `0x${bin.toString(16)}`,
            ts: `0x${ts.toString(16)}`,
          };
          break;
        }
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // 3) Globals @ 0x400390 (word), 0x400696 / 0x400698 (word)
    {
      const bin = peekMem(cpu, 0x00400390, 2) & 0xffff;
      const ts =
        (((stateInst.workRam[0x390] ?? 0) << 8) |
          (stateInst.workRam[0x391] ?? 0)) &
        0xffff;
      if (bin !== ts) {
        fail = {
          i,
          count,
          level,
          field: "global@0x400390",
          bin: `0x${bin.toString(16)}`,
          ts: `0x${ts.toString(16)}`,
        };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }
    {
      const bin = peekMem(cpu, 0x00400696, 2) & 0xffff;
      const ts =
        (((stateInst.workRam[0x696] ?? 0) << 8) |
          (stateInst.workRam[0x697] ?? 0)) &
        0xffff;
      if (bin !== ts) {
        fail = {
          i,
          count,
          level,
          field: "global@0x400696",
          bin: `0x${bin.toString(16)}`,
          ts: `0x${ts.toString(16)}`,
        };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }
    {
      const bin = peekMem(cpu, 0x00400698, 2) & 0xffff;
      const ts =
        (((stateInst.workRam[0x698] ?? 0) << 8) |
          (stateInst.workRam[0x699] ?? 0)) &
        0xffff;
      if (bin !== ts) {
        fail = {
          i,
          count,
          level,
          field: "global@0x400698",
          bin: `0x${bin.toString(16)}`,
          ts: `0x${ts.toString(16)}`,
        };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(
      `  First fail @ case ${f.i} count=${f.count} level=${f.level}:`,
    );
    console.log(`    ${f.field}: bin=${f.bin} ts=${f.ts}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
