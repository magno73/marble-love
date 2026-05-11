#!/usr/bin/env node
/**
 * test-sub-14dec-parity.ts — differential FUN_00014DEC vs `sub14DEC`.
 *
 * FUN_00014DEC (166 byte, 0xA6 byte): "nearest-neighbor V2" — itera list
 * @ obj+0x4E (stride 4 byte) cercando l'entry più vicino (distance < 0x400).
 * Scrive ptr migliore in obj+0x4A (o 0xFFFFFFFF se nessuno).
 *
 * **Strategia parity**:
 *   - Nessuna callee (loop puro su list bytes).
 *   - Confronto workRam @ obj (32 byte: in particolare obj+0x4A) e list area.
 *
 * Layout:
 *   - Obj @ 0x401D00 (size 0x60)
 *   - List @ 0x401E00 (entries 4 byte ognuna, terminator byte[0|1]==0xFF)
 *
 * Uso: npx tsx packages/cli/src/test-sub-14dec-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  sub14DEC as subNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_14DEC = 0x00014dec;

const OBJ_ABS = 0x00401d00;
const OBJ_OFF = OBJ_ABS - 0x400000;
const OBJ_SIZE = 0x60;

const LIST_ABS = 0x00401e00;
const LIST_OFF = LIST_ABS - 0x400000;
const LIST_SIZE = 0x100; // ampio buffer per entries

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function writeLongBytes(arr: number[], off: number, v: number): void {
  const u = v >>> 0;
  arr[off]     = (u >>> 24) & 0xff;
  arr[off + 1] = (u >>> 16) & 0xff;
  arr[off + 2] = (u >>> 8)  & 0xff;
  arr[off + 3] =  u         & 0xff;
}

function setupBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  objBytes: number[],
  listBytes: number[],
): void {
  for (let i = 0; i < OBJ_SIZE; i++) {
    const v = objBytes[i] ?? 0;
    pokeMem(cpu, OBJ_ABS + i, 1, v);
    state.workRam[OBJ_OFF + i] = v;
  }
  for (let i = 0; i < LIST_SIZE; i++) {
    const v = listBytes[i] ?? 0;
    pokeMem(cpu, LIST_ABS + i, 1, v);
    state.workRam[LIST_OFF + i] = v;
  }
}

function compareObj(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < OBJ_SIZE; i++) {
    const b = peekMem(cpu, OBJ_ABS + i, 1);
    const t = state.workRam[OBJ_OFF + i] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t };
  }
  return null;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "100");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  let totalOk = 0;
  interface FailRecord {
    tc: number;
    offset: number;
    bin: number;
    ts: number;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(tc: number, objBytes: number[], listBytes: number[]): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    // D6 register: matching della replica TS che usa bestPtr = 0xFFFFFFFF
    // come "non aggiornato". Il binario legge D6 register all'entry (non lo
    // clearizza prima del primo update). Forziamo D6 == 0xFFFFFFFF coerente
    // col valore TS default.
    cpu.system.setRegister("d6", 0xffffffff);
    setupBoth(stateInst, cpu, objBytes, listBytes);
    callFunction(cpu, FUN_14DEC, [OBJ_ABS]);
    subNs.sub14DEC(stateInst, OBJ_ABS);
    const fail = compareObj(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = { tc, offset: fail.offset, bin: fail.bin, ts: fail.ts };
    }
    return false;
  }

  const rng = makeRng(0x14dec);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  console.log(`\n=== sub14DEC (FUN_00014DEC) — 100 random scenarios — ${total} casi ===`);

  for (let i = 0; i < total; i++) {
    const objBytes = new Array(OBJ_SIZE).fill(0).map(() => rb());
    // Obj posX/posY (0xC, 0x10) lasciati random.
    // Obj+0x4E (list ptr) → LIST_ABS.
    writeLongBytes(objBytes, 0x4e, LIST_ABS);

    // List entries: prima genera N entry random (4 byte ognuna), poi sentinel 0xFF.
    const listBytes = new Array(LIST_SIZE).fill(0).map(() => rb());
    // Numero entry valide: 1..15 (random) — sentinel piazzato dopo.
    const nEntries = 1 + Math.floor(rng() * 15);
    // Garantiamo che la prima sentinel-able byte sia 0xFF a entry index nEntries.
    listBytes[nEntries * 4] = 0xff;
    listBytes[nEntries * 4 + 1] = 0xff; // doppia per robustezza
    // Forziamo le prime entry ad avere byte[0|1] != 0xFF (per evitare early break casuale).
    for (let e = 0; e < nEntries; e++) {
      if (listBytes[e * 4] === 0xff) listBytes[e * 4] = (rb() & 0x7f);
      if (listBytes[e * 4 + 1] === 0xff) listBytes[e * 4 + 1] = (rb() & 0x7f);
    }

    if (runOneCase(i, objBytes, listBytes)) totalOk++;
  }

  console.log(`  Match: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}%`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail tc=${f.tc}: @ obj+0x${f.offset.toString(16)} ` +
        `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
