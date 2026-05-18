import type { GameState, ObjectStateEntryDebug } from "./state.js";

const WORK_RAM_BASE = 0x00400000;

function readLongBE(bytes: Uint8Array, off: number): number {
  return (
    (((bytes[off] ?? 0) << 24) |
      ((bytes[off + 1] ?? 0) << 16) |
      ((bytes[off + 2] ?? 0) << 8) |
      (bytes[off + 3] ?? 0)) >>>
    0
  );
}

export function recordObjectStateEntryDebug(
  state: GameState,
  entityAddr: number,
  code: number,
  source: string,
  extra: Partial<ObjectStateEntryDebug> = {},
): void {
  const off = (entityAddr - WORK_RAM_BASE) >>> 0;
  if (entityAddr < WORK_RAM_BASE || off + 0xe1 >= state.workRam.length) return;
  state.debug ??= {};
  state.debug.lastObjectStateEntry = {
    frame: Number(state.clock.frame ?? 0),
    source,
    entityAddr: entityAddr >>> 0,
    code: code & 0xff,
    active: state.workRam[off + 0x18] ?? 0,
    type: state.workRam[off + 0x19] ?? 0,
    prevState: state.workRam[off + 0x1a] ?? 0,
    prevKind: state.workRam[off + 0x1b] ?? 0,
    prevF36: state.workRam[off + 0x36] ?? 0,
    prevF56: state.workRam[off + 0x56] ?? 0,
    prevF57: state.workRam[off + 0x57] ?? 0,
    prevF58: state.workRam[off + 0x58] ?? 0,
    prevF59: state.workRam[off + 0x59] ?? 0,
    prevF5f: state.workRam[off + 0x5f] ?? 0,
    prevF60: state.workRam[off + 0x60] ?? 0,
    prevX: readLongBE(state.workRam, off + 0x0c) | 0,
    prevY: readLongBE(state.workRam, off + 0x10) | 0,
    prevZ: readLongBE(state.workRam, off + 0x14) | 0,
    prevVx: readLongBE(state.workRam, off + 0x00) | 0,
    prevVy: readLongBE(state.workRam, off + 0x04) | 0,
    prevVz: readLongBE(state.workRam, off + 0x08) | 0,
    prevTargetZ: readLongBE(state.workRam, off + 0x2a) | 0,
    ...extra,
  };
}
