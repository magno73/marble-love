/**
 * Bit-perfect port of `FUN_00011FF8`, the high-score table renderer.
 *
 * The routine scans the 10 decoded high-score entries against the ROM default
 * table at `0x1EEA0`, renders the appropriate table header, then renders all
 * rows with rank, initials, and numeric score. The stack argument is observed
 * only through its low byte (`D2b`).
 *
 * The implementation keeps the original three phases explicit because each
 * phase has externally visible side effects through the string buffer,
 * high-score decode scratch area, and injected render subcalls. The default
 * wiring is used by `MainLoopInit11452Subs.helper11FF8`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { hiScoreDecode41c8 } from "./hi-score-decode-41c8.js";
import { renderStringEntry28F62 } from "./render-string-entry-28f62.js";
import { renderStringEntry286B0 } from "./render-string-entry-286b0.js";
import { renderScore28E3C } from "./render-score-28e3c.js";
import { stateSub2572 } from "./state-sub-2572.js";
import { formatNumber3874 } from "./string-format.js";

export const HELPER_11FF8_ADDR = 0x00011ff8 as const;

const WRAM = 0x00400000;

/** ROM default hi-score table base address (10 entries × 8 bytes). */
const ROM_TABLE_BASE = 0x1eea0 as const;

/** ROM string ptr table for hi-score entries (10 entries × 4 bytes). */
const ROM_STRING_PTR_TABLE = 0x00022ea2 as const;

/** ROM "default table" title string. */
const ROM_TITLE_STRING = 0x000228fa as const;

/** WorkRam address of game mode word. */
const MODE_ADDR = 0x00400390 as const;

/** WorkRam address of string buffer pointer (long). */
const STRING_BUF_PTR_ADDR = 0x0040041e as const;

// ── helpers ──────────────────────────────────────────────────────────────────

function off(addr: number): number {
  return addr - WRAM;
}

function rw(state: GameState, addr: number): number {
  return (((state.workRam[off(addr)] ?? 0) << 8) | (state.workRam[off(addr) + 1] ?? 0)) & 0xffff;
}

function rl(state: GameState, addr: number): number {
  const o = off(addr);
  return (
    (((state.workRam[o] ?? 0) << 24) |
      ((state.workRam[o + 1] ?? 0) << 16) |
      ((state.workRam[o + 2] ?? 0) << 8) |
      (state.workRam[o + 3] ?? 0)) >>>
    0
  );
}

const WRAM_END = WRAM + 0x2000;
const ROM_END = 0x80000; // 512 KiB program ROM

function readRomByte(rom: RomImage, addr: number): number {
  return (rom.program[addr] ?? 0) & 0xff;
}

function readRomLong(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>>
    0
  );
}

/**
 * Read a byte from an absolute M68k address — dispatches to ROM or workRam.
 * Matches the binary's bus access (ROM at 0x000000-0x07FFFF, workRam at 0x400000-0x401FFF).
 * Used for the `(A2+4)` initials-copy loop where A2 can be any address
 * (e.g., small value from patched-rts hiScoreDecode → reads ROM bytes).
 */
function readAbsByte(state: GameState, rom: RomImage | undefined, absAddr: number): number {
  const a = absAddr >>> 0;
  if (a >= WRAM && a < WRAM_END) {
    return (state.workRam[a - WRAM] ?? 0) & 0xff;
  }
  if (rom !== undefined && a < ROM_END) {
    return (rom.program[a] ?? 0) & 0xff;
  }
  return 0;
}

/**
 * Read a long from an absolute M68k address — dispatches to ROM or workRam.
 */
function readAbsLong(state: GameState, rom: RomImage | undefined, absAddr: number): number {
  const a = absAddr >>> 0;
  if (a >= WRAM && a + 4 <= WRAM_END) {
    const o = a - WRAM;
    return (
      (((state.workRam[o] ?? 0) << 24) |
        ((state.workRam[o + 1] ?? 0) << 16) |
        ((state.workRam[o + 2] ?? 0) << 8) |
        (state.workRam[o + 3] ?? 0)) >>>
      0
    );
  }
  if (rom !== undefined && a + 4 <= ROM_END) {
    return readRomLong(rom, a);
  }
  return 0;
}

/**
 * Sign-extend byte to 32-bit value (M68k `ext.w; ext.l` on byte).
 */
function signExtByte(b: number): number {
  const v = b & 0xff;
  return v & 0x80 ? ((v | 0xffffff00) >>> 0) : v;
}

// ── Sub injection interface ───────────────────────────────────────────────────

export interface Helper11FF8Subs {
  /**
   * `FUN_2572` via thunk `0x142` — renders a ROM string at tile base attr.
   * Called as `renderString(stringAddr, attr)` when the hi-score table
   * matches the ROM defaults AND mode != 2.
   * Default: no-op.
   */
  renderString0142?: (state: GameState, textPtr: number, attr: number) => void;

  /**
   * `FUN_286B0` — renders table header (string pointer from ROM table).
   * Called with `(0x22ea2, 0xf, D0, 0x1400)` where D0=3 (mode=2) or D0=9.
   * Default: no-op (delegates to `renderStringEntry286B0` if rom available).
   */
  renderStringEntry286B0?: (
    state: GameState,
    arg1Long: number,
    arg2Long: number,
    arg3Long: number,
    arg4Long: number,
  ) => void;

  /**
   * `FUN_41C8` via thunk `0x1AE` — decodes a hi-score entry from workRam
   * into the decode buffer at `0x401F7A`. Returns `0x401F7A` on success
   * or `0` on out-of-range arg.
   * Default: delegates to `hiScoreDecode41c8`.
   */
  hiScoreDecode41c8?: (state: GameState, arg1: number) => number;

  /**
   * `FUN_28F62` — writes string-chain entry (col, tickOff, marker) and
   * triggers `renderStringChain` for the current hi-score row.
   * Called as `(0xd, D4b, 0x1000)` per row.
   * Default: delegates to `renderStringEntry28F62`.
   */
  renderStringEntry28F62?: (
    state: GameState,
    arg1Long: number,
    arg2Long: number,
    arg3Long: number,
  ) => void;

  /**
   * `FUN_28E3C` — numeric score renderer (6-arg format-and-render).
   * Called as `(score_long, 0, 0x14, D4b, 7, 0x1000)` per row.
   * Default: no-op.
   */
  fun_28e3c?: (
    state: GameState,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
  ) => void;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Render the high-score table exactly as `FUN_00011FF8` does.
 *
 * @param state Game state mutated through the string entry, string buffer, and
 *              decode scratch work RAM.
 * @param rom ROM image for the default table and string pointer table.
 * @param arg1 Long stack argument; the binary reads only `arg1 & 0xff`.
 * @param subs Optional injections for the ROM JSR targets.
 */
export function helper11FF8(
  state: GameState,
  rom?: RomImage,
  arg1: number = 0xff,
  subs: Helper11FF8Subs = {},
): void {
  // D2b = low byte of arg1 (M68k: `move.b (0x1F, SP), D2b` = low byte of long arg).
  const d2b = arg1 & 0xff;

  // A3 = &workRam[0x390] → mode word (match-scan uses D4b as flag, phase 3 repurposes it)
  const mode = rw(state, MODE_ADDR);

  // D4b = 1 (match flag for phase 1; repurposed as row tile offset in phase 3)
  let d4b = 1;

  // ── Phase 1: match-scan (D3b = 0..9) ────────────────────────────────────
  // D4b starts at 1. Any mismatch clears it to 0 permanently (no reset per
  // iteration). If D4b is still 1 after checking entry D3b → match found,
  // exit loop early. Otherwise D4b stays 0 for all remaining iterations and
  // the loop exhausts to D3b=10 (but D4b can never become 1 again).
  //
  // IMPORTANT: each iteration calls hiScoreDecode41c8 which modifies workRam
  // at 0x401F7A..0x401F80. We must call it even when D4b=0.

  const decodeEntry = subs.hiScoreDecode41c8 ?? ((s: GameState, idx: number) => hiScoreDecode41c8(s, idx));

  for (let d3bScan = 0; d3bScan < 10; d3bScan++) {
    // jsr 0x1ae → hiScoreDecode41c8(state, ext_l(D3b))
    const a1 = decodeEntry(state, signExtByte(d3bScan)) >>> 0;

    // A2 = ROM_TABLE_BASE + d3bScan * 8
    const romEntryBase = ROM_TABLE_BASE + d3bScan * 8;

    // Inner loop: compare 3 initials bytes (offset +4, +5, +6) — only relevant
    // when D4b=1, but D4b can only go from 1→0, never 0→1.
    // Note: A1 can be any value returned by hiScoreDecode41c8 (incl. small
    // values like 0..9 when the sub is patched to rts), so we use readAbsByte
    // which dispatches to ROM or workRam based on the absolute address.
    for (let d5b = 0; d5b < 3; d5b++) {
      // A1[4+D5] = read byte at absolute address (A1+4+D5)
      const decodedByte = readAbsByte(state, rom, (a1 + 4 + d5b) >>> 0);
      const romByte = rom ? readRomByte(rom, romEntryBase + 4 + d5b) : 0;
      if (decodedByte !== romByte) {
        d4b = 0;
      }
    }

    // Compare score long: (A1) vs (A2)
    // A1 can be any address (ROM or workRam), use readAbsLong.
    const decodedScore = readAbsLong(state, rom, a1);
    const romScore = rom ? readRomLong(rom, romEntryBase) : 0;
    if (decodedScore !== romScore) {
      d4b = 0;
    }

    // tst D4b; bne.w 0x12060 → if D4b still 1, match found, exit
    if (d4b !== 0) {
      break;
    }

    // D4b = 0: continue outer loop to D3b=10.
    // (D4b never recovers, but we must still call decodeEntry for each entry
    // to replicate the workRam side effects of those calls.)
  }

  // After loop: d4b = 1 (match) or 0 (no match); d3bScan = matched index or 10.

  // ── Phase 2: render header ────────────────────────────────────────────────
  if (d4b !== 0 && mode !== 2) {
    // D4b=1 AND mode!=2: render ROM title string @ 0x228fa with attr 0x1400
    subs.renderString0142?.(state, ROM_TITLE_STRING, 0x1400);
    // bra.b 0x120a4 → skip the 286b0 call
  } else {
    // D4b=0 OR mode==2: render table string via 286b0
    // D0 = 3 if mode==2, else 9
    const d0 = mode === 2 ? 3 : 9;
    // jsr 0x286b0(0x22ea2, 0xf, D0, 0x1400)
    if (subs.renderStringEntry286B0 !== undefined) {
      subs.renderStringEntry286B0(state, ROM_STRING_PTR_TABLE, 0xf, d0, 0x1400);
    } else if (rom !== undefined) {
      renderStringEntry286B0(state, ROM_STRING_PTR_TABLE, 0xf, d0, 0x1400, undefined, (absAddr) =>
        (rom.program[absAddr] ?? 0) & 0xff
      );
    }
  }

  // ── Phase 3: render entries (D3b = 0..9) ─────────────────────────────────
  // D4b = 0xd (mode==2) or 0xb (mode!=2) — row tile offset
  d4b = mode === 2 ? 0xd : 0xb;

  // D3b = 0 (render loop counter, separate from match-scan D3b)
  for (let d3b = 0; d3b < 10; d3b++) {
    let a2: number;
    // cmp.b D2b,D3b; ble.b 120d4 → if D3b <= D2b, use D3b
    // cmpi.b #-1,D2b; beq.b 120d4 → if D2b==0xFF (-1), use D3b
    if (d3b > d2b && d2b !== 0xff) {
      // decode entry D3b - 1
      a2 = decodeEntry(state, signExtByte(d3b - 1)) >>> 0;
    } else {
      // decode entry D3b
      a2 = decodeEntry(state, signExtByte(d3b)) >>> 0;
    }

    // A1 = *(0x40041e) (string buffer write pointer)
    const a1Ptr = rl(state, STRING_BUF_PTR_ADDR);

    // Write formatted rank string to buffer at A1:
    // [space] "#" rank " " initials_null_term
    // (space omitted for D3b == 9)
    let writeOff = a1Ptr - WRAM;
    if (writeOff >= 0 && writeOff < state.workRam.length) {
      // Optional leading space (omitted for rank #10, i.e. D3b==9)
      if (d3b !== 9) {
        state.workRam[writeOff++] = 0x20; // space
      }
      // '#'
      state.workRam[writeOff++] = 0x23;
      // Rank number
      if (d3b === 9) {
        state.workRam[writeOff++] = 0x31; // '1'
        state.workRam[writeOff++] = 0x30; // '0'
      } else {
        // D3b + 0x31 = ASCII '1'..'9'
        state.workRam[writeOff++] = ((d3b + 0x31) & 0xff);
      }
      // Trailing space
      state.workRam[writeOff++] = 0x20;

      // Copy null-terminated initials from absolute address (A2+4).
      // A2 can point anywhere in memory (ROM or workRam), so use readAbsByte.
      // The loop copies including the terminating null byte
      // (matching M68k `move.b (A0)+,(A1)+; bne 0x1211c`).
      {
        let srcAddr = (a2 + 4) >>> 0;
        let ch: number;
        do {
          ch = readAbsByte(state, rom, srcAddr++);
          state.workRam[writeOff++] = ch;
        } while (ch !== 0);
      }
    }

    // renderStringEntry28F62(state, 0xd, D4b, 0x1000)
    if (subs.renderStringEntry28F62 !== undefined) {
      subs.renderStringEntry28F62(state, 0xd, d4b, 0x1000);
    } else {
      renderStringEntry28F62(state, 0xd, d4b, 0x1000);
    }

    // fun_28e3c(state, score_from_a2, 0, 0x14, D4b, 7, 0x1000)
    // A2 can be any address (ROM or workRam), use readAbsLong.
    const scoreLong = readAbsLong(state, rom, a2);
    subs.fun_28e3c?.(state, scoreLong, 0, 0x14, d4b, 7, 0x1000);

    // D4b++ (byte increment)
    d4b = (d4b + 1) & 0xff;
  }
}

/**
 * Default implementation for `MainLoopInit11452Subs.helper11FF8`.
 * Calls `helper11FF8(state, rom, 0xff, {})`.
 */
export function helper11FF8Default(state: GameState, rom?: RomImage): void {
  if (rom === undefined) {
    helper11FF8(state, rom, 0xff);
    return;
  }

  const renderStringChain = (s: GameState, structAddr: number, attrWord: number): void => {
    stateSub2572(s, rom, structAddr, attrWord);
  };
  const romRead8 = (absAddr: number): number => (rom.program[absAddr] ?? 0) & 0xff;

  helper11FF8(state, rom, 0xff, {
    renderString0142: (s, textPtr, attr) => {
      renderStringChain(s, textPtr, attr);
    },
    renderStringEntry286B0: (s, arg1, arg2, arg3, arg4) => {
      renderStringEntry286B0(
        s,
        arg1,
        arg2,
        arg3,
        arg4,
        { renderStringChain: (structAddr, attrWord) => renderStringChain(s, structAddr, attrWord) },
        romRead8,
      );
    },
    renderStringEntry28F62: (s, arg1, arg2, arg3) => {
      renderStringEntry28F62(
        s,
        arg1,
        arg2,
        arg3,
        { renderStringChain: (structAddr, attrWord) => renderStringChain(s, structAddr, attrWord) },
      );
    },
    fun_28e3c: (s, arg1, arg2, arg3, arg4, arg5, arg6) => {
      renderScore28E3C(s, arg1, arg2, arg3, arg4, arg5, arg6, {
        numberFormatter: (st, value, bufEnd, fmtMode, width, fillExtra) => {
          formatNumber3874(st, value, bufEnd, fmtMode, width, fillExtra);
        },
        renderStringEntry28F62: (st, col, tickOff, attr) => {
          renderStringEntry28F62(
            st,
            col,
            tickOff,
            attr,
            { renderStringChain: (structAddr, attrWord) => renderStringChain(st, structAddr, attrWord) },
          );
        },
      });
    },
  });
}
