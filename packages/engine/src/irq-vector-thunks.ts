/**
 * irq-vector-thunks.ts — IRQ vector trampoline table.
 *
 * 23 six-byte functions are `jmp targetAddr.l` (opcode 4EF9 plus
 *
 * `enableInterrupts1010A`.
 *
 *   - `THUNK_TABLE`: metadata immutabile (sourceAddr, targetAddr, bytes ROM)
 *   - `enableInterrupts1010A`: replica TS di FUN_01010A.
 *
 * Funzioni coperte (per discovery script):
 *   FUN_000100 FUN_00010C FUN_000112 FUN_000118 FUN_00012A FUN_00013C
 *   FUN_000148 FUN_00014E FUN_00015A FUN_000160 FUN_000178 FUN_00019C
 *   FUN_0001A8 FUN_0001AE FUN_0001B4 FUN_0001C0 FUN_0001C6 FUN_000218
 *   FUN_000224 FUN_000230 FUN_000236 FUN_00023C FUN_000254 FUN_01010A
 */

/** Metadata for an IRQ-vector thunk extracted from ROM. */
export interface ThunkEntry {
  readonly sourceAddr: number;
  /**
   */
  readonly targetAddr: number | null;
  /** Six raw ROM bytes as a big-endian hex string, e.g. "4EF900002A24". */
  readonly romBytes: string;
}

/**
 * Sorted by increasing sourceAddr.
 *
 * 23 entry: `jmp targetAddr.l`  (opcode 4EF9 + addr long).
 *  1 entry: `move #0x2000,SR ; rts`  (0x01010A — enable interrupts).
 */
export const THUNK_TABLE: readonly ThunkEntry[] = [
  /** @sourceAddr 0x000100  jmp 0x00002A24.l */
  { sourceAddr: 0x000100, targetAddr: 0x00002a24, romBytes: "4EF900002A24" },
  /** @sourceAddr 0x00010C  jmp 0x00003A08.l */
  { sourceAddr: 0x00010c, targetAddr: 0x00003a08, romBytes: "4EF900003A08" },
  /** @sourceAddr 0x000112  jmp 0x00003874.l */
  { sourceAddr: 0x000112, targetAddr: 0x00003874, romBytes: "4EF900003874" },
  /** @sourceAddr 0x000118  jmp 0x00002678.l */
  { sourceAddr: 0x000118, targetAddr: 0x00002678, romBytes: "4EF900002678" },
  /** @sourceAddr 0x00012A  jmp 0x00002B50.l */
  { sourceAddr: 0x00012a, targetAddr: 0x00002b50, romBytes: "4EF900002B50" },
  /** @sourceAddr 0x00013C  jmp 0x0000255A.l */
  { sourceAddr: 0x00013c, targetAddr: 0x0000255a, romBytes: "4EF90000255A" },
  /** @sourceAddr 0x000148  jmp 0x00002E18.l */
  { sourceAddr: 0x000148, targetAddr: 0x00002e18, romBytes: "4EF900002E18" },
  /** @sourceAddr 0x00014E  jmp 0x000031D0.l */
  { sourceAddr: 0x00014e, targetAddr: 0x000031d0, romBytes: "4EF9000031D0" },
  /** @sourceAddr 0x00015A  jmp 0x00004CA0.l */
  { sourceAddr: 0x00015a, targetAddr: 0x00004ca0, romBytes: "4EF900004CA0" },
  /** @sourceAddr 0x000160  jmp 0x00003F78.l */
  { sourceAddr: 0x000160, targetAddr: 0x00003f78, romBytes: "4EF900003F78" },
  /** @sourceAddr 0x000178  jmp 0x00004D68.l */
  { sourceAddr: 0x000178, targetAddr: 0x00004d68, romBytes: "4EF900004D68" },
  /** @sourceAddr 0x00019C  jmp 0x00004790.l */
  { sourceAddr: 0x00019c, targetAddr: 0x00004790, romBytes: "4EF900004790" },
  /** @sourceAddr 0x0001A8  jmp 0x000040D8.l */
  { sourceAddr: 0x0001a8, targetAddr: 0x000040d8, romBytes: "4EF9000040D8" },
  /** @sourceAddr 0x0001AE  jmp 0x000041C8.l */
  { sourceAddr: 0x0001ae, targetAddr: 0x000041c8, romBytes: "4EF9000041C8" },
  /** @sourceAddr 0x0001B4  jmp 0x0000428E.l */
  { sourceAddr: 0x0001b4, targetAddr: 0x0000428e, romBytes: "4EF90000428E" },
  /** @sourceAddr 0x0001C0  jmp 0x00004420.l */
  { sourceAddr: 0x0001c0, targetAddr: 0x00004420, romBytes: "4EF900004420" },
  /** @sourceAddr 0x0001C6  jmp 0x00004686.l */
  { sourceAddr: 0x0001c6, targetAddr: 0x00004686, romBytes: "4EF900004686" },
  /** @sourceAddr 0x000218  jmp 0x00003784.l */
  { sourceAddr: 0x000218, targetAddr: 0x00003784, romBytes: "4EF900003784" },
  /** @sourceAddr 0x000224  jmp 0x000037E4.l */
  { sourceAddr: 0x000224, targetAddr: 0x000037e4, romBytes: "4EF9000037E4" },
  /** @sourceAddr 0x000230  jmp 0x00004008.l */
  { sourceAddr: 0x000230, targetAddr: 0x00004008, romBytes: "4EF900004008" },
  /** @sourceAddr 0x000236  jmp 0x00003F3E.l */
  { sourceAddr: 0x000236, targetAddr: 0x00003f3e, romBytes: "4EF900003F3E" },
  /** @sourceAddr 0x00023C  jmp 0x00004C6E.l */
  { sourceAddr: 0x00023c, targetAddr: 0x00004c6e, romBytes: "4EF900004C6E" },
  /** @sourceAddr 0x000254  jmp 0x00004D98.l */
  { sourceAddr: 0x000254, targetAddr: 0x00004d98, romBytes: "4EF900004D98" },
  /**
   * @sourceAddr 0x01010A  move #0x2000,SR ; rts
   */
  { sourceAddr: 0x01010a, targetAddr: null, romBytes: "46FC20004E75" },
] as const;

/**
 * Lookup O(1) per sourceAddr → ThunkEntry.
 * Chiave: sourceAddr normalizzato (number).
 */
export const THUNK_MAP: ReadonlyMap<number, ThunkEntry> = new Map(
  THUNK_TABLE.map((e) => [e.sourceAddr, e]),
);

/**
 * Replica TS di `FUN_01010A` (6 byte: `move #0x2000,SR ; rts`).
 *
 *   - Supervisor mode (bit 13 = 1).
 *   - IPL = 0: tutte le interrupt hardware abilitate.
 *   - Bit di condizione (C/V/Z/N/X) non alterati (SR load esplicito).
 *
 */
export function enableInterrupts1010A(): void {
  // move #0x2000,SR — supervisor mode + IPL=0.
}
