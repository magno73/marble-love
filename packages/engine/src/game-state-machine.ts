/**
 * game-state-machine.ts — replica del root game-logic `FUN_00002E18`.
 *
 * Funzione "state machine dispatcher" da 930 byte, gestisce 4 slot
 * paralleli, ognuno con un proprio state machine (state in {0..7}).
 * Chiama 10 sub-funzioni (FUN_2572/2678/2766/2818/295A/2ABC/2BDA/2C60/2CD4/2DA0)
 * per le azioni specifiche di ogni stato.
 *
 * **Layout struct workRam @ 0x401F00..0x401F3F**:
 *   +0x00  word  (`VALUE_F00`)            usato in calcoli "marker check"
 *   +0x02  word  (`MODE`)                  0 = Branch B (state machine), ≠0 = Branch A
 *   +0x04  4 longs (`DATA_PTR[0..3]`)      pointer a struct esterno per slot
 *   +0x14  4 words (`WORD16[0..3]`)        secondary data per slot
 *   +0x1C  4 bytes (`STATE[0..3]`)         state machine state per slot (0..7)
 *   +0x20  4 words (`THRESHOLD[0..3]`)     dispatch threshold per slot
 *   +0x28  4 words (`COUNTER[0..3]`)       contatore frame per slot
 *   +0x30  4 bytes (`FLAG30[0..3]`)        toggle flag per state==2
 *   +0x34  4 bytes (`FLAG34[0..3]`)        byte counter per state==3/4
 *   +0x38  word   (`FRAME_COUNTER`)        contatore master, sempre incrementato
 *   +0x3A  word   (`SPECIAL_TICK`)         tick counter per Branch A
 *   +0x3C  word   (`SPECIAL_INNER`)        inner counter per Branch A
 *   +0x3E  word   (`SPECIAL_TARGET`)       target per Branch A
 *
 * **State dispatch (Branch B, mode==0)**:
 *   Per ogni slot D4 in [0..3]:
 *     if state[D4] == 0: skip
 *     counter[D4] += 1 (word)
 *     if counter[D4] != threshold[D4]: skip  (else: counter[D4] = 0, dispatch)
 *     switch state[D4]:
 *       1 → FUN_2678(data[D4])
 *       2 → if flag30[D4]: FUN_2ABC(data[D4]); flag30[D4]=0
 *           else:           FUN_2572(data[D4], sext(word16[D4])); flag30[D4]=1
 *       3 → result = FUN_2CD4(data[D4], sext(word16[D4]), flag34[D4]);
 *           flag34[D4] += 1; state[D4] = result.b;
 *           if state[D4] == 0 AND *(data[D4]+8) != 0:
 *             FUN_2BDA(*(data[D4]+8), sext(word16[D4]), sext(threshold[D4]))
 *       4 → result = FUN_2DA0(data[D4], flag34[D4]);
 *           flag34[D4] += 1; state[D4] = result.b;
 *           if state[D4] == 0 AND *(data[D4]+8) != 0:
 *             FUN_2C60(*(data[D4]+8), sext(threshold[D4]))
 *       5 → FUN_2766(data[D4])
 *       6 → FUN_2818(data[D4])
 *
 * **Branch A (mode != 0)**: TODO. Path complesso con linked-list walk e
 * potenziale infinite loop quando byte_at(D3+6) + *0x401F00 < 2. Per
 * sicurezza, in TS imploding una safety bound e settando state[D4]=0 +
 * break (deviation dal binario in questo edge case).
 *
 * **Verificato bit-perfect** vs `FUN_00002E18` (con tutte le 10 sub-functions
 * patched a stub deterministico) tramite `cli/src/test-game-state-machine-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants (workRam offsets) ─────────────────────────────────

export const VALUE_F00_OFF = 0x1f00 as const;
export const MODE_OFF = 0x1f02 as const;
export const DATA_PTR_BASE_OFF = 0x1f04 as const;
export const WORD16_BASE_OFF = 0x1f14 as const;
export const STATE_BASE_OFF = 0x1f1c as const;
export const THRESHOLD_BASE_OFF = 0x1f20 as const;
export const COUNTER_BASE_OFF = 0x1f28 as const;
export const FLAG30_BASE_OFF = 0x1f30 as const;
export const FLAG34_BASE_OFF = 0x1f34 as const;
export const FRAME_COUNTER_OFF = 0x1f38 as const;
export const SPECIAL_TICK_OFF = 0x1f3a as const;
export const SPECIAL_INNER_OFF = 0x1f3c as const;
export const SPECIAL_TARGET_OFF = 0x1f3e as const;
export const ROTATION_OFF = 0x1f42 as const;

/** Numero di slot processati. */
export const SLOT_COUNT = 4 as const;

/** ROM lookup table address (per Branch A). */
const ROM_LOOKUP_BASE = 0x7294 as const;

// ─── Sub-function callbacks ──────────────────────────────────────────────

/**
 * Stub callbacks per le 10 sub-functions. Quando omessi, il default è
 * no-op (matching `rts`). Per `fun_2cd4` e `fun_2da0` il default ritorna
 * 0 (matching `moveq #0, D0; rts`).
 */
export interface GameStateMachineSubs {
  /** FUN_295A: dispatch one-shot (Branch A). 0 args. */
  fun_295a?: () => void;
  /** FUN_2572(arg1Long, arg2Long). State 2 (alt path) + Branch A dispatch. */
  fun_2572?: (arg1Long: number, arg2Long: number) => void;
  /** FUN_2ABC(arg1Long). State 2 (toggled path). */
  fun_2abc?: (arg1Long: number) => void;
  /** FUN_2678(arg1Long). State 1. */
  fun_2678?: (arg1Long: number) => void;
  /** FUN_2CD4(arg1Long, arg2Long, arg3Long) → byte. State 3. */
  fun_2cd4?: (arg1Long: number, arg2Long: number, arg3Long: number) => number;
  /** FUN_2BDA(arg1Long, arg2Long, arg3Long). State 3 transition. */
  fun_2bda?: (arg1Long: number, arg2Long: number, arg3Long: number) => void;
  /** FUN_2DA0(arg1Long, arg2Long) → byte. State 4. */
  fun_2da0?: (arg1Long: number, arg2Long: number) => number;
  /** FUN_2C60(arg1Long, arg2Long). State 4 transition. */
  fun_2c60?: (arg1Long: number, arg2Long: number) => void;
  /** FUN_2766(arg1Long). State 5. */
  fun_2766?: (arg1Long: number) => void;
  /** FUN_2818(arg1Long). State 6. */
  fun_2818?: (arg1Long: number) => void;
}

// ─── Memory helpers ──────────────────────────────────────────────────────

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}
function readU16Signed(state: GameState, off: number): number {
  const w = readU16(state, off);
  return w & 0x8000 ? w - 0x10000 : w;
}
function writeU16(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}
function readU32(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>> 0
  );
}

/** Read byte at absolute address (subset memory map). */
function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a < 0x80000) return rom.program[a] ?? 0;
  if (a >= 0x400000 && a < 0x402000) return state.workRam[a - 0x400000] ?? 0;
  if (a >= 0xa02000 && a < 0xa03000) return state.spriteRam[a - 0xa02000] ?? 0;
  if (a >= 0xa03000 && a < 0xa04000) return state.alphaRam[a - 0xa03000] ?? 0;
  if (a >= 0xb00000 && a < 0xb00800) return state.colorRam[a - 0xb00000] ?? 0;
  return 0;
}
function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  return (
    ((readByteAbs(state, rom, addr) << 24) |
      (readByteAbs(state, rom, (addr + 1) >>> 0) << 16) |
      (readByteAbs(state, rom, (addr + 2) >>> 0) << 8) |
      readByteAbs(state, rom, (addr + 3) >>> 0)) >>> 0
  );
}

// ─── Main function: replica FUN_2E18 ─────────────────────────────────────

export function gameStateMachineTick(
  state: GameState,
  rom: RomImage,
  subs?: GameStateMachineSubs,
): void {
  const r = state.workRam;

  // *0x401F38 += 1 (word, frame counter)
  writeU16(state, FRAME_COUNTER_OFF, (readU16(state, FRAME_COUNTER_OFF) + 1) & 0xffff);

  const mode = readU16(state, MODE_OFF);
  if (mode !== 0) {
    // ─── Branch A: special path ─────────────────────────────────────
    branchASpecial(state, rom, subs);
    return;
  }

  // ─── Branch B: standard state-machine dispatch (4 slots) ──────────
  for (let d4 = 0; d4 < SLOT_COUNT; d4++) {
    const stateByte = r[STATE_BASE_OFF + d4] ?? 0;
    if (stateByte === 0) continue;

    // counter[D4] += 1 (word)
    const counterOld = readU16(state, COUNTER_BASE_OFF + d4 * 2);
    const counterNew = (counterOld + 1) & 0xffff;
    writeU16(state, COUNTER_BASE_OFF + d4 * 2, counterNew);

    // if threshold != counter: skip
    const threshold = readU16(state, THRESHOLD_BASE_OFF + d4 * 2);
    if (threshold !== counterNew) continue;

    // counter[D4] = 0 (reset on dispatch)
    writeU16(state, COUNTER_BASE_OFF + d4 * 2, 0);

    // Dispatch
    if (stateByte === 2) {
      const dataPtr = readU32(state, DATA_PTR_BASE_OFF + d4 * 4);
      if ((r[FLAG30_BASE_OFF + d4] ?? 0) !== 0) {
        if (subs?.fun_2abc) subs.fun_2abc(dataPtr);
        r[FLAG30_BASE_OFF + d4] = 0;
      } else {
        const word16 = readU16Signed(state, WORD16_BASE_OFF + d4 * 2);
        if (subs?.fun_2572) subs.fun_2572(dataPtr, word16 | 0);
        r[FLAG30_BASE_OFF + d4] = 1;
      }
    } else if (stateByte === 1) {
      const dataPtr = readU32(state, DATA_PTR_BASE_OFF + d4 * 4);
      if (subs?.fun_2678) subs.fun_2678(dataPtr);
    } else if (stateByte === 3) {
      const dataPtr = readU32(state, DATA_PTR_BASE_OFF + d4 * 4);
      const word16 = readU16Signed(state, WORD16_BASE_OFF + d4 * 2);
      const flag34Old = r[FLAG34_BASE_OFF + d4] ?? 0;
      r[FLAG34_BASE_OFF + d4] = (flag34Old + 1) & 0xff;
      const result = subs?.fun_2cd4 ? subs.fun_2cd4(dataPtr, word16 | 0, flag34Old) : 0;
      r[STATE_BASE_OFF + d4] = result & 0xff;
      if ((result & 0xff) === 0) {
        const next = readLongAbs(state, rom, (dataPtr + 8) >>> 0);
        if (next !== 0) {
          const thresh = readU16Signed(state, THRESHOLD_BASE_OFF + d4 * 2);
          if (subs?.fun_2bda) subs.fun_2bda(next, word16 | 0, thresh | 0);
        }
      }
    } else if (stateByte === 4) {
      const dataPtr = readU32(state, DATA_PTR_BASE_OFF + d4 * 4);
      const flag34Old = r[FLAG34_BASE_OFF + d4] ?? 0;
      r[FLAG34_BASE_OFF + d4] = (flag34Old + 1) & 0xff;
      const result = subs?.fun_2da0 ? subs.fun_2da0(dataPtr, flag34Old) : 0;
      r[STATE_BASE_OFF + d4] = result & 0xff;
      if ((result & 0xff) === 0) {
        const next = readLongAbs(state, rom, (dataPtr + 8) >>> 0);
        if (next !== 0) {
          const thresh = readU16Signed(state, THRESHOLD_BASE_OFF + d4 * 2);
          if (subs?.fun_2c60) subs.fun_2c60(next, thresh | 0);
        }
      }
    } else if (stateByte === 5) {
      const dataPtr = readU32(state, DATA_PTR_BASE_OFF + d4 * 4);
      if (subs?.fun_2766) subs.fun_2766(dataPtr);
    } else if (stateByte === 6) {
      const dataPtr = readU32(state, DATA_PTR_BASE_OFF + d4 * 4);
      if (subs?.fun_2818) subs.fun_2818(dataPtr);
    }
    // state 7 ignored in Branch B (only handled in Branch A)
  }
}

// ─── Branch A implementation ─────────────────────────────────────────────

function branchASpecial(state: GameState, rom: RomImage, subs?: GameStateMachineSubs): void {
  // *0x401F3C reads, then += 1
  const innerOld = readU16(state, SPECIAL_INNER_OFF);
  writeU16(state, SPECIAL_INNER_OFF, (innerOld + 1) & 0xffff);
  // if innerOld != *0x401F3E: exit
  if (innerOld !== readU16(state, SPECIAL_TARGET_OFF)) return;

  if (subs?.fun_295a) subs.fun_295a();
  writeU16(state, SPECIAL_INNER_OFF, 0);
  writeU16(state, SPECIAL_TICK_OFF, (readU16(state, SPECIAL_TICK_OFF) + 1) & 0xffff);

  for (let d4 = 0; d4 < SLOT_COUNT; d4++) {
    const stateByte = state.workRam[STATE_BASE_OFF + d4] ?? 0;
    if (stateByte !== 7) continue;

    let d3 = readU32(state, DATA_PTR_BASE_OFF + d4 * 4);
    // Safety bound contro infinite loop documentato (deviation dal binario
    // quando byte_at(D3+6) + *0x401F00 < 2 nel ramo d0<d1: il binario
    // farebbe loop infinito — qui usciamo dopo un cap di 1024 iterazioni).
    let safety = 1024;
    while (safety-- > 0) {
      const rotation = readU16(state, ROTATION_OFF);
      const lookupRaw =
        ((rom.program[ROM_LOOKUP_BASE + rotation * 2] ?? 0) << 8) |
        (rom.program[ROM_LOOKUP_BASE + rotation * 2 + 1] ?? 0);
      const lookupSigned = lookupRaw & 0x8000 ? lookupRaw - 0x10000 : lookupRaw;
      const d1 = (lookupSigned - 1) | 0;
      const b1 = readByteAbs(state, rom, (d3 + 1) >>> 0);
      const b1Signed = (b1 & 0x80) ? b1 - 0x100 : b1;
      const tick = readU16Signed(state, SPECIAL_TICK_OFF);
      const d0 = (b1Signed - tick) | 0;

      // ble: if D1 <= D0 (signed): branch to "due" path
      if (d1 <= d0) {
        // Re-check: dispatch only when D0 == D1 exactly
        if (d0 !== d1) break;

        const word16 = readU16Signed(state, WORD16_BASE_OFF + d4 * 2);
        if (subs?.fun_2572) subs.fun_2572(d3 >>> 0, word16 | 0);
        // Save d3 back to data[D4]
        const dataOff = DATA_PTR_BASE_OFF + d4 * 4;
        state.workRam[dataOff] = (d3 >>> 24) & 0xff;
        state.workRam[dataOff + 1] = (d3 >>> 16) & 0xff;
        state.workRam[dataOff + 2] = (d3 >>> 8) & 0xff;
        state.workRam[dataOff + 3] = d3 & 0xff;

        const b6 = readByteAbs(state, rom, (d3 + 6) >>> 0);
        const b6Signed = (b6 & 0x80) ? b6 - 0x100 : b6;
        const valF00 = readU16Signed(state, VALUE_F00_OFF);
        const x = (b6Signed + valF00) | 0;
        if (x < 2) {
          state.workRam[STATE_BASE_OFF + d4] = 0;
        }
        // (else: redundant write of d3 to data[D4] — no-op since already done)
        break;
      }

      // d0 < d1: not due; check marker
      const b6 = readByteAbs(state, rom, (d3 + 6) >>> 0);
      const b6Signed = (b6 & 0x80) ? b6 - 0x100 : b6;
      const valF00 = readU16Signed(state, VALUE_F00_OFF);
      const x = (b6Signed + valF00) | 0;
      if (x < 2) {
        // Marker: clear state, abort (deviation: binary infinite loops here)
        state.workRam[STATE_BASE_OFF + d4] = 0;
        break;
      }
      // Walk to next entry
      d3 = readLongAbs(state, rom, (d3 + 8) >>> 0);
    }
  }
}
