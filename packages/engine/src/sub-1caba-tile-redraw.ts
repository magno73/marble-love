/**
 * sub-1caba-tile-redraw.ts — replica `FUN_0001CABA` (442 byte, 0x1CABA..0x1CC5C).
 *
 * "Heavy tile-redraw"/projection helper: scansiona la "diagonal scanline"
 * sotto la corrente posizione tile (`*0x400696`, `*0x400698`), legge il
 * terrain z per 4 sub-tile (= 16 word) dalla level data + binsearch table,
 * e popola STRUCT @ 0x401C28 (16 word = 32 byte). Output usato da
 * `spriteProject1CC62` per il proj-z.
 *
 * **Calling convention M68k** (no args, RTS):
 *   - Nessun arg sullo stack.
 *   - Side-effect: scrive `workRam[0x1c28..0x1c47]` (16 word) ed eventualmente
 *     legge `workRam[0x40065a].l` come ptr binsearch base.
 *
 * **Disasm 0x1CABA..0x1CC60** (~150 istruzioni, 4 iter di scanline):
 *
 *   ; --- Prologo (0x1CABA..0x1CB12) ---
 *   movem.l {A2..A6, D2..D6}, -(SP)
 *   A5 = #0x401c28              ; A5 = STRUCT base (autoinc per write)
 *   A0 = #0x400474              ; A0 = ptr to level header ptr
 *   A2 = #0x1ed62               ; A2 = ROM table (terrain coef, 32 word)
 *   A1 = (A0)                   ; A1 = level header ptr
 *   A0 = (A1)                   ; A0 = direct terrain byte-record base
 *   D0w = *(0x400696)           ; tileX (= obj.x >> 3)
 *   D4w = *(0x400698)           ; tileY (= obj.y >> 3)
 *   D4w = (D4w + 1 + tileX) - 0x15
 *   D4 = ext.l(D4w)             ; long sign-extend
 *   D6w = 0x15 - D0w + (D4w asr 1) ; first iteration's "x-offset" start
 *   A6 = #0x24b3a               ; A6 = ROM table (loop step, 12 word/half)
 *   if (D4 & 1): A6 += 0x12     ; choose even/odd half
 *   A4 = #0x400478 + D4*4       ; workRam ptr (per-column X offsets)
 *   D2w = (0x18, A1)            ; max-tile-idx bound from level header
 *   D3w = 0                     ; loop counter (0..3)
 *
 *   ; --- LOOP (0x1CB14): 4 iter, each writes 4 words to (A5) ---
 *   LOOP:
 *     if (D4w < 0): bra epilog  ; out-of-bounds top
 *     if (D4w >= D2w): bra epilog ; out-of-bounds bottom
 *     D0w = D6w                 ; start "x-offset" for this row
 *     D1 = (D4 & 0xff) with bit 0 cleared
 *     if (bit 0 was set): D0w += 0x16  ; choose alternate base for odd rows
 *     A0 = #0x1eb3a             ; ROM table — word offsets for playfield access
 *     A3 = #0xa00000            ; playfield RAM base
 *     A3.w += (A0+D1)           ; A3 += word offset for row D1
 *     A0 = #0x1ed0a             ; ROM table — D1 byte deltas (0x2c entries)
 *     D1b = *(A0 + D0w*1)       ; D1.b = byte from table at index D0
 *     D1 -= 2; A3 += D1         ; A3 += (D1-2) → final playfield address
 *     D1 = (A3).l               ; D1 = long at playfield position
 *     D0b = *(A0 + 0x2c + D0w)  ; D0.b = shift count from same table
 *     D1 lsr D0                 ; D1 >>= D0 (logical, byte select)
 *     D1w &= 0x7fe              ; mask to even word index
 *     A0 = *(0x40065a)          ; A0 = workRam ptr (bsearch base)
 *     D0w = (A0 + D1w)          ; D0w = binsearch result (terrain tile code)
 *
 *     ; --- Dispatch on D0w (terrain code) ---
 *     if D0w >= 0x1000: goto PATH_TERRAIN_BIG (0x1CBD0)
 *     if D0w >= 0x800:  goto PATH_INDIRECT   (0x1CBC0)
 *     if D0w == 0:      goto END_OF_ITER
 *
 *     ; --- PATH_DIRECT (0x1CB76): D0 ∈ [1..0x7FF] ---
 *     A0 = D0 + *(lvlPtr+0)     ; A0 = direct terrain byte-record ptr
 *     D1w = (A4) - 0x80         ; D1 = tile X offset - 0x80
 *     repeat 4×:
 *       D0w = 0
 *       D0b = (A0)+
 *       if D0b == 0: (A5)+ = 0 (clear word)
 *       else: D0w = D0w + D1w (i.e. byte + offset); (A5)+ = D0w
 *     ; 4th iter branches to END_OF_ITER instead of falling through
 *
 *     ; --- PATH_INDIRECT (0x1CBC0): D0 ∈ [0x800..0xFFF] ---
 *     D0w &= 0x7fe
 *     A0 = #0x40076e            ; workRam ptr (alt bsearch table)
 *     D0w = (A0 + D0w)
 *     goto re-dispatch at 0x1CB64
 *
 *     ; --- PATH_TERRAIN_BIG (0x1CBD0): D0 ∈ [0x1000..0xEFFF] ---
 *     if D0w >= 0xF000: goto PATH_TERRAIN_TOP (0x1CC2E)
 *     D5w = D0w                 ; save for bit tests
 *     D0w = D0w & 0x7f; D0w -= 0x40; D0w += (A4)  ; "base height"
 *     D1w = D5w asr 6 & 0x3e    ; index into A2 table
 *     D1w = (A2 + D1w)          ; coef from 0x1ed62
 *     if D1w == 0x1000: D1w = 0
 *     else: D1w = -D1w + D0w    ; alternative height
 *     ; 4 conditional writes per bit 12..15 of D5
 *     for i in 12..15:
 *       (A5)+ = (D5 bit i set ? D0 : D1)
 *     goto END_OF_ITER
 *
 *     ; --- PATH_TERRAIN_TOP (0x1CC2E): D0 ∈ [0xF000..0xFFFF] ---
 *     D0w = D0w & 0x7f - 0x40 + (A4)
 *     4× (A5)+ = D0w
 *
 *     ; --- END_OF_ITER (0x1CC46) ---
 *     D6w += (A6)+              ; D6 advances by ROM table step
 *     D0w = (A6)+
 *     D4w += D0w                ; D4 advances by ROM step (next "row")
 *     A4 += D0w * 2             ; A4 advances 2*D0 bytes
 *     A5 += (A6)+               ; A5 advances by ROM table step (next sub-block)
 *     D3w += 1
 *     if D3 != 4: bra LOOP
 *
 *   ; --- Epilog (0x1CC5C) ---
 *   movem.l (SP)+, restore
 *   rts
 *
 * **ROM tables**:
 *   - `0x1eb3a` (word table, ~340 entries): playfield word offset per row index.
 *   - `0x1ed0a` (byte table, 0x58 entries): 0..0x2b = byte offset, 0x2c..0x57 = shift count.
 *   - `0x1ed62` (word table, 16 entries): terrain coef for big-terrain path.
 *   - `0x24b3a` (word table, ~12+ entries): loop step values (D6, D4, A5 deltas).
 *
 * **WorkRam reads**:
 *   - `*0x400474.l`: level header ptr (A1).
 *   - `*0x400478..0x4007FF` (A4): per-column X offset words.
 *   - `*0x40065a.l`: binsearch table ptr.
 *   - `*0x400696.w`: tileX (post-derive).
 *   - `*0x400698.w`: tileY (post-derive).
 *   - `*0x40076e..0x40087F`: alt bsearch table (workRam).
 *   - `*(A1+0x18).w`: max tile bound from level header.
 *
 * **WorkRam writes**:
 *   - `0x401c28..0x401c47` (STRUCT, 32 byte = 16 word): terrain heights per sub-tile.
 *
 * **Playfield RAM reads** (via PF_RAM_BASE = 0xA00000):
 *   - playfield long at offset derived from tile coords + ROM table.
 *
 * **Parity status**: bit-perfect 54/54 vs MAME (window f173..f257 in
 * boot/level-init; FUN_1CABA is NOT called in attract f12000..12099). See
 * `packages/cli/src/test-sub-1caba-parity.ts` + `oracle/mame_1caba_capture.lua`.
 *
 * **Impact on attract drift**: ZERO. FUN_1CABA is invoked only at level-init
 * time, not during the attract window used by `probe-100f-diff.ts`. STRUCT @
 * 0x401C28 stays at `3fdc*16` throughout f12000..12099 in MAME (verified via
 * tap on writes to 0x401C28..0x401C47 — 32 writes total in f0..f12010, all
 * during boot, all with value 0). TS preserves the warm-state value
 * identically (`probe-struct-1c28.ts` 99/99 OK).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Constants ─────────────────────────────────────────────────────────────

/** Indirizzo assoluto M68k di `FUN_0001CABA`. */
export const SUB_1CABA_ADDR = 0x0001caba as const;

/** Base workRam (M68k 0x400000). */
const WORK_RAM_BASE = 0x00400000 as const;
/** Base playfield RAM (M68k 0xa00000). Aliased a `state.workRam` via bus. */
const PF_RAM_BASE = 0x00a00000 as const;

/** STRUCT @ 0x401c28..0x401c47 (16 word). */
const STRUCT_OFF = 0x1c28;

/** Globals offset (relativi a workRam base). */
const OFF_LVLPTR = 0x0474; // *0x400474.l — level header ptr
const OFF_TILE_X = 0x0696; // *0x400696.w — tile X (post-derive)
const OFF_TILE_Y = 0x0698; // *0x400698.w — tile Y (post-derive)
const OFF_COL_BASE = 0x0478; // *0x400478..  — per-column X offset words
const OFF_BSEARCH_PTR = 0x065a; // *0x40065a.l — bsearch table ptr (M68k abs)
const OFF_BSEARCH_ALT = 0x076e; // *0x40076e..  — alt bsearch table (workRam)

/** ROM table addresses (absolute, into rom.program). */
const ROM_TBL_24B3A = 0x24b3a; // loop step table (word entries)
const ROM_TBL_1EB3A = 0x1eb3a; // playfield word offset table (word entries)
const ROM_TBL_1ED0A = 0x1ed0a; // byte deltas + shift counts (byte entries, 0x58)
const ROM_TBL_1ED62 = 0x1ed62; // terrain coef (word entries, 16)

// ─── Helpers ────────────────────────────────────────────────────────────────

function r16(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}
function r32(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>> 0
  );
}
function w16(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

/** Read ROM byte (program image). */
function romB(rom: RomImage, addr: number): number {
  return (rom.program[addr] ?? 0) & 0xff;
}
/** Read ROM word (BE). */
function romW(rom: RomImage, addr: number): number {
  return (((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0)) & 0xffff;
}
/** Read M68k word at abs address `a` (BE). Handles ROM + slapstic, workRam, playfield. */
function readWordAbs(state: GameState, rom: RomImage, a: number): number {
  const u = a >>> 0;
  // ROM 0x000000-0x07FFFF and slapstic 0x080000-0x087FFF live in rom.program (size 0x88000)
  if (u < 0x088000) return romW(rom, u);
  if (u >= WORK_RAM_BASE && u < WORK_RAM_BASE + 0x2000) return r16(state, u - WORK_RAM_BASE);
  if (u >= PF_RAM_BASE && u < PF_RAM_BASE + 0x2000) {
    const off = u - PF_RAM_BASE;
    return (((state.playfieldRam[off] ?? 0) << 8) | (state.playfieldRam[off + 1] ?? 0)) & 0xffff;
  }
  return 0;
}
/** Read M68k long at abs address `a` (BE). */
function readLongAbs(state: GameState, rom: RomImage, a: number): number {
  const u = a >>> 0;
  if (u < 0x088000) {
    return (
      (((rom.program[u] ?? 0) << 24) |
        ((rom.program[u + 1] ?? 0) << 16) |
        ((rom.program[u + 2] ?? 0) << 8) |
        (rom.program[u + 3] ?? 0)) >>> 0
    );
  }
  if (u >= WORK_RAM_BASE && u < WORK_RAM_BASE + 0x2000) return r32(state, u - WORK_RAM_BASE);
  if (u >= PF_RAM_BASE && u < PF_RAM_BASE + 0x2000) {
    const off = u - PF_RAM_BASE;
    return (
      (((state.playfieldRam[off] ?? 0) << 24) |
        ((state.playfieldRam[off + 1] ?? 0) << 16) |
        ((state.playfieldRam[off + 2] ?? 0) << 8) |
        (state.playfieldRam[off + 3] ?? 0)) >>> 0
    );
  }
  return 0;
}

/** sign-extend 16-bit word → JS signed number. */
function s16(v: number): number {
  const u = v & 0xffff;
  return u & 0x8000 ? u - 0x10000 : u;
}
/** asr.w (signed right-shift, 16-bit operand). */
function asrW(v: number, n: number): number {
  return (s16(v) >> n) & 0xffff;
}

// ─── Replica ────────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_0001CABA`.
 *
 * Esegue 4 iterazioni di scanline: ogni iter calcola 4 word di terrain z
 * leggendo dalla playfield RAM + binsearch tables + ROM coef tables, e
 * scrive 16 word in totale a STRUCT @ 0x401c28.
 *
 * @param state  GameState (modifica `workRam[0x1c28..0x1c47]`).
 * @param rom    RomImage (ROM letture: 0x1eb3a, 0x1ed0a, 0x1ed62, 0x24b3a + lvlPtr).
 */
// ─── Probe hook (registry-gated, OFF by default) ──────────────────────────
// Callers (e.g. probe-1caba-runtime-state.ts) can register an observer to
// inspect input/output state at each call. One-shot or multi-shot is up
// to caller. Production paths never set this, so overhead is one undefined
// check.
type Sub1CabaObserver = (
  state: GameState,
  rom: RomImage,
  callIndex: number,
  phase: "pre" | "post",
) => void;
let __sub1caba_observer: Sub1CabaObserver | null = null;
let __sub1caba_call_count = 0;
export function setSub1CabaObserver(obs: Sub1CabaObserver | null): void {
  __sub1caba_observer = obs;
  __sub1caba_call_count = 0;
}

export function sub1CABATileRedraw(state: GameState, rom: RomImage): void {
  const obs = __sub1caba_observer;
  let observedCall = 0;
  if (obs !== null) {
    __sub1caba_call_count++;
    observedCall = __sub1caba_call_count;
    obs(state, rom, observedCall, "pre");
  }
  sub1CABATileRedrawImpl(state, rom);
  if (obs !== null) {
    obs(state, rom, observedCall, "post");
  }
}

function sub1CABATileRedrawImpl(state: GameState, rom: RomImage): void {
  // ── Prologo: setup pointers + initial scan position ───────────────────────
  let a5 = STRUCT_OFF;                          // workRam offset for STRUCT writes
  const lvlPtr = r32(state, OFF_LVLPTR) >>> 0;  // *0x400474 = level header ptr (M68k abs)

  // D0w = *(0x400696) = tileX
  const tileX = r16(state, OFF_TILE_X);
  // D4w = *(0x400698) = tileY
  let d4 = r16(state, OFF_TILE_Y);
  // D4w += 1; D4w += tileX; D4w -= 0x15
  d4 = (d4 + 1 + tileX - 0x15) & 0xffff;
  // ext.l D4 → sign-extend to 32-bit
  let d4Long = s16(d4);

  // D6w = 0x15 - D0w + (D4w asr 1)
  let d6 = (0x15 - tileX + asrW(d4, 1)) & 0xffff;

  // A6 = 0x24b3a; if (D4 bit 0): A6 += 0x12
  let a6 = ROM_TBL_24B3A + ((d4Long & 1) !== 0 ? 0x12 : 0);

  // A4 = 0x400478 + D4 * 2 (workRam offset)
  // Disasm: `lea 0x400478, A4; adda.l D4, A4; adda.l D4, A4` — TWO adds of
  // D4 (long), so net A4 += D4*2 (NOT D4*4 as previously documented).
  // (Long arith, since D4 is signed long now after ext.l)
  let a4Off = (OFF_COL_BASE + d4Long * 2) >>> 0;
  // For bounds checking — a4Off may be negative or out of range when d4Long < 0;
  // we'll guard via the bmi/cmp inside the loop.

  // D2w = *(0x18, A1) = word @ lvlPtr+0x18 (max tile bound)
  const d2Max = readWordAbs(state, rom, (lvlPtr + 0x18) >>> 0);

  // ── LOOP: 4 iterations ─────────────────────────────────────────────────────
  for (let d3 = 0; d3 < 4; d3++) {
    // tst.w D4w; bmi.w 0x1cc42 (D4 < 0 → write 8 zeros + EOI)
    // cmp.w D4w, D2w; ble.w 0x1cc42 (D4 >= D2max → write 8 zeros + EOI)
    // 0x1cc42 has `clr.l (A5)+; clr.l (A5)+` = writes 8 zero bytes to STRUCT,
    // THEN proceeds to END_OF_ITER (0x1cc46). So abortBody = "clear 8 bytes".

    const d4Signed = s16(d4);
    let abortBody = false;
    if (d4Signed < 0) abortBody = true;
    if (s16(d2Max) <= d4Signed) abortBody = true;

    if (abortBody) {
      // Write 8 zero bytes via 2× clr.l (A5)+
      w16(state, a5 + 0, 0);
      w16(state, a5 + 2, 0);
      w16(state, a5 + 4, 0);
      w16(state, a5 + 6, 0);
      a5 = (a5 + 8) >>> 0;
    } else {
      // D0w = D6w
      let d0 = d6;

      // D1 = 0; D1b = D4b; bclr.l #0,D1 → D1 = D4 byte with bit 0 cleared
      const d4b = d4 & 0xff;
      let d1Long = d4b & ~1; // bit 0 cleared
      // beq.b 0x1cb30 (if D1 was 0 after bclr — meaning original bit was 0)
      // bra: if (D4 & 1) → D0w += 0x16
      if ((d4b & 1) !== 0) {
        d0 = (d0 + 0x16) & 0xffff;
      }

      // A0 = 0x1eb3a; A3 = 0xa00000; A3w += *(A0 + D1.w)  [word read]
      // A3w means: only low 16 bits of A3 are modified. A3 is `0x00a0XXXX`.
      let a3 = PF_RAM_BASE >>> 0;
      const off1eb3a = (ROM_TBL_1EB3A + d1Long) >>> 0;
      const pfWordOff = romW(rom, off1eb3a);
      // adda.w D1.w,A3 with sign-extend (m68k adda.w sext word → long)
      a3 = ((a3 + s16(pfWordOff)) >>> 0);

      // A0 = 0x1ed0a; D1b = *(A0 + D0w*1)
      const off1ed0aB = (ROM_TBL_1ED0A + d0) >>> 0;
      d1Long = romB(rom, off1ed0aB);

      // subq.l #2,D1 → D1 -= 2 (signed long)
      d1Long = (d1Long - 2) | 0;

      // adda.l D1,A3
      a3 = ((a3 + d1Long) >>> 0);

      // D1.l = (A3).l → long read from playfield RAM (BE)
      let d1 = readLongAbs(state, rom, a3) >>> 0;

      // D0b = *(A0 + 0x2c + D0w*1)
      const off1ed0aShift = (ROM_TBL_1ED0A + 0x2c + d0) >>> 0;
      const shiftAmt = romB(rom, off1ed0aShift);

      // lsr.l D0,D1 → D1 = D1 >>> shiftAmt (logical)
      d1 = (d1 >>> (shiftAmt & 0x1f)) >>> 0;

      // andi.w #0x7fe,D1 → mask to 11-bit even word index
      const idx = (d1 & 0x7fe) & 0xffff;

      // A0 = *(0x40065a).l → bsearch base (M68k abs)
      const bsearchBase = r32(state, OFF_BSEARCH_PTR) >>> 0;

      // D0w = *(A0 + D1w*1) → terrain code (word)
      let terrainCode = readWordAbs(state, rom, (bsearchBase + idx) >>> 0);

      // ── Dispatch on terrainCode (D0w) ──────────────────────────────────────
      // cmpi.w #0x1000, D0w; bcc.b 0x1cbd0 (unsigned >= 0x1000)
      // Use unsigned semantics for `bcc` (no carry = >=).
      dispatchLoop: for (;;) {
        if ((terrainCode & 0xffff) >= 0x1000) {
          // PATH_TERRAIN_BIG (0x1CBD0)
          // cmpi.w #-0x1000, D0w; bcc.b 0x1cc2e (unsigned >= 0xf000)
          if ((terrainCode & 0xffff) >= 0xf000) {
            // PATH_TERRAIN_TOP (0x1CC2E): D0w = D0w & 0x7f - 0x40 + (A4)
            let v = terrainCode & 0x7f;
            v = (v - 0x40) & 0xffff;
            const colVal = r16(state, a4Off);
            v = (v + colVal) & 0xffff;
            // 4× (A5)+ = D0w
            w16(state, a5 + 0, v);
            w16(state, a5 + 2, v);
            w16(state, a5 + 4, v);
            w16(state, a5 + 6, v);
            a5 = (a5 + 8) >>> 0;
            break dispatchLoop;
          }
          // D5w = D0w
          const d5w = terrainCode & 0xffff;
          // D1w = D0w
          // D0w &= 0x7f; D0w -= 0x40; D0w += (A4)
          let v0 = (terrainCode & 0x7f) - 0x40;
          v0 = (v0 + r16(state, a4Off)) & 0xffff;
          // D1w = D5w asr 6
          let v1 = asrW(d5w, 6);
          // D1w &= 0x3e
          v1 = v1 & 0x3e;
          // D1w = *(A2 + D1w*1) where A2 = 0x1ed62
          const coef = romW(rom, (ROM_TBL_1ED62 + v1) >>> 0);
          // cmpi.w #0x1000, D1w; beq.b 0x1cbfa
          let alt: number;
          if (coef === 0x1000) {
            alt = 0;
          } else {
            // neg.w D1w; D1w += D0w → alt = -coef + v0
            alt = ((-s16(coef) + s16(v0)) & 0xffff) >>> 0;
          }
          // 4 conditional writes per bit 12..15 of D5
          // btst.l #0xc,D5; beq → use D1, else → use D0 [layout: bit set → D0, bit clear → D1]
          // Looking at disasm:
          //   btst.l #0xc,D5; beq.b 0x1cc06; move.w D0w,(A5)+; bra 0x1cc08;
          //   0x1cc06: move.w D1w,(A5)+
          // So: if (D5 bit 12) → write D0; else → write D1
          // Same for bits 13,14,15.
          const writeBit = (bit: number) => {
            const useD0 = (d5w & (1 << bit)) !== 0;
            return useD0 ? (v0 & 0xffff) : (alt & 0xffff);
          };
          w16(state, a5 + 0, writeBit(12));
          w16(state, a5 + 2, writeBit(13));
          w16(state, a5 + 4, writeBit(14));
          w16(state, a5 + 6, writeBit(15));
          a5 = (a5 + 8) >>> 0;
          break dispatchLoop;
        }
        // cmpi.w #0x800, D0w; bcc.b 0x1cbc0 (unsigned >= 0x800)
        if ((terrainCode & 0xffff) >= 0x800) {
          // PATH_INDIRECT (0x1CBC0)
          // D0w &= 0x7fe; A0 = 0x40076e; D0w = *(A0 + D0w*1)
          const idx2 = (terrainCode & 0x7fe) & 0xffff;
          terrainCode = r16(state, (OFF_BSEARCH_ALT + idx2) >>> 0);
          // bra 0x1cb64 → re-dispatch
          continue dispatchLoop;
        }
        // tst.w D0w; beq.w 0x1cc42 → write 8 zero bytes + EOI
        if ((terrainCode & 0xffff) === 0) {
          // PATH_TC_ZERO: branches to 0x1cc42 = `clr.l (A5)+; clr.l (A5)+`
          // → writes 8 zero bytes to STRUCT, THEN proceeds to END_OF_ITER.
          w16(state, a5 + 0, 0);
          w16(state, a5 + 2, 0);
          w16(state, a5 + 4, 0);
          w16(state, a5 + 6, 0);
          a5 = (a5 + 8) >>> 0;
          break dispatchLoop;
        }
        // PATH_DIRECT (0x1CB76): D0w in [1..0x7FF]
        // ext.l D0; A0 = D0 + (A1), where (A1) is the descriptor's first
        // long pointer. This is not lvlPtr-relative data: L4 reaches records
        // in the slapstic window, e.g. lvlPtr 0x2d648 -> base 0x8123e.
        const directRecordBase = readLongAbs(state, rom, lvlPtr) >>> 0;
        const a0Long = (s16(terrainCode) + directRecordBase) >>> 0;
        // D1w = (A4) - 0x80
        let d1c = (r16(state, a4Off) - 0x80) & 0xffff;
        // 4× iter: D0w = 0; D0b = (A0)+; if 0 → (A5)+ = 0; else D0w += D1w; (A5)+ = D0w
        for (let k = 0; k < 4; k++) {
          const byte = romB(rom, (a0Long + k) >>> 0);
          if (byte === 0) {
            w16(state, a5 + k * 2, 0);
          } else {
            const v = (byte + d1c) & 0xffff;
            w16(state, a5 + k * 2, v);
          }
        }
        a5 = (a5 + 8) >>> 0;
        // 4th iter branches to END_OF_ITER (same as fall-through). OK.
        break dispatchLoop;
      }
    }

    // END_OF_ITER (0x1CC46):
    //   D6w += (A6)+         ; step1 word
    //   D0w = (A6)+          ; step2 word
    //   D4w += D0w
    //   D0w += D0w           ; D0 *= 2
    //   A4 += D0w (with sign-extend)
    //   A5 += (A6)+          ; step3 word (signed sext to long)
    //   D3w += 1; if D3 != 4: bra LOOP
    const step1 = romW(rom, a6);          // for D6
    const step2 = romW(rom, (a6 + 2) >>> 0); // for D4 and *2 for A4
    const step3 = romW(rom, (a6 + 4) >>> 0); // for A5
    a6 = (a6 + 6) >>> 0;

    d6 = (d6 + step1) & 0xffff;
    d4 = (d4 + step2) & 0xffff;
    d4Long = s16(d4);
    // A4 += step2 * 2 (sign-extend)
    a4Off = (a4Off + s16(step2) * 2) >>> 0;
    // A5 += step3 (sign-extend word → long)
    a5 = (a5 + s16(step3)) >>> 0;
  }
}
