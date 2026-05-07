#!/usr/bin/env node
/**
 * test-string-dispatch-table-177f8-parity.ts —
 * differential FUN_177F8 vs `stringDispatchTable177F8`.
 *
 * `FUN_000177F8` (316 byte) è una sub di "lookup multi-tabella" con 3 word
 * args (passati come long sullo stack). Read-only: legge ROM, workRam,
 * PF/sprite/alpha RAM (0xA00000..0xA04000). Ritorna un word in `D0.w`.
 *
 * **Strategia**: la sub è **pure** (read-only — non scrive memoria), quindi
 * il differential testing si limita a confrontare il valore di ritorno
 * `D0 & 0xFFFF`. Pre-popoliamo workRam + PF RAM con pattern deterministici
 * + random, e per ogni caso eseguiamo:
 *   1. Side binary: `callFunction(cpu, 0x177F8, [arg0L, arg1L, arg2L])` →
 *      cattura `r.d0 & 0xFFFF`.
 *   2. Side TS: snapshot di workRam → `state.workRam`; snapshot di PF RAM
 *      [0xA00000..0xA04000] → `pfRam: Uint8Array(0x4000)`. Chiama
 *      `stringDispatchTable177F8(state, rom, pfRam, arg0w, arg1w, arg2w)`.
 *   3. Compara D0.w.
 *
 * **Suite testate (5 × 100 = 500 casi)**:
 *   - A: bound-exit forzato (D2.w >= bound).
 *   - B: top4 = 0 + bit11 = 0 (no_bit11 path), con tabelle valide e PF RAM
 *        deterministica → percorso completo del case_no_bit11.
 *   - C: top4 != 0 + mask hit (top4_short path).
 *   - D: top4 != 0 + mask miss (top4_search → bias lookup).
 *   - E: random everything (mix di tutti i path, incluso byte_zero / fff_zero
 *        / bias_sentinel / bit11_set re-loop).
 *
 * Compariamo solo `D0 & 0xFFFF` perché:
 *   - La sub non scrive memoria (verificato dal disasm — nessun `move.X` con
 *     destinatario in memory address).
 *   - Le high 16 bits di D0 dipendono dal D0 del caller pre-call (la sub
 *     usa solo `move.w` e `move.b` su D0). La nostra TS-replica restituisce
 *     un word; la D0.high del binario è "sporcata" dal sentinel return push
 *     di `callFunction` ma solo nei bit hi.
 *
 * Uso: npx tsx packages/cli/src/test-string-dispatch-table-177f8-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  stringDispatchTable177F8 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_177F8 = 0x000177f8;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
const PFRAM_BASE = 0x00a00000;
const PFRAM_SIZE = 0x4000;

// Workram addresses lette dalla sub (per setup).
const WR_LEVEL_HEADER_PTR = 0x00400474;
const WR_BIAS_Y_LONG = 0x00400988;
const WR_BIAS_X_WORD = 0x0040098a;
const WR_STRING_TABLE_PTR = 0x0040065a;

// ─── RNG deterministico ─────────────────────────────────────────────────────
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

// ─── Memory I/O helpers (sync binario + TS) ────────────────────────────────

/** Carica un buffer in workRam (CPU). */
function loadWorkRam(cpu: CpuSession, src: Uint8Array): void {
  for (let i = 0; i < WORK_RAM_SIZE; i++) {
    pokeMem(cpu, WORK_RAM_BASE + i, 1, src[i] ?? 0);
  }
}

/** Carica un buffer in PF/sprite/alpha RAM (CPU). */
function loadPfRam(cpu: CpuSession, src: Uint8Array): void {
  for (let i = 0; i < PFRAM_SIZE; i++) {
    pokeMem(cpu, PFRAM_BASE + i, 1, src[i] ?? 0);
  }
}

// ─── Setup case ────────────────────────────────────────────────────────────

interface CaseSetup {
  arg0w: number; // 0..0xFFFF
  arg1w: number; // 0..0xFFFF
  arg2w: number; // 0..0xFFFF
  /** Pre-fill workRam (8 KB). */
  workRam: Uint8Array;
  /** Pre-fill PF/sprite/alpha RAM (16 KB). */
  pfRam: Uint8Array;
}

function setLongBE(buf: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  buf[off] = (u >>> 24) & 0xff;
  buf[off + 1] = (u >>> 16) & 0xff;
  buf[off + 2] = (u >>> 8) & 0xff;
  buf[off + 3] = u & 0xff;
}
function setWordBE(buf: Uint8Array, off: number, v: number): void {
  const u = v & 0xffff;
  buf[off] = (u >>> 8) & 0xff;
  buf[off + 1] = u & 0xff;
}

/**
 * Costruisce un setup "base" comune: workRam pseudo-random + PF RAM
 * pseudo-random + level header @ 0x401000 con bound generoso, string-table
 * @ 0x401200 (nel workRam), base-offset table @ 0x400478 sane.
 */
function buildBaseFill(rngSeed: number, args: {
  arg0w: number;
  arg1w: number;
  arg2w: number;
  bound: number;
}): CaseSetup {
  const rng = makeRng(rngSeed);
  const wr = new Uint8Array(WORK_RAM_SIZE);
  const pf = new Uint8Array(PFRAM_SIZE);
  // Random fill
  for (let i = 0; i < WORK_RAM_SIZE; i++) wr[i] = Math.floor(rng() * 256) & 0xff;
  for (let i = 0; i < PFRAM_SIZE; i++) pf[i] = Math.floor(rng() * 256) & 0xff;

  // Level header ptr -> 0x401000 (within workRam)
  setLongBE(wr, WR_LEVEL_HEADER_PTR - WORK_RAM_BASE, 0x401000);
  // bound @ levelHeader + 0x18 (= workRam off 0x1018)
  setWordBE(wr, 0x1000 + 0x18, args.bound & 0xffff);
  // (A0).l = long @ 0x401000 — diamo un valore "safe" che fa cadere A1 in PF RAM
  // A0_deref ∈ [0xa00000..0xa04000) per il path no_bit11. Il D0_sext aggiunto
  // può essere in [0..0x7ff] (positive). Settiamo A0_deref = 0xa00800 →
  // A1 ∈ [0xa00800..0xa00fff], dentro PF RAM.
  setLongBE(wr, 0x1000, 0xa00800);

  // string-table ptr @ 0x40065a -> 0x401200 (workRam)
  setLongBE(wr, WR_STRING_TABLE_PTR - WORK_RAM_BASE, 0x401200);

  // bias-Y long @ 0x400988 -> 0 (semplifichiamo: bias_y = 0)
  setLongBE(wr, WR_BIAS_Y_LONG - WORK_RAM_BASE, 0);
  // bias-X word @ 0x40098a (overlap col long; setLong già zerato → setWord = 0)
  setWordBE(wr, WR_BIAS_X_WORD - WORK_RAM_BASE, 0);

  return {
    arg0w: args.arg0w & 0xffff,
    arg1w: args.arg1w & 0xffff,
    arg2w: args.arg2w & 0xffff,
    workRam: wr,
    pfRam: pf,
  };
}

// ─── Run case ──────────────────────────────────────────────────────────────

interface CompareResult {
  ok: boolean;
  binD0w: number;
  tsD0w: number;
}

async function runCase(
  cpu: CpuSession,
  state: ReturnType<typeof stateNs.emptyGameState>,
  rom: ReturnType<typeof busNs.emptyRomImage>,
  setup: CaseSetup,
): Promise<CompareResult> {
  // ── Side binary ─────────────────────────────────────────────────────────
  cpu.system.setRegister("sp", 0x401f00);
  loadWorkRam(cpu, setup.workRam);
  loadPfRam(cpu, setup.pfRam);
  // 3 long args, pushed RTL by callFunction. Solo low word di ciascuno è
  // letto dalla sub. Mettiamo high word = 0 per chiarezza.
  const arg0L = setup.arg0w & 0xffff;
  const arg1L = setup.arg1w & 0xffff;
  const arg2L = setup.arg2w & 0xffff;
  const r = callFunction(cpu, FUN_177F8, [arg0L, arg1L, arg2L]);
  const binD0w = r.d0 & 0xffff;

  // ── Side TS ─────────────────────────────────────────────────────────────
  state.workRam.set(setup.workRam);
  // Costruiamo un pfRam separato per TS (snapshot pre-call).
  const tsPfRam = new Uint8Array(setup.pfRam);
  const tsD0w =
    ns.stringDispatchTable177F8(
      state,
      rom,
      tsPfRam,
      setup.arg0w,
      setup.arg1w,
      setup.arg2w,
    ) & 0xffff;

  return {
    ok: binD0w === tsD0w,
    binD0w,
    tsD0w,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 5);
  const remainder = total - perSuite * 5;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBytes = readFileSync(romPath);

  // Per la TS-side: costruiamo un RomImage che usa il blob letto.
  const rom = busNs.emptyRomImage();
  // Copia in rom.program (max 0x88000 byte).
  const copyLen = Math.min(rom.program.length, romBytes.length);
  for (let i = 0; i < copyLen; i++) rom.program[i] = romBytes[i] ?? 0;

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state });

  console.log(`\n=== stringDispatchTable177F8 (FUN_177F8) — ${total} casi ===`);

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    args: { arg0w: number; arg1w: number; arg2w: number };
    binD0w: number;
    tsD0w: number;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  async function runOneCase(
    suite: string,
    tc: number,
    setup: CaseSetup,
  ): Promise<boolean> {
    const r = await runCase(cpu, state, rom, setup);
    if (r.ok) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        args: {
          arg0w: setup.arg0w,
          arg1w: setup.arg1w,
          arg2w: setup.arg2w,
        },
        binD0w: r.binD0w,
        tsD0w: r.tsD0w,
      };
    }
    return false;
  }

  const rng = makeRng(0x177f8a17);
  const ri = (max: number): number => Math.floor(rng() * max);

  // ── Suite A: bound-exit ────────────────────────────────────────────────
  console.log(`\n  Suite A (bound-exit, D2.w >= bound) — ${perSuite} casi`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const bound = 1 + ri(50); // bound piccolo
    const arg0w = bound + ri(0x1000); // arg0 ≥ bound (signed)
    const setup = buildBaseFill(0x10000 + i, {
      arg0w,
      arg1w: ri(0x10000),
      arg2w: ri(0x10000),
      bound,
    });
    if (await runOneCase("A", i, setup)) okA++;
  }
  console.log(`    Match: ${okA}/${perSuite}`);
  totalOk += okA;

  // ── Suite B: no_bit11 path (top4 = 0, bit 11 = 0) ──────────────────────
  // Vincoli per avere reads "validi" (= dentro PF RAM 0xa00000..0xa04000):
  //   - D3.l = sext(arg2w) + globalLong988. Vogliamo D3.l piccolo (0..0xF).
  //     Con globalLong988=0 e arg2w piccolo (positive 0..0xF) → D3.l = arg2w.
  //   - D3.l * 8 ∈ [0..0x78] → A2 = 0x2417e + 0..0x78, dentro ROM entry table.
  //   - A0_deref = 0xa00800 (in PF RAM); D0_sext ∈ [0x40..0x7ff] → A1 ∈
  //     [0xa00840..0xa00fff], dentro PF RAM.
  //   - offset0/offset4 dalla ROM sono piccoli (0..0x12121200 ma noi guardiamo
  //     solo le entries 0..15 = 0..0xF). Comunque A3 = A1 + offset0 e A1 += offset4.
  //     Con offset0 ∈ {0..3, 0x12120300...}, andiamo in posti diversi. Ma in
  //     pratica per le entries 0..7 le offset sono 0..3 (vedi rom dump @ 0x2417e),
  //     quindi A3 = A1 + 0..3 rimane in PF RAM. Per essere safe limitiamo
  //     arg2w ∈ [0..7].
  //   - shift_byte e tbl1 word: D1_post può essere fino a 0x34, A1 += → ancora
  //     in PF RAM se A1_pre ≥ 0xa00000.
  console.log(`\n  Suite B (no_bit11 path) — ${perSuite} casi`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const bound = 100;
    const arg0w = ri(50);
    // arg2w in [0..7]: D3.l = 0..7, asl.l #3 = 0..0x38, A2 = 0x2417e..0x241b6.
    const arg2w = ri(8);
    // arg1w controllato: vogliamo D0_init in [0x40..0x100] (positivo, piccolo)
    // così D0.w come index in 0x1ed0a + 0x80 è dentro la table, e D0_sext finale
    // (post-A2-lookup) può essere in range.
    const arg1w = ri(0x80) * 2;
    const setup = buildBaseFill(0x20000 + i, {
      arg0w,
      arg1w,
      arg2w,
      bound,
    });
    // Forziamo D0 lookup @ A2: a `0x401200 + qualcosa` → vogliamo top4=0,
    // bit11=0, fff in [0x40..0x7ff].
    // Need to fill the entire potential range (D1.w masked ∈ [0..0x7fe]).
    for (let j = 0; j < 0x400; j++) {
      const v = (0x40 + ri(0x7c0)) & 0xfff;
      setWordBE(setup.workRam, 0x200 + j * 2, v);
    }
    if (await runOneCase("B", i, setup)) okB++;
  }
  console.log(`    Match: ${okB}/${perSuite}`);
  totalOk += okB;

  // ── Suite C: top4 != 0, mask hit (top4_short) ──────────────────────────
  // top4_short non rilegge PF RAM (solo workRam @ 0x400478 + 2*arg0w e
  // ROM @ 0x24176 + D3.w*2). Vincoli:
  //   - D3.w*2 ∈ [0..6] per cadere dentro la 4-word mask table @ 0x24176
  //     (0x24176..0x2417d). Con globalLong988=0 e arg2w ∈ [0..3], D3.w =
  //     arg2w, D3.w*2 ∈ [0..6]. ✓
  console.log(`\n  Suite C (top4_short path) — ${perSuite} casi`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const bound = 100;
    const arg0w = ri(50);
    const arg2w = ri(4); // D3.w*2 ∈ [0..6]
    const arg1w = ri(0x80) * 2;
    const setup = buildBaseFill(0x30000 + i, {
      arg0w,
      arg1w,
      arg2w,
      bound,
    });
    // string-table area (full 0x800 bytes): word con top4 != 0 (0x1000..0xF000).
    // L'index può essere fino a 0x7fe → fill 0x400 word.
    for (let j = 0; j < 0x400; j++) {
      const top4 = ((1 + ri(15)) << 12) & 0xf000;
      const lo = ri(0x1000);
      setWordBE(setup.workRam, 0x200 + j * 2, top4 | lo);
    }
    if (await runOneCase("C", i, setup)) okC++;
  }
  console.log(`    Match: ${okC}/${perSuite}`);
  totalOk += okC;

  // ── Suite D: top4 != 0 con mix di hit/miss → top4_short / top4_search ──
  console.log(`\n  Suite D (top4 mixed path) — ${perSuite} casi`);
  let okD = 0;
  for (let i = 0; i < perSuite; i++) {
    const bound = 100;
    const arg0w = ri(50);
    const arg2w = ri(4);
    const arg1w = ri(0x80) * 2;
    const setup = buildBaseFill(0x40000 + i, {
      arg0w,
      arg1w,
      arg2w,
      bound,
    });
    // Random top4 + low bits → varietà di paths. Bit 11 del fff può anche
    // attivare bit11_set re-loop (ma il indirect table @ 0x40076e è random
    // e generalmente non genera infinite loops).
    for (let j = 0; j < 0x400; j++) {
      const top4 = (ri(16) << 12) & 0xf000;
      const lo = ri(0x1000);
      setWordBE(setup.workRam, 0x200 + j * 2, top4 | lo);
    }
    if (await runOneCase("D", i, setup)) okD++;
  }
  console.log(`    Match: ${okD}/${perSuite}`);
  totalOk += okD;

  // ── Suite E: random everything con vincoli "safe" ──────────────────────
  // Random arg0w/arg1w/arg2w ma con D3.l ridotto (arg2w piccolo + bias_y=0)
  // per evitare reads da memory unmapped.
  const sizeE = perSuite + remainder;
  console.log(`\n  Suite E (random + safe ranges) — ${sizeE} casi`);
  let okE = 0;
  for (let i = 0; i < sizeE; i++) {
    const bound = 1 + ri(120);
    const arg0w = ri(0x80); // 0..127
    const arg2w = ri(8);
    const arg1w = ri(0x10000);
    const setup = buildBaseFill(0x50000 + i, {
      arg0w,
      arg1w,
      arg2w,
      bound,
    });
    if (await runOneCase("E", i, setup)) okE++;
  }
  console.log(`    Match: ${okE}/${sizeE}`);
  totalOk += okE;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): ` +
        `arg0w=0x${f.args.arg0w.toString(16)} ` +
        `arg1w=0x${f.args.arg1w.toString(16)} ` +
        `arg2w=0x${f.args.arg2w.toString(16)} ` +
        `binD0w=0x${f.binD0w.toString(16)} tsD0w=0x${f.tsD0w.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
