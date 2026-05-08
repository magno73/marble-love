#!/usr/bin/env node
/**
 * test-helper-25c74-parity.ts — differential FUN_00025C74 vs helper25C74.
 *
 * `FUN_00025C74` (0x25C74..0x25DF4) è un "object entry-state handler":
 * aggiorna lo stato di una object struct in work RAM, aggiorna il campo
 * A2[+0x57] con delta clampato, poi dispatcha transizioni di stato.
 *
 * **Argomenti**: 2 long sullo stack = (objPtr, deltaLong).
 * **Costanti interne**: A3 = 0x25BAE, coppia canonica 0x400018/0x4000FA.
 *
 * **Sub-JSR** patchate per isolamento:
 *   - `FUN_25BAE` (@ 0x25BAE): append (objPtr, code) a buffer.
 *   - `FUN_15884` (@ 0x15884): incrementa count.
 *   - `FUN_158AC` (@ 0x158AC): append sound cmd a buffer.
 *   - `FUN_15BD0` (@ 0x15BD0): append (structPtr, arg2, arg3) a buffer.
 *
 * **Strategia parity**:
 *   1. ROM patch: intercetta le 4 sub-jsr con stub che scrivono i loro arg
 *      in zone fisse di work RAM (0x401F00+).
 *   2. Per ogni caso random: randomizza objPtr tra la coppia canonica e
 *      indirizzi arbitrari; randomizza i campi rilevanti della struct.
 *   3. Esegui binario reale @ FUN_25C74 + TS helper25C74 su mirror.
 *   4. Confronta tutti i campi scritti + le sequenze di chiamate sub-jsr.
 *
 * **Buffer cattura** (tutti in work RAM range 0x401F00-0x401FF0):
 *   - 0x401F00: FUN_158AC sound buffer (max 4 byte)
 *   - 0x401F0C: FUN_158AC sound cur ptr (long → next write slot)
 *   - 0x401F10: FUN_25BAE call buffer (max 3 × 8 byte)
 *     ogni entry: [objPtr long BE][code long BE]
 *   - 0x401F2C: FUN_25BAE call count byte
 *   - 0x401F30: FUN_15884 call count byte
 *   - 0x401F40: FUN_15BD0 call buffer (max 2 × 12 byte = 24 byte)
 *     ogni entry: [structPtr long BE][arg2 long BE][arg3 long BE]
 *   - 0x401F58: FUN_15BD0 call count byte
 *
 * Uso: npx tsx packages/cli/src/test-helper-25c74-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  helper25C74 as h25c74Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_25C74 = 0x00025c74;
const FUN_25BAE = 0x00025bae;
const FUN_15884 = 0x00015884;
const FUN_158AC = 0x000158ac;
const FUN_15BD0 = 0x00015bd0;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

// ─── Buffer cattura in work RAM ───────────────────────────────────────────────
const SOUND_BUF_BASE  = 0x00401f00 as const;
const SOUND_CUR_PTR   = 0x00401f0c as const;
const OSE25_BUF_BASE  = 0x00401f10 as const;
const OSE25_COUNT_PTR = 0x00401f2c as const;
const SP15884_COUNT   = 0x00401f30 as const;
const BD0_BUF_BASE    = 0x00401f40 as const;
const BD0_COUNT_PTR   = 0x00401f58 as const;

// ─── Coppia canonica ──────────────────────────────────────────────────────────
const OBJ_PAIR_FIRST  = 0x00400018 as const;
const OBJ_PAIR_SECOND = 0x004000fa as const;

// ─── Object pointer candidates (extra) ───────────────────────────────────────
const PTR_CANDIDATES: readonly number[] = [
  0x00400200, 0x00400400, 0x00400600, 0x00400800,
  0x00400a00, 0x00400c00, 0x00400e00, 0x00401000,
  0x00401200, 0x00401400, 0x00401600,
];

// ─── Fail record ─────────────────────────────────────────────────────────────
interface FailRecord {
  i: number;
  ptr: number;
  delta: number;
  field: string;
  bin: unknown;
  ts: unknown;
}

// ─── LCG RNG ─────────────────────────────────────────────────────────────────
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ─── ROM patches ─────────────────────────────────────────────────────────────

/**
 * Patch FUN_158AC: append byte arg (offset 0x7 da SP) a buffer.
 *   move.b  (0x7,SP), D0       : 10 2F 00 07
 *   movea.l ($401F0C).l, A1    : 22 79 00 40 1F 0C
 *   move.b  D0, (A1)+          : 12 C0
 *   move.l  A1, ($401F0C).l    : 23 C9 00 40 1F 0C
 *   rts                         : 4E 75
 */
function patchSoundSink(rom: Buffer): void {
  const a = FUN_158AC;
  rom[a + 0x0] = 0x10; rom[a + 0x1] = 0x2f; rom[a + 0x2] = 0x00; rom[a + 0x3] = 0x07;
  rom[a + 0x4] = 0x22; rom[a + 0x5] = 0x79;
  rom[a + 0x6] = 0x00; rom[a + 0x7] = 0x40; rom[a + 0x8] = 0x1f; rom[a + 0x9] = 0x0c;
  rom[a + 0xa] = 0x12; rom[a + 0xb] = 0xc0;
  rom[a + 0xc] = 0x23; rom[a + 0xd] = 0xc9;
  rom[a + 0xe] = 0x00; rom[a + 0xf] = 0x40; rom[a + 0x10] = 0x1f; rom[a + 0x11] = 0x0c;
  rom[a + 0x12] = 0x4e; rom[a + 0x13] = 0x75;
}

/**
 * Patch FUN_15884: incrementa count @ 0x401F30 + rts.
 *   addq.b  #1, ($401F30).l    : 52 39 00 40 1F 30
 *   rts                         : 4E 75
 */
function patchSoundPair(rom: Buffer): void {
  const a = FUN_15884;
  rom[a + 0x0] = 0x52; rom[a + 0x1] = 0x39;
  rom[a + 0x2] = 0x00; rom[a + 0x3] = 0x40; rom[a + 0x4] = 0x1f; rom[a + 0x5] = 0x30;
  rom[a + 0x6] = 0x4e; rom[a + 0x7] = 0x75;
}

/**
 * Patch FUN_25BAE: append (objPtr, code) al buffer + rts.
 *
 * Al momento di ingresso in FUN_25BAE:
 *   SP+0 = return addr
 *   SP+4 = objPtr (ultima push = più vicina allo SP)
 *   SP+8 = subStateCode long (prima push = più lontana)
 *
 * Stub (48 byte):
 *   moveq #0, D0
 *   move.b  ($401F2C).l, D0
 *   cmpi.b  #3, D0
 *   bge.b   done (skip 0x20 bytes from bge+2)
 *   addq.b  #1, ($401F2C).l
 *   mulu    #8, D0
 *   lea     ($401F10).l, A0
 *   adda.l  D0, A0
 *   move.l  (0x4,SP), D1  ; objPtr
 *   move.l  D1, (A0)
 *   move.l  (0x8,SP), D1  ; code
 *   move.l  D1, (0x4,A0)
 * done:
 *   rts
 */
function patchOSE25BAE(rom: Buffer): void {
  const a = FUN_25BAE;
  rom[a+0x0]=0x70; rom[a+0x1]=0x00;
  rom[a+0x2]=0x10; rom[a+0x3]=0x39; rom[a+0x4]=0x00; rom[a+0x5]=0x40;
  rom[a+0x6]=0x1f; rom[a+0x7]=0x2c;
  rom[a+0x8]=0x0c; rom[a+0x9]=0x00; rom[a+0xa]=0x00; rom[a+0xb]=0x03;
  rom[a+0xc]=0x6c; rom[a+0xd]=0x20;
  rom[a+0xe]=0x52; rom[a+0xf]=0x39; rom[a+0x10]=0x00; rom[a+0x11]=0x40;
  rom[a+0x12]=0x1f; rom[a+0x13]=0x2c;
  rom[a+0x14]=0xc0; rom[a+0x15]=0xfc; rom[a+0x16]=0x00; rom[a+0x17]=0x08;
  rom[a+0x18]=0x41; rom[a+0x19]=0xf9; rom[a+0x1a]=0x00; rom[a+0x1b]=0x40;
  rom[a+0x1c]=0x1f; rom[a+0x1d]=0x10;
  rom[a+0x1e]=0xd1; rom[a+0x1f]=0xc0;
  rom[a+0x20]=0x22; rom[a+0x21]=0x2f; rom[a+0x22]=0x00; rom[a+0x23]=0x04;
  rom[a+0x24]=0x20; rom[a+0x25]=0x81;
  rom[a+0x26]=0x22; rom[a+0x27]=0x2f; rom[a+0x28]=0x00; rom[a+0x29]=0x08;
  rom[a+0x2a]=0x21; rom[a+0x2b]=0x41; rom[a+0x2c]=0x00; rom[a+0x2d]=0x04;
  rom[a+0x2e]=0x4e; rom[a+0x2f]=0x75;
}

/**
 * Patch FUN_15BD0: append (structPtr, arg2, arg3) al buffer + rts.
 *
 * Al momento di ingresso in FUN_15BD0:
 *   SP+0  = return addr
 *   SP+4  = structPtr (arg1 long)
 *   SP+8  = arg2 long
 *   SP+12 = arg3 long
 *
 * Stub (56 byte):
 *   moveq #0, D0
 *   move.b  ($401F58).l, D0    ; D0 = count
 *   cmpi.b  #2, D0             ; limit 2 entries
 *   bge.b   done (skip to rts)
 *   addq.b  #1, ($401F58).l
 *   mulu    #12, D0            ; offset = count_old * 12
 *   lea     ($401F40).l, A0
 *   adda.l  D0, A0
 *   move.l  (0x4,SP), D1      ; structPtr
 *   move.l  D1, (A0)
 *   move.l  (0x8,SP), D1      ; arg2
 *   move.l  D1, (0x4,A0)
 *   move.l  (0xC,SP), D1      ; arg3
 *   move.l  D1, (0x8,A0)
 * done:
 *   rts
 *
 * M68k encoding:
 *   moveq #0, D0           : 70 00
 *   move.b ($401F58).l, D0 : 10 39 00 40 1F 58
 *   cmpi.b #2, D0          : 0C 00 00 02
 *   bge.b (offset)         : 6C XX
 *   addq.b #1, ($401F58).l : 52 39 00 40 1F 58
 *   mulu.w #12, D0         : C0 FC 00 0C
 *   lea ($401F40).l, A0    : 41 F9 00 40 1F 40
 *   adda.l D0, A0          : D1 C0
 *   move.l (0x4,SP), D1    : 22 2F 00 04
 *   move.l D1, (A0)        : 20 81
 *   move.l (0x8,SP), D1    : 22 2F 00 08
 *   move.l D1, (0x4,A0)    : 21 41 00 04
 *   move.l (0xC,SP), D1    : 22 2F 00 0C
 *   move.l D1, (0x8,A0)    : 21 41 00 08
 *   rts                    : 4E 75
 * Total = 2+6+4+2+6+4+6+2+4+2+4+4+4+4+2 = 56 byte
 * bge offset from PC (bge+2) to rts: = 56 - (2+6+4+2) = 42 = 0x2A
 */
function patchStateSub15BD0(rom: Buffer): void {
  const a = FUN_15BD0;
  // moveq #0, D0
  rom[a+0x0]=0x70; rom[a+0x1]=0x00;
  // move.b ($401F58).l, D0
  rom[a+0x2]=0x10; rom[a+0x3]=0x39; rom[a+0x4]=0x00; rom[a+0x5]=0x40;
  rom[a+0x6]=0x1f; rom[a+0x7]=0x58;
  // cmpi.b #2, D0
  rom[a+0x8]=0x0c; rom[a+0x9]=0x00; rom[a+0xa]=0x00; rom[a+0xb]=0x02;
  // bge.b → rts (offset = 0x2A from next instr = a+0xE)
  rom[a+0xc]=0x6c; rom[a+0xd]=0x2a;
  // addq.b #1, ($401F58).l
  rom[a+0xe]=0x52; rom[a+0xf]=0x39; rom[a+0x10]=0x00; rom[a+0x11]=0x40;
  rom[a+0x12]=0x1f; rom[a+0x13]=0x58;
  // mulu.w #12, D0
  rom[a+0x14]=0xc0; rom[a+0x15]=0xfc; rom[a+0x16]=0x00; rom[a+0x17]=0x0c;
  // lea ($401F40).l, A0
  rom[a+0x18]=0x41; rom[a+0x19]=0xf9; rom[a+0x1a]=0x00; rom[a+0x1b]=0x40;
  rom[a+0x1c]=0x1f; rom[a+0x1d]=0x40;
  // adda.l D0, A0
  rom[a+0x1e]=0xd1; rom[a+0x1f]=0xc0;
  // move.l (0x4,SP), D1   ; structPtr
  rom[a+0x20]=0x22; rom[a+0x21]=0x2f; rom[a+0x22]=0x00; rom[a+0x23]=0x04;
  // move.l D1, (A0)
  rom[a+0x24]=0x20; rom[a+0x25]=0x81;
  // move.l (0x8,SP), D1   ; arg2
  rom[a+0x26]=0x22; rom[a+0x27]=0x2f; rom[a+0x28]=0x00; rom[a+0x29]=0x08;
  // move.l D1, (0x4,A0)
  rom[a+0x2a]=0x21; rom[a+0x2b]=0x41; rom[a+0x2c]=0x00; rom[a+0x2d]=0x04;
  // move.l (0xC,SP), D1   ; arg3
  rom[a+0x2e]=0x22; rom[a+0x2f]=0x2f; rom[a+0x30]=0x00; rom[a+0x31]=0x0c;
  // move.l D1, (0x8,A0)
  rom[a+0x32]=0x21; rom[a+0x33]=0x41; rom[a+0x34]=0x00; rom[a+0x35]=0x08;
  // rts  (at offset 0xE + 0x2A = 0x38)
  rom[a+0x36]=0x4e; rom[a+0x37]=0x75;
}

// ─── Helpers locali ───────────────────────────────────────────────────────────

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Patch ROM
  patchSoundSink(romBuf);
  patchSoundPair(romBuf);
  patchOSE25BAE(romBuf);
  patchStateSub15BD0(romBuf);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== helper25C74 (FUN_00025C74) — ${n} casi ===`);
  console.log(
    `  (FUN_158AC → sound-sink, FUN_15884 → count, FUN_25BAE → call-log, FUN_15BD0 → call-log)`,
  );

  const rng = makeRng(0x25c74);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const pickPtr = (): number =>
    PTR_CANDIDATES[Math.floor(rng() * PTR_CANDIDATES.length)]!;

  let ok = 0;
  let firstFail: FailRecord | null = null;

  // Tutti i field offset scritti dalla funzione
  const SCRATCH_FIELDS = [
    0x18, 0x1a, 0x56, 0x57, 0x5a, 0x5b, 0x5c, 0x5d, 0x5f, 0x60,
  ] as const;

  // Offset NON toccati (sentinelle per no-spill)
  const NEIGHBORS = [
    0x00, 0x01, 0x17, 0x19, 0x1b, 0x1c, 0x1d,
    0x1e, 0x1f, 0x55, 0x58, 0x59,
    0x5e, 0x61, 0x62, 0x63, 0x64, 0x65,
  ] as const;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Scelta dell'objPtr
    const ptrChoice = rng();
    const actualPtr: number =
      ptrChoice < 0.20 ? OBJ_PAIR_FIRST :
      ptrChoice < 0.40 ? OBJ_PAIR_SECOND :
      pickPtr();

    const off = actualPtr - WORK_RAM_BASE;

    // Delta word (D1.w): distribuzione mista
    const deltaLong = Math.floor(rng() * 0x100000000) >>> 0;
    // Prefer interesting values: sign range, zero, 0x7F, 0x10, etc.
    let deltaChoice: number;
    const dr = rng();
    if      (dr < 0.1)  deltaChoice = 0x00000000;
    else if (dr < 0.2)  deltaChoice = 0x00000001;
    else if (dr < 0.25) deltaChoice = 0x00000010;
    else if (dr < 0.3)  deltaChoice = 0x00007fff;
    else if (dr < 0.35) deltaChoice = 0xffff8000; // -0x8000
    else if (dr < 0.4)  deltaChoice = 0x0000ffff; // 0xFFFF word
    else                deltaChoice = deltaLong;

    // State A2[+0x1A]: distribuzione {1,5,6, random}
    const r1a = rng();
    const pre1A: number =
      r1a < 0.20 ? 0x01 :
      r1a < 0.40 ? 0x05 :
      r1a < 0.55 ? 0x06 :
      rb();

    // A2[+0x56]: step counter
    const pre56 = rb();
    // A2[+0x57]: obj_type
    const pre57 = rb();
    // A2[+0x18]: secondary state
    const pre18 = rng() < 0.3 ? 0x02 : rb();
    // A2[+0x20].w: field_20 (signed word for range check)
    const pre20hi = rb();
    const pre20lo = rb();
    // A2[+0x5F]: frame_ctr
    const pre5F = rb();
    // A2[+0x60]: frames_per_step
    const pre60 = rb();
    // A2[+0x5A..5D]: anim_ptr
    const preAnimPtr = ((0x00020000 + Math.floor(rng() * 0x1000) * 4)) >>> 0;

    // ── Build scratch object ─────────────────────────────────────────────
    const scratchObj = new Uint8Array(0x80);
    for (let k = 0; k < 0x80; k++) scratchObj[k] = rb();

    scratchObj[0x18] = pre18;
    scratchObj[0x1a] = pre1A;
    scratchObj[0x20] = pre20hi;
    scratchObj[0x21] = pre20lo;
    scratchObj[0x56] = pre56;
    scratchObj[0x57] = pre57;
    scratchObj[0x5a] = (preAnimPtr >>> 24) & 0xff;
    scratchObj[0x5b] = (preAnimPtr >>> 16) & 0xff;
    scratchObj[0x5c] = (preAnimPtr >>> 8)  & 0xff;
    scratchObj[0x5d] =  preAnimPtr         & 0xff;
    scratchObj[0x5f] = pre5F;
    scratchObj[0x60] = pre60;

    // Sentinelle vicini
    const neighborSentinels: Record<number, number> = {};
    for (let idx = 0; idx < NEIGHBORS.length; idx++) {
      const nOff = NEIGHBORS[idx]!;
      if (nOff >= 0x80) continue; // safety
      const v = (0xb0 + idx) & 0xff;
      neighborSentinels[nOff] = v;
      scratchObj[nOff] = v;
    }

    // ── Setup binary ─────────────────────────────────────────────────────
    // Init buffer zone
    pokeMem(cpu, SOUND_CUR_PTR, 4, SOUND_BUF_BASE);
    for (let k = 0; k < 4; k++) pokeMem(cpu, SOUND_BUF_BASE + k, 1, 0xff);
    pokeMem(cpu, OSE25_COUNT_PTR, 1, 0);
    pokeMem(cpu, SP15884_COUNT, 1, 0);
    pokeMem(cpu, BD0_COUNT_PTR, 1, 0);
    for (let k = 0; k < 0x80; k++) pokeMem(cpu, actualPtr + k, 1, scratchObj[k]!);

    // ── Mirror su state.workRam ──────────────────────────────────────────
    for (let k = 0; k < WORK_RAM_SIZE; k++) stateInst.workRam[k] = 0;
    for (let k = 0; k < 0x80; k++) stateInst.workRam[off + k] = scratchObj[k]!;

    // ── Run binary ───────────────────────────────────────────────────────
    callFunction(cpu, FUN_25C74, [actualPtr, deltaChoice]);

    // Leggi catture binarie
    const binSoundCurEnd = peekMem(cpu, SOUND_CUR_PTR, 4) >>> 0;
    const binSoundCount = (binSoundCurEnd - SOUND_BUF_BASE) >>> 0;
    const binSounds: number[] = [];
    for (let k = 0; k < binSoundCount && k < 4; k++) {
      binSounds.push(peekMem(cpu, SOUND_BUF_BASE + k, 1) & 0xff);
    }
    const binSP15884 = peekMem(cpu, SP15884_COUNT, 1) & 0xff;
    const binOSE25Count = peekMem(cpu, OSE25_COUNT_PTR, 1) & 0xff;
    const binOSE25Calls: { objPtr: number; code: number }[] = [];
    for (let k = 0; k < binOSE25Count && k < 3; k++) {
      const base = OSE25_BUF_BASE + k * 8;
      const op = (peekMem(cpu, base, 4)) >>> 0;
      const codeLong = (peekMem(cpu, base + 4, 4)) >>> 0;
      binOSE25Calls.push({ objPtr: op, code: codeLong & 0xff });
    }
    const binBD0Count = peekMem(cpu, BD0_COUNT_PTR, 1) & 0xff;
    const binBD0Calls: { structPtr: number; arg2: number; arg3: number }[] = [];
    for (let k = 0; k < binBD0Count && k < 2; k++) {
      const base = BD0_BUF_BASE + k * 12;
      const sp_ = (peekMem(cpu, base, 4)) >>> 0;
      const a2_ = (peekMem(cpu, base + 4, 4)) >>> 0;
      const a3_ = (peekMem(cpu, base + 8, 4)) >>> 0;
      binBD0Calls.push({ structPtr: sp_, arg2: a2_ & 0xff, arg3: a3_ & 0xff });
    }

    // Leggi campi scritti nel binario
    const binFields: Record<number, number> = {};
    for (const foff of SCRATCH_FIELDS) {
      binFields[foff] = peekMem(cpu, actualPtr + foff, 1) & 0xff;
    }
    const binNeighbors: Record<number, number> = {};
    for (const nOff of NEIGHBORS) {
      binNeighbors[nOff] = peekMem(cpu, actualPtr + nOff, 1) & 0xff;
    }

    // ── Run TS ───────────────────────────────────────────────────────────
    const tsSounds: number[] = [];
    let tsSP15884 = 0;
    const tsOSE25Calls: { objPtr: number; code: number }[] = [];
    const tsBD0Calls: { structPtr: number; arg2: number; arg3: number }[] = [];

    h25c74Ns.helper25C74(stateInst, actualPtr, deltaChoice, {
      soundCommand: (cmd: number) => {
        tsSounds.push(cmd & 0xff);
      },
      soundPair15884: () => {
        tsSP15884++;
      },
      objectStateEntry25BAE: (_s: typeof stateInst, op: number, code: number) => {
        tsOSE25Calls.push({ objPtr: op >>> 0, code: code & 0xff });
      },
      stateSub15BD0: (_s: typeof stateInst, structPtr: number, arg2: number, arg3: number) => {
        tsBD0Calls.push({ structPtr: structPtr >>> 0, arg2: arg2 & 0xff, arg3: arg3 & 0xff });
      },
    });

    const tsFields: Record<number, number> = {};
    for (const foff of SCRATCH_FIELDS) {
      tsFields[foff] = stateInst.workRam[off + foff] ?? 0;
    }
    const tsNeighbors: Record<number, number> = {};
    for (const nOff of NEIGHBORS) {
      if (nOff >= 0x80) continue;
      tsNeighbors[nOff] = stateInst.workRam[off + nOff] ?? 0;
    }

    // ── Confronto ────────────────────────────────────────────────────────
    let pass = true;

    // Campi scritti
    for (const foff of SCRATCH_FIELDS) {
      if ((binFields[foff] ?? 0) !== (tsFields[foff] ?? 0)) {
        if (!firstFail) firstFail = {
          i, ptr: actualPtr, delta: deltaChoice,
          field: `obj[+0x${foff.toString(16)}]`,
          bin: `0x${(binFields[foff] ?? 0).toString(16)}`,
          ts:  `0x${(tsFields[foff]  ?? 0).toString(16)}`,
        };
        pass = false;
        break;
      }
    }

    // Sentinelle (no-spill)
    if (pass) {
      for (const nOff of NEIGHBORS) {
        if (nOff >= 0x80) continue;
        const expected = neighborSentinels[nOff] ?? 0;
        if ((binNeighbors[nOff] ?? 0) !== expected) {
          // Binary spilled too — ok, just check TS matches binary
        }
        if ((binNeighbors[nOff] ?? 0) !== (tsNeighbors[nOff] ?? 0)) {
          if (!firstFail) firstFail = {
            i, ptr: actualPtr, delta: deltaChoice,
            field: `neighbor[+0x${nOff.toString(16)}]`,
            bin: `0x${(binNeighbors[nOff] ?? 0).toString(16)}`,
            ts:  `0x${(tsNeighbors[nOff] ?? 0).toString(16)}`,
          };
          pass = false;
          break;
        }
      }
    }

    // Sound calls
    if (pass) {
      if (binSounds.length !== tsSounds.length ||
          binSounds.some((v, k) => v !== tsSounds[k])) {
        if (!firstFail) firstFail = {
          i, ptr: actualPtr, delta: deltaChoice,
          field: "soundCmds",
          bin: JSON.stringify(binSounds),
          ts:  JSON.stringify(tsSounds),
        };
        pass = false;
      }
    }

    // Sound-pair15884 count
    if (pass) {
      if (binSP15884 !== tsSP15884) {
        if (!firstFail) firstFail = {
          i, ptr: actualPtr, delta: deltaChoice,
          field: "sp15884Count",
          bin: binSP15884,
          ts:  tsSP15884,
        };
        pass = false;
      }
    }

    // OSE25BAE calls
    if (pass) {
      if (binOSE25Calls.length !== tsOSE25Calls.length) {
        if (!firstFail) firstFail = {
          i, ptr: actualPtr, delta: deltaChoice,
          field: "ose25Count",
          bin: binOSE25Calls.length,
          ts:  tsOSE25Calls.length,
        };
        pass = false;
      } else {
        for (let ci = 0; ci < binOSE25Calls.length; ci++) {
          const bc = binOSE25Calls[ci]!;
          const tc = tsOSE25Calls[ci]!;
          if (bc.objPtr !== tc.objPtr || bc.code !== tc.code) {
            if (!firstFail) firstFail = {
              i, ptr: actualPtr, delta: deltaChoice,
              field: `ose25[${ci}]`,
              bin: `{objPtr:0x${bc.objPtr.toString(16)},code:${bc.code}}`,
              ts:  `{objPtr:0x${tc.objPtr.toString(16)},code:${tc.code}}`,
            };
            pass = false;
            break;
          }
        }
      }
    }

    // BD0 calls
    if (pass) {
      if (binBD0Calls.length !== tsBD0Calls.length) {
        if (!firstFail) firstFail = {
          i, ptr: actualPtr, delta: deltaChoice,
          field: "bd0Count",
          bin: binBD0Calls.length,
          ts:  tsBD0Calls.length,
        };
        pass = false;
      } else {
        for (let ci = 0; ci < binBD0Calls.length; ci++) {
          const bc = binBD0Calls[ci]!;
          const tc = tsBD0Calls[ci]!;
          if (bc.structPtr !== tc.structPtr ||
              bc.arg2 !== tc.arg2 ||
              bc.arg3 !== tc.arg3) {
            if (!firstFail) firstFail = {
              i, ptr: actualPtr, delta: deltaChoice,
              field: `bd0[${ci}]`,
              bin: `{sp:0x${bc.structPtr.toString(16)},a2:${bc.arg2},a3:${bc.arg3}}`,
              ts:  `{sp:0x${tc.structPtr.toString(16)},a2:${tc.arg2},a3:${tc.arg3}}`,
            };
            pass = false;
            break;
          }
        }
      }
    }

    if (pass) {
      ok++;
    }
  }

  disposeCpu(cpu);

  const pct = ((ok / n) * 100).toFixed(1);
  console.log(`\n  Result: ${ok}/${n} passed (${pct}%)`);

  if (firstFail) {
    const f = firstFail;
    console.error(`\n  FIRST FAIL @ case ${f.i}:`);
    console.error(`    ptr=0x${f.ptr.toString(16).padStart(8,"0")}`);
    console.error(`    delta=0x${(f.delta >>> 0).toString(16).padStart(8,"0")}`);
    console.error(`    field: ${f.field}`);
    console.error(`    binary: ${f.bin}`);
    console.error(`    ts    : ${f.ts}`);
    exit(1);
  }

  console.log("  PASS");
  exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(2);
});
