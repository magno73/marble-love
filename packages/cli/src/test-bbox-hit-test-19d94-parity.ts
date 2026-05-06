#!/usr/bin/env node
/**
 * test-bbox-hit-test-19d94-parity.ts — differential FUN_00019D94 vs
 * `bboxHitTest19D94`.
 *
 * FUN_00019D94 (174 byte): "mode-4 AABB hit-test sull'array @ 0x4019F8".
 * Itera 10 slot stride 0x38; per ciascuna slot armata e libera, verifica
 * bbox-overlap con (marble.x, marble.y) e su hit scrive slot fields, entity
 * fields, e triggera sound 0x3E via `FUN_158AC`.
 *
 * **Strategia parity**:
 *   - `FUN_00158AC` (sound command sender) **stubbato con RTS** (0x4E75) per
 *     neutralizzare side effects su MMIO sound. Il TS usa
 *     `subs.soundCommand = noop` per matchare.
 *   - Compare:
 *       * Per ciascuna delle 10 slot: i 0x38 byte completi a partire da
 *         `0x4019F8 + i*0x38`.
 *       * I 0x60 byte dell'entity @ ENTITY_BASE (copre 0x1A e 0x57).
 *       * Il flag word @ 0x400394 (game-mode), non scritto ma verifichiamo
 *         non sia stato corrotto.
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random everything
 *   - B: forced game-mode = 4 + slot 0 armata + bbox centrato → guaranteed hit
 *   - C: game-mode = 4, slot armate con vari edge-case bbox boundaries
 *   - D: game-mode != 4 → early-exit (entity/slot non toccati)
 *
 * Uso: npx tsx packages/cli/src/test-bbox-hit-test-19d94-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bboxHitTest19D94 as bboxNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_19D94 = 0x00019d94;
const FUN_158AC = 0x000158ac;

const ENTITY_BASE = 0x00401e00;
const ENTITY_SIZE = 0x60; // copre [0..0x57] inclusive
const SLOT_BASE = 0x004019f8;
const SLOT_STRIDE = 0x38;
const SLOT_COUNT = 10;
const GAME_MODE_ADDR = 0x00400394;
const MARBLE_X_ADDR = 0x00400690;
const MARBLE_Y_ADDR = 0x00400692;

/**
 * Patch JSR-stub:
 *   - FUN_158AC → RTS (0x4E75) per neutralizzare il sound command sender.
 *
 * NB: `pea (cmd).l; jsr FUN_158AC; addq.l #4, SP` — il binario del caller
 * pusha il long e dopo il RTS dello stub fa addq.l #4, SP per pulire lo
 * stack. Quindi RTS-only va bene.
 */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_158AC + 0, 1, 0x4e);
  pokeMem(cpu, FUN_158AC + 1, 1, 0x75);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  entity: number[]; // 0x60 byte (copre [0..0x57])
  slots: number[]; // 10 × 0x38 byte concatenati
  gameMode: number; // word @ 0x400394
  marbleX: number; // word @ 0x400690
  marbleY: number; // word @ 0x400692
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const entity: number[] = [];
  for (let i = 0; i < ENTITY_SIZE; i++) {
    entity.push(peekMem(cpu, ENTITY_BASE + i, 1) & 0xff);
  }
  const slots: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    for (let j = 0; j < SLOT_STRIDE; j++) {
      slots.push(peekMem(cpu, SLOT_BASE + i * SLOT_STRIDE + j, 1) & 0xff);
    }
  }
  return {
    entity,
    slots,
    gameMode: peekMem(cpu, GAME_MODE_ADDR, 2) & 0xffff,
    marbleX: peekMem(cpu, MARBLE_X_ADDR, 2) & 0xffff,
    marbleY: peekMem(cpu, MARBLE_Y_ADDR, 2) & 0xffff,
  };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const entity: number[] = [];
  const entityOff = ENTITY_BASE - 0x400000;
  for (let i = 0; i < ENTITY_SIZE; i++) {
    entity.push(state.workRam[entityOff + i] ?? 0);
  }
  const slots: number[] = [];
  const slotOff0 = SLOT_BASE - 0x400000;
  for (let i = 0; i < SLOT_COUNT; i++) {
    for (let j = 0; j < SLOT_STRIDE; j++) {
      slots.push(state.workRam[slotOff0 + i * SLOT_STRIDE + j] ?? 0);
    }
  }
  const r = state.workRam;
  return {
    entity,
    slots,
    gameMode: (((r[0x394] ?? 0) << 8) | (r[0x395] ?? 0)) & 0xffff,
    marbleX: (((r[0x690] ?? 0) << 8) | (r[0x691] ?? 0)) & 0xffff,
    marbleY: (((r[0x692] ?? 0) << 8) | (r[0x693] ?? 0)) & 0xffff,
  };
}

interface CaseInput {
  /** 0x60 byte entity. */
  entityBytes: number[];
  /** 10 × 0x38 byte slot array. */
  slotBytes: number[];
  gameMode: number;
  marbleX: number;
  marbleY: number;
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binSnap: Snapshot;
  tsSnap: Snapshot;
  input: CaseInput;
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
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchSubs(cpu);

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(input: CaseInput): void {
    // BINARY: write entity, slots, globals
    for (let i = 0; i < ENTITY_SIZE; i++) {
      pokeMem(cpu, ENTITY_BASE + i, 1, input.entityBytes[i] ?? 0);
    }
    for (let i = 0; i < SLOT_COUNT * SLOT_STRIDE; i++) {
      pokeMem(cpu, SLOT_BASE + i, 1, input.slotBytes[i] ?? 0);
    }
    pokeMem(cpu, GAME_MODE_ADDR, 2, input.gameMode & 0xffff);
    pokeMem(cpu, MARBLE_X_ADDR, 2, input.marbleX & 0xffff);
    pokeMem(cpu, MARBLE_Y_ADDR, 2, input.marbleY & 0xffff);
    cpu.system.setRegister("sp", 0x401f00);

    // TS: same setup
    const entityOff = ENTITY_BASE - 0x400000;
    for (let i = 0; i < ENTITY_SIZE; i++) {
      stateInst.workRam[entityOff + i] = input.entityBytes[i] ?? 0;
    }
    const slotOff0 = SLOT_BASE - 0x400000;
    for (let i = 0; i < SLOT_COUNT * SLOT_STRIDE; i++) {
      stateInst.workRam[slotOff0 + i] = input.slotBytes[i] ?? 0;
    }
    stateInst.workRam[0x394] = (input.gameMode >>> 8) & 0xff;
    stateInst.workRam[0x395] = input.gameMode & 0xff;
    stateInst.workRam[0x690] = (input.marbleX >>> 8) & 0xff;
    stateInst.workRam[0x691] = input.marbleX & 0xff;
    stateInst.workRam[0x692] = (input.marbleY >>> 8) & 0xff;
    stateInst.workRam[0x693] = input.marbleY & 0xff;
  }

  function runOneCase(suite: string, tc: number, input: CaseInput): boolean {
    setupCase(input);

    callFunction(cpu, FUN_19D94, [ENTITY_BASE]);
    const binSnap = snapshotBinary(cpu);

    bboxNs.bboxHitTest19D94(stateInst, ENTITY_BASE, {
      soundCommand: () => {
        // no-op (matching del binario stubbato con RTS)
      },
    });
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    if (binSnap.gameMode !== tsSnap.gameMode) {
      reason = `gameMode bin=0x${binSnap.gameMode.toString(16)} ts=0x${tsSnap.gameMode.toString(16)}`;
    } else if (binSnap.marbleX !== tsSnap.marbleX) {
      reason = `marbleX bin=0x${binSnap.marbleX.toString(16)} ts=0x${tsSnap.marbleX.toString(16)}`;
    } else if (binSnap.marbleY !== tsSnap.marbleY) {
      reason = `marbleY bin=0x${binSnap.marbleY.toString(16)} ts=0x${tsSnap.marbleY.toString(16)}`;
    } else {
      for (let i = 0; i < ENTITY_SIZE; i++) {
        if (binSnap.entity[i] !== tsSnap.entity[i]) {
          reason = `entity[0x${i.toString(16)}] bin=0x${binSnap.entity[i]!.toString(16)} ts=0x${tsSnap.entity[i]!.toString(16)}`;
          break;
        }
      }
      if (reason === "") {
        for (let i = 0; i < SLOT_COUNT * SLOT_STRIDE; i++) {
          if (binSnap.slots[i] !== tsSnap.slots[i]) {
            const slotIdx = Math.floor(i / SLOT_STRIDE);
            const fieldOff = i % SLOT_STRIDE;
            reason = `slot[${slotIdx}][0x${fieldOff.toString(16)}] bin=0x${binSnap.slots[i]!.toString(16)} ts=0x${tsSnap.slots[i]!.toString(16)}`;
            break;
          }
        }
      }
    }
    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = { suite, tc, reason, binSnap, tsSnap, input };
    }
    return false;
  }

  const rng = makeRng(0x19d94);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;

  function randomEntity(): number[] {
    return new Array(ENTITY_SIZE).fill(0).map(() => rb());
  }
  function randomSlots(): number[] {
    return new Array(SLOT_COUNT * SLOT_STRIDE).fill(0).map(() => rb());
  }

  // ─── Suite A: random ─────────────────────────────────────────────────
  console.log(
    `\n=== bboxHitTest19D94 (FUN_00019D94) — Suite A: random — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const input: CaseInput = {
      entityBytes: randomEntity(),
      slotBytes: randomSlots(),
      gameMode: rw(),
      marbleX: rw(),
      marbleY: rw(),
    };
    if (runOneCase("A", i, input)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: gameMode=4, slot 0 armata centrata su marble → hit ─────
  console.log(
    `\n=== Suite B: gameMode=4 + slot 0 armata + bbox-centered (guaranteed hit) — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const slots = randomSlots();
    // Forza tutte le slot a NON armate
    for (let s = 0; s < SLOT_COUNT; s++) {
      slots[s * SLOT_STRIDE + 0x18] = 0;
    }
    // Slot 0 armata + libera + bbox centrato su (mx, my)
    const mx = (rw() & 0x7fff) - 0x4000; // signed-ish range
    const my = (rw() & 0x7fff) - 0x4000;
    slots[0 * SLOT_STRIDE + 0x18] = 1;
    slots[0 * SLOT_STRIDE + 0x1a] = 0;
    slots[0 * SLOT_STRIDE + 0x0c] = (mx >>> 8) & 0xff;
    slots[0 * SLOT_STRIDE + 0x0d] = mx & 0xff;
    slots[0 * SLOT_STRIDE + 0x10] = (my >>> 8) & 0xff;
    slots[0 * SLOT_STRIDE + 0x11] = my & 0xff;
    const input: CaseInput = {
      entityBytes: randomEntity(),
      slotBytes: slots,
      gameMode: 4,
      marbleX: mx & 0xffff,
      marbleY: my & 0xffff,
    };
    if (runOneCase("B", i, input)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: gameMode=4, edge cases bbox boundaries ─────────────────
  console.log(
    `\n=== Suite C: gameMode=4 + slot armate con bbox boundary edges — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const slots = randomSlots();
    // Tutte le slot armate + libere
    for (let s = 0; s < SLOT_COUNT; s++) {
      slots[s * SLOT_STRIDE + 0x18] = 1;
      slots[s * SLOT_STRIDE + 0x1a] = 0;
      // Posizioni random word
      const sx = rw();
      const sy = rw();
      slots[s * SLOT_STRIDE + 0x0c] = (sx >>> 8) & 0xff;
      slots[s * SLOT_STRIDE + 0x0d] = sx & 0xff;
      slots[s * SLOT_STRIDE + 0x10] = (sy >>> 8) & 0xff;
      slots[s * SLOT_STRIDE + 0x11] = sy & 0xff;
    }
    // Marble pos = una delle slot ± 0..7 (per testare boundary)
    const targetSlot = i % SLOT_COUNT;
    const baseSx =
      ((slots[targetSlot * SLOT_STRIDE + 0x0c]! << 8) |
        slots[targetSlot * SLOT_STRIDE + 0x0d]!) &
      0xffff;
    const baseSy =
      ((slots[targetSlot * SLOT_STRIDE + 0x10]! << 8) |
        slots[targetSlot * SLOT_STRIDE + 0x11]!) &
      0xffff;
    // Add offset in [-8, +8] to test boundaries
    const dx = Math.floor(rng() * 17) - 8;
    const dy = Math.floor(rng() * 17) - 8;
    const mx = (baseSx + dx) & 0xffff;
    const my = (baseSy + dy) & 0xffff;
    const input: CaseInput = {
      entityBytes: randomEntity(),
      slotBytes: slots,
      gameMode: 4,
      marbleX: mx,
      marbleY: my,
    };
    if (runOneCase("C", i, input)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge — gameMode != 4 (early exit) + slot states mixed ──
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: gameMode != 4 (early exit) + slot states miscellanei — ${sizeD} casi ===`,
  );
  let okD = 0;
  const gameModeChoices = [0, 1, 2, 3, 5, 6, 0xff, 0xffff, 0x0400];
  for (let i = 0; i < sizeD; i++) {
    const slots = randomSlots();
    for (let s = 0; s < SLOT_COUNT; s++) {
      // mix: alcune armate, alcune occupate, alcune libere
      const mode = i % 3;
      if (mode === 0) {
        slots[s * SLOT_STRIDE + 0x18] = 1;
        slots[s * SLOT_STRIDE + 0x1a] = 0;
      } else if (mode === 1) {
        slots[s * SLOT_STRIDE + 0x18] = 1;
        slots[s * SLOT_STRIDE + 0x1a] = (rb() | 1) & 0xff; // != 0
      } else {
        slots[s * SLOT_STRIDE + 0x18] = 0;
      }
    }
    const gm = gameModeChoices[i % gameModeChoices.length]!;
    const input: CaseInput = {
      entityBytes: randomEntity(),
      slotBytes: slots,
      gameMode: gm,
      marbleX: rw(),
      marbleY: rw(),
    };
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
    console.log(`    gameMode=0x${f.input.gameMode.toString(16)} marbleX=0x${f.input.marbleX.toString(16)} marbleY=0x${f.input.marbleY.toString(16)}`);
    for (let s = 0; s < SLOT_COUNT; s++) {
      const off = s * SLOT_STRIDE;
      const armed = f.input.slotBytes[off + 0x18];
      const stateB = f.input.slotBytes[off + 0x1a];
      const sx =
        (((f.input.slotBytes[off + 0x0c] ?? 0) << 8) |
          (f.input.slotBytes[off + 0x0d] ?? 0)) &
        0xffff;
      const sy =
        (((f.input.slotBytes[off + 0x10] ?? 0) << 8) |
          (f.input.slotBytes[off + 0x11] ?? 0)) &
        0xffff;
      console.log(
        `    slot[${s}]: armed=${armed}, state=${stateB}, x=0x${sx.toString(16)}, y=0x${sy.toString(16)}`,
      );
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
