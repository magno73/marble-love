#!/usr/bin/env node
/**
 * test-vblank-wait-parity.ts — differential FUN_000052B8 vs waitVblank.
 *
 * `FUN_000052B8` (34 byte) è una busy-wait di N vblank. Convenzione caller
 * (vista ad esempio @ 0x5D02..0x5D0C):
 *
 *   pea     (0xa).w        ; arg long (low word = count)
 *   jsr     0x000052b8.l   ; busy-wait
 *   addq.l  0x4,SP         ; pop arg
 *
 * Internamente:
 *   move.w  (0xa,SP),D0w
 *   bra     test
 * loop:
 *   move.l  (0x401FF8).l,D2
 *   inner: move.l (0x401FF8).l,D1; cmp D2,D1; beq inner
 *   subq.w  #1,D0w
 * test:  tst.w D0w; bgt loop
 *
 * Per evitare che il binario rimanga bloccato sul `0x401FF8` (counter che il
 * vero hardware incrementa nella IRQ vblank), registriamo un callback su
 * `onMemoryRead` che, ad ogni lettura di `0x401FF8`, scrive in memoria
 * `counter+1`. La lettura SUCCESSIVA vede il valore mutato → il `cmp + beq`
 * inner esce immediatamente. In media servono 2 letture per iterazione del
 * loop esterno.
 *
 * **Output confrontato**: D0w (low word di D0) e workRam unchanged.
 *
 * **Distribuzione**:
 *   - 50% count signed <= 0 (bgt non scatta, nessuna lettura del counter)
 *   - 50% count signed > 0 in [1..16] (loop esegue, counter injection attiva)
 *
 * Uso: npx tsx packages/cli/src/test-vblank-wait-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, vblankWait as vwNs } from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_VBLANK_WAIT = 0x000052b8;
const VBLANK_COUNTER_ADDR = 0x00401ff8;
const SENTINEL_RET = 0xcafebabe >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  bytes: Uint8Array;
}

function snapshotWorkRam(cpu: ReturnType<typeof createCpu> extends Promise<infer S> ? S : never): Snapshot {
  // Read entire work RAM 0x400000..0x401FFF (8 KB)
  const bytes = cpu.system.readBytes(0x400000, 0x2000);
  return { bytes };
}

function workRamDiffers(
  a: Uint8Array,
  b: Uint8Array,
  ignores: ReadonlyArray<readonly [off: number, len: number]>,
): number {
  for (let i = 0; i < a.length; i++) {
    let masked = false;
    for (const [off, len] of ignores) {
      if (i >= off && i < off + len) {
        masked = true;
        break;
      }
    }
    if (masked) continue;
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  // Hook reads to 0x401FF8: ogni lettura, incrementa il counter in memoria.
  // Così la lettura successiva vede il valore mutato e l'inner loop esce.
  // Usiamo writeRaw8 per bypassare callbacks/MMIO e scrivere direttamente
  // nella unified memory (così la lettura successiva del CPU vede il
  // valore aggiornato).
  let injectionsActive = true;
  let injectCount = 0;
  let injectedValue = 0; // contatore monotono indipendente dalla mem
  const dispose = cpu.system.onMemoryRead((event) => {
    if (!injectionsActive) return;
    if (event.addr === VBLANK_COUNTER_ADDR && event.size === 4) {
      injectedValue = (injectedValue + 1) >>> 0;
      // Scrivi big-endian (M68k): byte alto a addr, byte basso a addr+3.
      cpu.system.writeRaw8(VBLANK_COUNTER_ADDR + 0, (injectedValue >>> 24) & 0xff);
      cpu.system.writeRaw8(VBLANK_COUNTER_ADDR + 1, (injectedValue >>> 16) & 0xff);
      cpu.system.writeRaw8(VBLANK_COUNTER_ADDR + 2, (injectedValue >>> 8) & 0xff);
      cpu.system.writeRaw8(VBLANK_COUNTER_ADDR + 3, injectedValue & 0xff);
      injectCount++;
    }
  });

  console.log(`\n=== waitVblank (FUN_000052B8) — ${n} casi ===`);

  const rng = makeRng(0xdeadbeef);
  let ok = 0;
  let firstFail: {
    i: number;
    countWord: number;
    binD0w: number;
    tsD0w: number;
    workRamMismatchOff: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    // Pattern dei primi casi: corner cases noti.
    let countWord: number;
    if (i === 0) {
      countWord = 0;
    } else if (i === 1) {
      countWord = 1;
    } else if (i === 2) {
      countWord = -1 & 0xffff;
    } else if (i === 3) {
      countWord = 0x8000; // -32768 signed
    } else if (i === 4) {
      countWord = 0x7fff; // troppo grande per testare nel binario, lo gestiamo a parte
    } else if (i % 2 === 0) {
      // count signed <= 0: range [-32768..0]
      countWord = Math.floor(rng() * 0x8001) | 0; // 0..0x8000
      if (countWord !== 0) countWord = (-countWord) & 0xffff;
    } else {
      // count signed > 0 in [1..16] per tenere il binario veloce
      countWord = (Math.floor(rng() * 16) + 1) & 0xffff;
    }

    // Caso speciale 0x7fff: nel binario significa 32767 iterazioni →
    // ~65k letture del counter, troppo lente con la callback. Saltiamo
    // al binario e verifichiamo solo via TS, ma per coerenza del pattern
    // scegliamo 0x7fff in TS solo: comparison con il binario clamped a 16.
    let runOnBinary = true;
    if (i === 4) {
      // Skip: verifichiamo solo TS=0 (count>0 → loop esegue → ritorna 0)
      const tsD0w = vwNs.waitVblank(state, countWord) & 0xffff;
      if (tsD0w === 0) ok++;
      else if (firstFail === null) {
        firstFail = { i, countWord, binD0w: -1, tsD0w, workRamMismatchOff: -1 };
      }
      runOnBinary = false;
    }
    if (!runOnBinary) continue;

    // Pre-zero del counter @ 0x401FF8 e reset injectedValue
    pokeMem(cpu, VBLANK_COUNTER_ADDR, 4, 0);
    injectedValue = 0;

    // Costruiamo l'arg long come il caller reale: pea (0xa).w fa
    // sext_long(word). Quindi arg = signExtend(countWord) → long.
    const countSigned = (countWord & 0x8000) ? countWord - 0x10000 : countWord;
    const argLong = countSigned >>> 0;

    // Setup stack: SP a 0x401E80, push arg long, push sentinel return.
    // Usiamo step()-based runner (non `callFunction`/`run`) perché
    // `system.run(burst)` può over-runnare oltre la sentinel e far divergere
    // il PC su exception handlers se il `rts` esce sotto la fine del burst.
    const initialSp = 0x401e80;
    cpu.system.setRegister("sp", initialSp);
    let sp = initialSp;
    sp = (sp - 4) >>> 0;
    cpu.system.write(sp, 4, argLong);
    sp = (sp - 4) >>> 0;
    cpu.system.write(sp, 4, SENTINEL_RET);
    cpu.system.setRegister("sp", sp);
    cpu.system.setRegister("pc", FUN_VBLANK_WAIT);
    // Pre-fill D0/D1 con sentinel per accorgerci di clobber non documentati.
    cpu.system.setRegister("d0", 0xdeadbeef);
    cpu.system.setRegister("d1", 0xcafedab0);

    // Snapshot workRam DOPO setup stack (così sentinel/arg già scritti
    // sono nel "before" e non producono falsi mismatch).
    const before = snapshotWorkRam(cpu);

    const injBefore = injectCount;
    const MAX_STEPS = 200_000;
    let stepCount = 0;
    while (stepCount < MAX_STEPS) {
      if (cpu.system.getRegisters().pc === SENTINEL_RET) break;
      cpu.system.step();
      stepCount++;
    }
    // Pop sentinel + arg long (SP back to initialSp).
    cpu.system.setRegister("sp", (cpu.system.getRegisters().sp + 8) >>> 0);

    const binD0 = cpu.system.getRegisters().d0 >>> 0;
    const binD0w = binD0 & 0xffff;
    if (process.env.VBW_DEBUG) {
      const finalPc = cpu.system.getRegisters().pc;
      console.log(
        `  case ${i}: countWord=0x${countWord.toString(16)} arg=0x${argLong.toString(16)} steps=${stepCount}` +
        ` injReads=${injectCount - injBefore} binD0=0x${binD0.toString(16)} binD0w=0x${binD0w.toString(16)} finalPC=0x${finalPc.toString(16)}`,
      );
    }

    // Snapshot DOPO esecuzione e confronto.
    const after = snapshotWorkRam(cpu);
    // Ignora regione del counter VBLANK @ 0x1FF8..0x1FFB (modificato
    // dall'injection durante l'esecuzione del busy-wait).
    const wramMismatch = workRamDiffers(before.bytes, after.bytes, [
      [0x1ff8, 4],
    ]);

    // TS run
    const tsD0w = vwNs.waitVblank(state, countWord) & 0xffff;

    const match = binD0w === tsD0w && wramMismatch === -1;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        countWord,
        binD0w,
        tsD0w,
        workRamMismatchOff: wramMismatch,
      };
    }
  }

  injectionsActive = false;
  dispose();

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    countWord=0x${firstFail.countWord.toString(16)}`
        + ` (signed=${(firstFail.countWord & 0x8000) ? firstFail.countWord - 0x10000 : firstFail.countWord})`,
    );
    console.log(
      `    bin D0w=0x${firstFail.binD0w.toString(16)}` +
      `   ts D0w=0x${firstFail.tsD0w.toString(16)}` +
      `   workRam mismatch off=${firstFail.workRamMismatchOff}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
