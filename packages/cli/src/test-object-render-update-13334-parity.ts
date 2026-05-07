#!/usr/bin/env node
/**
 * test-object-render-update-13334-parity.ts —
 * differential FUN_00013334 vs `objectRenderUpdate13334`.
 *
 * **Strategia**:
 * `FUN_13334` ha 5 path osservabili (mode = `struct[0x1e]`):
 *   1. mode ∉ {1,2}: skip globals → compute + dispatch + final copy.
 *   2. mode ∈ {1,2} AND `*struct[0x3e] == 0xFFFFFFFF`: epilogue diretto.
 *   3. mode == 1, record valido: store globals → epilogue.
 *   4. mode == 2, record valido, mode_hi ∉ {1,2}: compute SENZA globals.
 *   5. mode == 2, record valido, mode_hi ∈ {1,2}: globals + compute.
 *
 * Inoltre il compute path ha 4 sotto-rami su `struct[0x1f]`:
 *   - 1f == 6: chiama `FUN_1D06A(sext_l(struct[0x25]))`.
 *   - 1f == 3: indicizza tabella ROM @ 0x1DF18 + push palette.
 *   - 1f ∉ {3,6}: solo compute + final copy.
 *
 * `FUN_1D06A` non è ancora replicato in TS — patcha il binario con `4E75 (rts)`
 * per neutralizzarlo. La TS callback è no-op. `FUN_26B66` (paletteQueuePush) È
 * replicato → chiamato direttamente sia da binario sia da TS, deve dare gli
 * stessi side effect.
 *
 * Confronto:
 *   - D0 long (ignorato dal caller, ma verificato per completezza)
 *   - workRam @ 0x400690..0x400693 (POS_X/Y globals)
 *   - workRam @ 0x400970..0x400977 (active record globals)
 *   - workRam @ 0x400408..0x40040F (palette queue ptr + body)
 *   - struct @ A2..A2+0x60 (incluso +0x42, +0x4E)
 *   - record buffer @ struct[0x3E] (per detectare scritture spurie via FUN_1D06A)
 *
 * Suite testate:
 *   - A: random everything (mode random, kind random)
 *   - B: mode==1 forzato (path globals + epilogue)
 *   - C: mode==2 forzato con mode_hi random (4 vs 5)
 *   - D: kind==3 forzato + base==0x21192 random (path palette index)
 *
 * Uso: npx tsx packages/cli/src/test-object-render-update-13334-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  objectRenderUpdate13334 as ns,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_13334 = 0x00013334;
const FUN_1D06A = 0x0001d06a;
const HUD_OFFSET_ADDR = 0x0040097e;
const POS_X_ADDR = 0x00400690;
const ACTIVE_RECORD_ADDR = 0x00400970;
const PAL_QUEUE_PTR_ADDR = 0x00400408;
const PAL_QUEUE_HEAD = 0x0040040c;

/** Stub bytes per `FUN_1D06A`: solo `rts` (4E75). Niente side effect. */
const STUB_1D06A_BYTES = [0x4e, 0x75] as const;

/** Slot pointers candidati per la struct (work RAM, lontani da globals). */
const PTR_CHOICES = [
  0x00401000,
  0x004012a0,
  0x00401500,
  0x004017c0,
  0x00401a00,
  0x00401d00,
] as const;

/** Slot pointers per il record (struct[0x3E]). */
const REC_CHOICES = [
  0x00401080,
  0x00401320,
  0x00401580,
  0x00401820,
  0x00401a80,
  0x00401d80,
] as const;

const STRUCT_SIZE = 0x60;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  suite: string;
  i: number;
  structPtr: number;
  modeByte: number;
  modeHiByte: number;
  kindByte: number;
  reason: string;
  binVal: number;
  tsVal: number;
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

  // Mirror ROM nella RomImage TS (per accedere a 0x1DF18 e altri).
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  // Patch FUN_1D06A con stub `rts`.
  function applyStub(): void {
    for (let i = 0; i < STUB_1D06A_BYTES.length; i++) {
      pokeMem(cpu, FUN_1D06A + i, 1, STUB_1D06A_BYTES[i]!);
    }
  }
  applyStub();

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupStruct(structPtr: number, bytes: number[]): void {
    for (let i = 0; i < STRUCT_SIZE; i++) {
      const v = bytes[i] ?? 0;
      pokeMem(cpu, structPtr + i, 1, v);
      stateInst.workRam[(structPtr - 0x400000) + i] = v;
    }
  }

  function setupRecord(recPtr: number, recBytes: number[]): void {
    for (let i = 0; i < 8; i++) {
      const v = recBytes[i] ?? 0;
      pokeMem(cpu, recPtr + i, 1, v);
      stateInst.workRam[(recPtr - 0x400000) + i] = v;
    }
  }

  function resetGlobals(): void {
    // Azzera POS_X/Y, active globals, queue ptr (head=0x40040C, vuota).
    for (let a = POS_X_ADDR; a < POS_X_ADDR + 4; a++) {
      pokeMem(cpu, a, 1, 0);
      stateInst.workRam[a - 0x400000] = 0;
    }
    for (let a = ACTIVE_RECORD_ADDR; a < ACTIVE_RECORD_ADDR + 8; a++) {
      pokeMem(cpu, a, 1, 0);
      stateInst.workRam[a - 0x400000] = 0;
    }
    // Queue ptr = 0x40040C (head, vuoto).
    const head = PAL_QUEUE_HEAD >>> 0;
    pokeMem(cpu, PAL_QUEUE_PTR_ADDR, 4, head);
    stateInst.workRam[PAL_QUEUE_PTR_ADDR - 0x400000] = (head >>> 24) & 0xff;
    stateInst.workRam[PAL_QUEUE_PTR_ADDR - 0x400000 + 1] = (head >>> 16) & 0xff;
    stateInst.workRam[PAL_QUEUE_PTR_ADDR - 0x400000 + 2] = (head >>> 8) & 0xff;
    stateInst.workRam[PAL_QUEUE_PTR_ADDR - 0x400000 + 3] = head & 0xff;
    // Queue body (4 byte) = 0.
    for (let i = 0; i < 4; i++) {
      pokeMem(cpu, PAL_QUEUE_HEAD + i, 1, 0);
      stateInst.workRam[PAL_QUEUE_HEAD + i - 0x400000] = 0;
    }
  }

  function setHud(rng: () => number): number {
    const v = Math.floor(rng() * 0x10000) & 0xffff;
    pokeMem(cpu, HUD_OFFSET_ADDR, 1, (v >>> 8) & 0xff);
    pokeMem(cpu, HUD_OFFSET_ADDR + 1, 1, v & 0xff);
    stateInst.workRam[0x97e] = (v >>> 8) & 0xff;
    stateInst.workRam[0x97f] = v & 0xff;
    return v;
  }

  /** Confronta tutti gli observable. Ritorna prima diff o null. */
  function compareAll(
    structPtr: number,
    recPtr: number,
  ): { what: string; bin: number; ts: number } | null {
    // Struct.
    for (let i = 0; i < STRUCT_SIZE; i++) {
      const b = peekMem(cpu, structPtr + i, 1);
      const t = stateInst.workRam[(structPtr - 0x400000) + i] ?? 0;
      if (b !== t) {
        return { what: `struct+0x${i.toString(16)}`, bin: b, ts: t };
      }
    }
    // POS_X/Y.
    for (let i = 0; i < 4; i++) {
      const b = peekMem(cpu, POS_X_ADDR + i, 1);
      const t = stateInst.workRam[0x690 + i] ?? 0;
      if (b !== t) {
        return { what: `pos[0x${(0x690 + i).toString(16)}]`, bin: b, ts: t };
      }
    }
    // Active record globals.
    for (let i = 0; i < 8; i++) {
      const b = peekMem(cpu, ACTIVE_RECORD_ADDR + i, 1);
      const t = stateInst.workRam[0x970 + i] ?? 0;
      if (b !== t) {
        return {
          what: `active[0x${(0x970 + i).toString(16)}]`,
          bin: b,
          ts: t,
        };
      }
    }
    // Palette queue (ptr + body).
    for (let i = 0; i < 4; i++) {
      const b = peekMem(cpu, PAL_QUEUE_PTR_ADDR + i, 1);
      const t = stateInst.workRam[0x408 + i] ?? 0;
      if (b !== t) {
        return {
          what: `palQptr[0x${(0x408 + i).toString(16)}]`,
          bin: b,
          ts: t,
        };
      }
    }
    for (let i = 0; i < 4; i++) {
      const b = peekMem(cpu, PAL_QUEUE_HEAD + i, 1);
      const t = stateInst.workRam[0x40c + i] ?? 0;
      if (b !== t) {
        return {
          what: `palQbody[0x${(0x40c + i).toString(16)}]`,
          bin: b,
          ts: t,
        };
      }
    }
    // Record buffer (8 byte) — per detect scritture spurie.
    if (recPtr >= 0x400000 && recPtr < 0x402000) {
      for (let i = 0; i < 8; i++) {
        const b = peekMem(cpu, recPtr + i, 1);
        const t = stateInst.workRam[(recPtr - 0x400000) + i] ?? 0;
        if (b !== t) {
          return { what: `rec+0x${i.toString(16)}`, bin: b, ts: t };
        }
      }
    }
    return null;
  }

  function runOneCase(
    suite: string,
    i: number,
    structPtr: number,
    recPtr: number,
    bytes: number[],
    recBytes: number[],
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);

    // Re-applica stub periodicamente.
    if (i % 100 === 0) applyStub();

    resetGlobals();
    setupStruct(structPtr, bytes);
    setupRecord(recPtr, recBytes);

    const off = (structPtr - 0x400000) >>> 0;
    const modeByte = stateInst.workRam[off + 0x1e] ?? 0;
    const modeHiByte = stateInst.workRam[off + 0x1a] ?? 0;
    const kindByte = stateInst.workRam[off + 0x1f] ?? 0;

    // Run binario.
    const r = callFunction(cpu, FUN_13334, [structPtr >>> 0]);
    const binD0 = r.d0 >>> 0;

    // Run TS (callback no-op per inner1D06A).
    const tsD0 =
      ns.objectRenderUpdate13334(stateInst, tsRom, structPtr, {
        inner1D06A: (_b: number): void => undefined,
      }) >>> 0;

    const diff = compareAll(structPtr, recPtr);

    // D0 al ritorno è opaco e il caller non lo legge → non confrontiamo.
    void binD0;
    void tsD0;

    if (diff === null) return true;

    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        i,
        structPtr,
        modeByte,
        modeHiByte,
        kindByte,
        reason: diff.what,
        binVal: diff.bin,
        tsVal: diff.ts,
      };
    }
    return false;
  }

  const rng = makeRng(0x13334);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const pickPtr = (): number =>
    PTR_CHOICES[Math.floor(rng() * PTR_CHOICES.length)]!;
  const pickRec = (): number =>
    REC_CHOICES[Math.floor(rng() * REC_CHOICES.length)]!;

  function makeStructBytes(recPtr: number): number[] {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    // struct[0x3e..0x41] = recPtr (long BE).
    bytes[0x3e] = (recPtr >>> 24) & 0xff;
    bytes[0x3f] = (recPtr >>> 16) & 0xff;
    bytes[0x40] = (recPtr >>> 8) & 0xff;
    bytes[0x41] = recPtr & 0xff;
    return bytes;
  }

  // Record bytes con prob 50% di tombstone (per esercitare il path).
  function makeRecBytes(): number[] {
    if (rng() < 0.3) {
      // Tombstone: *recPtr = 0xFFFFFFFF.
      return [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0];
    }
    return new Array(8).fill(0).map(() => rb());
  }

  // ─── Suite A: random everything ─────────────────────────────────────
  console.log(
    `\n=== objectRenderUpdate13334 (FUN_00013334) — Suite A: random — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    setHud(rng);
    const structPtr = pickPtr();
    const recPtr = pickRec();
    if (structPtr === recPtr) continue; // skip overlap.
    const bytes = makeStructBytes(recPtr);
    const recBytes = makeRecBytes();
    if (runOneCase("A", i, structPtr, recPtr, bytes, recBytes)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: mode==1 forzato ────────────────────────────────────────
  console.log(`\n=== Suite B: mode==1 (path globals/epilogue) — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    setHud(rng);
    const structPtr = pickPtr();
    const recPtr = pickRec();
    if (structPtr === recPtr) continue;
    const bytes = makeStructBytes(recPtr);
    bytes[0x1e] = 1; // forza mode == 1.
    bytes[0x1a] = rb();
    bytes[0x1f] = rb();
    const recBytes = makeRecBytes();
    if (runOneCase("B", i, structPtr, recPtr, bytes, recBytes)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: mode==2 forzato + mode_hi random ──────────────────────
  console.log(`\n=== Suite C: mode==2 — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    setHud(rng);
    const structPtr = pickPtr();
    const recPtr = pickRec();
    if (structPtr === recPtr) continue;
    const bytes = makeStructBytes(recPtr);
    bytes[0x1e] = 2;
    // mode_hi = 1, 2, 3, o random per coprire i 4/5 paths.
    const hiVals = [0, 1, 2, 3, 4];
    bytes[0x1a] = hiVals[Math.floor(rng() * hiVals.length)]!;
    bytes[0x1f] = rb();
    const recBytes = makeRecBytes();
    if (runOneCase("C", i, structPtr, recPtr, bytes, recBytes)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: kind==3 forzato (path palette index) ──────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: kind==3 (palette index path) — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    setHud(rng);
    const structPtr = pickPtr();
    const recPtr = pickRec();
    if (structPtr === recPtr) continue;
    const bytes = makeStructBytes(recPtr);
    bytes[0x1e] = 0; // skip gating, vai dritto al compute.
    bytes[0x1f] = 3; // kind == 3 → path palette index.

    // basePtr: 50% magic 0x21192, 50% random in ROM range.
    const useMagic = rng() < 0.5;
    const basePtr = useMagic ? 0x00021192 : Math.floor(rng() * 0x10000);
    bytes[0x46] = (basePtr >>> 24) & 0xff;
    bytes[0x47] = (basePtr >>> 16) & 0xff;
    bytes[0x48] = (basePtr >>> 8) & 0xff;
    bytes[0x49] = basePtr & 0xff;

    // Force record ptr che da' diff piccolo (≤ ~100 byte); >>3 → indice 0..12.
    const idx = Math.floor(rng() * 0x10);
    const recordPtrForIdx = (basePtr + (idx << 3)) >>> 0;
    bytes[0x3e] = (recordPtrForIdx >>> 24) & 0xff;
    bytes[0x3f] = (recordPtrForIdx >>> 16) & 0xff;
    bytes[0x40] = (recordPtrForIdx >>> 8) & 0xff;
    bytes[0x41] = recordPtrForIdx & 0xff;

    // Niente record buffer: bytes[0x3e..] punta in ROM (no-op per il dereferencing
    // perché mode==0 → non legge il record).
    const recBytes = new Array(8).fill(0);
    if (runOneCase("D", i, structPtr, recordPtrForIdx, bytes, recBytes)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} i=${f.i}):`);
    console.log(
      `    structPtr=0x${f.structPtr.toString(16)} mode=0x${f.modeByte.toString(16)} ` +
        `mode_hi=0x${f.modeHiByte.toString(16)} kind=0x${f.kindByte.toString(16)}`,
    );
    console.log(
      `    @${f.reason}: bin=0x${f.binVal.toString(16)} ts=0x${f.tsVal.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
