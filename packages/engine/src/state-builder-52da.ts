/**
 * state-builder-52da.ts — replica `FUN_000052DA`.
 *
 * The function builds a small descriptor from two byte-sized args and a table
 * pointer. It scans that table for the first zero byte, stores the resulting
 * index plus `b1` in work RAM byte `0x401F98`, stores `b2` in `0x401F99`, then
 * calls `FUN_2572` with the descriptor and a zero long.
 */

import type { GameState } from "./state.js";

const WORK_RAM_BASE = 0x00400000;

export const STATE_BUILDER_52DA_ADDR = 0x000052da as const;
export const STATE_BUILDER_INDEX_ADDR = 0x00401f98 as const;
export const STATE_BUILDER_SECOND_ADDR = 0x00401f99 as const;

const INDEX_OFF = STATE_BUILDER_INDEX_ADDR - WORK_RAM_BASE;
const SECOND_OFF = STATE_BUILDER_SECOND_ADDR - WORK_RAM_BASE;

export interface StateBuilder52DADescriptorCall {
  descriptor: Uint8Array;
  zeroArg: number;
  d0In: number;
}

export interface StateBuilder52DASubs {
  /**
   * Reads one byte from the 68010 absolute address space. The binary uses
   * `longArg + signExt8(index)` while scanning.
   */
  readByte?: (addr: number) => number;
  /**
   * Models `FUN_2572(descriptorPtr, 0)`. An RTS-patched binary callee preserves
   * D0, so the default returns `d0In`.
   */
  renderStringChain?: (call: StateBuilder52DADescriptorCall) => number;
  /** Safety valve for malformed tables. The real binary loops until a zero. */
  maxScanSteps?: number;
}

function signExtByteToI32(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

function u32ToBytesBE(out: Uint8Array, off: number, v: number): void {
  const n = v >>> 0;
  out[off] = (n >>> 24) & 0xff;
  out[off + 1] = (n >>> 16) & 0xff;
  out[off + 2] = (n >>> 8) & 0xff;
  out[off + 3] = n & 0xff;
}

function defaultReadByte(_addr: number): number {
  return 0;
}

/**
 * Replica bit-perfect di `FUN_000052DA` for observable state and D0.
 *
 * Stack args are three longs, but the function reads only the low byte of the
 * first two (`0x0B(A6)` and `0x0F(A6)`) plus the full third long (`0x10(A6)`).
 */
export function stateBuilder52DA(
  state: GameState,
  b1: number,
  b2: number,
  longArg: number,
  subs: StateBuilder52DASubs = {},
): number {
  const firstByte = b1 & 0xff;
  const secondByte = b2 & 0xff;
  const tableBase = longArg >>> 0;
  const readByte = subs.readByte ?? defaultReadByte;
  const maxScanSteps = subs.maxScanSteps ?? 0x10000;

  state.workRam[SECOND_OFF] = secondByte;
  state.workRam[INDEX_OFF] = 0;

  let steps = 0;
  while (true) {
    const indexByte: number = state.workRam[INDEX_OFF] ?? 0;
    const signedIndex = signExtByteToI32(indexByte);
    const probeAddr = (tableBase + signedIndex) >>> 0;
    if ((readByte(probeAddr) & 0xff) === 0) break;

    state.workRam[INDEX_OFF] = (indexByte + 1) & 0xff;
    steps++;
    if (steps >= maxScanSteps) {
      throw new Error("stateBuilder52DA scan did not find a zero terminator");
    }
  }

  const foundIndex = state.workRam[INDEX_OFF] ?? 0;
  const d0BeforeCall = (signExtByteToI32(foundIndex) & 0xffffff00) | firstByte;
  state.workRam[INDEX_OFF] = (foundIndex + firstByte) & 0xff;

  const descriptor = new Uint8Array(12);
  descriptor[0] = firstByte;
  descriptor[1] = secondByte;
  u32ToBytesBE(descriptor, 2, tableBase);
  descriptor[6] = 0;

  const render = subs.renderStringChain;
  if (render === undefined) return d0BeforeCall >>> 0;

  return (
    render({
      descriptor,
      zeroArg: 0,
      d0In: d0BeforeCall >>> 0,
    }) >>> 0
  );
}
