/**
 * timer-cascade.ts — gestione di timer cascading a 3 livelli.
 *
 * Replica `FUN_00028C38`. Struct timer di 5 byte:
 *   +0..1: outerCounter (u16 BE)
 *   +2:    mediumCounter (u8)
 *   +3:    (padding o altro field, non toccato)
 *   +4:    innerCounter (u8)
 *
 * Logica per chiamata:
 *   1. Se innerCounter == 0xFF (disabled): no-op, ritorna 0.
 *   2. innerCounter -= 1 (signed)
 *   3. Se innerCounter >= 0 SIGNED: ritorna 0 (no cascade).
 *   4. innerCounter = 5 (reset)
 *   5. mediumCounter -= 1 (signed)
 *   6. Se mediumCounter >= 0 SIGNED: ritorna bit 1 set (cascade triggered).
 *   7. mediumCounter = 9 (reset)
 *   8. outerCounter -= 1 (word, signed)
 *   9. Se outerCounter è ora -1 (= 0xFFFF, wrapped from 0): bit 0 set.
 *  10. Bit 1 sempre set (cascade was triggered).
 *
 * Return value flags:
 *   bit 0: outer word wrapped to 0xFFFF this call
 *   bit 1: timer expired (mediumCounter wrapped this call)
 *
 * **Verificato bit-perfect** vs `FUN_00028C38`.
 */

import type { GameState } from "./state.js";

export const TIMER_OFFSET_OUTER = 0 as const;   // u16 BE
export const TIMER_OFFSET_MEDIUM = 2 as const;  // u8
export const TIMER_OFFSET_INNER = 4 as const;   // u8

const INNER_RESET = 5 as const;
const MEDIUM_RESET = 9 as const;
const TIMER_DISABLED = 0xff as const;

function sext8(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

function sext16(w: number): number {
  return ((w & 0xffff) << 16) >> 16;
}

/** Read a generic memory byte from the unified address space (subset). */
function readMemoryU8(state: GameState, addr: number): number {
  if (addr >= 0x400000 && addr < 0x402000) {
    return state.workRam[addr - 0x400000] ?? 0;
  } else if (addr >= 0xa02000 && addr < 0xa04000) {
    return state.spriteRam[addr - 0xa02000] ?? 0;
  } else if (addr >= 0xb00000 && addr < 0xb00800) {
    return state.colorRam[addr - 0xb00000] ?? 0;
  }
  return 0;
}
function writeMemoryU8(state: GameState, addr: number, v: number): void {
  const b = v & 0xff;
  if (addr >= 0x400000 && addr < 0x402000) {
    state.workRam[addr - 0x400000] = b;
  } else if (addr >= 0xa02000 && addr < 0xa04000) {
    state.spriteRam[addr - 0xa02000] = b;
  } else if (addr >= 0xb00000 && addr < 0xb00800) {
    state.colorRam[addr - 0xb00000] = b;
  }
}

/**
 * Replica `FUN_00028C38` — tick di un timer cascading.
 *
 * @param state    GameState
 * @param timerAddr Indirizzo assoluto della struct timer (5 byte)
 * @returns        Flags: bit 0 = outer wrapped, bit 1 = cascade triggered
 */
export function tickCascadingTimer(state: GameState, timerAddr: number): number {
  const innerAddr = (timerAddr + TIMER_OFFSET_INNER) >>> 0;
  const mediumAddr = (timerAddr + TIMER_OFFSET_MEDIUM) >>> 0;

  const inner = readMemoryU8(state, innerAddr);
  // Disabled: ritorna 0 (no cascade)
  if (inner === TIMER_DISABLED) return 0;

  // Decrement inner (byte)
  let newInner = (inner - 1) & 0xff;
  writeMemoryU8(state, innerAddr, newInner);

  // tst.b inner; bge skip — skip se signed >= 0
  if (sext8(newInner) >= 0) return 0;

  // Reset inner
  writeMemoryU8(state, innerAddr, INNER_RESET);

  // Decrement medium (byte)
  let medium = readMemoryU8(state, mediumAddr);
  medium = (medium - 1) & 0xff;
  writeMemoryU8(state, mediumAddr, medium);

  // tst.b medium; bge.b end — skip se signed >= 0 (return D1=0).
  // Bit 1 viene settato SOLO quando medium ha pure cascated (outer decremented).
  if (sext8(medium) >= 0) {
    return 0;
  }

  // Reset medium
  writeMemoryU8(state, mediumAddr, MEDIUM_RESET);

  // Decrement outer (word BE at timerAddr)
  const outerHigh = readMemoryU8(state, timerAddr);
  const outerLow = readMemoryU8(state, (timerAddr + 1) >>> 0);
  const outerOld = ((outerHigh << 8) | outerLow) & 0xffff;
  const outerNew = (outerOld - 1) & 0xffff;
  writeMemoryU8(state, timerAddr, (outerNew >>> 8) & 0xff);
  writeMemoryU8(state, (timerAddr + 1) >>> 0, outerNew & 0xff);

  // Check if outer wrapped to 0xFFFF
  let flags = 0x2; // cascade triggered
  // Disasm: moveq -1, D0; cmp.w *A0, D0; bne skip; ori.b #1, D1
  // So if outer.w == -1 (= 0xFFFF, after subq.w 1 from 0): set bit 0.
  if (sext16(outerNew) === -1) {
    flags |= 0x1;
  }
  return flags;
}
