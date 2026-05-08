#!/usr/bin/env node
/**
 * test-refresh-frame-10fce-parity.ts — differential FUN_10FCE vs refreshFrame10FCE.
 *
 * FUN_10FCE è l'idle/refresh frame handler. È un orchestratore che chiama 12
 * JSR in sequenza + 2× addq.b sul frame-counter @ 0x4003F0.
 *
 * **Strategia**: patchiamo le 3 JSR non ancora replicate (FUN_13EE6,
 * FUN_1912C) con `rts` puri nel binario, e usiamo stub TS no-op per le
 * stesse nel lato TS. Le restanti 9 JSR già replicate vengono patchate come
 * sentinel (`addq.b #1, (addr) ; rts`) nel binario e come callback
 * `incSentinel` nel lato TS, garantendo che l'ordine di chiamata e gli
 * effetti sul workRam siano identici.
 *
 * Confrontiamo tutta la workRam (0x400000..0x402000) dopo l'esecuzione.
 *
 * Uso: npx tsx packages/cli/src/test-refresh-frame-10fce-parity.ts [N]
 */

import { readFileSync } from "node:fs";
import { exit } from "node:process";

import {
  bus as busNs,
  state as stateNs,
  refreshFrame10FCE as rf10fceNs,
} from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";
import {
  findRomBlobPath,
  incSentinel,
  makeRng,
  patchStubAddq,
  patchRts,
  readRam,
  writeRam,
  type PatchableSub,
} from "./main-loop-init-parity-lib.js";

const FUN_10FCE = 0x00010fce;
const SENT_BASE = 0x00401d00;

/**
 * Subs patchati con sentinels (tutte ora replicate in TS).
 */
const SENTINEL_SUBS: PatchableSub[] = [
  { name: "fun13EE6",                entry: 0x00013ee6, sentinel: SENT_BASE + 0 },
  { name: "objectScanDispatch251DE", entry: 0x000251de, sentinel: SENT_BASE + 1 },
  { name: "processAllSprites189E2",  entry: 0x000189e2, sentinel: SENT_BASE + 2 },
  { name: "objectUpdatePair158CC",   entry: 0x000158cc, sentinel: SENT_BASE + 3 },
  { name: "slotArrayTick1493C",      entry: 0x0001493c, sentinel: SENT_BASE + 4 },
  { name: "dispatchStrings17230",    entry: 0x00017230, sentinel: SENT_BASE + 5 },
  { name: "fun1912C",                entry: 0x0001912c, sentinel: SENT_BASE + 6 },
  { name: "stateSub19BAA",           entry: 0x00019baa, sentinel: SENT_BASE + 7 },
  { name: "stateSub1844A",           entry: 0x0001844a, sentinel: SENT_BASE + 8 },
  { name: "stateDispatch12FD0",      entry: 0x00012fd0, sentinel: SENT_BASE + 9 },
  { name: "objDirtyDispatch28624",   entry: 0x00028624, sentinel: SENT_BASE + 10 },
];

/** No subs need plain rts patching — all 12 JSRs are now replicated. */
const RTS_SUBS: readonly number[] = [];

/** Regioni watched per il confronto: sentinels + frame-counter. */
const WATCHED = [
  ...SENTINEL_SUBS.map((s) => ({ name: s.name, addr: s.sentinel, size: 1 as const })),
  { name: "4003F0_frameCtr", addr: 0x004003f0, size: 1 as const },
];

function buildTsSubs(state: ReturnType<typeof stateNs.emptyGameState>): rf10fceNs.RefreshFrame10FCESubs {
  void state;
  return {
    fun13EE6:                (s) => { incSentinel(s.workRam, SENT_BASE + 0); void s; },
    objectScanDispatch251DE: (s) => { incSentinel(s.workRam, SENT_BASE + 1); void s; },
    processAllSprites189E2:  (s) => { incSentinel(s.workRam, SENT_BASE + 2); void s; },
    objectUpdatePair158CC:   (s) => { incSentinel(s.workRam, SENT_BASE + 3); void s; },
    slotArrayTick1493C:      (s) => { incSentinel(s.workRam, SENT_BASE + 4); void s; },
    dispatchStrings17230:    (s) => { incSentinel(s.workRam, SENT_BASE + 5); void s; },
    fun1912C:                (s) => { incSentinel(s.workRam, SENT_BASE + 6); void s; },
    stateSub19BAA:           (s) => { incSentinel(s.workRam, SENT_BASE + 7); void s; },
    stateSub1844A:           (s) => { incSentinel(s.workRam, SENT_BASE + 8); void s; },
    stateDispatch12FD0:      (s) => { incSentinel(s.workRam, SENT_BASE + 9); void s; },
    objDirtyDispatch28624:   (s) => { incSentinel(s.workRam, SENT_BASE + 10); void s; },
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBuf = Buffer.from(readFileSync(findRomBlobPath()));

  // Patch sentinel subs
  for (const sub of SENTINEL_SUBS) {
    patchStubAddq(romBuf, sub.entry, sub.sentinel);
  }
  // Patch not-yet-replicated subs with plain rts
  for (const entry of RTS_SUBS) {
    patchRts(romBuf, entry);
  }

  const romView = busNs.emptyRomImage();
  romView.program.set(romBuf);

  const rng = makeRng(0x10fce);
  let ok = 0;
  let firstFail: string | null = null;

  for (let i = 0; i < n; i++) {
    const state = stateNs.emptyGameState();
    const cpu = await createCpu({ rom: romBuf, state });
    cpu.system.setRegister("sp", 0x401f00);

    // Randomize watched fields
    for (const f of WATCHED) {
      const max = f.size === 1 ? 0x100 : f.size === 2 ? 0x10000 : 0x100000000;
      const value = Math.floor(rng() * max) >>> 0;
      pokeMem(cpu, f.addr, f.size, value);
      writeRam(state.workRam, f.addr, f.size, value);
    }

    // Seed a few game-state fields to exercise default paths
    const set = (addr: number, size: 1 | 2 | 4, value: number): void => {
      pokeMem(cpu, addr, size, value);
      writeRam(state.workRam, addr, size, value);
    };
    set(0x00400394, 2, i % 6);       // gameMode
    set(0x00400396, 2, (i % 2) + 1); // playerCount

    // Binary side
    callFunction(cpu, FUN_10FCE, [], 500_000);

    // TS side
    rf10fceNs.refreshFrame10FCE(state, romView, buildTsSubs(state));

    // Compare watched fields
    let caseOk = true;
    for (const f of WATCHED) {
      const b = peekMem(cpu, f.addr, f.size) >>> 0;
      const t = readRam(state.workRam, f.addr, f.size) >>> 0;
      if (b !== t) {
        firstFail ??= `case ${i} ${f.name}: bin=0x${b.toString(16)} ts=0x${t.toString(16)}`;
        caseOk = false;
        break;
      }
    }
    if (caseOk) ok++;
    disposeCpu(cpu);
  }

  console.log(`\n=== refreshFrame10FCE (FUN_10FCE) parity — ${ok}/${n} ===`);
  if (firstFail) console.log(`  First fail: ${firstFail}`);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
