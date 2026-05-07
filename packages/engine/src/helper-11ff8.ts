/**
 * helper-11ff8.ts — replica `FUN_00011FF8` (hiscore table renderer, ~0x172 byte).
 *
 * **Funzione**: confronta le 10 entry della hi-score table con i default ROM
 * (`0x1EEA0`), poi rende la lista completa dei 10 punteggi sul display alfanumerico.
 *
 * **Argomento stack**: `arg1Long` (long BE a `SP+0x1C` dopo movem, low byte =
 * `D2b`). Dai caller noti:
 *   - `FUN_11452 case 2` @ `0x115C4`: puscia `move.l #-0x1,-(SP)` → `D2b = 0xFF`
 *   - `FUN_11B18` @ `0x11B86`: puscia `ext.l(D4b)` → `D2b = low byte del D4b`
 *
 * **Logica generale** (tre fasi):
 *
 * ### Fase 1 — match-scan (D3b = 0..9)
 * Confronta la hi-score entry `D3b` (decodificata da workRam via `FUN_41C8`)
 * con l'entry ROM default `0x1EEA0 + D3b*8`:
 *   - Confronto di 3 byte iniziali (offset +4,+5,+6 sia del decoded che del ROM)
 *   - Confronto del long score (offset +0)
 *   - `D4b` parte a 1: qualsiasi mismatch lo azzera definitivamente.
 *   - Se `D4b` rimane 1 → match trovato → esci anticipatamente con `D3b` = indice.
 *   - Se `D4b` diventa 0 → loop esaurisce (D3b=10), nessun match.
 *
 * ### Fase 2 — render header
 * - `D4b == 1 AND mode != 2`: `renderString(0x228fa, 0x1400)` (titolo "default" table)
 * - Altrimenti: `renderStringEntry286B0(0x22ea2, 0xf, D0, 0x1400)`
 *   dove `D0 = 3` se mode==2, `D0 = 9` altrimenti.
 *
 * ### Fase 3 — render entries (D3b = 0..9)
 * Per ogni D3b:
 *   - Se `D3b < D2b AND D2b != 0xFF`: decodifica entry `D3b - 1`; altrimenti `D3b`.
 *   - Costruisce stringa in `*(0x40041E)`: `[space] "#" rank_str " " initials_null_term`
 *     (spazio iniziale omesso per D3b==9; rank: "10" per D3b==9, "1".."9" per D3b==0..8)
 *   - Chiama `renderStringEntry28F62(0xd, D4b, 0x1000)` per la riga
 *   - Chiama `fun_28e3c(score, 0, D4b, 0x14, 7, 0x1000)` per il punteggio
 *   - `D4b++`
 *
 * **Disasm FUN_00011FF8 completo**:
 *
 *   00011ff8  movem.l {A3 A2 D5 D4 D3 D2},-(SP)   ; save 6 reg (24 byte)
 *   00011ffc  move.b  (0x1f,SP),D2b               ; D2b = low byte of arg1
 *   00012000  movea.l #0x400390,A3                ; A3 = &workRam[0x390] (mode word)
 *   00012006  moveq   0x1,D4                      ; D4 = 1 (match flag)
 *   00012008  movea.l #0x1eea0,A2                 ; A2 = ROM default table
 *   0001200e  clr.b   D3b                         ; D3 = 0 (entry index)
 *
 *   ; ── OUTER LOOP (match scan) ──────────────────────────────────────────────
 *   00012010  [ext.l(D3b)] move.l D0,-(SP)        ; push arg = ext_l(D3b)
 *   00012018  jsr     0x1ae.l                     ; → hiScoreDecode41c8: A1 = result
 *   0001201e  movea.l D0,A1
 *   00012020  clr.b   D5b                         ; D5 = 0 (inner index 0..2)
 *   00012022  addq.l  0x4,SP
 *   ; ── INNER LOOP (compare 3 initials bytes) ──────────────────────────────
 *   00012024  [ext.w(D5b)] lea (0x4,A1),A0
 *   0001202c  move.b  (0x0,A0,D0w*1),D0b         ; D0b = A1[4+D5]
 *   00012030  [ext.w(D5b)] lea (0x4,A2),A0
 *   00012038  cmp.b   (0x0,A0,D1w*1),D0b         ; cmp D0b vs A2[4+D5]
 *   0001203c  beq.b   0x12040                    ; equal → skip clear
 *   0001203e  clr.b   D4b                        ; mismatch → D4b = 0
 *   00012040  addq.b  0x1,D5b
 *   00012042  cmpi.b  #0x3,D5b
 *   00012046  bne.b   0x12024
 *   ; ── Compare score long ──────────────────────────────────────────────────
 *   00012048  move.l  (A1),D0
 *   0001204a  cmp.l   (A2),D0                    ; compare score long
 *   0001204c  beq.b   0x12050
 *   0001204e  clr.b   D4b
 *   00012050  tst.b   D4b
 *   00012052  bne.w   0x12060                    ; D4b=1 → match found, exit
 *   00012056  addq.l  0x8,A2                     ; A2 += 8 (next ROM entry)
 *   00012058  addq.b  0x1,D3b
 *   0001205a  cmpi.b  #0xa,D3b
 *   0001205e  bne.b   0x12010
 *
 *   ; ── POST-LOOP ────────────────────────────────────────────────────────────
 *   00012060  tst.b   D4b
 *   00012062  beq.b   0x1207e                    ; D4b=0 → no match
 *   00012064  moveq   0x2,D0; cmp.w (A3),D0w
 *   00012068  beq.b   0x1207e                    ; mode==2 → skip "default" title
 *   0001206a  pea     (0x1400).w
 *   0001206e  pea     (0x228fa).l
 *   00012074  jsr     0x142.l                    ; renderString(0x228fa, 0x1400)
 *   0001207a  addq.l  0x8,SP
 *   0001207c  bra.b   0x120a4
 *
 *   0001207e  moveq   0x2,D0; cmp.w (A3),D0w
 *   00012082  bne.b   0x12088; moveq 0x3,D0; bra 0x1208a
 *   00012088  moveq   0x9,D0
 *   0001208a  pea     (0x1400).w; move.l D0,-(SP); pea (0xf).w; pea (0x22ea2).l
 *   0001209a  jsr     0x286b0.l
 *   000120a0  lea     (0x10,SP),SP               ; pop 4 args
 *
 *   ; ── RENDER LOOP setup ────────────────────────────────────────────────────
 *   000120a4  moveq 0x2,D0; cmp.w (A3),D0w; bne 120ae; moveq 0xd,D0; bra 120b0
 *   000120ae  moveq 0xb,D0
 *   000120b0  move.b D0b,D4b                     ; D4b = 0xd (mode=2) or 0xb
 *   000120b2  clr.b  D3b                         ; D3b = 0 (render loop counter)
 *
 *   ; ── RENDER LOOP (D3b = 0..9) ─────────────────────────────────────────────
 *   000120b4  cmp.b D2b,D3b; ble.b 120d4; cmpi.b #-1,D2b; beq.b 120d4
 *   000120be  [ext.l(D3b-1)] jsr 0x1ae → A2   ; decode entry D3b-1
 *   000120d2  bra.b 0x120e6
 *   000120d4  [ext.l(D3b)] jsr 0x1ae → A2     ; decode entry D3b
 *
 *   000120e6  movea.l (0x0040041e).l,A1         ; A1 = *(0x40041e) (string buf ptr)
 *   000120ec  cmpi.b  #0x9,D3b
 *   000120f0  beq.b   0x120f6                   ; D3b==9 → no leading space
 *   000120f2  move.b  #0x20,(A1)+               ; write space
 *   000120f6  move.b  #0x23,(A1)+               ; write '#'
 *   000120fa  cmpi.b  #0x9,D3b
 *   000120fe  bne.b   0x1210a
 *   00012100  move.b #0x31,(A1)+; move.b #0x30,(A1)+; bra 0x12114 ; "10"
 *   0001210a  [D3b+0x31] move.b D0b,(A1)+      ; "1".."9"
 *   00012114  move.b  #0x20,(A1)+               ; write trailing space
 *   00012118  lea (0x4,A2),A0
 *   0001211c  move.b (A0)+,(A1)+; bne 0x1211c  ; copy initials (null-term)
 *
 *   00012120  pea (0x1000).w; [D4b ext.l push]; pea (0xd).w
 *   00012130  jsr 0x28f62.l                     ; renderStringEntry28F62(0xd, D4b, 0x1000)
 *   00012136  pea(0x1000); pea(7); pea(0x14); [D4b ext.l]; clr.l; (A2)long
 *   0001214e  jsr 0x28e3c.l                     ; fun_28e3c(score, 0, D4b, 0x14, 7, 0x1000)
 *   00012154  addq.b 0x1,D4b
 *   00012156  lea (0x24,SP),SP                  ; pop 9 longs (jsr 28f62: 3 + jsr 28e3c: 6)
 *   0001215a  addq.b 0x1,D3b
 *   0001215c  cmpi.b #0xa,D3b
 *   00012160  bne.w  0x120b4
 *   00012164  movem.l (SP)+,{D2 D3 D4 D5 A2 A3}
 *   00012168  rts
 *
 * **Side effects** (workRam):
 *   - `workRam[0x41C..0x41E]` — string-chain entry col/tickOff/marker (via renderStringEntry28F62)
 *   - `workRam[0x41E..0x421]` — string buf pointer (read) and string written there
 *   - `workRam[0x1F7A..0x1F80]` — hi-score decode buffer (via hiScoreDecode41c8 calls)
 *
 * **JSR sub-calls injectable**:
 *   - `renderString0142` — `FUN_2572` via thunk 0x142 (renders 0x228fa)
 *   - `renderStringEntry286B0` — renders table header string
 *   - `hiScoreDecode41c8` — decodes hi-score entry from workRam
 *   - `renderStringEntry28F62` — renders hi-score row label
 *   - `fun_28e3c` — renders numeric score value
 *
 * **Caller**: `mainLoopInit11452 case2` → wired as default sub via
 * `MainLoopInit11452Subs.helper11FF8`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { hiScoreDecode41c8 } from "./hi-score-decode-41c8.js";
import { renderStringEntry28F62 } from "./render-string-entry-28f62.js";
import { renderStringEntry286B0 } from "./render-string-entry-286b0.js";

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
   * Called as `(score_long, 0, D4b, 0x14, 7, 0x1000)` per row.
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
 * Replica bit-perfect di `FUN_00011FF8`.
 *
 * Hi-score table renderer: scansiona le 10 entry della hi-score table
 * (confrontandole con i default ROM @ `0x1EEA0`), poi rende ognuna sul display
 * alfanumerico con rank number, iniziali e punteggio.
 *
 * @param state  GameState. Lettura: `workRam[0x390]` (mode), `workRam[0x41e]`
 *               (string buf ptr), `workRam[0x1F7A..]` (decode buf).
 *               Scrittura: `workRam[0x41C..0x41E]` (entry), `workRam[0x1F7A..]`.
 * @param rom    ROM image (richiesta per leggere la tabella default `0x1EEA0`
 *               e i puntatori string `0x22EA2`).
 * @param arg1   Long arg dallo stack (`D2b = arg1 & 0xFF`). Default: 0xFF.
 * @param subs   Sub injection per le JSR non replicate (default no-op).
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

    // fun_28e3c(state, score_from_a2, 0, D4b, 0x14, 7, 0x1000)
    // A2 can be any address (ROM or workRam), use readAbsLong.
    const scoreLong = readAbsLong(state, rom, a2);
    subs.fun_28e3c?.(state, scoreLong, 0, d4b, 0x14, 7, 0x1000);

    // D4b++ (byte increment)
    d4b = (d4b + 1) & 0xff;
  }
}

/**
 * Default implementation for `MainLoopInit11452Subs.helper11FF8`.
 * Calls `helper11FF8(state, rom, 0xff, {})`.
 */
export function helper11FF8Default(state: GameState, rom?: RomImage): void {
  helper11FF8(state, rom, 0xff);
}
