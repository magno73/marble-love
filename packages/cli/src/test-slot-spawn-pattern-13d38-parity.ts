#!/usr/bin/env node
/**
 * test-slot-spawn-pattern-13d38-parity.ts — differential FUN_00013D38 vs
 * `slotSpawnPattern13D38`.
 *
 * `FUN_00013D38` (430 byte) emette un fan-pattern di 8 record da 6 byte in due
 * range del proprio slot record (A0+0xA4 e A0+0x38), leggendo:
 *   - delta-stream byte signed @ ROM 0x1EF32 (16 byte = 8 coppie)
 *   - puntatori-slot @ ROM 0x1F016 indicizzati da `(A0+0x58).b sext.l <<2`
 *   - coords da `(A1+0x4E).l` e branch su `(A1+0x1F).b == 0xD`
 *
 * Setup random per ogni caso:
 *   - `(A0+0x57).b` random (counter)
 *   - `(A0+0x58).b` random nel range [0..24] (selettore valido nella table)
 *   - `(A0+0x1E).l` random (coords source)
 *   - workRam pre-azzerata sui campi rilevanti
 *   - SP fresco
 *
 * Confronto:
 *   - D0 (low byte: 0xFF o 0x00)
 *   - byte `(A0+0x57)` (counter post-decrement)
 *   - byte `(A0+0x1C)` (mark)
 *   - 4 record × 6 byte @ `(A0+0xA4)..(A0+0xBB)`
 *   - 4 record × 6 byte @ `(A0+0x38)..(A0+0x4F)`
 *
 * Uso: npx tsx packages/cli/src/test-slot-spawn-pattern-13d38-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  slotSpawnPattern13D38 as ssp13D38Ns,
  bus as busNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_13D38 = 0x00013d38;
const SLOT_PTR_TABLE = 0x0001f016;
const SLOT_TABLE_RAM = 0x00400a9c;
const SLOT_STRIDE = 0x56;
const SLOT_COUNT = 0x19;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function readU32BE(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  // Mirror ROM nella RomImage TS.
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  // Decodifica i 25 ptrs della tabella @0x1F016 una sola volta (validazione layout).
  const slotPtrs: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    slotPtrs.push(readU32BE(romBuf, SLOT_PTR_TABLE + i * 4));
  }

  console.log(`\n=== slotSpawnPattern13D38 (FUN_00013D38) — ${n} casi ===`);

  const rng = makeRng(0x13d38);
  let ok = 0;
  let firstFail: {
    i: number;
    argPtr: number;
    counterPre: number;
    selector: number;
    binD0: number;
    tsD0: number;
    diffField: string | undefined;
    binVal: number | undefined;
    tsVal: number | undefined;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // argPtr: usa uno degli slot canonici (in modo che A1 dopo selector lookup
    // sia nello stesso layout di slot).
    const argSlotIdx = Math.floor(rng() * SLOT_COUNT) % SLOT_COUNT;
    const argPtr = slotPtrs[argSlotIdx]!;
    const argOff = argPtr - 0x400000;

    // Pattern coverage:
    //   0: counter pre = 1 → post 0 → D0 = 0xFF (success path)
    //   1: counter pre = 0x21 → D2 negative? No: sext(0x21)=33, D2=0x20-33=-1
    //   2: counter pre = 0xE0 (sext=-32) → D2 = 0x40 → tutti skip
    //   3: counter pre random
    //   default (>=4): random mix
    let counterPre: number;
    if (i === 0) counterPre = 1;
    else if (i === 1) counterPre = 0x21;
    else if (i === 2) counterPre = 0xe0;
    else counterPre = Math.floor(rng() * 256) & 0xff;

    // Selector byte: range [0..24] per stare nella table.
    const selectorByte = Math.floor(rng() * SLOT_COUNT) & 0xff;

    // Random coords @ A0+0x1E (long).
    const coordsLong = Math.floor(rng() * 0x100000000) >>> 0;

    // ── PRE-CLEAR + SETUP ───────────────────────────────────────────
    // Azzera tutti gli slot (per evitare interference fra casi).
    // Ma anche manteniamo solo i campi rilevanti del slot in argPtr e dello
    // slot selezionato (per A1+0x4E e A1+0x1F).
    // Pulisci tutta la work RAM rilevante (slots).
    for (let s = 0; s < SLOT_COUNT; s++) {
      const slot = slotPtrs[s]!;
      const slotOff = slot - 0x400000;
      // Azzera campi che il binario legge (4E.l, 1F.b) e che potrebbero
      // essere modificati dal pattern emit (38..4F, A4..BB).
      // Inoltre azzera 1C, 57, 58, 1E.l per safety.
      const ranges: Array<[number, number]> = [
        [0x18, 1],
        [0x1c, 1],
        [0x1e, 4],
        [0x1f, 1],
        [0x38, 24], // 4 record da 6 byte
        [0x4e, 4], // long (overlapping con 0x4e..0x51)
        [0x57, 1],
        [0x58, 1],
        [0xa4, 24], // 4 record da 6 byte
      ];
      for (const [off, size] of ranges) {
        for (let k = 0; k < size; k++) {
          pokeMem(cpu, slot + off + k, 1, 0);
          stateInst.workRam[slotOff + off + k] = 0;
        }
      }
    }

    // Setup arg slot fields.
    pokeMem(cpu, argPtr + 0x57, 1, counterPre);
    stateInst.workRam[argOff + 0x57] = counterPre;

    pokeMem(cpu, argPtr + 0x58, 1, selectorByte);
    stateInst.workRam[argOff + 0x58] = selectorByte;

    // (A0+0x1E).l = coords (big-endian).
    for (let k = 0; k < 4; k++) {
      const b = (coordsLong >>> ((3 - k) * 8)) & 0xff;
      pokeMem(cpu, argPtr + 0x1e + k, 1, b);
      stateInst.workRam[argOff + 0x1e + k] = b;
    }

    // Setup A1 fields (A1 = slotPtrs[selectorByte] se selectorByte < 25).
    // Setup random A1+0x4E (long) e A1+0x1F (byte). Con selectorByte ∈ [0..24]
    // garantiamo che A1 sia un slot canonico (in work RAM).
    const a1Idx = selectorByte; // < 25 by construction
    if (a1Idx < SLOT_COUNT) {
      const a1Slot = slotPtrs[a1Idx]!;
      const a1SlotOff = a1Slot - 0x400000;
      const a1CoordsLong = Math.floor(rng() * 0x100000000) >>> 0;
      // A1 può essere == argPtr (se selectorByte == argSlotIdx). In tal caso
      // i field 0x4e/0x1f sopra azzerati saranno comunque sovrascritti adesso.
      for (let k = 0; k < 4; k++) {
        const b = (a1CoordsLong >>> ((3 - k) * 8)) & 0xff;
        pokeMem(cpu, a1Slot + 0x4e + k, 1, b);
        stateInst.workRam[a1SlotOff + 0x4e + k] = b;
      }
      // 50% chance di mettere 0xD per esercitare il branch "subtract".
      const kind1F = rng() < 0.5 ? 0x0d : Math.floor(rng() * 256) & 0xff;
      pokeMem(cpu, a1Slot + 0x1f, 1, kind1F);
      stateInst.workRam[a1SlotOff + 0x1f] = kind1F;
    }

    // ── RUN ─────────────────────────────────────────────────────────
    const r = callFunction(cpu, FUN_13D38, [argPtr]);
    const binD0 = r.d0 >>> 0;

    const tsD0 = ssp13D38Ns.slotSpawnPattern13D38(stateInst, tsRom, argPtr) >>> 0;

    // ── COMPARE ─────────────────────────────────────────────────────
    let match = true;
    let diffField: string | undefined;
    let binVal: number | undefined;
    let tsVal: number | undefined;

    // Confronta solo low byte di D0 (il binario fa neg.b, high opaqua).
    if ((binD0 & 0xff) !== (tsD0 & 0xff)) {
      match = false;
      diffField = "D0.b";
      binVal = binD0 & 0xff;
      tsVal = tsD0 & 0xff;
    }

    if (match) {
      const bin57 = peekMem(cpu, argPtr + 0x57, 1) & 0xff;
      const ts57 = stateInst.workRam[argOff + 0x57] ?? 0;
      if (bin57 !== ts57) {
        match = false;
        diffField = "+0x57";
        binVal = bin57;
        tsVal = ts57;
      }
    }

    if (match) {
      const bin1c = peekMem(cpu, argPtr + 0x1c, 1) & 0xff;
      const ts1c = stateInst.workRam[argOff + 0x1c] ?? 0;
      if (bin1c !== ts1c) {
        match = false;
        diffField = "+0x1C";
        binVal = bin1c;
        tsVal = ts1c;
      }
    }

    // Confronta i 24 byte di entrambe le metà.
    if (match) {
      for (const baseOff of [0x38, 0xa4]) {
        if (!match) break;
        for (let k = 0; k < 24; k++) {
          const offMem = argPtr + baseOff + k;
          const offRam = argOff + baseOff + k;
          const binV = peekMem(cpu, offMem, 1) & 0xff;
          const tsV = stateInst.workRam[offRam] ?? 0;
          if (binV !== tsV) {
            match = false;
            diffField = `+0x${(baseOff + k).toString(16).toUpperCase()}`;
            binVal = binV;
            tsVal = tsV;
            break;
          }
        }
      }
    }

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        argPtr,
        counterPre,
        selector: selectorByte,
        binD0,
        tsD0,
        diffField,
        binVal,
        tsVal,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    argPtr=0x${firstFail.argPtr.toString(16)} counterPre=0x${firstFail.counterPre.toString(16)} selector=0x${firstFail.selector.toString(16)}`,
    );
    console.log(
      `    binD0=0x${firstFail.binD0.toString(16)} tsD0=0x${firstFail.tsD0.toString(16)}`,
    );
    if (firstFail.diffField !== undefined) {
      console.log(
        `    diff ${firstFail.diffField}: bin=0x${(firstFail.binVal ?? 0).toString(16)} ts=0x${(firstFail.tsVal ?? 0).toString(16)}`,
      );
    }
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
